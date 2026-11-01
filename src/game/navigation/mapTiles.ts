import { BIOME_COUNT, biomeWeights, climateAt, coldHeath, lakeMask, WATER_LEVEL } from "../../world/climate"
import { PALETTE, ROCK } from "../../world/chunkGen"
import { worldHeight } from "../../world/terrain"
import { highvaleRiverSurfaceAt } from "../../world/highvale/highvaleRiver"
import { POND, RIVER_MAX_X, RIVER_MIN_X, riverCenterZ, riverHalfWidthAt } from "../../world/hubLayout"
import { highvaleMaps } from "../../world/highvale/highvaleData"
import { highvaleWeight } from "../../world/highvale/highvaleLayout"
import { highvaleFarLook } from "../../world/highvale/highvaleGround"
import { PLAYABLE_REACH } from "../travel/safety"
import { rectTouchesHighvale } from "../../world/highvale/highvaleLayout"
import { rawWildHeight } from "../../world/baseTerrain"
import { hubWeight } from "../../world/hubLayout"
import { siteWeight } from "../../world/sites/siteLayout"
import { highvaleHeightAt } from "../../world/highvale/highvaleTerrain"

/**
 * The map's terrain, cut into square tiles on a power-of-two ladder (as every
 * slippy map is), each rendered off the main thread from the very functions
 * the world is built from: worldHeight for relief, the biome palette and
 * Highvale's aerial look (the far terrain's own colours) for the ground,
 * waterSurfaceAt for the lakes and the river, the home pond and creek. Nothing
 * is painted in: a ridge on the map is a ridge in the game.
 *
 * Only what can be reached is charted (the land within reach of home, and
 * Highvale); the land between is drawn, faded, as uncharted country, because
 * no one walks there (game/travel/safety.ts beyondReach).
 *
 * Level L tiles are TILE_M(L) metres on a side and TILE_PX pixels: level 0
 * is a quarter metre a pixel, level 11 a whole valley (128 m a pixel).
 */

export const TILE_PX = 128
export const MAX_LEVEL = 11
export const tileMetres = (level: number): number => 32 * 2 ** level
/** Where home's reach is measured from (as the safety net measures it). */
export const MAP_HOME = { x: 0, z: 22.5 }

/** The ladder rung whose pixels are nearest (not coarser than) `mpp` metres a screen pixel. */
export const levelFor = (mpp: number): number => {
  const l = Math.floor(Math.log2(Math.max(1e-6, mpp) * TILE_PX / 32) + 0.6)
  return Math.min(MAX_LEVEL, Math.max(0, l))
}

export const tileKey = (level: number, tx: number, tz: number): string => `${level}/${tx}/${tz}`

/** Contour interval (m) for a level: fine at home, wide over the mountains. */
export const contourInterval = (level: number): number => [5, 5, 5, 5, 10, 20, 50, 100, 100, 200, 400, 400][Math.min(MAX_LEVEL, level)]

export type TileRequest = { level: number; tx: number; tz: number }
export type TileRaster = TileRequest & { rgba: Uint8ClampedArray; highvale: boolean }

const toSrgb = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const mix = (a: number, b: number, t: number): number => a + (b - a) * t
const WATER_DEEP = [0.17, 0.36, 0.45]
const WATER_SHALLOW = [0.36, 0.6, 0.64]
const RIVER = [0.42, 0.66, 0.69]
const UNCHARTED = [0.47, 0.5, 0.47]

const weights = new Float32Array(BIOME_COUNT)
const look: [number, number, number] = [0, 0, 0]

/** The home pond and creek: authored water (world/hubLayout), not part of waterSurfaceAt's swim contract. */
const homeWater = (x: number, z: number): boolean =>
  Math.hypot(x - POND.x, z - POND.z) < POND.r || (x > RIVER_MIN_X && x < RIVER_MAX_X && Math.abs(z - riverCenterZ(x)) < riverHalfWidthAt(x))

/** Linear ground albedo at (x, z), as the terrain renders it seen from above. */
const groundColour = (x: number, z: number, h: number, slope: number, out: number[]): void => {
  const mw = highvaleMaps.data ? highvaleWeight(x, z) : 0
  if (mw >= 0.999) {
    highvaleFarLook(x, z, h, look)
    out[0] = look[0]; out[1] = look[1]; out[2] = look[2]
    return
  }
  biomeWeights(x, z, weights)
  let r = 0, g = 0, b = 0
  for (let q = 0; q < BIOME_COUNT; q++) { r += PALETTE[q][0] * weights[q]; g += PALETTE[q][1] * weights[q]; b += PALETTE[q][2] * weights[q] }
  const heath = coldHeath(climateAt(x, z))
  r = mix(r, 0.23, heath * 0.78); g = mix(g, 0.255, heath * 0.78); b = mix(b, 0.125, heath * 0.78)
  const rock = clamp01((slope - 0.7) / 0.4)
  r = mix(r, ROCK[0], rock); g = mix(g, ROCK[1], rock); b = mix(b, ROCK[2], rock)
  if (mw > 0) {
    highvaleFarLook(x, z, h, look)
    r = mix(r, look[0], mw); g = mix(g, look[1], mw); b = mix(b, look[2], mw)
  }
  out[0] = r; out[1] = g; out[2] = b
}

