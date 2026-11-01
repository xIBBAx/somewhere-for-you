import { describe, expect, it } from "vitest"
import { findCameraPitch, findCameraYaw, limitCameraDistance } from "../src/game/camera/cameraCollision"
import { CAMERA_CONFIG } from "../src/game/camera/FollowCamera"
import { damp, dampAngle } from "../src/utils/math"
import type { CircleCollider, RectCollider } from "../src/game/world-layout"
import type { SitePolygon } from "../src/world/sites/sites"

const flatGround = (): number => 0
const target = { x: 0, y: 1.1, z: 0 }
const desired = { x: 0, y: 3.1, z: 10 }

describe("limitCameraDistance", () => {
  it("leaves an unobstructed third-person boom at full length", () => {
    expect(limitCameraDistance(target, desired, 0.25, [], [], flatGround)).toBeCloseTo(
      Math.hypot(2, 10),
    )
  })

  it("pulls in before a tall circular obstacle with smooth bisection refinement", () => {
    const tree: CircleCollider = { x: 0, z: 5, r: 0.7, height: 6 }
    const limited = limitCameraDistance(target, desired, 0.25, [tree], [], flatGround)
    expect(limited).toBeLessThan(5)
    expect(limited).toBeGreaterThan(2.5)
  })

  it("can pass above a low prop", () => {
    const cushion: CircleCollider = { x: 0, z: 5, r: 0.7, height: 0.35 }
    expect(limitCameraDistance(target, desired, 0.25, [cushion], [], flatGround)).toBeCloseTo(
      Math.hypot(2, 10),
    )
  })

  it("pulls in before a building rectangle", () => {
    const building: RectCollider = {
      minX: -2,
      maxX: 2,
      minZ: 4,
      maxZ: 7,
      height: 5,
    }
    expect(limitCameraDistance(target, desired, 0.25, [], [building], flatGround)).toBeLessThan(4.5)
  })

  it("refines distance smoothly without discretization stepping", () => {
    const tree: CircleCollider = { x: 0, z: 6, r: 0.8, height: 5 }
    const distA = limitCameraDistance(target, { x: 0, y: 1.1, z: 10 }, 0.25, [tree], [], flatGround)
    const distB = limitCameraDistance(target, { x: 0, y: 1.1, z: 10.1 }, 0.25, [tree], [], flatGround)
    // Distance to obstacle from target should be identical regardless of how far desired is beyond it
    expect(Math.abs(distA - distB)).toBeLessThan(0.05)
  })
})

describe("readable camera framing at buildings", () => {
  const cafe: RectCollider = { minX: -3.6, maxX: 3.6, minZ: 1.7, maxZ: 5.1, height: 4.65 }

  it("orbits around a close studio corner when raising alone cannot clear it", () => {
    const corner = { x: -11.4, y: 1.15, z: 4.6 }
    const studio = { minX: -14.9, maxX: -11.5, minZ: 1.1, maxZ: 4.1, height: 3 }
    const yaw = findCameraYaw(corner, Math.PI, 0.61, 11.5, 5.2, 0.32, [], [studio], flatGround)
    expect(Math.abs(yaw - Math.PI)).toBeGreaterThan(0.1)
    expect(Math.abs(yaw - Math.PI)).toBeLessThan(0.9)
    const end = {
      x: corner.x + Math.sin(yaw) * Math.cos(0.61) * 11.5,
      y: corner.y + Math.sin(0.61) * 11.5,
      z: corner.z + Math.cos(yaw) * Math.cos(0.61) * 11.5,
    }
    expect(limitCameraDistance(corner, end, 0.32, [], [studio], flatGround)).toBeGreaterThan(5.2)
  })

  it("raises the view over the cafe instead of zooming into the explorer's head", () => {
    const pitch = findCameraPitch(target, 0, 0.45, 10, 5.2, 0.32, [], [cafe], flatGround)
    expect(pitch).toBeGreaterThan(0.9)
    expect(pitch).toBeLessThanOrEqual(1.25)
    const end = { x: 0, y: target.y + Math.sin(pitch) * 10, z: Math.cos(pitch) * 10 }
    expect(limitCameraDistance(target, end, 0.32, [], [cafe], flatGround)).toBeGreaterThan(5.2)
  })

  it("keeps the chosen angle in open space and during upward sky inspection", () => {
    expect(findCameraPitch(target, 0, 0.61, 10, 5.2, 0.32, [], [], flatGround)).toBe(0.61)
    expect(findCameraPitch(target, 0, -0.7, 10, 5.2, 0.32, [], [cafe], flatGround)).toBe(-0.7)
  })

  it("keeps collision protection when the obstruction is too tall to clear", () => {
    const wall = { ...cafe, height: 30 }
    expect(findCameraPitch(target, 0, 0.45, 10, 5.2, 0.32, [], [wall], flatGround)).toBe(1.25)
    const end = { x: 0, y: target.y + Math.sin(1.25) * 10, z: Math.cos(1.25) * 10 }
    expect(limitCameraDistance(target, end, 0.32, [], [wall], flatGround)).toBeLessThan(5.2)
  })
})

