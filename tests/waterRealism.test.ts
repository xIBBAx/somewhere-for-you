import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { isOverWater, isSheltered, calculateWetMaterialParams, SHELTER_VOLUMES } from "../src/game/environment/water/waterSim"
import { waterVertexShader, waterFragmentShader } from "../src/game/environment/water/waterShaders"
import { waterfallCurtainVertexShader, waterfallCurtainFragmentShader, plungePoolVertexShader, plungePoolFragmentShader } from "../src/game/environment/water/waterfallShaders"
import { rainStreakVertexShader, rainStreakFragmentShader } from "../src/game/environment/water/rainShaders"
import { POND, WATER_Y, riverCenterZ } from "../src/game/world-layout"

describe("SOTA Water & Rain System Realism", () => {
  describe("Pond & Creek Layout and Depths", () => {
    it("has valid water level and pond layout", () => {
      expect(WATER_Y).toBe(-0.34)
      expect(POND.x).toBeCloseTo(9.2)
      expect(POND.z).toBeCloseTo(7.0)
      expect(POND.r).toBeGreaterThan(2.0)
    })

    it("correctly identifies positions over water vs land", () => {
      // Exactly in center of pond
      expect(isOverWater(POND.x, POND.z)).toBe(true)
      // On the river centerline
      expect(isOverWater(0, riverCenterZ(0))).toBe(true)
      // Far away on grassy hill
      expect(isOverWater(0, 20)).toBe(false)
      expect(isOverWater(-20, -10)).toBe(false)
    })

    it("correctly identifies sunken valley waterfall lagoon as water", () => {
      expect(isOverWater(0, -38)).toBe(true)
      expect(isOverWater(4, -40)).toBe(true)
    })
  })

  describe("Shelter Occlusion (Rain Collision)", () => {
    it("identifies positions under umbrellas and roofs as sheltered", () => {
      // Under rainy moment umbrella at (10.8, -15.6)
      expect(isSheltered(10.8, 1.5, -15.6)).toBe(true)
      // Above the umbrella roof
      expect(isSheltered(10.8, 3.5, -15.6)).toBe(false)
      // Under bridge at (0, -23.5)
      expect(isSheltered(0, 0.2, -23.5)).toBe(true)
      // Open sky
      expect(isSheltered(0, 1.0, 10)).toBe(false)
    })

    it("has all registered shelter volumes with valid non-zero radius", () => {
      expect(SHELTER_VOLUMES.length).toBeGreaterThanOrEqual(4)
      for (const s of SHELTER_VOLUMES) {
        expect(s.radius).toBeGreaterThan(1.0)
        expect(s.roofY).toBeGreaterThan(0)
      }
    })

    it("evaluates exact boundary thresholds for shelter volume", () => {
      const s = SHELTER_VOLUMES[0] // Umbrella at (10.8, -15.6), radius 1.35, roofY 1.85
      // Just under roof height
      expect(isSheltered(s.x, s.roofY - 0.05, s.z)).toBe(true)
      // Exactly at or above roof height
      expect(isSheltered(s.x, s.roofY, s.z)).toBe(false)
      expect(isSheltered(s.x, s.roofY + 0.1, s.z)).toBe(false)
      // Just inside radius
      expect(isSheltered(s.x + s.radius - 0.05, s.roofY - 0.5, s.z)).toBe(true)
      // Just outside radius
      expect(isSheltered(s.x + s.radius + 0.05, s.roofY - 0.5, s.z)).toBe(false)
    })
  })

  describe("Material Wetness Physics", () => {
    it("reduces surface roughness and darkens diffuse color when wet", () => {
      const dryRoughness = 0.85
      const dryColor = new THREE.Color("#d2ccc0")

      const { roughness: wetRoughness, color: wetColor } = calculateWetMaterialParams(
        dryRoughness,
        dryColor,
        1.0,
      )

      // Roughness must decrease when wet
      expect(wetRoughness).toBeLessThan(dryRoughness)
      expect(wetRoughness).toBeLessThanOrEqual(0.25)

      // Diffuse color must darken (lower luminance/values)
      expect(wetColor.r).toBeLessThan(dryColor.r)
      expect(wetColor.g).toBeLessThan(dryColor.g)
      expect(wetColor.b).toBeLessThan(dryColor.b)
    })

    it("leaves dry materials unchanged when wetness is 0", () => {
      const dryRoughness = 0.9
      const dryColor = new THREE.Color("#659c65")

      const { roughness, color } = calculateWetMaterialParams(dryRoughness, dryColor, 0)
      expect(roughness).toBeCloseTo(dryRoughness)
      expect(color.r).toBeCloseTo(dryColor.r)
    })

    it("clamps negative and excess wetness cleanly", () => {
      const dryRoughness = 0.8
      const dryColor = new THREE.Color("#888888")

      const zeroWet = calculateWetMaterialParams(dryRoughness, dryColor, -0.5)
      expect(zeroWet.roughness).toBeCloseTo(dryRoughness)
      expect(zeroWet.color.r).toBeCloseTo(dryColor.r)

      const fullWet = calculateWetMaterialParams(dryRoughness, dryColor, 1.5)
      const exactFull = calculateWetMaterialParams(dryRoughness, dryColor, 1.0)
      expect(fullWet.roughness).toBeCloseTo(exactFull.roughness)
      expect(fullWet.color.r).toBeCloseTo(exactFull.color.r)
    })
  })

  describe("Shader Integrity and Exports", () => {
    it("exports valid pond water shaders containing Fresnel and depth logic", () => {
      expect(waterVertexShader).toContain("vWorldPosition")
      expect(waterFragmentShader).toContain("fresnel")
      expect(waterFragmentShader).toContain("uWaterShallowColor")
      expect(waterFragmentShader).toContain("uWaterDeepColor")
      expect(waterFragmentShader).toContain("getCaustics")
      expect(waterFragmentShader).toContain("uRainIntensity")
    })

    it("exports valid waterfall shaders containing acceleration, aeration and plunge pool logic", () => {
      expect(waterfallCurtainVertexShader).toContain("fallProgress")
      expect(waterfallCurtainFragmentShader).toContain("aeration")
      expect(waterfallCurtainFragmentShader).toContain("breakup")
      expect(waterfallCurtainFragmentShader).toContain("whitewaterColor")
      expect(plungePoolVertexShader).toContain("uTurbulence")
      expect(plungePoolFragmentShader).toContain("foamMask")
    })

    it("exports valid rain streak shaders containing wind alignment and forward scattering", () => {
      expect(rainStreakVertexShader).toContain("uWind")
      expect(rainStreakVertexShader).toContain("fallSpeed")
      expect(rainStreakFragmentShader).toContain("forwardScatter")
    })
  })
})