/** Whether a whole tile lies in uncharted country (beyond home's reach and clear of Highvale). */
export const tileUncharted = (x0: number, z0: number, size: number): boolean => {
  const nx = Math.max(x0, Math.min(MAP_HOME.x, x0 + size)), nz = Math.max(z0, Math.min(MAP_HOME.z, z0 + size))
  return Math.hypot(nx - MAP_HOME.x, nz - MAP_HOME.z) > PLAYABLE_REACH + 50 && !rectTouchesHighvale(x0, z0, x0 + size, z0 + size)
}

/**
 * Height for a map pixel `step` metres wide. Home, authored sites and Highvale are
 * always exact (worldHeight). Out in the wilds, once a pixel is wider than the
 * erosion pass's own 24 m grain, its drainage detail is below the pixel and
 * costs a 192 m region build per sample (world/erosion.ts): the base terrain
 * it is carved from stands in, which is what the eye sees at that scale.
 */
export const mapHeight = (x: number, z: number, step: number): number => {
  if (step < 24) return worldHeight(x, z)
  const mw = highvaleWeight(x, z)
  if (mw >= 0.999 || hubWeight(x, z) > 0.001 || siteWeight(x, z).w > 0.001) return worldHeight(x, z)
  const raw = rawWildHeight(x, z)
  if (mw > 0) {
    const mh = highvaleHeightAt(x, z)
    if (mh !== null) return mix(raw, mh, mw)
  }
  return raw
}

/** The open water over a pixel of height h: waterSurfaceAt's own rule (The river, then the lakes), without measuring the ground again. */
const mapWater = (x: number, z: number, h: number): number | null => {
  if (highvaleWeight(x, z) > 0) {
    const river = highvaleRiverSurfaceAt(x, z)
    if (river !== null) return river > h ? river : null
  }
  return lakeMask(x, z) > 0 && h < WATER_LEVEL ? WATER_LEVEL : null
}

/** Shade one map pixel from its height and gradient (sRGB 0..1 into out). */
const shadePixel = (x: number, z: number, h: number, dx: number, dz: number, level: number, hx: number, hz: number, out: number[]): void => {
  const slope = Math.hypot(dx, dz)
  const surface = mapWater(x, z, h)
  const wet = surface !== null
  let r: number, g: number, b: number
  if (wet || homeWater(x, z)) {
    const depth = wet ? surface! - h : 0.6
    const flowing = wet && highvaleWeight(x, z) > 0 && surface! > 0.5
    const c = flowing ? RIVER : WATER_SHALLOW
    const d = clamp01(depth / (flowing ? 3 : 6))
    r = mix(c[0], WATER_DEEP[0], d); g = mix(c[1], WATER_DEEP[1], d); b = mix(c[2], WATER_DEEP[2], d)
  } else {
    groundColour(x, z, h, slope, out)
    // a map lifts the ground's dark albedo into the range the eye reads as colour, and
    // tempers it as the lit, blade-shadowed grass in the game does (pure albedo reads lime)
    r = toSrgb(out[0]) * 1.08; g = toSrgb(out[1]) * 1.08; b = toSrgb(out[2]) * 1.08
    const grey = 0.3 * r + 0.59 * g + 0.11 * b
    r = mix(grey, r, 0.72); g = mix(grey, g, 0.72); b = mix(grey, b, 0.72)
    // hillshade, lit from the north-west (the top left), as maps are
    const shade = clamp01(0.94 + (dx + dz) * 0.38 / Math.sqrt(1 + slope * slope))
    const lift = 0.62 + 0.5 * shade
    r *= lift; g *= lift; b *= lift
    // contours where the height crosses an interval between this pixel and the next
    const interval = contourInterval(level)
    const c0 = Math.floor(h / interval)
    if (c0 !== Math.floor(hx / interval) || c0 !== Math.floor(hz / interval)) {
      const index = Math.abs(Math.floor(Math.max(h, hx, hz) / interval)) % 5 === 0
      const ink = index ? 0.72 : 0.84
      r *= ink; g *= ink; b *= ink * 0.98
    }
  }
  out[0] = r; out[1] = g; out[2] = b
}

/** Uncharted country: a calm, even tone, shaded only by the broad lie of the land. */
const unchartedColour = (dx: number, dz: number, out: number[]): void => {
  const lift = 0.9 + clamp01(0.5 + (dx + dz) * 0.5) * 0.16
  out[0] = UNCHARTED[0] * lift; out[1] = UNCHARTED[1] * lift; out[2] = UNCHARTED[2] * lift
}

