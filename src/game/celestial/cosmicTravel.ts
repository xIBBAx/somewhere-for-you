import * as THREE from "three"
import type { HorseState } from "../horses/horseState"
import { resetFlightControls } from "../horses/riding"
import { DATUM_Y, KM } from "./scale"
import { ringRT } from "./rings/ringPhysics"
import { spaceRT, universeDirToLocal } from "./spaceState"
import { cameraRT } from "../runtime"
import { arriveOverEarth, mountUniverse, parkInDeep, sailRT, wingsAgain } from "./starSail"
import { bodyById } from "./universe"
import { earthFrame, localToUniverse } from "./frames"
import { siteUniverse } from "./realm/lunarSites"
import { l1Point } from "./spaceCats/journey"
import { aberrationRT } from "./render/aberration"
import { journeyBeta, launchKick } from "./travelEnvelope"
import { names } from "../../personalization"

/**
 * Cosmic travel: Starborn's starlight run. The explorer picks a world; Starborn rears,
 * gathers her starlight and launches with one great wingbeat. As she reaches
 * her running speed the real sky crowds forward into a blazing, colour-banded
 * cone ahead (relativistic aberration, render/aberration.ts), stardust streams
 * past with parallax and she runs through a nebula or two; the destination
 * swells ahead, the sky unfolds back to where the stars really are and she
 * glides out beside it, sailing and in the explorer's hands again. Coming home, the corridor lets her out high
 * over Earth and she falls through the air on a glowing re-entry, pulling
 * out above home in ordinary wing-borne flight (never landing by herself).
 *
 * It is magic and says so: the speed is Starborn's starlight, not a claim
 * about real physics (the way the sky looks at that speed is real). The journey moves her true universe position, so
 * everything the sky shows on the way is the real sky.
 *
 * Phases:  gather → corridor → emerge            (to a world in space)
 *          gather → corridor → reentry          (home to Earth)
 * Every phase can be skipped (E / "Arrive now"); Esc drops out of the
 * corridor where she is. Quick travel plays a short flash instead.
 *
 * The VFX (WarpCorridor, ReentryFX) and the HUD only read `travelRT`.
 */

export type TravelDestination =
  | { kind: "body"; id: string }
  | { kind: "site"; id: string }
  | { kind: "cats" }
  | { kind: "earth" }
  /** into Saturn's rings: the A ring's ice, flying along the orbit */
  | { kind: "rings" }

export type TravelPhase = "idle" | "gather" | "corridor" | "emerge" | "reentry"

export const travelRT = {
  phase: "idle" as TravelPhase,
  /** "quick": a short flash instead of the corridor */
  style: "cinematic" as "cinematic" | "quick",
  dest: null as TravelDestination | null,
  /** shown in the HUD and tinting the corridor's light (CSS colour) */
  name: "",
  color: "#cfe0ff",
  /** seconds into the current phase and its length */
  t: 0,
  duration: 0,
  /** 0..1 through the current phase */
  u: 0,
  /** 0..1 through the whole journey */
  progress: 0,
  /** 0..1: how strongly the corridor is open (VFX, audio, camera FOV) */
  intensity: 0,
  /** 0..1 a white bloom at the moments of opening and bursting out */
  flash: 0,
  /** re-entry: 0..1 heat of the plasma sheath and the pull the riders feel */
  heat: 0,
  pull: 0,
  /** the player's sway inside the corridor (−1..1, eased), for the body and camera */
  sway: 0,
  /** v / c the sky is drawn at (aberration and Doppler shift of the real stars) */
  beta: 0,
  /** 0..1 the launch's kick (the camera is left behind a moment, a great wingbeat) */
  launch: 0,
  /** finished journeys (QA, journal) */
  journeys: 0,
  /** set for one frame on arrival: "body:mars", "earth", … (HUD toast) */
  arrived: null as string | null,
}

export const travelling = (): boolean => travelRT.phase !== "idle"

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
const damp = (a: number, b: number, k: number, dt: number): number => a + (b - a) * (1 - Math.exp(-k * dt))
const smooth = (u: number): number => u * u * (3 - 2 * u)

const calmMotion = (): boolean => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

