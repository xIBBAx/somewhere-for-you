import * as THREE from "three"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import type { AnimalModel } from "../../../world/wildlife/animalAssets"
import type { CrewMember } from "./crew"

/**
 * A space cat's kit, fitted to the one rigged cat (public/assets/animals/cat.glb).
 *
 * - The suit and booties are the cat's own skinned body, inflated a few
 *   millimetres along its normals and cut by skin weight (torso, neck and
 *   upper legs for the suit; the lower legs and paws for the booties), so
 *   they are skinned to the same bones and fold exactly as the fur does:
 *   nothing clips when a cat curls up, kneads or turns a somersault.
 * - The pressure helmet is a clear dome on the head bone, sized from the
 *   measured head (ear tips reach y 0.359 in rest space; a 0.106 m sphere
 *   round (0, 0.268, 0.19) holds every head vertex, whiskers included), with
 *   a sealed neck ring, a gold sun visor that lowers or lifts, two helmet
 *   lamps and a comms antenna.
 * - The life-support pack rides on the spine: a rounded case with a status
 *   light and two little cold-gas nozzles, which puff when they manoeuvre.
 *
 * Rest-space conventions (the asset): +z forward, +y up, metres, a cat about
 * 0.36 m tall to the ear tips.
 */

const HEAD_SET = new Set(["head", "earL", "earR", "eyeL", "eyeR", "pupilL", "pupilR", "jaw", "tongue", "whiskerL", "whiskerR"])
const TAIL_SET = new Set(["tail1", "tail2", "tail3", "tail4", "tail5", "tail6"])
const PAW_SET = new Set(["legFL3", "legFL4", "legFR3", "legFR4", "legBL3", "legBL4", "legBR3", "legBR4"])

type KitGeometry = { suit: THREE.BufferGeometry; boots: THREE.BufferGeometry }
const kitCache = new WeakMap<THREE.BufferGeometry, KitGeometry>()

/** Weight of a vertex on a set of bones. */
const weightOn = (si: THREE.BufferAttribute, sw: THREE.BufferAttribute, names: string[], set: Set<string>, i: number): number => {
  let w = 0
  for (let c = 0; c < 4; c++) if (set.has(names[si.getComponent(i, c)])) w += sw.getComponent(i, c)
  return w
}

/**
 * Cut and inflate the body into the suit and the booties (shared by every
 * cat: the geometry is the same, only the material differs).
 */
export const kitGeometry = (body: THREE.SkinnedMesh): KitGeometry => {
  const cached = kitCache.get(body.geometry)
  if (cached) return cached
  const g = body.geometry
  const names = body.skeleton.bones.map((b) => b.name)
  const pos = g.attributes.position as THREE.BufferAttribute
  const nor = g.attributes.normal as THREE.BufferAttribute
  const si = g.attributes.skinIndex as THREE.BufferAttribute
  const sw = g.attributes.skinWeight as THREE.BufferAttribute
  const index = g.index ? Array.from(g.index.array) : Array.from({ length: pos.count }, (_, i) => i)
  const region = new Int8Array(pos.count) // 0 bare (head, tail), 1 suit, 2 boot
  for (let i = 0; i < pos.count; i++) {
    const head = weightOn(si, sw, names, HEAD_SET, i)
    const tail = weightOn(si, sw, names, TAIL_SET, i)
    const paw = weightOn(si, sw, names, PAW_SET, i)
    // literal-colour parts (eyes, nose, claws) are never covered
    region[i] = head > 0.45 || tail > 0.5 ? 0 : paw > 0.5 ? 2 : 1
  }
  const build = (want: 1 | 2, inflate: number): THREE.BufferGeometry => {
    const remap = new Map<number, number>()
    const p: number[] = [], n: number[] = [], rest: number[] = [], idx: number[] = [], sI: number[] = [], sW: number[] = []
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t], b = index[t + 1], c = index[t + 2]
      const ra = region[a], rb = region[b], rc = region[c]
      if (ra === 0 || rb === 0 || rc === 0) continue
      // seam triangles go to both, so the booties overlap the suit's cuffs a little
      const boots = (ra === 2 ? 1 : 0) + (rb === 2 ? 1 : 0) + (rc === 2 ? 1 : 0)
      if (want === 1 ? boots > 1 : boots < 1) continue
      for (const v of [a, b, c]) {
        let k = remap.get(v)
        if (k === undefined) {
          k = p.length / 3
          remap.set(v, k)
          const nx = nor.getX(v), ny = nor.getY(v), nz = nor.getZ(v)
          p.push(pos.getX(v) + nx * inflate, pos.getY(v) + ny * inflate, pos.getZ(v) + nz * inflate)
          n.push(nx, ny, nz)
          rest.push(pos.getX(v), pos.getY(v), pos.getZ(v))
          for (let q = 0; q < 4; q++) { sI.push(si.getComponent(v, q)); sW.push(sw.getComponent(v, q)) }
        }
        idx.push(k)
      }
    }
    const out = new THREE.BufferGeometry()
    out.setAttribute("position", new THREE.Float32BufferAttribute(p, 3))
    out.setAttribute("normal", new THREE.Float32BufferAttribute(n, 3))
    out.setAttribute("rest", new THREE.Float32BufferAttribute(rest, 3))
    out.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(sI, 4))
    out.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sW, 4))
    out.setIndex(idx)
    out.computeBoundingSphere()
    out.boundingSphere!.radius = out.boundingSphere!.radius * 1.7 + 0.2
    return out
  }
  const kit = { suit: build(1, 0.0065), boots: build(2, 0.0085) }
  kitCache.set(body.geometry, kit)
  return kit
}

