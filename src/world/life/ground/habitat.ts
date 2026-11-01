import { BIOME_COUNT, biomeWeights, lakeMask, WATER_LEVEL } from "../../climate"
import { chunkColliders } from "../../colliders"
import { distToPath, hubWeight } from "../../hubLayout"
import { hash01, smooth } from "../../noise"
import { siteBlocked } from "../../sites/siteLayout"
import { slopeAt, worldHeight } from "../../terrain"
import { CHUNK_SIZE, chunkKey, WORLD_SEED } from "../../worldConfig"
import { worldStreamRT } from "../../worldRuntime"
import { groundObstacle, sampleGround } from "../../../game/environment/ground/groundSurface"
import { K, KIND_COUNT } from "./roster"

/**
 * Where and when ground creatures live. Everything here is a pure function of
 * world position (and, for activity, of time and weather), so a place hosts
 * the same creatures every time the explorer comes back to it.
 */

/**
 * Habitat affinity 0…1 per kind, in BIOMES order:
 * meadow, flowerMeadow, forest, gulmohar, autumn, pine, glade, lakeside.
 * Woodland litter dwellers favour forest/autumn/pine; sun lovers the meadows.
 */
export const AFFINITY: readonly (readonly number[])[] = [
  /* gardenAnt    */ [1, 0.9, 0.1, 0.6, 0.2, 0, 0.4, 0.3],
  /* woodAnt      */ [0, 0, 0.8, 0, 0.5, 1, 0.3, 0],
  /* ladybird     */ [0.8, 1, 0.15, 0.8, 0.3, 0.1, 0.6, 0.4],
  /* groundBeetle */ [0.15, 0.1, 1, 0.3, 0.9, 0.6, 0.7, 0.3],
  /* stagBeetle   */ [0, 0, 1, 0.1, 0.8, 0.1, 0.4, 0],
  /* grasshopper  */ [1, 0.9, 0, 0.4, 0.2, 0.1, 0.5, 0.6],
  /* fieldCricket */ [0.9, 0.7, 0, 0.3, 0.3, 0.1, 0.4, 0.3],
  /* harvestman   */ [0.2, 0.1, 0.9, 0.4, 0.9, 0.7, 0.8, 0.4],
  /* woodlouse    */ [0.1, 0.05, 1, 0.5, 1, 0.6, 0.6, 0.3],
  /* millipede    */ [0.05, 0, 0.9, 0.3, 0.8, 0.5, 0.7, 0.2],
  /* snail        */ [0.5, 0.5, 0.7, 0.8, 0.5, 0.2, 0.9, 1],
  /* earthworm    */ [0.8, 0.7, 0.7, 0.6, 0.6, 0.2, 0.7, 0.7],
]

/** Expected creatures per planning slot in ideal habitat (walkers only). */
export const DENSITY: readonly number[] = [0, 0, 0.2, 0.14, 0.05, 0.26, 0.1, 0.12, 0.26, 0.1, 0.16, 0.2]

export type GroundEnv = {
  /** worldRT.timeOfDay: 0 day … ~0.7 twilight … 1 night */
  tod: number
  rain: number
  /** slow ground dampness memory (rain and wetness, lingering after rain) */
  wet: number
  snow: number
  cloud: number
}

export const makeEnv = (): GroundEnv => ({ tod: 0, rain: 0, wet: 0, snow: 0, cloud: 0 })

export type TimeBands = { day: number; twilight: number; night: number }
const bandsOut: TimeBands = { day: 1, twilight: 0, night: 0 }

/** Smooth day / twilight / night weights that always sum to 1. */
export const timeBands = (tod: number, out: TimeBands = bandsOut): TimeBands => {
  out.day = 1 - smooth(0.5, 0.7, tod)
  out.night = smooth(0.78, 0.92, tod)
  out.twilight = Math.max(0, 1 - out.day - out.night)
  return out
}