const GATHER = 1.5
const QUICK_GATHER = 0.45
const EMERGE = 1.8
const QUICK_EMERGE = 0.7
/** Re-entry: from this height over home's datum (game m, ~1900 km real) to the pull-out. */
/** arriving at the rings: this far above the ring plane (game m), over the ice */
const RINGS_ARRIVE_ABOVE = 30
const REENTRY_TOP = 30_000
const REENTRY_BOTTOM = 520
const REENTRY_TIME = 9
/** horizontal run over the last of re-entry, ending above home */
const REENTRY_RUN = 2600
const REENTRY_HEADING = 0.6
/** the corridor stops this far short of the goal, as a fraction of where it started (then emerge closes it) */
const CORRIDOR_RATIO = 1e-5

const start = new THREE.Vector3()
const goal = new THREE.Vector3()
const dir = new THREE.Vector3()
const up = new THREE.Vector3()
const _v = new THREE.Vector3()
const _u = new THREE.Vector3()
const _w = new THREE.Vector3()
const _aim = new THREE.Vector3()
let arriveNow = false
let startDist = 0
let corridorEnd = 0

const COLORS: Record<string, string> = {
  sun: "#ffd27a", mercury: "#d9c3a5", venus: "#ffe2a8", earth: "#9fd2ff", moon: "#e8ecf4", mars: "#ff9d6e",
  jupiter: "#f2c894", saturn: "#f6dfa4", uranus: "#a8f0ee", neptune: "#7ea6ff", pluto: "#f0d6c2",
}

/**
 * The rings' sunlit face (+pole or -pole): she arrives over the bright ice,
 * not the night face (since Saturn's 2025 equinox the Sun lights the south).
 */
const litFace = (sat: { pos: THREE.Vector3; pole: THREE.Vector3 }, out: THREE.Vector3): THREE.Vector3 => {
  const sun = bodyById("sun")
  const side = sun && _litTmp.copy(sun.pos).sub(sat.pos).dot(sat.pole) < 0 ? -1 : 1
  return out.copy(sat.pole).multiplyScalar(side)
}
const _litTmp = new THREE.Vector3()

/** Name and light of a destination; null if it cannot be reached now. */
export const describe = (d: TravelDestination): { name: string; color: string } | null => {
  if (d.kind === "earth") return { name: "Earth", color: COLORS.earth }
  if (d.kind === "rings") return bodyById("saturn") ? { name: "Saturn's rings", color: "#f6e7c8" } : null
  if (d.kind === "cats") return l1Point(_v) ? { name: "The space cats", color: "#ffe6f4" } : null
  if (d.kind === "site") return bodyById("moon") ? { name: "The Moon", color: COLORS.moon } : null
  const b = bodyById(d.id)
  if (!b) return null
  return { name: b.def.name, color: COLORS[d.id] ?? COLORS[b.def.parent ?? ""] ?? "#d8e4ff" }
}

/** Where a journey ends, in universe metres (the approach point, never inside a world). */
const goalPoint = (h: HorseState, d: TravelDestination, out: THREE.Vector3): boolean => {
  mountUniverse(h, _v)
  if (d.kind === "earth") {
    localToUniverse(earthFrame(), -Math.sin(REENTRY_HEADING) * REENTRY_RUN, DATUM_Y + REENTRY_TOP, -Math.cos(REENTRY_HEADING) * REENTRY_RUN, out)
    return !!bodyById("earth")
  }
  if (d.kind === "rings") {
    // the middle of the A ring (128,000 km), on the side she comes from, a
    // little above the ice so she arrives looking out along it
    const sat = bodyById("saturn")
    if (!sat) return false
    _w.copy(_v).sub(sat.pos)
    _w.addScaledVector(sat.pole, -_w.dot(sat.pole))
    if (_w.lengthSq() < 1e-6) _w.set(1, 0, 0).addScaledVector(sat.pole, -sat.pole.x)
    _w.normalize()
    out.copy(sat.pos).addScaledVector(_w, 128_000 * KM).addScaledVector(litFace(sat, _u), RINGS_ARRIVE_ABOVE)
    return true
  }
  if (d.kind === "cats") {
    if (!l1Point(out)) return false
    _w.copy(_v).sub(out)
    const len = _w.length()
    if (len > 1e-6) out.addScaledVector(_w, 40 / len)
    return true
  }
  const b = bodyById(d.kind === "site" ? "moon" : d.id)
  if (!b) return false
  if (d.kind === "site") {
    if (!siteUniverse(d.id, b, 900, out)) return false
    return true
  }
  // beside the world on the side she comes from, far enough to take it all in
  _w.copy(_v).sub(b.pos).normalize()
  const stand = b.radius * (b.def.kind === "star" ? 3.5 : b.def.rings ? 2.6 : 1.9)
  out.copy(b.pos).addScaledVector(_w, stand)
  return true
}

