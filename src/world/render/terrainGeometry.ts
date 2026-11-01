import * as THREE from "three"
import { FIELD_N, FIELD_RES, FIELD_STEP, type ChunkPayload } from "../chunkGen"
import { STREAM_CONFIG } from "../streamer"
import { CHUNK_SIZE, LOD_SEGMENTS, type TerrainLod } from "../worldConfig"

/**
 * Terrain chunk meshes. All chunks of a given LOD share one index buffer;
 * per-chunk vertex attributes are copied out of the worker's full-resolution
 * field (every 1st/2nd/4th sample). Downward skirts hide the tiny T-junction
 * cracks where neighbouring chunks use different LODs.
 */
const SKIRT_DEPTH = 1.6

/**
 * Geomorphing. Every vertex of a LOD 0 or 1 mesh also carries what the next
 * coarser mesh has at that point (height, colour, masks), and the vertex
 * shader slides toward it with distance from the player. A chunk switches
 * LOD only once its centre is lodHysteresis past the boundary, so its
 * nearest vertex is then at least that minus the half-diagonal away: the
 * morph has finished there, and the switch changes nothing on screen. Shared
 * edges with a coarser neighbour are always fully morphed, so the
 * T-junctions close exactly.
 */
export const MORPH_BAND = 35
const HALF_DIAGONAL = (CHUNK_SIZE / 2) * Math.SQRT2
/** Distance from the player at which a mesh of this LOD has fully become the next. */
export const morphEnd = (lod: TerrainLod): number =>
  lod === 0 ? STREAM_CONFIG.lod0Radius - STREAM_CONFIG.lodHysteresis - HALF_DIAGONAL
    : lod === 1 ? STREAM_CONFIG.lod1Radius - STREAM_CONFIG.lodHysteresis - HALF_DIAGONAL
      : Infinity
/** How far a LOD's surface has morphed toward the next at this distance (as the shader does). */
export const morphWeight = (lod: TerrainLod, distance: number): number => {
  if (lod >= 2 || !(distance >= 0)) return 0
  const end = morphEnd(lod)
  const t = Math.min(1, Math.max(0, (distance - (end - MORPH_BAND)) / MORPH_BAND))
  return t * t * (3 - 2 * t)
}

/** Field index of the samples whose mean is the coarser mesh at (fi, fj): itself on the coarse grid, else the two ends of the coarse edge it lies on. */
const coarsePair = (fi: number, fj: number, stride: number): [number, number] => {
  const k = fj * FIELD_N + fi
  const ei = fi % (stride * 2) !== 0, ej = fj % (stride * 2) !== 0
  if (!ei && !ej) return [k, k]
  if (ei && !ej) return [k - stride, k + stride]
  if (!ei && ej) return [k - stride * FIELD_N, k + stride * FIELD_N]
  // a coarse quad's centre lies on its diagonal b–c (the split, a→c→b, b→c→d)
  return [k + stride - stride * FIELD_N, k - stride + stride * FIELD_N]
}

/** One LOD's triangle surface at chunk-local (lx, lz): exactly what is drawn. */
const lodSurface = (h: Float32Array, segments: number, lx: number, lz: number): number => {
  const stride = FIELD_RES / segments
  const gx = (lx / CHUNK_SIZE) * segments
  const gz = (lz / CHUNK_SIZE) * segments
  const ix = Math.min(segments - 1, Math.max(0, Math.floor(gx)))
  const iz = Math.min(segments - 1, Math.max(0, Math.floor(gz)))
  const u = gx - ix, v = gz - iz, i = iz * stride * FIELD_N + ix * stride
  const a = h[i], b = h[i + stride], c = h[i + stride * FIELD_N], d = h[i + stride * (FIELD_N + 1)]
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v)
}

/**
 * The rendered ground height at chunk-local (lx, lz) of a chunk drawn at
 * this LOD, morphed as the shader morphs it for a player `distance` away
 * (NaN: unmorphed). Animals, prints and impressions stand on this.
 */
