import { clamp, damp } from "../../utils/math"

/** Retained shallow water fills after the soil wets and drains after rainfall. */
export const stepSurfaceWater = (level: number, rain: number, wetness: number, heat: number, wind: number, dt: number, burst = 0): number => {
  const saturation = clamp((wetness - 0.35) / 0.65, 0, 1)
  const supply = clamp(rain, 0, 1) * saturation
  const target = Math.min(1, supply * 1.35)
  // a cloudburst floods the ground several times faster than heavy rain
  const rate = target > level ? 0.065 * (1 + clamp(burst, 0, 1) * 3) : 0.012 + clamp(heat, 0, 1) * 0.025 + clamp(wind, 0, 1) * 0.012
  return clamp(damp(level, target, rate, Math.max(0, dt)), 0, 1)
}
