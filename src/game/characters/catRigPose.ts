import { damp, smoothstep } from "../../utils/math"
import type { AnimalPose } from "../../world/wildlife/QuadrupedAnimator"

/**
 * Maps the companion cat's behaviour state machine onto the wildlife cat rig.
 *
 * `CompanionCat` keeps every bit of its behaviour — navigation, the cat state
 * machine, the autonomy excursions, affection, the jump arc — and this module
 * only decides how all of that *looks*. The wildlife `QuadrupedAnimator` owns
 * the gaits, the IK and the shared body layers; the companion drives every
 * expressive layer it offers: jaw, tongue, pupils, lids, whiskers, ears, all
 * six tail segments and the whole-body actions.
 *
 * This is deliberately pure and allocation free: `CompanionCat` owns one
 * scratch pose and one blend object for the lifetime of the component.
 */

/**
 * Normalised gait drive from the companion's world speed.
 *
 * The companion's tuned speeds (a 3.2 m/s trot, an 8.7 m/s sprint) are far
 * beyond what this rig can stride, and the animator expects a normalised
 * 0–1 drive anyway — the wildlife feeds it `speed / scale`. Measuring the rig
 * shows the walk→trot handover near 1.2 and the stride saturating by ~2.6, so
 * the companion's brisk trot is mapped to a full trot and the sprint to the
 * same gait running a faster cycle. That keeps the paws on the ground: the
 * animator derives the stance from the pose speed, and an over-driven stance
 * is what makes a paw skate.
 */
export const companionGaitSpeed = (speed: number): number => {
  if (speed <= 0.05) return 0
  return speed >= 3.2 ? 1 : speed / 3.2
}

/**
 * Gait above the trot. She catches up with the explorer at up to 11.5 m/s, which no
 * trot can show: from ~4.6 m/s the trot hands over to a rotary gallop (spine
 * flexing and extending, a gathered suspension), fully galloping by 7.2 m/s.
 * The blend is continuous in speed, so accelerating never pops a footfall.
 */
export const companionGallop = (speed: number): number => smoothstep(4.6, 7.2, speed)

/**
 * Step-frequency multiplier on the cat's cadence: the trot quickens past its
 * stride limit and the gallop runs at ~3.5 Hz rising to ~4.5 Hz flat out.
 */
export const companionCadence = (speed: number): number => 1 + clamp((speed - 3.2) / 6, 0, 1) * 0.42

/** Smoothed 0–1 weights for the behaviours that overlap and cross-fade. */
export type CompanionBlend = {
  sit: number
  sleep: number
  crouch: number
  stretch: number
  chase: number
  investigate: number
  jump: number
  jumpApproach: number
  look: number
  affection: number
  greet: number
  rub: number
  petted: number
  meow: number
  scared: number
  groom: number
  knead: number
  roll: number
  yawn: number
  scratch: number
  loaf: number
  shake: number
  /** contented walking beside the explorer (tail held high) */
  content: number
  /** settled long enough to wrap the tail round the paws */
  settled: number
}

export const createCompanionBlend = (): CompanionBlend => ({
  sit: 0,
  sleep: 0,
  crouch: 0,
  stretch: 0,
  chase: 0,
  investigate: 0,
  jump: 0,
  jumpApproach: 0,
  look: 0,
  affection: 0,
  greet: 0,
  rub: 0,
  petted: 0,
  meow: 0,
  scared: 0,
  groom: 0,
  knead: 0,
  roll: 0,
  yawn: 0,
  scratch: 0,
  loaf: 0,
  shake: 0,
  content: 0,
  settled: 0,
})

/** Everything the pose needs to know about the companion this frame. */
export type CompanionPoseInput = {
  /** `CatState` */
  state: string
  /** seconds in the current state */
  stateTime?: number
  /** world speed in m/s */
  speed: number
  /** heading change, rad/s */
  turnRate: number
  /** direction to the explorer relative to the cat's own facing, in radians */
  explorerBearing: number
  navMode: string
  affectionKind: "nuzzle" | "paw"
  /** 0–1 blend of the whole affectionate idle moment */
  affectionPose: number
  /** terrain gradient along and across the facing */
  slope: number
  crossSlope: number
  /** 0 bright daylight … 1 night (pupils open in the dark) */
  dark?: number
  /** 0–1 jaw envelope of the current vocalisation (meow, hiss, trill) */
  voice?: number
  /** 0–1 slow-blink envelope ("I trust you") */
  slowBlink?: number
  /** which side the explorer's legs are on while she rubs: 1 left, −1 right */
  rubSide?: number
  /** forepaw used for grooming / hind leg scratching, ±1 */
  actSide?: number
  /** side the tail wraps to when she sits */
  tailSide?: number
  /** 0–1 position of the explorer's stroke along her back (head → tail) */
  stroke?: number
  /** a pounce is imminent: rump wiggle */
  pounce?: number
  /** recently soaked by rain */
  wet?: number
  /** 0..1 swimming: legs paddle, chin up, tail floating out behind */
  swim?: number
  /** jump progress: -1..0 the gather crouch, 0..1 the arc; undefined when not jumping */
  jumpT?: number
  /** 0..1 landing compression (CompanionCat catTouchdown) */
  touchdown?: number
  /** ground height under a paw at model (x, z), relative to the body origin */
  groundAt?: (x: number, z: number) => number
}

