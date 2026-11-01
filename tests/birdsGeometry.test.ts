import { describe, expect, it } from "vitest"
import { createBirdGeometry, BIRD_PART_BODY, BIRD_PART_BREAST, BIRD_PART_DARK } from "../src/world/life/birdsGeometry"
import { createBirdMaterial, birdUniforms } from "../src/world/life/birdsMaterial"

describe("birdsGeometry — detailed songbird", () => {
  const geom = createBirdGeometry()
  const pos = geom.getAttribute("position")
  const normal = geom.getAttribute("normal")
  const index = geom.getIndex()

  it("stays inside the 500-1500 triangle budget", () => {
    expect(index!.count / 3).toBeGreaterThanOrEqual(500)
    expect(index!.count / 3).toBeLessThanOrEqual(1500)
  })

  it("keeps the +Z beak forward and the tail aft with +Y up", () => {
    geom.computeBoundingBox()
    const box = geom.boundingBox!
    // beak reaches well forward of the body centre, tail trails behind it
    expect(box.max.z).toBeGreaterThan(0.38)
    expect(box.min.z).toBeLessThan(-0.4)
    // head sits above the belly
    expect(box.max.y).toBeGreaterThan(0.11)
    expect(box.min.y).toBeGreaterThan(-0.12)
    // roughly symmetric across X
    expect(Math.abs(box.max.x + box.min.x)).toBeLessThan(0.001)
  })

  it("bakes head, breast and beak into separate tintable regions", () => {
    const part = geom.getAttribute("aBirdPart")
    const seen = new Set<number>()
    for (let i = 0; i < part.count; i++) seen.add(part.getX(i))
    expect(seen.has(BIRD_PART_BODY)).toBe(true)
    expect(seen.has(BIRD_PART_BREAST)).toBe(true)
    expect(seen.has(BIRD_PART_DARK)).toBe(true)
  })

  it("articulates wings at the shoulder and the elbow", () => {
    const wf = geom.getAttribute("aWingFactor")
    const ws = geom.getAttribute("aWingSpan")
    const we = geom.getAttribute("aWingElbow")
    let inner = 0
    let outer = 0
    let body = 0
    let maxSpan = 0
    let maxElbow = 0
    for (let i = 0; i < wf.count; i++) {
      const f = wf.getX(i)
      if (f === 0) body++
      else if (f <= 0.5) inner++
      else outer++
      if (f > 0) {
        maxSpan = Math.max(maxSpan, ws.getX(i))
        maxElbow = Math.max(maxElbow, we.getX(i))
      }
    }
    expect(body).toBeGreaterThan(100)
    expect(inner).toBeGreaterThan(40)
    expect(outer).toBeGreaterThan(40)
    // primaries reach much further from the elbow than the inner panel does
    expect(maxElbow).toBeGreaterThan(0.1)
    expect(maxSpan).toBeGreaterThan(0.25)
  })

  it("never leaves the wing root welded to the body", () => {
    // The shader skips vertices with aWingFactor == 0, so any triangle that
    // mixes weighted wing vertices with unweighted ones would tear the wing
    // off the body mid-flap. Asserted on triangle adjacency, which is exactly
    // the condition the shader branch creates.
    const wf = geom.getAttribute("aWingFactor")
    const idx = geom.getIndex()!
    let wingTris = 0
    const torn: number[] = []
    for (let t = 0; t < idx.count; t += 3) {
      const a = wf.getX(idx.getX(t))
      const b = wf.getX(idx.getX(t + 1))
      const c = wf.getX(idx.getX(t + 2))
      if (a > 0 || b > 0 || c > 0) {
        wingTris++
        if (a === 0 || b === 0 || c === 0) torn.push(t / 3)
      }
    }
    expect(wingTris).toBeGreaterThan(80)
    expect(torn).toEqual([])
    // and the ramp must start strictly above zero so the root itself moves
    let minWeighted = Infinity
    for (let i = 0; i < wf.count; i++) {
      const f = wf.getX(i)
      if (f > 0) minWeighted = Math.min(minWeighted, f)
    }
    expect(minWeighted).toBeGreaterThan(0.05)
  })

  it("separates the primary tips so the wing reads as feathers", () => {
    // distinct tips: at least 5 outboard vertices beyond x = 0.45, spread in z
    const pos = geom.getAttribute("position")
    const wf = geom.getAttribute("aWingFactor")
    const tips = new Set<string>()
    for (let i = 0; i < wf.count; i++) {
      if (Math.abs(pos.getX(i)) > 0.45 && wf.getX(i) > 0.9) {
        tips.add(`${Math.round(pos.getZ(i) * 1000)}`)
      }
    }
    expect(tips.size).toBeGreaterThanOrEqual(5)
  })

  it("has finite normals everywhere and no NaN vertices", () => {
    for (let i = 0; i < pos.count; i++) {
      expect(Number.isFinite(pos.getX(i))).toBe(true)
      expect(Number.isFinite(pos.getY(i))).toBe(true)
      expect(Number.isFinite(pos.getZ(i))).toBe(true)
      expect(Number.isFinite(normal.getX(i))).toBe(true)
      expect(Number.isFinite(normal.getY(i))).toBe(true)
      expect(Number.isFinite(normal.getZ(i))).toBe(true)
    }
  })

  it("adds standing legs only for the ground variant", () => {
    const flying = createBirdGeometry()
    const standing = createBirdGeometry({ feet: true })
    expect(standing.getIndex()!.count).toBeGreaterThan(flying.getIndex()!.count)
    flying.computeBoundingBox()
    standing.computeBoundingBox()
    // feet reach the ground plane so terrain contact is exact
    expect(standing.boundingBox!.min.y).toBeLessThan(flying.boundingBox!.min.y)
    expect(standing.boundingBox!.min.y).toBeLessThan(-0.08)
    // and the flying variant is unchanged by the option
    expect(flying.getAttribute("aBirdPart").count).toBe(pos.count)
  })
})

