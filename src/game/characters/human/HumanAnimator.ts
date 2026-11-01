import { JUMP_LAND_TIME, PLAYER_GRAVITY, PLAYER_JUMP_SPEED, type PlayerMotion } from "../playerMotion"
import * as THREE from "three"
import type { HumanAsset } from "./humanAsset"
import { advanceGait, footAt, gaitFor, MotionSpring, pelvisBob, stepDrapeSpring, type FootSample, type GaitParams } from "./humanLocomotion"

/**
 * Procedural animation for the explorer's skeleton.
 *
 * Every pose is a set of *model-space* rotation deltas applied on top of the
 * rest pose (model axes: +X her left, +Y up, +Z forward). Deltas compose down
 * the hierarchy, so "bend the spine forward" carries the head and arms along
 * naturally. Legs are solved with analytic two-bone IK against the terrain,
 * so feet plant on slopes and the gait never slides.
 *
 * Layers (blended by weights, never snapped):
 *   base locomotion (idle ↔ walk ↔ jog ↔ run, distance-driven phase)
 *   airborne (jump rise / fall / land)
 *   gestures (petting the cat, celebrating, training jab/cross, fear)
 *   look-at, breathing, blinking and expressions
 *   secondary motion (headscarf drape spring)
 */

export type HumanPoseInput = {
  dt: number
  time: number
  speed: number
  /** signed angular velocity of facing (rad/s), for banking into turns */
  turnRate: number
  /** forward acceleration (m/s²), for leaning into starts/stops */
  forwardAccel: number
  /** ground height under each foot relative to the root (m), left/right */
  groundLeft: number
  groundRight: number
  /** ground slope along facing (rise per metre) */
  slope: number
  airborne: boolean
  jumpPhase: PlayerMotion["phase"]
  jumpTime: number
  idleTime: number
  petting: number
  petSide: number
  celebrate: number
  training: { stance: number; jab: number; cross: number }
  fear: number
  greeting: number
  /** desired head yaw relative to body (rad), e.g. to glance at the cat */
  lookYaw: number
  lookPitch: number
  wind: number
  /** 0..1 sitting on the ground/bench */
  sit: number
  /** 0..1 painting at an easel (right arm brushes) */
  paint: number
  /** 0..1 hands together making a wish */
  wish: number
  /**
   * 0..1 land/free-swim blend; omitted = 0. Internally spring-ramped even if
   * the controller changes it abruptly. The controller owns root height and
   * puts the posed chest at the water line. Additional hips offsets are
   * -0.055 m vertically while treading, -0.03 m vertically/+0.08 m forward
   * during breaststroke (on top of the normal -0.012 m standing settle).
   */
  swim?: number
  /** 0..1 wading depth: water surface height on her legs (0 dry, 1 waist-deep) */
  wade?: number
  /** Nonnegative horizontal swim speed (m/s); omitted = 0 (upright treading). */
  swimSpeed?: number
  /** 0..1 kneeling on one knee beside her cat to stroke her */
  kneel?: number
  /** model-space point the right palm should rest on (the cat's back) */
  handTarget?: THREE.Vector3 | null
  /** 0..1 how much the right hand follows `handTarget` */
  handReach?: number
  /** direction the stroke travels along (model space), for the hand's yaw */
  handStrokeDir?: THREE.Vector3 | null
  /** 0..1 calling the cat: crouched a little, beckoning, "pspsps" */
  call?: number
  /** 0..1 whistling for a Pegasus: two fingers to the lips, then the arm
   * raised high to the sky; `whistleT` is the seconds since it began */
  whistle?: number
  whistleT?: number
  /** 0..1 a fond smile at her cat (she meowed, she is rubbing her legs) */
  smile?: number
  /** Free hand goals for shared actions (holding hands, hugs, mini-games). */
  reachL?: ArmGoal | null
  reachR?: ArmGoal | null
  /** forward bend of the upper body, e.g. leaning into a hug (rad) */
  bow?: number
  /** 0..1 swaying to music */
  dance?: number
  /** 0..1 happy, affectionate expression (closed smiling eyes and blush) */
  love?: number
  /**
   * 0..1 seated on a horse. The caller places the root so the pelvis sits in
   * the saddle; the legs straddle the barrel to the stirrups (model space),
   * heels down, and the hands come from `reachL`/`reachR` (the reins).
   */
  ride?: number
  rideFootL?: THREE.Vector3 | null
  rideFootR?: THREE.Vector3 | null
  /** model-space pelvis offset from the horse's motion (posting, two-point) */
  rideHips?: THREE.Vector3 | null
  /** forward lean of the upper body over the withers (rad) */
  rideLean?: number
  /** sideways lean into a turn (rad, + leans to her left) */
  rideBank?: number
  /** 0..1 the exhilaration of a fast ride (a dash, the overdrive, a launch) and the wonder of a launch's first breath */
  rideThrill?: number
  rideWonder?: number
  /** Whole-body roll around the pelvis during a soft wildlife rejection. */
  rideTumble?: number
  /**
   * 0..1 hold on tightly, combined from this rider's own mount and journey.
   */
  rideGrip?: number
  /** 0..1 pressed into the saddle by this mount's pull. */
  rideBrace?: number
}

/**
 * A model-space goal for one hand. The wrist is placed so the palm centre
 * reaches `target`; the fingers point along `fingers` and the palm faces
 * `palm`. `grip` closes the hand around something (0 open … 1 fist).
 */
export type ArmGoal = { target: THREE.Vector3; fingers: THREE.Vector3; palm: THREE.Vector3; weight: number; grip: number }

/** Per-hand pose: curl of index/middle/ring/pinky, thumb curl and how far it
 * crosses the palm, and how far the fingers fan apart. */
type HandPose = { curl: [number, number, number, number]; thumb: number; thumbIn: number; spread: number }
const FINGER_NAMES = ["index", "middle", "ring", "pinky"] as const
/** maximum flexion of the MCP, PIP and DIP joints (rad) */
const JOINT_MAX = [1.35, 1.65, 1.05]
/** the authored rest pose is already gently curled (REST_CURL) */
const JOINT_REST = [0.1, 0.2, 0.16]
const SPREAD = [0.16, 0.03, -0.1, -0.22]

const lerpHand = (a: HandPose, b: HandPose, t: number): void => {
  if (t <= 0) return
  for (let i = 0; i < 4; i++) a.curl[i] += (b.curl[i] - a.curl[i]) * t
  a.thumb += (b.thumb - a.thumb) * t
  a.thumbIn += (b.thumbIn - a.thumbIn) * t
  a.spread += (b.spread - a.spread) * t
}
const hp = (c: number | [number, number, number, number], thumb: number, thumbIn: number, spread: number): HandPose => ({
  curl: typeof c === "number" ? [c, c, c, c] : c,
  thumb,
  thumbIn,
  spread,
})
/** two fingers straight to the lips, the others curled in */
const WHISTLE_HAND = hp([0.08, 0.12, 0.95, 1], 0.7, 0.85, -0.05)
const HAND = {
  relaxed: hp([0.26, 0.3, 0.34, 0.38], 0.2, 0.25, 0.02),
  loose: hp([0.5, 0.58, 0.64, 0.7], 0.35, 0.45, -0.05),
  open: hp([0.04, 0.03, 0.05, 0.07], 0.02, 0.0, 0.55),
  flat: hp([0.1, 0.08, 0.1, 0.14], 0.08, 0.05, 0.12),
  fist: hp([1, 1, 1, 1], 0.8, 0.95, -0.1),
  brush: hp([0.55, 0.62, 0.86, 0.92], 0.5, 0.85, -0.05),
  together: hp([0.05, 0.04, 0.05, 0.06], 0.1, 0.05, 0),
  face: hp([0.42, 0.46, 0.5, 0.55], 0.3, 0.3, 0.15),
}
const SIDES = ["L", "R"] as const
type FingerRig = { bones: [BoneRec, BoneRec, BoneRec]; axis: THREE.Vector3; spreadAxis: THREE.Vector3 }
type HandRig = { fingers: FingerRig[]; thumb: [BoneRec, BoneRec, BoneRec]; thumbAxis: THREE.Vector3; thumbInAxis: THREE.Vector3; palm: THREE.Vector3; dir: THREE.Vector3 }

type BoneRec = {
  bone: THREE.Bone
  restQ: THREE.Quaternion
  restP: THREE.Vector3
  /** parent's rest rotation in model space (A) and its inverse */
  parentRestModelQ: THREE.Quaternion
  parentRestModelQInv: THREE.Quaternion
  restModelPos: THREE.Vector3
  delta: THREE.Quaternion
  /** Cached root-to-bone traversal, built once (IK has no frame allocations). */
  chain: BoneRec[]
  x: MotionSpring
  y: MotionSpring
  z: MotionSpring
}

