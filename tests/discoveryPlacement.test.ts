import { describe, expect, it } from "vitest"
import { findInCell, FIND_CELL } from "../src/world/findPlacement"
import { LANDMARK_CELL, LANDMARK_RADIUS, LANDMARK_RARITY, landmarkInCell } from "../src/world/landmarks"
import { rawWildHeight } from "../src/world/baseTerrain"
import { lakeMask, WATER_LEVEL } from "../src/world/climate"
import { slopeAt, worldHeight } from "../src/world/terrain"
import { generateChunk, K, SCATTER_STRIDE } from "../src/world/chunkGen"
import { CHUNK_SIZE } from "../src/world/worldConfig"

describe("discoveries throughout the world", () => {
  it("reconstructs safe small finds after visiting thousands of other cells", () => {
    const first = []
    for (let cx = -10; cx <= 10; cx++) for (let cz = -10; cz <= 10; cz++) first.push([cx, cz, findInCell(cx, cz)] as const)
    for (let i = 0; i < 1500; i++) findInCell(i + 100, -i - 100)
    let count = 0
    for (const [cx, cz, f] of first) {
      expect(findInCell(cx, cz)).toEqual(f)
      if (!f) continue
      count++
      expect(Math.floor(f.x / FIND_CELL)).toBe(cx)
      expect(lakeMask(f.x, f.z)).toBe(0)
      expect(worldHeight(f.x, f.z)).toBeGreaterThan(WATER_LEVEL + 0.39)
      expect(slopeAt(f.x, f.z)).toBeLessThanOrEqual(0.25)
      const lm = landmarkInCell(Math.floor(f.x / LANDMARK_CELL), Math.floor(f.z / LANDMARK_CELL))
      if (lm) expect(Math.hypot(f.x - lm.x, f.z - lm.z)).toBeGreaterThanOrEqual(LANDMARK_RADIUS[lm.kind] + 8)
    }
    expect(count).toBeGreaterThan(80)
  })

  it("continues varied landmarks in every distant quadrant without cliff terraces or overlaps", () => {
    const rarities = new Set<string>()
    for (const [ox, oz] of [[30, 30], [-45, 30], [30, -45], [-45, -45]]) {
      const found = []
      for (let cx = ox; cx < ox + 12; cx++) for (let cz = oz; cz < oz + 12; cz++) {
        const lm = landmarkInCell(cx, cz)
        if (!lm) continue
        found.push(lm); rarities.add(LANDMARK_RARITY[lm.kind])
        const r = LANDMARK_RADIUS[lm.kind] + 6, h = rawWildHeight(lm.x, lm.z)
        for (let i = 0; i < 8; i++) {
          const x = lm.x + Math.cos(i * Math.PI / 4) * r, z = lm.z + Math.sin(i * Math.PI / 4) * r
          expect(lakeMask(x, z)).toBe(0)
          expect(Math.abs(rawWildHeight(x, z) - h) / r).toBeLessThanOrEqual(0.32)
        }
      }
      expect(found.length).toBeGreaterThan(30)
      for (let i = 0; i < found.length; i++) for (let j = i + 1; j < found.length; j++) {
        expect(Math.hypot(found[i].x - found[j].x, found[i].z - found[j].z)).toBeGreaterThan(120)
      }
    }
    expect(rarities.size).toBe(4)
  })

  it("keeps trees, rocks and bushes out of small-find clearings, including chunk borders", () => {
    const finds = []
    for (let cx = 8; cx < 25 && finds.length < 6; cx++) for (let cz = 5; cz < 15 && finds.length < 6; cz++) {
      const f = findInCell(cx, cz)
      if (f) finds.push(f)
    }
    expect(finds).toHaveLength(6)
    for (const f of finds) {
      for (let cx = Math.floor((f.x - 3) / CHUNK_SIZE); cx <= Math.floor((f.x + 3) / CHUNK_SIZE); cx++) {
        for (let cz = Math.floor((f.z - 3) / CHUNK_SIZE); cz <= Math.floor((f.z + 3) / CHUNK_SIZE); cz++) {
          const p = generateChunk(cx, cz)
          for (let i = 0; i < p.scatterCount; i++) {
            const k = i * SCATTER_STRIDE, kind = p.scatter[k + 5]
            if (kind >= K.flower) continue
            expect(Math.hypot(cx * CHUNK_SIZE + p.scatter[k] - f.x, cz * CHUNK_SIZE + p.scatter[k + 2] - f.z)).toBeGreaterThan(2.4)
          }
        }
      }
    }
  })
})