/**
 * Begin a journey. Returns a reason when it cannot begin (shown as a hint),
 * or null once it has.
 */
export const startJourney = (h: HorseState | null, d: TravelDestination, style: "cinematic" | "quick" = "cinematic"): string | null => {
  if (!h?.flight?.spec.celestial) return `Only ${names.starborn}, the star-born, can carry you between worlds.`
  const info = describe(d)
  if (!info) return "That place isn't out there right now."
  if (travelling()) {
    // changing her mind on the way: Starborn turns toward the new world from where she is
    if (travelRT.phase === "gather" || travelRT.phase === "corridor") {
      if (d.kind === "earth" && travelRT.phase === "gather" && spaceRT.mode === "local" && spaceRT.realm === "earth") return "You're already home in Earth's sky."
      travelRT.dest = d
      travelRT.name = info.name
      travelRT.color = info.color
      if (travelRT.phase === "corridor") openCorridor(h, true)
      return null
    }
    return "Nearly there — arrive first, then choose another world."
  }
  if (h.rider) resetFlightControls(h.rider)
  if (h.passenger) resetFlightControls(h.passenger)
  // already in home's air and asked for Earth: nothing to cross
  if (d.kind === "earth" && spaceRT.mode === "local" && spaceRT.realm === "earth" && h.y - DATUM_Y < REENTRY_TOP) return "You're already home in Earth's sky."
  // already flying among the ice: nothing to cross
  if (d.kind === "rings" && spaceRT.mode === "deep" && ringRT.vis > 0.5) return "You're already among Saturn's rings — fly on through them."
  arriveNow = false
  sailRT.autopilot = null
  sailRT.arrived = null
  travelRT.style = style
  travelRT.dest = d
  travelRT.name = info.name
  travelRT.color = info.color
  travelRT.flash = 0
  travelRT.heat = travelRT.pull = travelRT.sway = 0
  travelRT.arrived = null
  enter("gather", style === "quick" ? QUICK_GATHER : GATHER)
  const f = h.flight
  // on the ground or on the wing, she takes to her sails where she is
  if (f.mode !== "sail") {
    f.mode = "sail"
    f.t = 0
    f.rise = 0
    f.vy = 0
  }
  f.throttle = Math.max(f.throttle, 0.5)
  return null
}

/** Arrive now: the rest of the journey in a moment. */
export const skipJourney = (): void => {
  if (travelling()) arriveNow = true
}

/** Release presentation and course ownership when the pilot disappears. */
export const resetTravelState = (): void => {
  arriveNow = false
  travelRT.beta = travelRT.launch = aberrationRT.beta = 0
  travelRT.phase = "idle"
  travelRT.t = travelRT.u = travelRT.progress = 0
  travelRT.intensity = travelRT.flash = travelRT.heat = travelRT.pull = travelRT.sway = 0
  travelRT.arrived = null
  travelRT.dest = null
  sailRT.autopilot = null
}

/** Take the reins at the current safe position in any phase. */
export const dropOut = (h: HorseState): void => {
  if (!travelling()) return
  const inAir = spaceRT.mode === "local" && spaceRT.realm === "earth"
  finish(h, false)
  if (inAir) wingsAgain(h, h.flight!.spec.cruise)
}

const enter = (phase: TravelPhase, duration: number): void => {
  travelRT.phase = phase
  travelRT.t = 0
  travelRT.u = 0
  travelRT.duration = duration
}

const corridorTime = (dist: number): number => clamp(3.2 + 0.85 * Math.log10(Math.max(10, dist) / 1000), 4, 9)

/** 1 → 0 along the corridor: the share of the way still to go (falls geometrically: the world swells steadily) */
const corridorShape = (u: number): number => (Math.pow(CORRIDOR_RATIO, smooth(u)) - CORRIDOR_RATIO) / (1 - CORRIDOR_RATIO)
/** a redirected run starts part way along its shape; this is the shape's value there */
let rebase = 0

