import * as THREE from "three"
import { wingRhythm } from "./wingRhythm"
export { advanceWingbeat } from "./wingRhythm"
import type { RigPoser } from "../rig/RigPoser"

/**
 * Procedural wings for the Pegasi.
 *
 * The rig is a bird's: shoulder girdle, humerus, forearm, hand and digits on
 * each side, built in the spread gliding pose. Every pose is that rest plus
 * three rotations per joint, written for the left wing in the body's rest
 * axes and mirrored for the right:
 *
 *   sweep  about the wing's normal (up): + sweeps the segment back
 *   twist  about the span (x): + pronates (leading edge down)
 *   lift   about the body's long axis (z): + raises the wing
 *
 * Folded, the wing makes a bird's Z in its own plane (humerus back, forearm
 * forward, hand back) and that plane is then rolled about the body's long axis
 * at the shoulder until the upper surface faces outward: the closed wing lies
 * along the upper flank with its leading edge on top. With a rider it is rolled
 * only part way, a swan's raised fold sloping like a roof over the rider's
 * thighs. Rolled, an in-plane angle ψ (from the span, + back) points
 * (cos ψ·cos r, cos ψ·sin r, −sin ψ): 90° is straight back, below 90° droops.
 * The flight feathers do what real ones do when a wing closes: each swings
 * about its own base to lie back along the folded arm. That is done per
 * feather in the vertex shader (horseAssets: featherMaterial) from the
 * angles this class writes to `featherA` / `featherFan`.
 *
 * In flight the stroke follows large birds: the downstroke takes ~55 % of the
 * cycle with the wing fully extended and slightly pronated; on the upstroke
 * the wrist flexes and the hand supinates so the wing is drawn up with little
 * drag; the primaries fan on the downstroke (into separate fingers on the
 * eagle-winged Onyx). Gliding holds a few degrees of dihedral with the
 * tips curled up under load; a dive sweeps the wings back; the landing flare
 * brings them forward and up with quick strokes; in a turn the inner wing
 * flexes a little and the outer one reaches.
 */

export type WingPose = {
  mode?: "ground" | "takeoff" | "air" | "landing" | "sail"
  speed?: number
  accel?: number
  time?: number
  personality?: "ivory" | "onyx" | "starborn" | string
  brake?: number
  contact?: number
  stride?: number
  reducedMotion?: boolean
  wind?: number
  /** Hoof clearance above terrain and world-space half-span, in metres. */
  clearance?: number
  span?: number
  /** 0 folded … 1 spread */
  spread: number
  /** stroke phase 0..1 (0 top of the upstroke) */
  flap: number
  power: number
  glide: number
  tuck: number
  flare: number
  /** bank (rad, + left wing down) and the breed's max bank */
  roll: number
  bank: number
  /** 0..1 wings swept back hard, as a bird turns on the spot (a pirouette) */
  sweep?: number
  /** 0..1 the wings drawn up high to gather a dash's first great stroke (Starborn) */
  gather?: number
  /** a rider aboard (raised fold) 0..1 */
  ridden: number
  /** standing quietly with nobody aboard (idle wing stretches) */
  idle: boolean
}

export const makeWingPose = (): WingPose => ({ spread: 0, flap: 0, power: 0, glide: 0, tuck: 0, flare: 0, roll: 0, bank: 0.7, sweep: 0, ridden: 0, idle: false })

export type WingGroups = Record<string, [number, number]>

const DEG = Math.PI / 180
const TAU = Math.PI * 2
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

