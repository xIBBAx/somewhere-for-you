/**
 * When the riders stand on another world (game/celestial/realm), the
 * ground under every foot and hoof there is that world's: the height
 * functions here and in terrain.ts / waterSurface.ts defer to it, there is
 * no water, and gravity is that world's.
 *
 * That world's ground is laid out in its own far corner of the logical
 * plane (REALM_ORIGIN, thousands of kilometres from home), and only that
 * corner answers with its heights. Everything left at home (The companion waiting
 * by the café, the herd, the cat) keeps standing on home's own ground while the
 * riders are away. Worker threads never set it (they build home's chunks).
 */
export const REALM_ORIGIN = { x: 6_000_000, z: 6_000_000 } as const
/** Half the side of the square of the plane given to another world's ground. */
export const REALM_REACH = 1_000_000

export const realmGround = {
  /** logical (x, z) → ground height in the realm's corner, or null at home */
  fn: null as ((x: number, z: number) => number) | null,
  /** surface gravity relative to Earth's, where the active body stands */
  gravityScale: 1,
}

/** Whether a logical point lies in the corner of the plane kept for another world. */
export const inRealm = (x: number, z: number): boolean =>
  Math.abs(x - REALM_ORIGIN.x) < REALM_REACH && Math.abs(z - REALM_ORIGIN.z) < REALM_REACH

/** The realm's ground at a point, or null when the point is home's. */
export const realmHeightAt = (x: number, z: number): number | null =>
  realmGround.fn && inRealm(x, z) ? realmGround.fn(x, z) : null

/** Gravity relative to Earth's for something standing at (x, z). */
export const gravityAt = (x: number, z: number): number => (realmGround.fn && inRealm(x, z) ? realmGround.gravityScale : 1)

/** Two bodies stand on the same world (both home, or both on the Moon). */
export const sameWorld = (a: { x: number; z: number }, b: { x: number; z: number }): boolean => inRealm(a.x, a.z) === inRealm(b.x, b.z)

/**
 * Obstacles on another world's ground (boulders, landers, rovers), kept by
 * the lunar scene round the riders and merged into the nearby colliders the
 * movement code reads (WorldScatter) whenever the riders stand in the realm.
 */
export const realmColliders = {
  list: [] as import("../game/world-layout").CircleCollider[],
  version: 0,
}

/** The player stands on another world: home's creatures, plants and weather pause round them. */
export const awayFromEarth = (p: { x: number; z: number }): boolean => realmGround.fn !== null && inRealm(p.x, p.z)
