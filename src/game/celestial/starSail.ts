import { skyLift } from "../../world/highvale/highvaleSky"
import * as THREE from "three"
import type { HorseState } from "../horses/horseState"
import type { FlightState } from "../pegasus/flight"
import { worldRT } from "../runtime"
import { groundHeight } from "../world-layout"
import { inRealm } from "../../world/realmHook"
import { standable } from "../horses/horseMotion"
import { earthFrame, localAxes, localToUniverse, universeToLocal } from "./frames"
import { DATUM_Y, EARTH_R, EARTH_SCALE, SAIL_ALTITUDE } from "./scale"
import { spaceRT } from "./spaceState"
import { bodyById, nearestBody, universe, type BodyState } from "./universe"
import { canLand, enterRealm, leaveRealm, prepareRealm, realmReady, realmRT, recentreRealm } from "./realm/realmState"
import { siteUniverse } from "./realm/lunarSites"
import { approachFloor, hazardNotice } from "./hazards"
import { l1Point, rendezvousLimit, waitingInSpace } from "./spaceCats/journey"
import { observationJourney, observationPoint, observationSpeedLimit } from "./observations"
import { rememberMoonLanding, voyage } from "./voyageMemory"
import { ringCoords, ringPlaneWeight, ringSpeedCap, type RingCoords } from "./rings/ringPhysics"

/**
 * Starborn's star-sail: how the star-born Pegasus travels where no wing can.
 *
 * A wing needs air to push against, and above ~60 km (950 m the explorer) there is
 * almost none. So Starborn stops beating her wings and spreads them wide and
 * still: her feathers are woven from starlight, and spread like this they
 * sail on the pressure of light, as a real solar sail does, only far more
 * strongly. Near a world she sails gently; out in the open she goes faster
 * the further she is from everything, so a crossing to the Moon or to Saturn
 * takes a minute and not a lifetime, and she always slows on her own as a
 * world draws near (the way "supercruise" works in space games: speed in
 * proportion to the distance to the nearest surface).
 *
 * Controls are the flying controls, given the meaning they have without
 * air: W/S set the sail (throttle), A/D turn, Space/C hold the nose up or
 * down (it levels again when let go), Shift holds a surge, E heads down to
 * land, and with a destination
 * chosen she can take you there herself (autopilot).
 *
 * Where she is: near a surface she flies in that surface's ordinary local
 * coordinates (on Earth, the game world itself); far out (deep mode) her
 * position is kept in float64 universe metres while she and her riders stay
 * parked at a fixed local anchor (spaceState.ts), and the "up" of that
 * parked frame slowly turns to the world she is approaching, so its horizon
 * comes level by itself.
 */

/** Leaving the Earth bubble for deep space, and coming back into it. */
export const DEEP_OUT = 42_000
export const DEEP_IN = 34_000
/**
 * The Moon's ground becomes the local world below this height over its mean
 * radius (~95 km real), and gives way to deep space above REALM_OUT. Its
 * elevation data starts loading from REALM_PREPARE on the way in.
 */
export const REALM_IN = 1500
export const REALM_OUT = 2200
const REALM_PREPARE = 60_000
/** The local frame is re-laid under her once she has sailed this far across it (arc, m). */
const REALM_RECENTRE = 7000
/** Hooves are kept this far over another world's ground while sailing, unless she is setting down. */
const HOVER_CLEARANCE = 1.6
/** How far round the globe the flat local world is used (arc from home). */
const LOCAL_REACH = 160_000
/** Sail speed: v = SAIL_K × (height over the nearest surface), plus a floor. */
const SAIL_K = 0.85
const SAIL_FLOOR = 38
const SURGE = 5
/** The sail setting on leaving the air: enough that she keeps her way on. */
const SAIL_ENTRY_THROTTLE = 0.72
/** Space/C hold the nose up or down to this pitch; let go and it comes level. */
const SAIL_PITCH_HOLD = 0.9
const SAIL_PITCH_MAX = 1.25
/** How quickly the nose settles back to the horizon with no hand on it. */
const SAIL_LEVEL_RATE = 1.1

export type SailAutopilot = { kind: "observation"; journey: string; stop: number } | { kind: "target"; id: string } | { kind: "home" } | { kind: "site"; id: string } | { kind: "cats" } | null

export const sailRT = {
  /** the star pirouette (W W on the sails): seconds into it (−1 when none) and its sense */
  pirouette: -1,
  pirouetteDir: 1,
  /** A naturally reached close-world neighbourhood, kept gentle until Dash or departure. */
  encounter: null as { bodyId: string; point: THREE.Vector3; frame: typeof spaceRT.frame; mode: typeof spaceRT.mode; pilot: HorseState } | null,
  autopilot: null as SailAutopilot,
  /** set when an autopilot arrives, for the HUD */
  arrived: null as string | null,
  /** a refusal or a notice for the HUD ("too close to the Sun") */
  notice: null as string | null,
  noticeT: 0,
  /** setting down on an airless world: the hooves are reaching for the dust */
  descending: false,
  /** seconds of drifting on after the ground below proved too steep or too rocky */
  blocked: 0,
  /** the last touchdown on another world (for the HUD, QA and the journal) */
  touchdowns: 0,
  /**
   * The mount the player is riding (CelestialController sets it each frame).
   * Only it carries the view between frames (deep space, the Moon's ground);
   * any other sailing Pegasus just glides in its own world.
   */
  pilot: null as HorseState | null,
  /** saved story time while away */
  savedOverride: undefined as number | null | undefined,
  /**
   * Cosmic travel (cosmicTravel.ts) moves the pilot itself while a journey
   * runs; it registers here so this module does not import it back.
   */
  travel: null as ((h: HorseState, dt: number) => boolean) | null,
}

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
const damp = (a: number, b: number, k: number, dt: number): number => a + (b - a) * (1 - Math.exp(-k * dt))
const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a))

