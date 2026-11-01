import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { readFileSync } from "node:fs"
import { RigPoser } from "../src/game/rig/RigPoser"
import { WingAnimator, makeWingPose, type WingPose } from "../src/game/pegasus/WingAnimator"

/**
 * The wing poses on the shipped Pegasi's real skeletons (node transforms read
 * straight from public/assets/horses/<breed>.glb). The folded wing must close
 * as a bird's does, along the upper flank behind the shoulder with every
 * flight feather laid back, never standing up over the back or reaching
 * forward to the neck.
 */

type GltfNode = { name?: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; extras?: { horse?: string } }

type Gltf = {
  nodes: GltfNode[]; scenes: Array<{ nodes: number[] }>; skins: Array<{ joints: number[]; inverseBindMatrices: number }>
  meshes: Array<{ name: string; primitives: Array<{ attributes: Record<string, number> }> }>
  accessors: Array<{ bufferView: number; byteOffset?: number; componentType: number; normalized?: boolean; count: number; type: string }>
  bufferViews: Array<{ byteOffset?: number; byteStride?: number }>
}

const load = (breed: string) => {
  const b = readFileSync(`public/assets/horses/${breed}.glb`)
  const jl = b.readUInt32LE(12)
  const gj = JSON.parse(b.subarray(20, 20 + jl).toString()) as Gltf
  const bin = 20 + jl + 8
  /** read one element of an accessor (floats, normalized or plain bytes/shorts) */
  const accessor = (i: number) => {
    const a = gj.accessors[i]
    const bv = gj.bufferViews[a.bufferView]
    const off = bin + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0)
    const n = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as Record<string, number>)[a.type]
    const cs = a.componentType === 5126 ? 4 : a.componentType === 5122 || a.componentType === 5123 ? 2 : 1
    const st = bv.byteStride ?? n * cs
    const read = (o: number): number =>
      a.componentType === 5126 ? b.readFloatLE(o)
        : a.componentType === 5121 ? b.readUInt8(o) / (a.normalized ? 255 : 1)
          : a.componentType === 5123 ? b.readUInt16LE(o) / (a.normalized ? 65535 : 1)
            : b.readInt16LE(o) / (a.normalized ? 32767 : 1)
    return { count: a.count, get: (k: number) => Array.from({ length: n }, (_, c) => read(off + k * st + c * cs)) }
  }
  const objs = gj.nodes.map((n) => {
    const o = new THREE.Bone()
    o.name = n.name ?? ""
    if (n.translation) o.position.fromArray(n.translation)
    if (n.rotation) o.quaternion.fromArray(n.rotation)
    if (n.scale) o.scale.fromArray(n.scale)
    return o
  })
  gj.nodes.forEach((n, i) => n.children?.forEach((c) => objs[i].add(objs[c])))
  const root = new THREE.Group()
  for (const i of gj.scenes[0].nodes) root.add(objs[i])
  root.updateMatrixWorld(true)
  const meta = JSON.parse(gj.nodes.find((n) => n.extras?.horse)!.extras!.horse!)
  const bones = new Map<string, THREE.Bone>()
  root.traverse((o) => { if (/^wing|^(root|hips|spine\d|chest|neck\d|head)$/.test(o.name)) bones.set(o.name, o as THREE.Bone) })
  const P = new RigPoser(root, bones)
  const W = new WingAnimator(P, meta.wing.groups, meta.wing.kind, () => 0.5)
  return { root, objs, gj, accessor, bones, P, W, meta }
}

const NAMES = ["wingHum", "wingFore", "wingHand", "wingTip"]
const DEG = Math.PI / 180

type Rig = ReturnType<typeof load>
const frame = (r: Rig, w: Partial<WingPose>): void => {
  r.P.reset()
  r.W.update(r.P, { ...makeWingPose(), ...w }, 1 / 60)
  r.P.apply()
}
/** Discrete anatomical endpoints need to reach the articulated pose. Continuous
 * motion checks below use frame() directly and retain their original bounds. */
const pose = (r: Rig, w: Partial<WingPose>): void => {
  for (let n = 0; n < 120; n++) frame(r, w)
}
const joints = (r: Rig, side: "L" | "R"): THREE.Vector3[] => NAMES.map((n) => r.P.posedHead(`${n}${side}`, new THREE.Vector3()))

