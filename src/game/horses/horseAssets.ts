import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js"
import type { BreedId, FaceMark, HorseIdentity } from "./breeds"
import type { WingGroups } from "../pegasus/WingAnimator"
import { disposeFadeable } from "../../world/render/aerialFog"

/**
 * Horse models: one GLB per breed (asset-pipeline/horses/build.sh), each with its
 * own conformation, built on the same 40-bone equine skeleton. A clone shares
 * the breed's geometry; materials are per horse because the coat, markings
 * and hair motion are per horse (they compile to one shader program).
 */

export type HorseMeta = {
  breed: BreedId
  height: number
  length: number
  hooves: Record<"hoofFL" | "hoofFR" | "hoofBL" | "hoofBR", [number, number, number]>
  head: { origin: number[]; axis: number[]; dorsal: number[]; length: number }
  marks: Record<string, number[]>
  tack: {
    seat: number[]; seatBone: string; pommel: number[]; cantle: number[]
    stirrupL: number[]; stirrupR: number[]; bitL: number[]; bitR: number[]; reinRest: number[]
    /** tandem saddle: the second (rear) seat and its stirrups */
    seat2?: number[]; stirrupL2?: number[]; stirrupR2?: number[]
  }
  /** winged builds: semispan (m), planform, and the feather groups' angle ranges */
  wing?: { semi: number; kind: string; chord: number; prim: number; bones: string[]; groups?: WingGroups }
}

type Template = { scene: THREE.Group; meta: HorseMeta }
const templates = new Map<string, Promise<Template | null>>()

export const horseAssetUrl = (breed: BreedId, lod: 0 | 1): string => `/assets/horses/${breed}${lod ? "-lod1" : ""}.glb`

const loadTemplate = (breed: BreedId, lod: 0 | 1): Promise<Template | null> => {
  const key = `${breed}:${lod}`
  let p = templates.get(key)
  if (!p) {
    p = new GLTFLoader().loadAsync(horseAssetUrl(breed, lod)).then((g) => {
      let meta: HorseMeta | null = null
      g.scene.traverse((o) => {
        const raw = (o.userData as { horse?: string }).horse
        if (raw && !meta) meta = JSON.parse(raw) as HorseMeta
      })
      if (!meta) throw new Error(`horse ${breed}: no metadata`)
      return { scene: g.scene, meta }
    }).catch((error) => {
      console.warn(`[horses] ${breed} LOD ${lod} unavailable`, error)
      return null
    })
    templates.set(key, p)
  }
  return p
}

export const preloadHorse = (breed: BreedId): Promise<unknown> => Promise.all([loadTemplate(breed, 0), loadTemplate(breed, 1)])

// ---------------------------------------------------------------- hair texture

let hairTexture: THREE.Texture | null = null
/**
 * Strand texture for the hair cards, drawn once: a few hundred fine, slightly
 * wavy hairs of varied tone that thin out towards the tips. Roots are at the
 * bottom of the canvas (the cards' v = 1 in glTF's flipped convention).
 */
