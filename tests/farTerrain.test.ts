import { describe, expect, it } from "vitest"
import { FAR_DROP, FAR_HALF, FAR_SNAP, FAR_SPACING, FAR_TREE_STRIDE, FAR_VERTS, buildFarTerrain, farCentre } from "../src/world/farTerrain"
import { WATER_LEVEL, worldHeight } from "../src/world/terrain"

describe("far terrain", () => {
  it("is deterministic and follows the real terrain just below it", () => {
    const a = buildFarTerrain(1024, -768), b = buildFarTerrain(1024, -768)
    expect(a.heights).toEqual(b.heights)
    for (const [i, j] of [[3, 7], [28, 28], [50, 12]]) {
      const x = 1024 - FAR_HALF + i * FAR_SPACING, z = -768 - FAR_HALF + j * FAR_SPACING
      const h = worldHeight(x, z)
      const k = j * FAR_VERTS + i
      expect(a.heights[k]).toBeCloseTo(h < WATER_LEVEL - 0.05 ? WATER_LEVEL - 0.25 - FAR_DROP : h - FAR_DROP, 4)
    }
    expect([...a.colors].every(Number.isFinite)).toBe(true)
  })

  it("re-centres on a lattice that shares vertices, so hills never wobble", () => {
    expect(FAR_SNAP % FAR_SPACING).toBe(0)
    expect(farCentre(130)).toBe(256)
    const a = buildFarTerrain(0, 0), b = buildFarTerrain(FAR_SNAP, 0)
    const shift = FAR_SNAP / FAR_SPACING
    for (const [i, j] of [[20, 5], [40, 30]]) expect(b.heights[j * FAR_VERTS + i - shift]).toBe(a.heights[j * FAR_VERTS + i])
  })
})

describe("far crowns", () => {
  it("are deterministic, grounded on dry land and denser in woods", () => {
    const a = buildFarTerrain(256, 512), b = buildFarTerrain(256, 512)
    expect(a.treeCount).toBe(b.treeCount)
    expect(a.trees).toEqual(b.trees)
    expect(a.treeCount).toBeGreaterThan(0)
    for (let t = 0; t < a.treeCount; t += 97) {
      const o = t * FAR_TREE_STRIDE
      const x = 256 + a.trees[o], z = 512 + a.trees[o + 2]
      expect(worldHeight(x, z)).toBeGreaterThan(WATER_LEVEL + 0.4)
      expect(a.trees[o + 1]).toBeCloseTo(worldHeight(x, z) - FAR_DROP, 4)
    }
  })
})
