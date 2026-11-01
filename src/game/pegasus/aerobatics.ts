import type { PegasusId } from "../horses/breeds"
import type { HorseState } from "../horses/horseState"
import { fwdX, fwdZ } from "../horses/horseState"
import { surfaceAt, type FlightState } from "./flight"

/**
 * Pegasus aerobatics: the tricks a rider flies on a winged horse, as real
 * motion of the body (heading, pitch, bank and the path through the air), not
 * a visual spin. The shapes are the ones aerobatic pilots and birds fly:
 *
 *   roll       a barrel roll: a whole turn about the nose while the body
 *              traces a small helix round its line of flight (it really
 *              moves: up and over to the side, and back onto the line), the
 *              way a falcon rolls to strike
 *   loop       a pull up and over: the nose climbs through the vertical,
 *              upside down at the top, and comes back level on the same
 *              heading. The radius follows the speed (a loop is a circle of
 *              air you fly round, so the energy trade is real: slow over the
 *              top, faster going down)
 *   split      the dive flip (a split-S): roll inverted, then pull the nose
 *              down through the vertical and out heading the other way, lower
 *              by about two radii, as a hawk turns back in a stoop
 *   corkscrew  a spiralling climb of one full turn, banked steeply into the
 *              spiral (the bank and the rate of turn rise and fall together,
 *              so the body is always leaning into the curve it flies), the
 *              way a swift climbs out of a thermal
 *   pirouette  a flat spin about the vertical with the wings swept back, the
 *              way a bird turns on the spot to shake off the wind; a star-born
 *              one lets starlight fall from her as she turns
 *
 * Every trick eases in and out (smoothstep of its progress), ends level and
 * heading as the air allows, and never reaches the ground: the path is
 * checked against the terrain and water before it starts (tryTrick), and in
 * flight the body is pushed clear of whatever lies below (stepTrick).
 * A rider's opposite input hurries the rest of the trick so it still ends
 * level, rather than leaving the body part-way through a shape.
 *
 * Bindings (controls in horses/riding.ts): A A / D D barrel roll; S S loop;
 * C C dive flip (Shift with C is the stoop); Space Space corkscrew; W W
 * pirouette. Touch: the trick button, with the stick choosing (left or right
 * roll, down loop, up corkscrew, centred pirouette).
 *
 * Runtime: `aeroRT` says what the trick is doing and how hard the rider holds
 * on (`grip`, `brace`); `riderGrip` lets other forces (a re-entry pull, say)
 * combine with it by the larger value. `aeroRT.star` is the star-born's burst.
 */

export type TrickKind = "roll" | "loop" | "split" | "corkscrew" | "pirouette"
export type TrickResult = "ok" | "low" | "busy" | "ground"
export type TrickRequest = { kind: TrickKind; dir: number }

/** The trick in progress on one Pegasus (FlightState.trick); `kind` is null when none. */
export type Trick = {
  kind: TrickKind | null
  /** seconds into the trick, and its length */
  t: number
  T: number
  /** entry speed (m/s), the least speed it may fall to, the radius of a loop or flip (m) */
  v0: number
  vmin: number
  R: number
  /** the way it turns: +1 to the left, −1 to the right */
  dir: number
  /** the attitude it began from (pitch and bank, rad) and the height it began at (m) */
  p0: number
  r0: number
  y0: number
  /** the corkscrew's climb angle (rad) */
  amp: number
  /** a star-born's pirouette: two turns and a burst of starlight */
  star: boolean
  /** an opposite input hurries the remainder (it still ends level) */
  recover: boolean
  /** the pull on the rider (g) and the grip it takes */
  g: number
  grip: number
  /** the rider's steering, eased (rad/s of heading) */
  steer: number
  /** a barrel roll's helix radius (m) and how far along it the body has been carried */
  helix: number
  ox: number
  oy: number
  oz: number
}

