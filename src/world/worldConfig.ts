/**
 * Streaming-world constants. One seed defines the entire endless landscape;
 * changing it produces a different (but equally stable) universe.
 */
export const WORLD_SEED = 0x6d1b0525

/** Side length of one streamed terrain chunk, in metres. */
export const CHUNK_SIZE = 64

/** Grid resolution (quads per side) for each terrain LOD. */
export const LOD_SEGMENTS = [64, 32, 16] as const
export type TerrainLod = 0 | 1 | 2

/** Floating-origin grid. The render origin always sits on a multiple of this. */
export const ORIGIN_GRID = 1024
/** Rebase once the player is this far (render space) from the current origin. */
export const ORIGIN_REBASE_DISTANCE = 640
/** The home region renders with origin exactly zero while the player is this close. */
export const HOME_ORIGIN_RADIUS = 520

export const chunkKey = (cx: number, cz: number): string => `${cx},${cz}`
export const worldToChunk = (v: number): number => Math.floor(v / CHUNK_SIZE)
