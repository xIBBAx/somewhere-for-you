import { gift } from "../../personalization"
import * as THREE from "three"
import type { ArmGoal, HumanPoseInput } from "../characters/human/HumanAnimator"
import { originRT } from "../../world/origin"
import type { CharacterId } from "../runtime"

/**
 * Shared state for everything the explorer and the companion do together after the
 * finale: the partner following you, holding hands, hugs, high fives,
 * slow dances and sitting side by side. Plain mutable data read per frame by
 * the characters (never React state).
 */
export type CoupleAction = "none" | "holdHands" | "hug" | "highFive" | "dance" | "sitTogether"

/** A hand goal in logical world space (converted to model space per body). */
export type WorldArmGoal = { target: THREE.Vector3; fingers: THREE.Vector3; palm: THREE.Vector3; weight: number; grip: number }

export type BodyPoseRequest = {
  reachL: WorldArmGoal
  reachR: WorldArmGoal
  bow: number
  kneel?: number
  dance: number
  love: number
  celebrate: number
  /** logical world point to look at (head yaw/pitch), or null */
  lookAt: THREE.Vector3 | null
}

const goal = (): WorldArmGoal => ({ target: new THREE.Vector3(), fingers: new THREE.Vector3(0, -1, 0), palm: new THREE.Vector3(1, 0, 0), weight: 0, grip: 0 })
const request = (): BodyPoseRequest => ({ reachL: goal(), reachR: goal(), bow: 0, dance: 0, love: 0, celebrate: 0, lookAt: null })

export const togetherRT = {
  action: "none" as CoupleAction,
  actionTime: 0,
  /** the partner follows the played character (T toggles "wait here") */
  // the companion walks along unless the gift says otherwise (`characters.companion.follows`)
  follow: gift().characters.companion.follows,
  /** both bodies are present, close and free to act together */
  partnerNear: false,
  /** distance between the two bodies (m) */
  distance: Infinity,
  /** discrete counter so the HUD can refresh its prompts cheaply */
  version: 0,
  /** short speech line shown over a body */
  speech: { who: "companion" as CharacterId, text: "", time: 0, screenX: 0, screenY: 0, onScreen: false },
  pose: { explorer: request(), companion: request() } as Record<CharacterId, BodyPoseRequest>,
  /** QA counters */
  stats: { hugs: 0, highFives: 0, dances: 0, handHolds: 0, teleports: 0 },
}

export const clearPoseRequest = (r: BodyPoseRequest): void => {
  r.reachL.weight = r.reachR.weight = 0
  r.bow = r.dance = r.love = r.celebrate = 0
  r.kneel = 0
  r.lookAt = null
}

const _inv = new THREE.Matrix4()

const toModel = (world: WorldArmGoal, out: ArmGoal | null): ArmGoal => {
  const result = out ?? { target: new THREE.Vector3(), fingers: new THREE.Vector3(), palm: new THREE.Vector3(), weight: 0, grip: 0 }
  // logical → rendered world (floating origin) → the rig's model space
  result.target.set(world.target.x - originRT.x, world.target.y, world.target.z - originRT.z).applyMatrix4(_inv)
  result.fingers.copy(world.fingers).transformDirection(_inv)
  result.palm.copy(world.palm).transformDirection(_inv)
  result.weight = world.weight
  result.grip = world.grip
  return result
}

/**
 * Fill a character's animator input from its pose request; `root` is the rig root (asset.root).
 * `pose.kneel` is combined with max(), so the caller must write its own kneel
 * (0 when it has none) every frame first, or a past request is held forever.
 */
export const applyPoseRequest = (id: CharacterId, root: THREE.Object3D, pose: HumanPoseInput, cache: { L: ArmGoal | null; R: ArmGoal | null }): void => {
  const r = togetherRT.pose[id]
  root.updateWorldMatrix(true, false)
  _inv.copy(root.matrixWorld).invert()
  pose.reachL = r.reachL.weight > 0.001 ? (cache.L = toModel(r.reachL, cache.L)) : null
  pose.reachR = r.reachR.weight > 0.001 ? (cache.R = toModel(r.reachR, cache.R)) : null
  pose.bow = r.bow
  pose.kneel = Math.max(pose.kneel ?? 0, r.kneel ?? 0)
  pose.dance = r.dance
  pose.love = r.love
}
