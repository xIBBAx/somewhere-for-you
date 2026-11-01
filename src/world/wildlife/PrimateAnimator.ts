import * as THREE from "three"
import { RigPoser, type LegSpec } from "../../game/rig/RigPoser"
import type { AnimalModel, Species } from "./animalAssets"
import { rng } from "../noise"

/**
 * Procedural animation for the primate rigs (monkey, gorilla) from
 * asset-pipeline/blender/build_wildlife_v2.py.
 *
 * A primate is not a cat with longer arms, so this does not reuse
 * QuadrupedAnimator: it knows the arm{L,R}1..2 / hand{L,R} and
 * leg{L,R}1..2 / foot{L,R} chains, and it poses the postures that only a
 * primate has — a quadrupedal knuckle walk with the knuckles planted and the
 * hips high, a full sit with the hind legs folded under and the torso upright,
 * and a climb with both arms overhead gripping bark. It is peaceful wildlife:
 * every posture is relaxed or curious, nothing is raised, bared or lunging.
 *
 * Both IK chains use the same two-bone solver and the same <x>1 -> <x>2 with
 * hand/foot heads as the planted targets, so feet and hands stay on
 * the branch and on the ground through every blend.
 */
export type PrimatePose = {
  dt: number
  time: number
  speed: number
  turnRate: number
  /** 0 upright quadrupedal knuckle walk, 1 sitting on the haunches */
  sit: number
  /** curled asleep on a branch */
  sleep: number
  /** both arms overhead gripping bark */
  climb: number
  /** vertical speed while climbing (m/s, + up): drives the hand-over-hand grip cycle */
  climbRate?: number
  /** airborne between branches: limbs trailing */
  air: number
  /** crouched ready to spring */
  crouch: number
  /** head yaw/pitch toward something interesting (rad) */
  lookYaw: number
  lookPitch: number
  /** eating; the free hand comes up with food */
  eat: number
  /** grooming or scratching */
  groom: number
  /** peaceable contentment: a slow sway and a soft open mouth */
  happy: number
  /** startled: sits up tall and looks, but never attacks */
  alert: number
  /** grooming a partner: both hands part and pick through the fur in front */
  allogroom?: number
  /** being groomed: slumped, eyes half shut, an arm lifted now and then */
  groomed?: number
  /** close, friendly company: brings out the lip-smack */
  social?: number
  /** something worth a look (the avatar nearby): brows up, ears forward, a head cock */
  curious?: number
  fullIK: boolean
}

type Params = {
  /** strides per metre */
  cadence: number
  /** how high the hips ride above the knuckles when walking */
  hipRise: number
  /** how far the knuckles and feet sweep fore/aft relative to the hip */
  stanceMax: number
  /** swing arc height as a fraction of the hip height */
  liftK: number
  /** fraction of the stride a hand/foot stays planted */
  duty: number
  /** gorilla: massive shoulders and long forearms, so a shorter, slower cycle */
  heavy: boolean
}

const PARAMS: Record<string, Params> = {
  monkey: { cadence: 2.6, hipRise: 0.10, stanceMax: 0.30, liftK: 0.26, duty: 0.60, heavy: false },
  gorilla: { cadence: 1.5, hipRise: 0.05, stanceMax: 0.36, liftK: 0.16, duty: 0.66, heavy: true },
}

const damp = (a: number, b: number, k: number, dt: number): number => a + (b - a) * (1 - Math.exp(-k * dt))
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

const _v = new THREE.Vector3()
const _q1 = new THREE.Quaternion()

type Chain = { spec: LegSpec; base: string; side: number; kind: "arm" | "leg"; rest: THREE.Vector3 }

