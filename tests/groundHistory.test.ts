import { describe, expect, it } from "vitest"
import { GroundHistory, TRACK_CAPACITY, TRACK_PROFILES } from "../src/game/environment/ground/groundHistory"
import { renderedGroundHeight, sampleGround } from "../src/game/environment/ground/groundSurface"
import { terrainHeight } from "../src/game/world-layout"

const shoe = TRACK_PROFILES.explorer
const contact = { maker: "explorer", profile: shoe, x: -1.5, z: 20.5, angle: Math.PI, speed: 1.5 }

describe("ground history physical and storage invariants", () => {
  it("rejects water; hard surfaces receive shallow temporary scuffs", () => {
    const history = new GroundHistory()
    for (const [x, z] of [[9.2, 7]]) {
      expect(history.stamp({ ...contact, x, z })).toBeUndefined()
    }
    expect(history.emitted).toBe(0)
    for (const [x, z] of [[0, -23.5], [0.8, 30.2]]) {
      const scuff = history.stamp({ ...contact, x, z, height: 0 })!
      expect(scuff.depth).toBe(0)
      expect(scuff.lifetime).toBeLessThan(25)
      expect(scuff.surface.height).toBeCloseTo(0)
    }
    history.advance(25, 0, 0)
    expect(history.tracks.filter(t => t?.active)).toHaveLength(0)
  })
  it("varies pressure by impact and maker, while grass has no carved depression", () => {
    const history = new GroundHistory()
    const walk = history.stamp(contact)!
    const run = history.stamp({ ...contact, speed: 5.2, impact: 0.7 })!
    const horse = history.stamp({ ...contact, profile: TRACK_PROFILES.horse })!
    const cat = history.stamp({ ...contact, profile: TRACK_PROFILES["companion-cat"] })!
    expect(run.depth).toBeGreaterThan(walk.depth)
    expect(horse.pressure).toBeGreaterThan(cat.pressure)
    expect(horse.shape).toBe("hoof")
    expect(cat.shape).toBe("paw")
    const grass = history.stamp({ ...contact, x: -19, z: 12 })!
    expect(grass.surface.kind).toBe("grass")
    expect(grass.depth).toBe(0)
  })
  it("wear accumulates gradually, temporary bending recovers, established traffic remains", () => {
    const history = new GroundHistory()
    const c = { ...contact, x: -19, z: 12 }
    history.stamp(c)
    const single = Math.max(...Array.from(history.activeCells, i => history.wear[i]))
    expect(single).toBeLessThan(0.10)
    const cell = Array.from(history.activeCells).sort((a, b) => history.bend[b] - history.bend[a])[0]
    const initialBend = history.bend[cell]
    history.advance(25, 0, 0)
    expect(history.bend[cell]).toBeLessThan(initialBend * 0.5)
    expect(history.bend[cell]).toBeGreaterThan(0)
    for (let i = 0; i < 130; i++) history.stamp(c)
    expect(history.wear[cell]).toBeGreaterThan(0.72)
    const established = history.wear[cell]
    history.advance(600, 0, 0)
    expect(history.wear[cell]).toBeCloseTo(established, 5)
  })
  it("rain erodes exposed tracks faster; repeated traffic destroys old clarity", () => {
    const dry = new GroundHistory(), rain = new GroundHistory()
    const a = dry.stamp(contact)!, b = rain.stamp(contact)!
    dry.advance(40, 0, 0); rain.advance(40, 1, 0)
    expect(b.age).toBeGreaterThan(a.age * 2)
    for (let i = 0; i < 8; i++) dry.stamp(contact)
    dry.advance(0.1, 0, 0)
    expect(a.active).toBe(false)
  })
  it("never exceeds capacity or leaves dangling indices when pooled slots wrap", () => {
    const history = new GroundHistory()
    for (let i = 0; i < TRACK_CAPACITY + 350; i++) history.stamp({ ...contact, x: -1.5 + i % 4 * 0.1 })
    expect(history.tracks.length).toBe(TRACK_CAPACITY)
    expect(Array.from(history.spatial.values()).reduce((n, slots) => n + slots.size, 0)).toBe(TRACK_CAPACITY)
    for (const [cell, slots] of history.spatial) for (const slot of slots) expect(history.tracks[slot]?.cell).toBe(cell)
  })
  it("creates alternating directional trackways but skips teleport and airborne travel", () => {
    const history = new GroundHistory()
    for (let i = 0; i <= 30; i++) history.observe("explorer", shoe, -1.5, 20.5 - i * 0.1, 1.5, false, 0, 1 / 15)
    const tracks = history.tracks.filter(t => t !== undefined)
    expect(tracks.length).toBeGreaterThan(3)
    for (let i = 1; i < tracks.length; i++) {
      expect(tracks[i].side).toBe(-tracks[i - 1].side)
      expect(Math.cos(tracks[i].angle)).toBeLessThan(-0.99)
      expect(Math.hypot(tracks[i].x - tracks[i - 1].x, tracks[i].z - tracks[i - 1].z)).toBeGreaterThan(0.4)
    }
    const count = history.emitted
    history.observe("explorer", shoe, 20, 15, 1.5, false, 0, 1 / 60)
    history.observe("explorer", shoe, 20, 14.7, 1.5, true, 0, 1 / 60)
    expect(history.emitted).toBe(count)
  })
  it("terrain attachment matches the actual triangle-grid vertices", () => {
    for (let iz = 20; iz < 100; iz += 13) for (let ix = 20; ix < 100; ix += 13) {
      const x = -48 + ix / 120 * 96, z = -54 + iz / 120 * 104
      expect(renderedGroundHeight(x, z)).toBeCloseTo(terrainHeight(x, z), 5)
    }
  })
  it("authored meadow remains green and wet exposed ground becomes softer", () => {
    const meadow = sampleGround(-19, 12)
    expect(meadow.grass).toBeGreaterThan(0.25)
    expect(meadow.sand).toBeLessThan(0.1)
    const dry = sampleGround(contact.x, contact.z), wet = sampleGround(contact.x, contact.z, 1)
    expect(wet.kind).toBe("mud")
    expect(wet.softness).toBeGreaterThan(dry.softness)
  })
})
