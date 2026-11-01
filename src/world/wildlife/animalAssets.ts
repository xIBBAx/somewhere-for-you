import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js"
import { CAT_BREEDS } from "./catBreeds"
import { disposeFadeable } from "../render/aerialFog"

/**
 * Rigged animals. `asset-pipeline/blender/build_animals.py` builds the first five;
 * `asset-pipeline/blender/build_wildlife_v2.py` builds the far-world set (horse,
 * monkey, tiger, cheetah, gorilla) with their own anatomy and masks. Each
 * instance is a SkeletonUtils clone sharing geometry; coats are chosen per
 * animal from palettes, using the vertex-colour masks baked in Blender.
 */
export type Species = "cat" | "rabbit" | "deer" | "fox" | "duck" | "horse" | "monkey" | "tiger" | "cheetah" | "gorilla"
export const SPECIES: Species[] = ["cat", "rabbit", "deer", "fox", "duck", "horse", "monkey", "tiger", "cheetah", "gorilla"]

/** The far-world species are streamable wildlife with their own rig family. */
export const WILDLIFE_V2: Species[] = ["horse", "monkey", "tiger", "cheetah", "gorilla"]

/**
 * A species is driven by QuadrupedAnimator when its limbs are named legF/legB;
 * the primates are driven by PrimateAnimator, which bends arm{L,R}1..2 and
 * leg{L,R}1..2 and knows about knuckle-walking, sitting and climbing.
 */
export const PRIMATE_SPECIES: Species[] = ["monkey", "gorilla"]
export const isPrimate = (s: Species): boolean => PRIMATE_SPECIES.includes(s)

/**
 * Pattern features beyond the baked tabby mask (see `catBreeds.ts`). Every
 * field is off by default, so coats without a `look` render as before.
 */
export type CoatLook = {
  /** 0..1: hide the tabby bars, leaving only ghost markings */
  solid?: number
  /** spots per metre over the torso (Bengal, Egyptian Mau); legs, tail and face keep their bars */
  spots?: number
  /** 0..1 coverage of tortoiseshell blotches in `patch` */
  tortie?: number
  patch?: string
  /** 0..1: `pattern` darkens face, ears, legs and tail (Siamese, Ragdoll, Birman) */
  point?: number
  /** 0..1 white spotting in `light`, from gloves (0.15) to bicolour (0.55) */
  white?: number
  /** 1: white all over but for a coloured cap and tail (Turkish Van) */
  van?: number
}
/** Proportions on one cat's own skeleton; `size` multiplies its spawn scale. */
export type CatBuild = { size?: number; head?: number; ears?: number; tail?: number; earFold?: number }

/** `eye`: optional multiplier on the baked (olive-green) iris, so wild cats
 * get their own amber, copper or hazel eyes from the one asset. */
export type Coat = {
  name: string; base: string; light: string; pattern: string; eye?: [number, number, number]
  look?: CoatLook; build?: CatBuild
  /** what a new friend of this coat says, instead of the species' lines */
  lines?: string[]
  /** a duck's bill colour (the bill shares the head's pattern mask in the asset) */
  bill?: string
}

/**
 * Real coat colours: `base` is the mid-tone, `light` the pale ventral/chest
 * field and `pattern` the darker markings baked as a mask in Blender.
 */
