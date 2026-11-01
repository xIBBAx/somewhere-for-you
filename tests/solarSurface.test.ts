import { describe, expect, it } from "vitest"
import { solarExposure, solarTime, SOLAR_SURFACE_GLSL } from "../src/game/celestial/render/solarSurface"
import { BODY_FRAGMENT } from "../src/game/celestial/render/bodyShader"
import { readFileSync } from "node:fs"

describe("resolved solar surface", () => {
  it("keeps the distant daylight disc bright and adapts continuously to close detail", () => {
    expect(solarExposure(0.5)).toBe(6)
    expect(solarExposure(5)).toBe(6)
    expect(solarExposure(60)).toBeCloseTo(1.2)
    expect(solarExposure(2000)).toBeCloseTo(1.2)
    let last = solarExposure(0)
    for (let px = 0.25; px <= 100; px += 0.25) {
      const light = solarExposure(px)
      expect(light).toBeLessThanOrEqual(last)
      expect(Math.abs(light - last)).toBeLessThan(0.04)
      expect(light).toBeGreaterThanOrEqual(1.2 - 1e-12)
      last = light
    }
  })

  it("freezes solar advection under reduced motion without dropping spatial detail", () => {
    expect(solarTime(1, true)).toBe(solarTime(10000, true))
    expect(solarTime(120, false)).toBe(120)
  })

  it("uses solar-only decorrelated noise without directional sine stripes", () => {
    expect(SOLAR_SURFACE_GLSL).not.toMatch(/\bsin\(/)
    expect(SOLAR_SURFACE_GLSL).not.toMatch(/\bnoise3\(/)
    expect(SOLAR_SURFACE_GLSL).toContain("SOLAR_ROT * p * 2.17")
    expect(SOLAR_SURFACE_GLSL).toContain("length(dFdx(p))")
  })

  it("writes the real Sun intersection depth without giving atmospheric shells solid depth", () => {
    // The old sky path wrote no depth, allowing a magnetic echo on the far
    // side to draw over the star. Proxy depth also incorrectly hides nearby
    // echoes, since its squeezed radius is much closer than the photosphere.
    const sky = readFileSync("src/game/celestial/render/CelestialSky.tsx", "utf8")
    expect(sky).toContain('depthWrite: def.id === "sun"')
    expect(sky).toContain('depthTest: def.id === "sun", depthFunc: THREE.AlwaysDepth')
    expect(BODY_FRAGMENT).toContain("tHit * uTrueRadius")
    expect(BODY_FRAGMENT).toContain("if (uKind == 3) {\n      gl_FragDepth = 1.0;")
    expect(BODY_FRAGMENT).toContain("if (air && uKind != 3)")
  })
})
