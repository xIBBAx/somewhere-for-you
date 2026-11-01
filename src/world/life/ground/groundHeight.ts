import { renderedGroundHeight } from "../../../game/environment/ground/groundSurface"
import { renderedChunkHeight } from "../../render/terrainGeometry"
import type { ChunkState } from "../../streamer"
import { CHUNK_SIZE, chunkKey } from "../../worldConfig"
import { worldStreamRT } from "../../worldRuntime"

/**
 * Height of the *rendered* terrain triangles (exactly what
 * `renderedGroundHeight` returns), without its per-call chunk-key string.
 * Tiny creatures must sit on the drawn surface, not on the analytic height,
 * or they float or sink by a few centimetres — their whole body height.
 *
 * A 4×4 direct-mapped cache remembers chunk records by integer coordinates;
 * a record is trusted only while the streamer still holds that same object
 * with a payload, so unloads and LOD switches are always respected.
 */
const SLOTS = 16
const cacheCx = new Int32Array(SLOTS)
const cacheCz = new Int32Array(SLOTS)
const cacheChunk: (ChunkState | null)[] = new Array<ChunkState | null>(SLOTS).fill(null)

const chunkAt = (cx: number, cz: number): ChunkState | null => {
  const streamer = worldStreamRT.streamer
  if (!streamer) return null
  const slot = ((cx & 3) << 2) | (cz & 3)
  const cached = cacheChunk[slot]
  if (cached && cacheCx[slot] === cx && cacheCz[slot] === cz && cached.payload && streamer.chunks.get(cached.key) === cached) return cached
  // Miss: one string lookup when crossing into a chunk (rare, not per frame).
  const chunk = streamer.chunks.get(chunkKey(cx, cz)) ?? null
  cacheChunk[slot] = chunk && chunk.payload ? chunk : null
  cacheCx[slot] = cx
  cacheCz[slot] = cz
  return cacheChunk[slot]
}

export const groundHeightAt = (x: number, z: number): number => {
  const cx = Math.floor(x / CHUNK_SIZE)
  const cz = Math.floor(z / CHUNK_SIZE)
  const chunk = chunkAt(cx, cz)
  if (!chunk || !chunk.payload) return renderedGroundHeight(x, z)
  // (as morphed for the player's distance: render/terrainGeometry.ts)
  const streamer = worldStreamRT.streamer
  const d = streamer ? Math.hypot(x - streamer.px, z - streamer.pz) : Number.NaN
  return renderedChunkHeight(chunk.payload, chunk.lod, x - cx * CHUNK_SIZE, z - cz * CHUNK_SIZE, d, streamer ? streamer.px - cx * CHUNK_SIZE : Number.NaN, streamer ? streamer.pz - cz * CHUNK_SIZE : Number.NaN)
}

/** Drop cached chunk records (tests, world resets). */
export const resetGroundHeightCache = (): void => {
  cacheChunk.fill(null)
}
