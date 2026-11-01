import { gift } from "../../personalization"
import * as THREE from "three"
import { BODIES, BODY, type BodyDef } from "./bodies"
import { eclipticToEquatorial, heliocentric, julianDate, raDecToVector } from "./ephemeris"
import { AU, DATUM_Y, EARTH_CENTER, EARTH_R, KM } from "./scale"
import { moonPosition, sunDirection } from "../environment/celestialLighting"

/**
 * The Sun's family placed around home, in the game's own frame (metres,
 * y up, -z north, Earth's centre straight below home).
 *
 * The game's sky clock is a story clock (day → dusk → night), so the frame is
 * the real sky turned to agree with it: the rotation from the J2000
 * equatorial frame takes the real Sun to where the game's sun shines and the
 * celestial pole to home's latitude (19° N), nudged only as much as the
 * Sun's real declination needs. Planets then sit where they really are
 * relative to the Sun on today's date, the stars and the Milky Way with them,
 * and the Moon rides the game's own moon path so the moon you see from the
 * meadow is the one you can fly to.
 */

export type BodyState = {
  def: BodyDef
  /** centre in the game frame (float64) */
  pos: THREE.Vector3
  /** radius in game metres */
  radius: number
  /** spin axis (unit, game frame) */
  pole: THREE.Vector3
  /** spin angle about the pole (radians) */
  spin: number
  /** distance inside which this body rules the view and the flight */
  soi: number
  parent: BodyState | null
}

/** Pole directions (IAU WGCCRE, J2000 RA/Dec in degrees). */
const POLES: Record<string, [number, number]> = {
  sun: [286.13, 63.87], mercury: [281.01, 61.42], venus: [272.76, 67.16], earth: [0, 90], moon: [270.0, 66.54],
  mars: [317.68, 52.89], jupiter: [268.06, 64.5], saturn: [40.59, 83.54], uranus: [257.31, -15.18], neptune: [299.36, 43.46],
  pluto: [132.99, -6.16],
}

/** Home on the globe (personalization `world.home`): it sets the night sky's latitude and where the opening journey lands. */
export const HOME_LATITUDE = gift().world.home.latitude
export const HOME_LONGITUDE = gift().world.home.longitude

/** game axes → Earth's body-fixed (ECEF) axes: home is straight up, -z is north. */
export const GAME_TO_ECEF = (() => {
  const lat = THREE.MathUtils.degToRad(HOME_LATITUDE), lon = THREE.MathUtils.degToRad(HOME_LONGITUDE)
  const up = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat))
  const east = new THREE.Vector3(-Math.sin(lon), Math.cos(lon), 0)
  const north = new THREE.Vector3(-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat))
  // game x = east, y = up, z = south
  return new THREE.Matrix3().set(
    east.x, up.x, -north.x,
    east.y, up.y, -north.y,
    east.z, up.z, -north.z,
  )
})()

const _a: [number, number, number] = [0, 0, 0]
const _b: [number, number, number] = [0, 0, 0]
const _sunEq = new THREE.Vector3()
const _sunGame = new THREE.Vector3()
const _pole = new THREE.Vector3()
const _u1 = new THREE.Vector3(), _u2 = new THREE.Vector3(), _u3 = new THREE.Vector3()
const _w1 = new THREE.Vector3(), _w2 = new THREE.Vector3(), _w3 = new THREE.Vector3()
const _v = new THREE.Vector3()

/** The rotation from J2000 equatorial vectors into the game frame. */
export const equatorialToGame = new THREE.Matrix3()
const eqBasis = new THREE.Matrix3()
const gameBasis = new THREE.Matrix3()

const hash = (s: string): number => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return ((h >>> 0) % 100000) / 100000
}

export const universe = {
  bodies: [] as BodyState[],
  byId: new Map<string, BodyState>(),
  /** direction to the Sun from home (unit) */
  sunDir: new THREE.Vector3(0, 1, 0),
  /** the date the planets are placed for */
  date: new Date(),
  version: 0,
}

const ensureBodies = (): void => {
  if (universe.bodies.length) return
  for (const def of BODIES) {
    const state: BodyState = {
      def, pos: new THREE.Vector3(), radius: def.radius * KM, pole: new THREE.Vector3(0, 1, 0), spin: 0, soi: 0, parent: null,
    }
    universe.bodies.push(state)
    universe.byId.set(def.id, state)
  }
  for (const b of universe.bodies) b.parent = b.def.parent ? universe.byId.get(b.def.parent) ?? null : null
}

/** Equatorial J2000 vector → game frame. */
export const toGame = (eq: [number, number, number], out: THREE.Vector3): THREE.Vector3 =>
  out.set(eq[0], eq[1], eq[2]).applyMatrix3(equatorialToGame)

/**
 * Place every body for a game time of day and a calendar date. Cheap (a few
 * dozen Kepler solutions), so it can run every frame while the sky moves.
 */
