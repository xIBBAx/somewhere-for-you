import * as THREE from "three"
import { LIGHT_BLENDING } from "../render/lightBlending"

/**
 * Lumen: the light every small moment gives off.
 *
 * One GPU particle system for the whole world. Each particle is written once,
 * when it is born (position, velocity, colour, size, drag, gravity, shape,
 * turbulence), into a ring of instanced attributes; the vertex shader flies
 * it analytically from then on (drag-damped ballistic motion, layered
 * turbulence, velocity-aligned streaks), so a thousand sparks cost the CPU
 * nothing per frame and never stutter with the frame rate.
 *
 * Shapes are drawn in the fragment shader, not sprites: a glow with a halo,
 * a four-point glint with diffraction spikes, a motion-blurred streak, a
 * shock ring (billboard or lying in a plane), a cooling ember that shifts
 * from white heat to red, and sunlit pollen. Light is added (LIGHT_BLENDING,
 * alpha 0) and skips tone mapping so it stays vivid on every preset.
 */

export const Shape = { Glow: 0, Glint: 1, Streak: 2, Ring: 3, Ember: 4, Mote: 5 } as const
export type Shape = (typeof Shape)[keyof typeof Shape]

export const vfxClock = { t: 0 }

const CAPACITY = 8192

type Ring = {
  start: Float32Array
  vel: Float32Array
  color: Float32Array
  shape: Float32Array
  motion: Float32Array
  axis: Float32Array
  next: number
  /** lowest/highest slots written since the last upload */
  dirtyFrom: number
  dirtyTo: number
  geometry: THREE.InstancedBufferGeometry | null
}

const ring: Ring = {
  start: new Float32Array(CAPACITY * 4),
  vel: new Float32Array(CAPACITY * 4),
  color: new Float32Array(CAPACITY * 4),
  shape: new Float32Array(CAPACITY * 4),
  motion: new Float32Array(CAPACITY * 4),
  axis: new Float32Array(CAPACITY * 3),
  next: 0,
  dirtyFrom: Infinity,
  dirtyTo: -1,
  geometry: null,
}

/** how many particles each burst really spawns (the quality preset sets it) */
export const lumenBudget = { scale: 1 }

export type ParticleSpec = {
  x: number
  y: number
  z: number
  vx?: number
  vy?: number
  vz?: number
  life: number
  /** linear RGB */
  color: THREE.Color
  intensity?: number
  size: number
  drag?: number
  /** m/s² downward (negative rises) */
  gravity?: number
  shape: Shape
  /** turbulence (m/s-ish) */
  curl?: number
  /** radians per second (glints and rings) */
  spin?: number
  /** seconds of motion blur along the velocity (streaks) */
  stretch?: number
  /** delay before it appears (seconds) */
  delay?: number
  /** a ring lies in the plane with this normal (else it faces the camera) */
  axis?: THREE.Vector3 | null
  /** ring: how much it grows over its life (multiplies size) */
  grow?: number
}

/** Spawn one particle. Safe to call from anywhere, at any rate. */
export const emit = (p: ParticleSpec): void => {
  const i = ring.next
  ring.next = (ring.next + 1) % CAPACITY
  const k = i * 4
  ring.start[k] = p.x
  ring.start[k + 1] = p.y
  ring.start[k + 2] = p.z
  ring.start[k + 3] = vfxClock.t + (p.delay ?? 0)
  ring.vel[k] = p.vx ?? 0
  ring.vel[k + 1] = p.vy ?? 0
  ring.vel[k + 2] = p.vz ?? 0
  ring.vel[k + 3] = p.life
  ring.color[k] = p.color.r
  ring.color[k + 1] = p.color.g
  ring.color[k + 2] = p.color.b
  ring.color[k + 3] = p.intensity ?? 1
  ring.shape[k] = p.size
  ring.shape[k + 1] = p.drag ?? 1.2
  ring.shape[k + 2] = p.gravity ?? 0
  ring.shape[k + 3] = p.shape
  ring.motion[k] = p.curl ?? 0
  ring.motion[k + 1] = p.spin ?? 0
  ring.motion[k + 2] = p.stretch ?? 0
  ring.motion[k + 3] = p.grow ?? 1
  const a = i * 3
  if (p.axis) {
    ring.axis[a] = p.axis.x
    ring.axis[a + 1] = p.axis.y
    ring.axis[a + 2] = p.axis.z
  } else {
    ring.axis[a] = ring.axis[a + 1] = ring.axis[a + 2] = 0
  }
  if (i < ring.dirtyFrom) ring.dirtyFrom = i
  if (i > ring.dirtyTo) ring.dirtyTo = i
}