export const COATS: Record<Species, Coat[]> = {
  cat: [
    /** Wild cats: everyday moggies and real breeds (`catBreeds.ts`). */
    ...CAT_BREEDS,
    /** The cat, the explorer's own cat: silver-grey fur with charcoal tabby stripes
     * and a paler silver muzzle, chest ruff and inner legs. Last in the
     * list and never rolled for a wild
     * cat (see `WILD_CAT_COATS`). */
    { name: "cat", base: "#b6bcc3", light: "#e1e4e7", pattern: "#25292e" },
  ],
  rabbit: [
    { name: "brown", base: "#9a7856", light: "#eee3d1", pattern: "#9a7856" },
    { name: "grey", base: "#a49d95", light: "#eeeae5", pattern: "#a49d95" },
    { name: "white", base: "#efe9e0", light: "#fbf8f3", pattern: "#efe9e0" },
  ],
  deer: [{ name: "fallow", base: "#a4703f", light: "#f0e4d4", pattern: "#f3e8d8" }],
  fox: [{ name: "red fox", base: "#cf5f21", light: "#f6efe6", pattern: "#241a15" }],
  duck: [
    { name: "mallard", base: "#8b7250", light: "#d8cec0", pattern: "#1f4f34", bill: "#c4ad3a" },
    { name: "white duck", base: "#f2eee5", light: "#fbf8f2", pattern: "#f2eee5", bill: "#e8862a" },
  ],
  // --- far-world set (asset-pipeline/blender/build_wildlife_v2.py) ---
  // The masks are authored per species: the horse is bay/chestnut with socks
  // and a blaze, the tiger is striped with a white cheek/belly field, the
  // cheetah is spotted with a tear line, the monkey is a macaque tan, and the
  // gorilla is a silverback black whose saddle is the lighter tone.
  horse: [
    { name: "bay", base: "#7c3f18", light: "#e8dccb", pattern: "#2c1608", eye: [1.0, 1.0, 1.0] },
    { name: "chestnut", base: "#9a4d1c", light: "#f2e2cc", pattern: "#3d1e0a" },
    { name: "palomino", base: "#d8a83c", light: "#f7ecc9", pattern: "#b98322" },
    { name: "grey", base: "#8a857c", light: "#efece5", pattern: "#4a463f" },
    { name: "black", base: "#26221f", light: "#4a423c", pattern: "#171412" },
  ],
  monkey: [
    { name: "rhesus macaque", base: "#8a6b4c", light: "#d9b993", pattern: "#5a4330" },
    { name: "mangabey", base: "#b09170", light: "#e6d3bb", pattern: "#7a6047" },
    { name: "bonnet macaque", base: "#9a8368", light: "#e2d4c2", pattern: "#6b5744" },
  ],
  tiger: [
    { name: "bengal tiger", base: "#c9761f", light: "#f4ead8", pattern: "#2b1b0d", eye: [1.1, 1.05, 0.7] },
    { name: "white tiger", base: "#efe6da", light: "#fbf6ee", pattern: "#4a3f33", eye: [1.15, 1.05, 0.75] },
  ],
  cheetah: [
    { name: "cheetah", base: "#c9a468", light: "#f2e7d2", pattern: "#241a10", eye: [1.0, 1.05, 0.6] },
  ],
  gorilla: [
    { name: "silverback", base: "#403b37", light: "#69615b", pattern: "#9a958d" },
    { name: "western lowland", base: "#3a332e", light: "#6b645c", pattern: "#4a443d" },
  ],
}

/** Wild cats roll their coat from the first entries only; the cat's is hers. */
export const WILD_CAT_COATS = COATS.cat.length - 1

/** Strength of the fur sheen term per species (feathery vs. plush coats). */
const SHEEN: Record<Species, number> = {
  cat: 0.5, rabbit: 0.75, deer: 0.35, fox: 0.6, duck: 0.2,
  // the far-world set: a horse's coat is a coarse hair roan, a big cat's is
  // short and sleek, a primate's is dense plush
  horse: 0.42, monkey: 0.62, tiger: 0.4, cheetah: 0.36, gorilla: 0.55,
}

const coatMaterial = (coat: Coat, species: Species): THREE.MeshStandardMaterial => {
  // Fur is very rough; a touch of sheen sells the fibre without a second pass.
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 })
  const uniforms = {
    uBase: { value: new THREE.Color(coat.base) },
    uLight: { value: new THREE.Color(coat.light) },
    uPattern: { value: new THREE.Color(coat.pattern) },
    uSheen: { value: SHEEN[species] ?? 0.5 },
    uEye: { value: new THREE.Vector3(...(coat.eye ?? [1, 1, 1])) },
    uMarking: { value: species === "tiger" ? 1 : species === "cheetah" ? 2 : 0 },
    // breed looks; all zero leaves the coat exactly as the plain tabby path draws it
    uSolid: { value: coat.look?.solid ?? 0 },
    uSpots: { value: coat.look?.spots ?? 0 },
    uTortie: { value: coat.look?.tortie ?? 0 },
    uPatch: { value: new THREE.Color(coat.look?.patch ?? "#000000") },
    uPoint: { value: coat.look?.point ?? 0 },
    uWhite: { value: coat.look?.white ?? 0 },
    uVan: { value: coat.look?.van ?? 0 },
    uBill: { value: new THREE.Color(coat.bill ?? "#000000") },
    uBillOn: { value: coat.bill ? 1 : 0 },
    // 0 dry … 1 soaked: wet fur clumps, darkens and takes a soft sheen
    uWet: { value: 0 },
  }
  m.userData.coat = uniforms
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vAnimalRest;\nvarying vec3 vAnimalNormal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvAnimalRest = position;\nvAnimalNormal = normal;")
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform vec3 uBase, uLight, uPattern, uEye, uPatch, uBill;
uniform float uSheen, uMarking, uSolid, uSpots, uTortie, uPoint, uWhite, uVan, uBillOn, uWet;
varying vec3 vAnimalRest, vAnimalNormal;
vec2 spotHash(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}
float cheetahSpots(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  float nearest = 2.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 offset = vec2(float(x), float(y));
    vec2 centre = 0.22 + 0.56 * spotHash(cell + offset);
    nearest = min(nearest, length(offset + centre - f));
  }
  float aa = max(fwidth(nearest), 0.025);
  return 1.0 - smoothstep(0.19 - aa, 0.19 + aa, nearest);
}`)
      .replace(
        "#include <color_fragment>",
        `vec4 mask = vColor;
