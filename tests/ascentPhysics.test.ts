import { describe, expect, it } from "vitest"
import { EARTH_SCALE, realAirDensity } from "../src/game/celestial/scale"
import { airSpeedCap } from "../src/game/celestial/starSail"

const game = (realKm: number): number => (realKm * 1000) / EARTH_SCALE
const kms = (gameSpeed: number): number => (gameSpeed * EARTH_SCALE) / 1000

describe("the real atmosphere (US Standard Atmosphere 1976)", () => {
  it("matches the table and falls off smoothly", () => {
    expect(realAirDensity(0)).toBe(1)
    expect(realAirDensity(100)).toBeCloseTo(4.575e-7, 9)
    expect(realAirDensity(95)).toBeLessThan(realAirDensity(90))
    expect(realAirDensity(95)).toBeGreaterThan(realAirDensity(100))
    let last = 2
    for (let h = 0; h < 1500; h += 7) {
      const r = realAirDensity(h)
      expect(r).toBeLessThan(last)
      last = r
    }
  })
})

describe("how fast Starborn's sail may go in the air", () => {
  it("keeps the climb under ~4.5 km/s until the air is gone, so it never heats the air into a glow", () => {
    for (const h of [56, 70, 85, 99]) expect(kms(airSpeedCap(game(h), false))).toBeLessThan(4.5)
    // by ~120 km the cap has lifted far beyond anything she does in the air
    expect(kms(airSpeedCap(game(125), false))).toBeGreaterThan(100)
  })

  it("lets a return from space come in at orbital speed high up, slowing to a glide where the wings take over", () => {
    expect(kms(airSpeedCap(game(90), true))).toBeCloseTo(7.6, 1)
    expect(kms(airSpeedCap(game(56), true))).toBeLessThan(3)
    for (let h = 56; h < 100; h += 2) expect(airSpeedCap(game(h + 2), true)).toBeGreaterThanOrEqual(airSpeedCap(game(h), true) - 1e-9)
  })
})

describe("the shock layer (AscentFX.shockGlow)", () => {
  // imported lazily: AscentFX pulls in three and the stores
  it("never glows on Starborn's climb, at any height, at the fastest she may go", async () => {
    const { shockGlow } = await import("../src/game/pegasus/AscentFX")
    const { CELESTIAL_CLIMB_MAX } = await import("../src/game/pegasus/flight")
    for (let h = 0; h < 130; h += 1) {
      const alt = game(h)
      // on the wing (to ~60 km) or under sail, climbing
      const v = h < 60 ? CELESTIAL_CLIMB_MAX + 20 : airSpeedCap(alt, false)
      expect(shockGlow(alt, Math.min(v, game(10) * 10))).toBe(0)
    }
  })

  it("glows on a fast return from space through the upper air, as a real re-entry does", async () => {
    const { shockGlow } = await import("../src/game/pegasus/AscentFX")
    const v = (7.6 * 1000) / EARTH_SCALE
    expect(shockGlow(game(75), v)).toBeGreaterThan(0.4)
    // too thin for a shock layer high up, however fast; too slow lower down
    expect(shockGlow(game(130), v * 3)).toBe(0)
    expect(shockGlow(game(40), (2.5 * 1000) / EARTH_SCALE)).toBe(0)
  })
})
