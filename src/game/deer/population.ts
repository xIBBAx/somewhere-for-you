import { B, BIOME_COUNT, biomeWeights, climateAt, lakeMask, WATER_LEVEL } from "../../world/climate"
import { HUB_CENTER } from "../../world/hubLayout"
import { hash3, rng } from "../../world/noise"
import { slopeAt, worldHeight } from "../../world/terrain"
import { CHUNK_SIZE, WORLD_SEED } from "../../world/worldConfig"
import { territoryPhase } from "../../world/wildlife/territoryClock"
import { deerIdentity, SPECIES, type DeerIdentity, type DeerSpecies } from "./species"

export const TERRITORY_SIZE = CHUNK_SIZE * 3
export type DeerHome = {
  ident: DeerIdentity
  x: number
  z: number
  shelterX: number
  shelterZ: number
  waterX: number
  waterZ: number
  hasWater: boolean
}
export type Territory = { id: string; species: DeerSpecies; members: DeerHome[]; x: number; z: number }
const cache = new Map<string, Territory | null>()
export const habitatWeights = (x: number, z: number): Array<[DeerSpecies, number]> => {
  const c = { ...climateAt(x, z) },
    w = biomeWeights(x, z, new Float32Array(BIOME_COUNT))
  const shore = Math.min(1, lakeMask(x, z) * 3 + w[B.lakeside])
  const warm = Math.max(0, Math.min(1, (c.temperature + 0.02) * 3.8))
  const cold = Math.max(0, Math.min(1, (-c.temperature - 0.12) * 3.4))
  const mild = Math.max(0.1, 1 - warm - cold)
  const forest = w[B.forest] + w[B.glade] * 0.5
  const meadow = w[B.meadow] + w[B.flowerMeadow]
  // Large climate regions, plus a continental field, keep a forest's species
  // coherent across many adjacent territories instead of mixing a zoo.
  const continent = hash3(WORLD_SEED ^ 0xa121, Math.floor(x / 2400), Math.floor(z / 2400)) % 3
  return [
    ["chital", warm * (meadow + forest * 0.3) * 1.5],
    ["sambar", warm * (forest + shore * 0.2) * 0.8],
    ["muntjac", warm * forest * 0.65],
    ["barasingha", warm * shore * 1.5],
    ["hog", warm * shore * 0.6],
    ["red", mild * (meadow + w[B.autumn]) * (continent === 0 ? 1.5 : 0.2)],
    ["fallow", mild * (meadow + forest * 0.5) * (continent === 0 ? 1.2 : 0.1)],
    ["roe", mild * (forest + w[B.autumn]) * (continent === 0 ? 0.8 : 0.1)],
    ["sika", mild * (forest + w[B.gulmohar]) * (continent === 1 ? 1.5 : 0.15)],
    ["whitetail", mild * (forest + meadow) * (continent === 2 ? 1.3 : 0.1)],
    ["mule", (cold + mild * 0.3) * (meadow + w[B.pine]) * (continent === 2 ? 0.9 : 0.1)],
    ["elk", (cold + mild * 0.3) * (meadow + w[B.pine]) * 0.9],
    ["moose", c.temperature < -0.25 ? cold * (w[B.pine] + shore * 1.8) * 0.9 : 0],
    ["reindeer", c.temperature < -0.4 ? cold * (meadow + w[B.pine] * 0.3) * (1 - c.hills * 0.5) : 0],
    ["yak", c.temperature < -0.28 && c.hills > 0.5 ? cold * c.hills * (0.6 + meadow) * 1.3 : 0],
  ]
}