/** Where the corridor has carried her. */
const corridorPoint = (u: number, out: THREE.Vector3): THREE.Vector3 => {
  let g = corridorShape(u)
  if (rebase > 0) g = Math.min(1, g / rebase)
  return out.copy(goal).addScaledVector(dir, -(corridorEnd + (startDist - corridorEnd) * g))
}

/** The pilot's per-frame step while a journey runs (starSail calls it first). Returns false when idle. */
export const stepTravel = (h: HorseState, dt: number): boolean => {
  if (travelRT.phase === "idle") return false
  const f = h.flight!
  const i = f.intent
  if (arriveNow) {
    arriveNow = false
    if (travelRT.phase === "gather") openCorridor(h)
    if (!travelling()) return true
    if (travelRT.dest?.kind === "earth") {
      arriveOverEarth(h, 0, DATUM_Y + REENTRY_BOTTOM, 0, REENTRY_HEADING)
    } else spaceRT.pos.copy(goal)
    finish(h, true)
    return true
  }
  travelRT.t += dt
  travelRT.u = clamp(travelRT.t / Math.max(1e-3, travelRT.duration), 0, 1)
  const u = travelRT.u
  travelRT.flash = damp(travelRT.flash, 0, 3.5, dt)
  travelRT.sway = damp(travelRT.sway, clamp(i.turn, -1, 1), 2, dt)
  // how the sky looks at her speed: deep in space she runs along local +z;
  // gathering in home's air, along her nose
  travelRT.beta = journeyBeta(travelRT.phase, u, travelRT.style === "quick", calmMotion(), travelRT.t)
  travelRT.launch = launchKick(travelRT.phase, travelRT.t)
  aberrationRT.beta = travelRT.beta
  if (spaceRT.mode === "deep") aberrationRT.dir.set(0, 0, 1)
  else aberrationRT.dir.set(Math.sin(h.heading), 0, Math.cos(h.heading))
  // wings: raised and open as she gathers, one great stroke at the launch,
  // then swept back for the run with a slow stroke now and then (alive, not a
  // statue), opening wide again to brake into the arrival
  const ph = travelRT.phase
  const stroke = ph === "corridor" && travelRT.style !== "quick" ? Math.pow(Math.max(0, Math.sin(travelRT.t * 0.9)), 6) * 0.45 : 0
  f.spread = damp(f.spread, 1, 4, dt)
  f.glide = damp(f.glide, ph === "corridor" ? 1 - 0.6 * travelRT.launch : 1, 3, dt)
  f.power = damp(f.power, ph === "gather" ? 0.35 + 0.4 * u : ph === "corridor" ? Math.max(travelRT.launch, stroke) : ph === "emerge" ? 0.5 * (1 - u) : 0, 5, dt)
  f.tuck = damp(f.tuck, ph === "corridor" ? 0.5 * (1 - travelRT.launch) : ph === "reentry" ? 0.3 + 0.4 * travelRT.pull : ph === "emerge" ? 0.05 : 0.1, 2.5, dt)
  f.roll = damp(f.roll, travelRT.sway * 0.4, 3, dt)
  f.stats.airTime += dt

  if (travelRT.phase === "gather") {
    travelRT.intensity = damp(travelRT.intensity, 0.55, 3, dt)
    travelRT.progress = 0.08 * u
    // a held breath: she slows, rises a little off whatever is below, and
    // wheels round to face the world she is going to, so the launch runs
    // straight out along her own nose
    h.speed = damp(h.speed, 0, 3, dt)
    if (travelRT.dest && goalPoint(h, travelRT.dest, _aim)) {
      mountUniverse(h, _v)
      universeDirToLocal(_aim.sub(_v), _aim)
      if (_aim.lengthSq() > 1e-12) {
        const want = Math.atan2(_aim.x, _aim.z)
        const d = Math.atan2(Math.sin(want - h.heading), Math.cos(want - h.heading))
        h.heading += d * (1 - Math.exp(-2.4 * dt))
        f.roll = damp(f.roll, clamp(d * 0.5, -0.45, 0.45), 4, dt)
      }
    }
    if (spaceRT.mode === "local") h.y += (1 - u) * 4 * dt
    // rearing: nose high, the breath held before the launch
    f.pitch = damp(f.pitch, 0.38 * Math.sin(Math.PI * Math.min(1, u * 1.15)), 3, dt)
    if (u >= 1) openCorridor(h)
    return true
  }
  if (travelRT.phase === "corridor") {
    travelRT.intensity = damp(travelRT.intensity, 1, 4, dt)
    travelRT.progress = 0.08 + 0.8 * u
    corridorPoint(u, spaceRT.pos)
    spaceRT.vel.copy(dir).multiplyScalar(0)
    // the sway only leans her: the corridor holds the course
    h.heading = travelRT.sway * 0.18
    f.pitch = damp(f.pitch, 0, 2, dt)
    h.speed = 30 + 60 * Math.sin(Math.PI * u)
    spaceRT.speed = h.speed
    if (u >= 1) {
      if (travelRT.dest?.kind === "earth") startReentry(h)
      else enter("emerge", travelRT.style === "quick" ? QUICK_EMERGE : EMERGE)
      travelRT.flash = 1
    }
    return true
  }
  if (travelRT.phase === "emerge") {
    travelRT.intensity = damp(travelRT.intensity, 0, 3, dt)
    travelRT.progress = 0.88 + 0.12 * u
    _v.copy(goal).addScaledVector(dir, -corridorEnd * (1 - smooth(u)))
    spaceRT.pos.copy(_v)
    h.heading = damp(h.heading, 0, 2, dt)
    h.speed = damp(h.speed, 6, 2.5, dt)
    spaceRT.speed = h.speed
    if (u >= 1) finish(h, true)
    return true
  }
  // ---- re-entry: Earth swells below, the air thickens and glows round her
  const e = smooth(u)
  const alt = Math.exp(Math.log(REENTRY_TOP) + (Math.log(REENTRY_BOTTOM) - Math.log(REENTRY_TOP)) * e)
  const prevY = h.y
  const run = REENTRY_RUN * e
  h.x = -Math.sin(REENTRY_HEADING) * (REENTRY_RUN - run)
  h.z = -Math.cos(REENTRY_HEADING) * (REENTRY_RUN - run)
  h.y = DATUM_Y + alt
  h.heading = REENTRY_HEADING + travelRT.sway * 0.2
  const altKm = alt * 0.06371
  // the plasma sheath glows in the upper air (~120–55 km real), strongest near 70 km
  travelRT.heat = clamp(Math.exp(-Math.pow((altKm - 72) / 26, 2)) * (alt < 2400 ? 1 : 0.15), 0, 1)
  // the riders feel the fall build and then the pull-out
  travelRT.pull = clamp(Math.sin(Math.PI * clamp(u * 1.15, 0, 1)), 0, 1)
  travelRT.intensity = damp(travelRT.intensity, 0, 2, dt)
  travelRT.progress = 0.85 + 0.15 * u
  f.pitch = damp(f.pitch, u < 0.82 ? -0.55 : -0.05, u < 0.82 ? 2 : 1.4, dt)
  h.speed = Math.max(12, Math.abs(prevY - h.y) / Math.max(dt, 1e-3))
  spaceRT.speed = h.speed
  f.alt = alt
  // Space in the last of the fall: pull out now, where she is
  const pullOut = i.climb > 0.3 && alt < 1600
  if (u >= 1 || pullOut) finish(h, true)
  return true
}

