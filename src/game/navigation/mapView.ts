import { PATH_XZ } from "../../world/hubLayout"
import { SITE_POLYGONS } from "../../world/sites/sites"
import { BUILDINGS } from "../world-layout"
import { HIGHVALE_BRIDGE, HIGHVALE_PATHS } from "../../world/highvale/highvale.layout"
import { RIVER_N0, RIVER_N1, riverE, toWorld } from "../../world/highvale/highvaleLayout"
import { beginTileFrame, drawTiles, endTileFrame } from "./mapTileCache"
import { levelFor, MAP_HOME } from "./mapTiles"
import { PLAYABLE_REACH } from "../travel/safety"

/**
 * One projection for every map in the game. A view is a centre in logical
 * world metres, a scale (metres per CSS pixel), a size, and the bearing that
 * points up the screen (radians clockwise from north, north being −z):
 * 0 for the north-up World map, the camera's own bearing for the minimap.
 *
 *   screen x = w/2 + ( dx·cos a + dz·sin a) / mpp
 *   screen y = h/2 + (−dx·sin a + dz·cos a) / mpp      (dx, dz from the centre)
 *
 * Everything drawn is real game data: the terrain tiles (mapTiles.ts), the
 * authored paths and roads, the buildings' own collision footprints, the
 * The river from the river's own centre line.
 */

export type MapView = { cx: number; cz: number; mpp: number; up: number; w: number; h: number }

export const toScreen = (v: MapView, x: number, z: number, out = { x: 0, y: 0 }): { x: number; y: number } => {
  const dx = x - v.cx, dz = z - v.cz, c = Math.cos(v.up), s = Math.sin(v.up)
  out.x = v.w / 2 + (dx * c + dz * s) / v.mpp
  out.y = v.h / 2 + (-dx * s + dz * c) / v.mpp
  return out
}

export const toWorldXZ = (v: MapView, sx: number, sy: number): { x: number; z: number } => {
  const X = (sx - v.w / 2) * v.mpp, Y = (sy - v.h / 2) * v.mpp, c = Math.cos(v.up), s = Math.sin(v.up)
  return { x: v.cx + X * c - Y * s, z: v.cz + X * s + Y * c }
}

/** Compass bearing (radians clockwise from north) of a world direction. */
export const bearingOf = (dx: number, dz: number): number => Math.atan2(dx, -dz)

/** The world rectangle a view shows: the box round the screen turned to its bearing
 * (north-up, just the screen; turned, a little more). Asking for the square round the
 * diagonal instead asked for more tiles than the cache holds, and they evicted each other. */
export const viewBounds = (v: MapView): { x0: number; z0: number; x1: number; z1: number } => {
  const c = Math.abs(Math.cos(v.up)), s = Math.abs(Math.sin(v.up))
  const rx = (v.w * c + v.h * s) / 2 * v.mpp, rz = (v.w * s + v.h * c) / 2 * v.mpp
  return { x0: v.cx - rx, z0: v.cz - rz, x1: v.cx + rx, z1: v.cz + rz }
}

// ---- vector layers -----------------------------------------------------------

export type MapLine = { kind: "path" | "road" | "trail" | "paved" | "bridge"; pts: Float64Array; width: number }
export type MapArea = { kind: "building"; pts: Float64Array }

const lines: MapLine[] = []
lines.push({ kind: "path", pts: Float64Array.from(PATH_XZ), width: 2.1 })
for (const p of HIGHVALE_PATHS) {
  const pts: number[] = []
  for (let i = 0; i < p.points.length; i += 3) pts.push(...toWorld(p.points[i], p.points[i + 1]))
  lines.push({ kind: p.paved ? "paved" : "trail", pts: Float64Array.from(pts), width: p.halfWidth * 2 })
}
{
  const [x0, z0] = toWorld(HIGHVALE_BRIDGE.e0 - 3.4, HIGHVALE_BRIDGE.n0), [x1, z1] = toWorld(HIGHVALE_BRIDGE.e1 + 3.4, HIGHVALE_BRIDGE.n1)
  lines.push({ kind: "bridge", pts: Float64Array.from([x0, z0, x1, z1]), width: 2.6 })
}
export const MAP_LINES: readonly MapLine[] = lines

const areas: MapArea[] = []
// solid buildings only (not the bench, not the bridge's rails)
for (const p of SITE_POLYGONS) if (p.height >= 2) areas.push({ kind: "building", pts: p.pts })
for (const b of Object.values(BUILDINGS)) areas.push({ kind: "building", pts: Float64Array.from([b.x - b.w / 2, b.z - b.d / 2, b.x + b.w / 2, b.z - b.d / 2, b.x + b.w / 2, b.z + b.d / 2, b.x - b.w / 2, b.z + b.d / 2]) })
export const MAP_AREAS: readonly MapArea[] = areas