const _u = new THREE.Vector3()
const _v = new THREE.Vector3()
const _w = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _radial = new THREE.Vector3()
const _m = new THREE.Matrix4()
const UP = new THREE.Vector3(0, 1, 0)

/** The mount's universe position. */
export const mountUniverse = (h: HorseState, out: THREE.Vector3): THREE.Vector3 =>
  spaceRT.mode === "deep" ? out.copy(spaceRT.pos) : localToUniverse(spaceRT.frame, h.x, h.y, h.z, out)

/** The rotation from the mount's local axes to universe axes. */
const mountAxes = (h: HorseState, out: THREE.Quaternion): THREE.Quaternion =>
  spaceRT.mode === "deep" ? out.copy(spaceRT.park) : localAxes(spaceRT.frame, h.x, h.z, out)

/** Unit forward vector of a heading and pitch, local axes. */
const forward = (heading: number, pitch: number, out: THREE.Vector3): THREE.Vector3 =>
  out.set(Math.sin(heading) * Math.cos(pitch), Math.sin(pitch), Math.cos(heading) * Math.cos(pitch))

const _ringC: RingCoords = { r: 0, y: 0, s: 0, rkm: 0 }

const notice = (text: string): void => {
  sailRT.notice = text
  sailRT.noticeT = 4
}

/** The lowest a world lets Starborn sail over it (celestial/hazards.ts). */
const floorOver = (b: BodyState): number => approachFloor(b)

export const sailSpeedLimit = (altitude: number): number => SAIL_FLOOR + SAIL_K * Math.max(0, altitude)

/**
 * The edge of the world: past the last world's orbit (with a margin)
 * there is nothing left to sail to. The sail's speed grows with the distance
 * to the nearest world, so heading out past it with the sail full used to
 * compound without end (a few seconds of W and Shift and she was a billion
 * light years out). Past the edge the outward speed bleeds away and she drifts,
 * free to turn back in at any speed.
 */
const _sunAt = new THREE.Vector3(), _edgeDir = new THREE.Vector3(), _edgeQ = new THREE.Quaternion()
let edgeCache = 0
export const universeEdge = (): { sun: THREE.Vector3; edge: number } => {
  const sun = bodyById("sun")
  _sunAt.copy(sun?.pos ?? _sunAt)
  if (!edgeCache) for (const b of universe.bodies) edgeCache = Math.max(edgeCache, b.pos.distanceTo(_sunAt) * 1.3)
  return { sun: _sunAt, edge: edgeCache || Infinity }
}
/** The fastest the sail allows `beyond` metres past the edge, moving outward. */
export const edgeSpeedLimit = (edge: number, beyond: number): number =>
  beyond <= 0 ? Infinity : Math.max(SAIL_FLOOR, sailSpeedLimit(edge) * Math.exp(-beyond / (edge * 0.06)))

/** The lower quarter of the sail is a gentle exploration gear, even beside
 * a giant world. Beyond it the remaining sail opens smoothly to cosmic speed. */
export const sailThrottleSpeed = (limit: number, throttle: number): number => {
  const t = clamp(throttle, 0, 1)
  return Math.min(limit, t <= 0.25 ? 2 + 58 * (t / 0.25) ** 2
    : 60 + Math.max(0, limit - 60) * ((t - 0.25) / 0.75) ** 2)
}

/** Geometric blending keeps a huge cosmic speed from leaking into the first
 * metres beyond the quiet neighbourhood; both ends have zero slope. */
export const encounterSpeedLimit = (normal: number, distance: number): number => {
  if (normal <= 60 || distance <= 1500) return Math.min(normal, 60)
  const t = clamp((distance - 1500) / 750, 0, 1)
  const blend = t * t * (3 - 2 * t)
  return 60 * Math.pow(normal / 60, blend)
}

/**
 * How fast the sail may go while there is still air (game m/s), by height
 * over Earth's datum (game m). Below ~100 km the air is thick enough that
 * anything moving much faster than ~4.5 km/s heats it into a glowing shock
 * layer, and the climb out should be calm, so going up she keeps under
 * 4.2 km/s until the air is gone (from ~108 km the cap lifts fast; by ~120
 * km it is far beyond anything she needs). Coming down she may come in as fast as a real
 * return from orbit (7.6 km/s) through the upper air, slowing to a glide
 * by the time the wings take over near 56 km.
 */
