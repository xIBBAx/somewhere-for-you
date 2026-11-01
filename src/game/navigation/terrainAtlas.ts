import { biomeWeights, BIOME_COUNT, lakeMask, WATER_LEVEL } from "../../world/climate"
import { worldHeight } from "../../world/terrain"
import { POND, RIVER_MIN_X, RIVER_MAX_X, riverCenterZ, riverHalfWidthAt } from "../../world/hubLayout"

export type AtlasRequest = { id: number; x: number; z: number; range: number; size: number }
export type AtlasRaster = AtlasRequest & { pixels: Uint8ClampedArray; ink: Uint8ClampedArray }
const COLORS = [[144, 166, 116], [169, 171, 124], [75, 112, 84], [176, 147, 142], [157, 125, 86], [75, 107, 99], [131, 155, 137], [158, 168, 127]]
export const atlasWaterAt = (x: number, z: number, height = worldHeight(x, z)): boolean =>
  Math.hypot(x - POND.x, z - POND.z) < POND.r ||
  (x > RIVER_MIN_X && x < RIVER_MAX_X && Math.abs(z - riverCenterZ(x)) < riverHalfWidthAt(x)) ||
  (lakeMask(x, z) > 0 && height < WATER_LEVEL)

/** Same authoritative functions as chunk generation, off the render thread.
 * One padded height field gives hillshade without three terrain evaluations
 * per pixel; no decorative terrain or independent random geography. */
export const rasterTerrain = (request: AtlasRequest): AtlasRaster => {
  const { x, z, range, size } = request, n = size + 2, step = range * 2 / size
  const heights = new Float32Array(n * n), weights = new Float32Array(BIOME_COUNT)
  const pixels = new Uint8ClampedArray(size * size * 4), ink = new Uint8ClampedArray(size * size * 4)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = worldHeight(x + (i - 0.5 - size / 2) * step, z + (j - 0.5 - size / 2) * step)
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const wx = x + (i + 0.5 - size / 2) * step, wz = z + (j + 0.5 - size / 2) * step
    const k = (j + 1) * n + i + 1, h = heights[k], p = (j * size + i) * 4
    if (atlasWaterAt(wx, wz, h)) {
      ink[p] = 127; ink[p + 1] = 210; ink[p + 2] = 221; ink[p + 3] = 115
      pixels[p] = 84; pixels[p + 1] = 143; pixels[p + 2] = 157
    } else {
      biomeWeights(wx, wz, weights)
      const dx = (heights[k + 1] - heights[k - 1]) / (2 * step), dz = (heights[k + n] - heights[k - n]) / (2 * step)
      const shade = Math.min(1.18, Math.max(0.66, 0.95 + (-dx - dz) * 0.22))
      const edge = Math.floor(h / 5) !== Math.floor(heights[k + 1] / 5) || Math.floor(h / 5) !== Math.floor(heights[k + n] / 5)
      ink[p] = 216; ink[p + 1] = 228; ink[p + 2] = 209; ink[p + 3] = edge ? 148 : 25 + Math.round(Math.min(30, Math.hypot(dx, dz) * 28))
      const contour = Math.abs(h / 5 - Math.round(h / 5)) < Math.min(0.07, step * 0.012) ? 0.9 : 1
      for (let c = 0; c < 3; c++) {
        let color = 0
        for (let b = 0; b < BIOME_COUNT; b++) color += COLORS[b][c] * weights[b]
        pixels[p + c] = color * shade * contour
      }
    }
    pixels[p + 3] = 255
  }
  return { ...request, pixels, ink }
}
