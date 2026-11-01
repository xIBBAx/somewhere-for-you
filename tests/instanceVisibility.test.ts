import { describe, expect, it } from "vitest"
import { Frustum, Matrix4, PerspectiveCamera, Sphere, Vector3 } from "three"
import { compactVisibleInstances, writeInstanceBounds } from "../src/world/render/instanceVisibility"

const frustum = (x: number) => {
  const camera = new PerspectiveCamera(50, 1, .1, 100)
  camera.position.x = x
  camera.updateMatrixWorld()
  return new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
}

describe("vegetation visibility compaction", () => {
  it("keeps visible geometry and offscreen shadow casters without changing source slots", () => {
    const matrices = new Float32Array(48), colors = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), bounds = new Float32Array(12)
    for (const [i, x] of [0, 20, 200].entries()) {
      const matrix = new Matrix4().makeTranslation(x, 0, -12)
      matrix.toArray(matrices, i * 16)
      writeInstanceBounds(bounds, i, new Sphere(new Vector3(), 1), matrix)
    }
    const original = matrices.slice(), drawMatrices = new Float32Array(48), drawColors = new Float32Array(9)
    expect(compactVisibleInstances(matrices, colors, bounds, 3, drawMatrices, drawColors, frustum(0), frustum(20))).toBe(2)
    expect([...drawColors.slice(0, 6)]).toEqual([1, 0, 0, 0, 1, 0])
    expect(matrices).toEqual(original)
    expect(compactVisibleInstances(matrices, colors, bounds, 3, drawMatrices, drawColors, frustum(200))).toBe(1)
    expect(drawMatrices[12]).toBe(200)
    expect([...drawColors.slice(0, 3)]).toEqual([0, 0, 1])
  })

  it("covers transformed canopy bounds, nonuniform scale and wind at the frustum edge", () => {
    const bounds = new Float32Array(4)
    const matrix = new Matrix4().makeScale(2, 3, 4).setPosition(5, 1, -8)
    writeInstanceBounds(bounds, 0, new Sphere(new Vector3(0, 2, 0), 2), matrix)
    expect([...bounds]).toEqual([5, 7, -8, 9.5])
  })
})
