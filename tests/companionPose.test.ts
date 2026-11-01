/// <reference types="node" />
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { QuadrupedAnimator, type AnimalPose } from "../src/world/wildlife/QuadrupedAnimator"
import type { AnimalModel } from "../src/world/wildlife/animalAssets"
import {
  GROUND_SINK,
  companionCadence,
  companionGallop,
  composeCompanionPose,
  createCompanionBlend,
  stepCompanionBlend,
  type CompanionPoseInput,
  type CompanionPoseScratch,
} from "../src/game/characters/catRigPose"

const base: AnimalPose = { dt: 1 / 60, time: 0, speed: 0, turnRate: 0, sit: 0, sleep: 0, graze: 0, happy: 0, swim: 0, lookYaw: 0, lookPitch: 0, slope: 0, crossSlope: 0, fullIK: true }

const loadCat = async (): Promise<{ model: AnimalModel; mesh: THREE.SkinnedMesh; bones: Map<string, THREE.Bone> }> => {
  const bytes = readFileSync("public/assets/animals/cat.glb")
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "")
  const root = new THREE.Group()
  root.add(gltf.scene)
  const bones = new Map<string, THREE.Bone>()
  let mesh: THREE.SkinnedMesh | null = null
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone)
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh
  })
  return { model: { root, bones, meshes: [mesh!], material: new THREE.MeshStandardMaterial() }, mesh: mesh!, bones }
}

/** Lowest skinned vertex over a settle of `frames`, relative to the root. */
const lowest = (an: QuadrupedAnimator, mesh: THREE.SkinnedMesh, root: THREE.Object3D, pose: Partial<AnimalPose>, frames = 200): number => {
  const v = new THREE.Vector3()
  const pos = mesh.geometry.attributes.position
  let min = Infinity
  for (let f = 0; f < frames; f++) {
    an.update({ ...base, ...pose, time: f / 60 })
    if (f < frames - 40 || f % 8) continue
    root.updateMatrixWorld(true)
    mesh.skeleton.update()
    for (let i = 0; i < pos.count; i += 3) {
      v.fromBufferAttribute(pos, i)
      mesh.applyBoneTransform(i, v)
      v.applyMatrix4(mesh.matrixWorld)
      if (v.y < min) min = v.y
    }
  }
  return min
}

