import type { MountBody } from "../mounts/mount"

/**
 * The ground dash: every mount's surge past its gallop, asked for by holding
 * Shift on at a full gallop (or keeping the Run button on, on a touch screen).
 * No stamina: it lasts as long as the rider asks.
 *
 * Each kind has its own signature (GroundDashFX.tsx draws them):
 *   gale    an ordinary horse: clods of turf and soil flung from the hooves, dust and a low haze behind
 *   grove   a deer: leaves and pollen torn up from the ground, whirling in her wake
 *   pearl   Ivory on the ground: rose-pearl petals and a pearly mist
 *   ember   Onyx on the ground: gold embers struck from his hooves
 *   star    Starborn on the ground: hoofprints of starlight that glow and fade, stardust rising from them
 */

export type GroundDashKind = "gale" | "grove" | "pearl" | "ember" | "star"

/** how much faster than the gallop a surge carries each kind */
export const SURGE: Record<GroundDashKind, number> = { gale: 1.3, grove: 1.38, pearl: 1.34, ember: 1.28, star: 1.42 }

/** Shift held this long at a full gallop begins the surge (s) */
export const SURGE_AFTER = 0.75

export const groundDashKind = (h: MountBody & { ident: { breed?: string } } | null): GroundDashKind | null => {
  if (!h) return null
  if (h.kind === "deer") return "grove"
  const breed = (h.ident as { breed?: string }).breed
  if (breed === "ivory") return "pearl"
  if (breed === "onyx") return "ember"
  if (breed === "starborn") return "star"
  return "gale"
}

/** The ridden mount's surge, read by the effects, the camera and the sound. */
export const groundDashRT = {
  /** 0..1 eased: how fully the surge is on */
  amount: 0,
  /** the rider is asking for it now */
  on: false,
  kind: null as GroundDashKind | null,
  /** id of the mount surging */
  id: "",
  /** frames since the surge began (onset effects fire at 0) */
  since: 0,
  /** QA (`__worldDev.groundDash(true)`): hold the surge on while riding */
  qa: false,
}
