import { highvaleDeckAt } from "../world/highvale/highvaleStructures"
import { roofTopAt } from "../world/sites/sites"
import * as THREE from "three"
import { starNookColliders } from "../world/starNookLayout"
import { makeRng } from "../utils/math"

/**
 * Single source of truth for the home region's shape: the path curve, terrain
 * height, river/pond, vegetation placement and collision shapes.
 * Environment rendering, movement and collision all read from here so
 * they can never disagree.
 */

import {
  BRIDGE_HALF_WIDTH,
  CLEARINGS,
  HUB_CENTER,
  HUB_RADIUS,
  PATH_XZ,
  POND,
  RIVER_HALF_WIDTH,
  RIVER_MAX_X,
  RIVER_MIN_X,
  RIVER_Z,
  WATER_Y,
  distToPath,
  inClearing,
  riverCenterZ,
  riverEnvelope,
  riverHalfWidthAt,
} from "../world/hubLayout"
import { worldHeight } from "../world/terrain"

export {
  BRIDGE_HALF_WIDTH,
  CLEARINGS,
  POND,
  RIVER_HALF_WIDTH,
  RIVER_MAX_X,
  RIVER_MIN_X,
  RIVER_Z,
  WATER_Y,
  distToPath,
  riverCenterZ,
  riverEnvelope,
  riverHalfWidthAt,
}

/** Centre/radius of the authored home region. */
export const HOME_CENTER = new THREE.Vector2(HUB_CENTER.x, HUB_CENTER.z)
export const HOME_RADIUS = HUB_RADIUS

/** Shared ride/stall positions and their complete occupied footprints. */
export const FAIR_LAYOUT = {
  x: 0.8, z: 30.2, r: 4.9,
  ferris: { position: [-2.6, 0, 0.2], halfWidth: 2.5, halfDepth: 0.7 },
  carousel: { position: [2.7, 0, 0.4], r: 1.55 },
  swings: { position: [0, 0, -2.2], r: 1.15 },
  ticket: { position: [0, 0, -3.2], r: 0.94 },
  pastry: { position: [-3.4, 0, 1.2], r: 1.08 },
  game: { position: [3.4, 0, 0.8], r: 0.93 },
  fountain: { position: [0, 0, 0.9], r: 0.95 },
} as const

/** The memory path, sampled identically to the terrain's path flattening. */
export const PATH_POINTS: THREE.Vector3[] = Array.from(
  { length: PATH_XZ.length / 2 },
  (_, i) => new THREE.Vector3(PATH_XZ[i * 2], 0, PATH_XZ[i * 2 + 1]),
)

export const PATH_CURVE = new THREE.CatmullRomCurve3(
  [
    [0, 24.5], [-1.5, 20.5], [-4.5, 17.5], [-7.2, 14.6], [-5.5, 11.2], [-1.5, 9.4], [3.4, 9.8],
    [6.2, 8.2], [4.6, 4.6], [0.2, 3.0], [-4.6, 2.6], [-8.4, 1.4], [-6.4, -2.4], [-2.2, -4.0],
    [2.4, -4.6], [-1.4, -7.0], [-5.6, -7.6], [-3.0, -10.6], [0.8, -12.2], [4.6, -12.6],
    [7.4, -14.6], [5.2, -17.2], [0.6, -17.8], [-3.0, -19.2], [-0.6, -20.6], [0, -26.5], [0, -29.5],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z)),
  false,
  "catmullrom",
  0.5,
)

/** Terrain height everywhere: authored home terrain blended into the endless wilds. */
export const terrainHeight = worldHeight

/** Ground height including the walkable bridge arch. */
export const groundHeight = (x: number, z: number): number => {
  const onBridge =
    Math.abs(x) <= BRIDGE_HALF_WIDTH && z >= RIVER_Z - 2.4 && z <= RIVER_Z + 2.4
  if (onBridge) {
    const t = (z - (RIVER_Z - 2.4)) / 4.8
    return 0.12 + Math.sin(t * Math.PI) * 0.38
  }
  // Highvale's footbridge over the river (world/highvale/highvaleStructures.ts)
  const deck = highvaleDeckAt(x, z)
  if (deck !== null) return deck
  // the flat roofs of authored sites and the houses round them are solid ground too
  // (a Pegasus can land on one; whoever gets off stands on the slab)
  const roof = roofTopAt(x, z)
  if (roof > -Infinity) return roof
  return terrainHeight(x, z)
}

