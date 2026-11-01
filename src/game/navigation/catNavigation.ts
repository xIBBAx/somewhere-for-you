import type { CircleCollider, RectCollider } from "../world-layout"

export type NavPoint = { x: number; z: number }

export type CatJumpPlan = {
  takeoff: NavPoint
  landing: NavPoint
  obstacleHeight: number
}

const GRID_CELL = 0.68
/** The planner works in a local window around start and goal, so it is valid
 * anywhere in the endless world. Goals further away are approached in legs. */
const GRID_MARGIN = 9
const GRID_MAX_SPAN = 72
const SEGMENT_SAMPLE = 0.14

/** Ground the cat must never enter (deep water, cliffs), set by the world. */
let terrainBlocked: ((x: number, z: number) => boolean) | null = null
export const setNavigationTerrainBlocker = (fn: ((x: number, z: number) => boolean) | null): void => {
  terrainBlocked = fn
}

// The active grid window, rebuilt for every search.
let GRID_SIZE = 1
let GRID_MIN_X = 0
let GRID_MIN_Z = 0
const setGridWindow = (a: NavPoint, b: NavPoint, margin: number): void => {
  const cx = (a.x + b.x) / 2
  const cz = (a.z + b.z) / 2
  const span = Math.min(GRID_MAX_SPAN, Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)) + margin * 2)
  GRID_SIZE = Math.ceil(span / GRID_CELL)
  GRID_MIN_X = cx - (GRID_SIZE * GRID_CELL) / 2
  GRID_MIN_Z = cz - (GRID_SIZE * GRID_CELL) / 2
}

export const isNavigationPointBlocked = (
  point: NavPoint,
  radius: number,
  circles: CircleCollider[],
  rects: RectCollider[],
  ignoredCircle = -1,
): boolean => {
  if (terrainBlocked?.(point.x, point.z)) return true

  for (let i = 0; i < circles.length; i++) {
    if (i === ignoredCircle) continue
    const collider = circles[i]
    const reach = collider.r + radius
    const dx = point.x - collider.x
    const dz = point.z - collider.z
    if (dx * dx + dz * dz < reach * reach) return true
  }
  for (let i = 0; i < rects.length; i++) {
    const collider = rects[i]
    if (
      point.x > collider.minX - radius &&
      point.x < collider.maxX + radius &&
      point.z > collider.minZ - radius &&
      point.z < collider.maxZ + radius
    ) {
      return true
    }
  }
  return false
}

export const segmentHasClearance = (
  from: NavPoint,
  to: NavPoint,
  radius: number,
  circles: CircleCollider[],
  rects: RectCollider[],
): boolean => {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const distance = Math.hypot(dx, dz)
  const steps = Math.max(1, Math.ceil(distance / SEGMENT_SAMPLE))
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    if (
      isNavigationPointBlocked(
        { x: from.x + dx * t, z: from.z + dz * t },
        radius,
        circles,
        rects,
      )
    ) {
      return false
    }
  }
  return true
}

const gridPoint = (index: number): NavPoint => ({
  x: GRID_MIN_X + ((index % GRID_SIZE) + 0.5) * GRID_CELL,
  z: GRID_MIN_Z + (Math.floor(index / GRID_SIZE) + 0.5) * GRID_CELL,
})

const rawCell = (point: NavPoint): { x: number; z: number } => ({
  x: Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((point.x - GRID_MIN_X) / GRID_CELL))),
  z: Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((point.z - GRID_MIN_Z) / GRID_CELL))),
})

const nearestWalkableIndex = (
  point: NavPoint,
  radius: number,
  circles: CircleCollider[],
  rects: RectCollider[],
): number => {
  const cell = rawCell(point)
  const exactPointIsWalkable = !isNavigationPointBlocked(point, radius, circles, rects)
  for (let ring = 0; ring <= 7; ring++) {
    let best = -1
    let bestDistance = Infinity
    for (let dz = -ring; dz <= ring; dz++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dz) !== ring) continue
        const x = cell.x + dx
        const z = cell.z + dz
        if (x < 0 || z < 0 || x >= GRID_SIZE || z >= GRID_SIZE) continue
        const index = z * GRID_SIZE + x
        const candidate = gridPoint(index)
        if (isNavigationPointBlocked(candidate, radius, circles, rects)) continue
        if (
          exactPointIsWalkable &&
          !segmentHasClearance(point, candidate, radius, circles, rects)
        ) {
          continue
        }
        const distance = (candidate.x - point.x) ** 2 + (candidate.z - point.z) ** 2
        if (distance < bestDistance) {
          best = index
          bestDistance = distance
        }
      }
    }
    if (best >= 0) return best
  }
  return -1
}

class MinHeap {
  private readonly nodes: number[] = []
  private readonly scores: number[] = []

  get size(): number {
    return this.nodes.length
  }

