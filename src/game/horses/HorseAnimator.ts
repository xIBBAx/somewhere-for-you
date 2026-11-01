import * as THREE from "three"
import { RigPoser, type LegSpec } from "../rig/RigPoser"
import type { HorseModel } from "./horseAssets"
import { WingAnimator, makeWingPose, type WingPose } from "../pegasus/WingAnimator"

/**
 * Biomechanical horse animation on the equine rig (scapula, humerus, radius,
 * cannon, pastern, hoof; femur, tibia, cannon, pastern, hoof; spine, neck,
 * head, ears, jaw and a six-bone tail).
 *
 * Gaits follow the measured footfall patterns:
 *   walk    4-beat lateral sequence LH, LF, RH, RF, duty ~0.64, head nods twice per stride
 *   trot    2-beat diagonal pairs, duty ~0.42, short suspension, head steady
 *   canter  3-beat: outside hind, inside hind + outside fore together, leading fore, then suspension
 *   gallop  4-beat transverse: the canter's diagonal pair splits, one gathered suspension
 * Stride phase advances with time at a gait-specific stride frequency while
 * each stance sweeps the hoof back by exactly the distance the body travels,
 * so planted hooves do not slide. Neighbouring gaits blend through their
 * footfall offsets, duty factors and body motion, so transitions take a
 * fraction of a stride instead of popping.
 *
 * Each leg is solved distal-first: the hoof is placed on the terrain, the
 * pastern and cannon take orientations from the stride (fetlock sinking under
 * load, the carpus folding the forefoot up behind in the swing, the hock
 * flexing the hind cannon forward under the belly), and an analytic two-bone
 * IK then places the elbow (bending back) and the stifle (bending forward).
 */

export type HorsePose = {
  dt: number
  time: number
  /** forward speed (m/s, signed: negative backs up) and yaw rate (rad/s, + turns left) */
  speed: number
  turnRate: number
  /** forward acceleration (m/s²) for the head/neck and rider */
  accel: number
  /** gait speeds of this horse (walk, trot, canter, gallop) */
  speeds: [number, number, number, number]
  /** ground height under a model-space point, relative to the root (m) */
  ground: (x: number, z: number) => number
  /** full IK and secondary motion (near); false = cheap far tier */
  detail: boolean

  // behaviour layers, 0..1 unless noted
  graze: number
  drink: number
  alert: number
  /** resting a hind leg (−1 right, +1 left, 0 none) */
  restLeg: number
  /** 0 standing … 1 lying on the chest; `lieSide` rolls onto the side */
  lie: number
  lieSide: number
  /** 0..1 progress of the rising sequence when getting up (forelegs first) */
  rising: number
  /** head target in model space (yaw, pitch rad) and how much to follow it */
  lookYaw: number
  lookPitch: number
  look: number
  /** one-shot gestures: progress 0..1 while playing, −1 when idle */
  headShake: number
  paw: number
  snort: number
  shake: number
  swish: number
  /** ears: −1 back … +1 forward; `earSplit` sends one back to the rider */
  ears: number
  earSplit: number
  /** 0..1 exertion: breathing rate and depth, nostril work */
  exertion: number
  /** weight of a rider in the saddle 0..1 (back lowered slightly, head carriage) */
  ridden: number
  /** collected (rider asks for contact) 0..1: neck rounds, head nearer vertical */
  collect: number
  /** lead for canter/gallop: +1 left lead, −1 right lead */
  lead: number
  /** water depth at the legs (m): high stepping, slower */
  wade: number
  /** 0..1 out of its depth and swimming: legs paddle, head held high */
  swim?: number
  /** jump progress 0..1 (−1 on the ground); the root carries the arc */
  jump: number
  /** how high the root is carried above the ground by the jump (m, model scale) */
  air: number
  /** winged horses: 0 on the ground … 1 flying (legs tucked, body free of the terrain) */
  fly: number
  /** 0..1 legs reaching down and forward for a landing */
  legReach: number
  /** body pitch in flight (rad, nose up +): the neck levels the head against it */
  flyPitch: number
  /** Decaying touchdown load, independent of the airborne/ground pose blend. */
  contact: number
  /** Wing-assisted approach braking, 0..1. */
  landingBrake: number
  /** the wings (winged horses only) */
  wing: WingPose
}

export const makeHorsePose = (): HorsePose => ({
  dt: 1 / 60, time: 0, speed: 0, turnRate: 0, accel: 0, speeds: [1.7, 3.8, 6.8, 13], ground: () => 0, detail: true,
  graze: 0, drink: 0, alert: 0, restLeg: 0, lie: 0, lieSide: 0, rising: 0, lookYaw: 0, lookPitch: 0, look: 0,
  headShake: -1, paw: -1, snort: -1, shake: -1, swish: -1, ears: 0.3, earSplit: 0, exertion: 0, ridden: 0, collect: 0,
  lead: 1, wade: 0, jump: -1, air: 0, fly: 0, legReach: 0, flyPitch: 0, contact: 0, landingBrake: 0, wing: makeWingPose(),
})

type LegId = 0 | 1 | 2 | 3 // FL, FR, HL, HR
type Leg = {
  id: LegId
  front: boolean
  side: number // +1 left
  top: string // scapula (front) or femur (hind) parent chain start
  spec: LegSpec // humerus/radius -> cannon (front) or femur/tibia -> cannon (hind)
  cannon: string
  pastern: string
  hoof: string
  restKnee: THREE.Vector3 // head of the cannon (carpus or hock)
  restFet: THREE.Vector3
  restCoffin: THREE.Vector3
  restToe: THREE.Vector3
  cannonVec: THREE.Vector3 // knee -> fetlock at rest
  pasternVec: THREE.Vector3 // fetlock -> coffin at rest
  hoofVec: THREE.Vector3 // coffin -> toe at rest
  lift: number // smoothed swing lift for audio
  inStance: boolean
}

