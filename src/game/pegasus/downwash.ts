import { useFrame } from "@react-three/fiber"
import { horseRT, type HorseState } from "../horses/horseState"
import { originRT } from "../../world/origin"
import { grassUniforms } from "../../world/render/GrassField"
import { spaceRT } from "../celestial/spaceState"
import { isPegasus } from "./pegasi"
import type { FlightState } from "./flight"

/**
 * The downwash of a big wing flying low. A wing makes its lift by throwing
 * air down; near the ground that air spreads out across it, so a large bird
 * landing, taking off or beating along just over a meadow presses the grass
 * flat and outward, a pulse with every downstroke. Onyx's broad, deep
 * strokes do it hardest (skills.ts `downwash`); a glide hardly stirs it.
 */

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Strength of the wash at the ground (0..~1.3) for a flight, its wing's half-span `semi` (m). */
export const downwashStrength = (f: FlightState, semi: number, altitude = f.alt): number => {
  const k = f.skills
  if (!k || f.mode === "ground" || f.mode === "sail") return 0
  // the wake reaches the ground from about two spans up, fully under one
  const low = 1 - smooth(semi * 0.9, semi * 3.4, altitude)
  if (low <= 0) return 0
  // a pulse with each downstroke (the bottom of the stroke is near phase 0.55)
  const stroke = 0.55 + 0.45 * Math.sin(Math.PI * 2 * (f.flap - 0.3))
  const beating = f.power * (1 - f.glide * 0.8)
  const hard = f.mode === "takeoff" || f.mode === "landing" ? 1.25 : f.boostT > 0 ? 1.15 : 1
  return k.downwash * low * (0.25 + 0.75 * beating * stroke) * hard
}

/** Writes the strongest wash near the player into the grass each frame. */
export const PegasusDownwash = (): null => {
  useFrame(() => {
    let best = 0
    let at: HorseState | null = null
    if (spaceRT.realm === "earth" && spaceRT.mode === "local") {
      for (const h of horseRT.horses.values()) {
        if (!isPegasus(h) || !h.flight || !h.visible) continue
        const w = downwashStrength(h.flight, h.model?.meta.wing?.semi ?? 3.2)
        if (w > best) { best = w; at = h }
      }
    }
    const u = grassUniforms.uDownwash.value
    if (at) {
      u.set(at.x - originRT.x, 0, at.z - originRT.z, best)
      grassUniforms.uDownwashR.value = (at.model?.meta.wing?.semi ?? 3.2) * 2.4
    } else u.w = 0
  })
  return null
}
