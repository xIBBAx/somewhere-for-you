import * as THREE from "three"
import type { HorseState } from "../horses/horseState"
import type { CompanionPoseScratch } from "./catRigPose"

/**
 * The cat's inner weather on Starborn's back.
 *
 * A cat reads its world through its body, and so does she. In a fright the
 * ears go flat and back, the pupils open wide, the body drops and the claws
 * hook in, the tail wraps tight, and only a real shock fluffs it out
 * (piloerection). Curiosity is the other half of a cat: ears pricked and
 * forward, whiskers fanned, a long still stare at something new, the head
 * craning to follow it. A cat that trusts the person beside her glances
 * back at them and gives them the slow blink. None of this is a script: the
 * flight itself (the leap off the ground, a dash, a roll, the black sky,
 * the quiet drift) moves three slow moods, and her pose is read from them.
 *
 * - fear: rises at once to a shock, ebbs slowly. Each flight she has
 *   survived makes the next take-off less frightening (habituation).
 * - wonder: grows while the flight is calm and the view is extraordinary:
 *   high over the land, the sky gone black, stars all round.
 * - ease: trust settling in; time aboard, closeness, a calm Starborn.
 */
export type RideMood = {
  fear: number
  wonder: number
  ease: number
  /** where she is looking (rad, relative to her facing) */
  lookYaw: number
  lookPitch: number
  /** next glance: at the explorer, at the ground, at the stars */
  glanceIn: number
  glance: "owner" | "down" | "up" | "around" | "ahead"
  glanceTime: number
  slowBlink: number
  /** flights she has been on (the first is the most overwhelming) */
  flights: number
  wasAirborne: boolean
  prevSpeed: number
  tailSwish: number
}

export const makeRideMood = (): RideMood => ({
  fear: 0, wonder: 0, ease: 0.3, lookYaw: 0, lookPitch: 0, glanceIn: 3, glance: "ahead", glanceTime: 0,
  slowBlink: 0, flights: 0, wasAirborne: false, prevSpeed: 0, tailSwish: 0,
})

const toward = (v: number, target: number, up: number, down: number, dt: number): number =>
  v + (target - v) * (1 - Math.exp(-(target > v ? up : down) * dt))

/**
 * Advance her moods for a frame on `h`. `thin` is how airless the sky is
 * (0 Earth's air … 1 space); `altitude` metres over the land.
 */
