import { describe, expect, it } from "vitest"
import { createPlayerMotion, resetPlayerMotion, stepPlayerMotion } from "../src/game/characters/playerMotion"

describe("The explorer's jump", () => {
  it("rises immediately, falls, lands once and recovers at different frame rates", () => {
    for (const hz of [20, 30, 60, 120]) {
      const motion = createPlayerMotion()
      const phases = new Set<string>()
      let contacts = 0
      let peak = 0
      for (let i = 0; i < hz * 2; i++) {
        if (stepPlayerMotion(motion, 1 / hz, 0, i === 0)) contacts++
        peak = Math.max(peak, motion.lift)
        phases.add(motion.phase)
        expect(motion.lift).toBeGreaterThanOrEqual(0)
      }
      expect([...phases]).toEqual(["rising", "falling", "landing", "grounded"])
      expect(peak).toBeGreaterThan(1.4)
      expect(peak).toBeLessThan(1.65)
      expect(contacts).toBe(1)
    }
  })

  it("cuts the rise short when the button is let go: a tap is a hop", () => {
    for (const hz of [30, 60, 120]) {
      const tap = createPlayerMotion()
      const held = createPlayerMotion()
      let tapPeak = 0, heldPeak = 0
      for (let i = 0; i < hz; i++) {
        stepPlayerMotion(tap, 1 / hz, 0, i === 0, 1, undefined, i < hz * 0.06)
        stepPlayerMotion(held, 1 / hz, 0, i === 0, 1, undefined, true)
        tapPeak = Math.max(tapPeak, tap.lift)
        heldPeak = Math.max(heldPeak, held.lift)
      }
      expect(tapPeak).toBeGreaterThan(0.45)
      expect(tapPeak).toBeLessThan(heldPeak * 0.65)
    }
  })

  it("still jumps a moment after walking off an edge, but not long after", () => {
    const late = (wait: number): string => {
      const motion = createPlayerMotion()
      resetPlayerMotion(motion, 3)
      stepPlayerMotion(motion, 1 / 60, 0, false)
      expect(motion.phase).toBe("falling")
      let t = 0
      while (t < wait) { stepPlayerMotion(motion, 1 / 60, 0, false); t += 1 / 60 }
      stepPlayerMotion(motion, 1 / 60, 0, true)
      return motion.phase
    }
    expect(late(0.06)).toBe("rising")
    expect(late(0.3)).not.toBe("rising")
  })

  it("has positive lift in the update that consumes a short jump press", () => {
    for (const hz of [20, 30, 60, 120]) {
      const motion = createPlayerMotion()
      stepPlayerMotion(motion, 1 / hz, 0, true)
      expect(motion.phase).toBe("rising")
      expect(motion.lift).toBeGreaterThan(0)
      expect(motion.velocity).toBeGreaterThan(0)
    }
  })

  it("can jump during landing recovery and launches from the edge height", () => {
    const motion = createPlayerMotion()
    resetPlayerMotion(motion, 0.8)
    motion.phase = "landing"
    stepPlayerMotion(motion, 1 / 60, 0, true)
    expect(motion.phase).toBe("rising")
    expect(motion.ground + motion.lift).toBeGreaterThan(0.8)
  })

  it("keeps its world altitude over changing ground and cannot jump again in flight", () => {
    const a = createPlayerMotion()
    const b = createPlayerMotion()
    for (let frame = 0; frame < 25; frame++) {
      stepPlayerMotion(a, 1 / 60, 0, frame === 0)
      stepPlayerMotion(b, 1 / 60, frame > 10 ? -0.3 : 0, frame === 0 || frame === 18)
    }
    expect(a.ground + a.lift).toBeCloseTo(b.ground + b.lift, 8)
    expect(a.velocity).toBe(b.velocity)
    resetPlayerMotion(b, 0.5)
    expect(b.phase).toBe("grounded")
    expect(b.lift).toBe(0)
    expect(b.ground).toBe(0.5)
  })
})