export const renderedChunkHeight = (
  payload: ChunkPayload, lod: TerrainLod, lx: number, lz: number, distance: number,
  playerLocalX = Number.NaN, playerLocalZ = Number.NaN,
): number => {
  const segments = LOD_SEGMENTS[lod]
  if (lod >= 2 || !Number.isFinite(playerLocalX) || !Number.isFinite(playerLocalZ)) {
    const fine = lodSurface(payload.heights, segments, lx, lz)
    const w = morphWeight(lod, distance)
    return w > 0 ? fine + (lodSurface(payload.heights, segments / 2, lx, lz) - fine) * w : fine
  }
  // The GPU weights each vertex BEFORE rasterizing the triangle. Blending two
  // sampled surfaces at the query's distance differs within a morph band,
  // making tiny creatures and footprints float above the actual triangle.
  const stride = FIELD_RES / segments
  const gx = Math.min(segments, Math.max(0, lx / CHUNK_SIZE * segments))
  const gz = Math.min(segments, Math.max(0, lz / CHUNK_SIZE * segments))
  const ix = Math.min(segments - 1, Math.floor(gx)), iz = Math.min(segments - 1, Math.floor(gz))
  const u = gx - ix, v = gz - iz
  const vertex = (i: number, j: number): number => {
    const fi = i * stride, fj = j * stride, h = payload.heights[fj * FIELD_N + fi]
    const [a, b] = coarsePair(fi, fj, stride)
    const w = morphWeight(lod, Math.hypot(fi * FIELD_STEP - playerLocalX, fj * FIELD_STEP - playerLocalZ))
    return h + ((payload.heights[a] + payload.heights[b]) / 2 - h) * w
  }
  const b = vertex(ix + 1, iz), c = vertex(ix, iz + 1)
  if (u + v <= 1) { const a = vertex(ix, iz); return a + (b - a) * u + (c - a) * v }
  const d = vertex(ix + 1, iz + 1)
  return d + (c - d) * (1 - u) + (b - d) * (1 - v)
}

const vertexCount = (seg: number): number => (seg + 1) * (seg + 1) + 4 * seg

const indexCache = new Map<number, THREE.BufferAttribute>()

const buildIndex = (seg: number): THREE.BufferAttribute => {
  const cached = indexCache.get(seg)
  if (cached) return cached
  const n = seg + 1
  const idx: number[] = []
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * n + i
      const b = a + 1
      const c = a + n
      const d = c + 1
      // split along a→d keeps it consistent with the scatter height sampler
      idx.push(a, c, b, b, c, d)
    }
  }
  // perimeter (counter-clockwise from (0,0)) with skirt duplicates
  const perimeter = perimeterOrder(seg)
  const base = n * n
  for (let p = 0; p < perimeter.length; p++) {
    const q = (p + 1) % perimeter.length
    const top0 = perimeter[p]
    const top1 = perimeter[q]
    const bot0 = base + p
    const bot1 = base + q
    // double-sided skirt so it's visible from both chunk sides
    idx.push(top0, bot0, top1, top1, bot0, bot1)
    idx.push(top0, top1, bot0, top1, bot1, bot0)
  }
  const attr = new THREE.Uint16BufferAttribute(idx, 1)
  indexCache.set(seg, attr)
  return attr
}

const perimeterCache = new Map<number, number[]>()
const perimeterOrder = (seg: number): number[] => {
  const cached = perimeterCache.get(seg)
  if (cached) return cached
  const n = seg + 1
  const out: number[] = []
  for (let i = 0; i < seg; i++) out.push(i) // z = 0 edge
  for (let j = 0; j < seg; j++) out.push(j * n + seg) // x = max edge
  for (let i = seg; i > 0; i--) out.push(seg * n + i) // z = max edge
  for (let j = seg; j > 0; j--) out.push(j * n) // x = 0 edge
  perimeterCache.set(seg, out)
  return out
}

const pools = new Map<number, THREE.BufferGeometry[]>()

const allocate = (lod: TerrainLod): THREE.BufferGeometry => {
  const seg = LOD_SEGMENTS[lod]
  const pool = pools.get(seg)
  const reused = pool?.pop()
  if (reused) return reused
  const count = vertexCount(seg)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Int8Array(count * 3), 3, true))
  geometry.setAttribute("color", new THREE.BufferAttribute(new Uint8Array(count * 4), 4, true))
  geometry.setAttribute("aux", new THREE.BufferAttribute(new Uint8Array(count * 4), 4, true))
  // x: height to add to become the coarser mesh; y: morphEnd for this LOD
  geometry.setAttribute("aMorph", new THREE.BufferAttribute(new Float32Array(count * 2), 2))
  geometry.setAttribute("aCoarseColor", new THREE.BufferAttribute(new Uint8Array(count * 4), 4, true))
  geometry.setAttribute("aCoarseAux", new THREE.BufferAttribute(new Uint8Array(count * 4), 4, true))
  geometry.setIndex(buildIndex(seg))
  geometry.userData.seg = seg
  return geometry
}

