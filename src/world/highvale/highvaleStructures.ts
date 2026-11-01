import { HIGHVALE_BRIDGE, HIGHVALE_HOUSES, HIGHVALE_MEADOW, HIGHVALE_TEMPLE } from "./highvale.layout"
import { highvaleMaps } from "./highvaleData"
import { toWorld } from "./highvaleLayout"

/**
 * Where Highvale's buildings stand and what of them is solid: the houses on
 * their pads, the footbridge over the river, the temple, the meadow bench.
 * Sizes match the valley's authoring script. Pure data: shared by
 * the renderer (render/HighvaleVillage.tsx), collision (world/sites/sites.ts)
 * and the walkable deck (game/world-layout.ts).
 */

/** Each variant's plan (m): along the front (W) and front to back (D). */
export const HOUSE_PLAN: readonly (readonly [number, number])[] = [[7.6, 6.0], [9.2, 6.6], [6.6, 5.6]]

/** y is NaN where the model sits on the ground itself (read when placed). */
export type Placed = { name: string; x: number; y: number; z: number; rotation: number }

const housesPlaced: Placed[] = HIGHVALE_HOUSES.map((h) => {
  const [x, z] = toWorld(h.e, h.n)
  return { name: `house_v${h.variant}_s${h.storeys}`, x, y: h.level, z, rotation: h.facing }
})

/** The temple's doorway faces the trail that comes to it from the village. */
const templeFacing = Math.atan2(14, 10)
const [tx, tz] = toWorld(HIGHVALE_TEMPLE.e, HIGHVALE_TEMPLE.n)
const templePlaced: Placed = { name: "temple", x: tx, y: HIGHVALE_TEMPLE.level, z: tz, rotation: templeFacing }

const bridgeE = (HIGHVALE_BRIDGE.e0 + HIGHVALE_BRIDGE.e1) / 2
const [bx, bz] = toWorld(bridgeE, HIGHVALE_BRIDGE.n0)
const bridgePlaced: Placed = { name: "bridge", x: bx, y: HIGHVALE_BRIDGE.level, z: bz, rotation: 0 }

/** The bench on the meadow's shoulder, turned to the open north-west: the valley, the river and the snow beyond. */
export const BENCH_LOCAL = { e: HIGHVALE_MEADOW.e - 5, n: HIGHVALE_MEADOW.n + 3 }
/** Seated, you face this way (radians in the east-north plane): up the river. */
export const BENCH_VIEW = Math.atan2(1500, -1100)
const [cx, cz] = toWorld(BENCH_LOCAL.e, BENCH_LOCAL.n)
export const BENCH_WORLD = { x: cx, z: cz }
// the bench's long axis is local z: turn it square to the view
const benchPlaced: Placed = { name: "bench", x: cx, y: Number.NaN, z: cz, rotation: BENCH_VIEW }

export const HIGHVALE_PLACED: readonly Placed[] = [...housesPlaced, templePlaced, bridgePlaced, benchPlaced]

/** Half the deck's length (m) beyond the river's banks, and its half width. */
const DECK_HALF = (HIGHVALE_BRIDGE.e1 - HIGHVALE_BRIDGE.e0) / 2 + 3.4
const DECK_HALF_W = 0.85

/** The deck's walking height at world (x, z), or null off the bridge. */
export const highvaleDeckAt = (x: number, z: number): number | null => {
  // no bridge over ground that has not arrived yet (the wilds stand there)
  if (!highvaleMaps.data) return null
  if (Math.abs(z - bz) > DECK_HALF_W || Math.abs(x - bx) > DECK_HALF) return null
  return HIGHVALE_BRIDGE.level
}

type Footprint = { pts: [number, number][]; height: number }

const rect = (x: number, z: number, rotation: number, halfFront: number, halfDepth: number, height: number): Footprint => {
  // local +x is the front (east at rotation 0), local z across it; rotation.y = `rotation`
  const c = Math.cos(rotation), s = Math.sin(rotation)
  const pts: [number, number][] = []
  for (const [lx, lz] of [[-halfDepth, -halfFront], [halfDepth, -halfFront], [halfDepth, halfFront], [-halfDepth, halfFront]]) {
    pts.push([x + lx * c + lz * s, z - lx * s + lz * c])
  }
  return { pts, height }
}

/** Solid ground plans in world coordinates (for world/sites/sites.ts). */
export const highvaleFootprints = (): Footprint[] => {
  const out: Footprint[] = []
  for (const h of HIGHVALE_HOUSES) {
    const [W, D] = HOUSE_PLAN[h.variant]
    const [x, z] = toWorld(h.e, h.n)
    out.push(rect(x, z, h.facing, W / 2 + 0.25, D / 2 + 0.25, 5 + h.storeys * 2.5))
  }
  out.push(rect(tx, tz, templeFacing, 6.5, 6.5, 20))
  // the bench is solid too: you sit on it (game/activities/highvaleBench.ts), not through it
  out.push(rect(cx, cz, BENCH_VIEW, 1.05, 0.26, 0.47))
  // the bridge's sides: you cross it, you do not step off it
  const span = HIGHVALE_BRIDGE.e1 - HIGHVALE_BRIDGE.e0
  for (const side of [-1, 1]) {
    out.push(rect(bx, bz + side * (DECK_HALF_W + 0.08), 0, 0.06, span / 2 + 0.4, 1.2))
  }
  return out
}
