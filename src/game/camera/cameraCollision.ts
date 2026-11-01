import type { SitePolygon } from "../../world/sites/sites"
import type { CircleCollider, RectCollider } from "../world-layout"

export type CameraPoint = { x: number; y: number; z: number }
export type GroundHeight = (x: number, z: number) => number

const SAMPLE_SPACING = 0.38
const MIN_RECOVERY_DISTANCE = 0.9
const NO_POLYGONS: readonly SitePolygon[] = []

/** Inside a building footprint, or within `radius` of one of its walls (plan view). */
const nearFootprint = (x: number, z: number, radius: number, poly: SitePolygon): boolean => {
  if (x < poly.minX - radius || x > poly.maxX + radius || z < poly.minZ - radius || z > poly.maxZ + radius) return false
  const pts = poly.pts
  const n = pts.length / 2
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const x1 = pts[j * 2], z1 = pts[j * 2 + 1], x2 = pts[i * 2], z2 = pts[i * 2 + 1]
    if ((z1 > z) !== (z2 > z) && x < ((x2 - x1) * (z - z1)) / (z2 - z1) + x1) inside = !inside
    const ex = x2 - x1, ez = z2 - z1
    const t = Math.max(0, Math.min(1, ((x - x1) * ex + (z - z1) * ez) / Math.max(ex * ex + ez * ez, 1e-9)))
    const dx = x - x1 - ex * t, dz = z - z1 - ez * t
    if (dx * dx + dz * dz < radius * radius) return true
  }
  return inside
}

const blockedAt = (
  x: number,
  y: number,
  z: number,
  radius: number,
  circles: CircleCollider[],
  rects: RectCollider[],
  groundHeight: GroundHeight,
  polygons: readonly SitePolygon[],
): boolean => {
  if (y - radius <= groundHeight(x, z)) return true

  for (let i = 0; i < circles.length; i++) {
    const collider = circles[i]
    const height = collider.height ?? 1.35
    if (height <= 0) continue
    const dx = x - collider.x
    const dz = z - collider.z
    const reach = collider.r + radius
    if (dx * dx + dz * dz > reach * reach) continue
    if (y - radius <= groundHeight(collider.x, collider.z) + height) return true
  }

  for (let i = 0; i < rects.length; i++) {
    const collider = rects[i]
    const height = collider.height ?? 4
    if (height <= 0) continue
    if (
      x < collider.minX - radius ||
      x > collider.maxX + radius ||
      z < collider.minZ - radius ||
      z > collider.maxZ + radius
    ) {
      continue
    }
    const centerX = (collider.minX + collider.maxX) * 0.5
    const centerZ = (collider.minZ + collider.maxZ) * 0.5
    if (y - radius <= groundHeight(centerX, centerZ) + height) return true
  }

  // the buildings at authored sites (the Highvale village), walls to roof
  for (let i = 0; i < polygons.length; i++) {
    const poly = polygons[i]
    if (!nearFootprint(x, z, radius, poly)) continue
    if (y - radius <= groundHeight((poly.minX + poly.maxX) * 0.5, (poly.minZ + poly.maxZ) * 0.5) + poly.height) return true
  }

  return false
}

const refineCollision = (
  target: CameraPoint,
  dx: number,
  dy: number,
  dz: number,
  tClear: number,
  tHit: number,
  cameraRadius: number,
  circles: CircleCollider[],
  rects: RectCollider[],
  groundHeight: GroundHeight,
  polygons: readonly SitePolygon[],
): number => {
  let low = tClear
  let high = tHit
  for (let iter = 0; iter < 4; iter++) {
    const mid = (low + high) * 0.5
    const x = target.x + dx * mid
    const y = target.y + dy * mid
    const z = target.z + dz * mid
    if (blockedAt(x, y, z, cameraRadius, circles, rects, groundHeight, polygons)) {
      high = mid
    } else {
      low = mid
    }
  }
  return low
}

/**
 * Continuous sphere-sample the target→camera segment and return the farthest safe range.
 * Uses adaptive step sampling with bisection refinement for pixel-perfect, jitter-free collision.
 */