/** Return a geometry to its LOD pool for reuse (keeps GPU buffers alive). */
export const releaseTerrainGeometry = (geometry: THREE.BufferGeometry): void => {
  const seg = geometry.userData.seg as number
  let pool = pools.get(seg)
  if (!pool) {
    pool = []
    pools.set(seg, pool)
  }
  if (pool.length < 48) pool.push(geometry)
  else geometry.dispose()
}

export const buildTerrainGeometry = (payload: ChunkPayload, lod: TerrainLod): THREE.BufferGeometry => {
  const seg = LOD_SEGMENTS[lod]
  const stride = FIELD_RES / seg
  const geometry = allocate(lod)
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute
  const nor = geometry.getAttribute("normal") as THREE.BufferAttribute
  const col = geometry.getAttribute("color") as THREE.BufferAttribute
  const aux = geometry.getAttribute("aux") as THREE.BufferAttribute
  const morph = geometry.getAttribute("aMorph") as THREE.BufferAttribute
  const coarseCol = geometry.getAttribute("aCoarseColor") as THREE.BufferAttribute
  const coarseAux = geometry.getAttribute("aCoarseAux") as THREE.BufferAttribute
  const M = morph.array as Float32Array
  const CC = coarseCol.array as Uint8Array
  const CA = coarseAux.array as Uint8Array
  // LOD 2 has nothing coarser: no morph (aMorph = 0, coarse = itself)
  const morphs = lod < 2
  const end = morphs ? morphEnd(lod) : 0
  const P = pos.array as Float32Array
  const Nn = nor.array as Int8Array
  const C = col.array as Uint8Array
  const A = aux.array as Uint8Array
  const n = seg + 1
  const write = (v: number, fi: number, fj: number, yOffset: number): void => {
    const k = fj * FIELD_N + fi
    P[v * 3] = fi * FIELD_STEP
    P[v * 3 + 1] = payload.heights[k] + yOffset
    P[v * 3 + 2] = fj * FIELD_STEP
    Nn[v * 3] = payload.normals[k * 3]
    Nn[v * 3 + 1] = payload.normals[k * 3 + 1]
    Nn[v * 3 + 2] = payload.normals[k * 3 + 2]
    for (let c = 0; c < 4; c++) {
      C[v * 4 + c] = payload.colors[k * 4 + c]
      A[v * 4 + c] = payload.aux[k * 4 + c]
    }
    const [k0, k1] = morphs ? coarsePair(fi, fj, stride) : [k, k]
    M[v * 2] = (payload.heights[k0] + payload.heights[k1]) / 2 - payload.heights[k]
    M[v * 2 + 1] = end
    for (let c = 0; c < 4; c++) {
      CC[v * 4 + c] = (payload.colors[k0 * 4 + c] + payload.colors[k1 * 4 + c] + 1) >> 1
      CA[v * 4 + c] = (payload.aux[k0 * 4 + c] + payload.aux[k1 * 4 + c] + 1) >> 1
    }
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) write(j * n + i, i * stride, j * stride, 0)
  const perimeter = perimeterOrder(seg)
  for (let p = 0; p < perimeter.length; p++) {
    const v = perimeter[p]
    const i = v % n
    const j = Math.floor(v / n)
    write(n * n + p, i * stride, j * stride, -SKIRT_DEPTH)
  }
  pos.needsUpdate = true
  nor.needsUpdate = true
  col.needsUpdate = true
  aux.needsUpdate = true
  morph.needsUpdate = true
  coarseCol.needsUpdate = true
  coarseAux.needsUpdate = true
  const half = CHUNK_SIZE / 2
  const midY = (payload.minH + payload.maxH) / 2
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(half, midY, half),
    Math.hypot(half, half, (payload.maxH - payload.minH) / 2 + SKIRT_DEPTH),
  )
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(0, payload.minH - SKIRT_DEPTH, 0),
    new THREE.Vector3(CHUNK_SIZE, payload.maxH, CHUNK_SIZE),
  )
  return geometry
}
