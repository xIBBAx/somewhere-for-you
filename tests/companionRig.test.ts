/// <reference types="node" />
import { readFileSync } from "node:fs"
import { withoutTextures } from "./glbHelpers"
import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { HumanAnimator, type HumanPoseInput } from "../src/game/characters/human/HumanAnimator"

const load = async (path = "public/assets/characters/companion.glb") => {
  const bytes = readFileSync(path)
  const gltf = await new GLTFLoader().parseAsync(withoutTextures(bytes), "")
  const root = new THREE.Group(), bones = new Map<string, THREE.Bone>(), skinned: THREE.SkinnedMesh[] = []
  root.add(gltf.scene)
  root.traverse(object => {
    if ((object as THREE.Bone).isBone) bones.set(object.name, object as THREE.Bone)
    if ((object as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(object as THREE.SkinnedMesh)
  })
  const face = { uAtlas: { value: null }, uEyes: { value: 0 }, uMouth: { value: 0 }, uBlush: { value: 0 }, uSkin: { value: new THREE.Color() } }
  return { root, bones, skinned, animator: new HumanAnimator({ root, bones, skinned, face }) }
}
const base: HumanPoseInput = {
  dt: 1 / 60, time: 0, speed: 0, turnRate: 0, forwardAccel: 0, groundLeft: 0, groundRight: 0, slope: 0,
  airborne: false, jumpPhase: "grounded", jumpTime: 0, idleTime: 0, petting: 0, petSide: 1, celebrate: 0,
  training: { stance: 0, jab: 0, cross: 0 }, fear: 0, greeting: 0, lookYaw: 0, lookPitch: 0, wind: 0,
  sit: 0, paint: 0, wish: 0,
}

describe("the companion's production rig", () => {
  it("connects both arm chains, fingers and toes to their intended parents", async () => {
    const { bones } = await load()
    for (const side of ["L", "R"]) {
      expect(bones.get(`forearm${side}`)?.parent?.name).toBe(`upperarm${side}`)
      expect(bones.get(`hand${side}`)?.parent?.name).toBe(`forearm${side}`)
      expect(bones.get(`toe${side}`)?.parent?.name).toBe(`foot${side}`)
      for (const finger of ["thumb", "index", "middle", "ring", "pinky"]) {
        expect(bones.get(`${finger}1${side}`)?.parent?.name).toBe(`hand${side}`)
        for (const joint of [2, 3]) expect(bones.get(`${finger}${joint}${side}`)?.parent?.name).toBe(`${finger}${joint - 1}${side}`)
      }
    }
  })

  it("poses the real exported skin through locomotion and gestures without invalid deformation", async () => {
    const { root, animator, skinned } = await load()
    const sample = new THREE.Vector3()
    const actions: Partial<HumanPoseInput>[] = [{}, { speed: 4.5 }, { speed: 6.2, turnRate: 2 },
      { airborne: true, jumpPhase: "rising", jumpTime: 0.3 }, { swim: 1, swimSpeed: 1.4 },
      { training: { stance: 1, jab: 1, cross: 0 } }, { wish: 1 }, { paint: 1 }, { greeting: 1 }]
    let time = 0
    for (const action of actions) {
      for (let frame = 0; frame < 60; frame++) { time += 1 / 60; animator.update({ ...base, ...action, time }) }
      root.updateMatrixWorld(true)
      for (const mesh of skinned) {
        mesh.skeleton.update()
        const positions = mesh.geometry.getAttribute("position")
        for (let vertex = 0; vertex < positions.count; vertex += 17) {
          sample.fromBufferAttribute(positions, vertex)
          mesh.applyBoneTransform(vertex, sample)
          sample.applyMatrix4(mesh.matrixWorld)
          expect(sample.toArray().every(Number.isFinite)).toBe(true)
          expect(Math.abs(sample.x)).toBeLessThan(2)
          expect(sample.y).toBeGreaterThan(-1)
          expect(sample.y).toBeLessThan(3)
        }
      }
    }
  })
})
