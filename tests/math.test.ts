import { describe, expect, it } from "vitest"
import { clamp, damp, dampAngle, lerp, lerpAngle, makeRng, smoothstep } from "../src/utils/math"

describe("math utils", () => {
  it("clamps", () => {
    expect(clamp(5, 0, 3)).toBe(3)
    expect(clamp(-2, 0, 3)).toBe(0)
    expect(clamp(1.5, 0, 3)).toBe(1.5)
  })

  it("lerps", () => {
    expect(lerp(0, 10, 0.5)).toBe(5)
    expect(lerp(2, 4, 0)).toBe(2)
    expect(lerp(2, 4, 1)).toBe(4)
  })

  it("damp converges toward the target and is frame-rate stable", () => {
    // many small steps vs one big step land in the same place
    let a = 0
    for (let i = 0; i < 60; i++) a = damp(a, 10, 3, 1 / 60)
    const b = damp(damp(0, 10, 3, 0.5), 10, 3, 0.5)
    expect(Math.abs(a - b)).toBeLessThan(0.05)
    expect(a).toBeGreaterThan(9)
  })

  it("damps angles via the shortest arc", () => {
    const out = dampAngle(0.1, Math.PI * 2 - 0.1, 10, 0.5)
    expect(out).toBeLessThan(Math.PI) // went backwards, not the long way
  })

  it("lerpAngle handles wrap-around", () => {
    expect(Math.abs(lerpAngle(Math.PI * 0.9, -Math.PI * 0.9, 0.5))).toBeCloseTo(Math.PI, 5)
  })

  it("smoothstep eases between edges", () => {
    expect(smoothstep(0, 1, 0)).toBe(0)
    expect(smoothstep(0, 1, 1)).toBe(1)
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 5)
    expect(smoothstep(0, 1, -1)).toBe(0)
    expect(smoothstep(0, 1, 2)).toBe(1)
  })

  it("makeRng is deterministic", () => {
    const a = makeRng(42)
    const b = makeRng(42)
    expect(a()).toBe(b())
    expect(a()).toBe(b())
  })
})