type LimbRig = {
  side: "L" | "R"
  sign: number
  shoulder: BoneRec
  upperarm: BoneRec
  forearm: BoneRec
  hand: BoneRec
  thigh: BoneRec
  shin: BoneRec
  foot: BoneRec
  toe?: BoneRec
  thighLen: number
  shinLen: number
  restThighDir: THREE.Vector3
  restShinDir: THREE.Vector3
  handPose: HandPose
  footZ: MotionSpring
  footY: MotionSpring
  footPitch: MotionSpring
  target: THREE.Vector3
  pitch: number
  toeOff: number
}

type JumpPose = { crouch: number; lift: number; forward: number; pitch: number; arm: number; roll: number; elbow: number; lean: number }

const _q = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _e = new THREE.Euler()
const _m = new THREE.Matrix4()
const _m2 = new THREE.Matrix4()
const _v = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _v3 = new THREE.Vector3()
const _q3 = new THREE.Quaternion()
const _v4 = new THREE.Vector3()
const _v5 = new THREE.Vector3()
const _frameA1 = new THREE.Vector3()
const _frameA2 = new THREE.Vector3()
const _frameA3 = new THREE.Vector3()
const _frameB1 = new THREE.Vector3()
const _frameB2 = new THREE.Vector3()
const _frameB3 = new THREE.Vector3()
// IK scratch is independent of FK/frameRotation scratch: inputs stay intact
// while a solver evaluates the two rotation frames.
const _parentQ = new THREE.Quaternion()
const _model1 = new THREE.Quaternion()
const _model2 = new THREE.Quaternion()
const _modelHand = new THREE.Quaternion()
const _deltaQ = new THREE.Quaternion()
const _joint = new THREE.Vector3()
const _direction = new THREE.Vector3()
const _pole = new THREE.Vector3()
const _upperDir = new THREE.Vector3()
const _lowerDir = new THREE.Vector3()
const _elbow = new THREE.Vector3()
const _rest1 = new THREE.Vector3()
const _rest2 = new THREE.Vector3()
const _hipsQ = new THREE.Quaternion()
const _hipsHead = new THREE.Vector3()

const FORWARD = new THREE.Vector3(0, 0, 1)
const BACK = new THREE.Vector3(0, 0, -1)
const DOWN = new THREE.Vector3(0, -1, 0)

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
const damp = (a: number, b: number, rate: number, dt: number): number => a + (b - a) * (1 - Math.exp(-rate * dt))
const ease = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
const perpendicular = (pole: THREE.Vector3, direction: THREE.Vector3): THREE.Vector3 => {
  pole.addScaledVector(direction, -pole.dot(direction))
  if (pole.lengthSq() < 1e-8) {
    pole.set(Math.abs(direction.y) < 0.9 ? 0 : 1, Math.abs(direction.y) < 0.9 ? 1 : 0, 0)
    pole.addScaledVector(direction, -pole.dot(direction))
  }
  return pole.normalize()
}

// Seconds to 95% from rest. Action envelopes ease both ends; faster pose
// springs add overlapping body motion without delaying a short punch/jump.
/**
 * How far the pelvis rises as the swimmer pitches into a forward stroke, so
 * the mouth stays above the water. Simpler rigs float with the water
 * high on a short body and need the full lift; the realistic bodies float at
 * chest depth (bodyMetrics) and need less, or the shoulders and the whole
 * stroke come out of the water.
 */
export const SWIM_LIFT = { storybook: 0.28, real: 0.10 } as const
/** Arm pitch at the glide of the breaststroke (overhead = about -3). */
export const SWIM_REACH = { storybook: -2.85, real: -2.3 } as const

const TIMING = {
  walkEnter: 0.30, walkExit: 0.38,
  gestureEnter: 0.38, gestureExit: 0.34, kneelEnter: 0.48, kneelExit: 0.42,
  swimEnter: 0.50, swimExit: 0.40, wadeEnter: 0.35, wadeExit: 0.30,
  pelvis: 0.12, spine: 0.14, chest: 0.16, arm: 0.18, head: 0.10,
  gaze: 0.24, jump: 0.065, jumpArm: 0.10, foot: 0.075, blocked: 0.065,
} as const
const POSE_STEP = 1 / 120

/** Authored phase targets are continuous at takeoff, apex and touchdown. */
const jumpAt = (phase: HumanPoseInput["jumpPhase"], time: number, airborne: boolean, out: JumpPose): void => {
  out.crouch = out.lift = out.forward = out.pitch = out.lean = out.arm = 0
  out.roll = 0.08
  out.elbow = 0.18
  if (phase === "rising" || phase === "falling" || airborne) {
    // jumpTime runs from takeoff through both aerial phases; it does not
    // restart at the apex. A ledge fall (airborne only) starts in the reach.
    const t = phase === "grounded" ? Math.max(0.5, time) : time
    const apex = PLAYER_JUMP_SPEED / PLAYER_GRAVITY
    const extend = ease(0, 0.10, t)
    const tuck = ease(0.07, 0.24, t) * (1 - ease(apex + 0.04, apex * 2 - 0.045, t))
    out.crouch = 0.115 * (1 - extend)
    out.lift = 0.135 * tuck
    out.forward = 0.07 * tuck
    out.pitch = 0.32 * tuck
    out.arm = 0.45 - 2.10 * ease(0, 0.20, t) + 1.10 * ease(apex - 0.04, apex * 2 - 0.045, t)
    out.roll = 0.08 + 0.32 * ease(0, 0.20, t)
    out.elbow = 0.38 + 0.32 * tuck
    out.lean = 0.12 * (1 - extend)
  } else if (phase === "landing") {
    const recover = ease(0.06, JUMP_LAND_TIME, time)
    out.crouch = 0.105 * ease(0, 0.06, time) * (1 - recover)
    out.arm = -0.55 * (1 - ease(0, JUMP_LAND_TIME, time))
    out.roll = 0.08 + 0.32 * (1 - ease(0, JUMP_LAND_TIME, time))
    out.elbow = 0.18 + 0.20 * (1 - ease(0, JUMP_LAND_TIME, time))
    out.lean = 0.08 * ease(0, 0.06, time) * (1 - recover)
  }
}

