import { avatarRT, cameraRT, characterRT, companionRT, playerRT, resetRuntime, selectAvatar, worldRT, type CharacterId } from "../runtime"
import { riderRT } from "../horses/riding"
import type { HorseState } from "../horses/horseState"
import { groundHeight } from "../world-layout"
import { standable } from "../horses/horseMotion"
import { waterDepthAt } from "../../world/waterSurface"
import { spaceRT } from "../celestial/spaceState"
import { useGame } from "../../state/gameStore"
import { companionUnlocked } from "../../state/storyProgress"
import { isFinitePos } from "./safety"

/** Resume at the last safe Earth stop, never in a half-finished flight or film. */
export const LOCATION_KEY = "gift-world/location"
export type LocationCheckpoint = { v: 1; x: number; z: number; facing: number; active: CharacterId }
export const locationRT = { restored: false, saved: false }

export const readLocationCheckpoint = (raw: string | null): LocationCheckpoint | null => {
  if (!raw || raw.length > 1000) return null
  try {
    const s: unknown = JSON.parse(raw)
    if (!s || typeof s !== "object" || Array.isArray(s)) return null
    const r = s as Record<string, unknown>
    if (r.v !== 1 || typeof r.x !== "number" || typeof r.z !== "number" || typeof r.facing !== "number") return null
    if (!isFinitePos(r.x, r.facing, r.z) || Math.hypot(r.x, r.z) > 100_000) return null
    if (r.active !== "explorer" && r.active !== "companion") return null
    return { v: 1, x: r.x, z: r.z, facing: r.facing, active: r.active }
  } catch { return null }
}

const safeGround = (x: number, z: number): boolean =>
  standable(x, z, 1.2) && waterDepthAt(x, z) <= 0.25 && Number.isFinite(groundHeight(x, z))

export const saveLocationCheckpoint = (): boolean => {
  const game = useGame.getState(), body = avatarRT(), r = riderRT[characterRT.active]
  if (!locationRT.restored || !game.started || body.paused || worldRT.relocating || worldRT.introActive || worldRT.finaleActive || characterRT.switching) return false
  if (spaceRT.realm !== "earth" || spaceRT.mode !== "local" || r.phase !== "none" && r.phase !== "riding") return false
  const h = r.phase === "riding" ? r.horse as HorseState | null : null
  if (h && (h.kind !== "horse" || h.flight && h.flight.mode !== "ground")) return false
  const x = h ? h.x : body.pos.x, z = h ? h.z : body.pos.z
  if (!isFinitePos(x, body.pos.y, z) || Math.hypot(x, z) > 100_000 || Math.abs(body.pos.y - groundHeight(x, z)) > 5 || !safeGround(x, z)) return false
  const checkpoint: LocationCheckpoint = { v: 1, x: +x.toFixed(2), z: +z.toFixed(2), facing: body.facing, active: characterRT.active }
  try {
    localStorage.setItem(LOCATION_KEY, JSON.stringify(checkpoint))
    locationRT.saved = true
    return true
  } catch { return false }
}

/** Restoring on foot avoids reviving stale saddle references or unsafe momentum. */
export const restoreLocationCheckpoint = (): boolean => {
  if (locationRT.restored) return false
  locationRT.restored = true
  let saved: LocationCheckpoint | null = null
  try { saved = readLocationCheckpoint(localStorage.getItem(LOCATION_KEY)) } catch { /* private storage */ }
  if (!saved || !safeGround(saved.x, saved.z)) return false
  const active = saved.active === "companion" && companionUnlocked(useGame.getState()) ? "companion" : "explorer"
  if (active === "companion") characterRT.companionPresent = true
  selectAvatar(active)
  resetRuntime(saved)
  for (const body of [playerRT, companionRT]) body.pos.y = groundHeight(body.pos.x, body.pos.z)
  avatarRT().facing = saved.facing
  cameraRT.yaw = cameraRT.targetYaw = saved.facing + Math.PI
  locationRT.saved = true
  return true
}
