import * as THREE from "three"

/**
 * Generic procedural posing for skinned rigs (The explorer and the wildlife).
 *
 * Rotations are model-space deltas applied on top of the rest pose and they
 * compose down the hierarchy (local = A⁻¹·D·A·restLocal, A = parent's rest
 * model rotation). Legs are solved with analytic two-bone IK that keeps each
 * joint bending the way it bends in the rest pose.
 */
export type BoneRec = {
  bone: THREE.Bone
  restQ: THREE.Quaternion
  restP: THREE.Vector3
  parentRestModelQ: THREE.Quaternion
  parentRestModelQInv: THREE.Quaternion
  restModelPos: THREE.Vector3
  restModelQ: THREE.Quaternion
}

const _e = new THREE.Euler()
const _q = new THREE.Quaternion()
const _m1 = new THREE.Matrix4()
const _m2 = new THREE.Matrix4()
const a1 = new THREE.Vector3()
const a2 = new THREE.Vector3()
const a3 = new THREE.Vector3()
const b1 = new THREE.Vector3()
const b2 = new THREE.Vector3()
const b3 = new THREE.Vector3()

export const frameRotation = (dirA: THREE.Vector3, poleA: THREE.Vector3, dirB: THREE.Vector3, poleB: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion => {
  a1.copy(dirA).normalize()
  a2.copy(poleA).addScaledVector(a1, -poleA.dot(a1)).normalize()
  a3.crossVectors(a1, a2)
  b1.copy(dirB).normalize()
  b2.copy(poleB).addScaledVector(b1, -poleB.dot(b1)).normalize()
  b3.crossVectors(b1, b2)
  _m1.makeBasis(a1, a2, a3).transpose()
  _m2.makeBasis(b1, b2, b3).multiply(_m1)
  return out.setFromRotationMatrix(_m2)
}

export type LegSpec = {
  upper: string
  lower: string
  /** bone whose head is the IK target (the joint below `lower`) */
  end: string
  len1: number
  len2: number
  restDir1: THREE.Vector3
  restDir2: THREE.Vector3
  /** rest bend direction (pole) in model space */
  pole: THREE.Vector3
}

export class RigPoser {
  readonly recs = new Map<string, BoneRec>()
  readonly deltas = new Map<string, THREE.Quaternion>()
  private order: string[] = []
  private chains = new Map<string, BoneRec[]>()
  private posedQ = new THREE.Quaternion()
  private headOffset = new THREE.Vector3()
  private translate = new THREE.Vector3()
  private ikTo = new THREE.Vector3()
  private ikPole = new THREE.Vector3()
  private ikDir1 = new THREE.Vector3()
  private ikDir2 = new THREE.Vector3()
  private ikKnee = new THREE.Vector3()
  private ikQ1 = new THREE.Quaternion()
  private ikQ2 = new THREE.Quaternion()
  private ikLocal = new THREE.Quaternion()

  constructor(root: THREE.Object3D, bones: Map<string, THREE.Bone>) {
    root.updateMatrixWorld(true)
    const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert()
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const scl = new THREE.Vector3()
    for (const [name, bone] of bones) {
      // Poses explicitly compose their local matrices below. Reduced-rate
      // animals need no quaternion composition on the intervening frames.
      bone.matrixAutoUpdate = false
      const model = new THREE.Matrix4().multiplyMatrices(rootInv, bone.matrixWorld)
      model.decompose(pos, quat, scl)
      const pq = new THREE.Quaternion()
      const parentModel = new THREE.Matrix4().multiplyMatrices(rootInv, bone.parent ? bone.parent.matrixWorld : new THREE.Matrix4())
      parentModel.decompose(new THREE.Vector3(), pq, new THREE.Vector3())
      this.recs.set(name, {
        bone,
        restQ: bone.quaternion.clone(),
        restP: bone.position.clone(),
        parentRestModelQ: pq.clone(),
        parentRestModelQInv: pq.clone().invert(),
        restModelPos: pos.clone(),
        restModelQ: quat.clone(),
      })
      this.deltas.set(name, new THREE.Quaternion())
    }
    // parents before children
    const depth = (b: THREE.Object3D): number => (b.parent && this.recs.has(b.parent.name) ? 1 + depth(b.parent) : 0)
    this.order = [...this.recs.keys()].sort((x, y) => depth(this.recs.get(x)!.bone) - depth(this.recs.get(y)!.bone))
    for (const name of this.order) {
      const chain: BoneRec[] = []
      let bone: THREE.Object3D | null = this.recs.get(name)!.bone
      while (bone && this.recs.has(bone.name)) { chain.push(this.recs.get(bone.name)!); bone = bone.parent }
      this.chains.set(name, chain.reverse())
    }
  }

  has(name: string): boolean {
    return this.recs.has(name)
  }

  pos(name: string): THREE.Vector3 {
    return this.recs.get(name)!.restModelPos
  }

  reset(): void {
    for (const d of this.deltas.values()) d.identity()
    for (const r of this.recs.values()) r.bone.position.copy(r.restP)
  }

  euler(name: string, x: number, y: number, z: number): void {
    const d = this.deltas.get(name)
    if (!d) return
    _e.set(x, y, z, "YXZ")
    d.setFromEuler(_e)
  }

  setDelta(name: string, q: THREE.Quaternion): void {
    this.deltas.get(name)?.copy(q)
  }

  scale(name: string, x: number, y: number, z: number): void {
    this.recs.get(name)?.bone.scale.set(x, y, z)
  }

  /** Translate a bone by a model-space offset (e.g. hips bob). */
  offset(name: string, x: number, y: number, z: number): void {
    const r = this.recs.get(name)
    if (!r) return
    _q.copy(r.parentRestModelQInv)
    r.bone.position.copy(r.restP).add(a1.set(x, y, z).applyQuaternion(_q))
  }

  accumulated(name: string, out: THREE.Quaternion): THREE.Quaternion {
    out.identity()
    const chain = this.chains.get(name)
    if (chain) for (const rec of chain) out.multiply(this.deltas.get(rec.bone.name)!)
    return out
  }

  /** Model-space position of a bone's head given current deltas (rest-relative chain). */
  posedHead(name: string, out: THREE.Vector3): THREE.Vector3 {
    const chain = this.chains.get(name)
    if (!chain) return out.set(0, 0, 0)
    // walk down: each head = parent head + accumulatedRot(parent) * (restOffset) + translation offsets
    const acc = this.posedQ.identity()
    for (let i = 0; i < chain.length; i++) {
      const r = chain[i]
      const translate = this.translate.copy(r.bone.position).sub(r.restP).applyQuaternion(r.parentRestModelQ)
      if (i === 0) out.copy(r.restModelPos).add(translate)
      else {
        const prev = chain[i - 1]
        out.add(this.headOffset.copy(r.restModelPos).sub(prev.restModelPos).applyQuaternion(acc)).add(translate.applyQuaternion(acc))
      }
      acc.multiply(this.deltas.get(r.bone.name)!)
    }
    return out
  }

  apply(): void {
    for (const name of this.order) {
      const rec = this.recs.get(name)!
      const d = this.deltas.get(name)!
      _q.copy(rec.parentRestModelQInv).multiply(d).multiply(rec.parentRestModelQ).multiply(rec.restQ)
      rec.bone.quaternion.copy(_q)
      rec.bone.updateMatrix()
    }
  }

  leg(upper: string, lower: string, end: string): LegSpec {
    const p1 = this.pos(upper)
    const p2 = this.pos(lower)
    const p3 = this.pos(end)
    const d1 = p2.clone().sub(p1)
    const d2 = p3.clone().sub(p2)
    const line = p3.clone().sub(p1).normalize()
    const knee = p2.clone().sub(p1)
    const pole = knee.addScaledVector(line, -knee.dot(line))
    if (pole.lengthSq() < 1e-8) pole.set(0, 0, 1)
    return { upper, lower, end, len1: d1.length(), len2: d2.length(), restDir1: d1.normalize(), restDir2: d2.normalize(), pole: pole.normalize() }
  }

  /**
   * Two-bone IK: place `leg.end`'s head at `target` (model space). `parentQ`
   * is the accumulated delta of the upper bone's parent; `poleRot` rotates
   * the rest pole (e.g. by the body's yaw/roll).
   */
  solveLeg(leg: LegSpec, hip: THREE.Vector3, target: THREE.Vector3, parentQ: THREE.Quaternion): void {
    const L1 = leg.len1
    const L2 = leg.len2
    const to = this.ikTo.subVectors(target, hip)
    const dist = Math.min(Math.max(to.length(), 0.01), L1 + L2 - 0.0005)
    const u = to.normalize()
    const pole = this.ikPole.copy(leg.pole).applyQuaternion(parentQ)
    const w = pole.addScaledVector(u, -pole.dot(u))
    if (w.lengthSq() < 1e-8) w.set(0, 0, 1)
    w.normalize()
    const cosA = Math.min(1, Math.max(-1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)))
    const a = Math.acos(cosA)
    const dir1 = this.ikDir1.copy(u).multiplyScalar(Math.cos(a)).addScaledVector(w, Math.sin(a))
    const knee = this.ikKnee.copy(hip).addScaledVector(dir1, L1)
    const ankle = this.ikDir2.copy(hip).addScaledVector(u, dist)
    const dir2 = ankle.sub(knee).normalize()
    const restPole = leg.pole
    const M1 = frameRotation(leg.restDir1, restPole, dir1, w, this.ikQ1)
    const M2 = frameRotation(leg.restDir2, restPole, dir2, w, this.ikQ2)
    this.setDelta(leg.upper, this.ikLocal.copy(parentQ).invert().multiply(M1))
    this.setDelta(leg.lower, this.ikLocal.copy(M1).invert().multiply(M2))
    // keep the end bone's rest orientation in model space (paw flat)
    this.setDelta(leg.end, this.ikLocal.copy(M2).invert())
  }
}
