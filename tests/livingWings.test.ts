import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { WingAnimator, advanceWingbeat, makeWingPose, type WingPose } from "../src/game/pegasus/WingAnimator"
import { wingRhythm } from "../src/game/pegasus/wingRhythm"
import type { RigPoser } from "../src/game/rig/RigPoser"

const rig = () => {
  const rotations = new Map<string, THREE.Quaternion>()
  const poser = { setDelta: (name: string, q: THREE.Quaternion) => rotations.set(name, q.clone()) } as unknown as RigPoser
  return { rotations, poser, animator: new WingAnimator(poser, {}, "slot", () => 0.5) }
}
const air = (extra: Partial<WingPose> = {}): WingPose => ({ ...makeWingPose(), mode: "air", spread: 1, power: 0.7, speed: 18, ...extra })

describe("shared wingbeat rhythm", () => {
  it("keeps one continuous phase with slower powerful eagle strokes and graceful long-wing timing", () => {
    const w = air()
    const ivory = wingRhythm({ ...w, personality: "ivory" })
    const eagle = wingRhythm({ ...w, personality: "onyx" })
    expect(eagle.cadence).toBeLessThan(ivory.cadence)
    expect(eagle.amplitude).toBeGreaterThan(ivory.amplitude)
    expect(eagle.downShare).toBeGreaterThan(ivory.downShare)
    expect(wingRhythm({ ...w, personality: "starborn" }).expression).toBeGreaterThan(ivory.expression)
    expect(advanceWingbeat(0.99, 0.02, 1, w)).toBeLessThan(0.03)
    expect(advanceWingbeat(0.4, 0, 1, w)).toBeCloseTo(0.4)
  })
  it("responds to takeoff demand, slows in a glide, freezes on the ground and beats on the sails only with power", () => {
    const easy = air({ power: 0.2 })
    expect(advanceWingbeat(0, 0.05, 1, air({ mode: "takeoff", accel: 10, power: 1 })))
      .toBeGreaterThan(advanceWingbeat(0, 0.05, 1, easy))
    expect(advanceWingbeat(0, 0.05, 1, air({ glide: 1 }))).toBeLessThan(0.01)
    expect(wingRhythm({ ...easy, speed: 36 }).cadence).toBeLessThan(wingRhythm({ ...easy, speed: 4 }).cadence)
    expect(wingRhythm({ ...easy, brake: 1 }).demand).toBeGreaterThan(wingRhythm(easy).demand)
    expect(advanceWingbeat(0.37, 0.05, 1, air({ mode: "ground" }))).toBeCloseTo(0.37)
    expect(advanceWingbeat(0.37, 0.05, 1, air({ mode: "sail", power: 0.05 }))).toBeCloseTo(0.37)
    expect(advanceWingbeat(0.37, 0.05, 1, air({ mode: "sail", power: 1 }))).toBeGreaterThan(0.38)
  })
})

describe("living wing rig", () => {
  it("keeps ground gallop folded without any flap-phase motion, even with stale flight inputs", () => {
    const a = rig(), b = rig()
    const w = air({ mode: "ground", speed: 18, stride: 0.3, wind: 0.6, flare: 0.5 })
    a.animator.update(a.poser, { ...w, flap: 0.1 }, 1 / 60)
    b.animator.update(b.poser, { ...w, flap: 0.7 }, 1 / 60)
    for (const [name, q] of a.rotations) expect(q.angleTo(b.rotations.get(name)!)).toBeLessThan(1e-7)
    expect(a.animator.featherA).toEqual(b.animator.featherA)
  })
  it("trims opposing wings in a bank while preserving finite feather folds across all flight modes", () => {
    const { animator, poser, rotations } = rig()
    let phase = 0
    for (const mode of ["takeoff", "air", "landing", "ground", "takeoff", "sail"] as const) {
      for (let n = 0; n < 60; n++) {
        const w = air({ mode, personality: "starborn", roll: 0.5, brake: mode === "landing" ? 1 : 0, time: n / 60 })
        phase = advanceWingbeat(phase, 1 / 60, 1, w)
        animator.update(poser, { ...w, flap: phase }, 1 / 60)
        for (const q of rotations.values()) expect(q.toArray().every(Number.isFinite)).toBe(true)
        expect([...animator.featherA, ...animator.featherFan, ...animator.flex].every(Number.isFinite)).toBe(true)
      }
    }
    expect(rotations.get("wingHandL")!.angleTo(rotations.get("wingHandR")!)).toBeGreaterThan(0.01)
    expect(Math.max(...animator.flex)).toBeLessThanOrEqual(1)
  })
  it("blends landing folds and immediate retakeoff without snapping the shoulder", () => {
    const { animator, poser, rotations } = rig()
    for (let n = 0; n < 60; n++) animator.update(poser, air({ flap: 0.2 }), 1 / 60)
    const previous = rotations.get("wingHumL")!.clone()
    animator.update(poser, air({ mode: "ground", flap: 0.2 }), 1 / 60)
    expect(previous.angleTo(rotations.get("wingHumL")!)).toBeLessThan(0.4)
    const landed = rotations.get("wingHumL")!.clone()
    animator.update(poser, air({ mode: "takeoff", flap: 0.2 }), 1 / 60)
    expect(landed.angleTo(rotations.get("wingHumL")!)).toBeLessThan(0.4)
  })
})


it("limits low-approach downstroke and lagging wrists while retaining full strokes in clear air", () => {
  const low = rig(), high = rig()
  const phase = wingRhythm(air({ personality: "onyx" })).downShare
  const approach = air({ mode: "landing", personality: "onyx", power: 0.85, flare: 1, brake: 1, flap: phase, span: 3.5 })
  for (let n = 0; n < 60; n++) {
    low.animator.update(low.poser, { ...approach, clearance: 0.05 }, 1 / 60)
    high.animator.update(high.poser, { ...approach, clearance: 15 }, 1 / 60)
  }
  const euler = new THREE.Euler()
  const lift = (q: THREE.Quaternion) => euler.setFromQuaternion(q, "ZXY").z
  const safeFloor = -Math.asin(1.15 / 3.5)
  let cumulative = 0
  for (const name of ["wingHumL", "wingForeL", "wingHandL", "wingTipL"]) {
    cumulative += lift(low.rotations.get(name)!)
    expect(cumulative).toBeGreaterThanOrEqual(safeFloor - 1e-6)
  }
  expect(lift(high.rotations.get("wingHumL")!)).toBeLessThan(lift(low.rotations.get("wingHumL")!) - 0.1)
  // The first low frame also corrects the previous high-altitude deep stroke.
  high.animator.update(high.poser, { ...approach, clearance: 0.05 }, 1 / 60)
  expect(lift(high.rotations.get("wingHumL")!)).toBeGreaterThanOrEqual(safeFloor - 1e-6)
})
