import { qualityRT } from "../../state/qualityStore"
import { heroLook, heroWet } from "../vfx/heroRuntime"
import { capTexture, characterTextureMax } from "./textureBudget"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { FaceRig } from "./faceRig"
import type { FaceUniforms, HumanAsset } from "./human/humanAsset"

/**
 * Loader for the rigged human characters: the built-in ones made by
 * asset-pipeline/characters/build_human.py (public/assets/characters/*.glb)
 * and custom models that follow docs/CHARACTER_ASSETS.md.
 *
 * The GLBs carry their own textures (skin, outfit, hair, eyes, brows, lashes,
 * teeth) and simple PBR materials; this module upgrades each part's material
 * for the game's lighting (skin sheen and a cheek flush, alpha-tested hair
 * cards, wet eyes, fabric sheen) and attaches a FaceRig that turns
 * HumanAnimator's expression codes into ARKit morphs and eye gaze.
 */

export type CharacterStyle = "real"

/**
 * Bones every character model must have (names as they arrive after three.js
 * strips the dots: "upperarm.L" -> "upperarmL"). HumanAnimator drives these.
 */
export const CORE_BONES = [
  "hips", "spine", "chest", "neck", "head",
  ...["L", "R"].flatMap((s) => [`shoulder${s}`, `upperarm${s}`, `forearm${s}`, `hand${s}`, `thigh${s}`, `shin${s}`, `foot${s}`]),
]

/** The full rig of the built-in characters: CORE_BONES plus fingers, toes, eyes and the two cape bones. */
export const REAL_REQUIRED_BONES = [
  "root", "hips", "spine", "chest", "neck", "head", "cape", "cape2", "eyeL", "eyeR",
  ...["L", "R"].flatMap((s) => [
    `shoulder${s}`, `upperarm${s}`, `forearm${s}`, `hand${s}`, `thigh${s}`, `shin${s}`, `foot${s}`, `toe${s}`,
    ...["index", "middle", "ring", "pinky", "thumb"].flatMap((f) => [1, 2, 3].map((k) => `${f}${k}${s}`)),
  ]),
]

/** Standing heights of the rest pose (m above the soles), read from the rig. */
export type BodyMeasure = { top: number; eye: number; shoulder: number; chest: number; waist: number; hand: number }

export const measureBody = (root: THREE.Object3D, bones: Map<string, THREE.Bone>, skinned: THREE.SkinnedMesh[]): BodyMeasure => {
  root.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const y = (name: string): number => {
    const b = bones.get(name)
    return b ? new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).applyMatrix4(inv).y : 0
  }
  let top = 0
  const v = new THREE.Vector3()
  for (const mesh of skinned) {
    const p = mesh.geometry.getAttribute("position")
    for (let i = 0; i < p.count; i++) top = Math.max(top, v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv).y)
  }
  const shoulder = (y("upperarmL") + y("upperarmR")) / 2
  return {
    top,
    eye: (y("eyeL") + y("eyeR")) / 2,
    shoulder,
    chest: y("chest") + (shoulder - y("chest")) * 0.45,
    waist: y("spine"),
    hand: (y("handL") + y("handR")) / 2,
  }
}

