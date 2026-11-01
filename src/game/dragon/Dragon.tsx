import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { avatarRT, cameraRT, characterRT, companionRT, input, playerRT, takeAction, worldRT, type CharacterId } from "../runtime"
import { isMounted, riderMetrics } from "../horses/riding"
import { solidTopAt } from "../pegasus/flight"
import { homeGroundHidden } from "../celestial/spaceState"
import { HUB_CENTER } from "../../world/hubLayout"
import { waterSurfaceAt } from "../../world/waterSurface"
import { originRT } from "../../world/origin"
import { useGame } from "../../state/gameStore"
import { lightingRT } from "../environment/Lighting"
import { nightBlend, sunDirection } from "../environment/celestialLighting"
import { registerDevTool } from "../../dev/devTools"
import { emit, rand, Shape } from "../vfx/lumenCore"
import { col } from "../vfx/signatures"
import { Ribbon } from "../vfx/ribbons"
import { registerVirtualLight, VirtualPointLight } from "../lightPool"
import { forwardOf, makeDragon, resetTrail, setDragonMode, stepDragon, swimWave, trailAt, upOf, type DragonControls, type DragonState } from "./dragonFlight"
import { dragonSeatRT } from "./dragonRider"
import { dragonRT, useDragonUI } from "./dragonState"
import { discoveryRT } from "../../world/discoveries"
import { useDiscoveries } from "../../state/discoveryStore"
import { names } from "../../personalization"

/**
 * The dragon, the golden dragon.
 *
 * A long Eastern dragon, CC0 model by peaznchips (OpenGameArt "Flying Dragon"),
 * re-rigged for the game: its spine bones are flown along the path its head
 * has taken (dragonFlight.ts), so it swims through the air like a serpent in
 * water. Gold scales that hold a slow wave of inner light, vermilion fins
 * that glow when the sun is behind them, the flaming pearl it chases, a
 * shimmer of gold dust off its flanks, and a breath of light when she asks.
 */

const URL = "/assets/dragon/dragon.glb"
/** model units to metres: about 31 m from the snout to the tip of the tail */
const SCALE = 0.56
/** where she sits, metres back from the head joint */
const SEAT_S = 2.9
const PASSENGER_S = 4.3

/** the spine from the head to the tail, as GLTFLoader names the bones */
const SPINE = ["Head2", "BodyE027", "BodyE026", "BodyE025", "BodyE024", "BodyE023", "BodyE022", "BodyE021",
  ...Array.from({ length: 18 }, (_, i) => `BodyE${String(18 - i).padStart(3, "0")}`), "Tail001"]

type Rig = {
  group: THREE.Group
  bones: THREE.Bone[]
  /** arc length (m) of each spine bone behind the head joint */
  arc: number[]
  /** each bone's rest orientation (model space) */
  rest: THREE.Quaternion[]
  /** spine-relative offset of each bone at rest (model units) */
  offset: THREE.Vector3[]
  jaw: THREE.Bone | null
  jawRest: THREE.Quaternion
  legs: { bone: THREE.Bone; rest: THREE.Quaternion; phase: number; side: number }[]
  meshes: THREE.SkinnedMesh[]
  length: number
  /** the neck's half-width and height of its top above the spine at the seat (m) */
  girth: number
  top: number
  gold: THREE.MeshPhysicalMaterial
  fins: THREE.MeshPhysicalMaterial
  uniforms: { uTime: { value: number }; uGlow: { value: number }; uSurge: { value: number }; uSunView: { value: THREE.Vector3 }; uSunI: { value: number }; uSeatU: { value: number } }
}

const GOLD_HEAD = /* glsl */ `
uniform float uTime;
uniform float uGlow;
uniform float uSurge;
varying vec2 vSpine;
`

/**
 * Scales of old gold. The model's own normal map carries the big plates; on
 * the body a procedural layer of small overlapping scales sits on top (each
 * a shallow dome, rows offset like a carp's), their crevices darker and
 * rougher, and at night or in the rush a slow wave of fire runs head to tail
 * through the seams between them.
 */
