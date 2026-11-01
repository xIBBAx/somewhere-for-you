import { describe, expect, it } from "vitest"
import { distanceSquared, FlightClock, flightPoint, flightRandom, identitySeed } from "../src/game/animals/flying/primitives"
import { FlightSpatialGrid } from "../src/game/animals/flying/spatial"

describe("flying simulation foundations", () => {
  it("replays the same continuous trajectory at 30, 60 and 144 render Hz", () => {
    const run = (hz: number) => {
      const clock = new FlightClock()
      const random = flightRandom(identitySeed("robin-1", 20260907))
      let velocity = 0, position = 0, acceleration = 0
      for (let frame = 0; frame < hz * 20; frame++) clock.advance(1 / hz, (dt, tick) => {
        if (tick % 30 === 0) acceleration = random() * 2 - 1
        velocity += acceleration * dt
        position += velocity * dt
      })
      return { ticks: clock.ticks, position, velocity, lost: clock.discardedSeconds }
    }
    expect(run(30)).toEqual(run(60))
    expect(run(144)).toEqual(run(60))
    expect(run(60).ticks).toBe(1200)
  })

  it("caps suspended-tab catch-up without large motion steps", () => {
    const clock = new FlightClock()
    const steps: number[] = []
    expect(clock.advance(120, dt => steps.push(dt))).toBe(8)
    expect(steps.every(dt => dt === 1 / 60)).toBe(true)
    expect(clock.discardedSeconds).toBeCloseTo(120 - 8 / 60)
    expect(clock.interpolation).toBeLessThan(1)
    expect(() => clock.advance(NaN, () => undefined)).toThrow(RangeError)
  })

  it("keeps identity randomness independent of registration order and global randomness", () => {
    const draw = (id: string) => {
      const random = flightRandom(identitySeed(id, 7))
      return Array.from({ length: 8 }, random)
    }
    const robin = draw("robin")
    expect(draw("bluebird")).not.toEqual(robin)
    expect(draw("robin")).toEqual(robin)
    expect(identitySeed("robin", 8)).not.toBe(identitySeed("robin", 7))
  })

  it("matches a brute-force 3D oracle across negative coordinates, collisions and bounded results", () => {
    const random = flightRandom(91)
    const agents = Array.from({ length: 240 }, () => ({ position: flightPoint(random() * 60 - 30, random() * 12 - 3, random() * 60 - 30) }))
    // Deliberately force all cells into one bucket to exercise collision handling.
    const grid = new FlightSpatialGrid(240, 3, 1)
    grid.rebuild(agents)
    const result = new Int32Array(7)
    for (let query = 0; query < agents.length; query += 3) {
      const point = agents[query].position
      const count = grid.query(point, 9, result, query)
      const oracle = agents.map((agent, index) => ({ index, d: distanceSquared(point, agent.position) }))
        .filter(a => a.index !== query && a.d <= 81)
        .sort((a, b) => a.d - b.d || a.index - b.index).slice(0, 7).map(a => a.index)
      expect([...result.slice(0, count)]).toEqual(oracle)
    }
  })

  it("uses altitude and cell locality and removes stale occupants after rebuild", () => {
    const agents = Array.from({ length: 240 }, (_, i) => ({ position: flightPoint(i * 5, 0, 0) }))
    agents[1].position = flightPoint(0, 10, 0)
    const grid = new FlightSpatialGrid(240)
    const result = new Int32Array(8)
    grid.rebuild(agents)
    expect(grid.query(flightPoint(), 3, result)).toBe(1)
    expect(grid.candidatesVisited).toBeLessThan(10)
    agents[0].position.x = 50
    grid.rebuild(agents)
    expect(grid.query(flightPoint(), 3, result)).toBe(0)
    grid.rebuild([])
    expect(grid.query(flightPoint(50), 3, result)).toBe(0)
  })
})
