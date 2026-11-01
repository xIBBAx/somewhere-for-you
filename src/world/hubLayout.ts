/**
 * Authored shape of the "home" region: its path, creek, pond and memory
 * clearings. Pure math with no THREE
 * dependency so the chunk worker can evaluate it.
 *
 * The home region sits inside an endless streamed landscape: its terrain
 * blends into the wild terrain around it.
 */

export const HUB_CENTER = { x: 0, z: -2 }
/** Radius of the authored home landscape. */
export const HUB_RADIUS = 34
/** Beyond this distance the authored terrain has fully handed over to the wilds. */
export const HUB_BLEND_INNER = 36
export const HUB_BLEND_OUTER = 64

export const RIVER_Z = -23.5
export const RIVER_HALF_WIDTH = 1.9
export const RIVER_MIN_X = -13.2
export const RIVER_MAX_X = 13.4
export const BRIDGE_HALF_WIDTH = 1.5
export const POND = { x: 9.2, z: 7.0, r: 2.8 }
export const WATER_Y = -0.34
/**
 * The giant water lily leaves on the pond: they crowd it edge to edge without
 * overlapping, each wholly over water. Swimmers keep off them.
 */
export const POND_LILY_PADS = [
  { x: 10.1, z: 7.6, r: 1.0 },
  { x: 8.1, z: 7.9, r: 0.9 },
  { x: 9.0, z: 5.65, r: 0.8 },
] as const
/** Moves a point on the pond out from under any lily leaf, `margin` clear of its rim. */
export const keepOffLilyPads = (p: { x: number; z: number }, margin: number): boolean => {
  let moved = false
  for (const pad of POND_LILY_PADS) {
    const dx = p.x - pad.x, dz = p.z - pad.z
    const d = Math.hypot(dx, dz), clear = pad.r + margin
    if (d >= clear) continue
    const ux = d > 1e-6 ? dx / d : 1, uz = d > 1e-6 ? dz / d : 0
    p.x = pad.x + ux * clear
    p.z = pad.z + uz * clear
    moved = true
  }
  return moved
}

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

export const riverCenterZ = (x: number): number =>
  RIVER_Z + x * 0.035 + Math.sin(x * 0.19) * 1.05 + Math.sin(x * 0.46) * 0.28

export const riverEnvelope = (x: number): number =>
  smoothstep(0, 3.2, Math.min(x - RIVER_MIN_X, RIVER_MAX_X - x))

export const riverHalfWidthAt = (x: number): number => RIVER_HALF_WIDTH * riverEnvelope(x)

export const PATH_WAYPOINTS: Array<[number, number]> = [
  [0, 24.5], [-1.5, 20.5], [-4.5, 17.5], [-7.2, 14.6], [-5.5, 11.2], [-1.5, 9.4], [3.4, 9.8],
  [6.2, 8.2], [4.6, 4.6], [0.2, 3.0], [-4.6, 2.6], [-8.4, 1.4], [-6.4, -2.4], [-2.2, -4.0],
  [2.4, -4.6], [-1.4, -7.0], [-5.6, -7.6], [-3.0, -10.6], [0.8, -12.2], [4.6, -12.6],
  [7.4, -14.6], [5.2, -17.2], [0.6, -17.8], [-3.0, -19.2], [-0.6, -20.6], [0, -26.5], [0, -29.5],
]

/**
 * Centripetal-free uniform Catmull-Rom (tension 0.5), matching
 * THREE.CatmullRomCurve3(..., "catmullrom", 0.5) closely enough for terrain.
 * Arc-length resampled into 221 points like the original PATH_POINTS.
 */
