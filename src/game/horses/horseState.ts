import * as THREE from "three"
import type { CharacterId } from "../runtime"
import { gaitSpeeds, type HorseIdentity } from "./breeds"
import type { HorseModel } from "./horseAssets"
import type { HorseAnimator } from "./HorseAnimator"
import { makeHorsePose, type HorsePose } from "./HorseAnimator"
import type { FlightState } from "../pegasus/flight"
import { makeGlide, type Glide } from "../../utils/renderGlide"

/**
 * What a horse is doing when nobody rides it. Timings and proportions follow
 * equine time budgets: free-ranging horses spend most of the day grazing,
 * a good part standing at rest (dozing on a "cocked" hind leg thanks to the
 * stay apparatus), and only a little lying down, which they need for REM sleep.
 */
export type HorseMode =
  | "graze" | "stand" | "walk" | "drink" | "lie" | "alert" | "curious" | "come" | "follow" | "wait" | "ridden" | "flee"

export type HorseState = {
  kind: "horse"
  ident: HorseIdentity
  /** home herd and bonded horses are persistent; wild ones stream with chunks */
  persistent: boolean
  chunk: string | null
  // ---- physical state (logical world space) -------------------------------
  x: number
  y: number
  z: number
  heading: number
  /** forward speed (m/s; negative when backing) */
  speed: number
  targetSpeed: number
  /** desired heading for AI steering, or null to hold the current one */
  wantHeading: number | null
  /** rider steering −1..1 (overrides wantHeading when ridden) */
  steer: number
  turnRate: number
  accel: number
  /** 1 full … 0 blown; recovers at rest */
  stamina: number
  exertion: number
  wade: number
  /** 0..1 swimming (out of its depth, afloat) */
  swim: number
  /** a free horse's dip after drinking: 0 none, 1 walking in, 2 standing/pawing in it, 3 walking out */
  bathe: 0 | 1 | 2 | 3
  bankX: number
  bankZ: number
  blocked: number
  /** jump: progress 0..1 (−1 on the ground), duration (s), peak height (m) and current lift */
  jumpT: number
  jumpDur: number
  jumpH: number
  jumpY: number
  jumpCool: number
  /** set for one frame on touching down (sound, dust, the rider absorbs it) */
  landed: boolean
  // ---- behaviour ------------------------------------------------------------
  mode: HorseMode
  modeTime: number
  timer: number
  tx: number
  tz: number
  homeX: number
  homeZ: number
  homeRange: number
  /** another horse this one keeps company with */
  buddy: HorseState | null
  /** the thing being watched (alert / curious) */
  watchX: number
  watchZ: number
  /** befriending: pets accumulate trust */
  trust: number
  lastPet: number
  /** lead for canter/gallop: +1 left, −1 right */
  lead: number
  // ---- riding ------------------------------------------------------------------
  /** the rider in the (front) saddle, who holds the reins */
  rider: CharacterId | null
  /** a second rider in the rear seat of a tandem saddle (Starborn) */
  passenger: CharacterId | null
  /** winged horses: the flight model (null for a plain horse) */
  flight: FlightState | null
  /** a character who is mounting or has called this horse */
  reservedBy: CharacterId | null
  // ---- presentation ---------------------------------------------------------
  pose: HorsePose
  model: HorseModel | null
  animator: HorseAnimator | null
  loading: boolean
  failed: boolean
  visible: boolean
  /** where it is drawn between its (far, infrequent) steps, and the model's
   * offset from its feet (tilt pivot, jump) at the last full update */
  glide: Glide
  rootOffset: THREE.Vector3
  rootQuat: THREE.Quaternion
  rootHeading: number
  /** seconds since the animator last ran (reduced-rate far tier) */
  animClock: number
  gestureTimers: { headShake: number; paw: number; snort: number; shake: number; swish: number }
  /** posed rider anchors (world) */
  seatWorld: THREE.Vector3
  stirrupL: THREE.Vector3
  stirrupR: THREE.Vector3
  bitL: THREE.Vector3
  bitR: THREE.Vector3
  /** where the reins lie over the crest when nobody holds them (world) */
  reinRest: THREE.Vector3
  random: () => number
  /** QA: drive this horse at a fixed speed in a gentle circle */
  debugSpeed: number | null
  /** pinned ears and a cross look after a bump (s) */
  irritated: number
  /** the jolt of running into something solid (0..1, decaying), and its rest (s) */
  impact: number
  impactCool: number
  /** sideways shove from a bump, eased out (m) */
  shoveX: number
  shoveZ: number
  /** QA: hidden while another horse is inspected alone */
  soloHidden?: boolean
}

export const makeHorseState = (ident: HorseIdentity, x: number, z: number, persistent: boolean, chunk: string | null = null): HorseState => {
  let s = (ident.seed % 2147483646) + 1
  const random = (): number => ((s = (s * 16807) % 2147483647) / 2147483647)
  const pose = makeHorsePose()
  pose.speeds = gaitSpeeds(ident)
  return {
    kind: "horse", ident, persistent, chunk,
    x, y: 0, z, heading: random() * Math.PI * 2, speed: 0, targetSpeed: 0, wantHeading: null, steer: 0, turnRate: 0, accel: 0,
    stamina: 1, exertion: 0, wade: 0, swim: 0, bathe: 0, bankX: 0, bankZ: 0, blocked: 0, jumpT: -1, jumpDur: 0.8, jumpH: 1, jumpY: 0, jumpCool: 0, landed: false,
    mode: "graze", modeTime: 0, timer: 2 + random() * 8, tx: x, tz: z, homeX: x, homeZ: z, homeRange: persistent ? 13 : 28, buddy: null,
    watchX: x, watchZ: z, trust: ident.saddled ? 1 : 0, lastPet: -99, lead: random() < 0.5 ? 1 : -1,
    rider: null, passenger: null, flight: null, reservedBy: null,
    pose, model: null, animator: null, loading: false, failed: false, visible: false, animClock: 1,
    glide: makeGlide(), rootOffset: new THREE.Vector3(), rootQuat: new THREE.Quaternion(), rootHeading: 0,
    gestureTimers: { headShake: -1, paw: -1, snort: -1, shake: -1, swish: -1 },
    seatWorld: new THREE.Vector3(), stirrupL: new THREE.Vector3(), stirrupR: new THREE.Vector3(),
    bitL: new THREE.Vector3(), bitR: new THREE.Vector3(), reinRest: new THREE.Vector3(),
    random,
    debugSpeed: null,
    irritated: 0,
    impact: 0,
    impactCool: 0,
    shoveX: 0,
    shoveZ: 0,
  }
}

/** Shared registry the characters, camera, HUD and QA read. */
export const horseRT = {
  horses: new Map<string, HorseState>(),
  /** the horse the active character could interact with right now */
  near: null as HorseState | null,
  /** E prompt for the HUD (null when no horse wants the key) */
  prompt: null as string | null,
  /** each character's own horse: the one they last rode, callable from anywhere */
  bonded: { explorer: "", companion: "" } as Record<CharacterId, string>,
  /** QA: hide every horse (A/B performance checks) */
  hidden: false,
  /** QA counters */
  stats: { mounts: 0, dismounts: 0, calls: 0, rendered: 0, simulated: 0, footfalls: 0, ms: 0 },
}

export const horseById = (id: string): HorseState | undefined => horseRT.horses.get(id)

/** forward vector of a heading in the x/z plane */
export const fwdX = (h: number): number => Math.sin(h)
export const fwdZ = (h: number): number => Math.cos(h)
