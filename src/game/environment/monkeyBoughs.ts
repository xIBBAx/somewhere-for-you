import * as THREE from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { BRANCH_SPRINGS, branchShape, type MonkeyBranch } from "../animals/monkeyHabitat"
import { TREES } from "../world-layout"

/**
 * The monkeys' boughs as one bendable mesh per bark.
 *
 * DeciduousTreeSystem used to draw these boughs as rigid instances; they are
 * drawn here instead, at the same size (its 0.095 -> 0.042 taper times
 * 0.72 * tree scale), so they can bend with `BRANCH_SPRINGS`. Every vertex
 * remembers its bough and its fraction t along it, and each frame drops by
 * q * phi(t): the same deflection the feet are planted on in
 * `branchFootPoint`. Deflections stay small next to the length (a few cm on
 * ~3 m), so the rings shear down rather than rotate, and the rest normals hold.
 */
export type BoughMesh = {
  geometry: THREE.BufferGeometry
  /** rest y of every vertex */
  restY: Float32Array
  /** fraction along the bough (0 at the trunk, 1 at the tip); attachments are 0 */
  along: Float32Array
  branch: Int16Array
  /** the drop each bough was last drawn with, so idle boughs cost nothing */
  drawn: Float32Array
}

const RADIAL = 9
const RINGS = 10
const _dir = new THREE.Vector3()
const _mid = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _m = new THREE.Matrix4()
const UP = new THREE.Vector3(0, 1, 0)

/** The tree's bough radii for this branch (palms carry no tree bough: slimmer). */
export const boughRadii = (branch: MonkeyBranch): [number, number] => {
  const tree = TREES[branch.tree]
  return branch.tree === 53 ? [0.075, 0.04] : [0.095 * 0.72 * tree.s, 0.042 * 0.72 * tree.s]
}

export const buildBoughMesh = (branches: MonkeyBranch[]): BoughMesh | null => {
  if (!branches.length) return null
  const parts: THREE.BufferGeometry[] = []
  const along: number[] = []
  const ids: number[] = []
  for (const branch of branches) {
    const [r0, r1] = boughRadii(branch)
    // the short stub from the bark into the bough's root never moves
    const attach = branch.trunk.clone()
    attach.y = branch.base.y - 0.04
    for (const [from, to, rings, bends] of [[attach, branch.base, 1, false], [branch.base, branch.tip, RINGS, true]] as const) {
      _dir.subVectors(to, from)
      const length = _dir.length()
      const g = new THREE.CylinderGeometry(bends ? r1 : r0, r0, length, RADIAL, rings, !bends)
      _q.setFromUnitVectors(UP, _dir.normalize())
      _mid.copy(from).add(to).multiplyScalar(0.5)
      g.applyMatrix4(_m.compose(_mid, _q, new THREE.Vector3(1, 1, 1)))
      const pos = g.attributes.position
      for (let i = 0; i < pos.count; i++) {
        // fraction along the axis from the bough's root
        const t = bends
          ? THREE.MathUtils.clamp((pos.getX(i) - from.x) * _dir.x + (pos.getY(i) - from.y) * _dir.y + (pos.getZ(i) - from.z) * _dir.z, 0, length) / length
          : 0
        along.push(t)
        ids.push(branch.id)
      }
      parts.push(g.index ? g.toNonIndexed() : g)
      g.dispose()
    }
  }
  const geometry = mergeGeometries(parts, false)!
  for (const p of parts) p.dispose()
  const pos = geometry.attributes.position as THREE.BufferAttribute
  pos.setUsage(THREE.DynamicDrawUsage)
  const restY = new Float32Array(pos.count)
  for (let i = 0; i < pos.count; i++) restY[i] = pos.getY(i)
  return {
    geometry, restY,
    along: Float32Array.from(along),
    branch: Int16Array.from(ids),
    drawn: new Float32Array(BRANCH_SPRINGS.length),
  }
}

/** Drop every vertex by its bough's current deflection. Returns true if anything moved. */
export const bendBoughMesh = (mesh: BoughMesh): boolean => {
  let changed = false
  for (let b = 0; b < BRANCH_SPRINGS.length; b++) {
    if (Math.abs(BRANCH_SPRINGS[b].q - mesh.drawn[b]) > 2e-4) changed = true
  }
  if (!changed) return false
  const pos = mesh.geometry.attributes.position as THREE.BufferAttribute
  const arr = pos.array as Float32Array
  for (let i = 0; i < pos.count; i++) {
    const t = mesh.along[i]
    arr[i * 3 + 1] = t > 0 ? mesh.restY[i] - BRANCH_SPRINGS[mesh.branch[i]].q * branchShape(t) : mesh.restY[i]
  }
  for (let b = 0; b < BRANCH_SPRINGS.length; b++) mesh.drawn[b] = BRANCH_SPRINGS[b].q
  pos.needsUpdate = true
  return true
}