const buildPathPoints = (): Float64Array => {
  const pts = PATH_WAYPOINTS
  const dense: number[] = []
  const tension = 0.5
  const n = pts.length
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(n - 1, i + 2)]
    // THREE extrapolates the end points; mirror that behaviour.
    const q0 = i === 0 ? [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]] : p0
    const q3 = i + 2 >= n ? [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]] : p3
    for (let s = 0; s < 40; s++) {
      const t = s / 40
      const t2 = t * t
      const t3 = t2 * t
      for (let k = 0; k < 2; k++) {
        const v0 = q0[k], v1 = p1[k], v2 = p2[k], v3 = q3[k]
        const m1 = tension * (v2 - v0)
        const m2 = tension * (v3 - v1)
        dense.push((2 * t3 - 3 * t2 + 1) * v1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * v2 + (t3 - t2) * m2)
      }
    }
  }
  dense.push(pts[n - 1][0], pts[n - 1][1])
  // arc-length resample
  const count = dense.length / 2
  const cum = new Float64Array(count)
  for (let i = 1; i < count; i++) {
    cum[i] = cum[i - 1] + Math.hypot(dense[i * 2] - dense[i * 2 - 2], dense[i * 2 + 1] - dense[i * 2 - 1])
  }
  const total = cum[count - 1]
  const out = new Float64Array(221 * 2)
  let j = 0
  for (let i = 0; i <= 220; i++) {
    const target = (i / 220) * total
    while (j < count - 2 && cum[j + 1] < target) j++
    const seg = cum[j + 1] - cum[j] || 1
    const f = (target - cum[j]) / seg
    out[i * 2] = dense[j * 2] + (dense[j * 2 + 2] - dense[j * 2]) * f
    out[i * 2 + 1] = dense[j * 2 + 1] + (dense[j * 2 + 3] - dense[j * 2 + 1]) * f
  }
  return out
}

/** Flat [x0, z0, x1, z1, ...] samples along the memory path. */
export const PATH_XZ = buildPathPoints()

/** Approximate distance from (x,z) to the path centerline. */
export const distToPath = (x: number, z: number): number => {
  // Far from home there is no path; skip the 221-point scan.
  const hx = x - HUB_CENTER.x
  const hz = z - HUB_CENTER.z
  if (hx * hx + hz * hz > 46 * 46) return 99
  let min = Infinity
  for (let i = 0; i < PATH_XZ.length; i += 2) {
    const dx = PATH_XZ[i] - x
    const dz = PATH_XZ[i + 1] - z
    const d = dx * dx + dz * dz
    if (d < min) min = d
  }
  return Math.sqrt(min)
}

/** Areas keep a clearing free of trees so buildings never clip foliage. */
export const CLEARINGS: Array<{ x: number; z: number; r: number }> = [
  { x: 0, z: 22, r: 6.5 }, // beginning
  { x: -8.6, z: 13.6, r: 4.5 }, // verandah table
  { x: 6.8, z: 10.2, r: 4 }, // pond bench
  { x: -12.4, z: 3.2, r: 6 }, // studio
  { x: 12.4, z: 0.4, r: 5.2 }, // cat garden
  { x: -10.8, z: -7.6, r: 5 }, // training corner
  { x: 2.4, z: -10.8, r: 7 }, // corner café
  { x: 10.8, z: -15.6, r: 4 }, // rain spot
  { x: -4.4, z: -17.8, r: 4 }, // future bench
  { x: 0, z: -30.5, r: 9 }, // finale garden
  { x: 0, z: -23.5, r: 4 }, // bridge
  { x: 9.2, z: 7.0, r: 4 }, // pond
  { x: 0.8, z: 30.2, r: 5.2 }, // little fair
]

export const inClearing = (x: number, z: number): boolean => {
  for (const c of CLEARINGS) if ((x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r) return true
  return false
}

const riverDepthMask = (x: number, z: number): number => {
  const envelope = riverEnvelope(x)
  if (envelope <= 0) return 0
  const rd = Math.abs(z - riverCenterZ(x))
  const halfWidth = riverHalfWidthAt(x)
  return (1 - smoothstep(halfWidth, halfWidth + 1.15, rd)) * envelope
}

const pondDepthMask = (x: number, z: number): number => {
  const d = Math.hypot(x - POND.x, z - POND.z)
  return 1 - smoothstep(POND.r - 0.4, POND.r + 1.4, d)
}

/** The authored home terrain. */
export const hubHeight = (x: number, z: number): number => {
  const base = 0.26 * Math.sin(x * 0.14 + 1.3) * Math.cos(z * 0.11) + 0.16 * Math.sin(z * 0.17 + x * 0.05)
  const pathMask = smoothstep(2.0, 5.2, distToPath(x, z))
  const gardenMask = smoothstep(7, 11, Math.hypot(x, z + 30.5))
  let h = base * Math.min(pathMask, gardenMask)
  h -= 1.0 * riverDepthMask(x, z)
  h -= 0.9 * pondDepthMask(x, z)
  return h
}

/** 1 inside the authored home region, 0 in the wilds. */
export const hubWeight = (x: number, z: number): number => {
  const d = Math.hypot(x - HUB_CENTER.x, z - HUB_CENTER.z)
  return 1 - smoothstep(HUB_BLEND_INNER, HUB_BLEND_OUTER, d)
}

export const distToHub = (x: number, z: number): number => Math.hypot(x - HUB_CENTER.x, z - HUB_CENTER.z)