  push(node: number, score: number): void {
    let index = this.nodes.length
    this.nodes.push(node)
    this.scores.push(score)
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (this.scores[parent] <= score) break
      this.nodes[index] = this.nodes[parent]
      this.scores[index] = this.scores[parent]
      index = parent
    }
    this.nodes[index] = node
    this.scores[index] = score
  }

  pop(): number {
    const root = this.nodes[0]
    const lastNode = this.nodes.pop()
    const lastScore = this.scores.pop()
    if (this.nodes.length === 0 || lastNode === undefined || lastScore === undefined) return root

    let index = 0
    while (true) {
      const left = index * 2 + 1
      if (left >= this.nodes.length) break
      const right = left + 1
      const child = right < this.nodes.length && this.scores[right] < this.scores[left] ? right : left
      if (this.scores[child] >= lastScore) break
      this.nodes[index] = this.nodes[child]
      this.scores[index] = this.scores[child]
      index = child
    }
    this.nodes[index] = lastNode
    this.scores[index] = lastScore
    return root
  }
}

const octileDistance = (a: number, b: number): number => {
  const ax = a % GRID_SIZE
  const az = Math.floor(a / GRID_SIZE)
  const bx = b % GRID_SIZE
  const bz = Math.floor(b / GRID_SIZE)
  const dx = Math.abs(ax - bx)
  const dz = Math.abs(az - bz)
  return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)
}

const simplifyPath = (
  path: NavPoint[],
  radius: number,
  circles: CircleCollider[],
  rects: RectCollider[],
): NavPoint[] => {
  if (path.length <= 2) return path
  const result: NavPoint[] = [path[0]]
  let anchor = 0
  while (anchor < path.length - 1) {
    let next = anchor + 1
    for (let candidate = path.length - 1; candidate > anchor + 1; candidate--) {
      if (segmentHasClearance(path[anchor], path[candidate], radius, circles, rects)) {
        next = candidate
        break
      }
    }
    result.push(path[next])
    anchor = next
  }
  return result
}

/** Grid A* with diagonal corner checks and line-of-sight path simplification. */
export const findCatPath = (
  start: NavPoint,
  goal: NavPoint,
  radius: number,
  circles: CircleCollider[],
  rects: RectCollider[],
): NavPoint[] => {
  if (segmentHasClearance(start, goal, radius, circles, rects)) return [{ ...goal }]

  // Far goals: plan a leg toward them; the caller re-plans as she advances.
  const far = Math.hypot(goal.x - start.x, goal.z - start.z)
  const reach = GRID_MAX_SPAN / 2 - GRID_MARGIN
  const truncated = far > reach
  if (truncated) {
    const k = reach / far
    goal = { x: start.x + (goal.x - start.x) * k, z: start.z + (goal.z - start.z) * k }
  }
  // A tight window is cheap; widen it only when the detour leaves the window.
  for (const margin of [GRID_MARGIN, GRID_MAX_SPAN / 2]) {
    setGridWindow(start, goal, margin)
    const path = searchGrid(start, goal, radius, circles, rects)
    if (path.length > 0) return truncated ? withoutBlockedEnd(path, radius, circles, rects) : path
  }
  return []
}

/** A leg aimed short of a far goal can end inside an obstacle. Stop at the last clear waypoint instead. */
const withoutBlockedEnd = (
  path: NavPoint[],
  radius: number,
  circles: CircleCollider[],
  rects: RectCollider[],
): NavPoint[] =>
  isNavigationPointBlocked(path[path.length - 1], radius, circles, rects) ? path.slice(0, -1) : path

