/**
 * The explorer's movement tuning and distance-driven gait.
 *
 * The gait phase advances by *distance travelled*, never by time, so the
 * animation is locked to the real ground speed: a stance foot moves backward
 * in character space at exactly the body's forward speed and therefore stays
 * planted in the world (no foot skating), at any speed.
 */

/** Default (full stick / key) movement: a brisk, happy jog. */
export const MOVE_SPEED = 3.7
/** Holding Shift (or the touch run toggle). */
export const RUN_SPEED = 6.6
/** Exponential rates (1/s). ~95 % of target speed in ≈0.25 s, stops in ≈0.2 s. */
export const ACCEL_RATE = 12
export const DECEL_RATE = 15
/** Facing follows velocity; faster when running so turns stay crisp. */
export const TURN_RATE = 13

export type GaitParams = {
  /** steps per second (two steps = one cycle) */
  cadence: number
  /** metres travelled per step */
  stepLength: number
  /** fraction of the cycle each foot spends on the ground */
  duty: number
  /** peak swing-foot lift (m) */
  lift: number
  /** vertical pelvis bob amplitude (m) */
  bob: number
  /** 0 walk … 1 full run, for posture blending */
  runBlend: number
}

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Persistent scalar state; allocate once, then reuse for every frame. */
export class MotionSpring {
  velocity = 0

  constructor(public value = 0) {}

  /**
   * Exact critically damped solution for a constant target. `settleTime` is
   * seconds to cover 95% of a step from rest (omega = 4.744 / settleTime).
   * A retarget keeps velocity, including the small follow-through on reversal.
   * Unlike Euler integration, this remains stable for long or uneven frames.
   */
  to(target: number, settleTime: number, dt: number): number {
    if (dt <= 0 || !Number.isFinite(dt)) return this.value
    const omega = 4.744 / Math.max(0.001, settleTime)
    const offset = this.value - target
    const drift = this.velocity + omega * offset
    const decay = Math.exp(-omega * dt)
    this.value = target + (offset + drift * dt) * decay
    this.velocity = (this.velocity - omega * drift * dt) * decay
    return this.value
  }

  /** Bounded action envelope, with separate enter/exit times in seconds. */
  weight(target: number, enter: number, exit: number, dt: number): number {
    target = clamp(target, 0, 1)
    this.to(target, target > this.value ? enter : exit, dt)
    // A moving spring can briefly overshoot after a retarget. Weights must
    // remain convex blends; cancel only the outward velocity at a boundary.
    if (this.value < 0) {
      this.value = 0
      this.velocity = Math.max(0, this.velocity)
    } else if (this.value > 1) {
      this.value = 1
      this.velocity = Math.min(0, this.velocity)
    }
    return this.value
  }
}

/**
 * Underdamped cloth: preserve the authored k/c and integrate both drape links
 * at <= 1/240 s. Semi-implicit substeps keep 20 Hz frames and hitches stable.
 */
export const stepDrapeSpring = (state: MotionSpring, target: number, stiffness: number, damping: number, dt: number): number => {
  if (dt <= 0 || !Number.isFinite(dt)) return state.value
  const steps = Math.ceil(dt * 240)
  const h = dt / steps
  for (let i = 0; i < steps; i++) {
    state.velocity += (stiffness * (target - state.value) - damping * state.velocity) * h
    state.value += state.velocity * h
  }
  return state.value
}

export const gaitFor = (speed: number, out: GaitParams): GaitParams => {
  const v = Math.max(0, speed)
  // natural cadence rises with speed, saturating for her short legs
  out.cadence = clamp(1.7 + 0.6 * v, 1.7, 4.7)
  out.stepLength = v / out.cadence
  out.runBlend = smooth(1.6, 4.6, v)
  // walking keeps a foot down >50 % of the time; running gains a flight phase
  out.duty = 0.62 - out.runBlend * 0.28
  out.lift = 0.05 + out.runBlend * 0.1
  out.bob = 0.012 + out.runBlend * 0.03
  return out
}

/** Advance the cycle phase (0..1 per two steps) by distance travelled. */
export const advanceGait = (phase: number, speed: number, dt: number, gait: GaitParams): number => {
  if (gait.stepLength < 1e-4) return phase
  const cycles = (speed * dt) / (gait.stepLength * 2)
  return (phase + cycles) % 1
}

export type FootSample = {
  /** forward offset from the hip in character space (m) */
  z: number
  /** lift above ground (m) */
  y: number
  /** toe pitch (rad), + = toe down */
  pitch: number
  stance: boolean
  /** 0..1 progress through stance or swing */
  t: number
}

/**
 * Foot position for one leg. `side` 0 = left, 1 = right (half a cycle apart).
 * During stance dz/dt = −speed exactly.
 */
export const footAt = (phase: number, side: number, gait: GaitParams, out: FootSample): FootSample => {
  const p = (phase + side * 0.5) % 1
  const stanceLen = 2 * gait.duty * gait.stepLength
  if (p < gait.duty) {
    const u = p / gait.duty
    out.stance = true
    out.t = u
    out.z = (0.5 - u) * stanceLen
    out.y = 0
    // heel strike → flat → push-off
    out.pitch = u < 0.15 ? -(1 - u / 0.15) * 0.22 : u > 0.72 ? ((u - 0.72) / 0.28) * 0.42 : 0
  } else {
    const u = (p - gait.duty) / (1 - gait.duty)
    out.stance = false
    out.t = u
    const s = u * u * (3 - 2 * u)
    out.z = (-0.5 + s) * stanceLen
    // Zero vertical velocity at lift-off/touchdown avoids a knee jerk when
    // duty changes through walk/run or when stepping out of deep water.
    const arc = Math.sin(u * Math.PI)
    out.y = arc * arc * gait.lift * (0.6 + 0.4 * Math.min(1, stanceLen / 0.6))
    out.pitch = 0.42 * (1 - smooth(0, 0.35, u)) - 0.18 * smooth(0.6, 1, u)
  }
  return out
}

/** Pelvis vertical offset: lowest at mid-stance, highest mid-swing/flight. */
export const pelvisBob = (phase: number, gait: GaitParams): number =>
  -Math.cos(phase * Math.PI * 4) * gait.bob - gait.bob * 0.6

/** Exponential approach used for acceleration (pure, for tests). */
export const approach = (current: number, target: number, rate: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-rate * dt))
