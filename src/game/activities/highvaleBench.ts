import { worldHeight } from "../../world/terrain"
import { BENCH_VIEW, BENCH_WORLD } from "../../world/highvale/highvaleStructures"
import { cameraRT, characterRT, companionRT, input, playerRT, worldRT, type AvatarBody } from "../runtime"
import { togetherRT } from "../together/togetherState"
import { useActivityUI } from "./activityState"
import type { ActivityContext } from "./context"

/**
 * The bench on Highvale's meadow (world/highvale/highvaleStructures.ts): E sits
 * down there looking up the river to the snow, the other one comes to sit
 * alongside (together/Together.tsx, sitTogether), the camera settles behind
 * them, and after a quiet moment the place's card (ui/HighvaleMoment.tsx)
 * comes up. Moving, or closing the card with "stand up", ends it.
 */
const REACH = 2.4
/** Hips on the seat: the sit pose lowers the body this far above the ground. */
const SEAT = 0.3
/** The sit pose draws the hips this far ahead of the body's origin: set it back so they land on the seat. */
const SEAT_BACK = 0.8

/** World facing (characters face (sin f, cos f) in x, z) of the bench's view. */
const VIEW_FACING = Math.atan2(Math.cos(BENCH_VIEW), -Math.sin(BENCH_VIEW))

export const highvaleRT = { t: -1, mateSeated: false }

const nearBench = (ctx: ActivityContext): boolean =>
  Math.hypot(ctx.body.pos.x - BENCH_WORLD.x, ctx.body.pos.z - BENCH_WORLD.z) < REACH

export const benchPrompt = (ctx: ActivityContext): string | null =>
  ctx.water === "land" && nearBench(ctx) ? "E — sit here a while" : null

export const startBench = (ctx: ActivityContext): void => {
  const b = ctx.body
  // settle on the seat, looking up the valley
  b.pos.x = BENCH_WORLD.x - Math.sin(VIEW_FACING) * SEAT_BACK
  b.pos.z = BENCH_WORLD.z - Math.cos(VIEW_FACING) * SEAT_BACK
  b.pos.y = worldHeight(b.pos.x, b.pos.z)
  b.rideY = b.pos.y + SEAT
  b.facing = VIEW_FACING
  b.vel.set(0, 0, 0)
  b.paused = true
  b.gesture = "sit"
  b.gestureTime = 0
  // the camera behind and a little above the two of them, the valley beyond
  const f = worldRT.focus
  f.active = true
  f.x = b.pos.x + Math.sin(VIEW_FACING) * 4
  f.z = b.pos.z + Math.cos(VIEW_FACING) * 4
  // (FollowCamera: the eye sits at yaw, pitch from the look point; pitch > 0 is above)
  f.yaw = VIEW_FACING + Math.PI - 0.38
  f.pitch = 0.2
  f.distance = 8.5
  highvaleRT.t = 0
  useActivityUI.getState().setMode("highvale")
}

export const endBench = (): void => {
  if (highvaleRT.t < 0) return
  highvaleRT.t = -1
  const f = worldRT.focus
  f.active = false
  f.yaw = f.pitch = f.distance = null
  cameraRT.targetYaw = cameraRT.yaw
  useActivityUI.getState().setMode("none")
}

const partnerOf = (b: AvatarBody): AvatarBody => (b === playerRT ? companionRT : playerRT)

/** Per frame (Activities.tsx): the moment's clock; any step away stands up. */
export const updateBench = (ctx: ActivityContext): void => {
  if (highvaleRT.t < 0) return
  highvaleRT.t += ctx.dt
  const b = ctx.body
  // whoever comes to sit alongside (Together.tsx) sits on the seat too
  const mate = partnerOf(b)
  if (characterRT.companionPresent && togetherRT.action === "sitTogether" && mate.gesture === "sit") {
    mate.rideY = worldHeight(mate.pos.x, mate.pos.z) + SEAT
    highvaleRT.mateSeated = true
  } else if (highvaleRT.mateSeated) {
    // they got up: give them their own feet back
    mate.rideY = null
    highvaleRT.mateSeated = false
  }
  const moving = Math.hypot(input.move.x, input.move.y) > 0.3
  // taken somewhere else (travel, recovery): the moment is over too
  const away = Math.hypot(b.pos.x - BENCH_WORLD.x, b.pos.z - BENCH_WORLD.z) > REACH + 1
  if ((moving && highvaleRT.t > 1.2) || away || useActivityUI.getState().mode !== "highvale") {
    b.paused = false
    b.rideY = null
    if (b.gesture === "sit") b.gesture = "none"
    // only the seat we gave them: rideY is also the saddle's (horses/riding.ts)
    if (highvaleRT.mateSeated) mate.rideY = null
    highvaleRT.mateSeated = false
    endBench()
  }
}
