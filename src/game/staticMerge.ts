import * as THREE from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"

/**
 * Draw-call reduction for authored, motionless scenery.
 *
 * Meshes proven static by the auto-freezer are merged per material into one
 * mesh. Originals stay in the scene graph (so gameplay code can still find
 * and move them) but move to a hidden layer; if one later moves or changes
 * visibility, its group is rebuilt without it.
 */
const HIDDEN_LAYER = 31

type Entry = { mesh: THREE.Mesh; visibleChain: boolean; matHash: string }

const c = (x: THREE.Color | undefined): string => (x ? x.getHexString() : "-")
/** Visual identity of a material: equal hashes render identically. */
const materialHash = (m: THREE.Material): string => {
  const a = m as THREE.MeshStandardMaterial & THREE.MeshPhysicalMaterial
  return [
    m.type, c(a.color), c(a.emissive), a.emissiveIntensity?.toFixed(3), a.roughness?.toFixed(3), a.metalness?.toFixed(3),
    a.map?.uuid ?? "-", a.normalMap?.uuid ?? "-", a.emissiveMap?.uuid ?? "-", a.vertexColors ? 1 : 0, m.side, a.flatShading ? 1 : 0,
    m.opacity.toFixed(3), m.alphaTest, a.sheen ?? "-", a.transmission ?? "-", m.customProgramCacheKey(), (m as THREE.MeshStandardMaterial).fog ? 1 : 0,
    m.onBeforeCompile.toString().length,
  ].join("|")
}
const volatileMaterials = new WeakSet<THREE.Material>()
type Group = { key: string; entries: Entry[]; merged: THREE.Mesh | null }

export const mergeStats = { groups: 0, merged: 0, rebuilds: 0 }

const visibleChain = (o: THREE.Object3D, stop: THREE.Object3D): boolean => {
  let n: THREE.Object3D | null = o
  while (n && n !== stop) {
    if (!n.visible) return false
    n = n.parent
  }
  return true
}

const signature = (g: THREE.BufferGeometry): string =>
  Object.keys(g.attributes)
    .sort()
    .map((k) => {
      const a = g.attributes[k] as THREE.BufferAttribute
      return `${k}${a.itemSize}${a.normalized ? "n" : ""}${(a.array as ArrayLike<number>).constructor.name}`
    })
    .join("|") + (g.index ? "|i" : "")

/** A locally still wing/body can belong to an animal that moves as a whole. */
export const hasDynamicAncestor = (object: THREE.Object3D, stop: THREE.Object3D): boolean => {
  for (let node: THREE.Object3D | null = object; node && node !== stop; node = node.parent) {
    if (node.userData.dynamic === true) return true
  }
  return false
}

export class StaticMerger {
  private groups = new Map<string, Group>()
  private owned = new Map<THREE.Mesh, Group>()
  private inv = new THREE.Matrix4()
  constructor(private root: THREE.Object3D) {}

  eligible(mesh: THREE.Mesh): boolean {
    if (!mesh.isMesh) return false
    if (hasDynamicAncestor(mesh, this.root)) return false
    // A mesh's own local transform being still says nothing about its parents.
    // Only batch after every ancestor has also been proven static.
    for (let parent = mesh.parent; parent && parent !== this.root; parent = parent.parent) {
      if (parent.matrixAutoUpdate) return false
    }
    const any = mesh as unknown as Record<string, unknown>
    if (any.isSkinnedMesh || any.isInstancedMesh || any.isBatchedMesh || any.isPoints || any.isLine) return false
    if (Array.isArray(mesh.material)) return false
    const m = mesh.material as THREE.Material
    if (m.transparent || mesh.morphTargetInfluences || mesh.geometry.morphAttributes.position) return false
    if (mesh.renderOrder !== 0 || mesh.onBeforeRender !== THREE.Mesh.prototype.onBeforeRender) return false
    if (mesh.geometry.attributes.position.count > 20000) return false
    if (!mesh.frustumCulled) return false
    return true
  }

