import { FIELD_N, K, SCATTER_STRIDE, type ChunkPayload } from "../chunkGen"
import { WATER_LEVEL } from "../climate"
import { POND, RIVER_MAX_X, RIVER_MIN_X, hubHeight, hubWeight, riverCenterZ, riverHalfWidthAt } from "../hubLayout"
import { rawWildHeight } from "../baseTerrain"
import { erodedWildHeight } from "../erosion"
import { siteHeight, siteWeight } from "../sites/sites"
import { LANDMARK_RADIUS, landmarkAt, type Landmark } from "../landmarks"
import { mix, smooth } from "../noise"
import { worldHeight } from "../terrain"
import { CHUNK_SIZE, chunkKey } from "../worldConfig"

export type WaterKind = "pond" | "lake" | "river"
export type WaterZone = "shallow" | "deep"
export type WaterPoint = { x: number; z: number; depth: number }
export type ShorePoint = { x: number; y: number; z: number; waterX: number; waterZ: number }
export type WaterArea = {
  id: number; kind: WaterKind; area: number; maxDepth: number; x: number; z: number
  cells: WaterPoint[]; plants: WaterPoint[]; shores: ShorePoint[]
}
export type WaterHabitat = {
  key: string; payload: ChunkPayload; labels: Uint16Array; areas: WaterArea[]
  landmark: Landmark | null; landmarkHeight: number
}

const STEP = 2
const GRID = CHUNK_SIZE / STEP
export const BED_MARGIN = 0.08
export const SURFACE_MARGIN = 0.065
export const waterZone = (depth: number): WaterZone => depth < 1.2 ? "shallow" : "deep"

export const homeWaterKind = (x: number, z: number): WaterKind | null => {
  if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 0.6) return "pond"
  if (x > RIVER_MIN_X && x < RIVER_MAX_X && Math.abs(z - riverCenterZ(x)) < riverHalfWidthAt(x) + 0.35) return "river"
  return null
}

/** The creek travels toward +x; fish hold their noses against this tangent. */
export const riverFlow = (x: number, out: { x: number; z: number }): void => {
  const dz = 0.035 + 0.1995 * Math.cos(x * 0.19) + 0.1288 * Math.cos(x * 0.46)
  const length = Math.hypot(1, dz)
  out.x = 1 / length; out.z = dz / length
}

export const areaAt = (h: WaterHabitat, x: number, z: number): number => {
  const gx = Math.floor((x - h.payload.cx * CHUNK_SIZE) / STEP)
  const gz = Math.floor((z - h.payload.cz * CHUNK_SIZE) / STEP)
  if (gx < 0 || gz < 0 || gx >= GRID || gz >= GRID) return 0
  return h.labels[gz * GRID + gx]
}

/** Conservative maximum over the entire fish footprint, including the same
 * vertices used by shore-clipped water. No terrain/noise sampling in lookahead. */
export const footprintBed = (h: WaterHabitat, x: number, z: number, radius: number): number => {
  const lx = x - h.payload.cx * CHUNK_SIZE, lz = z - h.payload.cz * CHUNK_SIZE
  const x0 = Math.floor(lx - radius), x1 = Math.ceil(lx + radius)
  const z0 = Math.floor(lz - radius), z1 = Math.ceil(lz + radius)
  if (x0 < 0 || z0 < 0 || x1 >= FIELD_N || z1 >= FIELD_N) return Infinity
  let bed = -Infinity
  for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) bed = Math.max(bed, h.payload.heights[j * FIELD_N + i])
  return bed
}

/** Exact worldHeight math with the chunk's landmark cached once. Chunk size
 * divides the landmark grid, so valid fish positions cannot cross its cell.
 * This avoids the string cache key allocated by landmarkAt on every step. */
export const aquaticBedHeight = (h: WaterHabitat, x: number, z: number): number => {
  const weight = hubWeight(x, z)
  if (weight >= 0.999) return hubHeight(x, z)
  const site = siteWeight(x, z)
  let bed = site.w >= 0.999 ? siteHeight(site.site!) : erodedWildHeight(x, z)
  if (site.w > 0.001 && site.w < 0.999) bed = mix(bed, siteHeight(site.site!), site.w)
  const lm = h.landmark
  if (lm && site.w <= 0.001) {
    const radius = LANDMARK_RADIUS[lm.kind], distance = Math.hypot(x - lm.x, z - lm.z)
    if (distance <= radius + 7) bed = mix(bed, h.landmarkHeight, 1 - smooth(radius * 0.8, radius + 7, distance))
  }
  return weight <= 0.001 ? bed : mix(bed, hubHeight(x, z), weight)
}

