import * as THREE from "three"
import { vfxClock } from "./lumenCore"

/**
 * Real petals, confetti and leaves: small curved 3D blades lit by the sun
 * and the sky like everything else, tumbling and fluttering as they fall.
 * The same analytic flight as Lumen (written once at birth, flown on the
 * GPU) through a MeshStandardMaterial, so they catch the light, turn dark
 * against the sun and glint when foil confetti faces it.
 */

export const PetalKind = { Rose: 0, Blossom: 1, Confetti: 2, Leaf: 3 } as const
export type PetalKind = (typeof PetalKind)[keyof typeof PetalKind]

const CAPACITY = 2048

const pool = {
  start: new Float32Array(CAPACITY * 4),
  vel: new Float32Array(CAPACITY * 4),
  spin: new Float32Array(CAPACITY * 4),
  tint: new Float32Array(CAPACITY * 4),
  misc: new Float32Array(CAPACITY * 4),
  next: 0,
  from: Infinity,
  to: -1,
  geometry: null as THREE.InstancedBufferGeometry | null,
}

export type PetalSpec = {
  x: number
  y: number
  z: number
  vx?: number
  vy?: number
  vz?: number
  life: number
  color: THREE.Color
  kind: PetalKind
  /** length of the petal (m) */
  size: number
  drag?: number
  gravity?: number
  /** tumbling (rad/s) */
  spin?: number
  /** side-to-side flutter while falling (m) */
  flutter?: number
  delay?: number
}

const _axis = new THREE.Vector3()

export const emitPetal = (p: PetalSpec): void => {
  const i = pool.next
  pool.next = (pool.next + 1) % CAPACITY
  const k = i * 4
  pool.start[k] = p.x
  pool.start[k + 1] = p.y
  pool.start[k + 2] = p.z
  pool.start[k + 3] = vfxClock.t + (p.delay ?? 0)
  pool.vel[k] = p.vx ?? 0
  pool.vel[k + 1] = p.vy ?? 0
  pool.vel[k + 2] = p.vz ?? 0
  pool.vel[k + 3] = p.life
  _axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
  if (_axis.lengthSq() < 1e-4) _axis.set(0, 1, 0)
  _axis.normalize()
  pool.spin[k] = _axis.x
  pool.spin[k + 1] = _axis.y
  pool.spin[k + 2] = _axis.z
  pool.spin[k + 3] = (p.spin ?? 3) * (Math.random() < 0.5 ? -1 : 1)
  pool.tint[k] = p.color.r
  pool.tint[k + 1] = p.color.g
  pool.tint[k + 2] = p.color.b
  pool.tint[k + 3] = p.kind
  pool.misc[k] = p.size
  pool.misc[k + 1] = p.drag ?? 2.2
  pool.misc[k + 2] = p.gravity ?? 1.6
  pool.misc[k + 3] = p.flutter ?? 0.35
  if (i < pool.from) pool.from = i
  if (i > pool.to) pool.to = i
}

export const flushPetals = (): void => {
  const g = pool.geometry
  if (!g || pool.to < 0) return
  const from = pool.from
  const count = pool.to - from + 1
  for (const name of ["aStart", "aVel", "aSpin", "aTint", "aMisc"]) {
    const attr = g.getAttribute(name) as THREE.InstancedBufferAttribute
    attr.clearUpdateRanges()
    attr.addUpdateRange(from * 4, count * 4)
    attr.needsUpdate = true
  }
  pool.from = Infinity
  pool.to = -1
}

/** A blade one metre long (y 0..1), half a metre wide, cupped like a petal. */
export const makePetalGeometry = (): THREE.InstancedBufferGeometry => {
  const base = new THREE.PlaneGeometry(1, 1, 4, 6)
  base.translate(0, 0.5, 0)
  const pos = base.getAttribute("position") as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    // cupped across, curling back a little toward the tip
    pos.setZ(i, x * x * 0.55 - Math.pow(y, 2.2) * 0.12)
    pos.setX(i, x * 0.5)
  }
  base.computeVertexNormals()
  const g = new THREE.InstancedBufferGeometry()
  g.index = base.index
  g.setAttribute("position", base.getAttribute("position"))
  g.setAttribute("normal", base.getAttribute("normal"))
  g.setAttribute("uv", base.getAttribute("uv"))
  const add = (name: string, array: Float32Array): void => {
    const attr = new THREE.InstancedBufferAttribute(array, 4)
    attr.setUsage(THREE.DynamicDrawUsage)
    g.setAttribute(name, attr)
  }
  add("aStart", pool.start)
  add("aVel", pool.vel)
  add("aSpin", pool.spin)
  add("aTint", pool.tint)
  add("aMisc", pool.misc)
  g.instanceCount = CAPACITY
  return g
}

