import * as THREE from "three"
import { RigPoser, type LegSpec } from "../../game/rig/RigPoser"
import type { AnimalModel, Species } from "./animalAssets"
import { rng } from "../noise"

/**
 * Procedural animation for the wildlife rigs: distance-driven gaits (walk,
 * trot, rabbit hop, duck waddle/paddle) with IK paws, plus layered poses —
 * sit, sleep curled up, graze, look at the explorer, happy tail, ear twitches and
 * breathing. Gait phase advances with distance, so paws never skate.
 *
 * Every rig part that exists on the model is alive: the jaw (chewing,
 * meowing, yawning, quacking), tongue (licking, grooming), pupils (light and
 * mood), eyelids (blinks, the slow "I trust you" blink), whiskers, ears
 * (twitch, swivel, flatten), digits (flex in the swing, knead, spread) and
 * every tail segment. The expressive layers are optional fields: a wild
 * animal that never sets them is posed exactly as it always was.
 */
export type AnimalPose = {
  dt: number
  time: number
  speed: number
  turnRate: number
  sit: number
  sleep: number
  graze: number
  happy: number
  swim: number
  /** head yaw/pitch toward something interesting (rad) */
  lookYaw: number
  lookPitch: number
  slope: number
  crossSlope: number
  fullIK: boolean
  /**
   * Optional companion layers. The wildlife never sets these, so wild animals
   * are posed exactly as before; the explorer's cat uses them for the postures a cat
   * shares with no other species here.
   */
  /** body flattened and lowered into a stalk, haunches deep, head level */
  crouch?: number
  /** forelegs extended, hips raised, rump up — the cat's morning stretch */
  stretch?: number
  /** legs extended fore and aft in the air; 1 at the apex of a leap */
  leap?: number
  /**
   * Progress through the leap's arc (0 take-off .. 1 touchdown). When given,
   * the legs are staged as a real jump: hind legs drive and trail, forelegs
   * tuck then reach far forward, and before touchdown the forelegs reach
   * down to meet the ground first while the hind legs swing in under.
   */
  leapT?: number
  /** 0..1 gathered on the haunches just before a spring */
  gather?: number
  /** 0..1 landing compression: the legs give, the body sinks, the head stays level */
  touchdown?: number
  /**
   * Ground height under a paw at model (x, z), relative to the model origin.
   * When given, every planted paw finds the real terrain beneath it instead
   * of one plane fitted under the body.
   */
  groundAt?: (x: number, z: number) => number
  /** forward reach of the head and shoulders toward something low */
  reach?: number
  /**
   * 0..1 blend into a rotary gallop (cats): bounding spine flexion and
   * extension, a gathered suspension phase and a long reach fore and aft.
   * Blended continuously with the walk/trot by the caller from real speed.
   */
  gallop?: number
  /** step-frequency multiplier on top of the species cadence (default 1) */
  cadence?: number

  // ---- expression ---------------------------------------------------------
  /** jaw opening 0..1 (meow, hiss, pant, quack); chewing is automatic */
  mouth?: number
  /** tongue out 0..1 (lick, groom, blep) */
  tongue?: number
  /** pupil dilation 0..1: 0 a sunlit slit, 1 wide and round */
  pupil?: number
  /** extra eyelid closure 0..1 (slow blink, drowsy, content) */
  lids?: number
  /** whiskers −1 (pressed back) … +1 (fanned forward) */
  whisker?: number
  /** ears pressed flat and back 0..1 (fear, anger) */
  earFlat?: number
  /** both ears rotated toward a sound, −1 right … +1 left */
  earSwivel?: number
  /** head roll in radians (a curious tilt) */
  headTilt?: number

  // ---- tail ---------------------------------------------------------------
  /** upright tail with a hooked tip: the friendly cat greeting 0..1 */
  tailUp?: number
  /** bottle-brush fluffed tail 0..1 */
  tailPuff?: number
  /** agitated lashing 0..1 */
  tailLash?: number
  /** tail curled around the paws when sitting 0..1 (sign of tailSide) */
  tailWrap?: number
  tailSide?: number

  // ---- whole-body actions (0..1 weights; cycles run on `time`) --------------
  /** arched, side-on "Halloween cat" back */
  arch?: number
  /** rump wiggle before a pounce */
  wiggle?: number
  /** alternating front-paw kneading ("making biscuits") */
  knead?: number
  /** licking a raised forepaw and washing the face with it */
  groom?: number
  /** which forepaw grooms / scratches: 1 left, −1 right */
  actSide?: number
  /** rolled onto the side/back, belly up, paws loose in the air */
  roll?: number
  /** leaning the cheek and flank into something (bunting), sign = side */
  rub?: number
  /** hind leg scratching behind the ear */
  scratch?: number
  /** a full yawn: head back, jaw wide, eyes shut, ears back */
  yawn?: number
  /** whole-body shake to throw off water */
  shake?: number
  /** paddle strokes per second while swimming (default 1.4) */
  stroke?: number
  /** "loaf": forepaws tucked under the chest */
  loaf?: number
  /** head high, ears forward, tail flagged: alarm */
  alert?: number
  /** rabbit standing up on its haunches to look around */
  rear?: number
  /** rabbit hind-foot thump (0..1 pulse) */
  thump?: number
  /** duck: preening the back/wing feathers */
  preen?: number
  /** duck: tipped up to feed, head under the water and tail to the sky */
  dabble?: number
  /** duck: wing-stretching flap */
  flap?: number
}

type Params = { cadence: number; liftK: number; stanceMax: number; trotAt: number; hop: boolean; waddle: boolean }

/**
 * Gait constants per species. `cadence` is strides per metre, so a
 * long-strided horse and a short-strided rabbit differ by 3x; `stanceMax` caps
 * how far a paw sweeps back relative to the hip height, which is what keeps a
 * horse's long walk from over-reaching and a big cat's trot from scrabbling.
 */