export type CompanionPoseScratch = AnimalPose & {
  crouch: number
  stretch: number
  leap: number
  reach: number
}

const STATES_SITTING = new Set(["sit", "meow", "petted", "scratch", "groom"])

/**
 * Advance the smoothed behaviour weights.
 *
 * Rates are slower than the wildlife's on purpose. A wild cat startles; the
 * companion is meant to read as a deliberate cat that chooses its posture.
 */
export const stepCompanionBlend = (
  blend: CompanionBlend,
  input: CompanionPoseInput,
  dt: number,
): void => {
  const state = input.state
  const is = (s: string): number => (state === s ? 1 : 0)
  blend.sit = damp(blend.sit, STATES_SITTING.has(state) ? 1 : 0, 5, dt)
  blend.sleep = damp(blend.sleep, is("sleep"), 3.2, dt)
  blend.crouch = damp(blend.crouch, is("crouch"), 7, dt)
  blend.stretch = damp(blend.stretch, is("stretch"), 4.5, dt)
  blend.chase = damp(blend.chase, state === "chase" || state === "runAhead" ? 1 : 0, 6, dt)
  blend.investigate = damp(blend.investigate, is("investigate"), 5, dt)
  // The jump arc is authored, so it should snap on and off with the arc
  // rather than ease, or the body lags its own trajectory.
  blend.jump = damp(blend.jump, input.navMode === "jump" ? 1 : 0, 18, dt)
  blend.jumpApproach = damp(blend.jumpApproach, input.navMode === "jumpApproach" ? 1 : 0, 11, dt)
  blend.look = damp(blend.look, is("lookAround"), 5, dt)
  blend.affection = damp(blend.affection, input.affectionPose, 8, dt)
  blend.greet = damp(blend.greet, is("greet"), 6, dt)
  blend.rub = damp(blend.rub, is("rub"), 5, dt)
  blend.petted = damp(blend.petted, is("petted"), 4, dt)
  blend.meow = damp(blend.meow, is("meow"), 5, dt)
  // a fright is instant; calming down is slow
  blend.scared = damp(blend.scared, is("scared"), state === "scared" ? 22 : 1.6, dt)
  blend.groom = damp(blend.groom, is("groom"), 4, dt)
  blend.knead = damp(blend.knead, is("knead"), 4, dt)
  blend.roll = damp(blend.roll, is("roll"), 2.6, dt)
  blend.yawn = damp(blend.yawn, is("yawn") * yawnEnvelope(input.stateTime ?? 0), 9, dt)
  blend.scratch = damp(blend.scratch, is("scratch"), 6, dt)
  blend.loaf = damp(blend.loaf, is("loaf"), 3, dt)
  blend.shake = damp(blend.shake, is("shake") * shakeEnvelope(input.stateTime ?? 0), 14, dt)
  const strolling = (state === "follow" || state === "greet" || state === "rub") && input.speed > 0.1 && input.speed < 4.5
  blend.content = damp(blend.content, strolling ? 1 : 0, 3, dt)
  const resting = STATES_SITTING.has(state) || state === "loaf" || state === "lookAround"
  blend.settled = damp(blend.settled, resting && (input.stateTime ?? 0) > 1.2 ? 1 : 0, 1.5, dt)
}

/** A yawn opens slowly, holds wide, and snaps shut. */
export const yawnEnvelope = (t: number): number => {
  if (t < 0.2) return 0
  if (t < 1.0) return (t - 0.2) / 0.8
  if (t < 1.6) return 1
  return Math.max(0, 1 - (t - 1.6) / 0.35)
}

/** The shake is a short burst. */
export const shakeEnvelope = (t: number): number => (t < 0.08 ? t / 0.08 : t < 0.9 ? 1 : Math.max(0, 1 - (t - 0.9) / 0.3))

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)

/**
 * Fill the animator's pose struct.
 *
 * `lookPitch` is positive *downward* on this rig (verified against the authored
 * rest axes), so a lifted head needs a negative value.
 */