export class PrimateAnimator {
  private poser: RigPoser
  private chains: Chain[] = []
  private tails: string[] = []
  private p: Params
  private phase: number
  /** hand-over-hand climbing cycle (0..1), advanced by the height climbed */
  private climbPhase = 0
  private move = 0
  private breathe = 0
  private random: () => number
  private blinkTimer = 2
  private blinkTime = 0
  private parentQ = new THREE.Quaternion()
  /** the face rig (jaw, muzzle, brows; iris on the pupil bone) is present */
  private face: boolean
  // ---- face state: bursts that come and go on their own timers -----------
  private smack = 0
  private smackTimer = 0.4
  private smackLeft = 0
  private socialWas = 0
  private coo = 0
  private cooTimer = 9
  private yawn = 0
  private yawnTimer = 30
  private yawnTime = -1
  private gazeYaw = 0
  private gazePitch = 0
  private saccadeYaw = 0
  private saccadePitch = 0
  private saccadeTimer = 0.5
  private cock = 0
  private cockTimer = 3
  // ---- grooming: the picking cycle, a hand to the mouth, a lifted arm ----
  private pick = 0
  private mouthTimer = 4
  private mouthTime = 0
  private liftTimer = 5
  private liftTime = 0
  private liftSide = 1
  private shoulder = new THREE.Vector3()
  private hipH: number
  stepped = false

  constructor(readonly species: Species, model: AnimalModel, seed = 1) {
    this.random = rng(seed)
    this.phase = this.random()
    this.blinkTimer = 1 + this.random() * 4
    this.poser = new RigPoser(model.root, model.bones)
    this.p = PARAMS[species] ?? PARAMS.monkey
    // discovered as front(pair) then hind(pair), matching the BEATS ordering
    for (const [kind, bases] of [["arm", ["armL", "armR"]], ["leg", ["legL", "legR"]]] as const) {
      for (const base of bases) {
        const end = `${kind === "arm" ? "hand" : "foot"}${base.endsWith("L") ? "L" : "R"}`
        if (!this.poser.has(`${base}1`) || !this.poser.has(`${base}2`) || !this.poser.has(end)) continue
        const spec = this.poser.leg(`${base}1`, `${base}2`, end)
        this.chains.push({ spec, base, side: base.endsWith("L") ? 1 : -1, kind, rest: this.poser.pos(end).clone() })
      }
    }
    for (let i = 1; this.poser.has(`tail${i}`); i++) this.tails.push(`tail${i}`)
    this.hipH = this.poser.has("hips") ? this.poser.pos("hips").y : 0.3
    this.face = this.poser.has("muzzle") && this.poser.has("jaw")
    this.yawnTimer = 20 + this.random() * 40
    this.cooTimer = 6 + this.random() * 14
  }

  private cockNow = 0
  private cockDamped(dt: number): number {
    this.cockNow = damp(this.cockNow, this.cock, 3, dt)
    return this.cockNow
  }

  /** Brief, self-timed facial actions (s). Exposed for tests and QA. */
  get expression(): { smack: number; coo: number; yawn: number; gazeYaw: number; gazePitch: number } {
    return { smack: this.smack, coo: this.coo, yawn: this.yawn, gazeYaw: this.gazeYaw, gazePitch: this.gazePitch }
  }

