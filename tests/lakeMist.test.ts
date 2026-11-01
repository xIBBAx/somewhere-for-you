import { describe, expect, it } from "vitest"
import { MIST_CELL, mistAmount, mistPuffsNear } from "../src/world/render/LakeMist"
import { waterDepthAt } from "../src/world/waterSurface"

describe("lake mist", () => {
  it("gathers in cool, still, humid air and burns off in wind and daylight", () => {
    const dusk = mistAmount(0.8, 0, 0, 0.1, false, false)
    expect(dusk).toBeGreaterThan(mistAmount(0, 0, 0, 0.1, false, false))
    expect(mistAmount(0.8, 0, 0, 0.1, false, true)).toBeGreaterThan(dusk)
    expect(mistAmount(0, 0, 0, 0.1, true, false)).toBeGreaterThan(0.8)
    expect(mistAmount(0.8, 0, 0, 1, false, true)).toBeLessThan(0.1)
    expect(mistAmount(0, 0, 0, 0, false, false)).toBe(0)
  })

  it("places stable puffs over open water only", () => {
    // the debug lake finder's first deep lake lies near here (seeded world)
    const a = mistPuffsNear(-265, -195), b = mistPuffsNear(-265 + MIST_CELL * 0.3, -195)
    expect(a.length).toBeGreaterThan(0)
    for (const p of a) expect(waterDepthAt(p.x, p.z)).toBeGreaterThanOrEqual(0.7)
    const shared = a.filter(p => b.some(q => q.x === p.x && q.z === p.z))
    expect(shared.length).toBeGreaterThan(a.length * 0.6)
  })
})