export const makeTrick = (): Trick => ({
  kind: null, t: 0, T: 1, v0: 0, vmin: 0, R: 1, dir: 1, p0: 0, r0: 0, y0: 0, amp: 0, star: false, recover: false, g: 1, grip: 0,
  steer: 0, helix: 0, ox: 0, oy: 0, oz: 0,
})

/** Per-breed tuning (skills.ts keeps the flight numbers; these are the tricks). */
type Tune = {
  /** loop and flip radius as a fraction of the entry speed (m per m/s): tight for Ivory, wide for Onyx */
  loop: number
  /** how long a loop or flip takes, relative (lower is quicker) */
  tempo: number
  /** corkscrew climb angle (rad) */
  climb: number
  /** pirouette length (s) */
  spin: number
  /** barrel-roll helix radius (m): Ivory flicks round a tight line, Onyx swings wide and heavy */
  helix: number
  /** corkscrew bank at its steepest (rad) */
  bank: number
}
// Personalities: Ivory is quick and light (tight shapes, short tempo); Onyx
// is the eagle (wide, powerful, unhurried); Starborn flows (long, graceful
// arcs, a little slower, the turns drawn out like a dancer's)
const TUNE: Record<PegasusId, Tune> = {
  ivory: { loop: 0.28, tempo: 0.85, climb: 0.42, spin: 1.5, helix: 1.3, bank: 1.15 },
  onyx: { loop: 0.34, tempo: 1, climb: 0.5, spin: 1.9, helix: 2.4, bank: 1.0 },
  starborn: { loop: 0.31, tempo: 1.05, climb: 0.36, spin: 2, helix: 1.9, bank: 1.1 },
}

const G = 9.8
const TAU = Math.PI * 2
/** never closer than this to whatever is below, in flight (m) */
const MIN_ALT = 3.5
/** the path must clear the ground and water by this much when a trick starts (m) */
const MIN_CLEAR = 5
/** a loop, flip, corkscrew or spin needs this much height to begin with (m) */
const MIN_START = 12
/** a double tap: two presses within this window (s) */
const TAP_WINDOW = 0.24

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
const damp = (a: number, b: number, k: number, dt: number): number => a + (b - a) * (1 - Math.exp(-k * dt))
const sm = (u: number): number => {
  const t = clamp(u, 0, 1)
  return t * t * (3 - 2 * t)
}

// ---- the runtime object -----------------------------------------------------------

/** What the trick does now, for the rider's pose (HumanAnimator) and for others to render. */
export const aeroRT = {
  /** a trick is under way on a Pegasus */
  active: false,
  kind: null as TrickKind | null,
  /** progress 0..1 */
  u: 0,
  /** pull in g, eased (1 at rest) */
  g: 1,
  /** 0..1 how hard the rider holds on: the hands close on the mane, the body folds down */
  grip: 0,
  /** 0..1 pressed back into the saddle under a strong pull */
  brace: 0,
  /** 0..1 a star-born's starlight burst, fading over about 1.8 s; at (starX, starY, starZ) */
  star: 0,
  starX: 0,
  starY: 0,
  starZ: 0,
}

/**
 * The grip the rider takes, combined with an external force (0..1) by the
 * larger value: a re-entry pull or a hard landing feeds in here, and the
 * rider's hands and body answer whichever is stronger.
 */
export const riderGrip = (external = 0): number => clamp(Math.max(aeroRT.grip, external), 0, 1)

/** Publish the active rider's eased reaction once per rendered frame.
 * Herd simulation must not advance this clock: several Pegasi can step in one
 * frame, and their simulation rates vary with distance.
 */
export const tickAero = (dt: number, h: HorseState | null = null): void => {
  const tr = h?.flight?.mode === "air" ? h.flight.trick : null
  const active = !!tr?.kind
  aeroRT.active = active
  aeroRT.kind = active ? tr.kind : null
  aeroRT.u = active ? Math.min(1, tr.t / tr.T) : 0
  aeroRT.g = damp(aeroRT.g, active ? tr.g : 1, 4, dt)
  aeroRT.grip = damp(aeroRT.grip, active ? tr.grip : 0, 3, dt)
  aeroRT.brace = clamp((aeroRT.g - 2) / 2, 0, 1)
  aeroRT.star = Math.max(0, aeroRT.star - dt / 1.8)
}