export const getHairTexture = (): THREE.Texture => {
  if (hairTexture) return hairTexture
  const w = 256
  const h = 512
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext("2d")!
  g.clearRect(0, 0, w, h)
  let s = 1234567
  const rand = (): number => ((s = (s * 16807) % 2147483647) / 2147483647)
  // Real hair falls in locks: strands gather into clumps with gaps between
  // them, each lock tapering to a few fine tips, plus loose strays. A card
  // drawn from this reads as hair you can see through, not an opaque striped
  // sheet with a hard polygon edge (the old 420 even strands covered the
  // root ~2.3x over). Strands wrap across u, which repeats.
  const strand = (x0: number, len: number, width: number, tone: number, alpha: number, wav: number): void => {
    const grad = g.createLinearGradient(0, h, 0, h - len)
    const c = Math.round(255 * tone)
    // roots fade in over a staggered few percent, so a card's base edge is
    // ragged where it leaves the crest or the dock instead of a straight cut
    const root = 0.01 + rand() * 0.07
    grad.addColorStop(0, `rgba(${c},${c},${c},0)`)
    grad.addColorStop(root, `rgba(${c},${c},${c},${alpha})`)
    grad.addColorStop(0.7, `rgba(${c},${c},${c},${alpha * 0.92})`)
    grad.addColorStop(1, `rgba(${c},${c},${c},0)`)
    g.strokeStyle = grad
    g.lineWidth = width
    for (const dx of [0, -w, w]) {
      const x = x0 + dx
      if (x < -12 || x > w + 12) continue
      g.beginPath()
      g.moveTo(x, h)
      g.bezierCurveTo(x + wav, h - len * 0.33, x - wav, h - len * 0.66, x + wav * 0.5, h - len)
      g.stroke()
    }
  }
  for (let lock = 0; lock < 30; lock++) {
    const cx = rand() * w
    const spread = 3 + rand() * 7
    const lockLen = h * (0.62 + rand() * 0.38)
    const lockTone = 0.62 + rand() * 0.38
    const lockWav = (rand() - 0.5) * 7
    const n = 7 + Math.floor(rand() * 9)
    for (let i = 0; i < n; i++) {
      // strands bunch toward the lock's middle and run nearly its length
      const off = (rand() + rand() - 1) * spread
      strand(cx + off, lockLen * (0.72 + rand() * 0.28), 0.8 + rand() * 0.9, lockTone * (0.85 + rand() * 0.15), 0.95, lockWav + (rand() - 0.5) * 2)
    }
  }
  // strays and short flyaways between the locks
  for (let i = 0; i < 70; i++) strand(rand() * w, h * (0.3 + rand() * 0.7), 0.7 + rand() * 0.5, 0.55 + rand() * 0.45, 0.85, (rand() - 0.5) * 9)
  const tex = new THREE.CanvasTexture(canvas)
  tex.flipY = false
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  tex.wrapS = THREE.RepeatWrapping
  hairTexture = tex
  return tex
}

// ---------------------------------------------------------------- materials

const FACE_CODE: Record<FaceMark, number> = { none: 0, star: 1, strip: 2, snip: 3, starStrip: 4, blaze: 5, bald: 6 }

export type CoatUniforms = {
  uBody: { value: THREE.Color }
  uPoints: { value: THREE.Color }
  uHasPoints: { value: number }
  uPale: { value: number }
  uDapple: { value: number }
  uRoan: { value: number }
  uFace: { value: number }
  uLegs: { value: THREE.Vector4 }
  uPoll: { value: THREE.Vector3 }
  uAxis: { value: THREE.Vector3 }
  uDorsal: { value: THREE.Vector3 }
  uHeadLen: { value: number }
  uH: { value: number }
  uSeed: { value: number }
  uWet: { value: number }
  uDust: { value: number }
  uStars: { value: number }
}