const PARAMS: Record<Species, Params> = {
  cat: { cadence: 3.2, liftK: 0.25, stanceMax: 0.12, trotAt: 0.9, hop: false, waddle: false },
  fox: { cadence: 3.0, liftK: 0.22, stanceMax: 0.16, trotAt: 1.0, hop: false, waddle: false },
  deer: { cadence: 1.8, liftK: 0.16, stanceMax: 0.42, trotAt: 1.6, hop: false, waddle: false },
  rabbit: { cadence: 3.6, liftK: 0.35, stanceMax: 0.08, trotAt: 0.0, hop: true, waddle: false },
  duck: { cadence: 3.4, liftK: 0.35, stanceMax: 0.05, trotAt: 99, hop: false, waddle: true },
  // A horse walks a long, low 4-beat and canters on the diagonal, so its
  // stance sweep is the longest here and its trot handover is the highest.
  horse: { cadence: 1.15, liftK: 0.13, stanceMax: 0.50, trotAt: 2.2, hop: false, waddle: false },
  // Big cats cover ground in a rolling stride with a deep chest; the tiger is
  // heavier and slower to accelerate than the much longer-legged cheetah.
  tiger: { cadence: 2.05, liftK: 0.22, stanceMax: 0.34, trotAt: 2.0, hop: false, waddle: false },
  cheetah: { cadence: 2.35, liftK: 0.20, stanceMax: 0.40, trotAt: 1.7, hop: false, waddle: false },
  // Primates are driven by PrimateAnimator. These entries keep the record
  // total and prevent a primate ever falling through to a quadruped default;
  // their limbs are arm/leg named rather than legF/legB, so no leg chain is
  // discovered and the leg loop is simply empty.
  monkey: { cadence: 2.6, liftK: 0.24, stanceMax: 0.22, trotAt: 1.2, hop: false, waddle: false },
  gorilla: { cadence: 1.5, liftK: 0.18, stanceMax: 0.36, trotAt: 1.4, hop: false, waddle: false },
}

/** Pupil shape per species: cats and foxes narrow to a vertical slit, the
 * deer's pupil is a horizontal bar, rabbits and ducks stay round. */
const PUPIL: Record<Species, { slitX: number; slitZ: number }> = {
  cat: { slitX: 0.16, slitZ: 1 },
  fox: { slitX: 0.24, slitZ: 1 },
  deer: { slitX: 1, slitZ: 0.55 },
  rabbit: { slitX: 0.8, slitZ: 0.8 },
  duck: { slitX: 0.75, slitZ: 0.75 },
  // Big cats have ROUND pupils like the domestic cat's night dilation — the
  // vertical slit is what distinguishes a housecat (and the fox) from a tiger.
  tiger: { slitX: 0.9, slitZ: 0.95 },
  cheetah: { slitX: 0.92, slitZ: 0.95 },
  horse: { slitX: 1, slitZ: 0.5 },
  // primates have a bright round pupil with a wide iris
  monkey: { slitX: 0.85, slitZ: 0.85 },
  gorilla: { slitX: 0.9, slitZ: 0.9 },
}

/**
 * Which species chew while grazing, and how far the head is held below the
 * withers at rest. A horse grazes with its neck dropped almost to the ground
 * and its jaw working steadily; a big cat lowers its head only a little and
 * tears at its food with a wider jaw swing.
 */
const GRAZE_JAW: Record<Species, { chew: number; swing: number }> = {
  cat: { chew: 0, swing: 0 },
  fox: { chew: 0, swing: 0 },
  deer: { chew: 1, swing: 0.12 },
  rabbit: { chew: 1, swing: 0.06 },
  duck: { chew: 0, swing: 0 },
  horse: { chew: 1, swing: 0.16 },
  tiger: { chew: 0.4, swing: 0.26 },
  cheetah: { chew: 0.3, swing: 0.22 },
  monkey: { chew: 0.6, swing: 0.10 },
  gorilla: { chew: 0.5, swing: 0.18 },
}

const damp = (a: number, b: number, k: number, dt: number): number => a + (b - a) * (1 - Math.exp(-k * dt))
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth01 = (v: number): number => { const u = clamp01(v); return u * u * (3 - 2 * u) }

/**
 * Which foot leads, and the stance fraction, per species.
 *
 * A horse and a big cat are both quadrupeds but they do not walk the same way:
 * a horse's 4-beat walk is a clear lateral sequence (LH, LF, RH, RF) with a
 * long 0.62 stance and low swing, while a cat's default walk is a more even
 * diagonal-ish 0.62 that blends to a trot sooner. Getting the horse's beats
 * wrong is exactly what made the earlier horses look like they were skating,
 * so the offsets live in data per species rather than being assumed.
 */
const BEATS: Record<Species, { walk: [number, number, number, number]; duty: number; trot: [number, number, number, number]; trotDuty: number }> = {
  cat: { walk: [0, 0.5, 0.25, 0.75], duty: 0.62, trot: [0, 0.5, 0.5, 0], trotDuty: 0.45 },
  fox: { walk: [0, 0.5, 0.25, 0.75], duty: 0.62, trot: [0, 0.5, 0.5, 0], trotDuty: 0.45 },
  deer: { walk: [0, 0.5, 0.25, 0.75], duty: 0.62, trot: [0, 0.5, 0.5, 0], trotDuty: 0.45 },
  rabbit: { walk: [0, 0.5, 0.25, 0.75], duty: 0.62, trot: [0, 0.5, 0.5, 0], trotDuty: 0.45 },
  duck: { walk: [0, 0.5, 0.25, 0.75], duty: 0.62, trot: [0, 0.5, 0.5, 0], trotDuty: 0.45 },
  // lateral-sequence 4-beat, long low walk, then a 2-beat diagonal trot
  horse: { walk: [0, 0.75, 0.5, 0.25], duty: 0.64, trot: [0, 0.5, 0.5, 0], trotDuty: 0.40 },
  // big cats: rolling stride that folds quickly into a bounding trot/gallop
  tiger: { walk: [0, 0.5, 0.25, 0.75], duty: 0.58, trot: [0, 0.5, 0.5, 0], trotDuty: 0.38 },
  cheetah: { walk: [0, 0.5, 0.25, 0.75], duty: 0.56, trot: [0, 0.5, 0.5, 0], trotDuty: 0.36 },
  monkey: { walk: [0, 0.5, 0.25, 0.75], duty: 0.62, trot: [0, 0.5, 0.5, 0], trotDuty: 0.45 },
  gorilla: { walk: [0, 0.5, 0.25, 0.75], duty: 0.64, trot: [0, 0.5, 0.5, 0], trotDuty: 0.48 },
}