const makeGold = (normalMap: THREE.Texture | null, uniforms: Rig["uniforms"], key: string, scales: boolean): THREE.MeshPhysicalMaterial => {
  const m = new THREE.MeshPhysicalMaterial({
    color: "#c99232", metalness: 1, roughness: 0.34, normalMap, normalScale: new THREE.Vector2(1.1, 1.1),
    iridescence: 0.22, iridescenceIOR: 1.45, iridescenceThicknessRange: [220, 520], envMapIntensity: 1.3,
  })
  m.name = `dragon-gold-${key}`
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    if (scales) shader.defines = { ...shader.defines, DRAGON_SCALES: "" }
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nattribute vec2 spine;\nvarying vec2 vSpine;\nvarying vec2 vScaleUv;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvSpine = spine;\nvScaleUv = uv;`)
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        ${GOLD_HEAD}
        varying vec2 vScaleUv;
        float zEdge = 0.0;
        float zDome = 1.0;
        vec2 zGrad = vec2(0.0);
        // overlapping scales, laid like roof tiles: u goes round the body and v
        // along it (v grows toward the head). Every pixel looks at the nine
        // nearest scales and shows the one nearest the head that covers it, so
        // each scale's tail-side margin lies over the next; the rim casts a thin
        // shadow on the scale beneath. Faded out with distance (fwidth) before
        // the pattern could shimmer.
        void dragonScales(vec2 uv) {
          vec2 p = vec2(uv.x * 22.0, uv.y * 150.0);
          float fw = max(length(fwidth(p)), 1e-4);
          float detail = 1.0 - smoothstep(0.2, 0.6, fw);
          const float R = 0.74;
          float best = -1e9;
          vec2 bestC = vec2(0.0);
          float bestD2 = 1.0;
          for (int dj = -1; dj <= 1; dj++) {
            float j = floor(p.y) + float(dj);
            float off = mod(j, 2.0) * 0.5;
            for (int di = -1; di <= 1; di++) {
              float i = floor(p.x - off) + float(di);
              vec2 c = (p - vec2(i + off + 0.5, j)) * vec2(1.0, 0.92);
              float d2 = dot(c, c) / (R * R);
              if (d2 < 1.0 && j > best) { best = j; bestC = c; bestD2 = d2; }
            }
          }
          float dome = sqrt(max(0.0, 1.0 - bestD2));
          // a shallow dome, darker toward its rim where it overlaps the next
          float rim = smoothstep(0.55, 1.0, bestD2);
          zDome = mix(1.0, mix(1.0, 0.25, rim) * (0.85 + 0.15 * dome), detail);
          zGrad = -bestC / (R * R * max(dome, 0.25)) * 0.13 * detail;
        }`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        #ifdef DRAGON_SCALES
          dragonScales(vScaleUv);
          diffuseColor.rgb *= mix(0.48, 1.08, smoothstep(0.0, 0.55, zDome));
        #endif
        // the belly plates are paler gold
        float belly = smoothstep(-0.05, -0.95, vSpine.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.74, 0.4), belly * 0.35);`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        #ifdef DRAGON_SCALES
          roughnessFactor = mix(0.62, roughnessFactor, smoothstep(0.0, 0.4, zDome));
        #endif`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        #ifdef USE_NORMALMAP_TANGENTSPACE
          zEdge = clamp(1.0 - mapN.z * 1.15, 0.0, 1.0);
          #ifdef DRAGON_SCALES
            normal = normalize(tbn * normalize(mapN + vec3(zGrad, 0.0)));
            zEdge = max(zEdge, 1.0 - smoothstep(0.0, 0.35, zDome));
          #endif
        #endif`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        // a slow wave of inner light runs from the head to the tail, brightest
        // in the seams between the scales; the rush sets the whole body alight
        // squares written out: pow() of a negative base is NaN on some GPUs
        float wa = (fract(vSpine.x * 1.4 - uTime * 0.16) - 0.5) * 6.0;
        float wb = (fract(vSpine.x * 3.1 - uTime * 0.41 + 0.37) - 0.5) * 9.0;
        float wave = exp(-wa * wa);
        float wave2 = exp(-wb * wb) * 0.45;
        float seam = zEdge * zEdge;
        vec3 fire = vec3(1.0, 0.55, 0.16);
        totalEmissiveRadiance += fire * (seam * (0.18 + (wave + wave2) * 1.8) + (wave + wave2) * 0.04) * uGlow;
        totalEmissiveRadiance += vec3(1.0, 0.78, 0.42) * seam * uSurge * 2.0;`)
  }
  m.customProgramCacheKey = () => `dragon-gold-v2-${scales ? 1 : 0}-${normalMap ? 1 : 0}`
  return m
}

/** Vermilion fins and mane: silk-thin, glowing orange where the sun shines through. */
const makeFins = (normalMap: THREE.Texture | null, uniforms: Rig["uniforms"]): THREE.MeshPhysicalMaterial => {
  const m = new THREE.MeshPhysicalMaterial({
    color: "#9e140c", metalness: 0.12, roughness: 0.5, normalMap, side: THREE.DoubleSide,
    sheen: 0.35, sheenColor: new THREE.Color("#ff5a1e"), sheenRoughness: 0.45, envMapIntensity: 0.8,
  })
  m.name = "dragon-fins"
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nattribute vec2 spine;\nvarying vec2 vSpine;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvSpine = spine;`)
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${GOLD_HEAD}\nuniform vec3 uSunView;\nuniform float uSunI;\nuniform float uSeatU;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        // a gap in the dorsal crest where she sits
        if (abs(vSpine.x - uSeatU) < 0.032) discard;
        float tip = smoothstep(0.15, 1.1, vSpine.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.32, 0.06), tip * 0.75);`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        // light through a thin fin when the sun is behind it
        float through = pow(max(dot(-normalize(vViewPosition), uSunView), 0.0), 3.0);
        totalEmissiveRadiance += vec3(1.0, 0.42, 0.12) * through * uSunI * 0.55;
        float wa = (fract(vSpine.x * 1.4 - uTime * 0.16) - 0.5) * 6.0;
        float wave = exp(-wa * wa);
        totalEmissiveRadiance += vec3(1.0, 0.5, 0.18) * (wave * 0.35 + uSurge * 0.6) * uGlow;`)
  }
  m.customProgramCacheKey = () => "dragon-fins-v1"
  return m
}

/**
 * The five meshes share one armature, but the loader gives each its own
 * Skeleton (and the quantised file folds a per-mesh dequantisation into its
 * inverse bind matrices). Five bone textures uploaded every frame cost more
 * than the rest of the dragon together on some drivers, so every mesh is
 * re-bound to the first one's skeleton with that difference folded into its
 * own bind matrix: B·IBM₀·(IBM₀⁻¹·IBMₘ·bind) = B·IBMₘ·bind, the same vertices.
 */
const shareSkeleton = (meshes: THREE.SkinnedMesh[]): void => {
  const base = meshes[0]?.skeleton
  if (!base) return
  const inv0 = new THREE.Matrix4()
  const q = new THREE.Matrix4()
  const qi = new THREE.Matrix4()
  for (const mesh of meshes.slice(1)) {
    const sk = mesh.skeleton
    if (sk.bones.length !== base.bones.length || sk.bones.some((b, i) => b !== base.bones[i])) continue
    q.copy(inv0.copy(base.boneInverses[0]).invert()).multiply(sk.boneInverses[0])
    let consistent = true
    for (let i = 1; i < sk.bones.length && consistent; i++) {
      qi.copy(inv0.copy(base.boneInverses[i]).invert()).multiply(sk.boneInverses[i])
      for (let k = 0; k < 16; k++) if (Math.abs(qi.elements[k] - q.elements[k]) > 1e-4 * Math.max(1, Math.abs(q.elements[k]))) { consistent = false; break }
    }
    if (!consistent) continue
    mesh.bind(base, q.clone().multiply(mesh.bindMatrix))
    sk.dispose()
  }
}

