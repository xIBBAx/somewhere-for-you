import { WATER_LEVEL } from "../climate"
import { chunkColliders } from "../colliders"
import { worldHeight } from "../terrain"
import { CHUNK_SIZE } from "../worldConfig"
import { creatureWaterSurfaceAt } from "../creatureWater"
import { highvaleWeight } from "../highvale/highvaleLayout"
import type { Species } from "./animalAssets"

/**
 * Daily and weather rhythms for the streamed wildlife.
 *
 * Real animals keep hours: rabbits and foxes come out at dawn and dusk,
 * ducks and primates are about by day, tigers own the night. Rain sends
 * furred animals under a tree, while ducks carry on. Everything here is
 * pure and cheap; the brain in behavior.ts asks it when choosing what to do
 * next, never every frame.
 */

/** What the world looks like to an animal right now. */
export type AnimalEnv = {
  /** worldRT.timeOfDay: 0 day … ~0.8 golden/twilight … 1 night */
  tod: number
  /** 0 … 1 rain intensity */
  rain: number
  /** unit vector the wind blows toward; animals shelter on the lee side */
  windX?: number
  windZ?: number
}
export const CALM_DAY: AnimalEnv = { tod: 0, rain: 0 }

type Rhythm = "diurnal" | "crepuscular" | "nocturnal"
export const SPECIES_RHYTHM: Record<Species, Rhythm> = {
  rabbit: "crepuscular",
  fox: "crepuscular",
  cat: "crepuscular",
  deer: "crepuscular",
  duck: "diurnal",
  horse: "diurnal",
  monkey: "diurnal",
  gorilla: "diurnal",
  cheetah: "diurnal",
  tiger: "nocturnal",
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * 0 … 1: how much a species wants to be up and about. Twilight in this world
 * sits around timeOfDay 0.55–0.92 (both dawn and dusk pass through it).
 */
export const activityLevel = (species: Species, env: AnimalEnv): number => {
  const t = env.tod
  const twilight = smooth(0.35, 0.62, t) * (1 - smooth(0.9, 0.99, t))
  let level: number
  switch (SPECIES_RHYTHM[species]) {
    case "diurnal": level = 1 - 0.85 * smooth(0.72, 0.97, t); break
    case "crepuscular": level = 0.5 + 0.5 * twilight - 0.2 * smooth(0.93, 1, t); break
    case "nocturnal": level = 0.35 + 0.65 * smooth(0.55, 0.92, t); break
  }
  // a steady rain quietens everyone except the ducks, who rather like it
  if (species !== "duck") level *= 1 - 0.45 * smooth(0.25, 0.8, env.rain)
  return Math.min(1, Math.max(0, level))
}

/** Furred animals look for cover once the rain is more than a sprinkle. */
export const wantsShelter = (species: Species, env: AnimalEnv): boolean =>
  species !== "duck" && species !== "horse" && env.rain > 0.35

/**
 * The nearest tree within `range`, as a resting spot on its lee side, just
 * outside the trunk collider. Boulders count only when no tree is close.
 */
export const findShelter = (x: number, z: number, radius: number, range: number, windX = 1, windZ = 0): { x: number; z: number } | null => {
  let best: { x: number; z: number; r: number } | null = null
  let bestScore = Infinity
  const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE)
  const reach = Math.ceil(range / CHUNK_SIZE)
  for (let iz = -reach; iz <= reach; iz++) for (let ix = -reach; ix <= reach; ix++) {
    const list = chunkColliders.get(`${cx + ix},${cz + iz}`)
    if (!list) continue
    for (const c of list) {
      const d = Math.hypot(c.x - x, c.z - z)
      if (d > range) continue
      // a crown (tall collider) shelters far better than a rock
      const score = d * (c.standable ? 2.2 : 1)
      if (score < bestScore) { bestScore = score; best = c }
    }
  }
  if (!best) return null
  // sit downwind of the trunk, out of the driven rain
  const gap = best.r + radius + 0.35
  return { x: best.x + windX * gap, z: best.z + windZ * gap }
}

const SHORE_RINGS = [5, 9, 14, 19]
/**
 * A dry spot right at the water's edge within ~20 m, plus the heading that
 * faces the water from it. Deterministic for a given position.
 */
export const findShore = (
  x: number, z: number, allows: (x: number, z: number) => boolean,
): { x: number; z: number; face: number } | null => {
  for (const ring of SHORE_RINGS) {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + ring * 0.37
      const sx = x + Math.sin(a) * ring, sz = z + Math.cos(a) * ring
      const h = worldHeight(sx, sz)
      // lakes sit at WATER_LEVEL; the river runs higher, down its own valley
      const river = highvaleWeight(sx, sz) > 0
      if ((!river && h > WATER_LEVEL + 0.6) || !allows(sx, sz) || (river && creatureWaterSurfaceAt(sx, sz) !== null)) continue
      // the water must be within a short neck-stretch of this spot
      for (let j = 0; j < 8; j++) {
        const b = (j / 8) * Math.PI * 2
        const wx = sx + Math.sin(b) * 0.9, wz = sz + Math.cos(b) * 0.9
        if (river ? creatureWaterSurfaceAt(wx, wz) !== null : worldHeight(wx, wz) < WATER_LEVEL - 0.02) return { x: sx, z: sz, face: b }
      }
    }
  }
  return null
}

/** One fleeing animal warns its own kind nearby: rabbits thump, deer flag. */
export const ALARM_RADIUS: Partial<Record<Species, number>> = { rabbit: 9, deer: 14 }
