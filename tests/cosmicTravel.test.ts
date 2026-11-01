import { beforeEach, describe, expect, it } from "vitest"
import * as THREE from "three"
import { makeIdentity } from "../src/game/horses/breeds"
import { makeHorseState, type HorseState } from "../src/game/horses/horseState"
import { flightOf } from "../src/game/pegasus/flight"
import { resetTravelState, dropOut, skipJourney, startJourney, stepTravel, travelRT, type TravelPhase } from "../src/game/celestial/cosmicTravel"
import { spaceRT } from "../src/game/celestial/spaceState"
import { bodyById, updateUniverse } from "../src/game/celestial/universe"
import { earthFrame } from "../src/game/celestial/frames"
import { DATUM_Y } from "../src/game/celestial/scale"
import { sailRT, sailThrottleSpeed, stepSail } from "../src/game/celestial/starSail"
import { l1Point } from "../src/game/celestial/spaceCats/journey"

let h: HorseState
beforeEach(() => {
  updateUniverse(0.2, new Date("2026-10-20T12:00:00Z"))
  h = makeHorseState(makeIdentity(70303, "starborn", { saddled: true, scale: 1 }), 0, 0, true)
  flightOf(h)
  h.y = DATUM_Y + 600
  h.flight!.mode = "air"
  travelRT.phase = "idle"
  travelRT.journeys = 0
  travelRT.arrived = null
  spaceRT.mode = "local"
  spaceRT.realm = "earth"
  spaceRT.frame = earthFrame()
  spaceRT.frozenTime = null
  sailRT.autopilot = null
  sailRT.pilot = h
})

const reach = (phase: TravelPhase) => {
  for (let n = 0; n < 500 && travelRT.phase !== phase; n++) stepTravel(h, 0.1)
  expect(travelRT.phase).toBe(phase)
}

describe("cosmic journey continuity", () => {
  it("reaches the cats rather than treating their non-body destination as failure", () => {
    expect(startJourney(h, { kind: "cats" })).toBeNull()
    skipJourney()
    stepTravel(h, 0.016)
    const cats = new THREE.Vector3()
    expect(l1Point(cats)).toBe(true)
    expect(spaceRT.pos.distanceTo(cats)).toBeCloseTo(40, 4)
    expect(travelRT.arrived).toBe("cats")
    expect(sailRT.autopilot?.kind).toBe("cats")
  })

  for (const phase of ["gather", "corridor", "emerge"] as const) {
    it(`Arrive now finishes the whole journey from ${phase}`, () => {
      startJourney(h, { kind: "body", id: "mars" })
      reach(phase)
      skipJourney()
      stepTravel(h, 0.016)
      expect(travelRT.phase).toBe("idle")
      expect(travelRT.journeys).toBe(1)
      expect(spaceRT.pos.distanceTo(bodyById("mars")!.pos)).toBeCloseTo(bodyById("mars")!.radius * 1.9, 3)
      expect(h.flight!.mode).toBe("sail")
    })
  }

  it("quick home and skipping reentry leave the rider flying above home", () => {
    startJourney(h, { kind: "body", id: "mars" })
    skipJourney(); stepTravel(h, 0.016)
    startJourney(h, { kind: "earth" })
    reach("reentry")
    skipJourney(); stepTravel(h, 0.016)
    expect(travelRT.phase).toBe("idle")
    expect(spaceRT.mode).toBe("local")
    expect(spaceRT.realm).toBe("earth")
    expect(h.y - DATUM_Y).toBe(520)
    expect(h.flight!.mode).toBe("air")
    expect(sailRT.autopilot).toBeNull()
  })

  for (const phase of ["gather", "corridor", "emerge", "reentry"] as const) {
    it(`Escape hands back control during ${phase}`, () => {
      if (phase === "reentry") {
        startJourney(h, { kind: "body", id: "mars" }); skipJourney(); stepTravel(h, 0.016)
        startJourney(h, { kind: "earth" })
      } else startJourney(h, { kind: "body", id: "venus" })
      reach(phase)
      dropOut(h)
      expect(travelRT.phase).toBe("idle")
      expect(sailRT.autopilot).toBeNull()
      expect(h.flight!.mode).toBe(spaceRT.mode === "local" ? "air" : "sail")
      expect(Number.isFinite(h.x + h.y + h.z)).toBe(true)
    })
  }

  it("losing the pilot releases the corridor sound, heat and queued skip", () => {
    startJourney(h, { kind: "body", id: "mars" })
    reach("corridor")
    stepTravel(h, 0.1)
    expect(travelRT.intensity).toBeGreaterThan(0)
    skipJourney()
    resetTravelState()
    expect(travelRT.phase).toBe("idle")
    expect(travelRT.intensity + travelRT.flash + travelRT.heat + travelRT.pull).toBe(0)
    expect(travelRT.dest).toBeNull()
    startJourney(h, { kind: "body", id: "venus" })
    stepTravel(h, 0.016)
    expect(travelRT.phase).toBe("gather")
  })

  it("offers a continuous gentle gear beside even the Sun", () => {
    expect(sailThrottleSpeed(30_000_000, 0.12)).toBeLessThan(20)
    expect(sailThrottleSpeed(30_000_000, 0.04)).toBeGreaterThan(0)
    expect(sailThrottleSpeed(30_000_000, 0.250001) - sailThrottleSpeed(30_000_000, 0.25)).toBeLessThan(0.01)
    expect(sailThrottleSpeed(30_000_000, 1)).toBe(30_000_000)
    expect(sailThrottleSpeed(38, 0.8)).toBeLessThanOrEqual(38)
  })

  it("manual steering cancels a course and released climb levels the sail", () => {
    startJourney(h, { kind: "body", id: "mars" }); skipJourney(); stepTravel(h, 0.016)
    sailRT.autopilot = { kind: "target", id: "venus" }
    h.flight!.pitch = 1.25
    h.flight!.intent.turn = 0.5
    stepSail(h, 0.1)
    expect(sailRT.autopilot).toBeNull()
    h.flight!.intent.turn = 0
    for (let n = 0; n < 60; n++) stepSail(h, 0.1)
    expect(Math.abs(h.flight!.pitch)).toBeLessThan(0.05)
  })
})
