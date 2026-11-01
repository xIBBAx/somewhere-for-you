import { MAX_LEVEL, TILE_PX, tileKey, tileMetres, type TileRaster, type TileRequest } from "./mapTiles"

/**
 * The main thread's side of the map tiles (mapTiles.ts): a bounded cache of
 * rendered tiles as canvases, a priority queue of the ones a view is waiting
 * for, and one worker that draws them two at a time. Views ask for tiles
 * every frame; a tile not yet drawn is queued (nearest the view first) and
 * its coarser parent stands in for it meanwhile, so the map is never blank.
 */

type Tile = { canvas: HTMLCanvasElement; used: number; highvale: boolean }
// (a full-screen World map at a fine rung needs ~110 at once, with the minimap's beside them)
const MAX_TILES = 256

const cache = new Map<string, Tile>()
const pending = new Set<string>()
const queue = new Map<string, TileRequest & { priority: number; frame: number }>()
/** two workers, one tile each at a time (the terrain workers keep the rest of the cores) */
const POOL = 2
const workers: { w: Worker; busy: boolean }[] = []
let failed = false
let frame = 0
const listeners = new Set<() => void>()

/** Bumped whenever a tile arrives (views redraw on a change). */
export const mapTilesRT = { version: 0, failed: false, drawn: 0 }

export const onMapTiles = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const ensureWorkers = (): boolean => {
  if (failed) return false
  while (workers.length < POOL) {
    let w: Worker
    try {
      w = new Worker(new URL("./mapTiles.worker.ts", import.meta.url), { type: "module" })
    } catch {
      failed = mapTilesRT.failed = true
      return false
    }
    const slot = { w, busy: false }
    w.onmessage = (event: MessageEvent<TileRaster & { error?: string }>) => {
      slot.busy = false
      const t = event.data
      const key = tileKey(t.level, t.tx, t.tz)
      pending.delete(key)
      if (!t.error && t.rgba) {
        const canvas = document.createElement("canvas")
        canvas.width = canvas.height = TILE_PX
        canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(t.rgba.buffer as ArrayBuffer), TILE_PX, TILE_PX), 0, 0)
        cache.set(key, { canvas, used: frame, highvale: t.highvale })
        mapTilesRT.drawn++
        evict()
        mapTilesRT.version++
        for (const l of listeners) l()
      }
      pump()
    }
    w.onerror = () => {
      failed = mapTilesRT.failed = true
      for (const s of workers) s.w.terminate()
      workers.length = 0
      for (const l of listeners) l()
    }
    workers.push(slot)
  }
  return true
}

const evict = (): void => {
  if (cache.size <= MAX_TILES) return
  const old = [...cache.entries()].sort((a, b) => a[1].used - b[1].used)
  for (let i = 0; i < old.length - MAX_TILES; i++) cache.delete(old[i][0])
}

const pump = (): void => {
  if (!queue.size || !ensureWorkers()) return
  const order = [...queue.entries()].sort((a, b) => a[1].priority - b[1].priority)
  for (const [key, next] of order) {
    const slot = workers.find((s) => !s.busy)
    if (!slot) break
    queue.delete(key)
    if (cache.has(key) || pending.has(key)) continue
    pending.add(key)
    slot.busy = true
    slot.w.postMessage({ level: next.level, tx: next.tx, tz: next.tz })
  }
}

/** Start a new frame of requests: anything queued and not asked for since the last frame is dropped. */
export const beginTileFrame = (): void => {
  frame++
  for (const [key, q] of queue) if (q.frame < frame - 1) queue.delete(key)
}

/** The tile if drawn (marking it used); otherwise queue it. */
export const tileFor = (level: number, tx: number, tz: number, priority: number): HTMLCanvasElement | null => {
  const key = tileKey(level, tx, tz)
  const hit = cache.get(key)
  if (hit) { hit.used = frame; return hit.canvas }
  if (!pending.has(key) && !failed) {
    const q = queue.get(key)
    if (q) { q.frame = frame; q.priority = Math.min(q.priority, priority) }
    else queue.set(key, { level, tx, tz, priority, frame })
  }
  return null
}