export const airSpeedCap = (earthAlt: number, descending: boolean): number => {
  const hk = (earthAlt * EARTH_SCALE) / 1000
  let kms: number
  // going up, the cap lifts only once the air is too thin to hold a shock
  // layer round her (~108 km: the mean free path there is near her size)
  if (!descending) kms = hk >= 108 ? 4.2 * Math.exp((hk - 108) / 4) : 4.2
  else if (hk >= 100) kms = 7.6 * Math.exp((hk - 100) / 5)
  else if (hk >= 75) kms = 7.6
  else {
    const t = clamp((hk - 55) / 20, 0, 1)
    kms = 2.4 + (7.6 - 2.4) * t * t * (3 - 2 * t)
  }
  return (kms * 1000) / EARTH_SCALE
}

/**
 * Start sailing (from the high air). She arrives from a wing-borne climb
 * nose-high and slow, so the sail is set well open (she keeps going instead
 * of stalling at the edge of space) and the nose eases down from there.
 */
export const enterSail = (f: FlightState): void => {
  f.mode = "sail"
  f.t = 0
  f.throttle = Math.max(f.throttle, SAIL_ENTRY_THROTTLE)
  f.pitch = clamp(f.pitch, -SAIL_PITCH_MAX, SAIL_PITCH_MAX)
  f.vy = 0
}

/** Freeze the story clock while away, so the planets hold still. */
const freezeTime = (): void => {
  if (spaceRT.frozenTime !== null) return
  spaceRT.frozenTime = worldRT.timeOfDay
  sailRT.savedOverride = worldRT.timeOverride
  worldRT.timeOverride = worldRT.timeOfDay
}
const thawTime = (): void => {
  if (spaceRT.frozenTime === null) return
  spaceRT.frozenTime = null
  worldRT.timeOverride = sailRT.savedOverride ?? null
  sailRT.savedOverride = undefined
}

/** Local → deep: keep everything the eye sees exactly where it is. */
const goDeep = (h: HorseState): void => {
  localToUniverse(spaceRT.frame, h.x, h.y, h.z, spaceRT.pos)
  localAxes(spaceRT.frame, h.x, h.z, spaceRT.park)
  spaceRT.anchor.set(h.x, h.y, h.z)
  spaceRT.mode = "deep"
  freezeTime()
}

/** Deep → local over a surface frame: re-express the mount's place and attitude. */
const comeDown = (h: HorseState): void => {
  const f = h.flight!
  // the direction of travel in universe axes, re-read in the new local axes
  forward(h.heading, f.pitch, _v).applyQuaternion(spaceRT.park)
  spaceRT.mode = "local"
  reframe(h, f)
}

/** Read the mount's universe place and direction (_v) in the current local frame. */
const reframe = (h: HorseState, f: FlightState): void => {
  universeToLocal(spaceRT.frame, spaceRT.pos, _u)
  h.x = _u.x; h.y = _u.y; h.z = _u.z
  localAxes(spaceRT.frame, h.x, h.z, _q).invert()
  _v.applyQuaternion(_q)
  h.heading = Math.atan2(_v.x, _v.z)
  f.pitch = Math.asin(clamp(_v.y, -1, 1))
  worldRT.snapCamera = true
}

const _target = new THREE.Vector3()
const _toLocal = new THREE.Quaternion()

/** Where the autopilot is steering, in universe metres, and how close is "there". */
// Returned vectors belong to the flight solver; presentation callers must copy them.
export const autopilotGoal = (h: HorseState): { point: THREE.Vector3; arrive: number; body: BodyState | null; look?: THREE.Vector3 } | null => {
  const ap = sailRT.autopilot
  if (!ap) return null
  if (ap.kind === "observation") {
    const journey = observationJourney(ap.journey), sun = bodyById("sun")
    const body = journey ? bodyById(journey.body) : undefined
    if (!journey || !body || !sun) return null
    observationPoint(journey, ap.stop, body, sun, _target)
    return { point: _target, arrive: Math.max(30, body.radius * 0.015), body, look: body.pos }
  }
  if (ap.kind === "home") {
    // above home, at the top of the air, then down through it
    localToUniverse(earthFrame(), 0, DATUM_Y + SAIL_ALTITUDE + 250, 0, _target)
    return { point: _target, arrive: 400, body: bodyById("earth") ?? null }
  }
  if (ap.kind === "cats") {
    // alongside the space cats: a little short of them, on the side she comes from
    if (!l1Point(_target)) return null
    mountUniverse(h, _u)
    _v.copy(_u).sub(_target)
    const d = _v.length()
    if (d > 1e-6) _target.addScaledVector(_v, 14 / d)
    return { point: _target, arrive: 7, body: null }
  }
  if (ap.kind === "site") {
    // a place on the Moon: come in high over it, then hold just above it
    const moon = bodyById("moon")
    if (!moon || !siteUniverse(ap.id, moon, 0, _target)) return null
    mountUniverse(h, _u)
    const over = _u.distanceTo(_target)
    // far out, aim at a point well above the site so the approach is from overhead
    siteUniverse(ap.id, moon, Math.min(900, Math.max(40, over * 0.35)), _target)
    return { point: _target, arrive: 60, body: moon }
  }
  const b = bodyById(ap.id)
  if (!b) return null
  // aim beside the world, not into it: an approach point on the near side
  mountUniverse(h, _u)
  _v.copy(_u).sub(b.pos).normalize()
  const stand = b.radius * (b.def.kind === "star" ? 3.5 : b.def.rings ? 2.6 : 1.6)
  _target.copy(b.pos).addScaledVector(_v, stand)
  return { point: _target, arrive: Math.max(b.radius * 0.25, 600), body: b }
}