// Footfall offsets (fraction of a stride at which each hoof strikes), indexed
// FL, FR, HL, HR, and the stance fraction (duty factor) of each gait.
// Canter/gallop are written for the LEFT lead; the right lead mirrors sides.
export const WALK = { off: [0.25, 0.75, 0.0, 0.5], duty: 0.64 }
export const TROT = { off: [0.5, 0.0, 0.0, 0.5], duty: 0.42 }
// left lead canter: RH (beat 1), LH + RF (beat 2), LF (beat 3), suspension
export const CANTER = { off: [0.52, 0.3, 0.28, 0.0], duty: 0.4 }
// left lead transverse gallop: RH, LH, RF, LF, gathered suspension
export const GALLOP = { off: [0.52, 0.42, 0.1, 0.0], duty: 0.28 }

const TAU = Math.PI * 2
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
const clamp01 = (v: number): number => clamp(v, 0, 1)
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const damp = (a: number, b: number, k: number, dt: number): number => a + (b - a) * (1 - Math.exp(-k * dt))
const wrap = (x: number): number => x - Math.floor(x)
/** blend two phase offsets on the circle */
const blendOff = (a: number, b: number, t: number): number => {
  let d = b - a
  d -= Math.round(d)
  return wrap(a + d * t)
}

const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _v3 = new THREE.Vector3()
const _q1 = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _q3 = new THREE.Quaternion()
const _knee = new THREE.Vector3()
const _fet = new THREE.Vector3()
const _coffin = new THREE.Vector3()
const _hip = new THREE.Vector3()
const _parentQ = new THREE.Quaternion()
const X_AXIS = new THREE.Vector3(1, 0, 0)

const rotX = (v: THREE.Vector3, a: number, out: THREE.Vector3): THREE.Vector3 => {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return out.set(v.x, v.y * c - v.z * s, v.y * s + v.z * c)
}

/** Simple critically-damped spring for secondary motion. */
class Spring {
  x = 0
  v = 0
  step(target: number, k: number, d: number, dt: number): number {
    const a = (target - this.x) * k - this.v * d
    this.v += a * dt
    this.x += this.v * dt
    return this.x
  }
}

export type FootfallEvent = { leg: LegId; strength: number }

export class HorseAnimator {
  protected poser: RigPoser
  /** the wings of a winged horse, or null */
  readonly wings: WingAnimator | null = null
  private legs: Leg[] = []
  private tails: string[] = []
  private phase = 0
  /** gait weights walk, trot, canter, gallop (smoothed) */
  gaitW: [number, number, number, number] = [1, 0, 0, 0]
  private moveW = 0
  private freq = 0.9
  private hipsY: number
  private H: number
  private chewT = 0
  private breath = 0
  private earL = new Spring()
  private earR = new Spring()
  private earTimer = 1
  private earFlickSide = 1
  private earFlick = 0
  private tailS: Spring[] = []
  private tailYawS: Spring[] = []
  private tailFlutter = 0
  private leadS = 1
  private headPitchS = new Spring()
  private bodyPitchS = 0
  private bodyRollS = 0
  private bodyYS = 0
  private restSide = 0
  private random: () => number
  /** footfalls this frame (for hoofbeat audio and dust) */
  readonly footfalls: FootfallEvent[] = []
  /** model-space posed seat and bit rings, updated each frame */
  readonly seat = new THREE.Vector3()
  /** the rear seat of a tandem saddle (zero when there is none) */
  readonly seat2 = new THREE.Vector3()
  readonly seatQ = new THREE.Quaternion()
  readonly bitL = new THREE.Vector3()
  readonly bitR = new THREE.Vector3()
  readonly reinRest = new THREE.Vector3()
  readonly headPos = new THREE.Vector3()
  /** QA: per-leg targets of the last update */
  readonly dbg: Array<Record<string, number | boolean>> = [0, 1, 2, 3].map(() => ({ stance: false, u: 0, dz: 0, cz: 0, cy: 0, aCannon: 0 }))
  /** QA: freeze at a gait (0 walk … 3 gallop) and stride phase */
  debug: { gait: number; phase: number } | null = null
  /** gait the horse is in (dominant weight) */
  gait: 0 | 1 | 2 | 3 = 0
  /** 0..1 stride phase, for the rider's posting and seat motion */
  get stride(): number { return this.phase }

  constructor(model: HorseModel, seed = 1) {
    let s = (seed % 2147483646) + 1
    this.random = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    this.phase = this.random()
    this.poser = new RigPoser(model.root, model.bones)
    this.H = model.meta.height
    const P = this.poser
    const ids: Array<[LegId, boolean, number, string]> = [[0, true, 1, "L"], [1, true, -1, "R"], [2, false, 1, "L"], [3, false, -1, "R"]]
    for (const [id, front, side, s] of ids) {
      const top = front ? `scapula${s}` : `femur${s}`
      const upper = front ? `humerus${s}` : `femur${s}`
      const lower = front ? `radius${s}` : `tibia${s}`
      const cannon = front ? `cannonF${s}` : `cannonB${s}`
      const pastern = front ? `pasternF${s}` : `pasternB${s}`
      const hoof = front ? `hoofF${s}` : `hoofB${s}`
      if (!P.has(cannon)) continue
      const restKnee = P.pos(cannon).clone()
      const restFet = P.pos(pastern).clone()
      const restCoffin = P.pos(hoof).clone()
      const toe = model.meta.hooves[`hoof${front ? "F" : "B"}${s}` as "hoofFL"]
      const restToe = new THREE.Vector3(toe[0], toe[1], toe[2])
      this.legs.push({
        id, front, side, top, spec: P.leg(upper, lower, cannon), cannon, pastern, hoof,
        restKnee, restFet, restCoffin, restToe,
        cannonVec: restFet.clone().sub(restKnee), pasternVec: restCoffin.clone().sub(restFet), hoofVec: restToe.clone().sub(restCoffin),
        lift: 0, inStance: true,
      })
    }
    for (let i = 1; P.has(`tail${i}`); i++) {
      this.tails.push(`tail${i}`)
      this.tailS.push(new Spring())
      this.tailYawS.push(new Spring())
    }
    this.hipsY = P.pos("hips").y
    const wingMeta = model.meta.wing
    if (wingMeta && WingAnimator.has(P)) this.wings = new WingAnimator(P, wingMeta.groups ?? {}, wingMeta.kind, this.random)
  }

