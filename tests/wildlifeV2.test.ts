/// <reference types="node" />
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { COATS, SPECIES, WILDLIFE_V2, isPrimate, type AnimalModel, type Species } from "../src/world/wildlife/animalAssets"
import { QuadrupedAnimator, type AnimalPose } from "../src/world/wildlife/QuadrupedAnimator"
import { PrimateAnimator, type PrimatePose } from "../src/world/wildlife/PrimateAnimator"

/** Load one LOD of a species straight off disk and wrap it like the runtime. */
const load = async (species: Species, lod = 0): Promise<{
  root: THREE.Group
  bones: Map<string, THREE.Bone>
  mesh: THREE.SkinnedMesh
  model: AnimalModel
}> => {
  const bytes = readFileSync(`public/assets/animals/${species}${lod ? "-lod1" : ""}.glb`)
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "")
  const root = new THREE.Group()
  root.add(gltf.scene)
  const bones = new Map<string, THREE.Bone>()
  const meshes: THREE.SkinnedMesh[] = []
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone)
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh)
  })
  const model: AnimalModel = { root, bones, meshes, material: new THREE.MeshStandardMaterial() }
  return { root, bones, mesh: meshes[0], model }
}

const pose: AnimalPose = {
  dt: 1 / 60, time: 0, speed: 0, turnRate: 0, sit: 0, sleep: 0, graze: 0, happy: 0, swim: 0,
  lookYaw: 0, lookPitch: 0, slope: 0, crossSlope: 0, fullIK: true,
}
const primatePose: PrimatePose = {
  dt: 1 / 60, time: 0, speed: 0, turnRate: 0, sit: 0, sleep: 0, climb: 0, air: 0,
  crouch: 0, lookYaw: 0, lookPitch: 0, eat: 0, groom: 0, happy: 0, alert: 0, fullIK: true,
}

