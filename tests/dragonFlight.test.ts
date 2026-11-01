import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { makeDragon, resetTrail, setDragonMode, stepDragon, trailAt, TRAIL_SPACING, type DragonWorld } from "../src/game/dragon/dragonFlight"

const flat = (height = 0): DragonWorld => ({ top: () => height, random: () => 0.5 })
const her = { x: 0, y: 0, z: 0 }

describe("The dragon's flight", () => {
  it("lays the body along the path the head has flown", () => {
    const d = makeDragon(0, 50, 0, 0)
    setDragonMode(d, "ride")
    const controls = { turn: 1, throttle: 0, climb: 0, surge: false }
    const heads: THREE.Vector3[] = []
    for (let i = 0; i < 400; i++) {
      stepDragon(d, flat(), { dt: 1 / 60, her, controls, homeX: 0, homeZ: 0 })
      heads.push(new THREE.Vector3(d.x, d.y, d.z))
    }
    // every point 10 m back along the body lies on (or very near) a place the head has been
    const p = new THREE.Vector3()
    trailAt(d, 10, p)
    const nearest = Math.min(...heads.map((h) => h.distanceTo(p)))
    expect(nearest).toBeLessThan(TRAIL_SPACING)
  })

  it("keeps samples evenly spaced along the body", () => {
    const d = makeDragon(0, 50, 0, 0)
    setDragonMode(d, "ride")
    for (let i = 0; i < 300; i++) stepDragon(d, flat(), { dt: 1 / 60, her, controls: { turn: 0.4, throttle: 1, climb: 0.3, surge: false }, homeX: 0, homeZ: 0 })
    const a = new THREE.Vector3(), b = new THREE.Vector3()
    for (let s = 2; s < 25; s += 3) {
      trailAt(d, s, a)
      trailAt(d, s + 1, b)
      expect(a.distanceTo(b)).toBeGreaterThan(0.9)
      expect(a.distanceTo(b)).toBeLessThan(1.05)
    }
  })

  it("never flies into the ground, even when told to dive", () => {
    const d = makeDragon(0, 12, 0, 0)
    setDragonMode(d, "ride")
    for (let i = 0; i < 600; i++) {
      stepDragon(d, flat(5), { dt: 1 / 30, her, controls: { turn: 0, throttle: 1, climb: -1, surge: true }, homeX: 0, homeZ: 0 })
      expect(d.y).toBeGreaterThanOrEqual(5 + 1.2 - 1e-6)
      expect(Number.isFinite(d.x + d.y + d.z)).toBe(true)
    }
  })

  it("comes to her and circles close by", () => {
    const d = makeDragon(400, 120, 0, 0)
    resetTrail(d)
    setDragonMode(d, "come")
    for (let i = 0; i < 60 * 60 && d.mode === "come"; i++) stepDragon(d, flat(), { dt: 1 / 60, her, controls: null, homeX: 0, homeZ: 0 })
    expect(d.mode).toBe("circle")
    for (let i = 0; i < 60 * 30; i++) stepDragon(d, flat(), { dt: 1 / 60, her, controls: null, homeX: 0, homeZ: 0 })
    expect(Math.hypot(d.x, d.z)).toBeLessThan(40)
    expect(d.y).toBeLessThan(15)
  })

  it("re-lays the body after a jump far away instead of stretching it", () => {
    const d = makeDragon(0, 50, 0, 0)
    d.x = 5000
    stepDragon(d, flat(), { dt: 1 / 60, her, controls: null, homeX: 0, homeZ: 0 })
    const p = new THREE.Vector3()
    trailAt(d, 20, p)
    expect(p.distanceTo(new THREE.Vector3(d.x, d.y, d.z))).toBeLessThan(25)
  })
})