/**
 * Advance a sailing Pegasus. Returns true (it is always airborne).
 */
/** How long the star pirouette takes (s). */
export const STAR_PIROUETTE = 2.4

/**
 * W tapped twice on the sails: the star pirouette. Out where nothing pushes on
 * a wing she turns once, slowly, about the length of her body, riders and
 * all, the sails held wide, and comes back to her course (the view holds
 * still; only she turns). Returns false if one is already under way.
 */
export const startStarPirouette = (h: HorseState, dir: number): boolean => {
  if (h.flight?.mode !== "sail" || sailRT.pirouette >= 0) return false
  sailRT.pirouette = 0
  sailRT.pirouetteDir = dir < 0 ? -1 : 1
  return true
}

export const stepSail = (h: HorseState, dt: number): boolean => {
  const f = h.flight!
  if (h !== sailRT.pilot) return stepStray(h, f, dt)
  // the star pirouette: one slow, eased turn about her length
  if (sailRT.pirouette >= 0) {
    sailRT.pirouette += dt
    const u = Math.min(1, sailRT.pirouette / STAR_PIROUETTE)
    f.spin = sailRT.pirouetteDir * Math.PI * 2 * u * u * (3 - 2 * u)
    if (u >= 1) { sailRT.pirouette = -1; f.spin = 0 }
  }
  if (sailRT.travel?.(h, dt)) { sailRT.encounter = null; return true }
  const i = f.intent
  f.t += dt
  sailRT.noticeT = Math.max(0, sailRT.noticeT - dt)

  // ---- the wings: spread wide and still, the sail set to the light ------
  f.spread = damp(f.spread, 1, 3, dt)
  f.glide = damp(f.glide, 1, 2.5, dt)
  f.power = damp(f.power, 0, 2, dt)
  f.tuck = damp(f.tuck, 0, 2, dt)
  f.flare = damp(f.flare, 0, 3, dt)
  f.flapHz = damp(f.flapHz, f.spec.flapHz * 0.6, 2, dt)

  // ---- where we are -----------------------------------------------------
  mountUniverse(h, _u)
  const near = nearestBody(_u)
  const altitude = near.altitude
  const onEarth = spaceRT.mode === "local" && spaceRT.realm === "earth"
  const onRealm = spaceRT.mode === "local" && spaceRT.realm !== "earth" && inRealm(h.x, h.z)
  const earthAlt = onEarth ? h.y - DATUM_Y : Infinity
  // over another world: the height of the hooves over its real ground
  const ground = onRealm ? groundHeight(h.x, h.z) : -Infinity
  const agl = onRealm ? h.y - ground : Infinity

  // ---- on an airless world she comes down and goes up like a lander -------
  if (onRealm && (f.rise > 0 || (i.land && agl < DESCENT_FROM))) return stepAirless(h, f, dt)
  sailRT.descending = false

  // ---- steering: the player, or the autopilot ---------------------------
  let turn = clamp(i.turn, -1, 1)
  let climb = clamp(i.climb, -1, 1)
  let throttleUp = i.thrust
  if (sailRT.autopilot && (Math.abs(i.turn) + Math.abs(i.climb) + Math.abs(i.thrust) > 0.12 || i.land || i.boost)) {
    sailRT.autopilot = null
    notice("You take the reins again.")
  }
  const goal = autopilotGoal(h)
  let goalDist = Infinity
  if (goal) {
    mountAxes(h, _toLocal).invert()
    _w.copy(goal.point).sub(_u)
    goalDist = _w.length()
    if (goal.look && goalDist <= goal.arrive * 1.3 && h.speed < Math.max(2, (goal.body?.radius ?? 0) * 0.001)) _w.copy(goal.look).sub(_u)
    _w.normalize().applyQuaternion(_toLocal)
    const wantHeading = Math.hypot(_w.x, _w.z) > 1e-7 ? Math.atan2(_w.x, _w.z) : h.heading
    const wantPitch = Math.asin(clamp(_w.y, -1, 1))
    // the player's own hands still steer over the autopilot
    if (Math.abs(i.turn) < 0.05) turn = clamp(wrapAngle(wantHeading - h.heading) * 2.2, -1, 1)
    if (Math.abs(i.climb) < 0.05) climb = clamp((wantPitch - f.pitch) * 2.5, -1, 1)
    if (Math.abs(i.thrust) < 0.05) throttleUp = goalDist > goal.arrive * 3 ? 1 : -0.6
    // over home: nose down through the last of the air, where the wings
    // take over and land (riding.ts)
    if (sailRT.autopilot?.kind === "home" && onEarth && Math.hypot(h.x, h.z) < 2500) {
      if (Math.abs(i.climb) < 0.05) climb = clamp((-0.65 - f.pitch) * 2.5, -1, 1)
      if (Math.abs(i.thrust) < 0.05) throttleUp = f.throttle > 0.35 ? -1 : 0
    }
    if (goalDist < goal.arrive && sailRT.autopilot?.kind !== "observation") {
      const kind = sailRT.autopilot?.kind
      sailRT.arrived = kind === "home" ? "home" : kind === "cats" ? "cats" : kind === "site" ? `site:${(sailRT.autopilot as { id: string }).id}` : goal.body?.def.id ?? null
      sailRT.autopilot = null
      if (kind === "home" && onEarth) {
        wingsAgain(h, f.spec.cruise)
        return true
      }
    }
  }
  // E: head down to land on whatever is below
  if (i.land) {
    climb = clamp((-0.6 - f.pitch) * 2.5, -1, 1)
    if (f.throttle > 0.4) throttleUp = -1
  }
  const turnRate = 0.85
  h.heading = wrapAngle(h.heading + turn * turnRate * dt)
  h.turnRate = turn * turnRate
  h.steer = turn
  // a gentle bank into the turn (left wing down for a left turn)
  f.roll = damp(f.roll, turn * 0.45, 2.5, dt)
  // The rider's Space/C hold the nose up or down, and letting go brings it
  // back to the horizon, as on the wing. (Steering the nose by rate alone
  // left her pointing wherever the climb out of the air had left her: nose
  // to the zenith, where A/D only spun her about her own spine.) The
  // autopilot and the E descent still steer the nose by rate.
  if (Math.abs(i.climb) >= 0.05) f.pitch = damp(f.pitch, clamp(i.climb, -1, 1) * SAIL_PITCH_HOLD, 1.6, dt)
  else if (goal || i.land) f.pitch = clamp(f.pitch + climb * 0.75 * dt, -SAIL_PITCH_MAX, SAIL_PITCH_MAX)
  else f.pitch = damp(f.pitch, 0, SAIL_LEVEL_RATE, dt)

  // ---- the sail: throttle and surge -------------------------------------
  f.throttle = clamp(f.throttle + throttleUp * 0.45 * dt, 0.04, 1)
  f.surge = damp(f.surge, i.boost ? 1 : 0, i.boost ? 1.5 : 2.5, dt)
  // her overdrive goes on into the sails while Shift is held (the sky's starbow and the FX read it)
  f.overdrive = damp(f.overdrive, i.boost && !!f.skills?.overdrive ? 1 : 0, i.boost ? 1.1 : 1.4, dt)
  // within Earth's last air the sail only slowly finds its strength; low
  // over the Moon she keeps to a pace the eye can follow over the ground
  const reach = Number.isFinite(earthAlt) ? Math.max(0, earthAlt - SAIL_ALTITUDE) : onRealm ? Math.max(0, Math.min(altitude, agl * 1.6)) : altitude
  const limit = sailSpeedLimit(reach) * (1 + (SURGE - 1) * f.surge) * (onRealm ? clamp(agl / 60, 0.1, 1) : 1)
  let speedT = sailThrottleSpeed(limit, f.throttle)
  // still in Earth's air: no faster than the air allows (no meteor-fire on the way up)
  if (onEarth) speedT = Math.min(speedT, airSpeedCap(earthAlt, f.pitch < -0.05 || sailRT.autopilot?.kind === "home"))
  // coming up to the space cats, whoever steers, she slows to a rendezvous
  if (waitingInSpace(voyage) && l1Point(_w)) speedT = Math.min(speedT, rendezvousLimit(_u.distanceTo(_w)))
  // the autopilot eases in so as to stop right at the goal
  if (goal) speedT = Math.min(speedT, sailRT.autopilot?.kind === "observation"
    ? observationSpeedLimit(goalDist, goal.arrive)
    : Math.max(onRealm ? 4 : SAIL_FLOOR, goalDist * 0.9))
  const anchor = sailRT.encounter
  if (anchor && (anchor.bodyId !== near.body.def.id || anchor.frame !== spaceRT.frame || anchor.mode !== spaceRT.mode || anchor.pilot !== h || anchor.point.distanceTo(_u) >= 2250 || goal)) sailRT.encounter = null
  if (!sailRT.encounter && !goal && !i.boost && h.speed < 30) {
    // The same physical approach ring used for a world's encounter; no
    // presentation dependency, artificial route, or steering correction.
    const stand = near.body.radius * (near.body.def.kind === "star" ? 3.5 : near.body.def.rings ? 2.6 : 1.9)
    const radial = _u.distanceTo(near.body.pos)
    if (radial > near.body.radius * 1.05 && radial < stand * 1.4) sailRT.encounter = { bodyId: near.body.def.id, point: _u.clone(), frame: spaceRT.frame, mode: spaceRT.mode, pilot: h }
  }
  if (sailRT.encounter && !goal && !i.boost) speedT = encounterSpeedLimit(speedT, _u.distanceTo(sailRT.encounter.point))
  // among Saturn's ice she rides at a pace the eye can follow, piece by piece
  const saturn = universe.byId.get("saturn")
  if (saturn) speedT = Math.min(speedT, ringSpeedCap(ringCoords(_u, saturn.pos, saturn.pole, _ringC), i.boost))
  // past the last world, outward, the sail has nothing to draw on
  const { sun, edge } = universeEdge()
  const beyond = _u.distanceTo(sun) - edge
  if (beyond > 0) {
    forward(h.heading, f.pitch, _edgeDir).applyQuaternion(mountAxes(h, _edgeQ))
    if (_edgeDir.dot(_radial.copy(_u).sub(sun).normalize()) > 0) {
      speedT = Math.min(speedT, edgeSpeedLimit(edge, beyond))
      if (sailRT.noticeT <= 0) notice("Past the last world there is only the dark. Turn back toward the Sun, or choose a world.")
    }
  }
  // thrown up out of the air in her overdrive, she coasts down to the sail's pace (Shift held), not braked to it
  h.speed = damp(h.speed, speedT, speedT < h.speed ? (onEarth && i.boost && f.overdrive > 0.3 ? 0.5 : 3) : 1.1, dt)
  h.targetSpeed = h.speed
  spaceRT.speed = h.speed

  // ---- don't sail into a world (or the Sun) -----------------------------
  forward(h.heading, f.pitch, _v)
  mountAxes(h, _q)
  _w.copy(_v).applyQuaternion(_q) // universe direction of travel
  const floor = floorOver(near.body)
  if (!onRealm && altitude < floor * 1.5 && !(near.body.def.id === "earth" && spaceRT.mode === "local")) {
    _radial.copy(_u).sub(near.body.pos).normalize()
    const inward = -_w.dot(_radial)
    if (inward > 0) {
      // slide along the surface instead of into it
      _w.addScaledVector(_radial, inward * smoothClose(altitude, floor)).normalize()
      if (altitude < floor) notice(hazardNotice(near.body))
    }
  }

  // ---- move -------------------------------------------------------------
  if (spaceRT.mode === "local") {
    _q.invert()
    _w.applyQuaternion(_q)
    // low over airless ground: the descent eases off above the dust
    if (onRealm && _w.y < 0) _w.y *= clamp((agl - HOVER_CLEARANCE) / (HOVER_CLEARANCE * 3), 0, 1)
    h.x += _w.x * h.speed * dt
    h.y += _w.y * h.speed * dt
    h.z += _w.z * h.speed * dt
    f.vy = _w.y * h.speed
    if (onEarth) {
      f.alt = h.y - DATUM_Y
      // back into the air: the wings take over again
      if (h.y - DATUM_Y - skyLift(h.x, h.z) < SAIL_ALTITUDE - 70 && f.pitch < 0.1) {
        f.mode = "air"
        f.t = 0
        f.pitch = Math.max(f.pitch, -0.35)
        sailRT.pirouette = -1
        f.spin = 0
        h.speed = Math.min(h.speed, f.spec.boost)
        thawTime()
        return true
      }
      // out of the bubble round home: into deep space. Far across the planet
      // only while still high, or a descent far from home (deep space hands
      // back below DEEP_IN wherever she is) would flap between the two frames
      if (h.y - DATUM_Y > DEEP_OUT || (Math.hypot(h.x, h.z) > LOCAL_REACH && h.y - DATUM_Y > DEEP_IN)) goDeep(h)
    } else {
      // never into a crater wall or a hill ahead
      const under = groundHeight(h.x, h.z)
      if (h.y < under + HOVER_CLEARANCE * 0.6) h.y = under + HOVER_CLEARANCE * 0.6
      f.alt = h.y - under
      // far across the frame: lay it again under her, so it never stretches
      if (Math.hypot(h.x - spaceRT.frame.ox, h.z - spaceRT.frame.oz) > REALM_RECENTRE) recentre(h)
      // up and away: deep space again
      else if (altitude > REALM_OUT) {
        goDeep(h)
        leaveRealm()
      }
    }
  } else {
    spaceRT.pos.addScaledVector(_w, h.speed * dt)
    spaceRT.vel.copy(_w).multiplyScalar(h.speed)
    f.alt = altitude
    f.vy = 0
    // A planet or moon has a landing horizon. A star does not: rotating the
    // free-space frame toward its radial up would turn an arrival facing the
    // Sun into a climb away from it, without any steering from the rider.
    if (near.body.def.kind !== "star") levelTo(near.body, altitude, dt)
    if (near.body.def.id === "earth" && altitude < DEEP_IN) {
      // home again: Earth's air below
      spaceRT.frame = earthFrame()
      spaceRT.realm = "earth"
      comeDown(h)
    } else if (canLand(near.body)) {
      // the Moon: its ground comes up to meet her
      if (altitude < REALM_PREPARE) prepareRealm(near.body.def.id)
      if (altitude < REALM_IN && realmReady(near.body.def.id) && enterRealm(near.body, spaceRT.pos)) comeDown(h)
    }
  }
  f.stats.maxAlt = Math.max(f.stats.maxAlt, Math.min(f.alt, 1e12))
  f.stats.airTime += dt
  return true
}

