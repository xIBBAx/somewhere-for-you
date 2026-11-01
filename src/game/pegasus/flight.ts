import { skyLift } from "../../world/highvale/highvaleSky"
import { groundHeight } from "../world-layout"
import { waterSurfaceAt } from "../../world/waterSurface"
import { crownTopNear } from "../../world/colliders"
import { BREEDS, type FlightSpec } from "../horses/breeds"
import { stepHorseMotion } from "../horses/horseMotion"
import { landingSurface, makeLanding, stepLanding, type LandingState } from "./landing"
import { fwdX, fwdZ, type HorseState } from "../horses/horseState"
import { enterSail, liftOffAirless, stepSail } from "../celestial/starSail"
import { inRealm } from "../../world/realmHook"
import { DATUM_Y, SAIL_ALTITUDE } from "../celestial/scale"
import { skillsOf, soarGain, thermalLift, type FlightSkills } from "./skills"
import { makeTrick, stepTrick, tryTrick, type Trick } from "./aerobatics"
import { weatherRT } from "../weather/weatherState"
import { worldRT } from "../runtime"
import { solarVisibility } from "../environment/celestialLighting"

/**
 * Pegasus flight: one physical model for every winged horse, whoever flies it.
 *
 * A flight is ground → takeoff → air → landing → ground. The player, a called
 * Pegasus flying in, and the companion keeping formation all fill the same
 * `FlightIntent`; nothing teleports and every phase has its own body and
 * wing behaviour, read by WingAnimator:
 *
 *   takeoff   wings open, deep fast strokes; from a stand the forehand rises
 *             and the hind legs drive off, from a run it simply lifts away
 *   air       speed eases toward cruise (W faster, S slower, Shift a dash);
 *             A/D bank and the yaw rate follows a coordinated turn
 *             (rate = g tan(bank) / v, capped); Space climbs, C descends and,
 *             with neither, altitude holds. Diving trades height for speed and
 *             climbing costs a little. Cruising, it alternates flapping bouts
 *             and glides as large birds do. The terrain ahead is watched and
 *             climbed over; a soft ceiling stops all but the star-born.
 *             Shift with Space is the launch: the dash's whole speed is swung
 *             up into an almost vertical climb (below, LAUNCH_*)
 *   sail      the star-born only, above the last of the air: wings spread
 *             still as sails of starlight (celestial/starSail.ts)
 *   landing   a glide down ahead, then a flare (nose up, wings forward,
 *             quick back-strokes, legs reaching) and a touchdown into the
 *             canter or a halt; water or a slope underneath aborts it into a
 *             go-around
 *
 * Positions are absolute (the root at the hooves); `alt` is the height over
 * whatever is below (ground or water).
 */

export type FlightMode = "ground" | "takeoff" | "air" | "landing" | "sail"

/** QA (`?debug`): held flight controls and frozen wing poses (pegasus/pegasusDev). */
export const flightQA = {
  override: null as Partial<FlightIntent> | null,
  /** leave every feather at its rest angle (wing-rig QA) */
  noFeatherFold: false,
  wing: new Map<string, Partial<import("./WingAnimator").WingPose> & { fly?: number; legReach?: number }>(),
}

export type FlightIntent = {
  /** −1 slow … +1 faster */
  thrust: number
  /** −1 right … +1 left (same sign as turnRate) */
  turn: number
  /** −1 descend … +1 climb */
  climb: number
  boost: boolean
  /** settle onto the ground below and ahead */
  land: boolean
  /** a barrel roll asked for this frame: +1 to the left, −1 to the right (the rider's controls set it once; skills.ts ROLL_TAP) */
  roll?: number
}

export type FlightState = {
  spec: FlightSpec
  mode: FlightMode
  /** seconds in this mode */
  t: number
  /** hooves above the surface below (m) */
  alt: number
  vy: number
  /** body attitude: nose up +, left wing down + (rad) */
  pitch: number
  roll: number
  // ---- wing drivers (WingAnimator) ------------------------------------------
  /** 0 folded … 1 spread */
  spread: number
  /** stroke phase 0..1: 0 top of the upstroke, ~0.55 bottom of the downstroke */
  flap: number
  flapHz: number
  /** 0..1 stroke amplitude / effort */
  power: number
  /** 0..1 wings held out without a stroke */
  glide: number
  /** 0..1 swept back for a dive or a dash */
  tuck: number
  /** 0..1 landing flare */
  flare: number
  /** cruise rhythm: in a flapping bout or a glide, and time left */
  boutFlap: boolean
  bout: number
  /** dash: seconds into a dash held (0 when not dashing); a Pegasus never tires, so there is no cool-down */
  boostT: number
  boostCool: number
  /** this Pegasus's own way of flying (skills.ts) */
  skills: FlightSkills | null
  /** rising (+) or sinking (−) air under the wings now (m/s), for the HUD */
  lift: number
  /** the body's roll about its nose (a barrel roll, rad; aerobatics.ts) */
  spin: number
  /** yaw rate being flown (rad/s, + to the left) and the sideways slide (m/s, + to the left) */
  yawRate: number
  drift: number
  /** the trick in progress (aerobatics.ts), seconds of a barrel roll left, and the wings swept back for a pirouette (0..1) */
  trick: Trick
  rollT: number
  sweep: number
  /** a stoop under way (0..1): wings folded, gravity doing the work (Shift with C) */
  stoop: number
  /** the launch under way (0..1, eased; Shift with Space), the flight path's angle above level
   *  (rad, tracked always so a launch starts from the path she is on), and seconds into it */
  launch: number
  gamma: number
  launchT: number
  /** 0..1 the launch's downstroke under way now (its surge; the camera feels it) */
  strokeSurge: number
  /** Starborn's overdrive (skills.ts): 0..1 eased, seconds into it, and the room the land ahead leaves (0.55..1) */
  overdrive: number
  odT: number
  odRoom: number
  intent: FlightIntent
  /** star-sail (celestial/starSail.ts): sail setting 0..1 and the surge, eased */
  throttle: number
  surge: number
  /** star-sail on an airless world: seconds left of a straight rise off the ground */
  rise: number
  /** why the last landing was refused, for the hint ("water", "slope") */
  refused: string | null
  landing: LandingState
  stats: { takeoffs: number; landings: number; aborted: number; maxAlt: number; airTime: number; launches: number }
}