const skinMaterial = (from: THREE.MeshStandardMaterial, rig: FaceRig, cheeks: [THREE.Vector3, THREE.Vector3]): THREE.MeshPhysicalMaterial => {
  const m = new THREE.MeshPhysicalMaterial({
    map: from.map, roughness: 0.52, metalness: 0,
    // a soft grazing sheen reads as skin's fine hair and subsurface glow
    sheen: 0.35, sheenRoughness: 0.55, sheenColor: new THREE.Color("#ffb59a"),
  })
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uBlush = rig.blush
    shader.uniforms.uCheekL = { value: cheeks[0] }
    shader.uniforms.uCheekR = { value: cheeks[1] }
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vRest;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRest = position;")
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vRest;\nuniform float uBlush;\nuniform vec3 uCheekL;\nuniform vec3 uCheekR;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
// a warm flush over the cheekbones when the character is happy, shy or out of breath
float cheek = max(exp(-pow(distance(vRest, uCheekL) / 0.022, 2.0)), exp(-pow(distance(vRest, uCheekR) / 0.022, 2.0)));
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.08, 0.78, 0.76), clamp(uBlush, 0.0, 1.0) * cheek * 0.55);`,
      )
  }
  m.customProgramCacheKey = () => "real-skin-v1"
  return m
}

const fabric = (from: THREE.MeshStandardMaterial, opts: Partial<THREE.MeshPhysicalMaterialParameters> = {}): THREE.MeshPhysicalMaterial =>
  new THREE.MeshPhysicalMaterial({
    map: from.map, normalMap: from.normalMap, color: from.map ? 0xffffff : from.color,
    roughness: 0.86, metalness: 0, sheen: 0.45, sheenRoughness: 0.7, sheenColor: new THREE.Color("#e8dcd4"),
    ...opts,
  })

const cards = (from: THREE.MeshStandardMaterial, rough: number): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({
    map: from.map, roughness: rough, metalness: 0, side: THREE.DoubleSide,
    // alpha-tested cards sort correctly and keep their shadows; MSAA turns
    // the cut-out edge into coverage so strands stay soft
    alphaTest: 0.42, alphaToCoverage: true, transparent: false,
  })

/**
 * How much each part darkens when soaked (wet cloth and hair lose the light
 * their dry fibres scattered; skin barely changes), for the shared hero patch.
 */
const HERO_SOAK: Record<string, number> = { body: 0.06, outfit: 0.36, hair: 0.24, shoes: 0.3 }

/**
 * The playable people's own light and weather (vfx/heroRuntime.ts):
 *  - a rim along the silhouette, sky light all round and sunlight on the
 *    edges turned toward the sun, so they stand out of the world the way a
 *    film lights its leads (strongest backlit, as a real rim is);
 *  - wetness: darker and glossier cloth, hair and skin as rain soaks them,
 *    or below the water line when they wade (rest-pose height).
 * Chained after the part's own shader edits; the program key follows them.
 */
const heroSurface = (m: THREE.MeshStandardMaterial, id: "explorer" | "companion", soak: number): void => {
  const before = m.onBeforeCompile
  const key = m.customProgramCacheKey.bind(m)
  m.onBeforeCompile = (shader, renderer) => {
    before.call(m, shader, renderer)
    shader.uniforms.uHeroRim = heroLook.uHeroRim
    shader.uniforms.uHeroSunRim = heroLook.uHeroSunRim
    shader.uniforms.uHeroSun = heroLook.uHeroSun
    shader.uniforms.uHeroWet = heroWet[id]
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vHeroRest;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvHeroRest = position;")
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vHeroRest;\nuniform vec3 uHeroRim;\nuniform vec3 uHeroSunRim;\nuniform vec3 uHeroSun;\nuniform vec2 uHeroWet;")
      .replace("#include <color_fragment>", `#include <color_fragment>
float heroWet = max(uHeroWet.x, 1.0 - smoothstep(uHeroWet.y - 0.04, uHeroWet.y + 0.04, vHeroRest.y));
diffuseColor.rgb *= 1.0 - ${soak.toFixed(3)} * heroWet;`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.4, heroWet);`)
      .replace("#include <opaque_fragment>", `{
  vec3 heroV = normalize(vViewPosition);
  float heroF = 1.0 - clamp(dot(normal, heroV), 0.0, 1.0);
  heroF = heroF * heroF * heroF;
  vec3 heroL = normalize((viewMatrix * vec4(uHeroSun, 0.0)).xyz);
  float heroSun = clamp(dot(normal, heroL), 0.0, 1.0);
  outgoingLight += (uHeroRim + uHeroSunRim * heroSun * 1.6) * heroF * (0.35 + 0.65 * diffuseColor.rgb) * (1.0 + heroWet * 0.6);
}
#include <opaque_fragment>`)
  }
  m.customProgramCacheKey = () => `${key()}|hero-${soak}`
}

/** The parts the built-in characters are made of (asset-pipeline/characters/build_human.py). */
export const PART_ROLES = ["body", "eyes", "brows", "lashes", "hair", "teeth", "outfit", "shoes"] as const

/** A mesh's part: its name ("hair"), or the part after a prefix ("hero_hair", "hair_1"). Anything else keeps its own material. */
export const partRole = (meshName: string): string => {
  const name = meshName.toLowerCase()
  if ((PART_ROLES as readonly string[]).includes(name)) return name
  const parts = name.split(/[_.-]/)
  return parts.find((p) => (PART_ROLES as readonly string[]).includes(p)) ?? name
}