describe("CAMERA_CONFIG & Mathematics", () => {
  it("has valid pitch limits for full sky inspection and ground inspection", () => {
    expect(CAMERA_CONFIG.minPitch).toBeLessThan(-1.0) // upward sky look
    expect(CAMERA_CONFIG.maxPitch).toBeGreaterThan(1.0) // downward ground look
  })

  it("has comfortable zoom min and max boundaries", () => {
    // Close should feel close: the hand zoom reaches
    // 1.6 m, still well clear of the body (collision radius + near plane)
    expect(CAMERA_CONFIG.minDistance).toBeGreaterThanOrEqual(1.5)
    expect(CAMERA_CONFIG.minDistance).toBeGreaterThan(CAMERA_CONFIG.collisionRadius * 3)
    expect(CAMERA_CONFIG.maxDistance).toBeLessThanOrEqual(20.0)
    expect(CAMERA_CONFIG.defaultDistance).toBeGreaterThan(CAMERA_CONFIG.minDistance)
    expect(CAMERA_CONFIG.defaultDistance).toBeLessThan(CAMERA_CONFIG.maxDistance)
  })

  it("computes delta-time independent damping identically over equivalent total time", () => {
    // 1 step of dt = 0.032s vs 2 steps of dt = 0.016s
    let v1 = 0
    v1 = damp(v1, 10, 10, 0.032)

    let v2 = 0
    v2 = damp(v2, 10, 10, 0.016)
    v2 = damp(v2, 10, 10, 0.016)

    expect(v1).toBeCloseTo(v2, 4)
  })

  it("dampAngle wraps angles cleanly across the -PI / +PI boundary", () => {
    const fromAngle = Math.PI - 0.1
    const toAngle = -Math.PI + 0.1
    const result = dampAngle(fromAngle, toAngle, 10, 0.016)
    expect(Number.isNaN(result)).toBe(false)
    expect(Math.abs(result)).toBeLessThanOrEqual(Math.PI)
  })
})

describe("site buildings", () => {
  // a 6 m square block 4 m behind the player, like a building footprint
  const block = (height: number): SitePolygon => ({
    pts: new Float64Array([-3, 4, 3, 4, 3, 10, -3, 10]), minX: -3, maxX: 3, minZ: 4, maxZ: 10, height,
  })

  it("shortens the boom before it passes into a building's wall", () => {
    const limited = limitCameraDistance(target, desired, 0.32, [], [], flatGround, [block(9)])
    expect(limited).toBeLessThan(4.6)
    expect(limited).toBeGreaterThan(0.9)
  })

  it("lets the camera pass over a roof it clears", () => {
    const high = { x: 0, y: 14, z: 10 }
    const full = Math.hypot(high.y - target.y, high.z - target.z)
    expect(limitCameraDistance(target, high, 0.32, [], [], flatGround, [block(3)])).toBeCloseTo(full, 5)
  })

  it("lifts the view over a low building", () => {
    const pitch = findCameraPitch(target, 0, 0.3, 10, 5.2, 0.32, [], [], flatGround, [block(4)])
    expect(pitch).toBeGreaterThan(0.3)
  })

  it("ignores buildings when none are passed, as before", () => {
    expect(limitCameraDistance(target, desired, 0.32, [], [], flatGround)).toBeCloseTo(
      Math.hypot(desired.x - target.x, desired.y - target.y, desired.z - target.z), 5)
  })
})
