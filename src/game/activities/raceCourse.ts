import {
  findCatPath,
  isNavigationPointBlocked,
  segmentHasClearance,
  type NavPoint,
} from "../navigation/catNavigation"
import type { CircleCollider, RectCollider } from "../world-layout"

/** Footprint of a racer: the radius the other characters use against walls. */
export const RACER_RADIUS = 0.36
/** The finish keeps this much room beyond the racer's footprint from anything solid. */
const FINISH_CLEARANCE = 0.6
/** A route may be this many times longer than the straight line before it is refused. */
const MAX_DETOUR = 1.4
/** Headings tried around the runner's facing, nearest first (radians). */
const TURNS = [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9]
/** The planner searches in legs of its own window, so a long route is walked in several. */
const MAX_LEGS = 8
/** A waypoint counts as reached inside this distance (m). */
const WAYPOINT_REACH = 1.2
/** Grid searches allowed for detoured courses once no straight course is free. */
const MAX_DETOUR_PLANS = 6

export type RaceCourse = {
  finish: NavPoint
  /** Waypoints from the start to the finish, the finish last. */
  route: NavPoint[]
}

const routeLength = (from: NavPoint, route: NavPoint[]): number => {
  let total = 0
  let previous = from
  for (const point of route) {
    total += Math.hypot(point.x - previous.x, point.z - previous.z)
    previous = point
  }
  return total
}

/** Every step of the route must stay out of water, sampled about each metre. */
const routeIsDry = (
  from: NavPoint,
  route: NavPoint[],
  isWater: (x: number, z: number) => boolean,
): boolean => {
  let previous = from
  for (const point of route) {
    const steps = Math.max(1, Math.ceil(Math.hypot(point.x - previous.x, point.z - previous.z)))
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      if (isWater(previous.x + (point.x - previous.x) * t, previous.z + (point.z - previous.z) * t)) return false
    }
    previous = point
  }
  return true
}

/**
 * A walkable route from start to goal, or null when the grid planner finds
 * none. The planner only searches a window around each leg, so a far goal is
 * approached in legs, each planned from where the previous one ended.
 */
export const planRoute = (
  start: NavPoint,
  goal: NavPoint,
  circles: CircleCollider[],
  rects: RectCollider[],
): NavPoint[] | null => {
  const route: NavPoint[] = []
  let at = start
  for (let leg = 0; leg < MAX_LEGS; leg++) {
    const path = findCatPath(at, goal, RACER_RADIUS, circles, rects)
    if (path.length === 0) return null
    route.push(...path)
    at = path[path.length - 1]
    if (at.x === goal.x && at.z === goal.z) return route
  }
  return null
}

/**
 * The course whose finish is clear of trees, buildings, rocks and water and
 * whose route to it is walkable, dry and not wildly longer than the straight
 * line. At each distance a straight course at any heading wins (the nicest race
 * and the cheapest to check); only then are detours planned, nearest heading
 * first, and only `MAX_DETOUR_PLANS` of them in all, so pressing R in a dense
 * wood never stalls a frame. Null when none qualifies.
 */
export const chooseRaceCourse = (
  start: NavPoint,
  facing: number,
  distances: number[],
  circles: CircleCollider[],
  rects: RectCollider[],
  isWater: (x: number, z: number) => boolean,
): RaceCourse | null => {
  let plans = 0
  for (const distance of distances) {
    const finishes: NavPoint[] = []
    for (const turn of TURNS) {
      const heading = facing + turn
      const finish = {
        x: start.x + Math.sin(heading) * distance,
        z: start.z + Math.cos(heading) * distance,
      }
      if (isWater(finish.x, finish.z)) continue
      if (isNavigationPointBlocked(finish, RACER_RADIUS + FINISH_CLEARANCE, circles, rects)) continue
      finishes.push(finish)
    }
    for (const finish of finishes) {
      if (segmentHasClearance(start, finish, RACER_RADIUS, circles, rects) && routeIsDry(start, [finish], isWater)) {
        return { finish, route: [finish] }
      }
    }
    for (const finish of finishes) {
      if (plans++ >= MAX_DETOUR_PLANS) return null
      const route = planRoute(start, finish, circles, rects)
      if (!route || !routeIsDry(start, route, isWater)) continue
      if (routeLength(start, route) > distance * MAX_DETOUR) continue
      return { finish, route }
    }
  }
  return null
}

/** The waypoint a racer walks to next: the first not yet reached, never the last one passed. */
export const routeCursor = (route: NavPoint[], at: NavPoint, cursor: number): number => {
  let index = cursor
  while (index < route.length - 1 && Math.hypot(route[index].x - at.x, route[index].z - at.z) < WAYPOINT_REACH) index++
  return index
}

/** The colliders that could shape a route around this point. */
export const obstaclesNear = (
  center: NavPoint,
  reach: number,
  circles: CircleCollider[],
  rects: RectCollider[],
): { circles: CircleCollider[]; rects: RectCollider[] } => ({
  circles: circles.filter((c) => Math.hypot(c.x - center.x, c.z - center.z) < reach + c.r),
  rects: rects.filter((r) => r.maxX > center.x - reach && r.minX < center.x + reach && r.maxZ > center.z - reach && r.minZ < center.z + reach),
})