describe("companion cat rig", () => {
  it("has every expressive bone", async () => {
    const { bones } = await loadCat()
    for (const b of ["jaw", "tongue", "pupilL", "pupilR", "whiskerL", "whiskerR", "legFL4", "legBR4", "tail6"]) {
      expect(bones.has(b), b).toBe(true)
    }
  })

  it("keeps her paws on the ground in every folded pose", async () => {
    const { model, mesh } = await loadCat()
    const an = new QuadrupedAnimator("cat", model, 7)
    const rest = lowest(an, mesh, model.root, {})
    const measured: Record<string, number> = {}
    for (const key of Object.keys(GROUND_SINK) as Array<keyof typeof GROUND_SINK>) {
      measured[key] = rest - lowest(an, mesh, model.root, { [key]: 1 })
    }
    for (const key of Object.keys(GROUND_SINK) as Array<keyof typeof GROUND_SINK>) {
      // lifting by the constant must leave her neither buried nor floating
      expect(Math.abs(measured[key] - GROUND_SINK[key]), key).toBeLessThan(0.015)
    }
  })

  it("blends trot into a gallop continuously with speed", () => {
    expect(companionGallop(3.2)).toBe(0)
    expect(companionGallop(11.5)).toBe(1)
    let prev = 0
    for (let v = 0; v <= 12; v += 0.05) {
      const g = companionGallop(v)
      expect(g).toBeGreaterThanOrEqual(prev)
      expect(g - prev).toBeLessThan(0.05)
      prev = g
    }
    expect(companionCadence(11.5)).toBeGreaterThan(companionCadence(4))
  })

  it("gallops with a flexing spine and a suspension phase", async () => {
    const { model, bones, mesh } = await loadCat()
    const an = new QuadrupedAnimator("cat", model, 3)
    const spine = bones.get("spine")!
    const pitches: number[] = []
    let lowestPaw = Infinity, highestPaw = -Infinity
    const pos = mesh.geometry.attributes.position
    const v = new THREE.Vector3()
    for (let f = 0; f < 240; f++) {
      an.update({ ...base, speed: 1, gallop: 1, cadence: 1.4, time: f / 60 })
      for (const b of bones.values()) expect(b.quaternion.toArray().every(Number.isFinite), b.name).toBe(true)
      if (f < 120) continue
      pitches.push(new THREE.Euler().setFromQuaternion(spine.quaternion).x)
      // lowest paw height per frame: rises clear of the ground in suspension
      model.root.updateMatrixWorld(true)
      mesh.skeleton.update()
      let low = Infinity
      for (let i = 0; i < pos.count; i += 7) {
        v.fromBufferAttribute(pos, i)
        mesh.applyBoneTransform(i, v)
        if (v.y < low) low = v.y
      }
      lowestPaw = Math.min(lowestPaw, low)
      highestPaw = Math.max(highestPaw, low)
    }
    expect(Math.max(...pitches) - Math.min(...pitches)).toBeGreaterThan(0.3)
    expect(highestPaw - lowestPaw).toBeGreaterThan(0.01)
  })

  it("never synchronises two wild cats' gait or tail", async () => {
    const a = await loadCat()
    const b = await loadCat()
    const anA = new QuadrupedAnimator("cat", a.model, 4021)
    const anB = new QuadrupedAnimator("cat", b.model, 77013)
    let maxGaitDifference = 0, maxTailDifference = 0
    for (let f = 0; f < 120; f++) {
      anA.update({ ...base, speed: 0.6, time: f / 60 })
      anB.update({ ...base, speed: 0.6, time: f / 60 })
      maxGaitDifference = Math.max(maxGaitDifference, a.bones.get("legFL2")!.quaternion.angleTo(b.bones.get("legFL2")!.quaternion))
      maxTailDifference = Math.max(maxTailDifference, a.bones.get("tail1")!.quaternion.angleTo(b.bones.get("tail1")!.quaternion))
    }
    // Independently phased periodic movements may briefly cross. Inspect a
    // complete cycle rather than mistaking one coincident frame for synchrony.
    expect(maxGaitDifference).toBeGreaterThan(0.01)
    expect(maxTailDifference).toBeGreaterThan(0.01)
  })

  it("poses every behaviour without NaN", async () => {
    const { model, bones } = await loadCat()
    const an = new QuadrupedAnimator("cat", model, 11)
    const blend = createCompanionBlend()
    const out = { ...base, crouch: 0, stretch: 0, leap: 0, reach: 0 } as CompanionPoseScratch
    const states = ["follow", "sit", "greet", "rub", "petted", "meow", "scared", "groom", "knead", "roll", "yawn", "scratch", "loaf", "shake", "sleep", "crouch", "stretch", "lookAround"]
    for (const state of states) {
      for (let f = 0; f < 90; f++) {
        const input: CompanionPoseInput = {
          state, stateTime: f / 60, speed: state === "rub" || state === "greet" ? 0.8 : 0, turnRate: 0, explorerBearing: 0.4, navMode: "direct",
          affectionKind: "nuzzle", affectionPose: 0, slope: 0, crossSlope: 0, dark: 0.3, voice: f % 30 < 10 ? 0.8 : 0, slowBlink: 0.5,
          rubSide: 1, actSide: -1, tailSide: 1, stroke: (f / 90) % 1, pounce: state === "crouch" ? 1 : 0,
        }
        stepCompanionBlend(blend, input, 1 / 60)
        composeCompanionPose(blend, input, 1 / 60, f / 60, out)
        an.update(out)
      }
      for (const bone of bones.values()) expect(bone.quaternion.toArray().every(Number.isFinite), `${state}:${bone.name}`).toBe(true)
    }
  })
})