// --- vegetation placement (deterministic) -----------------------------------

const rng = makeRng(20260825)

const blockedForTrees = (x: number, z: number): boolean => {
  if (distToPath(x, z) < 3.4) return true
  if (Math.abs(z - RIVER_Z) < 4.2) return true
  if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 1.6) return true
  if (inClearing(x, z)) return true
  return false
}

export type Prop = { x: number; z: number; s: number; variant: number }

const scatter = (
  count: number,
  radiusMin: number,
  radiusMax: number,
  ok: (x: number, z: number) => boolean,
  variants: number,
  scaleMin: number,
  scaleMax: number,
): Prop[] => {
  const out: Prop[] = []
  let guard = 0
  while (out.length < count && guard < count * 40) {
    guard++
    const a = rng() * Math.PI * 2
    const r = radiusMin + rng() * (radiusMax - radiusMin)
    const x = HOME_CENTER.x + Math.cos(a) * r
    const z = HOME_CENTER.y + Math.sin(a) * r
    if (!ok(x, z)) continue
    out.push({ x, z, s: scaleMin + rng() * (scaleMax - scaleMin), variant: Math.floor(rng() * variants) })
  }
  return out
}

// The first 30 entries form a ring of trees around the home region.
// They keep their indices (monkey trees and other systems refer to TREES by
// index) and their RNG draws, but are now loosened into an irregular belt
// that hands home over to the procedural forests beyond.
const beltRng = makeRng(77031)
export const TREES: Prop[] = [
  ...Array.from({ length: 30 }, (_, i) => {
    const a = (i / 30) * Math.PI * 2 + rng() * 0.14 + (beltRng() - 0.5) * 0.18
    const r = HOME_RADIUS + 1.2 + rng() * 2.4 + beltRng() * 9
    return {
      x: HOME_CENTER.x + Math.cos(a) * r,
      z: HOME_CENTER.y + Math.sin(a) * r,
      s: 1.1 + rng() * 0.5,
      variant: Math.floor(rng() * 3),
    }
  }),
  ...scatter(26, 6, HOME_RADIUS - 2, (x, z) => !blockedForTrees(x, z), 3, 0.85, 1.35),
]

export const BUSHES: Prop[] = scatter(
  34,
  5,
  HOME_RADIUS - 1,
  (x, z) => distToPath(x, z) > 2.1 && Math.abs(z - RIVER_Z) > 3 && !inClearing(x, z),
  2,
  0.6,
  1.1,
)

export const FLOWERS: Prop[] = [
  ...scatter(
    70,
    4,
    HOME_RADIUS - 2,
    (x, z) => {
      const d = distToPath(x, z)
      if (d < 1.7 || d > 4.2) return false
      if (Math.abs(z - RIVER_Z) < 3) return false
      if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 0.8) return false
      return !inClearing(x, z)
    },
    4,
    0.8,
    1.2,
  ),
  // dense beds inside the finale garden
  ...scatter(46, 0.5, 7.5, (x, z) => Math.hypot(x, z + 30.5) < 7.5 && Math.hypot(x, z + 30.5) > 2.2, 4, 0.9, 1.3),
]

export const ROCKS: Prop[] = scatter(
  14,
  6,
  HOME_RADIUS - 2,
  (x, z) => distToPath(x, z) > 2.6 && !inClearing(x, z),
  2,
  0.5,
  1.0,
)

// --- collision ---------------------------------------------------------------

export type CircleCollider = {
  x: number
  z: number
  r: number
  height?: number
  jumpable?: boolean
  /** characters can stand on its top (rocks, boulders, low platforms) */
  standable?: boolean
  /** a tree's crown: its top over the ground and its radius (m), for things that fly */
  crown?: number
  crownR?: number
  /** cached absolute top height, filled in lazily by the movement code */
  top?: number
}
export type RectCollider = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  height?: number
}

