import { describe, expect, it } from "vitest"
import { erodedWildHeight, erosionStats } from "../src/world/erosion"
import { rawWildHeight } from "../src/world/baseTerrain"
import { worldHeight } from "../src/world/terrain"

describe("bounded drainage erosion", () => {
  it("preserves home terrain and produces finite reproducible wild heights", () => {
    expect(erodedWildHeight(0, 0)).toBe(rawWildHeight(0, 0))
    let changed = 0
    for (let x = 700; x < 1300; x += 37)
      for (let z = 700; z < 1100; z += 53) {
        const a = erodedWildHeight(x, z)
        expect(a).toBe(erodedWildHeight(x, z))
        expect(Number.isFinite(a)).toBe(true)
        expect(Math.abs(a - rawWildHeight(x, z))).toBeLessThan(2.76)
        if (Math.abs(a - rawWildHeight(x, z)) > 0.001) changed++
      }
    expect(changed).toBeGreaterThan(10)
    expect(erosionStats.regions).toBeLessThanOrEqual(1024)
  })
  it("joins region and terrain chunk boundaries continuously", () => {
    for (const x of [768, 960, 1152, -768])
      for (const z of [711, 832, 1001]) {
        const e = 0.0001
        expect(Math.abs(worldHeight(x - e, z) - worldHeight(x + e, z))).toBeLessThan(0.002)
        const dl = (worldHeight(x, z) - worldHeight(x - e, z)) / e,
          dr = (worldHeight(x + e, z) - worldHeight(x, z)) / e
        expect(Math.abs(dl - dr)).toBeLessThan(0.03)
      }
  })
})
