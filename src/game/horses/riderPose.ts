import { travelling, travelRT } from "../celestial/cosmicTravel"
import { groundDashRT } from "./groundDash"
import * as THREE from "three"
import { originRT } from "../../world/origin"
import type { CharacterId } from "../runtime"
import type { ArmGoal, HumanPoseInput } from "../characters/human/HumanAnimator"
import type { HorseState } from "./horseState"
import { riderRT } from "./riding"

/**
 * Feed a character's animator from the riding system: the seat, stirrups,
 * reins and the neck pat are logical world points, converted here to the
 * rig's model space (the same route as shared together-actions use).
 */
export type RiderPoseCache = {
  grip: number
  brace: number
  footL: THREE.Vector3
  footR: THREE.Vector3
  hips: THREE.Vector3
  L: ArmGoal
  R: ArmGoal
}

const goal = (): ArmGoal => ({ target: new THREE.Vector3(), fingers: new THREE.Vector3(), palm: new THREE.Vector3(), weight: 0, grip: 0 })
export const makeRiderPoseCache = (): RiderPoseCache => ({ grip: 0, brace: 0, footL: new THREE.Vector3(), footR: new THREE.Vector3(), hips: new THREE.Vector3(), L: goal(), R: goal() })

const inv = new THREE.Matrix4()
const _d = new THREE.Vector3()

const toModel = (w: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 => out.set(w.x - originRT.x, w.y, w.z - originRT.z).applyMatrix4(inv)

/** Returns true while the character is on (or getting on or off) a horse. */
export const applyRiderPose = (id: CharacterId, root: THREE.Object3D, pose: HumanPoseInput, cache: RiderPoseCache, time: number): boolean => {
  const r = riderRT[id]
  if (r.phase === "none" || !r.horse) {
    pose.ride = 0
    pose.rideFootL = pose.rideFootR = null
    pose.rideHips = null
    pose.rideLean = 0
    pose.rideBank = 0
    pose.rideTumble = 0
    pose.rideThrill = pose.rideWonder = 0
    cache.grip = cache.brace = 0
    pose.rideBrace = 0
    pose.rideGrip = 0
    return false
  }
  root.updateWorldMatrix(true, false)
  inv.copy(root.matrixWorld).invert()
  const h = r.horse
  pose.ride = r.ride
  pose.rideFootL = toModel(r.footL, cache.footL)
  pose.rideFootR = toModel(r.footR, cache.footR)
  pose.rideHips = cache.hips.copy(r.hips)
  pose.rideLean = r.lean
  pose.rideBank = r.bank
  pose.rideTumble = r.tumble
  // holding on: the pull of a re-entry, the rush of a star corridor, a held dash, a launch (low over the neck, braced)
  const f = h.kind === "horse" ? (h as HorseState).flight : null
  const tr = f?.mode === "air" && f.trick.kind ? f.trick : null
  // a ground surge (groundDash.ts): she tucks low over the neck and holds the mane
  const surge = groundDashRT.id === h.ident.id ? groundDashRT.amount * 0.55 : 0
  const external = travelling() ? Math.max(travelRT.pull, travelRT.intensity * 0.6) : Math.max(surge, f ? Math.max(f.boostT > 0 ? Math.min(0.5, f.boostT * 0.8) : 0, f.launch * 0.95, f.landing.brake * 0.45, f.landing.contact * 0.8) : 0)
  const dt = Math.max(0, Math.min(0.1, pose.dt))
  // Each rider reacts to their own mount, including a tandem passenger. The
  // nearby companion must not brace just because the player is doing a loop.
  cache.grip += (Math.max(external, tr?.grip ?? 0) - cache.grip) * (1 - Math.exp(-3 * dt))
  cache.brace += (Math.min(1, Math.max(0, ((tr?.g ?? 1) - 2) / 2, (f?.landing.brake ?? 0) * 0.3, f?.landing.contact ?? 0, (f?.launch ?? 0) * 0.55)) - cache.brace) * (1 - Math.exp(-8 * dt))
  pose.rideGrip = cache.grip
  pose.rideBrace = cache.brace
  // what her face does with it: the joy of a dash, a grin into the overdrive's
  // wind, and a breath of wide-eyed wonder as a launch throws them at the sky
  const air = f && f.mode !== "ground" && f.mode !== "landing"
  pose.rideThrill = travelling() ? travelRT.intensity * 0.6 : air ? Math.max(Math.min(0.5, f.boostT * 0.9), f.overdrive, f.launch * 0.8) : surge
  pose.rideWonder = air ? f.launch * Math.exp(-f.launchT * 1.3) : 0
  // the legs belong to the horse now: no gait of her own except the walk to the stirrup
  pose.speed = r.walk
  pose.turnRate = 0
  pose.forwardAccel = 0
  pose.groundLeft = pose.groundRight = 0
  pose.slope = 0
  pose.airborne = false
  pose.jumpPhase = "grounded"
  pose.swim = 0
  pose.wade = 0
  pose.swimSpeed = 0
  pose.lookYaw = r.lookYaw
  pose.lookPitch = 0.08
  if (r.handW > 0.01) {
    const fx = Math.sin(h.heading)
    const fz = Math.cos(h.heading)
    // left = (cos, -sin); fingers point forward and down round the reins
    for (const [hand, world, palmSign] of [[cache.L, r.handL, -1], [cache.R, r.handR, 1]] as const) {
      toModel(world, hand.target)
      hand.fingers.copy(_d.set(fx * 0.55, -0.83, fz * 0.55)).transformDirection(inv)
      hand.palm.copy(_d.set(Math.cos(h.heading) * palmSign, -0.2, -Math.sin(h.heading) * palmSign)).transformDirection(inv)
      hand.weight = r.handW
      hand.grip = r.phase === "rejecting" ? 0.08 : Math.max(h.kind === "deer" ? 0.18 : 0.85, cache.grip)
      if (h.kind === "deer") hand.palm.copy(_d.set(0, -1, 0)).transformDirection(inv)
    }
    pose.reachL = cache.L
    pose.reachR = cache.R
    // patting the neck: the right hand leaves the reins for a few pats
    if (r.pat > 0 && r.phase === "riding") {
      const p = Math.min(1, r.pat / 0.3) * Math.min(1, (1.8 - r.pat) / 0.3 + 0.01)
      toModel(r.patTarget, _d)
      _d.y += Math.max(0, Math.sin(time * 9)) * 0.05
      cache.R.target.lerp(_d, Math.max(0, Math.min(1, p)))
      cache.R.fingers.set(0, -1, 0.3).normalize()
      cache.R.palm.set(0, -1, 0)
      cache.R.grip = 0.1
    }
  }
  return true
}