// rest in-plane angles of humerus, forearm, hand, digits (deg, + back) from
// anatomy.wing_skeleton, and where each points when the wing is folded: the
// humerus back and a little down to the elbow, the forearm forward so the wrist
// closes just ahead of the shoulder, hand and digits back along the flank
const REST_PSI = [16, -9, 10, 18]
const FOLD_PSI = [82, -96, 89, 93]
const FOLD_PHI = FOLD_PSI.map((f, i) => f - REST_PSI[i])
const FOLD_DELTA = FOLD_PHI.map((p, i) => p - (i > 0 ? FOLD_PHI[i - 1] : 0))
// the bone each feather group grows on (index into the arm chain) and where
// its feathers lie in the fold (deg, + back from the wing's span): tertials
// rise a touch to cover the stack, the secondaries' tips droop a little to make
// the closed wing's lower edge, the primaries run straight back over the croup
const GROUP_BONE = [0, 1, 1, 2, 3]
const GROUP_FOLD_PSI = [99, 72, 77, 84, 87]
// roll of the folded plane about the long axis (deg, − lowers the outer edge)
// and the humerus's pitch (+ lifts the elbow), free and with a rider aboard
const FOLD_ROLL = [-72, -40]
const FOLD_RAISE = [2, 8]

const _e = new THREE.Euler()
const _q = new THREE.Quaternion()

export class WingAnimator {
  private readonly bones: { L: string[]; R: string[] }
  private readonly groups: Array<[number, number]>
  /** per-feather group fold and fan angles (rad), 0-4 left, 5-9 right */
  readonly featherA = new Float32Array(10)
  readonly featherFan = new Float32Array(10)
  /** feather tip flex under load (left, right) */
  readonly flex = new Float32Array(2)
  /** the eagle wing: outer primaries split into fingers */
  private readonly slotted: boolean
  private stretchT = -1
  private stretchWait: number
  private random: () => number
  private settle = 0
  /** this horse's own phase for the beat-to-beat variation */
  private readonly seed: number
  private spread = Number.NaN
  private power = 0
  private clock = 0
  private grounded = true
  private contact = 0
  private readonly tipLoad = new Float32Array(2)
  private readonly articulated = new Map<string, THREE.Quaternion>()

  constructor(poser: RigPoser, groups: WingGroups, kind: string, random: () => number) {
    const names = ["wingRoot", "wingHum", "wingFore", "wingHand", "wingTip"]
    this.bones = { L: names.map((n) => `${n}L`), R: names.map((n) => `${n}R`) }
    this.groups = [0, 1, 2, 3, 4].map((g) => groups[String(g)] ?? [0, 1])
    this.slotted = kind === "slot"
    this.random = random
    this.stretchWait = 25 + random() * 40
    this.seed = random() * 6.28
    void poser
  }

  static has(poser: RigPoser): boolean {
    return poser.has("wingHumL") && poser.has("wingHumR")
  }

  /** Short joint response blends contact and immediate retakeoff without
   * resetting the authoritative stroke phase or popping the folded arm. */
  private pose(P: RigPoser, name: string, target: THREE.Quaternion, dt: number, rate: number, minimumLift?: number, side = 1): number {
    let q = this.articulated.get(name)
    if (!q) { q = target.clone(); this.articulated.set(name, q) }
    else q.slerp(target, 1 - Math.exp(-dt * rate))
    let lift = 0
    if (minimumLift !== undefined) {
      // Apply the terrain bound after the small joint lag, so a fast approach
      // cannot carry yesterday's deep downstroke through the ground.
      _e.setFromQuaternion(q, "ZXY")
      lift = Math.max(minimumLift, _e.z * side / DEG)
      _e.z = lift * side * DEG
      q.setFromEuler(_e)
    }
    P.setDelta(name, q)
    return lift
  }

