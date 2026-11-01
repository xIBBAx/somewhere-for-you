import { siteBlocked } from "./sites/siteLayout"
import { highvaleWeight } from "./highvale/highvaleLayout"
import { highvaleGroundAt, type HighvaleGround } from "./highvale/highvaleGround"
import { highvaleMaps } from "./highvale/highvaleData"
import { B, BIOME_COUNT, WATER_LEVEL, biomeWeights, lakeMask, climateAt, coldHeath } from "./climate"
import { HUB_CENTER, distToPath, hubWeight, inClearing } from "./hubLayout"
import { findsInRect } from "./findPlacement"
import { LANDMARK_RADIUS, landmarksNear, type Landmark } from "./landmarks"
import { clamp01, hash01, makeSimplex, mix, smooth } from "./noise"
import { worldHeight } from "./terrain"
import { CHUNK_SIZE, WORLD_SEED } from "./worldConfig"

/**
 * Pure chunk generation, executed inside a Web Worker (see chunk.worker.ts).
 * Produces everything the renderer needs for one 64 m chunk:
 *  - a full-resolution (1 m) height field with smooth analytic normals
 *  - albedo + detail masks per vertex (biome blend, soil, sand, litter, grass)
 *  - deterministic scatter (trees, bushes, rocks, flowers, plants)
 * Scatter cells are aligned to a global grid, so neighbouring chunks never
 * duplicate or miss objects at their borders.
 */

export const FIELD_RES = 64
export const FIELD_N = FIELD_RES + 1
export const FIELD_STEP = CHUNK_SIZE / FIELD_RES

/** Scatter record layout (Float32Array, stride SCATTER_STRIDE). */
export const SCATTER_STRIDE = 8
// [localX, y, localZ, scale, rotY, kind, variant(0..1), tint(0..1)]

export const K = {
  // trees
  oak: 0,
  linden: 1,
  birch: 2,
  pine: 3,
  gulmohar: 4,
  maple: 5,
  willow: 6,
  glow: 7,
  /** Himalayan cedar (Highvale) */
  cedar: 8,
  // bushes / ground plants
  bush: 10,
  blossomBush: 11,
  fern: 12,
  // rocks
  boulder: 20,
  stones: 21,
  // flowers (variant picks species colour)
  flower: 30,
  // misc plants
  reeds: 40,
  mushrooms: 41,
  lily: 42,
  log: 43,
} as const

export const isTreeKind = (k: number): boolean => k < 10

export type ChunkPayload = {
  cx: number
  cz: number
  heights: Float32Array
  normals: Int8Array
  colors: Uint8Array
  aux: Uint8Array
  minH: number
  maxH: number
  hasWater: boolean
  scatter: Float32Array
  scatterCount: number
  /** Dominant biome index at the chunk centre (for ambience / animal populations). */
  biome: number
  biomeWeights: Float32Array
  genMs: number
}

const nPatch = makeSimplex(WORLD_SEED ^ 0xa11a)
const nTone = makeSimplex(WORLD_SEED ^ 0xb22b)
const nGrove = makeSimplex(WORLD_SEED ^ 0xc33c)
const nFlowers = makeSimplex(WORLD_SEED ^ 0xd44d)
const nTrail = makeSimplex(WORLD_SEED ^ 0x7a11)
const nGlade = makeSimplex(WORLD_SEED ^ 0x9e1d)

/**
 * 0 … 1 openness carved through woodland: meandering deer trails (the zero
 * contour of a slow noise field) and occasional sunny glades. Deterministic
 * from world position, so forests have walkable rhythm instead of a wall.
 */
export const woodlandOpening = (x: number, z: number): number => {
  const trail = 1 - smooth(0.03, 0.17, Math.abs(nTrail(x / 220, z / 220)))
  const glade = smooth(0.4, 0.8, nGlade(x / 90, z / 90))
  return Math.max(trail, glade)
}