const coatMaterial = (h: HorseIdentity, meta: HorseMeta, normalMap: THREE.Texture | null): THREE.MeshStandardMaterial => {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0, vertexColors: true, normalMap })
  if (normalMap) m.normalScale.set(1.25, 1.25)
  const coat = h.coat
  const u: CoatUniforms = {
    uBody: { value: new THREE.Color(coat.body) },
    uPoints: { value: new THREE.Color(coat.points ?? coat.body) },
    uHasPoints: { value: coat.points ? 1 : 0 },
    uPale: { value: coat.pale },
    uDapple: { value: coat.dapple },
    uRoan: { value: coat.roan },
    uFace: { value: FACE_CODE[h.face] },
    uLegs: { value: new THREE.Vector4(...h.legs) },
    uPoll: { value: new THREE.Vector3(...meta.head.origin) },
    uAxis: { value: new THREE.Vector3(...meta.head.axis) },
    uDorsal: { value: new THREE.Vector3(...meta.head.dorsal) },
    uHeadLen: { value: meta.head.length },
    uH: { value: meta.height },
    uSeed: { value: (h.seed % 997) / 997 },
    uWet: { value: 0 },
    uDust: { value: 0 },
    uStars: { value: coat.stars ?? 0 },
  }
  m.userData.coat = u
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u)
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vRest;\nvarying vec3 vRestN;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRest = position;\nvRestN = normal;")
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform vec3 uBody, uPoints, uPoll, uAxis, uDorsal;
uniform float uHasPoints, uPale, uDapple, uRoan, uFace, uHeadLen, uH, uSeed, uWet, uDust, uStars;
uniform vec4 uLegs;
varying vec3 vRest;
varying vec3 vRestN;
float hHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hHash(i), hHash(i + vec3(1,0,0)), f.x), mix(hHash(i + vec3(0,1,0)), hHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hHash(i + vec3(0,0,1)), hHash(i + vec3(1,0,1)), f.x), mix(hHash(i + vec3(0,1,1)), hHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
// dapples: pale rings of hair around darker centres over the barrel and quarters
float dapples(vec3 p) {
  vec3 q = p * 9.0;
  vec3 c = floor(q);
  float best = 9.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(float(x), float(y), float(z));
    vec3 r = vec3(hHash(c + o), hHash(c + o + 7.1), hHash(c + o + 3.7));
    best = min(best, length(c + o + r - q));
  }
  return smoothstep(0.25, 0.62, best);
}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
float ao = vColor.r;
vec3 p = vRest;
float Hn = uH;
// --- head frame: s along poll -> muzzle, t towards the face, lateral x
vec3 rel = p - uPoll;
float s = dot(rel, uAxis) / uHeadLen;
float tt = dot(rel, uDorsal);
float lat = abs(p.x);
float onHead = step(0.0, s) * (1.0 - smoothstep(0.24 * Hn, 0.3 * Hn, length(rel - uAxis * clamp(dot(rel, uAxis), 0.0, uHeadLen))));
// --- legs: which leg (front if forward of the girth), height above the ground
float front = step(0.0, p.z);
float leftLeg = step(0.0, p.x);
float legWhite = mix(mix(uLegs.w, uLegs.z, leftLeg), mix(uLegs.y, uLegs.x, leftLeg), front);
float kneeH = mix(0.34, 0.3, front) * Hn;
float coronet = 0.062 * Hn;
float lowLeg = 1.0 - smoothstep(kneeH * 0.85, kneeH * 1.25, p.y);
vec3 col = uBody;
// subtle tonal variation in the hair, a darker topline and a richer,
// darker shade low on the legs (the coat thins and darkens there)
col *= 0.93 + 0.14 * hNoise(p * 6.0 + uSeed * 10.0);
col *= mix(1.0, 0.86, smoothstep(0.85 * Hn, 1.0 * Hn, p.y) * (1.0 - onHead));
col *= mix(1.0, 0.82, (1.0 - smoothstep(0.25 * Hn, 0.5 * Hn, p.y)) * (1.0 - uHasPoints));
// mealy / pale areas: belly, inside the legs and flanks, muzzle and round the eyes
float belly = smoothstep(-0.2, -0.75, vRestN.y) * step(0.35 * Hn, p.y);
float inner = smoothstep(0.35, 0.9, -sign(p.x) * vRestN.x) * (1.0 - smoothstep(0.62 * Hn, 0.7 * Hn, p.y)) * step(0.2 * Hn, p.y);
float muzzle = onHead * smoothstep(0.8, 0.95, s);
float eyeRing = onHead * (1.0 - smoothstep(0.03 * Hn, 0.05 * Hn, length(vec2(lat - 0.055 * Hn, s * uHeadLen - 0.35 * uHeadLen))));
col = mix(col, col * 1.55 + 0.04, clamp((belly * 0.6 + inner * 0.5 + muzzle * 0.8 + eyeRing * 0.5) * uPale, 0.0, 0.85));
// dapples over the body of a grey, fading on the head and legs
float dap = dapples(p) * uDapple * (1.0 - onHead * 0.6) * smoothstep(0.35 * Hn, 0.55 * Hn, p.y);
col = mix(col, col * 1.45 + 0.05, dap);
// roan: white hairs through the body but not the head or lower legs
float roan = uRoan * step(0.5, hHash(floor(p * 260.0))) * (1.0 - onHead) * (1.0 - lowLeg);
col = mix(col, vec3(0.86), roan * 0.55);
// points: black lower legs, ear rims and muzzle on bays, buckskins, duns
float points = uHasPoints * max(lowLeg, onHead * smoothstep(0.88, 0.97, s) * 0.7);
col = mix(col, uPoints, points);
// a dun's dorsal stripe
// --- white markings ------------------------------------------------------
float face = 0.0;
float mid = lat;
float forehead = onHead * step(0.0, tt + 0.02 * Hn);
if (uFace > 0.5) {
  float star = 1.0 - smoothstep(0.022 * Hn, 0.03 * Hn, length(vec2(mid, (s - 0.33) * uHeadLen * 0.6)));
  float strip = (1.0 - smoothstep(0.009 * Hn, 0.014 * Hn, mid + 0.004 * Hn * sin(s * 20.0 + uSeed * 6.0))) * step(0.35, s) * step(s, 0.86);
  float snip = (1.0 - smoothstep(0.015 * Hn, 0.022 * Hn, mid)) * smoothstep(0.86, 0.9, s);
  float blaze = (1.0 - smoothstep(0.024 * Hn - s * 0.006 * Hn, 0.032 * Hn, mid)) * step(0.22, s);
  float bald = (1.0 - smoothstep(0.06 * Hn, 0.08 * Hn, mid)) * step(0.2, s);
  if (uFace < 1.5) face = star;
  else if (uFace < 2.5) face = strip;
  else if (uFace < 3.5) face = snip;
  else if (uFace < 4.5) face = max(star, strip);
  else if (uFace < 5.5) face = blaze;
  else face = bald;
  face *= forehead;
}
// socks / stockings: legWhite 0..1 of the way up to the knee or hock
float sockTop = coronet + legWhite * (kneeH * 1.05 - coronet) + 0.012 * Hn * sin(atan(p.z, p.x) * 3.0 + uSeed * 9.0);
float sock = step(0.01, legWhite) * (1.0 - smoothstep(sockTop - 0.01 * Hn, sockTop + 0.006 * Hn, p.y)) * step(coronet, p.y);
float white = max(face, sock);
col = mix(col, vec3(0.93, 0.91, 0.87), white);
// skin at the muzzle: dark, or pink where a blaze runs off the nose
float skin = onHead * smoothstep(0.93, 0.985, s) * (1.0 - smoothstep(0.02 * Hn, 0.06 * Hn, tt + 0.03 * Hn) * 0.3);
vec3 skinCol = mix(vec3(0.06, 0.05, 0.05), vec3(0.62, 0.45, 0.42), face);
col = mix(col, skinCol, skin * 0.85);
// hoof horn: dark grey, pale and striped under a white sock
float hoof = 1.0 - smoothstep(coronet - 0.004 * Hn, coronet + 0.002 * Hn, p.y);
vec3 horn = mix(vec3(0.075, 0.07, 0.065), vec3(0.62, 0.55, 0.43) * (0.85 + 0.15 * sin(atan(p.z, p.x) * 14.0)), step(0.01, legWhite));
col = mix(col, horn, hoof);
// a star-born coat: a faint nebular sheen and scattered bright specks
float speck = uStars * step(0.9965, hHash(floor(p * 95.0))) * (1.0 - hoof);
col += uStars * vec3(0.03, 0.02, 0.07) * hNoise(p * 2.5 + 3.0);
col = mix(col, vec3(0.9, 0.93, 1.0), speck);
// wet coat darkens, dust lightens the legs
col *= 1.0 - uWet * 0.35;
col = mix(col, vec3(0.55, 0.48, 0.38), uDust * lowLeg * 0.5);
diffuseColor.rgb = col * mix(1.0, ao, 0.85);`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
// short summer coat has a soft sheen; horn and wet skin are smoother
roughnessFactor = mix(roughnessFactor, 0.38, hoof);
roughnessFactor = mix(roughnessFactor, 0.32, skin * 0.8);
roughnessFactor = mix(roughnessFactor, 0.35, uWet);`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
// sheen: light grazing the short hair along the silhouette
vec3 sheenN = normalize(vNormal);
float rim = pow(1.0 - clamp(dot(sheenN, normalize(vViewPosition)), 0.0, 1.0), 2.6);
totalEmissiveRadiance += diffuseColor.rgb * rim * 0.16 * (1.0 - hoof);
totalEmissiveRadiance += vec3(0.75, 0.82, 1.0) * uStars * step(0.9965, hHash(floor(vRest * 95.0))) * 0.9;
totalEmissiveRadiance += vec3(0.25, 0.2, 0.55) * uStars * rim * 0.35;`)
  }
  m.customProgramCacheKey = () => "horse-coat-v2"
  return m
}

export type HairUniforms = { uFlow: { value: THREE.Vector3 }; uTime: { value: number }; uWind: { value: number } }

const hairMaterial = (h: HorseIdentity): THREE.MeshStandardMaterial => {
  const color = new THREE.Color(h.coat.mane)
  const m = new THREE.MeshStandardMaterial({
    color, map: getHairTexture(), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.52, metalness: 0,
    // with MSAA, strand edges get smooth coverage instead of a jagged cut-out
    alphaToCoverage: true,
  })
  const u: HairUniforms = { uFlow: { value: new THREE.Vector3() }, uTime: { value: 0 }, uWind: { value: 0 } }
  m.userData.hair = u
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u)
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uFlow;\nuniform float uTime, uWind;")
      .replace("#include <skinning_vertex>", `#include <skinning_vertex>
