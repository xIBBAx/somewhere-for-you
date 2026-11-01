import * as THREE from "three"
import type { BodyDef } from "../bodies"
import type { BodyState } from "../universe"
import { names } from "../../../personalization"

/**
 * The wonders at the worlds as plain numbers: which world has what, the
 * scale its lights chime, and where the lights hang round Starborn's arrival.
 *
 * What is real: the approach distances, which are cosmicTravel's (a star's
 * radius × 3.5, a ringed world's × 2.6, anything else × 1.9), so every light
 * is placed relative to the spot she actually arrives at. What is Starborn's
 * magic: every light, manta, glint and curtain of aurora. None of them is
 * ever inside a world, and all of them are within a few hundred metres to a
 * few kilometres of game space, reachable in seconds with the sail.
 */

export const MAX_LIGHTS = 12
const TAU = Math.PI * 2
const GOLDEN = 2.39996323
/** the lights' middle distance ahead of the arrival point (game m) */
const LIGHT_AHEAD = 320
const HEART_AHEAD = 340
const HEART_SCALE = 8

export type WonderShape = "cloud" | "heart"

export type WonderWorld = {
  id: string
  /** lights in the constellation (7–12) */
  lights: number
  shape: WonderShape
  /** the scale its lights chime: a root (Hz) and steps (semitones), climbing over octaves */
  root: number
  steps: readonly number[]
  /** the glow of its lights, creatures and moments (CSS colour) */
  color: string
  /** star mantas that drift near the arrival point */
  mantas: number
  /** ice motes near the ring plane that sparkle when she skims them */
  ice: boolean
  /** faint aurora curtains ahead */
  aurora: boolean
  /** what she is told on arrival, after the count */
  line: string
}

const TABLE: WonderWorld[] = [
  { id: "mercury", lights: 7, shape: "cloud", root: 466.16, steps: [0, 2, 3, 7, 8], color: "#ffe2b8", mantas: 0, ice: false, aurora: false, line: "They hang very still in the hot, bright dark." },
  { id: "venus", lights: 8, shape: "cloud", root: 392, steps: [0, 2, 4, 7, 9], color: "#ffd77a", mantas: 0, ice: false, aurora: false, line: "Golden cloud silk hangs nearby: fly through and watch it part around your wings." },
  { id: "mars", lights: 7, shape: "cloud", root: 293.66, steps: [0, 3, 5, 7, 10], color: "#ff9d6e", mantas: 0, ice: false, aurora: false, line: "Three little dust dancers spiral nearby: skim through to unfurl them in your wake." },
  { id: "jupiter", lights: 9, shape: "cloud", root: 261.63, steps: [0, 2, 4, 6, 7, 9], color: "#f2c894", mantas: 4, ice: false, aurora: true, line: "Star mantas glide through the aurora. Fly gently and they swim with you; surge and they scatter." },
  { id: "saturn", lights: 10, shape: "cloud", root: 349.23, steps: [0, 2, 4, 7, 9], color: "#f6dfa4", mantas: 5, ice: true, aurora: false, line: "Ice glitters where the rings reach: skim the motes and they burst into sparkles." },
  { id: "uranus", lights: 7, shape: "cloud", root: 329.63, steps: [0, 2, 4, 6, 8, 10], color: "#a8f0ee", mantas: 0, ice: false, aurora: false, line: "Blue-green and cold, they chime like frost." },
  { id: "neptune", lights: 8, shape: "cloud", root: 220, steps: [0, 3, 5, 7, 10], color: "#7ea6ff", mantas: 3, ice: false, aurora: false, line: "Deep-blue star mantas keep watch in the cold." },
  { id: "pluto", lights: 12, shape: "heart", root: 523.25, steps: [0, 4, 7, 11, 14], color: "#f0d6c2", mantas: 0, ice: false, aurora: false, line: "Far from home, they have made a heart for you." },
  // the moons: each with what it is really known for, so no journey ends in an empty sky
  { id: "titan", lights: 8, shape: "cloud", root: 277.18, steps: [0, 3, 5, 7, 10], color: "#ffb36b", mantas: 2, ice: false, aurora: false, line: "Titan's orange haze glows round its edge; two star mantas drift in the twilight above its methane seas." },
  { id: "europa", lights: 8, shape: "cloud", root: 415.3, steps: [0, 2, 4, 7, 9], color: "#cfe8ff", mantas: 0, ice: true, aurora: false, line: "Ice crystals rise from the cracks over its hidden ocean: skim through and they sparkle." },
  { id: "io", lights: 7, shape: "cloud", root: 311.13, steps: [0, 2, 3, 7, 8], color: "#ffe46b", mantas: 0, ice: false, aurora: true, line: "Io glows in Jupiter's grip: a sulphur aurora shimmers where its volcanoes breathe." },
  { id: "ganymede", lights: 9, shape: "cloud", root: 246.94, steps: [0, 2, 4, 7, 9], color: "#bcd0ff", mantas: 2, ice: false, aurora: true, line: "The largest moon has a magnetic field of its own, and auroras: star mantas swim through them." },
  { id: "enceladus", lights: 8, shape: "cloud", root: 440, steps: [0, 4, 7, 9, 11], color: "#e8f6ff", mantas: 0, ice: true, aurora: false, line: "Fountains of ice spray from its south pole: fly through the glittering motes." },
  { id: "sun", lights: 9, shape: "cloud", root: 196, steps: [0, 2, 4, 7, 9, 12], color: "#ffd27a", mantas: 0, ice: false, aurora: false, line: `Brush the drifting solar filaments and they answer with a chord of sunlight. ${names.starborn} catches their magnetic echoes safely clear of our star.` },
]

