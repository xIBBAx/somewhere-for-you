/**
 * Envelope maths for the journey visuals and sound (pure: no three, no DOM).
 *
 * Everything here is presentation only: it turns travelRT's phase, progress
 * and strengths into how long the starlight streaks are, how fast they run,
 * how much the flash blooms and how loud the corridor is. Nothing here moves
 * Starborn; cosmicTravel.ts does that.
 *
 * Real: nothing in this file is physics. The speeds are chosen for legibility
 * (a corridor that reads as extraordinary speed without strobing).
 */

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth = (u: number): number => {
  const t = clamp01(u)
  return t * t * (3 - 2 * t)
}

/** how fast the streams run, 0..1, through a phase (1 = full corridor rush) */
export const warpSpeed = (phase: string, u: number): number => {
  if (phase === "corridor") return 1
  // a held breath: the light is drawn in towards her heart
  if (phase === "gather") return 0.3 + 0.1 * smooth(u)
  // she slows out of the corridor and the light falls away
  if (phase === "emerge") return 1 - smooth(u)
  return 0
}

/** streak length in metres, scaled by the corridor's strength (0..1) and the speed multiplier */
export const warpStretch = (intensity: number, speed: number): number => clamp01(intensity) * (2 + 36 * clamp01(speed))

/** metres per second the streaks travel past her (before reduced-motion scaling) */
export const warpPhaseRate = (speed: number, reduced: boolean): number => 240 * clamp01(speed) * (reduced ? 0.4 : 1)

/** the white bloom at opening and bursting out: never above a comfortable third, fading in ~0.3 s */
export const warpBloom = (flash: number, reduced: boolean): number => clamp01(flash) * 0.35 * (reduced ? 0.4 : 1)

/** suggested extra field of view (degrees) while the corridor is open; the camera owner applies it */
export const corridorFovBoost = (intensity: number): number => 5 * clamp01(intensity)

/** re-entry: cloud wisps rush up past her below ~15 km (game metres), full below ~9 km */
export const wispVisibility = (alt: number): number => 1 - smooth((alt - 9000) / 6000)

/** re-entry: wind streaks follow the pull (0..1) */
export const windVisibility = (pull: number): number => clamp01(pull)

/** space dust shows only out of the air (thin: 0 in home's sky, 1 in space) */
export const dustVisibility = (thin: number): number => smooth((thin - 0.35) / 0.55)

/** a dust mote's streak length from the mount's real speed (game m/s): a point when still */
export const dustStreak = (speed: number): number => clamp01(speed / 40) * 4

/** a motion-scaled streak length for dust: a point when still */
export const dustAlpha = (speed: number, thin: number): number => dustVisibility(thin) * (0.22 + 0.5 * clamp01(speed / 30))

/**
 * How fast the sky says she is going (v / c, for render/aberration.ts),
 * through a journey. The launch is a surge (most of the change in its first
 * moment), the run holds near the top with a slow breath, and the arrival
 * lets the sky unfold back to where the stars really are.
 * Quick travel flicks it briefly; reduced motion keeps it gentler.
 */
export const journeyBeta = (phase: string, u: number, quick: boolean, reduced: boolean, t = 0): number => {
  const top = (reduced ? 0.55 : 0.9) * (quick ? 0.6 : 1)
  if (phase === "corridor") {
    const surge = 1 - Math.pow(1 - clamp01(u / (quick ? 0.5 : 0.2)), 3)
    const settle = 1 - 0.65 * smooth((u - (quick ? 0.5 : 0.82)) / (quick ? 0.5 : 0.18))
    return top * surge * settle * (quick ? 1 : 1 - 0.03 * Math.sin(t * 1.3))
  }
  // the light falls back out: the last third of the speed unwinds as she slows
  if (phase === "emerge") return top * 0.35 * (1 - smooth(u / 0.75))
  // a held breath: the sky trembles toward her before the launch
  if (phase === "gather") return top * 0.06 * smooth(u)
  return 0
}

/** the launch's kick (0..1): the camera is left behind for a moment, then catches her */
export const launchKick = (phase: string, t: number): number =>
  phase === "corridor" ? Math.exp(-t * 2.4) * smooth(t / 0.12) : 0

/** how many nebula banks a corridor of this length passes through (of `banks` available) */
export const nebulaCount = (duration: number, banks: number): number =>
  duration > 6.5 ? banks : duration > 4.6 ? Math.min(2, banks) : Math.min(1, banks)

/** the corridor time (s) at which nebula bank i of n is passed */
export const nebulaMoment = (duration: number, i: number, n: number): number => duration * (i + 1) / (n + 1)
