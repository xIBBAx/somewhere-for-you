import { afterEach, describe, expect, it } from "vitest"
import {
  RACER_RADIUS,
  chooseRaceCourse,
  obstaclesNear,
  planRoute,
  routeCursor,
} from "../src/game/activities/raceCourse"
import {
  isNavigationPointBlocked,
  segmentHasClearance,
  setNavigationTerrainBlocker,
  type NavPoint,
} from "../src/game/navigation/catNavigation"
import { buildColliders } from "../src/game/world-layout"
import type { CircleCollider, RectCollider } from "../src/game/world-layout"

const DISTANCES = [55, 40, 28]
const DRY = (): boolean => false
const CLEARANCE = 0.6

const routeLength = (from: NavPoint, route: NavPoint[]): number => {
  let total = 0
  let previous = from
  for (const point of route) {
    total += Math.hypot(point.x - previous.x, point.z - previous.z)
    previous = point
  }
  return total
}

/** Each leg of the route must be clear of every obstacle, starting from the start. */
const expectClearRoute = (
  start: NavPoint,
  route: NavPoint[],
  circles: CircleCollider[],
  rects: RectCollider[],
): void => {
  let previous = start
  for (const point of route) {
    expect(segmentHasClearance(previous, point, RACER_RADIUS, circles, rects)).toBe(true)
    previous = point
  }
}

afterEach(() => setNavigationTerrainBlocker(null))

describe("chooseRaceCourse", () => {
  it("runs straight to the full distance on open ground", () => {
    const course = chooseRaceCourse({ x: 0, z: 0 }, 0, DISTANCES, [], [], DRY)
    expect(course?.finish.x).toBeCloseTo(0, 6)
    expect(course?.finish.z).toBeCloseTo(55, 6)
    expect(course?.route).toEqual([course?.finish])
  })

  it("takes a straight course at another heading before planning a detour", () => {
    const building: RectCollider = { minX: -4, maxX: 4, minZ: 20, maxZ: 24, height: 4 }
    const course = chooseRaceCourse({ x: 0, z: 0 }, 0, DISTANCES, [], [building], DRY)
    expect(course?.route).toHaveLength(1)
    expect(Math.hypot(course?.finish.x ?? 0, course?.finish.z ?? 0)).toBeCloseTo(55, 6)
    expect(course?.finish.x).not.toBeCloseTo(0, 1)
    expectClearRoute({ x: 0, z: 0 }, course?.route ?? [], [], [building])
  })

  it("routes round a building wide enough to block every straight course", () => {
    const building: RectCollider = { minX: -30, maxX: 30, minZ: 20, maxZ: 24, height: 4 }
    const course = chooseRaceCourse({ x: 0, z: 0 }, 0, [55], [], [building], DRY)
    expect(course).not.toBeNull()
    if (!course) return
    expect(course.route.length).toBeGreaterThan(1)
    const length = routeLength({ x: 0, z: 0 }, course.route)
    expect(length).toBeGreaterThan(55)
    expect(length).toBeLessThan(55 * 1.4)
    expectClearRoute({ x: 0, z: 0 }, course.route, [], [building])
  })

  it("keeps the finish and the route clear of the home's trees, buildings and rocks", () => {
    const { circles, rects } = buildColliders()
    const starts = [
      { x: 0, z: 0 },
      { x: -6, z: 6 },
      { x: 8, z: 3 },
      { x: -8, z: -14 },
      { x: 14, z: 8 },
    ]
    let courses = 0
    for (const start of starts) {
      if (isNavigationPointBlocked(start, RACER_RADIUS, circles, rects)) continue
      for (const facing of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const course = chooseRaceCourse(start, facing, DISTANCES, circles, rects, DRY)
        if (!course) continue
        courses++
        expect(isNavigationPointBlocked(course.finish, RACER_RADIUS + CLEARANCE, circles, rects)).toBe(false)
        expectClearRoute(start, course.route, circles, rects)
      }
    }
    expect(courses).toBeGreaterThan(0)
  }, 20000)

  it("refuses a course from inside a walled enclosure", () => {
    const walls: RectCollider[] = [
      { minX: -3.5, maxX: 3.5, minZ: 2.5, maxZ: 3.5 },
      { minX: -3.5, maxX: 3.5, minZ: -3.5, maxZ: -2.5 },
      { minX: 2.5, maxX: 3.5, minZ: -2.5, maxZ: 2.5 },
      { minX: -3.5, maxX: -2.5, minZ: -2.5, maxZ: 2.5 },
    ]
    expect(chooseRaceCourse({ x: 0, z: 0 }, 0, DISTANCES, [], walls, DRY)).toBeNull()
  })

  it("routes round a lake the planner knows about and keeps every waypoint dry", () => {
    const isWater = (x: number, z: number): boolean => Math.abs(x) < 30 && z > 20 && z < 24
    setNavigationTerrainBlocker(isWater)
    const course = chooseRaceCourse({ x: 0, z: 0 }, 0, [55], [], [], isWater)
    expect(course).not.toBeNull()
    if (!course) return
    expect(course.route.length).toBeGreaterThan(1)
    for (const point of course.route) expect(isWater(point.x, point.z)).toBe(false)
    expect(isWater(course.finish.x, course.finish.z)).toBe(false)
    expect(routeLength({ x: 0, z: 0 }, course.route)).toBeLessThan(55 * 1.4)
  })
})

