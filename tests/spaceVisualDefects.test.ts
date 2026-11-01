import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { CATALOGUE_STAR_FRAGMENT, STAR_FRAGMENT } from "../src/game/celestial/render/skyShaders"
import { buildHorizonLands } from "../src/world/horizonLands"
import { EARTH_R } from "../src/game/celestial/scale"

/** The space-journey defects found on the night ascent and return. */
describe("space journey visual defects stay fixed", () => {
  it("adds the stars' light as written: premultiplied, since their alpha is 0", () => {
    // unpremultiplied additive blending is (SRC_ALPHA, ONE): alpha 0 drew none of the 22k catalogue stars
    expect(CATALOGUE_STAR_FRAGMENT).toContain("gl_FragColor = vec4(vColor * vI * a, 0.0);")
    expect(STAR_FRAGMENT).toContain(", 0.0);")
    const sky = readFileSync("src/game/celestial/render/CelestialSky.tsx", "utf8")
    const additive = sky.split("\n").filter((l) => l.includes("blending: THREE.AdditiveBlending"))
    const points = additive.filter((l) => !l.includes("SpriteMaterial"))
    expect(points.length).toBeGreaterThanOrEqual(2)
    for (const l of points) expect(l).toContain("premultipliedAlpha: true")
  })

  it("gives the horizon lands a share of water per vertex, not a 0/1 polygon", () => {
    const d = buildHorizonLands(0, 0, EARTH_R)
    let partial = 0
    for (let k = 1; k < d.kinds.length; k += 2) {
      const wet = d.kinds[k]
      expect(wet).toBeGreaterThanOrEqual(0)
      expect(wet).toBeLessThanOrEqual(1)
      if (wet > 0 && wet < 1) partial++
    }
    expect(partial).toBeGreaterThan(0)
  })
})
