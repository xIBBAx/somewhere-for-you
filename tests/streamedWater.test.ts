import type * as THREE from "three"
import { describe, expect, it, vi } from "vitest"
import { FIELD_N, FIELD_STEP, type ChunkPayload } from "../src/world/chunkGen"
import { WATER_LEVEL } from "../src/world/climate"
import { buildWaterGeometry } from "../src/world/render/waterGeometry"

// An exactly representable water level lets the fixtures exercise zero-depth
// vertices and edges, independent of the world's current height offset.
vi.mock("../src/world/climate", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/world/climate")>(),
  WATER_LEVEL: 0,
}))

const SIZE = (FIELD_N - 1) * FIELD_STEP
const payload = (cx: number, cz: number, heightAt: (x: number, z: number) => number): ChunkPayload => {
  const heights = new Float32Array(FIELD_N * FIELD_N)
  for (let z = 0; z < FIELD_N; z++) for (let x = 0; x < FIELD_N; x++) {
    heights[z * FIELD_N + x] = heightAt(cx * SIZE + x * FIELD_STEP, cz * SIZE + z * FIELD_STEP)
  }
  return {
    cx, cz, heights, hasWater: true, minH: -1, maxH: 1,
    normals: new Int8Array(0), colors: new Uint8Array(0), aux: new Uint8Array(0),
    scatter: new Float32Array(0), scatterCount: 0,
    biome: 0, biomeWeights: new Float32Array(0), genMs: 0,
  }
}

const surfaceArea = (g: THREE.BufferGeometry): number => {
  const positions = g.getAttribute("position"), depths = g.getAttribute("waterDepth")
  expect(g.index).toBeNull()
  expect(positions.count % 3).toBe(0)
  expect(depths.count).toBe(positions.count)
  let area = 0
  for (let i = 0; i < positions.count; i++) {
    expect(positions.getY(i)).toBeCloseTo(WATER_LEVEL + 0.012, 6)
    expect(depths.getX(i)).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(depths.getX(i))).toBe(true)
    if (i % 3 !== 0) continue
    const ax = positions.getX(i), az = positions.getZ(i)
    const upwardArea = (positions.getZ(i + 1) - az) * (positions.getX(i + 2) - ax)
      - (positions.getX(i + 1) - ax) * (positions.getZ(i + 2) - az)
    expect(upwardArea).toBeGreaterThan(0)
    area += upwardArea / 2
  }
  return area
}

describe("streamed lake surfaces", () => {
  it.each([
    { name: "terrain diagonals", height: (x: number, z: number) => x + z - SIZE, area: SIZE * SIZE / 2 },
    { name: "vertices across terrain diagonals", height: (x: number, z: number) => x - z, area: SIZE * SIZE / 2 },
    { name: "grid edges", height: (x: number) => x - SIZE / 4, area: SIZE * SIZE / 4 },
    { name: "triangle interiors", height: (x: number, z: number) => x + z - SIZE / 2 - 0.25, area: (SIZE / 2 + 0.25) ** 2 / 2 },
  ])("preserves submerged area and upward triangles when the waterline follows $name", ({ height, area }) => {
    const g = buildWaterGeometry(payload(0, 0, (x, z) => WATER_LEVEL + height(x, z)))!
    expect(g).not.toBeNull()
    expect(surfaceArea(g)).toBeCloseTo(area, 5)
    g.dispose()
  })

  it("keeps the terrain's b-c diagonal when clipping a submerged corner", () => {
    const g = buildWaterGeometry(payload(0, 0, (x, z) => WATER_LEVEL + (x === 0 && z === 0 ? -1 : 1)))!
    expect(surfaceArea(g)).toBeCloseTo(FIELD_STEP * FIELD_STEP / 8, 6)
    expect(g.getAttribute("position").count).toBe(3)
    g.dispose()
  })

  it("omits triangles that only touch the waterline beside a submerged triangle", () => {
    const g = buildWaterGeometry(payload(0, 0, (x, z) => WATER_LEVEL - (x === FIELD_STEP && z === FIELD_STEP ? 1 : 0)))!
    // Six source triangles surround the wet vertex; the two neighbouring
    // triangles with three zero-depth vertices must not add a water surface.
    expect(surfaceArea(g)).toBeCloseTo(3 * FIELD_STEP * FIELD_STEP, 6)
    expect(g.getAttribute("position").count).toBe(18)
    g.dispose()
  })

  it("omits shoreline slivers that collapse in Float32 position attributes", () => {
    const p = payload(0, 0, (x, z) => WATER_LEVEL + (x === 10 * FIELD_STEP && z === 10 * FIELD_STEP ? -1e-12 : 1))
    expect(buildWaterGeometry(p)).toBeNull()
  })

  it.each([
    { axis: "x", cx: 0, cz: 0, shoreline: 27.25 },
    { axis: "z", cx: 0, cz: 0, shoreline: 27.25 },
    { axis: "x", cx: -1, cz: -2, shoreline: -96.25 },
    { axis: "z", cx: -2, cz: -1, shoreline: -96.25 },
  ])("matches exact shared $axis-edge vertices and depths at chunk ($cx, $cz)", ({ axis, cx, cz, shoreline }) => {
    const height = (x: number, z: number): number => WATER_LEVEL + ((axis === "x" ? z : x) - shoreline) * 0.125
    const left = buildWaterGeometry(payload(cx, cz, height))!
    const right = buildWaterGeometry(payload(cx + (axis === "x" ? 1 : 0), cz + (axis === "z" ? 1 : 0), height))!
    const edge = (g: THREE.BufferGeometry, border: number): string[] => {
      const positions = g.getAttribute("position"), depths = g.getAttribute("waterDepth"), vertices: string[] = []
      for (let i = 0; i < positions.count; i++) {
        const across = axis === "x" ? positions.getX(i) : positions.getZ(i)
        const along = axis === "x" ? positions.getZ(i) : positions.getX(i)
        if (across === border) vertices.push(`${along}:${depths.getX(i)}`)
      }
      return [...new Set(vertices)].sort()
    }
    const expectedEdge = edge(left, SIZE)
    expect(expectedEdge.length).toBeGreaterThan(1)
    expect(expectedEdge).toContain(`${shoreline - (axis === "x" ? cz : cx) * SIZE}:0`)
    expect(edge(right, 0)).toEqual(expectedEdge)
    expect(surfaceArea(left)).toBeCloseTo(surfaceArea(right), 6)
    left.dispose(); right.dispose()
  })

  it("covers a fully submerged chunk with upward nonindexed triangles", () => {
    const g = buildWaterGeometry(payload(0, 0, () => WATER_LEVEL - 1))!
    expect(surfaceArea(g)).toBeCloseTo(SIZE * SIZE, 6)
    expect(g.getAttribute("position").count).toBe(6 * (FIELD_N - 1) ** 2)
    g.dispose()
  })

  it("allocates no lake mesh for dry chunks or waterline-only terrain", () => {
    const p = payload(3, 4, () => WATER_LEVEL + 1)
    p.hasWater = false
    expect(buildWaterGeometry(p)).toBeNull()
    p.hasWater = true
    expect(buildWaterGeometry(p)).toBeNull()
    p.heights.fill(WATER_LEVEL)
    expect(buildWaterGeometry(p)).toBeNull()
  })
})