/**
 * A sailing Pegasus nobody is riding (her rider got off high up, or a debug
 * placement): she never moves the view between frames. Over home she simply
 * spreads her wings and glides down into the air again; on the Moon she
 * settles to the dust.
 */
const stepStray = (h: HorseState, f: FlightState, dt: number): boolean => {
  if (inRealm(h.x, h.z)) {
    f.intent.land = true
    return stepAirless(h, f, dt)
  }
  f.mode = "air"
  f.t = 0
  f.rise = 0
  f.pitch = Math.max(-0.3, Math.min(0.1, f.pitch))
  h.speed = Math.min(h.speed, f.spec.boost)
  return true
}

/** Begin the descent on airless ground from this height over it (m). */
const DESCENT_FROM = 450
/** Seconds of the straight rise off airless ground. */
const RISE_TIME = 2.6

/** Off the ground of an airless world: a straight rise on the sails, then away. */
export const liftOffAirless = (h: HorseState): void => {
  const f = h.flight!
  f.mode = "sail"
  f.t = 0
  f.rise = RISE_TIME
  f.vy = 0
  f.pitch = 0
  f.throttle = Math.max(0.12, Math.min(f.throttle, 0.25))
  h.speed = Math.min(h.speed, 1)
  sailRT.descending = false
}

