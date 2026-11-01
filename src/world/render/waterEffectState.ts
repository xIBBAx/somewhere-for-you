import type { Matrix4 } from "three"

export type WaterSplash = { x: number; y: number; z: number; strength: number }

/** Capture the contact surface before another body update or queued effect can
 * change it. A dry target has no water contact to render. */
export const captureWaterSplash = (
  x: number, z: number, strength: number,
  surfaceAt: (x: number, z: number) => number | null,
): WaterSplash | null => {
  const y = surfaceAt(x, z)
  return y === null ? null : { x, y, z, strength }
}

/** Keep logical positions in float64 until after origin subtraction. Packing
 * absolute coordinates first loses small waves and droplet motion far away. */
export const writeWaterRingMatrix = (out: Matrix4, positions: Float64Array, slot: number, originX: number, originZ: number): void => {
  const o = slot * 3
  out.makeTranslation(positions[o] - originX, positions[o + 1], positions[o + 2] - originZ)
}

export const writeWaterDropPositions = (positions: Float64Array, rendered: Float32Array, originX: number, originZ: number): void => {
  for (let o = 0; o < positions.length; o += 3) {
    rendered[o] = positions[o] - originX
    rendered[o + 1] = positions[o + 1]
    rendered[o + 2] = positions[o + 2] - originZ
  }
}
