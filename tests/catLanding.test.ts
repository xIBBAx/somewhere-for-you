/// <reference types="node" />
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import type { AnimalModel } from "../src/world/wildlife/animalAssets"
import { QuadrupedAnimator, type AnimalPose } from "../src/world/wildlife/QuadrupedAnimator"

const load = async (): Promise<{ root: THREE.Group; model: AnimalModel }> => {
  const bytes = readFileSync("public/assets/animals/cat.glb")
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "")
  const root = new THREE.Group()
  root.add(gltf.scene)
  const bones = new Map<string, THREE.Bone>()
  const meshes: THREE.SkinnedMesh[] = []
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone)
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh)
  })
  return { root, model: { root, bones, meshes, material: new THREE.MeshStandardMaterial() } }
}

const pose: AnimalPose = {
  dt: 1 / 60, time: 0, speed: 0, turnRate: 0, sit: 0, sleep: 0, graze: 0, happy: 0, swim: 0,
  lookYaw: 0, lookPitch: 0, slope: 0, crossSlope: 0, fullIK: true,
}
const paw = (model: AnimalModel, name: string): THREE.Vector3 => model.bones.get(name)!.getWorldPosition(new THREE.Vector3())

describe("a cat's jump and landing", () => {
  it("plants each paw on the ground actually under it, not on one fitted plane", async () => {
    const { root, model } = await load()
    const animator = new QuadrupedAnimator("cat", model, 7)
    // flat ground first
    animator.update({ ...pose, groundAt: () => 0 })
    root.updateMatrixWorld(true)
    const flatFL = paw(model, "legFL3").y
    const flatBR = paw(model, "legBR3").y
    // a bump under the left forepaw only (+x is her left, +z her front)
    const bump = (x: number, z: number): number => (x > 0 && z > 0 ? 0.035 : 0)
    for (let i = 0; i < 3; i++) animator.update({ ...pose, groundAt: bump })
    root.updateMatrixWorld(true)
    expect(paw(model, "legFL3").y - flatFL).toBeGreaterThan(0.025)
    expect(Math.abs(paw(model, "legBR3").y - flatBR)).toBeLessThan(0.006)
  })

  it("stages the legs through the arc and lands forepaws first", async () => {
    const { root, model } = await load()
    const animator = new QuadrupedAnimator("cat", model, 8)
    const at = (leapT: number): { fy: number; fz: number; hy: number; hz: number } => {
      animator.update({ ...pose, leap: 1, leapT, gather: 0 })
      root.updateMatrixWorld(true)
      const f = paw(model, "legFL3"), h = paw(model, "legBL3")
      return { fy: f.y, fz: f.z, hy: h.y, hz: h.z }
    }
    const start = at(0.02), top = at(0.45), late = at(0.96)
    // over the top the forelegs reach far forward and the hind legs trail
    expect(top.fz).toBeGreaterThan(start.fz + 0.03)
    // the hind legs drive back off the ground at the spring
    expect(start.hz).toBeLessThan(top.hz + 0.02)
    // reaching to land: forepaws drop back below their stretched height and
    // sit lower than the still-tucked hind paws, so they touch first
    expect(late.fy).toBeLessThan(top.fy - 0.02)
    expect(late.fy).toBeLessThan(late.hy)
  })

  it("sinks over the legs on touchdown and gathers before the spring", async () => {
    const { root, model } = await load()
    const animator = new QuadrupedAnimator("cat", model, 9)
    animator.update({ ...pose })
    root.updateMatrixWorld(true)
    const standing = model.bones.get("hips")!.getWorldPosition(new THREE.Vector3()).y
    const standingPaw = paw(model, "legFL3").y
    animator.update({ ...pose, touchdown: 1 })
    root.updateMatrixWorld(true)
    const landed = model.bones.get("hips")!.getWorldPosition(new THREE.Vector3()).y
    animator.update({ ...pose, gather: 1, leap: 1, leapT: 0 })
    root.updateMatrixWorld(true)
    const gathered = model.bones.get("hips")!.getWorldPosition(new THREE.Vector3()).y
    expect(standing - landed).toBeGreaterThan(0.02)
    expect(standing - gathered).toBeGreaterThan(0.02)
    // paws stay on the ground through the compression
    animator.update({ ...pose, touchdown: 1 })
    root.updateMatrixWorld(true)
    expect(Math.abs(paw(model, "legFL3").y - standingPaw)).toBeLessThan(0.01)
  })
})
