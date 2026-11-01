import * as THREE from "three"
import { saveVoyage, voyage } from "../voyageMemory"

/**
 * Wishing lights remembered: which of a world's lights Starborn has flown
 * through, and which constellations are whole. They live in the voyage
 * memory as optional fields, so a save from before wishes reads as none
 * gathered, and a reset clears them with the rest of the voyage.
 */

export const wishId = (world: string, i: number): string => `${world}:${i}`

export const wishDone = (world: string, i: number): boolean => !!voyage.wishes?.includes(wishId(world, i))

/** How many of a world's lights have been gathered (over all visits). */
export const gatheredCount = (world: string): number => (voyage.wishes ?? []).filter((w) => w.startsWith(`${world}:`)).length

export const constellationDone = (world: string): boolean => !!voyage.constellations?.includes(world)

/**
 * Remember a light gathered. `fresh` is true the first time; `complete` is
 * true only on the call that makes the world's constellation whole.
 */
export const gatherWish = (world: string, i: number, total: number): { fresh: boolean; complete: boolean } => {
  if (i < 0 || i >= total || wishDone(world, i)) return { fresh: false, complete: constellationDone(world) }
  voyage.wishes = [...(voyage.wishes ?? []), wishId(world, i)]
  const complete = gatheredCount(world) >= total && !constellationDone(world)
  if (complete) voyage.constellations = [...(voyage.constellations ?? []), world]
  saveVoyage()
  return { fresh: true, complete }
}

const _ab = new THREE.Vector3()
const _ap = new THREE.Vector3()

/**
 * Did the segment from a to b (the mount's last step and this one) pass
 * within r of p? Starborn moves faster than a light is wide, so testing only
 * her positions would let her skip straight over one. Universe positions,
 * subtracted first in float64.
 */
export const passedThrough = (a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3, r: number): boolean => {
  _ab.subVectors(b, a)
  _ap.subVectors(p, a)
  const len2 = _ab.lengthSq()
  const t = len2 > 1e-9 ? Math.min(1, Math.max(0, _ap.dot(_ab) / len2)) : 0
  const dx = _ap.x - _ab.x * t, dy = _ap.y - _ab.y * t, dz = _ap.z - _ab.z * t
  return dx * dx + dy * dy + dz * dz <= r * r
}
