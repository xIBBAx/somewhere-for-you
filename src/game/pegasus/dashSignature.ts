/**
 * The dash of each Pegasus, as pure timing and shape rules. DashFX.tsx draws
 * them and dashAudio.ts sounds them; nothing here touches the scene, so the
 * maths can be tested on its own.
 *
 *   swift      Ivory: a swift's slipstream. One soft air-lens ripple on onset,
 *              wingtip vortices peeling off in rose-pearl light.
 *   thunder    Onyx: raw power. A golden condensation cone on onset, and a
 *              pressure ring thrown backward on every driving downstroke.
 *   starfall   Starborn: light gathered in out of the air and let go along
 *              both wings on her first great downstroke, a pulse of it on every
 *              beat after, a comet tail and, once the air is thin, a rip of light.
 *
 * Real: the downstroke timing (flight.ts puts the bottom of the stroke at
 * phase ~0.55) and the dash itself (flight.ts boostT). Magic and styling:
 * every envelope and size below.
 */

export type DashSignature = "swift" | "thunder" | "starfall"

/** The stroke phase at which a wing reaches the bottom of its downstroke (flight.ts). */
export const DOWNSTROKE_AT = 0.55

/** True when the cyclic stroke phase moved forward past `at` between two frames (0..1 wrap). */
export const strokeCrossed = (prev: number, now: number, at = DOWNSTROKE_AT): boolean => {
  const span = (now - prev + 1) % 1
  const to = (at - prev + 1) % 1
  return to > 0 && to <= span
}

/** Onset impulse: 1 on the first frame of a dash, ~0.05 by 0.6 s (exp(-5t)). */
export const onsetPunch = (t: number): number => Math.exp(-t * 5)

/** Ring growth over its life u (0..1): fast at first, then slowing (ease-out cubic). */
export const ringGrowth = (u: number): number => 1 - (1 - u) ** 3

/** Ring opacity over its life u: eased in over the first fifth (a swell of air, never a flash), then a soft tail. */
export const ringFade = (u: number): number => Math.min(1, u * 5) ** 2 * (1 - u) ** 1.6

/** Sound falloff: full at the camera, silent beyond `range` metres. */
export const dashGain = (dist: number, range: number): number => Math.max(0, 1 - dist / range) ** 1.6

/**
 * How many of a full-quality count an effect spawns. Low quality keeps about
 * 40%; reduced motion halves it again, so a calm version stays visible but still.
 */
export const densityScale = (level: "low" | "medium" | "high", reduced: boolean): number =>
  (level === "low" ? 0.4 : level === "medium" ? 0.7 : 1) * (reduced ? 0.5 : 1)

/** Size of rings and sparks under reduced motion: a little smaller, never gone. */
export const motionScale = (reduced: boolean): number => (reduced ? 0.6 : 1)

/**
 * Sparkles fade out as they near the chase camera, so nothing streams past
 * the lens or covers the creature. 0 within `near` metres, 1 beyond `far`.
 */
export const nearCameraFade = (dist: number, near = 2, far = 7): number => {
  const t = Math.min(1, Math.max(0, (dist - near) / (far - near)))
  return t * t * (3 - 2 * t)
}