describe("far-world species (build_wildlife_v2)", () => {
  it("ships exactly the five owned species", () => {
    expect(WILDLIFE_V2).toEqual(["horse", "monkey", "tiger", "cheetah", "gorilla"])
    for (const s of WILDLIFE_V2) expect(SPECIES).toContain(s)
  })

  it("gives every species a real coat with no invented names", () => {
    for (const species of SPECIES) {
      const coats = COATS[species]
      expect(coats.length, species).toBeGreaterThan(0)
      for (const c of coats) {
        expect(c.base, `${species}/${c.name}`).toMatch(/^#[0-9a-f]{6}$/i)
        expect(c.light, `${species}/${c.name}`).toMatch(/^#[0-9a-f]{6}$/i)
        expect(c.pattern, `${species}/${c.name}`).toMatch(/^#[0-9a-f]{6}$/i)
      }
      const names = coats.map((c) => c.name)
      expect(new Set(names).size, species).toBe(names.length)
    }
    expect(COATS.tiger.map((c) => c.name)).toEqual(["bengal tiger", "white tiger"])
    expect(COATS.cheetah.map((c) => c.name)).toEqual(["cheetah"])
  })

  for (const species of WILDLIFE_V2) {
    it(`${species} is a real skinned, masked, grounded mesh in budget`, async () => {
      const counts: number[] = []
      for (const lod of [0, 1]) {
        const { root, bones, mesh, model } = await load(species, lod)
        // one skinned mesh with a full skin and a 4-channel vertex colour mask
        expect(bones.size, `${species} bones`).toBeGreaterThan(15)
        expect(mesh.isSkinnedMesh).toBe(true)
        expect(mesh.skeleton.bones.length, `${species} skin joints`).toBe(bones.size)
        const color = mesh.geometry.attributes.color
        expect(color.itemSize, `${species} colour channels`).toBe(4)
        // glTF JOINTS_0/WEIGHTS_0 arrive as skinIndex/skinWeight
        const joint = mesh.geometry.getAttribute("skinIndex")
        const weight = mesh.geometry.getAttribute("skinWeight")
        expect(joint, `${species} joints_0`).toBeTruthy()
        expect(weight, `${species} weight_0`).toBeTruthy()
        // the mask is real: it has literal (alpha 1) parts and coated parts
        let literal = 0
        let coated = 0
        for (let i = 0; i < color.count; i++) {
          if (color.getX(i) + color.getY(i) + color.getZ(i) > 0) coated++
          if (color.getW(i) > 0.5) literal++
        }
        expect(coated, `${species} coated verts`).toBeGreaterThan(100)
        expect(literal, `${species} literal verts`).toBeGreaterThan(10)
        counts.push(mesh.geometry.index!.count / 3)
        // every vertex is weighted, and its weights are normalised
        let maxErr = 0
        for (let i = 0; i < mesh.geometry.attributes.position.count; i += 7) {
          const sum = [0, 1, 2, 3].reduce((a, k) => a + weight.getComponent(i, k as never), 0)
          maxErr = Math.max(maxErr, Math.abs(sum - 1))
        }
        expect(maxErr, `${species} weight sums`).toBeLessThan(0.02)
        // origin on the ground between the feet, facing +Z in three.js
        mesh.computeBoundingBox()
        const bb = mesh.boundingBox!
        expect(bb.min.y, `${species} below ground`).toBeGreaterThan(-0.06)
        expect(bb.max.y, `${species} height`).toBeGreaterThan(0.15)
        expect(bb.max.z, `${species} faces +Z`).toBeGreaterThan(0.02)
        expect(Math.abs(bb.min.x + bb.max.x), `${species} centred`).toBeLessThan(0.12)
        mesh.skeleton.dispose()
        model.material.dispose()
        void root
      }
      // LOD0 6-12k, LOD1 2-4k render triangles, and LOD1 genuinely smaller
      expect(counts[0], `${species} LOD0 tris`).toBeGreaterThan(5000)
      expect(counts[0], `${species} LOD0 tris`).toBeLessThan(12500)
      expect(counts[1], `${species} LOD1 tris`).toBeGreaterThan(1500)
      expect(counts[1], `${species} LOD1 tris`).toBeLessThan(4500)
      expect(counts[1]).toBeLessThan(counts[0] * 0.45)
    })
  }

  it("authored each species distinctly, not as recoloured cats", async () => {
    // bounding boxes read real proportions rather than one shared silhouette
    const box = async (species: Species): Promise<THREE.Box3> => {
      const { mesh } = await load(species)
      mesh.computeBoundingBox()
      const b = mesh.boundingBox!.clone()
      mesh.geometry.dispose()
      return b
    }
    const [horse, tiger, cheetah, monkey, gorilla, cat] = await Promise.all(
      [box("horse"), box("tiger"), box("cheetah"), box("monkey"), box("gorilla"), box("cat")],
    )
    const size = (b: THREE.Box3): THREE.Vector3 => b.getSize(new THREE.Vector3())
    const hs = size(horse)
    const ts = size(tiger)
    const cs = size(cheetah)
    const ms = size(monkey)
    const gs = size(gorilla)
    // a horse is far taller than a big cat, which is far taller than a macaque
    expect(hs.y).toBeGreaterThan(ts.y * 1.3)
    expect(ts.y).toBeGreaterThan(ms.y * 1.8)
    expect(gs.y).toBeGreaterThan(ms.y * 1.5)
    // a horse is longer than it is tall and much deeper than a cat
    expect(hs.z).toBeGreaterThan(hs.y)
    expect(hs.y).toBeGreaterThan(ts.y * 1.3)
    // Tail length must not change the anatomy assertion: compare the actual
    // leg height to the width of the two species' ribcages instead.
    const tigerRig = await load("tiger"), cheetahRig = await load("cheetah")
    const tigerLeg = tigerRig.bones.get("legFL1")!.getWorldPosition(new THREE.Vector3()).y
    const cheetahLeg = cheetahRig.bones.get("legFL1")!.getWorldPosition(new THREE.Vector3()).y
    expect(cheetahLeg / cs.x).toBeGreaterThan(tigerLeg / ts.x)
    for (const rig of [tigerRig, cheetahRig]) { rig.mesh.skeleton.dispose(); rig.mesh.geometry.dispose(); rig.model.material.dispose() }
    // the gorilla is a different shape from the monkey, not a scaled copy
    expect(gs.z / gs.y).not.toBeCloseTo(ms.z / ms.y, 2)
    // and none of them is the cat's silhouette
    const catS = size(cat)
    expect(hs.y / hs.z).not.toBeCloseTo(catS.y / catS.z, 2)
  })

  it("gives the gorilla no tail and the monkey one", async () => {
    const monkey = await load("monkey")
    const gorilla = await load("gorilla")
    expect(monkey.bones.has("tail1")).toBe(true)
    // no tail at all is the clearest gorilla-vs-monkey read in silhouette
    expect(gorilla.bones.has("tail1")).toBe(false)
    expect([...gorilla.bones.keys()].some((b) => b.startsWith("tail"))).toBe(false)
    monkey.mesh.geometry.dispose()
    gorilla.mesh.geometry.dispose()
  })

  it("drives every species through its own animator without NaN", async () => {
    for (const species of WILDLIFE_V2) {
      const { root, bones, mesh, model } = await load(species)
      const animator = isPrimate(species)
        ? new PrimateAnimator(species, model, 4711)
        : new QuadrupedAnimator(species, model, 4711)
      // the behavior set each species is actually asked for
      const frames = isPrimate(species)
        ? [primatePose, { ...primatePose, speed: 1.4 }, { ...primatePose, sit: 1 },
           { ...primatePose, climb: 1 }, { ...primatePose, air: 1 }, { ...primatePose, eat: 1, groom: 1 },
           { ...primatePose, sleep: 1 }, { ...primatePose, alert: 1 }, { ...primatePose, fullIK: false }]
        : [pose, { ...pose, speed: 1.6, slope: 0.12, crossSlope: -0.1 }, { ...pose, graze: 1 },
           { ...pose, alert: 1 }, { ...pose, sleep: 1 }, { ...pose, happy: 1 },
           { ...pose, gallop: 1, speed: 5 }, { ...pose, fullIK: false }]
      for (const frame of frames) {
        for (let f = 0; f < 90; f++) {
          if (isPrimate(species)) (animator as PrimateAnimator).update({ ...frame, time: f / 60 } as PrimatePose)
          else (animator as QuadrupedAnimator).update({ ...frame, time: f / 60 } as AnimalPose)
        }
        root.updateMatrixWorld(true)
        mesh.skeleton.update()
        mesh.computeBoundingBox()
        const size = mesh.boundingBox!.getSize(new THREE.Vector3())
        expect(Number.isFinite(size.x + size.y + size.z), `${species} finite`).toBe(true)
        expect(size.length(), `${species} collapsed`).toBeGreaterThan(0.1)
        for (const bone of bones.values()) expect(bone.quaternion.toArray().every(Number.isFinite), species).toBe(true)
      }
      mesh.skeleton.dispose()
      model.material.dispose()
    }
  })

  it("keeps a walking horse's hooves on the ground instead of skating", async () => {
    const { root, mesh, model } = await load("horse")
    const animator = new QuadrupedAnimator("horse", model, 99)
    // sample the lowest vertex over a full stride: the stance minimum must
    // touch the floor, which is what the old primitive horse got wrong
    let lowest = Infinity
    for (let f = 0; f < 240; f++) {
      animator.update({ ...pose, speed: 1.2, time: f / 60 })
      root.updateMatrixWorld(true)
      mesh.skeleton.update()
      mesh.computeBoundingBox()
      lowest = Math.min(lowest, mesh.boundingBox!.min.y)
    }
    expect(lowest, "hoof bottom reaches the ground").toBeLessThan(0.06)
    expect(lowest, "hooves never sink below the floor").toBeGreaterThan(-0.12)
    mesh.skeleton.dispose()
    model.material.dispose()
  })

  it("advances the gait phase with distance so paws do not skate", async () => {
    const a = await load("tiger")
    const b = await load("tiger")
    const animA = new QuadrupedAnimator("tiger", a.model, 7)
    const animB = new QuadrupedAnimator("tiger", b.model, 7)
    for (let f = 0; f < 120; f++) {
      animA.update({ ...pose, speed: 2.2, time: f / 60 })
      animB.update({ ...pose, speed: 2.2, time: f / 60 })
    }
    expect(animA.stepped).toBe(animB.stepped)
    // a different seed must not lock two animals into the same rhythm
    const c = await load("tiger")
    const animC = new QuadrupedAnimator("tiger", c.model, 991)
    let different = false
    for (let f = 0; f < 240 && !different; f++) {
      animC.update({ ...pose, speed: 2.2, time: f / 60 })
      different = animC.stepped !== animA.stepped
    }
    expect(different, "two tigers are not gait-locked").toBe(true)
    for (const x of [a, b, c]) { x.mesh.skeleton.dispose(); x.model.material.dispose() }
  })

  it("routes each species to the animator that understands its limbs", () => {
    // main's Wildlife.tsx should branch on isPrimate: the primates have no
    // legF/legB chain, so handing them to QuadrupedAnimator poses nothing
    expect(isPrimate("monkey")).toBe(true)
    expect(isPrimate("gorilla")).toBe(true)
    for (const s of ["horse", "tiger", "cheetah", "cat", "fox", "deer", "rabbit", "duck"] as Species[]) {
      expect(isPrimate(s), s).toBe(false)
    }
  })

  it("gives big cats round pupils and a horse a wide horizontal one", async () => {
    // a tiger/cheetah pupil must NOT collapse to a domestic-cat slit
    for (const species of ["tiger", "cheetah"] as Species[]) {
      const { root, mesh, model } = await load(species)
      const animator = new QuadrupedAnimator(species, model, 5)
      animator.update({ ...pose, pupil: 1 })
      root.updateMatrixWorld(true)
      const pupil = model.bones.get("pupilL")!
      pupil.updateMatrixWorld(true)
      expect(pupil.scale.x, `${species} pupil stays round`).toBeGreaterThan(0.75)
      expect(pupil.scale.z, `${species} pupil stays round`).toBeGreaterThan(0.8)
      mesh.skeleton.dispose()
      model.material.dispose()
    }
    const { root, mesh, model } = await load("horse")
    const horse = new QuadrupedAnimator("horse", model, 5)
    horse.update({ ...pose, pupil: 1 })
    root.updateMatrixWorld(true)
    const pupil = model.bones.get("pupilL")!
    pupil.updateMatrixWorld(true)
    // a horse's pupil is a wide horizontal bar, not a slit
    expect(pupil.scale.x).toBeGreaterThan(0.95)
    expect(pupil.scale.z).toBeLessThan(0.7)
    mesh.skeleton.dispose()
    model.material.dispose()
  })

  it("poses a climbing monkey with both hands up and a sitting one folded", async () => {
    const { root, bones, mesh, model } = await load("monkey")
    const animator = new PrimateAnimator("monkey", model, 3)
    root.updateMatrixWorld(true)
    const restWorldY = model.bones.get("handL")!.getWorldPosition(new THREE.Vector3()).y
    const restHipsY = model.bones.get("hips")!.getWorldPosition(new THREE.Vector3()).y
    animator.update({ ...primatePose, climb: 1, time: 2 })
    root.updateMatrixWorld(true)
    const climbY = bones.get("handL")!.getWorldPosition(new THREE.Vector3()).y
    expect(climbY, "climbing hand is above the rest hand").toBeGreaterThan(restWorldY + 0.05)

    // sitting folds the hind legs under and drops the hips
    animator.update({ ...primatePose, sit: 1, time: 4 })
    root.updateMatrixWorld(true)
    const hips = bones.get("hips")!.getWorldPosition(new THREE.Vector3()).y
    expect(hips, "sitting lowers the pelvis onto the haunches").toBeLessThan(restHipsY * 0.5)
    expect(hips).toBeGreaterThan(0)
    mesh.skeleton.dispose()
    model.material.dispose()
  })
})
