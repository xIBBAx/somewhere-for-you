import { debugEnabled } from "./debugFlag"
import { celestialRT } from "../game/environment/celestialLighting"
import { cameraRT, catRT, avatarRT, input, resetRuntime, worldRT } from "../game/runtime"
import { setWeatherOverride } from "../game/weather/weatherState"
import type { WeatherOverride } from "../game/weather/weatherTypes"
import { BIOMES, dominantBiome, type BiomeId } from "../world/climate"
import { chunkColliders } from "../world/colliders"
import { waterDepthAt } from "../world/waterSurface"
import { colliderTop } from "../game/movement"

/**
 * Development-only QA shortcuts on `window.__worldDev` (only with ?debug).
 * Kept separate from the on-screen debug panel so systems can register their
 * own helpers (`registerDevTool`) without touching shared UI code.
 *
 *   __worldDev.time("sunset" | "midnight" | "noon" | "dusk" | "dawn" | 0..1 | null)
 *   __worldDev.weather("rain" | "fog" | "thunderstorm" | ... | null)
 *   __worldDev.lake()            teleport to the nearest deep-lake shore
 *   __worldDev.boulder()         teleport beside the nearest standable boulder
 *   __worldDev.biome("pine")     teleport to the nearest place of that biome
 *   __worldDev.far(km)           teleport km further along the current heading
 *   __worldDev.camera(pitch, distance, yaw?)
 *   __worldDev.goto(x, z)        teleport anywhere
 */

type DevTools = Record<string, (...args: never[]) => unknown>
type DevWindow = Window & { __worldDev?: DevTools }

const TIMES: Record<string, number> = { noon: 0, day: 0.05, afternoon: 0.45, golden: 0.62, sunset: 0.72, dawn: 0.78, dusk: 0.84, night: 0.95, midnight: 1 }

const teleport = (x: number, z: number): { x: number; z: number } => {
  resetRuntime({ x, z })
  catRT.pos.set(x + 1.2, 0, z + 0.6)
  return { x: +x.toFixed(1), z: +z.toFixed(1) }
}

/** Spiral search outward from the player for the first point matching `test`. */
const spiral = (test: (x: number, z: number) => boolean, maxRadius = 3000, step = 24): { x: number; z: number } | null => {
  const ox = avatarRT().pos.x
  const oz = avatarRT().pos.z
  for (let r = step; r <= maxRadius; r += step) {
    const n = Math.max(8, Math.round((Math.PI * 2 * r) / step))
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const x = ox + Math.cos(a) * r
      const z = oz + Math.sin(a) * r
      if (test(x, z)) return { x, z }
    }
  }
  return null
}

const tools: DevTools = {
  goto: (x: number, z: number) => teleport(x, z),
  /**
   * free inspection camera: look(px, py, pz, tx, ty, tz) or look(null) to release.
   * With follow = true the points are in the active character's own frame
   * (x = her left, y = up from the ground, z = forward), e.g. a face close-up:
   * look(0, 1.45, 0.6, 0, 1.44, 0, true)
   */
  look: (px: number | null, py = 0, pz = 0, tx = 0, ty = 0, tz = 0, follow = false) => {
    const cam = worldRT.inspectionCamera
    if (px === null) { cam.active = false; return false }
    Object.assign(cam, { active: true, follow, px, py, pz, tx, ty, tz })
    return true
  },
  character: () => { input.switchCharacter = true },
  time: (t: number | string | null) => {
    const value = t === null ? null : typeof t === "number" ? t : TIMES[t] ?? null
    worldRT.timeOverride = value
    if (value !== null) worldRT.timeOfDay = value
    return value
  },
  weather: (preset: WeatherOverride | null) => {
    setWeatherOverride(preset)
    return preset
  },
  lake: () => {
    const deep = spiral((x, z) => waterDepthAt(x, z) > 2)
    if (!deep) return null
    // walk back toward the player until dry ground: the shore
    let { x, z } = deep
    const dx = avatarRT().pos.x - x
    const dz = avatarRT().pos.z - z
    const d = Math.hypot(dx, dz) || 1
    for (let i = 0; i < 400 && waterDepthAt(x, z) > 0; i++) {
      x += (dx / d) * 0.5
      z += (dz / d) * 0.5
    }
    const at = teleport(x + (dx / d) * 1.5, z + (dz / d) * 1.5)
    // face the water
    cameraRT.yaw = cameraRT.targetYaw = Math.atan2(dx, dz)
    return { shore: at, deep }
  },
  boulder: () => {
    let best: { x: number; z: number; r: number; top: number } | null = null
    let bestD = Infinity
    for (const list of chunkColliders.values()) {
      for (const c of list) {
        if (!c.standable || (c.height ?? 0) > 1.0 || (c.height ?? 0) < 0.6) continue
        const d = Math.hypot(c.x - avatarRT().pos.x, c.z - avatarRT().pos.z)
        if (d < bestD) {
          bestD = d
          best = { x: c.x, z: c.z, r: c.r, top: colliderTop(c) }
        }
      }
    }
    if (!best) return null
    teleport(best.x, best.z + best.r + 1.6)
    cameraRT.yaw = cameraRT.targetYaw = 0
    return best
  },
  biome: (id: BiomeId) => {
    if (!BIOMES.includes(id)) return `unknown biome; one of ${BIOMES.join(", ")}`
    const at = spiral((x, z) => dominantBiome(x, z) === id && waterDepthAt(x, z) === 0, 6000, 48)
    return at ? teleport(at.x, at.z) : null
  },
  far: (km = 1) => {
    const x = avatarRT().pos.x + Math.sin(avatarRT().facing) * km * 1000
    const z = avatarRT().pos.z + Math.cos(avatarRT().facing) * km * 1000
    return teleport(x, z)
  },
  /** dawn(0.8): a morning at that time (sun on the rising side, dawn colours); dawn(null) follows the clock */
  dawn: (t: number | null = 0.8) => {
    worldRT.morningOverride = t === null ? null : 1
    worldRT.timeOverride = t
    if (t !== null) worldRT.timeOfDay = t
    // switch now, even mid-twilight: QA wants to compare frames directly
    celestialRT.morning = t === null ? worldRT.morningTarget : 1
    return t
  },
  dusk: (t: number | null = 0.8) => {
    worldRT.morningOverride = t === null ? null : 0
    worldRT.timeOverride = t
    if (t !== null) worldRT.timeOfDay = t
    celestialRT.morning = 0
    return t
  },
  camera: (pitch = 0.45, distance = 8, yaw?: number) => {
    cameraRT.targetPitch = cameraRT.pitch = pitch
    cameraRT.targetDistance = cameraRT.distance = distance
    if (yaw !== undefined) cameraRT.targetYaw = cameraRT.yaw = yaw
    return { pitch, distance, yaw: cameraRT.yaw }
  },
}

/** Systems add their own QA helpers here (e.g. aquatic test populations). */
export const registerDevTool = (name: string, fn: (...args: never[]) => unknown): void => {
  const w = window as DevWindow
  if (!w.__worldDev) return
  w.__worldDev[name] = fn
}

export const installDevTools = (): void => {
  if (typeof window === "undefined" || !debugEnabled()) return
  const w = window as DevWindow
  w.__worldDev = Object.assign(w.__worldDev ?? {}, tools)
}
