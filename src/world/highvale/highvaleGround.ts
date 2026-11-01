import { makeSimplex } from "../noise"
import { WORLD_SEED } from "../worldConfig"
import { floorH, HIGHVALE_CENTER, riverE, riverWidth } from "./highvaleLayout"
import { bakedHeight, highvaleLaid, highvaleLook, trailAt } from "./highvaleTerrain"
import { HIGHVALE_MEADOW, HIGHVALE_SQUARE, HIGHVALE_TEMPLE } from "./highvale.layout"

/**
 * What Highvale's ground is made of, for the streamed chunks and the far grid.
 *
 * Late autumn: the valley-floor grass has gone gold-green, the
 * cedar forest floor is a dark duff of fallen needles, the high meadows
 * above the trees are tawny, granite and gneiss break out wherever the
 * slope is too steep to hold soil, and the river runs between broad pale
 * shingle bars. Snow lies only on the high peaks (drawn by the terrain
 * shader from height and slope, see terrainMaterial.ts).
 *
 * Colours are linear RGB, like chunkGen's palette.
 */
const nPatch = makeSimplex(WORLD_SEED ^ 0x5e11a)
const nDry = makeSimplex(WORLD_SEED ^ 0x5e22b)

export type HighvaleGround = {
  r: number; g: number; b: number
  /** 0..1 grass cover */
  grass: number
  /** bare soil / trodden path */
  soil: number
  /** shingle and sand */
  sand: number
  /** forest-floor needle litter 0..1 */
  needles: number
  /** gully wetness 0..1 */
  wet: number
  /** cedar forest density 0..1 (from the bake) */
  forest: number
  /** 0..1 how much of this is laid ground (trail, pad) */
  laid: number
  /** distance (m) from the river's water edge, negative in the water */
  riverDist: number
}

const look: [number, number] = [0, 0]
const mixc = (a: number, b: number, t: number): number => a + (b - a) * t
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// late-autumn palette (linear)
const GRASS_LOW: [number, number, number] = [0.15, 0.2, 0.055]
const GRASS_DRY: [number, number, number] = [0.235, 0.205, 0.072]
const ALPINE: [number, number, number] = [0.3, 0.215, 0.09]
const DUFF: [number, number, number] = [0.085, 0.058, 0.032]
const MOSS: [number, number, number] = [0.07, 0.11, 0.035]
const ROCK: [number, number, number] = [0.27, 0.26, 0.245]
const SHINGLE: [number, number, number] = [0.42, 0.405, 0.37]
const PATH: [number, number, number] = [0.25, 0.19, 0.13]
const PAVED: [number, number, number] = [0.3, 0.29, 0.27]
const SNOW: [number, number, number] = [0.78, 0.8, 0.84]
/**
 * Fresh autumn snow: only the high peaks (above about 1,000 m here), not on
 * faces too steep to hold it.
 */
export const snowAt = (e: number, n: number, h: number, slope: number): number =>
  smooth(940, 1060, h + nPatch(e / 180, n / 180) * 60 + nDry(e / 37, n / 37) * 16) * (1 - smooth(0.95, 1.4, slope))