// hair streams with the horse's motion: tips (v -> 0) move most, roots not at all
float tip = pow(clamp(1.0 - uv.y, 0.0, 1.0), 1.4);
float ph = position.x * 23.0 + position.z * 17.0 + position.y * 11.0;
vec3 flutter = vec3(sin(uTime * 7.0 + ph), 0.35 * sin(uTime * 5.3 + ph * 1.3), cos(uTime * 6.1 + ph * 0.7)) * (0.006 + 0.012 * uWind + 0.0025 * length(uFlow));
transformed += (uFlow * 0.05 + flutter) * tip;`)
    // Coverage that survives distance: as the texture mips down, fine
    // strands average to faint alpha and an alpha-tested tail would thin to
    // nothing far away; raise alpha with the mip level so locks stay full.
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>
#ifdef USE_MAP
{
  vec2 texel = vMapUv * vec2(256.0, 512.0);
  float lod = log2(max(max(length(dFdx(texel)), length(dFdy(texel))), 1.0));
  diffuseColor.a = min(1.0, diffuseColor.a * (1.0 + 0.45 * lod));
}
#endif`)
  }
  m.customProgramCacheKey = () => "horse-hair-v2"
  return m
}

// ---------------------------------------------------------------- feathers

export type FeatherUniforms = {
  uFeatherA: { value: Float32Array }
  uFeatherFan: { value: Float32Array }
  uFlex: { value: Float32Array }
  /** Starborn's light (celestial feathers only): x power 0..1, y how far out along the feathers the pulse has run (m), z the overdrive, w the resting glow */
  uLight: { value: THREE.Vector4 }
}

