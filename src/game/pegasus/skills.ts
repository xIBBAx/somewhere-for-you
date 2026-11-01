import type { PegasusId } from "../horses/breeds"
import type { DashSignature } from "./dashSignature"
import { names } from "../../personalization"

/**
 * What each Pegasus is good at in the air, grounded in how real birds of the
 * same wing fly.
 *
 *   Ivory     long, narrow swan/albatross wings: the best glider. She holds
 *            height on a still wing, gains speed crossing the wind (dynamic
 *            soaring, as albatrosses do over the sea), rides thermals up in
 *            tight circles, rolls and turns the quickest, and her dash is a
 *            swift's: wings swept back, long and light.
 *   Onyx  broad, fingered eagle wings: power. The strongest climb, a
 *            stoop (the folded-wing dive of an eagle, gravity doing the work,
 *            pulling out into a zoom climb that trades the speed back for
 *            height), the steadiest in gusts, and a dash of deep, driving
 *            strokes whose downwash flattens the grass and ruffles water
 *            when he flies low.
 *   Starborn   the star-born: steady, unhurried, and the only one who leaves
 *            the air (celestial/starSail.ts).
 *
 * None of them tires. A Pegasus is not a horse that has been given wings: its
 * dash is held for as long as the rider holds it, and it never comes down
 * winded (horses/horseMotion.ts keeps a Pegasus's stamina full).
 */

export type FlightSkills = {
  /** shown in the flight key legend */
  title: string
  /** the dash: airspeed (m/s), how fast it is reached, how far the wings sweep back (0..1) */
  dash: { speed: number; accel: number; sweep: number; strokes: number }
  /**
   * Starborn's alone: held past the dash's first surge (`onset` s), she opens
   * into her overdrive, starlight taking her through the air faster than any
   * wing could: `low` m/s skimming the land, `high` m/s well up the sky,
   * reached over a couple of seconds (`rise`, the ease's rate per second).
   */
  overdrive?: { onset: number; low: number; high: number; rise: number }
  /** climb rate against the breed's own (Space): broad wings and a deep stroke climb hardest */
  climb: number
  /** 0..1: how well a glide holds its height (0 sinks like a stone, 1 a sailplane) */
  glide: number
  /** speed gained per m/s of crosswind while gliding (dynamic soaring) */
  soar: number
  /** fraction of a thermal's rising air the wings can use */
  thermal: number
  /** the stoop (Shift with C): top speed in a folded dive and its acceleration (fraction of g) */
  stoop: { speed: number; g: number }
  /** fraction of a stoop's extra speed turned back into height on the pull-out */
  zoom: number
  /** seconds for a full barrel roll (A or D tapped twice) */
  roll: number
  /** 0..1 calm in gusts (1: the gust does not rock it) */
  steady: number
  /** downwash strength when dashing low (grass and water) */
  downwash: number
  /** the look and sound of its dash (DashFX.tsx, dashAudio.ts): a swift's slipstream, a thunder of strokes, a starfall */
  signature: DashSignature
  /** the light it leaves in the air: filament core, its coloured sheath, the drops it sheds;
   *  the ribbon's half-width at the wing (m; the bright filament is the middle tenth of it);
   *  and whether a stream also pours from the tail (the star-born's comet tail) */
  trail: { core: string; edge: string; fleck: string; width: number; tail: boolean }
}

export const SKILLS: Record<PegasusId, FlightSkills> = {
  ivory: {
    title: `${names.explorerPegasus} · glider`,
    dash: { speed: 36, accel: 1.6, sweep: 0.75, strokes: 1.25 },
    climb: 1,
    glide: 0.9,
    soar: 0.32,
    thermal: 1,
    stoop: { speed: 46, g: 0.55 },
    zoom: 0.55,
    roll: 0.85,
    steady: 0.45,
    downwash: 0.35,
    signature: "swift",
    trail: { core: "#fff6f2", edge: "#f4a6c4", fleck: "#ffe9c4", width: 0.26, tail: false },
  },
  onyx: {
    title: `${names.companionPegasus} · eagle`,
    dash: { speed: 42, accel: 2.4, sweep: 0.45, strokes: 1.6 },
    climb: 1.4,
    glide: 0.62,
    soar: 0.12,
    thermal: 0.7,
    stoop: { speed: 68, g: 0.85 },
    zoom: 0.8,
    roll: 1.3,
    steady: 0.9,
    downwash: 1,
    signature: "thunder",
    trail: { core: "#fff3dc", edge: "#ffa040", fleck: "#ffd889", width: 0.32, tail: false },
  },
  starborn: {
    title: `${names.starborn} · star-born`,
    dash: { speed: 34, accel: 1.4, sweep: 0.55, strokes: 1.2 },
    overdrive: { onset: 0.5, low: 92, high: 168, rise: 1.1 },
    climb: 1,
    glide: 0.8,
    soar: 0.2,
    thermal: 0.85,
    stoop: { speed: 50, g: 0.6 },
    zoom: 0.65,
    roll: 1.2,
    steady: 0.8,
    downwash: 0.6,
    signature: "starfall",
    trail: { core: "#f6f8ff", edge: "#8ea0ff", fleck: "#d8e6ff", width: 0.28, tail: true },
  },
}