const _v = new THREE.Vector3()
const _e = new THREE.Euler()
const _q1 = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _q3 = new THREE.Quaternion()

type Leg = { spec: LegSpec; front: boolean; side: number; restPaw: THREE.Vector3; toe: string | null }

export class QuadrupedAnimator {
  private poser: RigPoser
  private legs: Leg[] = []
  private tails: string[] = []
  /** a breed's tail size (a Maine Coon's plume); the fluff multiplies it */
  tailSize = 1
  /**
   * Planted strides: once a stride reaches the legs' reach, the legs quicken
   * instead of the paws skating, and every stance sweeps exactly the ground the
   * body covers. Off by default so an animal's established gait (The cat's) only
   * changes where a caller asks for it.
   */
  plantPaws = false
  private p: Params
  private phase: number
  private move = 0
  private earTimer = 1
  private earTwitch = 0
  private earSide = 1
  private blinkTimer = 2
  private blinkTime = 0
  private tailPhase: number
  private flickTimer = 3
  private flick = 0
  private chew = 0
  private random: () => number
  private parentQ = new THREE.Quaternion()
  private hip = new THREE.Vector3()
  private hipH: number
  stepped = false

  constructor(readonly species: Species, model: AnimalModel, seed = 1) {
    this.random = rng(seed)
    this.phase = this.random()
    this.tailPhase = this.random() * 6
    this.earTimer = this.random() * 4
    this.blinkTimer = 1 + this.random() * 4
    this.poser = new RigPoser(model.root, model.bones)
    this.p = PARAMS[species]
    const legDefs: Array<[string, boolean, number]> = species === "duck"
      ? [["legBL", false, 1], ["legBR", false, -1]]
      : [["legFL", true, 1], ["legFR", true, -1], ["legBL", false, 1], ["legBR", false, -1]]
    for (const [base, front, side] of legDefs) {
      if (!this.poser.has(`${base}1`)) continue
      const spec = this.poser.leg(`${base}1`, `${base}2`, `${base}3`)
      this.legs.push({ spec, front, side, restPaw: this.poser.pos(`${base}3`).clone(), toe: this.poser.has(`${base}4`) ? `${base}4` : null })
    }
    for (let i = 1; this.poser.has(`tail${i}`); i++) this.tails.push(`tail${i}`)
    this.hipH = this.poser.has("hips") ? this.poser.pos("hips").y : 0.2
  }

  /** Scratch result of `footfall` (no per-frame allocation). */
  private ff = { z: 0, y: 0, s: 0 }

  /**
   * One paw's fore-aft offset `z`, lift `y` and swing weight `s` at gait phase
   * `ph` with stance fraction `duty`. The stance sweeps back at the body's
   * speed (capped by the species' reach) so the planted paw does not skate;
   * the swing eases forward with a lift arc. `stance`/`liftH` override the
   * species defaults (the gallop reaches far further than the walk).
   */
  private footfall(ph: number, duty: number, cycleLen: number, H: number, stance?: number, liftH?: number): void {
    const P = this.p
    const st = this.plantPaws ? cycleLen * duty : stance ?? Math.min(P.stanceMax * (1 + H), cycleLen * duty)
    const f = this.ff
    if (ph < duty) {
      f.z = (0.5 - ph / duty) * st
      f.y = 0
      f.s = 0
      return
    }
    const u = (ph - duty) / (1 - duty)
    f.z = (-0.5 + u * u * (3 - 2 * u)) * st
    f.s = Math.sin(u * Math.PI)
    f.y = f.s * (liftH ?? P.liftK * H * Math.min(1, st / (P.stanceMax + 1e-3) + 0.4))
  }

  /** Model-space rotation helper (YXZ like RigPoser.euler). */
  private static rot(x: number, y: number, z: number, out: THREE.Quaternion): THREE.Quaternion {
    _e.set(x, y, z, "YXZ")
    return out.setFromEuler(_e)
  }