/** Rotation matrix mapping frame (dirA, poleA) onto (dirB, poleB). */
const frameRotation = (dirA: THREE.Vector3, poleA: THREE.Vector3, dirB: THREE.Vector3, poleB: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion => {
  const a1 = _frameA1.copy(dirA).normalize()
  const a2 = perpendicular(_frameA2.copy(poleA), a1)
  const a3 = _frameA3.crossVectors(a1, a2)
  const b1 = _frameB1.copy(dirB).normalize()
  const b2 = perpendicular(_frameB2.copy(poleB), b1)
  const b3 = _frameB3.crossVectors(b1, b2)
  _m.makeBasis(a1, a2, a3)
  _m2.makeBasis(b1, b2, b3)
  _m.transpose()
  _m2.multiply(_m)
  return out.setFromRotationMatrix(_m2)
}

export class HumanAnimator {
  private recs = new Map<string, BoneRec>()
  private bones: BoneRec[] = []
  private limbs: LimbRig[] = []
  private hips!: BoneRec
  private gait: GaitParams = { cadence: 0, stepLength: 0, duty: 0.6, lift: 0, bob: 0, runBlend: 0 }
  private gaitTarget: GaitParams = { cadence: 0, stepLength: 0, duty: 0.6, lift: 0, bob: 0, runBlend: 0 }
  private foot: FootSample = { z: 0, y: 0, pitch: 0, stance: true, t: 0 }
  phase = 0
  private swimPhase = 0
  /** pelvis raise while swimming forward, see SWIM_LIFT */
  swimLift: number = SWIM_LIFT.storybook
  /** arm pitch at the glide, see SWIM_REACH */
  swimReach: number = SWIM_REACH.storybook
  private treadPhase = 0
  private move = new MotionSpring()
  private actualMotion = new MotionSpring()
  private run = new MotionSpring()
  private stride = new MotionSpring(0.6 / 2.06)
  private cadence = new MotionSpring(2.06)
  private speed = new MotionSpring()
  private lean = new MotionSpring()
  private bank = new MotionSpring()
  private turnHead = new MotionSpring()
  private turnTorso = new MotionSpring()
  private turnArms = new MotionSpring()
  private cape = new MotionSpring()
  private cape2 = new MotionSpring()
  private headYaw = new MotionSpring()
  private headPitch = new MotionSpring()
  private hipsX = new MotionSpring()
  private hipsY = new MotionSpring()
  private hipsZ = new MotionSpring()
  private air = new MotionSpring()
  private jumping = new MotionSpring()
  private swim = new MotionSpring()
  private swimFeet = new MotionSpring()
  private swimTravel = new MotionSpring()
  private swimSpeed = new MotionSpring()
  private wade = new MotionSpring()
  private petting = new MotionSpring()
  private petSide = new MotionSpring(1)
  private celebrate = new MotionSpring()
  private stance = new MotionSpring()
  private jab = new MotionSpring()
  private cross = new MotionSpring()
  private fear = new MotionSpring()
  private greeting = new MotionSpring()
  private sit = new MotionSpring()
  private rideW = new MotionSpring()
  private rideLeanS = new MotionSpring()
  private paint = new MotionSpring()
  private wish = new MotionSpring()
  private kneel = new MotionSpring()
  private call = new MotionSpring()
  private whistle = new MotionSpring()
  private smile = new MotionSpring()
  private reach = new MotionSpring()
  private reachX = new MotionSpring()
  private reachY = new MotionSpring()
  private reachZ = new MotionSpring()
  private reachTarget = new THREE.Vector3()
  private strokeDir = FORWARD.clone()
  private strokeYaw = new MotionSpring()
  private hasReachTarget = false
  private free = SIDES.map(() => ({
    weight: new MotionSpring(), x: new MotionSpring(), y: new MotionSpring(), z: new MotionSpring(), has: false,
    target: new THREE.Vector3(), fingers: new THREE.Vector3(0, -1, 0), palm: new THREE.Vector3(1, 0, 0), grip: 0,
  }))
  private bow = new MotionSpring()
  private dance = new MotionSpring()
  private love = new MotionSpring()
  private jumpPose: JumpPose = { crouch: 0, lift: 0, forward: 0, pitch: 0, arm: 0, roll: 0.08, elbow: 0.18, lean: 0 }
  private poseDt = 0
  private blinkTimer = 2.5
  private blink = 0
  private glanceYaw = 0
  private glanceTimer = 0
  /** true on the frame a foot touches down (for footstep sounds) */
  stepped = false
  private rideNow = 0
  /** rest height of the pelvis joint above the soles (riding places it on the seat) */
  get hipsHeight(): number { return this.hips.restModelPos.y }
  private face: HumanAsset["face"]
  private faceRig: HumanAsset["faceRig"]
  private hands: Partial<Record<"L" | "R", HandRig>> = {}
  private beckonPose = hp(0, 0.15, 0.1, 0.1)

  constructor(asset: HumanAsset) {
    this.face = asset.face
    this.faceRig = asset.faceRig
    if (asset.style === "real") {
      this.swimLift = SWIM_LIFT.real
      this.swimReach = SWIM_REACH.real
    }
    const root = asset.root
    root.updateMatrixWorld(true)
    const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert()
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const scl = new THREE.Vector3()
    for (const [name, bone] of asset.bones) {
      const model = new THREE.Matrix4().multiplyMatrices(rootInv, bone.matrixWorld)
      model.decompose(pos, quat, scl)
      const parent = bone.parent
      const parentModel = new THREE.Matrix4().multiplyMatrices(rootInv, parent ? parent.matrixWorld : new THREE.Matrix4())
      const pq = new THREE.Quaternion()
      parentModel.decompose(new THREE.Vector3(), pq, new THREE.Vector3())
      const rec: BoneRec = {
        bone,
        restQ: bone.quaternion.clone(),
        restP: bone.position.clone(),
        parentRestModelQ: pq.clone(),
        parentRestModelQInv: pq.clone().invert(),
        restModelPos: pos.clone(),
        delta: new THREE.Quaternion(), chain: [],
        x: new MotionSpring(), y: new MotionSpring(), z: new MotionSpring(),
      }
      this.recs.set(name, rec)
      this.bones.push(rec)
    }
    for (const rec of this.bones) {
      let bone: THREE.Object3D | null = rec.bone
      while (bone && this.recs.has(bone.name)) {
        rec.chain.unshift(this.recs.get(bone.name)!)
        bone = bone.parent
      }
    }
    this.hips = this.recs.get("hips")!
    for (const side of SIDES) {
      const thigh = this.recs.get(`thigh${side}`)!
      const shin = this.recs.get(`shin${side}`)!
      const foot = this.recs.get(`foot${side}`)!
      this.limbs.push({
        side, sign: side === "L" ? 1 : -1,
        shoulder: this.recs.get(`shoulder${side}`)!, upperarm: this.recs.get(`upperarm${side}`)!,
        forearm: this.recs.get(`forearm${side}`)!, hand: this.recs.get(`hand${side}`)!,
        thigh, shin, foot, toe: this.recs.get(`toe${side}`),
        thighLen: thigh.restModelPos.distanceTo(shin.restModelPos), shinLen: shin.restModelPos.distanceTo(foot.restModelPos),
        restThighDir: shin.restModelPos.clone().sub(thigh.restModelPos).normalize(),
        restShinDir: foot.restModelPos.clone().sub(shin.restModelPos).normalize(),
        handPose: hp(0, 0, 0, 0), footZ: new MotionSpring(), footY: new MotionSpring(), footPitch: new MotionSpring(),
        target: new THREE.Vector3(), pitch: 0, toeOff: 0,
      })
    }
    // Hands: each digit's flexion axis is fixed in the rest-model frame, where
    // the deltas act (see apply()), so a curl reads the same in any arm pose.
    for (const side of SIDES) {
      if (!this.recs.has(`index1${side}`) || !this.recs.has(`thumb1${side}`)) continue
      const sx = side === "L" ? 1 : -1
      const palmN = new THREE.Vector3(-sx, 0, 0)
      const wrist = this.modelPos(`hand${side}`)
      const knuckles = this.modelPos(`middle1${side}`)
      const dir = knuckles.clone().sub(wrist).normalize()
      const lateral = this.modelPos(`index1${side}`).clone().sub(this.modelPos(`pinky1${side}`)).normalize()
      const fingers: FingerRig[] = []
      for (const f of FINGER_NAMES) {
        const d = this.modelPos(`${f}2${side}`).clone().sub(this.modelPos(`${f}1${side}`)).normalize()
        const axis = new THREE.Vector3().crossVectors(d, palmN).normalize()
        // spreading turns the digit toward its own side of the hand
        let spreadAxis = palmN.clone()
        if (new THREE.Vector3().crossVectors(palmN, d).dot(lateral) < 0) spreadAxis = spreadAxis.negate()
        fingers.push({ bones: [this.recs.get(`${f}1${side}`)!, this.recs.get(`${f}2${side}`)!, this.recs.get(`${f}3${side}`)!], axis, spreadAxis })
      }
      const td = this.modelPos(`thumb2${side}`).clone().sub(this.modelPos(`thumb1${side}`)).normalize()
      // the thumb folds toward the palm and across it, toward the pinky
      const across = palmN.clone().multiplyScalar(0.6).addScaledVector(lateral, -0.8).normalize()
      this.hands[side] = {
        fingers,
        thumb: [this.recs.get(`thumb1${side}`)!, this.recs.get(`thumb2${side}`)!, this.recs.get(`thumb3${side}`)!],
        thumbAxis: new THREE.Vector3().crossVectors(td, across).normalize(),
        thumbInAxis: new THREE.Vector3().crossVectors(td, palmN).normalize(),
        palm: palmN,
        dir,
      }
    }
  }

  /** Pose one hand's digits. */
  private poseHand(side: "L" | "R", h: HandPose): void {
    const rig = this.hands[side]
    if (!rig) return
    for (let i = 0; i < 4; i++) {
      const f = rig.fingers[i]
      const c = Math.max(0, Math.min(1, h.curl[i]))
      for (let j = 0; j < 3; j++) {
        _q.setFromAxisAngle(f.axis, c * JOINT_MAX[j] - JOINT_REST[j] * 0.7)
        if (j === 0) _q2.setFromAxisAngle(f.spreadAxis, h.spread * SPREAD[i] * (1 - c * 0.7)).multiply(_q)
        else _q2.copy(_q)
        f.bones[j].delta.copy(_q2)
      }
    }
    _q.setFromAxisAngle(rig.thumbInAxis, h.thumbIn * 0.75)
    rig.thumb[0].delta.copy(_q)
    _q.setFromAxisAngle(rig.thumbAxis, h.thumb * 0.7)
    rig.thumb[1].delta.copy(_q)
    _q.setFromAxisAngle(rig.thumbAxis, h.thumb * 0.9)
    rig.thumb[2].delta.copy(_q)
  }

  /** Model-space bone head under the current deltas and translations. */
  private posedHead(rec: BoneRec, out: THREE.Vector3): THREE.Vector3 {
    const chain = rec.chain
    const acc = _q3.identity()
    for (let i = 0; i < chain.length; i++) {
      const r = chain[i]
      const tr = _v3.copy(r.bone.position).sub(r.restP).applyQuaternion(r.parentRestModelQ)
      if (i === 0) out.copy(r.restModelPos).add(tr)
      else out.add(_v2.copy(r.restModelPos).sub(chain[i - 1].restModelPos).applyQuaternion(acc)).add(tr.applyQuaternion(acc))
      acc.multiply(r.delta)
    }
    return out
  }

  private modelPos(name: string): THREE.Vector3 {
    return this.recs.get(name)!.restModelPos
  }

  /** Velocity-preserving mass response in model axes, never quaternion lerp. */
  private euler(bone: string | BoneRec, x: number, y: number, z: number, response: number = TIMING.spine): void {
    const rec = typeof bone === "string" ? this.recs.get(bone) : bone
    if (!rec) return
    _e.set(rec.x.to(x, response, this.poseDt), rec.y.to(y, response, this.poseDt), rec.z.to(z, response, this.poseDt), "YXZ")
    rec.delta.setFromEuler(_e)
  }

  /** Accumulated model-space delta from the root down to a bone (inclusive). */
  private accumulated(rec: BoneRec, out: THREE.Quaternion): THREE.Quaternion {
    out.identity()
    for (let i = 0; i < rec.chain.length; i++) out.multiply(rec.chain[i].delta)
    return out
  }

  private apply(): void {
    for (let i = 0; i < this.bones.length; i++) {
      const rec = this.bones[i]
      const d = rec.delta
      // local = A⁻¹ · D · A · restLocal
      _q.copy(rec.parentRestModelQInv).multiply(d).multiply(rec.parentRestModelQ).multiply(rec.restQ)
      rec.bone.quaternion.copy(_q)
    }
  }

  /**
   * Two-bone IK for the right arm: the wrist goes where the palm can rest on
   * `target`, the elbow bends out and back, and the hand lies flat with its
   * fingers along `strokeDir`.
   */
  private reachRight(target: THREE.Vector3, strokeDir: THREE.Vector3 | null, weight: number): void {
    const limb = this.limbs[1]
    const up = limb.upperarm
    const fore = limb.forearm
    const hand = limb.hand
    const rig = this.hands.R
    const L1 = up.restModelPos.distanceTo(fore.restModelPos)
    const L2 = fore.restModelPos.distanceTo(hand.restModelPos)
    const along = _v4.copy(strokeDir ?? FORWARD).setY(0)
    if (along.lengthSq() < 1e-6) along.copy(FORWARD)
    along.normalize()
    // wrist sits behind the palm centre, a little above the fur
    const wrist = _v5.copy(target).addScaledVector(along, -0.055).add(_v.set(0, 0.03, 0))
    const parentQ = this.accumulated(limb.shoulder, _parentQ)
    const shoulder = this.posedHead(up, _joint)
    const to = _direction.copy(wrist).sub(shoulder)
    const dist = clamp(to.length(), 0.05, L1 + L2 - 0.003)
    const u = to.lengthSq() < 1e-8 ? to.copy(DOWN) : to.normalize()
    const pole = _pole.set(-0.55, -0.25, -0.8).normalize()
    const wv = perpendicular(pole, u)
    const cosA = clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1)
    const a1 = Math.acos(cosA)
    const d1 = _upperDir.copy(u).multiplyScalar(Math.cos(a1)).addScaledVector(wv, Math.sin(a1))
    const elbow = _elbow.copy(shoulder).addScaledVector(d1, L1)
    const d2 = _lowerDir.copy(shoulder).addScaledVector(u, dist).sub(elbow).normalize()
    const rest1 = _rest1.copy(fore.restModelPos).sub(up.restModelPos).normalize()
    const rest2 = _rest2.copy(hand.restModelPos).sub(fore.restModelPos).normalize()
    const M1 = frameRotation(rest1, BACK, d1, wv, _model1)
    const M2 = frameRotation(rest2, BACK, d2, wv, _model2)
    const D1 = _deltaQ.copy(parentQ).invert().multiply(M1)
    up.delta.slerp(D1, weight)
    const D2 = _deltaQ.copy(M1).invert().multiply(M2)
    fore.delta.slerp(D2, weight)
    if (rig) {
      // palm down on her back, fingers pointing along the stroke
      const fingers = _v.copy(along).addScaledVector(DOWN, 0.25).normalize()
      const Mh = frameRotation(rig.dir, rig.palm, fingers, DOWN, _modelHand)
      hand.delta.slerp(_deltaQ.copy(M2).invert().multiply(Mh), weight)
    }
  }

  /**
   * Two-bone IK for either arm towards a free goal: elbows bend outward and
   * down, the palm centre lands on the target with the requested orientation.
   */
  private reachArm(index: 0 | 1, target: THREE.Vector3, fingers: THREE.Vector3, palm: THREE.Vector3, weight: number): void {
    const limb = this.limbs[index]
    const up = limb.upperarm
    const fore = limb.forearm
    const hand = limb.hand
    const rig = this.hands[limb.side]
    const L1 = up.restModelPos.distanceTo(fore.restModelPos)
    const L2 = fore.restModelPos.distanceTo(hand.restModelPos)
    const along = _v4.copy(fingers)
    if (along.lengthSq() < 1e-6) along.copy(DOWN)
    along.normalize()
    // the wrist sits a palm's length behind the palm centre
    const wrist = _v5.copy(target).addScaledVector(along, -0.06)
    const parentQ = this.accumulated(limb.shoulder, _parentQ)
    const shoulder = this.posedHead(up, _joint)
    const to = _direction.copy(wrist).sub(shoulder)
    const dist = clamp(to.length(), 0.05, L1 + L2 - 0.003)
    const u = to.lengthSq() < 1e-8 ? to.copy(DOWN) : to.normalize()
    const pole = _pole.set(limb.sign * 0.55, -0.35, -0.75).normalize()
    const wv = perpendicular(pole, u)
    const cosA = clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1)
    const a1 = Math.acos(cosA)
    const d1 = _upperDir.copy(u).multiplyScalar(Math.cos(a1)).addScaledVector(wv, Math.sin(a1))
    const elbow = _elbow.copy(shoulder).addScaledVector(d1, L1)
    const d2 = _lowerDir.copy(shoulder).addScaledVector(u, dist).sub(elbow).normalize()
    const rest1 = _rest1.copy(fore.restModelPos).sub(up.restModelPos).normalize()
    const rest2 = _rest2.copy(hand.restModelPos).sub(fore.restModelPos).normalize()
    const M1 = frameRotation(rest1, BACK, d1, wv, _model1)
    const M2 = frameRotation(rest2, BACK, d2, wv, _model2)
    up.delta.slerp(_deltaQ.copy(parentQ).invert().multiply(M1), weight)
    fore.delta.slerp(_deltaQ.copy(M1).invert().multiply(M2), weight)
    if (rig) {
      const Mh = frameRotation(rig.dir, rig.palm, along, palm, _modelHand)
      hand.delta.slerp(_deltaQ.copy(M2).invert().multiply(Mh), weight)
    }
  }

  update(input: HumanPoseInput): void {
    this.stepped = false
    if (!Number.isFinite(input.dt) || input.dt <= 0) return
    // Keep the full elapsed time at 20..144 Hz. Subsample moving targets, not
    // just the springs, so fast gaits and short jump phases retain their shape.
    const dt = Math.min(input.dt, 0.25)
    const steps = Math.ceil(dt / POSE_STEP)
    const h = dt / steps
    for (let i = 0; i < steps; i++) this.pose(input, h, input.time - dt + (i + 1) * h, i === steps - 1)
    this.apply()
    // realistic faces: morphs and eye gaze from the same expression codes,
    // after apply() has reset the eye bones
    this.faceRig?.update(this.face, dt, this.headYaw.value, this.headPitch.value)
  }

  private pose(input: HumanPoseInput, dt: number, time: number, solve: boolean): void {
    this.poseDt = dt
    for (let i = 0; i < this.bones.length; i++) {
      this.bones[i].delta.identity()
      this.bones[i].bone.position.copy(this.bones[i].restP)
    }
    const enter = TIMING.gestureEnter
    const exit = TIMING.gestureExit
    const swim = this.swim.weight(input.swim ?? 0, TIMING.swimEnter, TIMING.swimExit, dt)
    // Legs trail the buoyant torso. Filtering the contact blend also avoids
    // an IK knee jerk as a nearly extended land leg first leaves the ground.
    const swimFeet = this.swimFeet.weight(swim, 0.12, 0.12, dt)
    const land = 1 - swim
    const wade = this.wade.weight(input.wade ?? 0, TIMING.wadeEnter, TIMING.wadeExit, dt) * land
    const swimSpeed = this.swimSpeed.to(Math.max(0, input.swimSpeed ?? 0), 0.22, dt)
    const travel = this.swimTravel.weight(ease(0.08, 0.70, swimSpeed), 0.30, 0.30, dt)
    // the stroke quickens with speed all the way to a sprint (no gliding feet at 6 m/s)
    this.swimPhase = (this.swimPhase + dt * (0.36 + 0.25 * clamp(swimSpeed, 0, 2.5) + 0.12 * clamp(swimSpeed - 2.5, 0, 5)) * swim) % 1
    this.treadPhase = (this.treadPhase + dt * 0.45 * swim) % 1
    const petting = this.petting.weight(input.petting, enter, exit, dt) * land
    const petSide = this.petSide.to(clamp(input.petSide, -1, 1), 0.24, dt)
    const cel = this.celebrate.weight(clamp(input.celebrate * 2.5, 0, 1), 0.42, 0.36, dt) * land
    const st = this.stance.weight(input.training.stance, enter, exit, dt) * land
    // Punch pulses are already authored (~0.12 s); a gesture-length ramp
    // would erase them. Preserve their snap of effort, with physical recovery.
    const jab = this.jab.weight(input.training.jab, 0.065, 0.10, dt)
    const cross = this.cross.weight(input.training.cross, 0.065, 0.10, dt)
    const fear = this.fear.weight(input.fear, 0.35, exit, dt) * land
    const greeting = this.greeting.weight(input.greeting, enter, exit, dt) * land
    const sit = this.sit.weight(input.sit, 0.45, 0.40, dt) * land
    const paint = this.paint.weight(input.paint, enter, exit, dt) * land
    const wish = this.wish.weight(input.wish, 0.42, exit, dt) * land
    const kneel = this.kneel.weight(input.kneel ?? 0, TIMING.kneelEnter, TIMING.kneelExit, dt) * land
    const call = this.call.weight(input.call ?? 0, enter, exit, dt) * land
    const whistle = this.whistle.weight(input.whistle ?? 0, 0.16, 0.3, dt) * land
    // 0-1 s fingers at the lips (chin up, chest lifted), then the arm goes up
    const wt = input.whistleT ?? 0
    const whistleLips = whistle * (1 - THREE.MathUtils.smoothstep(wt, 0.95, 1.2))
    const whistleWave = whistle * THREE.MathUtils.smoothstep(wt, 0.95, 1.2)
    const smile = this.smile.weight(input.smile ?? 0, 0.35, 0.35, dt)
    const bow = this.bow.to(clamp(input.bow ?? 0, -0.4, 0.9), 0.3, dt) * land
    const dance = this.dance.weight(input.dance ?? 0, 0.5, 0.5, dt) * land
    const love = this.love.weight(input.love ?? 0, 0.35, 0.5, dt)
    const groove = Math.sin(time * Math.PI * 1.6)
    const aerial = input.airborne || input.jumpPhase === "rising" || input.jumpPhase === "falling"
    const air = this.air.weight(aerial ? 1 : 0, 0.065, 0.10, dt) * land
    const jump = this.jumping.weight(input.jumpPhase !== "grounded" || input.airborne ? 1 : 0, 0.045, 0.15, dt) * land
    jumpAt(input.jumpPhase, Math.max(0, input.jumpTime - (input.time - time)), input.airborne, this.jumpPose)
    const jp = this.jumpPose

    // ---- gait: continuous cadence/stride, including a final settling step --
    const speed = Math.max(0, input.speed)
    // Turning where she stands is a few short steps, not a statue on a
    // turntable: a quick change of facing at a standstill drives the walk
    // cycle with short, in-place steps (feet lift and re-plant round her), the
    // hips leading and the head looking into the turn first
    const pivot = ease(0.7, 2.6, Math.abs(input.turnRate)) * (1 - ease(0.05, 0.5, speed))
    const stepSpeed = Math.max(speed, 0.62 * pivot)
    const moving = ease(0.02, 0.28, stepSpeed)
    const move = this.move.weight(moving * (1 - air), TIMING.walkEnter, TIMING.walkExit, dt)
    const w = move * land
    const motion = this.actualMotion.weight(ease(0.02, 0.45, speed) * (1 - air) * land, 0.08, TIMING.blocked, dt)
    const speedFollow = this.speed.to(speed, 0.25, dt)
    gaitFor(Math.max(speed, 0.6), this.gaitTarget)
    const run = this.run.weight(this.gaitTarget.runBlend * (1 - 0.65 * wade), 0.22, 0.26, dt)
    const duty = 0.62 - run * 0.28
    const cadenceScale = 1 - 0.32 * wade
    this.gait.cadence = this.cadence.to(this.gaitTarget.cadence * cadenceScale, 0.22, dt)
    this.gait.stepLength = this.stride.to(Math.min(this.gaitTarget.stepLength / cadenceScale, 0.48 / duty) * (1 - 0.72 * pivot), 0.22, dt)
    this.gait.runBlend = run
    this.gait.duty = duty
    this.gait.lift = 0.05 + run * 0.10 + wade * 0.11
    this.gait.bob = (0.012 + run * 0.03) * (1 - 0.35 * wade)
    const before = this.phase
    // At constant land speed this is exactly distance-driven. During a start
    // cap cadence to human reach; at a stop finish a small step as weight fades.
    const phaseSpeed = Math.min(Math.max(stepSpeed, 0.50 * move), this.gait.cadence * this.gait.stepLength) * land * (1 - air)
    this.phase = advanceGait(this.phase, phaseSpeed, dt, this.gait)
    const crossed = Math.floor(before * 2) !== Math.floor(this.phase * 2) || this.phase < before
    if (crossed && speed > 0.4 && air < 0.1 && swim < 0.1) this.stepped = true

    // ---- posture: actual movement gates both stored and requested inertia ---
    const leanTarget = ((0.05 + 0.13 * run) * w + clamp(input.forwardAccel * 0.012, -0.08, 0.10) + clamp(input.slope * 0.35, -0.12, 0.15) * w) * motion
    const inertiaTime = speed < 0.12 ? TIMING.blocked : 0.15
    const lean = this.lean.to(leanTarget, inertiaTime, dt) * motion
    const bank = this.bank.to(clamp(-input.turnRate * (0.02 + speed * 0.012), -0.16, 0.16) * motion, inertiaTime, dt) * motion
    const turnHead = this.turnHead.to(clamp(input.turnRate * 0.075, -0.30, 0.30), 0.09, dt)
    const turnTorso = this.turnTorso.to(clamp(input.turnRate * 0.045, -0.18, 0.18) * Math.max(motion, pivot * 0.8), 0.22, dt)
    const turnArms = this.turnArms.to(turnTorso, 0.28, dt)
    const bodyTime = speed < 0.12 && move > 0.05 ? TIMING.blocked : TIMING.pelvis
    const bob = pelvisBob(this.phase, this.gait) * w * (1 - jump)
    const breathe = Math.sin(time * 1.6) * 0.006 * (1 - w)
    const weightShift = Math.sin(time * 0.55) * 0.012 * (1 - w) * land
    const crouch = jp.crouch * jump + petting * 0.16 * (1 - kneel) + st * 0.05 + fear * 0.04 + sit * 0.36 + kneel * 0.37 + call * 0.07
    const reachDrop = Math.min(0, input.groundLeft, input.groundRight) * 0.9 * land * (1 - air)
    const hipsTime = jump > 0.1 ? TIMING.jump : TIMING.pelvis
    const hx = this.hipsX.to(weightShift + Math.sin(this.phase * Math.PI * 2) * 0.008 * w + groove * 0.035 * dance, hipsTime, dt)
    // Raising the swimming pelvis as the torso pitches keeps the mouth above
    // the physical waterline, rather than dipping the whole face under it.
    const hy = this.hipsY.to(-0.012 - crouch + bob + reachDrop + swim * (0.05 + this.swimLift * travel) - Math.abs(groove) * 0.025 * dance, hipsTime, dt)
    const hz = this.hipsZ.to(-petting * 0.03 + swim * travel * 0.08, hipsTime, dt)
    _v.set(hx, hy, hz).applyQuaternion(this.hips.parentRestModelQInv)
    this.hips.bone.position.add(_v)
    // Riding: the saddle carries the pelvis. Posting rises and the two-point
    // lift come straight from the horse's stride (no spring lag on the beat).
    const ride = this.rideW.weight(input.ride ?? 0, 0.16, 0.2, dt)
    const rideLean = this.rideLeanS.to((input.rideLean ?? 0) * ride, 0.18, dt)
    // holding on in a trick: the hands close and the body folds down over the neck; a strong pull presses it back into the saddle
    const grip = clamp(input.rideGrip ?? 0, 0, 1) * ride
    const brace = clamp(input.rideBrace ?? 0, 0, 1) * ride
    if (ride > 0.001 && input.rideHips) {
      _v.copy(input.rideHips).multiplyScalar(ride).applyQuaternion(this.hips.parentRestModelQInv)
      this.hips.bone.position.add(_v)
    }
    const sway = Math.sin(this.phase * Math.PI * 2)
    const swimPitch = swim * (0.10 + 0.98 * travel)
    const treadSway = Math.sin(this.treadPhase * Math.PI * 2) * 0.025 * swim * (1 - travel)
    this.euler(this.hips, lean * 0.35 + petting * 0.25 * (1 - kneel) - sit * 0.25 + kneel * 0.12 + call * 0.08 + jp.lean * jump * 0.35 + swimPitch,
      sway * 0.12 * w * (1 - run * 0.4) + turnTorso * 0.2 + groove * 0.12 * dance, sway * 0.05 * w + bank * 0.5 + weightShift * 1.2 + treadSway - groove * 0.08 * dance + (input.rideTumble??0)*1.25, input.rideTumble ? .08 : jump > 0.1 ? TIMING.jump : bodyTime)
    this.euler("spine", rideLean * 0.45 + grip * 0.16 - brace * 0.1 + lean * 0.4 + breathe * 0.4 + kneel * 0.4 + call * 0.12 + jp.lean * jump * 0.4 + swim * travel * 0.04 + bow * 0.45,
      -sway * 0.08 * w - kneel * 0.12 + turnTorso * 0.4, -sway * 0.025 * w + bank * 0.3, speed < 0.12 ? bodyTime : TIMING.spine)
    this.euler("chest", rideLean * 0.35 + grip * 0.12 + lean * 0.3 + breathe + petting * 0.15 * (1 - kneel) + fear * 0.15 + kneel * 0.32 + call * 0.1 + jp.lean * jump * 0.25 + swim * travel * 0.02 + bow * 0.35,
      -sway * 0.1 * w + (jab * 0.25 - cross * 0.45) * st - kneel * 0.1 + turnTorso * 0.4 - groove * 0.1 * dance, -sway * 0.02 * w + groove * 0.06 * dance + (input.rideBank ?? 0) * 0.6 * ride, st > 0.1 ? 0.09 : TIMING.chest)

    // ---- gaze: head leads, torso follows, upper limbs trail -----------------
    this.glanceTimer -= dt
    if (this.glanceTimer <= 0) {
      this.glanceTimer = 2.5 + ((time * 7.31) % 1) * 4
      this.glanceYaw = w > 0.5 ? 0 : (((time * 3.17) % 1) - 0.5) * 0.9
    }
    const wantYaw = clamp(input.lookYaw + this.glanceYaw * Math.max(0, 1 - Math.abs(input.lookYaw) * 2), -1, 1)
    // Anticipation has its own fast spring; passing it through the deliberate
    // cat-look response would make the head arrive after the torso instead.
    const headYaw = clamp(this.headYaw.to(wantYaw, TIMING.gaze, dt) + turnHead - turnTorso, -1, 1)
    const headPitch = this.headPitch.to(clamp(input.lookPitch + petting * 0.35 * (1 - kneel) + fear * 0.2 - lean * 0.7 + wish * 0.25 + paint * 0.1 - sit * 0.12 + kneel * 0.1 + call * 0.15 - whistle * 0.16 - (swimPitch + swim * travel * 0.06) * 0.95 - bow * 0.55, -1.2, 0.85), 0.20, dt)
    const nod = Math.sin(this.phase * Math.PI * 4) * 0.03 * w
    const neckShare = 0.4 + 0.30 * swim * travel
    this.euler("neck", headPitch * neckShare + nod * 0.5, headYaw * 0.4 + sway * 0.12 * w, -bank * 0.3, TIMING.head)
    this.euler("head", headPitch * (1 - neckShare) + nod, headYaw * 0.6 + sway * 0.06 * w + greeting * 0.15,
      petting * 0.25 * petSide + Math.sin(time * 0.7) * 0.02 * (1 - w) + call * 0.18 + groove * 0.12 * dance + love * 0.1, TIMING.head)

    // Breaststroke: glide -> outward pull -> hands recover -> delayed frog
    // kick. All signals join with zero slope at cycle wrap (no stroke reset).
    const p = this.swimPhase
    const pull = ease(0.14, 0.42, p) * (1 - ease(0.52, 0.82, p))
    const recover = ease(0.42, 0.60, p) * (1 - ease(0.78, 1, p))
    const frog = ease(0.30, 0.56, p) * (1 - ease(0.62, 0.90, p))
    const kick = ease(0.58, 0.80, p) * (1 - ease(0.82, 0.99, p))
    for (let i = 0; i < this.limbs.length; i++) {
      const limb = this.limbs[i]
      const side = limb.side
      const s = limb.sign
      const swingPhase = Math.sin((this.phase + (i === 0 ? 0.5 : 0)) * Math.PI * 2)
      let pitch = -swingPhase * (0.42 + run * 0.5) * w - wade * 0.22
      let roll = s * (0.08 + run * 0.12 * w + wade * 0.24)
      let elbow = 0.18 + run * 1.1 * w + Math.max(0, swingPhase) * 0.25 * w + wade * 0.28
      let whistleYaw = 0
      pitch = THREE.MathUtils.lerp(pitch, jp.arm, jump)
      roll = THREE.MathUtils.lerp(roll, s * jp.roll, jump)
      elbow = THREE.MathUtils.lerp(elbow, jp.elbow, jump)
      const pet = petting * (0.925 + (i === 0 ? -petSide : petSide) * 0.075)
      pitch = THREE.MathUtils.lerp(pitch, -1.15 + Math.sin(time * 4.4 + s) * 0.12, pet)
      elbow = THREE.MathUtils.lerp(elbow, 0.5, pet)
      pitch = THREE.MathUtils.lerp(pitch, -2.25 + Math.sin(time * 9 + s) * 0.15, cel)
      roll = THREE.MathUtils.lerp(roll, s * 0.35, cel)
      elbow = THREE.MathUtils.lerp(elbow, 0.5, cel)
      if (i === 1) {
        pitch = THREE.MathUtils.lerp(pitch, -2.4, greeting)
        roll = THREE.MathUtils.lerp(roll, -0.4 + Math.sin(time * 10) * 0.25, greeting)
        elbow = THREE.MathUtils.lerp(elbow, 0.9, greeting)
      }
      const punch = i === 0 ? jab : cross
      pitch = THREE.MathUtils.lerp(pitch, -1.35 - punch * 0.25, st)
      roll = THREE.MathUtils.lerp(roll, s * -0.15, st)
      elbow = THREE.MathUtils.lerp(elbow, 1.9 - punch * 1.75, st)
      pitch = THREE.MathUtils.lerp(pitch, i === 1 ? -1.25 + Math.sin(time * 5) * 0.18 : -0.55, paint)
      roll = THREE.MathUtils.lerp(roll, i === 1 ? s * 0.1 + Math.sin(time * 3.3) * 0.2 : s * 0.2, paint)
      elbow = THREE.MathUtils.lerp(elbow, i === 1 ? 0.7 : 1.4, paint)
      pitch = THREE.MathUtils.lerp(pitch, -1.1, wish)
      roll = THREE.MathUtils.lerp(roll, s * -0.5, wish)
      elbow = THREE.MathUtils.lerp(elbow, 2.1, wish)
      pitch = THREE.MathUtils.lerp(pitch, -0.75, sit)
      elbow = THREE.MathUtils.lerp(elbow, 0.55, sit)
      pitch = THREE.MathUtils.lerp(pitch, -1.7, fear)
      elbow = THREE.MathUtils.lerp(elbow, 2.0, fear)
      roll = THREE.MathUtils.lerp(roll, s * -0.2, fear)
      pitch = THREE.MathUtils.lerp(pitch, i === 0 ? -0.95 : pitch, kneel)
      roll = THREE.MathUtils.lerp(roll, i === 0 ? s * 0.05 : roll, kneel)
      elbow = THREE.MathUtils.lerp(elbow, i === 0 ? 0.75 : elbow, kneel)
      pitch = THREE.MathUtils.lerp(pitch, i === 1 ? -0.85 : -0.35, call * (i === 1 ? 1 : 0.6))
      roll = THREE.MathUtils.lerp(roll, s * 0.12, call * (i === 1 ? 1 : 0))
      elbow = THREE.MathUtils.lerp(elbow, i === 1 ? 0.85 : 0.5, call * (i === 1 ? 1 : 0.6))
      if (i === 1) {
        // the whistle: right hand up to the lips…
        // (the upper arm comes across the chest so the forearm folds up to the
        // mouth, not out beside the head)
        pitch = THREE.MathUtils.lerp(pitch, -1.65, whistleLips)
        roll = THREE.MathUtils.lerp(roll, s * -0.2, whistleLips)
        elbow = THREE.MathUtils.lerp(elbow, 2.4, whistleLips)
        whistleYaw = s * -1.05 * whistleLips
        // …then raised high, waving to the sky where the Pegasus will come from
        pitch = THREE.MathUtils.lerp(pitch, -2.7 + Math.sin(time * 7) * 0.1, whistleWave)
        roll = THREE.MathUtils.lerp(roll, s * (0.25 + Math.sin(time * 7) * 0.12), whistleWave)
        elbow = THREE.MathUtils.lerp(elbow, 0.35, whistleWave)
      } else {
        pitch = THREE.MathUtils.lerp(pitch, -0.2, whistle * 0.5)
      }
      const scull = Math.sin((this.treadPhase + i * 0.5) * Math.PI * 2)
      pitch = THREE.MathUtils.lerp(pitch, THREE.MathUtils.lerp(-0.65 + scull * 0.15, this.swimReach + pull * 0.95 + recover * 0.35, travel), swim)
      roll = THREE.MathUtils.lerp(roll, s * THREE.MathUtils.lerp(0.48 + scull * 0.10, 0.05 + pull * 0.85 + recover * 0.10, travel), swim)
      elbow = THREE.MathUtils.lerp(elbow, THREE.MathUtils.lerp(1.0 + scull * 0.20, 0.20 + pull * 1.1 + recover * 1.35, travel), swim)
      pitch = THREE.MathUtils.lerp(pitch, -0.55, ride)
      roll = THREE.MathUtils.lerp(roll, s * 0.12, ride)
      elbow = THREE.MathUtils.lerp(elbow, 1.15, ride)
      const armTime = jump > 0.1 ? TIMING.jumpArm : st > 0.1 ? 0.09 : TIMING.arm
      const overhead = Math.max(0, -pitch - 1.6) * 0.12
      this.euler(limb.shoulder, 0, 0, s * (breathe * 0.6 + cel * 0.10 + overhead), 0.14)
      this.euler(limb.upperarm, pitch, s * -0.1 * w + (turnArms - turnTorso) * 0.6 + whistleYaw, roll, armTime)
      this.euler(limb.forearm, -elbow, s * 0.25 * clamp(elbow, 0, 1), 0, armTime)
      const wristLag = Math.cos((this.phase + (i === 0 ? 0.5 : 0)) * Math.PI * 2) * 0.12 * w
      this.euler(limb.hand, -0.1 - elbow * 0.12 + wristLag + swim * pull * 0.25,
        s * scull * 0.25 * swim, s * 0.1 + (i === 1 ? -s * 1.25 * call : 0) + s * swim * 0.25, armTime + 0.035)
      const h = limb.handPose
      for (let f = 0; f < 4; f++) h.curl[f] = HAND.relaxed.curl[f]
      h.thumb = HAND.relaxed.thumb
      h.thumbIn = HAND.relaxed.thumbIn
      h.spread = HAND.relaxed.spread
      lerpHand(h, HAND.loose, run * w * 0.8)
      lerpHand(h, HAND.open, air * 0.6)
      lerpHand(h, HAND.flat, pet)
      lerpHand(h, HAND.open, cel)
      if (i === 1) lerpHand(h, HAND.open, greeting)
      lerpHand(h, HAND.fist, st)
      lerpHand(h, i === 1 ? HAND.brush : HAND.loose, paint)
      lerpHand(h, HAND.together, wish)
      lerpHand(h, HAND.relaxed, sit * 0.6)
      lerpHand(h, HAND.face, fear)
      lerpHand(h, i === 0 ? HAND.relaxed : HAND.flat, kneel)
      if (i === 1) {
        const beckon = 0.2 + 0.65 * (0.5 + 0.5 * Math.sin(time * 9))
        for (let f = 0; f < 4; f++) this.beckonPose.curl[f] = beckon * (1 + f * 0.04)
        lerpHand(h, this.beckonPose, call)
        lerpHand(h, WHISTLE_HAND, whistleLips)
        lerpHand(h, HAND.open, whistleWave)
        for (let f = 0; f < 4; f++) h.curl[f] += Math.sin(time * 6) * 0.03 * this.reach.value
      }
      lerpHand(h, HAND.flat, swim * 0.85)
      lerpHand(h, HAND.loose, ride * 0.9)
      this.poseHand(side, h)

      // Foot paths are springs too; IK remains the last constraint so ground
      // contact is not broken by smoothing the solved bone rotations.
      footAt(this.phase, i, this.gait, this.foot)
      const fz = this.foot.z * w + st * (i === 0 ? 0.16 : -0.12) + sit * 0.32 + kneel * (i === 0 ? 0.20 : -0.31) + jp.forward * jump
      const fy = this.foot.y * w + sit * 0.02 + kneel * (i === 0 ? 0 : 0.035) + jp.lift * jump
      const footPitch = THREE.MathUtils.lerp(this.foot.pitch * w, i === 0 ? 0 : 1.15, kneel) + jp.pitch * jump
      const footTime = jump > 0.1 ? TIMING.jump : TIMING.foot
      const z = limb.footZ.to(fz, footTime, dt)
      const y = limb.footY.to(fy, footTime, dt)
      limb.pitch = limb.footPitch.to(footPitch, footTime, dt)
      const ground = (i === 0 ? input.groundLeft : input.groundRight) * (1 - air)
      limb.target.set(limb.foot.restModelPos.x * (1 + st * 0.3), limb.foot.restModelPos.y + y + ground + input.slope * z * (1 - air), limb.foot.restModelPos.z + z)
      const planted = this.foot.stance ? 1 : Math.max(0, 1 - this.foot.t * 3)
      limb.toeOff = Math.max(0, limb.pitch) * planted * w * (1 - air) + kneel * (i === 1 ? 1 : 0)
      // Feet separate sideways for the frog kick. solveLeg adds the vertical
      // and forward/backward offsets relative to the actual posed hip joint.
      const tread = Math.sin((this.treadPhase + i * 0.5) * Math.PI * 2)
      limb.target.x = THREE.MathUtils.lerp(limb.target.x, s * (0.11 + 0.17 * frog * travel), swimFeet)
      // Y/Z swimming offsets are evaluated in solveLeg after pelvis FK.
      const stirrup = i === 0 ? input.rideFootL : input.rideFootR
      if (ride > 0.001 && stirrup) {
        limb.target.lerp(stirrup, ride)
        // heels down, toes a little up in the irons
        limb.pitch = THREE.MathUtils.lerp(limb.pitch, -0.28, ride)
        limb.toeOff *= 1 - ride
      }
      this.rideNow = ride
      if (solve) this.solveLeg(limb, i, input, air, swimFeet, travel, tread, frog, kick)
    }

    // Retain the last palm target during release. A disappearing target must
    // not bypass the exit envelope and instantly drop the entire right arm.
    if (input.handTarget) {
      if (!this.hasReachTarget) {
        this.reachX.value = input.handTarget.x
        this.reachY.value = input.handTarget.y
        this.reachZ.value = input.handTarget.z
        this.hasReachTarget = true
      }
      this.reachTarget.set(this.reachX.to(input.handTarget.x, 0.09, dt), this.reachY.to(input.handTarget.y, 0.09, dt), this.reachZ.to(input.handTarget.z, 0.09, dt))
      const dir = input.handStrokeDir ?? FORWARD
      const want = Math.atan2(dir.x, dir.z)
      const delta = Math.atan2(Math.sin(want - this.strokeYaw.value), Math.cos(want - this.strokeYaw.value))
      const yaw = this.strokeYaw.to(this.strokeYaw.value + delta, 0.22, dt)
      this.strokeDir.set(Math.sin(yaw), 0, Math.cos(yaw))
    }
    // A palm-up/down IK pose can differ by nearly pi at the wrist. Give its
    // release the longer human exit budget rather than dropping it in a beat.
    const reach = this.reach.weight(input.handTarget ? input.handReach ?? 0 : 0, 0.42, 0.50, dt) * land
    if (solve && this.hasReachTarget && reach > 0.0001) this.reachRight(this.reachTarget, this.strokeDir, reach)
    if (reach < 0.0001 && !input.handTarget) this.hasReachTarget = false

    // Free hand goals for shared actions. Like the cat reach, a goal that
    // disappears keeps its last target while the envelope fades out.
    for (let i = 0; i < 2; i++) {
      const goal = i === 0 ? input.reachL : input.reachR
      const f = this.free[i]
      if (goal) {
        if (!f.has) { f.x.value = goal.target.x; f.y.value = goal.target.y; f.z.value = goal.target.z; f.has = true }
        // holding on: the hands come in toward the chest and forward, down onto the mane
        const gk = clamp(input.rideGrip ?? 0, 0, 1) * ride
        f.target.set(f.x.to(goal.target.x * (1 - 0.25 * gk), 0.08, dt), f.y.to(goal.target.y - 0.08 * gk, 0.08, dt), f.z.to(goal.target.z + 0.14 * gk, 0.08, dt))
        f.fingers.lerp(goal.fingers, 1 - Math.exp(-dt * 14)).normalize()
        f.palm.lerp(goal.palm, 1 - Math.exp(-dt * 14)).normalize()
        f.grip = damp(f.grip, goal.grip, 10, dt)
      }
      const fw = f.weight.weight(goal ? goal.weight : 0, 0.32, 0.4, dt) * land
      if (fw < 0.0001 && !goal) f.has = false
      if (f.has && fw > 0.0001) {
        const limb = this.limbs[i]
        lerpHand(limb.handPose, HAND.open, fw * (1 - f.grip))
        lerpHand(limb.handPose, HAND.loose, fw * f.grip)
        this.poseHand(limb.side, limb.handPose)
        if (solve) this.reachArm(i as 0 | 1, f.target, f.fingers, f.palm, fw)
      }
    }

    // Cloth uses the original underdamped coefficients, with <=1/240 s steps.
    const capeTarget = -(Math.min(8, speedFollow) * 0.045 + run * w * 0.12) - Math.max(0, input.forwardAccel) * 0.01 * motion + Math.sin(time * 2.1) * 0.02 * input.wind + air * 0.15
    const cape = stepDrapeSpring(this.cape, capeTarget, 60, 9, dt)
    this.euler("cape", cape, 0, bank * 0.4, 0.03)
    const cape2 = stepDrapeSpring(this.cape2, cape * 0.6 + Math.sin(time * 2.7 + 1) * 0.015 * input.wind + kneel * 0.2, 40, 6, dt)
    this.euler("cape2", cape2 - cape * 0.25, 0, bank * 0.2, 0.03)

    // The atlas intentionally has discrete cells; body weights above ease the
    // action before its expression changes. Blush alone is a first-order fade.
    this.blinkTimer -= dt
    if (this.blinkTimer <= 0) {
      this.blinkTimer = 2.2 + ((time * 13.7) % 1) * 3.4
      this.blink = 0.16
    }
    this.blink = Math.max(0, this.blink - dt)
    let eyes = 0
    let mouth = run * w > 0.25 ? 9 : 8
    if (input.idleTime > 6 && Math.floor(time / 7) % 3 === 2) mouth = 11
    if (headYaw > 0.35) eyes = 6
    else if (headYaw < -0.35) eyes = 7
    if (petting > 0.3) { eyes = 3; mouth = 9 }
    if (cel > 0.05) { eyes = cel > 0.35 ? 4 : 3; mouth = 13 }
    if (st > 0.4) { eyes = 0; mouth = jab + cross > 0.4 ? 14 : 11 }
    if (air > 0.4) mouth = 10
    if (wish > 0.4) { eyes = 2; mouth = 11 }
    if (paint > 0.4) mouth = 11
    if (sit > 0.5 && this.blink === 0) eyes = Math.floor(time / 5) % 3 === 0 ? 3 : eyes
    if (smile > 0.3) { mouth = 9; if (eyes === 0 && smile > 0.7) eyes = 3 }
    if (dance > 0.3) { mouth = 13; eyes = Math.floor(time / 3) % 2 === 0 ? 3 : eyes }
    if (love > 0.3) { eyes = 3; mouth = 13 }
    if (call > 0.3) mouth = Math.floor(time * 7.5) % 2 === 0 ? 10 : 8
    if (whistleLips > 0.3) mouth = 10
    if (whistleWave > 0.4) { mouth = 13; eyes = 0 }
    // riding fast: a smile that opens into a grin, eyes narrowed into the wind; a launch's first breath is wonder
    const thrill = (input.rideThrill ?? 0) * ride
    if (thrill > 0.25) { mouth = thrill > 0.6 ? 13 : 9; if (thrill > 0.6 && eyes === 0) eyes = 3 }
    if ((input.rideWonder ?? 0) * ride > 0.45) { eyes = 5; mouth = 9 }
    if (fear > 0.15) { eyes = 5; mouth = 10 }
    if (this.blink > 0 && eyes !== 3 && eyes !== 4) {
      const progress = 1 - this.blink / 0.16
      eyes = progress < 0.3 || progress > 0.75 ? 1 : 2
    }
    this.face.uEyes.value = eyes
    this.face.uMouth.value = mouth
    this.face.uBlush.value = damp(this.face.uBlush.value, petting * 0.8 + cel + run * w * 0.3 + smile * 0.35 + love * 0.9 + dance * 0.3, 3, dt)
  }

  /** Analytic IK is evaluated once per rendered frame, after pose substeps. */
  private solveLeg(limb: LimbRig, index: number, input: HumanPoseInput, air: number, swim: number, travel: number, tread: number, frog: number, kick: number): void {
    const hipsQ = this.accumulated(this.hips, _hipsQ)
    const hipsHead = _hipsHead.copy(this.hips.restModelPos).add(_v3.copy(this.hips.bone.position).sub(this.hips.restP).applyQuaternion(this.hips.parentRestModelQ))
    const hip = _joint.copy(limb.thigh.restModelPos).sub(this.hips.restModelPos).applyQuaternion(hipsQ).add(hipsHead)
    const target = limb.target
    const swimY = hip.y + THREE.MathUtils.lerp(-0.40 + 0.10 * tread, -0.19 + 0.11 * frog, travel)
    const swimZ = hip.z + THREE.MathUtils.lerp(0.045 * Math.cos((this.treadPhase + index * 0.5) * Math.PI * 2), -0.46 + 0.23 * frog - 0.055 * kick, travel)
    target.y = THREE.MathUtils.lerp(target.y, swimY, swim)
    target.z = THREE.MathUtils.lerp(target.z, swimZ, swim)
    const L1 = limb.thighLen
    const L2 = limb.shinLen
    const u = _direction.copy(target).sub(hip)
    const dist = clamp(u.length(), 0.05, L1 + L2 - 0.002)
    if (u.lengthSq() < 1e-8) u.copy(DOWN)
    else u.normalize()
    const pole = _pole.copy(FORWARD).applyQuaternion(hipsQ)
    pole.x += limb.sign * (0.08 + swim * travel * frog * 0.9 + this.rideNow * 0.85)
    const wv = perpendicular(pole, u)
    const a = Math.acos(clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1))
    const thighDir = _upperDir.copy(u).multiplyScalar(Math.cos(a)).addScaledVector(wv, Math.sin(a))
    const knee = _elbow.copy(hip).addScaledVector(thighDir, L1)
    const shinDir = _lowerDir.copy(hip).addScaledVector(u, dist).sub(knee).normalize()
    const Mthigh = frameRotation(limb.restThighDir, FORWARD, thighDir, wv, _model1)
    const Mshin = frameRotation(limb.restShinDir, FORWARD, shinDir, wv, _model2)
    limb.thigh.delta.copy(_deltaQ.copy(hipsQ).invert().multiply(Mthigh))
    limb.shin.delta.copy(_deltaQ.copy(Mthigh).invert().multiply(Mshin))
    const slopePitch = -input.slope * 0.6 * (1 - this.move.value * 0.5) * (1 - air) * (1 - swim)
    const swimFoot = THREE.MathUtils.lerp(0.10 + tread * 0.15, 0.85 - frog * 0.65, travel)
    _e.set(THREE.MathUtils.lerp(limb.pitch + slopePitch, swimFoot, swim), limb.sign * frog * travel * swim * 0.35, 0, "YXZ")
    const Mfoot = _modelHand.setFromEuler(_e)
    limb.foot.delta.copy(_deltaQ.copy(Mshin).invert().multiply(Mfoot))
    if (limb.toe) {
      _e.set(-input.slope * 0.6 * (1 - air) * (1 - swim), 0, 0, "YXZ")
      const flat = _q2.setFromEuler(_e)
      const toeQ = _deltaQ.copy(Mfoot).invert().multiply(flat)
      limb.toe.delta.identity().slerp(toeQ, Math.min(1, limb.toeOff * 2.4) * (1 - swim))
    }
  }
}