/** Ground at world (x, z) of height h and slope (rise over run). */
export const highvaleGroundAt = (x: number, z: number, h: number, slope: number, out: HighvaleGround): HighvaleGround => {
  const e = x - HIGHVALE_CENTER.x
  const n = HIGHVALE_CENTER.z - z
  highvaleLook(e, n, look)
  // people have cleared the village and its fields, and the meadow is open
  // grass; the temple keeps its grove, with a courtyard
  const village = 1 - smooth(120, 200, Math.hypot(e - HIGHVALE_SQUARE.e, (n - HIGHVALE_SQUARE.n) * 0.8))
  const meadow = 1 - smooth(34, 70, Math.hypot(e - HIGHVALE_MEADOW.e, n - HIGHVALE_MEADOW.n))
  const court = 1 - smooth(16, 24, Math.hypot(e - HIGHVALE_TEMPLE.e, n - HIGHVALE_TEMPLE.n))
  const forest = look[0] * (1 - Math.max(village * 0.92, meadow, court))
  const wet = look[1]
  const above = h - floorH(n)
  // grass: lusher low and in gullies, sun-dried in patches, tawny above the trees
  const dry = smooth(-0.3, 0.6, nDry(e / 60, n / 60) * 0.7 + nDry(e / 14, n / 14) * 0.3) * (1 - wet * 0.6)
  const alpine = smooth(600, 760, h)
  let r = mixc(mixc(GRASS_LOW[0], GRASS_DRY[0], dry), ALPINE[0], alpine)
  let g = mixc(mixc(GRASS_LOW[1], GRASS_DRY[1], dry), ALPINE[1], alpine)
  let b = mixc(mixc(GRASS_LOW[2], GRASS_DRY[2], dry), ALPINE[2], alpine)
  let grass = 0.9 - alpine * 0.3
  // under the cedars: needle duff with moss in the damp
  const under = smooth(0.25, 0.6, forest) * (0.75 + 0.25 * smooth(-0.5, 0.5, nPatch(e / 9, n / 9)))
  r = mixc(r, mixc(DUFF[0], MOSS[0], wet * 0.7), under)
  g = mixc(g, mixc(DUFF[1], MOSS[1], wet * 0.7), under)
  b = mixc(b, mixc(DUFF[2], MOSS[2], wet * 0.7), under)
  grass *= 1 - under * 0.85
  let soil = under * 0.55
  // rock where the slope cannot hold soil, scree below the steepest faces
  const rock = smooth(0.75, 1.15, slope + nPatch(e / 23, n / 23) * 0.12)
  r = mixc(r, ROCK[0], rock); g = mixc(g, ROCK[1], rock); b = mixc(b, ROCK[2], rock)
  grass *= 1 - rock
  // the river's shingle bars and wet banks
  const width = riverWidth(n)
  const riverDist = Math.abs(e - riverE(n)) - width * 0.85
  let sand = 0
  if (riverDist < width * 3 && above < 4) {
    const span = 0.5 + 1.2 * smooth(-0.2, 0.6, Math.sin(n / 260 + 0.7) * 0.6 + Math.sin(n / 97) * 0.4)
    sand = (1 - smooth(width * 0.15, width * span, riverDist + nPatch(e / 11, n / 11) * 3)) * (1 - smooth(1.2, 3, above))
    r = mixc(r, SHINGLE[0], sand); g = mixc(g, SHINGLE[1], sand); b = mixc(b, SHINGLE[2], sand)
    grass *= 1 - sand
  }
  // trails and the levelled ground of the village
  let laid = 0
  const t = trailAt(e, n)
  if (t) {
    const w = 1 - smooth(-0.4, 0.9, t.dist)
    const c = t.paved ? PAVED : PATH
    r = mixc(r, c[0], w); g = mixc(g, c[1], w); b = mixc(b, c[2], w)
    soil = Math.max(soil, w)
    grass *= 1 - w * 0.95
    laid = w
  }
  laid = Math.max(laid, highvaleLaid(e, n) * 0.6)
  const snow = snowAt(e, n, h, slope)
  if (snow > 0) {
    r = mixc(r, SNOW[0], snow); g = mixc(g, SNOW[1], snow); b = mixc(b, SNOW[2], snow)
    grass *= 1 - snow
    sand *= 1 - snow
  }
  out.r = r; out.g = g; out.b = b
  out.grass = Math.max(0, Math.min(1, grass))
  out.soil = Math.min(1, soil)
  out.sand = sand
  out.needles = under
  out.wet = wet
  out.forest = forest
  out.laid = laid
  out.riverDist = riverDist
  return out
}

/** Cedar crowns seen from afar (linear), and birch toward the tree line. */
const CROWN_CEDAR: [number, number, number] = [0.04, 0.068, 0.045]
const CROWN_BIRCH: [number, number, number] = [0.2, 0.17, 0.06]
const far: HighvaleGround = { r: 0, g: 0, b: 0, grass: 0, soil: 0, sand: 0, needles: 0, wet: 0, forest: 0, laid: 0, riverDist: 0 }

/**
 * Highvale as the far grid and the horizon lands see it: ground colour into
 * `out`, returning the canopy share; `crown` gets the crowns' colour and
 * crown[3] the conifer share.
 */
export const highvaleFarLook = (x: number, z: number, h: number, out: [number, number, number], crown?: number[]): number => {
  const e = x - HIGHVALE_CENTER.x
  const n = HIGHVALE_CENTER.z - z
  const hx = (bakedHeight(e + 8, n) ?? h) - (bakedHeight(e - 8, n) ?? h)
  const hz = (bakedHeight(e, n + 8) ?? h) - (bakedHeight(e, n - 8) ?? h)
  const slope = Math.hypot(hx, hz) / 16
  highvaleGroundAt(x, z, h, slope, far)
  // seen from afar, the forest floor is the trees' own colour
  const canopy = far.forest * (1 - snowAt(e, n, h, slope))
  out[0] = mixc(far.r, CROWN_CEDAR[0] * 1.3, canopy * 0.7)
  out[1] = mixc(far.g, CROWN_CEDAR[1] * 1.3, canopy * 0.7)
  out[2] = mixc(far.b, CROWN_CEDAR[2] * 1.3, canopy * 0.7)
  if (crown) {
    const birch = smooth(540, 650, h)
    crown[0] = mixc(CROWN_CEDAR[0], CROWN_BIRCH[0], birch)
    crown[1] = mixc(CROWN_CEDAR[1], CROWN_BIRCH[1], birch)
    crown[2] = mixc(CROWN_CEDAR[2], CROWN_BIRCH[2], birch)
    crown[3] = 1 - birch
  }
  return canopy
}