const openCorridor = (h: HorseState, redirect = false): void => {
  const d = travelRT.dest!
  mountUniverse(h, start)
  if (!goalPoint(h, d, goal)) { finish(h, false); return }
  dir.copy(goal).sub(start)
  startDist = dir.length()
  if (startDist < 1) { finish(h, true); return }
  dir.divideScalar(startDist)
  corridorEnd = Math.min(startDist * 0.5, Math.max(40, startDist * CORRIDOR_RATIO))
  // keep her "up" as near as possible to the up she had
  up.set(0, 1, 0).applyQuaternion(spaceRT.mode === "deep" ? spaceRT.park : spaceRT.rot)
  // the new frame faces her course (heading 0): keep the view where it was round her
  const turned = h.heading
  parkInDeep(h, start, dir, up)
  cameraRT.yaw -= turned
  cameraRT.targetYaw -= turned
  travelRT.flash = redirect ? 0.4 : 1
  const T = travelRT.style === "quick" ? 0.35 : corridorTime(startDist * 63.71)
  if (redirect) {
    // already at speed: keep running (no second launch), just a new course
    travelRT.phase = "corridor"
    travelRT.duration = T
    travelRT.t = Math.min(T * 0.22, 1.2)
    travelRT.u = travelRT.t / T
    // corridorPoint starts from u: re-base so she does not jump along the new line
    rebase = corridorShape(travelRT.u)
  } else {
    rebase = 0
    enter("corridor", T)
  }
}