export const endTileFrame = (): void => pump()

/**
 * Draw the terrain under a view into ctx, whose transform already maps world
 * metres (relative to `ox, oz`) to the screen. `bounds` is the world rectangle
 * to cover. Missing tiles fall back to the nearest drawn parent.
 */
export type TileSnap = { x: (x: number) => number; z: (z: number) => number }
export const drawTiles = (ctx: CanvasRenderingContext2D, level: number, bounds: { x0: number; z0: number; x1: number; z1: number }, ox: number, oz: number, focus: { x: number; z: number }, snap?: TileSnap): void => {
  const s = tileMetres(level)
  const tx0 = Math.floor(bounds.x0 / s), tx1 = Math.floor(bounds.x1 / s)
  const tz0 = Math.floor(bounds.z0 / s), tz1 = Math.floor(bounds.z1 / s)
  if ((tx1 - tx0 + 1) * (tz1 - tz0 + 1) > 400) return
  // Seams (a turned view, the minimap): filtering past a tile's edge blends in the sheet beneath (a line), and
  // stretching the tile to hide that moves its texels off their true places by
  // up to half of one (a light-dark pair where neighbours meet). So each tile
  // is laid down twice: first stretched a hair past its edges, an underlay that
  // fills the half-texel strips; then exactly registered, from its first texel
  // centre to its last, so every texel sits where it was sampled.
  const pad = s / TILE_PX * 0.6, half = s / TILE_PX * 0.5
  const laid: { tile: HTMLCanvasElement; x: number; z: number }[] = []
  for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) {
    const cxm = (tx + 0.5) * s, czm = (tz + 0.5) * s
    const tile = tileFor(level, tx, tz, Math.hypot(cxm - focus.x, czm - focus.z) / s)
    // A north-up view: every tile edge on a whole device pixel, shared exactly with its
    // neighbour (two antialiased edges meeting in one pixel let the sheet through: a line)
    if (tile && snap) {
      const x0 = snap.x(tx * s), x1 = snap.x((tx + 1) * s), z0 = snap.z(tz * s), z1 = snap.z((tz + 1) * s)
      if (x1 > x0 && z1 > z0) ctx.drawImage(tile, x0 - ox, z0 - oz, x1 - x0, z1 - z0)
      continue
    }
    // (the underlay from half a texel in, so it is opaque to its very edge: never the sheet showing through)
    if (tile) { ctx.drawImage(tile, 0.5, 0.5, TILE_PX - 1, TILE_PX - 1, tx * s - ox, tz * s - oz, s + pad, s + pad); laid.push({ tile, x: tx * s - ox, z: tz * s - oz }); continue }
    // one coarse tile covering sixteen of these comes first, so the view fills at once
    if (level + 2 <= MAX_LEVEL) {
      const S2 = tileMetres(level + 2)
      tileFor(level + 2, Math.floor(tx * s / S2), Math.floor(tz * s / S2), -1)
    }
    // a coarser parent, cropped to this tile, stands in until it arrives
    for (let up = 1; up <= 4 && level + up <= MAX_LEVEL; up++) {
      const L = level + up, S = tileMetres(L)
      const px = Math.floor(tx * s / S), pz = Math.floor(tz * s / S)
      const key = tileKey(L, px, pz)
      const parent = cache.get(key)
      if (!parent) continue
      parent.used = frame
      const f = TILE_PX / S
      const sx = (tx * s - px * S) * f, sz = (tz * s - pz * S) * f
      ctx.drawImage(parent.canvas, sx + 0.25, sz + 0.25, s * f - 0.5, s * f - 0.5, tx * s - ox, tz * s - oz, s + pad, s + pad)
      break
    }
  }
  for (const { tile, x, z } of laid) ctx.drawImage(tile, 0.5, 0.5, TILE_PX - 1, TILE_PX - 1, x + half, z + half, s - 2 * half, s - 2 * half)
}
