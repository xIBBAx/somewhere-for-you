import { buildColliders, distToPath, groundHeight, HOME_RADIUS, POND, RIVER_Z, riverCenterZ, riverEnvelope, riverHalfWidthAt, ROCKS, terrainHeight, TREES, WATER_Y } from "../../world-layout"
import { clamp, smoothstep } from "../../../utils/math"
import { worldHeight } from "../../../world/terrain"
import { biomeWeights, B, BIOME_COUNT } from "../../../world/climate"
import { waterSurfaceAt } from "../../../world/waterSurface"
import { worldStreamRT } from "../../../world/worldRuntime"
import { CHUNK_SIZE, chunkKey } from "../../../world/worldConfig"
import { renderedChunkHeight } from "../../../world/render/terrainGeometry"

export const GROUND_BOUNDS = { x: -48, z: -54, width: 96, depth: 104 }
export const TERRAIN_SEGMENTS = 120
export const SURFACE_RESOLUTION = 256
export type GroundKind = "grass" | "sand" | "soil" | "mud" | "rock" | "water" | "built"
export type GroundSurface = { kind: GroundKind; sand: number; soil: number; moisture: number; grass: number; slope: number; height: number; softness: number }

const fract = (x: number): number => x - Math.floor(x)
export const groundHash = (x: number, z: number): number => fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453123)
export const groundNoise = (x: number, z: number): number => {
  const ix = Math.floor(x), iz = Math.floor(z)
  const u = smoothstep(0, 1, x - ix), v = smoothstep(0, 1, z - iz)
  const a = groundHash(ix, iz), b = groundHash(ix + 1, iz)
  const c = groundHash(ix, iz + 1), d = groundHash(ix + 1, iz + 1)
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v
}

// The actual rendered triangle grid, rather than an independent analytic height,
// is shared by surface detail and terrain-conforming impressions.
const heights = new Float32Array((TERRAIN_SEGMENTS + 1) ** 2)
for (let z = 0; z <= TERRAIN_SEGMENTS; z++) for (let x = 0; x <= TERRAIN_SEGMENTS; x++) {
  heights[z * (TERRAIN_SEGMENTS + 1) + x] = terrainHeight(
    GROUND_BOUNDS.x + x / TERRAIN_SEGMENTS * GROUND_BOUNDS.width,
    GROUND_BOUNDS.z + z / TERRAIN_SEGMENTS * GROUND_BOUNDS.depth,
  )
}
export const renderedGroundHeight = (x: number, z: number): number => {
  const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE)
  const chunk = worldStreamRT.streamer?.chunks.get(chunkKey(cx, cz))
  if (chunk?.payload) {
    // morphed as drawn for the player's distance (world/render/terrainGeometry.ts)
    const s = worldStreamRT.streamer
    const d = s ? Math.hypot(x - s.px, z - s.pz) : Number.NaN
    return renderedChunkHeight(chunk.payload, chunk.lod, x - cx * CHUNK_SIZE, z - cz * CHUNK_SIZE, d, s ? s.px - cx * CHUNK_SIZE : Number.NaN, s ? s.pz - cz * CHUNK_SIZE : Number.NaN)
  }
  if (x < GROUND_BOUNDS.x || x > GROUND_BOUNDS.x + GROUND_BOUNDS.width || z < GROUND_BOUNDS.z || z > GROUND_BOUNDS.z + GROUND_BOUNDS.depth) return worldHeight(x, z)
  const fx = clamp((x - GROUND_BOUNDS.x) / GROUND_BOUNDS.width * TERRAIN_SEGMENTS, 0, TERRAIN_SEGMENTS - 0.0001)
  const fz = clamp((z - GROUND_BOUNDS.z) / GROUND_BOUNDS.depth * TERRAIN_SEGMENTS, 0, TERRAIN_SEGMENTS - 0.0001)
  const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz
  const i = iz * (TERRAIN_SEGMENTS + 1) + ix
  const a = heights[i], b = heights[i + 1], c = heights[i + TERRAIN_SEGMENTS + 1], d = heights[i + TERRAIN_SEGMENTS + 2]
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v)
}

const colliders = buildColliders()
// Existing floor placements read from Fair, TrainingCorner, MemoryStopProps,
// PathAhead and FinaleGarden. They do not all participate in collision.
const steppingStones = Array.from({ length: 7 }, (_, i) => ({
  x: -3 + 2.2 * i / 6 + Math.sin(i * 1.8) * 0.16,
  z: -18.6 - 2.6 * i / 6,
  r: (0.82 - i / 6 * 0.14) * 0.42,
}))
const finaleStones = Array.from({ length: 7 }, (_, i) => ({ x: Math.sin(i * 1.31) * 0.18, z: -26.85 - 3.10 * i / 6, r: 0.52 }))
export const isHardGround = (x: number, z: number): boolean =>
  Math.hypot(x - 0.8, z - 30.2) < 4.90 ||
  Math.hypot(x + 10.45, z + 7.45) < 2.18 ||
  Math.hypot(x + 8.9, z - 12.4) < 1.15 ||
  steppingStones.some(p => Math.hypot(x - p.x, z - p.z) < p.r) ||
  finaleStones.some(p => Math.hypot(x - p.x, z - p.z) < p.r)

export const groundDetailHeight = (x: number, z: number): number =>
  renderedGroundHeight(x, z)
