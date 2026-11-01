import { smooth } from "../noise"

/**
 * Authored places inside the endless world (pure math, no terrain imports,
 * so the climate and terrain modules can use it without import cycles).
 *
 * A site is a flat disc of ground (no lakes, wild landmarks, finds or
 * scatter) that can hold a hand-made model. The world ships with none; the
 * terrain, scatter and collision code all honour any you add here
 * (docs/CUSTOMIZATION.md, "Adding a place of your own").
 */
export type SiteId = string
export type Site = {
  id: SiteId
  /** world position of the model origin */
  x: number
  z: number
  /** rotation about +y applied to the model (radians) */
  rotation: number
  /** flat radius and blend distance (m) */
  radius: number
  blend: number
  /** the model's local gate point, if it has one */
  gate: { x: number; z: number; inward: [number, number] } | null
}

const rotate = (x: number, z: number, a: number): [number, number] => [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)]

export const SITES: Site[] = []

/** 1 inside a site's flat disc, easing to 0 across its blend band (plus margin). */
export const siteWeight = (x: number, z: number, margin = 0): { site: Site | null; w: number } => {
  for (const site of SITES) {
    const d = Math.hypot(x - site.x, z - site.z)
    if (d > site.radius + site.blend + margin) continue
    return { site, w: 1 - smooth(site.radius + margin, site.radius + site.blend + margin, d) }
  }
  return { site: null, w: 0 }
}

/** True where nothing wild may grow: inside a site. */
export const siteBlocked = (x: number, z: number): boolean => siteWeight(x, z, -8).w > 0.02

/** World → site-local coordinates. */
export const toSiteLocal = (site: Site, x: number, z: number): [number, number] => rotate(x - site.x, z - site.z, -site.rotation)
/** Site-local → world coordinates. */
export const toSiteWorld = (site: Site, x: number, z: number): [number, number] => {
  const [rx, rz] = rotate(x, z, site.rotation)
  return [rx + site.x, rz + site.z]
}