// ---- kinematics -----------------------------------------------------------------------

/** The body as the trick moves it. Pure: the same steps run for the real body and for the clearance check. */
type Kin = { x: number; y: number; z: number; heading: number; speed: number; pitch: number; roll: number; vy: number; spin: number; turnRate: number }

const kinOf = (h: HorseState, f: FlightState, k: Kin): Kin => {
  k.x = h.x; k.y = h.y; k.z = h.z; k.heading = h.heading; k.speed = h.speed
  k.pitch = f.pitch; k.roll = f.roll; k.vy = f.vy; k.spin = f.spin; k.turnRate = 0
  return k
}

const kin: Kin = { x: 0, y: 0, z: 0, heading: 0, speed: 0, pitch: 0, roll: 0, vy: 0, spin: 0, turnRate: 0 }
const simKin: Kin = { x: 0, y: 0, z: 0, heading: 0, speed: 0, pitch: 0, roll: 0, vy: 0, spin: 0, turnRate: 0 }
const sim = makeTrick()

/** Ends the trick: the body is level, and a flip has turned it round. */
const finish = (tr: Trick, k: Kin): void => {
  if (tr.kind === "split") k.heading += Math.PI
  k.pitch = 0
  k.roll = 0
  k.spin = 0
  k.vy = 0
  k.turnRate = 0
  tr.kind = null
}

/**
 * One step of a trick's motion over `dt` seconds (less while it is hurried).
 * Positions advance along the nose: a loop or split sweeps its pitch through
 * the vertical in the plane of the heading; the corkscrew and pirouette turn
 * their heading as they go. `turn` (−1..1) steers a little while it runs.
 */
