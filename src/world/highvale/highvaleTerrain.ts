import { makeSimplex } from "../noise"
import { WORLD_SEED } from "../worldConfig"
import { highvaleMaps } from "./highvaleData"
import {
  COARSE_HALF, COARSE_N, CORE_HALF, CORE_N, HEIGHT_BASE, HEIGHT_SPAN, LOOK_N, HIGHVALE_CENTER, highvaleWeight,
} from "./highvaleLayout"
import { HIGHVALE_PADS, HIGHVALE_PATHS, type HighvalePath } from "./highvale.layout"

/**
 * Highvale's ground: the baked maps sampled bicubically (the 2.5 m map under
 * the walkable valley, the 8 m one over the whole massif), a fine relief the
 * maps are too coarse to hold, then the trails and the levelled pads the
 * village, the temple and the meadow stand on (planned offline over the
 * same maps, generated offline).
 *
 * Deterministic and worker-safe once the maps are in; null before.
 */
const nFine = makeSimplex(WORLD_SEED ^ 0x3a4a11)
const Q = HEIGHT_SPAN / 65535

const cubic = (a: number, b: number, c: number, d: number, t: number): number =>
  b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)))

/** Catmull-Rom sample of a u16 height grid at fractional cell (fx, fy). */
const bicubic = (g: Uint16Array, n: number, fx: number, fy: number): number => {
  const ix = Math.floor(fx), iy = Math.floor(fy)
  const u = fx - ix, v = fy - iy
  const row = (j: number): number => {
    const y = Math.min(n - 1, Math.max(0, iy + j)) * n
    const at = (i: number): number => g[y + Math.min(n - 1, Math.max(0, ix + i))]
    return cubic(at(-1), at(0), at(1), at(2), u)
  }
  return cubic(row(-1), row(0), row(1), row(2), v) * Q + HEIGHT_BASE
}

/** The baked ground (no trails or pads) at local (e, n). */
export const bakedHeight = (e: number, n: number): number | null => {
  const maps = highvaleMaps.data
  if (!maps) return null
  const ce = CORE_HALF - 4
  if (Math.abs(e) < ce && Math.abs(n) < ce) {
    const s = (2 * CORE_HALF) / CORE_N
    return bicubic(maps.core, CORE_N, (e + CORE_HALF) / s - 0.5, (CORE_HALF - n) / s - 0.5)
  }
  const s = (2 * COARSE_HALF) / COARSE_N
  return bicubic(maps.coarse, COARSE_N, (e + COARSE_HALF) / s - 0.5, (COARSE_HALF - n) / s - 0.5)
}

/** Forest density (0..1) and gully wetness (0..1) at local (e, n). */
export const highvaleLook = (e: number, n: number, out: [number, number]): [number, number] => {
  const maps = highvaleMaps.data
  if (!maps) { out[0] = 0; out[1] = 0; return out }
  const s = (2 * COARSE_HALF) / LOOK_N
  const fx = Math.min(LOOK_N - 1.001, Math.max(0, (e + COARSE_HALF) / s - 0.5))
  const fy = Math.min(LOOK_N - 1.001, Math.max(0, (COARSE_HALF - n) / s - 0.5))
  const ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy
  const L = maps.look
  for (let c = 0; c < 2; c++) {
    const i = (iy * LOOK_N + ix) * 2 + c
    const a = L[i], b = L[i + 2], d = L[i + LOOK_N * 2], f = L[i + LOOK_N * 2 + 2]
    out[c] = ((a * (1 - u) + b * u) * (1 - v) + (d * (1 - u) + f * u) * v) / 255
  }
  return out
}

