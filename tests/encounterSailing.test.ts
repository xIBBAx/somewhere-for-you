import { beforeEach, describe, expect, it } from "vitest"
import { makeIdentity } from "../src/game/horses/breeds"
import { makeHorseState, type HorseState } from "../src/game/horses/horseState"
import { flightOf } from "../src/game/pegasus/flight"
import { resetTravelState, skipJourney, startJourney, stepTravel } from "../src/game/celestial/cosmicTravel"
import { spaceRT } from "../src/game/celestial/spaceState"
import { updateUniverse } from "../src/game/celestial/universe"
import { earthFrame } from "../src/game/celestial/frames"
import { DATUM_Y } from "../src/game/celestial/scale"
import { encounterSpeedLimit, sailRT, stepSail } from "../src/game/celestial/starSail"

let horse: HorseState
beforeEach(() => {
  updateUniverse(0.2, new Date("2026-10-20T12:00:00Z"))
  resetTravelState()
  horse = makeHorseState(makeIdentity(70305, "starborn", { saddled: true }), 0, 0, true)
  flightOf(horse)
  horse.y = DATUM_Y + 600; horse.flight!.mode = "air"
  spaceRT.mode = "local"; spaceRT.realm = "earth"; spaceRT.frame = earthFrame()
  sailRT.pilot = horse; sailRT.autopilot = null; sailRT.encounter = null
})
const arrive = (id: string): void => {
  expect(startJourney(horse, { kind: "body", id }, "quick")).toBeNull()
  skipJourney(); stepTravel(horse, 1 / 60)
}

describe("carefree close-world sailing", () => {
  it.each(["sun", "jupiter"])("keeps fifteen seconds of held W controllable at %s", id => {
    arrive(id)
    const start = spaceRT.pos.clone()
    horse.flight!.intent.thrust = 1
    horse.flight!.intent.turn = 0.12
    for (let n = 0; n < 900; n++) {
      stepSail(horse, 1 / 60)
      expect(horse.speed).toBeLessThanOrEqual(60.00001)
    }
    expect(sailRT.encounter?.bodyId).toBe(id)
    expect(spaceRT.pos.distanceTo(start)).toBeGreaterThan(100)
    expect(Math.abs(horse.heading)).toBeGreaterThan(0.1)
    expect(horse.flight!.throttle).toBe(1)
  })
  it("allows Dash to leave fast and releases it with ordinary smooth deceleration", () => {
    arrive("sun"); stepSail(horse, 1 / 60)
    const f = horse.flight!
    f.throttle = 1; f.intent.boost = true
    stepSail(horse, 0.001)
    const fast = horse.speed
    expect(fast).toBeGreaterThan(60)
    expect(sailRT.encounter).not.toBeNull()
    f.intent.boost = false
    stepSail(horse, 0.001)
    expect(horse.speed).toBeLessThan(fast)
    expect(horse.speed).toBeGreaterThan(fast * 0.99)
  })
  it("feathers into ordinary cosmic speed without a boundary jump", () => {
    const normal = 30_000_000
    expect(encounterSpeedLimit(normal, 1500)).toBe(60)
    expect(encounterSpeedLimit(normal, 1500.01) - 60).toBeLessThan(0.001)
    expect(encounterSpeedLimit(normal, 1800)).toBeGreaterThan(60)
    expect(encounterSpeedLimit(normal, 2249.99) / normal).toBeGreaterThan(0.99999)
    expect(encounterSpeedLimit(normal, 2250)).toBeCloseTo(normal, 6)
  })
  it("does not cap a guided course and discards the anchor on a new trip or frame", () => {
    arrive("sun"); stepSail(horse, 1 / 60)
    expect(sailRT.encounter).not.toBeNull()
    sailRT.autopilot = { kind: "target", id: "jupiter" }
    horse.flight!.throttle = 1
    stepSail(horse, 0.1)
    expect(sailRT.encounter).toBeNull()
    expect(horse.speed).toBeGreaterThan(60)
    arrive("sun"); stepSail(horse, 1 / 60)
    const before = sailRT.encounter
    expect(before).not.toBeNull()
    spaceRT.frame = earthFrame()
    stepSail(horse, 1 / 60)
    expect(sailRT.encounter).not.toBe(before)
  })
})
