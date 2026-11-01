/**
 * Highvale: a high mountain valley about 24 km north of home, with a
 * village, a river running down to a lake and snow peaks around it. Its
 * landform was designed and then eroded by simulated droplets offline; the
 * baked height maps live in public/assets/highvale/.
 *
 * The valley's own frame: `e` metres east and `n` metres north of the
 * centre. The river runs north to south down it. Its shape is baked offline,
 * and the river functions here mirror the baking script exactly.
 *
 * Pure math and static data: worker-safe, no imports from rendering.
 */
export const HIGHVALE_CENTER = { x: 6060, z: -23150 } as const

/** Half the side of the coarse height map (m) and its resolution. */
export const COARSE_HALF = 8192
export const COARSE_N = 2048
/** Half the side of the fine map under the walkable valley. */
export const CORE_HALF = 1280
export const CORE_N = 1024
export const LOOK_N = 1024
/** Baked heights: h = v / 65535 * SPAN + BASE. */
export const HEIGHT_BASE = -60
export const HEIGHT_SPAN = 1900

/** Where the massif hands over to the game's own wild terrain (ellipse radius, m). */
export const BLEND_FROM = 7450
export const BLEND_TO = 8050

/** Where travel to Highvale sets you down: the village square (highvale.layout.ts HIGHVALE_SQUARE). */
export const HIGHVALE_ARRIVAL = { x: HIGHVALE_CENTER.x - 50.82, z: HIGHVALE_CENTER.z - 230 } as const

export const toLocal = (x: number, z: number): [number, number] => [x - HIGHVALE_CENTER.x, HIGHVALE_CENTER.z - z]
export const toWorld = (e: number, n: number): [number, number] => [HIGHVALE_CENTER.x + e, HIGHVALE_CENTER.z - n]

/** Elliptical distance used by the bake for the massif's extent. */
export const massifRadius = (e: number, n: number): number => Math.hypot(e * 0.95, n - 300)

/** How much of a world point belongs to the Highvale massif (0 outside). */
export const highvaleWeight = (x: number, z: number): number => {
  const e = x - HIGHVALE_CENTER.x
  const n = HIGHVALE_CENTER.z - z
  if (Math.abs(e) > COARSE_HALF || Math.abs(n) > COARSE_HALF) return 0
  const r = massifRadius(e, n)
  if (r >= BLEND_TO) return 0
  if (r <= BLEND_FROM) return 1
  const t = (r - BLEND_FROM) / (BLEND_TO - BLEND_FROM)
  return 1 - t * t * (3 - 2 * t)
}

/** True if any part of the axis-aligned world rectangle may touch the massif. */
export const rectTouchesHighvale = (x0: number, z0: number, x1: number, z1: number): boolean => {
  const e0 = x0 - HIGHVALE_CENTER.x, e1 = x1 - HIGHVALE_CENTER.x
  const n0 = HIGHVALE_CENTER.z - z1, n1 = HIGHVALE_CENTER.z - z0
  const ce = Math.max(e0, Math.min(0, e1)), cn = Math.max(n0, Math.min(300, n1))
  return massifRadius(ce, cn) < BLEND_TO + 40
}

// --- the river (mirrors bake_terrain.py) ------------------------------------
/** East offset (m) of the river's centre line at northing n. */
export const riverE = (n: number): number => 70 * Math.sin(n / 820 + 0.4) + 28 * Math.sin(n / 310 + 1.3) - 20
/** Bank height at northing n: the valley floor climbs ~1% up the valley. */
export const floorH = (n: number): number => (n > -5600 ? 22 + 0.0105 * (n + 5600) : 22 + (n + 5600) * 0.06)
/** River surface: a little under the bank. */
export const riverLevel = (n: number): number => floorH(n) - 1.25
/** The carved channel's width parameter (m), as in the bake. */
export const riverWidth = (n: number): number => 15 + 6 * Math.sin(n / 430) + 8 * smooth01((n - 3000) / 2600)
/** The river runs from the head of the valley to the lake at its foot. */
export const RIVER_N0 = -5700
export const RIVER_N1 = 6900
export const LAKE_N = -6150

function smooth01(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}

/** 0..1: the lake basin at the valley's foot (the only standing water in the massif). */
export const highvaleLakeMask = (x: number, z: number): number => {
  const e = x - HIGHVALE_CENTER.x
  const n = HIGHVALE_CENTER.z - z
  const d = Math.hypot((e - riverE(LAKE_N)) / 1.35, n - LAKE_N)
  if (d >= 940) return 0
  return 1 - smooth01((d - 780) / 160)
}
