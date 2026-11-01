/// <reference types="node" />
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { QuadrupedAnimator, type AnimalPose } from "../src/world/wildlife/QuadrupedAnimator"
import type { AnimalModel, Species } from "../src/world/wildlife/animalAssets"

const load = async (species: Species): Promise<AnimalModel> => {
  const bytes = readFileSync(`public/assets/animals/${species}.glb`)
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "")
  const root = new THREE.Group(); root.add(gltf.scene)
  const bones = new Map<string, THREE.Bone>(), meshes: THREE.SkinnedMesh[] = []
  root.traverse(o => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone)
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh)
  })
  return { root, bones, meshes, material: new THREE.MeshStandardMaterial() }
}

/**
 * Runs an animal at a steady speed and measures how a planted paw moves over
 * the ground: in the animal's own frame the ground runs back at `speed`, so a
 * paw that is down should run back with it. Returns the mean slip as a share
 * of the speed over frames where the paw is down (its lowest few millimetres);
 * single touch-down and lift-off frames, where the toe rolls, average out.
 */
const slip = async (species: Species, speed: number, plant: boolean, paw: string): Promise<number> => {
  const model = await load(species)
  const animator = new QuadrupedAnimator(species, model, 5)
  animator.plantPaws = plant
  const pose: AnimalPose = { dt: 1 / 120, time: 0, speed, turnRate: 0, sit: 0, sleep: 0, graze: 0, happy: 0, swim: 0, lookYaw: 0, lookPitch: 0, slope: 0, crossSlope: 0, fullIK: true }
  const bone = model.bones.get(paw)!
  const samples: Array<{ y: number; z: number }> = []
  for (let f = 0; f < 600; f++) {
    animator.update({ ...pose, time: f / 120 })
    model.root.updateMatrixWorld(true)
    const p = bone.getWorldPosition(new THREE.Vector3())
    if (f >= 240) samples.push({ y: p.y, z: p.z })
  }
  const floor = Math.min(...samples.map(s => s.y))
  let total = 0, frames = 0
  for (let i = 1; i < samples.length - 1; i++) {
    const [a, b, c] = [samples[i - 1], samples[i], samples[i + 1]]
    if (Math.max(a.y, b.y, c.y) > floor + 0.004) continue
    const groundSpeed = (c.z - a.z) / (2 / 120)
    total += Math.abs(groundSpeed + speed) / speed
    frames++
  }
  expect(frames).toBeGreaterThan(8)
  return total / frames
}

describe("planted strides", () => {
  it("a wild cat's planted paws skated at a run before, and stay put now", async () => {
    expect(await slip("cat", 2.6, false, "legFL3")).toBeGreaterThan(0.4)
    expect(await slip("cat", 2.6, true, "legFL3")).toBeLessThan(0.06)
    expect(await slip("cat", 2.6, true, "legBL3")).toBeLessThan(0.06)
  })

  for (const [species, speed, paw] of [["cat", 0.55, "legBL3"], ["fox", 3.2, "legFL3"], ["fox", 3.2, "legBL3"], ["fox", 0.8, "legBL3"]] as Array<[Species, number, string]>) {
    it(`${species} at ${speed} m/s keeps a planted ${paw} on the ground`, async () => {
      expect(await slip(species, speed, true, paw)).toBeLessThan(0.06)
    })
  }
})