/**
 * Starborn over airless ground, coming down or going up. No wing can bear her
 * here, so she moves the way a lander does: down fast while high, braking to
 * a walking pace over the last metres and settling onto her hooves; up
 * straight off the dust before the sails take her away. The player still
 * steers and edges her forward to find level ground.
 */
const stepAirless = (h: HorseState, f: FlightState, dt: number): boolean => {
  const i = f.intent
  h.heading = wrapAngle(h.heading + clamp(i.turn, -1, 1) * 0.6 * dt)
  h.turnRate = clamp(i.turn, -1, 1) * 0.6
  h.steer = clamp(i.turn, -1, 1)
  f.roll = damp(f.roll, 0, 2.5, dt)
  if (f.rise > 0) {
    f.rise -= dt
    sailRT.descending = false
    const u = 1 - Math.max(0, f.rise) / RISE_TIME
    f.vy = damp(f.vy, 1.4 + 6 * u * u, 2.5, dt)
    h.speed = damp(h.speed, 1.5 + 4 * u, 1, dt)
    f.pitch = damp(f.pitch, 0.1 + 0.35 * u, 1.5, dt)
    if (f.rise <= 0) {
      f.rise = 0
      f.t = 0
    }
  } else {
    sailRT.descending = true
    const agl = h.y - groundHeight(h.x, h.z)
    // brake to a slow drift; W/S edges her on or holds her still. Held up
    // over a slope or a boulder she drifts on by herself to find level ground
    sailRT.blocked = Math.max(0, sailRT.blocked - dt)
    const drift = Math.max(sailRT.blocked > 0 ? 1.6 : 0, Math.min(agl * 0.25, 14) + clamp(i.thrust, -1, 1) * 2.5)
    h.speed = damp(h.speed, drift, 1.2, dt)
    f.pitch = damp(f.pitch, 0, 2, dt)
    // quick from high up, a walking pace over the dust; Space holds her up
    const sink = i.climb > 0 ? 0 : -(0.6 + Math.min(agl, 140) * 0.3)
    f.vy = damp(f.vy, sink, 2.5, dt)
  }
  h.targetSpeed = h.speed
  spaceRT.speed = h.speed
  h.x += Math.sin(h.heading) * h.speed * dt
  h.z += Math.cos(h.heading) * h.speed * dt
  h.y += f.vy * dt
  const under = groundHeight(h.x, h.z)
  if (h.y - under <= 0.03) {
    if (f.rise > 0 || !standable(h.x, h.z, 0.75)) {
      // a crater wall or a boulder underfoot: hold just above it, and move on
      h.y = under + 0.4
      f.vy = Math.max(0, f.vy)
      sailRT.blocked = 1.2
      if (f.rise <= 0) notice(`Too steep for ${h.ident.name}'s hooves here — drift on to level ground.`)
    } else {
      settleOnGround(h)
      return true
    }
  }
  f.alt = h.y - under
  f.stats.airTime += dt
  return true
}