export const composeCompanionPose = (
  blend: CompanionBlend,
  input: CompanionPoseInput,
  dt: number,
  time: number,
  out: CompanionPoseScratch,
): void => {
  // Airborne, the body follows a scripted arc that no velocity describes, so
  // the legs tuck and extend instead of cycling against it.
  const airborne = blend.jump > 0.02
  let speed = airborne ? 0 : companionGaitSpeed(input.speed)
  // Stalking is slow even where the state would allow more: a cat that rushes
  // while crouched reads as broken rather than predatory.
  speed *= 1 - blend.crouch * 0.78
  // a cat on her back, loafing or mid-groom is not walking, even if the
  // navigation is still easing her into place
  speed *= 1 - Math.max(blend.roll, blend.loaf, blend.groom, blend.scratch) * 0.9

  const bearing = clamp(input.explorerBearing, -1, 1)
  const st = input.stateTime ?? 0

  out.dt = dt
  out.time = time
  out.speed = speed
  // a stalk or a lazy roll never breaks into a gallop
  out.gallop = airborne ? 0 : companionGallop(input.speed) * (1 - blend.crouch) * (1 - Math.max(blend.roll, blend.loaf))
  out.cadence = companionCadence(input.speed)
  out.turnRate = input.turnRate
  // `sit` lowers the haunches onto the ground. Measured on the rig, `sit=1`
  // drops the hips 0.09 m and lifts the head — the correct sit.
  out.sit = Math.max(blend.sit - blend.groom - blend.scratch, 0)
  out.sleep = blend.sleep
  out.graze = 0
  out.happy =
    blend.affection * 0.55 +
    blend.chase * 0.3 +
    blend.petted * 0.5 +
    blend.rub * 0.4 +
    (!airborne && input.speed > 3.6 ? 0.25 : 0)
  const swim = input.swim ?? 0
  out.swim = swim
  out.stroke = 2.4
  out.crouch = blend.crouch
  out.stretch = blend.stretch
  // The leap peaks mid-arc: the legs are fully extended at the apex and are
  // back under the body at take-off and landing.
  out.leap = blend.jump
  // the arc's phase stages the legs: spring, stretch, reach down to land
  const jt = input.jumpT
  out.leapT = jt === undefined ? undefined : Math.max(0, jt)
  // sinking into the gather, then released in the first instant of the spring
  out.gather = jt === undefined ? 0 : jt < 0 ? 1 + jt : Math.max(0, 1 - jt / 0.08)
  out.touchdown = input.touchdown ?? 0
  out.groundAt = input.groundAt
  // Nuzzling lowers the head onto the explorer's hand; pawing reaches forward instead.
  out.reach = blend.affection * (input.affectionKind === "paw" ? 1 : 0)

  // ---- gaze -------------------------------------------------------------------
  // `explorerBearing` is already relative to the cat's facing, so the neck's own
  // yaw takes it directly. It is clamped because a bearing near ±π means the explorer
  // is behind the cat and twisting the neck fully reads as a glitch.
  const attend = blend.affection * 0.75 + blend.look * 0.55 + blend.meow * 0.8 + blend.petted * 0.35 + blend.greet * 0.6 + blend.settled * 0.35
  out.lookYaw = bearing * Math.min(1, attend)
  // the petted head pushes up into the explorer's palm as her hand passes over it
  const stroke = input.stroke ?? 0
  const palm = blend.petted * Math.max(0, 1 - Math.abs(stroke - 0.12) * 4)
  out.lookPitch =
    // Investigating a scent puts the nose to the ground.
    blend.investigate * 0.8 +
    // Looking around is mostly a head turn with a level gaze.
    blend.look * 0.15 -
    // Nuzzling drops the head; pawing looks up at the explorer instead.
    blend.affection * (input.affectionKind === "nuzzle" ? 0.45 : -0.18) -
    // asking for attention: head up toward her face
    blend.meow * 0.45 -
    blend.greet * 0.2 -
    palm * 0.35 +
    blend.scared * 0.15
  // swimming: chin up, nose and whiskers clear of the water
  out.lookPitch -= swim * 0.45
  out.headTilt = blend.look * Math.sin(time * 0.6) * 0.22 + blend.meow * 0.12 * Math.sin(time * 0.9) + palm * 0.2

  // ---- face --------------------------------------------------------------------
  const voice = input.voice ?? 0
  // the hiss shows the fangs: the jaw stays open while the fright peaks
  const hiss = blend.scared * (st < 1.4 ? 1 : 0)
  out.mouth = Math.max(voice, hiss * 0.75)
  out.tongue = 0
  const dark = input.dark ?? 0
  const excited = Math.max(blend.chase, blend.crouch, blend.greet * 0.6, blend.investigate * 0.3)
  // Even in sunshine her pupils stay a soft oval rather than a hairline slit
  // (that reads as a snake's eye), and at night they open wide but always
  // keep a ring of green: a fully black eye reads as a doll's, not a cat's.
  out.pupil = clamp(0.36 + dark * 0.42 + excited * 0.4 + blend.scared + blend.petted * 0.1, 0, 0.86)
  // contentment narrows the eyes; the slow blink closes them almost fully
  out.lids = clamp((input.slowBlink ?? 0) * 0.9 + blend.petted * 0.55 + blend.knead * 0.5 + blend.rub * 0.25 + blend.loaf * 0.35 * (1 - blend.settled * 0.3), 0, 0.93)
  out.whisker = clamp(
    blend.investigate * 0.7 + blend.greet * 0.4 + blend.petted * 0.25 + blend.crouch * 0.8 + blend.chase * 0.5 - blend.scared - blend.loaf * 0.3,
    -1,
    1,
  )
  out.earFlat = clamp(blend.scared * (1 - st * 0.05) + blend.shake * 0.3, 0, 1)
  // ears follow her attention to the explorer even when the head doesn't
  out.earSwivel = bearing * 0.5 * (blend.settled + blend.loaf) + Math.sin(time * 0.37) * 0.15 * blend.look

  // ---- tail --------------------------------------------------------------------
  out.tailUp = clamp(blend.greet + blend.rub + blend.petted * 0.85 + blend.content * 0.6 + blend.meow * 0.4 - blend.scared * 0.3, 0, 1)
  out.tailPuff = blend.scared
  out.tailLash = clamp(blend.crouch * 0.35 + (input.pounce ?? 0) * 0.4 + blend.scared * 0.3, 0, 1)
  out.tailWrap = clamp(blend.settled * (1 - blend.greet) + blend.loaf * 0.8, 0, 1) * (1 - swim)
  out.tailUp *= 1 - swim
  out.tailSide = input.tailSide ?? 1

  // ---- actions -----------------------------------------------------------------
  // arched only while standing her ground; running for the explorer she flattens
  out.arch = blend.scared * (input.speed > 0.6 ? 0.25 : 1)
  out.wiggle = (input.pounce ?? 0) * blend.crouch
  out.knead = blend.knead
  out.groom = blend.groom
  out.actSide = input.actSide ?? 1
  out.roll = blend.roll
  // bunting: flank toward the explorer while weaving; a head bump at the end of a stroke
  const bump = blend.petted * Math.max(0, Math.sin(clamp((stroke - 0.85) / 0.15, 0, 1) * Math.PI))
  out.rub = blend.rub * (input.rubSide ?? 1) * 0.9 + bump * 0.6
  out.scratch = blend.scratch
  out.yawn = blend.yawn
  out.shake = blend.shake + (input.wet ?? 0) * 0
  out.loaf = blend.loaf
  out.alert = blend.scared * 0.3 + blend.look * 0.15
  out.slope = input.slope
  out.crossSlope = input.crossSlope
  // The companion is always close to the camera when it matters, so it always
  // gets the full IK solve.
  out.fullIK = true
}

