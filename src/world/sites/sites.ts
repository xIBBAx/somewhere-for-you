import { rawWildHeight } from "../baseTerrain"
import type { Site, SiteId } from "./siteLayout"
import { highvaleFootprints } from "../highvale/highvaleStructures"

export * from "./siteLayout"

const heights = new Map<SiteId, number>()
/** Ground level of a site: the wild terrain height at its centre. */
export const siteHeight = (site: Site): number => {
  let h = heights.get(site.id)
  if (h === undefined) {
    h = Math.max(rawWildHeight(site.x, site.z), 0.4)
    heights.set(site.id, h)
  }
  return h
}

/**
 * A flat roof you can stand on: the slab inside the parapet, the parapet's
 * top, and anything standing on the slab. A site's model and its polygon must
 * agree, so the slab is exactly where the model's slab is.
 */
export type SiteRoof = {
  /** absolute height of the slab */
  top: number
  /** absolute height of the parapet's top (the wall) */
  wall: number
  /** the slab's outline, inside the parapet */
  inner: Float64Array
  obstacles: Array<{ x: number; z: number; r: number; top: number }>
}
export type SitePolygon = { pts: Float64Array; minX: number; maxX: number; minZ: number; maxZ: number; height: number; roof?: SiteRoof }

/** Building footprints in world coordinates, for collision (the Highvale village's houses, temple and footbridge). */
export const SITE_POLYGONS: SitePolygon[] = []

// Highvale's houses, temple and the footbridge's sides (highvale/highvaleStructures.ts)
for (const f of highvaleFootprints()) {
  const pts = new Float64Array(f.pts.flat())
  const xs = f.pts.map((p) => p[0]), zs = f.pts.map((p) => p[1])
  SITE_POLYGONS.push({ pts, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), height: f.height })
}

const inside = (pts: Float64Array, x: number, z: number): boolean => {
  const n = pts.length / 2
  let isIn = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const x1 = pts[j * 2], z1 = pts[j * 2 + 1], x2 = pts[i * 2], z2 = pts[i * 2 + 1]
    if ((z1 > z) !== (z2 > z) && x < (x2 - x1) * (z - z1) / (z2 - z1) + x1) isIn = !isIn
  }
  return isIn
}

/** A coarse grid over the roofs so the height query costs nothing elsewhere. */
const ROOF_CELL = 16
const roofGrid = new Map<string, SitePolygon[]>()
let roofMinX = Infinity, roofMaxX = -Infinity, roofMinZ = Infinity, roofMaxZ = -Infinity
for (const poly of SITE_POLYGONS) {
  if (!poly.roof) continue
  roofMinX = Math.min(roofMinX, poly.minX); roofMaxX = Math.max(roofMaxX, poly.maxX)
  roofMinZ = Math.min(roofMinZ, poly.minZ); roofMaxZ = Math.max(roofMaxZ, poly.maxZ)
  for (let gx = Math.floor(poly.minX / ROOF_CELL); gx <= Math.floor(poly.maxX / ROOF_CELL); gx++)
    for (let gz = Math.floor(poly.minZ / ROOF_CELL); gz <= Math.floor(poly.maxZ / ROOF_CELL); gz++) {
      const key = `${gx},${gz}`
      const list = roofGrid.get(key)
      if (list) list.push(poly)
      else roofGrid.set(key, [poly])
    }
}

/** The building whose roof is over (x, z), if any. */
export const roofPolygonAt = (x: number, z: number): SitePolygon | null => {
  if (x < roofMinX || x > roofMaxX || z < roofMinZ || z > roofMaxZ) return null
  const list = roofGrid.get(`${Math.floor(x / ROOF_CELL)},${Math.floor(z / ROOF_CELL)}`)
  if (!list) return null
  for (const poly of list) {
    if (x < poly.minX || x > poly.maxX || z < poly.minZ || z > poly.maxZ) continue
    if (inside(poly.pts, x, z)) return poly
  }
  return null
}

/**
 * The solid top of a building at (x, z): the slab inside the parapet, the
 * parapet's top over the wall itself, or −∞ off every roof. This is part of
 * the ground (world-layout groundHeight), as the Highvale footbridge is.
 */
export const roofTopAt = (x: number, z: number): number => {
  const poly = roofPolygonAt(x, z)
  if (!poly?.roof) return -Infinity
  return inside(poly.roof.inner, x, z) ? poly.roof.top : poly.roof.wall
}
