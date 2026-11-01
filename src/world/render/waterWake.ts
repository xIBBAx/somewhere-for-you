import * as THREE from "three"
import { originRT } from "../origin"

/**
 * Disturbances a flying Pegasus leaves on lakes, the home pond and creek, fed into the lake
 * shader as uniforms so the surface itself moves: rings of wave where she
 * skimmed (a V-wake once she outruns them), and a churned rotor-wash patch
 * under her wings. Positions are logical (float64) in the ring buffer and are
 * converted to render space (logical − origin) each frame, as every other
 * world effect is, so origin rebases never shift a wake.
 */

/** Bounded GPU cost: live rings are compacted and distant fragments skip the loop. */
export const WAKE_SLOTS = 12
/** how fast a ring of wave travels (m/s): a surface wave of a metre or so; a faster flyer outruns its rings */
export const WAKE_RING_SPEED = 3.5
/** a ring is forgotten once its strength has faded (s) */
export const WAKE_LIFE = 3.2

/** uWake[i] = (x, z render, age s, strength 0..1); uRotor = (x, z render, radius m, strength 0..1) */
export const waterWakeUniforms = {
  uWake: { value: Array.from({ length: WAKE_SLOTS }, () => new THREE.Vector4()) },
  uRotor: { value: new THREE.Vector4() },
  uWakeCount: { value: 0 },
  /** One render-space rectangle rejects all distant water before the ring loop. */
  uWakeBounds: { value: new THREE.Vector4() },
}

/** the clock the wake rings age by (the one updateWaterWake is driven with), for other wake makers such as swimmers */
export const wakeClock = { now: 0 }

const birth = new Float64Array(WAKE_SLOTS)
const logical = new Float64Array(WAKE_SLOTS * 2)
const power = new Float32Array(WAKE_SLOTS)
let next = 0

/** Lay down one ring of wave at a logical point on the lake, `now` in seconds. */
export const emitWaterWake = (x: number, z: number, strength: number, now: number): void => {
  const i = next
  next = (next + 1) % WAKE_SLOTS
  logical[i * 2] = x
  logical[i * 2 + 1] = z
  birth[i] = now
  power[i] = strength
}

/**
 * Write the live rings and the rotor patch into the uniforms (render space).
 * Rotor strength 0 switches the patch off. Call once per frame.
 */
export const updateWaterWake = (now: number, rotor: { x: number; z: number; radius: number; strength: number } | null): void => {
  wakeClock.now = now
  const ox = originRT.x, oz = originRT.z
  let count = 0
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
  for (let i = 0; i < WAKE_SLOTS; i++) {
    const age = now - birth[i]
    if (power[i] <= 0 || age < 0 || age > WAKE_LIFE) { power[i] = 0; continue }
    const x = logical[i * 2] - ox, z = logical[i * 2 + 1] - oz
    waterWakeUniforms.uWake.value[count++].set(x, z, age, power[i])
    const reach = age * WAKE_RING_SPEED + 2.5
    minX = Math.min(minX, x - reach); maxX = Math.max(maxX, x + reach)
    minZ = Math.min(minZ, z - reach); maxZ = Math.max(maxZ, z + reach)
  }
  for (let i = count; i < WAKE_SLOTS; i++) waterWakeUniforms.uWake.value[i].set(0, 0, 0, 0)
  waterWakeUniforms.uWakeCount.value = count
  if (rotor && rotor.strength > 0.01) {
    const x = rotor.x - ox, z = rotor.z - oz
    waterWakeUniforms.uRotor.value.set(x, z, rotor.radius, Math.min(1, rotor.strength))
    minX = Math.min(minX, x - rotor.radius); maxX = Math.max(maxX, x + rotor.radius)
    minZ = Math.min(minZ, z - rotor.radius); maxZ = Math.max(maxZ, z + rotor.radius)
  } else waterWakeUniforms.uRotor.value.set(0, 0, 1, 0)
  if (minX <= maxX) waterWakeUniforms.uWakeBounds.value.set(minX, minZ, maxX, maxZ)
  else waterWakeUniforms.uWakeBounds.value.set(0, 0, 0, 0)
}

/** Forget every ring (the wake ends when she leaves the lake or the air). */
export const clearWaterWake = (): void => {
  power.fill(0)
  next = 0
  waterWakeUniforms.uWakeCount.value = 0
  waterWakeUniforms.uWakeBounds.value.set(0, 0, 0, 0)
  waterWakeUniforms.uRotor.value.set(0, 0, 1, 0)
  for (const v of waterWakeUniforms.uWake.value) v.set(0, 0, 0, 0)
}

/**
 * Water-shader GLSL (include WORLD_NOISE_GLSL first). Returns (slope.x, slope.y, foam, churn) for the render
 * position p. Each ring is a band of wave travelling outward at WAKE_RING_SPEED
 * and fading with age; its slope is the radial derivative of the wave, so it
 * tilts the normals the same way the rain rings do. The rotor patch is turbulent
 * noise drifting under the wash, which also darkens and whitens the water.
 */
export const WATER_WAKE_GLSL = /* glsl */ `
uniform vec4 uWake[${WAKE_SLOTS}];
uniform vec4 uRotor;
uniform int uWakeCount;
uniform vec4 uWakeBounds;
vec4 pegasusWash(vec2 p) {
  if (uWakeCount == 0 && uRotor.w <= 0.0) return vec4(0.0);
  if (p.x < uWakeBounds.x || p.y < uWakeBounds.y || p.x > uWakeBounds.z || p.y > uWakeBounds.w) return vec4(0.0);
  vec2 slope = vec2(0.0);
  float foam = 0.0;
  for (int i = 0; i < ${WAKE_SLOTS}; i++) {
    if (i >= uWakeCount) break;
    vec4 s = uWake[i];
    if (s.w <= 0.0) continue;
    vec2 d = p - s.xy;
    float reach = ${WAKE_RING_SPEED.toFixed(2)} * s.z + 2.5;
    if (abs(d.x) > reach || abs(d.y) > reach) continue;
    float r = length(d);
    float front = r - ${WAKE_RING_SPEED.toFixed(2)} * s.z;
    if (abs(front) > 2.5) continue;
    float band = exp(-front * front * 1.6);
    float amp = s.w * exp(-s.z * 0.9) * band * 0.22;
    float ph = front * 5.2;
    slope += d / max(r, 0.05) * cos(ph) * amp;
    foam += amp * smoothstep(0.6, 1.0, sin(ph)) * 3.0;
  }
  float rr = length(p - uRotor.xy) / max(uRotor.z, 0.1);
  float churn = (1.0 - smoothstep(0.35, 1.0, rr)) * uRotor.w;
  if (churn > 0.001) {
    vec2 q = p + vec2(uTime * 2.3, -uTime * 1.9);
    vec2 n = vec2(wNoise(q, 512.0), wNoise(q + vec2(31.7, 11.3), 512.0)) - 0.5;
    slope += n * churn * 0.9;
    foam += churn * 0.35;
  }
  return vec4(slope, clamp(foam, 0.0, 1.0), churn);
}
`
