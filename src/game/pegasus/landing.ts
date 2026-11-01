import type { HorseState } from "../horses/horseState"
import { fwdX, fwdZ } from "../horses/horseState"
import { mountSurfaceTop, pushMountCircle, standable } from "../horses/horseMotion"
import { flightWaterSurfaceAt } from "../../world/waterSurface"
import { worldStreamRT } from "../../world/worldRuntime"
import type { FlightState } from "./flight"

export type LandingState = {
  style: "stop" | "gallop"
  run: boolean
  brake: number
  contact: number
  settle: number
  entrySpeed: number
  touchdownVy: number
  requested: boolean
  goAround: boolean
  /** Runway cache lifetime; the swept footprint is still checked every step. */
  scan: number
  scanHeading: number
  retry: number
  /** seconds spent skimming for a clear patch (the search relaxes, then ends) */
  skimT: number
}
export const makeLanding = (): LandingState => ({ style: "stop", run: false, brake: 0, contact: 0, settle: 0, entrySpeed: 0, touchdownVy: 0, requested: false, goAround: false, scan: 0, scanHeading: 0, retry: 0, skimT: 0 })
export type LandingHazard = "water" | "slope" | "obstacle" | "terrain"
/** Explicit sampling contract also allows deterministic terrain/collision tests. */
export type LandingProbe = {
  height: (x: number, z: number) => number
  water: (x: number, z: number) => number | null
  clear: (x: number, z: number, radius: number) => boolean
  ready: (x: number, z: number, radius: number) => boolean
  airClear?: (x: number, y: number, z: number, radius: number) => boolean
}
const push = { dx: 0, dz: 0 }
/**
 * The solid world as a Pegasus knows it: the ground, the Highvale footbridge,
 * the flat roofs of authored sites and the houses round them (world/sites), and the
 * tops of big rocks. Nothing is a named landing place: wherever the footprint
 * fits on something level and solid with room around it, she can stand.
 */
const terrain: LandingProbe = {
  height: mountSurfaceTop,
  water: flightWaterSurfaceAt,
  clear: standable,
  airClear: (x, y, z, radius) => !pushMountCircle(x, z, radius, push, y),
  ready: (x, z, radius) => worldStreamRT.streamer?.isAreaReady(x, z, radius) ?? true,
}
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x))
const damp = (a: number, b: number, k: number, dt: number): number => a + (b - a) * (1 - Math.exp(-k * dt))
const approach = (a: number, b: number, rate: number, dt: number): number => a + Math.sign(b - a) * Math.min(Math.abs(b - a), rate * dt)

/** Check the entire hoof/body footprint, not just the point between the legs. */
export const landingHazard = (h: HorseState, x: number, z: number, probe: LandingProbe = terrain): LandingHazard | null => {
  const scale = h.ident.scale
  if (!probe.ready(x, z, 2 * scale)) return "terrain"
  const y = probe.height(x, z)
  const fx = fwdX(h.heading), fz = fwdZ(h.heading)
  for (const fore of [-1, 0, 1]) for (const side of [-1, 0, 1]) {
    const px = x + (fx * fore * 0.9 + fz * side * 0.45) * scale
    const pz = z + (fz * fore * 0.9 - fx * side * 0.45) * scale
    const water = probe.water(px, pz)
    if (water !== null && water - probe.height(px, pz) > 0.45) return "water"
    if (Math.abs(probe.height(px, pz) - y) > 0.48 * scale) return "slope"
    if (!probe.clear(px, pz, 0.38 * scale)) return "obstacle"
  }
  return null
}

/** The surface a Pegasus touches: water is a floor to her (she runs on it), land is land. */
export const landingSurface = (x: number, z: number, probe: LandingProbe = terrain): number => {
  const g = probe.height(x, z)
  const w = probe.water(x, z)
  return w !== null && w > g ? w : g
}

/** Can the hooves come down here? Water of any depth is fine for a Pegasus; trunks, rocks and cliffs are not. */
const footprintClear = (h: HorseState, x: number, z: number, heading: number, probe: LandingProbe, relaxed = false): boolean => {
  const scale = h.ident.scale
  const y = landingSurface(x, z, probe)
  const fx = fwdX(heading), fz = fwdZ(heading)
  for (const fore of [-1, 0, 1]) for (const side of [-1, 1]) {
    const px = x + (fx * fore * 0.9 + fz * side * 0.4) * scale
    const pz = z + (fz * fore * 0.9 - fx * side * 0.4) * scale
    if (Math.abs(landingSurface(px, pz, probe) - y) > 0.7 * scale) return false
    const w = probe.water(px, pz)
    const onWater = w !== null && w > probe.height(px, pz) + 0.3
    // relaxed: only the hooves' centre line must be free of a trunk or rock
    if (!onWater && (!relaxed || fore === 0) && !probe.clear(px, pz, (relaxed ? 0.2 : 0.32) * scale)) return false
  }
  return true
}

