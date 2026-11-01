import { readFileSync } from "node:fs"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { describe, expect, it } from "vitest"
import { HorseAnimator, makeHorsePose } from "../src/game/horses/HorseAnimator"
import type { HorseMeta, HorseModel } from "../src/game/horses/horseAssets"

const load = async (breed: string): Promise<HorseModel> => {
  const bytes = readFileSync(`public/assets/horses/${breed}.glb`)
  // Exercise the shipped skeleton in Node without loading coat images.
  const jsonLength = bytes.readUInt32LE(12)
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString())
  json.materials = []
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material
  let text = JSON.stringify(json)
  while (Buffer.byteLength(text) % 4) text += " "
  const head = Buffer.from(bytes.subarray(0, 20)), rest = bytes.subarray(20 + jsonLength)
  head.writeUInt32LE(20 + Buffer.byteLength(text) + rest.length, 8)
  head.writeUInt32LE(Buffer.byteLength(text), 12)
  const data = Buffer.concat([head, Buffer.from(text), rest])
  const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "")
  const root = new THREE.Group(); root.add(gltf.scene)
  const bones = new Map<string, THREE.Bone>()
  let meta: HorseMeta | undefined
  root.traverse(o => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone)
    if (o.userData.horse) meta = JSON.parse(o.userData.horse) as HorseMeta
  })
  if (!meta) throw new Error("Missing shipped horse metadata")
  return { root, bones, meta, disposed: false, materialByName: new Map(), coat: new THREE.MeshStandardMaterial(), hair: new THREE.MeshStandardMaterial(), lod: [[], []], level: 0, tack: [], materials: [], feathers: null, featherDepth: null, featherUniforms: null }
}

describe("Pegasus pose support after abrupt travel", () => {
  it.each(["ivory", "onyx", "starborn"])("keeps %s's torso and hoof targets attached while flight blends above a distant floor", async breed => {
    const model = await load(breed), animator = new HorseAnimator(model, 33)
    const pose = makeHorsePose(), H = model.meta.height
    pose.ground = () => -2
    pose.speed = 20
    animator.update(pose)
    // Direct travel changes the presentation floor immediately, while fly
    // eases over several frames. The old terrain blend pulled the torso
    // thousands of metres down and left only the riders visible.
    pose.ground = (x, z) => -42000 + x * 0.1 + z * 0.2
    for (let n = 1; n <= 60; n++) {
      pose.fly = Math.min(1, n * 0.1)
      pose.time += pose.dt
      animator.update(pose)
      model.root.updateMatrixWorld(true)
      const hips = model.bones.get("hips")!.getWorldPosition(new THREE.Vector3())
      expect(Number.isFinite(hips.y)).toBe(true)
      expect(Math.abs(hips.y)).toBeLessThan(H * 2)
      for (const leg of animator.dbg) {
        expect(Number.isFinite(leg.cy)).toBe(true)
        expect(Math.abs(Number(leg.cy))).toBeLessThan(H * 2)
      }
      for (const bone of model.bones.values()) {
        const p = bone.getWorldPosition(new THREE.Vector3())
        expect(p.toArray().every(Number.isFinite)).toBe(true)
        expect(p.length()).toBeLessThan(H * 12)
      }
    }
  })

  it("retains exact reachable hoof support on shallow terrain and through a jump arc", async () => {
    const model = await load("starborn"), animator = new HorseAnimator(model, 33)
    const pose = makeHorsePose()
    const floor = (x: number, z: number) => 0.12 + x * 0.05 + z * 0.05
    pose.ground = floor
    animator.update(pose)
    for (const [i, name] of ["hoofFL", "hoofFR", "hoofBL", "hoofBR"].entries()) {
      const target = animator.dbg[i]
      const rest = animator.restPos(name)
      expect(Number(target.cy)).toBeCloseTo(floor(rest.x, Number(target.cz)) + rest.y, 2)
    }
    pose.air = 2
    pose.jump = 0.5
    pose.ground = (x, z) => floor(x, z) - pose.air
    animator.update(pose)
    expect(animator.dbg.every(leg => Number.isFinite(leg.cy))).toBe(true)
    model.root.updateMatrixWorld(true)
    expect(model.bones.get("hips")!.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(1)
  })
})