/** Material for one part, chosen by the mesh's role. */
const materialFor = (role: string, from: THREE.MeshStandardMaterial, rig: FaceRig, cheeks: [THREE.Vector3, THREE.Vector3]): THREE.Material => {
  switch (role) {
    case "body": return skinMaterial(from, rig, cheeks)
    // wet eyes with a living catch-light, but not a mirror of the whole sky:
    // a full-strength environment reflection washed dark irises to grey-blue
    case "eyes": return new THREE.MeshPhysicalMaterial({ map: from.map, roughness: 0.2, clearcoat: 0.7, clearcoatRoughness: 0.06, envMapIntensity: 0.35 })
    // brows a touch darker and fuller than the raw cards, so they read at play distance
    case "brows": { const m = cards(from, 0.85); m.color.setScalar(0.84); m.alphaTest = 0.36; return m }
    case "lashes": return cards(from, 0.85)
    case "hair": return cards(from, 0.62)
    case "teeth": return new THREE.MeshStandardMaterial({ map: from.map, roughness: 0.32 })
    case "outfit": return fabric(from, { sheen: 0.3 })
    case "shoes": return new THREE.MeshStandardMaterial({ map: from.map, roughness: 0.62 })
    default: return from
  }
}

/**
 * Load a rigged human for a character role. `strict` (the built-in presets)
 * demands the full rig; a custom model needs only CORE_BONES.
 */
export const loadRealHuman = async (id: "explorer" | "companion", url: string, strict = true): Promise<HumanAsset> => {
  // meshopt-compressed models decode locally; Draco and KTX2 are not supported (docs/CHARACTER_ASSETS.md)
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url)
  const root = new THREE.Group()
  root.name = `${id}-model`
  root.add(gltf.scene)
  const bones = new Map<string, THREE.Bone>()
  const skinned: THREE.SkinnedMesh[] = []
  gltf.scene.traverse((object) => {
    const bone = object as THREE.Bone
    if (bone.isBone) bones.set(bone.name, bone)
  })
  const missing = (strict ? REAL_REQUIRED_BONES : CORE_BONES).filter((b) => !bones.has(b))
  if (missing.length > 0) throw new Error(`the ${id} model is missing bones: ${missing.join(", ")}`)

  const rig = new FaceRig(root, bones)
  root.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const head = new THREE.Vector3().setFromMatrixPosition(bones.get("head")!.matrixWorld).applyMatrix4(inv)
  // without eye bones, estimate the eyes from the head joint
  const eye = (name: string): THREE.Vector3 => {
    const bone = bones.get(name)
    if (bone) return new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld).applyMatrix4(inv)
    return head.clone().add(new THREE.Vector3(name === "eyeL" ? 0.032 : -0.032, 0.07, 0.085))
  }
  // cheekbones sit a little below and outside the eyes, toward the front
  const cheeks: [THREE.Vector3, THREE.Vector3] = [eye("eyeL").add(new THREE.Vector3(0.012, -0.034, 0.008)), eye("eyeR").add(new THREE.Vector3(-0.012, -0.034, 0.008))]
  const textureMax = characterTextureMax(qualityRT.level)

  gltf.scene.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh
    if (!(mesh as THREE.Mesh).isMesh) return
    const role = partRole(mesh.name)
    const from = mesh.material as THREE.MeshStandardMaterial
    capTexture(from.map, textureMax)
    capTexture(from.normalMap, textureMax)
    if (from.map) from.map.anisotropy = 4
    mesh.material = materialFor(role, from, rig, cheeks)
    if (from !== mesh.material) from.dispose()
    const soak = HERO_SOAK[role]
    if (soak !== undefined && (mesh.material as THREE.MeshStandardMaterial).isMeshStandardMaterial) heroSurface(mesh.material as THREE.MeshStandardMaterial, id, soak)
    // eyelashes, brows and teeth are too thin to shadow anything usefully
    mesh.castShadow = !["lashes", "brows", "teeth", "eyes"].includes(role)
    mesh.receiveShadow = true
    // skinned bounds change with pose; the character is always near the camera
    mesh.frustumCulled = false
    if (mesh.isSkinnedMesh) skinned.push(mesh)
  })

  // The atlas uniforms stay for HumanAnimator's expression codes; nothing
  // samples the atlas on these faces.
  const face: FaceUniforms = {
    uAtlas: { value: null },
    uEyes: { value: 0 },
    uMouth: { value: 8 },
    uBlush: { value: 0 },
    uSkin: { value: new THREE.Color("#c9926f") },
  }
  return { root, skinned, bones, face, faceRig: rig, style: "real", measure: measureBody(root, bones, skinned) }
}
