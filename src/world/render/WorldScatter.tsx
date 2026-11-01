import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { avatarRT } from "../../game/runtime"
import type { CircleCollider } from "../../game/world-layout"
import { K, SCATTER_STRIDE } from "../chunkGen"
import { chunkColliders, nearbyWorldColliders, SCATTER_COLLIDER_RADIUS, SCATTER_CROWN } from "../colliders"
import { rectTouchesHighvale } from "../highvale/highvaleLayout"
import { inRealm, realmColliders } from "../realmHook"
import { originRT } from "../origin"
import type { ChunkState } from "../streamer"
import { subscribeChunks, worldStreamRT } from "../worldRuntime"
import { CHUNK_SIZE } from "../worldConfig"
import { loadVegetationLibrary, highvaleVegetationRT, type VegetationLibrary } from "./vegetationLibrary"
import { compactVisibleInstances, writeInstanceBounds } from "./instanceVisibility"

/**
 * Scatter items taken by the player (picked flowers). They are removed from
 * their instance pools now and skipped whenever their chunk streams back in.
 * Session-only: meadows regrow when the world is next opened.
 */
export const pickedScatter = new Set<string>()
let removeItemImpl: ((key: string, item: number) => void) | null = null
export const removeScatterItem = (key: string, item: number): void => {
  pickedScatter.add(`${key}:${item}`)
  removeItemImpl?.(key, item)
}
import {
  barkDepthMaterial,
  barkMaterial,
  foliageDepthMaterial,
  foliageMaterial,
  logMaterial,
  propsMaterial,
  rockMaterial,
} from "./vegetationMaterials"

/**
 * Renders every chunk's deterministic scatter as one InstancedMesh per
 * geometry and LOD band (~100 true instanced draws). BatchedMesh looked like
 * ~7 draw calls but multi-draw expands to one driver draw per instance on
 * ANGLE/Mesa paths, which capped the wilderness at ~30 fps; instancing is a
 * single driver call regardless of tree count. Pools grow by doubling and
 * remove instances by swapping the last one into the hole.
 *
 *  near (chunk LOD 0)  : detailed trunks/crowns, rocks, flowers, reeds — cast shadows
 *  far  (chunk LOD 1/2): low-poly trunks/crowns and boulders — no shadows
 *
 * Instance matrices are stored relative to the floating origin and rebuilt
 * on rebase, so they never lose float32 precision far from home.
 */

type Role = "barkNear" | "barkFar" | "leavesNear" | "leavesFar" | "solidNear" | "solidFar" | "small"

type Part = { role: Role; geometry: string }

const TREE_NAMES: Record<number, string> = {
  [K.oak]: "oak",
  [K.linden]: "linden",
  [K.birch]: "birch",
  [K.pine]: "pine",
  [K.gulmohar]: "sakura",
  [K.maple]: "maple",
  [K.willow]: "willow",
  [K.glow]: "glow",
  [K.cedar]: "cedar",
}
/** Geometries the library holds (a cedar falls back to a pine until Highvale's trees arrive). */
const available = new Set<string>()
const FLOWER_SPECIES = ["daisy", "poppy", "buttercup", "cosmos", "cornflower", "lavender", "tulip"]

const partsFor = (kind: number, variant: number, near: boolean, detail: boolean, out: Part[]): Part[] => {
  out.length = 0
  const v = variant < 0.5 ? 0 : 1
  const lod = near ? 0 : 1
  if (kind < 10) {
    let name = `tree_${TREE_NAMES[kind]}_${v}_lod${lod}`
    if (kind === K.cedar && !available.has(name)) name = `tree_pine_${v}_lod${lod}`
    out.push({ role: near ? "barkNear" : "barkFar", geometry: name })
    out.push({ role: near ? "leavesNear" : "leavesFar", geometry: `${name}_leaves` })
  } else if (kind === K.bush || kind === K.blossomBush || kind === K.fern) {
    if (!near && !detail) return out
    const base = kind === K.bush ? "bush" : kind === K.blossomBush ? "blossombush" : "fern"
    out.push({ role: near ? "leavesNear" : "leavesFar", geometry: `${base}_${v}_lod${lod}_leaves` })
  } else if (kind === K.boulder) {
    out.push({ role: near ? "solidNear" : "solidFar", geometry: `rock_boulder_${v}_lod${lod}` })
  } else if (kind === K.stones) {
    if (near) out.push({ role: "solidNear", geometry: `rock_stones_${v}_lod0` })
  } else if (kind === K.log) {
    out.push({ role: near ? "solidNear" : "solidFar", geometry: `prop_log_0_lod${lod}` })
  } else if (kind === K.mushrooms) {
    if (near) out.push({ role: "solidNear", geometry: `prop_mushrooms_${Math.min(2, Math.floor(variant * 3))}_lod0` })
  } else if (kind === K.flower) {
    if (near) out.push({ role: "small", geometry: `flower_${FLOWER_SPECIES[Math.min(6, Math.floor(variant * 7))]}_lod0` })
  } else if (kind === K.reeds) {
    if (near) out.push({ role: "small", geometry: "prop_reeds_0_lod0" })
  } else if (kind === K.lily) {
    if (near) out.push({ role: "small", geometry: `prop_lily_${v}_lod0` })
  }
  return out
}

