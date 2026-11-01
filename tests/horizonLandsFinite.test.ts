/// <reference types="node" />
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * The dive blackout: diving Starborn at ~400 m, whole frames went
 * black every second or so. Under the composer's 4x MSAA, a few edge samples
 * on the horizon lands' long grazing triangles shaded past half-float range
 * (+-Inf in red), and the bloom spread them over the frame. Found by bisecting
 * the scene's meshes in a 4x-sampled half-float target; float or unsampled
 * targets never showed it.
 */
describe("the horizon lands never hand the composer an overflow", () => {
  const source = readFileSync("src/world/render/HorizonLands.tsx", "utf8")

  it("scrubs a non-finite colour by its bits and clamps it to a finite range", () => {
    const tail = source.slice(source.indexOf('.replace("#include <dithering_fragment>"'))
    expect(tail.length).toBeLessThan(source.length)
    expect(tail).toContain("floatBitsToUint(gl_FragColor.rgb) & 0x7f800000u")
    expect(tail).toMatch(/gl_FragColor\.rgb = clamp\(gl_FragColor\.rgb, 0\.0, \d+\.0\);/)
  })

  it("recompiles the program for the guard", () => {
    expect(source).toMatch(/customProgramCacheKey = \(\) => "horizon-lands-v([8-9]|\d\d)"/)
  })
})

/**
 * The corridor's opening frame (same day): Starborn's halo took
 * pow(1.0 - abs(dot(vN, vV)), 2.6). Interpolated unit vectors can dot a hair
 * past 1, and pow() of a negative base is NaN in GLSL, so one frame went black
 * as the warp opened. Every fresnel rim of that shape is clamped now.
 */
describe("fresnel rims never take pow() of a negative base", () => {
  const files = [
    "src/game/celestial/WarpCorridor.tsx", "src/game/celestial/ReentryFX.tsx", "src/game/celestial/rings/RingField.tsx",
    "src/game/horses/horseAssets.ts", "src/game/pegasus/DashFX.tsx", "src/world/life/ground/material.ts",
  ]
  it.each(files)("%s", (file) => {
    const source = readFileSync(file, "utf8")
    expect(source).not.toMatch(/pow\(\s*1\.0\s*-\s*(abs\()?dot\(/)
    expect(source).toMatch(/pow\(max\(1\.0 - abs\(dot\(/)
  })
})