export const makeFlight = (spec: FlightSpec): FlightState => ({
  spec, mode: "ground", t: 0, alt: 0, vy: 0, pitch: 0, roll: 0,
  spread: 0, flap: 0, flapHz: spec.flapHz, power: 0, glide: 0, tuck: 0, flare: 0, boutFlap: true, bout: 3,
  boostT: 0, boostCool: 0, throttle: 0.3, surge: 0, rise: 0,
  skills: null, lift: 0, spin: 0, yawRate: 0, drift: 0, trick: makeTrick(), rollT: 0, sweep: 0, stoop: 0, launch: 0, gamma: 0, launchT: 0, strokeSurge: 0, overdrive: 0, odT: 0, odRoom: 1,
  intent: { thrust: 0, turn: 0, climb: 0, boost: false, land: false },
  refused: null, landing: makeLanding(),
  stats: { takeoffs: 0, landings: 0, aborted: 0, maxAlt: 0, airTime: 0, launches: 0 },
})

/** A winged horse's flight state, created on first use. */
export const flightOf = (h: HorseState): FlightState | null => {
  const spec = BREEDS[h.ident.breed].flight
  if (!spec) return null
  if (!h.flight) {
    h.flight = makeFlight(spec)
    h.flight.skills = skillsOf(h.ident.breed)
  }
  return h.flight
}

export const isAirborne = (h: { flight?: FlightState | null }): boolean => !!h.flight && h.flight.mode !== "ground"

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
const damp = (a: number, b: number, k: number, dt: number): number => a + (b - a) * (1 - Math.exp(-k * dt))
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Top of whatever is below: the ground, or the water over it. */
export const surfaceAt = (x: number, z: number): number => {
  const g = groundHeight(x, z)
  const w = waterSurfaceAt(x, z)
  return w !== null && w > g ? w : g
}

/** The highest solid thing (ground, water, tree crowns) under a disc about (x, z). */
export const solidTopAt = (x: number, z: number, pad: number): number => Math.max(surfaceAt(x, z), crownTopNear(x, z, pad, groundHeight))

/** Felt by the rider: a graze or a brush with the ground or a crown (0..1, decaying; read by the camera). */
export const flightContactRT = { jolt: 0 }
export type TakeoffResult = "ok" | "busy" | "water"

/** Ask for a mounted running landing. Repeated input does not restart it. */
export const requestGallopLanding = (h: HorseState): boolean => {
  const f = flightOf(h)
  if (!f || f.mode === "sail" || f.landing.goAround) return false
  if (!f.landing.requested || f.landing.style !== "gallop") f.landing.entrySpeed = h.speed
  f.landing.retry = 0
  f.landing.style = "gallop"
  f.landing.requested = f.mode !== "ground"
  f.landing.run = f.mode === "ground"
  if (f.trick.kind) f.trick.recover = true
  return true
}

/** Cancel without replacing momentum or a partially completed trick pose. */
export const cancelLanding = (h: HorseState): void => {
  const f = h.flight
  if (!f) return
  f.landing.requested = false
  f.landing.run = false
  f.intent.land = false
  // back to the wing where she is: no forced climb, the explorer flies on as she likes
  if (f.mode === "landing") { f.mode = "air"; f.t = 0 }
}

export const clearLanding = (h: HorseState): void => {
  if (h.flight) Object.assign(h.flight.landing, makeLanding())
}

/** Spread the wings and go. From a run it lifts away; from a stand it leaps. */
export const startTakeoff = (h: HorseState): TakeoffResult => {
  const f = flightOf(h)
  if (!f) return "busy"
  if (f.mode !== "ground" || h.jumpT >= 0) return "busy"
  if (h.wade > 0.85) return "water"
  f.intent.land = false
  f.landing.requested = f.landing.run = f.landing.goAround = false
  f.mode = "takeoff"
  f.t = 0
  f.vy = 0
  f.refused = null
  f.stats.takeoffs++
  return "ok"
}

/** Leave the air at once (teleports, the finale, a reset). */
export const groundNow = (h: HorseState): void => {
  const f = h.flight
  if (!f) return
  clearLanding(h)
  f.mode = "ground"
  f.t = 0
  f.vy = 0
  f.pitch = 0
  f.roll = 0
  f.alt = 0
  f.flare = 0
  f.tuck = 0
  f.glide = 0
  f.boostT = 0
  f.spin = f.rollT = f.stoop = f.lift = f.sweep = f.yawRate = f.drift = 0
  f.launch = f.gamma = f.launchT = 0
  f.overdrive = f.odT = 0
  f.trick.kind = null
  h.y = groundHeight(h.x, h.z)
  h.turnRate = 0
}