describe("birdsMaterial — GPU wing deformation", () => {
  const compile = (): { uniforms: Record<string, unknown>; vertex: string } => {
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader:
        "#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>\nvoid main(){}",
      fragmentShader: "void main(){}",
    }
    createBirdMaterial().onBeforeCompile(shader as never, {} as never)
    return { uniforms: shader.uniforms, vertex: shader.vertexShader }
  }

  it("hooks the standard vertex stages three.js actually emits", () => {
    const { vertex } = compile()
    // Each hook re-emits its own `#include` as the first line of its
    // replacement, which is why the placeholders are still present; what
    // matters is that our code follows them in both stages.
    const commonAt = vertex.indexOf("attribute float aWingFactor")
    const normalAt = vertex.indexOf("birdWingAngles();")
    const beginAt = vertex.indexOf("#include <begin_vertex>")
    expect(commonAt).toBeGreaterThan(vertex.indexOf("#include <common>"))
    expect(normalAt).toBeGreaterThan(vertex.indexOf("#include <beginnormal_vertex>"))
    expect(beginAt).toBeGreaterThan(normalAt)
    expect(vertex).toContain("attribute vec4 aBirdParams")
    expect(vertex).toContain("attribute float aWingElbow")
    // wing chain state is declared once and shared by both stages
    expect(vertex.match(/float birdShoulderAngle = 0\.0;/g)).toHaveLength(1)
    expect(vertex.match(/float birdElbow = 0\.0;/g)).toHaveLength(1)
  })

  it("flaps about +Z, not +Y, so both wings rise together", () => {
    const { vertex } = compile()
    // rotZ keeps the z column as the identity; rotY would yaw the wing.
    const rotZ = vertex.slice(vertex.indexOf("mat3 birdRotZ"))
    expect(rotZ).toContain("0.0, 0.0, 1.0)")
    expect(rotZ).toContain("cos(ang)")
    expect(rotZ).toContain("sin(ang)")
  })

  it("rotates each half about its own signed shoulder pivot", () => {
    const { vertex } = compile()
    // abs(position.x) with a side sign is what keeps left and right exact
    // mirrors; a shared unsigned pivot shears the bird instead.
    expect(vertex).toContain("float side = position.x < 0.0 ? -1.0 : 1.0;")
    expect(vertex).toContain("abs(position.x) - 0.055")
    expect(vertex).toContain("side * (0.055 +")
  })

  it("ramps the elbow fold in past the hinge using the geometry ramp", () => {
    const { vertex } = compile()
    expect(vertex).toContain("clamp((aWingFactor - 0.5) * 2.0, 0.0, 1.0)")
    // shoulder 1.0 -> tip 1.9x, so the primaries swing furthest
    expect(vertex).toContain("birdShoulderAngle * (1.0 + birdElbow * 0.9)")
  })

  it("rotates wing normals through the same matrix as the positions", () => {
    const { vertex } = compile()
    expect(vertex).toContain(
      "objectNormal = birdRotZ(normalSide * birdShoulderAngle * (1.0 + birdElbow * 0.9)) * objectNormal;",
    )
    // one matrix, two consumers: the stages cannot drift apart
    const angles = vertex.match(/birdShoulderAngle \* \(1\.0 \+ birdElbow \* 0\.9\)/g)
    expect(angles).toHaveLength(2)
  })

  it("holds the glide dihedral when the flap amplitude is zero", () => {
    const { vertex } = compile()
    expect(vertex).toContain("+ (1.0 - amp) * aBirdParams.w")
  })

  it("shares one time uniform across every material instance", () => {
    const { uniforms } = compile()
    expect(uniforms.uBirdTime).toBe(birdUniforms.uBirdTime)
  })

  it("uses a stable custom program cache key", () => {
    expect(createBirdMaterial().customProgramCacheKey!()).toBe("world-bird-v3-mirrored-normals")
  })
})
