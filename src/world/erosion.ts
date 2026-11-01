import { rawWildHeight } from "./baseTerrain"
import { climateAt, lakeMask, WATER_LEVEL } from "./climate"
import { HUB_CENTER } from "./hubLayout"
import { hash3, rng, smooth } from "./noise"
import { WORLD_SEED } from "./worldConfig"

// Small, overlapping drainage regions. Built once, outside frame animation;
// the worker and collision sampler independently obtain identical results.
// Broad drainage belongs to a coarse field: sampling the full detail terrain
// thousands of times per region stalls new territory discovery. These 24 m
// samples retain the underlying terrain detail and only supply its erosion
// offset. The entire bounded cache uses about 1.2 MB per sampler.
const SPAN = 192,
  STEP = 24,
  N = 17,
  MAX_REGIONS = 1024
const cache = new Map<string, Float32Array>()
export const erosionStats = { regions: 0, builds: 0, maxBuildMs: 0 }
const sample = (a: Float32Array, x: number, z: number): number => {
  const ix = Math.min(N - 2, Math.max(0, Math.floor(x))),
    iz = Math.min(N - 2, Math.max(0, Math.floor(z)))
  const u = Math.max(0, Math.min(1, x - ix)),
    v = Math.max(0, Math.min(1, z - iz)),
    i = iz * N + ix
  return a[i] * (1 - u) * (1 - v) + a[i + 1] * u * (1 - v) + a[i + N] * (1 - u) * v + a[i + N + 1] * u * v
}
const cubic = (a: number, b: number, c: number, d: number, t: number): number =>
  b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)))
const surface = (a: Float32Array, x: number, z: number): number => {
  const ix = Math.floor(x),
    iz = Math.floor(z),
    u = x - ix,
    v = z - iz
  const at = (dx: number, dz: number): number =>
    a[Math.max(0, Math.min(N - 1, iz + dz)) * N + Math.max(0, Math.min(N - 1, ix + dx))]
  return cubic(
    ...([-1, 0, 1, 2].map((j) => cubic(at(-1, j), at(0, j), at(1, j), at(2, j), u)) as [
      number,
      number,
      number,
      number,
    ]),
    v,
  )
}
const region = (rx: number, rz: number): Float32Array => {
  const key = `${rx},${rz}`,
    old = cache.get(key)
  if (old) {
    cache.delete(key)
    cache.set(key, old)
    return old
  }
  const start = performance.now(),
    base = new Float32Array(N * N)
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++)
      base[z * N + x] = rawWildHeight(rx * SPAN - SPAN + x * STEP, rz * SPAN - SPAN + z * STEP)
  const h = base.slice(),
    random = rng(hash3(WORLD_SEED ^ 0xe205, rx, rz))
  // Droplets carry finite sediment. They deposit when slowing or climbing,
  // erode downhill, and evaporate. This is an original bounded implementation;
  // no third-party erosion source is included in the game.
  for (let drop = 0; drop < 160; drop++) {
    let x = 2 + random() * (N - 5),
      z = 2 + random() * (N - 5),
      dx = 0,
      dz = 0,
      water = 1,
      sediment = 0,
      speed = 0.2
    for (let life = 0; life < 24 && water > 0.08; life++) {
      const before = sample(h, x, z),
        gx = sample(h, x + 0.5, z) - sample(h, x - 0.5, z),
        gz = sample(h, x, z + 0.5) - sample(h, x, z - 0.5)
      dx = dx * 0.25 - gx * 0.75
      dz = dz * 0.25 - gz * 0.75
      const len = Math.hypot(dx, dz)
      if (len < 0.0001) break
      dx /= len
      dz /= len
      const nx = x + dx,
        nz = z + dz
      if (nx < 1 || nz < 1 || nx > N - 2 || nz > N - 2) break
      const descent = before - sample(h, nx, nz),
        capacity = Math.max(0.015, descent) * speed * water * 4
      let amount: number
      if (descent < 0 || sediment > capacity) {
        amount = Math.min(sediment, descent < 0 ? -descent : (sediment - capacity) * 0.25)
        sediment -= amount
      } else {
        amount = -Math.min((capacity - sediment) * 0.1, Math.max(0, descent) * 0.35, 0.055)
        sediment -= amount
      }
      const ix = Math.round(x),
        iz = Math.round(z)
      // A compact brush avoids single-vertex pits and transfers exactly the
      // removed mass into the droplet before subsequent deposition.
      for (let oz = -1; oz <= 1; oz++)
        for (let ox = -1; ox <= 1; ox++) {
          const weight = ((ox === 0 ? 2 : 1) * (oz === 0 ? 2 : 1)) / 16
          h[(iz + oz) * N + ix + ox] += amount * weight
        }
      speed = Math.sqrt(Math.max(0.015, speed * speed + descent * 0.5))
      water *= 0.955
      x = nx
      z = nz
    }
  }
  for (let i = 0; i < h.length; i++) h[i] = Math.max(-1.1, Math.min(0.45, h[i] - base[i]))
  cache.set(key, h)
  while (cache.size > MAX_REGIONS) cache.delete(cache.keys().next().value!)
  erosionStats.regions = cache.size
  erosionStats.builds++
  erosionStats.maxBuildMs = Math.max(erosionStats.maxBuildMs, performance.now() - start)
  return h
}

/** C1 blend across overlapping regions: never a chunk-edge height jump.
 * Authored home, site terraces and landmark floors keep their existing base. */
export const erodedWildHeight = (x: number, z: number): number => {
  const base = rawWildHeight(x, z),
    distance = Math.hypot(x - HUB_CENTER.x, z - HUB_CENTER.z)
  if (distance < 240 || base < WATER_LEVEL + 0.12) return base
  const climate = climateAt(x, z),
    strength =
      smooth(240, 400, distance) *
      smooth(0.15, 0.7, climate.hills) *
      (1 - lakeMask(x, z) * 0.7) *
      smooth(WATER_LEVEL + 0.12, WATER_LEVEL + 1.6, base)
  if (strength === 0) return base
  const rx = Math.floor(x / SPAN),
    rz = Math.floor(z / SPAN),
    u = x / SPAN - rx,
    v = z / SPAN - rz
  const su = u * u * (3 - 2 * u),
    sv = v * v * (3 - 2 * v)
  let delta = 0
  for (let j = 0; j < 2; j++)
    for (let i = 0; i < 2; i++) {
      const weight = (i ? su : 1 - su) * (j ? sv : 1 - sv)
      if (weight > 0)
        delta +=
          surface(region(rx + i, rz + j), (x - (rx + i) * SPAN + SPAN) / STEP, (z - (rz + j) * SPAN + SPAN) / STEP) *
          weight
    }
  return Math.max(WATER_LEVEL + 0.12, base + delta * strength * 2.5)
}