export const skillsOf = (breed: string): FlightSkills | null => (breed in SKILLS ? SKILLS[breed as PegasusId] : null)

// ---- the air itself ------------------------------------------------------------

const hash2 = (x: number, z: number): number => {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h ^= h >>> 13
  return ((h >>> 0) % 100000) / 100000
}

/** Thermals sit on a 260 m lattice, one candidate per cell. */
const THERMAL_CELL = 260

/**
 * Rising air over sunlit ground (m/s): thermals are bubbles and columns of
 * warm air, typically 1–4 m/s and 30–100 m across, that come and go over
 * several minutes and are strongest in the afternoon sun. `sun` is 0 at
 * night or under heavy cloud and rain, 1 in clear daylight. The core is
 * strongest, with a ring of gentle sink round it, as real thermals have.
 */
export const thermalLift = (x: number, z: number, time: number, sun: number): number => {
  if (sun <= 0.02) return 0
  const cx = Math.floor(x / THERMAL_CELL), cz = Math.floor(z / THERMAL_CELL)
  let lift = 0
  for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
    const u = hash2(ix, iz)
    if (u > 0.55) continue
    const px = (ix + 0.2 + 0.6 * hash2(ix + 17, iz)) * THERMAL_CELL
    const pz = (iz + 0.2 + 0.6 * hash2(ix, iz + 29)) * THERMAL_CELL
    const radius = 30 + 70 * hash2(ix + 5, iz + 3)
    const strength = 1 + 3 * hash2(ix + 11, iz + 7)
    // each thermal lives a few minutes, then rests before the next bubble
    const cycle = 240 + 300 * hash2(ix + 3, iz + 13)
    const phase = ((time / cycle + u * 7.3) % 1 + 1) % 1
    const life = phase < 0.65 ? Math.sin((phase / 0.65) * Math.PI) : 0
    if (life <= 0) continue
    const d = Math.hypot(x - px, z - pz) / radius
    // the core rises; just outside it the air sinks a little
    const shape = d < 1 ? 1 - d * d : d < 1.6 ? -0.18 * Math.sin(((d - 1) / 0.6) * Math.PI) : 0
    lift += strength * shape * life
  }
  return lift * sun
}

/**
 * Dynamic soaring, simplified: gliding across the wind (not with it or into
 * it) a long-winged bird gains airspeed from the wind gradient. Returns the
 * speed gained per second, for a wind of `wind` m/s from `windDir` (radians)
 * and a heading `heading`, scaled by the Pegasus's `soar`.
 */
export const soarGain = (heading: number, windDir: number, wind: number, soar: number): number =>
  Math.abs(Math.sin(heading - windDir)) * wind * soar

/** Double-tap detection for the barrel roll: two presses within this window (s). */
export const ROLL_TAP = 0.32

/** The roll's double tap, per rider: the side last pressed, how long ago, and the side held now. */
export type RollTap = { side: number; since: number; held: number }
export const makeRollTap = (): RollTap => ({ side: 0, since: 9, held: 0 })

/**
 * Feed the turn control (−1 … +1) once a frame. Returns +1 or −1 on the
 * frame the same side is pressed a second time within ROLL_TAP, else 0.
 */
export const rollTap = (st: RollTap, turn: number, dt: number): number => {
  st.since += dt
  const held = Math.abs(turn) > 0.5 ? Math.sign(turn) : 0
  let fire = 0
  if (held !== 0 && st.held === 0) {
    if (held === st.side && st.since < ROLL_TAP) {
      fire = held
      st.side = 0
    } else st.side = held
    st.since = 0
  }
  st.held = held
  return fire
}
