import { Frustum, Matrix4, Sphere } from "three"

const transformed = new Sphere()

/** Include wind sway and a small camera-motion margin around the real mesh. */
export const writeInstanceBounds = (out: Float32Array, index: number, geometry: Sphere, matrix: Matrix4): void => {
  transformed.copy(geometry).applyMatrix4(matrix)
  const offset = index * 4
  out[offset] = transformed.center.x
  out[offset + 1] = transformed.center.y
  out[offset + 2] = transformed.center.z
  out[offset + 3] = transformed.radius + 1.5
}

/** Compact GPU draw buffers, preserving canonical slots and offscreen shadows. */
export const compactVisibleInstances = (
  matrices: Float32Array, colors: Float32Array, bounds: Float32Array, count: number,
  targetMatrices: Float32Array, targetColors: Float32Array, view: Frustum, shadow?: Frustum,
): number => {
  let visible = 0
  for (let index = 0; index < count; index++) {
    transformed.center.fromArray(bounds, index * 4)
    transformed.radius = bounds[index * 4 + 3]
    if (!view.intersectsSphere(transformed) && !shadow?.intersectsSphere(transformed)) continue
    // This runs while the camera moves: avoid thousands of temporary typed
    // array views per frame, which otherwise introduce garbage-collection stalls.
    for (let element = 0; element < 16; element++) targetMatrices[visible * 16 + element] = matrices[index * 16 + element]
    for (let channel = 0; channel < 3; channel++) targetColors[visible * 3 + channel] = colors[index * 3 + channel]
    visible++
  }
  return visible
}
