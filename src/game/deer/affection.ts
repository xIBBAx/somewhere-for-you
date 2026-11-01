import * as THREE from "three"
import { originRT } from "../../world/origin"
import { playerRT, companionRT, type CharacterId } from "../runtime"
import type { ArmGoal, HumanPoseInput } from "../characters/human/HumanAnimator"
import { SPECIES } from "./species"
import type { DeerState } from "./state"
import { affectionDrift } from "../vfx/signatures"

const sessions: Record<CharacterId, { animal: DeerState | null; t: number; hand: ArmGoal }> = {
  explorer: {
    animal: null,
    t: 0,
    hand: { target: new THREE.Vector3(), fingers: new THREE.Vector3(), palm: new THREE.Vector3(), weight: 0, grip: 0 },
  },
  companion: {
    animal: null,
    t: 0,
    hand: { target: new THREE.Vector3(), fingers: new THREE.Vector3(), palm: new THREE.Vector3(), weight: 0, grip: 0 },
  },
}
export const beginDeerAffection = (id: CharacterId, animal: DeerState): void => {
  sessions[id].animal = animal
  sessions[id].t = 0
  // a stroke of the neck: thistledown light lifting off the coat
  const H = SPECIES[animal.ident.species].height * animal.ident.scale
  affectionDrift(_at.set(animal.x, animal.y + H * 0.85, animal.z), "#e6f5c2")
}
const _at = new THREE.Vector3()
const inverse = new THREE.Matrix4()
/** The same anatomical hand IK used for the cat and riding, on both human rigs. */
export const applyDeerAffection = (id: CharacterId, root: THREE.Object3D, pose: HumanPoseInput, dt: number): void => {
  const s = sessions[id],
    d = s.animal,
    body = id === "explorer" ? playerRT : companionRT
  if (!d) return
  s.t += dt
  const dx = body.pos.x - d.x,
    dz = body.pos.z - d.z,
    dist = Math.hypot(dx, dz)
  if (s.t > 3.2 || body.speed > 0.7 || dist > 1.8 || d.alarm > 0.4 || d.rider) {
    s.animal = null
    return
  }
  const H = SPECIES[d.ident.species].height * d.ident.scale,
    radius = H * 0.2
  const weight = Math.min(1, s.t / 0.4, (3.2 - s.t) / 0.45)
  root.updateWorldMatrix(true, false)
  inverse.copy(root.matrixWorld).invert()
  s.hand.target
    .set(
      d.x + (dx / Math.max(0.01, dist)) * radius - originRT.x,
      d.y + Math.min(1.45, H * 0.92) + Math.sin(s.t * 5) * 0.025,
      d.z + (dz / Math.max(0.01, dist)) * radius - originRT.z,
    )
    .applyMatrix4(inverse)
  s.hand.fingers.set(0, 0, 1)
  s.hand.palm.set(0, -1, 0)
  s.hand.weight = weight
  s.hand.grip = 0.08
  pose.reachR = s.hand
  pose.bow = Math.max(pose.bow ?? 0, Math.max(0, 0.9 - H) * weight * 0.5)
  pose.lookPitch = 0.2
  pose.smile = weight
  pose.wish = 0
}
