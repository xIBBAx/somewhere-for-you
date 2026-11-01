import { describe, expect, it } from "vitest"
import { generateChunk } from "../src/world/chunkGen"
import { buildTerrainGeometry, morphEnd, morphWeight, releaseTerrainGeometry, renderedChunkHeight } from "../src/world/render/terrainGeometry"
import { STREAM_CONFIG } from "../src/world/streamer"
import { CHUNK_SIZE, LOD_SEGMENTS, type TerrainLod } from "../src/world/worldConfig"

/** Terrain LOD switches must not pop: each mesh has already become the next. */
describe("terrain geomorphing", () => {
  const payload = generateChunk(37, -12)

  it("lands every fully morphed vertex exactly on the next coarser mesh", () => {
    for (const lod of [0, 1] as TerrainLod[]) {
      const g = buildTerrainGeometry(payload, lod)
      const pos = g.getAttribute("position"), morph = g.getAttribute("aMorph")
      const n = LOD_SEGMENTS[lod] + 1
      for (let v = 0; v < n * n; v += 7) {
        const lx = pos.getX(v), lz = pos.getZ(v)
        const coarse = renderedChunkHeight(payload, (lod + 1) as TerrainLod, lx, lz, Number.NaN)
        expect(pos.getY(v) + morph.getX(v)).toBeCloseTo(coarse, 4)
        expect(morph.getY(v)).toBeCloseTo(morphEnd(lod), 4)
      }
      releaseTerrainGeometry(g)
    }
  })

  it("morphs colours and masks too, and nothing on the coarsest mesh", () => {
    const g = buildTerrainGeometry(payload, 2)
    const morph = g.getAttribute("aMorph"), col = g.getAttribute("color"), cc = g.getAttribute("aCoarseColor")
    for (let v = 0; v < morph.count; v += 13) {
      expect(morph.getX(v)).toBe(0)
      expect(cc.getX(v)).toBe(col.getX(v))
    }
    releaseTerrainGeometry(g)
  })

  it("finishes each morph before the chunk can switch, even at its nearest corner", () => {
    const halfDiagonal = (CHUNK_SIZE / 2) * Math.SQRT2
    // switching coarser→finer happens at boundary − hysteresis: the nearest vertex is then this far
    expect(morphEnd(0)).toBeLessThanOrEqual(STREAM_CONFIG.lod0Radius - STREAM_CONFIG.lodHysteresis - halfDiagonal + 1e-9)
    expect(morphEnd(1)).toBeLessThanOrEqual(STREAM_CONFIG.lod1Radius - STREAM_CONFIG.lodHysteresis - halfDiagonal + 1e-9)
    expect(morphWeight(0, morphEnd(0))).toBe(1)
    expect(morphWeight(0, 10)).toBe(0)
    // full detail where the player stands
    expect(morphEnd(0) - 35).toBeGreaterThan(30)
  })

  it("reports the same morphed height the drawn mesh has", () => {
    const d = morphEnd(0) - 10
    const w = morphWeight(0, d)
    expect(w).toBeGreaterThan(0)
    expect(w).toBeLessThan(1)
    const fine = renderedChunkHeight(payload, 0, 20.3, 41.7, Number.NaN)
    const coarse = renderedChunkHeight(payload, 1, 20.3, 41.7, Number.NaN)
    expect(renderedChunkHeight(payload, 0, 20.3, 41.7, d)).toBeCloseTo(fine + (coarse - fine) * w, 6)
  })
  it("matches barycentric interpolation of GPU-morphed vertices inside both triangle halves", () => {
    for (const lod of [0, 1] as TerrainLod[]) {
      const geometry = buildTerrainGeometry(payload, lod)
      const position = geometry.getAttribute("position"), morph = geometry.getAttribute("aMorph")
      const segments = LOD_SEGMENTS[lod], step = CHUNK_SIZE / segments
      const px = -morphEnd(lod) + 28, pz = 13.2
      const height = (i: number, j: number) => {
        const v = j * (segments + 1) + i
        return position.getY(v) + morph.getX(v) * morphWeight(lod, Math.hypot(position.getX(v) - px, position.getZ(v) - pz))
      }
      for (const [u, v] of [[0.23, 0.31], [0.81, 0.67]]) {
        for (let i = 1; i < segments - 1; i += 5) {
          const j = 5, x = (i + u) * step, z = (j + v) * step
          const a = height(i, j), b = height(i + 1, j), c = height(i, j + 1), d = height(i + 1, j + 1)
          const expected = u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v)
          expect(renderedChunkHeight(payload, lod, x, z, Math.hypot(x - px, z - pz), px, pz)).toBeCloseTo(expected, 5)
        }
      }
      releaseTerrainGeometry(geometry)
    }
  })

})