const BY_ID = new Map(TABLE.map((w) => [w.id, w]))
export const WONDER_WORLDS: readonly WonderWorld[] = TABLE
export const wonderFor = (id: string | null | undefined): WonderWorld | null => BY_ID.get(id ?? "") ?? null

export const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"]

/** The body as the placement needs it (BodyState carries all of this). */
export type WonderBody = Pick<BodyState, "pos" | "radius" | "pole"> & { def: Pick<BodyDef, "kind" | "name" | "rings"> }

/** How far a world's approach stands off its centre, in its radii (cosmicTravel.ts's rule). */
export const approachRadii = (def: Pick<BodyDef, "kind" | "rings">): number => (def.kind === "star" ? 3.5 : def.rings ? 2.6 : 1.9)

/** A light's place in its arrival frame: (right, up, ahead) in game metres. */
export type Offset = readonly [number, number, number]

/** Where the lights hang, from the arrival point, in its frame. Deterministic per world. */
export const lightOffsets = (w: WonderWorld): Offset[] => {
  const out: Offset[] = []
  for (let i = 0; i < w.lights; i++) {
    if (w.shape === "heart") {
      // the classic heart curve, traced round by the lights
      const t = (i / w.lights) * TAU
      out.push([
        16 * Math.sin(t) ** 3 * HEART_SCALE,
        (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * HEART_SCALE + 20,
        HEART_AHEAD,
      ])
      continue
    }
    // a loose golden-angle cloud, wider than it is deep, with a little depth jitter
    const u = (i + 0.5) / w.lights
    const r = 60 + 240 * Math.sqrt(u)
    const a = i * GOLDEN + hash(i + 1) * 0.5
    out.push([Math.cos(a) * r * 1.2, Math.sin(a) * r * 0.6, LIGHT_AHEAD + 110 * (2 * hash(i + 7) - 1)])
  }
  return out
}

/** The frequency (Hz) of light i: its world's steps, climbing an octave each time round. */
export const toneOf = (w: WonderWorld, i: number): number => {
  const n = w.steps.length
  return w.root * 2 ** ((w.steps[i % n] + 12 * Math.floor(i / n)) / 12)
}

const UP = new THREE.Vector3(0, 1, 0)
const Z = new THREE.Vector3(0, 0, 1)

/** Right and up for an ahead direction (unit), orthonormal, in universe axes. */
export const approachAxes = (fwd: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3): void => {
  right.crossVectors(fwd, UP)
  if (right.lengthSq() < 1e-6) right.crossVectors(fwd, Z)
  right.normalize()
  up.crossVectors(right, fwd).normalize()
}

/** A wonder site: one world's arrival point (universe metres) and its frame, live from then on. */
export type WonderSite = {
  world: WonderWorld
  body: WonderBody
  /** where she came to rest (universe, float64) */
  at: THREE.Vector3
  /** the frame: ahead is toward the world */
  right: THREE.Vector3
  up: THREE.Vector3
  fwd: THREE.Vector3
  /** the approach distance from the centre (universe m) */
  stand: number
  offsets: Offset[]
  /** each light this frame, universe metres (float64) */
  live: THREE.Vector3[]
  /** 1 where a light is already gathered */
  got: Uint8Array
}

export const makeSite = (world: WonderWorld, body: WonderBody, at: THREE.Vector3, gathered: (i: number) => boolean): WonderSite => {
  const fwd = new THREE.Vector3().subVectors(body.pos, at).normalize()
  const right = new THREE.Vector3(), up = new THREE.Vector3()
  approachAxes(fwd, right, up)
  const got = new Uint8Array(MAX_LIGHTS)
  for (let i = 0; i < world.lights; i++) got[i] = gathered(i) ? 1 : 0
  return {
    world, body, at: at.clone(), right, up, fwd, stand: body.radius * approachRadii(body.def),
    offsets: lightOffsets(world),
    live: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3()),
    got,
  }
}

/** A point in a site's frame (right, up, ahead, game m) as a universe position. */
export const sitePoint = (s: WonderSite, x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 =>
  out.copy(s.at).addScaledVector(s.right, x).addScaledVector(s.up, y).addScaledVector(s.fwd, z)

/** What the systems need each frame. Positions are universe metres (float64). */
export type WonderTick = {
  dt: number
  time: number
  calm: boolean
  /** half the viewport height in pixels, for sizing points in metres */
  halfH: number
  mount: THREE.Vector3
  prev: THREE.Vector3
  speed: number
}

/** A small seeded generator (for layouts that must be the same every time). */
export const rng = (seed: string): (() => number) => {
  let s = 2166136261
  for (let i = 0; i < seed.length; i++) s = Math.imul(s ^ seed.charCodeAt(i), 16777619)
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}
