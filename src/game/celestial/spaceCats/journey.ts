import * as THREE from "three"
import type { CatJourney, VoyageMemory } from "../voyageMemory"
import { universe } from "../universe"

/**
 * Where the space cats are and how their journey moves on, kept free of
 * rendering so it can be tested.
 *
 * Where they wait: the Earth–Moon L1 point, on the line from the Moon to
 * Earth, where the two worlds' pulls (and the turning of their orbit) all
 * but cancel. With almost nothing pulling them either way, their little
 * suit thrusters have been carrying them home very, very slowly. The
 * distance is the solution of the circular restricted three-body problem
 * for the Earth–Moon mass ratio (μ = 0.012150585): γ = 0.15093 of the way
 * from the Moon, about 58,000 km at the mean distance. Being fixed by the
 * two worlds, and not by any frame the riders were flying in, it is always
 * a valid place to find them again after a reload.
 */
export const L1_FROM_MOON = 0.15093

/** The star chart's id for the crew while they wait in space. */
export const CATS_TARGET = "space-cats"

/** Within this distance (game m) of the crew, met on approach. */
export const MEET_RANGE = 160
/** Within this distance Starborn can gather them into her company. */
export const GATHER_RANGE = 40
/**
 * Out in deep space within this distance (about 95,000 km real: anywhere on
 * the crossing between the Moon and Earth), Starborn notices them by herself.
 * At sailing speeds a nearer sphere would be crossed between two frames, or
 * missed by the autopilot's curve home.
 */
export const NOTICE_RANGE = 1_500_000
/** How far round the L1 point the crew drifts while waiting (m). */
export const DRIFT = 6

/** The crew waits out in space in these stages (and in "unseen" only after a first Moon landing). */
export const waitingInSpace = (v: Pick<VoyageMemory, "cats" | "moonLandings">): boolean =>
  v.cats === "met" || (v.cats === "unseen" && v.moonLandings >= 1)

/** The Earth–Moon L1 point now, in universe metres. False before the universe is placed. */
export const l1Point = (out: THREE.Vector3): boolean => {
  const moon = universe.byId.get("moon"), earth = universe.byId.get("earth")
  if (!moon || !earth) return false
  out.copy(earth.pos).sub(moon.pos).multiplyScalar(L1_FROM_MOON).add(moon.pos)
  return true
}

/**
 * Starborn slows as she comes up to them, whoever is steering: within a few
 * kilometres the pace falls to a rendezvous, and about ten metres off she
 * all but holds station beside them. Applied on top of the sail's own law
 * (starSail.ts), whose throttle never quite reaches zero out in the open.
 */
export const rendezvousLimit = (distance: number): number => 0.35 + 0.6 * Math.max(0, distance - 10)

/**
 * A formation slot (right, up, ahead) in the local axes of a mount facing
 * `heading` (atan2(x, z), so forward is (sin h, 0, cos h) and right is
 * (−cos h, 0, sin h)).
 */
export const slotOffset = (slot: readonly [number, number, number], heading: number, out: THREE.Vector3): THREE.Vector3 => {
  const s = Math.sin(heading), c = Math.cos(heading)
  return out.set(-c * slot[0] + s * slot[2], slot[1], s * slot[0] + c * slot[2])
}

/** The next stage, given what just happened; null when nothing changes. */
export type JourneyEvent = "approach" | "gather" | "lost" | "touchdownEarth" | "reachNook"
export const nextStage = (stage: CatJourney, e: JourneyEvent): CatJourney | null => {
  switch (e) {
    case "approach": return stage === "unseen" ? "met" : null
    case "gather": return stage === "met" || stage === "unseen" ? "escorting" : null
    // the mount they followed is gone (a reload, a reset): they wait where they were found
    case "lost": return stage === "escorting" ? "met" : null
    case "touchdownEarth": return stage === "escorting" ? "arrived" : null
    case "reachNook": return stage === "arrived" ? "settled" : null
  }
}

// ---- Star Nook (its layout lives with the world's: world/starNookLayout.ts) ----------
export {
  STAR_NOOK, NOOK_DECK, NOOK_SPOTS, NOOK_WALL, NOOK_TELESCOPE, NOOK_TOWER, NOOK_RACK, rackPeg, onNookDeck,
  type NookSpot, type NookSpotKind,
} from "../../../world/starNookLayout"

/**
 * The height to fly from one place to another over home: the highest ground
 * under the way plus room above the trees.
 */
export const cruiseHeight = (ax: number, az: number, bx: number, bz: number, ground: (x: number, z: number) => number, clearance = 9): number => {
  let top = -Infinity
  const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 6))
  for (let i = 0; i <= n; i++) top = Math.max(top, ground(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n))
  return top + clearance
}
