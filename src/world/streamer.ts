import type { ChunkPayload } from "./chunkGen"
import type { ChunkRequest } from "./chunk.worker"
import { CHUNK_SIZE, chunkKey, type TerrainLod } from "./worldConfig"

/**
 * Chunk streaming core (no rendering here).
 *
 * Maintains the set of chunks around the player, prioritises generation in
 * the direction of travel, farms generation out to a small worker pool and
 * hands finished payloads to listeners on a per-frame time budget, so the
 * world keeps building without ever freezing the frame.
 */

export type ChunkState = {
  key: string
  cx: number
  cz: number
  payload: ChunkPayload | null
  lod: TerrainLod
  /** distance from player to chunk centre at last update */
  distance: number
  requested: boolean
}

export type StreamerListener = {
  onChunkReady: (chunk: ChunkState) => void
  onChunkLodChange: (chunk: ChunkState) => void
  onChunkUnload: (chunk: ChunkState) => void
}

export type StreamerStats = {
  loaded: number
  pending: number
  inFlight: number
  generated: number
  unloaded: number
  avgGenMs: number
  lastIntegrateMs: number
}

export const STREAM_CONFIG = {
  /** chunks whose centre lies within this distance are kept loaded */
  loadRadius: 300,
  /** hysteresis before unloading */
  unloadRadius: 360,
  // (with the hysteresis below, a chunk's vertices are always fully morphed
  // to the coarser shape before it can switch: render/terrainGeometry.ts)
  lod0Radius: 128,
  lod1Radius: 208,
  /** metres past a LOD boundary before a chunk switches */
  lodHysteresis: 8,
  /** main-thread milliseconds per frame for integrating finished chunks */
  frameBudgetMs: 4,
}

export class WorldStreamer {
  readonly chunks = new Map<string, ChunkState>()
  readonly stats: StreamerStats = { loaded: 0, pending: 0, inFlight: 0, generated: 0, unloaded: 0, avgGenMs: 0, lastIntegrateMs: 0 }
  private workers: Worker[] = []
  private idle: Worker[] = []
  private inflight = new Map<number, ChunkState>()
  private queue: ChunkState[] = []
  private ready: Array<{ chunk: ChunkState; payload: ChunkPayload }> = []
  private nextId = 1
  private listener: StreamerListener
  private lastCx = Number.NaN
  private lastCz = Number.NaN
  private genTotal = 0
  private disposed = false
  /** the player's position at the last update (NaN before the first): the
   * centre of the terrain's LOD morph */
  px = Number.NaN
  pz = Number.NaN

