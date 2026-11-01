import * as THREE from "three"
import { useGame } from "../../../state/gameStore"
import { useExplorationUI } from "../../../state/explorationUIStore"
import { cameraRelativeMove, supportTop } from "../../movement"
import { cameraRT, characterRT, input, worldRT, type AvatarBody, type CharacterId } from "../../runtime"
import { buildColliders, groundHeight, type CircleCollider } from "../../world-layout"
import { nearbyWorldColliders } from "../../../world/colliders"
import { createLocomotion, resetLocomotion, stepLocomotion, type LocomotionIntent, type LocomotionTuning } from "./locomotion"

const colliders = buildColliders()

/**
 * World-space intent for a body that is not being played: the companion
 * director (game/together) writes it so the partner walks, runs and jumps
 * with the same locomotion as the player. Null means stand still.
 */
export const aiIntents: Record<CharacterId, LocomotionIntent | null> = { explorer: null, companion: null }

export const createAvatarController = (body: AvatarBody) => ({
  loco: createLocomotion(),
  revision: -1,
  intent: { move: { x: 0, y: 0 }, sprint: false, jump: false } as LocomotionIntent,
  turnRate: 0,
  forwardAccel: 0,
  previousFacing: body.facing,
  previousForwardSpeed: 0,
  targetSpeed: 0,
  streamed: [] as CircleCollider[],
})

export type AvatarController = ReturnType<typeof createAvatarController>

/** Feet use the same support surfaces as the physical root, including rocks. */
export const avatarFootGround = (body: AvatarBody, state: AvatarController, x: number, z: number): number =>
  Math.max(groundHeight(x, z), supportTop(x, z, 0.06, body.pos.y, colliders.circles, state.streamed)) - state.loco.support

/** Both bodies use this controller; only the selected one ever consumes input. */
export const stepAvatarController = (
  body: AvatarBody,
  id: CharacterId,
  state: AvatarController,
  tuning: LocomotionTuning,
  dt: number,
  scripted = false,
): boolean => {
  if (worldRT.relocating || useExplorationUI.getState().panel === "controls") return false
  const selected = characterRT.active === id
  const controlled = selected && useGame.getState().started && !body.paused && !worldRT.introActive && !worldRT.finaleActive && !characterRT.switching
  // A bounded snapshot keeps an inactive body on its rock even after that
  // chunk leaves the active character's streaming bubble. Retain references
  // to colliders, never meshes or chunks.
  const revised = state.revision !== body.revision
  const hasLocal = (selected || aiIntents[id] !== null) && nearbyWorldColliders.some(obstacle => Math.abs(obstacle.x - body.pos.x) < 28 && Math.abs(obstacle.z - body.pos.z) < 28)
  if (hasLocal || revised) {
    state.streamed.length = 0
    for (const obstacle of nearbyWorldColliders) {
      if (Math.abs(obstacle.x - body.pos.x) < 28 && Math.abs(obstacle.z - body.pos.z) < 28) state.streamed.push(obstacle)
    }
  }
  if (revised) {
    resetLocomotion(state.loco, body, tuning, colliders.circles, state.streamed)
    state.revision = body.revision
    state.previousFacing = body.facing
    state.previousForwardSpeed = 0
    state.forwardAccel = state.turnRate = 0
  }
  const intent = state.intent
  if (controlled) {
    cameraRelativeMove(input.move, cameraRT.viewYaw, intent.move)
    intent.sprint = input.sprint
    intent.jump = input.jump
    intent.jumpHeld = input.ascend
    input.jump = false
    state.targetSpeed = Math.min(1, Math.hypot(intent.move.x, intent.move.y)) * (intent.sprint ? tuning.runSpeed : tuning.walkSpeed)
  } else {
    state.targetSpeed = 0
  }
  const ai = !controlled && !selected && !body.paused && !worldRT.introActive && !worldRT.finaleActive ? aiIntents[id] : null
  if (ai) state.targetSpeed = Math.min(1, Math.hypot(ai.move.x, ai.move.y)) * (ai.sprint ? tuning.runSpeed : tuning.walkSpeed)
  if (!scripted) {
    stepLocomotion(body, state.loco, tuning, controlled ? intent : ai, colliders.circles, colliders.rects, dt, state.streamed)
  } else {
    // The finale director, memory choreography or balloon owns placement.
    // Sync physics only when that placement changes; ordinary switches never reset it.
    resetLocomotion(state.loco, body, tuning, colliders.circles, state.streamed)
    body.speed = Math.hypot(body.vel.x, body.vel.z)
    body.moving = body.speed > 0.08
  }
  body.jumpPhase = state.loco.motion.phase
  body.jumpHeight = state.loco.motion.lift
  const delta = Math.atan2(Math.sin(body.facing - state.previousFacing), Math.cos(body.facing - state.previousFacing))
  state.previousFacing = body.facing
  state.turnRate = THREE.MathUtils.damp(state.turnRate, delta / Math.max(dt, 1e-4), 10, dt)
  const speed = body.vel.x * Math.sin(body.facing) + body.vel.z * Math.cos(body.facing)
  state.forwardAccel = THREE.MathUtils.damp(state.forwardAccel, (speed - state.previousForwardSpeed) / Math.max(dt, 1e-4), 8, dt)
  state.previousForwardSpeed = speed
  return controlled
}