const shelter = (rain: number, lo: number, hi: number): number => 1 - smooth(lo, hi, rain)
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * 0…1: the share of a kind's local population that is out and about now.
 * Sun lovers (ants, ladybirds, grasshoppers) shelter from rain; litter
 * dwellers (woodlice, millipedes) come out at night or when it is damp;
 * snails and earthworms emerge with rain and linger while the ground is wet.
 * Snow sends everyone under cover.
 */
export const kindActivity = (kind: number, env: GroundEnv): number => {
  const t = timeBands(env.tod)
  const { day, twilight, night } = t
  const cold = 1 - smooth(0.08, 0.35, env.snow)
  const overcast = smooth(0.6, 1, env.cloud)
  let a = 0
  switch (kind) {
    case K.gardenAnt:
      a = (day + twilight * 0.55 + night * 0.05) * shelter(env.rain, 0.18, 0.45)
      break
    case K.woodAnt:
      a = (day + twilight * 0.45 + night * 0.03) * shelter(env.rain, 0.18, 0.45)
      break
    case K.ladybird:
      a = (day + twilight * 0.2) * shelter(env.rain, 0.08, 0.3) * (1 - overcast * 0.4)
      break
    case K.groundBeetle:
      a = (day * (0.12 + env.wet * 0.2) + twilight * 0.75 + night) * shelter(env.rain, 0.65, 0.95)
      break
    case K.stagBeetle:
      a = (day * 0.03 + twilight + night * 0.55) * shelter(env.rain, 0.12, 0.35)
      break
    case K.grasshopper:
      a = (day + twilight * 0.3) * shelter(env.rain, 0.08, 0.3) * (1 - overcast * 0.5)
      break
    case K.fieldCricket:
      a = (day * 0.55 + twilight + night * 0.9) * shelter(env.rain, 0.15, 0.4)
      break
    case K.harvestman:
      a = (day * 0.1 + twilight * 0.8 + night) * shelter(env.rain, 0.55, 0.9)
      break
    case K.woodlouse:
      a = day * (0.06 + env.wet * 0.8) + twilight * 0.7 + night + env.wet * 0.3
      break
    case K.millipede:
      a = day * (0.05 + env.wet * 0.7) + twilight * 0.6 + night + env.wet * 0.2
      break
    case K.snail:
      a = day * 0.04 + twilight * 0.55 + night * 0.95 + smooth(0.15, 0.55, env.wet)
      break
    case K.earthworm: {
      const moist = smooth(0.2, 0.6, Math.max(env.wet, env.rain))
      a = moist * (0.55 + 0.45 * (night + twilight * 0.5)) + night * 0.12
      break
    }
  }
  return clamp01(a) * cold
}

/** Activity for every kind at once (allocation-free). */
export const allActivity = (env: GroundEnv, out: Float32Array): Float32Array => {
  for (let k = 0; k < KIND_COUNT; k++) out[k] = kindActivity(k, env)
  return out
}

/**
 * Slow soil dampness memory. WeatherSystem's wetness dries within a minute or
 * so; snails and worms keep coming out for a few minutes after rain, so ground
 * life keeps its own, slower memory.
 */
export const stepDampness = (wet: number, rain: number, wetness: number, dt: number): number => {
  const target = Math.max(Math.min(1, rain * 1.2), wetness)
  if (target > wet) return wet + (target - wet) * (1 - Math.exp(-dt / 6))
  return wet * Math.exp(-dt / 180)
}

/** Weighted habitat suitability of a kind for given biome weights. */
export const suitability = (kind: number, w: Float32Array): number => {
  const row = AFFINITY[kind]
  let s = 0
  for (let b = 0; b < BIOME_COUNT; b++) s += w[b] * row[b]
  return s
}

/**
 * Can a small creature live here? Never in lakes, on an authored site or
 * its road, on cliffs, or (at home) on paths, plazas, rocks and buildings.
 */
