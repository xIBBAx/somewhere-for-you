import { highvaleWeight } from "./highvale/highvaleLayout"
import type { FindKind } from "../content/discoveries"
import { lakeMask, nRegion, WATER_LEVEL } from "./climate"
import { HUB_CENTER } from "./hubLayout"
import { LANDMARK_CELL, LANDMARK_RADIUS, landmarkInCell } from "./landmarks"
import { hash01, hash3, smooth } from "./noise"
import { slopeAt, worldHeight } from "./terrain"
import { WORLD_SEED } from "./worldConfig"
import { siteWeight } from "./sites/siteLayout"

export const FIND_CELL = 80
const KINDS: FindKind[] = ["gift", "gift", "cupcake", "letter"]
export type Find = { id: string; kind: FindKind; category: "find"; x: number; z: number; rot: number; seed: number; radius: number }
const cache = new Map<string, Find | null>()

const makeFind = (cx: number, cz: number): Find | null => {
  const x = (cx + 0.15 + hash01(WORLD_SEED ^ 0x7702, cx, cz) * 0.7) * FIND_CELL
  const z = (cz + 0.15 + hash01(WORLD_SEED ^ 0x7703, cx, cz) * 0.7) * FIND_CELL
  const homeDistance = Math.hypot(x - HUB_CENTER.x, z - HUB_CENTER.z)
  const density = homeDistance < 600 ? 0.5 : 0.22 + smooth(-0.5, 0.55, nRegion(x / 730 - 4, z / 730 + 7)) * 0.38
  if (homeDistance < 70 || hash01(WORLD_SEED ^ 0x7701, cx, cz) > density) return null
  if (siteWeight(x, z, 20).w > 0 || highvaleWeight(x, z) > 0) return null
  if (lakeMask(x, z) > 0 || worldHeight(x, z) < WATER_LEVEL + 0.4 || slopeAt(x, z) > 0.25) return null
  const lm = landmarkInCell(Math.floor(x / LANDMARK_CELL), Math.floor(z / LANDMARK_CELL))
  if (lm && Math.hypot(x - lm.x, z - lm.z) < LANDMARK_RADIUS[lm.kind] + 8) return null
  return { id: `find:${cx}:${cz}`, kind: KINDS[Math.floor(hash01(WORLD_SEED ^ 0x7704, cx, cz) * KINDS.length)], category: "find", x, z,
    rot: hash01(WORLD_SEED ^ 0x7705, cx, cz) * Math.PI * 2, seed: hash3(WORLD_SEED ^ 0x7706, cx, cz), radius: 1.7 }
}

export const findInCell = (cx: number, cz: number): Find | null => {
  const key = `${cx}:${cz}`
  const known = cache.get(key)
  if (known !== undefined) return known
  const value = makeFind(cx, cz)
  if (cache.size >= 1024) cache.delete(cache.keys().next().value!)
  cache.set(key, value)
  return value
}

/** Includes the neighboring cells, so a clearing remains complete at a
 * streamed chunk boundary. Both renderer and worker use the exact same find. */
export const findsInRect = (minX: number, minZ: number, maxX: number, maxZ: number, out: Find[]): Find[] => {
  out.length = 0
  const pad = 4
  for (let z = Math.floor((minZ - pad) / FIND_CELL); z <= Math.floor((maxZ + pad) / FIND_CELL); z++) {
    for (let x = Math.floor((minX - pad) / FIND_CELL); x <= Math.floor((maxX + pad) / FIND_CELL); x++) {
      const f = findInCell(x, z)
      if (f && f.x + pad >= minX && f.x - pad <= maxX && f.z + pad >= minZ && f.z - pad <= maxZ) out.push(f)
    }
  }
  return out
}
