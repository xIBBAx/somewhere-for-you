import { describe, expect, it } from "vitest"
import { woodlandOpening } from "../src/world/chunkGen"

describe("woodland trails and glades", () => {
  it("is deterministic, bounded and spatially continuous", () => {
    let open = 0
    let closed = 0
    for (let z = -1000; z <= 1000; z += 20) {
      for (let x = -1000; x <= 1000; x += 20) {
        const v = woodlandOpening(x, z)
        expect(v).toBe(woodlandOpening(x, z))
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
        if (v > 0.95) open++
        if (v < 0.05) closed++
        expect(Math.abs(woodlandOpening(x + 1, z) - v)).toBeLessThan(0.35)
      }
    }
    // forests get real openings, but most woodland stays woodland
    expect(open).toBeGreaterThan(200)
    expect(closed).toBeGreaterThan(open)
  })
})