/** Hooves down on another world. */
const settleOnGround = (h: HorseState): void => {
  const f = h.flight!
  f.mode = "ground"
  f.t = 0
  f.vy = 0
  f.pitch = 0
  f.roll = 0
  f.alt = 0
  f.boostT = 0
  f.rise = 0
  f.stats.landings++
  h.y = groundHeight(h.x, h.z)
  h.speed = 0
  h.targetSpeed = 0
  h.turnRate = 0
  h.landed = true
  sailRT.descending = false
  sailRT.touchdowns++
  if (h === sailRT.pilot && spaceRT.realm === "moon") rememberMoonLanding()
}

/** Lay the world's frame again under the mount (it has sailed far across it). */
const recentre = (h: HorseState): void => {
  const f = h.flight!
  localToUniverse(spaceRT.frame, h.x, h.y, h.z, spaceRT.pos)
  forward(h.heading, f.pitch, _v).applyQuaternion(localAxes(spaceRT.frame, h.x, h.z, _q))
  if (!realmRT.body || !recentreRealm(spaceRT.pos)) return
  reframe(h, f)
}

const smoothClose = (alt: number, floor: number): number => clamp(1.5 - alt / floor, 0, 1) * 1.2

/**
 * Turn the parked frame so its "up" points away from the world being
 * approached: the riders' horizon levels to that world's horizon. The
 * mount's local attitude is kept, so this is a slow, gentle roll of the view.
 */