/** The star-born's fastest wing-borne climb (game m/s, ~2.4 km/s real). */
export const CELESTIAL_CLIMB_MAX = 38

const TAKEOFF_RUN = 0.75
const TAKEOFF_STAND = 1.25

/**
 * Agility. A Pegasus answers the reins like a hawk, not an airliner: the
 * yaw rate asked for arrives in about a tenth of a second (TURN_AGILITY ×
 * the breed's turn figure, sharper still when slow), the body banks into it
 * at the angle that turn really needs, and A/D also slide her sideways at
 * once (DRIFT × the breed's bank), so a correction shows before the heading
 * has even swung. Climb and speed answer within half a second.
 */
const TURN_AGILITY = 2.6
const DRIFT = 7
const CLIMB_AGILITY = 1.7

/**
 * The launch: Shift held with Space. A dash is a Pegasus at full stretch; a
 * climb asked for on top of it is not the dash plus a few metres a second
 * (that only tilted a fast level line by ten degrees) but the dash's whole
 * speed swung upward, as a falcon throws its speed up into a towering climb
 * or a fighter pulls into the vertical. The flight path rotates up at a
 * bounded pitch rate (a quarter-second to the vertical's neighbourhood, no
 * snap), the speed is kept and a first great downstroke adds a surge, and
 * from then on every stroke is a full power stroke. The path stays around
 * seventy degrees (S stands it up further; W, held through most flying,
 * leaves it be), never quite
 * straight up: she is still flying, so A/D still bank, slide and turn her,
 * and letting go of either key swings the speed back into level flight
 * (Space off) or carries it up as a zoom that bleeds away (Shift off).
 */
export const LAUNCH_ANGLE = 1.2
const LAUNCH_STAND = 0.2
/** highest rate the path rotates (rad/s) and how quickly it settles on the angle */
const LAUNCH_PITCH_RATE = 3.4
const LAUNCH_SETTLE = 7
/** airspeed in the launch against the dash's own, and the first stroke's surge (m/s) */
const LAUNCH_SPEED = 1.3
const LAUNCH_SURGE = 9
/** the pulse each power downstroke adds (m/s at the stroke's peak) */
const LAUNCH_BEAT = 6

/**
 * Starborn's overdrive. Held past the dash's first surge she does not just go a
 * little faster: she opens into a speed no wing could make (skills.ts), and it
 * must still fly like her. So the extra is eased in over a couple of seconds
 * (a shove in the back, then the world pouring past), is lower near the land
 * than high in the sky (OD_HIGH_FROM..OD_HIGH_AT metres up), gives way where
 * the land ahead rises (odRoom), looks further ahead for it and climbs over it
 * harder; the turns carve wider but answer as quickly, the slide and the bank
 * open with the speed, the wings sweep back half-shut, with a
 * single drive now and then, and letting go she coasts back down to her dash
 * over a second or two rather than being braked. (Her wings sweep back into
 * a scythe, half-shut and still lit, rather than closing like a falcon's.)
 */
const OD_HIGH_FROM = 30
const OD_HIGH_AT = 450
/** the overdrive's airspeed at this height over the land */
export const overdriveSpeed = (od: NonNullable<FlightSkills["overdrive"]>, alt: number): number => od.low + (od.high - od.low) * smooth(OD_HIGH_FROM, OD_HIGH_AT, alt)

/**
 * Advance a Pegasus that is in the air (takeoff, air or landing). Returns
 * false while it is on the ground: the caller then runs the ground motion.
 */
export const stepFlight = (h: HorseState, dt: number, random: () => number = Math.random): boolean => {
  const f = h.flight
  if (!f || dt <= 0) return false
  if (f.mode === "ground" || f.mode === "sail" || inRealm(h.x, h.z)) return stepFlightSlice(h, dt, random)
  // Existing aerobatic integration owns its complete eased shape per frame.
  if (f.trick.kind && !f.landing.requested && !f.intent.land) return stepFlightSlice(h, dt, random)
  const count = Math.min(240, Math.ceil(Math.max(dt * 60, Math.abs(h.speed) * dt / 0.35)))
  const step = dt / count
  for (let n = 0; n < count; n++) {
    if (h.flight?.mode === "ground") {
      stepFlightSlice(h, step, random)
      stepHorseMotion(h, step, h.steer)
    } else stepFlightSlice(h, step, random)
    // up onto the sails: they take her from the next frame (starSail.ts runs its own step)
    if (h.flight?.mode === "sail") break
  }
  return true
}