/** Per-species colour grading and per-instance variation. */
const tintFor = (kind: number, variant: number, tint: number, role: Role, out: THREE.Color): THREE.Color => {
  const bright = 0.86 + tint * 0.26
  if (role === "barkNear" || role === "barkFar") return out.setRGB(bright, bright, bright)
  if (kind === K.maple) {
    // autumn crowns drift between amber, orange and crimson
    const hue = tint
    return out.setRGB(1.05 * bright, (0.72 + hue * 0.35) * bright, (0.7 + hue * 0.1) * bright)
  }
  // gulmohar flowers are flame-coloured: pull green and blue well below the authored pale crown
  if (kind === K.gulmohar || kind === K.blossomBush) return out.setRGB(bright * 1.18, (0.52 + tint * 0.12) * bright, (0.26 + variant * 0.1) * bright)
  if (kind === K.flower) return out.setRGB(1, 1, 1)
  return out.setRGB((0.92 + tint * 0.14) * bright, bright, (0.9 + variant * 0.14) * bright)
}

type Pool = { mesh: THREE.InstancedMesh; owners: Slot[]; dirty: boolean;
  matrices: Float32Array; colors: Float32Array; bounds: Float32Array }
type Slot = { pool: Pool; index: number; item: number }
type ChunkScatter = {
  chunk: ChunkState
  near: boolean
  /** built with the understory (bushes, ferns): chunk LOD 0 or 1 */
  detail: boolean
  slots: Slot[]
  colliders: CircleCollider[]
}


export const scatterStats = { instances: 0, drawn: 0, chunks: 0 }

