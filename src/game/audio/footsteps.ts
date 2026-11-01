import { siteWeight } from "../../world/sites/siteLayout"
import { BRIDGE_HALF_WIDTH, RIVER_Z } from "../../world/hubLayout"
import type { AvatarBody } from "../runtime"
import { playSprite } from "./soundscape"
import { sfx } from "./audio"
import { inRealm } from "../../world/realmHook"

/**
 * Footsteps from real recordings, chosen by what is underfoot: grass and
 * earth paths, authored sites and their roads (concrete), the home bridge (wood) and
 * shallow water. Running steps are a little louder and brighter.
 */
export type Surface = "grass" | "concrete" | "wood" | "wet"

export const surfaceAt = (x: number, z: number, wading: boolean): Surface => {
  if (wading) return "wet"
  if (Math.abs(x) <= BRIDGE_HALF_WIDTH && Math.abs(z - RIVER_Z) < 2.4) return "wood"
  if (siteWeight(x, z, -20).w > 0.5) return "concrete"
  return "grass"
}

let side = 1
export const footstep = (body: AvatarBody, wading: boolean): void => {
  // on the Moon no air carries the crunch of a step: what is heard is the
  // thud that travels up through the boot and the body into the veil, low
  // and soft, with the grit of the regolith dulled almost away
  if (inRealm(body.pos.x, body.pos.z)) {
    side = -side
    if (!playSprite("step_concrete", 0.2, { pitch: 0.55, pan: side * 0.03, jitter: 0.04 })) sfx.step()
    return
  }
  const surface = surfaceAt(body.pos.x, body.pos.z, wading)
  const run = Math.min(1, Math.max(0, (body.speed - 3) / 3.5))
  side = -side
  const played = playSprite(`step_${surface}`, 0.42 + run * 0.28, { pitch: 1 + run * 0.06, pan: side * 0.06, jitter: 0.05 })
  if (!played) sfx.step()
}