describe("planRoute", () => {
  it("walks a goal beyond one planning window in legs, round a long wall", () => {
    const wall: RectCollider = { minX: -40, maxX: 10, minZ: 29, maxZ: 31, height: 4 }
    const start = { x: 0, z: 0 }
    const goal = { x: 0, z: 60 }
    const route = planRoute(start, goal, [], [wall])
    expect(route).not.toBeNull()
    if (!route) return
    expect(route[route.length - 1]).toEqual(goal)
    expect(routeLength(start, route)).toBeGreaterThan(60)
    expectClearRoute(start, route, [], [wall])
  })

  it("returns null when the goal sits inside a closed enclosure", () => {
    const box: RectCollider[] = [
      { minX: 25, maxX: 35, minZ: 4, maxZ: 5 },
      { minX: 25, maxX: 35, minZ: -5, maxZ: -4 },
      { minX: 25, maxX: 26, minZ: -4, maxZ: 4 },
      { minX: 34, maxX: 35, minZ: -4, maxZ: 4 },
    ]
    expect(planRoute({ x: 0, z: 0 }, { x: 30, z: 0 }, [], box)).toBeNull()
  })
})

describe("routeCursor", () => {
  const route: NavPoint[] = [{ x: 1, z: 0 }, { x: 2, z: 0 }, { x: 10, z: 0 }]

  it("moves past the waypoints the racer has already reached", () => {
    expect(routeCursor(route, { x: 0, z: 0 }, 0)).toBe(1)
    expect(routeCursor(route, { x: 0.9, z: 0 }, 0)).toBe(2)
  })

  it("stops at the finish and never walks back", () => {
    expect(routeCursor(route, { x: 10, z: 0 }, 2)).toBe(2)
    expect(routeCursor(route, { x: 0, z: 0 }, 2)).toBe(2)
  })
})

describe("obstaclesNear", () => {
  it("keeps only the colliders within reach of the centre", () => {
    const near: CircleCollider = { x: 0, z: 0, r: 1 }
    const far: CircleCollider = { x: 200, z: 0, r: 1 }
    const nearRect: RectCollider = { minX: 10, maxX: 12, minZ: 0, maxZ: 2 }
    const farRect: RectCollider = { minX: 300, maxX: 302, minZ: 0, maxZ: 2 }
    const kept = obstaclesNear({ x: 0, z: 0 }, 80, [near, far], [nearRect, farRect])
    expect(kept.circles).toEqual([near])
    expect(kept.rects).toEqual([nearRect])
  })
})