const loadRig = async (): Promise<Rig> => {
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(URL)
  const scene = gltf.scene
  scene.updateMatrixWorld(true)
  const uniforms: Rig["uniforms"] = {
    uTime: { value: 0 }, uGlow: { value: 0.5 }, uSurge: { value: 0 }, uSunView: { value: new THREE.Vector3(0, 1, 0) }, uSunI: { value: 1 }, uSeatU: { value: 0 },
  }
  const meshes: THREE.SkinnedMesh[] = []
  scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh) })
  const normalOf = (name: string): THREE.Texture | null => {
    const mesh = meshes.find((m) => m.name.startsWith(name))
    return ((mesh?.material as THREE.MeshStandardMaterial | undefined)?.normalMap) ?? null
  }
  const gold = makeGold(normalOf("DragonBody"), uniforms, "body", true)
  const limbs = makeGold(normalOf("DragonBody"), uniforms, "legs", false)
  const tailFin = makeGold(normalOf("DragonBody"), uniforms, "tail", false)
  const head = makeGold(normalOf("DragonHead"), uniforms, "head", false)
  const fins = makeFins(normalOf("DragonFins"), uniforms)
  for (const mesh of meshes) {
    const old = mesh.material as THREE.Material
    mesh.material = mesh.name.startsWith("DragonHead") ? head : mesh.name.startsWith("DragonFins") ? fins : mesh.name.startsWith("DragonTailFin") ? tailFin : mesh.name.startsWith("DragonLegs") ? limbs : gold
    old.dispose()
    const uv1 = mesh.geometry.getAttribute("uv1")
    if (uv1) mesh.geometry.setAttribute("spine", uv1)
    else mesh.geometry.setAttribute("spine", new THREE.BufferAttribute(new Float32Array(mesh.geometry.getAttribute("position").count * 2), 2))
    mesh.frustumCulled = false
    mesh.castShadow = true
    mesh.receiveShadow = true
  }
  shareSkeleton(meshes)
  const bones = SPINE.map((n) => scene.getObjectByName(n) as THREE.Bone | undefined)
  if (bones.some((b) => !b)) throw new Error(`${names.dragon}'s spine is missing bones: ${SPINE.filter((_, i) => !bones[i]).join(", ")}`)
  const spine = bones as THREE.Bone[]
  const restPos = spine.map((b) => b.getWorldPosition(new THREE.Vector3()))
  const rest = spine.map((b) => b.getWorldQuaternion(new THREE.Quaternion()))
  const headX = restPos[0].x
  const arc = restPos.map((p) => (headX - p.x) * SCALE)
  const offset = restPos.map((p) => new THREE.Vector3(0, p.y - restPos[0].y, p.z - restPos[0].z))
  // the neck's girth and the height of its back where she sits (from the rest mesh)
  const body = meshes.find((m) => m.name.startsWith("DragonBody"))
  let girth = 0.45, top = 0.5
  if (body) {
    body.skeleton.update()
    const pos = body.geometry.getAttribute("position")
    const v = new THREE.Vector3()
    const seatX = headX - SEAT_S / SCALE
    let maxY = -Infinity, maxZ = 0
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      body.applyBoneTransform(i, v)
      v.applyMatrix4(body.matrixWorld)
      if (Math.abs(v.x - seatX) > 0.6) continue
      maxY = Math.max(maxY, v.y - restPos[0].y)
      maxZ = Math.max(maxZ, Math.abs(v.z - restPos[0].z))
    }
    if (Number.isFinite(maxY)) { top = maxY * SCALE; girth = maxZ * SCALE * 0.82 }
  }
  const group = new THREE.Group()
  group.name = "dragon"
  group.add(scene)
  group.updateMatrixWorld(true)
  // the spine bones are posed directly in the world, each from the path
  for (const b of spine) group.attach(b)
  const jaw = scene.getObjectByName("JawBottom") as THREE.Bone | null
  const legs: Rig["legs"] = []
  for (const [name, phase, side] of [["LegFrontL", 0, 1], ["LegFrontR", Math.PI, -1], ["LegBackL", Math.PI * 0.5, 1], ["LegBackR", Math.PI * 1.5, -1]] as const) {
    const bone = scene.getObjectByName(name) as THREE.Bone | null
    if (bone) legs.push({ bone, rest: bone.quaternion.clone(), phase, side })
  }
  const tailX = restPos[restPos.length - 1].x
  uniforms.uSeatU.value = SEAT_S / ((headX - (tailX - 2.8)) * SCALE)
  return {
    group, bones: spine, arc, rest, offset, jaw, jawRest: jaw ? jaw.quaternion.clone() : new THREE.Quaternion(), legs, meshes,
    length: arc[arc.length - 1] + 1.6, girth, top, gold, fins, uniforms,
  }
}

// ---- the pearl ----------------------------------------------------------------

const PEARL_VERTEX = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`
const PEARL_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uGlow;
varying vec3 vN;
varying vec3 vV;
void main() {
  float ndv = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  float rim = pow(1.0 - ndv, 2.5);
  // nacre: a thin-film shimmer that turns as the pearl does
  vec3 film = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + rim * 1.6 + uTime * 0.05));
  vec3 core = vec3(1.0, 0.93, 0.78) * (0.85 + 0.6 * pow(ndv, 3.0));
  vec3 c = mix(core, film, 0.35 * rim) + vec3(1.0, 0.7, 0.35) * rim * 1.4;
  gl_FragColor = vec4(c * uGlow, 1.0);
}`

const _p = new THREE.Vector3()
const _q = new THREE.Vector3()
const _t = new THREE.Vector3()
const _u = new THREE.Vector3()
const _l = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _rot = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _e = new THREE.Euler()
const _wave = { side: 0, lift: 0 }
const _cam = new THREE.Vector3()
const _look = new THREE.Vector3()
const _sun = new THREE.Vector3()

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
const damp = (a: number, b: number, k: number, dt: number): number => a + (b - a) * (1 - Math.exp(-k * dt))
const smooth01 = (x: number): number => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t) }

const top = (x: number, z: number): number => solidTopAt(x, z, 3)

/** a body free to be carried off: on foot, not busy, not in the saddle */
const freeOnFoot = (id: CharacterId): boolean => {
  const b = id === "explorer" ? playerRT : companionRT
  return b.rideY === null && b.gesture === "none" && !b.paused && !isMounted(id)
}

const MET_KEY = "gift-world/dragon-met"

/**
 * E climbs onto the dragon only when she is the thing being asked for: she was
 * called and is circling close by, she is in front of the explorer or of the view,
 * and nothing nearer wants E (a horse, an animal, a memory, a find). Without
 * this a circling dragon swallowed every E pressed near her and lifted the explorer
 * onto her neck when she meant to pet a cat or mount a horse.
 */