/** Upload only the slots written this frame (called by the Lumen component). */
export const flushLumen = (): void => {
  const g = ring.geometry
  if (!g || ring.dirtyTo < 0) return
  const from = ring.dirtyFrom
  const count = ring.dirtyTo - from + 1
  for (const [name, size] of [["aStart", 4], ["aVel", 4], ["aColor", 4], ["aShape", 4], ["aMotion", 4], ["aAxis", 3]] as const) {
    const attr = g.getAttribute(name) as THREE.InstancedBufferAttribute
    attr.clearUpdateRanges()
    attr.addUpdateRange(from * size, count * size)
    attr.needsUpdate = true
  }
  ring.dirtyFrom = Infinity
  ring.dirtyTo = -1
}

export const makeLumenGeometry = (): THREE.InstancedBufferGeometry => {
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  g.setIndex([0, 1, 2, 0, 2, 3])
  const add = (name: string, array: Float32Array, size: number): void => {
    const attr = new THREE.InstancedBufferAttribute(array, size)
    attr.setUsage(THREE.DynamicDrawUsage)
    g.setAttribute(name, attr)
  }
  add("aStart", ring.start, 4)
  add("aVel", ring.vel, 4)
  add("aColor", ring.color, 4)
  add("aShape", ring.shape, 4)
  add("aMotion", ring.motion, 4)
  add("aAxis", ring.axis, 3)
  g.instanceCount = CAPACITY
  return g
}

/** The geometry being drawn receives the uploads (mount); returns the release. */
export const attachLumenGeometry = (g: THREE.InstancedBufferGeometry): (() => void) => {
  ring.geometry = g
  // everything written so far goes up with the first draw
  for (const name of ["aStart", "aVel", "aColor", "aShape", "aMotion", "aAxis"]) (g.getAttribute(name) as THREE.InstancedBufferAttribute).needsUpdate = true
  return () => {
    if (ring.geometry === g) ring.geometry = null
    g.dispose()
  }
}

const VERTEX = /* glsl */ `
attribute vec4 aStart;
attribute vec4 aVel;
attribute vec4 aColor;
attribute vec4 aShape;
attribute vec4 aMotion;
attribute vec3 aAxis;
uniform float uTime;
varying vec2 vUv;
varying vec3 vColor;
varying float vKind;
varying float vAge;
varying float vSpin;

void main() {
  float age = uTime - aStart.w;
  float life = aVel.w;
  vUv = position.xy;
  if (life <= 0.0 || age < 0.0 || age > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float u = age / life;
  float drag = max(aShape.y, 0.001);
  float e = exp(-drag * age);
  float travel = (1.0 - e) / drag;
  float g = aShape.z;
  vec3 p = aStart.xyz + aVel.xyz * travel;
  p.y -= g * (age - travel) / drag;
  vec3 vel = aVel.xyz * e;
  vel.y -= g * (1.0 - e) / drag;
  // turbulence: a few incommensurate swirls, growing then settling
  float s = fract(sin(dot(aStart.xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453) * 6.2831;
  vec3 swirl = vec3(sin(age * 1.7 + s) + 0.5 * sin(age * 3.3 + s * 2.0),
                    0.6 * sin(age * 1.3 + s * 3.0),
                    cos(age * 1.9 + s) + 0.5 * cos(age * 2.9 + s * 1.7));
  p += swirl * aMotion.x * min(age, 0.6 + age * 0.35);
  vel += swirl * aMotion.x * 0.6;

  int kind = int(aShape.w + 0.5);
  vKind = aShape.w;
  vAge = u;
  vSpin = aMotion.y * age;
  float size = aShape.x;
  // an ember cools and shrinks; a ring grows; a glint pops in
  if (kind == 3) size *= mix(0.18, 1.0, 1.0 - pow(1.0 - u, 3.0)) * aMotion.w;
  else if (kind == 4) size *= mix(1.0, 0.35, u);
  else if (kind == 1) size *= smoothstep(0.0, 0.12, u) * (1.0 - 0.6 * u);
  else size *= mix(1.0, 0.55, u);

  vec4 wp = modelMatrix * vec4(p, 1.0);
  vec3 toCam = normalize(cameraPosition - wp.xyz);
  vec3 right;
  vec3 up;
  float lenX = size;
  if (kind == 3 && dot(aAxis, aAxis) > 0.01) {
    // a ring lying in its own plane (a shock wave on the ground or round a wing)
    vec3 n = normalize(mat3(modelMatrix) * aAxis);
    right = normalize(abs(n.y) < 0.95 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0)));
    up = cross(n, right);
  } else if (aMotion.z > 0.0 && dot(vel, vel) > 1e-4) {
    // motion blur: the quad stretches along the velocity as seen by the camera
    vec3 v = mat3(modelMatrix) * vel;
    vec3 along = v - toCam * dot(v, toCam);
    float l = length(along);
    right = l > 1e-4 ? along / l : vec3(1.0, 0.0, 0.0);
    up = normalize(cross(toCam, right));
    lenX = size + l * aMotion.z;
  } else {
    right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  }
  vec3 corner = wp.xyz + right * position.x * lenX + up * position.y * size;
  vColor = aColor.rgb * aColor.a;
  // fade by life (rings and glints have their own envelopes in the fragment)
  float fade = smoothstep(0.0, 0.06, u) * (1.0 - smoothstep(0.55, 1.0, u));
  vColor *= fade;
  gl_Position = projectionMatrix * viewMatrix * vec4(corner, 1.0);
}
`

const FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vKind;
varying float vAge;
varying float vSpin;

void main() {
  int kind = int(vKind + 0.5);
  vec2 q = vUv;
  float d2 = dot(q, q);
  float a = 0.0;
  vec3 col = vColor;
  if (kind == 0) {
    // glow: a bright core and a soft halo
    a = exp(-d2 * 9.0) + 0.28 * exp(-d2 * 2.2);
  } else if (kind == 1) {
    // glint: a hot point with four thin diffraction spikes, slowly turning
    float c = cos(vSpin), s = sin(vSpin);
    vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    float spikes = exp(-abs(r.x) * 46.0) * exp(-r.y * r.y * 2.4) + exp(-abs(r.y) * 46.0) * exp(-r.x * r.x * 2.4);
    float diag = exp(-abs(r.x + r.y) * 60.0) * exp(-d2 * 6.0) + exp(-abs(r.x - r.y) * 60.0) * exp(-d2 * 6.0);
    a = exp(-d2 * 40.0) * 1.4 + spikes * 0.9 + diag * 0.25;
    col *= 0.7 + 0.3 * sin(vSpin * 3.7 + vAge * 20.0);
  } else if (kind == 2) {
    // streak: a motion-blurred spark, brightest at its head
    float across = exp(-q.y * q.y * 10.0);
    float along = smoothstep(1.0, 0.55, abs(q.x)) * mix(0.45, 1.0, smoothstep(-1.0, 1.0, q.x));
    a = across * along;
  } else if (kind == 3) {
    // shock ring: thin, thinning as it grows, fading out
    float r = sqrt(d2);
    float w = mix(0.07, 0.022, vAge);
    float fadeR = (1.0 - vAge) * (1.0 - vAge);
    // squares written out: pow() of a negative base is undefined (NaN on some GPUs)
    float ra = (r - 0.88) / w;
    float rb = (r - 0.82) / (w * 2.5);
    a = exp(-ra * ra) * fadeR * 1.5 + exp(-rb * rb) * 0.1 * fadeR;
  } else if (kind == 4) {
    // ember: white heat cooling to gold, orange and a dull red, flickering
    a = exp(-d2 * 12.0) * 1.2 + 0.2 * exp(-d2 * 3.0);
    vec3 heat = mix(vec3(1.0, 0.95, 0.85), vec3(1.0, 0.62, 0.18), smoothstep(0.0, 0.35, vAge));
    heat = mix(heat, vec3(0.75, 0.16, 0.05), smoothstep(0.35, 1.0, vAge));
    col = heat * max(max(vColor.r, vColor.g), vColor.b) * (0.75 + 0.25 * sin(vSpin * 9.0 + vAge * 31.0));
  } else {
    // mote: a tiny sunlit speck of pollen or dust
    a = exp(-d2 * 14.0);
  }
  // nothing reaches the quad's edge: no square halos round bright light
  if (kind != 2) a *= 1.0 - smoothstep(0.72, 1.0, sqrt(d2));
  if (a < 0.003) discard;
  gl_FragColor = vec4(col * a, 0.0);
}
`

export const makeLumenMaterial = (): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    name: "lumen",
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    ...LIGHT_BLENDING,
  })

/** Seeded-free helpers shared by the signatures. */
export const rand = (a: number, b: number): number => a + Math.random() * (b - a)

const _dir = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _z = new THREE.Vector3(0, 0, 1)
/** a random direction in a cone round `axis` (unit; half-angle in radians) */
export const coneDirection = (axis: THREE.Vector3, half: number, out: THREE.Vector3): THREE.Vector3 => {
  const z = 1 - Math.random() * (1 - Math.cos(half))
  const phi = Math.random() * Math.PI * 2
  const r = Math.sqrt(Math.max(0, 1 - z * z))
  _dir.set(r * Math.cos(phi), r * Math.sin(phi), z)
  // rotate +z onto the axis
  _q.setFromUnitVectors(_z, axis)
  return out.copy(_dir).applyQuaternion(_q)
}
