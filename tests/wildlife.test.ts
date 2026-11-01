import { afterEach, describe, expect, it } from "vitest"
import { generateChunk } from "../src/world/chunkGen"
import { chunkColliders, collidersForChunk, pushOutOfScatter } from "../src/world/colliders"
import { createAnimalAgent, moveAnimal, thinkAnimal } from "../src/world/wildlife/behavior"
import { clearOfColliders, habitatAllows, selectPopulation, spawnsForChunk, wildlifeTier, type AnimalSpawn } from "../src/world/wildlife/population"

const spawn: AnimalSpawn = { id: "cat:test", species: "cat", coat: 0, seed: 819, scale: 1, x: 190, z: 200 }
afterEach(() => chunkColliders.clear())

describe("streamed wildlife", () => {
  it("reconstructs identical safe populations in distant positive and negative chunks", () => {
    let seen = 0
    for (const [cx, cz] of [[3, 4], [-5, 12], [84, -71], [-117, 52], [0, -8], [8, 6], [14, 15], [120, 82]]) {
      const p = generateChunk(cx, cz), colliders = collidersForChunk(p)
      const a = spawnsForChunk(cx, cz, p.hasWater, colliders)
      expect(a).toEqual(spawnsForChunk(cx, cz, p.hasWater, colliders))
      for (const s of a) {
        seen++
        expect(habitatAllows(s.species, s.x, s.z)).toBe(true)
        expect(clearOfColliders(s.x, s.z, 0.12, colliders)).toBe(true)
        expect(Math.floor(s.x / 64)).toBe(cx)
        expect(Math.floor(s.z / 64)).toBe(cz)
      }
    }
    expect(seen).toBeGreaterThan(2)
  })

  it("bounds live populations while visiting thousands of regions and deduplicates friends", () => {
    const candidates = Array.from({ length: 3000 }, (_, i) => ({ ...spawn, id: `cat:${i}`, x: i - 1500, z: (i % 7) * 2 }))
    const selected = selectPopulation([...candidates, candidates[1500]], 0, 0, 28, 120)
    expect(selected).toHaveLength(28)
    expect(new Set(selected.map(s => s.id)).size).toBe(28)
    expect(selected.every(s => Math.hypot(s.x, s.z) < 120)).toBe(true)
    expect(selectPopulation(candidates, 10000, 10000, 28, 120)).toEqual([])
    expect([10, 45, 95, 160].map(d => wildlifeTier(d))).toEqual(["near", "middle", "far", "off"])
  })

  it("handles border obstacles and exact centre overlap without NaN", () => {
    chunkColliders.set("1,0", [{ x: 64.1, z: 12, r: 0.6 }])
    const p = { x: 63.95, z: 12 }
    expect(pushOutOfScatter(p, 0.25, 64)).toBe(true)
    expect(Math.hypot(p.x - 64.1, p.z - 12)).toBeGreaterThanOrEqual(0.8499)
    const centre = { x: 64.1, z: 12 }
    expect(pushOutOfScatter(centre, 0.25, 64)).toBe(true)
    expect(Number.isFinite(centre.x + centre.z)).toBe(true)
  })

  it("uses independent seeded timing and returns the same behavior on replay", () => {
    const a = createAnimalAgent(spawn), b = createAnimalAgent(spawn), other = createAnimalAgent({ ...spawn, seed: 37 })
    expect(a.timer).not.toBe(other.timer)
    const p = { x: 230, z: 240, speed: 0, facing: 0 }
    for (let i = 0; i < 500; i++) for (const animal of [a, b]) { thinkAnimal(animal, p, 0.05, true); moveAnimal(animal, p, 0.05) }
    expect([a.x, a.z, a.state, a.heading]).toEqual([b.x, b.z, b.state, b.heading])
    expect(a.travelled).toBeGreaterThan(0)
    expect(habitatAllows(a.species, a.x, a.z)).toBe(true)
  })

  it("supports movement above 120fps and does not skate against obstacles", () => {
    const a = createAnimalAgent(spawn)
    a.tx = a.x + 4; a.targetSpeed = 0.55
    const p = { x: 230, z: 240, speed: 0, facing: 0 }
    for (let i = 0; i < 240; i++) moveAnimal(a, p, 1 / 120)
    expect(a.travelled).toBeGreaterThan(0.3)
    const stopped = createAnimalAgent(spawn)
    stopped.tx = stopped.x; stopped.tz = stopped.z; stopped.speed = 2
    moveAnimal(stopped, p, 0.05)
    expect(stopped.speed).toBe(0)
  })

  it("reacts by species, safely handles zero-distance threats, and leashes fleeing animals", () => {
    const rabbit = createAnimalAgent({ ...spawn, species: "rabbit" })
    rabbit.reactTimer = 0
    thinkAnimal(rabbit, { x: rabbit.x, z: rabbit.z, speed: 6.6, facing: 0 }, 0.1, true)
    expect(rabbit.state).toBe("flee")
    expect(Number.isFinite(rabbit.tx + rabbit.tz)).toBe(true)
    rabbit.state = "idle"; rabbit.x += 60; rabbit.friendTime = 0
    thinkAnimal(rabbit, { x: 900, z: 900, speed: 0, facing: 0 }, 0.1, false)
    expect(rabbit.state).toBe("return")
    expect(rabbit.tx).toBe(spawn.x)
    const cat = createAnimalAgent({ ...spawn, sleeper: true })
    thinkAnimal(cat, { x: cat.x, z: cat.z, speed: 6.6, facing: 0 }, 0.1, true)
    expect(cat.state).toBe("sleep")
  })
})