const searchGrid = (
  start: NavPoint,
  goal: NavPoint,
  radius: number,
  circles: CircleCollider[],
  rects: RectCollider[],
): NavPoint[] => {
  const startIndex = nearestWalkableIndex(start, radius, circles, rects)
  const goalIndex = nearestWalkableIndex(goal, radius, circles, rects)
  if (startIndex < 0 || goalIndex < 0) return []

  const count = GRID_SIZE * GRID_SIZE
  const cost = new Float64Array(count)
  cost.fill(Infinity)
  const parent = new Int32Array(count)
  parent.fill(-1)
  const closed = new Uint8Array(count)
  const open = new MinHeap()
  cost[startIndex] = 0
  open.push(startIndex, octileDistance(startIndex, goalIndex))

  const directions = [
    [-1, 0, 1],
    [1, 0, 1],
    [0, -1, 1],
    [0, 1, 1],
    [-1, -1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [1, 1, Math.SQRT2],
  ] as const

  while (open.size > 0) {
    const current = open.pop()
    if (closed[current]) continue
    if (current === goalIndex) break
    closed[current] = 1
    const cx = current % GRID_SIZE
    const cz = Math.floor(current / GRID_SIZE)
    const currentPoint = gridPoint(current)

    for (const [dx, dz, stepCost] of directions) {
      const nx = cx + dx
      const nz = cz + dz
      if (nx < 0 || nz < 0 || nx >= GRID_SIZE || nz >= GRID_SIZE) continue
      const next = nz * GRID_SIZE + nx
      if (closed[next]) continue
      const point = gridPoint(next)
      if (isNavigationPointBlocked(point, radius, circles, rects)) continue
      if (!segmentHasClearance(currentPoint, point, radius, circles, rects)) continue
      if (dx !== 0 && dz !== 0) {
        const sideA = gridPoint(cz * GRID_SIZE + nx)
        const sideB = gridPoint(nz * GRID_SIZE + cx)
        if (
          isNavigationPointBlocked(sideA, radius, circles, rects) ||
          isNavigationPointBlocked(sideB, radius, circles, rects)
        ) {
          continue
        }
      }

      const nextCost = cost[current] + stepCost
      if (nextCost >= cost[next]) continue
      cost[next] = nextCost
      parent[next] = current
      open.push(next, nextCost + octileDistance(next, goalIndex))
    }
  }

  if (goalIndex !== startIndex && parent[goalIndex] < 0) return []
  const reversed: NavPoint[] = []
  let current = goalIndex
  reversed.push(gridPoint(current))
  while (current !== startIndex) {
    current = parent[current]
    if (current < 0) return []
    reversed.push(gridPoint(current))
  }
  reversed.reverse()
  const raw = [{ ...start }, ...reversed, { ...goal }]
  return simplifyPath(raw, radius, circles, rects).slice(1)
}

type SegmentHit = { entry: number; exit: number; circleIndex: number; jumpable: boolean }

const circleSegmentHit = (
  from: NavPoint,
  to: NavPoint,
  circle: CircleCollider,
  radius: number,
  circleIndex: number,
): SegmentHit | null => {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const fx = from.x - circle.x
  const fz = from.z - circle.z
  const reach = circle.r + radius
  const a = dx * dx + dz * dz
  if (a < 1e-8) return null
  const b = 2 * (fx * dx + fz * dz)
  const c = fx * fx + fz * fz - reach * reach
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return null
  const root = Math.sqrt(discriminant)
  const entry = (-b - root) / (2 * a)
  const exit = (-b + root) / (2 * a)
  if (exit <= 0 || entry >= 1) return null
  return {
    entry: Math.max(0, entry),
    exit: Math.min(1, exit),
    circleIndex,
    jumpable: circle.jumpable === true,
  }
}

const rectSegmentEntry = (
  from: NavPoint,
  to: NavPoint,
  rect: RectCollider,
  radius: number,
): number | null => {
  const dx = to.x - from.x
  const dz = to.z - from.z
  let entry = 0
  let exit = 1
  const axes = [
    [from.x, dx, rect.minX - radius, rect.maxX + radius],
    [from.z, dz, rect.minZ - radius, rect.maxZ + radius],
  ] as const
  for (const [origin, direction, min, max] of axes) {
    if (Math.abs(direction) < 1e-8) {
      if (origin < min || origin > max) return null
      continue
    }
    const a = (min - origin) / direction
    const b = (max - origin) / direction
    entry = Math.max(entry, Math.min(a, b))
    exit = Math.min(exit, Math.max(a, b))
    if (entry > exit) return null
  }
  return exit > 0 && entry < 1 ? Math.max(0, entry) : null
}

/** Return a physically valid takeoff/landing plan only for explicit low props. */
export const findJumpPlan = (
  start: NavPoint,
  goal: NavPoint,
  radius: number,
  circles: CircleCollider[],
  rects: RectCollider[],
  groundHeight: (x: number, z: number) => number,
): CatJumpPlan | null => {
  const distance = Math.hypot(goal.x - start.x, goal.z - start.z)
  if (distance < 0.8) return null

  let firstHit: SegmentHit | null = null
  for (let i = 0; i < circles.length; i++) {
    const hit = circleSegmentHit(start, goal, circles[i], radius, i)
    if (hit && (!firstHit || hit.entry < firstHit.entry)) firstHit = hit
  }
  for (let i = 0; i < rects.length; i++) {
    const entry = rectSegmentEntry(start, goal, rects[i], radius)
    if (entry !== null && (!firstHit || entry < firstHit.entry)) {
      firstHit = { entry, exit: entry, circleIndex: -1, jumpable: false }
    }
  }
  if (!firstHit?.jumpable || firstHit.circleIndex < 0 || firstHit.entry < 0.04) return null

  const directionX = (goal.x - start.x) / distance
  const directionZ = (goal.z - start.z) / distance
  const takeoffDistance = Math.max(0, firstHit.entry * distance - 0.1)
  const landingDistance = Math.min(distance, firstHit.exit * distance + 0.2)
  if (landingDistance - takeoffDistance > 1.8 || landingDistance >= distance - 0.05) return null

  const takeoff = {
    x: start.x + directionX * takeoffDistance,
    z: start.z + directionZ * takeoffDistance,
  }
  const landing = {
    x: start.x + directionX * landingDistance,
    z: start.z + directionZ * landingDistance,
  }
  if (
    isNavigationPointBlocked(
      landing,
      radius,
      circles,
      rects,
      firstHit.circleIndex,
    ) ||
    Math.abs(groundHeight(landing.x, landing.z) - groundHeight(takeoff.x, takeoff.z)) > 0.45
  ) {
    return null
  }

  return {
    takeoff,
    landing,
    obstacleHeight: circles[firstHit.circleIndex].height ?? 0.45,
  }
}