vec3 coat = mix(uBase, uLight, mask.g);
// Markings use the undeformed mesh position. They remain attached to the fur
// through skinning and retain their shape between vertices and across LODs.
float marking = mask.b;
if (uMarking > 0.5 && uMarking < 1.5) {
  float phase = vAnimalRest.z * 25.0 + sin(vAnimalRest.y * 15.0 + vAnimalRest.z * 5.0) * 1.1;
  float wave = abs(sin(phase));
  float aa = max(fwidth(wave), 0.025);
  marking = 1.0 - smoothstep(0.25 - aa, 0.25 + aa, wave);
} else if (uMarking > 1.5) {
  vec3 n = abs(vAnimalNormal);
  vec2 plane = n.x > n.y && n.x > n.z ? vAnimalRest.yz : n.y > n.z ? vAnimalRest.xz : vAnimalRest.xy;
  marking = cheetahSpots(plane * 16.0);
  // Short dark tear marks below the forward-facing eyes.
  float tear = (1.0 - smoothstep(0.011, 0.022, abs(abs(vAnimalRest.x) - 0.042)))
    * smoothstep(0.50, 0.55, vAnimalRest.z)
    * smoothstep(0.72, 0.75, vAnimalRest.y) * (1.0 - smoothstep(0.81, 0.84, vAnimalRest.y));
  marking = max(marking, tear);
}
// --- cat breeds (catBreeds.ts). Each term is skipped at zero, so the cat and the
// other species take exactly the path above. Regions are in the cat's rest
// space: +z forward, head z > 0.13, paws y < 0.04, tail z < -0.15.
vec3 rest = vAnimalRest;
if (uSpots > 0.0) {
  vec3 n = abs(vAnimalNormal);
  vec2 plane = n.x > n.y && n.x > n.z ? rest.yz : n.y > n.z ? rest.xz : rest.xy;
  float torso = smoothstep(0.10, 0.15, rest.y) * smoothstep(-0.16, -0.10, rest.z) * (1.0 - smoothstep(0.10, 0.15, rest.z));
  marking = mix(marking, cheetahSpots(plane * uSpots), torso);
}
if (uSolid > 0.0) marking *= 1.0 - uSolid;
coat = mix(coat, uPattern, marking * (1.0 - mask.g * 0.7));
if (uTortie > 0.0) {
  // continuous crossed sines (a hashed value noise draws blocks on ANGLE)
  vec3 q = rest * 38.0;
  float blot = sin(q.x * 1.3 + sin(q.z * 0.9) * 2.1) * sin(q.z * 1.1 + sin(q.y * 1.7) * 1.6)
    + 0.55 * sin(q.y * 2.3 + q.x * 0.7 + sin(q.z * 1.9));
  float aa = max(fwidth(blot), 0.02);
  float threshold = 0.9 - 1.6 * uTortie;
  float patchMask = smoothstep(threshold - aa, threshold + aa, blot) * (1.0 - mask.g * 0.6);
  coat = mix(coat, uPatch * mix(1.0, 0.8, mask.b), patchMask);
}
if (uPoint > 0.0) {
  // the mask: eyes, nose and whisker pads (the face front is z 0.19-0.23); the chin stays pale
  float face = smoothstep(0.172, 0.2, rest.z) * smoothstep(0.228, 0.248, rest.y);
  float ears = smoothstep(0.315, 0.335, rest.y) * smoothstep(0.11, 0.14, rest.z);
  float legs = 1.0 - smoothstep(0.07, 0.14, rest.y);
  float tail = 1.0 - smoothstep(-0.22, -0.15, rest.z);
  float points = max(max(face, ears), max(legs, tail));
  // a little shading along the spine, as on a mature colourpoint
  points = max(points, 0.18 * smoothstep(0.26, 0.31, rest.y) * (1.0 - face));
  coat = mix(coat, uPattern, points * uPoint);
}
if (uWhite > 0.0 || uVan > 0.0) {
  float paws = 1.0 - smoothstep(0.025, 0.06, rest.y);
  float lowLegs = (1.0 - smoothstep(0.08, 0.15, rest.y)) * 0.8;
  float belly = (1.0 - smoothstep(0.13, 0.19, rest.y)) * smoothstep(-0.14, -0.08, rest.z) * 0.72;
  float blaze = (1.0 - smoothstep(0.008, 0.02, abs(rest.x))) * smoothstep(0.205, 0.225, rest.z)
    * smoothstep(0.255, 0.27, rest.y) * (1.0 - smoothstep(0.30, 0.315, rest.y)) * 0.8;
  float field = max(max(paws, lowLegs), max(belly, max(mask.g * 0.9, blaze)));
  float white = smoothstep(0.93 - uWhite, 1.07 - uWhite, field);
  if (uVan > 0.0) {
    float cap = smoothstep(0.285, 0.30, rest.y) * smoothstep(0.12, 0.15, rest.z);
    float tail = 1.0 - smoothstep(-0.21, -0.17, rest.z);
    white = max(white, uVan * (1.0 - max(cap, tail)));
  }
  coat = mix(coat, uLight, white);
}
// a duck's bill: in the asset it shares the head's pattern mask, so it took the
// head colour (white on a white duck). Rest space: bill z > 0.23, y 0.285-0.32.
if (uBillOn > 0.0) {
  float bill = smoothstep(0.222, 0.234, rest.z) * smoothstep(0.280, 0.287, rest.y) * (1.0 - smoothstep(0.317, 0.324, rest.y));
  coat = mix(coat, uBill, bill);
}
coat *= mask.r;
// water darkens fur (light no longer scatters between dry fibres)
coat *= mix(1.0, 0.62, uWet);
// glossy literal parts are the eyes: tint the iris, never the white catchlight
float eyeTint = step(0.5, mask.a) * step(mask.a, 0.9) * (1.0 - smoothstep(0.55, 0.85, max(mask.r, max(mask.g, mask.b))));
diffuseColor.rgb = mask.a > 0.5 ? mask.rgb * mix(vec3(1.0), uEye, eyeTint) : coat;`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
// Break up the perfect smoothness with the baked grain so the coat reads as
// fur rather than painted plastic. mask.rgb is unused on literal-colour parts.
float furGrain = fract(sin(dot(mask.rgb, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
roughnessFactor = clamp(roughnessFactor - 0.06 * furGrain, 0.62, 1.0);
// Eyes are baked as literal colours with alpha 0.75: wet and glossy, so the
// sun leaves a real catchlight on the cornea. Noses and claws stay matte.
if (mask.a > 0.5 && mask.a < 0.9) roughnessFactor = 0.16;
else roughnessFactor = mix(roughnessFactor, 0.45, uWet);`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
// Cheap fur sheen: light wraps the silhouette and grazes the fibres, which
// is what separates a coat from painted plastic. Fresnel x up-facing term.
vec3 furN = normalize(vNormal);
vec3 furV = normalize(vViewPosition);
float wrap = pow(1.0 - clamp(dot(furN, furV), 0.0, 1.0), 2.4);
float graze = pow(clamp(furN.y * 0.5 + 0.5, 0.0, 1.0), 3.0);
totalEmissiveRadiance += diffuseColor.rgb * (wrap * 0.20 + graze * 0.06) * uSheen * (1.0 - step(0.5, mask.a));`,
      )
  }
  m.customProgramCacheKey = () => "animal-coat-v6-breeds-bills"
  return m
}

type Template = { scene: THREE.Object3D }
const templates = new Map<string, Promise<Template | null>>()

const loadTemplate = (s: Species, lod = 0): Promise<Template | null> => {
  const key = `${s}:${lod}`
  let p = templates.get(key)
  if (!p) {
    p = new GLTFLoader()
      .loadAsync(`/assets/animals/${s}${lod === 1 ? "-lod1" : ""}.glb`)
      .then((g) => ({ scene: g.scene }))
      .catch((error) => {
        console.warn(`[wildlife] ${s} LOD ${lod} unavailable`, error)
        return null
      })
    templates.set(key, p)
  }
  return p
}

export const preloadAnimals = (): Promise<unknown> => Promise.all(SPECIES.map(s => loadTemplate(s)))

export type AnimalModel = {
  root: THREE.Group
  bones: Map<string, THREE.Bone>
  material: THREE.MeshStandardMaterial
  meshes: THREE.SkinnedMesh[]
}

type GeometryLOD = { high: THREE.BufferGeometry[]; low: THREE.BufferGeometry[]; detailed: boolean }
const homeGeometryLODs = new WeakMap<AnimalModel, GeometryLOD>()
const releasedModels = new WeakSet<AnimalModel>()

/** Home residents keep one skeleton and animator while swapping the shared
 * far geometry. Both exports use the same joint order and bind transforms. */
export const prepareHomeAnimalLOD = async (model: AnimalModel, species: Species): Promise<void> => {
  const template = await loadTemplate(species, 1)
  if (!template || releasedModels.has(model)) return
  const low: THREE.SkinnedMesh[] = []
  template.scene.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) low.push(o as THREE.SkinnedMesh) })
  const sameMatrix = (a: THREE.Matrix4, b: THREE.Matrix4): boolean => a.elements.every((v, i) => Math.abs(v - b.elements[i]) < 1e-5)
  const compatible = low.length === model.meshes.length && low.every((mesh, i) => {
    const high = model.meshes[i]
    return sameMatrix(mesh.bindMatrix, high.bindMatrix)
      && mesh.skeleton.bones.length === high.skeleton.bones.length
      && mesh.skeleton.bones.every((bone, j) => bone.name === high.skeleton.bones[j].name
        && sameMatrix(mesh.skeleton.boneInverses[j], high.skeleton.boneInverses[j]))
  })
  if (!compatible) return
  homeGeometryLODs.set(model, { high: model.meshes.map(mesh => mesh.geometry), low: low.map(mesh => mesh.geometry), detailed: true })
}

/** Hysteresis prevents mesh flicker at the boundary. Nearby paws retain IK;
 * farther residents use the existing cheaper gait on the same live rig. */
export const updateHomeAnimalLOD = (model: AnimalModel, distanceSquared: number): boolean => {
  const lod = homeGeometryLODs.get(model)
  if (!lod) return distanceSquared < 14 ** 2
  const detailed = lod.detailed ? distanceSquared < 16 ** 2 : distanceSquared < 12 ** 2
  if (detailed !== lod.detailed) {
    lod.detailed = detailed
    const geometries = detailed ? lod.high : lod.low
    model.meshes.forEach((mesh, i) => { mesh.geometry = geometries[i] })
  }
  return detailed
}

const materialCache = new Map<string, THREE.MeshStandardMaterial>()

export const makeAnimalModel = async (s: Species, coatIndex: number, lod = 0): Promise<AnimalModel | null> => {
  const t = await loadTemplate(s, lod) ?? await loadTemplate(s, 1 - lod)
  if (!t) return null
  const scene = cloneSkinned(t.scene)
  const root = new THREE.Group()
  root.add(scene)
  const updateMatrices = root.updateMatrixWorld
  root.updateMatrixWorld = function (force?: boolean): void { if (this.visible) updateMatrices.call(this, force) }
  root.updateMatrixWorld(true)
  const coat = COATS[s][coatIndex % COATS[s].length]
  const key = `${s}:${coat.name}`
  let material = materialCache.get(key)
  if (!material) {
    material = coatMaterial(coat, s)
    materialCache.set(key, material)
  }
  const bones = new Map<string, THREE.Bone>()
  const meshes: THREE.SkinnedMesh[] = []
  scene.traverse((o) => {
    const b = o as THREE.Bone
    if (b.isBone) bones.set(b.name, b)
    const m = o as THREE.SkinnedMesh
    if (m.isSkinnedMesh) {
      m.material = material!
      m.castShadow = true
      m.receiveShadow = true
      // Conservative bound covers the entire gait and curled/resting poses.
      // It is shared in mesh space and does not require per-frame skinning.
      m.computeBoundingSphere()
      m.boundingSphere!.radius = m.boundingSphere!.radius * 1.7 + 0.2
      m.frustumCulled = true
      meshes.push(m)
    }
  })
  return { root, bones, material, meshes }
}

/** Geometry and coat materials are shared; each clone owns its skeleton's GPU
 * texture. Releasing that texture is essential during indefinite traversal. */
export const disposeAnimalModel = (m: AnimalModel): void => {
  releasedModels.add(m)
  homeGeometryLODs.delete(m)
  disposeFadeable(m.root)
  m.root.removeFromParent()
  const skeletons = new Set(m.meshes.map(mesh => mesh.skeleton))
  for (const skeleton of skeletons) skeleton.dispose()
}
