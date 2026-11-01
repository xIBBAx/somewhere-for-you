import * as THREE from "three"
import { EARTH_SCALE } from "../scale"

/**
 * The ground of another world, for walking on it: one height function
 * evaluated identically here (physics: feet, hooves, landing) and on the GPU
 * (realmGlsl.ts, the terrain you see), so the two always agree.
 *
 *   real elevation   LRO LOLA for the Moon, MGS MOLA for Mars (1/4°),
 *                    shrunk with everything else (1:63.71)
 *   craters          six size classes from 115 m down to 12 cm, a simple
 *                    bowl with a raised rim and an ejecta apron, laid on a
 *                    cube-sphere grid fixed to the body (so they are always
 *                    in the same place)
 *   regolith         gentle undulation of the dusty surface
 *
 * Every world has its own character from a few numbers (RealmLook).
 */

export type RealmLook = {
  /** elevation grid name in public/assets/celestial/<name>_elevation.bin */
  elevation: "moon" | "mars" | null
  /** crater abundance 0…1 (fresh, airless worlds are saturated) */
  craters: number
  /** crater depth relative to diameter (simple craters ~0.2) */
  depth: number
  /** gentle hills where there is no elevation data (metres) */
  hills: number
  /** surface gravity, m/s² */
  gravity: number
}

export const REALM_LOOKS: Record<string, RealmLook> = {
  moon: { elevation: "moon", craters: 1, depth: 0.2, hills: 0, gravity: 1.62 },
  mars: { elevation: "mars", craters: 0.45, depth: 0.12, hills: 0, gravity: 3.71 },
  mercury: { elevation: null, craters: 1, depth: 0.2, hills: 22, gravity: 3.7 },
  io: { elevation: null, craters: 0.05, depth: 0.1, hills: 35, gravity: 1.8 },
  europa: { elevation: null, craters: 0.12, depth: 0.08, hills: 6, gravity: 1.31 },
  ganymede: { elevation: null, craters: 0.6, depth: 0.15, hills: 14, gravity: 1.43 },
  callisto: { elevation: null, craters: 1, depth: 0.18, hills: 12, gravity: 1.24 },
  titan: { elevation: null, craters: 0.05, depth: 0.08, hills: 28, gravity: 1.35 },
  enceladus: { elevation: null, craters: 0.5, depth: 0.15, hills: 4, gravity: 0.113 },
  triton: { elevation: null, craters: 0.15, depth: 0.1, hills: 10, gravity: 0.779 },
  pluto: { elevation: null, craters: 0.35, depth: 0.12, hills: 40, gravity: 0.62 },
}

/** Crater size classes: grid cell size in metres (The explorer). */
export const CRATER_CELLS = [460, 150, 48, 15, 4.8, 1.5]

export type ElevationGrid = { data: Float32Array; w: number; h: number }

/** Load a packed elevation grid (asset-pipeline/celestial/build_elevation.py) in game metres, row 0 = 90° S. */
export const loadElevation = async (name: string): Promise<ElevationGrid> => {
  const buf = await (await fetch(`/assets/celestial/${name}_elevation.bin`)).arrayBuffer()
  const src = new Uint16Array(buf)
  const w = 1440, h = 720
  const data = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // the file runs north to south; flip so row 0 is the south pole (texture v = 0)
    const m = src[(h - 1 - y) * w + x] * 0.5 - 10000
    // quantised exactly as the GPU's half-float texture holds it
    data[y * w + x] = THREE.DataUtils.fromHalfFloat(THREE.DataUtils.toHalfFloat(m / EARTH_SCALE))
  }
  return { data, w, h }
}

/** Bilinear sample at equirectangular uv (u wraps; v = 0 south). Matches GPU linear filtering. */
export const sampleElevation = (g: ElevationGrid, u: number, v: number): number => {
  const x = u * g.w - 0.5, y = Math.min(Math.max(v * g.h - 0.5, 0), g.h - 1)
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const fx = x - x0, fy = y - y0
  const xa = ((x0 % g.w) + g.w) % g.w, xb = (xa + 1) % g.w
  const ya = y0, yb = Math.min(y0 + 1, g.h - 1)
  const d = g.data
  const a = d[ya * g.w + xa] + (d[ya * g.w + xb] - d[ya * g.w + xa]) * fx
  const b = d[yb * g.w + xa] + (d[yb * g.w + xb] - d[yb * g.w + xa]) * fx
  return a + (b - a) * fy
}

// ---- hashing, identical to the GLSL (uint arithmetic) ----------------------
const hashU = (x: number, y: number, z: number): number => {
  let h = Math.imul((x | 0) ^ 0x27d4eb2d, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15) ^ (y | 0), 0x27d4eb2d)
  h = Math.imul(h ^ (h >>> 13) ^ (z | 0), 0x165667b1)
  h ^= h >>> 16
  return h >>> 0
}
const unit = (h: number, shift: number): number => ((h >>> shift) & 1023) / 1023

/** Cube-sphere face and planar coordinates (metres) of a unit direction. */
const faceCoords = (d: THREE.Vector3, radius: number, out: { face: number; u: number; v: number }): void => {
  const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z)
  if (ax >= ay && ax >= az) { out.face = d.x > 0 ? 0 : 1; out.u = d.y / ax; out.v = d.z / ax }
  else if (ay >= az) { out.face = d.y > 0 ? 2 : 3; out.u = d.x / ay; out.v = d.z / ay }
  else { out.face = d.z > 0 ? 4 : 5; out.u = d.x / az; out.v = d.y / az }
  out.u *= radius; out.v *= radius
}

