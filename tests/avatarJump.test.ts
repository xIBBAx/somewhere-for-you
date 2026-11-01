import * as THREE from "three"
import { describe, expect, it } from "vitest"
import { createLocomotion, resetLocomotion, stepLocomotion, type LocomotionTuning } from "../src/game/characters/controller/locomotion"
import { ACCEL_RATE, DECEL_RATE, MOVE_SPEED, RUN_SPEED, TURN_RATE } from "../src/game/characters/human/humanLocomotion"
import { groundHeight, type CircleCollider } from "../src/game/world-layout"

const tuning: LocomotionTuning = {
  radius: 0.34, walkSpeed: MOVE_SPEED, runSpeed: RUN_SPEED, accel: ACCEL_RATE,
  decel: DECEL_RATE, turnRate: TURN_RATE, swimSpeed: 1.45, swimSprint: 2.3,
  floatDraft: 1.12, swimEnter: 1.25, swimExit: 1.02,
}
const setup = (radius: number, circles: CircleCollider[] = []) => {
  const body = { pos: new THREE.Vector3(0, groundHeight(0, 22.5), 22.5), vel: new THREE.Vector3(), facing: 0, speed: 0, moving: false, idleTime: 0 }
  const state = createLocomotion()
  const settings = { ...tuning, radius }
  resetLocomotion(state, body, settings, circles, [])
  return { body, state, settings }
}

describe.each([0.34, 0.36])("playable-body jump with radius %s", radius => {
  it.each([20, 30, 60, 120])("clears a low rock without crossing its side at %i Hz", hz => {
    const top = groundHeight(1.4, 22.5) + 0.55
    const rock: CircleCollider = { x: 1.4, z: 22.5, r: 0.3, height: 0.55, top, standable: true }
    const { body, state, settings } = setup(radius, [rock])
    let passed = false
    for (let frame = 0; frame < hz; frame++) {
      const beforeY = body.pos.y
      stepLocomotion(body, state, settings, { move: { x: 1, y: 0 }, sprint: false, jump: frame === 0 }, [rock], [], 1 / hz, [])
      if (frame === 0) expect(state.motion.lift).toBeGreaterThan(0)
      if (Math.abs(body.pos.x - rock.x) < rock.r + radius - 0.01) {
        // Horizontal entry was resolved against the previous feet height.
        expect(beforeY).toBeGreaterThanOrEqual(top - 1e-8)
        passed = true
      }
    }
    expect(passed).toBe(true)
    expect(body.pos.x).toBeGreaterThan(rock.x + rock.r + radius)
    expect(state.motion.phase).toMatch(/landing|grounded/)
  })

  it("stays blocked by an obstacle above the jump's apex", () => {
    const tree: CircleCollider = { x: 1.4, z: 22.5, r: 0.3, height: 3, top: groundHeight(1.4, 22.5) + 3 }
    const { body, state, settings } = setup(radius, [tree])
    for (let frame = 0; frame < 90; frame++) {
      stepLocomotion(body, state, settings, { move: { x: 1, y: 0 }, sprint: false, jump: frame === 0 }, [tree], [], 1 / 60, [])
      expect(body.pos.x).toBeLessThanOrEqual(tree.x - tree.r - radius + 1e-8)
    }
  })

  it("buffers a brief press just before landing without enabling a midair jump", () => {
    const { body, state, settings } = setup(radius)
    const peaks: number[] = []
    let previousPhase = state.motion.phase
    let pressed = false
    for (let frame = 0; frame < 100; frame++) {
      const nearLanding = !pressed && state.motion.phase === "falling" && state.motion.lift < 0.3
      stepLocomotion(body, state, settings, { move: { x: 0, y: 0 }, sprint: false, jump: frame === 0 || nearLanding }, [], [], 1 / 60, [])
      if (nearLanding) { pressed = true; expect(state.motion.phase).not.toBe("rising") }
      if (state.motion.phase === "rising" && previousPhase !== "rising") peaks.push(frame)
      previousPhase = state.motion.phase
    }
    expect(pressed).toBe(true)
    expect(peaks).toHaveLength(2)
    expect(state.motion.phase).toMatch(/landing|grounded/)
  })
})
