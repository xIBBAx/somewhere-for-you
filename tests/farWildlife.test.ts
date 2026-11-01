import { describe, expect, it } from "vitest"
import { ANIMAL_PROFILE, habitatAllows, selectPopulation, spawnsForChunk } from "../src/world/wildlife/population"
import { createAnimalAgent, moveAnimal, thinkAnimal } from "../src/world/wildlife/behavior"
import type { Species } from "../src/world/wildlife/animalAssets"

// Horses live in their own herds (src/game/horses/herds.ts, tests/horses.test.ts).
const EXPLORATION_SPECIES: Species[] = ["monkey", "tiger", "cheetah", "gorilla"]

describe("distinct wildlife during exploration", () => {
  it("keeps the familiar home population and deterministically inhabits distant regions", () => {
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
      expect(spawnsForChunk(x, z, false).every(a => !EXPLORATION_SPECIES.includes(a.species))).toBe(true)
    }
    const found = new Map<Species, ReturnType<typeof spawnsForChunk>[number]>()
    // Scan a regular set of regions, rather than inventing debug-only spawns.
    for (let x = -60; x <= 60; x += 3) for (let z = -60; z <= 60; z += 3) {
      const first = spawnsForChunk(x, z, false)
      expect(spawnsForChunk(x, z, false)).toEqual(first)
      for (const animal of first) if (EXPLORATION_SPECIES.includes(animal.species)) {
        expect(habitatAllows(animal.species, animal.x, animal.z)).toBe(true)
        found.set(animal.species, animal)
      }
    }
    expect([...found.keys()].sort()).toEqual([...EXPLORATION_SPECIES].sort())
    expect(selectPopulation([...found.values()], 0, 0, 3, 10000)).toHaveLength(3)
  })

  it.each(EXPLORATION_SPECIES)("keeps %s encounters peaceful and grounded", species => {
    let spawn: ReturnType<typeof spawnsForChunk>[number] | undefined
    for (let x = -60; x <= 60 && !spawn; x += 3) for (let z = -60; z <= 60 && !spawn; z += 3) {
      spawn = spawnsForChunk(x, z, false).find(a => a.species === species)
    }
    expect(spawn).toBeDefined()
    const animal = createAnimalAgent(spawn!)
    const visitor = { x: animal.x + 3, z: animal.z, speed: 0, facing: 0 }
    for (let i = 0; i < 120; i++) {
      thinkAnimal(animal, visitor, 0.1, true)
      moveAnimal(animal, visitor, 0.1)
      expect([animal.x, animal.y, animal.z, animal.heading, animal.speed].every(Number.isFinite)).toBe(true)
      expect(habitatAllows(species, animal.x, animal.z, false)).toBe(true)
      expect(animal.speed).toBeLessThanOrEqual(ANIMAL_PROFILE[species].walk * 1.16)
      expect(["idle", "wander", "graze", "sit", "watch", "return", "sleep", "drink", "shelter"]).toContain(animal.state)
    }
  })
})