/** headings tried, nearest first, when the spot straight ahead is blocked */
const BEARINGS = [0, 0.22, -0.22, 0.45, -0.45, 0.75, -0.75]

/**
 * One approach step (the caller limits steps to 1/60 s). Land anywhere: the
 * approach never refuses and never goes round. The explorer asked to come down, so
 * she comes down, as directly as the world allows:
 *
 * - clear ground or water ahead: a smooth descent and a flare onto it;
 * - a trunk, a rock or a cliff where the hooves would land: she leans toward
 *   the nearest clear bearing (a gentle assist on top of the explorer's own steering)
 *   and, until there is one, skims low over the treetops-free air below the
 *   canopy line, touching down the moment a patch opens;
 * - rising ground: she lifts over it rather than running into it;
 * - the world not yet streamed in ahead: she holds her height a moment.
 *
 * Momentum is kept: a gallop approach keeps most of its speed and the ground
 * (or the water) takes the rest after contact; only a stop approach slows in
 * the air, and never to a hover.
 * Returns true at contact; touchdown owns the mode change.
 */
export const stepLanding = (h: HorseState, f: FlightState, dt: number, probe: LandingProbe = terrain): boolean => {
  const l = f.landing
  const s = f.spec
  l.goAround = false
  const y = landingSurface(h.x, h.z, probe)
  const alt = Math.max(0, h.y - y)
  const gallop = l.style === "gallop"
  // the speed she keeps to the ground: a gallop approach brings a dash in at up
  // to ~1.7 gallops (the ground run sheds the rest); a stop approach slows to a canter
  // (a stop approach — Land & Dismount, or answering a call — settles at a
  // quiet walk, so she comes to rest beside the person waiting rather than past them)
  const keep = gallop ? Math.max(h.pose.speeds[3], Math.min(h.speed, h.pose.speeds[3] * 1.7)) : Math.min(h.speed, Math.max(1.2, h.pose.speeds[0]))
  const decel = clamp(2.4 + 0.0045 * h.speed * h.speed, 2.4, 6)
  h.speed = approach(h.speed, Math.max(keep, gallop && alt > 3 ? s.minSpeed : 0), decel, dt)
  h.targetSpeed = h.speed
  l.brake = damp(l.brake, h.speed > keep + 0.5 ? 1 : 0.2, 4, dt)
  // ---- where the hooves would come down, and the nearest clear bearing to it
  const toContact = Math.max(0.4, alt / Math.max(1, Math.min(5, alt * 0.8)))
  const ahead = clamp(h.speed * toContact, 3, 30)
  const ready = probe.ready(h.x + fwdX(h.heading) * ahead, h.z + fwdZ(h.heading) * ahead, 2 * h.ident.scale)
  // Never a long search: after a moment of skimming the footprint check
  // relaxes to the hooves' centre line, and a little later she simply comes
  // down where she is (the ground model slides her clear of anything small)
  const relaxed = l.skimT > 1.2
  const settle = l.skimT > 2.5
  l.scan -= dt
  if (l.scan <= 0) {
    l.scan = 0.12
    l.scanHeading = Number.NaN
    for (const b of BEARINGS) {
      const hd = h.heading + b
      if (footprintClear(h, h.x + fwdX(hd) * ahead, h.z + fwdZ(hd) * ahead, hd, probe, relaxed)) { l.scanHeading = b; break }
    }
  }
  const blocked = Number.isNaN(l.scanHeading) && !settle
  const assist = blocked ? 0 : clamp(l.scanHeading * 1.4, -0.55, 0.55)
  // ---- descent: steady, flaring at the end; skimming low while nothing is clear
  // far faster than hooves can take: skim the last metre with the wings as
  // air brakes until she can, never a refusal (the approach above sheds speed)
  const hot = h.speed > keep * 1.04
  const skim = blocked || (!ready && !settle) || hot
  // (it only grows during one approach: flight.ts zeroes it as an approach begins)
  if (blocked || !ready) l.skimT += dt
  const skimAt = hot && !blocked && ready ? 0.8 : 1.8
  let vy = skim ? clamp((skimAt - alt) * 1.5, -2, 2) : -Math.min(5, Math.max(0.7, alt * 0.9))
  if (-f.vy > 1 && alt < f.vy * f.vy / 12 + 0.6) vy = Math.max(vy, -0.6)
  f.vy = approach(f.vy, vy, 6, dt)
  const turn = clamp(f.intent.turn, -1, 1)
  h.steer = turn
  // she levels her wings in the last metre or so: a horse touches down square
  const square = clamp((alt - 0.4) / 1.4, 0, 1)
  const turnWant = (turn * Math.min(s.turn, 0.45) + assist) * clamp(alt / 4, 0.25, 1)
  f.roll = damp(f.roll, clamp(turnWant / 0.45, -1, 1) * s.bank * Math.min(0.45, alt / 8) * square, square < 1 ? 9 : 5, dt)
  h.turnRate = damp(h.turnRate, turnWant, 4, dt)
  h.heading += h.turnRate * dt
  const low = clamp(1 - alt / 6, 0, 1)
  f.flare = damp(f.flare, hot ? 0.8 : skim ? 0.3 : low, 5, dt)
  f.pitch = damp(f.pitch, -0.08 + low * 0.22, 4, dt)
  f.spread = damp(f.spread, 1, 7, dt)
  f.tuck = damp(f.tuck, 0, 5, dt)
  f.sweep = damp(f.sweep, 0, 5, dt)
  f.stoop = damp(f.stoop, 0, 5, dt)
  f.glide = damp(f.glide, skim ? 0.6 : 1 - low, 5, dt)
  f.power = damp(f.power, skim ? 0.6 : 0.25 + low * 0.6, 5, dt)
  f.flapHz = damp(f.flapHz, s.flapHz * (1 + f.flare * 0.4), 5, dt)
  f.boostT = 0
  const nx = h.x + fwdX(h.heading) * h.speed * dt
  const nz = h.z + fwdZ(h.heading) * h.speed * dt
  const nextSurface = landingSurface(nx, nz, probe)
  let nextY = h.y + f.vy * dt
  // a trunk or a wall at body height ahead: lift clear of it (never through it)
  // (only near the ground: higher up, a collider without a height would read
  // as a wall at every altitude and keep lifting her away from the landing)
  const airborneClear = alt > 5 || settle || [-0.9, 0, 0.9].every(d =>
    probe.airClear?.(nx + fwdX(h.heading) * d * h.ident.scale, nextY - 0.2, nz + fwdZ(h.heading) * d * h.ident.scale, 0.5 * h.ident.scale) ?? true)
  if (!airborneClear && probe.airClear) {
    // a trunk at her chest: weave round it, as a horse threads a wood —
    // the nearest bearing that is clear a few metres on, at her own height
    const look = 3 * h.ident.scale
    for (const b of [0.35, -0.35, 0.7, -0.7, 1.1, -1.1]) {
      const hd = h.heading + b
      if (probe.airClear(h.x + fwdX(hd) * look, nextY - 0.2, h.z + fwdZ(hd) * look, 0.5 * h.ident.scale)) {
        h.heading += Math.sign(b) * Math.min(Math.abs(b), 1.8 * dt)
        h.turnRate = Math.sign(b) * 1.8
        f.roll = damp(f.roll, -Math.sign(b) * 0.35, 6, dt)
        h.speed = Math.max(h.pose.speeds[2], h.speed - 4 * dt)
        // move on along the new bearing (never into the trunk): half pace while she threads it
        const wx = h.x + fwdX(h.heading) * h.speed * 0.5 * dt, wz = h.z + fwdZ(h.heading) * h.speed * 0.5 * dt
        if (probe.airClear(wx, h.y - 0.2, wz, 0.5 * h.ident.scale)) { h.x = wx; h.z = wz }
        // still coming down as she threads it, and the clock runs (no endless weaving)
        h.y = Math.max(nextY, landingSurface(h.x, h.z, probe) + 0.12)
        l.skimT += dt
        f.alt = Math.max(0, h.y - landingSurface(h.x, h.z, probe))
        return false
      }
    }
  }
  if (!airborneClear) {
    // boxed in on every side: rise over it on the spot rather than through it
    // (and let the clock run: boxed in this long, she comes down regardless)
    // (only once she is up near the line where the check stops: hovering there)
    if (alt > 3) l.skimT += dt
    nextY = h.y + Math.max(2.5, f.vy) * dt
    f.vy = Math.max(f.vy, 2.5)
    h.y = nextY
    f.alt = Math.max(0, h.y - landingSurface(h.x, h.z, probe))
    return false
  }
  h.x = nx
  h.z = nz
  const attitudeReady = Math.abs(f.roll) < 0.25 && Math.abs(f.pitch) < 0.3
  if (nextY <= nextSurface && airborneClear) {
    if ((settle || footprintClear(h, h.x, h.z, h.heading, probe, relaxed)) && attitudeReady) {
      // contact: the hooves (or the water) take her at the speed she carries
      h.y = nextSurface
      f.alt = 0
      return true
    }
    // the very spot is blocked (or she is still squaring up): skim the last
    // few centimetres on, and let the clock run so this too ends in a landing
    h.y = nextSurface + 0.12
    f.vy = Math.max(f.vy, 0)
    l.skimT += dt * 2
  } else h.y = Math.max(nextY, nextSurface + (nextSurface > y + 0.3 ? 0.3 : 0))
  f.alt = Math.max(0, h.y - landingSurface(h.x, h.z, probe))
  f.stats.airTime += dt
  f.stats.maxAlt = Math.max(f.stats.maxAlt, f.alt)
  return false
}
