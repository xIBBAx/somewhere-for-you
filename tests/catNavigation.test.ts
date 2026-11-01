import { describe, expect, it } from "vitest"
import {
  findCatPath,
  findJumpPlan,
  isNavigationPointBlocked,
  segmentHasClearance,
} from "../src/game/navigation/catNavigation"
import { buildColliders, groundHeight } from "../src/game/world-layout"
import type { CircleCollider, RectCollider } from "../src/game/world-layout"

const CAT_RADIUS = 0.2

describe("findCatPath", () => {
  it("routes around a solid obstacle and simplifies to clear waypoints", () => {
    const circles: CircleCollider[] = [{ x: 0, z: 0, r: 0.8, height: 3 }]
    const start = { x: -2, z: 0 }
    const goal = { x: 2, z: 0 }
    const path = findCatPath(start, goal, CAT_RADIUS, circles, [])
    expect(path.length).toBeGreaterThan(1)

    let previous = start
    for (const waypoint of path) {
      expect(segmentHasClearance(previous, waypoint, CAT_RADIUS, circles, [])).toBe(true)
      previous = waypoint
    }
  })

  it("uses the Cat Garden entrance instead of crossing its closed fence", () => {
    const { circles, rects } = buildColliders()
    const start = { x: 16.8, z: -1.4 }
    const goal = { x: 12.4, z: -1.4 }
    expect(segmentHasClearance(start, goal, CAT_RADIUS, circles, rects)).toBe(false)

    const path = findCatPath(start, goal, CAT_RADIUS, circles, rects)
    expect(path.length).toBeGreaterThan(1)
    let previous = start
    let routeLength = 0
    for (const waypoint of path) {
      expect(segmentHasClearance(previous, waypoint, CAT_RADIUS, circles, rects)).toBe(true)
      routeLength += Math.hypot(waypoint.x - previous.x, waypoint.z - previous.z)
      previous = waypoint
    }
    expect(routeLength).toBeGreaterThan(8)
  })

  it("ends a far leg at a clear point, never inside the tree the leg was aimed at", () => {
    // Goals beyond the planning reach are aimed at a point 27 m along the line.
    const start = { x: 0, z: 0 }
    const goal = { x: 0, z: 60 }
    const tree: CircleCollider = { x: 0, z: 27, r: 0.5, height: 4 }
    const path = findCatPath(start, goal, CAT_RADIUS, [tree], [])
    expect(path.length).toBeGreaterThan(0)
    for (const waypoint of path) {
      expect(isNavigationPointBlocked(waypoint, CAT_RADIUS, [tree], [])).toBe(false)
    }
    let previous = start
    for (const waypoint of path) {
      expect(segmentHasClearance(previous, waypoint, CAT_RADIUS, [tree], [])).toBe(true)
      previous = waypoint
    }
  })
})

describe("findJumpPlan", () => {
  const start = { x: -1.5, z: 0 }
  const goal = { x: 1.5, z: 0 }
  const flatGround = (): number => 0

  it("creates takeoff and landing points for an explicit low obstacle", () => {
    const rock: CircleCollider = {
      x: 0,
      z: 0,
      r: 0.35,
      height: 0.4,
      jumpable: true,
    }
    const plan = findJumpPlan(start, goal, CAT_RADIUS, [rock], [], flatGround)
    expect(plan).not.toBeNull()
    expect(plan?.takeoff.x).toBeLessThan(-0.45)
    expect(plan?.landing.x).toBeGreaterThan(0.45)
    expect(plan?.obstacleHeight).toBe(0.4)
  })

  it("refuses to jump a tall or non-jumpable barrier", () => {
    const wall: RectCollider = { minX: -0.2, maxX: 0.2, minZ: -2, maxZ: 2, height: 3 }
    expect(findJumpPlan(start, goal, CAT_RADIUS, [], [wall], flatGround)).toBeNull()
    expect(
      findJumpPlan(
        start,
        goal,
        CAT_RADIUS,
        [{ x: 0, z: 0, r: 0.35, height: 0.4 }],
        [],
        flatGround,
      ),
    ).toBeNull()
  })

  it("rejects a landing with an impossible terrain step", () => {
    const rock: CircleCollider = {
      x: 0,
      z: 0,
      r: 0.35,
      height: 0.4,
      jumpable: true,
    }
    const cliff = (x: number): number => (x > 0 ? 1.2 : 0)
    expect(findJumpPlan(start, goal, CAT_RADIUS, [rock], [], cliff)).toBeNull()
  })
})

describe("world navigation fixtures", () => {
  it("keeps generated world paths grounded in the same height source", () => {
    expect(groundHeight(0, -23.5)).toBeGreaterThan(groundHeight(3, -23.5))
  })
})
