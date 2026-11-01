import type { BiomeId } from "../../world/climate"
import type { GroundKind } from "../environment/ground/groundSurface"

/**
 * What a flying Pegasus does to the world around her, as pure numbers: how
 * strong the spray, the debris, the air rush and the wake are for a given
 * height, airspeed, dash and surface. The render and audio code (WakeFX,
 * CloudWakeFX, airAudio) only read these, so the feel can be tested alone.
 */

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

/** smooth 0→1 between a and b (the step used across the flight code) */
export const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/**
 * How much of a wing's wash reaches the surface below at height `alt` over a
 * half-span `semi` (m): all of it within about a span, none beyond ~3.4 spans
 * (the same reach downwash.ts uses for the grass).
 */
export const washReach = (alt: number, semi: number): number => 1 - smooth(semi * 0.9, semi * 3.4, alt)

/**
 * Spray thrown up off open water (0..1). A dash skimming a few metres up
 * flings sheets of it up and back; the lower she is and the faster she goes,
 * the more it throws. A slow glide only ruffles, and nothing above ~25 m reaches.
 */
export const sprayStrength = (alt: number, speed: number, dash: number, wash: number): number => {
  const low = 1 - smooth(3, 25, alt)
  const pace = smooth(3, 15, speed)
  return clamp01(low * pace * clamp01(0.3 + 0.5 * dash + 0.4 * wash))
}

/**
 * Ripple strength of one wake ring (0..1) laid down as she skims water. Pace
 * and dash make the rings bigger; a glide leaves small ones.
 */
export const wakeRingStrength = (speed: number, dash: number, wash: number): number =>
  clamp01(0.2 * smooth(2, 14, speed) + 0.45 * dash + 0.35 * clamp01(wash))

/** What a surface lifts into the air under a low wing. */
export type Feed = "none" | "dust" | "powder" | "petal" | "leaf"

/**
 * The loose stuff the wash picks up from the ground under her. Dry sand, soil
 * and rock give dust; snow gives powder; meadows give petals (blossom,
 * flower meadows) or leaves (autumn, woods, meadow); mud and water give nothing
 * (water has its own spray).
 */
export const feedFor = (ground: GroundKind, biome: BiomeId, snowy: boolean): Feed => {
  if (ground === "water" || ground === "built" || ground === "mud") return "none"
  if (snowy) return "powder"
  if (ground === "sand" || ground === "soil" || ground === "rock") return "dust"
  if (ground !== "grass") return "none"
  if (biome === "gulmohar" || biome === "flowerMeadow") return "petal"
  if (biome === "pine") return "none"
  return "leaf"
}

/** The rush of air over a flying body, as audio targets. */
export type AirSound = { rush: number; roar: number; hiss: number; tone: number; cutoff: number }

/**
 * Air-rush audio targets. Dense low air roars (roar); thin high air whispers
 * (the rush brightens and quietens as altitude climbs); a dash louder; cloud
 * muffles all of it (`cloud` 0..1); skimming water adds a hiss from the spray.
 * Space is silent, so callers pass nothing there.
 */
export const airSound = (alt: number, speed: number, dash: number, cloud: number, spray: number): AirSound => {
  const pace = smooth(2, 20, speed)
  const dense = 1 - smooth(10, 220, alt)
  const thin = smooth(60, 500, alt)
  const muffle = clamp01(cloud)
  const quiet = 1 - 0.55 * muffle
  return {
    rush: 0.05 * pace * (0.4 + 0.6 * dash) * (0.65 + 0.35 * thin) * quiet,
    roar: 0.11 * dense * pace * (0.35 + 0.65 * dash) * (1 - 0.8 * muffle),
    hiss: 0.07 * clamp01(spray) * (1 - 0.5 * muffle),
    tone: 1 + 0.8 * thin,
    cutoff: Math.max(260, (2200 + 3800 * thin + 1500 * dash) * (1 - 0.85 * muffle) + 500 * muffle),
  }
}

/**
 * Scale for particle counts and wake strengths from the quality preset's
 * particle budget, halved under prefers-reduced-motion (smaller, calmer).
 */
export const effectScale = (particles: number, reduced: boolean): number => particles * (reduced ? 0.5 : 1)

/** Dash amount eases toward 1 while she dashes and back to 0 when she eases off. */
export const dashTowards = (current: number, boosting: boolean, dt: number): number =>
  current + ((boosting ? 1 : 0) - current) * (1 - Math.exp(-dt * 5))

/**
 * Wrap a value into the cloud domain [-r, r) the way the cloud shader does
 * (`mod(p + R, 2R) - R`), so a formation's drawn place can be recomputed.
 */
export const wrapDomain = (v: number, r: number): number => {
  const d = 2 * r
  return (v + r) - Math.floor((v + r) / d) * d - r
}
