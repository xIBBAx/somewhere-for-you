import { describe, expect, it } from "vitest"
import { POND, POND_LILY_PADS, WATER_Y, keepOffLilyPads } from "../src/world/hubLayout"
import { groundHeight } from "../src/game/world-layout"

describe("pond lily leaves", () => {
  it("float wholly over the pond's water, rim included", () => {
    for (const pad of POND_LILY_PADS) {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2
        for (const k of [0, 0.5, 1]) {
          expect(groundHeight(pad.x + Math.cos(a) * pad.r * k, pad.z + Math.sin(a) * pad.r * k)).toBeLessThan(WATER_Y - 0.05)
        }
      }
      expect(Math.hypot(pad.x - POND.x, pad.z - POND.z)).toBeLessThan(POND.r)
    }
  })

  it("never lie on top of one another", () => {
    for (let i = 0; i < POND_LILY_PADS.length; i++) {
      for (let j = i + 1; j < POND_LILY_PADS.length; j++) {
        const a = POND_LILY_PADS[i], b = POND_LILY_PADS[j]
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(a.r + b.r)
      }
    }
  })

  it("moves a swimmer from under a leaf to just beyond its rim, and leaves open water alone", () => {
    const pad = POND_LILY_PADS[0]
    const p = { x: pad.x + 0.2, z: pad.z }
    expect(keepOffLilyPads(p, 0.18)).toBe(true)
    expect(Math.hypot(p.x - pad.x, p.z - pad.z)).toBeCloseTo(pad.r + 0.18, 5)
    const centre = { x: pad.x, z: pad.z }
    keepOffLilyPads(centre, 0.1)
    expect(Math.hypot(centre.x - pad.x, centre.z - pad.z)).toBeGreaterThanOrEqual(pad.r + 0.1 - 1e-9)
    const open = { x: POND.x - 2.2, z: POND.z - 1.4 }
    expect(keepOffLilyPads(open, 0.18)).toBe(false)
  })
})
