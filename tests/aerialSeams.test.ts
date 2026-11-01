import * as THREE from "three"
import { describe, expect, it } from "vitest"
import { AERIAL, AERIAL_FADE, HAZE_GLOW, HAZE_SUN, updateAerial } from "../src/world/render/aerialFog"
import { FAR_HALF, FAR_SPACING, FAR_VERTS, buildFarTerrain } from "../src/world/farTerrain"
import { LANDS_CAP, LANDS_INNER, LANDS_OUTER, LANDS_RINGS, landsRing } from "../src/world/horizonLands"
import { WATER_LEVEL, worldHeight } from "../src/world/terrain"

/** The world seen from the air must not split into its LOD layers. */
describe("one aerial perspective for every layer of land", () => {
  it("is installed into three's fog, shared by reference with every material", () => {
    expect(THREE.ShaderChunk.fog_fragment).toContain("uAerial")
    // the eye-space position travels whole: the sunlit haze needs each fragment's direction
    expect(THREE.ShaderChunk.fog_vertex).toContain("vFogView")
    expect(THREE.ShaderChunk.fog_fragment).toContain("hazeTint")
    expect((THREE.UniformsUtils.clone(THREE.UniformsLib.fog) as Record<string, THREE.IUniform>).uHazeSun.value).toBe(HAZE_SUN)
    expect(THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms).uHazeGlow.value).toBe(HAZE_GLOW)
    // UniformsUtils.clone copies Colors and Vectors but shares typed arrays,
    // so all materials read one set of values
    expect((THREE.UniformsUtils.clone(THREE.UniformsLib.fog) as Record<string, THREE.IUniform>).uAerial.value).toBe(AERIAL)
    expect(THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms).uAerialFade.value).toBe(AERIAL_FADE)
    expect(THREE.UniformsUtils.clone(THREE.ShaderLib.physical.uniforms).uAerial.value).toBe(AERIAL)
  })

  it("leaves the ground's look alone near the ground and off Earth", () => {
    updateAerial(20)
    expect([...AERIAL]).toEqual([0, 0, 0, 0])
    updateAerial(-1)
    expect([...AERIAL]).toEqual([0, 0, 0, 0])
    expect(AERIAL_FADE[0]).toBe(0)
  })

  it("hazes blue light most, and dissolves the ground world only once Earth's photograph takes over", () => {
    updateAerial(400)
    expect(AERIAL[2]).toBeGreaterThan(AERIAL[1])
    expect(AERIAL[1]).toBeGreaterThan(AERIAL[0])
    expect(AERIAL_FADE[0]).toBe(0)
    updateAerial(1250)
    expect(AERIAL_FADE[0]).toBeGreaterThan(0)
    expect(AERIAL_FADE[0]).toBeLessThan(1)
    updateAerial(2000)
    expect(AERIAL_FADE[0]).toBe(1)
    // Starborn and her riders are never dissolved
    expect(AERIAL_FADE[1]).toBeGreaterThanOrEqual(100)
  })
})

describe("far shorelines and the lands under the whole world", () => {
  it("gives the far grid the water's real depth, so its shore follows the land", () => {
    const d = buildFarTerrain(512, -256)
    for (const [i, j] of [[4, 9], [28, 28], [51, 40]]) {
      const x = 512 - FAR_HALF + i * FAR_SPACING, z = -256 - FAR_HALF + j * FAR_SPACING
      expect(d.kinds[(j * FAR_VERTS + i) * 2 + 1]).toBeCloseTo(WATER_LEVEL - worldHeight(x, z), 4)
    }
  })

  it("lets the horizon lands reach the centre, then ring out to the horizon", () => {
    expect(landsRing(0)).toBe(0)
    expect(landsRing(LANDS_CAP)).toBeCloseTo(LANDS_INNER, 6)
    expect(landsRing(LANDS_RINGS - 1)).toBeCloseTo(LANDS_OUTER, 3)
    for (let i = 1; i < LANDS_RINGS; i++) expect(landsRing(i)).toBeGreaterThan(landsRing(i - 1))
  })
})
