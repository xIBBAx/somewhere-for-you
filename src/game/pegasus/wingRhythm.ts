/** Demand changes the timing of the shared flight phase, never a second clock. */
export type WingRhythmPose = {
  power: number; glide: number; tuck: number; flare: number
  mode?: "ground" | "takeoff" | "air" | "landing" | "sail"
  speed?: number; accel?: number; personality?: string; brake?: number
}
const clamp = (v: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, v))

export const wingRhythm = (w: WingRhythmPose) => {
  const eagle = w.personality === "onyx", star = w.personality === "starborn"
  const grace = w.personality === "ivory"
  const demand = clamp(w.power * 0.65 + w.flare * 0.3 + (w.brake ?? 0) * 0.2
    + clamp((w.accel ?? 0) / 12) * 0.15 + (w.mode === "takeoff" ? 0.3 : 0))
  const support = clamp((Math.abs(w.speed ?? 0) - 6) / 32)
  return {
    demand,
    cadence: (eagle ? 0.86 : grace ? 0.94 : star ? 1.02 : 1) * (0.88 + demand * 0.3)
      * (1 - support * 0.08 * (1 - demand))
      * (1 - clamp(w.glide) * 0.9) * (1 - clamp(w.tuck) * 0.28),
    downShare: (eagle ? 0.62 : grace ? 0.58 : star ? 0.54 : 0.55) - demand * 0.035 + support * 0.025 * (1 - demand),
    amplitude: eagle ? 1.12 : grace ? 0.94 : 1,
    lag: eagle ? 0.085 : grace ? 0.065 : 0.075,
    expression: star ? 1.25 : eagle ? 0.7 : 1,
  }
}

/** HorseSystem calls this once, before assigning w.flap, so VFX and body agree. */
export const advanceWingbeat = (phase: number, dt: number, baseHz: number, w: WingRhythmPose): number => {
  const p = ((phase % 1) + 1) % 1
  if (w.mode === "ground") return p
  // on her sails the beat runs only with real power (a journey's launch, a surge), slow and deep
  if (w.mode === "sail") return (p + Math.max(0, baseHz) * clamp(dt, 0, 0.5) * 0.6 * clamp(w.power * 1.4 - 0.15)) % 1
  return (p + Math.max(0, baseHz) * clamp(dt, 0, 0.5) * wingRhythm(w).cadence) % 1
}
