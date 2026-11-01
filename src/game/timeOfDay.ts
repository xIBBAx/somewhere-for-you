import { smoothstep } from "../utils/math"

export type WorldTimeMode = "auto" | "day" | "night"

export type LocalTimeContext = {
  nowMs: number
  sunrise?: number
  sunset?: number
  isDay?: boolean
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t
const MINUTE = 60_000

/** Browser-clock fallback when weather/location data is unavailable. */
export const localClockTimeTarget = (date: Date): number => {
  const hour = date.getHours() + date.getMinutes() / 60
  if (hour < 5.25 || hour >= 20) return 1
  if (hour < 7) return mix(0.92, 0.05, smoothstep(5.25, 7, hour))
  if (hour < 15.5) return 0.05
  if (hour < 18.5) return mix(0.05, 0.8, smoothstep(15.5, 18.5, hour))
  return mix(0.8, 1, smoothstep(18.5, 20, hour))
}

/** Sunrise/sunset-aware mapping onto the world's day → twilight → night palette. */
export const automaticTimeTarget = ({
  nowMs,
  sunrise,
  sunset,
}: LocalTimeContext): number => {
  if (
    sunrise === undefined ||
    sunset === undefined ||
    !Number.isFinite(sunrise + sunset) ||
    sunrise >= sunset
  ) {
    return localClockTimeTarget(new Date(nowMs))
  }

  const dawnStart = sunrise - 45 * MINUTE
  const morningEnd = sunrise + 75 * MINUTE
  const goldenStart = sunset - 150 * MINUTE
  const nightStart = sunset + 60 * MINUTE

  if (nowMs < dawnStart || nowMs >= nightStart) return 1
  if (nowMs < morningEnd) {
    return mix(0.92, 0.05, smoothstep(dawnStart, morningEnd, nowMs))
  }
  if (nowMs < goldenStart) return 0.05
  if (nowMs < sunset) {
    return mix(0.05, 0.82, smoothstep(goldenStart, sunset, nowMs))
  }
  return mix(0.82, 1, smoothstep(sunset, nightStart, nowMs))
}

export const explorationTimeTarget = (
  mode: WorldTimeMode,
  context: LocalTimeContext,
): number => {
  if (mode === "day") return 0
  if (mode === "night") return 1
  return automaticTimeTarget(context)
}

export const nextTimeMode = (mode: WorldTimeMode): WorldTimeMode => {
  if (mode === "auto") return "day"
  if (mode === "day") return "night"
  return "auto"
}

/**
 * Is the world in its morning half? Only the automatic clock has mornings:
 * before solar noon (midway between sunrise and sunset), or before 12:00 on
 * the browser clock when the sun times are unknown. Pinned day and night
 * modes keep the familiar evening sky.
 */
export const isMorning = (mode: WorldTimeMode, { nowMs, sunrise, sunset }: LocalTimeContext): boolean => {
  if (mode !== "auto") return false
  if (sunrise !== undefined && sunset !== undefined && Number.isFinite(sunrise + sunset) && sunrise < sunset) {
    const noon = (sunrise + sunset) / 2
    // after midnight the coming sunrise is the reference
    const day = 86_400_000
    const t = ((nowMs - noon) % day + day) % day
    return t > day / 2
  }
  return new Date(nowMs).getHours() < 12
}