// --- trails --------------------------------------------------------------
type Seg = { ax: number; ay: number; bx: number; by: number; la: number; lb: number; hw: number; len2: number; path: HighvalePath }
const BIN = 48
const bins = new Map<number, Seg[]>()
const binKey = (i: number, j: number): number => (i + 4096) * 8192 + (j + 4096)
for (const path of HIGHVALE_PATHS) {
  const p = path.points
  for (let k = 0; k + 5 < p.length; k += 3) {
    const seg: Seg = {
      ax: p[k], ay: p[k + 1], la: p[k + 2], bx: p[k + 3], by: p[k + 4], lb: p[k + 5], hw: path.halfWidth,
      len2: (p[k + 3] - p[k]) ** 2 + (p[k + 4] - p[k + 1]) ** 2, path,
    }
    const r = path.halfWidth + 4
    const i0 = Math.floor((Math.min(seg.ax, seg.bx) - r) / BIN), i1 = Math.floor((Math.max(seg.ax, seg.bx) + r) / BIN)
    const j0 = Math.floor((Math.min(seg.ay, seg.by) - r) / BIN), j1 = Math.floor((Math.max(seg.ay, seg.by) + r) / BIN)
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const key = binKey(i, j)
      const list = bins.get(key)
      if (list) list.push(seg)
      else bins.set(key, [seg])
    }
  }
}

export type TrailHit = { dist: number; level: number; halfWidth: number; paved: boolean }
const hit: TrailHit = { dist: Infinity, level: 0, halfWidth: 0, paved: false }

/** The nearest trail to local (e, n), within a few metres; null if none. */
export const trailAt = (e: number, n: number): TrailHit | null => {
  const list = bins.get(binKey(Math.floor(e / BIN), Math.floor(n / BIN)))
  if (!list) return null
  let best = Infinity
  for (const s of list) {
    const vx = s.bx - s.ax, vy = s.by - s.ay
    const t = s.len2 > 0 ? Math.min(1, Math.max(0, ((e - s.ax) * vx + (n - s.ay) * vy) / s.len2)) : 0
    const d = Math.hypot(e - s.ax - vx * t, n - s.ay - vy * t) - s.hw
    if (d < best) {
      best = d
      hit.dist = d
      hit.level = s.la + (s.lb - s.la) * t
      hit.halfWidth = s.hw
      hit.paved = s.path.paved
    }
  }
  return best < 4 ? hit : null
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** 0..1: how flat-laid the ground is here (pads and trails), for scatter and relief. */
export const highvaleLaid = (e: number, n: number): number => {
  let w = 0
  for (const p of HIGHVALE_PADS) {
    const d = Math.hypot((e - p.e) / p.re, (n - p.n) / p.rn)
    if (d < 1.4) w = Math.max(w, 1 - smooth(0.85, 1.25, d))
  }
  const t = trailAt(e, n)
  if (t) w = Math.max(w, 1 - smooth(0, 2.2, t.dist))
  return w
}

/** Highvale's ground height at world (x, z), or null where it is not Highvale or the maps are not in. */
export const highvaleHeightAt = (x: number, z: number): number | null => {
  if (!highvaleMaps.data) return null
  const e = x - HIGHVALE_CENTER.x
  const n = HIGHVALE_CENTER.z - z
  if (highvaleWeight(x, z) <= 0) return null
  let h = bakedHeight(e, n)!
  // a fine relief the 2.5 m map cannot hold: tussocks, hummocks, small steps
  h += nFine(e / 7.3, n / 7.3) * 0.16 + nFine(e / 2.1 + 31, n / 2.1 - 7) * 0.05
  // levelled pads: house platforms, the temple's courtyard, the meadow
  for (const p of HIGHVALE_PADS) {
    const d = Math.hypot((e - p.e) / p.re, (n - p.n) / p.rn)
    if (d < 1.4) h += (p.level - h) * (1 - smooth(0.85, 1.35, d)) * p.strength
  }
  // trails: a bench cut into the slope, its cut and fill banks blended in
  const t = trailAt(e, n)
  if (t) h += (t.level - h) * (1 - smooth(0, 2.6, t.dist))
  return h
}
