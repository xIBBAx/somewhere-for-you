import { describe, expect, it } from "vitest"
import { edgeSpeedLimit, sailSpeedLimit } from "../src/game/celestial/starSail"

describe("the edge of the world", () => {
  it("leaves the sail alone inside the edge", () => {
    expect(edgeSpeedLimit(1e11, -5e9)).toBe(Infinity)
    expect(edgeSpeedLimit(1e11, 0)).toBe(Infinity)
  })
  it("bleeds the outward speed away past it, never below a gentle drift", () => {
    const at = (b: number): number => edgeSpeedLimit(1e11, b)
    expect(at(1e9)).toBeLessThan(sailSpeedLimit(1e11))
    expect(at(1e10)).toBeLessThan(at(1e9))
    expect(at(1e12)).toBeGreaterThan(0)
    // a sixth of the edge past it, the sail is a tiny fraction of what it was
    expect(at(1e11 / 6)).toBeLessThan(sailSpeedLimit(1e11) * 0.1)
  })
})

describe("the star pirouette (W W on the sails)", async () => {
  const { sailRT, startStarPirouette, STAR_PIROUETTE } = await import("../src/game/celestial/starSail")
  const { makeIdentity } = await import("../src/game/horses/breeds")
  const { makeHorseState } = await import("../src/game/horses/horseState")
  const { flightOf } = await import("../src/game/pegasus/flight")
  it("starts only on the sails and only once at a time", () => {
    const h = makeHorseState(makeIdentity(9, "starborn", { saddled: true, scale: 1 }), 0, 0, true)
    const f = flightOf(h)!
    f.mode = "air"
    expect(startStarPirouette(h, 1)).toBe(false)
    f.mode = "sail"
    expect(startStarPirouette(h, -1)).toBe(true)
    expect(startStarPirouette(h, 1)).toBe(false)
    expect(sailRT.pirouetteDir).toBe(-1)
    expect(STAR_PIROUETTE).toBeGreaterThan(1)
    sailRT.pirouette = -1
  })
})
