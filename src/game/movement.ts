import { SITE_POLYGONS, type SitePolygon } from "../world/sites/sites"
import { clamp } from "../utils/math"
import type { CircleCollider, RectCollider } from "./world-layout"
import { WATER_LEVEL, lakeMask } from "../world/climate"
import { worldHeight } from "../world/terrain"
import { nearbyWorldColliders } from "../world/colliders"

export type Vec2 = { x: number; z: number }

/** Convert screen/keyboard axes into world movement using camera orbit yaw. */
export const cameraRelativeMove = (
  move: { x: number; y: number },
  cameraYaw: number,
  out: { x: number; y: number },
): void => {
  const forward = -move.y
  const sin = Math.sin(cameraYaw)
  const cos = Math.cos(cameraYaw)
  out.x = move.x * cos - forward * sin
  out.y = -move.x * sin - forward * cos
}

const pushOutOfCircle = (p: Vec2, radius: number, c: CircleCollider): boolean => {
  const dx = p.x - c.x
  const dz = p.z - c.z
  const minDist = c.r + radius
  const d2 = dx * dx + dz * dz
  if (d2 >= minDist * minDist) return false
  if (d2 === 0) {
    p.x = c.x + minDist
    return true
  }
  const d = Math.sqrt(d2)
  p.x = c.x + (dx / d) * minDist
  p.z = c.z + (dz / d) * minDist
  return true
}

const pushOutOfRect = (p: Vec2, radius: number, r: RectCollider): boolean => {
  const cx = clamp(p.x, r.minX, r.maxX)
  const cz = clamp(p.z, r.minZ, r.maxZ)
  const dx = p.x - cx
  const dz = p.z - cz
  const d2 = dx * dx + dz * dz
  if (d2 >= radius * radius) return false
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2)
    p.x = cx + (dx / d) * radius
    p.z = cz + (dz / d) * radius
  } else {
    // deep inside: push out through the nearest face
    const left = p.x - r.minX
    const right = r.maxX - p.x
    const top = p.z - r.minZ
    const bottom = r.maxZ - p.z
    const min = Math.min(left, right, top, bottom)
    if (min === left) p.x = r.minX - radius
    else if (min === right) p.x = r.maxX + radius
    else if (min === top) p.z = r.minZ - radius
    else p.z = r.maxZ + radius
  }
  return true
}

/** How far up a character can step without jumping (m). */
export const STEP_UP = 0.32

/** Absolute height of a collider's top, cached on the collider. */
export const colliderTop = (c: CircleCollider): number => {
  if (c.top === undefined) c.top = worldHeight(c.x, c.z) + (c.height ?? 0)
  return c.top
}

/** Step onto standable surfaces, or fully clear a known-height obstacle. */
const passesOver = (c: CircleCollider, feetY: number | undefined, stepUp: number): boolean => {
  if (feetY === undefined) return false
  if (c.standable) return feetY >= colliderTop(c) - stepUp
  // Unknown heights and water boundaries remain solid. A bush/cushion
  // needs full foot clearance; being jumpable does not make it a platform.
  return c.height !== undefined && c.height > 0 && feetY >= colliderTop(c)
}

export type CollisionOptions = {
  /** absolute feet height: lets the body pass over standable obstacles */
  feetY?: number
  /** Grounded step allowance; airborne bodies must clear the entire top. */
  stepUp?: number
  /** bodies that can swim are not pushed back to the shore */
  canSwim?: boolean
  /** An independent body's retained streamed obstacles when it is inactive. */
  streamed?: CircleCollider[]
}

/**
 * Highest standable surface under a footprint that the feet can reach
 * (top within STEP_UP of the feet), or -Infinity.
 */
export const supportTop = (
  x: number,
  z: number,
  radius: number,
  feetY: number,
  circles: CircleCollider[],
  streamed: CircleCollider[] = nearbyWorldColliders,
  stepUp: number = STEP_UP,
): number => {
  let best = -Infinity
  const scan = (list: CircleCollider[]): void => {
    for (let i = 0; i < list.length; i++) {
      const c = list[i]
      if (!c.standable) continue
      const reach = c.r * 0.92 + radius * 0.35
      const dx = x - c.x
      const dz = z - c.z
      if (dx * dx + dz * dz > reach * reach) continue
      const top = colliderTop(c)
      if (top > best && feetY >= top - stepUp) best = top
    }
  }
  scan(circles)
  scan(streamed)
  return best
}

