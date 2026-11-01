import { B, BIOME_COUNT, WATER_LEVEL, biomeWeights } from "./climate"
import { hubWeight } from "./hubLayout"
import { hash3 } from "./noise"
import { worldHeight } from "./terrain"
import { WORLD_SEED } from "./worldConfig"
import { highvaleMaps } from "./highvale/highvaleData"
import { highvaleWeight } from "./highvale/highvaleLayout"
import { highvaleFarLook } from "./highvale/highvaleGround"

/**
 * The far landscape: a coarse, world-aligned height and colour grid that
 * carries hills, forests and lakes out to the haze, beyond the streamed
 * chunks. Worker-safe and deterministic, like the chunks themselves.
 *
 * Vertices sit on a fixed FAR_SPACING lattice in world space, and the grid
 * re-centres in FAR_SNAP steps, so a re-centred grid shares every vertex it
 * overlaps with the previous one and distant hills never wobble or pop.
 */
export const FAR_SPACING = 32
/** vertices per side */
export const FAR_VERTS = 57
export const FAR_SNAP = 256
/** half the grid's width, in metres */
export const FAR_HALF = ((FAR_VERTS - 1) / 2) * FAR_SPACING
/** The streamed chunks always cover this radius around the player. */
export const FAR_HOLE = 250
/** Tucked under the streamed terrain wherever both exist. */
export const FAR_DROP = 1.6

export type FarTerrainData = {
  /** world-space centre of the grid (a multiple of FAR_SNAP) */
  cx: number
  cz: number
  heights: Float32Array
  /** linear rgb per vertex */
  colors: Float32Array
  /** x = canopy density 0..1, y = water depth in metres (negative on land:
   * linear across a triangle, its zero is the real shore, not the grid's) */
  kinds: Float32Array
  /** distant crowns, FAR_TREE_STRIDE floats each: x, y, z (relative to the
   * centre), radius, height, conifer (0/1), r, g, b (linear) */
  trees: Float32Array
  treeCount: number
}

export const FAR_TREE_STRIDE = 9
/** Crowns only beyond the streamed trees (chunks reach 255–345 m). */
export const FAR_TREE_START = 290
const MAX_FAR_TREES = 9000