const stepFlightSlice = (h: HorseState, dt: number, random: () => number): boolean => {
  const f = h.flight
  if (!f) return false
  h.stamina = 1
  f.landing.retry = Math.max(0, f.landing.retry - dt)
  f.landing.contact = damp(f.landing.contact, 0, 5, dt)
  f.landing.settle = damp(f.landing.settle, 0, 2.8, dt)
  if (f.mode === "ground") {
    f.pitch = damp(f.pitch, 0, 5, dt)
    f.roll = damp(f.roll, 0, 5, dt)
    f.landing.brake = damp(f.landing.brake, 0, 3, dt)
    f.spread = damp(f.spread, 0, 2.6, dt)
    f.flare = damp(f.flare, 0, 4, dt)
    f.power = damp(f.power, 0, 3, dt)
    return false
  }
  if (f.mode === "sail") return stepSail(h, dt)
  if (f.mode === "air" && !f.landing.requested && !f.landing.goAround) f.landing.brake = damp(f.landing.brake, 0, 3, dt)
  // no air to beat a wing against (the Moon): she rises on her sails instead
  if (inRealm(h.x, h.z)) {
    liftOffAirless(h)
    return stepSail(h, dt)
  }
  const s = f.spec
  const i = f.intent
  f.t += dt
  const k = f.skills
  // Shift with C: not a dash but a stoop, the wings folded into a dive
  const stooping = !!k && i.boost && i.climb < -0.6 && f.mode === "air"
  // the dash lasts as long as it is held: no Pegasus ever runs out of breath
  f.boostCool = 0
  const dashOnset = f.boostT === 0
  f.boostT = i.boost && !stooping && f.mode === "air" ? f.boostT + dt : 0
  // the star-born's dash begins at the top of a stroke: the wings gathered high
  // (WingAnimator gather), then the first great downstroke lands its surge
  if (dashOnset && f.boostT > 0 && k?.overdrive && !f.trick.kind) f.flap = 0.94
  // ---- tricks (aerobatics.ts): a barrel roll (A or D tapped twice), and the loops, flips and spins
  if (f.landing.requested || i.land) {
    if (f.trick.kind) f.trick.recover = true
    i.roll = 0
  }
  if (i.roll && !f.landing.requested && !i.land) {
    tryTrick(h, "roll", i.roll)
    i.roll = 0
  }
  if (f.trick.kind !== null && stepTrick(h, f, dt)) return true
  // Rolls return false so ordinary air motion can continue, but their pose
  // must finish too before a landing may take ownership of pitch and bank.
  if (i.land && !f.landing.goAround && f.landing.retry <= 0) {
    if (f.landing.style !== "stop" || !f.landing.requested) f.landing.entrySpeed = h.speed
    f.landing.style = "stop"
    f.landing.run = false
    f.landing.requested = true
  }
  if (f.mode === "air" && !f.trick.kind && (f.landing.requested || (f.landing.retry <= 0 && f.alt < 5 && i.climb < 0 && h.speed < f.spec.minSpeed + 3.5))) {
    f.mode = "landing"
    f.t = 0
    f.landing.skimT = 0
  }
  if (f.mode === "landing" && i.climb > 0.3 && !i.land) cancelLanding(h)
  if (f.mode === "landing") {
    // The approach owns motion, but the dash's visual/camera energy must coast away.
    f.overdrive = damp(f.overdrive, 0, 1.4, dt)
    f.odT = 0
    const before = h.speed
    if (stepLanding(h, f, dt)) touchDown(h)
    h.accel = (h.speed - before) / Math.max(dt, 1e-4)
    return true
  }
  const prevSpeed = h.speed
  const surface = surfaceAt(h.x, h.z)
  /** total airspeed flown in a launch this frame (set below), or null */
  let launchV: number | null = null
  let vyT: number
  let pitchT = f.pitch
  let speedT = h.speed
  let speedK = 1

  if (f.mode === "takeoff") {
    const run = prevSpeed > 5
    const dur = run ? TAKEOFF_RUN : TAKEOFF_STAND
    const u = f.t / dur
    f.spread = damp(f.spread, 1, 9, dt)
    f.power = damp(f.power, 1, 6, dt)
    f.glide = damp(f.glide, 0, 8, dt)
    f.flapHz = damp(f.flapHz, s.flapHz * 1.4, 6, dt)
    // from a stand the forehand rises over the first strokes before the
    // hind legs drive off; at a run it lifts away almost at once
    const off = run ? 0.12 : 0.34
    vyT = u > off ? s.climb * 1.5 : 0
    pitchT = run ? 0.18 : 0.38 * smooth(0, 0.3, u) * (1 - smooth(0.7, 1.2, u)) + 0.12
    speedT = Math.max(prevSpeed, s.minSpeed + 3 + Math.max(0, i.thrust) * 4)
    speedK = run ? 1.6 : 1.1
    if (u > off) f.vy = damp(f.vy, vyT, 3.2, dt)
    if (f.t >= dur && f.alt > 3) {
      f.mode = "air"
      f.t = 0
      f.boutFlap = true
      f.bout = 2.5
    }
  } else if (f.mode === "air") {
    // ---- speed: eases toward the wanted airspeed; height is traded for speed
    speedT = i.thrust >= 0 ? s.cruise * (1 + 0.35 * i.thrust) : s.cruise + (s.minSpeed - s.cruise) * -i.thrust
    if (f.boostT > 0) speedT = k?.dash.speed ?? s.boost
    speedK = f.boostT > 0 ? Math.max(1.6, k?.dash.accel ?? 1.3) : i.thrust > 0 ? 1.8 : i.thrust < 0 ? 1.6 : 0.9
    // ---- Starborn's overdrive (OD_*, above): the dash opened into her own speed
    const od = k?.overdrive
    const odWant = !!od && f.boostT > od.onset && !stooping
    f.overdrive = damp(f.overdrive, odWant ? 1 : 0, odWant ? od!.rise : 1.4, dt)
    f.odT = odWant ? f.odT + dt : 0
    if (od && f.overdrive > 1e-3) {
      const fastest = overdriveSpeed(od, f.alt) * f.odRoom
      if (f.boostT > 0) {
        speedT = speedT + (fastest - speedT) * f.overdrive
        speedK += 1.4 * f.overdrive
      }
    }
    // a hard climb is flown as birds fly one: a little slower, so the path
    // steepens, with every stroke a power stroke (below: pitch and effort)
    const climbHard = f.boostT > 0 ? 0 : Math.max(0, i.climb)
    speedT *= 1 - 0.22 * climbHard
    // ---- vertical: climb, dive or hold
    vyT = i.climb > 0 ? i.climb * s.climb * CLIMB_AGILITY * (k?.climb ?? 1) * (f.boostT > 0 ? 1.2 : 1) : i.climb * s.dive
    // the stoop: the wings fold and gravity does the work
    f.stoop = damp(f.stoop, stooping ? 1 : 0, stooping ? 1.5 : 3, dt)
    if (k && f.stoop > 0.05) {
      vyT *= 1 + f.stoop * 0.8
      speedT = Math.max(speedT, s.cruise + (k.stoop.speed - s.cruise) * f.stoop)
      // the pull-out: nearing the ground the dive flattens by itself, about a
      // second and a half of fall above it, as an eagle opens out of a stoop
      const floor = 6 + h.speed * 1.5
      if (vyT < 0 && f.alt < floor) vyT *= clamp((f.alt - 5) / (floor - 5), 0, 1)
    }
    // with no hand on the climb, large wings fly as large birds do: a gentle
    // sink on the glide, made good again on the flapping bouts (a dash's
    // strokes hold the height), and lifted by any rising air under the wings
    if (k && i.climb === 0) {
      const sink = (1 - k.glide) * 2.4
      vyT = f.boostT > 0 ? 0 : f.boutFlap ? sink * 0.9 : -sink
      const sun = solarVisibility(worldRT.timeOfDay) * (1 - Math.min(1, weatherRT.cloud * 0.8 + weatherRT.rain))
      // thermals rise off sunlit ground, not off the water, and thin out high up
      const overWater = surface > groundHeight(h.x, h.z) + 0.05
      f.lift = overWater ? 0 : thermalLift(h.x, h.z, performance.now() / 1000, sun) * k.thermal * (1 - smooth(450, 900, f.alt))
      vyT += f.lift
      // gliding across the wind, a long wing gathers speed from it (dynamic soaring)
      if (!f.boutFlap && f.boostT <= 0) speedT += soarGain(h.heading, weatherRT.windDirectionRad, weatherRT.wind * 12, k.soar) * 4
    } else f.lift = 0
    // the star-born climbs ever faster as the air thins and starlight takes
    // her weight: a minute from the meadow to the edge of the sky
    // (her wings still need air: she keeps the climb under ~2.4 km/s real, fast but never hypersonic)
    // (only a climb she is asked for: a flapping bout's hold or a thermal, multiplied
    // twentyfold up there, carried her back out of the air when Homeward left her above home)
    if (s.celestial && vyT > 0 && i.climb > 0) vyT = Math.min(vyT * (1 + Math.max(0, h.y - DATUM_Y - skyLift(h.x, h.z) - 60) / 40), CELESTIAL_CLIMB_MAX)
    if (s.ceiling !== Infinity) {
      const above = h.y - surface
      if (vyT > 0) vyT *= 1 - smooth(s.ceiling - 90, s.ceiling, above)
      if (above > s.ceiling) vyT = Math.min(vyT, -1.5)
    }
    // coming out of a launch, the climb it built carries on and bleeds away (a zoom), not cut dead
    // (an overdrive launch is flown at its own speed below: the ordinary climb's rate must not drag on it)
    f.vy = damp(f.vy, vyT, (i.climb !== 0 ? 4.5 : 2.4) * (1 - 0.75 * f.launch) * (1 - f.overdrive * f.launch), dt)
    // the body rides above its path in a powered climb (a high angle of attack):
    // nose up, neck stretched, the forelegs folded tight (HorseAnimator flyPitch)
    pitchT = Math.atan2(f.vy, Math.max(4, h.speed)) * 0.85 + (f.boostT > 0 ? -0.05 - 0.04 * f.overdrive : 0) + climbHard * smooth(0.5, 3, f.vy) * 0.2
    // ---- the launch (LAUNCH_*): the dash's speed swung up into the climb
    const launching = f.boostT > 0 && i.climb > 0.3 && !stooping
    if (launching && f.launch < 0.05 && f.launchT === 0) f.stats.launches++
    f.launchT = launching ? f.launchT + dt : f.launch > 0.05 ? f.launchT : 0
    // Shift let go with Space still held: the climb carries on and bleeds away
    // over a couple of seconds (a zoom); Space let go: the dash comes level again
    const zooming = !launching && i.climb > 0.3
    f.launch = damp(f.launch, launching ? 1 : 0, launching ? 9 : zooming ? 1.1 : 2.6, dt)
    if (f.launch > 0.002) {
      // the path she wants: steep, leaned by W/S, and under a winged horse's ceiling, level again
      let gammaT = launching ? (LAUNCH_ANGLE + LAUNCH_STAND * Math.max(0, -i.thrust)) * Math.min(1, i.climb) : zooming ? 0.4 : 0
      if (s.ceiling !== Infinity) gammaT *= 1 - smooth(s.ceiling - 260, s.ceiling - 60, h.y - surface + Math.max(0, f.vy) * 0.6)
      // (pulling that much more speed round into the climb, she swings it up a little more gently)
      const rate = LAUNCH_PITCH_RATE * (1 - 0.2 * f.overdrive)
      const turnTo = clamp((gammaT - f.gamma) * (launching ? LAUNCH_SETTLE : zooming ? 1.4 : 4), -rate, rate)
      f.gamma += turnTo * dt
      // the speed is kept through the pull (and a little more), plus the first great stroke's surge;
      // the star-born keeps gaining as the air thins, as her ordinary climb does
      const air = h.y - DATUM_Y - skyLift(h.x, h.z)
      const thin = s.celestial ? 1 + Math.max(0, air - 60) / 320 : 1
      const vMax = s.celestial ? CELESTIAL_CLIMB_MAX * 1.3 : (k?.dash.speed ?? s.boost) * LAUNCH_SPEED
      const surge = launching ? LAUNCH_SURGE * Math.exp(-f.launchT * 2.2) * smooth(0, 0.12, f.launchT) : 0
      // and every downstroke drives her on: flapping flight surges with each beat
      const stroke = launching ? Math.max(0, Math.sin(Math.PI * Math.min(1, f.flap / 0.55))) * (f.flap < 0.55 ? 1 : 0) : 0
      f.strokeSurge = stroke
      let vT = launching ? Math.min(vMax, (k?.dash.speed ?? s.boost) * LAUNCH_SPEED * thin) + surge + LAUNCH_BEAT * stroke : Math.hypot(speedT, Math.max(0, vyT))
      // in her overdrive the launch is that speed thrown at the sky (the sails take it on, starSail.ts)
      if (launching && k?.overdrive && f.overdrive > 1e-3) vT = Math.max(vT, overdriveSpeed(k.overdrive, f.alt) * f.overdrive)
      const v0 = Math.hypot(prevSpeed, f.vy)
      const v = v0 + (vT - v0) * (1 - Math.exp(-dt * (vT > v0 ? 3.2 : 1.2)))
      launchV = v
      f.vy += (v * Math.sin(f.gamma) - f.vy) * f.launch
      // the nose leads the path round (that is what turns it), then rides a little above it
      const lead = clamp(gammaT - f.gamma, -0.4, 0.6) * 0.55
      pitchT += (Math.min(1.38, f.gamma + lead + 0.1) - pitchT) * f.launch
    } else f.gamma = Math.atan2(f.vy, Math.max(1, prevSpeed))
    // pulling out of a stoop: the speed built in the dive is turned back into height (a zoom climb)
    // (taken up over a few frames, not in one: a jump of five metres a second read as a snap)
    if (k && i.climb > 0 && h.speed > s.cruise * 1.15 && f.boostT <= 0) {
      const zoomVy = (h.speed - s.cruise) * k.zoom * 0.45
      if (zoomVy > f.vy) f.vy = damp(f.vy, zoomVy, 8, dt)
    }
    // ---- the rhythm of the wings
    const climbing = Math.max(0, f.vy / s.climb)
    const slow = 1 - smooth(s.minSpeed + 1, s.minSpeed + 5, h.speed)
    // a held dash beats in strong bouts and sweeps between them (a swift's rhythm for Ivory, an eagle's drive for Onyx)
    const dashCycle = k ? (f.boostT * (k.dash.strokes > 1.4 ? 0.48 : 0.42)) % 1 : 1
    // (in the overdrive the wings are nearly shut: one short drive now and then)
    const dashStroke = f.boostT > 0 && (f.boostT < 1.2 || dashCycle < (k?.dash.strokes ?? 1) * 0.36 * (1 - 0.7 * f.overdrive))
    // holding the climb asks for more than cruising strokes: deeper and quicker (up to 1.35)
    // and the launch asks for everything: full, deep, quick strokes, the first one hardest
    const effort = Math.max(clamp(0.3 + 0.55 * climbing + 0.35 * Math.max(0, i.thrust) + (dashStroke ? 0.6 * (k?.dash.strokes ?? 1) : 0) + slow * 0.45, 0, 1) + 0.35 * climbHard * smooth(0.5, 3, f.vy),
      f.launch * (1.3 + 0.2 * Math.exp(-f.launchT * 1.5)))
    if (effort < 0.5 && i.climb <= 0) {
      f.bout -= dt
      if (f.bout <= 0) {
        f.boutFlap = !f.boutFlap
        f.bout = f.boutFlap ? 2.2 + random() * 2.2 : 2.4 + random() * 3.2
      }
    } else {
      f.boutFlap = true
      f.bout = Math.max(f.bout, 1.5)
    }
    const diving = i.climb < -0.3 || f.vy < -s.dive * 0.45
    // (in a launch the wings never sweep back into the dash's glide: they drive)
    const dashing = f.boostT > 0 && !dashStroke && f.launch < 0.5
    if (dashStroke || f.launch > 0.5) f.boutFlap = true
    f.glide = damp(f.glide, ((!f.boutFlap && !dashStroke) || diving || dashing) && f.launch < 0.5 ? 1 : 0, f.launch > 0.5 ? 8 : 2.4, dt)
    const sweep = k?.dash.sweep ?? 0.55
    // (the overdrive draws the wings back into a scythe, HorseSystem sweeps them: half-shut, still wide and lit)
    f.tuck = damp(f.tuck, Math.max(diving ? clamp(-f.vy / s.dive, 0, 1) * 0.75 : dashing ? sweep : 0, f.stoop * 0.95, f.overdrive * (f.launch > 0.5 ? 0.5 : 0.6)), f.launch > 0.5 ? 7 : 2.2, dt)
    f.power = damp(f.power, effort, f.launch > 0.5 ? 9 : 3, dt)
    f.flapHz = damp(f.flapHz, s.flapHz * (0.88 + 0.5 * Math.min(effort, 1.2) + f.launch * (0.3 + 0.35 * Math.exp(-f.launchT * 1.2))), f.launch > 0.5 ? 6 : 2, dt)
    // in a stoop the wings close halfway toward the flank, the hands swept back beside the body
    f.spread = damp(f.spread, 1 - f.stoop * 0.5, 6, dt)
    f.flare = damp(f.flare, 0, 4, dt)
    // ---- above the last of the air: the sails (celestial/starSail.ts)
    if (s.celestial && h.y - DATUM_Y - skyLift(h.x, h.z) > SAIL_ALTITUDE && i.climb >= 0) {
      // the sails carry on at the speed she has along her path, not just its level part
      h.speed = Math.hypot(h.speed, f.vy)
      f.launch = f.gamma = f.launchT = 0
      enterSail(f)
      return true
    }
  }

  // ---- speed and energy ------------------------------------------------------
  let speed = prevSpeed + (speedT - prevSpeed) * (1 - Math.exp(-dt * speedK))
  // trading height for speed and back: a stoop accelerates at its own fraction of g
  // (a launch's strokes pay for its climb: it is flown at its own speed, below)
  if (f.mode === "air") speed -= 9.8 * (f.vy / Math.max(5, speed)) * (f.vy < 0 && k ? 0.32 + (k.stoop.g - 0.32) * f.stoop : 0.32) * dt * (1 - f.launch)
  // in a launch the level part of the speed is what is left of it round the path's angle
  if (launchV !== null) speed += (launchV * Math.cos(f.gamma) - speed) * f.launch
  // (the overdrive's own top eases away with it, so letting go is a coast, not a brake)
  const top = Math.max(Math.max(s.boost, k?.dash.speed ?? 0, (k?.stoop.speed ?? 0) * Math.max(f.stoop, 0.3)) * 1.25,
    k?.overdrive ? (k.dash.speed + (overdriveSpeed(k.overdrive, f.alt) - k.dash.speed) * f.overdrive) * 1.08 : 0)
  speed = clamp(speed, s.minSpeed * 0.7, top)
  if (f.mode === "takeoff" && f.t < 0.25 && prevSpeed < 2) speed = Math.max(speed, prevSpeed)
  h.accel = (speed - prevSpeed) / Math.max(dt, 1e-4)
  h.speed = speed
  h.targetSpeed = speed

  // ---- turning: the reins ask for a yaw rate and get it --------------------
  const turn = clamp(i.turn, -1, 1)
  const agile = f.mode === "takeoff" ? 0.75 : 1
  // slow, she can wheel almost on the spot; fast, the turn widens a little
  // (and in the overdrive it answers as quickly still: the turn carves wider only with the speed)
  const slowTurn = Math.max(clamp(s.cruise / Math.max(speed, s.minSpeed), 0.75, 1.6), 0.75 + 0.15 * f.overdrive)
  const yawT = turn * s.turn * TURN_AGILITY * slowTurn * agile
  f.yawRate = damp(f.yawRate, yawT, turn !== 0 ? 10 : 7, dt)
  // and the slide: a beat of the outside wing carries her sideways at once
  f.drift = damp(f.drift, turn * DRIFT * s.bank * agile * (1 + f.overdrive), turn !== 0 ? 6 : 3.5, dt)
  // gusts rock a light wing more than a broad one
  const rock = k ? weatherRT.gust * (1 - k.steady) * 0.12 * Math.sin(f.t * 2.7 + h.x * 0.01) : 0
  // the body banks to the angle the turn really needs (and leans into the slide)
  const coordinated = Math.atan2(speed * f.yawRate, 9.8) * 0.85 + f.drift * 0.035
  const bankT = clamp(coordinated, -s.bank * 1.25 * (1 + 0.25 * f.overdrive), s.bank * 1.25 * (1 + 0.25 * f.overdrive))
  f.roll = damp(f.roll, bankT + rock, 7 + (k ? (1.3 - k.roll) * 2 : 0), dt)
  h.turnRate = f.yawRate
  h.heading += f.yawRate * dt
  h.steer = i.turn

  // ---- terrain ahead: climb over it ----------------------------------------
  const fx = fwdX(h.heading)
  const fz = fwdZ(h.heading)
  if (f.mode === "air" || f.mode === "takeoff") {
    const look = Math.max(8, speed * 1.6)
    const semi = h.model?.meta.wing?.semi ?? 3.2
    let ahead = Math.max(solidTopAt(h.x + fx * look, h.z + fz * look, semi), solidTopAt(h.x + fx * look * 0.5, h.z + fz * look * 0.5, semi))
    // in the overdrive: further ahead too, and nearer (a crown passes in a blink)
    if (f.overdrive > 0.05) ahead = Math.max(ahead, solidTopAt(h.x + fx * look * 1.6, h.z + fz * look * 1.6, semi), solidTopAt(h.x + fx * look * 0.2, h.z + fz * look * 0.2, semi))
    const need = Math.max(ahead, surface) + 4 + 4 * f.overdrive - h.y
    if (need > 0 && f.mode === "air") f.vy = Math.max(f.vy, Math.min(Math.max(s.climb * 2, speed * 0.6 * f.overdrive), need / (0.9 - 0.4 * f.overdrive)))
    // rising land ahead takes some of the overdrive back, so she clears it rather than meets it
    f.odRoom = damp(f.odRoom, 1 - 0.45 * smooth(0, 35, need), need > 0 ? 6 : 1.5, dt)
  }
  f.pitch = damp(f.pitch, pitchT, 6 + 8 * f.launch, dt)

  // ---- integrate --------------------------------------------------------------
  // forward along the heading, plus the slide to the left (+) or right (−)
  h.x += fx * speed * dt + fz * f.drift * dt
  h.z += fz * speed * dt - fx * f.drift * dt
  h.y += f.vy * dt
  const under = surfaceAt(h.x, h.z)
  f.alt = h.y - under
  if (f.mode !== "takeoff" || f.t > 0.4) f.stats.airTime += dt
  f.stats.maxAlt = Math.max(f.stats.maxAlt, f.alt)
  // ---- nothing passes through her: the ground and the crowns under her body
  // and both wingtips. Brushing them is felt: she is pushed off, rolls away
  // from the side that touched, loses speed, and her wings flare.
  if (f.mode === "air") {
    const semi = h.model?.meta.wing?.semi ?? 3.2
    const rx = fz, rz = -fx
    const reach = semi * Math.cos(f.roll) * 0.92
    const tipY = Math.sin(f.roll) * semi * 0.92
    const body = solidTopAt(h.x, h.z, 1.2) + 1.1
    const left = solidTopAt(h.x + rx * reach, h.z + rz * reach, 0.4) + 0.35 - tipY
    const right = solidTopAt(h.x - rx * reach, h.z - rz * reach, 0.4) + 0.35 + tipY
    const need = Math.max(body, left, right)
    if (h.y < need) {
      const depth = need - h.y
      h.y = need
      f.vy = Math.max(f.vy, Math.min(6, depth * 6))
      if (depth > 0.15) {
        const strength = Math.min(1, depth / 1.2 + speed / 40)
        // roll away from the side that touched (left tip under pressure: roll right)
        if (left > body || right > body) f.roll += (left > right ? -1 : 1) * 0.25 * strength
        h.speed *= 1 - 0.12 * strength
        f.flare = Math.max(f.flare, 0.5 * strength)
        if (h.rider) flightContactRT.jolt = Math.max(flightContactRT.jolt, strength)
      }
      f.alt = h.y - under
    }
  }
  if (f.mode === "air" && f.alt < 1.2) {
    // never scrape the ground in level flight: the ground effect lifts her
    // back up over a few frames (a soft cushion, not a snap), with a hard
    // floor a little lower so a fast dive still cannot touch
    h.y = Math.max(under + 0.7, h.y + (under + 1.2 - h.y) * (1 - Math.exp(-14 * dt)))
    f.vy = Math.max(f.vy, 0.5)
    f.alt = h.y - under
  }
  if (f.mode === "takeoff" && f.alt < 0) {
    h.y = under
    f.alt = 0
  }
  return true
}

