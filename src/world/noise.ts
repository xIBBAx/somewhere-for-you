/**
 * Deterministic, allocation-free noise for the streamed world.
 *
 * Everything here is pure and worker-safe: the chunk worker and the main
 * thread evaluate exactly the same functions, so collision heights, rendered
 * terrain and scatter placement can never disagree. Never use Math.random()
 * for anything that must persist when a location is revisited.
 */

/** 32-bit integer avalanche hash (lowbias32). */
export const hash32 = (n: number): number => {
  let x = n | 0
  x ^= x >>> 16
  x = Math.imul(x, 0x7feb352d)
  x ^= x >>> 15
  x = Math.imul(x, 0x846ca68b)
  x ^= x >>> 16
  return x >>> 0
}

/** Stable hash of (seed, x, z) integer lattice coordinates. */
export const hash3 = (seed: number, x: number, z: number): number =>
  hash32(hash32(hash32(seed) ^ Math.imul(x | 0, 0x27d4eb2d)) ^ Math.imul(z | 0, 0x165667b1))

/** Hash to [0, 1). */
export const hash01 = (seed: number, x: number, z: number): number => hash3(seed, x, z) / 4294967296

/** Deterministic seeded RNG (mulberry32). */
export const rng = (seed: number): (() => number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- 2D simplex noise -------------------------------------------------------

const F2 = 0.5 * (Math.sqrt(3) - 1)
const G2 = (3 - Math.sqrt(3)) / 6
const GRAD = new Float32Array([
  1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1,
  0.7071, 0.7071, -0.7071, 0.7071, 0.7071, -0.7071, -0.7071, -0.7071,
])

export type Noise2 = (x: number, z: number) => number

/** Seeded 2D simplex noise in roughly [-1, 1]. */
export const makeSimplex = (seed: number): Noise2 => {
  const perm = new Uint8Array(512)
  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i
  const r = rng(seed)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    const t = p[i]
    p[i] = p[j]
    p[j] = t
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
  const gradIndex = new Uint8Array(512)
  for (let i = 0; i < 512; i++) gradIndex[i] = (perm[i] % 12) * 2

  return (xin: number, yin: number): number => {
    const s = (xin + yin) * F2
    const i = Math.floor(xin + s)
    const j = Math.floor(yin + s)
    const t = (i + j) * G2
    const x0 = xin - (i - t)
    const y0 = yin - (j - t)
    const i1 = x0 > y0 ? 1 : 0
    const j1 = x0 > y0 ? 0 : 1
    const x1 = x0 - i1 + G2
    const y1 = y0 - j1 + G2
    const x2 = x0 - 1 + 2 * G2
    const y2 = y0 - 1 + 2 * G2
    const ii = i & 255
    const jj = j & 255
    let n = 0
    let t0 = 0.5 - x0 * x0 - y0 * y0
    if (t0 > 0) {
      const g = gradIndex[ii + perm[jj]]
      t0 *= t0
      n += t0 * t0 * (GRAD[g] * x0 + GRAD[g + 1] * y0)
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1
    if (t1 > 0) {
      const g = gradIndex[ii + i1 + perm[jj + j1]]
      t1 *= t1
      n += t1 * t1 * (GRAD[g] * x1 + GRAD[g + 1] * y1)
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2
    if (t2 > 0) {
      const g = gradIndex[ii + 1 + perm[jj + 1]]
      t2 *= t2
      n += t2 * t2 * (GRAD[g] * x2 + GRAD[g + 1] * y2)
    }
    return 70 * n
  }
}

/** Fractal sum, normalised to roughly [-1, 1]. */
export const fbm = (
  noise: Noise2,
  x: number,
  z: number,
  octaves: number,
  lacunarity = 2.03,
  gain = 0.5,
): number => {
  let sum = 0
  let amp = 1
  let norm = 0
  let fx = x
  let fz = z
  for (let o = 0; o < octaves; o++) {
    sum += noise(fx, fz) * amp
    norm += amp
    amp *= gain
    // rotate slightly each octave to hide lattice alignment
    const nx = fx * 1.6 - fz * 1.2
    fz = fx * 1.2 + fz * 1.6
    fx = nx * (lacunarity / 2)
    fz *= lacunarity / 2
  }
  return sum / norm
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
export const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t
/** Polynomial smooth maximum (k = blend width). */
export const smax = (a: number, b: number, k: number): number => {
  const h = clamp01(0.5 + (0.5 * (a - b)) / k)
  return mix(b, a, h) + k * h * (1 - h)
}
export const smin = (a: number, b: number, k: number): number => -smax(-a, -b, k)