  /** Offer a frozen mesh for merging. */
  add(mesh: THREE.Mesh): void {
    if (this.owned.has(mesh) || !this.eligible(mesh)) return
    const m = mesh.material as THREE.Material
    if (volatileMaterials.has(m)) return
    const matHash = materialHash(m)
    const key = `${matHash}|${signature(mesh.geometry)}|${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}`
    let group = this.groups.get(key)
    if (!group) {
      group = { key, entries: [], merged: null }
      this.groups.set(key, group)
    }
    group.entries.push({ mesh, visibleChain: visibleChain(mesh, this.root), matHash })
    this.owned.set(mesh, group)
    ;(group as Group & { dirty?: boolean }).dirty = true
  }

  /** A previously frozen mesh moved: give it back its own draw call. */
  release(mesh: THREE.Mesh): void {
    const group = this.owned.get(mesh)
    if (!group) return
    this.owned.delete(mesh)
    group.entries = group.entries.filter((e) => e.mesh !== mesh)
    mesh.layers.set(0)
    mesh.matrixWorldAutoUpdate = true
    ;(group as Group & { dirty?: boolean }).dirty = true
  }

  /** Rebuild dirty groups; also detect visibility changes made by gameplay code. */
  flush(): void {
    this.root.updateMatrixWorld()
    this.inv.copy(this.root.matrixWorld).invert()
    let merged = 0
    for (const group of this.groups.values()) {
      const g = group as Group & { dirty?: boolean }
      // a material animated by gameplay code can't share a batch: release it
      for (const e of [...group.entries]) {
        const m = e.mesh.material as THREE.Material
        if (materialHash(m) !== e.matHash) {
          volatileMaterials.add(m)
          this.release(e.mesh)
        }
      }
      for (const e of group.entries) {
        const vis = visibleChain(e.mesh, this.root)
        if (vis !== e.visibleChain) {
          e.visibleChain = vis
          g.dirty = true
        }
      }
      if (!g.dirty) {
        if (group.merged) merged += group.entries.length
        continue
      }
      g.dirty = false
      if (group.merged) {
        this.root.remove(group.merged)
        group.merged.geometry.dispose()
        group.merged = null
        mergeStats.rebuilds++
      }
      const live = group.entries.filter((e) => e.visibleChain)
      if (live.length < 2) {
        for (const e of group.entries) { e.mesh.layers.set(0); e.mesh.matrixWorldAutoUpdate = true }
        continue
      }
      const parts: THREE.BufferGeometry[] = []
      const mat = new THREE.Matrix4()
      for (const e of live) {
        const geo = e.mesh.geometry.clone()
        mat.multiplyMatrices(this.inv, e.mesh.matrixWorld)
        geo.applyMatrix4(mat)
        parts.push(geo)
      }
      const geometry = mergeGeometries(parts, false)
      for (const p of parts) p.dispose()
      if (!geometry) {
        for (const e of group.entries) { e.mesh.layers.set(0); e.mesh.matrixWorldAutoUpdate = true }
        continue
      }
      const first = live[0].mesh
      const mesh = new THREE.Mesh(geometry, first.material)
      mesh.name = "static-merged"
      mesh.castShadow = first.castShadow
      mesh.receiveShadow = first.receiveShadow
      mesh.matrixAutoUpdate = false
      mesh.userData.staticMerged = true
      geometry.computeBoundingSphere()
      this.root.add(mesh)
      mesh.updateMatrixWorld(true)
      group.merged = mesh
      for (const e of group.entries) {
        e.mesh.layers.set(e.visibleChain ? HIDDEN_LAYER : 0)
        e.mesh.matrixWorldAutoUpdate = !e.visibleChain
      }
      merged += live.length
    }
    mergeStats.groups = this.groups.size
    mergeStats.merged = merged
  }

  owns(mesh: THREE.Object3D): boolean {
    return this.owned.has(mesh as THREE.Mesh)
  }

  dispose(): void {
    for (const group of this.groups.values()) {
      if (group.merged) { group.merged.removeFromParent(); group.merged.geometry.dispose() }
      for (const e of group.entries) { e.mesh.layers.set(0); e.mesh.matrixWorldAutoUpdate = true }
    }
    this.groups.clear(); this.owned.clear()
  }
}