/**
 * Each feather card carries its insertion point (`_fbase`, rest model space)
 * and its group and place in the fan (`_fgroup` = group + 0.9 k, +10 on the
 * right wing, −1 for none). Before skinning, the vertex shader swings every
 * feather about its own base by its group's fold/fan angle (WingAnimator) and
 * bends the long ones up under load, so a closing wing lays its flight
 * feathers back along the arm as a bird's does.
 */
const FEATHER_VERTEX = `
attribute vec3 _fbase;
attribute float _fgroup;
uniform float uFeatherA[10];
uniform float uFeatherFan[10];
uniform float uFlex[2];
float featherAngle() {
  if (_fgroup < -0.5) return 0.0;
  bool right = _fgroup >= 9.5;
  float code = right ? _fgroup - 10.0 : _fgroup;
  int g = int(floor(code + 1e-3));
  float k = clamp(fract(code + 1e-4) / 0.9, 0.0, 1.0);
  int gi = g + (right ? 5 : 0);
  return (right ? -1.0 : 1.0) * (uFeatherA[gi] + uFeatherFan[gi] * k);
}
vec3 featherSwing(vec3 v, float a) {
  float c = cos(a), s = sin(a);
  return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}
vec3 featherPose(vec3 p) {
  if (_fgroup < -0.5) return p;
  vec3 d = p - _fbase;
  float flex = uFlex[_fgroup >= 9.5 ? 1 : 0];
  d.y += flex * 0.075 * dot(d.xz, d.xz);
  return _fbase + featherSwing(d, featherAngle());
}`