/** Resolve a position against colliders in place. Returns true if moved. */
/** Push a point out of a building footprint polygon (world x/z pairs). */
const pushOutOfPolygon = (p: Vec2, radius: number, poly: SitePolygon): boolean => {
  if (p.x < poly.minX - radius || p.x > poly.maxX + radius || p.z < poly.minZ - radius || p.z > poly.maxZ + radius) return false
  const pts = poly.pts
  const n = pts.length / 2
  let inside = false
  let bestD = Infinity, bx = 0, bz = 0
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const x1 = pts[j * 2], z1 = pts[j * 2 + 1], x2 = pts[i * 2], z2 = pts[i * 2 + 1]
    if ((z1 > p.z) !== (z2 > p.z) && p.x < (x2 - x1) * (p.z - z1) / (z2 - z1) + x1) inside = !inside
    const ex = x2 - x1, ez = z2 - z1
    const t = Math.max(0, Math.min(1, ((p.x - x1) * ex + (p.z - z1) * ez) / Math.max(ex * ex + ez * ez, 1e-9)))
    const cx = x1 + ex * t, cz = z1 + ez * t
    const d = (p.x - cx) ** 2 + (p.z - cz) ** 2
    if (d < bestD) { bestD = d; bx = cx; bz = cz }
  }
  const dist = Math.sqrt(bestD)
  if (!inside && dist >= radius) return false
  let nx = p.x - bx, nz = p.z - bz
  const len = Math.hypot(nx, nz) || 1
  nx /= len; nz /= len
  if (inside) { nx = -nx; nz = -nz }
  p.x = bx + nx * radius
  p.z = bz + nz * radius
  return true
}

const insideOutline = (pts: Float64Array, x: number, z: number): boolean => {
  const n = pts.length / 2
  let isIn = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const x1 = pts[j * 2], z1 = pts[j * 2 + 1], x2 = pts[i * 2], z2 = pts[i * 2 + 1]
    if ((z1 > z) !== (z2 > z) && x < (x2 - x1) * (z - z1) / (z2 - z1) + x1) isIn = !isIn
  }
  return isIn
}

/**
 * On a roof: the parapet is a wall from the inside, and the stair housing or
 * water tank stands in the way. Returns true if the point was moved.
 */
const keepOnRoof = (p: Vec2, radius: number, poly: SitePolygon): boolean => {
  const roof = poly.roof!
  if (!insideOutline(poly.pts, p.x, p.z)) return false
  let moved = false
  // nearest point on the slab's outline: stay at least `radius` inside it
  const pts = roof.inner
  const n = pts.length / 2
  let bestD = Infinity, bx = 0, bz = 0
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const x1 = pts[j * 2], z1 = pts[j * 2 + 1], x2 = pts[i * 2], z2 = pts[i * 2 + 1]
    const ex = x2 - x1, ez = z2 - z1
    const t = Math.max(0, Math.min(1, ((p.x - x1) * ex + (p.z - z1) * ez) / Math.max(ex * ex + ez * ez, 1e-9)))
    const cx = x1 + ex * t, cz = z1 + ez * t
    const d = (p.x - cx) ** 2 + (p.z - cz) ** 2
    if (d < bestD) { bestD = d; bx = cx; bz = cz }
  }
  const inSlab = insideOutline(pts, p.x, p.z)
  const dist = Math.sqrt(bestD)
  if (!inSlab || dist < radius) {
    let nx = p.x - bx, nz = p.z - bz
    const len = Math.hypot(nx, nz) || 1
    nx /= len; nz /= len
    if (!inSlab) { nx = -nx; nz = -nz }
    p.x = bx + nx * radius
    p.z = bz + nz * radius
    moved = true
  }
  for (const o of roof.obstacles) {
    const dx = p.x - o.x, dz = p.z - o.z, min = o.r + radius
    const d2 = dx * dx + dz * dz
    if (d2 >= min * min) continue
    const d = Math.sqrt(d2) || 1e-6
    p.x = o.x + dx / d * min
    p.z = o.z + dz / d * min
    moved = true
  }
  return moved
}