const startReentry = (h: HorseState): void => {
  const x = -Math.sin(REENTRY_HEADING) * REENTRY_RUN
  const z = -Math.cos(REENTRY_HEADING) * REENTRY_RUN
  arriveOverEarth(h, x, DATUM_Y + REENTRY_TOP, z, REENTRY_HEADING)
  enter("reentry", travelRT.style === "quick" ? 0.9 : REENTRY_TIME)
}

const finish = (h: HorseState, arrived: boolean): void => {
  const d = travelRT.dest
  const f = h.flight!
  const reentry = travelRT.phase === "reentry"
  arriveNow = false
  sailRT.autopilot = null
  travelRT.phase = "idle"
  travelRT.beta = travelRT.launch = aberrationRT.beta = 0
  travelRT.t = travelRT.u = 0
  travelRT.intensity = 0
  travelRT.heat = travelRT.pull = 0
  travelRT.progress = arrived ? 1 : 0
  if (!arrived || !d) { f.throttle = 0.25; return }
  travelRT.journeys++
  if (reentry || d.kind === "earth") {
    // home's sky, on the wing, flying on: where to go next is the explorer's
    wingsAgain(h, f.spec.cruise * 1.6)
    spaceRT.target = null
    travelRT.arrived = "earth"
    return
  }
  f.mode = "sail"
  f.pitch = 0
  f.throttle = 0.12
  h.speed = 6
  spaceRT.vel.set(0, 0, 0)
  if (d.kind === "body") {
    const body = bodyById(d.id)
    if (body) {
      // The corridor's last direction can point outwards on a repeat visit.
      // Keep the exact arrival position and prior up, but face the world the
      // rider deliberately came to see rather than the short corridor leg.
      _v.copy(spaceRT.pos)
      _w.copy(body.pos).sub(_v).normalize()
      up.set(0, 1, 0).applyQuaternion(spaceRT.park)
      parkInDeep(h, _v, _w, up)
    }
    spaceRT.target = d.id
    sailRT.arrived = d.id
    travelRT.arrived = `body:${d.id}`
  } else if (d.kind === "rings") {
    const sat = bodyById("saturn")
    if (sat) {
      // face along the orbit (prograde), the ice spread below her, Saturn to one side
      _v.copy(spaceRT.pos).sub(sat.pos)
      _v.addScaledVector(sat.pole, -_v.dot(sat.pole)).normalize()
      _w.crossVectors(sat.pole, _v).normalize()
      // along the orbit, turned toward Saturn so the planet (28° across from
      // here) and the ring plane share the view instead of Saturn at the edge
      _w.multiplyScalar(Math.cos(0.95)).addScaledVector(_v, -Math.sin(0.95)).normalize()
      parkInDeep(h, spaceRT.pos.clone(), _w, litFace(sat, up))
      h.speed = 8
      spaceRT.target = "saturn"
    }
    travelRT.arrived = "rings"
  } else if (d.kind === "site") {
    spaceRT.target = "moon"
    // the last of the way down to the site is the Moon's own approach
    sailRT.autopilot = { kind: "site", id: d.id }
    travelRT.arrived = `site:${d.id}`
  } else if (d.kind === "cats") {
    sailRT.autopilot = { kind: "cats" }
    travelRT.arrived = "cats"
  }
}

/** QA and the HUD: a short summary. */
export const travelInfo = (): { phase: TravelPhase; to: string; progress: number; style: string } =>
  ({ phase: travelRT.phase, to: travelRT.name, progress: +travelRT.progress.toFixed(3), style: travelRT.style })

sailRT.travel = stepTravel
