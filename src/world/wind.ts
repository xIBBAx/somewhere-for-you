import * as THREE from "three"
import { weatherRT } from "../game/weather/weatherState"
import { ORIGIN_GRID } from "./worldConfig"

/**
 * One coherent wind for the whole world.
 *
 * The weather system provides direction, steady strength and gusts; this
 * module turns them into shared shader uniforms plus CPU helpers, so grass,
 * flowers, leaves, trees, rain, particles and clouds all move in the same air.
 *
 * Spatial variation comes from a 1024 m-periodic gust field that is scrolled
 * downwind, so visible waves roll across meadows instead of every blade
 * swinging in unison.
 */
export const windRT = {
  /** unit vector the wind blows toward (x, z) */
  dirX: 1,
  dirZ: 0,
  /** steady strength 0..1.4 */
  strength: 0.2,
  /** gust envelope 0..1 */
  gust: 0,
  /** world-space scroll of the gust field (wrapped to 1024 m) */
  scrollX: 0,
  scrollZ: 0,
  time: 0,
  /** integrated sway phase (radians, wrapped): its rate follows the wind, but
   * a change of strength never jumps every blade to a new phase */
  sway: 0,
  flutterA: 0,
  flutterB: 0,
}

export const windUniforms = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(1, 0) },
  uWindStrength: { value: 0.2 },
  uGust: { value: 0 },
  uWindScroll: { value: new THREE.Vector2() },
  /** x = sway, y/z = two flutter phases; all integrated on the CPU */
  uWindPhase: { value: new THREE.Vector3() },
}

const wrap = (v: number): number => ((v % ORIGIN_GRID) + ORIGIN_GRID) % ORIGIN_GRID
const TAU = Math.PI * 2
/** Advance a phase by rate·dt and keep it small, so float32 never loses it. */
export const advancePhase = (phase: number, rate: number, dt: number): number => (phase + rate * dt) % TAU

export const updateWind = (dt: number): void => {
  // weather direction is "blowing from"; convert to "blowing toward"
  const toward = weatherRT.windDirectionRad + Math.PI
  const tx = Math.sin(toward)
  const tz = Math.cos(toward)
  const k = 1 - Math.exp(-0.8 * dt)
  windRT.dirX += (tx - windRT.dirX) * k
  windRT.dirZ += (tz - windRT.dirZ) * k
  const len = Math.hypot(windRT.dirX, windRT.dirZ) || 1
  windRT.dirX /= len
  windRT.dirZ /= len
  // calm days still breathe a little
  windRT.strength = 0.16 + weatherRT.wind * 1.15 + weatherRT.rain * 0.25
  windRT.gust = weatherRT.gust
  const scrollSpeed = 2.2 + windRT.strength * 6
  windRT.scrollX = wrap(windRT.scrollX + windRT.dirX * scrollSpeed * dt)
  windRT.scrollZ = wrap(windRT.scrollZ + windRT.dirZ * scrollSpeed * dt)
  windRT.time += dt
  // sin(time · rate(t)) speeds up wildly while the rate changes at a large
  // time; integrating the phase keeps sway smooth through weather changes
  windRT.sway = advancePhase(windRT.sway, 1.6 + windRT.strength * 0.9, dt)
  windRT.flutterA = advancePhase(windRT.flutterA, 6.3 * (0.85 + windRT.strength * 0.25), dt)
  windRT.flutterB = advancePhase(windRT.flutterB, 10.1 * (0.85 + windRT.strength * 0.25), dt)
  windUniforms.uWindPhase.value.set(windRT.sway, windRT.flutterA, windRT.flutterB)
  windUniforms.uTime.value = windRT.time % 3600
  windUniforms.uWindDir.value.set(windRT.dirX, windRT.dirZ)
  windUniforms.uWindStrength.value = windRT.strength
  windUniforms.uGust.value = windRT.gust
  windUniforms.uWindScroll.value.set(windRT.scrollX, windRT.scrollZ)
}

/** Horizontal wind velocity (m/s) for particles, rain and leaves. */
export const windVelocity = (out: { x: number; z: number }): { x: number; z: number } => {
  const s = (windRT.strength + windRT.gust * 0.8) * 4.5
  out.x = windRT.dirX * s
  out.z = windRT.dirZ * s
  return out
}

/**
 * GLSL: `vec2 windBend(vec2 renderXZ, float phase)` → horizontal bend in
 * metres for a fully flexible point. Requires WORLD_NOISE_GLSL.
 */
export const WIND_GLSL = /* glsl */ `
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uGust;
uniform vec2 uWindScroll;
uniform vec3 uWindPhase;
float windGustField(vec2 rp) {
  vec2 p = rp - uWindScroll;
  return wNoise(p, 30.0) * 0.6 + wNoise(p, 95.0) * 0.4;
}
vec2 windBend(vec2 rp, float phase) {
  float g = windGustField(rp);
  float strength = uWindStrength * (0.3 + g * 1.2) + uGust * (0.25 + g * 0.9);
  float sway = sin(uWindPhase.x + phase) * 0.5 + 0.5;
  vec2 perp = vec2(-uWindDir.y, uWindDir.x);
  float flutter = sin(uWindPhase.y + phase * 2.7) * 0.1 + sin(uWindPhase.z + phase * 1.3) * 0.05;
  return uWindDir * strength * (0.45 + sway * 0.55) + perp * flutter * (0.4 + strength);
}
// 0..1: how hard the travelling gust front is pressing here right now
float windSheen(vec2 rp) {
  float g = windGustField(rp);
  return clamp((g - 0.45) * 2.2, 0.0, 1.0) * clamp(uWindStrength * 0.7 + uGust, 0.0, 1.0);
}
`