/** A simple crater: bowl, raised rim, ejecta apron. x = distance / radius. */
export const craterProfile = (x: number, depth: number, rim: number): number => {
  if (x < 1) return -depth + (depth + rim) * x * x
  if (x < 2.6) {
    const t = (x - 1) / 1.6
    return rim * (1 - t) * (1 - t) * (1 - t) * Math.exp(-t)
  }
  return 0
}

const _fc = { face: 0, u: 0, v: 0 }

/** The crater field at a body-fixed unit direction (metres, the explorer). */
export const craterHeight = (dir: THREE.Vector3, radius: number, look: RealmLook): number => {
  if (look.craters <= 0) return 0
  faceCoords(dir, radius, _fc)
  let h = 0
  for (let k = 0; k < CRATER_CELLS.length; k++) {
    const s = CRATER_CELLS[k]
    const cx = Math.floor(_fc.u / s), cy = Math.floor(_fc.v / s)
    // the largest classes look into neighbouring cells too (their aprons are wide)
    const reach = k < 2 ? 1 : 0
    for (let oy = -reach; oy <= reach; oy++) for (let ox = -reach; ox <= reach; ox++) {
      const hh = hashU(cx + ox + _fc.face * 7919, cy + oy, k * 131 + 17)
      if (unit(hh, 0) > look.craters * 0.62) continue
      const r = s * (0.12 + 0.26 * unit(hh, 10))
      const px = (cx + ox + 0.3 + 0.4 * unit(hh, 20)) * s
      const py = (cy + oy + 0.3 + 0.4 * unit(hh, 5)) * s
      const d = Math.hypot(_fc.u - px, _fc.v - py)
      if (d > r * 2.6) continue
      // older craters are softened
      const fresh = 0.45 + 0.55 * unit(hh, 15)
      h += craterProfile(d / r, 2 * r * look.depth * fresh, 2 * r * 0.045 * fresh)
    }
  }
  return h
}

/** Cheap smooth noise for regolith undulation and hills (3D value noise). */
export const valueNoise = (x: number, y: number, z: number): number => {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
  const fx = x - ix, fy = y - iy, fz = z - iz
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz)
  const n = (a: number, b: number, c: number): number => (hashU(ix + a, iy + b, iz + c) & 65535) / 65535
  const x00 = n(0, 0, 0) + (n(1, 0, 0) - n(0, 0, 0)) * sx
  const x10 = n(0, 1, 0) + (n(1, 1, 0) - n(0, 1, 0)) * sx
  const x01 = n(0, 0, 1) + (n(1, 0, 1) - n(0, 0, 1)) * sx
  const x11 = n(0, 1, 1) + (n(1, 1, 1) - n(0, 1, 1)) * sx
  const y0 = x00 + (x10 - x00) * sy, y1 = x01 + (x11 - x01) * sy
  return y0 + (y1 - y0) * sz
}

/** A patch of ground kept clear of the procedural craters (a historic site): body-fixed direction and radius (m). */
export type CalmSpot = { dir: THREE.Vector3; r: number }
/** At most this many calm spots (the GPU holds them in a fixed array). */
export const CALM_MAX = 12

/** 1 out in the crater field … 0 inside a calm spot (smooth edge out to 2.2 × its radius). */
export const calmFactor = (dir: THREE.Vector3, radius: number, calm: readonly CalmSpot[]): number => {
  let f = 1
  for (let i = 0; i < calm.length && i < CALM_MAX; i++) {
    const c = calm[i]
    const arc = Math.acos(Math.max(-1, Math.min(1, dir.dot(c.dir)))) * radius
    const t = Math.max(0, Math.min(1, (arc - c.r) / (c.r * 1.2)))
    f = Math.min(f, t * t * (3 - 2 * t))
  }
  return f
}

/** Height over the body's mean radius at a body-fixed unit direction (metres, the explorer). */
export const surfaceHeight = (dir: THREE.Vector3, radius: number, look: RealmLook, grid: ElevationGrid | null, calm: readonly CalmSpot[] = []): number => {
  let h = 0
  if (grid) {
    const lon = Math.atan2(dir.y, dir.x), lat = Math.asin(Math.max(-1, Math.min(1, dir.z)))
    h += sampleElevation(grid, lon / (2 * Math.PI) + 0.5, lat / Math.PI + 0.5)
  }
  if (look.hills > 0) {
    const p = dir.clone().multiplyScalar(radius / 900)
    h += (valueNoise(p.x, p.y, p.z) - 0.5) * look.hills * 2 + (valueNoise(p.x * 3.1, p.y * 3.1, p.z * 3.1) - 0.5) * look.hills * 0.5
  }
  if (look.craters > 0) h += craterHeight(dir, radius, look) * (calm.length ? calmFactor(dir, radius, calm) : 1)
  // dusty regolith: soft undulation over a few metres
  const q = dir.clone().multiplyScalar(radius / 3.5)
  h += (valueNoise(q.x, q.y, q.z) - 0.5) * 0.16
  return h
}