  /** model-space rest positions for placing tack anchors */
  restPos(name: string): THREE.Vector3 { return this.poser.pos(name) }

  update(a: HorsePose, out?: { seatRest: THREE.Vector3; bitLRest: THREE.Vector3; bitRRest: THREE.Vector3; reinRestRest: THREE.Vector3; seat2Rest?: THREE.Vector3 }): void {
    const dt = Math.min(a.dt, 0.1)
    const P = this.poser
    const H = this.H
    const t = a.time
    P.reset()
    this.footfalls.length = 0

    // ---- gait selection ----------------------------------------------------
    const v = Math.abs(a.speed)
    const sp = a.speeds
    const lie = clamp01(a.lie)
    const standing = 1 - lie
    const fly = clamp01(a.fly)
    // Prepare actual speed-matched strides during the final approach, rather
    // than beginning a walk cycle only after the flight flag changes.
    const clearance = Math.max(0, -(a.ground(0, 0) + a.air))
    const runIn = clamp01(a.legReach) * clamp01(1 - clearance / 2)
    // A travel arrival can move the root far from the old terrain while
    // `fly` is still blending up. Only anatomically reachable support may
    // influence the pose; distant floors must not translate the torso or
    // stretch partially blended hoof targets kilometres away. Remove the
    // root's jump arc before judging support, then retain it for jump IK.
    const ground = (x: number, z: number): number => {
      const offset = a.ground(x, z) + a.air
      if (!Number.isFinite(offset)) return -a.air
      const support = 1 - smooth(H * 0.35, H * 0.9, Math.abs(offset))
      return offset * support - a.air
    }
    // Turning is movement too: a horse asked to turn where it stands walks
    // round its hindquarters (the forehand travels about a metre for every
    // radian), so its legs step through the turn instead of the body spinning
    // on still hooves. The planted hooves pivot with the body (turnX below).
    const pivot = Math.abs(a.turnRate) * 1.1 * Math.sqrt(H / 1.6)
    const vStep = Math.max(v, pivot)
    const moving = vStep > 0.08 && lie < 0.05 && (fly < 0.5 || runIn > 0.65)
    this.moveW = damp(this.moveW, moving ? 1 : 0, moving ? 6 : fly > 0.5 ? 8 : 4, dt)
    let w = this.moveW
    // thresholds midway between gait speeds, with hysteresis
    const g = this.gait
    const up = [0, (sp[0] + sp[1]) * 0.5 * 1.04, (sp[1] + sp[2]) * 0.5 * 1.04, (sp[2] + sp[3]) * 0.5 * 1.03]
    const down = [0, (sp[0] + sp[1]) * 0.5 * 0.92, (sp[1] + sp[2]) * 0.5 * 0.92, (sp[2] + sp[3]) * 0.5 * 0.94]
    let target = g as number
    while (target < 3 && v > up[target + 1]) target++
    while (target > 0 && v < down[target]) target--
    // a backing horse only ever walks (rein-back is a 2-beat diagonal walk)
    if (a.speed < 0) target = 0
    this.gait = target as 0 | 1 | 2 | 3
    const gw = this.gaitW
    for (let i = 0; i < 4; i++) gw[i] = damp(gw[i], i === target ? 1 : 0, 7, dt)
    const sum = gw[0] + gw[1] + gw[2] + gw[3]
    for (let i = 0; i < 4; i++) gw[i] /= sum
    // flying lead change only during the suspension of the stride
    if (Math.sign(a.lead) !== Math.sign(this.leadS) && (this.phase > 0.85 || gw[2] + gw[3] < 0.2)) this.leadS = Math.sign(a.lead) || 1

    // stride frequency: real horses change frequency little within a gait and
    // lengthen the stride instead; bigger horses stride a little slower
    const sizeK = Math.sqrt(1.6 / H)
    const fGait = [0.92, 1.42, 1.72, 2.3]
    let f = 0
    for (let i = 0; i < 4; i++) f += gw[i] * fGait[i] * Math.pow(Math.max(0.2, vStep) / Math.max(0.2, sp[i]), 0.3)
    f *= sizeK
    this.freq = damp(this.freq, Math.max(0.55, f), 5, dt)
    this.phase = wrap(this.phase + this.freq * dt * w)
    if (this.debug) {
      for (let i = 0; i < 4; i++) gw[i] = i === this.debug.gait ? 1 : 0
      this.phase = this.debug.phase
      this.moveW = 1
      this.gait = this.debug.gait as 0 | 1 | 2 | 3
      this.freq = fGait[this.debug.gait] * sizeK
      w = 1
    }
    const strideLen = v / Math.max(0.3, this.freq)

    // blended footfall offsets and duty factor
    const lead = this.leadS
    const duty = gw[0] * WALK.duty + gw[1] * TROT.duty + gw[2] * CANTER.duty + gw[3] * GALLOP.duty
    const fast = gw[2] + gw[3]
    const gallop = gw[3]
    const trot = gw[1]
    const canter = gw[2]
    const walk = gw[0]

    // ---- body: height, pitch, roll, bob ------------------------------------
    // ground under the fore and hind feet gives the slope pitch and roll
    const zf = this.legs[0]?.restCoffin.z ?? 0.6
    const zh = this.legs[2]?.restCoffin.z ?? -0.6
    const xs = this.legs[0]?.restCoffin.x ?? 0.17
    // the body follows the terrain, not the jump arc the root already carries
    const gFL = ground(xs, zf) + a.air
    const gFR = ground(-xs, zf) + a.air
    const gHL = ground(xs, zh) + a.air
    const gHR = ground(-xs, zh) + a.air
    const gFront = (gFL + gFR) * 0.5
    const gBack = (gHL + gHR) * 0.5
    const grounded = standing * (1 - fly)
    const slopePitch = Math.atan2(gFront - gBack, zf - zh) * grounded
    const slopeRoll = Math.atan2(((gFL + gHL) - (gFR + gHR)) * 0.5, xs * 2) * 0.35 * grounded
    const ph = this.phase * TAU
    // vertical motion per gait: walk ~1.5 cm twice a stride, trot ~4 cm twice
    // (low at diagonal mid-stance), canter rocks once, gallop rises in suspension
    let bob = walk * Math.cos(ph * 2) * 0.008 + trot * Math.cos(ph * 2) * 0.026 * (H / 1.6)
    bob += canter * Math.sin(ph - 0.6) * 0.03 + gallop * Math.sin(ph - 1.2) * 0.045
    bob *= w
    let pitch = canter * Math.sin(ph + 0.4) * 0.05 + gallop * Math.sin(ph + 0.9) * 0.07
    pitch = pitch * w
    const roll = walk * Math.sin(ph) * 0.02 * w - a.turnRate * clamp(v, 0, 14) * 0.006
    // resting a hind leg drops that hip
    this.restSide = damp(this.restSide, a.restLeg * (1 - w) * standing, 2.5, dt)
    const restRoll = -this.restSide * 0.045
    // lying down: the body sinks to rest on the sternum and folded legs
    const lieDrop = this.hipsY - 0.29 * H
    const sinkFront = clamp01(lie * 1.6) // forehand kneels first going down
    const sinkHind = clamp01(lie * 1.6 - 0.6)
    const rise = a.rising // forelegs extend first getting up
    const frontDown = sinkFront * (1 - smooth(0.0, 0.45, rise))
    const hindDown = sinkHind * (1 - smooth(0.4, 1.0, rise))
    const bodyDrop = (frontDown * 0.55 + hindDown * 0.45) * lieDrop
    const liePitch = (frontDown - hindDown) * 0.28
    const sideRoll = a.lieSide * lie * 1.25
    // a rider's weight lowers the back a touch
    this.bodyYS = damp(this.bodyYS, (gBack + (gFront - gBack) * 0.35) * (1 - fly), 12, dt)
    this.bodyPitchS = damp(this.bodyPitchS, slopePitch * 0.9 - liePitch, 8, dt)
    this.bodyRollS = damp(this.bodyRollS, slopeRoll + roll + restRoll + sideRoll, 6, dt)
    const breatheRate = 0.22 + a.exertion * 0.9
    this.breath += dt * breatheRate * TAU
    const breathe = Math.sin(this.breath) * (0.004 + a.exertion * 0.008)
    // jumping: the forehand rises at take-off, the back arcs over the fence
    // (bascule) and the horse comes down nose-first onto its forelegs
    const jt = a.jump
    const jw = jt >= 0 ? 1 : 0
    const takeoff = jw * smooth(0, 0.07, jt) * (1 - smooth(0.16, 0.42, jt))
    const descend = jw * smooth(0.45, 0.8, jt) * (1 - smooth(0.88, 1, jt))
    const jumpPitch = -0.34 * takeoff + 0.2 * descend
    const crouch = jw * (1 - smooth(0, 0.06, jt)) * 0.05 + jw * smooth(0.86, 0.92, jt) * (1 - smooth(0.92, 1, jt)) * 0.05
    // in flight the body heaves up a little on each downstroke
    const wp = a.wing
    const heave = fly * wp.power * (1 - wp.glide) * Math.sin(TAU * (wp.flap - 0.12)) * 0.035 * (H / 1.6)
    // The established IK still places each hoof; the barrel absorbs only a
    // few centimetres of load so the saddle, reins and both riders follow it.
    const contact = clamp01(a.contact)
    P.offset("hips", 0, this.bodyYS + bob - bodyDrop - a.ridden * 0.008 + breathe * 0.3 - crouch + heave - contact * H * 0.035, 0)
    P.euler("hips", -this.bodyPitchS - pitch + jumpPitch + contact * 0.035, 0, this.bodyRollS)
    // spine: flexion/extension at the gallop, slight sag under a rider, lateral bend in turns
    const flex = gallop * Math.sin(ph - 0.3) * w
    const bend = clamp(a.turnRate * 0.06, -0.12, 0.12)
    P.euler("spine1", flex * 0.06 + a.ridden * 0.01, bend * 0.5, 0)
    P.euler("spine2", -flex * 0.04, bend * 0.6, 0)
    P.euler("chest", -flex * 0.05 + pitch * 0.4, bend * 0.6, 0)
    // breathing widens the barrel
    const rib = 1 + breathe * 2.2
    P.scale("spine2", rib, 1, 1)

    // ---- neck and head -----------------------------------------------------
    // head nod: twice per walk stride (down as each forefoot lands), steady
    // at the trot, once per stride at canter/gallop (lowest as the leading
    // fore strikes)
    const nodWalk = Math.sin(ph * 2 - 0.4) * 0.06 * walk
    const nodFast = Math.sin(ph - 1.0) * (0.07 * canter + 0.11 * gallop)
    const nod = (nodWalk + nodFast) * w
    // carriage: neck lowers and stretches as speed rises; alert raises it;
    // grazing drops the muzzle to the grass; collection rounds the neck
    const graze = clamp01(a.graze + a.drink)
    const lowNeck = gallop * 0.32 + canter * 0.14 + trot * 0.06
    const flightNeck = jt >= 0 ? smooth(0.2, 0.5, jt) * (1 - smooth(0.85, 1, jt)) : 0
    // flying: the neck stretches forward and the head is kept level against
    // the body's climb or dive
    const flyNeck = fly * (0.12 - a.flyPitch * 0.55 + a.legReach * -0.12)
    // each downstroke heaves the body up; the neck gives the other way so the
    // head rides steady, as a bird's does (the spring below adds the lag)
    const beat = Math.sin(TAU * (wp.flap - 0.12))
    const flyBeat = fly * wp.power * (1 - wp.glide) * beat
    // swimming: the head is carried high, the muzzle pushed out level with the
    // surface so the nostrils stay clear, the neck stretched forward
    const swimHead = a.swim ?? 0
    const neckPitch = -swimHead * 0.42 + (flyNeck + lowNeck * w + flightNeck * 0.2 - takeoff * 0.15 - a.alert * 0.32 + graze * 0.95 + frontDown * 0.35 - smooth(0, 0.35, rise) * smooth(0.6, 0.35, rise) * 0.5 + lie * 0.05)
    const headPitchExtra = -swimHead * 0.3 + graze * 0.55 - a.alert * 0.15 + a.collect * 0.28 + lie * a.lieSide * 0.4
    // look target, limited by anatomy
    const lookYaw = clamp(a.lookYaw, -1.3, 1.3) * a.look * (1 - graze * 0.5)
    const lookPitch = clamp(a.lookPitch, -0.6, 0.8) * a.look
    const turnLook = clamp(a.turnRate * 0.18, -0.35, 0.35)
    // shake / toss / snort gestures
    const shake = a.headShake >= 0 ? Math.sin(a.headShake * TAU * 4) * Math.sin(a.headShake * Math.PI) : 0
    const toss = a.snort >= 0 ? Math.sin(a.snort * Math.PI) : 0
    const bodyShake = a.shake >= 0 ? Math.sin(a.shake * TAU * 6) * Math.sin(a.shake * Math.PI) : 0
    const hp = this.headPitchS.step(neckPitch + nod * 0.5 - toss * 0.25 + flyBeat * 0.09, 60, 14, dt)
    P.euler("neck1", hp * 0.45 + lookPitch * 0.2, (lookYaw + turnLook) * 0.25 + bodyShake * 0.08, bodyShake * 0.1)
    P.euler("neck2", hp * 0.3 + nod * 0.4 + lookPitch * 0.3, (lookYaw + turnLook) * 0.35 + shake * 0.1, shake * 0.2)
    P.euler("neck3", hp * 0.25 + nod * 0.3 - a.collect * 0.1, (lookYaw + turnLook) * 0.25 + shake * 0.15, shake * 0.3)
    P.euler("head", headPitchExtra + lookPitch * 0.5 + nod * 0.4 + toss * 0.35, lookYaw * 0.15 + shake * 0.2, shake * 0.4)
    // chewing grass: jaw grinds sideways while grazing
    this.chewT += dt * (graze > 0.5 ? 5.5 : 0)
    P.euler("jaw", graze * (0.04 + 0.04 * Math.max(0, Math.sin(this.chewT))) + toss * 0.08, graze * Math.sin(this.chewT) * 0.04, 0)

    // ---- ears ------------------------------------------------------------------
    this.earTimer -= dt
    if (this.earTimer <= 0) {
      this.earTimer = 1.2 + this.random() * 4
      this.earFlick = 1
      this.earFlickSide = this.random() < 0.5 ? 1 : -1
    }
    this.earFlick = Math.max(0, this.earFlick - dt * 4)
    const flick = Math.sin(this.earFlick * Math.PI) * 0.5
    // + forward, - back; relaxed ears hang sideways when grazing or dozing
    const ears = clamp(a.ears + a.alert * 0.6 - lie * 0.4 - graze * 0.25 + gallop * -0.3, -1, 1)
    const eL = this.earL.step(ears + (this.earFlickSide > 0 ? -flick : 0) - (a.earSplit > 0 ? a.earSplit * 1.1 : 0), 120, 18, dt)
    const eR = this.earR.step(ears + (this.earFlickSide < 0 ? -flick : 0) - (a.earSplit < 0 ? -a.earSplit * 1.1 : 0), 120, 18, dt)
    // pitch tips the ear forward/back; roll turns the opening out when relaxed
    P.euler("earL", eL * 0.45, -eL * 0.35 + lookYaw * 0.25, -Math.max(0, -ears) * 0.5 - 0.05)
    P.euler("earR", eR * 0.45, eR * 0.35 + lookYaw * 0.25, Math.max(0, -ears) * 0.5 + 0.05)

    // ---- legs ------------------------------------------------------------------
    for (const leg of this.legs) {
      const i = leg.id
      // mirror the lead: right-lead canter/gallop swaps left and right offsets
      const mi = lead > 0 ? i : ((i ^ 1) as LegId)
      const offWalk = WALK.off[i]
      const offTrot = TROT.off[i]
      const offCanter = CANTER.off[mi]
      const offGallop = GALLOP.off[mi]
      let off = offWalk
      off = blendOff(off, offTrot, trot / Math.max(1e-3, walk + trot))
      off = blendOff(off, offCanter, canter / Math.max(1e-3, walk + trot + canter))
      off = blendOff(off, offGallop, gallop)
      // rein-back: diagonal pairs, reversed travel
      const lp = wrap(this.phase - off)
      const stance = lp < duty
      const u = stance ? lp / duty : (lp - duty) / (1 - duty)
      // footfall event at touchdown
      if (stance && !leg.inStance && w > 0.3 && standing > 0.9 && jt < 0 && fly < 0.1) this.footfalls.push({ leg: i, strength: clamp01(v / sp[3]) * 0.7 + 0.3 })
      leg.inStance = stance
      // a hoof cannot be planted further than the limb reaches; past that
      // the stance shortens (real gallops trade contact length for suspension)
      const reach = (leg.front ? 0.95 : 0.8) * H * (0.55 + 0.45 * Math.min(1, v / 6))
      const sweep = Math.min(strideLen * duty, reach) * (a.speed < 0 ? -1 : 1)
      let dz: number
      let lift = 0
      if (stance) {
        dz = (0.5 - u) * sweep
      } else {
        const e = u * u * (3 - 2 * u)
        dz = (-0.5 + e) * sweep
        // hoof clearance: higher at speed and in water, forefeet higher
        const clear = (0.07 + 0.08 * trot + 0.12 * canter + 0.16 * gallop) * (leg.front ? 1.2 : 0.9) + a.wade * 0.15
        lift = Math.sin(Math.PI * Math.pow(u, leg.front ? 0.8 : 1.0)) * clear * Math.min(1, v * 1.5)
      }
      dz *= w
      lift *= w
      leg.lift = lift
      // planted hooves pivot with the body while turning
      const turnX = stance ? a.turnRate * leg.restCoffin.z * (u - 0.5) * (duty / Math.max(0.3, this.freq)) * w : 0
      let cx = leg.restCoffin.x + turnX
      let cz = leg.restCoffin.z + dz
      // grazing stance: one foreleg a stride forward
      if (leg.front && graze > 0) cz += graze * (leg.side > 0 ? 0.16 : -0.04) * H / 1.6
      // pawing: one forefoot scrapes forwards and back
      const pawing = a.paw >= 0 && i === 0 ? Math.sin(a.paw * Math.PI) : 0
      const pawStroke = pawing * Math.max(0, Math.sin(a.paw * TAU * 3))
      cz += pawStroke * 0.12
      lift += pawStroke * 0.08
      const groundY = ground(cx, cz)
      let cy = groundY + (leg.restCoffin.y) + lift
      // resting hind leg: heel up, resting on the toe, slightly forward
      const resting = !leg.front && Math.sign(this.restSide) === leg.side ? Math.abs(this.restSide) : 0
      cz += resting * 0.06
      cy += resting * 0.035
      // --- distal orientation -----------------------------------------------
      // cannon angle (+ swings the bottom back): the carpus folds the forefoot
      // up behind in the swing; the hind cannon swings forward under the body
      // in swing and angles back as the hind leg drives at the end of stance
      let aCannon: number
      let aPastern: number // relative to the cannon (+ flexes, − fetlock sinks)
      let aHoof: number // relative to the pastern
      const speedK = clamp01(v / 4) * w
      // the limb swings like a pendulum about the elbow (fore) or hip (hind):
      // a hoof ahead of its rest point tilts the cannon's bottom forward
      const pivotH = leg.front ? leg.restKnee.y * 1.9 : leg.restKnee.y * 2.6
      const swingA = -Math.atan2(cz - leg.restCoffin.z, pivotH)
      if (leg.front) {
        // carpus folds the foot up behind early in the swing, then the leg reaches
        const fold = (0.75 * walk + 1.3 * trot + 1.55 * canter + 1.75 * gallop) * speedK
        aCannon = stance ? swingA : swingA + Math.sin(Math.PI * Math.min(1, u * 1.3)) * fold
        aPastern = stance ? -(0.2 + 0.25 * fast + 0.15 * trot) * Math.sin(Math.PI * u) * speedK : Math.sin(Math.PI * u) * 0.5 * speedK
      } else {
        // the hock flexes the cannon forward under the belly through the swing
        // and opens as the hind leg drives at the end of the stance
        const tuck = (0.3 * walk + 0.5 * trot + 0.6 * canter + 0.7 * gallop) * speedK
        aCannon = stance ? swingA * 0.9 + 0.12 * u * speedK : swingA * 0.9 - Math.sin(Math.PI * u) * tuck * 0.5
        aPastern = stance ? -(0.18 + 0.22 * fast) * Math.sin(Math.PI * u) * speedK : Math.sin(Math.PI * u) * 0.6 * speedK
      }
      aCannon += resting * 0.18
      aPastern += resting * 0.35
      // breakover: the heel lifts at the end of stance; the hoof lands flat
      aHoof = stance ? smooth(0.82, 1.0, u) * 0.35 * speedK : (1 - u) * 0.4 * speedK
      aHoof += resting * 0.5
      // lying: forelegs fold completely under (carpus flexed), hind legs tucked
      const fold = leg.front ? frontDown : hindDown
      if (fold > 0) {
        cy = THREE.MathUtils.lerp(cy, groundY + 0.03, fold)
        cz += fold * (leg.front ? -0.22 : 0.18) * H / 1.6
        cx += fold * leg.side * (leg.front ? 0.0 : 0.06) + (sideRoll > 0.1 ? fold * a.lieSide * -0.15 : 0)
        aCannon = THREE.MathUtils.lerp(aCannon, leg.front ? 2.5 : -1.0, fold)
        aPastern = THREE.MathUtils.lerp(aPastern, leg.front ? 0.6 : 1.2, fold)
        aHoof = THREE.MathUtils.lerp(aHoof, 0.5, fold)
      }
      // getting up: forelegs straighten out in front first (a brief, dog-like sit)
      if (leg.front && rise > 0) {
        const ext = smooth(0.05, 0.4, rise) * (1 - smooth(0.7, 1.0, rise))
        cz += ext * 0.25
      }
      // swimming: a horse "trots" in the water, diagonal pairs reaching and
      // pulling in long, round strokes well clear of the bed; the knees and
      // hocks fold high under the chest on the recovery
      const sw = a.swim ?? 0
      if (sw > 0.01) {
        const R = leg.restCoffin
        const ph = a.time * TAU * 0.95 + (leg.front === (leg.side > 0) ? 0 : Math.PI)
        const recover = Math.max(0, Math.cos(ph))
        const pz = R.z + Math.sin(ph) * H * (leg.front ? 0.2 : 0.15) + (leg.front ? 0.05 : -0.06) * H
        const py = R.y + H * ((leg.front ? 0.18 : 0.1) + recover * 0.16)
        cz = THREE.MathUtils.lerp(cz, pz, sw)
        cy = THREE.MathUtils.lerp(cy, py, sw)
        aCannon = THREE.MathUtils.lerp(aCannon, leg.front ? 0.5 + recover * 1.1 : -0.2 - recover * 0.5, sw)
        aPastern = THREE.MathUtils.lerp(aPastern, 0.3 + recover * 0.4, sw)
        aHoof = THREE.MathUtils.lerp(aHoof, 0.3, sw)
      }
      let airborneLeg = false
      if (jt >= 0) {
        // jump: legs leave the ground in order (fore first) and land fore first
        const g0 = ground(cx, cz)
        const R = leg.restCoffin
        if (leg.front) {
          const lift = smooth(0.0, 0.07, jt) * (1 - smooth(0.8, 0.9, jt))
          const reachOut = smooth(0.62, 0.84, jt)
          airborneLeg = jt > 0.02 && jt < 0.86
          if (airborneLeg) {
            cz = R.z + 0.08 + reachOut * 0.18 * H / 1.6
            cy = Math.max(g0 + R.y, R.y + lift * 0.42 * H * (1 - reachOut * 0.8))
            aCannon = 2.3 * lift * (1 - reachOut) + leg.side * 0.0
            aPastern = 0.9 * lift * (1 - reachOut)
            aHoof = 0.4 * lift
          } else if (jt >= 0.86) {
            cz = R.z + 0.14 * (1 - smooth(0.86, 1, jt)) * H / 1.6
          }
        } else {
          // hind legs drive off together, trail out behind, then fold under
          airborneLeg = jt > 0.1 && jt < 0.93
          if (jt <= 0.1) {
            cz = R.z - 0.04
            aCannon = 0.35 * smooth(0, 0.1, jt)
            aPastern = -0.3
          } else if (airborneLeg) {
            const v = (jt - 0.1) / 0.83
            const trail = 1 - smooth(0.15, 0.55, v)
            cz = R.z - 0.38 * trail * H / 1.6 + 0.1 * (1 - trail) * H / 1.6
            cy = Math.max(g0 + R.y, R.y + (0.14 + 0.18 * (1 - trail)) * H)
            aCannon = 0.65 * trail - 0.95 * (1 - trail) * (1 - smooth(0.8, 1, v))
            aPastern = 0.7
            aHoof = 0.3
          }
        }
      }
      if (fly > 0) {
        // in flight the forelegs fold up under the chest (carpus flexed, as
        // over a fence) and the hind legs trail out behind; for a landing
        // both reach down and forward to take the ground
        const R = leg.restCoffin
        // A raised nose brings the hindquarters under the body first; a
        // flatter approach extends the forelegs first. Keep the running gait
        // underneath this blend so contact flows straight into a real stride.
        const first = (a.flyPitch > 0.16) !== leg.front
        const reach = clamp01(a.legReach + (first ? 0.06 : -0.04) * a.landingBrake)
        const paddle = Math.sin(TAU * (a.wing.flap + (leg.front ? 0.1 : 0.35) + (leg.side > 0 ? 0 : 0.08))) * (1 - reach) * a.wing.power * 0.02 * H
        let fy: number, fz: number, fc: number, fp: number, fh: number
        if (leg.front) {
          const tuck = 1 - reach * 0.88
          fz = R.z + 0.05 * H + reach * 0.16 * H
          fy = R.y + tuck * 0.36 * H + paddle
          fc = 2.2 * tuck + 0.1
          fp = 0.85 * tuck
          fh = 0.35 * tuck + 0.1
        } else {
          const trail = 1 - reach
          fz = R.z - 0.3 * H * trail + 0.08 * H * reach
          fy = R.y + (0.12 + 0.1 * trail) * H + paddle
          fc = 0.62 * trail - 0.25 * reach
          fp = 0.55 * trail + 0.15
          fh = 0.3
        }
        const legFly = fly * (1 - runIn * (first ? 0.8 : 0.6))
        cx = THREE.MathUtils.lerp(cx, R.x * 0.94, legFly)
        cy = THREE.MathUtils.lerp(cy, fy, legFly)
        cz = THREE.MathUtils.lerp(cz, fz, legFly)
        aCannon = THREE.MathUtils.lerp(aCannon, fc, legFly)
        aPastern = THREE.MathUtils.lerp(aPastern, fp, legFly)
        aHoof = THREE.MathUtils.lerp(aHoof, fh, legFly)
        if (legFly > 0.5) airborneLeg = true
      }
      const slopeA = Math.atan2(ground(cx, cz + 0.1) - ground(cx, cz - 0.1), 0.2)
      // world-aligned hoof orientation: the hoof sole follows the ground
      let accCannon = aCannon
      const accPastern = accCannon + aPastern
      // a planted hoof lies flat on the ground whatever the fetlock does
      const accHoof = stance && fold < 0.5 && !airborneLeg ? aHoof - slopeA : accPastern + aHoof
      _coffin.set(cx, cy, cz)
      Object.assign(this.dbg[i], { stance, u: +u.toFixed(2), dz: +dz.toFixed(2), cz: +cz.toFixed(2), cy: +cy.toFixed(2), aCannon: +accCannon.toFixed(2) })
      if (!a.detail) {
        // far tier: swing the upper limb by the hoof's fore-aft offset only
        const stride = clamp(dz / (0.3 * H), -1.5, 1.5)
        P.euler(leg.spec.upper, (leg.front ? -0.35 : 0.3) * stride, 0, 0)
        P.euler(leg.spec.lower, (leg.front ? 0.25 : -0.4) * stride * 0.5 + (leg.front ? Math.max(0, aCannon) * 0.3 : 0), 0, 0)
        continue
      }
      rotX(leg.pasternVec, accPastern, _v1)
      _fet.copy(_coffin).sub(_v1)
      // scapula rotates about its top with the stride (shoulder freedom)
      if (leg.front) {
        const scap = clamp((leg.restCoffin.z - cz) / (0.6 * H), -0.6, 0.6) * 0.35 - frontDown * 0.15
        P.euler(leg.top, -scap, 0, 0)
      }
      P.accumulated(P.recs.get(leg.spec.upper)!.bone.parent!.name, _parentQ)
      P.posedHead(leg.spec.upper, _hip)
      rotX(leg.cannonVec, accCannon, _v2)
      _knee.copy(_fet).sub(_v2)
      // Keep the carpus/hock within reach of the shoulder/hip: if the upper
      // limb cannot reach it, swing the cannon about the fetlock to the
      // nearest reachable angle (the leg straightens, as it does at the end
      // of a driving stance), instead of letting the IK fall short.
      const reachUL = (leg.spec.len1 + leg.spec.len2) * 0.985
      const Lc = leg.cannonVec.length()
      const dyk = _knee.y - _hip.y
      const dzk = _knee.z - _hip.z
      if (dyk * dyk + dzk * dzk > reachUL * reachUL) {
        const fy = _fet.y - _hip.y
        const fz = _fet.z - _hip.z
        const d = Math.hypot(fy, fz)
        let ky: number
        let kz: number
        if (d >= reachUL + Lc || d < 1e-4) {
          ky = fy - (fy / d) * Lc
          kz = fz - (fz / d) * Lc
        } else {
          // circle (hip, reachUL) meets circle (fetlock, Lc): two candidates
          const a = (reachUL * reachUL - Lc * Lc + d * d) / (2 * d)
          const hh = Math.sqrt(Math.max(0, reachUL * reachUL - a * a))
          const my = (fy / d) * a
          const mz = (fz / d) * a
          const y1 = my + (-fz / d) * hh
          const z1 = mz + (fy / d) * hh
          const y2 = my - (-fz / d) * hh
          const z2 = mz - (fy / d) * hh
          // pick the candidate nearest the wanted carpus/hock
          const pick1 = (y1 - dyk) ** 2 + (z1 - dzk) ** 2 < (y2 - dyk) ** 2 + (z2 - dzk) ** 2
          ky = pick1 ? y1 : y2
          kz = pick1 ? z1 : z2
        }
        _knee.y = _hip.y + ky
        _knee.z = _hip.z + kz
        // the cannon angle that this carpus/hock implies (vector knee -> fetlock)
        const cy = _fet.y - _knee.y
        const cz2 = _fet.z - _knee.z
        const rest = Math.atan2(leg.cannonVec.z, -leg.cannonVec.y)
        accCannon = -(Math.atan2(cz2, -cy) - rest)
      }
      Object.assign(this.dbg[i], { ky: +_knee.y.toFixed(2), kz: +_knee.z.toFixed(2), hy: +_hip.y.toFixed(2), hz: +_hip.z.toFixed(2), fy: +_fet.y.toFixed(2), fz: +_fet.z.toFixed(2) })
      P.solveLeg(leg.spec, _hip, _knee, _parentQ)
      // replace the solved rest-orientation cannon with the stride's angle
      const accLower = P.accumulated(leg.spec.lower, _q1)
      _q2.setFromAxisAngle(X_AXIS, accCannon)
      P.setDelta(leg.cannon, _q3.copy(accLower).invert().multiply(_q2))
      _q1.setFromAxisAngle(X_AXIS, accPastern)
      P.setDelta(leg.pastern, _q3.copy(_q2).invert().multiply(_q1))
      _q3.setFromAxisAngle(X_AXIS, accHoof)
      P.setDelta(leg.hoof, _q2.copy(_q1).invert().multiply(_q3))
    }

    // ---- tail ---------------------------------------------------------------------
    // carriage rises with energy and speed (an Arabian flags it high);
    // each segment is a damped spring driven by the body's motion; flies
    // get an occasional swish
    const n = this.tails.length
    const swish = a.swish >= 0 ? Math.sin(a.swish * Math.PI) : 0
    const raise = (0.25 * trot + 0.45 * canter + 0.6 * gallop) * w + a.alert * 0.3 - lie * 0.2 + fly * (0.55 - a.flyPitch * 0.6)
    // in flight the tail streams on the air: a ripple running down it that
    // quickens and tightens with airspeed, a whip that follows each wingbeat's
    // heave a little late, and a firmer rudder into turns
    const air = fly * smooth(2, 18, Math.abs(a.speed))
    const flutterHz = 5 + Math.min(Math.abs(a.speed), 40) * 0.25
    this.tailFlutter += dt * flutterHz
    for (let k = 0; k < n; k++) {
      const u2 = k / Math.max(1, n - 1)
      const pitchT = (k === 0 ? raise * 0.8 : raise * 0.25 * (1 - u2)) + (k > 1 ? clamp(a.accel * 0.01, -0.1, 0.1) : 0)
      const bounce = -bob * (k + 1) * 2.2
      const ripple = Math.sin(TAU * this.tailFlutter - k * 0.9) * air * (0.05 - 0.025 * air) * (0.3 + u2)
      const whip = -flyBeat * 0.12 * (0.4 + u2)
      const p = this.tailS[k].step(pitchT + bounce + (k > 2 ? gallop * w * 0.25 : 0) + whip + ripple * 0.5, 90 - k * 8, 10, dt)
      const yawT = swish * Math.sin(t * 9 - k * 0.6) * 0.5 * (0.4 + u2) - a.turnRate * (0.08 + fly * 0.14) * u2 + Math.sin(t * 1.3 + k) * 0.02 + ripple
      const y = this.tailYawS[k].step(yawT, 70 - k * 6, 9, dt)
      P.euler(this.tails[k], p, y, 0)
    }

    // ---- wings -----------------------------------------------------------------------
    a.wing.stride = this.phase
    if (this.wings) this.wings.update(P, a.wing, dt)

    P.apply()

    // ---- posed anchors for the rider and reins --------------------------------
    if (out) {
      this.posedPoint("spine2", out.seatRest, this.seat)
      if (out.seat2Rest) this.posedPoint("spine1", out.seat2Rest, this.seat2)
      P.accumulated("spine2", this.seatQ)
      this.posedPoint("head", out.bitLRest, this.bitL)
      this.posedPoint("head", out.bitRRest, this.bitR)
      this.posedPoint("neck1", out.reinRestRest, this.reinRest)
      P.posedHead("head", this.headPos)
    }
  }

  /** where a point attached to `bone` (rest model space) is now */
  posedPoint(bone: string, rest: THREE.Vector3, outV: THREE.Vector3): THREE.Vector3 {
    const P = this.poser
    P.posedHead(bone, outV)
    const q = P.accumulated(bone, _q1)
    _v3.copy(rest).sub(P.pos(bone)).applyQuaternion(q)
    return outV.add(_v3)
  }
}