const advance = (tr: Trick, k: Kin, dt: number, turn: number): void => {
  const kind = tr.kind
  if (kind === null) return
  const tOld = tr.t
  tr.t = Math.min(tr.T, tr.t + dt * (tr.recover ? 3 : 1))
  const d = tr.t - tOld
  const u0 = tOld / tr.T
  const u1 = tr.t / tr.T
  const um = (u0 + u1) / 2
  if (kind === "roll") {
    const phi = TAU * sm(u1)
    k.spin = tr.dir * phi
    // the helix: the body swings up and over to the side of its line and back
    // (offset from the line, in the body's right/up frame), so the roll is flown
    const side = tr.dir * tr.helix * Math.sin(phi)
    const up = tr.helix * (1 - Math.cos(phi))
    const rx = -fwdZ(k.heading), rz = fwdX(k.heading)
    k.x += rx * side - tr.ox
    k.z += rz * side - tr.oz
    k.y += up - tr.oy
    tr.ox = rx * side
    tr.oz = rz * side
    tr.oy = up
    if (tr.t >= tr.T) finish(tr, k)
    return
  }
  const hStart = k.heading
  // the rider's steering comes in eased, never as a jolt mid-shape
  tr.steer = damp(tr.steer, turn * 0.5, 3, d)
  const steer = tr.steer
  let v: number
  let pitch: number
  let roll: number
  if (kind === "loop" || kind === "split") {
    // a full turn up through the vertical, or half a turn down through it (then the flip)
    const total = kind === "loop" ? TAU : -Math.PI
    // the path and the nose share one angle (the body points where it flies),
    // starting from the attitude it entered with
    const thm = total * sm(um) + tr.p0 * (1 - sm(um / 0.08))
    // energy: slow over the top of a loop, faster going down a split
    v = clamp(Math.sqrt(Math.max(0, tr.v0 * tr.v0 - 2 * G * (k.y - tr.y0))), tr.vmin, tr.v0 * 1.35)
    k.heading += steer * d
    const cx = fwdX(k.heading) * v * Math.cos(thm) * d
    const cz = fwdZ(k.heading) * v * Math.cos(thm) * d
    k.x += cx
    k.z += cz
    k.y += v * Math.sin(thm) * d
    pitch = total * sm(u1) + tr.p0 * (1 - sm(u1 / 0.08))
    // a loop rolls out to level as it climbs; a split rolls inverted first and stays so through the pull
    roll = kind === "loop" ? tr.r0 * (1 - sm(u1 / 0.3)) : tr.r0 + (Math.PI - tr.r0) * sm(u1 / 0.42)
  } else if (kind === "corkscrew") {
    const inb = sm(um / 0.22)
    const env = inb * sm((1 - um) / 0.22)
    // one full turn, the rate following the envelope (its integral is ~0.78 T)
    const rate = TAU / (0.78 * tr.T) * env
    k.heading += tr.dir * rate * d + steer * d
    pitch = tr.amp * env + tr.p0 * (1 - inb)
    v = tr.v0 * (1 - 0.12 * Math.sin(Math.PI * u1))
    // leaning into the curve as hard as it turns (a coordinated turn's bank, tan φ = ω v / g)
    roll = tr.dir * Math.min(tr.R, Math.atan(rate * v / G)) + tr.r0 * (1 - inb)
    k.x += fwdX(k.heading) * v * Math.cos(pitch) * d
    k.z += fwdZ(k.heading) * v * Math.cos(pitch) * d
    k.y += v * Math.sin(pitch) * d
  } else {
    // pirouette: the heading turns a whole circle (two for a star-born) on the spot
    const inb = sm(u1 / 0.2)
    k.heading += tr.dir * TAU * (tr.star ? 2 : 1) * (sm(u1) - sm(u0)) + steer * d
    pitch = tr.p0 * (1 - inb)
    roll = tr.r0 * (1 - inb)
    v = Math.max(tr.vmin, tr.v0 * (1 - 0.75 * Math.sin(Math.PI * u1)))
    k.x += fwdX(k.heading) * v * Math.cos(pitch) * d
    k.z += fwdZ(k.heading) * v * Math.cos(pitch) * d
    k.y += v * Math.sin(pitch) * d
  }
  k.speed = v
  k.pitch = pitch
  k.roll = roll
  k.vy = v * Math.sin(pitch)
  k.turnRate = d > 0 ? (k.heading - hStart) / d : 0
  if (tr.t >= tr.T) finish(tr, k)
}

/** The lowest the path comes to ground or water over `dt`-long steps (m). */
const lowestClearance = (tr: Trick, k: Kin): number => {
  Object.assign(sim, tr)
  let low = Infinity
  for (let n = 0; n < 240 && sim.kind !== null; n++) {
    advance(sim, k, 1 / 30, 0)
    const a = k.y - surfaceAt(k.x, k.z)
    if (a < low) low = a
  }
  return low
}

// ---- the controls -----------------------------------------------------------------------

/** A key's double tap: when it was last pressed and whether it is down now. */
export type Tap = { down: boolean; since: number }
export const makeTap = (): Tap => ({ down: false, since: 9 })

/** True on the frame a key is pressed the second time within TAP_WINDOW of the first. */
export const tapTwice = (st: Tap, down: boolean, dt: number): boolean => {
  st.since += dt
  let fire = false
  if (down && !st.down) {
    if (st.since < TAP_WINDOW) {
      fire = true
      st.since = 9
    } else st.since = 0
  }
  st.down = down
  return fire
}

export type TrickTaps = { s: Tap; c: Tap; space: Tap; w: Tap }
export const makeTrickTaps = (): TrickTaps => ({ s: makeTap(), c: makeTap(), space: makeTap(), w: makeTap() })

/**
 * The keyboard's double taps: S S loop, C C dive flip (Shift with C is the
 * stoop, not a flip), Space Space corkscrew, W W pirouette. The turn key (A or
 * D) sets the sense of a spin or corkscrew. `move.y` is −1 for W, +1 for S.
 */