const _levelC: RingCoords = { r: 0, y: 0, s: 0, rkm: 0 }
const _pole = new THREE.Vector3()
const levelTo = (b: BodyState, altitude: number, dt: number): void => {
  let pull = 1 - clamp(Math.log10(Math.max(1, altitude / b.radius)) / 1.3, 0, 1)
  _v.copy(spaceRT.pos).sub(b.pos).normalize()
  _w.copy(UP).applyQuaternion(spaceRT.park)
  // Among Saturn's rings the ice is the horizon, not the planet's limb: level
  // to the ring plane, keeping whichever side of it her head is already on,
  // so crossing the plane (either way) never rolls her over.
  if (b.def.id === "saturn") {
    const ring = ringPlaneWeight(ringCoords(spaceRT.pos, b.pos, b.pole, _levelC))
    if (ring > 0) {
      _pole.copy(b.pole).multiplyScalar(_w.dot(b.pole) < 0 ? -1 : 1)
      _v.multiplyScalar(1 - ring).addScaledVector(_pole, ring)
      if (_v.lengthSq() < 1e-8) _v.copy(_pole)
      _v.normalize()
      pull = Math.max(pull, ring)
    }
  }
  if (pull <= 0) return
  const angle = _w.angleTo(_v)
  if (angle < 1e-5) return
  const step = Math.min(angle, 0.35 * pull * dt)
  _u.crossVectors(_w, _v).normalize()
  _q.setFromAxisAngle(_u, step)
  spaceRT.park.premultiply(_q).normalize()
}

/**
 * QA (`?debug`): put a sailing mount in deep space at a universe point,
 * facing along `dir` (universe), with the parked frame's up away from `up`.
 */
export const placeInSpace = (h: HorseState, p: THREE.Vector3, up: THREE.Vector3): void => {
  sailRT.encounter = null
  const f = h.flight!
  if (spaceRT.realm !== "earth") leaveRealm()
  // park the anchor where a real flight would (DEEP_OUT over home), never in
  // home's meadow, or the hub's scenery would stand round her in space
  if (spaceRT.mode === "local") {
    h.y = Math.max(h.y, DATUM_Y + DEEP_OUT + 100)
    goDeep(h)
  }
  f.mode = "sail"
  f.rise = 0
  f.pitch = 0
  spaceRT.pos.copy(p)
  spaceRT.park.setFromUnitVectors(UP, _v.copy(up).normalize())
  h.speed = 0
}

/** The planets stand still while the clock is frozen; restore it on landing at home. */
export const sailHome = (): void => thawTime()

/**
 * Cosmic travel (cosmicTravel.ts): carry the mount into deep space at a
 * universe point, the parked frame turned so her local forward (+z, level)
 * points along `dir` (universe) and its up is as near `up` as that allows.
 * Wherever she was (home's air, the Moon's ground), the anchor goes high over
 * an empty part of the local plane so no scenery stands round her out there.
 */
export const parkInDeep = (h: HorseState, p: THREE.Vector3, dir: THREE.Vector3, up: THREE.Vector3): void => {
  sailRT.encounter = null
  const f = h.flight!
  if (spaceRT.realm !== "earth") leaveRealm()
  if (spaceRT.mode === "local") {
    h.y = Math.max(h.y, DATUM_Y + DEEP_OUT + 100)
    goDeep(h)
  }
  f.mode = "sail"
  f.rise = 0
  f.pitch = 0
  f.roll = 0
  h.heading = 0
  spaceRT.pos.copy(p)
  // local +z → dir, local +y → up made square to dir
  _v.copy(dir).normalize()
  _w.copy(up).addScaledVector(_v, -up.dot(_v))
  if (_w.lengthSq() < 1e-10) _w.set(0, 1, 0).addScaledVector(_v, -_v.y)
  if (_w.lengthSq() < 1e-10) _w.set(1, 0, 0)
  _w.normalize()
  _u.crossVectors(_w, _v)
  _m.makeBasis(_u, _w, _v)
  spaceRT.park.setFromRotationMatrix(_m)
  worldRT.snapCamera = true
}

/**
 * Cosmic travel: back into home's air at a local point (the frame turns back
 * to home's, the clock runs again). She arrives on her sails and the caller
 * hands her to the wings.
 */
export const arriveOverEarth = (h: HorseState, x: number, y: number, z: number, heading: number): void => {
  sailRT.encounter = null
  const f = h.flight!
  if (spaceRT.realm !== "earth") leaveRealm()
  spaceRT.frame = earthFrame()
  spaceRT.realm = "earth"
  spaceRT.mode = "local"
  h.x = x; h.y = y; h.z = z
  h.heading = heading
  f.mode = "sail"
  f.pitch = 0
  f.roll = 0
  f.rise = 0
  thawTime()
  worldRT.snapCamera = true
}

/** Hand a sailing mount over Earth back to her wings, flying on (never landing). */
export const wingsAgain = (h: HorseState, speed: number): void => {
  sailRT.encounter = null
  const f = h.flight!
  f.mode = "air"
  f.t = 0
  f.vy = 0
  f.pitch = 0
  f.boutFlap = true
  f.bout = 2.5
  h.speed = Math.min(speed, f.spec.boost)
  h.targetSpeed = h.speed
  spaceRT.speed = h.speed
  thawTime()
}

/** HUD and QA: the mount's sky readout. */
export const sailInfo = (h: HorseState): { altitude: number; nearest: string; speed: number; throttle: number } => {
  mountUniverse(h, _u)
  const n = nearestBody(_u)
  return { altitude: n.altitude, nearest: n.body.def.name, speed: h.speed, throttle: h.flight?.throttle ?? 0 }
}

export { EARTH_R, universe }