/** How charted a point is: 1 within reach of home or in Highvale, easing to 0 over a short margin (the map's soft edge). */
export const chartedAt = (x: number, z: number): number => {
  const home = 1 - (Math.hypot(x - MAP_HOME.x, z - MAP_HOME.z) - PLAYABLE_REACH) / 140
  const mw = highvaleWeight(x, z)
  return clamp01(Math.max(home, mw > 0 ? 0.35 + mw / 0.3 : 0))
}

/** Coarse cells (pixels) used for uncharted country. */
const COARSE = 4

/**
 * Render one tile (worker-safe; Highvale's maps must already be loaded for its
 * colours and heights). Charted land is sampled at every pixel (every second
 * one on the widest rungs); uncharted country, drawn faded, on a 4×4 grid,
 * because the wild terrain far out is costly to evaluate and no one goes there.
 */
export const rasterTile = ({ level, tx, tz }: TileRequest): TileRaster => {
  const size = tileMetres(level)
  const x0 = tx * size, z0 = tz * size
  const base = tileUncharted(x0, z0, size) ? COARSE : 1
  const n = TILE_PX / base, step = size / n
  const rgba = new Uint8ClampedArray(TILE_PX * TILE_PX * 4)
  // the height field, filled lazily (an apron round it for gradients)
  const A = n + 2
  const fine = new Float32Array(A * A).fill(Number.NaN)
  const H = (i: number, j: number): number => {
    const k = j * A + i
    let v = fine[k]
    if (v !== v) { v = mapHeight(x0 + (i - 0.5) * step, z0 + (j - 0.5) * step, step); fine[k] = v }
    return v
  }
  const ratio = Math.max(1, COARSE / base), nc = Math.ceil(n / ratio)
  const coarse = new Float32Array(nc * nc * 3).fill(-1)
  const cstep = step * ratio
  // the broad lie of the land for the uncharted tone: a long baseline, so no small-scale noise
  const span = Math.max(cstep * 2, 260)
  const colour = [0, 0, 0], fog = [0, 0, 0]
  let highvale = false
  const put = (i: number, j: number, c: number[]): void => {
    const R = Math.round(clamp01(c[0]) * 255), G = Math.round(clamp01(c[1]) * 255), Bl = Math.round(clamp01(c[2]) * 255)
    const p = (j * base * TILE_PX + i * base) * 4
    for (let v = 0; v < base; v++) for (let u = 0; u < base; u++) {
      const q = p + (v * TILE_PX + u) * 4
      rgba[q] = R; rgba[q + 1] = G; rgba[q + 2] = Bl; rgba[q + 3] = 255
    }
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + (i + 0.5) * step, z = z0 + (j + 0.5) * step
    if (!highvale && highvaleWeight(x, z) > 0) highvale = true
    const charted = base === COARSE ? 0 : chartedAt(x, z)
    if (charted > 0) {
      const h = H(i + 1, j + 1), hx = H(i + 2, j + 1), hz = H(i + 1, j + 2)
      const dx = (hx - H(i, j + 1)) / (2 * step), dz = (hz - H(i + 1, j)) / (2 * step)
      shadePixel(x, z, h, dx, dz, level, hx, hz, colour)
      if (charted < 1) {
        unchartedColour(dx, dz, fog)
        for (let q = 0; q < 3; q++) colour[q] = mix(fog[q], colour[q], charted * charted * (3 - 2 * charted))
      }
      put(i, j, colour)
      continue
    }
    // uncharted: one sample per coarse cell, shared by its pixels
    const ci = Math.floor(i / ratio), cj = Math.floor(j / ratio), ck = (cj * nc + ci) * 3
    if (coarse[ck] < 0) {
      const cx = x0 + (ci + 0.5) * cstep, cz = z0 + (cj + 0.5) * cstep
      const h = mapHeight(cx, cz, span), hx = mapHeight(cx + span, cz, span), hz = mapHeight(cx, cz + span, span)
      unchartedColour((hx - h) / span, (hz - h) / span, colour)
      coarse[ck] = colour[0]; coarse[ck + 1] = colour[1]; coarse[ck + 2] = colour[2]
    }
    colour[0] = coarse[ck]; colour[1] = coarse[ck + 1]; colour[2] = coarse[ck + 2]
    put(i, j, colour)
  }
  // wide rungs sample the ground tens of metres apart: a light low-pass keeps
  // its fine colour noise from aliasing into speckle
  if (level >= 6 && base === 1) soften(rgba)
  return { level, tx, tz, rgba, highvale }
}

/** A 3×3 binomial blur in place (the tile's own edge pixels are left as they are). */
const soften = (rgba: Uint8ClampedArray): void => {
  const n = TILE_PX, src = rgba.slice()
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    const p = (j * n + i) * 4
    for (let c = 0; c < 3; c++) {
      const o = p + c
      rgba[o] = (src[o] * 4 + (src[o - 4] + src[o + 4] + src[o - n * 4] + src[o + n * 4]) * 2 + src[o - n * 4 - 4] + src[o - n * 4 + 4] + src[o + n * 4 - 4] + src[o + n * 4 + 4]) / 16
    }
  }
}
