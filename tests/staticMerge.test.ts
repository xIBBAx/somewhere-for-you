import { describe, expect, it } from "vitest"
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three"
import { StaticMerger } from "../src/game/staticMerge"

describe("static scenery batching", () => {
  it("never bakes an animal's locally still body or wings into scenery", () => {
    const root = new Group(), animal = new Group(), wing = new Group()
    root.add(animal); animal.add(wing)
    const body = new Mesh(new BoxGeometry(), new MeshStandardMaterial())
    wing.add(body)
    const merger = new StaticMerger(root)
    expect(merger.eligible(body)).toBe(false)
    animal.matrixAutoUpdate = wing.matrixAutoUpdate = false
    animal.userData.dynamic = true
    merger.add(body)
    expect(merger.owns(body)).toBe(false)
    expect(body.layers.mask).toBe(1)
    body.geometry.dispose(); (body.material as MeshStandardMaterial).dispose()
  })

  it("retains batching for proven static scenery and restores a released mesh", () => {
    const root = new Group(), scenery = new Group()
    scenery.matrixAutoUpdate = false
    root.add(scenery)
    const material = new MeshStandardMaterial(), geometry = new BoxGeometry()
    const a = new Mesh(geometry, material), b = new Mesh(geometry, material)
    scenery.add(a, b)
    const merger = new StaticMerger(root)
    merger.add(a); merger.add(b); merger.flush()
    expect(merger.owns(a)).toBe(true)
    expect(a.layers.mask).not.toBe(1)
    merger.release(a); merger.flush()
    expect(a.layers.mask).toBe(1)
    expect(a.matrixWorldAutoUpdate).toBe(true)
    merger.dispose(); geometry.dispose(); material.dispose()
  })
})