/** Folded direction of a flight feather at angle θ (out from straight back) on arm bone i, group g. */
const featherDir = (r: Rig, side: "L" | "R", i: number, g: number, theta: number): THREE.Vector3 => {
  const sg = side === "L" ? 1 : -1
  const a = r.P.pos(`${NAMES[i]}${side}`)
  const b = i < 3 ? r.P.pos(`${NAMES[i + 1]}${side}`) : new THREE.Vector3(...(r.meta.marks?.[`wingTipEnd${side}`] ?? [a.x + sg * 0.3, a.y, a.z - 0.1]))
  const d = b.clone().sub(a).normalize()
  const u = new THREE.Vector3(0, 1, 0).addScaledVector(d, -d.y).normalize()
  const f = new THREE.Vector3().crossVectors(d, u).multiplyScalar(sg)
  const t = theta * DEG
  const along = f.multiplyScalar(-Math.cos(t)).addScaledVector(d, Math.sin(t))
  // the vertex shader's swing about the feather's base (rest model space)
  const [lo, hi] = r.meta.wing.groups[String(g)] as [number, number]
  const k = Math.min(1, Math.max(0, (theta - lo) / (hi - lo)))
  const gi = g + (side === "R" ? 5 : 0)
  const ang = sg * (r.W.featherA[gi] + r.W.featherFan[gi] * k)
  const c = Math.cos(ang), s = Math.sin(ang)
  const swung = new THREE.Vector3(along.x * c + along.z * s, along.y, -along.x * s + along.z * c)
  return swung.applyQuaternion(r.P.accumulated(`${NAMES[i]}${side}`, new THREE.Quaternion())).normalize()
}

/**
 * Every wing vertex of the shipped mesh in the current pose, as the GPU puts
 * it: the feather shader's swing about its base, then linear-blend skinning.
 */
const skinnedWing = (r: Rig): Array<{ p: THREE.Vector3; left: boolean; arm: boolean }> => {
  r.root.updateMatrixWorld(true)
  const skin = r.gj.skins[0]
  const ibm = r.accessor(skin.inverseBindMatrices)
  const mats = skin.joints.map((ji, k) => new THREE.Matrix4().multiplyMatrices(r.objs[ji].matrixWorld, new THREE.Matrix4().fromArray(ibm.get(k))))
  const at = r.gj.meshes.find((m) => m.name === "wings")!.primitives[0].attributes
  const POS = r.accessor(at.POSITION), FB = r.accessor(at._FBASE), FG = r.accessor(at._FGROUP), J = r.accessor(at.JOINTS_0), Wt = r.accessor(at.WEIGHTS_0)
  const out: Array<{ p: THREE.Vector3; left: boolean; arm: boolean }> = []
  const v = new THREE.Vector3(), t = new THREE.Vector3()
  for (let k = 0; k < POS.count; k++) {
    const pos = POS.get(k), fb = FB.get(k), code = FG.get(k)[0]
    v.fromArray(pos)
    if (code > -0.5) {
      const right = code >= 9.5
      const c0 = right ? code - 10 : code
      const g = Math.floor(c0 + 1e-3)
      const kk = Math.min(1, Math.max(0, (c0 + 1e-4 - Math.floor(c0 + 1e-4)) / 0.9))
      const gi = g + (right ? 5 : 0)
      const a = (right ? -1 : 1) * (r.W.featherA[gi] + r.W.featherFan[gi] * kk)
      const dx = v.x - fb[0], dz = v.z - fb[2], c = Math.cos(a), s = Math.sin(a)
      v.set(fb[0] + dx * c + dz * s, v.y, fb[2] - dx * s + dz * c)
    }
    const p = new THREE.Vector3()
    const js = J.get(k), ws = Wt.get(k)
    for (let i = 0; i < 4; i++) if (ws[i] > 0) p.addScaledVector(t.copy(v).applyMatrix4(mats[js[i]]), ws[i])
    // which wing: the side of the bone that carries it most (a tertial's inner
    // tip can lie a few cm past the midline even at rest)
    const main = js[ws.indexOf(Math.max(...ws))]
    // the scapulars ride the shoulder girdle alone: body cover, not the folding wing
    const arm = js.some((j, i) => ws[i] > 0.05 && !r.objs[skin.joints[j]].name.startsWith("wingRoot"))
    out.push({ p, left: r.objs[skin.joints[main]].name.endsWith("L"), arm })
  }
  return out
}

// the arm bone each feather group grows on
const GROUP_BONE = [0, 1, 1, 2, 3]

