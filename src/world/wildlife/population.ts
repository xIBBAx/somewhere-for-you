import type { CircleCollider } from "../../game/world-layout"
import { B, BIOME_COUNT, WATER_LEVEL, biomeWeights, lakeMask } from "../climate"
import { HUB_CENTER } from "../hubLayout"
import { landmarkAt } from "../landmarks"
import { hash3, rng } from "../noise"
import { slopeAt, worldHeight } from "../terrain"
import { CHUNK_SIZE, WORLD_SEED } from "../worldConfig"
import { COATS, WILD_CAT_COATS, type Species } from "./animalAssets"

export type AnimalSpawn = {
  id: string
  species: Species
  coat: number
  seed: number
  scale: number
  x: number
  z: number
  sleeper?: boolean
  groundOffset?: number
}

export const ANIMAL_PROFILE: Record<Species, { walk: number; run: number; radius: number; slope: number; homeRange: number; coats: number }> = {
  cat: { walk: 0.55, run: 2.6, radius: 0.23, slope: 0.55, homeRange: 10, coats: WILD_CAT_COATS },
  rabbit: { walk: 0.9, run: 3.4, radius: 0.19, slope: 0.45, homeRange: 12, coats: 3 },
  deer: { walk: 0.9, run: 4.5, radius: 0.46, slope: 0.48, homeRange: 23, coats: 1 },
  fox: { walk: 0.8, run: 3.2, radius: 0.3, slope: 0.55, homeRange: 18, coats: 1 },
  duck: { walk: 0.35, run: 1.1, radius: 0.22, slope: 0.35, homeRange: 9, coats: 2 },
  horse: { walk: 1.15, run: 5.2, radius: 0.65, slope: 0.38, homeRange: 25, coats: 2 },
  monkey: { walk: 0.55, run: 1.8, radius: 0.24, slope: 0.55, homeRange: 12, coats: 1 },
  tiger: { walk: 0.7, run: 3.3, radius: 0.57, slope: 0.45, homeRange: 22, coats: 1 },
  cheetah: { walk: 0.95, run: 4.5, radius: 0.45, slope: 0.42, homeRange: 28, coats: 1 },
  gorilla: { walk: 0.5, run: 1.8, radius: 0.62, slope: 0.5, homeRange: 14, coats: 1 },
}

/**
 * Cats differ more in build than the other species (a slight young female
 * beside a big tom), so the shared ±7 % roll is widened to 0.86–1.10 for them.
 * Same random draw, so populations stay deterministic.
 */
export const catScale = (species: Species, s: number): number => (species === "cat" ? 0.86 + ((s - 0.93) / 0.14) * 0.24 : s)

/** A breed's size on top of the individual roll (a Maine Coon is a big cat). */
export const breedSize = (species: Species, coat: number): number =>
  species === "cat" ? COATS.cat[coat % COATS.cat.length].build?.size ?? 1 : 1

/** Chance of a stray, pair or colony in any chunk beyond home, before cosy landmarks and meadows. */
export const CAT_CHANCE = 0.42

export const habitatAllows =(species: Species, x: number, z: number, checkSlope = true): boolean => {
  const h = worldHeight(x, z)
  const lake = lakeMask(x, z)
  if (species === "duck") return lake > 0 && h < WATER_LEVEL - 0.2
  return h > WATER_LEVEL + 0.18 && (lake === 0 || h > WATER_LEVEL + 0.35) && (!checkSlope || slopeAt(x, z) < ANIMAL_PROFILE[species].slope)
}

export const clearOfColliders = (x: number, z: number, radius: number, colliders: readonly CircleCollider[]): boolean => {
  for (const c of colliders) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + radius) ** 2) return false
  return true
}

/** Reconstruct the same population from a chunk, independent of visit order.
 * Each member is validated separately: a valid flock centre is not sufficient
 * to keep its members out of shorelines, trunks and steep banks.
 */
