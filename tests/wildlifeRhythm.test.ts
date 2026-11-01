import { afterEach, describe, expect, it } from "vitest"
import { chunkColliders } from "../src/world/colliders"
import { createAnimalAgent, moveAnimal, separateAnimals, spreadAlarm, thinkAnimal } from "../src/world/wildlife/behavior"
import { activityLevel, findShelter } from "../src/world/wildlife/rhythm"
import type { AnimalSpawn } from "../src/world/wildlife/population"

const spawn: AnimalSpawn = { id: "rabbit:test", species: "rabbit", coat: 0, seed: 4242, scale: 1, x: 190, z: 200 }
const far = { x: 900, z: 900, speed: 0, facing: 0 }
afterEach(() => chunkColliders.clear())

describe("wildlife rhythms", () => {
  it("keeps species hours: twilight rabbits, night tigers, rain-loving ducks", () => {
    expect(activityLevel("rabbit", { tod: 0.78, rain: 0 })).toBeGreaterThan(activityLevel("rabbit", { tod: 0, rain: 0 }))
    expect(activityLevel("tiger", { tod: 1, rain: 0 })).toBeGreaterThan(activityLevel("tiger", { tod: 0, rain: 0 }))
    expect(activityLevel("monkey", { tod: 1, rain: 0 })).toBeLessThan(0.3)
    expect(activityLevel("duck", { tod: 0, rain: 1 })).toBe(activityLevel("duck", { tod: 0, rain: 0 }))
    expect(activityLevel("fox", { tod: 0.8, rain: 1 })).toBeLessThan(activityLevel("fox", { tod: 0.8, rain: 0 }))
  })

  it("wakes ordinary sleepers but lets landmark nappers sleep on", () => {
    const rabbit = createAnimalAgent(spawn)
    rabbit.state = "sleep"; rabbit.timer = 0.05
    thinkAnimal(rabbit, far, 0.1, false)
    expect(rabbit.state).toBe("idle")
    const napper = createAnimalAgent({ ...spawn, species: "cat", sleeper: true })
    napper.timer = 0
    thinkAnimal(napper, far, 0.1, false)
    expect(napper.state).toBe("sleep")
  })

  it("walks to the lee side of a nearby tree in the rain and rests there", () => {
    chunkColliders.set("3,3", [{ x: 196, z: 200, r: 0.4, height: 4.5 }])
    const spot = findShelter(190, 200, 0.2, 14, 1, 0)
    expect(spot).not.toBeNull()
    expect(spot!.x).toBeGreaterThan(196)
    const rabbit = createAnimalAgent(spawn)
    rabbit.thirst = 0; rabbit.timer = 0
    const env = { tod: 0, rain: 0.9, windX: 1, windZ: 0 }
    thinkAnimal(rabbit, far, 0.1, false, env)
    expect(rabbit.state).toBe("shelter")
    for (let i = 0; i < 400 && !rabbit.sheltered; i++) { thinkAnimal(rabbit, far, 0.05, false, env); moveAnimal(rabbit, far, 0.05) }
    expect(rabbit.sheltered).toBe(true)
    expect(Math.hypot(rabbit.x - 196, rabbit.z - 200)).toBeLessThan(1.6)
  })

  it("spreads a rabbit's alarm through its group exactly once", () => {
    const a = createAnimalAgent(spawn), b = createAnimalAgent({ ...spawn, id: "rabbit:b", x: 193, seed: 99 })
    const c = createAnimalAgent({ ...spawn, id: "rabbit:c", x: 230, seed: 7 })
    a.state = "flee"; a.tx = a.x - 12; a.tz = a.z
    expect(spreadAlarm([a, b, c])).toBe(1)
    expect(b.state).toBe("flee")
    expect(b.tx).toBeLessThan(b.x)
    expect(c.state).not.toBe("flee")
    expect(spreadAlarm([a, b, c])).toBe(0)
  })

  it("stays deterministic with the environment in play", () => {
    const a = createAnimalAgent(spawn), b = createAnimalAgent(spawn)
    const env = { tod: 0.8, rain: 0.3, windX: 0, windZ: 1 }
    for (let i = 0; i < 600; i++) for (const x of [a, b]) { thinkAnimal(x, far, 0.05, false, env); moveAnimal(x, far, 0.05) }
    expect([a.x, a.z, a.state, a.thirst]).toEqual([b.x, b.z, b.state, b.thirst])
    expect(Number.isFinite(a.x + a.z + a.heading)).toBe(true)
  })
})

describe("wildlife personal space", () => {
  it("eases overlapping animals apart but leaves sleepers in place", () => {
    const a = createAnimalAgent({ ...spawn, id: "rabbit:a" }), b = createAnimalAgent({ ...spawn, id: "rabbit:b", x: 190.05 })
    const napper = createAnimalAgent({ ...spawn, id: "cat:n", species: "cat", sleeper: true, x: 191 })
    const list = [a, b, napper]
    for (let i = 0; i < 60; i++) separateAnimals(list, 1 / 30)
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.45)
    expect(napper.x).toBe(191)
  })
})
