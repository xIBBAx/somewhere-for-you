import { describe, expect, it } from "vitest"
import { generateChunk, FIELD_N, SCATTER_STRIDE } from "../src/world/chunkGen"
import { biomeWeights, BIOME_COUNT, lakeMask, WATER_LEVEL, coldHeath } from "../src/world/climate"
import { hubHeight } from "../src/world/hubLayout"
import { landmarkAt, landmarkInCell, LANDMARK_CELL } from "../src/world/landmarks"
import { keepOutOfDeepWater } from "../src/game/movement"
import { worldHeight } from "../src/world/terrain"
import { CHUNK_SIZE } from "../src/world/worldConfig"

describe("deterministic world", () => {
  it("opens only cold or alpine habitat into heath", () => {
    const mild={temperature:.25,hills:.95,moisture:.1,magic:0}
    expect(coldHeath(mild)).toBe(0)
    expect(coldHeath({...mild,temperature:-.65})).toBeGreaterThan(.99)
    expect(coldHeath({...mild,temperature:-.35,hills:.1})).toBe(0)
    expect(coldHeath({...mild,temperature:-.35})).toBeGreaterThan(.4)
  })
  it("produces identical chunks for identical coordinates", () => {
    const a = generateChunk(7, -3)
    const b = generateChunk(7, -3)
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights))
    expect(Array.from(a.scatter)).toEqual(Array.from(b.scatter))
  })

  it("has no seams: shared chunk edges have identical heights", () => {
    const left = generateChunk(2, 5)
    const right = generateChunk(3, 5)
    const below = generateChunk(2, 6)
    for (let j = 0; j < FIELD_N; j++) {
      expect(left.heights[j * FIELD_N + FIELD_N - 1]).toBeCloseTo(right.heights[j * FIELD_N], 5)
    }
    for (let i = 0; i < FIELD_N; i++) {
      expect(left.heights[(FIELD_N - 1) * FIELD_N + i]).toBeCloseTo(below.heights[i], 5)
    }
  })

  it("never places scatter twice across a chunk border", () => {
    const seen = new Set<string>()
    for (const [cx, cz] of [[0, 4], [1, 4], [0, 5], [1, 5]]) {
      const p = generateChunk(cx, cz)
      for (let i = 0; i < p.scatterCount; i++) {
        const o = i * SCATTER_STRIDE
        const key = `${(cx * CHUNK_SIZE + p.scatter[o]).toFixed(3)},${(cz * CHUNK_SIZE + p.scatter[o + 2]).toFixed(3)},${p.scatter[o + 5]}`
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
    }
  })

  it("keeps the authored home terrain exactly at home", () => {
    for (const [x, z] of [[0, 22], [-12, 3], [9.2, 7], [0, -30]]) {
      expect(worldHeight(x, z)).toBeCloseTo(hubHeight(x, z), 6)
    }
  })

  it("keeps terrain walkable and continuous far from home", () => {
    let maxStep = 0
    for (let i = 0; i < 4000; i++) {
      const x = 8000 + i * 0.5
      const step = Math.abs(worldHeight(x + 0.5, 1234) - worldHeight(x, 1234))
      maxStep = Math.max(maxStep, step)
    }
    // < 0.4 m per 0.5 m step everywhere along a 2 km line
    expect(maxStep).toBeLessThan(0.4)
  })

  it("only holds water inside lake basins", () => {
    for (let i = 0; i < 3000; i++) {
      const x = (i * 97.3) % 6000 - 3000
      const z = (i * 61.7) % 6000 - 3000
      if (Math.hypot(x, z + 2) < 80) continue
      if (worldHeight(x, z) < WATER_LEVEL) expect(lakeMask(x, z)).toBeGreaterThan(0)
    }
  })

  it("biome weights are a partition of unity", () => {
    const w = new Float32Array(BIOME_COUNT)
    for (let i = 0; i < 200; i++) {
      biomeWeights(i * 133.1 - 9000, i * -71.9 + 400, w)
      const sum = w.reduce((a, b) => a + b, 0)
      expect(sum).toBeCloseTo(1, 4)
    }
  })

  it("landmarks are stable and never in lakes", () => {
    for (let cx = -12; cx < 12; cx++) {
      for (let cz = -12; cz < 12; cz++) {
        const a = landmarkInCell(cx, cz)
        const b = landmarkInCell(cx, cz)
        expect(a).toEqual(b)
        if (a) {
          expect(lakeMask(a.x, a.z)).toBe(0)
          expect(landmarkAt(a.x, a.z)?.id).toBe(a.id)
          expect(Math.floor(a.x / LANDMARK_CELL)).toBe(cx)
        }
      }
    }
  })

  it("pushes the player out of deep lake water", () => {
    // find a deep lake point
    let found: { x: number; z: number } | null = null
    for (let i = 0; i < 20000 && !found; i++) {
      const x = (i * 37.1) % 4000 - 2000
      const z = Math.floor(i / 108) * 37 - 2000
      if (lakeMask(x, z) > 0.8 && worldHeight(x, z) < WATER_LEVEL - 1) found = { x, z }
    }
    expect(found).not.toBeNull()
    const p = { ...found! }
    keepOutOfDeepWater(p)
    expect(worldHeight(p.x, p.z)).toBeGreaterThan(WATER_LEVEL - 0.6)
  })
})