export const territoryAt = (tx: number, tz: number): Territory | null => {
  const key = `${tx},${tz}`
  if (cache.has(key)) return cache.get(key)!
  const r = rng(hash3(WORLD_SEED ^ 0xd33e, tx, tz))
  const x = (tx + 0.25 + r() * 0.5) * TERRITORY_SIZE
  const z = (tz + 0.25 + r() * 0.5) * TERRITORY_SIZE
  let result: Territory | null = null
  // Presence is a property of the world seed and territory, never the player.
  if (Math.hypot(x - HUB_CENTER.x, z - HUB_CENTER.z) > 90 && r() < 0.74) {
    const choices = habitatWeights(x, z)
    const sum = choices.reduce((v, [, weight]) => v + weight, 0)
    let pick = r() * sum
    const species = choices.find(([, weight]) => weight > 0 && (pick -= weight) <= 0)?.[0] ?? "red"
    const p = SPECIES[species],
      id = `herd:${key}`,
      members: DeerHome[] = []
    const count = p.group[0] + Math.floor(r() * (p.group[1] - p.group[0] + 1))
    // Locate actual shore, not an arbitrary drinking point on dry terrain.
    let waterX = x,
      waterZ = z,
      hasWater = false
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8,
        wx = x + Math.sin(a) * 40,
        wz = z + Math.cos(a) * 40
      const h = worldHeight(wx, wz)
      if (lakeMask(wx, wz) > 0.02 && h > WATER_LEVEL && h < WATER_LEVEL + 0.55) {
        waterX = wx
        waterZ = wz
        hasWater = true
        break
      }
    }
    for (let n = 0; n < count; n++) {
      const age =
        n === count - 1 && count >= 2 && members.some((h) => h.ident.id === `deer:${key}:0`) && r() < 0.72
          ? "fawn"
          : "adult"
      const sex = n === 0 ? "female" : n === 1 && count >= 3 ? "male" : r() < 0.7 ? "female" : "male"
      const seed = hash3(WORLD_SEED ^ 0xdecaf, tx * 31 + n, tz * 17)
      const ident = deerIdentity(
        `deer:${key}:${n}`,
        seed,
        species,
        id,
        sex,
        age,
        age === "fawn" ? `deer:${key}:0` : null,
      )
      for (let a = 0; a < 12; a++) {
        const hx = x + (r() - 0.5) * 22,
          hz = z + (r() - 0.5) * 22
        if (worldHeight(hx, hz) <= WATER_LEVEL + 0.2 || slopeAt(hx, hz) > 0.5) continue
        members.push({ ident, x: hx, z: hz, shelterX: x + 10, shelterZ: z - 13, waterX, waterZ, hasWater })
        break
      }
    }
    if (members.length) result = { id, species, x, z, members }
  }
  cache.set(key, result)
  if (cache.size > 192) cache.delete(cache.keys().next().value!)
  return result
}

/** Adapter to the existing chunk lifecycle. A territory has exactly one
 * canonical set of identities even when several of its chunks are loaded. */
export const deerForChunk = (cx: number, cz: number): DeerHome[] => {
  const t = territoryAt(Math.floor(cx / 3), Math.floor(cz / 3))
  return t?.members.filter((h) => Math.floor(h.x / CHUNK_SIZE) === cx && Math.floor(h.z / CHUNK_SIZE) === cz) ?? []
}

export type Routine = "graze" | "browse" | "drink" | "rest" | "sleep" | "walk" | "groom"
/** Closed-form coarse simulation. No live entity or save entry is necessary
 * for unvisited animals; every animal advances along its own daily circuit. */
export const routineAt = (home: DeerHome, time: number): { x: number; z: number; mode: Routine; phase: number } => {
  const p = SPECIES[home.ident.species]
  const herdSeed = hash3(7, Math.floor(home.x / TERRITORY_SIZE), Math.floor(home.z / TERRITORY_SIZE))
  const period = 540 + ((p.social > 0.6 ? herdSeed : home.ident.seed) % 150)
  // Members share a clock, with a small bounded offset. Never interpolate
  // wrapped phases: doing so would abruptly move a herd across its route.
  const offset = p.social > 0.6 ? (herdSeed % period) + (home.ident.seed % 19) : home.ident.seed % period
  const phase = territoryPhase(offset, time, period)
  const t = phase
  const a = t * Math.PI * 2,
    radius = p.range * 0.26
  let mode: Routine =
    t < 0.43
      ? (home.ident.seed % 100) / 100 < p.browser
        ? "browse"
        : "graze"
      : t < 0.53
        ? "walk"
        : t < 0.6 && home.hasWater
          ? "drink"
          : t < 0.77
            ? "rest"
            : t < 0.87
              ? "sleep"
              : t < 0.91
                ? "groom"
                : "walk"
  if (home.ident.age === "fawn" && p.hidesYoung && t > 0.5) mode = "rest"
  const resting = mode === "rest" || mode === "sleep"
  // A continuous circuit joins feeding ground, shore and sheltered rest.
  // Transit is retained during coarse simulation as well as active walking.
  const blend = (a: number, b: number, v: number): number => {
    const u = Math.max(0, Math.min(1, (v - a) / (b - a)))
    return u * u * (3 - 2 * u)
  }
  const shelter = blend(0.61, 0.72, t) * (1 - blend(0.87, 0.98, t))
  const drink = home.hasWater ? blend(0.46, 0.55, t) * (1 - blend(0.59, 0.69, t)) : 0
  const sx = home.shelterX + (home.ident.seed % 7) - 3,
    sz = home.shelterZ + (home.ident.seed % 5) - 2
  let x = home.x + Math.sin(a) * radius,
    z = home.z + Math.cos(a) * radius * 0.65
  x += (home.waterX - x) * drink
  z += (home.waterZ - z) * drink
  x += (sx - x) * shelter
  z += (sz - z) * shelter
  if (!resting && mode !== "drink" && (shelter > 0.01 || drink > 0.01)) mode = "walk"
  // Route projection keeps the analytically advanced state above shorelines.
  const valid = worldHeight(x, z) > WATER_LEVEL + 0.12 && slopeAt(x, z) < 0.55
  return { x: valid ? x : home.x, z: valid ? z : home.z, mode, phase }
}