export const groundOk = (x: number, z: number): boolean => {
  if (siteBlocked(x, z)) return false
  if (lakeMask(x, z) > 0 && worldHeight(x, z) < WATER_LEVEL + 0.06) return false
  if (slopeAt(x, z) > 0.8) return false
  if (hubWeight(x, z) > 0.02) {
    if (distToPath(x, z) < 1.4) return false
    const s = sampleGround(x, z)
    if (s.kind === "built" || s.kind === "rock" || s.kind === "water") return false
    if (groundObstacle(x, z)) return false
  }
  return true
}

/**
 * Inside a streamed tree trunk or boulder? Checked when a creature or nest is
 * placed (not per frame). Chunks within the planning radius are always built
 * long before the player arrives, so the answer is stable on revisits.
 */
export const insideScatter = (x: number, z: number, margin = 0.12): boolean => {
  const cx = Math.floor(x / CHUNK_SIZE)
  const cz = Math.floor(z / CHUNK_SIZE)
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const list = chunkColliders.get(chunkKey(cx + dx, cz + dz))
      if (!list) continue
      for (const c of list) {
        const r = c.r + margin
        if ((x - c.x) * (x - c.x) + (z - c.z) * (z - c.z) < r * r) return true
      }
    }
  }
  return false
}

/** Cheap check for a landing/hop target: dry and not on an authored site. */
export const landingOk = (x: number, z: number): boolean =>
  !siteBlocked(x, z) && !(lakeMask(x, z) > 0 && worldHeight(x, z) < WATER_LEVEL + 0.04)

// --- deterministic planning -------------------------------------------------

export const PLAN_CELL = 7
export const PLAN_SLOTS = 2
export const COLONY_CELL = 22

const SEED = WORLD_SEED ^ 0x9e37
const weightsScratch = new Float32Array(BIOME_COUNT)
const kindWeights = new Float32Array(KIND_COUNT)

export type SlotPlan = { kind: number; x: number; z: number }

/**
 * What lives in slot `slot` of planning cell (gx, gz)? Position, kind and
 * acceptance come only from world-position hashes and the (deterministic)
 * climate, never from time or weather — activity decides who is out *now*.
 */
export const planSlot = (gx: number, gz: number, slot: number, out: SlotPlan): SlotPlan => {
  const s = slot * 17
  const x = (gx + 0.06 + 0.88 * hash01(SEED ^ (0x6c01 + s), gx, gz)) * PLAN_CELL
  const z = (gz + 0.06 + 0.88 * hash01(SEED ^ (0x6c02 + s), gx, gz)) * PLAN_CELL
  out.kind = -1
  out.x = x
  out.z = z
  biomeWeights(x, z, weightsScratch)
  let total = 0
  for (let k = 0; k < KIND_COUNT; k++) {
    const v = DENSITY[k] > 0 ? suitability(k, weightsScratch) * DENSITY[k] : 0
    kindWeights[k] = v
    total += v
  }
  if (hash01(SEED ^ (0x6c03 + s), gx, gz) >= Math.min(0.92, total)) return out
  let pick = hash01(SEED ^ (0x6c04 + s), gx, gz) * total
  let kind = -1
  for (let k = 0; k < KIND_COUNT; k++) {
    if (kindWeights[k] <= 0) continue
    kind = k
    pick -= kindWeights[k]
    if (pick < 0) break
  }
  if (kind < 0 || !groundOk(x, z)) return out
  out.kind = kind
  return out
}

/** Nearest tree trunk for wood ants to farm aphids on; "pending" while unbuilt. */
export type TreeFinder = (x: number, z: number, minD: number, maxD: number) => { x: number; z: number; r: number } | null | "pending"