export const resolveCollisions = (
  p: Vec2,
  radius: number,
  circles: CircleCollider[],
  rects: RectCollider[],
  options?: CollisionOptions,
): boolean => {
  const feetY = options?.feetY
  let touched = false
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < circles.length; i++) {
      if (passesOver(circles[i], feetY, options?.stepUp ?? STEP_UP)) continue
      if (pushOutOfCircle(p, radius, circles[i])) touched = true
    }
    for (let i = 0; i < rects.length; i++) {
      if (pushOutOfRect(p, radius, rects[i])) touched = true
    }
    // walls of the buildings at authored sites (the Highvale village); a body
    // standing on a flat roof is kept inside its parapet instead, and one
    // flying over the parapet's top passes clear
    for (let i = 0; i < SITE_POLYGONS.length; i++) {
      const poly = SITE_POLYGONS[i]
      if (feetY !== undefined && poly.roof) {
        if (feetY >= poly.roof.wall - 0.05) continue
        if (feetY >= poly.roof.top - 0.4 && keepOnRoof(p, radius, poly)) { touched = true; continue }
        if (feetY >= poly.roof.top - 0.4 && insideOutline(poly.pts, p.x, p.z)) continue
      }
      if (pushOutOfPolygon(p, radius, poly)) touched = true
    }
  }
  const streamed = options?.streamed ?? nearbyWorldColliders
  // Streamed wilds, or the inactive body's retained local obstacles.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < streamed.length; i++) {
      if (passesOver(streamed[i], feetY, options?.stepUp ?? STEP_UP)) continue
      if (pushOutOfCircle(p, radius, streamed[i])) touched = true
    }
  }
  if (!options?.canSwim && keepOutOfDeepWater(p)) touched = true
  return touched
}

const DEEP_WATER = WATER_LEVEL - 0.18

/** Lakes in the wilds are wade-able at the edge but never swum into. */
export const keepOutOfDeepWater = (p: Vec2): boolean => {
  if (lakeMask(p.x, p.z) <= 0) return false
  let h = worldHeight(p.x, p.z)
  if (h >= DEEP_WATER) return false
  for (let i = 0; i < 12 && h < DEEP_WATER; i++) {
    const e = 0.35
    const gx = worldHeight(p.x + e, p.z) - worldHeight(p.x - e, p.z)
    const gz = worldHeight(p.x, p.z + e) - worldHeight(p.x, p.z - e)
    const g = Math.hypot(gx, gz)
    if (g < 1e-4) break // flat lake bed: fall back to a shore search
    p.x += (gx / g) * 0.12
    p.z += (gz / g) * 0.12
    h = worldHeight(p.x, p.z)
  }
  if (h < DEEP_WATER) {
    // e.g. spawned/teleported mid-lake: walk outward rings to the nearest shore
    for (let r = 2; r < 160; r += 2) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2
        const x = p.x + Math.cos(a) * r
        const z = p.z + Math.sin(a) * r
        if (worldHeight(x, z) >= DEEP_WATER + 0.1) {
          p.x = x
          p.z = z
          return true
        }
      }
    }
  }
  return true
}

/** Pure player integration step (tested in vitest). Input uses screen axes (y = forward). */
export const stepMovement = (
  vel: Vec2,
  move: { x: number; y: number },
  dt: number,
  maxSpeed: number,
  accel: number,
  decel: number,
): void => {
  let mx = move.x
  let my = move.y
  const len = Math.hypot(mx, my)
  if (len > 1) {
    mx /= len
    my /= len
  }
  const targetX = mx * maxSpeed
  const targetZ = my * maxSpeed
  const rate = len > 0.01 ? accel : decel
  const t = 1 - Math.exp(-rate * dt)
  vel.x += (targetX - vel.x) * t
  vel.z += (targetZ - vel.z) * t
}
