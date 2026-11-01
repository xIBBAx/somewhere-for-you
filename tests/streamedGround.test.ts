import { describe, expect, it } from "vitest"
import { GroundHistory, TRACK_PROFILES } from "../src/game/environment/ground/groundHistory"
import { renderedGroundHeight, sampleGround } from "../src/game/environment/ground/groundSurface"
import { packTrailField, TRAIL_SIZE } from "../src/game/environment/ground/trailField"
import { generateChunk } from "../src/world/chunkGen"
import { buildTerrainGeometry, releaseTerrainGeometry } from "../src/world/render/terrainGeometry"
import { WorldStreamer } from "../src/world/streamer"
import { worldStreamRT } from "../src/world/worldRuntime"
import { CHUNK_SIZE, chunkKey, LOD_SEGMENTS, type TerrainLod } from "../src/world/worldConfig"

const landNear = (base: number, grassOnly = false) => {
  for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) {
    const px = base + x * 16, pz = -base + z * 16
    const surface = sampleGround(px, pz)
    if (surface.kind !== "water" && surface.slope < 0.4 && (!grassOnly || surface.kind === "grass")) return [px, pz] as const
  }
  throw new Error("Expected a walkable streamed region")
}

describe("ground contact across the streamed world", () => {
  it.each([1000, -1000000, 1000000])("leaves distinct alternating footprints near %s without a teleport trail", base => {
    const history = new GroundHistory(), [x, z] = landNear(base)
    for (let i = 0; i < 50; i++) history.observe("explorer", TRACK_PROFILES.explorer, x + i * 0.05, z, 1.5, false, 0, 1 / 30)
    const prints = history.tracks.filter(t => t?.active)
    expect(prints.length).toBeGreaterThan(2)
    expect(prints.every(t => Math.abs(t!.x - x) < 3 && Math.abs(t!.z - z) < 0.3)).toBe(true)
    for (let i = 1; i < prints.length; i++) expect(prints[i]!.side).toBe(-prints[i - 1]!.side)
    const count = history.emitted
    history.observe("explorer", TRACK_PROFILES.explorer, x + 1000, z, 1.5, false, 0, 1 / 30)
    expect(history.emitted).toBe(count)
  })

  it("uses the actual triangle heights at every rendered LOD, including negative far chunks", () => {
    const previous = worldStreamRT.streamer
    const streamer = new WorldStreamer({ onChunkReady: () => {}, onChunkLodChange: () => {}, onChunkUnload: () => {} }, 0)
    worldStreamRT.streamer = streamer
    try {
      const cx = -15626, cz = 15625, key = chunkKey(cx, cz), payload = generateChunk(cx, cz)
      for (const lod of [0, 1, 2] as TerrainLod[]) {
        streamer.chunks.set(key, { cx, cz, key, payload, lod, distance: 0, requested: true })
        const geometry = buildTerrainGeometry(payload, lod), position = geometry.getAttribute("position")
        const n = LOD_SEGMENTS[lod] + 1, cell = CHUNK_SIZE / LOD_SEGMENTS[lod]
        for (const [u, v] of [[0.2, 0.3], [0.7, 0.8]]) {
          const i = 9 * n + 7, a = position.getY(i), b = position.getY(i + 1), c = position.getY(i + n), d = position.getY(i + n + 1)
          const expected = u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v)
          expect(renderedGroundHeight(cx * CHUNK_SIZE + (7 + u) * cell, cz * CHUNK_SIZE + (9 + v) * cell)).toBeCloseTo(expected, 6)
        }
        releaseTerrainGeometry(geometry)
      }
    } finally { streamer.dispose(); worldStreamRT.streamer = previous }
  })

  it("compresses grass at far coordinates and recovers; the moving field stays fixed in size", () => {
    const history = new GroundHistory(), [x, z] = landNear(1000000, true)
    const print = history.stamp({ maker: "explorer", profile: TRACK_PROFILES.explorer, x, z, angle: 0 })!
    const data = new Uint8Array(TRAIL_SIZE ** 2)
    packTrailField(data, history.tracks, x, z)
    const initial = data.reduce((n, v) => n + v, 0)
    expect(initial).toBeGreaterThan(0)
    history.advance(45, 0, 0)
    packTrailField(data, history.tracks, x, z)
    expect(data.reduce((n, v) => n + v, 0)).toBeLessThan(initial / 3)
    packTrailField(data, history.tracks, x + 1000, z + 1000)
    expect(data.every(v => v === 0)).toBe(true)
    expect(data.length).toBe(TRAIL_SIZE ** 2)
    expect(print.depth).toBe(0)
  })

  it("forgets stride state for unloaded wildlife instead of retaining visited regions", () => {
    const history = new GroundHistory()
    for (let i = 0; i < 500; i++) history.observe(`animal:${i}`, TRACK_PROFILES.tiger, 1000 + i, 1000, 0, false, 0, 1 / 60)
    history.retainWalkers(new Set(["animal:499"]))
    expect([...history.walkers.keys()]).toEqual(["animal:499"])
  })
})
