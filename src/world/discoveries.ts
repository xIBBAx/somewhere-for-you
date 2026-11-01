import { FIND_TEXT, LANDMARK_TEXT, type DiscoveryText, type FindKind } from "../content/discoveries"
import { readDiscoveryMemory, rememberDiscovery, serializeDiscoveryMemory } from "./discoveryMemory"
import { FIND_CELL, findInCell } from "./findPlacement"
import { LANDMARK_CELL, LANDMARK_RADIUS, landmarkInCell, type LandmarkKind } from "./landmarks"

export { FIND_CELL, findInCell } from "./findPlacement"

/**
 * Everything the explorer can discover in the endless world:
 *  - landmarks (one per 320 m region cell, see landmarks.ts)
 *  - small finds (gifts, cupcakes, little letters) on an 80 m grid between them
 * Placement is deterministic, and what she has found is remembered in
 * localStorage, so the world stays consistent across visits.
 */
export type DiscoveryKind = LandmarkKind | FindKind
export type Discovery = {
  id: string
  kind: DiscoveryKind
  category: "landmark" | "find"
  x: number
  z: number
  rot: number
  seed: number
  /** interaction radius */
  radius: number
}

export const discoveriesNear = (px: number, pz: number, landmarkRange: number, findRange: number, out: Discovery[]): Discovery[] => {
  out.length = 0
  const lc = Math.ceil(landmarkRange / LANDMARK_CELL)
  const lcx = Math.floor(px / LANDMARK_CELL)
  const lcz = Math.floor(pz / LANDMARK_CELL)
  for (let dz = -lc; dz <= lc; dz++) {
    for (let dx = -lc; dx <= lc; dx++) {
      const lm = landmarkInCell(lcx + dx, lcz + dz)
      if (!lm || Math.hypot(lm.x - px, lm.z - pz) > landmarkRange) continue
      out.push({ id: lm.id, kind: lm.kind, category: "landmark", x: lm.x, z: lm.z, rot: lm.rot, seed: lm.seed, radius: Math.min(4.5, LANDMARK_RADIUS[lm.kind] * 0.7) })
    }
  }
  const fc = Math.ceil(findRange / FIND_CELL)
  const fcx = Math.floor(px / FIND_CELL)
  const fcz = Math.floor(pz / FIND_CELL)
  for (let dz = -fc; dz <= fc; dz++) {
    for (let dx = -fc; dx <= fc; dx++) {
      const f = findInCell(fcx + dx, fcz + dz)
      if (f && Math.hypot(f.x - px, f.z - pz) <= findRange) out.push(f)
    }
  }
  return out
}

export const textFor = (d: Discovery): { text: DiscoveryText; line: string } => {
  const text = d.category === "landmark" ? LANDMARK_TEXT[d.kind as LandmarkKind] : FIND_TEXT[d.kind as FindKind]
  return { text, line: text.lines[d.seed % text.lines.length] }
}

// --- persistence -------------------------------------------------------------

const KEY = "gift-world/discoveries"

const load = () => {
  try {
    return readDiscoveryMemory(localStorage.getItem(KEY))
  } catch {
    return readDiscoveryMemory(null)
  }
}

export const discoveryRT = {
  ...load(),
  /** nearest interactable discovery (set every frame by the discovery system) */
  near: null as Discovery | null,
  /** Wildlife chooses a nearby friend before this system resolves one HUD prompt. */
  animalPrompt: null as string | null,
  /** a horse wants E (ride, get off) — takes precedence over every other prompt */
  horsePrompt: null as string | null,
}

export const markFound = (id: string): boolean => {
  if (!rememberDiscovery(discoveryRT, id)) return false
  try {
    localStorage.setItem(KEY, serializeDiscoveryMemory(discoveryRT))
  } catch {
    // storage unavailable: discoveries still work for this session
  }
  return true
}

export const resetDiscoveries = (): void => {
  discoveryRT.found.clear()
  discoveryRT.total = 0
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