// Linear-space ground albedo per biome.
export const PALETTE: Array<[number, number, number]> = [
  [0.155, 0.37, 0.045], // meadow
  [0.19, 0.42, 0.06], // flower meadow
  [0.065, 0.22, 0.04], // forest
  [0.2, 0.37, 0.09], // gulmohar
  [0.38, 0.24, 0.04], // autumn
  [0.07, 0.19, 0.075], // pine
  [0.04, 0.29, 0.15], // glade
  [0.09, 0.36, 0.1], // lakeside
]

const SOIL: [number, number, number] = [0.23, 0.13, 0.06]
const SAND: [number, number, number] = [0.58, 0.45, 0.25]
const MUD: [number, number, number] = [0.16, 0.13, 0.09]
export const ROCK: [number, number, number] = [0.33, 0.32, 0.3]

// Per-biome density tables.
const TREE_DENSITY = [0.035, 0.02, 0.42, 0.24, 0.36, 0.34, 0.3, 0.1]
const BUSH_DENSITY = [0.05, 0.04, 0.22, 0.12, 0.16, 0.1, 0.14, 0.12]
/** How flowery each biome is (meadow, flower meadow, forest, gulmohar, autumn, pine, glade, lakeside). */
export const FLOWER_DENSITY = [0.3, 0.9, 0.06, 0.28, 0.1, 0.05, 0.2, 0.26]
const GRASS_DENSITY = [0.95, 0.55, 0.42, 0.7, 0.6, 0.38, 0.6, 0.9]
const ROCK_DENSITY = [0.04, 0.02, 0.08, 0.04, 0.07, 0.2, 0.1, 0.05]
const LITTER = [0, 0, 2, 1, 2, 3, 0, 0] // 1 petals, 2 leaves, 3 needles

// Tree species by biome: weighted choices [kind, weight]
const TREE_CHOICES: Array<Array<[number, number]>> = [
  [[K.oak, 3], [K.linden, 2], [K.birch, 1]],
  [[K.linden, 2], [K.gulmohar, 1], [K.birch, 1]],
  [[K.oak, 4], [K.linden, 3], [K.birch, 2], [K.pine, 1]],
  [[K.gulmohar, 6], [K.linden, 1]],
  [[K.maple, 6], [K.birch, 2], [K.oak, 1]],
  [[K.pine, 7], [K.birch, 1]],
  [[K.glow, 3], [K.oak, 2], [K.willow, 1]],
  [[K.willow, 4], [K.birch, 2], [K.linden, 1]],
]

const weightsScratch = new Float32Array(BIOME_COUNT)
const mg: HighvaleGround = { r: 0, g: 0, b: 0, grass: 0, soil: 0, sand: 0, needles: 0, wet: 0, forest: 0, laid: 0, riverDist: 0 }
/** Highvale's share of a point (0 elsewhere, or before its maps are in). */
const highvaleAt = (x: number, z: number): number => (highvaleMaps.data ? highvaleWeight(x, z) : 0)
const landmarksScratch: Landmark[] = []

const pickWeighted = (choices: Array<[number, number]>, r: number): number => {
  let total = 0
  for (const c of choices) total += c[1]
  let t = r * total
  for (const c of choices) {
    t -= c[1]
    if (t <= 0) return c[0]
  }
  return choices[choices.length - 1][0]
}

/** Pick a biome index by sampling its weight distribution with r ∈ [0,1). */
const sampleBiome = (w: Float32Array, r: number): number => {
  let t = r
  for (let i = 0; i < BIOME_COUNT; i++) {
    t -= w[i]
    if (t <= 0) return i
  }
  return 0
}

type Clearing = { x: number; z: number; radius: number }
const blocked = (x: number, z: number, clearings: Clearing[], pad: number): boolean => {
  for (const lm of clearings) {
    const r = Math.max(0.3, lm.radius + pad)
    if ((x - lm.x) ** 2 + (z - lm.z) ** 2 < r * r) return true
  }
  return false
}