export const limitCameraDistance = (
  target: CameraPoint,
  desired: CameraPoint,
  cameraRadius: number,
  circles: CircleCollider[],
  rects: RectCollider[],
  groundHeight: GroundHeight,
  polygons: readonly SitePolygon[] = NO_POLYGONS,
): number => {
  const dx = desired.x - target.x
  const dy = desired.y - target.y
  const dz = desired.z - target.z
  const distance = Math.hypot(dx, dy, dz)
  if (distance <= MIN_RECOVERY_DISTANCE) return distance

  const steps = Math.max(4, Math.ceil(distance / SAMPLE_SPACING))
  const firstStep = Math.max(1, Math.floor((MIN_RECOVERY_DISTANCE / distance) * steps))
  for (let i = firstStep; i <= steps; i++) {
    const t = i / steps
    const x = target.x + dx * t
    const y = target.y + dy * t
    const z = target.z + dz * t
    if (!blockedAt(x, y, z, cameraRadius, circles, rects, groundHeight, polygons)) continue

    const tClear = (i - 1) / steps
    const tHit = t
    const tRefined = refineCollision(
      target,
      dx,
      dy,
      dz,
      tClear,
      tHit,
      cameraRadius,
      circles,
      rects,
      groundHeight,
      polygons,
    )
    return Math.max(MIN_RECOVERY_DISTANCE, distance * tRefined - cameraRadius * 0.5)
  }

  return distance
}

const pitchProbe: CameraPoint = { x: 0, y: 0, z: 0 }

/** A small sideways orbit clears a building corner that cannot be cleared by
 * lifting alone. Prefer the previous side to avoid switching around an edge.
 */
export const findCameraYaw = (
  target: CameraPoint, yaw: number, pitch: number, distance: number,
  comfortableDistance: number, cameraRadius: number,
  circles: CircleCollider[], rects: RectCollider[], groundHeight: GroundHeight,
  previousOffset = 0,
  polygons: readonly SitePolygon[] = NO_POLYGONS,
): number => {
  if (pitch < 0) return yaw
  const rangeAt = (angle: number): number => {
    const horizontal = Math.cos(pitch) * distance
    pitchProbe.x = target.x + Math.sin(angle) * horizontal
    pitchProbe.y = target.y + Math.sin(pitch) * distance
    pitchProbe.z = target.z + Math.cos(angle) * horizontal
    return limitCameraDistance(target, pitchProbe, cameraRadius, circles, rects, groundHeight, polygons)
  }
  const desiredRange = Math.min(distance, comfortableDistance)
  if (rangeAt(yaw) >= desiredRange) return yaw
  const preferredSide = previousOffset < 0 ? -1 : 1
  for (let offset = 0.2; offset <= 1.41; offset += 0.2) {
    if (rangeAt(yaw + offset * preferredSide) >= desiredRange) return yaw + offset * preferredSide
    if (rangeAt(yaw - offset * preferredSide) >= desiredRange) return yaw - offset * preferredSide
  }
  return yaw
}

/** Lift the view over a nearby roof before the boom collapses into the player.
 * The user's horizontal orbit stays unchanged. Upward sky inspection is left
 * alone, and the ordinary distance solver still guards every rendered frame.
 */
export const findCameraPitch = (
  target: CameraPoint,
  yaw: number,
  pitch: number,
  distance: number,
  comfortableDistance: number,
  cameraRadius: number,
  circles: CircleCollider[],
  rects: RectCollider[],
  groundHeight: GroundHeight,
  polygons: readonly SitePolygon[] = NO_POLYGONS,
): number => {
  if (pitch < 0 || pitch >= 1.25) return pitch
  const rangeAt = (angle: number): number => {
    const horizontal = Math.cos(angle) * distance
    pitchProbe.x = target.x + Math.sin(yaw) * horizontal
    pitchProbe.y = target.y + Math.sin(angle) * distance
    pitchProbe.z = target.z + Math.cos(yaw) * horizontal
    return limitCameraDistance(target, pitchProbe, cameraRadius, circles, rects, groundHeight, polygons)
  }
  const desiredRange = Math.min(distance, comfortableDistance)
  const baseRange = rangeAt(pitch)
  if (baseRange >= desiredRange) return pitch
  const raisedRange = rangeAt(1.25)
  if (raisedRange <= baseRange + 0.5) return pitch
  if (raisedRange < desiredRange) return 1.25
  let low = pitch
  let high = 1.25
  for (let i = 0; i < 5; i++) {
    const mid = (low + high) * 0.5
    if (rangeAt(mid) >= desiredRange) high = mid
    else low = mid
  }
  return Math.min(1.25, high + 0.035)
}