export const spawnsForChunk = (cx: number, cz: number, hasWater: boolean, colliders: readonly CircleCollider[] = []): AnimalSpawn[] => {
  const out: AnimalSpawn[] = []
  const r = rng(hash3(WORLD_SEED ^ 0x5151, cx, cz))
  const ox = cx * CHUNK_SIZE
  const oz = cz * CHUNK_SIZE
  if (Math.hypot(ox + 32 - HUB_CENTER.x, oz + 32 - HUB_CENTER.z) < 70) return out
  const w = biomeWeights(ox + 32, oz + 32, new Float32Array(BIOME_COUNT))
  const meadow = w[B.meadow] + w[B.flowerMeadow] + w[B.gulmohar] + w[B.lakeside]
  const woods = w[B.forest] + w[B.autumn] + w[B.pine] + w[B.glade]
  // Dense interiors favour quiet deer/fox encounters; rabbits seek edges.
  const density = Math.min(1, colliders.length / 90)
  const lm = landmarkAt(ox + 32, oz + 32)
  const cozy = lm && ["catNap", "picnic", "bench", "kiosk", "flowerHeart"].includes(lm.kind) ? 0.28 : 0
  /** `rand` and `first` let a separate draw add members without moving the rest. */
  const add = (species: Species, count: number, spread: number, rand = r, first = 0): void => {
    let centre: { x: number; z: number } | null = null
    for (let attempt = 0; attempt < 22; attempt++) {
      const x = ox + 8 + rand() * (CHUNK_SIZE - 16)
      const z = oz + 8 + rand() * (CHUNK_SIZE - 16)
      if (habitatAllows(species, x, z) && clearOfColliders(x, z, ANIMAL_PROFILE[species].radius, colliders)) { centre = { x, z }; break }
    }
    if (!centre) return
    for (let i = first; i < first + count; i++) {
      const seed = hash3(WORLD_SEED ^ 0x7ab1, cx * 17 + i, cz * 31 + ["cat", "rabbit", "deer", "fox", "duck", "horse", "monkey", "tiger", "cheetah", "gorilla"].indexOf(species))
      for (let attempt = 0; attempt < 10; attempt++) {
        const x = centre.x + (rand() - 0.5) * spread
        const z = centre.z + (rand() - 0.5) * spread
        const radius = ANIMAL_PROFILE[species].radius
        if (x < ox + 2 || x > ox + CHUNK_SIZE - 2 || z < oz + 2 || z > oz + CHUNK_SIZE - 2) continue
        if (!habitatAllows(species, x, z) || !clearOfColliders(x, z, radius + 0.12, colliders)) continue
        if (out.some(a => Math.hypot(a.x - x, a.z - z) < radius + ANIMAL_PROFILE[a.species].radius + 0.3)) continue
        const coat = Math.floor(rand() * ANIMAL_PROFILE[species].coats)
        const scale = catScale(species, 0.93 + rand() * 0.14) * breedSize(species, coat)
        out.push({ id: `${species}:${cx}:${cz}:${i}`, species, x, z, seed, coat, scale })
        break
      }
    }
  }
  if (r() < meadow * (0.55 - density * 0.2) + woods * 0.12) add("rabbit", 1 + Math.floor(r() * 3), 6)
  if (r() < woods * 0.32 + meadow * 0.13) add("deer", 1 + Math.floor(r() * 3), 8)
  if (r() < woods * 0.19 + meadow * 0.02) add("fox", 1, 0)
  if (r() < 0.08 + cozy + w[B.glade] * 0.18) add("cat", 1, 0)
  if (hasWater) add("duck", 2 + Math.floor(r() * 3), 3.5)
  // Cats of every breed live all over the world beyond home: lone strays,
  // pairs and little colonies, more often by benches, picnics and kiosks.
  // Their own draw leaves every other animal exactly where it was.
  const cats = rng(hash3(WORLD_SEED ^ 0xca75, cx, cz))
  if (cats() < CAT_CHANCE + cozy + meadow * 0.1) add("cat", cats() < 0.3 ? 2 + Math.floor(cats() * 2) : 1, 5, cats, 4)
  // The home garden retains its familiar population. Farther exploration
  // reveals larger, distinct wildlife in suitable cover or open grassland.
  // A separate draw keeps the pre-existing species deterministic.
  if (Math.hypot(ox + 32 - HUB_CENTER.x, oz + 32 - HUB_CENTER.z) > 360) {
    const far = rng(hash3(WORLD_SEED ^ 0x781c, cx, cz))
    const lush = w[B.forest] + w[B.glade]
    const open = w[B.meadow] + w[B.flowerMeadow]
    const choices: Array<[Species, number]> = [
      // horses have their own herds (src/game/horses/herds.ts)
      ["monkey", lush * 0.5 + w[B.gulmohar] * 0.2],
      ["tiger", lush * 0.7 + w[B.autumn] * 0.22],
      ["cheetah", open * 0.65], ["gorilla", lush * 0.65],
    ]
    const total = choices.reduce((sum, [, weight]) => sum + weight, 0)
    if (far() < Math.min(0.48, total * 0.4)) {
      let choice = far() * total
      for (const [species, weight] of choices) {
        choice -= weight
        if (choice > 0) continue
        add(species, species === "monkey" ? 2 : species === "horse" && far() < 0.35 ? 2 : 1, species === "monkey" ? 4 : 6)
        break
      }
    }
  }
  return out
}

export type WildlifeTier = "near" | "middle" | "far" | "off"
export const wildlifeTier = (distance: number, range = 120): WildlifeTier => distance < 25 ? "near" : distance < 65 ? "middle" : distance < range ? "far" : "off"

/** Hard population bound, including temporarily befriended cats. */
export const selectPopulation = (candidates: AnimalSpawn[], px: number, pz: number, limit: number, range: number): AnimalSpawn[] => {
  const unique = new Map<string, AnimalSpawn>()
  for (const s of candidates) if (Math.hypot(s.x - px, s.z - pz) < range) unique.set(s.id, s)
  return [...unique.values()].sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz) || a.id.localeCompare(b.id)).slice(0, limit)
}

/** Cats have slots of their own, so a world full of them never crowds out the
 * deer, foxes and ducks; befriended cats count against the cats' share. */
export const selectWithCats = (candidates: AnimalSpawn[], px: number, pz: number, limit: number, catLimit: number, range: number): AnimalSpawn[] => [
  ...selectPopulation(candidates.filter(s => s.species !== "cat"), px, pz, limit, range),
  ...selectPopulation(candidates.filter(s => s.species === "cat"), px, pz, catLimit, range),
]