const injectFeather = (shader: THREE.WebGLProgramParametersWithUniforms, u: FeatherUniforms, normals: boolean): void => {
  Object.assign(shader.uniforms, u)
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${FEATHER_VERTEX}`)
    .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed = featherPose(transformed);")
  if (normals) shader.vertexShader = shader.vertexShader.replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nobjectNormal = featherSwing(objectNormal, featherAngle());")
}

/**
 * Starborn's feathers carry light (celestial only). Moon-silver vanes with a
 * thin-film sheen that turns cyan, violet and rose toward the grazing angle,
 * and light in the shafts: a faint resting glow, and in a dash a pulse that
 * runs out along every feather from its base after each downstroke (the
 * power of the stroke flowing to the tips), cyan near the base and violet
 * out at the long primaries. Distance along the feather is the rest-pose
 * distance from its insertion (`_fbase`), so it is exact on every card; the
 * shaft is the middle of each atlas column (wings.py), the arm's column
 * (the last) has none.
 */
const STARBORN_FEATHER_FRAGMENT = `
float sFacing = clamp(abs(dot(normalize(vNormal), normalize(vViewPosition))), 0.0, 1.0);
float sFilm = 1.0 - sFacing;
vec3 sIri = 0.5 + 0.5 * cos(6.2832 * (vec3(0.0, 0.33, 0.67) + sFilm * 1.2 + 0.52));
totalEmissiveRadiance += diffuseColor.rgb * mix(vec3(1.0), sIri, 0.7) * sFilm * sFilm * (0.16 + 0.3 * uLight.x + 0.2 * uLight.z);
float sCol = vMapUv.x * 8.0;
float sFeather = 1.0 - step(6.99, floor(sCol));
float sShaft = sFeather * smoothstep(0.07, 0.012, abs(fract(sCol) - 0.5 + 0.02));
// the vane's own edge: where the cut-out's alpha falls toward its threshold
float sEdge = sFeather * (1.0 - smoothstep(0.55, 0.95, texture2D(map, vMapUv).a));
float sWave = exp(-(vFeatherD - uLight.y) * (vFeatherD - uLight.y) * 10.0);
vec3 sLight = mix(vec3(0.36, 0.88, 1.0), vec3(0.6, 0.38, 1.0), smoothstep(0.25, 1.3, vFeatherD));
float sPow = uLight.x;
totalEmissiveRadiance += sLight * (
  sShaft * (uLight.w * 0.35 + sPow * (0.8 + 3.2 * sWave) + uLight.z * 0.6)
  + sEdge * sPow * (0.5 + 2.2 * sWave + 0.6 * uLight.z)
  + sFeather * sPow * sWave * 0.35);`

const featherMaterial = (map: THREE.Texture | null, stars: boolean, celestial = false): { mat: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial; u: FeatherUniforms } => {
  const u: FeatherUniforms = { uFeatherA: { value: new Float32Array(10) }, uFeatherFan: { value: new Float32Array(10) }, uFlex: { value: new Float32Array(2) }, uLight: { value: new THREE.Vector4() } }
  // alpha-to-coverage: under MSAA the vanes' edges are smooth, not hatched cut-outs
  const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.66, metalness: 0, alphaToCoverage: true })
  if (stars) {
    mat.emissiveMap = map
    mat.emissive = new THREE.Color(0.32, 0.36, 0.6)
    mat.emissiveIntensity = 0.32
  }
  mat.userData.feather = u
  mat.onBeforeCompile = (shader) => {
    injectFeather(shader, u, true)
    if (celestial) {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying float vFeatherD;")
        .replace("#include <begin_vertex>", "vFeatherD = _fgroup < -0.5 ? 0.0 : length(position - _fbase);\n#include <begin_vertex>")
    }
    // light grazing the vanes along the silhouette: feathers have a soft sheen
    shader.fragmentShader = shader.fragmentShader.replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
float fRim = pow(max(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 0.0), 3.0);
totalEmissiveRadiance += diffuseColor.rgb * fRim * 0.14;${celestial ? STARBORN_FEATHER_FRAGMENT : ""}`)
    if (celestial) shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vFeatherD;\nuniform vec4 uLight;")
  }
  mat.customProgramCacheKey = () => `pegasus-feather-v2${stars ? "-stars" : ""}${celestial ? "-celestial-v1" : ""}`
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5, side: THREE.DoubleSide })
  depth.onBeforeCompile = (shader) => injectFeather(shader, u, false)
  depth.customProgramCacheKey = () => "pegasus-feather-depth-v1"
  return { mat, depth, u }
}