/**
 * How far the rig sinks below the root while it is folded up, per state.
 *
 * The animator lowers the hips for `sit`, `sleep` and `crouch` while the IK
 * keeps the paws on their authored height, so the body ends up partly below
 * the ground plane. The companion's root therefore has to be lifted back by
 * however much it sank, or she visibly clips through the terrain.
 *
 * These are the worst-case values measured over a full 300-frame settle of the
 * cat rig, so they hold for every frame of the pose rather than its rest value.
 * `tests/companionPose.test.ts` re-measures them against the exported rig.
 */
export const GROUND_SINK = {
  sit: 0,
  sleep: 0.101,
  crouch: 0.025,
  stretch: 0.003,
  loaf: 0.039,
  roll: 0,
} as const

/**
 * Root lift that keeps the lowest paw on the ground for the current blend.
 * States are additive rather than mutually exclusive, which matches how the
 * animator's own layers stack.
 */
export const companionGroundSink = (blend: {
  sit: number
  sleep: number
  crouch: number
  stretch: number
  loaf?: number
  roll?: number
}): number =>
  blend.sit * GROUND_SINK.sit +
  blend.sleep * GROUND_SINK.sleep +
  blend.crouch * GROUND_SINK.crouch +
  blend.stretch * GROUND_SINK.stretch +
  (blend.loaf ?? 0) * GROUND_SINK.loaf +
  (blend.roll ?? 0) * GROUND_SINK.roll
