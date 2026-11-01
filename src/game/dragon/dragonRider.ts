import * as THREE from "three"
import { originRT } from "../../world/origin"
import type { CharacterId } from "../runtime"
import type { ArmGoal, HumanPoseInput } from "../characters/human/HumanAnimator"

/**
 * Sitting astride the dragon's neck: the dragon (Dragon.tsx) writes where the
 * seat is and how the neck is turned each frame; the characters' animators
 * read it here, after the horse riding pose, as the same seat, feet, hips
 * and hands a saddle would give. Her legs hang either side of the neck and
 * her hands hold the mane just behind the horns.
 */
export type DragonSeat = {
  /** 0..1 how much she is seated (blends in while she is lifted aboard) */
  w: number
  /** pelvis, logical world space */
  pelvis: THREE.Vector3
  /** the neck's forward, up and her left (unit, world) */
  forward: THREE.Vector3
  up: THREE.Vector3
  left: THREE.Vector3
  /** half the neck's width under her thighs (m) */
  girth: number
  lean: number
  bank: number
  /** the rush and the breath: a grin into the wind */
  thrill: number
  grip: number
}

const seat = (): DragonSeat => ({
  w: 0, pelvis: new THREE.Vector3(), forward: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0), left: new THREE.Vector3(1, 0, 0),
  girth: 0.45, lean: 0, bank: 0, thrill: 0, grip: 0.4,
})

export const dragonSeatRT: Record<CharacterId, DragonSeat> = { explorer: seat(), companion: seat() }

export const onDragon = (id: CharacterId): boolean => dragonSeatRT[id].w > 0.001

type SeatCache = { L: ArmGoal; R: ArmGoal; footL: THREE.Vector3; footR: THREE.Vector3; hips: THREE.Vector3 }
const goal = (): ArmGoal => ({ target: new THREE.Vector3(), fingers: new THREE.Vector3(), palm: new THREE.Vector3(), weight: 0, grip: 0 })
const caches: Record<CharacterId, SeatCache> = {
  explorer: { L: goal(), R: goal(), footL: new THREE.Vector3(), footR: new THREE.Vector3(), hips: new THREE.Vector3() },
  companion: { L: goal(), R: goal(), footL: new THREE.Vector3(), footR: new THREE.Vector3(), hips: new THREE.Vector3() },
}

const inv = new THREE.Matrix4()
const _w = new THREE.Vector3()
const _d = new THREE.Vector3()
const toModel = (w: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 => out.set(w.x - originRT.x, w.y, w.z - originRT.z).applyMatrix4(inv)

/** Pose a rider on the dragon (after applyRiderPose); true while seated. */
export const applyDragonRiderPose = (id: CharacterId, root: THREE.Object3D, pose: HumanPoseInput): boolean => {
  const s = dragonSeatRT[id]
  if (s.w <= 0.001) return false
  // never hand the animator a broken seat (it would spread NaN through the skeleton)
  if (!Number.isFinite(s.pelvis.x + s.pelvis.y + s.pelvis.z + s.forward.x + s.up.y + s.left.x)) return false
  const c = caches[id]
  root.updateWorldMatrix(true, false)
  inv.copy(root.matrixWorld).invert()
  const f = s.forward, u = s.up, l = s.left
  pose.ride = s.w
  // legs either side of the neck, knees a little forward, heels hanging low
  for (const [side, out] of [[1, c.footL], [-1, c.footR]] as const) {
    _w.copy(s.pelvis).addScaledVector(l, side * (s.girth + 0.1)).addScaledVector(u, -0.72).addScaledVector(f, 0.16)
    toModel(_w, out)
  }
  pose.rideFootL = c.footL
  pose.rideFootR = c.footR
  pose.rideHips = c.hips.set(0, 0, 0)
  pose.rideLean = s.lean
  pose.rideBank = s.bank
  pose.rideTumble = 0
  pose.rideThrill = s.thrill
  pose.rideWonder = 0
  pose.rideGrip = s.grip
  pose.rideBrace = s.grip * 0.4
  pose.speed = 0
  pose.turnRate = 0
  pose.forwardAccel = 0
  pose.groundLeft = pose.groundRight = 0
  pose.slope = 0
  pose.airborne = false
  pose.jumpPhase = "grounded"
  pose.swim = 0
  pose.wade = 0
  pose.swimSpeed = 0
  pose.lookPitch = 0.05
  // both hands in the mane just ahead of her, fingers forward and down
  for (const [side, hand] of [[1, c.L], [-1, c.R]] as const) {
    _w.copy(s.pelvis).addScaledVector(f, 0.46).addScaledVector(l, side * 0.17).addScaledVector(u, 0.16)
    toModel(_w, hand.target)
    hand.fingers.copy(_d.copy(f).multiplyScalar(0.6).addScaledVector(u, -0.8)).transformDirection(inv)
    hand.palm.copy(_d.copy(u).multiplyScalar(-1)).transformDirection(inv)
    hand.weight = s.w
    hand.grip = s.grip
  }
  pose.reachL = c.L
  pose.reachR = c.R
  return true
}
