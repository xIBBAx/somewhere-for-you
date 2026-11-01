import * as THREE from "three"
import type { AvatarBody } from "../runtime"

/**
 * What the two playable people do to the world and what the world does to
 * them, as physical stuff rather than light: each footfall throws up what is
 * underfoot (path dust and grit, grass clippings, sand, powder snow, mud, a
 * splash and its ripple in shallow water or a puddle), a jump kicks off and a
 * landing spreads a ring of dust or throws a crown of water, rain bursts on
 * the head and shoulders and drips from the hands once they are soaked, and
 * in cold air every breath shows. Their clothes darken and shine as they get
 * wet (to the water line when wading), and a rim of sky and sun light
 * separates them from the world as a film's key-and-rim lighting does.
 *
 * HeroFX.tsx draws the particles (one instanced draw, lit by the sun and the
 * sky like the world, alpha blended: dust is not light) and drives all of it
 * each frame from `heroTracks`, which the two characters feed (heroTrack).
 */

export type HeroId = "explorer" | "companion"
export type HeroWater = "land" | "wade" | "swim"

/** Shared by both characters' materials (realHuman.ts): the cinematic rim. */
export const heroLook = {
  /** sky light along the silhouette (linear, already scaled) */
  uHeroRim: { value: new THREE.Color(0, 0, 0) },
  /** sunlight caught by edges turned toward the sun (strongest when backlit) */
  uHeroSunRim: { value: new THREE.Color(0, 0, 0) },
  /** world direction to the key light */
  uHeroSun: { value: new THREE.Vector3(0, 1, 0) },
}

/** Per character: x how soaked they are (0..1), y the water line in rest-pose metres above the soles. */
export const heroWet: Record<HeroId, { value: THREE.Vector2 }> = {
  explorer: { value: new THREE.Vector2(0, -1) },
  companion: { value: new THREE.Vector2(0, -1) },
}

export type HeroTrack = {
  bones: Map<string, THREE.Bone> | null
  body: AvatarBody | null
  water: HeroWater
  mounted: boolean
  /** footfalls reported since the effects last ran */
  steps: number
  lastPhase: string
  /** the highest point of the current jump or fall */
  airPeak: number
  airTime: number
  breath: number
  rainAcc: number
  dripAcc: number
  wet: number
  line: number
  side: number
}

const track = (): HeroTrack => ({ bones: null, body: null, water: "land", mounted: false, steps: 0, lastPhase: "grounded", airPeak: 0, airTime: 0, breath: 1, rainAcc: 0, dripAcc: 0, wet: 0, line: -1, side: 1 })
export const heroTracks: Record<HeroId, HeroTrack> = { explorer: track(), companion: track() }

/** Called by each character every frame, after its animator has run. */
export const heroTrack = (id: HeroId, bones: Map<string, THREE.Bone> | null, body: AvatarBody, water: HeroWater, stepped: boolean, mounted: boolean): void => {
  const t = heroTracks[id]
  t.bones = bones
  t.body = body
  t.water = water
  t.mounted = mounted
  if (stepped) t.steps = Math.min(4, t.steps + 1)
}

// ---------------------------------------------------------------- particle pool

export const HeroKind = { Puff: 0, Chip: 1, Drop: 2, Ripple: 3, Breath: 4 } as const
export type HeroKind = (typeof HeroKind)[keyof typeof HeroKind]

export const HERO_POOL = 2048

export const heroPool = {
  a: new Float32Array(HERO_POOL * 4), // position, birth
  b: new Float32Array(HERO_POOL * 4), // velocity, life
  c: new Float32Array(HERO_POOL * 4), // albedo (linear), opacity
  d: new Float32Array(HERO_POOL * 4), // size, growth, drag, kind
  e: new Float32Array(HERO_POOL * 4), // gravity, floor height, spin, seed
  next: 0,
  dirtyFrom: Infinity,
  dirtyTo: -1,
  clock: 0,
  /** how many particles each burst really spawns (quality preset) */
  scale: 1,
}

export type HeroParticle = {
  x: number; y: number; z: number
  vx?: number; vy?: number; vz?: number
  life: number
  color: THREE.Color
  alpha: number
  size: number
  grow?: number
  drag?: number
  kind: HeroKind
  /** m/s² downward (negative rises) */
  gravity?: number
  /** it comes to rest at this height (the ground or the water) */
  floor?: number
  spin?: number
  delay?: number
}

export const emitHero = (p: HeroParticle): void => {
  const i = heroPool.next
  heroPool.next = (i + 1) % HERO_POOL
  const k = i * 4
  const { a, b, c, d, e } = heroPool
  a[k] = p.x; a[k + 1] = p.y; a[k + 2] = p.z; a[k + 3] = heroPool.clock + (p.delay ?? 0)
  b[k] = p.vx ?? 0; b[k + 1] = p.vy ?? 0; b[k + 2] = p.vz ?? 0; b[k + 3] = p.life
  c[k] = p.color.r; c[k + 1] = p.color.g; c[k + 2] = p.color.b; c[k + 3] = p.alpha
  d[k] = p.size; d[k + 1] = p.grow ?? 0; d[k + 2] = p.drag ?? 1; d[k + 3] = p.kind
  e[k] = p.gravity ?? 0; e[k + 1] = p.floor ?? -1e5; e[k + 2] = p.spin ?? 0; e[k + 3] = Math.random()
  if (i < heroPool.dirtyFrom) heroPool.dirtyFrom = i
  if (i > heroPool.dirtyTo) heroPool.dirtyTo = i
}

export const heroCount = (n: number): number => Math.max(0, Math.round(n * heroPool.scale))