/** Where labels for the regions and the river sit (the river along its own line). */
export type MapLabel = { text: string; x: number; z: number; tier: "region" | "river" | "place"; minMpp: number; maxMpp: number }
const riverPoint = (n: number): [number, number] => toWorld(riverE(n), n)
export const MAP_LABELS: readonly MapLabel[] = [-2600, 1200, 4600].map((n) => {
  const [x, z] = riverPoint(n)
  return { text: "The river", x, z, tier: "river" as const, minMpp: 0.6, maxMpp: 14 }
})
/** The reach of home, for the World map's charted edge. */
export const HOME_REACH = { x: MAP_HOME.x, z: MAP_HOME.z, r: PLAYABLE_REACH }
/** The river's own centre line, for hit-testing and its label (northing range). */
export const RIVER_SPAN = { n0: RIVER_N0, n1: RIVER_N1 }

const LINE_STYLE: Record<MapLine["kind"], { colour: string; casing: string; min: number }> = {
  path: { colour: "#f4ecd2", casing: "#3a332655", min: 1.4 },
  road: { colour: "#e9e4d6", casing: "#33302a66", min: 2 },
  trail: { colour: "#efe2bf", casing: "#3a2f1f55", min: 1.1 },
  paved: { colour: "#e2dccd", casing: "#3a332c66", min: 1.6 },
  bridge: { colour: "#c79a63", casing: "#2b1e1288", min: 2 },
}


/**
 * Draw terrain and the vector layers for a view into ctx (CSS-pixel space;
 * the caller sets the device-pixel transform and any clip).
 */
export const drawMap = (ctx: CanvasRenderingContext2D, v: MapView, opts: { detail: number } = { detail: 1 }): void => {
  const level = levelFor(v.mpp / Math.max(1, opts.detail))
  ctx.save()
  ctx.translate(v.w / 2, v.h / 2)
  ctx.rotate(-v.up)
  ctx.scale(1 / v.mpp, 1 / v.mpp)
  ctx.imageSmoothingEnabled = true
  beginTileFrame()
  // north up, tile edges go to whole device pixels (opts.detail is the device pixel ratio)
  const k = Math.max(1, opts.detail) / v.mpp
  const snap = v.up === 0 ? {
    x: (x: number): number => v.cx + (Math.round((x - v.cx) * k + v.w / 2 * opts.detail) - v.w / 2 * opts.detail) / k,
    z: (z: number): number => v.cz + (Math.round((z - v.cz) * k + v.h / 2 * opts.detail) - v.h / 2 * opts.detail) / k,
  } : undefined
  drawTiles(ctx, level, viewBounds(v), v.cx, v.cz, { x: v.cx, z: v.cz }, snap)
  endTileFrame()
  const b = viewBounds(v)
  // buildings: their footprints, a roof tone with a dark edge
  if (v.mpp < 4) {
    ctx.lineWidth = v.mpp * 1
    ctx.fillStyle = "#d9cdb6"
    ctx.strokeStyle = "#4a3c2c"
    for (const a of MAP_AREAS) {
      const p = a.pts
      if (p[0] < b.x0 - 50 || p[0] > b.x1 + 50 || p[1] < b.z0 - 50 || p[1] > b.z1 + 50) continue
      ctx.beginPath()
      for (let i = 0; i < p.length; i += 2) {
        if (i === 0) ctx.moveTo(p[i] - v.cx, p[i + 1] - v.cz); else ctx.lineTo(p[i] - v.cx, p[i + 1] - v.cz)
      }
      ctx.closePath(); ctx.fill(); ctx.stroke()
    }
  }
  // paths and roads: a dark casing under a light line, never thinner than a hairline
  ctx.lineJoin = ctx.lineCap = "round"
  if (v.mpp < 12) for (const pass of [0, 1]) for (const l of MAP_LINES) {
    const st = LINE_STYLE[l.kind]
    const w = Math.max(l.width, st.min * v.mpp) + (pass === 0 ? 1.6 * v.mpp : 0)
    ctx.lineWidth = w
    ctx.strokeStyle = pass === 0 ? st.casing : st.colour
    ctx.beginPath()
    const p = l.pts
    let near = false
    for (let i = 0; i < p.length; i += 2) {
      if (!near && p[i] > b.x0 - 200 && p[i] < b.x1 + 200 && p[i + 1] > b.z0 - 200 && p[i + 1] < b.z1 + 200) near = true
      if (i === 0) ctx.moveTo(p[i] - v.cx, p[i + 1] - v.cz); else ctx.lineTo(p[i] - v.cx, p[i + 1] - v.cz)
    }
    if (near) ctx.stroke()
  }
  ctx.restore()
}
