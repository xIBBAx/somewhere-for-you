import { BUILDINGS, PATH_CURVE, groundHeight } from "../../world-layout"

/**
 * Where the Indian details of the home region sit: rangoli at the thresholds,
 * diyas along the path and round each rangoli, marigold torans on the
 * gateways. Plain data, so a test can check nothing lands on a path or wall.
 */
export type Spot = { x: number; z: number }

/** rangoli at the places people arrive: outer radius in metres */
export const RANGOLI: Array<Spot & { radius: number; seed: number }> = [
  { x: 2.6, z: 18.4, radius: 1.1, seed: 3 }, // the first steps out of home
  { x: BUILDINGS.cafe.x, z: BUILDINGS.cafe.z + 3.1, radius: 0.95, seed: 7 }, // the chai stall's door
  { x: BUILDINGS.studio.x + 2.6, z: BUILDINGS.studio.z + 0.4, radius: 0.85, seed: 11 }, // the studio
  { x: 0, z: -28.6, radius: 1.3, seed: 17 }, // just inside the finale garden's gate
]

const DIYAS_PER_RANGOLI = 8
/** t along the home path where a pair of diyas sits, one each side */
const PATH_DIYAS = Array.from({ length: 26 }, (_, i) => 0.03 + i * 0.037)

/** Every diya in the home region. */
export const diyaSpots = (): Array<Spot & { y: number }> => {
  const out: Array<Spot & { y: number }> = []
  for (const r of RANGOLI) {
    for (let i = 0; i < DIYAS_PER_RANGOLI; i++) {
      const a = (i / DIYAS_PER_RANGOLI) * Math.PI * 2 + r.seed
      const x = r.x + Math.cos(a) * (r.radius + 0.14)
      const z = r.z + Math.sin(a) * (r.radius + 0.14)
      out.push({ x, z, y: groundHeight(x, z) })
    }
  }
  for (const t of PATH_DIYAS) {
    const p = PATH_CURVE.getPointAt(Math.min(0.99, t))
    const tan = PATH_CURVE.getTangentAt(Math.min(0.99, t)).normalize()
    for (const side of [1, -1]) {
      const x = p.x - tan.z * side * 1.5
      const z = p.z + tan.x * side * 1.5
      out.push({ x, z, y: groundHeight(x, z) })
    }
  }
  return out
}

export type Toran = { a: [number, number, number]; b: [number, number, number]; droop: number }

const { cafe, studio } = BUILDINGS

/** Marigold strings, end to end in world metres (y is above the ground at that end). */
export const TORANS: Toran[] = [
  // the finale garden's gate
  { a: [-1.9, 3.05, -26.5], b: [1.9, 3.05, -26.5], droop: 0.42 },
  // the chai stall's front, in three swags
  { a: [cafe.x - cafe.w / 2, 2.08, cafe.z + cafe.d / 2 + 1.12], b: [cafe.x - cafe.w / 6, 2.08, cafe.z + cafe.d / 2 + 1.12], droop: 0.3 },
  { a: [cafe.x - cafe.w / 6, 2.08, cafe.z + cafe.d / 2 + 1.12], b: [cafe.x + cafe.w / 6, 2.08, cafe.z + cafe.d / 2 + 1.12], droop: 0.3 },
  { a: [cafe.x + cafe.w / 6, 2.08, cafe.z + cafe.d / 2 + 1.12], b: [cafe.x + cafe.w / 2, 2.08, cafe.z + cafe.d / 2 + 1.12], droop: 0.3 },
  // the studio's open side
  { a: [studio.x + studio.w / 2, 2.3, studio.z - studio.d / 2], b: [studio.x + studio.w / 2, 2.3, studio.z + studio.d / 2], droop: 0.28 },
]

/** Straight strands hanging down the gate pillars. */
export const LADIS: Array<{ x: number; z: number; top: number; length: number }> = [
  { x: -1.9, z: -26.5, top: 3.05, length: 1.5 },
  { x: 1.9, z: -26.5, top: 3.05, length: 1.5 },
  { x: 0, z: -26.5, top: 2.63, length: 0.5 },
]

/** Where peacocks live, each with a small patch of its own. */
export const PEACOCK_HOMES: Array<Spot & { seed: number }> = [
  { x: 7.4, z: 15.2, seed: 1 },
  { x: -9.4, z: -2.2, seed: 2 },
  { x: 15.2, z: -10.4, seed: 3 },
]
