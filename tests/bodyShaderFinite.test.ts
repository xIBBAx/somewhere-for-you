import { describe, expect, it } from "vitest"
import { BODY_FRAGMENT } from "../src/game/celestial/render/bodyShader"

/**
 * The ascent blackout (~110-150 km): Earth's shader produced a few
 * NaN pixels, and the HDR chain's bloom spread them over the whole frame.
 * Two sources, both guarded here at the source, plus a last-line guard.
 */
describe("the body shader never hands the frame NaN", () => {
  it("takes its ray-sphere roots without sign(b) (0 for a level ray: c / -0.0 = Inf)", () => {
    expect(BODY_FRAGMENT).not.toMatch(/sign\(\s*b\s*\)\s*\*/)
    expect(BODY_FRAGMENT).toContain("float q = b >= 0.0 ? -b - h : -b + h;")
  })

  it("clamps every square root that rounding can push below zero", () => {
    expect(BODY_FRAGMENT).toContain("sqrt(max(rHi * rHi - b2, 0.0))")
    expect(BODY_FRAGMENT).toContain("sqrt(max(1.0 - cz * cz, 0.0))")
  })

  it("scrubs a non-finite colour by its bits before writing it", () => {
    expect(BODY_FRAGMENT).toContain("floatBitsToUint(x) & 0x7f800000u")
    expect(BODY_FRAGMENT).toMatch(/if \(nonFinite\(color\.r\) \|\| nonFinite\(color\.g\) \|\| nonFinite\(color\.b\)\) color = vec3\(0\.0\);/)
  })
})