  /**
   * The macaque face, from the expressions real macaques use with each other
   * at peace: the lip-smack (rapid soft jaw and lip flutter, ears back, brows
   * up: friendly, offered at the start of grooming and in bursts during it),
   * the coo (lips pursed forward, a small open mouth, head up: a contact
   * call), the yawn (rare, while resting), half-closed eyes of contentment
   * while being groomed, a knitted brow of concentration while grooming, and
   * curious brows and a head cock when something is worth a look. Eyes make
   * quick saccades between fixations instead of drifting. Nothing here bares
   * teeth or stares: those are threats in macaque language.
   */
  private updateFace(a: PrimatePose, dt: number): { jaw: number; muzzle: number; brow: number; knit: number; ears: number; lids: number; headUp: number } {
    const social = clamp01(a.social ?? 0)
    const groomed = clamp01(a.groomed ?? 0)
    const allogroom = clamp01(a.allogroom ?? 0)
    const curious = clamp01(a.curious ?? 0)
    // lip-smack: one burst when company arrives, then every few seconds
    if (social > 0.5 && this.socialWas <= 0.5) this.smackTimer = 0.15
    this.socialWas = social
    this.smackTimer -= dt
    if (social > 0.3 && this.smackTimer <= 0 && this.smackLeft <= 0) {
      this.smackLeft = 0.8 + this.random() * 1.0
      this.smackTimer = 2.5 + this.random() * 4
    }
    this.smackLeft = Math.max(0, this.smackLeft - dt)
    this.smack = damp(this.smack, this.smackLeft > 0 ? 1 : 0, 12, dt)
    // coo: a contact call now and then when on its own and awake
    this.cooTimer -= dt
    if (this.cooTimer <= 0) {
      this.cooTimer = 12 + this.random() * 25
      if (social < 0.2 && a.sleep < 0.5 && this.yawnTime < 0) this.coo = 0.75
    }
    this.coo = Math.max(0, this.coo - dt)
    const cooW = this.coo > 0 ? Math.sin(Math.min(1, (0.75 - this.coo) / 0.75) * Math.PI) : 0
    // yawn: rare, only when resting or being groomed
    this.yawnTimer -= dt
    if (this.yawnTimer <= 0) {
      this.yawnTimer = 25 + this.random() * 45
      if ((a.sit > 0.7 || groomed > 0.5) && allogroom < 0.2 && this.smackLeft <= 0) this.yawnTime = 0
    }
    if (this.yawnTime >= 0) {
      this.yawnTime += dt
      if (this.yawnTime > 2.4) this.yawnTime = -1
    }
    // slow opening, a held stretch, a quicker close
    const yt = this.yawnTime
    this.yawn = yt < 0 ? 0 : yt < 0.9 ? Math.sin((yt / 0.9) * Math.PI * 0.5) ** 2 : yt < 1.5 ? 1 : Math.max(0, 1 - (yt - 1.5) / 0.9) ** 2
    // gaze: fixations held 0.4-2 s, jumped between in a saccade (fast damp)
    this.saccadeTimer -= dt
    if (this.saccadeTimer <= 0) {
      this.saccadeTimer = 0.4 + this.random() * 1.6
      const range = allogroom > 0.5 ? 0.08 : 0.16
      this.saccadeYaw = (this.random() * 2 - 1) * range
      this.saccadePitch = (this.random() * 2 - 1) * range * 0.5
    }
    const yawGoal = THREE.MathUtils.clamp(a.lookYaw * 0.45 + this.saccadeYaw, -0.24, 0.24)
    const pitchGoal = THREE.MathUtils.clamp(a.lookPitch * 0.3 + this.saccadePitch + allogroom * 0.16 + groomed * 0.06, -0.18, 0.22)
    this.gazeYaw = damp(this.gazeYaw, yawGoal, 28, dt)
    this.gazePitch = damp(this.gazePitch, pitchGoal, 28, dt)
    // a curious head cock now and then
    this.cockTimer -= dt
    if (this.cockTimer <= 0) {
      this.cockTimer = 2 + this.random() * 4
      this.cock = curious > 0.3 ? (this.random() < 0.5 ? -1 : 1) * (0.12 + this.random() * 0.12) : 0
    }
    const flutter = Math.sin(this.breathe * Math.PI * 2 * 5.5)
    const smack = this.smack
    return {
      // the smack is mostly the lips: the jaw barely parts, the muzzle works
      jaw: smack * (0.012 + 0.022 * Math.max(0, flutter)) + cooW * 0.045 + this.yawn * 0.3,
      muzzle: smack * (0.0022 + 0.0016 * flutter) + cooW * 0.0045 - this.yawn * 0.001,
      brow: curious * 0.0024 + smack * 0.0016 + cooW * 0.0012 + this.yawn * 0.0018 - allogroom * 0.0008,
      knit: allogroom * 0.0009,
      ears: smack * 0.35 + groomed * 0.15,
      lids: Math.max(groomed * 0.5, this.yawn * 0.85, allogroom * 0.22, smack * 0.18),
      headUp: cooW * 0.14 + this.yawn * 0.3,
    }
  }

  /** Scratch of `footfall` — no per-frame allocation. */
  private ff = { y: 0, z: 0, s: 0 }

  /**
   * One hand or foot's fore-aft offset `z`, lift `y` and swing weight `s`.
   * Identical contract to QuadrupedAnimator.footfall: the planted end sweeps
   * back at the body's speed so it never skates, the swing eases forward with
   * a lift arc.
   */
  private footfall(ph: number, cycleLen: number, H: number): void {
    const P = this.p
    const duty = P.duty
    const st = Math.min(P.stanceMax * (1 + this.move), cycleLen * duty)
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
    f.y = f.s * (P.liftK * H * Math.min(1, st / (P.stanceMax + 1e-3) + 0.4))
  }

