import * as THREE from "three"
import { HUB_CENTER } from "./hubLayout"
import { HOME_ORIGIN_RADIUS, ORIGIN_GRID, ORIGIN_REBASE_DISTANCE } from "./worldConfig"

/**
 * Floating origin.
 *
 * Gameplay keeps using *logical* world coordinates (float64 in JS) for
 * everything. All rendered content lives under one `WorldRoot` group whose
 * position is `-origin`, and the camera is parented into that group, so every
 * model-view matrix is computed in float64 on the CPU and stays small before
 * it reaches the GPU's float32 pipeline. Rebasing therefore never moves any
 * logical position and is visually invisible.
 *
 * Shaders that need stable world-space noise use `uOriginWrap`
 * (origin mod 1024 m) together with 1024 m-periodic noise, so patterns are
 * continuous across rebases at any distance from home.
 */
export const originRT = {
  x: 0,
  z: 0,
  /** increments on every rebase */
  version: 0,
}

export const originUniforms = {
  uOrigin: { value: new THREE.Vector3() },
  uOriginWrap: { value: new THREE.Vector2() },
}

const wrap = (v: number): number => ((v % ORIGIN_GRID) + ORIGIN_GRID) % ORIGIN_GRID

const setOrigin = (x: number, z: number): void => {
  originRT.x = x
  originRT.z = z
  originRT.version++
  originUniforms.uOrigin.value.set(x, 0, z)
  originUniforms.uOriginWrap.value.set(wrap(x), wrap(z))
}

/**
 * Keep the render origin near the player. While the player is anywhere near
 * home the origin is exactly zero, so the authored home content (and its
 * shaders, which use absolute coordinates) is never affected.
 */
export const updateOrigin = (px: number, pz: number): boolean => {
  const homeDistance = Math.hypot(px - HUB_CENTER.x, pz - HUB_CENTER.z)
  if (homeDistance < HOME_ORIGIN_RADIUS) {
    if (originRT.x !== 0 || originRT.z !== 0) {
      setOrigin(0, 0)
      return true
    }
    return false
  }
  if (Math.hypot(px - originRT.x, pz - originRT.z) < ORIGIN_REBASE_DISTANCE) return false
  setOrigin(Math.round(px / ORIGIN_GRID) * ORIGIN_GRID, Math.round(pz / ORIGIN_GRID) * ORIGIN_GRID)
  return true
}

/** GLSL helpers for 1024 m-periodic world noise. Requires `uOriginWrap`. */
export const WORLD_NOISE_GLSL = /* glsl */ `
uniform vec2 uOriginWrap;
float wHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// Value noise with an integer lattice period (cycles per 1024 m).
float wNoise(vec2 renderXZ, float cycles) {
  vec2 p = (renderXZ + uOriginWrap) * (cycles / 1024.0);
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = wHash(mod(i, cycles));
  float b = wHash(mod(i + vec2(1.0, 0.0), cycles));
  float c = wHash(mod(i + vec2(0.0, 1.0), cycles));
  float d = wHash(mod(i + vec2(1.0, 1.0), cycles));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// Continuous world coordinate for smooth periodic functions (sin waves).
vec2 wPos(vec2 renderXZ) { return renderXZ + uOriginWrap; }
// Slow drift between sunny yellow-green and cool blue-green meadow patches,
// shared by the ground and the grass blades so they always agree.
vec3 meadowHue(vec2 renderXZ) {
  float h = wNoise(renderXZ, 110.0) * 0.65 + wNoise(renderXZ, 37.0) * 0.35;
  return mix(vec3(0.86, 1.0, 1.1), vec3(1.14, 1.04, 0.68), smoothstep(0.28, 0.72, h));
}
`
