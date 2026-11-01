/**
 * The explorer's jump, tuned the way third-person adventure games tune theirs: an
 * immediate take-off, a fuller rise while the button is held and a short
 * hop when it is tapped, a breath of hang at the top, a quicker fall so she
 * comes down with weight instead of drifting, and a few frames of grace for
 * a jump pressed just after running off a ledge.
 *
 *   held:  ~1.5 m standing, ~1.75 m from a sprint, ~0.8 s in the air
 *   tapped: ~0.75 m
 */
/** Gravity on the way up (m/s²). */
export const PLAYER_GRAVITY = 21
/** Gravity once falling: heavier, so landings are quick and grounded. */
export const PLAYER_FALL_GRAVITY = 33
/** While rising with the button released: the jump is cut short. */
const CUT_GRAVITY = 52
/** Near the apex with the button held the arc eases (fraction of PLAYER_GRAVITY). */
const APEX_HANG = 0.6
const APEX_SPEED = 1.6
const TERMINAL_SPEED = 24
/** ≈1.5 m apex when held: onto boulders, walls and the meadow's rocks. */
export const PLAYER_JUMP_SPEED = 7.9
/** Landing absorption, seconds; it never delays the next jump. */
export const JUMP_LAND_TIME = 0.22
/** A sudden drop larger than this (walking off a rock) becomes a fall; smaller ones are eased. */
export const LEDGE_DROP = 0.42
/** Seconds after running off an edge in which a jump still takes off. */
export const COYOTE_TIME = 0.13
export type PlayerMotion = {
  phase: "grounded" | "rising" | "falling" | "landing"
  time: number
  lift: number
  velocity: number
  ground: number
  /** grace left for a jump after leaving an edge (s) */
  coyote: number
  /** speed of the hardest landing this frame reported, m/s (0 when none) */
  impact: number
}

export const createPlayerMotion = (): PlayerMotion => ({
  phase: "grounded", time: 0, lift: 0, velocity: 0, ground: 0, coyote: 0, impact: 0,
})

export const resetPlayerMotion = (motion: PlayerMotion, ground: number): void => {
  motion.phase = "grounded"
  motion.time = 0
  motion.lift = 0
  motion.velocity = 0
  motion.ground = ground
  motion.coyote = 0
  motion.impact = 0
}

/** The launch speed of a full jump under a gravity (× Earth's): a little less push in low gravity, the leap still far higher and slower. */
export const jumpSpeedFor = (gravityScale: number): number => PLAYER_JUMP_SPEED * Math.pow(gravityScale, 0.3)

/** A running take-off carries more: up to ~+8 % launch speed at a full sprint. */
export const runningLaunch = (gravityScale: number, speed: number): number =>
  jumpSpeedFor(gravityScale) * (1 + 0.08 * Math.min(1, Math.max(0, speed) / 6.6))

/**
 * Returns true once at ground contact, for the landing sound and pose.
 * `gravityScale` is the world's gravity over Earth's (the Moon: 0.165) and
 * `launch` the take-off speed of this jump (a full jump by default).
 * `hold` is whether the jump button is still down (false cuts the rise).
 */
export const stepPlayerMotion = (
  motion: PlayerMotion, dt: number, ground: number, jump: boolean, gravityScale = 1, launch = jumpSpeedFor(gravityScale), hold = true,
): boolean => {
  motion.time += dt
  motion.impact = 0
  motion.coyote = Math.max(0, motion.coyote - dt)
  if ((motion.phase === "grounded" || motion.phase === "landing") && motion.ground - ground > LEDGE_DROP && !jump) {
    // stepped off an edge: fall from where the feet were, with a moment's grace to still jump
    motion.phase = "falling"
    motion.time = 0
    motion.velocity = 0
    motion.lift = motion.ground - ground
    motion.ground = ground
    motion.coyote = COYOTE_TIME
    return false
  }
  const coyoteJump = jump && motion.phase === "falling" && motion.coyote > 0
  if (motion.phase === "grounded" || motion.phase === "landing" || coyoteJump) {
    if (!coyoteJump) motion.lift = 0
    if (jump) {
      // Consume the press and integrate takeoff in this same update. Keep
      // the launch height when the horizontal step just crossed a ledge.
      const from = motion.ground + motion.lift
      motion.ground = Math.max(ground, Math.min(from, motion.ground))
      motion.lift = Math.max(0, from - motion.ground)
      motion.phase = "rising"
      motion.time = dt
      motion.velocity = launch
      motion.coyote = 0
    } else if (motion.phase === "landing" && motion.time >= JUMP_LAND_TIME) {
      motion.phase = "grounded"
      motion.time = 0
    }
    if (!jump) {
      motion.ground = ground
      return false
    }
  }
  if (motion.phase === "rising" || motion.phase === "falling") {
    // Integrate absolute altitude so terrain changes do not bend the flight arc.
    // On another world its own gravity (the Moon's is a sixth of Earth's).
    const rising = motion.velocity > 0
    const base = rising
      ? hold ? (motion.velocity < APEX_SPEED ? PLAYER_GRAVITY * APEX_HANG : PLAYER_GRAVITY) : CUT_GRAVITY
      : PLAYER_FALL_GRAVITY
    const g = base * gravityScale
    const altitude = motion.ground + motion.lift + motion.velocity * dt - 0.5 * g * dt * dt
    motion.velocity = Math.max(-TERMINAL_SPEED, motion.velocity - g * dt)
    motion.ground = ground
    motion.lift = altitude - ground
    if (motion.velocity <= 0) motion.phase = "falling"
    if (motion.lift <= 0 && motion.velocity <= 0) {
      motion.impact = -motion.velocity
      motion.lift = 0
      motion.velocity = 0
      motion.phase = "landing"
      motion.time = 0
      return true
    }
  }
  return false
}