const BOARD_RANGE = 20
const facingDragon = (body: { pos: THREE.Vector3; facing: number }, dx: number, dz: number): boolean => {
  const d = Math.hypot(dx - body.pos.x, dz - body.pos.z)
  if (d < 4) return true
  const ux = (dx - body.pos.x) / d, uz = (dz - body.pos.z) / d
  // the view looks back past her from where the camera hangs (camera yaw), the body along its facing
  const view = -(Math.sin(cameraRT.yaw) * ux + Math.cos(cameraRT.yaw) * uz)
  const ahead = Math.sin(body.facing) * ux + Math.cos(body.facing) * uz
  return Math.max(view, ahead) > Math.cos(0.7)
}
const somethingElseWantsE = (): boolean =>
  !!worldRT.nearMemoryId || !!worldRT.nearSecretId || !!discoveryRT.horsePrompt || !!discoveryRT.animalPrompt || !!useDiscoveries.getState().prompt

export const Dragon = (): React.ReactElement | null => {
  const [rig, setRig] = useState<Rig | null>(null)
  const pearl = useRef<THREE.Mesh>(null)
  const state = useMemo<DragonState>(() => {
    const d = makeDragon(HUB_CENTER.x + 220, 0, HUB_CENTER.z - 160, -2.2)
    d.y = top(d.x, d.z) + 110
    resetTrail(d)
    return d
  }, [])
  // silk of light from her whiskers and the tip of her tail
  const ribbons = useMemo(() => ({
    whiskerL: new Ribbon("#ffe7a8", "#ff9a3c", 0.1, 0.3),
    whiskerR: new Ribbon("#ffe7a8", "#ff9a3c", 0.1, 0.3),
    tail: new Ribbon("#ff6a2a", "#ffd27a", 0.42, 0.45),
  }), [])
  useEffect(() => () => { for (const r of Object.values(ribbons)) r.dispose() }, [ribbons])
  const headRot = useMemo(() => new THREE.Quaternion(), [])
  // the pearl lights the ground under it at dusk and at night
  const pearlLight = useMemo(() => {
    const l = new VirtualPointLight()
    l.color.set("#ffc978")
    l.distance = 26
    l.decay = 1.6
    l.intensity = 0
    return l
  }, [])
  useEffect(() => registerVirtualLight(pearlLight), [pearlLight])
  const pearlMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: PEARL_VERTEX, fragmentShader: PEARL_FRAGMENT, uniforms: { uTime: { value: 0 }, uGlow: { value: 2.2 } }, toneMapped: false,
  }), [])
  const ctl = useRef({
    rider: null as CharacterId | null,
    passenger: null as CharacterId | null,
    from: { explorer: new THREE.Vector3(), companion: new THREE.Vector3() } as Record<CharacterId, THREE.Vector3>,
    land: new THREE.Vector3(),
    stepDown: -1,
    breath: 0,
    breathCool: 0,
    surgeWas: false,
    playTime: 0,
    met: (() => { try { return localStorage.getItem(MET_KEY) === "1" } catch { return false } })(),
    hinted: false,
    orbitYaw: 0,
    orbitPitch: 0,
    lastYaw: 0,
    lastPitch: 0,
    lookT: 9,
    cam: new THREE.Vector3(),
    camInit: false,
    lazyBreath: 12,
    dust: 0,
    homeX: HUB_CENTER.x,
    homeZ: HUB_CENTER.z,
  })

  useEffect(() => {
    let alive = true
    loadRig().then((r) => { if (alive) setRig(r) }).catch((error) => console.error(`${names.dragon} could not be loaded`, error))
    return () => { alive = false }
  }, [])
  useEffect(() => () => pearlMat.dispose(), [pearlMat])

  useEffect(() => {
    registerDevTool("dragon", (mode?: string) => {
      const b = avatarRT()
      if (mode === "near") {
        // a QA view: the dragon circling just beside the active character
        state.x = b.pos.x + 18; state.z = b.pos.z; state.y = b.pos.y + 4; state.heading = 0
        resetTrail(state)
        setDragonMode(state, "circle")
      } else if (mode === "ride") {
        state.x = b.pos.x + 10; state.z = b.pos.z; state.y = b.pos.y + 3; resetTrail(state)
        setDragonMode(state, "circle")
        dragonRT.wantBoard = true
      } else if (mode === "soar" || mode === "come" || mode === "circle") setDragonMode(state, mode)
      return { mode: state.mode, x: state.x, y: state.y, z: state.z, speed: state.speed, rider: ctl.current.rider, loaded: !!rig }
    })
  }, [state, rig])

  useFrame((frame, rawDt) => {
    const dt = Math.min(Math.max(rawDt, 0), 0.1)
    const c = ctl.current
    const d = state
    const game = useGame.getState()
    const earth = !homeGroundHidden()
    const playing = game.started && !worldRT.introActive && !worldRT.finaleActive && earth
    const me = characterRT.active
    const body = avatarRT()
    dragonRT.loaded = !!rig

    // ---- calls and the first meeting -------------------------------------------------
    const called = takeAction("callDragon")
    if (playing && !c.rider) {
      c.playTime += dt
      const firstMeet = !c.met && c.playTime > 150 && d.mode === "soar" && freeOnFoot(me) && worldRT.nearMemoryId === null
      if ((called || firstMeet) && rig) {
        if (!freeOnFoot(me) && isMounted(me)) game.showHint(`${names.dragon} will come once you are on your own feet.`)
        else if (d.mode === "soar" || d.mode === "alight") {
          // from far away she would take minutes: she appears high in the sky ahead
          // of the view instead, already on her way down to her
          if (Math.hypot(d.x - body.pos.x, d.z - body.pos.z) > 650) {
            const yaw = cameraRT.yaw
            const ax = body.pos.x + Math.sin(yaw) * 420, az = body.pos.z + Math.cos(yaw) * 420
            d.x = ax; d.z = az; d.y = Math.max(top(ax, az) + 90, body.pos.y + 130)
            d.heading = Math.atan2(body.pos.x - ax, body.pos.z - az)
            d.pitch = -0.25
            resetTrail(d)
          }
          setDragonMode(d, "come")
          game.showHint(firstMeet ? "Something golden is coming down out of the sky…" : `${names.dragon} heard you. She is coming.`)
          if (!c.met) {
            c.met = true
            try { localStorage.setItem(MET_KEY, "1") } catch { /* the meeting still happens */ }
          }
        }
      }
    } else if (called && !earth) game.showHint(`${names.dragon} keeps to the skies of home.`)

    // ---- her flight ------------------------------------------------------------------
    let controls: DragonControls | null = null
    if (d.mode === "ride" && c.rider) {
      controls = {
        turn: clamp(input.move.x, -1, 1),
        throttle: clamp(-input.move.y, -1, 1),
        climb: (input.ascend ? 1 : 0) - (input.descend ? 1 : 0),
        surge: input.sprint,
      }
      // on her neck the keys are hers: no jumping, no calling the cat, no shared moments
      input.call = false
      input.jump = false
      if (takeAction("five")) { c.breath = 1.9; c.breathCool = 2.6 }
      takeAction("hug"); takeAction("hold"); takeAction("dance"); takeAction("race"); takeAction("callHorse"); takeAction("callPegasus"); takeAction("callStarborn")
    }
    const herPos = c.rider ? c.land : body.pos
    const goalPos = d.mode === "alight" ? c.land : herPos
    const herY = d.mode === "alight" ? c.land.y : body.pos.y
    // she soars over home, or over wherever the explorer has wandered far from it
    const awayFromHome = Math.hypot(body.pos.x - HUB_CENTER.x, body.pos.z - HUB_CENTER.z) > 900
    c.homeX = damp(c.homeX, awayFromHome ? body.pos.x : HUB_CENTER.x, 0.05, dt)
    c.homeZ = damp(c.homeZ, awayFromHome ? body.pos.z : HUB_CENTER.z, 0.05, dt)
    stepDragon(d, { top, random: Math.random }, { dt, her: { x: goalPos.x, y: herY, z: goalPos.z }, controls, homeX: c.homeX, homeZ: c.homeZ })

    // the circle gives up after a while, or follows her if she walks far
    if (d.mode === "circle" && !c.rider) {
      const far = Math.hypot(body.pos.x - d.x, body.pos.z - d.z)
      if (far > 130) setDragonMode(d, "come")
      else if (d.modeT > 80 || !playing) { setDragonMode(d, "soar"); d.goalX = d.x; d.goalZ = d.z }
    }

    // ---- boarding, riding, stepping down ---------------------------------------------
    const near = Math.hypot(body.pos.x - d.x, body.pos.z - d.z)
    let prompt: string | null = null
    const boardable = d.mode === "circle" && !c.rider && playing && freeOnFoot(me) && near < BOARD_RANGE && facingDragon(body, d.x, d.z) && !somethingElseWantsE()
    if (d.mode === "circle" && !c.rider && playing && near < 34 && !c.hinted) { c.hinted = true; game.showHint(`${names.dragon} has come to you. Face her and press E to ride.`) }
    if ((boardable || (dragonRT.wantBoard && d.mode === "circle" && !c.rider)) && freeOnFoot(me)) {
      prompt = `E — climb onto ${names.dragon}, the golden dragon`
      if (input.interact || dragonRT.wantBoard) {
        input.interact = false
        dragonRT.wantBoard = false
        c.rider = me
        const mate: CharacterId = me === "explorer" ? "companion" : "explorer"
        const mateBody = mate === "explorer" ? playerRT : companionRT
        c.passenger = characterRT.companionPresent && freeOnFoot(mate) && Math.hypot(mateBody.pos.x - body.pos.x, mateBody.pos.z - body.pos.z) < 22 ? mate : null
        c.from[me].copy(body.pos)
        if (c.passenger) c.from[c.passenger].copy(mateBody.pos)
        c.land.copy(body.pos)
        setDragonMode(d, "board")
      }
    }
    if (d.mode === "board" && d.modeT > 1.7) {
      setDragonMode(d, "ride")
      game.showHint("W faster · A D turn · Space climb · C dive · Shift the golden rush · F breathe light · E step down")
    }
    if (d.mode === "ride" && c.rider) {
      prompt = null
      if (input.interact) {
        input.interact = false
        // somewhere to step down: ahead, on land
        forwardOf(d.heading, 0, _p)
        let found = false
        for (const ahead of [26, 40, 60, 14, 80]) {
          const x = d.x + _p.x * ahead, z = d.z + _p.z * ahead
          const w = waterSurfaceAt(x, z)
          const g = top(x, z)
          if (w === null || g > w + 0.05) { c.land.set(x, g, z); found = true; break }
        }
        if (found) { setDragonMode(d, "alight"); c.stepDown = -1 }
        else game.showHint("Fly over land to step down.")
      }
    }
    if (d.mode === "alight" && c.rider) {
      // near the ground by the landing spot: she is let down
      trailAt(d, SEAT_S, _p)
      const low = _p.y - top(_p.x, _p.z) < 5.5
      if (c.stepDown < 0 && ((low && Math.hypot(_p.x - c.land.x, _p.z - c.land.z) < 24) || d.modeT > 14)) {
        c.stepDown = 0
        c.land.set(_p.x, top(_p.x, _p.z), _p.z)
      }
    }

    // ---- pose the spine --------------------------------------------------------------
    if (rig) {
      const visible = earth && !worldRT.introActive && Math.hypot(d.x - body.pos.x, d.z - body.pos.z) < 1800
      rig.group.visible = visible
      const u = rig.uniforms
      u.uTime.value += dt
      const night = nightBlend(worldRT.timeOfDay)
      u.uGlow.value = 0.55 + night * 1.25 + d.surge * 0.8 + c.breath * 0.4
      u.uSurge.value = d.surge
      sunDirection(worldRT.timeOfDay, _sun).normalize().transformDirection(frame.camera.matrixWorldInverse)
      u.uSunView.value.copy(_sun)
      u.uSunI.value = lightingRT.sunI
      if (visible) {
        for (let i = 0; i < rig.bones.length; i++) {
          const s = rig.arc[i]
          trailAt(d, s, _p, _u)
          trailAt(d, s + 0.6, _q)
          trailAt(d, Math.max(0, s - 0.6), _t)
          _t.sub(_q)
          if (_t.lengthSq() < 1e-8) forwardOf(d.heading, d.pitch, _t)
          _t.normalize()
          _u.addScaledVector(_t, -_u.dot(_t)).normalize()
          _l.crossVectors(_u, _t)
          // the swim wave, sideways and up, on top of the path
          swimWave(d, s, rig.length, _wave)
          _p.addScaledVector(_l, _wave.side).addScaledVector(_u, _wave.lift)
          // rest frame (+x to the head, +y up, +z) onto (forward, up, forward × up)
          _m.makeBasis(_t, _u, _q.crossVectors(_t, _u))
          _rot.setFromRotationMatrix(_m)
          const bone = rig.bones[i]
          if (i === 0) headRot.copy(_rot)
          bone.quaternion.copy(_rot).multiply(rig.rest[i])
          bone.position.copy(rig.offset[i]).multiplyScalar(SCALE).applyQuaternion(_rot).add(_p)
          bone.scale.setScalar(SCALE)
        }
        // the head looks about: at her while it waits, ahead when ridden
        const headBone = rig.bones[0]
        if (d.mode === "circle" || d.mode === "board") {
          _p.set(body.pos.x - d.x, body.pos.y + 1.2 - d.y, body.pos.z - d.z).normalize()
          forwardOf(d.heading, d.pitch, _q)
          const yaw = clamp(Math.atan2(_q.x * _p.z - _q.z * _p.x, _q.x * _p.x + _q.z * _p.z) * -1, -0.6, 0.6)
          _q2.setFromAxisAngle(_u.set(0, 1, 0), yaw * 0.6)
          headBone.quaternion.premultiply(_q2)
        }
        // the jaw opens to breathe, and a little in the rush
        if (rig.jaw) {
          const open = Math.max(c.breath > 0 ? 0.5 : 0, d.surge * 0.15) + Math.sin(u.uTime.value * 0.7) * 0.02
          rig.jaw.quaternion.copy(rig.jawRest).multiply(_q2.setFromEuler(_e.set(0, 0, -open)))
        }
        // claws paddle slowly through the air (folded back in the rush)
        for (const leg of rig.legs) {
          const sw = Math.sin(d.clock * (1.3 + d.speed * 0.02) + leg.phase)
          const fold = d.surge * 0.6 + (1 - d.low) * 0.2
          leg.bone.quaternion.copy(leg.rest).multiply(_q2.setFromEuler(_e.set(sw * 0.12 * leg.side, sw * 0.25 * (1 - d.surge), -0.35 * fold + sw * 0.18)))
        }
      }

      // ---- silk from her whiskers and her tail ----------------------------------------
      for (const r of Object.values(ribbons)) r.mesh.visible = visible
      if (visible) {
        const tt = u.uTime.value
        for (const [ribbon, side] of [[ribbons.whiskerL, 1], [ribbons.whiskerR, -1]] as const) {
          // the whisker roots on her upper lip, in the head's own frame (model units)
          _p.set(3.3, -0.15, side * 0.62).multiplyScalar(SCALE).applyQuaternion(headRot).add(rig.bones[0].position)
          ribbon.update(_p, tt)
          ribbon.material.uniforms.uIntensity.value = 0.9 + night * 1.2 + d.surge
        }
        trailAt(d, rig.length - 0.3, _p)
        ribbons.tail.update(_p, tt)
        ribbons.tail.material.uniforms.uIntensity.value = 0.7 + night * 1.1 + d.surge * 1.2
      }

      // ---- the pearl it chases --------------------------------------------------------
      const pm = pearl.current
      if (pm) {
        pm.visible = visible
        forwardOf(d.heading, d.pitch, _t)
        upOf(d.heading, d.pitch, d.bank, _u)
        const lead = c.rider ? 7 + d.speed * 0.12 : 4.2
        const tt = u.uTime.value
        _l.crossVectors(_u, _t)
        pm.position.set(d.x, d.y, d.z).addScaledVector(_t, lead).addScaledVector(_u, 0.6 + Math.sin(tt * 1.3) * 0.5).addScaledVector(_l, Math.sin(tt * 0.9) * 0.8)
        pm.scale.setScalar(0.34)
        pearlMat.uniforms.uTime.value = tt
        // an unparented light: the pool reads its render-space position and adds the origin back
        pearlLight.position.set(pm.position.x - originRT.x, pm.position.y, pm.position.z - originRT.z)
        pearlLight.updateMatrixWorld()
        pearlLight.intensity = visible ? night * 9 + (c.breath > 0 ? 6 : 0) : 0
        pearlMat.uniforms.uGlow.value = 1.6 + night * 1.6
        // its halo: soft light that never flickers (short glows, always overlapping)
        if (visible) emit({ x: pm.position.x, y: pm.position.y, z: pm.position.z, life: 0.35, color: col("#ffcf8a"), intensity: 0.35 + night * 0.4, size: 1.5, shape: Shape.Glow })
        if (visible && Math.random() < 0.6 + night * 0.4) {
          // the pearl's flame: wisps of light that lick back from it
          emit({ x: pm.position.x + rand(-0.15, 0.15), y: pm.position.y + rand(-0.15, 0.15), z: pm.position.z + rand(-0.15, 0.15),
            vx: -_t.x * d.speed * 0.3 + rand(-0.3, 0.3), vy: rand(0.4, 1.1), vz: -_t.z * d.speed * 0.3 + rand(-0.3, 0.3),
            life: rand(0.5, 0.9), color: col("#ffd28a"), intensity: rand(1.6, 2.6), size: rand(0.1, 0.2), drag: 2.4, gravity: -0.6, shape: Shape.Ember, curl: 0.4, spin: rand(0, 6) })
        }
      }

      // ---- gold dust, the rush, the breath ---------------------------------------------
      if (visible) {
        c.dust += dt * (18 + d.speed * 0.9 + night * 30)
        while (c.dust > 1) {
          c.dust -= 1
          const s = rand(1.5, rig.length - 2)
          trailAt(d, s, _p, _u)
          const a = rand(0, Math.PI * 2)
          _l.set(Math.cos(a), Math.sin(a), Math.cos(a * 1.7)).multiplyScalar(rig.girth * 1.1)
          const glint = Math.random() < 0.12
          emit({ x: _p.x + _l.x, y: _p.y + _l.y + rig.top * 0.3, z: _p.z + _l.z, vx: rand(-0.3, 0.3), vy: rand(-0.2, 0.5), vz: rand(-0.3, 0.3),
            life: glint ? rand(0.4, 0.8) : rand(1.4, 2.6), color: col(glint ? "#fff1c8" : "#ffc457"), intensity: glint ? 3 : rand(1, 1.8),
            size: glint ? rand(0.18, 0.3) : rand(0.035, 0.07), drag: 1.4, gravity: 0.05, shape: glint ? Shape.Glint : Shape.Glow, curl: 0.2, spin: rand(-2, 2) })
        }
        // low over water: spray thrown off by her belly and the wind of her passing
        const water = waterSurfaceAt(d.x, d.z)
        if (water !== null && d.y - water < 4.5 && d.speed > 10) {
          const k = (1 - (d.y - water) / 4.5) * Math.min(1, d.speed / 30)
          forwardOf(d.heading, 0, _t)
          for (let n = 0; n < 6 * k + 1; n++) {
            const side = Math.random() < 0.5 ? -1 : 1
            const s = rand(0.5, 8)
            trailAt(d, s, _p)
            _l.set(_t.z * side, 0, -_t.x * side)
            const v = rand(2, 5) + d.speed * 0.15
            emit({ x: _p.x, y: water + 0.1, z: _p.z, vx: _l.x * v - _t.x * 2, vy: rand(2.5, 5) * k + 1, vz: _l.z * v - _t.z * 2,
              life: rand(0.5, 0.9), color: col("#e8f6ff"), intensity: 1.2, size: 0.025, drag: 0.8, gravity: 9.8, shape: Shape.Streak, stretch: 0.04 })
          }
          if (Math.random() < 0.3 * k) emit({ x: d.x, y: water + 0.05, z: d.z, life: 1.4, color: col("#dff2ff"), intensity: 0.45, size: 2.5, shape: Shape.Ring, axis: new THREE.Vector3(0, 1, 0), grow: 2 })
        }
        const surging = d.surge > 0.55
        if (surging && !c.surgeWas) {
          // the rush begins: a ring of vapour thrown off round her neck
          forwardOf(d.heading, d.pitch, _t)
          emit({ x: d.x, y: d.y, z: d.z, life: 0.7, color: col("#fff3d8"), intensity: 1.6, size: 4.5, shape: Shape.Ring, axis: _t.clone(), grow: 2.2 })
          emit({ x: d.x, y: d.y, z: d.z, life: 0.5, color: col("#ffd98a"), intensity: 1.2, size: 2.5, shape: Shape.Ring, axis: _t.clone(), grow: 2.6, delay: 0.12 })
        }
        c.surgeWas = surging
        if (d.surge > 0.3) {
          // streams of air torn off the fins
          for (let k = 0; k < 3; k++) {
            const s = rand(0.5, rig.length * 0.8)
            trailAt(d, s, _p, _u)
            forwardOf(d.heading, d.pitch, _t)
            emit({ x: _p.x + _u.x * rig.top + rand(-0.6, 0.6), y: _p.y + _u.y * rig.top + rand(-0.3, 0.6), z: _p.z + _u.z * rig.top + rand(-0.6, 0.6),
              vx: _t.x * d.speed * 0.85, vy: _t.y * d.speed * 0.85, vz: _t.z * d.speed * 0.85,
              life: rand(0.25, 0.45), color: col("#eaf4ff"), intensity: 0.9 * d.surge, size: 0.03, drag: 4, shape: Shape.Streak, stretch: 0.06 })
          }
        }
        // the breath: when she asks (F), and now and then on its own while it waits for her
        if (!c.rider && d.mode === "circle") {
          c.lazyBreath -= dt
          if (c.lazyBreath < 0) { c.lazyBreath = rand(14, 26); c.breath = 1.1 }
        }
        if (c.breath > 0) {
          c.breath = Math.max(0, c.breath - dt)
          forwardOf(d.heading, d.pitch - (c.rider ? 0.08 : -0.35), _t)
          _p.set(d.x, d.y, d.z).addScaledVector(_t, 1.9)
          // a jet of light that reaches out ahead of her and then blooms: a white-gold
          // core of streaks, embers cooling from white to red, and a soft glow
          const n = c.rider ? 16 : 9
          const reach = d.speed + rand(26, 38)
          for (let k = 0; k < n; k++) {
            const kind = Math.random()
            const spread = kind < 0.35 ? 0.05 : 0.14
            const vx = _t.x + rand(-spread, spread), vy = _t.y + rand(-spread, spread), vz = _t.z + rand(-spread, spread)
            const speed = reach * rand(0.85, 1.05)
            if (kind < 0.35) {
              emit({ x: _p.x, y: _p.y - 0.15, z: _p.z, vx: vx * speed, vy: vy * speed, vz: vz * speed, life: rand(0.35, 0.6),
                color: col(kind < 0.15 ? "#ffffff" : "#ffe9b0"), intensity: rand(2.5, 4), size: rand(0.06, 0.1), drag: 0.7, shape: Shape.Streak, stretch: 0.05 })
            } else {
              emit({ x: _p.x, y: _p.y - 0.2, z: _p.z, vx: vx * speed, vy: vy * speed, vz: vz * speed,
                life: rand(0.8, 1.4), color: col(kind < 0.8 ? "#ffd27a" : "#ff8a2a"), intensity: rand(1.8, 3),
                size: rand(0.3, 0.7), drag: 0.9, gravity: -1.2, shape: kind < 0.85 ? Shape.Ember : Shape.Glow, curl: 0.8, spin: rand(0, 6) })
            }
          }
          if (Math.random() < 0.35) emit({ x: _p.x, y: _p.y, z: _p.z, vx: _t.x * 20, vy: _t.y * 20, vz: _t.z * 20, life: 0.6, color: col("#fff3d0"), intensity: 3, size: rand(0.3, 0.5), drag: 2, shape: Shape.Glint, spin: rand(-3, 3) })
        }
        c.breathCool = Math.max(0, c.breathCool - dt)
      }
    }

    // ---- the riders' seats -------------------------------------------------------------
    const riders: [CharacterId | null, number][] = [[c.rider, SEAT_S], [c.passenger, PASSENGER_S]]
    for (const id of ["explorer", "companion"] as const) {
      const seat = dragonSeatRT[id]
      const entry = riders.find(([who]) => who === id)
      if (!entry || !rig) { seat.w = 0; continue }
      const b = id === "explorer" ? playerRT : companionRT
      const sS = entry[1]
      trailAt(d, sS, _p, _u)
      trailAt(d, sS + 0.5, _q)
      trailAt(d, Math.max(0, sS - 0.5), _t)
      _t.sub(_q).normalize()
      _u.addScaledVector(_t, -_u.dot(_t)).normalize()
      swimWave(d, sS, rig.length, _wave)
      _l.crossVectors(_u, _t)
      _p.addScaledVector(_l, _wave.side).addScaledVector(_u, _wave.lift)
      seat.forward.copy(_t)
      seat.up.copy(_u)
      seat.left.copy(_l)
      seat.girth = rig.girth
      seat.pelvis.copy(_p).addScaledVector(_u, rig.top + 0.05)
      // lifted aboard on a ribbon of light, let down the same way
      let k = 1
      if (d.mode === "board") k = smooth01(d.modeT / 1.6)
      if (c.stepDown >= 0) k = 1 - smooth01(c.stepDown / 1.4)
      const hips = riderMetrics[id].hips
      const from = c.stepDown >= 0 ? c.land : c.from[id]
      const arc = Math.sin(k * Math.PI) * 1.6
      b.pos.set(
        THREE.MathUtils.lerp(from.x, seat.pelvis.x, k),
        THREE.MathUtils.lerp(from.y, seat.pelvis.y - hips, k) + arc,
        THREE.MathUtils.lerp(from.z, seat.pelvis.z, k),
      )
      b.rideY = b.pos.y
      b.gesture = "ride"
      b.vel.set(0, 0, 0)
      b.speed = 0
      b.moving = false
      b.facing = Math.atan2(_t.x, _t.z)
      b.ridePitch = Math.asin(clamp(_t.y, -1, 1)) * k
      b.rideRoll = Math.atan2(_l.y, _u.y) * k
      seat.w = k
      seat.lean = 0.12 + d.surge * 0.35
      seat.bank = clamp(-d.bank * 0.4, -0.4, 0.4)
      seat.thrill = Math.max(d.surge, c.breath > 0 ? 0.6 : 0)
      seat.grip = 0.45 + d.surge * 0.5
      if ((d.mode === "board" || c.stepDown >= 0) && Math.random() < 0.8) {
        // the ribbon of light round her as she is carried
        const a = frame.clock.elapsedTime * 7 + (id === "companion" ? Math.PI : 0)
        emit({ x: b.pos.x + Math.cos(a) * 0.6, y: b.pos.y + 0.3 + Math.random() * 1.2, z: b.pos.z + Math.sin(a) * 0.6, vx: -Math.sin(a) * 1.5, vy: 0.6, vz: Math.cos(a) * 1.5,
          life: 0.8, color: col("#ffd98a"), intensity: 2.2, size: 0.05, drag: 1.5, shape: Shape.Glow, curl: 0.1 })
      }
    }
    if (c.stepDown >= 0) {
      c.stepDown += dt
      if (c.stepDown > 1.4) {
        for (const id of [c.rider, c.passenger]) {
          if (!id) continue
          const b = id === "explorer" ? playerRT : companionRT
          b.pos.set(c.land.x + (id === c.passenger ? 1.2 : 0), c.land.y, c.land.z)
          b.rideY = null
          b.gesture = "none"
          b.ridePitch = b.rideRoll = 0
          dragonSeatRT[id].w = 0
        }
        // the camera settles behind her again
        cameraRT.targetYaw = cameraRT.yaw = body.facing
        c.rider = c.passenger = null
        c.stepDown = -1
        c.camInit = false
        // she climbs away to her own skies: E is free again until she is called (1)
        setDragonMode(d, "soar")
        d.goalX = d.x + Math.sin(d.heading) * 220
        d.goalZ = d.z + Math.cos(d.heading) * 220
        d.goalY = Math.max(d.y, top(d.goalX, d.goalZ)) + 90
        c.hinted = false
        game.showHint(`${names.dragon} flies off. Press 1 to call her back.`)
      }
    }

    // ---- the chase camera ----------------------------------------------------------------
    const cam = dragonRT.camera
    const carrying = !!c.rider && (d.mode === "ride" || d.mode === "alight" || d.mode === "board") && c.stepDown < 0
    cam.active = carrying && !cameraRT.photo
    if (cam.active) {
      // a drag orbits the view about her for a while, then it swings back behind
      const dy = cameraRT.targetYaw - c.lastYaw, dp = cameraRT.targetPitch - c.lastPitch
      if (Math.abs(dy) > 1e-4 || Math.abs(dp) > 1e-4) c.lookT = 0
      c.orbitYaw += dy
      c.orbitPitch = clamp(c.orbitPitch + dp, -0.6, 0.9)
      c.lookT += dt
      if (c.lookT > 2.5) { c.orbitYaw = damp(c.orbitYaw, 0, 1.2, dt); c.orbitPitch = damp(c.orbitPitch, 0, 1.2, dt) }
      const seat = dragonSeatRT[c.rider!]
      const yaw = Math.atan2(seat.forward.x, seat.forward.z) + c.orbitYaw
      const distance = 4.4 + d.speed * 0.05 + d.surge * 3
      const lift = 1.55 + d.speed * 0.015 + c.orbitPitch * 3.5
      _cam.set(seat.pelvis.x - Math.sin(yaw) * distance, seat.pelvis.y + lift, seat.pelvis.z - Math.cos(yaw) * distance)
      _cam.y = Math.max(_cam.y, top(_cam.x, _cam.z) + 1.6)
      if (!c.camInit) { c.cam.copy(_cam); c.camInit = true }
      c.cam.x = damp(c.cam.x, _cam.x, 5.5, dt)
      c.cam.y = damp(c.cam.y, _cam.y, 4.5, dt)
      c.cam.z = damp(c.cam.z, _cam.z, 5.5, dt)
      _look.copy(seat.pelvis).addScaledVector(seat.forward, 6 + d.speed * 0.1).addScaledVector(seat.up, 0.7)
      cam.px = c.cam.x; cam.py = c.cam.y; cam.pz = c.cam.z
      cam.tx = _look.x; cam.ty = _look.y; cam.tz = _look.z
      cam.fov = 48 + d.speed * 0.1 + d.surge * 9
      cam.roll = -d.bank * 0.12
    }
    c.lastYaw = cameraRT.targetYaw
    c.lastPitch = cameraRT.targetPitch

    dragonRT.mode = d.mode
    dragonRT.riding = carrying
    dragonRT.x = d.x; dragonRT.y = d.y; dragonRT.z = d.z
    const ui = useDragonUI.getState()
    if (ui.prompt !== prompt) ui.setPrompt(prompt)
  }, -45)

  if (!rig) return null
  return (
    <>
      <primitive object={rig.group} />
      <primitive object={ribbons.whiskerL.mesh} />
      <primitive object={ribbons.whiskerR.mesh} />
      <primitive object={ribbons.tail.mesh} />
      <mesh ref={pearl} material={pearlMat} frustumCulled={false} name="dragon-pearl">
        <icosahedronGeometry args={[1, 4]} />
      </mesh>
    </>
  )
}