  constructor(listener: StreamerListener, workerCount = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 2))) {
    this.listener = listener
    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(new URL("./chunk.worker.ts", import.meta.url), { type: "module" })
      worker.onmessage = (event: MessageEvent<{ id: number; payload?: ChunkPayload; error?: string }>) => this.onWorkerMessage(worker, event.data)
      worker.onerror = (event) => console.error("[world] chunk worker error", event.message)
      this.workers.push(worker)
      this.idle.push(worker)
    }
  }

  dispose(): void {
    this.disposed = true
    for (const w of this.workers) w.terminate()
    this.workers.length = 0
    this.idle.length = 0
    this.chunks.clear()
  }

  private onWorkerMessage(worker: Worker, data: { id: number; payload?: ChunkPayload; error?: string }): void {
    this.idle.push(worker)
    const chunk = this.inflight.get(data.id)
    this.inflight.delete(data.id)
    if (this.disposed || !chunk) return
    if (data.error || !data.payload) {
      console.error(`[world] chunk ${chunk.key} failed`, data.error)
      chunk.requested = false
      return
    }
    // Chunk may have been unloaded while generating; drop it.
    if (this.chunks.get(chunk.key) !== chunk) return
    this.genTotal += data.payload.genMs
    this.stats.generated++
    this.stats.avgGenMs = this.genTotal / this.stats.generated
    this.ready.push({ chunk, payload: data.payload })
    this.pump()
  }

  private pump(): void {
    while (this.idle.length && this.queue.length) {
      const chunk = this.queue.shift()!
      if (this.chunks.get(chunk.key) !== chunk || chunk.payload) continue
      const worker = this.idle.pop()!
      const id = this.nextId++
      this.inflight.set(id, chunk)
      const request: ChunkRequest = { id, cx: chunk.cx, cz: chunk.cz }
      worker.postMessage(request)
    }
  }

  lodFor(distance: number): TerrainLod {
    if (distance < STREAM_CONFIG.lod0Radius) return 0
    if (distance < STREAM_CONFIG.lod1Radius) return 1
    return 2
  }

  /**
   * Call every frame with the player's logical position and velocity.
   * Returns true while chunks near the player are still missing.
   */
  update(px: number, pz: number, vx: number, vz: number): void {
    this.px = px
    this.pz = pz
    const pcx = Math.floor(px / CHUNK_SIZE)
    const pcz = Math.floor(pz / CHUNK_SIZE)
    const R = Math.ceil(STREAM_CONFIG.loadRadius / CHUNK_SIZE) + 1
    const moved = pcx !== this.lastCx || pcz !== this.lastCz

    // Refresh distances + LODs every frame (cheap: ~100 chunks).
    for (const chunk of this.chunks.values()) {
      const dx = (chunk.cx + 0.5) * CHUNK_SIZE - px
      const dz = (chunk.cz + 0.5) * CHUNK_SIZE - pz
      chunk.distance = Math.hypot(dx, dz)
    }

    if (moved) {
      this.lastCx = pcx
      this.lastCz = pcz
      for (let dz = -R; dz <= R; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          const cx = pcx + dx
          const cz = pcz + dz
          const d = Math.hypot((cx + 0.5) * CHUNK_SIZE - px, (cz + 0.5) * CHUNK_SIZE - pz)
          if (d > STREAM_CONFIG.loadRadius) continue
          const key = chunkKey(cx, cz)
          if (this.chunks.has(key)) continue
          const chunk: ChunkState = { key, cx, cz, payload: null, lod: this.lodFor(d), distance: d, requested: false }
          this.chunks.set(key, chunk)
        }
      }
      for (const chunk of this.chunks.values()) {
        if (chunk.distance > STREAM_CONFIG.unloadRadius) {
          this.chunks.delete(chunk.key)
          this.stats.unloaded++
          if (chunk.payload) this.listener.onChunkUnload(chunk)
        }
      }
    }

    // Queue unrequested chunks, prioritised by distance and travel direction.
    const speed = Math.hypot(vx, vz)
    const dirX = speed > 0.1 ? vx / speed : 0
    const dirZ = speed > 0.1 ? vz / speed : 0
    let added = false
    for (const chunk of this.chunks.values()) {
      if (chunk.requested) continue
      chunk.requested = true
      this.queue.push(chunk)
      added = true
    }
    if (added || moved) {
      const score = (c: ChunkState): number => {
        const dx = (c.cx + 0.5) * CHUNK_SIZE - px
        const dz = (c.cz + 0.5) * CHUNK_SIZE - pz
        const ahead = (dx * dirX + dz * dirZ) / Math.max(1, c.distance)
        return c.distance - ahead * 60
      }
      this.queue.sort((a, b) => score(a) - score(b))
    }
    this.pump()

    // LOD transitions for already-built chunks.
    for (const chunk of this.chunks.values()) {
      if (!chunk.payload) continue
      const wanted = this.lodFor(chunk.distance + (chunk.lod === this.lodFor(chunk.distance) ? 0 : 0))
      // hysteresis: only switch once past the boundary by lodHysteresis
      if (wanted !== chunk.lod) {
        const coarser = wanted > chunk.lod
        const boundary = coarser ? (chunk.lod === 0 ? STREAM_CONFIG.lod0Radius : STREAM_CONFIG.lod1Radius) : (wanted === 0 ? STREAM_CONFIG.lod0Radius : STREAM_CONFIG.lod1Radius)
        const h = STREAM_CONFIG.lodHysteresis
        if (coarser ? chunk.distance > boundary + h : chunk.distance < boundary - h) {
          chunk.lod = wanted
          this.listener.onChunkLodChange(chunk)
        }
      }
    }

    // Integrate finished chunks within the frame budget (nearest first).
    if (this.ready.length) {
      const t0 = performance.now()
      this.ready.sort((a, b) => a.chunk.distance - b.chunk.distance)
      while (this.ready.length && performance.now() - t0 < STREAM_CONFIG.frameBudgetMs) {
        const { chunk, payload } = this.ready.shift()!
        if (this.chunks.get(chunk.key) !== chunk) continue
        chunk.payload = payload
        chunk.lod = this.lodFor(chunk.distance)
        this.listener.onChunkReady(chunk)
      }
      this.stats.lastIntegrateMs = performance.now() - t0
    }

    let loaded = 0
    for (const chunk of this.chunks.values()) if (chunk.payload) loaded++
    this.stats.loaded = loaded
    this.stats.pending = this.chunks.size - loaded
    this.stats.inFlight = this.inflight.size
  }

  /** True when every chunk within `radius` of (px, pz) is built. */
  isAreaReady(px: number, pz: number, radius: number): boolean {
    for (const chunk of this.chunks.values()) {
      if (chunk.distance <= radius && !chunk.payload) return false
    }
    const cx = Math.floor(px / CHUNK_SIZE)
    const cz = Math.floor(pz / CHUNK_SIZE)
    return this.chunks.get(chunkKey(cx, cz))?.payload != null
  }

  getChunkAt(x: number, z: number): ChunkState | undefined {
    return this.chunks.get(chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)))
  }
}
