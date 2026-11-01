import { hubHeight, hubWeight } from "./hubLayout"
import { landmarkAt, LANDMARK_RADIUS } from "./landmarks"
import { mix, smooth } from "./noise"
import { rawWildHeight } from "./baseTerrain"
import { erodedWildHeight } from "./erosion"
import { siteHeight, siteWeight } from "./sites/sites"
import { realmHeightAt } from "./realmHook"
import { highvaleWeight } from "./highvale/highvaleLayout"
import { highvaleHeightAt } from "./highvale/highvaleTerrain"

export { WATER_LEVEL } from "./climate"

/**
 * The endless landscape around the explorer's home.
 *
 *   world seed → climate fields → macro + medium + micro height (domain warped)
 *              → lake basins → landmark terraces
 *              → blended into the authored home terrain near the origin.
 *
 * Every function is deterministic in world coordinates and worker-safe.
 */

/** Wild height including the gentle terraces under landmarks. */
export const wildHeight = (x: number, z: number): number => {
  // Highvale's mountains (world/highvale), blended into the wilds at their foot
  const mw = highvaleWeight(x, z)
  if (mw > 0) {
    const mh = highvaleHeightAt(x, z)
    if (mh !== null) return mw >= 0.999 ? mh : mix(erodedWildHeight(x, z), mh, mw)
  }
  const site = siteWeight(x, z)
  if (site.w >= 0.999) return siteHeight(site.site!)
  const h = site.w > 0.001 ? mix(erodedWildHeight(x, z), siteHeight(site.site!), site.w) : erodedWildHeight(x, z)
  if (site.w > 0.001) return h
  const lm = landmarkAt(x, z)
  if (!lm) return h
  const r = LANDMARK_RADIUS[lm.kind]
  const d = Math.hypot(x - lm.x, z - lm.z)
  if (d > r + 7) return h
  const centre = rawWildHeight(lm.x, lm.z)
  return mix(h, centre, 1 - smooth(r * 0.8, r + 7, d))
}

/** Final terrain height: authored home terrain blended into the endless wilds. */
export const worldHeight = (x: number, z: number): number => {
  const realm = realmHeightAt(x, z)
  if (realm !== null) return realm
  const w = hubWeight(x, z)
  if (w >= 0.999) return hubHeight(x, z)
  const wild = wildHeight(x, z)
  if (w <= 0.001) return wild
  return mix(wild, hubHeight(x, z), w)
}

/** Terrain normal Y-component approximation for slope tests. */
export const slopeAt = (x: number, z: number): number => {
  const e = 0.6
  const dx = (worldHeight(x + e, z) - worldHeight(x - e, z)) / (2 * e)
  const dz = (worldHeight(x, z + e) - worldHeight(x, z - e)) / (2 * e)
  return Math.hypot(dx, dz)
}