const hornMaterial = (): THREE.MeshPhysicalMaterial => new THREE.MeshPhysicalMaterial({
  color: "#f2ede6", roughness: 0.24, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.15, iridescence: 0.55,
  iridescenceIOR: 1.4, emissive: new THREE.Color("#c4bcff"), emissiveIntensity: 0.12,
})

const sharedMats: Record<string, THREE.MeshStandardMaterial> = {}
const shared = (name: string, make: () => THREE.MeshStandardMaterial): THREE.MeshStandardMaterial =>
  (sharedMats[name] ??= make())

const PAD_COLORS = ["#2d3e5c", "#6b2430", "#e9e0cf", "#2f4a39", "#3b3633", "#7a5a2a"]

// ---------------------------------------------------------------- instances

export type HorseModel = {
  root: THREE.Group
  disposed: boolean
  materialByName: Map<string, THREE.Material>
  meta: HorseMeta
  bones: Map<string, THREE.Bone>
  coat: THREE.MeshStandardMaterial
  hair: THREE.MeshStandardMaterial
  /** LOD0 and LOD1 mesh sets on one skeleton */
  lod: [THREE.Object3D[], THREE.Object3D[]]
  level: 0 | 1
  tack: THREE.Object3D[]
  materials: THREE.Material[]
  /** winged builds */
  feathers: THREE.MeshStandardMaterial | null
  featherDepth: THREE.MeshDepthMaterial | null
  featherUniforms: FeatherUniforms | null
}

const isTack = (name: string): boolean => name.startsWith("tack_")

/**
 * A new horse. Resolves null if the breed's model cannot load (the caller
 * keeps the horse simulated but invisible, so a failed download never breaks
 * riding or the world).
 */
export const makeHorseModel = async (h: HorseIdentity): Promise<HorseModel | null> => {
  const t = await loadTemplate(h.breed, 0)
  if (!t) return null
  const scene = cloneSkinned(t.scene) as THREE.Group
  const root = new THREE.Group()
  root.name = `horse-${h.name}`
  root.add(scene)
  const bones = new Map<string, THREE.Bone>()
  let normalMap: THREE.Texture | null = null
  let featherMap: THREE.Texture | null = null
  scene.traverse((o) => {
    const b = o as THREE.Bone
    if (b.isBone) bones.set(b.name, b)
    const m = o as THREE.Mesh
    if (m.isMesh) {
      const mat = m.material as THREE.MeshStandardMaterial
      if (mat.normalMap && !normalMap) normalMap = mat.normalMap
      if (mat.name.startsWith("Feathers") && mat.map) featherMap = mat.map
    }
  })
  const coat = coatMaterial(h, t.meta, normalMap)
  const feather = t.meta.wing ? featherMaterial(featherMap, (h.coat.stars ?? 0) > 0, h.breed === "starborn") : null
  const horn = t.meta.wing ? shared("horn", hornMaterial) : null
  const hair = hairMaterial(h)
  const pad = shared(`pad${h.seed % PAD_COLORS.length}`, () => new THREE.MeshStandardMaterial({ color: PAD_COLORS[h.seed % PAD_COLORS.length], roughness: 0.92 }))
  const leather = shared("leather", () => new THREE.MeshStandardMaterial({ color: "#4a2a17", roughness: 0.55, metalness: 0 }))
  const metal = shared("metal", () => new THREE.MeshStandardMaterial({ color: "#b8b4ad", roughness: 0.32, metalness: 1 }))
  const eye = shared("eye", () => new THREE.MeshStandardMaterial({ color: "#1c120c", roughness: 0.06, metalness: 0 }))
  const lod0: THREE.Object3D[] = []
  const tack: THREE.Object3D[] = []
  const meshes: THREE.SkinnedMesh[] = []
  const materialByName = new Map<string, THREE.Material>()
  scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh
    if (!m.isMesh) return
    const matName = (m.material as THREE.Material).name
    m.material = matName.startsWith("HorseHair") ? hair : matName.startsWith("HorseEye") ? eye : matName.startsWith("TackCloth") ? pad
      : matName.startsWith("TackLeather") ? leather : matName.startsWith("TackMetal") ? metal
        : matName.startsWith("Feathers") && feather ? feather.mat : matName.startsWith("HornPearl") && horn ? horn : coat
    materialByName.set(matName, m.material)
    if (feather && m.material === feather.mat) m.customDepthMaterial = feather.depth
    // only the body, hair and wings cast shadows: tack and eyes add draw calls, not shape
    m.castShadow = m.material === coat || m.material === hair || (!!feather && m.material === feather.mat)
    m.receiveShadow = true
    m.frustumCulled = true
    if (m.isSkinnedMesh) {
      m.computeBoundingSphere()
      m.boundingSphere!.radius = m.boundingSphere!.radius * 1.4 + 0.4
      meshes.push(m)
    }
    lod0.push(m)
    if (isTack(m.name) || isTack(m.parent?.name ?? "")) tack.push(m)
  })
  for (const tk of tack) tk.visible = h.saddled
  const model: HorseModel = {
    root, disposed: false, materialByName, meta: t.meta, bones, coat, hair, lod: [lod0, []], level: 0, tack, materials: feather ? [coat, hair, feather.mat, feather.depth] : [coat, hair],
    feathers: feather?.mat ?? null, featherDepth: feather?.depth ?? null, featherUniforms: feather?.u ?? null,
  }
  void attachLod1(model, h, meshes[0]?.skeleton ?? null)
  return model
}