  update(P: RigPoser, w: WingPose, dt: number): void {
    // Far grounded horses may be posed at 2.5 Hz; keep their settling in
    // simulation time while the ridden/airborne rig updates every frame.
    dt = clamp(dt, 0, 0.5)
    this.clock = w.time ?? this.clock + dt
    const grounded = w.mode === "ground"
    const contact = clamp(w.contact ?? (grounded ? 1 : 0), 0, 1)
    if ((grounded && !this.grounded) || (contact > 0.6 && this.contact <= 0.6)) this.shuffle()
    this.contact = contact
    this.grounded = grounded
    const target = grounded ? 0 : clamp(w.spread, 0, 1)
    if (!Number.isFinite(this.spread)) this.spread = target
    this.spread += (target - this.spread) * (1 - Math.exp(-dt * (target > this.spread ? 12 : 8)))
    this.power += (clamp(w.power, 0, 1.5) - this.power) * (1 - Math.exp(-dt * 9))
    const rhythm = wingRhythm({ ...w, power: this.power })
    const quiet = w.reducedMotion ? 0.25 : 1
    // ---- the idle wing stretch: a slow full spread, a rouse, and back ----------
    let stretch = 0
    if (w.idle && !w.reducedMotion && w.spread < 0.05) {
      if (this.stretchT < 0) {
        this.stretchWait -= dt
        if (this.stretchWait <= 0) this.stretchT = 0
      }
    }
    if (w.reducedMotion) this.stretchT = -1
    if (this.stretchT >= 0) {
      this.stretchT += dt / 3.6
      stretch = smooth(0, 0.3, this.stretchT) * (1 - smooth(0.72, 1, this.stretchT))
      if (this.stretchT >= 1 || !w.idle) {
        this.stretchT = -1
        this.stretchWait = 45 + this.random() * 80
      }
    }
    const spread = Math.max(this.spread, stretch * 0.92)
    const F = 1 - spread
    // opening, the wing levels out early and then extends (a bird lifts its
    // wings clear of the body before reaching out), so the roll eases off first
    const Fr = F * F
    const fly = this.spread
    const sweep = w.sweep ?? 0
    const p = ((w.flap % 1) + 1) % 1
    const downShare = rhythm.downShare
    const brake = clamp(w.brake ?? 0, 0, 1)
    // ---- stroke --------------------------------------------------------------------
    const down = p < downShare
    const warp = down ? 0.5 * p / downShare : 0.5 + 0.5 * (p - downShare) / (1 - downShare)
    // on her sails (space, a journey) she glides, but a strong pull of power is
    // still a real stroke: the launch of a journey, a surge between worlds
    const stroke = grounded ? 0 : w.mode === "sail" ? clamp(this.power * 1.4 - 0.15, 0, 1) * (1 - 0.5 * w.glide) : 1 - w.glide
    // no two beats alike: a slow, irregular swell of the stroke's depth (two
    // incommensurate rates), as a bird's beats vary with the air it meets
    const vary = 1 + quiet * (0.07 * Math.sin(this.clock * 0.73 + this.seed) + 0.045 * Math.sin(this.clock * 1.91 + this.seed * 2.3))
    const amp = (14 + 36 * this.power + 18 * w.flare + 8 * brake) * rhythm.amplitude * stroke * (1 - w.tuck * 0.75) * fly * vary
    const mid = (6 + 9 * w.power * stroke + 14 * w.flare + 8 * brake - 5 * w.tuck) * fly + stretch * 30
    const upFlex = (down ? 0 : Math.sin(Math.PI * (p - downShare) / (1 - downShare))) * (0.25 + 0.5 * w.power) * stroke * fly
    const reach = (down ? Math.sin(Math.PI * p / downShare) : 0) * w.power * stroke * fly
    // primaries fan wide on the downstroke, in the flare and the glide
    const downLoad = down ? Math.sin(Math.PI * p / downShare) : 0
    const fanOpen = clamp(this.power * (0.3 + downLoad * 0.7) * stroke + w.flare + w.glide * 0.45 + brake * 0.4 + stretch, 0, 1.3) * fly
    // the tips bend up under load (downstroke, and a little in a glide)
    const load = (down ? Math.sin(Math.PI * p / downShare) : -0.2) * w.power * stroke + w.glide * 0.35 + w.flare * 0.4
    // settle a beat after landing: a shuffle as the wings close
    this.settle = Math.max(0, this.settle - dt)
    const pressure = smooth(2, 38, Math.abs(w.speed ?? 0))
    const foldedBreeze = F * quiet * (0.4 * clamp(w.wind ?? 0, 0, 1) * Math.sin(this.clock * 1.7)
      + 0.35 * Math.sin(TAU * (w.stride ?? 0)) * smooth(1, 12, Math.abs(w.speed ?? 0)))
    const turn = clamp(w.roll / Math.max(0.2, w.bank), -1, 1) * fly
    // flank (free) or raised (ridden) fold
    const lift = THREE.MathUtils.lerp(FOLD_ROLL[0], FOLD_ROLL[1], w.ridden)
    const raise = THREE.MathUtils.lerp(FOLD_RAISE[0], FOLD_RAISE[1], w.ridden)

    for (const side of ["L", "R"] as const) {
      const sg = side === "L" ? 1 : -1
      const b = this.bones[side]
      // the inner wing of a turn flexes, the outer reaches
      const inner = Math.max(0, turn * sg)
      const outer = Math.max(0, -turn * sg)
      // Gust correction follows the flight state, not independent random jitter.
      // A few degrees of unequal wrist trim keep the turn alive in a glide.
      const trim = quiet * fly * rhythm.expression * (outer - inner) * (1.2 + pressure * 1.8)
      const targetLoad = clamp(load + outer * 0.15 + brake * 0.25, -0.3, 1)
      const tip = side === "L" ? 0 : 1
      this.tipLoad[tip] += (targetLoad - this.tipLoad[tip]) * (1 - Math.exp(-dt * (this.slotted ? 8 : 11)))
      const secondary = quiet * fly * (this.tipLoad[tip] - targetLoad) * 5
      const starborn = w.personality === "starborn"
      const starCurl = starborn ? quiet * fly * (0.7 + pressure * 0.4) * Math.sin(this.clock * 1.4 + sg * 0.22) : 0
      // Starborn holds her wings like an angel's: a higher dihedral in the glide,
      // the hands curling up; and, to gather a dash, draws them up high and a
      // little forward before the first great downstroke
      const gather = starborn ? clamp(w.gather ?? 0, 0, 1) * fly : 0
      const halo = starborn ? (7 * w.glide + 3 * (1 - w.tuck)) * fly * (1 - gather) : 0
      // in-plane deltas (deg, + back) for hum, fore, hand, tip
      const sw = [
        FOLD_DELTA[0] * F + (-8 * reach + 10 * upFlex + 24 * w.tuck - 18 * w.flare - 10 * brake + 6 * inner - 4 * outer + 22 * sweep) * fly - 12 * gather,
        FOLD_DELTA[1] * F + (-36 * upFlex - 44 * w.tuck - 14 * inner + 6 * outer - 10 * sweep) * fly,
        FOLD_DELTA[2] * F + (52 * upFlex + 58 * w.tuck + 18 * inner - 4 * outer + 16 * sweep) * fly + 10 * gather,
        FOLD_DELTA[3] * F + (6 * w.glide - 6 * w.tuck) * fly,
      ]
      // in a turn the outer wing works harder and the inner one eases, and the
      // inner wing's beat leads a little: the turn is flown, not just leaned
      const ampS = amp * (1 + quiet * (0.28 * outer - 0.22 * inner))
      // (and no two wings beat as mirrors: Starborn's lead drifts a hair either side)
      const lead = quiet * (0.04 * inner + (starborn ? 0.012 * Math.sin(this.clock * 0.9 + sg * 1.7 + this.seed) : 0))
      // lift: the stroke at the shoulder with a lag down the arm (the wave of
      // a real wingbeat), dihedral and the tip curl of the glide
      const e0 = ampS * Math.cos(TAU * (warp + lead))
      const lag = ampS * Math.cos(TAU * (warp + lead - rhythm.lag))
      const lifts = [
        lift * Fr + (mid + e0) + foldedBreeze + halo + 46 * gather,
        (lag - e0) * 0.35 + 3 * w.glide * fly + trim,
        (ampS * Math.cos(TAU * (warp + lead - rhythm.lag * 1.7)) - lag) * 0.4 + 2 * w.glide * fly,
        6 * w.glide * fly + 4 * w.flare * fly + secondary + starCurl + trim * 0.5 + (starborn ? 5 * w.glide * fly : 0) + 8 * gather,
      ]
      // twist: pronated on the downstroke, the hand supinated on the upstroke,
      // the whole wing supinated (leading edge up) in the flare
      const twists = [
        raise * Fr + (4 * reach - 20 * w.flare) * fly,
        0,
        (6 * reach - 34 * upFlex - 8 * w.flare - 7 * brake) * fly + trim * 0.5,
        -6 * upFlex * fly,
      ]
      // girdle: a small shrug with the stroke
      _e.set(0, 0, sg * (0.15 * (e0 + mid) * fly + 4 * stretch) * DEG, "ZXY")
      this.pose(P, b[0], _q.setFromEuler(_e), dt, 24)
      // A conservative 1.1m shoulder allowance leaves room for feathers and
      // the girdle's shrug. Protect the whole arm chain, not just the humerus:
      // a trailing wrist must not dip below the safe shoulder plane either.
      // The original Z-fold plane remains the baseline as the span closes.
      const protect = w.clearance !== undefined && w.span !== undefined && w.clearance < w.span && fly > 0.02
      const floor = protect ? lift * Fr + fly * (
        -Math.asin(clamp((Math.max(0, w.clearance!) + 1.1) / Math.max(0.5, w.span!), 0, 1)) / DEG
        + Math.max(0, w.roll * sg) / DEG
      ) : undefined
      let carriedLift = 0
      for (let i = 0; i < 4; i++) {
        _e.set(twists[i] * DEG, sg * sw[i] * DEG, sg * lifts[i] * DEG, "ZXY")
        carriedLift += this.pose(P, b[i + 1], _q.setFromEuler(_e), dt, i === 0 ? 24 : 20,
          floor === undefined ? undefined : floor - carriedLift, sg)
      }
      // ---- feathers: fold each about its base; fan the primaries ---------------
      // accumulated in-plane rotation of each arm bone (deg)
      let acc = 0
      const phi: number[] = []
      for (let i = 0; i < 4; i++) {
        acc += sw[i]
        phi.push(acc)
      }
      for (let g = 0; g < 5; g++) {
        const [lo, hi] = this.groups[g]
        // fold: a feather at angle θ (out from straight back) on a bone pointing
        // at ψ lies at ψ + 90 − θ; swing it to GROUP_FOLD_PSI on the closed arm
        const foldA = (GROUP_FOLD_PSI[g] - 90 + lo - FOLD_PSI[GROUP_BONE[g]]) * F
        const foldFan = (hi - lo) * F
        // open: the primaries fan (+ swings a feather back, so opening is −)
        const fanA = g === 4 ? -(this.slotted ? 7 : 4) * fanOpen : g === 3 ? -2 * fanOpen : 0
        const fanK = g === 4 ? -(this.slotted ? 14 : 6) * fanOpen : g === 3 ? -4 * fanOpen : 0
        const i = (side === "L" ? 0 : 5) + g
        this.featherA[i] = (foldA + fanA + (this.settle > 0 ? Math.sin(this.settle * 20) * 2 * (this.settle / 0.6) * quiet : 0)) * DEG
        this.featherFan[i] = (foldFan + fanK) * DEG
      }
      this.flex[tip] = grounded ? this.tipLoad[tip] * fly * 0.1 : clamp(this.tipLoad[tip] * fly, -0.3, 1)
      void phi
    }
  }

  /** a beat of settling feathers (after landing) */
  shuffle(): void {
    this.settle = 0.6
  }
}
