import { highvaleMaps } from "./highvaleData"
import { COARSE_HALF, COARSE_N, HEIGHT_BASE, HEIGHT_SPAN, HIGHVALE_CENTER, highvaleWeight } from "./highvaleLayout"

/**
 * The sky over the mountains, in two parts.
 *
 * The explorer-scale sky is the real one shrunk 63.7 times (cumulus at ~36 m, the
 * sails at 950 m), while hills and mountains stay nearly life-size, so
 * Highvale's peaks (1,500 m here) would stand in the thinning air where Starborn
 * spreads her sails, and a walker on the valley floor would see the sky of
 * someone flying. Over the massif, then:
 *
 *  - the weather (clouds, rain, the storm's dark) is measured from the
 *    mountains' broad mean surface (`cloudLift`, their heights averaged over
 *    a kilometre or so): the deck hangs low in the valley with the peaks
 *    standing up through it, and does not leap as you fly over a ridge;
 *  - the air itself (its thinning toward space, the aerial haze, the horizon
 *    handing over to Earth's face, Starborn's sail) is measured from the ridge
 *    tops round about (`skyLift`, a smoothed envelope of the highest ground
 *    within ~1.3 km): inside the valley the sky is an ordinary sky, and it
 *    darkens toward space only once you climb above the mountains.
 */
const N = 128
const CELL = (2 * COARSE_HALF) / N
let mean: Float32Array | null = null
let ridge: Float32Array | null = null

const blur = (src: Float32Array, dx: number, dy: number, R: number, sigma: number): Float32Array => {
  const out = new Float32Array(N * N)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let s = 0, w = 0
    for (let k = -R; k <= R; k++) {
      const x = Math.min(N - 1, Math.max(0, i + k * dx)), y = Math.min(N - 1, Math.max(0, j + k * dy))
      const g = Math.exp(-(k * k) / (2 * sigma * sigma))
      s += src[y * N + x] * g
      w += g
    }
    out[j * N + i] = s / w
  }
  return out
}

const dilate = (src: Float32Array, dx: number, dy: number, R: number): Float32Array => {
  const out = new Float32Array(N * N)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let m = -Infinity
    for (let k = -R; k <= R; k++) {
      const x = Math.min(N - 1, Math.max(0, i + k * dx)), y = Math.min(N - 1, Math.max(0, j + k * dy))
      m = Math.max(m, src[y * N + x])
    }
    out[j * N + i] = m
  }
  return out
}

const build = (): boolean => {
  const maps = highvaleMaps.data
  if (!maps) return false
  const step = COARSE_N / N
  const q = HEIGHT_SPAN / 65535
  const raw = new Float32Array(N * N)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let s = 0
    for (let y = 0; y < step; y += 2) for (let x = 0; x < step; x += 2) s += maps.coarse[(j * step + y) * COARSE_N + i * step + x]
    raw[j * N + i] = (s / ((step / 2) * (step / 2))) * q + HEIGHT_BASE
  }
  mean = blur(blur(raw, 1, 0, 5, 2.6), 0, 1, 5, 2.6)
  // ~1.3 km of the highest ground (10 cells), then softened so it has no edges
  ridge = blur(blur(dilate(dilate(raw, 1, 0, 10), 0, 1, 10), 1, 0, 8, 4), 0, 1, 8, 4)
  return true
}

const sample = (grid: Float32Array, x: number, z: number): number => {
  const fx = Math.min(N - 1.001, Math.max(0, (x - HIGHVALE_CENTER.x + COARSE_HALF) / CELL - 0.5))
  const fy = Math.min(N - 1.001, Math.max(0, (COARSE_HALF - (HIGHVALE_CENTER.z - z)) / CELL - 0.5))
  const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j
  const a = grid[j * N + i], b = grid[j * N + i + 1], c = grid[(j + 1) * N + i], d = grid[(j + 1) * N + i + 1]
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

const ready = (): boolean => !!mean || build()

/** How far (m) the air is lifted over the massif at world (x, z): its ridge tops. 0 elsewhere. */
export const skyLift = (x: number, z: number): number => {
  if (!highvaleMaps.data) return 0
  const w = highvaleWeight(x, z)
  if (w <= 0 || !ready()) return 0
  return Math.max(0, sample(ridge!, x, z) * 0.92) * w
}

/** How far (m) the weather is lifted over the massif: its broad mean surface. 0 elsewhere. */
export const cloudLift = (x: number, z: number): number => {
  if (!highvaleMaps.data) return 0
  const w = highvaleWeight(x, z)
  if (w <= 0 || !ready()) return 0
  return Math.max(0, sample(mean!, x, z) * 0.85) * w
}
