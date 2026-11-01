import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync } from "node:fs"

/**
 * Every shipped horse model is whole: the body mesh is finite and left-right
 * symmetric, and the wings (on the Pegasi) span both sides evenly. A failed
 * retopology once collapsed half of a body into streaks while the build still
 * "succeeded"; these bounds catch that without loading the model.
 */
type Acc = { min?: number[]; max?: number[] }
const files = readdirSync("public/assets/horses").filter((f) => f.endsWith(".glb"))

describe.each(files)("%s", (file) => {
  const b = readFileSync(`public/assets/horses/${file}`)
  const gj = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString()) as {
    nodes: Array<{ name?: string; mesh?: number; extras?: { horse?: string } }>
    meshes: Array<{ primitives: Array<{ attributes: Record<string, number> }> }>
    accessors: Acc[]
  }
  const meta = JSON.parse(gj.nodes.find((n) => n.extras?.horse)!.extras!.horse!) as { height: number; wing?: { semi: number } }
  const bounds = (name: string): Acc | null => {
    const n = gj.nodes.find((x) => x.name === name && x.mesh !== undefined)
    return n ? gj.accessors[gj.meshes[n.mesh!].primitives[0].attributes.POSITION] : null
  }

  it("has a whole, symmetric body", () => {
    const a = bounds("body") ?? bounds("body_lod1")
    expect(a).not.toBeNull()
    const [mn, mx] = [a!.min!, a!.max!]
    for (const v of [...mn, ...mx]) expect(Number.isFinite(v)).toBe(true)
    const H = meta.height
    expect(Math.abs(mn[0] + mx[0])).toBeLessThan(0.04 * H)
    expect(mx[0] - mn[0]).toBeGreaterThan(0.3 * H)
    expect(mx[1]).toBeGreaterThan(1.1 * H)
    expect(mx[1]).toBeLessThan(1.7 * H)
    expect(mn[1]).toBeGreaterThan(-0.05)
  })

  it.runIf(!!meta.wing)("spreads both wings evenly", () => {
    const a = bounds("wings") ?? bounds("wings_lod1")
    expect(a).not.toBeNull()
    expect(Math.abs(a!.min![0] + a!.max![0])).toBeLessThan(0.02)
    expect(a!.max![0]).toBeGreaterThan(0.85 * meta.wing!.semi)
  })
})
