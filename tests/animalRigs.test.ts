/// <reference types="node" />
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { QuadrupedAnimator, type AnimalPose } from "../src/world/wildlife/QuadrupedAnimator"
import { SPECIES, isPrimate, type AnimalModel } from "../src/world/wildlife/animalAssets"
import { PrimateAnimator } from "../src/world/wildlife/PrimateAnimator"

const basePose: AnimalPose = { dt: 1 / 60, time: 0, speed: 0, turnRate: 0, sit: 0, sleep: 0, graze: 0, happy: 0, swim: 0, lookYaw: 0, lookPitch: 0, slope: 0, crossSlope: 0, fullIK: true }

describe("exported animal rigs", () => {
  for (const species of SPECIES) it(`${species} has valid deforming rigs and a smaller far mesh`, async () => {
    const counts: number[] = []
    let jointOrder: string[] | undefined
    let bindMatrix: number[] | undefined
    let inverseBinds: number[][] | undefined
    // Primates (monkey, gorilla) name their limbs arm{L,R}/leg{L,R} and carry no
    // legBL3..4 hind chain; they are driven by PrimateAnimator at runtime. The
    // quadrupeds all share the legF/legB three-bone IK contract.
    const primate = isPrimate(species)
    for (const lod of [0, 1]) {
      const bytes = readFileSync(`public/assets/animals/${species}${lod ? "-lod1" : ""}.glb`)
      const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "")
      const root = new THREE.Group(); root.add(gltf.scene)
      const bones = new Map<string, THREE.Bone>(), meshes: THREE.SkinnedMesh[] = []
      root.traverse(o => {
        if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone)
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh)
      })
      // hips/head are universal; `spine` is present on every skeleton here
      // except the duck, which is authored with a direct hips->chest body
      expect(bones.has("hips") && bones.has("head")).toBe(true)
      if (species !== "duck") expect(bones.has("spine"), species).toBe(true)
      if (primate) {
        expect(bones.has("armL1") && bones.has("armL2") && bones.has("legL1") && bones.has("legL2")).toBe(true)
      } else {
        expect(bones.has("legBL3")).toBe(true)
      }
      expect(meshes).toHaveLength(1)
      const mesh = meshes[0]
      const joints = mesh.skeleton.bones.map(bone => bone.name)
      const binds = mesh.skeleton.boneInverses.map(matrix => matrix.elements)
      if (lod === 0) {
        jointOrder = joints; bindMatrix = [...mesh.bindMatrix.elements]
        inverseBinds = binds.map(elements => [...elements])
      } else {
        // Home LODs swap only geometry, retaining the live pose and skeleton.
        expect(joints).toEqual(jointOrder)
        mesh.bindMatrix.elements.forEach((v, i) => expect(v).toBeCloseTo(bindMatrix![i], 5))
        binds.forEach((elements, j) => elements.forEach((v, i) => expect(v).toBeCloseTo(inverseBinds![j][i], 5)))
      }
      counts.push(mesh.geometry.index!.count / 3)
      expect(mesh.geometry.attributes.color.itemSize).toBe(4)
      const model: AnimalModel = { root, bones, meshes, material: new THREE.MeshStandardMaterial() }
      if (lod === 0) for (const side of ["L", "R"]) {
        const eye = bones.get(`eye${side}`)!, pupil = bones.get(`pupil${side}`)!
        const outward = new THREE.Vector3(0, 1, 0).applyQuaternion(pupil.getWorldQuaternion(new THREE.Quaternion())).normalize()
        const origin = eye.getWorldPosition(new THREE.Vector3()).addScaledVector(outward, 0.3)
        const hit = new THREE.Raycaster(origin, outward.clone().negate(), 0, 0.4).intersectObject(mesh, false)[0]
        expect(hit?.face, `${species} ${side} eye must be visible from its gaze direction`).toBeTruthy()
        const jointIds = new Set([mesh.skeleton.bones.indexOf(eye), mesh.skeleton.bones.indexOf(pupil)])
        const skin = mesh.geometry.getAttribute("skinIndex")
        const eyeVertices = [hit.face!.a, hit.face!.b, hit.face!.c].filter(v => jointIds.has(skin.getX(v)))
        expect(eyeVertices.length, `${species} ${side} eye is buried beneath its skull`).toBeGreaterThan(0)
      }
      const animator = primate ? new PrimateAnimator(species, model, 819) : new QuadrupedAnimator(species, model, 819)
      const limbNames = primate ? ["armL1", "armR1", "legL1", "legR1"] : species === "duck" ? ["legBL1", "legBR1"] : ["legFL1", "legFR1", "legBL1", "legBR1"]
      const restLimbs = limbNames.map(name => bones.get(name)!.quaternion.clone())
      for (const pose of [basePose, { ...basePose, speed: 1.2, slope: 0.1, crossSlope: -0.15 }, { ...basePose, sit: 1 }, { ...basePose, sleep: 1 }, { ...basePose, graze: 1 }, { ...basePose, swim: species === "duck" ? 1 : 0, fullIK: false }]) {
        for (let f = 0; f < 90; f++) {
          if (animator instanceof PrimateAnimator) animator.update({ ...pose, time: f / 60, climb: 0, air: 0, crouch: 0, eat: pose.graze, groom: 0, alert: 0 })
          else animator.update({ ...pose, time: f / 60 })
        }
        if (pose.speed > 0) expect(limbNames.some((name, i) => bones.get(name)!.quaternion.angleTo(restLimbs[i]) > 0.05), `${species} must actually animate its own limb chains`).toBe(true)
        root.updateMatrixWorld(true)
        mesh.skeleton.update()
        mesh.computeBoundingBox()
        const size = mesh.boundingBox!.getSize(new THREE.Vector3())
        expect(Number.isFinite(size.x + size.y + size.z)).toBe(true)
        expect(size.length()).toBeGreaterThan(0.1)
        expect(size.length()).toBeLessThan(3)
        for (const bone of bones.values()) expect(bone.quaternion.toArray().every(Number.isFinite)).toBe(true)
      }
      mesh.skeleton.dispose(); mesh.geometry.dispose(); model.material.dispose()
    }
    expect(counts[1]).toBeLessThan(counts[0] * 0.35)
  })
})
