import { describe, expect, it } from "vitest"
import { advanceGait, approach, footAt, gaitFor, MOVE_SPEED, RUN_SPEED, ACCEL_RATE, DECEL_RATE, type FootSample, type GaitParams } from "../src/game/characters/human/humanLocomotion"

const gait = (): GaitParams => ({ cadence: 0, stepLength: 0, duty: 0, lift: 0, bob: 0, runBlend: 0 })
const foot = (): FootSample => ({ z: 0, y: 0, pitch: 0, stance: true, t: 0 })

describe("The explorer locomotion", () => {
  it("is much faster than the old 1.88 m/s walk", () => {
    expect(MOVE_SPEED).toBeGreaterThan(1.88 * 1.8)
    expect(RUN_SPEED).toBeGreaterThan(MOVE_SPEED * 1.6)
  })

  it("reaches 95% of target speed within a quarter second and stops quickly", () => {
    let v = 0
    let t = 0
    while (v < MOVE_SPEED * 0.95) {
      v = approach(v, MOVE_SPEED, ACCEL_RATE, 1 / 60)
      t += 1 / 60
    }
    expect(t).toBeLessThan(0.27)
    t = 0
    while (v > 0.1) {
      v = approach(v, 0, DECEL_RATE, 1 / 60)
      t += 1 / 60
    }
    expect(t).toBeLessThan(0.28)
  })

  for (const speed of [1.2, MOVE_SPEED, RUN_SPEED]) {
    it(`plants the stance foot (no skating) at ${speed.toFixed(1)} m/s`, () => {
      const g = gaitFor(speed, gait())
      const dt = 1 / 240
      let phase = 0.02
      const a = foot()
      const b = foot()
      let checked = 0
      for (let i = 0; i < 400; i++) {
        footAt(phase, 0, g, a)
        const next = advanceGait(phase, speed, dt, g)
        footAt(next, 0, g, b)
        if (a.stance && b.stance && next > phase) {
          // foot moves backwards in character space exactly as fast as the body moves forwards
          expect((a.z - b.z) / dt).toBeCloseTo(speed, 3)
          checked++
        }
        phase = next
      }
      expect(checked).toBeGreaterThan(20)
    })
  }

  it("keeps stride within leg reach at every speed", () => {
    for (let v = 0.5; v <= RUN_SPEED; v += 0.25) {
      const g = gaitFor(v, gait())
      expect(2 * g.duty * g.stepLength).toBeLessThan(0.95)
    }
  })
})
