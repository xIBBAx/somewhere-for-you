/**
 * Star Nook: where the space cats (game/celestial/spaceCats) make their home.
 * Kept free of imports so the world's colliders and the scenery can share it.
 */

/**
 * Star Nook, the crew's home: open, level ground on the east side of home
 * between the pond and the meadow's edge, clear of every collider and the
 * memory path (scanned: 6.6 m to the nearest obstacle, 0.2 m of relief).
 */
export const STAR_NOOK = { x: 13.5, z: 18.2 } as const
/** The deck's radius and height. */
export const NOOK_DECK = { r: 2.5, h: 0.16 } as const

/**
 * The nook opens to the north-west, toward home and the pond; a low crescent
 * of stone with a sailcloth canopy shelters it on the south-east, where the
 * cushions and the helmet rack are. Offsets from STAR_NOOK in metres (+x
 * east, +z south); `facing` is a heading (atan2(x, z)).
 */
const polar = (deg: number, r: number): { x: number; z: number } => ({ x: Math.cos((deg * Math.PI) / 180) * r, z: Math.sin((deg * Math.PI) / 180) * r })

export type NookSpotKind = "cushion" | "rail" | "tower" | "telescope" | "bowl" | "lawn"
/** Where each cat spends its time at the nook. `y` lifts it (the cat tower's platform). */
export type NookSpot = { x: number; z: number; kind: NookSpotKind; facing: number; y?: number }
export const NOOK_SPOTS: readonly NookSpot[] = [
  { ...polar(8, 1.7), kind: "cushion", facing: -1.9 },
  { ...polar(62, 1.75), kind: "cushion", facing: -2.7 },
  { ...polar(112, 1.75), kind: "cushion", facing: 2.6 },
  // the lookout at the deck's open edge, facing home
  { ...polar(-135, 2.05), kind: "rail", facing: -2.36 },
  // beside the telescope, facing north
  { ...polar(-82, 1.75), kind: "telescope", facing: Math.PI },
  { x: -3.25, z: 0.45, kind: "tower", facing: 1.9, y: 0.62 },
  { ...polar(25, 0.85), kind: "bowl", facing: 0.9 },
  { x: -2.9, z: -2.7, kind: "lawn", facing: -2.2 },
  { x: 0.9, z: -3.7, kind: "lawn", facing: 0.4 },
]

/** The crescent wall: from `from` to `to` degrees (atan2(z, x)), radius r, height h. */
export const NOOK_WALL = { from: -38, to: 128, r: 2.95, h: 0.52 } as const
/** The telescope's tripod (it follows the Moon). */
export const NOOK_TELESCOPE = polar(-95, 2.55)
/** The cat tower, outside the deck to the west. */
export const NOOK_TOWER = { x: -3.25, z: 0.45, h: 0.62 } as const
/** The helmet rack against the wall, facing the deck's centre; five pegs along it. */
export const NOOK_RACK = { ...polar(40, 2.45), yaw: Math.atan2(-Math.cos((40 * Math.PI) / 180), -Math.sin((40 * Math.PI) / 180)), width: 1.35, pegY: 0.86, shelfY: 0.34 } as const
/** A peg on the rack, in the rack's own axes: x along it, z out of it. */
export const rackPeg = (i: number): { x: number; y: number; z: number } => ({ x: (i - 2) * (NOOK_RACK.width / 5), y: NOOK_RACK.pegY, z: 0.12 })

/** Whether a point lies on the deck (its floor is NOOK_DECK.h over the ground). */
export const onNookDeck = (x: number, z: number): boolean => Math.hypot(x - STAR_NOOK.x, z - STAR_NOOK.z) < NOOK_DECK.r - 0.08


/**
 * What stands at the nook, for the world's colliders: the deck (low enough to
 * step onto), the crescent wall, the telescope, the cat tower and the rack.
 * Same shape as world-layout's CircleCollider.
 */
export const starNookColliders = (): Array<{ x: number; z: number; r: number; height: number; jumpable?: boolean; standable?: boolean }> => {
  const out: Array<{ x: number; z: number; r: number; height: number; jumpable?: boolean; standable?: boolean }> = [
    { x: STAR_NOOK.x, z: STAR_NOOK.z, r: NOOK_DECK.r, height: NOOK_DECK.h, jumpable: true, standable: true },
  ]
  const n = 9
  for (let i = 0; i < n; i++) {
    const p = polar(NOOK_WALL.from + ((NOOK_WALL.to - NOOK_WALL.from) * i) / (n - 1), NOOK_WALL.r)
    out.push({ x: STAR_NOOK.x + p.x, z: STAR_NOOK.z + p.z, r: 0.42, height: NOOK_WALL.h, jumpable: true, standable: true })
  }
  out.push({ x: STAR_NOOK.x + NOOK_TELESCOPE.x, z: STAR_NOOK.z + NOOK_TELESCOPE.z, r: 0.32, height: 1.3 })
  out.push({ x: STAR_NOOK.x + NOOK_TOWER.x, z: STAR_NOOK.z + NOOK_TOWER.z, r: 0.3, height: NOOK_TOWER.h + 0.1, jumpable: true, standable: true })
  out.push({ x: STAR_NOOK.x + NOOK_RACK.x, z: STAR_NOOK.z + NOOK_RACK.z, r: 0.5, height: 1.1 })
  return out
}