  update(a: PrimatePose): void {
    const dt = Math.min(a.dt, 0.6)
    const P = this.p
    const t = a.time
    const poser = this.poser
    poser.reset()
    const moving = a.speed > 0.05 && a.sleep < 0.5
    this.move = damp(this.move, moving ? 1 : 0, moving ? 8 : 5, dt)
    const w = this.move
    this.breathe += dt
    const breathe = Math.sin(this.breathe * (a.sleep > 0.5 ? 1.5 : 2.4)) * 0.010
    const H = this.hipH
    const cadence = P.cadence * (0.8 + Math.min(1, a.speed / 2) * 0.4)
    const cycleLen = Math.max(0.05, a.speed / cadence)
    const before = this.phase
    this.phase = (this.phase + (a.speed * dt) / cycleLen) % 1
    // one full cycle of both hands per ~0.9 body heights climbed; descending runs it backwards
    const rate = a.climbRate ?? 0
    this.climbPhase = (((this.climbPhase + (rate * dt) / Math.max(0.1, H * 0.9)) % 1) + 1) % 1
    this.stepped = Math.floor(before * 2) !== Math.floor(this.phase * 2)

    const sit = clamp01(a.sit + a.sleep * 0.8)
    const climb = clamp01(a.climb)
    const air = clamp01(a.air)
    const crouch = clamp01(a.crouch)
    const gait = a.speed > 0.05 ? w : 0

    // ---- body ---------------------------------------------------------------
    // A walking primate is a level quadruped: the torso is held flat and the
    // hips ride only slightly above the shoulders. Sitting folds the torso
    // upright and drops the hips onto the ground, which is what separates a
    // perched monkey from one on all fours.
    let bodyY = breathe * H
    let bodyPitch = 0
    let bodyRoll = 0
    bodyY -= sit * H * 0.70
    bodyPitch -= sit * 0.95
    bodyY += -crouch * H * 0.14
    bodyPitch += crouch * 0.16
    bodyY += air * H * 0.06
    bodyPitch += air * 0.22
    bodyRoll += Math.sin(t * 1.1) * 0.03 * sit + a.happy * Math.sin(t * 2.2) * 0.05
    bodyY += (a.alert * 0.05 - a.sleep * 0.35) * H
    bodyPitch += a.sleep * 0.35
    poser.offset("hips", 0, bodyY, 0)
    poser.euler("hips", bodyPitch, -a.turnRate * 0.04 * w + a.sleep * 0.3, bodyRoll)
    poser.euler(
      "chest",
      sit * 0.30 - breathe - climb * 0.25 - air * 0.20 + a.alert * 0.18 + a.groom * 0.15,
      a.sleep * 0.25 + a.lookYaw * 0.20 - bodyRoll * 0.4,
      Math.sin(t * 0.8) * 0.04 * sit,
    )

    // ---- face -------------------------------------------------------------
    const face = this.updateFace(a, dt)
    const allogroom = clamp01(a.allogroom ?? 0)
    const groomed = clamp01(a.groomed ?? 0)
    // sitting is S-shaped: the chest opens up and the lumbar rounds; a groomer
    // leans in over the partner's back, a groomee slumps with its head bowed
    if (poser.has("spine")) {
      poser.euler(
        "spine",
        sit * 0.42 + breathe * 1.6 - crouch * 0.2 + air * 0.18 + a.sleep * 0.3 + allogroom * 0.22 + groomed * 0.18,
        a.sleep * 0.2 + a.happy * Math.sin(t * 1.7) * 0.06,
        -bodyRoll * 0.5,
      )
    }

    // ---- head ---------------------------------------------------------------
    const chew = Math.max(a.eat, this.mouthTime > 0 ? 0.6 : 0) * (0.5 + 0.5 * Math.sin(this.breathe * 7))
    const bow = allogroom * 0.30 + groomed * 0.28 - face.headUp
    poser.euler("neck", a.lookPitch * 0.35 + sit * 0.12 - climb * 0.35 + a.alert * 0.20 + chew * 0.10 + bow * 0.45, a.lookYaw * 0.35, 0)
    this.cock = this.cock * (1 - Math.min(1, dt * 0.4))
    poser.euler(
      "head",
      a.lookPitch * 0.55 + sit * 0.10 - climb * 0.20 + a.alert * 0.28 + chew * 0.16 + a.sleep * 0.2 + bow * 0.55,
      a.lookYaw * 0.55 + a.sleep * 0.3 + a.happy * Math.sin(t * 0.9) * 0.08,
      Math.sin(t * 0.7) * 0.10 * sit + a.sleep * 0.35 + a.happy * 0.06 + groomed * 0.18 + this.cockDamped(dt),
    )
    // Peaceful open mouth: a small relaxed gap, never a snarl or a roar.
    if (poser.has("jaw")) poser.euler("jaw", a.eat * 0.22 + chew * 0.10 + (this.face ? 0 : a.happy * 0.06) + face.jaw, chew * 0.15, 0)
    if (this.face) {
      poser.euler("tongue", -face.jaw * 0.4, 0, 0)
      poser.offset("muzzle", 0, -face.muzzle * 0.2, face.muzzle)
      poser.offset("browL", -face.knit, face.brow - face.knit, 0)
      poser.offset("browR", face.knit, face.brow - face.knit, 0)
      // the iris rides the pupil bone, so this turns the whole eye
      poser.euler("pupilL", this.gazePitch, this.gazeYaw, 0)
      poser.euler("pupilR", this.gazePitch, this.gazeYaw, 0)
    }

    // ---- eyes / ears ----------------------------------------------------------
    this.blinkTimer -= dt
    if (this.blinkTimer <= 0) { this.blinkTimer = 2.5 + this.random() * 4; this.blinkTime = 0.18 }
    this.blinkTime = Math.max(0, this.blinkTime - dt)
    const close = Math.min(1, Math.max(a.sleep, Math.sin(this.blinkTime / 0.18 * Math.PI), a.alert * 0.25, face.lids))
    poser.scale("eyeL", 1, 1 - close * 0.94, 1)
    poser.scale("eyeR", 1, 1 - close * 0.94, 1)
    if (poser.has("pupilL") && !this.face) {
      const d = 0.5 + a.alert * 0.3
      poser.scale("pupilL", 0.85 + d * 0.15, 1, 0.85 + d * 0.15)
      poser.scale("pupilR", 0.85 + d * 0.15, 1, 0.85 + d * 0.15)
    }
    if (poser.has("earL")) {
      // ears turn toward a sound; they flatten only when genuinely startled
      // the lip-smack and contentment lay them back; curiosity turns them forward
      const swivel = a.alert * 0.4 + Math.sin(t * 0.9) * 0.06 + clamp01(a.curious ?? 0) * 0.25 - face.ears
      poser.euler("earL", -a.sleep * 0.4 - a.alert * 0.5 - face.ears * 0.4, swivel * 0.5, swivel * 0.4)
      poser.euler("earR", -a.sleep * 0.4 - a.alert * 0.5 - face.ears * 0.4, swivel * 0.5, -swivel * 0.4)
    }

    // ---- tail: the monkey's balance and flourish (a gorilla has none) --------
    const n = this.tails.length
    if (n > 0) {
      // a long prehensile tail coils up while sitting or climbing and streams
      // out behind while running
      const coil = sit * 0.9 + climb * 0.7 + air * 0.5
      for (let i = 0; i < n; i++) {
        const u = n > 1 ? i / (n - 1) : 0
        const wave = Math.sin(t * 2.1 - u * 2.0)
        const pitch = -coil * (0.10 + u * 0.34) + wave * 0.05 * (1 - coil) + gait * 0.10
        const yaw = wave * (0.10 + u * 0.14) * (1 - coil * 0.5) + a.happy * 0.12 * u
        poser.euler(this.tails[i], pitch, yaw, wave * 0.08 * u)
      }
    }

    // grooming timers: the picking rhythm, a hand to the mouth, a lifted arm
    this.pick += dt * 1.5 * (allogroom > 0.1 ? 1 : 0)
    this.mouthTimer -= dt * (allogroom > 0.5 ? 1 : 0)
    if (this.mouthTimer <= 0) { this.mouthTimer = 3.5 + this.random() * 4; this.mouthTime = 0.9 }
    this.mouthTime = Math.max(0, this.mouthTime - dt)
    this.liftTimer -= dt * (groomed > 0.5 ? 1 : 0)
    if (this.liftTimer <= 0) { this.liftTimer = 6 + this.random() * 6; this.liftTime = 3.2; this.liftSide = this.random() < 0.5 ? 1 : -1 }
    this.liftTime = Math.max(0, this.liftTime - dt)

    // ---- limbs ----------------------------------------------------------------
    // Arms swing in antiphase with the legs (a diagonal primate walk); legs use
    // a lateral-sequence 4-beat like the quadrupeds. Sitting folds the hind
    // legs right under the hips and drops the arms to the ground either side.
    const parentQ = this.parentQ
    for (let ci = 0; ci < this.chains.length; ci++) {
      const c = this.chains[ci]
      const isArm = c.kind === "arm"
      // FL/FR then BL/BR ordering: index 0,1 = arms, 2,3 = legs
      const beat = isArm ? (c.side > 0 ? 0 : 0.5) : (c.side > 0 ? 0.25 : 0.75)
      this.footfall((this.phase + beat) % 1, cycleLen, H)
      const z = this.ff.z * gait
      const y = this.ff.y * gait
      const target = _v.copy(c.rest)
      target.z += z
      target.y += y

      if (isArm) {
        // climbing hand over hand: each hand grips the bark (fixed on the
        // trunk, so it slides down the body as she rises), lets go, swings up
        // clear of the bark and grips again above her head; the two hands
        // alternate by half a cycle, so one always holds on
        if (climb > 0) {
          const p = (this.climbPhase + (c.side > 0 ? 0 : 0.5)) % 1
          const hold = p < 0.62
          const u = hold ? p / 0.62 : (p - 0.62) / 0.38
          const top = H * 2.0, low = H * 1.3
          const reachY = hold ? top + (low - top) * u : low + (top - low) * (u * u * (3 - 2 * u))
          // gripping, the hand is on the bark; swinging, it arcs a little off it
          const off = hold ? 0 : Math.sin(Math.PI * u) * H * 0.12
          target.y = THREE.MathUtils.lerp(target.y, c.rest.y + reachY, climb)
          target.z = THREE.MathUtils.lerp(target.z, c.rest.z + H * 0.22 - off, climb)
          target.x = THREE.MathUtils.lerp(target.x, c.rest.x * (hold ? 0.8 : 1.05), climb)
        }
        // sitting: the hands rest on the ground beside the hips, for support
        if (sit > 0) {
          target.y = THREE.MathUtils.lerp(target.y, H * 0.10, sit)
          target.z = THREE.MathUtils.lerp(target.z, c.rest.z + H * 0.30, sit)
          target.x = THREE.MathUtils.lerp(target.x, c.rest.x * 1.5, sit)
        }
        // eating / grooming: one hand comes up to the mouth
        if ((a.eat > 0 || a.groom > 0) && c.side > 0) {
          const up = Math.max(a.eat, a.groom * 0.8)
          target.y = THREE.MathUtils.lerp(target.y, H * (0.85 + 0.1 * Math.sin(t * 3)), up)
          target.z = THREE.MathUtils.lerp(target.z, c.rest.z + H * 0.45, up)
          target.x = THREE.MathUtils.lerp(target.x, c.rest.x * 0.3, up)
        }
        // grooming a partner: both hands forward on its back, one holding the
        // fur parted while the other picks through it; now and then the
        // picking hand carries something to the mouth
        if (allogroom > 0) {
          const picking = (c.side > 0) === (Math.sin(this.pick * 0.5) > 0)
          const stroke = picking ? Math.sin(this.pick * Math.PI * 2) : 0
          const toMouth = c.side > 0 && this.mouthTime > 0 ? Math.sin(Math.min(1, this.mouthTime / 0.9) * Math.PI) : 0
          // close in, elbows bent: the fur is worked at arm's half-length
          const gy = H * (0.86 + stroke * 0.05)
          const gz = c.rest.z + H * (0.55 - Math.abs(stroke) * 0.05)
          const gx = c.rest.x * 0.5 + c.side * H * stroke * 0.05
          target.y = THREE.MathUtils.lerp(target.y, THREE.MathUtils.lerp(gy, H * 1.05, toMouth), allogroom)
          target.z = THREE.MathUtils.lerp(target.z, THREE.MathUtils.lerp(gz, c.rest.z + H * 0.45, toMouth), allogroom)
          target.x = THREE.MathUtils.lerp(target.x, THREE.MathUtils.lerp(gx, c.rest.x * 0.25, toMouth), allogroom)
        }
        // being groomed: now and then an arm lifts high to offer the flank
        if (groomed > 0 && this.liftTime > 0 && c.side === this.liftSide) {
          const up = groomed * Math.min(1, Math.sin(Math.min(1, this.liftTime / 3.2) * Math.PI) * 2.2)
          // lifted out to the side and up, opening the flank, elbow soft
          target.y = THREE.MathUtils.lerp(target.y, H * 1.2, up)
          target.z = THREE.MathUtils.lerp(target.z, c.rest.z + H * 0.2, up)
          target.x = THREE.MathUtils.lerp(target.x, c.rest.x * 2.3, up)
        }
        // airborne: arms trail back and out for balance
        if (air > 0) {
          target.y = THREE.MathUtils.lerp(target.y, c.rest.y + H * 0.25, air)
          target.z = THREE.MathUtils.lerp(target.z, c.rest.z - H * 0.45, air)
          target.x = THREE.MathUtils.lerp(target.x, c.rest.x * 1.8, air)
        }
        if (crouch > 0) {
          target.y = THREE.MathUtils.lerp(target.y, H * 0.16, crouch)
          target.z = THREE.MathUtils.lerp(target.z, c.rest.z - H * 0.10, crouch)
        }
      } else {
        // sitting: the hind leg folds under the hip, knee forward, foot flat
        if (sit > 0) {
          target.y = THREE.MathUtils.lerp(target.y, H * 0.06, sit)
          target.z = THREE.MathUtils.lerp(target.z, c.rest.z + H * 0.34, sit)
          target.x = THREE.MathUtils.lerp(target.x, c.rest.x * 1.35, sit)
        }
        if (a.sleep > 0) {
          target.y = THREE.MathUtils.lerp(target.y, H * 0.10, a.sleep)
          target.z = THREE.MathUtils.lerp(target.z, c.rest.z + H * 0.25, a.sleep)
        }
        // airborne: the hind legs tuck up under the belly
        if (air > 0) {
          target.y = THREE.MathUtils.lerp(target.y, c.rest.y + H * 0.45, air)
          target.z = THREE.MathUtils.lerp(target.z, c.rest.z - H * 0.18, air)
        }
        if (crouch > 0) {
          target.y = THREE.MathUtils.lerp(target.y, H * 0.10, crouch)
          target.z = THREE.MathUtils.lerp(target.z, c.rest.z - H * 0.16, crouch)
        }
      }

      if (a.fullIK) {
        const upper = c.spec.upper
        const parentName = poser.recs.get(upper)!.bone.parent?.name
        if (parentName) poser.accumulated(parentName, parentQ)
        else parentQ.identity()
                const anchor = this.poser.posedHead(upper, this.shoulder)
        poser.solveLeg(c.spec, anchor, target, parentQ)
        // a hand or foot keeps its rest orientation so the knuckles stay flat
        // on the branch and the sole stays on the ground
        if (c.kind === "leg") {
          const acc = poser.accumulated(c.spec.lower, _q1)
          poser.setDelta(c.spec.end, acc.invert())
        }
      } else {
        const stride = THREE.MathUtils.clamp(z / (0.30 * H), -1.6, 1.6) * 0.45
        poser.euler(c.spec.upper, stride * (isArm ? 1 : 1) + sit * (isArm ? 0.5 : -1.0) + air * (isArm ? 0.8 : -0.7) + climb * (isArm ? -2.4 : 0.3), 0, 0)
        poser.euler(c.spec.lower, -stride * 0.6 + sit * (isArm ? -0.5 : 1.1) - air * 0.5 + climb * (isArm ? 1.0 : -0.3), 0, 0)
      }
    }
    poser.apply()
  }
}