/** Bind the breed's far meshes to this horse's own skeleton. */
const attachLod1 = async (model: HorseModel, h: HorseIdentity, skeleton: THREE.Skeleton | null): Promise<void> => {
  if (!skeleton) return
  const t = await loadTemplate(h.breed, 1)
  if (!t || model.disposed) return
  t.scene.traverse((o) => {
    const src = o as THREE.SkinnedMesh
    if (!src.isSkinnedMesh) return
    const matName = (src.material as THREE.Material).name
    if (isTack(src.name) && !h.saddled) return
    const bones = src.skeleton.bones.map((b) => model.bones.get(b.name)!)
    if (bones.some((b) => !b)) return
    const feathered = matName.startsWith("Feathers") && model.feathers
    const material = model.materialByName.get(matName) ?? model.coat
    const mesh = new THREE.SkinnedMesh(src.geometry, material)
    if (feathered) mesh.customDepthMaterial = model.featherDepth!
    mesh.name = `${src.name}-lod1`
    mesh.bind(new THREE.Skeleton(bones, src.skeleton.boneInverses), src.bindMatrix)
    mesh.castShadow = false
    mesh.receiveShadow = true
    mesh.computeBoundingSphere()
    mesh.boundingSphere!.radius = mesh.boundingSphere!.radius * 1.4 + 0.4
    mesh.userData.tackOn = h.saddled
    mesh.visible = model.level === 1 && (!isTack(src.name) || h.saddled)
    // under the clone's scene root so it shares the rig's transform
    model.bones.get("root")!.parent!.add(mesh)
    model.lod[1].push(mesh)
  })
}

/** Switch mesh sets with hysteresis; returns the level in use. */
export const setHorseLod = (m: HorseModel, distance: number): 0 | 1 => {
  const want: 0 | 1 = m.level === 0 ? (distance > 38 ? 1 : 0) : distance < 32 ? 0 : 1
  if (want !== m.level && (want === 0 || m.lod[1].length > 0)) {
    m.level = want
    for (const o of m.lod[0]) o.visible = want === 0 && (!m.tack.includes(o) || o.userData.tackOn !== false)
    for (const o of m.lod[1]) o.visible = want === 1 && (!o.name.startsWith("tack_") || o.userData.tackOn !== false)
  }
  return m.level
}

export const setTackVisible = (m: HorseModel, on: boolean): void => {
  for (const o of m.tack) {
    o.userData.tackOn = on
    o.visible = on && m.level === 0
  }
  for (const o of m.lod[1]) if (o.name.startsWith("tack_")) { o.userData.tackOn = on; o.visible = on && m.level === 1 }
}

export const disposeHorseModel = (m: HorseModel): void => {
  if (m.disposed) return
  m.disposed = true
  disposeFadeable(m.root)
  m.root.removeFromParent()
  const skeletons = new Set<THREE.Skeleton>()
  m.root.traverse((o) => { const s = o as THREE.SkinnedMesh; if (s.isSkinnedMesh) skeletons.add(s.skeleton) })
  for (const s of skeletons) s.dispose()
  for (const mat of m.materials) mat.dispose()
}
