import type { ChunkState, StreamerListener, WorldStreamer } from "./streamer"

/**
 * Shared, non-React access to the streamed world. Rendering systems
 * (terrain, scatter, water, grass, wildlife) subscribe to chunk lifecycle
 * events here instead of each running their own streaming logic.
 */
export const worldStreamRT = {
  streamer: null as WorldStreamer | null,
  listeners: new Set<Partial<StreamerListener>>(),
  /** true once the chunks around the spawn point exist */
  spawnReady: false,
}

export const subscribeChunks = (listener: Partial<StreamerListener>): (() => void) => {
  worldStreamRT.listeners.add(listener)
  // replay chunks that already exist so late subscribers catch up
  const streamer = worldStreamRT.streamer
  if (streamer && listener.onChunkReady) {
    for (const chunk of streamer.chunks.values()) if (chunk.payload) listener.onChunkReady(chunk)
  }
  return () => {
    worldStreamRT.listeners.delete(listener)
  }
}

export const broadcast = {
  onChunkReady: (chunk: ChunkState): void => {
    for (const l of worldStreamRT.listeners) l.onChunkReady?.(chunk)
  },
  onChunkLodChange: (chunk: ChunkState): void => {
    for (const l of worldStreamRT.listeners) l.onChunkLodChange?.(chunk)
  },
  onChunkUnload: (chunk: ChunkState): void => {
    for (const l of worldStreamRT.listeners) l.onChunkUnload?.(chunk)
  },
}