export const keyTrick = (st: TrickTaps, move: { x: number; y: number }, ascend: boolean, descend: boolean, boost: boolean, turn: number, dt: number): TrickRequest | null => {
  const side = turn < 0 ? -1 : 1
  // Sample every key before choosing a request. Early returns used to leave
  // the other keys held in an old state and could manufacture later taps.
  const loop = tapTwice(st.s, move.y > 0.5, dt)
  const split = tapTwice(st.c, descend, dt) && !boost
  const corkscrew = tapTwice(st.space, ascend, dt)
  const pirouette = tapTwice(st.w, move.y < -0.5, dt)
  if (loop) return { kind: "loop", dir: side }
  if (split) return { kind: "split", dir: side }
  if (corkscrew) return { kind: "corkscrew", dir: side }
  if (pirouette) return { kind: "pirouette", dir: side }
  return null
}


// ---- starting and running a trick ----------------------------------------------------

/**
 * Start a trick if the Pegasus is flying and the air is clear for it: a loop,
 * flip or spin is checked along its whole predicted path, and a barrel roll
 * needs a little height. Returns "low" when there is not room (the caller
 * gives the gentle hint), "busy" while another trick runs, "ground" when not in the air.
 */
export const tryTrick = (h: HorseState, kind: TrickKind, dir: number): TrickResult => {
  const f = h.flight
  if (!f || !f.skills || f.mode !== "air") return "ground"
  const tr = f.trick
  if (tr.kind !== null) return "busy"
  const side = dir < 0 ? -1 : 1
  if (kind === "roll") {
    if (f.alt <= 12) return "low"
    tr.kind = "roll"
    tr.t = 0
    tr.T = f.skills.roll
    tr.dir = side
    tr.recover = false
    tr.g = 1
    tr.grip = 0.35
    tr.helix = (TUNE[h.ident.breed as PegasusId] ?? TUNE.ivory).helix
    tr.ox = tr.oy = tr.oz = 0
    return "ok"
  }
  if (f.alt < MIN_START) return "low"
  const tune = TUNE[h.ident.breed as PegasusId] ?? TUNE.ivory
  const dash = f.boostT > 0 ? 1 : 0
  const star = kind === "pirouette" && f.spec.celestial
  const v0 = clamp(h.speed, f.spec.minSpeed + 2, f.spec.boost)
  // a dash makes a bigger loop, done quicker: faster, tighter in time, wider in the air
  const R = clamp(v0 * tune.loop * (1 + 0.25 * dash), 4, 16)
  let T: number
  if (kind === "loop" || kind === "split") T = (3 * Math.PI * R / v0) * tune.tempo * (1 - 0.15 * dash)
  else if (kind === "corkscrew") T = 3 * tune.tempo * (1 - 0.1 * dash)
  else T = tune.spin * (star ? 1.3 : 1) * (1 - 0.1 * dash)
  tr.kind = kind
  tr.t = 0
  tr.T = clamp(T, 1.1, kind === "corkscrew" ? 3.4 : 2.6)
  tr.v0 = v0
  tr.vmin = f.spec.minSpeed * 0.7
  // the corkscrew keeps its steepest bank here (it has no radius of its own)
  tr.R = kind === "corkscrew" ? tune.bank : R
  tr.steer = 0
  tr.dir = side
  tr.p0 = f.pitch
  tr.r0 = f.roll
  tr.y0 = h.y
  tr.amp = tune.climb
  tr.star = star
  tr.recover = false
  // the pull: how hard the rider is pressed into the saddle at the bottom of a loop
  tr.g = kind === "pirouette" ? 1.2 : clamp(1 + 0.5 * v0 * v0 / (R * G), 1, 4)
  tr.grip = kind === "pirouette" ? 0.3 : clamp((tr.g - 1) / 2.5, 0.3, 1)
  const k = kinOf(h, f, simKin)
  if (lowestClearance(tr, k) < MIN_CLEAR) {
    tr.kind = null
    return "low"
  }
  if (star) {
    aeroRT.star = 1
    aeroRT.starX = h.x
    aeroRT.starY = h.y
    aeroRT.starZ = h.z
  }
  return "ok"
}

