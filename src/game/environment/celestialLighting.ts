import { Vector3 } from "three"
import { smoothstep } from "../../utils/math"

/** Shared by the light, visible moon and weather reflections. World time is
 * the existing morning-to-night story palette, rather than a 24-hour clock. */
export const nightBlend = (time: number): number => smoothstep(0.76, 0.96, time)
export const solarVisibility = (time: number): number => 1 - smoothstep(0.76, 0.88, time)

/**
 * World time runs day → twilight → night on one 0…1 curve for both the
 * evening and the morning. `morning` (0 or 1) mirrors the sun's azimuth about
 * its midday bearing, so the sun rises on the opposite side from where it
 * sets. It only switches while that is invisible: on the midday plateau,
 * where both bearings agree, or in deep night, when the key light is the
 * moon (whose path is unchanged).
 */
export const celestialRT = { morning: 0 }
// the sun's horizontal bearing at midday (time 0.05), as a unit vector
const NOON_X = Math.cos(0.965) * 30, NOON_Z = Math.sin(0.965) * 16 + 6
const NOON_LEN = Math.hypot(NOON_X, NOON_Z)
const NX = NOON_X / NOON_LEN, NZ = NOON_Z / NOON_LEN

export const sunDirection = (time: number, out: Vector3, morning = celestialRT.morning): Vector3 => {
  const angle = 0.9 + 1.3 * time
  let x = Math.cos(angle) * 30, z = Math.sin(angle) * 16 + 6
  if (morning > 0) {
    // reflect the bearing across the midday line: same height, other side
    const along = x * NX + z * NZ
    const mx = 2 * along * NX - x, mz = 2 * along * NZ - z
    x += (mx - x) * morning; z += (mz - z) * morning
  }
  return out.set(x, 22 - 16 * time, z).normalize()
}

export const moonPosition = (time: number, out: Vector3): Vector3 => {
  const angle = 0.9 + 1.3 * time + Math.PI
  const progress = time >= 0.65 ? (time - 0.65) / 0.35 : (time + 0.35) / 0.55
  return out.set(Math.cos(angle) * 65, 12 + 20 * Math.sin(Math.min(1, progress) * Math.PI / 2), Math.sin(angle) * 65 * 0.65 + 6)
}

const moon = new Vector3()
export const keyLightDirection = (time: number, out: Vector3, morning = celestialRT.morning): Vector3 =>
  sunDirection(time, out, morning).lerp(moonPosition(time, moon).normalize(), nightBlend(time)).normalize()

/** Safe moments to change the morning flag (see celestialRT). */
export const canSwitchMorning = (time: number): boolean => time > 0.955 || Math.abs(time - 0.05) < 0.015

/** 0 … 1: how much of the current light is a dawn rather than a dusk. */
export const dawnWeight = (time: number, morning = celestialRT.morning): number =>
  morning * smoothstep(0.3, 0.62, time) * (1 - smoothstep(0.92, 0.99, time))

/** Clouds must attenuate moonlight too; an overcast night cannot add daylight. */
export const skyLightLevel = (time: number, cloud: number, rain: number): number => {
  const golden = Math.max(0, 1 - Math.abs(time - 0.72) * 3.2)
  const daylight = (1 + golden * 0.35) * solarVisibility(time)
  const moonlight = nightBlend(time) * 0.045
  return (daylight + moonlight) * Math.max(0.12, 1 - cloud * 0.6 - rain * 0.28)
}