// ---- materials -------------------------------------------------------------------

/**
 * The suit's fabric: an EVA white with quilted panels, the crew member's
 * colour in stripes round the upper legs and along the spine, and a round
 * mission patch on each flank. Drawn from the rest position so the pattern
 * stays on the fabric as the body moves.
 */
const suitMaterial = (c: CrewMember, boots: boolean): THREE.MeshStandardMaterial => {
  const m = new THREE.MeshStandardMaterial({ color: boots ? "#d9d7d2" : "#eeece6", roughness: boots ? 0.7 : 0.86, metalness: 0 })
  const uniforms = {
    uAccent: { value: new THREE.Color(c.accent) },
    uPatch: { value: new THREE.Color(c.patch) },
    uBoots: { value: boots ? 1 : 0 },
  }
  m.userData.suit = uniforms
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 rest;\nvarying vec3 vRest;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRest = rest;")
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uAccent, uPatch;\nuniform float uBoots;\nvarying vec3 vRest;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
vec3 r = vRest;
float aa = 0.0018;
if (uBoots > 0.5) {
  // a dark sole and the crew colour in a cuff round the top
  float sole = 1.0 - smoothstep(0.012, 0.016, r.y);
  float cuff = smoothstep(0.052, 0.056, r.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.22, 0.22, 0.24), sole);
  diffuseColor.rgb = mix(diffuseColor.rgb, uAccent, cuff * 0.9);
} else {
  // padded fabric: soft ribs round the body, no harder than a shadow
  float rib = abs(fract(r.z * 22.0) - 0.5);
  diffuseColor.rgb *= 0.965 + 0.035 * smoothstep(0.04, 0.2, rib);
  // stripes round the upper legs (a commander's red, on the captain), and a yoke over the shoulders
  float legBand = smoothstep(0.098, 0.103, r.y) * (1.0 - smoothstep(0.13, 0.135, r.y)) * step(r.y, 0.2);
  float yoke = smoothstep(0.1, 0.11, r.z) * (1.0 - smoothstep(0.135, 0.145, r.z)) * smoothstep(0.2, 0.23, r.y);
  legBand = max(legBand, yoke);
  // a stripe along the spine
  float spine = (1.0 - smoothstep(0.009, 0.012, abs(r.x))) * smoothstep(0.27, 0.28, r.y) * smoothstep(-0.09, -0.06, r.z) * (1.0 - smoothstep(0.1, 0.13, r.z));
  diffuseColor.rgb = mix(diffuseColor.rgb, uAccent, max(legBand, spine));
  // the mission patch on each flank: a ring of gold, the crew's field, a white star
  vec2 q = vec2(r.z - 0.01, r.y - 0.238) / 0.024;
  float d = length(q);
  float side = smoothstep(0.035, 0.05, abs(r.x));
  float field = (1.0 - smoothstep(0.86, 0.86 + aa * 40.0, d)) * side;
  float ring = smoothstep(0.86, 0.9, d) * (1.0 - smoothstep(1.0, 1.04, d)) * side;
  float a = atan(q.y, q.x);
  float star = (1.0 - smoothstep(0.0, 0.06, d - 0.42 * (0.55 + 0.45 * cos(5.0 * a)))) * side;
  diffuseColor.rgb = mix(diffuseColor.rgb, uPatch, field);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.68, 0.28), ring);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.97, 0.96, 0.92), star * field);
}`,
      )
  }
  m.customProgramCacheKey = () => "space-cat-suit-v1"
  return m
}

const GLASS_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vViewW;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewW = normalize(cameraPosition - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

/**
 * Helmet glass: clear face-on, reflective at grazing angles (Fresnel), a
 * glint of the real Sun, and a faint reflection of a sky (blue over Earth,
 * black with a warm horizon glow in space). The gold visor is the same
 * glass with a thin gold film: much more reflective and tinted.
 */
const GLASS_FRAG = /* glsl */ `
uniform vec3 uSun;
uniform float uSunLit;
uniform vec3 uTint;
uniform float uGold;
uniform float uSky;
uniform float uFade;
varying vec3 vNormalW;
varying vec3 vViewW;
varying vec3 vLocal;
void main() {
  vec3 n = normalize(vNormalW);
  bool back = !gl_FrontFacing;
  if (back) n = -n;
  float facing = clamp(abs(dot(n, vViewW)), 0.0, 1.0);
  float fres = 0.04 + 0.96 * pow(1.0 - facing, 5.0);
  vec3 refl = reflect(-vViewW, n);
  // the sky it mirrors: home's blue by day, space's black with a glow along the horizon
  vec3 skyDay = mix(vec3(0.55, 0.68, 0.82), vec3(0.28, 0.45, 0.72), clamp(refl.y, 0.0, 1.0));
  vec3 skySpace = vec3(0.02, 0.025, 0.04) + vec3(0.12, 0.1, 0.08) * pow(1.0 - abs(refl.y), 6.0);
  vec3 sky = mix(skySpace, skyDay, uSky);
  float glint = pow(max(dot(refl, uSun), 0.0), 260.0) * uSunLit * 4.0;
  float sheen = pow(max(dot(refl, uSun), 0.0), 12.0) * uSunLit * 0.25;
  vec3 gold = vec3(0.95, 0.72, 0.32);
  float reflectivity = mix(fres, 0.55 + 0.45 * fres, uGold);
  vec3 col = sky * mix(vec3(1.0), gold, uGold) * reflectivity + (glint + sheen) * mix(vec3(1.0, 0.97, 0.9), gold, uGold * 0.6);
  float a = clamp(reflectivity * 0.9 + uGold * 0.35 + 0.03 + glint, 0.0, 0.92);
  if (back) a *= 0.45;
  gl_FragColor = vec4(col + uTint * 0.02, a * uFade);
}
`

export type GlassUniforms = {
  uSun: { value: THREE.Vector3 }
  uSunLit: { value: number }
  uTint: { value: THREE.Color }
  uGold: { value: number }
  uSky: { value: number }
  uFade: { value: number }
}

/** One set of glass uniforms is shared by every helmet (the Sun and the sky are the same for all). */
export const glassUniforms: GlassUniforms = {
  uSun: { value: new THREE.Vector3(0, 1, 0) },
  uSunLit: { value: 1 },
  uTint: { value: new THREE.Color("#bcd6ff") },
  uGold: { value: 0 },
  uSky: { value: 0 },
  uFade: { value: 1 },
}

const glassMaterial = (gold: boolean): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    vertexShader: GLASS_VERT,
    fragmentShader: GLASS_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { ...glassUniforms, uGold: { value: gold ? 1 : 0 } },
  })

// ---- the kit's parts ---------------------------------------------------------------

/** The helmet dome: centre, radii (model space), and the way its neck opening faces. */
export const HELMET = {
  centre: new THREE.Vector3(0, 0.27, 0.188),
  radii: new THREE.Vector3(0.117, 0.126, 0.119),
  /** the opening faces down and back, along the neck */
  opening: new THREE.Vector3(0, -0.62, -0.78).normalize(),
  /** fraction of the sphere kept (the rest is the neck opening) */
  keep: 0.79,
} as const

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const DOWN = new THREE.Vector3(0, -1, 0)

/** A dome with its opening facing HELMET.opening, in model space. */
const domeGeometry = (scale: number, thetaFrom: number, thetaLen: number, phiFrom = 0, phiLen = Math.PI * 2): THREE.BufferGeometry => {
  const g = new THREE.SphereGeometry(1, 40, 26, phiFrom, phiLen, thetaFrom, thetaLen)
  g.applyMatrix4(_m.makeRotationFromQuaternion(_q.setFromUnitVectors(DOWN, HELMET.opening)))
  g.scale(HELMET.radii.x * scale, HELMET.radii.y * scale, HELMET.radii.z * scale)
  g.translate(HELMET.centre.x, HELMET.centre.y, HELMET.centre.z)
  return g
}

/** The rim of the dome's opening, as a closed loop (model space). */
const openingLoop = (scale = 1): THREE.Vector3[] => {
  const th = Math.PI * HELMET.keep
  const pts: THREE.Vector3[] = []
  _q.setFromUnitVectors(DOWN, HELMET.opening)
  for (let i = 0; i < 48; i++) {
    const ph = (i / 48) * Math.PI * 2
    // SphereGeometry: x = −cos φ sin θ, y = cos θ, z = sin φ sin θ
    const v = new THREE.Vector3(-Math.cos(ph) * Math.sin(th), Math.cos(th), Math.sin(ph) * Math.sin(th)).applyQuaternion(_q)
    v.multiply(HELMET.radii).multiplyScalar(scale).add(HELMET.centre)
    pts.push(v)
  }
  return pts
}

export type CatKit = {
  suit: THREE.SkinnedMesh
  boots: THREE.SkinnedMesh
  helmet: THREE.Group
  /** the visor's hinge (turned by setVisor) */
  visor: THREE.Group
  pack: THREE.Group
  /** the antenna's status light and the pack's, for blinking */
  beacon: THREE.Mesh
  /** cold-gas puffs behind the pack's nozzles */
  puffs: THREE.Mesh[]
  /** a soft collar for life at Star Nook (shown once the suit comes off) */
  collar: THREE.Mesh
  materials: THREE.Material[]
  geometries: THREE.BufferGeometry[]
  /** where the helmet and pack are worn (to put them back on after the rack) */
  homes: Record<"helmet" | "pack", { parent: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }>
}

/** Attach a model-space object to a bone, so it follows the bone from its rest pose. */
const attach = (model: AnimalModel, boneName: string, obj: THREE.Object3D): void => {
  const bone = model.bones.get(boneName)
  if (!bone) throw new Error(`[space cats] no bone ${boneName}`)
  model.root.updateMatrixWorld(true)
  const rel = _m.copy(model.root.matrixWorld).invert().multiply(bone.matrixWorld)
  rel.invert().decompose(obj.position, obj.quaternion, obj.scale)
  bone.add(obj)
}

/**
 * Dress one cat. Call on a fresh model in its rest pose, before its breed's
 * build and before its animator is made.
 */
export const dressCat = (model: AnimalModel, c: CrewMember): CatKit => {
  const body = model.meshes[0]
  const geo = kitGeometry(body)
  const materials: THREE.Material[] = []
  const geometries: THREE.BufferGeometry[] = []
  const own = <T extends THREE.Material>(m: T): T => { materials.push(m); return m }
  const ownG = <T extends THREE.BufferGeometry>(g: T): T => { geometries.push(g); return g }

  // ---- suit and booties: skinned to the cat's own skeleton --------------------
  const skin = (g: THREE.BufferGeometry, m: THREE.Material, name: string): THREE.SkinnedMesh => {
    const s = new THREE.SkinnedMesh(g, m)
    s.name = name
    s.position.copy(body.position)
    s.quaternion.copy(body.quaternion)
    s.scale.copy(body.scale)
    s.bind(body.skeleton, body.bindMatrix)
    s.castShadow = true
    s.receiveShadow = true
    // five small cats: cheaper to draw than to bound a curling, tumbling body
    s.frustumCulled = false
    body.parent!.add(s)
    return s
  }
  const suit = skin(geo.suit, own(suitMaterial(c, false)), `${c.id}-suit`)
  const boots = skin(geo.boots, own(suitMaterial(c, true)), `${c.id}-boots`)

  // ---- helmet ------------------------------------------------------------------
  const helmet = new THREE.Group()
  helmet.name = `${c.id}-helmet`
  const glass = new THREE.Mesh(ownG(domeGeometry(1, 0, Math.PI * HELMET.keep)), own(glassMaterial(false)))
  glass.renderOrder = 7
  glass.name = "glass"
  helmet.add(glass)
  // the sun visor: a band of the dome over the face, a hair outside the glass
  const visorGeo = ownG(new THREE.SphereGeometry(1.018, 36, 14, Math.PI * 0.08, Math.PI * 0.84, Math.PI * 0.16, Math.PI * 0.36))
  // (SphereGeometry's φ = π/2 is +z, the face: the band is centred on it)
  visorGeo.scale(HELMET.radii.x, HELMET.radii.y, HELMET.radii.z)
  visorGeo.translate(HELMET.centre.x, HELMET.centre.y, HELMET.centre.z)
  const visor = new THREE.Mesh(visorGeo, own(glassMaterial(true)))
  visor.renderOrder = 8
  visor.name = "visor"
  // the visor turns about the helmet's lateral axis through its centre
  const visorHolder = new THREE.Group()
  visorHolder.position.copy(HELMET.centre)
  visor.position.copy(HELMET.centre).negate()
  visorHolder.add(visor)
  helmet.add(visorHolder)
  // the neck ring, round the rim of the opening, and its seal
  const metal = own(new THREE.MeshStandardMaterial({ color: "#c9ccd2", metalness: 0.85, roughness: 0.32 }))
  const accentMetal = own(new THREE.MeshStandardMaterial({ color: c.accent, metalness: 0.55, roughness: 0.38 }))
  const loop = new THREE.CatmullRomCurve3(openingLoop(1.0), true)
  helmet.add(new THREE.Mesh(ownG(new THREE.TubeGeometry(loop, 64, 0.0075, 8, true)), metal))
  const seal = new THREE.CatmullRomCurve3(openingLoop(0.985).map((p) => p.addScaledVector(HELMET.opening, 0.008)), true)
  helmet.add(new THREE.Mesh(ownG(new THREE.TubeGeometry(seal, 64, 0.0062, 8, true)), accentMetal))
  // helmet lamps either side, just above the ring
  const lampMat = own(new THREE.MeshStandardMaterial({ color: "#eef2ff", emissive: "#fff3d8", emissiveIntensity: 1.6, roughness: 0.2 }))
  const lampBody = ownG(new THREE.CylinderGeometry(0.0085, 0.0085, 0.02, 12).rotateX(Math.PI / 2))
  const lampLens = ownG(new THREE.CircleGeometry(0.0072, 12))
  for (const side of [-1, 1]) {
    const lamp = new THREE.Group()
    lamp.position.set(side * HELMET.radii.x * 0.93, HELMET.centre.y - 0.035, HELMET.centre.z - 0.01)
    lamp.add(new THREE.Mesh(lampBody, metal))
    const lens = new THREE.Mesh(lampLens, lampMat)
    lens.position.z = 0.0102
    lamp.add(lens)
    helmet.add(lamp)
  }
  // the comms antenna, from the back of the crown, with a status light
  const antennaGeo = ownG(new THREE.CylinderGeometry(0.0016, 0.0022, 0.07, 6))
  const antenna = new THREE.Mesh(antennaGeo, metal)
  antenna.position.set(0.05, HELMET.centre.y + 0.1, HELMET.centre.z - 0.075)
  antenna.rotation.set(-0.45, 0, -0.25)
  helmet.add(antenna)
  const beaconMat = own(new THREE.MeshStandardMaterial({ color: c.accent, emissive: c.accent, emissiveIntensity: 2, roughness: 0.3 }))
  const beacon = new THREE.Mesh(ownG(new THREE.SphereGeometry(0.0058, 10, 8)), beaconMat)
  beacon.position.set(0, 0.037, 0)
  antenna.add(beacon)
  attach(model, "head", helmet)

  // ---- the life-support pack, on the spine ----------------------------------------
  const pack = new THREE.Group()
  pack.name = `${c.id}-pack`
  const shell = own(new THREE.MeshStandardMaterial({ color: "#e9e7e1", roughness: 0.62, metalness: 0.05 }))
  const caseMesh = new THREE.Mesh(ownG(new RoundedBoxGeometry(0.088, 0.05, 0.118, 3, 0.014)), shell)
  caseMesh.position.set(0, 0.318, 0.0)
  caseMesh.castShadow = true
  pack.add(caseMesh)
  // a control strip in the crew colour along the top
  const strip = new THREE.Mesh(ownG(new RoundedBoxGeometry(0.03, 0.006, 0.07, 2, 0.002)), accentMetal)
  strip.position.set(0, 0.344, 0.004)
  pack.add(strip)
  // two cold-gas nozzles at the back, angled out, with their puffs
  const nozzleGeo = ownG(new THREE.CylinderGeometry(0.004, 0.0075, 0.016, 10).rotateX(Math.PI / 2))
  const puffGeo = ownG(new THREE.ConeGeometry(0.014, 0.06, 10, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.03))
  const puffMat = own(new THREE.MeshBasicMaterial({ color: "#d9ecff", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }))
  const puffs: THREE.Mesh[] = []
  for (const side of [-1, 1]) {
    const nozzle = new THREE.Mesh(nozzleGeo, metal)
    nozzle.position.set(side * 0.03, 0.31, -0.064)
    nozzle.rotation.y = side * 0.3
    pack.add(nozzle)
    const puff = new THREE.Mesh(puffGeo, puffMat)
    puff.position.z = -0.006
    puff.renderOrder = 9
    nozzle.add(puff)
    puffs.push(puff)
  }
  attach(model, "spine", pack)

  // ---- a collar for after (Star Nook) --------------------------------------------------
  const collarLoop = new THREE.CatmullRomCurve3(openingLoop(0.72).map((p) => p.addScaledVector(HELMET.opening, 0.022)), true)
  const collar = new THREE.Mesh(ownG(new THREE.TubeGeometry(collarLoop, 48, 0.0065, 6, true)), own(new THREE.MeshStandardMaterial({ color: c.accent, roughness: 0.75 })))
  const tag = new THREE.Mesh(ownG(new THREE.CylinderGeometry(0.009, 0.009, 0.002, 5).rotateX(Math.PI / 2)), own(new THREE.MeshStandardMaterial({ color: "#d7b45a", metalness: 0.9, roughness: 0.3 })))
  const low = openingLoop(0.72).reduce((a, b) => (b.z > a.z || (Math.abs(b.z - a.z) < 1e-4 && b.y < a.y) ? b : a))
  tag.position.copy(low).addScaledVector(HELMET.opening, 0.022).add(new THREE.Vector3(0, -0.012, 0.004))
  collar.add(tag)
  collar.visible = false
  attach(model, "head", collar)

  const home = (o: THREE.Object3D): CatKit["homes"]["helmet"] => ({ parent: o.parent!, position: o.position.clone(), quaternion: o.quaternion.clone(), scale: o.scale.clone() })
  return { suit, boots, helmet, visor: visorHolder, pack, beacon, puffs, collar, materials, geometries, homes: { helmet: home(helmet), pack: home(pack) } }
}

/** Lower (1) or lift (0) the gold visor: lifted, it turns back over the crown. */
export const setVisor = (kit: CatKit, down: number): void => {
  kit.visor.rotation.x = -(1 - down) * 1.05
}

/** Put the kit away (the cat is home): suit, booties, helmet and pack hidden, the collar on. */
export const wearKit = (kit: CatKit, on: boolean): void => {
  kit.suit.visible = on
  kit.boots.visible = on
  kit.helmet.visible = on
  kit.pack.visible = on
  kit.collar.visible = !on
}

export const disposeKit = (kit: CatKit): void => {
  for (const m of kit.materials) m.dispose()
  for (const g of kit.geometries) g.dispose()
  kit.suit.removeFromParent()
  kit.boots.removeFromParent()
  kit.helmet.removeFromParent()
  kit.pack.removeFromParent()
  kit.collar.removeFromParent()
}
