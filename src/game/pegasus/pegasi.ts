import { makeIdentity, COATS, type PegasusId } from "../horses/breeds"
import { horseRT, makeHorseState, type HorseState } from "../horses/horseState"
import { standable } from "../horses/horseMotion"
import { groundHeight } from "../world-layout"
import { HUB_CENTER } from "../../world/hubLayout"
import type { CharacterId } from "../runtime"
import { flightOf } from "./flight"
import { names } from "../../personalization"

/**
 * The Pegasi of the world.
 *
 *   Ivory     the explorer's own: a pearl-white mare, light and curious, with long
 *            gliding wings (a swan's and an albatross's planform)
 *   Onyx  the companion's own: a dark black-bay stallion, powerful and steady,
 *            with broad, fingered eagle wings
 *   Starborn   the star-born mare, the explorer's from the very beginning: she lives on
 *            the Star Hill some way from home (a landmark, not a gate) and comes
 *            to any call (I). Long in the back with a two-seat saddle, so the explorer
 *            and the companion can ride her together, and the only one who can carry
 *            them past the sky
 *
 * Ivory and Onyx graze in the meadow beyond the home herd; each comes to its
 * own rider's whistle, flying in when far away.
 */

export type PegasusDef = {
  id: string
  breed: PegasusId
  name: string
  seed: number
  owner: CharacterId | null
  /** a wish for where it lives (the nearest standable spot is used) */
  x: number
  z: number
}

export const PEGASI: PegasusDef[] = [
  { id: "pegasus:ivory", breed: "ivory", name: `${names.explorerPegasus}`, seed: 70101, owner: "explorer", x: -50, z: -6 },
  { id: "pegasus:onyx", breed: "onyx", name: `${names.companionPegasus}`, seed: 70202, owner: "companion", x: -56, z: -12 },
  { id: "pegasus:starborn", breed: "starborn", name: `${names.starborn}`, seed: 70303, owner: null, x: 0, z: 0 },
]

/** Runtime registry: each character's own Pegasus and the Star Hill. */
export const pegasusRT = {
  own: { explorer: "pegasus:ivory", companion: "pegasus:onyx" } as Record<CharacterId, string>,
  starHill: { x: 0, z: 0, y: 0 },
  /**
   * Starborn is the explorer's from the very beginning: nothing to find or unlock, so
   * she is met from the start (her beacon is only a landmark now).
   */
  starbornMet: true,
}

export const isPegasus = (h: { ident: { breed: string } } | null | undefined): boolean =>
  !!h && (h.ident.breed === "ivory" || h.ident.breed === "onyx" || h.ident.breed === "starborn")

export const isTandem = (h: HorseState | null | undefined): boolean => !!h && h.ident.breed === "starborn"

/** Nearest spot a Pegasus can stand, searching outward in rings. */
const settle = (x: number, z: number): { x: number; z: number } => {
  if (standable(x, z, 1.2)) return { x, z }
  for (let r = 2; r < 40; r += 2) {
    for (let a = 0; a < 16; a++) {
      const px = x + Math.cos((a / 16) * Math.PI * 2) * r
      const pz = z + Math.sin((a / 16) * Math.PI * 2) * r
      if (standable(px, pz, 1.2)) return { x: px, z: pz }
    }
  }
  return { x, z }
}

/**
 * The Star Hill: the highest open ground on a ring 230-330 m from home,
 * where Starborn waits. Deterministic for the world's seed.
 */
export const findStarHill = (): { x: number; z: number; y: number } => {
  let best = { x: HUB_CENTER.x + 260, z: HUB_CENTER.z, y: -Infinity }
  for (let r = 230; r <= 330; r += 25) {
    for (let a = 0; a < 48; a++) {
      const ang = (a / 48) * Math.PI * 2
      const x = HUB_CENTER.x + Math.cos(ang) * r
      const z = HUB_CENTER.z + Math.sin(ang) * r
      const y = groundHeight(x, z)
      if (y > best.y && standable(x, z, 1.5)) best = { x, z, y }
    }
  }
  return best
}

/** Create the three Pegasi in the horse registry (persistent and saddled). */
export const spawnPegasi = (): HorseState[] => {
  const hill = findStarHill()
  pegasusRT.starHill = hill
  const out: HorseState[] = []
  for (const d of PEGASI) {
    if (horseRT.horses.has(d.id)) continue
    const coat = d.breed === "ivory" ? "pearl" : d.breed === "onyx" ? "blackBay" : "midnight"
    const ident = makeIdentity(d.seed, d.breed, { id: d.id, name: d.name, coatId: coat, coat: COATS[coat], face: "none", legs: [0, 0, 0, 0], saddled: true, scale: 1 })
    // a Pegasus is calmer and more trusting than a wild horse: it chose its rider
    ident.traits.calm = Math.max(ident.traits.calm, 0.7)
    ident.traits.curiosity = Math.max(ident.traits.curiosity, 0.6)
    const at = d.breed === "starborn" ? settle(hill.x, hill.z) : settle(d.x, d.z)
    const h = makeHorseState(ident, at.x, at.z, true)
    h.y = groundHeight(at.x, at.z)
    h.homeRange = d.breed === "starborn" ? 8 : 16
    h.trust = 1
    flightOf(h)
    horseRT.horses.set(d.id, h)
    out.push(h)
  }
  const ivory = horseRT.horses.get("pegasus:ivory")
  const onyx = horseRT.horses.get("pegasus:onyx")
  if (ivory && onyx) {
    ivory.buddy = onyx
    onyx.buddy = ivory
  }
  return out
}

export const pegasusById = (id: string): HorseState | undefined => horseRT.horses.get(id)
