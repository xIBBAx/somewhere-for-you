import * as THREE from "three"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { makeIdentity, type BreedId } from "../src/game/horses/breeds"
import { disposeHorseModel, makeHorseModel, setHorseLod, setTackVisible, type HorseMeta } from "../src/game/horses/horseAssets"

const { loadAsync } = vi.hoisted(() => ({ loadAsync: vi.fn() }))
vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class { loadAsync = loadAsync },
}))

// Only network delivery and the decorative hair canvas are mocked. Real
// Three.js rigs, skeleton cloning, material selection and disposal run below.
beforeAll(() => {
  const context = {
    clearRect() {}, beginPath() {}, moveTo() {}, bezierCurveTo() {}, stroke() {},
    createLinearGradient: () => ({ addColorStop() {} }),
  }
  vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => context }) })
})
afterAll(() => { vi.unstubAllGlobals() })

const PARTS = [
  ["body", "HorseBody"],
  ["mane", "HorseHair"],
  ["eye", "HorseEye"],
  ["tack_pad", "TackCloth_pad"],
  ["tack_saddle", "TackLeather_saddle"],
  ["tack_bit", "TackMetal_bit"],
] as const

const template = (breed: BreedId): { scene: THREE.Group } => {
  const scene = new THREE.Group(), bone = new THREE.Bone()
  bone.name = "root"
  scene.add(bone)
  const meta: HorseMeta = {
    breed, height: 1.6, length: 2,
    hooves: { hoofFL: [0, 0, 0], hoofFR: [0, 0, 0], hoofBL: [0, 0, 0], hoofBR: [0, 0, 0] },
    head: { origin: [0, 1.6, 0], axis: [0, 0, 1], dorsal: [0, 1, 0], length: 0.5 }, marks: {},
    tack: { seat: [0, 1.5, 0], seatBone: "root", pommel: [0, 0, 0], cantle: [0, 0, 0],
      stirrupL: [0, 0, 0], stirrupR: [0, 0, 0], bitL: [0, 0, 0], bitR: [0, 0, 0], reinRest: [0, 0, 0] },
  }
  scene.userData.horse = JSON.stringify(meta)
  for (const [name, materialName] of PARTS) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Array(12).fill(0), 4))
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4))
    const material = new THREE.MeshStandardMaterial()
    material.name = materialName
    const mesh = new THREE.SkinnedMesh(geometry, material)
    mesh.name = name
    scene.add(mesh)
    mesh.bind(new THREE.Skeleton([bone]))
  }
  scene.updateMatrixWorld(true)
  return { scene }
}

const deferred = <T,>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe("streamed horse model lifecycle", () => {
  it("ignores a late LOD download for a disposed horse while attaching it to a live horse sharing the download", async () => {
    const high = template("arabian"), low = deferred<ReturnType<typeof template>>()
    loadAsync.mockImplementation((url: string) => url.endsWith("-lod1.glb") ? low.promise : Promise.resolve(high))
    const [retired, live] = await Promise.all([
      makeHorseModel(makeIdentity(501, "arabian", { saddled: true })),
      makeHorseModel(makeIdentity(502, "arabian", { saddled: true })),
    ])
    expect(retired).not.toBeNull(); expect(live).not.toBeNull()
    const old = retired!, survivor = live!, parent = new THREE.Group()
    parent.add(old.root, survivor.root)
    const skeletons = old.lod[0].map((part) => (part as THREE.SkinnedMesh).skeleton)
    for (const skeleton of skeletons) skeleton.computeBoneTexture()
    const materialDisposals = old.materials.map((material) => {
      const dispose = vi.fn()
      material.addEventListener("dispose", dispose)
      return dispose
    })
    const sharedGeometryDisposed = vi.fn()
    for (const mesh of high.scene.children) if (mesh instanceof THREE.SkinnedMesh) mesh.geometry.addEventListener("dispose", sharedGeometryDisposed)

    disposeHorseModel(old)
    disposeHorseModel(old)
    expect(old.root.parent).toBeNull()
    expect(skeletons.every((skeleton) => skeleton.boneTexture === null)).toBe(true)
    for (const disposed of materialDisposals) expect(disposed).toHaveBeenCalledTimes(1)

    low.resolve(template("arabian"))
    await vi.waitFor(() => { expect(survivor.lod[1]).toHaveLength(PARTS.length) })
    expect(old.lod[1]).toHaveLength(0)
    const retiredMeshes: THREE.Object3D[] = []
    old.root.traverse((object) => { if (object instanceof THREE.SkinnedMesh) retiredMeshes.push(object) })
    expect(retiredMeshes).toHaveLength(PARTS.length)
    expect(survivor.root.parent).toBe(parent)
    expect(setHorseLod(survivor, 100)).toBe(1)
    expect(survivor.lod[1].every((mesh) => mesh.visible)).toBe(true)
    disposeHorseModel(survivor)
    expect(sharedGeometryDisposed).not.toHaveBeenCalled()
  })

  it("retains each tack and eye material across LOD changes and keeps hidden tack hidden when returning to the far LOD", async () => {
    const low = deferred<ReturnType<typeof template>>()
    loadAsync.mockImplementation((url: string) => url.endsWith("-lod1.glb") ? low.promise : Promise.resolve(template("quarter")))
    const horse = await makeHorseModel(makeIdentity(601, "quarter", { saddled: true }))
    expect(horse).not.toBeNull()
    const model = horse!
    low.resolve(template("quarter"))
    await vi.waitFor(() => { expect(model.lod[1]).toHaveLength(PARTS.length) })

    const materialAt = (name: string, lod: 0 | 1): THREE.Material =>
      (model.lod[lod].find((part) => part.name === `${name}${lod ? "-lod1" : ""}`) as THREE.Mesh).material as THREE.Material
    const body = materialAt("body", 0)
    for (const [name] of PARTS) {
      expect(materialAt(name, 1)).toBe(materialAt(name, 0))
      if (name !== "body") expect(materialAt(name, 1)).not.toBe(body)
    }
    expect(new Set(["tack_pad", "tack_saddle", "tack_bit"].map((name) => materialAt(name, 1))).size).toBe(3)

    setHorseLod(model, 100)
    setTackVisible(model, false)
    setHorseLod(model, 0)
    setHorseLod(model, 100)
    for (const part of model.lod[1]) expect(part.visible).toBe(!part.name.startsWith("tack_"))
    setTackVisible(model, true)
    expect(model.lod[1].every((part) => part.visible)).toBe(true)
    disposeHorseModel(model)
  })
})
