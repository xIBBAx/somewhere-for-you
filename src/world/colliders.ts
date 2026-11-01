import type { CircleCollider } from "../game/world-layout"
import { K, SCATTER_STRIDE, type ChunkPayload } from "./chunkGen"
import { CHUNK_SIZE } from "./worldConfig"

/**
 * Colliders contributed by streamed chunks (trees, boulders, landmark props)
 * that lie near the player. Refreshed by the world renderer whenever the
 * player moves a few metres; movement and the camera read it every frame.
 */
export const nearbyWorldColliders: CircleCollider[] = []

/** Colliders of every built chunk, keyed by chunk, for wildlife steering. */
export const chunkColliders = new Map<string, CircleCollider[]>()

export const SCATTER_COLLIDER_RADIUS: Record<number, number> = {
  [K.oak]: 0.38, [K.linden]: 0.34, [K.birch]: 0.22, [K.pine]: 0.36,
  [K.gulmohar]: 0.32, [K.maple]: 0.34, [K.willow]: 0.48, [K.glow]: 0.32, [K.cedar]: 0.42,
  [K.boulder]: 0.85,
}

/** Each tree's crown at scale 1 (top over the ground, radius; m), as the vegetation library draws it. */
export const SCATTER_CROWN: Record<number, [number, number]> = {
  [K.oak]: [9.5, 4.2], [K.linden]: [9.5, 3.6], [K.birch]: [8.5, 2.2], [K.pine]: [11, 2.6],
  [K.gulmohar]: [6, 3.2], [K.maple]: [8.5, 3.6], [K.willow]: [7.5, 4.2], [K.glow]: [6, 3], [K.cedar]: [12, 3.8],
}

export const collidersForChunk = (p: ChunkPayload): CircleCollider[] => {
  const out: CircleCollider[] = []
  for (let i = 0; i < p.scatter.length; i += SCATTER_STRIDE) {
    const s = p.scatter, kind = s[i + 5], scale = s[i + 3], r = SCATTER_COLLIDER_RADIUS[kind]
    const crown = SCATTER_CROWN[kind]
    if (r) out.push({ x: p.cx * CHUNK_SIZE + s[i], z: p.cz * CHUNK_SIZE + s[i + 2], r: r * scale,
      height: (kind === K.boulder ? 1.1 : 4.5) * scale, jumpable: kind === K.boulder && scale < 0.9,
      standable: kind === K.boulder, crown: crown ? crown[0] * scale : undefined, crownR: crown ? crown[1] * scale : undefined })
  }
  return out
}

/**
 * The highest tree crown over a disc of radius `pad` about (x, z): its top's
 * height over the ground there, or 0 where no crown reaches. For a flying
 * body, so wings and hooves go over the forest, never through it.
 */
export const crownTopNear = (x: number, z: number, pad: number, ground: (x: number, z: number) => number): number => {
  let top = -Infinity
  const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE)
  for (let iz = -1; iz <= 1; iz++) for (let ix = -1; ix <= 1; ix++) {
    const list = chunkColliders.get(`${cx + ix},${cz + iz}`)
    if (!list) continue
    for (const c of list) {
      if (!c.crown) continue
      const reach = (c.crownR ?? 0) + pad
      const dx = x - c.x, dz = z - c.z
      if (dx * dx + dz * dz >= reach * reach) continue
      // the crown is round: lower toward its edge
      const d = Math.hypot(dx, dz)
      const edge = Math.max(0, (d - pad) / Math.max(0.5, c.crownR ?? 1))
      const t = ground(c.x, c.z) + c.crown * (1 - 0.35 * edge * edge)
      if (t > top) top = t
    }
  }
  return top
}

/** Push a point out of nearby scatter colliders (cheap per-chunk lookup). */
export const pushOutOfScatter = (p: { x: number; z: number }, radius: number, chunkSize: number): boolean => {
  let hit = false
  // Neighbouring chunks own obstacles whose radius crosses the boundary.
  for (let pass = 0; pass < 2; pass++) {
    const cx = Math.floor(p.x / chunkSize), cz = Math.floor(p.z / chunkSize)
    for (let iz = -1; iz <= 1; iz++) for (let ix = -1; ix <= 1; ix++) {
      const list = chunkColliders.get(`${cx + ix},${cz + iz}`)
      if (!list) continue
      for (const c of list) {
        const dx = p.x - c.x
        const dz = p.z - c.z
        const min = c.r + radius
        const d2 = dx * dx + dz * dz
        if (d2 < min * min) {
          const d = Math.sqrt(d2)
          p.x = c.x + (d > 1e-8 ? dx / d : 1) * min
          p.z = c.z + (d > 1e-8 ? dz / d : 0) * min
          hit = true
        }
      }
    }
  }
  return hit
}