/** The geometry being drawn receives the uploads (mount); returns the release. */
export const attachPetalGeometry = (g: THREE.InstancedBufferGeometry): (() => void) => {
  pool.geometry = g
  for (const name of ["aStart", "aVel", "aSpin", "aTint", "aMisc"]) (g.getAttribute(name) as THREE.InstancedBufferAttribute).needsUpdate = true
  return () => {
    if (pool.geometry === g) pool.geometry = null
    g.dispose()
  }
}

const HEAD = /* glsl */ `
attribute vec4 aStart;
attribute vec4 aVel;
attribute vec4 aSpin;
attribute vec4 aTint;
attribute vec4 aMisc;
uniform float uPetalTime;
varying vec3 vPetalTint;
varying float vPetalKind;
varying vec2 vPetalUv;
vec3 petalP;
vec3 petalAxis;
float petalAngle;
float petalScale;
vec3 petalRotate(vec3 v) {
  float c = cos(petalAngle), s = sin(petalAngle);
  return v * c + cross(petalAxis, v) * s + petalAxis * dot(petalAxis, v) * (1.0 - c);
}
void petalSetup() {
  float age = uPetalTime - aStart.w;
  float life = aVel.w;
  petalScale = 0.0;
  petalP = aStart.xyz;
  petalAxis = vec3(0.0, 1.0, 0.0);
  petalAngle = 0.0;
  if (life <= 0.0 || age < 0.0 || age > life) return;
  float u = age / life;
  float drag = max(aMisc.y, 0.001);
  float e = exp(-drag * age);
  float travel = (1.0 - e) / drag;
  petalP = aStart.xyz + aVel.xyz * travel;
  petalP.y -= aMisc.z * (age - travel) / drag;
  // a falling leaf's side-slip: it swings as it tumbles
  float seed = fract(sin(dot(aStart.xyz, vec3(17.13, 41.7, 9.31))) * 9631.7) * 6.2831;
  float fl = aMisc.w * min(1.0, age * 1.5);
  petalP += vec3(sin(age * 2.3 + seed), 0.0, cos(age * 1.9 + seed * 1.3)) * fl;
  petalAxis = normalize(aSpin.xyz + vec3(0.0, 0.35 * sin(age * 3.1 + seed), 0.0));
  petalAngle = aSpin.w * age + seed;
  // grow in, live, shrink away at the end
  petalScale = aMisc.x * smoothstep(0.0, 0.08, u) * (1.0 - smoothstep(0.82, 1.0, u));
}
`

/** The lit petal material (MeshStandardMaterial, flown on the GPU). */
export const makePetalMaterial = (): THREE.MeshStandardMaterial => {
  const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.55, metalness: 0 })
  m.name = "lumen-petals"
  const time = { value: 0 }
  m.userData.time = time
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPetalTime = time
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${HEAD}`)
      .replace("#include <beginnormal_vertex>", `petalSetup();\nvec3 objectNormal = petalRotate(normal);\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3( tangent.xyz );\n#endif`)
      .replace("#include <begin_vertex>", `vec3 transformed = petalP + petalRotate(position * petalScale);\nvPetalTint = aTint.rgb;\nvPetalKind = aTint.w;\nvPetalUv = uv;`)
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vPetalTint;\nvarying float vPetalKind;\nvarying vec2 vPetalUv;`)
      .replace("#include <color_fragment>", /* glsl */ `#include <color_fragment>
        int petalKind = int(vPetalKind + 0.5);
        vec2 pu = vPetalUv;
        float px = abs(pu.x - 0.5) * 2.0;
        float py = pu.y;
        if (petalKind == 0) {
          // rose: broad and rounded, narrowing to the base
          float w = sin(3.14159 * pow(py, 0.7)) * mix(0.55, 1.0, py);
          if (px > w) discard;
        } else if (petalKind == 1) {
          // blossom: rounded with the little notch at its tip
          float w = sin(3.14159 * pow(py, 0.65));
          if (px > w || (py > 0.86 && px < (py - 0.86) * 1.4)) discard;
        } else if (petalKind == 3) {
          // leaf: long and pointed
          float w = sin(3.14159 * py) * 0.62;
          if (px > w) discard;
        }
        diffuseColor.rgb = vPetalTint * mix(0.82, 1.0, py);`)
      .replace("#include <roughnessmap_fragment>", `float roughnessFactor = int(vPetalKind + 0.5) == 2 ? 0.28 : roughness;`)
      .replace("#include <metalnessmap_fragment>", `float metalnessFactor = int(vPetalKind + 0.5) == 2 ? 0.75 : (int(vPetalKind + 0.5) == 3 ? 0.55 : metalness);`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n// light passing through a thin petal\ntotalEmissiveRadiance += vPetalTint * 0.06;`)
  }
  m.customProgramCacheKey = () => "lumen-petals-v1"
  return m
}
