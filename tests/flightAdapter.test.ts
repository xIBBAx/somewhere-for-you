import { describe, expect, it } from "vitest"
import { flightPoint } from "../src/game/animals/flying/primitives"
import { arrivalVelocity, integrateFlight } from "../src/game/animals/flying/locomotion"
import {
  createFlightFollower,
  flightWingAngle,
  flightWingHz,
  mapToFlightSpecies,
  stepFlightFollower,
} from "../src/game/animals/flying/adapter"
import { FLYING_SPECIES } from "../src/game/animals/flying/species"

describe("flight adapter (ecosystem -> bounded sim -> render pose)", () => {
  it("maps ecosystem kinds to distinct research-backed species", () => {
    expect(mapToFlightSpecies("sky-bird", 0)).toBe("goldfinch")
    expect(mapToFlightSpecies("sky-bird", 1)).toBe("robin")
    expect(mapToFlightSpecies("dragonfly")).toBe("dragonfly")
    expect(mapToFlightSpecies("bee")).toBe("honeybee")
    expect(mapToFlightSpecies("butterfly", 0, "#38bdf8")).toBe("morpho")
    expect(mapToFlightSpecies("butterfly", 0, "#f97316")).toBe("monarch")
    expect(FLYING_SPECIES.morpho.food).toEqual(["fruit"])
  })

  it("follows a moving ecosystem target without position or velocity snaps", () => {
    const flight = createFlightFollower("sky-bird-1", "robin", flightPoint(0, 18, 0))
    const target = flightPoint(2, 18, 1)
    let lastX = flight.position.x
    for (let i = 0; i < 120; i++) {
      target.x += 0.02
      const before = { ...flight.position }
      const beforeV = { ...flight.velocity }
      stepFlightFollower(flight, target, 1 / 60)
      // No teleport: one step moves less than burst * dt + epsilon.
      const moved = Math.hypot(
        flight.position.x - before.x,
        flight.position.y - before.y,
        flight.position.z - before.z,
      )
      expect(moved).toBeLessThanOrEqual(flight.profile.flight.burst / 60 + 1e-6)
      const dv = Math.hypot(
        flight.velocity.x - beforeV.x,
        flight.velocity.y - beforeV.y,
        flight.velocity.z - beforeV.z,
      )
      expect(dv).toBeLessThanOrEqual(flight.profile.flight.acceleration / 60 + flight.profile.flight.braking / 60)
      lastX = flight.position.x
    }
    expect(lastX).toBeGreaterThan(0.2)
    // Heading is driven by velocity, bank stays bounded.
    expect(Number.isFinite(flight.pose.heading)).toBe(true)
    expect(Math.abs(flight.pose.bank)).toBeLessThanOrEqual(0.95 + 1e-9)
  })

  it("advances wing phase at species rate and exposes pose-driven flap", () => {
    const gold = createFlightFollower("g", "goldfinch", flightPoint())
    const robin = createFlightFollower("r", "robin", flightPoint())
    expect(flightWingHz("goldfinch")).toBeGreaterThan(flightWingHz("robin"))
    const target = flightPoint(3, 1, 0)
    for (let i = 0; i < 60; i++) {
      stepFlightFollower(gold, target, 1 / 60)
      stepFlightFollower(robin, target, 1 / 60)
    }
    // Goldfinch (13Hz) laps robin (10.5Hz) over one second.
    expect(gold.pose.wingPhase).not.toBeCloseTo(robin.pose.wingPhase, 1)
    expect(Number.isFinite(flightWingAngle(gold))).toBe(true)
    expect(Math.abs(flightWingAngle(gold))).toBeLessThanOrEqual(1)
  })

  it("keeps arrival + integration consistent when called through the adapter", () => {
    const flight = createFlightFollower("arr", "bluebird", flightPoint(-6, 3, 0))
    flight.velocity.x = 4
    const target = flightPoint(0, 3, 0)
    const desired = flightPoint()
    const stationary = flightPoint()
    for (let i = 0; i < 600; i++) {
      arrivalVelocity(flight, target, stationary, 0, 4, desired)
      integrateFlight(flight, desired, 1 / 60)
    }
    expect(Math.abs(flight.position.x)).toBeLessThan(0.05)
  })
})