/** Hooves on the ground: the end of a landing (also the lunar descent, starSail.ts). */
export const touchDown = (h: HorseState): void => {
  const f = h.flight!
  f.mode = "ground"
  f.t = 0
  f.landing.touchdownVy = f.vy
  f.landing.contact = clamp(Math.abs(f.vy) / 2, 0.12, 1)
  f.landing.settle = 1
  f.landing.requested = false
  f.landing.goAround = false
  f.landing.run = f.landing.style === "gallop"
  f.vy = 0
  f.alt = 0
  f.boostT = 0
  f.overdrive = f.odT = 0
  f.spin = f.rollT = f.stoop = f.lift = f.sweep = f.yawRate = f.drift = 0
  f.launch = f.gamma = f.launchT = 0
  f.trick.kind = null
  f.stats.landings++
  // on land the hooves meet the ground; over water she meets its surface and runs on it
  h.y = landingSurface(h.x, h.z)
  // The approach already matched a supported gait. Preserve its momentum;
  // contact is a vertical impulse, never an instantaneous horizontal brake.
  h.targetSpeed = f.landing.run ? h.pose.speeds[3] : 0
  h.landed = true
}

// ---------------------------------------------------------------- autopilot

const angleTo = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from))

export type AutopilotGoal = {
  x: number
  z: number
  /** wanted absolute altitude of the hooves, or null for cruise height */
  y: number | null
  /** wanted airspeed, or null for cruise */
  speed: number | null
  /** land at the goal when close */
  land: boolean
  /** heading to hold once there (formation), or null */
  heading: number | null
}