export const fitsWater = (h: WaterHabitat, area: number, x: number, y: number, z: number, radius: number, halfHeight: number): boolean =>
  areaAt(h, x, z) === area && y + halfHeight <= WATER_LEVEL - SURFACE_MARGIN &&
  y - halfHeight >= Math.max(footprintBed(h, x, z, radius), aquaticBedHeight(h, x, z)) + BED_MARGIN

/** Connected wet regions are measured on the streamed field. Border probes
 * distinguish a narrow slice of a large lake from a genuinely small pond. */
export const classifyWater = (payload: ChunkPayload): WaterHabitat => {
  const landmark = landmarkAt((payload.cx + 0.5) * CHUNK_SIZE, (payload.cz + 0.5) * CHUNK_SIZE)
  const h: WaterHabitat = { key: chunkKey(payload.cx, payload.cz), payload, labels: new Uint16Array(GRID * GRID), areas: [],
    landmark, landmarkHeight: landmark ? rawWildHeight(landmark.x, landmark.z) : 0 }
  // hasWater is intentionally lake-only in chunkGen. Authored home basins
  // still have their real bed in the same field and their own water meshes.
  if (payload.minH >= WATER_LEVEL - 0.22) return h
  const ox = payload.cx * CHUNK_SIZE, oz = payload.cz * CHUNK_SIZE
  const wet = new Uint8Array(GRID * GRID), queue = new Uint16Array(GRID * GRID)
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
    const bed = payload.heights[(j * STEP + 1) * FIELD_N + i * STEP + 1]
    wet[j * GRID + i] = WATER_LEVEL - bed > 0.22 ? 1 : 0
  }
  for (let start = 0; start < wet.length; start++) {
    if (!wet[start] || h.labels[start]) continue
    const id = h.areas.length + 1
    const a: WaterArea = { id, kind: "pond", area: 0, maxDepth: 0, x: 0, z: 0, cells: [], plants: [], shores: [] }
    let head = 0, tail = 1, border = false
    queue[0] = start; h.labels[start] = id
    while (head < tail) {
      const index = queue[head++], i = index % GRID, j = Math.floor(index / GRID)
      const x = ox + i * STEP + 1, z = oz + j * STEP + 1
      const depth = WATER_LEVEL - payload.heights[(j * STEP + 1) * FIELD_N + i * STEP + 1]
      a.cells.push({ x, z, depth }); a.area += STEP * STEP
      if (depth > a.maxDepth) { a.maxDepth = depth; a.x = x; a.z = z }
      if (i === 0 || j === 0 || i === GRID - 1 || j === GRID - 1) border = true
      for (const n of [i > 0 ? index - 1 : -1, i < GRID - 1 ? index + 1 : -1, j > 0 ? index - GRID : -1, j < GRID - 1 ? index + GRID : -1]) {
        if (n >= 0 && wet[n] && !h.labels[n]) { h.labels[n] = id; queue[tail++] = n }
      }
    }
    const home = homeWaterKind(a.x, a.z)
    let outsideWet = 0
    if (border && !home) for (let d = 0; d < 8; d++) {
      const angle = d * Math.PI / 4
      if (worldHeight(a.x + Math.sin(angle) * 14, a.z + Math.cos(angle) * 14) < WATER_LEVEL - 0.25) outsideWet++
    }
    a.kind = home ?? (a.area > 140 || a.maxDepth > 1.35 || outsideWet >= 3 ? "lake" : "pond")
    h.areas.push(a)
  }
  // Existing lily/reed positions are habitat anchors, never another plant draw.
  for (let i = 0; i < payload.scatterCount; i++) {
    const o = i * SCATTER_STRIDE, kind = payload.scatter[o + 5]
    if (kind !== K.lily && kind !== K.reeds) continue
    const x = ox + payload.scatter[o], z = oz + payload.scatter[o + 2]
    let id = areaAt(h, x, z)
    if (!id) for (const a of h.areas) if (a.cells.some(c => (c.x - x) ** 2 + (c.z - z) ** 2 < 16)) { id = a.id; break }
    if (id) h.areas[id - 1].plants.push({ x, z, depth: WATER_LEVEL - worldHeight(x, z) })
  }
  for (const a of h.areas) {
    if (a.kind === "river") continue
    for (const c of a.cells) {
      if (c.depth > 1.2 || a.shores.length >= 8) continue
      for (let d = 0; d < 8; d++) {
        const angle = d * Math.PI / 4
        const x = c.x + Math.sin(angle) * 2.4, z = c.z + Math.cos(angle) * 2.4
        const bed = worldHeight(x, z)
        if (bed < WATER_LEVEL + 0.035 || bed > WATER_LEVEL + 0.42) continue
        if (a.shores.some(s => (s.x - x) ** 2 + (s.z - z) ** 2 < 9)) continue
        a.shores.push({ x, z, y: bed + 0.022, waterX: c.x, waterZ: c.z })
        break
      }
    }
  }
  return h
}