export const BUILDINGS = {
  studio: { x: -13.2, z: 2.6, w: 3.4, d: 3.0 },
  cafe: { x: 2.2, z: -12.6, w: 7.2, d: 3.4 },
}

export const TRAINING = { x: -10.8, z: -7.8, bagX: -10.8, bagZ: -8.6 } as const

export const buildColliders = (): { circles: CircleCollider[]; rects: RectCollider[] } => {
  const circles: CircleCollider[] = []
  const rects: RectCollider[] = []

  for (const t of TREES) {
    // belt trees are solid too
    circles.push({ x: t.x, z: t.z, r: 0.55 * t.s, height: 4.4 * t.s })
  }
  // Gulmohar gulmohar blossom trees
  const gulmoharTrees = [
    { x: 9.5, z: 9.2, s: 1.15 },
    { x: -15.8, z: 3.8, s: 1.2 },
    { x: 14.2, z: -5.5, s: 1.1 },
    { x: -4.5, z: -4.8, s: 1.25 },
    { x: -6.8, z: 17.2, s: 1.05 },
    { x: 3.6, z: -23.5, s: 1.3 },
    { x: 12.8, z: -16.2, s: 1.15 },
  ]
  for (const st of gulmoharTrees) {
    circles.push({ x: st.x, z: st.z, r: 0.5 * st.s, height: 4.2 * st.s })
  }
  for (const b of BUSHES) {
    circles.push({ x: b.x, z: b.z, r: 0.5 * b.s, height: 0.9 * b.s })
  }
  for (const rock of ROCKS) {
    circles.push({
      x: rock.x,
      z: rock.z,
      r: 0.42 * rock.s,
      height: 0.72 * rock.s,
      jumpable: true,
      standable: true,
    })
  }

  const { studio, cafe } = BUILDINGS
  rects.push({
    minX: studio.x - studio.w / 2,
    maxX: studio.x + studio.w / 2,
    minZ: studio.z - studio.d / 2,
    maxZ: studio.z + studio.d / 2,
    height: 3.0,
  })
  rects.push({
    minX: cafe.x - cafe.w / 2,
    maxX: cafe.x + cafe.w / 2,
    minZ: cafe.z - cafe.d / 2,
    maxZ: cafe.z + cafe.d / 2,
    height: 4.65,
  })

  // Curved creek banks, approximated with short overlapping rectangles. The
  // exact bridge-width gap remains walkable and the tapered ends can be
  // walked around, matching what the player sees.
  const addRiverBank = (startX: number, endX: number): void => {
    const segmentLength = 2.2
    for (let x = startX; x < endX - 0.01; x += segmentLength) {
      const maxX = Math.min(endX, x + segmentLength)
      const centerX = (x + maxX) / 2
      const centerZ = riverCenterZ(centerX)
      const halfWidth = riverHalfWidthAt(centerX) + 0.2
      rects.push({
        minX: x - 0.08,
        maxX: maxX + 0.08,
        minZ: centerZ - halfWidth,
        maxZ: centerZ + halfWidth,
        height: 0,
      })
    }
  }
  addRiverBank(RIVER_MIN_X + 0.3, -BRIDGE_HALF_WIDTH)
  addRiverBank(BRIDGE_HALF_WIDTH, RIVER_MAX_X - 0.3)

  circles.push({ x: POND.x, z: POND.z, r: POND.r + 0.3, height: 0 })

  // training corner: heavy bag + frame
  circles.push({ x: TRAINING.bagX, z: TRAINING.bagZ, r: 0.29, height: 2.65 })
  // corner café: two tables + bench + planters (prevent walking through)
  circles.push({ x: 5.4, z: -9.6, r: 0.8 })
  circles.push({ x: -0.6, z: -9.4, r: 0.8 })
  circles.push({ x: 6.8, z: -12.2, r: 0.75 })
  circles.push({ x: -1.4, z: -9.0, r: 0.4 })
  circles.push({ x: 6.2, z: -11.2, r: 0.4 })
  // gate pillars (finale garden entrance)
  circles.push({ x: -1.9, z: -26.5, r: 0.45, height: 3.1 })
  circles.push({ x: 1.9, z: -26.5, r: 0.45, height: 3.1 })

  // Cat Garden: circular fence posts (visual + physical barrier, gap at west entrance).
  {
    const gx = 12.4
    const gz = 0.4
    const gr = 3.8
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2
      const fromEntrance = Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI))
      if (Math.abs(fromEntrance) < 0.34) continue
      const px = gx + Math.cos(a) * gr
      const pz = gz + Math.sin(a) * gr
      circles.push({ x: px, z: pz, r: 0.28, height: 1.05 })
    }
    // fence arch pillars
    circles.push({ x: gx - gr + 0.05, z: gz - 0.78, r: 0.22, height: 2.2 })
    circles.push({ x: gx - gr + 0.05, z: gz + 0.78, r: 0.22, height: 2.2 })
    // heart stone + cat house inside garden
    circles.push({ x: gx, z: gz, r: 0.45 })
    circles.push({ x: 14.45, z: 2.1, r: 0.65, height: 1.35 })
    // garden cushions
    circles.push({ x: 10.6, z: 0.0, r: 0.35, height: 0.18, jumpable: true })
    circles.push({ x: 13.6, z: 2.05, r: 0.35, height: 0.18, jumpable: true })
  }

  // Future Path overlook bench + telescope base
  circles.push({ x: -4.4, z: -17.2, r: 0.7 })
  circles.push({ x: -2.85, z: -17.4, r: 0.3 }) // telescope tripod cluster
  circles.push({ x: -2.8, z: -16.6, r: 0.45 }) // overlook stone cluster handled via terrain, but bench is enough

  // Finale garden: benches, cake table, gift box, fairy arch pillars
  circles.push({ x: -4.0, z: -30.75, r: 0.7 })
  circles.push({ x: 4.1, z: -31.1, r: 0.7 })
  circles.push({ x: -2.65, z: -30.65, r: 0.65 }) // cake table
  circles.push({ x: 2.8, z: -32.5, r: 0.55 }) // gift box platform
  // fairy arch pillars (frame the companion + constellation)
  circles.push({ x: -2.2, z: -28.05, r: 0.26, height: 3.2 })
  circles.push({ x: 2.2, z: -28.05, r: 0.26, height: 3.2 })

  // Little Fair behind spawn — keep it navigable but not phasing through rides
  const { x: fx, z: fz, ferris } = FAIR_LAYOUT
  // The rotating cabins sweep well outside the wheel's central supports.
  rects.push({ minX: fx + ferris.position[0] - ferris.halfWidth, maxX: fx + ferris.position[0] + ferris.halfWidth,
    minZ: fz + ferris.position[2] - ferris.halfDepth, maxZ: fz + ferris.position[2] + ferris.halfDepth })
  for (const [shape, height] of [[FAIR_LAYOUT.carousel, 2.8], [FAIR_LAYOUT.swings, 2.4], [FAIR_LAYOUT.ticket, 1.6],
    [FAIR_LAYOUT.pastry, 1.7], [FAIR_LAYOUT.game, 1.5], [FAIR_LAYOUT.fountain, 0.85]] as const) {
    circles.push({ x: fx + shape.position[0], z: fz + shape.position[2], r: shape.r, height })
  }
  // fair perimeter posts (visual posts already frame the circle)
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    const r = 4.9 - 0.2
    const px = fx + Math.cos(a) * r
    const pz = fz + Math.sin(a) * r * 0.92
    // skip the south entrance gap toward spawn
    if (pz < 26.2 && Math.abs(px - fx) < 1.15) continue
    circles.push({ x: px, z: pz, r: 0.17, height: 0.9 })
  }

  // Star Nook, the space cats' home (world/starNookLayout.ts)
  circles.push(...starNookColliders())
  return { circles, rects }
}