const treeOut = { x: 0, z: 0, r: 0 }
export const findTreeTrunk: TreeFinder = (x, z, minD, maxD) => {
  if (!worldStreamRT.streamer) return null
  const cx = Math.floor(x / CHUNK_SIZE)
  const cz = Math.floor(z / CHUNK_SIZE)
  let best = Infinity
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const list = chunkColliders.get(chunkKey(cx + dx, cz + dz))
      if (!list) {
        // A neighbour that may hold the nearest tree is not built yet.
        if (Math.abs((cx + dx + 0.5) * CHUNK_SIZE - x) < CHUNK_SIZE / 2 + maxD && Math.abs((cz + dz + 0.5) * CHUNK_SIZE - z) < CHUNK_SIZE / 2 + maxD) return "pending"
        continue
      }
      for (const c of list) {
        if (c.standable || c.r > 0.75) continue
        const d = Math.hypot(c.x - x, c.z - z)
        if (d < minD || d > maxD || d >= best) continue
        best = d
        treeOut.x = c.x
        treeOut.z = c.z
        treeOut.r = c.r
      }
    }
  }
  return best < Infinity ? treeOut : null
}

export type ColonyPlan = {
  ok: boolean
  pending: boolean
  /** 0 black garden ant, 1 red wood ant */
  species: number
  nx: number
  nz: number
  fx: number
  fz: number
  /** sideways bow of the trail, as a fraction of its length */
  bend: number
  /** nest diameter (m) */
  size: number
  /** the trail ends at the foot of a tree trunk and climbs it */
  tree: boolean
  trunkX: number
  trunkZ: number
  trunkR: number
}

export const makeColonyPlan = (): ColonyPlan => ({ ok: false, pending: false, species: 0, nx: 0, nz: 0, fx: 0, fz: 0, bend: 0, size: 0, tree: false, trunkX: 0, trunkZ: 0, trunkR: 0 })

/** Ant colony (if any) of colony cell (gx, gz): nest, food source and trail shape. */
export const planColony = (gx: number, gz: number, out: ColonyPlan, trees: TreeFinder = findTreeTrunk): ColonyPlan => {
  out.ok = false
  out.pending = false
  out.tree = false
  const nx = (gx + 0.2 + 0.6 * hash01(SEED ^ 0xa171, gx, gz)) * COLONY_CELL
  const nz = (gz + 0.2 + 0.6 * hash01(SEED ^ 0xa172, gx, gz)) * COLONY_CELL
  out.nx = nx
  out.nz = nz
  biomeWeights(nx, nz, weightsScratch)
  const garden = suitability(K.gardenAnt, weightsScratch)
  const wood = suitability(K.woodAnt, weightsScratch)
  out.species = wood > garden ? 1 : 0
  const suit = Math.max(garden, wood)
  if (hash01(SEED ^ 0xa173, gx, gz) >= suit * 0.5) return out
  if (!groundOk(nx, nz)) return out
  const h = hash01(SEED ^ 0xa174, gx, gz)
  out.size = out.species === 1 ? 0.75 + h * 0.5 : 0.16 + h * 0.08
  out.bend = (hash01(SEED ^ 0xa175, gx, gz) - 0.5) * 0.5
  const length = out.species === 1 ? 4 + h * 4 : 3 + hash01(SEED ^ 0xa176, gx, gz) * 3.5
  if (out.species === 1) {
    const tree = trees(nx, nz, 2.5, 9)
    if (tree === "pending") {
      out.pending = true
      return out
    }
    if (tree) {
      const d = Math.hypot(tree.x - nx, tree.z - nz)
      out.tree = true
      out.trunkX = tree.x
      out.trunkZ = tree.z
      out.trunkR = tree.r
      // the trail ends at the trunk's foot, on the side facing the nest
      out.fx = tree.x - ((tree.x - nx) / d) * (tree.r + 0.02)
      out.fz = tree.z - ((tree.z - nz) / d) * (tree.r + 0.02)
      out.ok = true
      return out
    }
  }
  const angle0 = hash01(SEED ^ 0xa177, gx, gz) * Math.PI * 2
  for (let attempt = 0; attempt < 4; attempt++) {
    const a = angle0 + attempt * 1.9
    const fx = nx + Math.cos(a) * length
    const fz = nz + Math.sin(a) * length
    if (!groundOk(fx, fz) || !landingOk((nx + fx) / 2, (nz + fz) / 2)) continue
    out.fx = fx
    out.fz = fz
    out.ok = true
    return out
  }
  return out
}
