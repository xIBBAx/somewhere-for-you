import { highvaleLakeMask, highvaleWeight } from "./highvale/highvaleLayout"
import { HUB_CENTER, WATER_Y, hubWeight } from "./hubLayout"
import { fbm, makeSimplex, mix, smooth } from "./noise"
import { WORLD_SEED } from "./worldConfig"
import { siteWeight } from "./sites/siteLayout"

/**
 * Large-scale climate of the endless world: temperature, moisture, rare
 * "magic" regions, hill regions and lake basins, plus the biome weights
 * derived from them. Worker-safe and deterministic.
 */

export const WATER_LEVEL = WATER_Y

export const nWarp = makeSimplex(WORLD_SEED ^ 0x4004)
const nLake = makeSimplex(WORLD_SEED ^ 0x5005)
const nTemp = makeSimplex(WORLD_SEED ^ 0x6006)
const nMoist = makeSimplex(WORLD_SEED ^ 0x7007)
const nMagic = makeSimplex(WORLD_SEED ^ 0x8008)
export const nRegion = makeSimplex(WORLD_SEED ^ 0x9009)

export const BIOMES = [
  "meadow",
  "flowerMeadow",
  "forest",
  "gulmohar",
  "autumn",
  "pine",
  "glade",
  "lakeside",
] as const
export type BiomeId = (typeof BIOMES)[number]
export const BIOME_COUNT = BIOMES.length
export const B = {
  meadow: 0,
  flowerMeadow: 1,
  forest: 2,
  gulmohar: 3,
  autumn: 4,
  pine: 5,
  glade: 6,
  lakeside: 7,
} as const

export type Climate = {
  temperature: number // -1 cold … 1 warm
  moisture: number // -1 dry … 1 lush
  magic: number // 0 … 1, rare enchanted regions
  hills: number // 0 … 1, how hilly the region is
}

/** Summer heath above the treeline and across the coldest open regions.
 * Uses the same continuous climate as wildlife territories and terrain. */
export const coldHeath = (c: Climate): number => Math.max(
  smooth(.43, .66, -c.temperature),
  smooth(.23, .44, -c.temperature) * smooth(.48, .82, c.hills),
)

const climateOut: Climate = { temperature: 0, moisture: 0, magic: 0, hills: 0 }

/** Large-scale climate fields. Scales are hundreds of metres, so biomes change gradually. */
export const climateAt = (x: number, z: number, out: Climate = climateOut): Climate => {
  const d = Math.hypot(x - HUB_CENTER.x, z - HUB_CENTER.z)
  const home = 1 - smooth(60, 260, d) // home keeps a mild, lush spring climate
  out.temperature = mix(fbm(nTemp, x / 1500, z / 1500, 3) * 1.25, 0.25, home * 0.8)
  out.moisture = mix(fbm(nMoist, x / 1200 + 31.7, z / 1200 - 12.3, 3) * 1.25, 0.15, home * 0.8)
  const m = fbm(nMagic, x / 760 - 7.1, z / 760 + 3.3, 2)
  out.magic = smooth(0.4, 0.62, m) * (1 - home)
  out.hills = smooth(-0.2, 0.55, fbm(nRegion, x / 1100 + 5.5, z / 1100 - 9.1, 2)) * smooth(90, 320, d)
  return out
}

/** 0 … 1: how much a location belongs to a lake basin. */
export const lakeMask = (x: number, z: number): number => {
  const d = Math.hypot(x - HUB_CENTER.x, z - HUB_CENTER.z)
  if (d < 70) return 0
  // in Highvale the only standing water is the lake where the river leaves the hills
  const mw = highvaleWeight(x, z)
  if (mw > 0) return Math.max(highvaleLakeMask(x, z), mw < 1 ? wildLake(x, z, d) * (1 - mw) : 0)
  return wildLake(x, z, d)
}

const wildLake = (x: number, z: number, d: number): number => {
  const wx = x + nWarp(x / 160, z / 160) * 38
  const wz = z + nWarp(x / 160 + 17, z / 160 - 9) * 38
  const l = fbm(nLake, wx / 560, wz / 560, 3)
  // real places and the road to them stay dry
  const keepDry = 1 - siteWeight(x, z, 70).w
  return smooth(0.42, 0.6, l) * smooth(70, 130, d) * keepDry
}

/**
 * Biome weights (sum to 1) at a location. Weights are smooth functions of
 * climate, so transitions take tens of metres and never form straight lines.
 */
export const biomeWeights = (x: number, z: number, out: Float32Array): Float32Array => {
  const c = climateAt(x, z)
  const t = c.temperature
  const m = c.moisture
  const k = (dt: number, dm: number, s: number): number => Math.exp(-(dt * dt + dm * dm) / s)
  out[B.meadow] = k(t - 0.15, m - 0.0, 0.16) + 0.08
  out[B.flowerMeadow] = k(t - 0.45, m - 0.25, 0.1)
  out[B.forest] = k(t - 0.05, m - 0.55, 0.12)
  out[B.gulmohar] = k(t - 0.55, m + 0.25, 0.07)
  out[B.autumn] = k(t + 0.35, m + 0.1, 0.09)
  out[B.pine] = k(t + 0.65, m - 0.2, 0.11) + c.hills * 0.35
  out[B.glade] = c.magic * 1.4
  const lake = lakeMask(x, z)
  const shore = smooth(0.0, 0.25, lake) * (1 - smooth(0.55, 0.9, lake))
  out[B.lakeside] = shore * 2.2
  // Sharpen slightly so biomes read clearly in their cores.
  let sum = 0
  for (let i = 0; i < BIOME_COUNT; i++) {
    const v = out[i] * out[i] * out[i]
    out[i] = v
    sum += v
  }
  const hw = hubWeight(x, z)
  for (let i = 0; i < BIOME_COUNT; i++) out[i] = (out[i] / sum) * (1 - hw)
  out[B.meadow] += hw
  return out
}

const weightsScratch = new Float32Array(BIOME_COUNT)
export const dominantBiome = (x: number, z: number): BiomeId => {
  biomeWeights(x, z, weightsScratch)
  let best = 0
  for (let i = 1; i < BIOME_COUNT; i++) if (weightsScratch[i] > weightsScratch[best]) best = i
  return BIOMES[best]
}