export const updateUniverse = (timeOfDay: number, date: Date): void => {
  ensureBodies()
  const jd = julianDate(date)
  // the real Sun, seen from Earth, in equatorial coordinates
  heliocentric("earth", jd, _a)
  eclipticToEquatorial([-_a[0], -_a[1], -_a[2]], _b)
  _sunEq.set(_b[0], _b[1], _b[2]).normalize()
  sunDirection(timeOfDay, _sunGame)
  universe.sunDir.copy(_sunGame)
  // home's celestial pole (north is -z), turned toward or away from the sun
  // until its angle to the sun is the real one (90° minus the declination)
  const lat = THREE.MathUtils.degToRad(HOME_LATITUDE)
  _pole.set(0, Math.sin(lat), -Math.cos(lat))
  const dec = Math.asin(THREE.MathUtils.clamp(_sunEq.z, -1, 1))
  _v.copy(_pole).addScaledVector(_sunGame, -_pole.dot(_sunGame))
  if (_v.lengthSq() < 1e-8) _v.set(0, 0, -1).addScaledVector(_sunGame, _sunGame.z)
  _v.normalize()
  _pole.copy(_sunGame).multiplyScalar(Math.sin(dec)).addScaledVector(_v, Math.cos(dec)).normalize()
  // two matching orthonormal bases: (sun, pole⊥sun, cross) in both frames
  _u1.copy(_sunEq)
  _u2.set(0, 0, 1).addScaledVector(_u1, -_u1.z).normalize()
  _u3.crossVectors(_u1, _u2)
  _w1.copy(_sunGame)
  _w2.copy(_pole).addScaledVector(_w1, -_pole.dot(_w1)).normalize()
  _w3.crossVectors(_w1, _w2)
  eqBasis.set(_u1.x, _u1.y, _u1.z, _u2.x, _u2.y, _u2.z, _u3.x, _u3.y, _u3.z) // rows = basis (its transpose)
  gameBasis.set(_w1.x, _w2.x, _w3.x, _w1.y, _w2.y, _w3.y, _w1.z, _w2.z, _w3.z) // columns = basis
  equatorialToGame.multiplyMatrices(gameBasis, eqBasis)

  const earth = universe.byId.get("earth")!
  earth.pos.set(EARTH_CENTER.x, EARTH_CENTER.y, EARTH_CENTER.z)
  earth.pole.copy(_pole)
  const earthHelio: [number, number, number] = [_a[0], _a[1], _a[2]]
  const days = jd - 2451545.0
  for (const b of universe.bodies) {
    const def = b.def
    const pole = POLES[def.id]
    if (pole && def.id !== "earth") toGame(raDecToVector(pole[0], pole[1], _b), b.pole).normalize()
    if (def.id === "earth") continue
    if (def.id === "sun") {
      // exactly where the game's sun is, at its real distance
      const r = Math.hypot(earthHelio[0], earthHelio[1], earthHelio[2]) * AU
      b.pos.copy(earth.pos).addScaledVector(_sunGame, r)
    } else if (def.planet) {
      heliocentric(def.planet, jd, _a)
      eclipticToEquatorial([(_a[0] - earthHelio[0]), (_a[1] - earthHelio[1]), (_a[2] - earthHelio[2])], _b)
      toGame(_b, _v).multiplyScalar(AU)
      b.pos.copy(earth.pos).add(_v)
    }
  }
  for (const b of universe.bodies) {
    const def = b.def
    if (def.id === "moon") {
      // the game's moon path, seen from home, at the Moon's real distance
      moonPosition(timeOfDay, _v).normalize()
      b.pos.set(0, DATUM_Y, 0).addScaledVector(_v, (def.orbitKm ?? 384400) * KM)
      // tidally locked: the near side faces Earth
      continue
    }
    if (!b.parent || !def.orbitKm) continue
    // other moons: circular orbits in the parent's equator, real radius and period
    const p = b.parent
    const period = def.periodDays ?? 1
    const angle = (hash(def.id) + days / period) * Math.PI * 2
    _u1.set(1, 0, 0)
    if (Math.abs(p.pole.x) > 0.9) _u1.set(0, 1, 0)
    _u2.crossVectors(p.pole, _u1).normalize()
    _u3.crossVectors(_u2, p.pole).normalize()
    // an inclination past 90° is a retrograde orbit (Triton)
    const inc = THREE.MathUtils.degToRad(def.inclination ?? 0)
    const r = def.orbitKm * KM
    b.pos.copy(p.pos)
      .addScaledVector(_u3, Math.cos(angle) * r)
      .addScaledVector(_u2, Math.sin(angle) * r * Math.cos(inc))
      .addScaledVector(p.pole, Math.sin(angle) * r * Math.sin(inc))
  }
  // spin: real rotation rates, from the real clock
  const hours = date.getTime() / 3600000
  for (const b of universe.bodies) {
    if (b.def.id === "earth" || b.def.id === "moon") b.spin = 0
    else b.spin = ((hours / b.def.day) % 1) * Math.PI * 2 + hash(b.def.id + "spin") * 6.283
    // where a body's gravity "rules": a Hill-sphere-like share of its distance
    const sun = universe.byId.get("sun")!
    if (b.def.id === "sun") b.soi = Infinity
    else {
      const parent = b.parent ?? sun
      const d = b.pos.distanceTo(parent.pos)
      const massRatio = (b.def.gravity * b.def.radius * b.def.radius) / (parent.def.gravity * parent.def.radius * parent.def.radius)
      b.soi = Math.max(b.radius * 4, d * Math.pow(massRatio, 0.4))
    }
  }
  universe.date = date
  universe.version++
}

/** The body whose surface is nearest to a point, and the height over it. */
export const nearestBody = (p: THREE.Vector3): { body: BodyState; altitude: number } => {
  ensureBodies()
  let best = universe.bodies[0]
  let bestAlt = Infinity
  for (const b of universe.bodies) {
    const alt = p.distanceTo(b.pos) - b.radius
    if (alt < bestAlt) { bestAlt = alt; best = b }
  }
  return { body: best, altitude: bestAlt }
}

/** The body whose sphere of influence holds a point (the smallest one). */
export const dominantBody = (p: THREE.Vector3): BodyState => {
  ensureBodies()
  let best = universe.byId.get("sun")!
  for (const b of universe.bodies) {
    if (b.def.id === "sun") continue
    if (p.distanceTo(b.pos) < b.soi && b.soi < best.soi) best = b
  }
  return best
}

export const bodyById = (id: string): BodyState | undefined => {
  ensureBodies()
  return universe.byId.get(id)
}

export { BODY, EARTH_R }