export const generateChunk = (cx: number, cz: number): ChunkPayload => {
  const t0 = performance.now()
  const ox = cx * CHUNK_SIZE
  const oz = cz * CHUNK_SIZE
  const A = FIELD_N + 2 // apron for normals
  const apron = new Float32Array(A * A)
  for (let j = 0; j < A; j++) {
    for (let i = 0; i < A; i++) {
      apron[j * A + i] = worldHeight(ox + (i - 1) * FIELD_STEP, oz + (j - 1) * FIELD_STEP)
    }
  }
  const N = FIELD_N
  const heights = new Float32Array(N * N)
  const normals = new Int8Array(N * N * 3)
  const colors = new Uint8Array(N * N * 4)
  const aux = new Uint8Array(N * N * 4)
  let minH = Infinity
  let maxH = -Infinity
  let hasWater = false

  landmarksNear(ox, oz, ox + CHUNK_SIZE, oz + CHUNK_SIZE, landmarksScratch)
  const landmarks: Clearing[] = landmarksScratch.map((lm) => ({ x: lm.x, z: lm.z, radius: LANDMARK_RADIUS[lm.kind] }))
  for (const find of findsInRect(ox, oz, ox + CHUNK_SIZE, oz + CHUNK_SIZE, [])) {
    landmarks.push({ x: find.x, z: find.z, radius: 2.5 })
  }

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = (j + 1) * A + (i + 1)
      const h = apron[a]
      const k = j * N + i
      heights[k] = h
      if (h < minH) minH = h
      if (h > maxH) maxH = h
      const dx = (apron[a + 1] - apron[a - 1]) / (2 * FIELD_STEP)
      const dz = (apron[a + A] - apron[a - A]) / (2 * FIELD_STEP)
      const inv = 1 / Math.hypot(dx, 1, dz)
      normals[k * 3] = Math.round(-dx * inv * 127)
      normals[k * 3 + 1] = Math.round(inv * 127)
      normals[k * 3 + 2] = Math.round(-dz * inv * 127)
      const slope = Math.hypot(dx, dz)

      const x = ox + i * FIELD_STEP
      const z = oz + j * FIELD_STEP
      biomeWeights(x, z, weightsScratch)
      let r = 0
      let g = 0
      let b = 0
      let grass = 0
      let litterBest = 0
      let litterW = 0
      for (let q = 0; q < BIOME_COUNT; q++) {
        const w = weightsScratch[q]
        r += PALETTE[q][0] * w
        g += PALETTE[q][1] * w
        b += PALETTE[q][2] * w
        grass += GRASS_DENSITY[q] * w
        if (LITTER[q] && w > litterW) {
          litterW = w
          litterBest = LITTER[q]
        }
      }
      // Cold highlands and northern heath retain a low summer sward of
      // sedges/lichen. This is a continuous habitat within existing biomes.
      const heath = coldHeath(climateAt(x, z))
      r = mix(r, .23, heath * .78)
      g = mix(g, .255, heath * .78)
      b = mix(b, .125, heath * .78)
      grass *= 1 - heath * .55
      // Organic tonal drift: sun-dried and lush patches.
      const tone = nTone(x / 38, z / 38) * 0.6 + nTone(x / 9 + 40, z / 9) * 0.4
      const dry = smooth(0.15, 0.8, tone)
      r *= 1 + dry * 0.22
      g *= 1 + dry * 0.06 - smooth(-0.8, -0.2, tone) * 0.08
      b *= 1 - dry * 0.15

      // Forest floors show soil between plants; steep ground shows soil/rock.
      const forestFloor = weightsScratch[B.forest] + weightsScratch[B.pine] * 0.9 + weightsScratch[B.autumn] * 0.5
      const patch = nPatch(x / 7, z / 7) * 0.5 + 0.5
      let soil = clamp01(forestFloor * smooth(0.35, 0.8, patch) * 0.75 + smooth(0.45, 0.85, slope) * 0.9)
      // the home path stays readable as it fades into the wilds
      const hw = hubWeight(x, z)
      if (hw > 0) soil = Math.max(soil, (1 - smooth(0.75, 2.2, distToPath(x, z))) * 0.9 * hw)
      r = mix(r, SOIL[0], soil)
      g = mix(g, SOIL[1], soil)
      b = mix(b, SOIL[2], soil)
      const rock = smooth(0.7, 1.1, slope)
      r = mix(r, ROCK[0], rock)
      g = mix(g, ROCK[1], rock)
      b = mix(b, ROCK[2], rock)

      // Lake shores: sand beaches fading into mud below the waterline.
      let sand = 0
      let wet = 0
      const lake = lakeMask(x, z)
      if (lake > 0) {
        const above = h - WATER_LEVEL
        sand = (1 - smooth(0.25, 1.1, above)) * smooth(-0.6, 0.05, above)
        wet = 1 - smooth(-0.05, 0.6, above)
        if (h < WATER_LEVEL) hasWater = true
        const under = smooth(0.05, -0.5, above)
        r = mix(mix(r, SAND[0], sand), MUD[0], under)
        g = mix(mix(g, SAND[1], sand), MUD[1], under)
        b = mix(mix(b, SAND[2], sand), MUD[2], under)
      }
      grass *= (1 - soil * 0.85) * (1 - rock) * (1 - sand) * (h > WATER_LEVEL + 0.12 ? 1 : 0)
      grass *= 0.55 + 0.45 * smooth(-0.5, 0.4, nPatch(x / 23 + 11, z / 23 - 3))
      if (blocked(x, z, landmarks, -1.5)) grass *= 0.5
      // authored places carry their own ground
      if (siteBlocked(x, z)) grass = 0

      // Highvale's own ground (world/highvale/highvaleGround.ts), blended at the massif's foot
      const mw = highvaleAt(x, z)
      if (mw > 0) {
        highvaleGroundAt(x, z, h, slope, mg)
        r = mix(r, mg.r, mw); g = mix(g, mg.g, mw); b = mix(b, mg.b, mw)
        grass = mix(grass, mg.grass, mw)
        soil = mix(soil, mg.soil, mw)
        sand = mix(sand, mg.sand, mw)
        if (mg.needles * mw > litterW * (1 - mw)) { litterBest = 3; litterW = mg.needles }
      }
      const c = k * 4
      colors[c] = Math.round(clamp01(r) * 255)
      colors[c + 1] = Math.round(clamp01(g) * 255)
      colors[c + 2] = Math.round(clamp01(b) * 255)
      colors[c + 3] = Math.round(wet * 255)
      aux[c] = Math.round(soil * 255)
      aux[c + 1] = Math.round(sand * 255)
      aux[c + 2] = litterBest * 60 + Math.round(clamp01(litterW) * 59)
      aux[c + 3] = Math.round(clamp01(grass) * 255)
    }
  }

  // --- scatter -------------------------------------------------------------
  const out: number[] = []
  const push = (x: number, y: number, z: number, s: number, rot: number, kind: number, variant: number, tint: number): void => {
    if (siteBlocked(x, z)) return
    out.push(x - ox, y, z - oz, s, rot, kind, variant, tint)
  }
  const heightAt = (x: number, z: number): number => {
    const fx = Math.min(FIELD_RES - 1e-4, Math.max(0, (x - ox) / FIELD_STEP))
    const fz = Math.min(FIELD_RES - 1e-4, Math.max(0, (z - oz) / FIELD_STEP))
    const ix = Math.floor(fx)
    const iz = Math.floor(fz)
    const u = fx - ix
    const v = fz - iz
    const k = iz * N + ix
    // matches the terrain triangle split used by the renderer
    const h00 = heights[k], h10 = heights[k + 1], h01 = heights[k + N], h11 = heights[k + N + 1]
    return u + v <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v)
  }
  const slopeAtField = (x: number, z: number): number => {
    const i = Math.min(N - 1, Math.max(0, Math.round((x - ox) / FIELD_STEP)))
    const j = Math.min(N - 1, Math.max(0, Math.round((z - oz) / FIELD_STEP)))
    const k = (j * N + i) * 3
    const ny = normals[k + 1] / 127
    return Math.sqrt(Math.max(0, 1 - ny * ny)) / Math.max(0.2, ny)
  }

  const homeBlock = (x: number, z: number): number => {
    // fade scatter in only where the authored home vegetation ends
    const d = Math.hypot(x - HUB_CENTER.x, z - HUB_CENTER.z)
    if (d < 40) return 0
    if (inClearing(x, z)) return 0
    return smooth(40, 56, d)
  }

  // Trees + bushes on a 4 m global grid.
  const CELL = 4
  const n = CHUNK_SIZE / CELL
  const gx0 = Math.round(ox / CELL)
  const gz0 = Math.round(oz / CELL)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const gx = gx0 + i
      const gz = gz0 + j
      const x = (gx + 0.12 + hash01(WORLD_SEED ^ 0x11, gx, gz) * 0.76) * CELL
      const z = (gz + 0.12 + hash01(WORLD_SEED ^ 0x12, gx, gz) * 0.76) * CELL
      const home = homeBlock(x, z)
      if (home <= 0) continue
      const h = heightAt(x, z)
      const slope = slopeAtField(x, z)
      const mw = highvaleAt(x, z)
      if (mw > 0 && hash01(WORLD_SEED ^ 0x5a1, gx, gz) < mw) {
        // Highvale: cedar forest where the bake grew it, birch toward the tree
        // line, lone cedars on the meadows; juniper and rhododendron scrub up
        // high, ferns in the damp shade
        highvaleGroundAt(x, z, h, slope, mg)
        if (mg.laid > 0.15 || mg.riverDist < 2.5 || h < WATER_LEVEL + 0.5) continue
        const r1 = hash01(WORLD_SEED ^ 0x14, gx, gz)
        const treeline = smooth(540, 650, h)
        const density = (mg.forest * 0.62 + 0.012) * (1 - smooth(0.85, 1.1, slope))
        if (r1 < density) {
          const birch = treeline * 0.8 > hash01(WORLD_SEED ^ 0x5a2, gx, gz)
          const s = (birch ? 0.75 : 0.85 + mg.forest * 0.45) + hash01(WORLD_SEED ^ 0x16, gx, gz) * 0.5
          push(x, h, z, s * (1 - treeline * 0.25), hash01(WORLD_SEED ^ 0x17, gx, gz) * Math.PI * 2, birch ? K.birch : K.cedar,
            hash01(WORLD_SEED ^ 0x18, gx, gz), hash01(WORLD_SEED ^ 0x19, gx, gz))
          continue
        }
        const r2 = hash01(WORLD_SEED ^ 0x1a, gx, gz)
        const scrub = smooth(540, 640, h) * (1 - smooth(780, 860, h)) * 0.16
        const fern = mg.forest * mg.wet * 0.5
        if (r2 < scrub + fern && slope < 0.9) {
          const kind = r2 < scrub ? K.bush : K.fern
          push(x, h, z, 0.55 + hash01(WORLD_SEED ^ 0x1c, gx, gz) * 0.5, hash01(WORLD_SEED ^ 0x1d, gx, gz) * Math.PI * 2, kind,
            hash01(WORLD_SEED ^ 0x1e, gx, gz), 0.15)
        }
        continue
      }
      biomeWeights(x, z, weightsScratch)
      const biome = sampleBiome(weightsScratch, hash01(WORLD_SEED ^ 0x13, gx, gz))
      const grove = smooth(-0.35, 0.45, nGrove(x / 70, z / 70) * 0.75 + nGrove(x / 19, z / 19) * 0.25)
      let tree = 0
      for (let q = 0; q < BIOME_COUNT; q++) tree += TREE_DENSITY[q] * weightsScratch[q]
      tree *= 0.25 + grove * 1.35
      tree *= 1 - woodlandOpening(x, z) * 0.92
      const heath = coldHeath(climateAt(x, z))
      tree *= 1 - heath * .97
      const waterOk = biome === B.lakeside ? h > WATER_LEVEL + 0.18 : h > WATER_LEVEL + 0.45
      const r1 = hash01(WORLD_SEED ^ 0x14, gx, gz)
      if (waterOk && slope < 0.62 && r1 < tree * home && !blocked(x, z, landmarks, 1.5)) {
        const kind = pickWeighted(TREE_CHOICES[biome], hash01(WORLD_SEED ^ 0x15, gx, gz))
        const s = (0.78 + hash01(WORLD_SEED ^ 0x16, gx, gz) * 0.55 + grove * 0.15) * (1 - heath * .45)
        push(x, h, z, s, hash01(WORLD_SEED ^ 0x17, gx, gz) * Math.PI * 2, kind, hash01(WORLD_SEED ^ 0x18, gx, gz), hash01(WORLD_SEED ^ 0x19, gx, gz))
        continue
      }
      let bush = 0
      for (let q = 0; q < BIOME_COUNT; q++) bush += BUSH_DENSITY[q] * weightsScratch[q]
      bush *= 0.5 + grove
      bush *= 1 - heath * .65
      const r2 = hash01(WORLD_SEED ^ 0x1a, gx, gz)
      if (h > WATER_LEVEL + 0.3 && slope < 0.7 && r2 < bush * home && !blocked(x, z, landmarks, 0.5)) {
        const forestish = weightsScratch[B.forest] + weightsScratch[B.pine] + weightsScratch[B.glade]
        const kind = biome === B.gulmohar || biome === B.flowerMeadow
          ? (hash01(WORLD_SEED ^ 0x1b, gx, gz) < 0.6 ? K.blossomBush : K.bush)
          : hash01(WORLD_SEED ^ 0x1b, gx, gz) < forestish * 0.8 ? K.fern : K.bush
        const s = 0.6 + hash01(WORLD_SEED ^ 0x1c, gx, gz) * 0.6
        push(x, h, z, s, hash01(WORLD_SEED ^ 0x1d, gx, gz) * Math.PI * 2, kind, hash01(WORLD_SEED ^ 0x1e, gx, gz), hash01(WORLD_SEED ^ 0x1f, gx, gz))
      }
    }
  }

  // Rocks, logs and mushrooms on an 8 m grid.
  const RCELL = 8
  const rn = CHUNK_SIZE / RCELL
  for (let j = 0; j < rn; j++) {
    for (let i = 0; i < rn; i++) {
      const gx = Math.round(ox / RCELL) + i
      const gz = Math.round(oz / RCELL) + j
      const x = (gx + 0.1 + hash01(WORLD_SEED ^ 0x21, gx, gz) * 0.8) * RCELL
      const z = (gz + 0.1 + hash01(WORLD_SEED ^ 0x22, gx, gz) * 0.8) * RCELL
      const home = homeBlock(x, z)
      if (home <= 0 || blocked(x, z, landmarks, 1)) continue
      const h = heightAt(x, z)
      const slope = slopeAtField(x, z)
      const mw = highvaleAt(x, z)
      if (mw > 0 && hash01(WORLD_SEED ^ 0x5a3, gx, gz) < mw) {
        // granite boulders: strewn below steep ground and along the river,
        // big rounded ones standing in its bed for the water to break on
        highvaleGroundAt(x, z, h, slope, mg)
        if (mg.laid > 0.2) continue
        const inBed = mg.riverDist < 0
        const rate = 0.05 + smooth(0.5, 1.0, slope) * 0.35 + (mg.riverDist < 14 ? 0.45 : 0) + mg.forest * 0.08
        const r = hash01(WORLD_SEED ^ 0x23, gx, gz)
        if (r < rate * (inBed ? 0.55 : 1)) {
          const big = inBed || hash01(WORLD_SEED ^ 0x24, gx, gz) < 0.5
          const s = inBed ? 1.5 + hash01(WORLD_SEED ^ 0x25, gx, gz) * 1.6
            : big ? 0.8 + hash01(WORLD_SEED ^ 0x25, gx, gz) * 1.5 : 0.5 + hash01(WORLD_SEED ^ 0x25, gx, gz) * 0.4
          // in the channel they stand proud of the ~2 m of water, half bedded
          push(x, inBed ? h + 0.35 * s : h, z, s, hash01(WORLD_SEED ^ 0x26, gx, gz) * Math.PI * 2, big ? K.boulder : K.stones, hash01(WORLD_SEED ^ 0x27, gx, gz), 0.2)
        } else if (mg.forest > 0.3 && slope < 0.5 && r < rate + mg.forest * 0.12) {
          push(x, h, z, 0.9 + hash01(WORLD_SEED ^ 0x2b, gx, gz) * 0.6, hash01(WORLD_SEED ^ 0x2c, gx, gz) * Math.PI * 2, K.log, hash01(WORLD_SEED ^ 0x2d, gx, gz), 0)
        }
        continue
      }
      biomeWeights(x, z, weightsScratch)
      let rock = 0
      for (let q = 0; q < BIOME_COUNT; q++) rock += ROCK_DENSITY[q] * weightsScratch[q]
      rock += smooth(0.3, 0.7, slope) * 0.25
      const r = hash01(WORLD_SEED ^ 0x23, gx, gz)
      if (h > WATER_LEVEL - 0.2 && r < rock * 2.2 * home) {
        const big = hash01(WORLD_SEED ^ 0x24, gx, gz) < 0.45
        push(x, h, z, big ? 0.7 + hash01(WORLD_SEED ^ 0x25, gx, gz) * 1.1 : 0.5 + hash01(WORLD_SEED ^ 0x25, gx, gz) * 0.4,
          hash01(WORLD_SEED ^ 0x26, gx, gz) * Math.PI * 2, big ? K.boulder : K.stones, hash01(WORLD_SEED ^ 0x27, gx, gz), hash01(WORLD_SEED ^ 0x28, gx, gz))
        continue
      }
      const forestish = weightsScratch[B.forest] + weightsScratch[B.glade] + weightsScratch[B.autumn] * 0.6 + weightsScratch[B.pine] * 0.5
      const r2 = hash01(WORLD_SEED ^ 0x29, gx, gz)
      if (h > WATER_LEVEL + 0.4 && slope < 0.4 && r2 < forestish * 0.35 * home) {
        const isLog = hash01(WORLD_SEED ^ 0x2a, gx, gz) < 0.35
        push(x, h, z, 0.8 + hash01(WORLD_SEED ^ 0x2b, gx, gz) * 0.5, hash01(WORLD_SEED ^ 0x2c, gx, gz) * Math.PI * 2,
          isLog ? K.log : K.mushrooms, hash01(WORLD_SEED ^ 0x2d, gx, gz), weightsScratch[B.glade])
      }
    }
  }

  // Flowers on a 1.33 m grid in drifts; reeds and lilies at lake edges.
  const FCELL = CHUNK_SIZE / 48
  for (let j = 0; j < 48; j++) {
    for (let i = 0; i < 48; i++) {
      const gx = Math.round(ox / FCELL) + i
      const gz = Math.round(oz / FCELL) + j
      const x = (gx + hash01(WORLD_SEED ^ 0x31, gx, gz)) * FCELL
      const z = (gz + hash01(WORLD_SEED ^ 0x32, gx, gz)) * FCELL
      const home = homeBlock(x, z)
      if (home <= 0) continue
      const h = heightAt(x, z)
      const lake = lakeMask(x, z)
      if (lake > 0 && h < WATER_LEVEL + 0.35) {
        const r = hash01(WORLD_SEED ^ 0x33, gx, gz)
        if (h > WATER_LEVEL - 0.35 && r < 0.42) {
          push(x, h, z, 0.7 + hash01(WORLD_SEED ^ 0x34, gx, gz) * 0.6, hash01(WORLD_SEED ^ 0x35, gx, gz) * Math.PI * 2, K.reeds, hash01(WORLD_SEED ^ 0x36, gx, gz), 0)
        } else if (h < WATER_LEVEL - 0.6 && h > WATER_LEVEL - 2.2 && r < 0.05) {
          push(x, WATER_LEVEL, z, 0.8 + hash01(WORLD_SEED ^ 0x34, gx, gz) * 0.7, hash01(WORLD_SEED ^ 0x35, gx, gz) * Math.PI * 2, K.lily, hash01(WORLD_SEED ^ 0x36, gx, gz), 0)
        }
        continue
      }
      if (h < WATER_LEVEL + 0.25) continue
      // late autumn in Highvale: the meadows have mostly gone to seed
      if (highvaleAt(x, z) > hash01(WORLD_SEED ^ 0x5a4, gx, gz) * 1.04) continue
      biomeWeights(x, z, weightsScratch)
      let flower = 0
      for (let q = 0; q < BIOME_COUNT; q++) flower += FLOWER_DENSITY[q] * weightsScratch[q]
      const drift = smooth(0.05, 0.55, nFlowers(x / 16, z / 16) * 0.7 + nFlowers(x / 5, z / 5) * 0.3)
      flower *= drift * 1.25
      const r = hash01(WORLD_SEED ^ 0x37, gx, gz)
      if (r < flower * home && slopeAtField(x, z) < 0.6 && !blocked(x, z, landmarks, -2.5)) {
        // species drifts: low-frequency noise picks a colour family per patch
        const species = (nFlowers(x / 31 + 100, z / 31 - 50) * 0.5 + 0.5) * 0.85 + hash01(WORLD_SEED ^ 0x38, gx, gz) * 0.15
        const gulmoharTint = weightsScratch[B.gulmohar]
        push(x, h, z, 1.15 + hash01(WORLD_SEED ^ 0x39, gx, gz) * 0.55, hash01(WORLD_SEED ^ 0x3a, gx, gz) * Math.PI * 2, K.flower, species, gulmoharTint)
      }
    }
  }

  // Centre biome summary.
  const centreWeights = new Float32Array(BIOME_COUNT)
  biomeWeights(ox + CHUNK_SIZE / 2, oz + CHUNK_SIZE / 2, centreWeights)
  let biome = 0
  for (let q = 1; q < BIOME_COUNT; q++) if (centreWeights[q] > centreWeights[biome]) biome = q

  const scatter = new Float32Array(out)
  return {
    cx,
    cz,
    heights,
    normals,
    colors,
    aux,
    minH,
    maxH,
    hasWater,
    scatter,
    scatterCount: out.length / SCATTER_STRIDE,
    biome,
    biomeWeights: centreWeights,
    genMs: performance.now() - t0,
  }
}

/** Transferable buffers for postMessage. */
export const payloadTransfers = (p: ChunkPayload): ArrayBuffer[] => [
  p.heights.buffer as ArrayBuffer,
  p.normals.buffer as ArrayBuffer,
  p.colors.buffer as ArrayBuffer,
  p.aux.buffer as ArrayBuffer,
  p.scatter.buffer as ArrayBuffer,
  p.biomeWeights.buffer as ArrayBuffer,
]
