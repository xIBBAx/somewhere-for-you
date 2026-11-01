import * as THREE from "three"
import { FIELD_N, FIELD_STEP, type ChunkPayload } from "../chunkGen"
import { WATER_LEVEL } from "../climate"

type Vertex = { x: number; z: number; depth: number }

/** Clip each terrain triangle at the waterline. Matching source triangles and
 * exact shared edge interpolation give neighbouring water chunks identical
 * shorelines, without a rectangular water plane over dry land. */
export const buildWaterGeometry = (p: ChunkPayload): THREE.BufferGeometry | null => {
  if (!p.hasWater) return null
  const positions: number[] = [], depths: number[] = []
  const emit = (a: Vertex, b: Vertex, c: Vertex): void => {
    if (Math.max(a.depth, b.depth, c.depth) <= 0) return
    const input = [a, b, c], polygon: Vertex[] = []
    for (let i = 0; i < 3; i++) {
      const v = input[i], next = input[(i + 1) % 3]
      if (v.depth >= 0) polygon.push(v)
      // Waterline vertices are already retained above. Only strict crossings
      // need interpolation, otherwise the polygon contains duplicate vertices.
      if ((v.depth < 0 && next.depth > 0) || (v.depth > 0 && next.depth < 0)) {
        // Use the same endpoint order for both triangles sharing this edge.
        const wet = v.depth > 0 ? v : next, dry = v.depth < 0 ? v : next
        const t = wet.depth / (wet.depth - dry.depth)
        polygon.push({ x: Math.fround(wet.x + (dry.x - wet.x) * t), z: Math.fround(wet.z + (dry.z - wet.z) * t), depth: 0 })
      }
    }
    for (let i = 1; i + 1 < polygon.length; i++) {
      const a = polygon[0], b = polygon[i], c = polygon[i + 1]
      // A tiny submerged sliver can collapse when written to Float32 positions.
      // Test the rounded coordinates so every emitted triangle has upward area.
      if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) <= 0) continue
      for (const v of [a, b, c]) {
        positions.push(v.x, WATER_LEVEL + 0.012, v.z); depths.push(v.depth)
      }
    }
  }
  const v = (x: number, z: number): Vertex => ({ x: Math.fround(x * FIELD_STEP), z: Math.fround(z * FIELD_STEP), depth: WATER_LEVEL - p.heights[z * FIELD_N + x] })
  for (let z = 0; z < FIELD_N - 1; z++) for (let x = 0; x < FIELD_N - 1; x++) {
    const a = v(x, z), b = v(x + 1, z), c = v(x, z + 1), d = v(x + 1, z + 1)
    if (Math.max(a.depth, b.depth, c.depth, d.depth) <= 0) continue
    emit(a, c, b); emit(b, c, d)
  }
  if (!positions.length) return null
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute("waterDepth", new THREE.Float32BufferAttribute(depths, 1))
  g.computeBoundingSphere()
  return g
}
