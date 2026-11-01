import { describe, expect, it } from "vitest"
import { FlightClock, flightPoint } from "../src/game/animals/flying/primitives"
import { createFlightIndividual } from "../src/game/animals/flying/state"
import { arrivalVelocity, integrateFlight } from "../src/game/animals/flying/locomotion"
import { FLYING_SPECIES } from "../src/game/animals/flying/species"

describe("bounded flying locomotion", () => {
  it("physically brakes and reverses after a goal change without velocity or position snaps", () => {
    const bird = createFlightIndividual("turn-test", "robin", flightPoint(0, 4, 0))
    bird.mode = "powered"
    bird.velocity.x = 4
    const target = flightPoint(-4, 0, 0)
    const before = { ...bird.position }
    integrateFlight(bird, target, 1 / 60)
    expect(bird.velocity.x).toBeGreaterThan(3.8)
    expect(bird.position.x - before.x).toBeLessThan(4 / 60)
    for (let i = 0; i < 180; i++) {
      const last = { ...bird.velocity }
      integrateFlight(bird, target, 1 / 60)
      expect(Math.hypot(bird.velocity.x - last.x, bird.velocity.y - last.y, bird.velocity.z - last.z)).toBeLessThanOrEqual(bird.profile.flight.braking / 60 + 1e-10)
    }
    expect(bird.velocity.x).toBeLessThan(-3.9)
  })

  it("converges to a stationary contact with low relative speed", () => {
    const bird = createFlightIndividual("landing-test", "bluebird", flightPoint(-6, 3, 0))
    bird.mode = "approach"
    bird.velocity.x = 4
    const target = flightPoint(0, 3, 0), desired = flightPoint(), stationary = flightPoint()
    for (let i = 0; i < 600; i++) {
      arrivalVelocity(bird, target, stationary, 0, 4, desired)
      integrateFlight(bird, desired, 1 / 60)
      expect(bird.position.x).toBeLessThan(0.1)
    }
    expect(Math.abs(bird.position.x)).toBeLessThan(0.002)
    expect(Math.hypot(bird.velocity.x, bird.velocity.y, bird.velocity.z)).toBeLessThan(0.01)
    expect(bird.pose.feet).toBeGreaterThan(0.99)
    expect(bird.pose.tailFan).toBeGreaterThan(0.8)
  })

  it("produces identical integrated trajectories at different render rates", () => {
    const run = (hz: number) => {
      const bird = createFlightIndividual("replay", "goldfinch", flightPoint(0, 3, 0))
      const clock = new FlightClock()
      const target = flightPoint(3, 1, 2)
      for (let i = 0; i < hz * 10; i++) clock.advance(1 / hz, dt => integrateFlight(bird, target, dt))
      return { p: bird.position, v: bird.velocity, pose: bird.pose }
    }
    expect(run(30)).toEqual(run(60))
    expect(run(144)).toEqual(run(60))
  })

  it("keeps worker bees non-reproductive and morphos away from nectar assumptions", () => {
    for (let i = 0; i < 30; i++) {
      const bee = createFlightIndividual(`bee-${i}`, "honeybee", flightPoint())
      expect(bee.sex).toBe("female")
      expect(bee.drives.breeding).toBe(0)
      expect(bee.profile.courtship).toBe("none")
    }
    expect(FLYING_SPECIES.morpho.food).toEqual(["fruit"])
    expect(FLYING_SPECIES.bluebird.nest).toBe("cavity")
  })
})
