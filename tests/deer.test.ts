import { beforeEach, describe, expect, it } from "vitest"
import { canCarryRider, deerIdentity, deerSpeeds, hasAntlers, SPECIES_IDS } from "../src/game/deer/species"
import {
  acceptsRider,
  gentleTouch,
  observePerson,
  relationship,
  relationships,
  frighten,
} from "../src/game/deer/relationships"
import {
  deerMemories,
  MAX_DEER_MEMORIES,
  parseDeerMemories,
  rememberDeer,
  restoreRelationship,
} from "../src/game/deer/persistence"
import { makeDeer } from "../src/game/deer/state"
import { shareDeerSignals, stepDeerBrain } from "../src/game/deer/brain"
import { routineAt, territoryAt } from "../src/game/deer/population"
import { climateAt } from "../src/world/climate"
import { registerDeerMount } from "../src/game/deer/interactions"
import { riderRT, resetRider, startMount } from "../src/game/horses/riding"
import { groundHeight } from "../src/game/world-layout"
import { playerRT } from "../src/game/runtime"
import { pushFromCapsule } from "../src/game/mounts/contact"

const animal = (
  species: Parameters<typeof deerIdentity>[2] = "sambar",
  age: "adult" | "fawn" = "adult",
  id = "deer:1,1:0",
) => {
  const ident = deerIdentity(id, 987, species, "family", "female", age, age === "fawn" ? "deer:1,1:0" : null)
  const home = { ident, x: -36, z: -24, shelterX: -32, shelterZ: -28, waterX: -36, waterZ: -24, hasWater: false }
  const d = makeDeer(home, 100)
  d.x = home.x
  d.z = home.z
  d.y = groundHeight(d.x, d.z)
  return d
}
beforeEach(() => {
  deerMemories.clear()
  resetRider("explorer")
  resetRider("companion")
})
describe("deer identity and biology", () => {
  it("preserves seed identity and forbids every juvenile mount", () => {
    for (const species of SPECIES_IDS) {
      const d = animal(species)
      expect(deerIdentity(d.ident.id, 987, species, "family", "female")).toEqual(d.ident)
      expect(canCarryRider(animal(species, "fawn").ident)).toBe(false)
      if (!["yak", "reindeer"].includes(species)) expect(hasAntlers(d.ident)).toBe(false)
      const speeds = deerSpeeds(d.ident)
      expect(speeds.every((v, i) => i === 0 || v > speeds[i - 1])).toBe(true)
    }
    for (const species of ["muntjac", "hog", "roe", "chital"] as const)
      expect(canCarryRider(animal(species).ident)).toBe(false)
  })
  it("makes athletic adults rare, deterministic and within horse-speed limits", () => {
    let rare = 0
    for (let s = 0; s < 2000; s++) {
      const i = deerIdentity(`deer:1,1:${s}`, s, "elk", "herd", "male")
      if (i.rare) {
        rare++
        expect(deerSpeeds(i)[3]).toBeLessThan(13)
      }
    }
    expect(rare).toBeGreaterThan(5)
    expect(rare).toBeLessThan(45)
  })
})
describe("relationship progression", () => {
  it("waiting alone cannot purchase riding; distinct gentle meetings can", () => {
    const d = animal(),
      r = relationship()
    for (let t = 0; t < 600; t++) observePerson(r, d.ident, 5, 0, 0, 1, 100 + t)
    expect(acceptsRider(r)).toBe(false)
    expect(r.trust).toBeLessThan(0.6)
    for (let n = 0; n < 4; n++) {
      for (let t = 0; t < 18; t++) observePerson(r, d.ident, 3, 0, 0, 1, 800 + n * 20 + t)
      expect(gentleTouch(r, 819 + n * 20)).toBe("accepted")
    }
    expect(acceptsRider(r)).toBe(true)
    expect(gentleTouch(r, 880)).toBe("wait")
    frighten(r, 0.8, 900)
    expect(acceptsRider(r)).toBe(false)
  })
  it("remembers people independently and detects charging a fawn", () => {
    const d = animal("sambar", "fawn"),
      r = d.relationships
    expect(observePerson(r.explorer, d.ident, 5, 6, 6, 1, 100)).toBe("threat")
    expect(r.explorer.fear).toBeGreaterThan(0.4)
    expect(r.companion).toEqual(relationship())
  })
})
describe("persistent living territories", () => {
  it("preserves identities across revisits and confines cold species", () => {
    let found = 0
    for (let x = -8; x <= 8; x++)
      for (let z = -8; z <= 8; z++) {
        const t = territoryAt(x, z)
        if (!t) continue
        found++
        expect(territoryAt(x, z)).toEqual(t)
        const climate = { ...climateAt(t.x, t.z) }
        if (t.species === "reindeer") expect(climate.temperature).toBeLessThan(-0.4)
        if (t.species === "yak") {
          expect(climate.temperature).toBeLessThan(-0.28)
          expect(climate.hills).toBeGreaterThan(0.5)
        }
        for (const h of t.members)
          if (h.ident.mother) expect(t.members.some((m) => m.ident.id === h.ident.mother)).toBe(true)
      }
    expect(found).toBeGreaterThan(30)
  })
  it("continues routines without a player and restores recent physical state", () => {
    const d = animal(),
      a = routineAt(d.home, 100),
      b = routineAt(d.home, 240)
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(1)
    d.relationships.explorer.lastSeen = 100
    rememberDeer({ id: d.ident.id, relationships: d.relationships, x: -37, z: -25, updated: 100 })
    const restored = makeDeer(d.home, 100)
    expect(restored.x).toBe(-37)
    expect(restored.z).toBe(-25)
  })
  it("bounds storage and rejects corrupt values", () => {
    for (let i = 0; i < 500; i++) {
      const r = relationships()
      r.explorer.lastSeen = 100
      r.explorer.trust = 0.8
      rememberDeer({ id: `deer:1,1:${i}`, relationships: r, x: 0, z: 0, updated: 100 })
    }
    expect(deerMemories.size).toBe(MAX_DEER_MEMORIES)
    const decoded = parseDeerMemories(JSON.stringify({ v: 1, animals: [...deerMemories.values()] }))
    expect(decoded.size).toBe(MAX_DEER_MEMORIES)
    const r = restoreRelationship("deer:1,1:499")
    r.explorer.trust = 0
    expect(deerMemories.get("deer:1,1:499")!.relationships.explorer.trust).toBe(0.8)
    expect(parseDeerMemories("corrupt").size).toBe(0)
  })
})
describe("family and mount decisions", () => {
  it("keeps people outside a rotated animal body, including its exact centre", () => {
    const animal = { x: 10, z: -8, heading: Math.PI / 2 }
    const centre = { x: 10, z: -8 }
    expect(pushFromCapsule(centre, animal, 0.6, 0.7)).toBe(true)
    expect(Math.hypot(centre.x - 10, centre.z + 8)).toBeCloseTo(0.7)
    const front = { x: 10.9, z: -8 }
    expect(pushFromCapsule(front, animal, 0.6, 0.7)).toBe(true)
    expect(front.x).toBeCloseTo(11.3)
    expect(pushFromCapsule({ x: 10, z: -10 }, animal, 0.6, 0.7)).toBe(false)
  })
  it("a nearby mother warns, a distant herd is unaffected", () => {
    const mother = animal(),
      fawn = animal("sambar", "fawn", "deer:1,1:1"),
      distant = animal("sambar", "adult", "deer:1,1:2")
    mother.ident.traits.protective = 0.9
    fawn.x += 2
    fawn.alarm = 0.9
    fawn.watchX = mother.x + 8
    fawn.watchZ = mother.z
    distant.x += 100
    shareDeerSignals([mother, fawn, distant])
    expect(mother.protect).toBe(0.9)
    expect(distant.socialAlarm).toBe(0)
    const people = [{ id: "explorer" as const, x: mother.x + 8, z: mother.z, vx: -6, vz: 0, speed: 6 }]
    stepDeerBrain(mother, { time: 100, people, rain: 0, thunder: 0 }, 0.1, new Map())
    expect(mother.mode).toBe("protect")
  })
  it("uses the shared mount sequence for rejection and earned permission", () => {
    const d = animal()
    registerDeerMount(d)
    playerRT.pos.set(d.x + 1.5, d.y, d.z)
    expect(startMount("explorer", d)).toBe("ok")
    expect(riderRT.explorer.rejected).toBe(true)
    resetRider("explorer")
    Object.assign(d.relationships.explorer, { trust: 0.85, fear: 0, kindness: 5, encounters: 3 })
    expect(startMount("explorer", d)).toBe("ok")
    expect(riderRT.explorer.rejected).toBe(false)
    resetRider("explorer")
    const fawn = animal("sambar", "fawn")
    registerDeerMount(fawn)
    expect(startMount("explorer", fawn)).toBe("small")
  })
})