/**
 * Fill a flight intent that steers toward a goal: a Pegasus flying in when
 * called, and the companion holding station beside the player. Uses the same
 * controls a player would, so it obeys the same physics.
 */
export const autopilot = (h: HorseState, goal: AutopilotGoal, out: FlightIntent): void => {
  const f = h.flight!
  const dx = goal.x - h.x
  const dz = goal.z - h.z
  const dist = Math.hypot(dx, dz)
  const want = dist > 3 || goal.heading === null ? Math.atan2(dx, dz) : goal.heading
  out.turn = clamp(angleTo(h.heading, want) * 1.6, -1, 1)
  const cruiseY = surfaceAt(h.x, h.z) + 28
  const ty = goal.y ?? (goal.land && dist < 70 ? surfaceAt(goal.x, goal.z) + Math.max(0, dist - 18) * 0.35 : Math.max(cruiseY, surfaceAt(goal.x, goal.z) + 28))
  out.climb = clamp((ty - h.y) / 6, -1, 1)
  if (goal.speed !== null) out.thrust = clamp((goal.speed - h.speed) / 4 + (goal.speed > f.spec.cruise ? 0.5 : goal.speed < f.spec.cruise ? -0.5 : 0), -1, 1)
  // (speed now answers within half a second: ease off only on the final approach)
  else out.thrust = goal.land && dist < 60 ? -clamp((60 - dist) / 30, 0, 1) : 0
  out.boost = goal.speed !== null && goal.speed > f.spec.cruise * 1.3 && dist > 40
  out.land = goal.land && dist < 16 && f.mode === "air"
}
