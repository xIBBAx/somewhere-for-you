import type { ChunkPayload } from "../chunkGen"
import { WATER_LEVEL } from "../climate"
import { worldHeight } from "../terrain"
import { CHUNK_SIZE, chunkKey, worldToChunk } from "../worldConfig"
import { classifyWater, type WaterHabitat } from "./habitat"
import { ACTIVE_RANGE, FISH_LIMITS, createFish, fishBudget, makePopulation, populationFactor, resetFish, type FishAgent, type FishSpawn } from "./simulation"
import { SURFACE_LIMIT, createSurfaceAgent, makeSurfacePopulation, type SurfaceAgent, type SurfaceSpawn } from "./surface"

type ResidentChunk = { habitat: WaterHabitat; fish: FishSpawn[] | null; surface: SurfaceSpawn[] | null }

/** Chunk payloads own spawn descriptors; only a bounded near population owns
 * mutable agents. Reused agents never retain unloaded terrain references. */
export class AquaticPopulation {
  readonly chunks = new Map<string, ResidentChunk>()
  readonly fish: FishAgent[] = []
  readonly surface: SurfaceAgent[] = []
  private fishPool: FishAgent[] = []
  private surfacePool: SurfaceAgent[] = []
  private fishCandidates: FishSpawn[] = []
  private surfaceCandidates: SurfaceSpawn[] = []
  private keep = new Set<string>()
  private speciesCounts = new Uint16Array(4)
  private px = 0
  private pz = 0
  private rank = (a: { x: number; z: number; id: string }, b: { x: number; z: number; id: string }): number =>
    (a.x - this.px) ** 2 + (a.z - this.pz) ** 2 - (b.x - this.px) ** 2 - (b.z - this.pz) ** 2 || a.id.localeCompare(b.id)

  add(payload: ChunkPayload): void {
    const key = chunkKey(payload.cx, payload.cz)
    const homeWater = payload.cx === 0 && payload.cz === 0 || (payload.cx === 0 || payload.cx === -1) && payload.cz === -1
    if ((!payload.hasWater && !homeWater) || this.chunks.has(key)) return
    this.chunks.set(key, { habitat: classifyWater(payload), fish: null, surface: null })
  }

  remove(key: string): void {
    this.chunks.delete(key)
    for (let i = this.fish.length - 1; i >= 0; i--) if (this.fish[i].habitat.key === key) this.releaseFish(i, false)
    for (let i = this.surface.length - 1; i >= 0; i--) if (this.surface[i].habitat.key === key) this.releaseSurface(i, false)
    // A parked agent would hold the old payload. Drop those references too.
    this.fishPool = this.fishPool.filter(a => a.habitat.key !== key)
    this.surfacePool = this.surfacePool.filter(a => a.habitat.key !== key)
    this.fishCandidates.length = 0; this.surfaceCandidates.length = 0
  }

  clear(): void {
    this.chunks.clear(); this.fish.length = 0; this.surface.length = 0
    this.fishPool.length = 0; this.surfacePool.length = 0
    this.fishCandidates.length = 0; this.surfaceCandidates.length = 0; this.keep.clear()
  }

  force(x: number, z: number): "ready" | "pending" | "dry" {
    const key = chunkKey(worldToChunk(x), worldToChunk(z)), chunk = this.chunks.get(key)
    if (!chunk) return worldHeight(x, z) >= WATER_LEVEL - 0.22 ? "dry" : "pending"
    if (!chunk.habitat.areas.length) return "dry"
    for (let i = this.fish.length - 1; i >= 0; i--) if (this.fish[i].habitat.key === key) this.releaseFish(i, true)
    for (let i = this.surface.length - 1; i >= 0; i--) if (this.surface[i].habitat.key === key) this.releaseSurface(i, true)
    chunk.fish = makePopulation(chunk.habitat, { x, z }); chunk.surface = makeSurfacePopulation(chunk.habitat)
    return chunk.fish.length ? "ready" : "dry"
  }

