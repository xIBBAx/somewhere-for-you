import { WATER_LEVEL } from "../climate"
import { worldHeight } from "../terrain"
import { highvaleMaps } from "./highvaleData"
import { RIVER_N0, RIVER_N1, riverE, riverLevel, riverWidth, toLocal, toWorld } from "./highvaleLayout"

/**
 * The river as water: its surface along the valley, read from the terrain
 * that was actually baked rather than the planned bank height alone. Where
 * the river falls through the gorge into the lake the plan's bank sits well
 * above the eroded bed, so the surface follows the bed (about 1.9 m over it,
 * as in the carve) and never climbs going downstream; it ends on the lake.
 */
const STEP = 2
const DEPTH = 1.9
let profile: Float32Array | null = null

const build = (): Float32Array | null => {
  if (!highvaleMaps.data) return null
  const count = Math.floor((RIVER_N1 - RIVER_N0) / STEP) + 1
  const out = new Float32Array(count)
  for (let k = 0; k < count; k++) {
    const n = RIVER_N0 + k * STEP
    const [x, z] = toWorld(riverE(n), n)
    out[k] = Math.min(riverLevel(n), worldHeight(x, z) + DEPTH)
  }
  // downstream is toward RIVER_N0: water never runs uphill
  for (let k = 1; k < count; k++) out[k] = Math.max(out[k], out[k - 1])
  for (let k = 0; k < count; k++) out[k] = Math.max(out[k], WATER_LEVEL)
  return out
}

/** Water surface height of the river at northing n (null before the maps load). */
export const surfaceLevel = (n: number): number | null => {
  profile ??= build()
  if (!profile) return null
  const f = Math.min(profile.length - 1.001, Math.max(0, (n - RIVER_N0) / STEP))
  const i = Math.floor(f), t = f - i
  return profile[i] * (1 - t) + profile[i + 1] * t
}

/** How steeply the river falls at northing n (rise over run, >= 0): rapids where large. */
export const riverFall = (n: number): number => {
  const a = surfaceLevel(n + 12), b = surfaceLevel(n - 12)
  return a === null || b === null ? 0 : Math.max(0, (a - b) / 24)
}

/** Half-width (m) of the band the water may cover; the bed itself decides the edge. */
export const riverReach = (n: number): number => riverWidth(n) * 1.15

/** The river's surface over world (x, z), or null where there is no river water. */
export const highvaleRiverSurfaceAt = (x: number, z: number): number | null => {
  const [e, n] = toLocal(x, z)
  if (n < RIVER_N0 || n > RIVER_N1) return null
  if (Math.abs(e - riverE(n)) > riverReach(n)) return null
  const level = surfaceLevel(n)
  if (level === null || level <= WATER_LEVEL + 0.05) return null
  return worldHeight(x, z) < level ? level : null
}