export const groundObstacle = (x: number, z: number): boolean =>
  colliders.circles.some(c => (x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + 0.10) ** 2) ||
  colliders.rects.some(r => x > r.minX - 0.12 && x < r.maxX + 0.12 && z > r.minZ - 0.12 && z < r.maxZ + 0.12)

const biomeScratch = new Float32Array(BIOME_COUNT)
export const sampleGround = (x: number, z: number, wetness = 0): GroundSurface => {
  const height = renderedGroundHeight(x, z)
  const dx = (renderedGroundHeight(x + 0.10, z) - renderedGroundHeight(x - 0.10, z)) / 0.20
  const dz = (renderedGroundHeight(x, z + 0.10) - renderedGroundHeight(x, z - 0.10)) / 0.20
  const slope = Math.hypot(dx, dz)
  if (Math.hypot(x, z + 2) > HOME_RADIUS + 1) {
    const water = waterSurfaceAt(x, z)
    biomeWeights(x, z, biomeScratch)
    const woods = biomeScratch[B.forest] + biomeScratch[B.pine] + biomeScratch[B.autumn]
    const shore = water === null ? Math.max(0, 1 - Math.abs(height - WATER_Y) / 0.7) : 1
    const soil = woods * 0.75
    const moisture = clamp(wetness * 0.65 + woods * 0.12 + shore * 0.35, 0, 1)
    const kind: GroundKind = water !== null ? "water" : slope > 0.78 ? "rock" : shore > 0.6 ? "sand" : soil > 0.4 ? (moisture > 0.5 ? "mud" : "soil") : "grass"
    return { kind, height, slope, soil, moisture, sand: shore, grass: kind === "grass" ? 0.65 : 0.15,
      softness: kind === "water" ? 0 : kind === "rock" ? 0.03 : kind === "grass" ? 0.12 : kind === "mud" ? 0.8 : 0.4 }
  }
  const pond = Math.hypot(x - POND.x, z - POND.z) - POND.r
  const creek = riverEnvelope(x) > 0.05 ? Math.abs(z - riverCenterZ(x)) - riverHalfWidthAt(x) : 100
  const bank = Math.min(pond, creek)
  const noise = groundNoise(x * 0.65, z * 0.65)
  const path = 1 - smoothstep(0.75, 2.05 + (noise - 0.5) * 0.6, distToPath(x, z))
  const shoreline = (1 - smoothstep(0.4, 1.9, bank)) * (1 - smoothstep(0.4, 0.85, slope))
  const canopy = TREES.reduce((value, t) => Math.max(value, (1 - smoothstep(0.3, 2.6 * t.s, Math.hypot(x - t.x, z - t.z))) * 0.75), 0)
  const moisture = clamp((1 - smoothstep(0.1, 2.6, bank)) * 0.8 + canopy * 0.10 + wetness * 0.65, 0, 1)
  const sand = clamp(shoreline * (0.6 + noise * 0.35) + path * 0.32, 0, 1)
  let soil = clamp(path * 0.86 + canopy * 0.55 + shoreline * 0.3, 0, 1)
  let grass = (1 - Math.max(path * 0.97, shoreline * 0.98)) * (0.38 + groundNoise(x * 0.45, z * 0.45) * 0.62) * (1 - canopy * 0.65)
  let kind: GroundKind = sand > 0.5 ? "sand" : soil > 0.5 ? "soil" : "grass"
  if (moisture > 0.55 && (soil > 0.35 || shoreline > 0.3) && sand < 0.8) kind = "mud"
  if (Math.hypot(x, z + 30.5) < 6.4) { kind = "grass"; grass = 0.30 + noise * 0.25; soil *= 0.15 }
  const bridge = Math.abs(x) <= 1.6 && Math.abs(z - RIVER_Z) <= 2.5
  if (bridge || isHardGround(x, z) || groundHeight(x, z) > height + 0.16) kind = "built"
  else if (bank < 0.7 && height < WATER_Y + 0.015) kind = "water"
  else if (slope > 0.78 || Math.hypot(x, z + 2) > HOME_RADIUS + 0.1 || ROCKS.some(r => Math.hypot(x - r.x, z - r.z) < r.s * 0.37)) kind = "rock"
  if (kind === "water" || kind === "built" || kind === "rock" || groundObstacle(x, z)) grass = 0
  const softness = kind === "mud" ? 0.72 + moisture * 0.28 : kind === "sand" ? 0.46 + moisture * 0.2 : kind === "soil" ? 0.12 + moisture * 0.25 : kind === "grass" ? 0.12 : kind === "rock" || kind === "built" ? 0.03 : 0
  return { kind, sand, soil, moisture, grass, slope, height, softness }
}

export const makeSurfaceField = (): Uint8Array => {
  const data = new Uint8Array(SURFACE_RESOLUTION ** 2 * 4)
  for (let z = 0; z < SURFACE_RESOLUTION; z++) for (let x = 0; x < SURFACE_RESOLUTION; x++) {
    const surface = sampleGround(GROUND_BOUNDS.x + (x + 0.5) / SURFACE_RESOLUTION * GROUND_BOUNDS.width, GROUND_BOUNDS.z + (z + 0.5) / SURFACE_RESOLUTION * GROUND_BOUNDS.depth)
    const i = (z * SURFACE_RESOLUTION + x) * 4
    data[i] = surface.sand * 255
    data[i + 1] = surface.soil * 255
    data[i + 2] = surface.moisture * 255
    data[i + 3] = surface.grass * 255
  }
  return data
}