describe.each(["ivory", "onyx", "starborn"])("the folded wing (%s)", (breed) => {
  const r = load(breed)

  it("has a near-equal humerus and forearm, as a large bird's", () => {
    const [s, e, w] = NAMES.slice(0, 3).map((n) => r.P.pos(`${n}L`))
    const hum = e.distanceTo(s)
    const fore = w.distanceTo(e)
    expect(fore / hum).toBeGreaterThan(0.8)
    expect(fore / hum).toBeLessThan(1.15)
  })

  for (const ridden of [0, 1]) {
    it(`closes as a Z along the upper flank${ridden ? ", raised over a rider's legs" : ""}`, () => {
      pose(r, { spread: 0, ridden })
      for (const side of ["L", "R"] as const) {
        const sg = side === "L" ? 1 : -1
        const [s, e, w, t] = joints(r, side)
        // elbow well back, wrist folded back beside the shoulder (not up by
        // the neck), hand and digits running back again
        expect(e.z).toBeLessThan(s.z - 0.35)
        expect(w.z).toBeLessThan(s.z + 0.15)
        expect(w.z).toBeGreaterThan(s.z - 0.3)
        expect(t.z).toBeLessThan(w.z - 0.2)
        // to the side of the spine, never crossing it, and no higher than a
        // little over the shoulder
        for (const j of [e, w, t]) {
          expect(j.x * sg).toBeGreaterThan(0.12)
          expect(j.y).toBeLessThan(s.y + (ridden ? 0.35 : 0.15))
          expect(j.y).toBeGreaterThan(s.y - 0.4)
        }
      }
    })

    it(`lays every flight feather back along the body${ridden ? " (ridden)" : ""}`, () => {
      pose(r, { spread: 0, ridden })
      for (const side of ["L", "R"] as const) {
        const sg = side === "L" ? 1 : -1
        for (let g = 0; g < 5; g++) {
          const [lo, hi] = r.meta.wing.groups[String(g)] as [number, number]
          for (const th of [lo, (lo + hi) / 2, hi]) {
            const d = featherDir(r, side, GROUP_BONE[g], g, th)
            expect(d.z, `group ${g} θ ${th}`).toBeLessThan(-0.8)
            // not standing up over the back, not tucked in under the spine
            expect(d.y, `group ${g} θ ${th}`).toBeLessThan(ridden ? 0.5 : 0.35)
            expect(d.x * sg, `group ${g} θ ${th}`).toBeGreaterThan(-0.3)
          }
        }
      }
    })
  }

  for (const ridden of [0, 1]) {
    it(`leaves nothing of the closed wing standing over the withers or across the spine${ridden ? " (ridden)" : ""}`, () => {
      pose(r, { spread: 0, ridden })
      const shoulder = r.P.posedHead("wingHumL", new THREE.Vector3())
      let top = -Infinity
      let across = Infinity
      for (const { p, left, arm } of skinnedWing(r)) {
        top = Math.max(top, p.y)
        if (arm) across = Math.min(across, left ? p.x : -p.x)
      }
      // the tertials may ride a hand's breadth over the shoulder to cover the stack
      expect(top - shoulder.y).toBeLessThan(ridden ? 0.42 : 0.28)
      expect(across).toBeGreaterThan(-0.02)
    })
  }

  it("mirrors left and right in every symmetric pose", () => {
    for (const w of [{ spread: 0 }, { spread: 0, ridden: 1 }, { spread: 0.5 }, { spread: 1, glide: 1 }, { spread: 1, power: 1, flap: 0.3 }, { spread: 1, power: 1, flap: 0.8 }, { spread: 1, flare: 1, flap: 0.2 }]) {
      pose(r, w)
      const L = joints(r, "L")
      const R = joints(r, "R")
      L.forEach((l, i) => {
        expect(R[i].x).toBeCloseTo(-l.x, 4)
        expect(R[i].y).toBeCloseTo(l.y, 4)
        expect(R[i].z).toBeCloseTo(l.z, 4)
      })
      for (let g = 0; g < 5; g++) {
        expect(r.W.featherA[5 + g]).toBeCloseTo(r.W.featherA[g], 6)
        expect(r.W.featherFan[5 + g]).toBeCloseTo(r.W.featherFan[g], 6)
      }
    }
  })

  it("opens and closes, and beats, without a jump", () => {
    const track = (seq: Array<Partial<WingPose>>): number => {
      let prev: THREE.Vector3[] | null = null
      let worst = 0
      pose(r, seq[0])
      for (const w of seq) {
        frame(r, w)
        const now = joints(r, "L")
        if (prev) now.forEach((p, i) => { worst = Math.max(worst, p.distanceTo(prev![i])) })
        prev = now
      }
      return worst
    }
    const opening = Array.from({ length: 51 }, (_, i) => ({ spread: i / 50 }))
    const raised = Array.from({ length: 51 }, (_, i) => ({ spread: i / 50, ridden: 1 }))
    // two strokes, across the wrap from the top of one to the next
    const beat = Array.from({ length: 481 }, (_, i) => ({ spread: 1, power: 1, flap: (i / 240) % 1 }))
    // a 2 % step of the spread or a 240th of a stroke moves no joint more than a few cm
    expect(track(opening)).toBeLessThan(0.12)
    expect(track(raised)).toBeLessThan(0.12)
    expect(track(beat)).toBeLessThan(0.08)
    // and while opening the wing never sweeps down into the body or the riders
    pose(r, opening[0])
    for (const w of opening) {
      frame(r, w)
      const [s, ...rest] = joints(r, "L")
      for (const j of rest) expect(j.y).toBeGreaterThan(s.y - 0.45)
    }
  })
})