const lin = (hex: number): [number, number, number] => [
  ((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255,
].map(c => Math.pow(c, 2.2)) as [number, number, number]

/** What each biome looks like from a few hundred metres up the valley. */
const BIOME_FAR: Array<{ col: [number, number, number]; canopy: number }> = []
BIOME_FAR[B.meadow] = { col: lin(0x6f9a3e), canopy: 0.12 }
BIOME_FAR[B.flowerMeadow] = { col: lin(0x7f9d46), canopy: 0.08 }
BIOME_FAR[B.forest] = { col: lin(0x426c2f), canopy: 0.95 }
BIOME_FAR[B.gulmohar] = { col: lin(0xb88f78), canopy: 0.7 }
BIOME_FAR[B.autumn] = { col: lin(0x9a6a33), canopy: 0.85 }
BIOME_FAR[B.pine] = { col: lin(0x2f5443), canopy: 0.95 }
BIOME_FAR[B.glade] = { col: lin(0x4c7f42), canopy: 0.7 }
BIOME_FAR[B.lakeside] = { col: lin(0x6b9446), canopy: 0.3 }
const WATER = lin(0x5c8ea6)
/** crown colour and conifer share per biome, as seen through light haze */
const CROWN: Array<{ col: [number, number, number]; conifer: number }> = []
CROWN[B.meadow] = { col: lin(0x4f7a33), conifer: 0.1 }
CROWN[B.flowerMeadow] = { col: lin(0x56823a), conifer: 0.05 }
CROWN[B.forest] = { col: lin(0x3d6a2c), conifer: 0.15 }
CROWN[B.gulmohar] = { col: lin(0xd9653f), conifer: 0 }
CROWN[B.autumn] = { col: lin(0xb0662a), conifer: 0.1 }
CROWN[B.pine] = { col: lin(0x2d5242), conifer: 0.9 }
CROWN[B.glade] = { col: lin(0x4a8040), conifer: 0.2 }
CROWN[B.lakeside] = { col: lin(0x58833c), conifer: 0.05 }

export const farCentre = (v: number): number => Math.round(v / FAR_SNAP) * FAR_SNAP

/**
 * What the land at (x, z) looks like from far off: linear colour into `out`
 * and the canopy share (0 for water). Shared with the horizon lands seen
 * from high in the sky (horizonLands.ts).
 */
export const farLook = (x: number, z: number, h: number, w: Float32Array, out: [number, number, number]): number => {
  if (h < WATER_LEVEL - 0.05) { out[0] = WATER[0]; out[1] = WATER[1]; out[2] = WATER[2]; return 0 }
  if (highvaleMaps.data && highvaleWeight(x, z) > 0.5) return highvaleFarLook(x, z, h, out)
  biomeWeights(x, z, w)
  let r = 0, g = 0, b = 0, canopy = 0
  for (let bi = 0; bi < BIOME_COUNT; bi++) {
    const f = BIOME_FAR[bi]
    r += f.col[0] * w[bi]; g += f.col[1] * w[bi]; b += f.col[2] * w[bi]
    canopy += f.canopy * w[bi]
  }
  out[0] = r; out[1] = g; out[2] = b
  return Math.min(1, canopy * (1 - hubWeight(x, z)))
}

const mcol: [number, number, number] = [0, 0, 0]
const mcrown = [0, 0, 0, 0]

export const buildFarTerrain = (cx: number, cz: number): FarTerrainData => {
  const n = FAR_VERTS
  const heights = new Float32Array(n * n)
  const colors = new Float32Array(n * n * 3)
  const kinds = new Float32Array(n * n * 2)
  const w = new Float32Array(BIOME_COUNT)
  const trees = new Float32Array(MAX_FAR_TREES * FAR_TREE_STRIDE)
  let treeCount = 0
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = cx - FAR_HALF + i * FAR_SPACING
      const z = cz - FAR_HALF + j * FAR_SPACING
      const k = j * n + i
      const h = worldHeight(x, z)
      biomeWeights(x, z, w)
      let r = 0, g = 0, b = 0, canopy = 0
      for (let bi = 0; bi < BIOME_COUNT; bi++) {
        const f = BIOME_FAR[bi]
        r += f.col[0] * w[bi]; g += f.col[1] * w[bi]; b += f.col[2] * w[bi]
        canopy += f.canopy * w[bi]
      }
      // the authored home garden reads as open, mown meadow
      const home = hubWeight(x, z)
      canopy *= 1 - home
      // Highvale: its own ground, forest and snow (world/highvale/highvaleGround.ts)
      const mw = highvaleMaps.data ? highvaleWeight(x, z) : 0
      if (mw > 0) {
        const c = highvaleFarLook(x, z, h, mcol, mcrown)
        r += (mcol[0] - r) * mw; g += (mcol[1] - g) * mw; b += (mcol[2] - b) * mw
        canopy += (c - canopy) * mw
      }
      const water = h < WATER_LEVEL - 0.05 ? 1 : 0
      // the shore itself is drawn by the shader (render/aerialLook.ts) over
      // the land's own colour, so no water-blue smears up the banks
      if (water) canopy = 0
      // Highvale's river and gullies are cut narrower than a far cell: seat the
      // vertex on the lowest ground within half a cell, so the coarse grid
      // never spans a channel above its bed (limited, so ridges barely move)
      let seat = h
      if (mw > 0) {
        const q = FAR_SPACING / 2
        for (let dz = -q; dz <= q; dz += q) for (let dx = -q; dx <= q; dx += q) seat = Math.min(seat, worldHeight(x + dx, z + dz))
        seat = Math.max(seat, h - 8)
      }
      heights[k] = (water ? WATER_LEVEL - 0.25 : seat) - FAR_DROP
      colors[k * 3] = r; colors[k * 3 + 1] = g; colors[k * 3 + 2] = b
      kinds[k * 2] = Math.min(1, canopy); kinds[k * 2 + 1] = WATER_LEVEL - h
      // crowns: about canopy × 3 per 32 m cell, jittered, on dry ground only
      if (water || canopy < 0.06 || i === n - 1 || j === n - 1) continue
      const cellX = Math.floor(x / FAR_SPACING), cellZ = Math.floor(z / FAR_SPACING)
      const wanted = canopy * 3.2
      for (let t = 0; t < 4 && treeCount < MAX_FAR_TREES; t++) {
        const hsh = hash3(WORLD_SEED ^ (0x7ee5 + t * 977), cellX, cellZ)
        if ((hsh & 1023) / 1024 > wanted - t) break
        const tx = x + ((hsh >>> 10) & 1023) / 1024 * FAR_SPACING
        const tz = z + ((hsh >>> 20) & 1023) / 1024 * FAR_SPACING
        const th = worldHeight(tx, tz)
        if (th < WATER_LEVEL + 0.4) continue
        let cr = 0, cg = 0, cb = 0, conifer = 0
        for (let bi = 0; bi < BIOME_COUNT; bi++) {
          const c = CROWN[bi]
          cr += c.col[0] * w[bi]; cg += c.col[1] * w[bi]; cb += c.col[2] * w[bi]
          conifer += c.conifer * w[bi]
        }
        if (mw > 0) {
          cr += (mcrown[0] - cr) * mw; cg += (mcrown[1] - cg) * mw; cb += (mcrown[2] - cb) * mw
          conifer += (mcrown[3] - conifer) * mw
        }
        // size, kind and shade from a second hash, independent of placement
        const h2 = hash3(WORLD_SEED ^ 0x51ab, cellX * 4 + t, cellZ)
        const v = (h2 & 255) / 255
        const isConifer = ((h2 >>> 8) & 255) / 255 < conifer ? 1 : 0
        const shade = 0.82 + ((h2 >>> 16) & 63) / 63 * 0.36
        const o = treeCount * FAR_TREE_STRIDE
        trees[o] = tx - cx; trees[o + 1] = th - FAR_DROP; trees[o + 2] = tz - cz
        trees[o + 3] = (isConifer ? 2.4 : 3.6) * (0.8 + v * 0.45)
        trees[o + 4] = (isConifer ? 13 : 10) * (0.8 + ((h2 >>> 24) & 15) / 15 * 0.5)
        trees[o + 5] = isConifer
        trees[o + 6] = cr * shade; trees[o + 7] = cg * shade; trees[o + 8] = cb * shade
        treeCount++
      }
    }
  }
  return { cx, cz, heights, colors, kinds, trees: trees.slice(0, treeCount * FAR_TREE_STRIDE), treeCount }
}

export const farTransfers = (d: FarTerrainData): Transferable[] => [d.heights.buffer, d.colors.buffer, d.kinds.buffer, d.trees.buffer]