  update(a: AnimalPose): void {
    const dt = Math.min(a.dt, 0.6)
    const P = this.p
    const t = a.time
    // The companion layers are optional; absent ones must read as zero or the
    // arithmetic below would poison every bone with NaN.
    const crouch = a.crouch ?? 0
    const stretch = a.stretch ?? 0
    const leap = a.leap ?? 0
    const leapT = a.leapT
    const gather = a.gather ?? 0
    const touchdown = a.touchdown ?? 0
    // the arc's own pose: legs only stretch out once she has left the ground
    const flight = leapT === undefined ? leap : leap * (1 - gather)
    const reach = a.reach ?? 0
    const arch = a.arch ?? 0
    const wiggle = a.wiggle ?? 0
    const knead = a.knead ?? 0
    const groom = a.groom ?? 0
    const roll = a.roll ?? 0
    const rub = a.rub ?? 0
    const scratch = a.scratch ?? 0
    const yawn = a.yawn ?? 0
    const shake = a.shake ?? 0
    const loaf = a.loaf ?? 0
    const alert = a.alert ?? 0
    const rear = a.rear ?? 0
    const thump = a.thump ?? 0
    const preen = a.preen ?? 0
    const flapAct = a.flap ?? 0
    const dabble = a.dabble ?? 0
    const side = (a.actSide ?? 1) >= 0 ? 1 : -1
    const poser = this.poser
    poser.reset()
    // turning on the spot is stepping too (a cat pivots on small paw steps,
    // never spins on planted paws); the turn's sweep drives the cycle
    const pivot = Math.abs(a.turnRate ?? 0) * Math.max(0.12, this.hipH) * 0.8
    const stepSpeed = Math.max(a.speed, pivot)
    const moving = stepSpeed > 0.05 && a.sleep < 0.5 && roll < 0.5
    this.move = damp(this.move, moving ? 1 : 0, moving ? 8 : 5, dt)
    const w = this.move
    // cycle length grows with speed; cadence is species-specific
    const gallop = clamp01(a.gallop ?? 0) * w
    const cadence = P.cadence * (0.75 + Math.min(1, a.speed / 2) * 0.5) * (a.cadence ?? 1)
    // walk -> trot is a blend, not a switch, so the footfalls never pop
    const trotW = P.trotAt > 0 ? THREE.MathUtils.smoothstep(a.speed, P.trotAt - 0.15, P.trotAt + 0.15) : 0
    const H = this.hipH
    let cycleLen = Math.max(0.05, stepSpeed / cadence)
    if (this.plantPaws) {
      // the stance a paw can cover, and the share of the stride it is down for
      const B = BEATS[this.species]
      const duty = P.hop ? 0.35 : P.waddle ? 0.62 : THREE.MathUtils.lerp(THREE.MathUtils.lerp(B.duty, B.trotDuty, trotW), 0.32, gallop)
      const reach = THREE.MathUtils.lerp(P.stanceMax * (1 + H), H * 1.15, P.hop || P.waddle ? 0 : gallop)
      cycleLen = Math.max(0.05, Math.min(cycleLen, reach / duty))
    }
    const before = this.phase
    this.phase = (this.phase + (stepSpeed * dt) / cycleLen) % 1
    this.stepped = Math.floor(before * 2) !== Math.floor(this.phase * 2)
    // Rotary gallop, one stride per cycle: hind stance 0..0.42 with the spine
    // extending as the hind legs drive, fore stance 0.45..0.87, then a gathered
    // suspension with the spine flexed and the hind paws swinging in under the
    // chest. `flex` is +1 fully gathered, −1 fully extended.
    const flex = Math.sin((this.phase - 0.55) * Math.PI * 2) * gallop
    const lift = Math.max(0, Math.cos((this.phase - 0.93) * Math.PI * 2)) * gallop
    // the seated family of poses all fold the haunches
    const seated = Math.min(1, a.sit + groom * 0.9 + scratch + knead * 0.6)

    // ---- cyclic action signals ------------------------------------------------
    // grooming alternates licking the paw and wiping it over the face
    const groomCycle = (t * 0.32) % 1
    const wash = groom * THREE.MathUtils.smoothstep(groomCycle, 0.55, 0.65) * (1 - THREE.MathUtils.smoothstep(groomCycle, 0.92, 1))
    const lick = groom * (1 - wash) * (0.5 + 0.5 * Math.sin(t * 9))
    const kneadL = knead * Math.max(0, Math.sin(t * 5.2))
    const kneadR = knead * Math.max(0, Math.sin(t * 5.2 + Math.PI))
    const scratchBeat = scratch * Math.sin(t * 24)
    const shakeWave = shake * Math.sin(t * 26)

    // ---- body layers -------------------------------------------------------------
    const breathe = Math.sin(t * (a.sleep > 0.5 ? 1.6 : 2.6)) * 0.012
    let bodyY = 0
    let bodyPitch = 0
    // leaning into a turn as hard as it is taken (lateral acceleration v·ω)
    let bodyRoll = THREE.MathUtils.clamp(-(a.turnRate ?? 0) * a.speed * 0.05, -0.22, 0.22) * (1 - (a.swim ?? 0))
    let bodyYaw = 0
    if (P.hop) {
      // a swimming rabbit paddles; it cannot hop off the water
      const hop = Math.max(0, Math.sin(this.phase * Math.PI * 2)) * w * (1 - (a.swim ?? 0))
      bodyY += hop * H * 0.55
      bodyPitch += Math.cos(this.phase * Math.PI * 2) * 0.25 * w
    } else if (P.waddle) {
      bodyRoll += Math.sin(this.phase * Math.PI * 2) * (0.18 - a.swim * 0.14) * w
      bodyY += Math.abs(Math.sin(this.phase * Math.PI * 2)) * 0.01 * w
    } else {
      bodyY += Math.abs(Math.sin(this.phase * Math.PI * 2)) * H * 0.04 * w * (1 - gallop)
      // gallop: the body sinks into each stance and floats in the suspension,
      // rocking nose-down as the forelegs land and rump-down as the hind drive
      bodyY += (lift * 0.16 - 0.05 * gallop) * H
      bodyPitch += Math.sin((this.phase - 0.30) * Math.PI * 2) * 0.10 * gallop
    }
    // sit: rear down, chest up
    bodyY -= seated * H * 0.42
    bodyPitch -= seated * 0.55
    // sleep: whole body low and curled
    bodyY -= a.sleep * H * 0.7
    bodyRoll += a.sleep * 0.35
    // loaf: low, level, everything tucked under
    bodyY -= loaf * H * 0.6
    // stalk: spine drops level so the cat can see over the grass, rump low
    bodyY -= crouch * H * 0.52
    bodyPitch += crouch * 0.2
    // wiggle: the rump shuffles side to side over the hind paws
    bodyYaw += wiggle * Math.sin(t * 15) * 0.09
    bodyRoll += wiggle * Math.sin(t * 15) * 0.06
    // stretch: hips and shoulders rise, spine dips into a shallow arch. The IK
    // holds the paws down, so this reads as the back arching up over them.
    bodyY += stretch * H * 0.16
    bodyPitch += stretch * 0.42
    // arch: legs stiff and straight, the whole body lifted onto its toes
    bodyY += arch * H * 0.2
    // leap: the body coils and then extends along the arc
    if (leapT === undefined) {
      bodyY += leap * H * 0.12
      bodyPitch += leap * 0.18
    } else {
      // nose up off the ground, level at the top, nose down to land
      bodyY += flight * H * 0.10
      bodyPitch += flight * (-0.22 * (1 - smooth01(leapT / 0.45)) + 0.24 * smooth01((leapT - 0.55) / 0.45))
    }
    // the gather: haunches loaded, rump low under a raised chest
    bodyY -= gather * H * 0.26
    bodyPitch -= gather * 0.16
    // touchdown: forepaws take the first of it (nose dips), then the whole
    // body sinks over the bending legs and rises again
    bodyY -= touchdown * H * 0.2
    bodyPitch += touchdown * 0.12
    // roll: over onto the side and back, belly to the sky
    bodyY -= roll * H * 0.66
    bodyRoll += roll * 1.45 * side
    // rub: lean the flank into whatever she is bunting
    bodyRoll += rub * 0.22
    // rabbit rearing up: chest high on the haunches
    bodyPitch -= rear * 0.95
    bodyY += rear * H * 0.25
    bodyY += thump * H * 0.05
    // the shake starts at the head and runs to the rump
    bodyRoll += shakeWave * 0.16
    // swimming: ride the water, legs paddle below
    bodyY -= a.swim * 0.105
    // dabbling: pivot about the waterline, rump up, breast and head under
    bodyPitch += dabble * 1.05
    bodyY += dabble * H * 0.12
    const groundK = (1 - a.sleep) * (1 - roll)
    bodyPitch -= Math.atan(a.slope) * 0.6 * groundK
    bodyRoll += Math.atan(a.crossSlope) * 0.5 * groundK
    poser.offset("hips", 0, bodyY + breathe * H, 0)
    poser.euler("hips", bodyPitch, -a.turnRate * 0.05 * w + a.sleep * 0.4 + bodyYaw, bodyRoll)
    if (poser.has("spine")) {
      poser.euler(
        "spine",
        // the gallop bends the whole back: arched when gathered, long when extended
        seated * 0.12 + breathe + stretch * 0.3 + crouch * 0.16 - arch * 0.7 + roll * 0.15 + rear * 0.15 - flex * 0.30,
        Math.sin(this.phase * Math.PI * 2) * 0.05 * w * (1 - gallop) + a.sleep * 0.45 - bodyYaw * 0.6 + rub * 0.12,
        -bodyRoll * 0.3 + shakeWave * 0.2,
      )
    }
    poser.euler(
      "chest",
      seated * 0.2 - breathe * 0.5 - reach * 0.35 - stretch * 0.2 + arch * 0.9 - loaf * 0.05 + rear * 0.2 + flex * 0.24,
      a.sleep * 0.4 + crouch * 0.25 + rub * 0.15 + groom * side * 0.12,
      shakeWave * 0.3,
    )

    // ---- head --------------------------------------------------------------------
    const grazeP = a.graze * 0.95
    const groomHead = groom * (0.55 + wash * 0.15)
    const neckPitch =
      grazeP * 0.6 + seated * 0.1 + a.lookPitch * 0.4 + a.sleep * 0.4 - reach * 0.3 - stretch * 0.25 +
      groomHead * 0.5 - yawn * 0.35 - alert * 0.45 + scratch * 0.2 - rear * 0.2 + preen * 0.4 + arch * 0.25 +
      // galloping: head low and long, held steady against the body's rock
      gallop * 0.18 - flex * 0.12 + dabble * 0.75 +
      // airborne and landing, the head is held level against the body's pitch
      (leapT === undefined ? 0 : -flight * (-0.22 * (1 - smooth01(leapT / 0.45)) + 0.24 * smooth01((leapT - 0.55) / 0.45)) * 0.8) -
      touchdown * 0.1 + gather * 0.12
    const neckYaw =
      a.lookYaw * 0.45 + a.sleep * 0.6 + crouch * 0.3 + groom * side * 0.35 + scratch * side * 0.25 +
      preen * side * 1.4 + rub * 0.3
    poser.euler("neck", neckPitch, neckYaw, 0)
    const tilt = (a.headTilt ?? 0) + rub * 0.5 + scratch * side * 0.35 + groom * side * wash * 0.4
    poser.euler(
      "head",
      grazeP * 0.4 + seated * 0.16 + a.lookPitch * 0.6 + Math.sin(t * 0.7) * 0.03 + a.sleep * 0.25 + reach * 0.25 + groomHead * 0.45 -
        yawn * 0.45 - alert * 0.15 + preen * 0.6 + dabble * 0.35,
      a.lookYaw * 0.55 + a.sleep * 0.4 + groom * side * 0.25 + preen * side * 0.6 + shakeWave * 0.35,
      a.happy * Math.sin(t * 1.3) * 0.15 + a.sleep * 0.5 - crouch * 0.3 + tilt + shakeWave * 0.6,
    )

    // ---- jaw & tongue --------------------------------------------------------------
    // grazers chew in a steady rhythm; everyone else only on purpose
    const grazeJaw = GRAZE_JAW[this.species]
    const chewing = grazeJaw.chew * a.graze
    this.chew += dt * (this.species === "rabbit" ? 9 : 4.2)
    const chew = chewing * (0.5 + 0.5 * Math.sin(this.chew)) * grazeJaw.swing
    const jawOpen = Math.min(1, (a.mouth ?? 0) + yawn * 1.0 + lick * 0.25 + wash * 0.0)
    if (poser.has("jaw")) poser.euler("jaw", jawOpen * (this.species === "duck" ? 0.45 : 0.62) + chew, chew * 0.25, 0)
    if (poser.has("tongue")) {
      // tongue slides out of the mouth and its tip curls up when yawning
      const out = Math.min(1, (a.tongue ?? 0) + lick * 0.9)
      poser.offset("tongue", 0, -out * 0.002, out * 0.014 * (H / 0.21))
      poser.euler("tongue", -yawn * 0.5 - out * 0.15, 0, 0)
    }

    // ---- eyes: blinks, slow blinks, pupils --------------------------------------
    this.blinkTimer -= dt
    if (this.blinkTimer <= 0) { this.blinkTimer = 2.5 + this.random() * 4; this.blinkTime = 0.18 }
    this.blinkTime = Math.max(0, this.blinkTime - dt)
    const close = Math.min(1, Math.max(a.sleep, Math.sin(this.blinkTime / 0.18 * Math.PI), (a.lids ?? 0), yawn * 0.95, shake * 0.8, lick * 0.5))
    // Eye bones point vertically in the authored rig; compressing that axis
    // keeps eyelids/glints attached, including throughout the sleeping pose.
    poser.scale("eyeL", 1, 1 - close * 0.94, 1)
    poser.scale("eyeR", 1, 1 - close * 0.94, 1)
    if (poser.has("pupilL")) {
      const pu = PUPIL[this.species]
      const d = clamp01((a.pupil ?? 0.45) + arch * 0.6 + crouch * 0.35 + wiggle * 0.4)
      const sx = pu.slitX + (1 - pu.slitX) * d
      const sz = pu.slitZ + ((this.species === "horse" ? 0.65 : 1) - pu.slitZ) * d
      poser.scale("pupilL", sx, 1, sz)
      poser.scale("pupilR", sx, 1, sz)
    }

    // ---- whiskers -------------------------------------------------------------------
    if (poser.has("whiskerL")) {
      const fan = Math.max(-1, Math.min(1, (a.whisker ?? 0) + crouch * 0.6 + reach * 0.5 - arch * 0.8 - yawn * 0.5 - a.sleep * 0.4))
      const twitch = Math.sin(t * 17) * 0.04 * (a.graze + (this.species === "rabbit" ? 1 : 0))
      poser.euler("whiskerL", fan * 0.08 + twitch, -fan * 0.34, 0)
      poser.euler("whiskerR", fan * 0.08 - twitch, fan * 0.34, 0)
    }

    // ---- ears: occasional twitch, swivel to sounds, flatten in fear -----------------
    this.earTimer -= dt
    if (this.earTimer <= 0) {
      this.earTimer = 1.5 + this.random() * 4
      this.earTwitch = 1
      this.earSide = this.random() < 0.5 ? 1 : -1
    }
    this.earTwitch = Math.max(0, this.earTwitch - dt * 6)
    const tw = Math.sin(this.earTwitch * Math.PI) * 0.4
    if (poser.has("earL")) {
      const flat = Math.min(1, (a.earFlat ?? 0) + arch * 0.9 + yawn * 0.3 + crouch * 0.25 + gallop * 0.25)
      const swivel = (a.earSwivel ?? 0) + rub * 0.0
      const fwd = alert * 0.35 + reach * 0.25 + a.happy * 0.2
      // pitch: + tips the ear forward, − lays it back; roll turns it outward
      poser.euler("earL", fwd - flat * 0.95 + (this.earSide > 0 ? tw : 0) - a.sleep * 0.5 + shakeWave * 0.3, swivel * 0.6, -flat * 0.65 + a.sleep * 0.4)
      poser.euler("earR", fwd - flat * 0.95 + (this.earSide < 0 ? tw : 0) - a.sleep * 0.5 - shakeWave * 0.3, swivel * 0.6, flat * 0.65 - a.sleep * 0.4)
    }

    // ---- tail: every segment -----------------------------------------------------------
    this.tailPhase += dt * (1.2 + a.happy * 2 + w * 1.5 + (a.tailLash ?? 0) * 7)
    this.flickTimer -= dt
    if (this.flickTimer <= 0) { this.flickTimer = 2 + this.random() * 5; this.flick = 1 }
    this.flick = Math.max(0, this.flick - dt * 3)
    const n = this.tails.length
    if (n > 0) {
      const up = clamp01((a.tailUp ?? 0) + arch * 0.8)
      const lash = a.tailLash ?? 0
      const wrap = (a.tailWrap ?? 0) * (1 - up)
      const wrapSide = (a.tailSide ?? 1) >= 0 ? 1 : -1
      const puff = a.tailPuff ?? 0
      // the short tails (rabbit scut, deer flag) only flick and flag
      const short = this.species === "rabbit" || this.species === "deer"
      for (let i = 0; i < n; i++) {
        const u = n > 1 ? i / (n - 1) : 0
        // a travelling wave: the tip lags the root
        const wave = Math.sin(this.tailPhase - u * 2.2)
        const amp = (0.25 + a.happy * 0.2 + stretch * 0.25) * (3 / Math.max(3, n)) * (0.6 + u)
        let pitch: number
        let yaw = wave * amp * (1 - a.sleep) * (1 - wrap) * (1 - up * 0.7) * (1 - gallop * 0.7)
        if (i === 0) {
          // A stalking cat drops its tail for balance and a stretching one flicks
          // it upright; both read as intent at a glance.
          pitch = -a.happy * 0.6 - a.sleep * 1.15 + crouch * 0.55 + stretch * 0.5 + leap * 0.35 + w * 0.15
          pitch += -up * 1.5 + wrap * 0.9 - alert * (short ? 1.1 : 0.2) + roll * 0.6
          // galloping, the tail streams out level behind and counters the back
          pitch += -gallop * 0.45 + flex * 0.3
          // the tail is her rudder in a jump: up as she lands, to check the pitch
          pitch += -touchdown * 0.55 - (leapT === undefined ? 0 : flight * 0.3 * smooth01((leapT - 0.6) / 0.4))
          // a seated or curled-up cat's long plume lies out along the ground
          // rather than hanging into it as the hips tip and roll
          if (this.species === "cat") pitch += seated * 0.5 - a.sleep * 0.5
          yaw += a.sleep * 1.0 + wrap * wrapSide * 0.5
        } else {
          pitch = (-a.happy * 0.3 - stretch * 0.3) * (3 / Math.max(3, n)) - a.sleep * 0.08
          yaw += a.sleep * (0.65 / Math.max(1, n - 1)) * 2 + wrap * wrapSide * (0.45 + u * 0.25)
          // question-mark: the last third hooks forward over the back
          pitch += up * (u > 0.6 ? 0.55 : -0.05)
          pitch += wrap * 0.06
        }
        // lashing: big, fast, mostly sideways; the tip snaps
        yaw += lash * Math.sin(this.tailPhase * 1.4 - u * 3) * (0.35 + u * 0.4)
        // idle tip flick
        if (u > 0.6) yaw += Math.sin(this.flick * Math.PI) * 0.4 * (1 - a.sleep)
        yaw += shakeWave * 0.4 * u
        poser.euler(this.tails[i], pitch, yaw, 0)
      }
      // the bottle-brush: scale the root uniformly so the whole tail fluffs
      // (non-uniform scale would shear the segments when they bend)
      const fluff = (1 + puff * 0.32) * this.tailSize
      poser.scale(this.tails[0], fluff, fluff, fluff)
    }
    // duck wings: flutter when moving fast, stretch-flap, lift for preening
    if (poser.has("wingL")) {
      const flutter = a.speed > 1.5 ? Math.sin(t * 22) * 0.9 : 0
      const stretchFlap = flapAct * (0.9 + Math.sin(t * 9) * 0.7)
      const lift = preen * 0.35
      poser.euler("wingL", 0, 0, flutter + stretchFlap + lift * (side > 0 ? 1 : 0))
      poser.euler("wingR", 0, 0, -flutter - stretchFlap - lift * (side < 0 ? 1 : 0))
    }

    // ---- legs ------------------------------------------------------------------------------
    const parentQ = this.parentQ
    const B = BEATS[this.species]
    for (let li = 0; li < this.legs.length; li++) {
      const leg = this.legs[li]
      // The beats table is indexed FL, FR, BL, BR to match the order the legs
      // were discovered in the constructor, so a horse's lateral sequence and a
      // cat's diagonal trot both come straight out of the data.
      const i = li
      // lateral-sequence walk / diagonal trot / paired hop / alternating waddle,
      // and the cat's rotary gallop; neighbouring gaits are blended by their
      // paw targets so speed changes never make a foot jump
      const ff = this.ff
      let z: number
      let y: number
      let swingU: number
      if (P.hop || P.waddle) {
        const off = P.hop ? (leg.front ? 0.15 : 0.6) : leg.side > 0 ? 0 : 0.5
        this.footfall((this.phase + off) % 1, P.hop ? 0.35 : 0.62, cycleLen, H)
        z = ff.z
        y = ff.y
        swingU = ff.s
      } else {
        this.footfall((this.phase + B.walk[i]) % 1, B.duty, cycleLen, H)
        z = ff.z
        y = ff.y
        swingU = ff.s
        if (trotW > 0) {
          this.footfall((this.phase + B.trot[i]) % 1, B.trotDuty, cycleLen, H)
          z += (ff.z - z) * trotW
          y += (ff.y - y) * trotW
          swingU += (ff.s - swingU) * trotW
        }
        if (gallop > 0) {
          // hind left leads the hind pair, the fore pair lands crosswise
          const off = leg.front ? (leg.side > 0 ? 0.55 : 0.45) : leg.side > 0 ? 0 : 0.1
          this.footfall((this.phase + off) % 1, 0.32, cycleLen, H, H * 1.15, (leg.front ? 0.42 : 0.34) * H)
          z += (ff.z - z) * gallop
          y += (ff.y - y) * gallop
          swingU += (ff.s - swingU) * gallop
        }
      }
      z *= w
      y *= w
      swingU *= w
      const target = _v.copy(leg.restPaw)
      target.z += z
      // the ground beneath this paw: sampled per paw when the caller can, else
      // the plane fitted under the body. In the air the paws ignore it.
      const planar = a.slope * target.z + a.crossSlope * target.x
      const under = a.groundAt ? Math.max(-0.25, Math.min(0.25, a.groundAt(target.x, target.z))) : planar
      target.y += y + (under + (planar - under) * Math.min(1, leap))
      // sit: hind paws come forward under the hips; sleep: tucked in
      if (!leg.front) target.z -= seated * H * 0.35
      if (a.sleep > 0) {
        target.y = THREE.MathUtils.lerp(target.y, H * 0.12, a.sleep)
        target.z += (leg.front ? -1 : 1) * a.sleep * H * 0.25
        target.x *= 1 - a.sleep * 0.3
      }
      if (loaf > 0) {
        // forepaws fold back under the chest, hind paws tuck under the hips
        target.y = THREE.MathUtils.lerp(target.y, H * (leg.front ? 0.07 : 0.1), loaf)
        target.z += loaf * H * (leg.front ? -0.2 : 0.12)
        target.x *= 1 - loaf * 0.2
      }
      if (a.swim > 0) {
        if (P.waddle) {
          target.y += a.swim * (-0.08 + Math.sin(t * 9 + leg.side) * 0.02)
          target.z += a.swim * Math.cos(t * 9 + leg.side) * 0.035
        } else {
          // a four-legged swimmer's paddle is a trot under water: diagonal
          // pairs reach forward and pull back in long rounded strokes, the
          // forelegs high under the chest, the hind legs driving behind
          const ph = t * Math.PI * 2 * (a.stroke ?? 1.4) + (leg.front === (leg.side > 0) ? 0 : Math.PI)
          const reachK = leg.front ? 0.3 : 0.22
          target.z += a.swim * Math.sin(ph) * H * reachK + a.swim * (leg.front ? 0.05 : -0.08) * H
          target.y += a.swim * H * ((leg.front ? 0.22 : 0.12) + Math.max(0, Math.cos(ph)) * 0.16)
        }
      }
      // stalk: paws stay planted but the body drops over them, so they splay
      // very slightly and the forelegs take a longer stride
      if (crouch > 0) {
        target.x += leg.side * crouch * H * 0.1
        target.z += (leg.front ? -1 : 1) * crouch * H * 0.12
      }
      // arch: paws gathered close together under the raised body
      if (arch > 0) target.z += (leg.front ? -1 : 1) * arch * H * 0.12
      // stretch: forelegs slide forward and the hind paws tuck under the rump
      if (stretch > 0) {
        target.z += (leg.front ? 1 : -1) * stretch * H * 0.55
        target.y += stretch * (leg.front ? -0.015 : 0.02)
      }
      // leap: paws leave the ground entirely and reach fore and aft
      if (leap > 0 && leapT === undefined) {
        target.y += leap * H * (leg.front ? 0.62 : 0.4)
        target.z += leap * H * (leg.front ? 0.85 : -0.6)
      } else if (flight > 0 && leapT !== undefined) {
        const u = leapT
        if (leg.front) {
          // tucked up at the spring, stretched far forward over the top,
          // then reaching down and ahead to meet the ground first
          const up = 0.55 * smooth01(u / 0.25) * (1 - smooth01((u - 0.58) / 0.34))
          const fwd = 0.85 * smooth01((u - 0.08) / 0.4) * (1 - 0.45 * smooth01((u - 0.72) / 0.28))
          target.y += flight * H * up
          target.z += flight * H * fwd
        } else {
          // driving back off the ground, trailing, then swung in under the
          // body, still a little high, to land just after the forepaws
          const back = -0.6 * (1 - smooth01((u - 0.3) / 0.4)) + 0.12 * smooth01((u - 0.6) / 0.4)
          const up = 0.1 * (1 - smooth01(u / 0.15)) + 0.42 * smooth01((u - 0.12) / 0.3) * (1 - 0.45 * smooth01((u - 0.75) / 0.25))
          target.y += flight * H * up
          target.z += flight * H * back
        }
      }
      // gathering, the hind paws come forward under the loaded haunches
      if (gather > 0 && !leg.front) target.z += gather * H * 0.18
      // landing, the paws stay where they touched while the body sinks
      // (the IK bends the legs); the forelegs land a touch ahead and wide
      if (touchdown > 0 && leg.front) {
        target.z += touchdown * H * 0.06
        target.x += leg.side * touchdown * H * 0.04
      }
      // reaching forward for a hand or a scent
      if (reach > 0 && leg.front) {
        target.z += reach * H * 0.5
        target.y += reach * 0.03
      }
      const mine = leg.side === side
      if (leg.front) {
        // kneading: each forepaw lifts and presses down in turn
        if (knead > 0) {
          const k = leg.side > 0 ? kneadL : kneadR
          target.y += k * H * 0.12
          target.z += knead * H * 0.12
        }
        // grooming: the forepaw comes up to the mouth, then sweeps over the ear
        if (groom > 0 && mine) {
          target.y = THREE.MathUtils.lerp(target.y, H * (0.62 + wash * 0.32 + Math.sin(t * 9) * 0.02 * (1 - wash)), groom)
          target.z = THREE.MathUtils.lerp(target.z, leg.restPaw.z + H * (0.42 - wash * 0.08), groom)
          target.x = THREE.MathUtils.lerp(target.x, leg.restPaw.x * 0.2, groom)
        }
        // rearing rabbit: forepaws hang in front of the chest
        if (rear > 0) {
          target.y += rear * H * 0.7
          target.z -= rear * H * 0.1
        }
      } else {
        // the scratching hind paw reaches up behind the ear and pedals
        if (scratch > 0 && mine) {
          target.y = THREE.MathUtils.lerp(target.y, H * (0.95 + scratchBeat * 0.06), scratch)
          target.z = THREE.MathUtils.lerp(target.z, leg.restPaw.z - H * 0.7, scratch)
          target.x = THREE.MathUtils.lerp(target.x, leg.restPaw.x * 1.6, scratch)
        }
        if (thump > 0) target.y += thump * H * 0.08
      }
      // on its back: paws loose in the air above the belly
      if (roll > 0) {
        target.y = THREE.MathUtils.lerp(target.y, H * (leg.front ? 0.55 : 0.4), roll)
        target.x = THREE.MathUtils.lerp(target.x, target.x - side * H * 0.65, roll)
        target.z = THREE.MathUtils.lerp(target.z, target.z * 0.7, roll)
      }
      if (a.fullIK) {
        poser.accumulated(poser.recs.get(leg.spec.upper)!.bone.parent!.name, parentQ)
        const hip = poser.posedHead(leg.spec.upper, this.hip)
        poser.solveLeg(leg.spec, hip, target, parentQ)
        // carpus/hock flex: the paw folds back while it swings and when it is
        // drawn up (grooming, kneading, scratching, lying on its back)
        const lifted = Math.max(
          swingU,
          leg.front && mine ? groom : 0,
          !leg.front && mine ? scratch : 0,
          roll * 0.8,
          loaf * (leg.front ? 1 : 0.4),
          a.sleep * 0.6,
          leap * 0.5,
        )
        const flex = lifted * (leg.front ? 1.25 : 0.45)
        if (flex > 1e-3 || leg.toe) {
          // accumulated rotation of the pastern = M2 · D_end; solveLeg made it
          // identity (rest). Replace with a flex about the lateral axis.
          const end = leg.spec.end
          const accLower = poser.accumulated(leg.spec.lower, _q1)
          const flexQ = QuadrupedAnimator.rot(flex, 0, 0, _q2)
          poser.setDelta(end, _q3.copy(accLower).invert().multiply(flexQ))
          if (leg.toe) {
            // digits curl as the paw lifts, spread while kneading
            const kneadToe = leg.front ? (leg.side > 0 ? kneadL : kneadR) : 0
            const curl = lifted * 0.5 - kneadToe * 0.45 + knead * 0.2
            poser.setDelta(leg.toe, _q1.copy(flexQ).invert().multiply(QuadrupedAnimator.rot(flex + curl, 0, 0, _q3)))
          }
        }
      } else {
        // cheap far tier: swing the limb by the same fore-aft paw offset
        const stride = THREE.MathUtils.clamp(z / (0.35 * H), -1.6, 1.6) * 0.45
        poser.euler(leg.spec.upper, stride + seated * (leg.front ? -0.2 : 0.8) + a.sleep * 0.8 + crouch * 0.25 + stretch * (leg.front ? -0.6 : 0.5) + leap * (leg.front ? -1.1 : 0.9) + loaf * (leg.front ? 0.9 : 0.8), 0, 0)
        poser.euler(leg.spec.lower, -stride * 0.6 - a.sleep * 0.7 - crouch * 0.3 - stretch * 0.35 + leap * 0.6 - loaf * 0.8, 0, 0)
      }
    }
    poser.apply()
  }
}