export const stepRideMood = (m: RideMood, h: HorseState, dt: number, thin: number, altitude: number, random: () => number): void => {
  const f = h.flight
  const airborne = !!f && f.mode !== "ground"
  const novelty = 1 / (1 + m.flights * 0.55)
  if (airborne && !m.wasAirborne) {
    // the ground drops away under her paws
    m.fear = Math.max(m.fear, 0.55 + 0.4 * novelty)
    m.flights++
    m.glance = "down"; m.glanceTime = 0; m.glanceIn = 2.5
  }
  m.wasAirborne = airborne
  const speed = Math.abs(h.speed)
  const accel = (speed - m.prevSpeed) / Math.max(dt, 1e-3)
  m.prevSpeed = speed
  // a surge (the dash, the overdrive), a roll or a hard bank: a jolt of fear
  let shock = 0
  if (airborne) {
    shock = Math.max(
      Math.min(1, Math.max(0, accel - 6) / 18),
      Math.min(1, Math.abs(f!.roll) / 1.4) * 0.6,
      Math.min(1, Math.abs(f!.spin ?? 0) / 1.2),
      Math.min(1, Math.max(0, speed - 60) / 80) * 0.7,
      f!.mode === "landing" ? 0.3 : 0,
    ) * (0.45 + 0.55 * novelty)
  }
  m.fear = toward(m.fear, Math.max(shock, airborne ? 0.12 * novelty : 0), 7, 0.22 + m.ease * 0.25, dt)
  // wonder grows when the flight is steady and the view is extraordinary
  const view = airborne ? Math.min(1, Math.max(thin * 1.1, (altitude - 25) / 220)) : 0
  const calm = 1 - Math.min(1, m.fear * 1.6)
  m.wonder = toward(m.wonder, view * calm, 0.18, 0.5, dt)
  m.ease = toward(m.ease, airborne ? 0.4 + 0.5 * calm : 0.85, 0.05, 0.4, dt)

  // where her eyes go: mostly ahead and down at the world sliding away,
  // up at the stars once they are out, and now and then back at the explorer
  m.glanceTime += dt
  m.glanceIn -= dt
  if (m.glanceIn <= 0) {
    const r = random()
    m.glance = m.fear > 0.55 ? (r < 0.6 ? "owner" : "ahead")
      : r < 0.22 + (1 - m.ease) * 0.2 ? "owner"
      : r < 0.5 ? (thin > 0.6 ? "up" : "down")
      : r < 0.75 ? "around" : "ahead"
    m.glanceTime = 0
    m.glanceIn = 2.5 + random() * (3 + m.wonder * 4)
    if (m.glance === "owner" && m.fear < 0.3 && m.ease > 0.5 && random() < 0.6) m.slowBlink = 1.4
  }
  let yaw: number, pitch: number
  switch (m.glance) {
    case "owner": yaw = 1.15 * Math.sign(Math.sin(m.flights * 1.7 + 0.6)); pitch = -0.25; break
    case "down": yaw = Math.sin(m.glanceTime * 0.35) * 0.6; pitch = 0.55; break
    case "up": yaw = Math.sin(m.glanceTime * 0.25) * 0.8; pitch = -0.6; break
    case "around": yaw = Math.sin(m.glanceTime * 0.5) * 1.0; pitch = Math.sin(m.glanceTime * 0.3) * 0.2; break
    default: yaw = 0; pitch = 0.1
  }
  // a frightened cat does not sightsee: head low, eyes on the rider
  yaw *= 1 - m.fear * 0.6
  pitch = THREE.MathUtils.lerp(pitch, 0.2, m.fear * 0.7)
  m.lookYaw = toward(m.lookYaw, yaw, 2.2, 2.2, dt)
  m.lookPitch = toward(m.lookPitch, pitch, 2.2, 2.2, dt)
  m.slowBlink = Math.max(0, m.slowBlink - dt)
  m.tailSwish += dt * (0.8 + m.wonder * 1.6)
}

/** Paint her moods onto the composed pose. */
export const applyRideMood = (pose: CompanionPoseScratch, m: RideMood, airborne: boolean): void => {
  const fear = m.fear, wonder = m.wonder
  // flat to Starborn's back, claws hooked in; curious, she lifts her chest to see
  pose.crouch = Math.max(pose.crouch ?? 0, fear * 0.85)
  pose.loaf = (pose.loaf ?? 0) * (1 - fear) * (1 - wonder * 0.5)
  pose.sit = Math.max(pose.sit ?? 0, airborne ? wonder * (1 - fear) * 0.55 : 0)
  pose.earFlat = Math.max(pose.earFlat ?? 0, fear * 0.75)
  // ears pricked and turned to whatever she is looking at
  pose.earSwivel = m.lookYaw * 0.6 * (1 - fear)
  pose.whisker = Math.max(-1, Math.min(1, wonder * 0.8 - fear * 0.6))
  pose.pupil = Math.min(0.9, Math.max(pose.pupil ?? 0.36, 0.38 + Math.max(fear, wonder * 0.85) * 0.5))
  // the slow blink at the explorer: trust
  const sb = m.slowBlink > 0 ? 1.4 - m.slowBlink : -1
  const blink = sb < 0 ? 0 : sb < 0.4 ? sb / 0.4 : sb < 0.85 ? 1 : Math.max(0, 1 - (sb - 0.85) / 0.55)
  pose.lids = Math.max((pose.lids ?? 0) * (1 - wonder), blink * 0.9)
  pose.lookYaw = m.lookYaw
  pose.lookPitch = m.lookPitch
  pose.headTilt = wonder * Math.sin(m.tailSwish * 0.4) * 0.18 * (1 - fear)
  // tail: wrapped tight round her when afraid, puffed only by a real shock,
  // a slow curious swish when she is taking it all in
  pose.tailWrap = Math.max(0, Math.min(1, 0.35 + fear * 0.65 - wonder * 0.3))
  pose.tailPuff = Math.max(pose.tailPuff ?? 0, Math.max(0, fear - 0.6) * 2.2)
  pose.tailLash = Math.max(pose.tailLash ?? 0, wonder * (1 - fear) * (0.25 + 0.2 * Math.sin(m.tailSwish)))
  pose.knead = Math.max(pose.knead ?? 0, fear * 0.3)
}
