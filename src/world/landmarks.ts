import { highvaleWeight } from "./highvale/highvaleLayout"
import { siteWeight } from "./sites/siteLayout"
import { B, BIOME_COUNT, biomeWeights, lakeMask, nRegion } from "./climate"
import { rawWildHeight } from "./baseTerrain"
import { HUB_CENTER } from "./hubLayout"
import { hash01, hash3, smooth } from "./noise"
import { WORLD_SEED } from "./worldConfig"

/**
 * Deterministic points of interest. The world is divided into large region
 * cells; each cell may host one discovery at a stable position. Because the
 * placement only depends on the seed and cell coordinates, landmarks persist
 * across sessions and revisits without any saved data.
 *
 * Every kind is drawn from things already established in the explorer's world:
 * cats, cafés, sketching/design, training, rainy-day umbrellas, quiet
 * walks/benches, the little fair, gulmohar blossoms, stars and wishes.
 */
export const LANDMARK_CELL = 320

export const LANDMARK_KINDS = [
  "flowerHeart", // heart-shaped flower bed (common)
  "picnic", // picnic blanket, basket, two cushions (common)
  "bench", // walk bench overlook with lantern (common)
  "catNap", // a few cats napping on cushions
  "kiosk", // chai kiosk with cups (rare)
  "easel", // sketching easel with a little canvas (rare)
  "umbrella", // rainy-day umbrella over a bench (uncommon)
  "trainingPost", // wrapped training post + mat (uncommon)
  "gulmoharArch", // gulmohar-blossom arch with hanging lanterns (rare)
  "starStones", // ring of glowing stones that light up at night (rare)
  "wishTree", // a great old tree with hanging ribbons and fairy lights (very rare)
  "balloon", // tethered hot-air balloon from the fair (very rare)
] as const
export type LandmarkKind = (typeof LANDMARK_KINDS)[number]

const WEIGHTS: Record<LandmarkKind, number> = {
  flowerHeart: 14,
  picnic: 12,
  bench: 14,
  catNap: 11,
  kiosk: 5,
  easel: 5,
  umbrella: 7,
  trainingPost: 5,
  gulmoharArch: 5,
  starStones: 5,
  wishTree: 3,
  balloon: 2,
}
const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((a, b) => a + b, 0)

export const LANDMARK_RARITY: Record<LandmarkKind, "common" | "uncommon" | "rare" | "very-rare"> = {
  flowerHeart: "common", picnic: "common", bench: "common", catNap: "common",
  umbrella: "uncommon", trainingPost: "uncommon", kiosk: "rare", easel: "rare", gulmoharArch: "rare", starStones: "rare",
  wishTree: "very-rare", balloon: "very-rare",
}

const biomeAffinity = (kind: LandmarkKind, w: Float32Array): number => {
  const open = w[B.meadow] + w[B.flowerMeadow] + w[B.gulmohar]
  const forest = w[B.forest] + w[B.autumn] + w[B.pine] + w[B.glade]
  switch (kind) {
    case "flowerHeart": return 0.12 + open * 1.8
    case "balloon": return open > 0.5 ? open : 0
    case "gulmoharArch": return 0.06 + w[B.gulmohar] * 3 + w[B.flowerMeadow]
    case "starStones": return 0.15 + w[B.glade] * 4 + w[B.pine]
    case "wishTree": return 0.15 + forest * 1.5 + w[B.glade] * 2
    case "umbrella": return 0.5 + forest
    case "easel": return 0.4 + open + w[B.autumn]
    default: return 0.8 + open * 0.3
  }
}

/** Clearing radius around each landmark kept free of trees/rocks. */
export const LANDMARK_RADIUS: Record<LandmarkKind, number> = {
  flowerHeart: 6,
  picnic: 5,
  bench: 4.5,
  catNap: 5,
  kiosk: 6.5,
  easel: 4.5,
  umbrella: 4.5,
  trainingPost: 4.5,
  gulmoharArch: 6,
  starStones: 7,
  wishTree: 9,
  balloon: 8,
}

export type Landmark = {
  id: string
  kind: LandmarkKind
  x: number
  z: number
  rot: number
  seed: number
}

/** Computing an eligible clearing includes climate and raw terrain samples.
 * The bounded cache is per worker/main thread, never a visited-world archive. */
