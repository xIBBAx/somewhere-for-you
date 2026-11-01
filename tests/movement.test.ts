import { describe, expect, it } from "vitest"
import { cameraRelativeMove, resolveCollisions, stepMovement, supportTop } from "../src/game/movement"
import { FAIR_LAYOUT, buildColliders, type CircleCollider, type RectCollider } from "../src/game/world-layout"

describe("stepMovement", () => {
  it("accelerates toward the input direction", () => {
    const vel = { x: 0, z: 0 }
    for (let i = 0; i < 60; i++) stepMovement(vel, { x: 1, y: 0 }, 1 / 60, 4, 20, 10)
    expect(vel.x).toBeCloseTo(4, 1)
    expect(Math.abs(vel.z)).toBeLessThan(0.01)
  })

  it("decelerates to a stop without input", () => {
    const vel = { x: 4, z: 0 }
    for (let i = 0; i < 90; i++) stepMovement(vel, { x: 0, y: 0 }, 1 / 60, 4, 20, 10)
    expect(Math.hypot(vel.x, vel.z)).toBeLessThan(0.05)
  })

  it("normalizes diagonals (no speed boost)", () => {
    const vel = { x: 0, z: 0 }
    for (let i = 0; i < 120; i++) stepMovement(vel, { x: 1, y: 1 }, 1 / 60, 4, 20, 10)
    expect(Math.hypot(vel.x, vel.z)).toBeLessThanOrEqual(4.01)
  })
})

describe("cameraRelativeMove", () => {
  it("maps W toward the camera heading", () => {
    const out = { x: 0, y: 0 }
    cameraRelativeMove({ x: 0, y: -1 }, 0, out)
    expect(out.x).toBeCloseTo(0)
    expect(out.y).toBeCloseTo(-1)

    cameraRelativeMove({ x: 0, y: -1 }, -Math.PI / 2, out)
    expect(out.x).toBeCloseTo(1)
    expect(out.y).toBeCloseTo(0)
  })

  it("keeps strafe orthogonal and preserves input magnitude", () => {
    const out = { x: 0, y: 0 }
    cameraRelativeMove({ x: 1, y: 0 }, Math.PI / 3, out)
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(1)

    cameraRelativeMove({ x: 0.6, y: -0.8 }, -1.1, out)
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(1)
  })
})

describe("resolveCollisions", () => {
  const circle: CircleCollider = { x: 5, z: 0, r: 1 }
  const rect: RectCollider = { minX: -2, maxX: 2, minZ: -2, maxZ: 2 }

  it("pushes the player out of a circle", () => {
    const p = { x: 5.4, z: 0 }
    resolveCollisions(p, 0.4, [circle], [])
    expect(Math.hypot(p.x - 5, p.z)).toBeGreaterThanOrEqual(1.39)
  })

  it("rescues an exact circle-centre overlap without a zero direction", () => {
    const p = { x: circle.x, z: circle.z }
    resolveCollisions(p, 0.4, [circle], [])
    expect(Math.hypot(p.x - circle.x, p.z - circle.z)).toBeCloseTo(1.4)
  })

  it("keeps bodies outside carousel horses and the Ferris cabin sweep", () => {
    const { circles, rects } = buildColliders()
    const carousel = { x: FAIR_LAYOUT.x + FAIR_LAYOUT.carousel.position[0], z: FAIR_LAYOUT.z + FAIR_LAYOUT.carousel.position[2] }
    const p = { x: carousel.x + 1.25, z: carousel.z }
    resolveCollisions(p, 0.34, circles, rects)
    expect(Math.hypot(p.x - carousel.x, p.z - carousel.z)).toBeGreaterThanOrEqual(1.88)
    const ferris = { x: FAIR_LAYOUT.x + FAIR_LAYOUT.ferris.position[0], z: FAIR_LAYOUT.z + FAIR_LAYOUT.ferris.position[2] }
    const nearCabin = { x: ferris.x - 1.8, z: ferris.z - 0.6 }
    resolveCollisions(nearCabin, 0.34, circles, rects)
    expect(nearCabin.z).toBeLessThanOrEqual(ferris.z - FAIR_LAYOUT.ferris.halfDepth - 0.33)
  })

  it("pushes the player out of a rectangle", () => {
    const p = { x: 0, z: 1.9 }
    resolveCollisions(p, 0.5, [], [rect])
    expect(p.z).toBeGreaterThanOrEqual(2.49)
  })

  it("rescues a position deep inside a rectangle", () => {
    const p = { x: 0, z: 0 }
    resolveCollisions(p, 0.5, [], [rect])
    const inside =
      p.x > rect.minX - 0.01 &&
      p.x < rect.maxX + 0.01 &&
      p.z > rect.minZ - 0.01 &&
      p.z < rect.maxZ + 0.01
    expect(inside).toBe(false)
  })

  it("never clamps the player: the world is endless", () => {
    const p = { x: 4000, z: -2500 }
    resolveCollisions(p, 0.4, [], [])
    expect(Math.hypot(p.x - 4000, p.z + 2500)).toBeLessThan(2)
  })

  it("never produces NaN", () => {
    const p = { x: 0, z: 0 }
    resolveCollisions(p, 0.4, [circle], [rect])
    expect(Number.isNaN(p.x)).toBe(false)
    expect(Number.isNaN(p.z)).toBe(false)
  })

  it("clears known low obstacles only when the feet reach their full top", () => {
    const cushion: CircleCollider = { x: 0, z: 0, r: 0.35, height: 0.18, top: 0.18, jumpable: true }
    for (const streamed of [false, true]) {
      const options = { feetY: 0.17, canSwim: true, streamed: streamed ? [cushion] : [] }
      const grounded = { x: 0, z: 0 }
      expect(resolveCollisions(grounded, 0.34, streamed ? [] : [cushion], [], options)).toBe(true)
      const airborne = { x: 0, z: 0 }
      expect(resolveCollisions(airborne, 0.34, streamed ? [] : [cushion], [], { ...options, feetY: 0.19 })).toBe(false)
      expect(supportTop(0, 0, 0.34, 0.19, [cushion], [])).toBe(-Infinity)
    }
  })

  it("uses step allowance on the ground but requires full clearance in flight", () => {
    const rock: CircleCollider = { x: 0, z: 0, r: 0.4, standable: true, height: 0.8, top: 0.8 }
    expect(resolveCollisions({ x: 0, z: 0 }, 0.34, [rock], [], { feetY: 0.6, streamed: [] })).toBe(false)
    expect(resolveCollisions({ x: 0, z: 0 }, 0.34, [rock], [], { feetY: 0.6, stepUp: 0, streamed: [] })).toBe(true)
    expect(supportTop(0, 0, 0.34, 0.6, [rock], [], 0)).toBe(-Infinity)
    expect(supportTop(0, 0, 0.34, 0.81, [rock], [], 0)).toBe(0.8)
  })

  it("keeps tall, unknown-height and water-boundary obstacles solid", () => {
    for (const height of [undefined, 0, 3]) {
      const obstacle: CircleCollider = { x: 0, z: 0, r: 0.4, height, top: height ?? 0 }
      expect(resolveCollisions({ x: 0, z: 0 }, 0.34, [obstacle], [], { feetY: 1.15, stepUp: 0, streamed: [] })).toBe(true)
    }
    expect(resolveCollisions({ x: 0, z: 0 }, 0.34, [], [rect], { feetY: 1.15, streamed: [] })).toBe(true)
  })
})