export const WorldScatter = (): React.ReactElement => {
  const { camera, scene } = useThree()
  const root = useMemo(() => {
    const g = new THREE.Group()
    g.name = "world-scatter"
    return g
  }, [])

  useEffect(() => {
    let disposed = false
    const pools = new Map<string, Pool>()
    const roleOf = new Map<string, Role>()
    const chunks = new Map<string, ChunkScatter>()
    const parts: Part[] = []
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const pos = new THREE.Vector3()
    const scl = new THREE.Vector3()
    const col = new THREE.Color()
    const up = new THREE.Vector3(0, 1, 0)
    let library: VegetationLibrary | null = null
    let originVersion = originRT.version
    let lastColliderX = Number.NaN
    let lastColliderZ = Number.NaN
    let lastRealmVersion = -1
    const queued: ChunkState[] = []
    const viewFrustum = new THREE.Frustum(), shadowFrustum = new THREE.Frustum()
    const projection = new THREE.Matrix4()
    const lastView = new THREE.Matrix4(), lastShadow = new THREE.Matrix4()

    const setup = (lib: VegetationLibrary): void => {
      for (const name of lib.geometries.keys()) {
        available.add(name)
        const lod0 = name.includes("_lod0")
        const leaves = name.endsWith("_leaves")
        if (name.startsWith("tree_")) roleOf.set(name, leaves ? (lod0 ? "leavesNear" : "leavesFar") : lod0 ? "barkNear" : "barkFar")
        else if (leaves) roleOf.set(name, lod0 ? "leavesNear" : "leavesFar")
        else if (name.startsWith("rock_") || name.startsWith("prop_log") || name.startsWith("prop_mushrooms")) roleOf.set(name, lod0 ? "solidNear" : "solidFar")
        else if (lod0) roleOf.set(name, "small")
      }
    }

    const makeMesh = (geometryName: string, role: Role, capacity: number): THREE.InstancedMesh => {
      const material = role.startsWith("bark") ? barkMaterial() : role.startsWith("leaves") ? foliageMaterial() : geometryName.startsWith("rock_") ? rockMaterial() : geometryName.startsWith("prop_log") ? logMaterial() : propsMaterial()
      const mesh = new THREE.InstancedMesh(library!.geometries.get(geometryName)!, material, capacity)
      mesh.name = `scatter-${role}-${geometryName}`
      mesh.count = 0
      // Visibility is compacted per instance without splitting the draw batch.
      mesh.frustumCulled = false
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
      const near = role.endsWith("Near")
      mesh.castShadow = near
      mesh.receiveShadow = true
      if (role === "leavesNear") mesh.customDepthMaterial = foliageDepthMaterial()
      if (role === "barkNear") mesh.customDepthMaterial = barkDepthMaterial()
      mesh.position.set(originRT.x, 0, originRT.z)
      return mesh
    }

    const poolFor = (geometryName: string): Pool | null => {
      const existing = pools.get(geometryName)
      if (existing) return existing
      const role = roleOf.get(geometryName)
      if (!role || !library?.geometries.has(geometryName)) return null
      const pool: Pool = { mesh: makeMesh(geometryName, role, 64), owners: [], dirty: true,
        matrices: new Float32Array(64 * 16), colors: new Float32Array(64 * 3), bounds: new Float32Array(64 * 4) }
      pools.set(geometryName, pool)
      root.add(pool.mesh)
      return pool
    }

    const grow = (pool: Pool, geometryName: string): void => {
      const old = pool.mesh
      const mesh = makeMesh(geometryName, roleOf.get(geometryName)!, old.instanceMatrix.count * 2)
      const matrices = new Float32Array(pool.matrices.length * 2)
      const colors = new Float32Array(pool.colors.length * 2)
      const bounds = new Float32Array(pool.bounds.length * 2)
      matrices.set(pool.matrices); colors.set(pool.colors); bounds.set(pool.bounds)
      pool.matrices = matrices; pool.colors = colors; pool.bounds = bounds
      root.remove(old)
      old.dispose()
      root.add(mesh)
      pool.mesh = mesh
      pool.dirty = true
    }

    const addInstance = (geometryName: string, matrix: THREE.Matrix4, color: THREE.Color, item: number): Slot | null => {
      const pool = poolFor(geometryName)
      if (!pool) return null
      if (pool.owners.length >= pool.mesh.instanceMatrix.count) grow(pool, geometryName)
      const index = pool.owners.length
      matrix.toArray(pool.matrices, index * 16)
      color.toArray(pool.colors, index * 3)
      writeInstanceBounds(pool.bounds, index, pool.mesh.geometry.boundingSphere!, matrix)
      const slot: Slot = { pool, index, item }
      pool.owners[index] = slot
      pool.dirty = true
      return slot
    }

    const removeInstance = (slot: Slot): void => {
      const { pool } = slot
      const last = pool.owners.length - 1
      if (slot.index !== last) {
        const ma = pool.matrices
        const ca = pool.colors
        ma.copyWithin(slot.index * 16, last * 16, last * 16 + 16)
        ca.copyWithin(slot.index * 3, last * 3, last * 3 + 3)
        pool.bounds.copyWithin(slot.index * 4, last * 4, last * 4 + 4)
        const moved = pool.owners[last]
        moved.index = slot.index
        pool.owners[slot.index] = moved
      }
      pool.owners.length = last
      pool.dirty = true
    }

    const writeMatrix = (chunk: ChunkState, item: number, out: THREE.Matrix4): void => {
      const s = chunk.payload!.scatter
      const o = item * SCATTER_STRIDE
      pos.set(chunk.cx * CHUNK_SIZE + s[o] - originRT.x, s[o + 1], chunk.cz * CHUNK_SIZE + s[o + 2] - originRT.z)
      // sink trunks a touch so roots never float on coarse far terrain
      if (s[o + 5] < 10) pos.y -= 0.12
      q.setFromAxisAngle(up, s[o + 4])
      const sc = s[o + 3]
      scl.set(sc, sc, sc)
      out.compose(pos, q, scl)
    }

    const addChunk = (chunk: ChunkState): void => {
      if (!library || !chunk.payload) return
      removeChunk(chunk.key)
      const near = chunk.lod === 0
      const detail = chunk.lod <= 1
      const entry: ChunkScatter = { chunk, near, detail, slots: [], colliders: [] }
      const s = chunk.payload.scatter
      for (let item = 0; item < chunk.payload.scatterCount; item++) {
        const o = item * SCATTER_STRIDE
        const kind = s[o + 5]
        if (kind === K.flower && pickedScatter.size && pickedScatter.has(`${chunk.key}:${item}`)) continue
        const variant = s[o + 6]
        const tint = s[o + 7]
        partsFor(kind, variant, near, detail, parts)
        if (parts.length) writeMatrix(chunk, item, m)
        for (const part of parts) {
          const slot = addInstance(part.geometry, m, tintFor(kind, variant, tint, part.role, col), item)
          if (slot) entry.slots.push(slot)
        }
        const r = SCATTER_COLLIDER_RADIUS[kind]
        if (r) {
          const crown = SCATTER_CROWN[kind]
          // a young cedar's branches sweep the ground in a broad skirt: you go
          // round it, not through it (a mature one is clear of branches below ~3 m)
          const skirt = kind === K.cedar && variant < 0.5 ? 1.5 : 0
          entry.colliders.push({
            x: chunk.cx * CHUNK_SIZE + s[o],
            z: chunk.cz * CHUNK_SIZE + s[o + 2],
            r: Math.max(r, skirt) * s[o + 3],
            height: kind === K.boulder ? 1.1 * s[o + 3] : 4.5 * s[o + 3],
            jumpable: kind === K.boulder && s[o + 3] < 0.9,
            standable: kind === K.boulder,
            // the crown, for whatever flies (pegasus/flight.ts solidTopAt)
            crown: crown ? crown[0] * s[o + 3] : undefined,
            crownR: crown ? crown[1] * s[o + 3] : undefined,
          })
        }
      }
      chunks.set(chunk.key, entry)
      chunkColliders.set(chunk.key, entry.colliders)
      lastColliderX = Number.NaN
    }

    removeItemImpl = (key, item) => {
      const entry = chunks.get(key)
      if (!entry) return
      for (let i = entry.slots.length - 1; i >= 0; i--) {
        if (entry.slots[i].item !== item) continue
        removeInstance(entry.slots[i])
        entry.slots.splice(i, 1)
      }
    }

    const removeChunk = (key: string): void => {
      const entry = chunks.get(key)
      if (!entry) return
      for (const slot of entry.slots) removeInstance(slot)
      chunks.delete(key)
      chunkColliders.delete(key)
      lastColliderX = Number.NaN
    }

    const rebuildMatrices = (): void => {
      for (const entry of chunks.values()) {
        for (const slot of entry.slots) {
          writeMatrix(entry.chunk, slot.item, m)
          m.toArray(slot.pool.matrices, slot.index * 16)
          writeInstanceBounds(slot.pool.bounds, slot.index, slot.pool.mesh.geometry.boundingSphere!, m)
          slot.pool.dirty = true
        }
      }
    }

    const unsubscribe = subscribeChunks({
      onChunkReady: (chunk) => (library ? addChunk(chunk) : queued.push(chunk)),
      onChunkLodChange: (chunk) => {
        const entry = chunks.get(chunk.key)
        const near = chunk.lod === 0
        // rebuild only when crossing the near/far boundary or the understory's
        // band, both ways (a chunk back from LOD 2 regains its bushes at once)
        if (!entry || entry.near !== near || entry.detail !== chunk.lod <= 1) addChunk(chunk)
      },
      onChunkUnload: (chunk) => removeChunk(chunk.key),
    })

    loadVegetationLibrary().then((lib) => {
      if (disposed) return
      library = lib
      setup(lib)
      for (const chunk of queued) if (worldStreamRT.streamer?.chunks.get(chunk.key) === chunk) addChunk(chunk)
      queued.length = 0
    })
    // Highvale's own trees arrive with the valley: re-dress any of its chunks
    // already standing (they wore pines meanwhile)
    let highvaleVersion = highvaleVegetationRT.version
    const highvaleWatch = window.setInterval(() => {
      if (disposed || !library || highvaleVegetationRT.version === highvaleVersion) return
      highvaleVersion = highvaleVegetationRT.version
      setup(library)
      for (const entry of [...chunks.values()]) {
        const x0 = entry.chunk.cx * CHUNK_SIZE, z0 = entry.chunk.cz * CHUNK_SIZE
        if (rectTouchesHighvale(x0, z0, x0 + CHUNK_SIZE, z0 + CHUNK_SIZE)) addChunk(entry.chunk)
      }
    }, 500)

    // per-frame: origin rebase + nearby colliders
    const tick = (viewCamera: THREE.Camera = camera): void => {
      if (originVersion !== originRT.version) {
        originVersion = originRT.version
        rebuildMatrices()
      }
      viewCamera.updateMatrixWorld()
      projection.multiplyMatrices(viewCamera.projectionMatrix, viewCamera.matrixWorldInverse)
      const moved = !projection.equals(lastView)
      viewFrustum.setFromProjectionMatrix(projection)
      lastView.copy(projection)
      const light = scene.getObjectByName("celestial-key") as THREE.DirectionalLight | undefined
      const shadowCamera = light?.shadow.camera
      let shadowMoved = false
      if (shadowCamera) {
        projection.multiplyMatrices(shadowCamera.projectionMatrix, shadowCamera.matrixWorldInverse)
        shadowMoved = !projection.equals(lastShadow)
        shadowFrustum.setFromProjectionMatrix(projection)
        lastShadow.copy(projection)
      }
      let drawn = 0
      for (const pool of pools.values()) {
        pool.mesh.position.set(originRT.x, 0, originRT.z)
        if (pool.dirty || moved || (pool.mesh.castShadow && shadowMoved)) {
          pool.dirty = false
          pool.mesh.count = compactVisibleInstances(pool.matrices, pool.colors, pool.bounds, pool.owners.length,
            pool.mesh.instanceMatrix.array as Float32Array, pool.mesh.instanceColor!.array as Float32Array,
            viewFrustum, pool.mesh.castShadow && shadowCamera ? shadowFrustum : undefined)
          pool.mesh.instanceMatrix.needsUpdate = true
          pool.mesh.instanceColor!.needsUpdate = true
        }
        drawn += pool.mesh.count
      }
      const px = avatarRT().pos.x
      const pz = avatarRT().pos.z
      if (!(Math.abs(px - lastColliderX) < 3 && Math.abs(pz - lastColliderZ) < 3) || realmColliders.version !== lastRealmVersion) {
        lastColliderX = px
        lastColliderZ = pz
        lastRealmVersion = realmColliders.version
        nearbyWorldColliders.length = 0
        // on another world: its boulders and hardware instead of home's trees
        if (inRealm(px, pz)) for (const c of realmColliders.list) if (Math.abs(c.x - px) < 26 && Math.abs(c.z - pz) < 26) nearbyWorldColliders.push(c)
        for (const entry of chunks.values()) {
          const cx = (entry.chunk.cx + 0.5) * CHUNK_SIZE
          const cz = (entry.chunk.cz + 0.5) * CHUNK_SIZE
          if (Math.abs(cx - px) > 60 || Math.abs(cz - pz) > 60) continue
          for (const c of entry.colliders) {
            if (Math.abs(c.x - px) < 26 && Math.abs(c.z - pz) < 26) nearbyWorldColliders.push(c)
          }
        }
      }
      let instances = 0
      for (const entry of chunks.values()) instances += entry.slots.length
      scatterStats.instances = instances
      scatterStats.drawn = drawn
      scatterStats.chunks = chunks.size
    }
    tickRef.current = tick

    return () => {
      disposed = true
      window.clearInterval(highvaleWatch)
      tickRef.current = null
      removeItemImpl = null
      unsubscribe()
      for (const pool of pools.values()) {
        root.remove(pool.mesh)
        pool.mesh.dispose()
      }
      pools.clear()
      for (const key of chunks.keys()) chunkColliders.delete(key)
      chunks.clear()
      nearbyWorldColliders.length = 0
    }
  }, [camera, scene, root])

  useFrame(() => tickRef.current?.())

  return <primitive object={root} />
}

const tickRef: { current: ((camera?: THREE.Camera) => void) | null } = { current: null }
export const prepareScatterVisibility = (camera: THREE.Camera): void => tickRef.current?.(camera)