/** Biomechanical traversal parameters satisfying real human gait dynamics. */
export const DEFAULT_TRAVERSAL_SPEED = 1.88
export const STEP_LENGTH = 0.90
export const STRIDE_LENGTH = 1.80
export const STEP_CADENCE = DEFAULT_TRAVERSAL_SPEED / STEP_LENGTH // ~2.089 steps/s
export const WALK_ACCEL = 42
export const WALK_DECEL = 26

/** Advances the distance-driven walk cycle phase so ground displacement and animation agree exactly. */
export const advanceWalkPhase = (
  walkPhase: number,
  speed: number,
  dt: number,
  stepLength: number = STEP_LENGTH,
): number => {
  return walkPhase + (speed * dt * Math.PI) / stepLength
}

export type FootState = {
  z: number
  y: number
  rotX: number
  isStance: boolean
  progress: number
}

/** Computes foot stance and swing kinematics with zero ground sliding.
 * During stance (u: 0 -> 1), dz/dt = -velocity, matching world-space forward travel exactly.
 */
export const calculateFootContact = (
  walkPhase: number,
  sideIndex: number, // 0: left, 1: right
  stepLength: number = STEP_LENGTH,
  maxLift: number = 0.075,
): FootState => {
  // Normalize cycle phase into [0, 1) with opposite feet 180 degrees (0.5) out of phase.
  const phase = ((walkPhase / (Math.PI * 2) + sideIndex * 0.5) % 1 + 1) % 1
  const isStance = phase < 0.5
  const u = isStance ? phase * 2 : (phase - 0.5) * 2

  if (isStance) {
    // Stance phase: foot travels backward in character space from +stepLength/2 to -stepLength/2
    const z = (0.5 - u) * stepLength
    // Heel strike (0..0.15) -> flat foot (0.15..0.70) -> push-off / toe-off (0.70..1.0)
    let rotX = 0
    if (u < 0.15) {
      rotX = (1 - u / 0.15) * 0.18 // heel strike tilt
    } else if (u > 0.70) {
      rotX = -((u - 0.70) / 0.30) * 0.32 // push-off extension
    }
    return { z, y: 0, rotX, isStance: true, progress: u }
  } else {
    // Swing phase: foot returns forward from -stepLength/2 to +stepLength/2 via smooth curve
    const swingSmooth = 3 * u * u - 2 * u * u * u
    const z = (-0.5 + swingSmooth) * stepLength
    const y = Math.sin(u * Math.PI) * maxLift
    // Ankle flexion: toe down in early swing, dorsiflexion preparing for heel strike in late swing
    const rotX = -Math.sin(u * Math.PI * 2) * 0.20
    return { z, y, rotX, isStance: false, progress: u }
  }
}

export type PelvisDynamics = {
  bounce: number
  roll: number
  yaw: number
}

/** Biomechanical pelvis participation: vertical bounce, Trendelenburg lateral tilt, and axial rotation. */
export const calculatePelvisDynamics = (
  walkPhase: number,
  gait: number,
): PelvisDynamics => {
  return {
    // Drops during mid-stance shock absorption, peaks during push-off
    bounce: -Math.abs(Math.sin(walkPhase)) * 0.025 * gait,
    // Lateral weight shift over stance leg (~3.2°)
    roll: Math.sin(walkPhase) * 0.055 * gait,
    // Pelvic axial twist forward with swing leg (~4.6°)
    yaw: -Math.sin(walkPhase) * 0.08 * gait,
  }
}

export type SpineDynamics = {
  forwardLean: number
  counterYaw: number
  counterRoll: number
}

/** Biomechanical spine & torso dynamics: forward lean and counter-rotation to stabilize head/sightline. */
export const calculateSpineDynamics = (
  walkPhase: number,
  gait: number,
  speedNorm: number,
  startAnticipation: number,
): SpineDynamics => {
  return {
    forwardLean: 0.062 * speedNorm + startAnticipation * 0.035,
    counterYaw: Math.sin(walkPhase) * 0.06 * gait,
    counterRoll: -Math.sin(walkPhase) * 0.032 * gait,
  }
}

export type ArmDynamics = {
  leftPitch: number
  rightPitch: number
  leftElbow: number
  rightElbow: number
}

/** Natural shoulder-driven counter-phase arm swing with elbow flexion on forward stroke. */
export const calculateArmDynamics = (
  walkPhase: number,
  gait: number,
): ArmDynamics => {
  // Left arm swings forward with right leg (when walkPhase approaches pi)
  const leftPitch = Math.sin(walkPhase) * 0.38 * gait
  const rightPitch = -Math.sin(walkPhase) * 0.38 * gait
  // Natural elbow flexion when swinging forward
  const leftElbow = Math.max(0, -leftPitch) * 0.42 + 0.08
  const rightElbow = Math.max(0, -rightPitch) * 0.42 + 0.08
  return { leftPitch, rightPitch, leftElbow, rightElbow }
}
