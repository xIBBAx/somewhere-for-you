import { highvaleWeight } from "../../world/highvale/highvaleLayout"
/**
 * Pure safety rules for the world, with no scene or store
 * imports so they can be tested on their own: where a body may stand, when a
 * body has fallen through the world or got stuck, and which recovery applies.
 * The scene (fastTravel.ts, SafetyNet.tsx) feeds them live numbers.
 */

export type Spot = { x: number; z: number }

/** A position the game can keep: all three numbers finite. */
export const isFinitePos = (x: number, y: number, z: number): boolean => Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)

/**
 * Nearest spot to (x, z) that passes `ok`, searching outward in rings (the
 * centre first, then rings `step` metres apart, sixteen-ish probes each).
 * Null when nothing within `maxRadius` passes.
 */
export const nearestSafeSpot = (x: number, z: number, ok: (x: number, z: number) => boolean, maxRadius = 60, step = 2): Spot | null => {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  if (ok(x, z)) return { x, z }
  for (let r = step; r <= maxRadius; r += step) {
    const n = Math.max(8, Math.round((Math.PI * 2 * r) / step))
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const px = x + Math.cos(a) * r
      const pz = z + Math.sin(a) * r
      if (ok(px, pz)) return { x: px, z: pz }
    }
  }
  return null
}

/** Below the ground under it by more than `margin` metres (or not a number at all). */
export const fellThrough = (y: number, ground: number, margin = 6): boolean => !Number.isFinite(y) || !Number.isFinite(ground) || y < ground - margin

/**
 * Accumulates how long something has been below the ground: true once it has
 * stayed there for `need` seconds without a break.
 */
export class HoldTimer {
  private t = 0
  constructor(private readonly need: number) {}
  update(dt: number, on: boolean): boolean {
    if (!on) { this.t = 0; return false }
    this.t += dt
    if (this.t >= this.need) { this.t = 0; return true }
    return false
  }
  reset(): void { this.t = 0 }
}

/**
 * "Stuck": a movement key is held, the body is meant to be walking or riding
 * on the ground, and it has not got more than `radius` metres from where it
 * was for `need` seconds. Returns true once, then starts the count again.
 */
export class StuckTimer {
  private t = 0
  private ax = 0
  private az = 0
  private armed = false
  private notified = false
  constructor(private readonly need = 4, private readonly radius = 1) {}
  update(dt: number, x: number, z: number, pushing: boolean): boolean {
    if (!pushing || !Number.isFinite(x) || !Number.isFinite(z)) { this.armed = false; this.t = 0; return false }
    if (this.notified && Math.hypot(x - this.ax, z - this.az) <= this.radius) return false
    if (!this.armed || Math.hypot(x - this.ax, z - this.az) > this.radius) {
      this.armed = true
      this.ax = x
      this.az = z
      this.t = 0
      this.notified = false
      return false
    }
    this.t += dt
    if (this.t >= this.need) { this.t = 0; this.notified = true; return true }
    return false
  }
  reset(): void { this.armed = false; this.t = 0; this.notified = false }
}

/** What the world wants done with a body that needs help (see recoveryPlan). */
export type RecoveryPlan = "none" | "journey" | "space" | "nearby" | "home"

export type RecoveryState = {
  /** a sail autopilot or a deep-space sailing journey is under way */
  journey: boolean
  /** in space or on another world: the Earth recovery does not apply */
  off: boolean
  /** position not a number */
  broken: boolean
  /** below the ground, in deep water or far beyond the playable world */
  lost: boolean
  /** a movement key held with no progress for a few seconds */
  stuck: boolean
}

/**
 * The order of recovery: a journey is cancelled first, then anything off
 * Earth goes home by sky, a broken position goes straight home, and a lost
 * or stuck body is set down on the nearest safe ground.
 */
export const recoveryPlan = (s: RecoveryState): RecoveryPlan => {
  if (s.broken) return "home"
  if (s.journey) return "journey"
  if (s.off) return "space"
  if (s.lost || s.stuck) return "nearby"
  return "none"
}

/** Playable reach from home for the Earth world (m): beyond this a body is lost (Highvale, far off, is a place of its own). */
export const PLAYABLE_REACH = 3000

/** Whether a point on Earth is beyond the playable reach from home. */
export const beyondReach = (x: number, z: number, home: Spot): boolean =>
  Math.hypot(x - home.x, z - home.z) > PLAYABLE_REACH && !(highvaleWeight(x, z) > 0)

/**
 * A horse's saved place, checked on reload. Returns the spot to use: the
 * saved one when it is finite, within reach of home and standable, otherwise
 * the fallback (its home spot).
 */
export const validRestoredSpot = (
  saved: Spot,
  fallback: Spot,
  standable: (x: number, z: number) => boolean,
  home: Spot,
): Spot => {
  if (!Number.isFinite(saved.x) || !Number.isFinite(saved.z)) return fallback
  if (beyondReach(saved.x, saved.z, home)) return fallback
  return standable(saved.x, saved.z) ? saved : fallback
}