describe("Fast Traversal Locomotion & Biomechanical Gait", () => {
  it("satisfies target traversal speed, step length, and cadence requirements", async () => {
    const {
      DEFAULT_TRAVERSAL_SPEED,
      STEP_CADENCE,
      STEP_LENGTH,
      STRIDE_LENGTH,
    } = await import("../src/game/characters/playerMotion")

    expect(DEFAULT_TRAVERSAL_SPEED).toBeGreaterThanOrEqual(1.80)
    expect(DEFAULT_TRAVERSAL_SPEED).toBeLessThanOrEqual(1.95)
    expect(STEP_LENGTH).toBeGreaterThanOrEqual(0.85)
    expect(STEP_LENGTH).toBeLessThanOrEqual(0.95)
    expect(STRIDE_LENGTH).toBeCloseTo(STEP_LENGTH * 2, 5)
    expect(STEP_CADENCE).toBeGreaterThanOrEqual(2.0)
    expect(STEP_CADENCE).toBeLessThanOrEqual(2.15)
  })

  it("advances walk phase strictly proportional to speed and step length", async () => {
    const {
      DEFAULT_TRAVERSAL_SPEED,
      STEP_LENGTH,
      advanceWalkPhase,
    } = await import("../src/game/characters/playerMotion")

    let phase = 0
    const dt = 1 / 60
    for (let frame = 0; frame < 60; frame++) {
      phase = advanceWalkPhase(phase, DEFAULT_TRAVERSAL_SPEED, dt, STEP_LENGTH)
    }
    const expectedDelta = (DEFAULT_TRAVERSAL_SPEED * 1 * Math.PI) / STEP_LENGTH
    expect(phase).toBeCloseTo(expectedDelta, 2)
  })

  it("guarantees zero foot skating: ground displacement matches world displacement during stance", async () => {
    const {
      STEP_LENGTH,
      advanceWalkPhase,
      calculateFootContact,
    } = await import("../src/game/characters/playerMotion")

    for (const speed of [0.8, 1.4, 1.88]) {
      for (const hz of [30, 60, 120]) {
        const dt = 1 / hz
        let walkPhase = 0.1 * Math.PI // left foot starts in stance
        for (let step = 0; step < 10; step++) {
          const footBefore = calculateFootContact(walkPhase, 0, STEP_LENGTH)
          if (!footBefore.isStance) continue
          const nextPhase = advanceWalkPhase(walkPhase, speed, dt, STEP_LENGTH)
          const footAfter = calculateFootContact(nextPhase, 0, STEP_LENGTH)
          if (!footAfter.isStance) continue

          const footDeltaZ = footAfter.z - footBefore.z
          const worldDeltaZ = speed * dt
          // Net world velocity of foot = world delta Z + foot delta Z = 0
          expect(footDeltaZ + worldDeltaZ).toBeCloseTo(0, 5)
          walkPhase = nextPhase
        }
      }
    }
  })

  it("produces realistic heel-strike, flat foot plant, and toe push-off foot angles", async () => {
    const {
      STEP_LENGTH,
      calculateFootContact,
    } = await import("../src/game/characters/playerMotion")

    // Left foot: walkPhase = 0 -> phase = 0 (stance start)
    const heelStrike = calculateFootContact(0.01 * Math.PI, 0, STEP_LENGTH)
    expect(heelStrike.isStance).toBe(true)
    expect(heelStrike.rotX).toBeGreaterThan(0.10) // dorsiflexed heel strike

    // Mid-stance: walkPhase = 0.5 * pi -> u = 0.5
    const midStance = calculateFootContact(0.5 * Math.PI, 0, STEP_LENGTH)
    expect(midStance.isStance).toBe(true)
    expect(midStance.rotX).toBe(0) // flat foot

    // Late stance push-off: walkPhase = 0.85 * pi -> u = 0.85
    const pushOff = calculateFootContact(0.85 * Math.PI, 0, STEP_LENGTH)
    expect(pushOff.isStance).toBe(true)
    expect(pushOff.rotX).toBeLessThan(-0.10) // toe extension push-off

    // Swing clearance lift: walkPhase = 1.5 * pi -> u = 0.5 swing
    const midSwing = calculateFootContact(1.5 * Math.PI, 0, STEP_LENGTH)
    expect(midSwing.isStance).toBe(false)
    expect(midSwing.y).toBeCloseTo(0.075, 2)
  })

  it("participates with full biomechanical pelvis tilt, vertical bounce, and spine counter-rotation", async () => {
    const {
      calculatePelvisDynamics,
      calculateSpineDynamics,
    } = await import("../src/game/characters/playerMotion")

    const gait = 1.0
    const pelvis = calculatePelvisDynamics(Math.PI / 2, gait)
    // Lateral tilt over stance leg (~3.2 deg = ~0.055 rad)
    expect(Math.abs(pelvis.roll)).toBeGreaterThanOrEqual(0.04)
    expect(Math.abs(pelvis.roll)).toBeLessThanOrEqual(0.08)
    // Axial yaw rotation (~4.6 deg = ~0.08 rad)
    expect(Math.abs(pelvis.yaw)).toBeGreaterThanOrEqual(0.06)
    expect(Math.abs(pelvis.yaw)).toBeLessThanOrEqual(0.10)
    // Vertical bounce (~2.5 cm amplitude)
    expect(pelvis.bounce).toBeLessThan(-0.02)
    expect(pelvis.bounce).toBeGreaterThan(-0.03)

    // Spine counter-rotation
    const spine = calculateSpineDynamics(Math.PI / 2, gait, 1.0, 0)
    expect(spine.forwardLean).toBeGreaterThan(0.05)
    // Spine counter-rotates opposite to pelvis
    expect(Math.sign(spine.counterYaw)).toBe(-Math.sign(pelvis.yaw))
    expect(Math.sign(spine.counterRoll)).toBe(-Math.sign(pelvis.roll))
  })

  it("swings arms in counter-phase to legs with natural elbow flexion", async () => {
    const {
      calculateArmDynamics,
    } = await import("../src/game/characters/playerMotion")

    // At walkPhase = Math.PI / 2, right arm swings forward (negative pitch in Three.js) and flexes
    const armsRightFwd = calculateArmDynamics(Math.PI / 2, 1.0)
    expect(armsRightFwd.rightPitch).toBeLessThan(-0.3)
    expect(armsRightFwd.leftPitch).toBeGreaterThan(0.3)
    expect(armsRightFwd.rightElbow).toBeGreaterThan(0.15)

    // At walkPhase = 3*Math.PI / 2, left arm swings forward and flexes
    const armsLeftFwd = calculateArmDynamics((3 * Math.PI) / 2, 1.0)
    expect(armsLeftFwd.leftPitch).toBeLessThan(-0.3)
    expect(armsLeftFwd.rightPitch).toBeGreaterThan(0.3)
    expect(armsLeftFwd.leftElbow).toBeGreaterThan(0.15)
  })

  it("alternates left and right feet symmetrically with exact 180-degree offset", async () => {
    const {
      STEP_LENGTH,
      calculateFootContact,
    } = await import("../src/game/characters/playerMotion")

    for (let p = 0; p < Math.PI * 2; p += 0.2) {
      const left = calculateFootContact(p, 0, STEP_LENGTH)
      const right = calculateFootContact(p, 1, STEP_LENGTH)
      expect(left.isStance !== right.isStance).toBe(true)
    }
  })
})


describe("ledges", () => {
  it("falls off a rock instead of snapping to the ground, then lands once", () => {
    const motion = createPlayerMotion()
    resetPlayerMotion(motion, 0.7)
    let contacts = 0
    let sawFall = false
    for (let i = 0; i < 60; i++) {
      if (stepPlayerMotion(motion, 1 / 60, 0, false)) contacts++
      if (motion.phase === "falling") sawFall = true
      if (i === 0) expect(motion.ground + motion.lift).toBeCloseTo(0.7, 6)
    }
    expect(sawFall).toBe(true)
    expect(contacts).toBe(1)
    expect(motion.lift).toBe(0)
  })

  it("walks down gentle slopes without leaving the ground", () => {
    const motion = createPlayerMotion()
    for (let i = 0; i < 60; i++) {
      stepPlayerMotion(motion, 1 / 60, -i * 0.05, false)
      expect(motion.phase).toBe("grounded")
    }
  })
})
