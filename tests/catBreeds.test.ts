import * as THREE from "three"
import { describe, expect, it } from "vitest"
import { COATS, WILD_CAT_COATS, type AnimalModel } from "../src/world/wildlife/animalAssets"
import { CAT_BREEDS, applyCatBuild } from "../src/world/wildlife/catBreeds"
import { breedSize, selectWithCats, spawnsForChunk, type AnimalSpawn } from "../src/world/wildlife/population"

describe("The cat", () => {
  it("keeps exactly her own coat, last in the list and never rolled for a wild cat", () => {
    const cat = COATS.cat[COATS.cat.length - 1]
    expect(cat).toEqual({ name: "cat", base: "#b6bcc3", light: "#e1e4e7", pattern: "#25292e" })
    expect(WILD_CAT_COATS).toBe(COATS.cat.length - 1)
    expect(CAT_BREEDS.some((c) => c.name === "cat")).toBe(false)
  })
})

describe("cat breeds", () => {
  it("are many, uniquely named and inside the shader's ranges", () => {
    expect(CAT_BREEDS.length).toBeGreaterThanOrEqual(20)
    expect(new Set(CAT_BREEDS.map((c) => c.name)).size).toBe(CAT_BREEDS.length)
    for (const coat of CAT_BREEDS) {
      for (const key of ["solid", "tortie", "point", "white", "van"] as const) {
        const v = coat.look?.[key]
        if (v !== undefined) { expect(v).toBeGreaterThan(0); expect(v).toBeLessThanOrEqual(1) }
      }
      if (coat.look?.tortie) expect(coat.look.patch).toMatch(/^#[0-9a-f]{6}$/)
      if (coat.look?.spots) expect(coat.look.spots).toBeGreaterThan(15)
      const size = coat.build?.size ?? 1
      expect(size).toBeGreaterThan(0.85)
      expect(size).toBeLessThan(1.35)
    }
  })

  it("size the spawn scale by breed and leave other species alone", () => {
    const coon = COATS.cat.findIndex((c) => c.name === "Maine Coon")
    const siamese = COATS.cat.findIndex((c) => c.name === "Siamese")
    expect(breedSize("cat", coon)).toBeGreaterThan(breedSize("cat", siamese))
    expect(breedSize("fox", coon)).toBe(1)
  })
})

describe("wild cats across the world", () => {
  const chunks: Array<[number, number]> = []
  for (let cx = 6; cx < 22; cx++) for (let cz = -8; cz < 8; cz++) chunks.push([cx, cz])

  it("live in a good share of chunks beyond home, in every breed but the cat's", () => {
    let withCats = 0
    const breeds = new Set<number>()
    for (const [cx, cz] of chunks) {
      const spawns = spawnsForChunk(cx, cz, false)
      const cats = spawns.filter((s) => s.species === "cat")
      if (cats.length > 0) withCats++
      for (const c of cats) {
        expect(c.coat).toBeLessThan(WILD_CAT_COATS)
        breeds.add(c.coat)
      }
      expect(new Set(spawns.map((s) => s.id)).size).toBe(spawns.length)
    }
    expect(withCats / chunks.length).toBeGreaterThan(0.25)
    expect(breeds.size).toBeGreaterThan(15)
  })

  it("are the same cats on every visit", () => {
    for (const [cx, cz] of chunks.slice(0, 20)) expect(spawnsForChunk(cx, cz, false)).toEqual(spawnsForChunk(cx, cz, false))
  })
})

describe("selectWithCats", () => {
  const spawn = (id: string, species: AnimalSpawn["species"], x: number): AnimalSpawn => ({ id, species, coat: 0, seed: 1, scale: 1, x, z: 0 })

  it("gives cats their own slots so they never crowd out the other animals", () => {
    const candidates = [
      ...Array.from({ length: 12 }, (_, i) => spawn(`cat:${i}`, "cat", i)),
      ...Array.from({ length: 6 }, (_, i) => spawn(`fox:${i}`, "fox", 20 + i)),
    ]
    const selected = selectWithCats(candidates, 0, 0, 4, 5, 100)
    expect(selected.filter((s) => s.species === "cat").map((s) => s.id)).toEqual(["cat:0", "cat:1", "cat:2", "cat:3", "cat:4"])
    expect(selected.filter((s) => s.species === "fox")).toHaveLength(4)
  })
})

describe("applyCatBuild", () => {
  /** root > head > earL (+ an ear tip child 4 cm up), like the cat rig */
  const rig = (): { model: AnimalModel; tip: THREE.Object3D } => {
    const root = new THREE.Group()
    const head = new THREE.Bone(); head.name = "head"; head.position.set(0, 0.29, 0.18)
    const earL = new THREE.Bone(); earL.name = "earL"; earL.position.set(0.025, 0.02, -0.01)
    const tip = new THREE.Object3D(); tip.position.set(0, 0.04, 0)
    root.add(head); head.add(earL); earL.add(tip)
    const bones = new Map([["head", head], ["earL", earL]])
    return { model: { root, bones, material: new THREE.MeshStandardMaterial(), meshes: [] }, tip }
  }

  it("scales the head and ears uniformly", () => {
    const { model } = rig()
    applyCatBuild(model, { head: 1.1, ears: 0.8 })
    expect(model.bones.get("head")!.scale.toArray()).toEqual([1.1, 1.1, 1.1])
    expect(model.bones.get("earL")!.scale.toArray()).toEqual([0.8, 0.8, 0.8])
  })

  it("folds the ear tip forward and down over the skull", () => {
    const { model, tip } = rig()
    const earPos = new THREE.Vector3(), before = new THREE.Vector3(), after = new THREE.Vector3()
    model.root.updateMatrixWorld(true)
    model.bones.get("earL")!.getWorldPosition(earPos)
    tip.getWorldPosition(before).sub(earPos)
    applyCatBuild(model, { earFold: 1.25 })
    tip.getWorldPosition(after).sub(earPos)
    expect(before.y).toBeGreaterThan(0.03)
    expect(after.z).toBeGreaterThan(0.03) // tipped forward (+z is the cat's front)
    expect(after.y).toBeLessThan(before.y * 0.5)
  })

  it("does nothing without a build", () => {
    const { model } = rig()
    applyCatBuild(model, undefined)
    expect(model.bones.get("head")!.scale.toArray()).toEqual([1, 1, 1])
  })
})