  refresh(px: number, pz: number, particles: number, animals: number): void {
    this.px = px; this.pz = pz
    this.fishCandidates.length = 0; this.surfaceCandidates.length = 0
    for (const chunk of this.chunks.values()) {
      const p = chunk.habitat.payload
      const dx = Math.max(p.cx * CHUNK_SIZE - px, 0, px - (p.cx + 1) * CHUNK_SIZE)
      const dz = Math.max(p.cz * CHUNK_SIZE - pz, 0, pz - (p.cz + 1) * CHUNK_SIZE)
      if (dx * dx + dz * dz > ACTIVE_RANGE * ACTIVE_RANGE) continue
      if (!chunk.fish) { chunk.fish = makePopulation(chunk.habitat); chunk.surface = makeSurfacePopulation(chunk.habitat) }
      for (const s of chunk.fish) if ((s.x - px) ** 2 + (s.z - pz) ** 2 < ACTIVE_RANGE * ACTIVE_RANGE) this.fishCandidates.push(s)
      for (const s of chunk.surface!) if ((s.x - px) ** 2 + (s.z - pz) ** 2 < ACTIVE_RANGE * ACTIVE_RANGE) this.surfaceCandidates.push(s)
    }
    const factor = populationFactor(particles, animals), limit = fishBudget(particles, animals)
    this.fishCandidates.sort(this.rank); this.surfaceCandidates.sort(this.rank)
    this.speciesCounts.fill(0); this.keep.clear()
    for (const s of this.fishCandidates) {
      if (this.keep.size >= limit) break
      if (this.speciesCounts[s.species] >= Math.max(1, Math.round(FISH_LIMITS[s.species] * factor))) continue
      this.keep.add(s.id); this.speciesCounts[s.species]++
    }
    for (let i = this.fish.length - 1; i >= 0; i--) if (!this.keep.has(this.fish[i].id)) this.releaseFish(i, true)
    for (const s of this.fishCandidates) {
      if (!this.keep.has(s.id) || this.fish.some(a => a.id === s.id)) continue
      const a = this.fishPool.pop()
      if (a) { resetFish(a, s); this.fish.push(a) } else this.fish.push(createFish(s))
    }
    this.keep.clear()
    const counts = [0, 0, 0]
    for (const s of this.surfaceCandidates) {
      if (this.keep.size >= Math.max(4, Math.round(SURFACE_LIMIT * particles))) break
      if (counts[s.kind] >= Math.max(1, Math.round((s.kind === 0 ? 4 : 5) * particles))) continue
      this.keep.add(s.id); counts[s.kind]++
    }
    for (let i = this.surface.length - 1; i >= 0; i--) if (!this.keep.has(this.surface[i].id)) this.releaseSurface(i, true)
    for (const s of this.surfaceCandidates) {
      if (!this.keep.has(s.id) || this.surface.some(a => a.id === s.id)) continue
      const a = this.surfacePool.pop()
      if (a) {
        Object.assign(a, s); a.active = true; a.heading = Math.atan2(s.waterX - s.x, s.waterZ - s.z)
        a.timer = 8 + s.phase * 0.2; a.croak = 0; a.hop = 0; a.submerged = 0; a.returning = false; a.elapsed = 0
        this.surface.push(a)
      } else this.surface.push(createSurfaceAgent(s))
    }
  }

  private releaseFish(i: number, pool: boolean): void {
    const a = this.fish[i]; a.active = false
    this.fish[i] = this.fish[this.fish.length - 1]; this.fish.pop()
    if (pool) this.fishPool.push(a)
  }
  private releaseSurface(i: number, pool: boolean): void {
    const a = this.surface[i]; a.active = false
    this.surface[i] = this.surface[this.surface.length - 1]; this.surface.pop()
    if (pool) this.surfacePool.push(a)
  }
}