/** Stop a trick at once, leaving the body where it is (the flight takes over). */
const cancel = (f: FlightState): void => {
  f.trick.kind = null
  f.spin = 0
  f.rollT = 0
  f.sweep = 0
}

/**
 * Fly the body through a trick for one frame. Returns true when the trick has
 * moved the body (flight.ts then skips its own air model this frame), false
 * when the trick is over, is only a roll (the air model carries on and the
 * roll is applied as `spin`), or has ended.
 */
export const stepTrick = (h: HorseState, f: FlightState, dt: number): boolean => {
  const tr = f.trick
  if (tr.kind === null) return false
  if (f.mode !== "air") {
    cancel(f)
    return false
  }
  const i = f.intent
  if (tr.kind !== "roll") {
    if ((tr.kind === "loop" && i.climb < -0.5) || (tr.kind === "split" && i.climb > 0.5) ||
      ((tr.kind === "corkscrew" || tr.kind === "pirouette") && i.turn * tr.dir < -0.5)) tr.recover = true
  }
  const k = kinOf(h, f, kin)
  const prevSpeed = h.speed
  const kindNow = tr.kind
  advance(tr, k, dt, i.turn)
  const u = Math.min(1, tr.t / tr.T)
  if (kindNow === "roll") {
    // a barrel roll turns the body about its nose and carries it round its
    // helix; the air model carries on along the line underneath
    h.x = k.x
    h.y = k.y
    h.z = k.z
    f.spin = k.spin
    f.rollT = tr.kind === null ? 0 : tr.T - tr.t
    f.tuck = damp(f.tuck, 0.35 * Math.sin(Math.PI * u), 6, dt)
    return false
  }
  const under = surfaceAt(k.x, k.z)
  h.x = k.x
  h.z = k.z
  h.heading = k.heading
  h.turnRate = k.turnRate
  h.speed = k.speed
  h.targetSpeed = k.speed
  h.accel = (k.speed - prevSpeed) / Math.max(dt, 1e-4)
  h.steer = i.turn
  h.y = k.y
  // never through the ground: push clear and hurry the trick to its end
  if (h.y - under < MIN_ALT) {
    h.y = under + MIN_ALT
    tr.recover = true
    k.vy = Math.max(k.vy, 1)
  }
  f.vy = k.vy
  f.pitch = k.pitch
  f.roll = k.roll
  f.spin = 0
  f.alt = h.y - under
  f.lift = 0
  f.stoop = 0
  f.stats.airTime += dt
  f.stats.maxAlt = Math.max(f.stats.maxAlt, f.alt)
  // the wings: spread and powered over the top of a loop, tucked through a flip,
  // swept back for a pirouette
  const s = Math.sin(Math.PI * clamp(u, 0, 1))
  let spread = 1
  let tuck = 0
  let power = 0.5
  let sweep = 0
  switch (tr.kind) {
    case "loop": power = 0.35 + 0.65 * s; tuck = 0.45 * (1 - s); break
    case "split": spread = 1 - 0.5 * s; tuck = 0.9 * s; power = 0.3; break
    case "corkscrew": power = 0.7; break
    case "pirouette": spread = 1 - 0.2 * s; tuck = 0.3 * s; sweep = 0.9 * s; break
  }
  f.spread = damp(f.spread, spread, 8, dt)
  f.tuck = damp(f.tuck, tuck, 6, dt)
  f.sweep = damp(f.sweep, sweep, 6, dt)
  f.power = damp(f.power, power, 6, dt)
  f.glide = damp(f.glide, 0, 6, dt)
  f.flare = damp(f.flare, 0, 6, dt)
  f.flapHz = damp(f.flapHz, f.spec.flapHz * (0.9 + 0.5 * f.power), 4, dt)
  return true
}