const cache = new Map<string, Landmark | null>()
const makeLandmark = (cellX: number, cellZ: number): Landmark | null => {
  const nearHome = Math.hypot((cellX + 0.5) * LANDMARK_CELL - HUB_CENTER.x, (cellZ + 0.5) * LANDMARK_CELL - HUB_CENTER.z) < 600
  const density = nearHome ? 0.7 : 0.4 + smooth(-0.55, 0.55, nRegion(cellX * 0.29 + 8, cellZ * 0.29 - 5)) * 0.42
  // ~70% of cells hold a discovery: frequent enough to always have something ahead.
  if (hash01(WORLD_SEED ^ 0x1a2b, cellX, cellZ) >= density) return null
  const jx = 0.2 + hash01(WORLD_SEED ^ 0x3c4d, cellX, cellZ) * 0.6
  const jz = 0.2 + hash01(WORLD_SEED ^ 0x5e6f, cellX, cellZ) * 0.6
  const x = (cellX + jx) * LANDMARK_CELL
  const z = (cellZ + jz) * LANDMARK_CELL
  // The authored home region owns its own memories; real places stay clear.
  if (Math.hypot(x - HUB_CENTER.x, z - HUB_CENTER.z) < 110) return null
  if (siteWeight(x, z, 40).w > 0) return null
  // Highvale keeps to what is really there
  if (highvaleWeight(x, z) > 0) return null
  const w = nearHome ? null : biomeWeights(x, z, new Float32Array(BIOME_COUNT))
  const weight = (kind: LandmarkKind): number => WEIGHTS[kind] * (w ? biomeAffinity(kind, w) : 1)
  const total = w ? LANDMARK_KINDS.reduce((sum, kind) => sum + weight(kind), 0) : TOTAL_WEIGHT
  let pick = hash01(WORLD_SEED ^ 0x7a8b, cellX, cellZ) * total
  let kind: LandmarkKind = "bench"
  for (const k of LANDMARK_KINDS) {
    pick -= weight(k)
    if (pick <= 0) {
      kind = k
      break
    }
  }
  // Never place discoveries in or right beside a lake.
  const r = LANDMARK_RADIUS[kind] + 6
  if (lakeMask(x, z) > 0 || lakeMask(x + r, z) > 0 || lakeMask(x - r, z) > 0 || lakeMask(x, z + r) > 0 || lakeMask(x, z - r) > 0) return null
  if (!nearHome) {
    const centre = rawWildHeight(x, z)
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4, sx = x + Math.cos(angle) * r, sz = z + Math.sin(angle) * r
      if (lakeMask(sx, sz) > 0 || Math.abs(rawWildHeight(sx, sz) - centre) / r > 0.32) return null
    }
  }
  return {
    id: `lm:${cellX}:${cellZ}`,
    kind,
    x,
    z,
    rot: hash01(WORLD_SEED ^ 0x9cad, cellX, cellZ) * Math.PI * 2,
    seed: hash3(WORLD_SEED ^ 0xbeef, cellX, cellZ),
  }
}

export const landmarkInCell = (cellX: number, cellZ: number): Landmark | null => {
  const key = `${cellX}:${cellZ}`
  const known = cache.get(key)
  if (known !== undefined) return known
  const value = makeLandmark(cellX, cellZ)
  if (cache.size >= 512) cache.delete(cache.keys().next().value!)
  cache.set(key, value)
  return value
}

/**
 * The landmark whose cell contains (x, z). Landmark centres stay within the
 * middle 60% of their cell and radii are far smaller than the margin, so a
 * point can only ever be influenced by its own cell's landmark.
 */
export const landmarkAt = (x: number, z: number): Landmark | null =>
  landmarkInCell(Math.floor(x / LANDMARK_CELL), Math.floor(z / LANDMARK_CELL))

/** All landmarks whose clearing may touch the given rectangle. */
export const landmarksNear = (minX: number, minZ: number, maxX: number, maxZ: number, out: Landmark[]): Landmark[] => {
  out.length = 0
  const pad = 12
  const c0x = Math.floor((minX - pad) / LANDMARK_CELL)
  const c1x = Math.floor((maxX + pad) / LANDMARK_CELL)
  const c0z = Math.floor((minZ - pad) / LANDMARK_CELL)
  const c1z = Math.floor((maxZ + pad) / LANDMARK_CELL)
  for (let cz = c0z; cz <= c1z; cz++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      const lm = landmarkInCell(cx, cz)
      if (!lm) continue
      const r = LANDMARK_RADIUS[lm.kind] + pad
      if (lm.x + r < minX || lm.x - r > maxX || lm.z + r < minZ || lm.z - r > maxZ) continue
      out.push(lm)
    }
  }
  return out
}
