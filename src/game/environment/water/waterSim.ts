import * as THREE from "three"
import { POND, RIVER_MIN_X, RIVER_MAX_X, riverCenterZ, riverHalfWidthAt } from "../../world-layout"
import { WATER_LEVEL, lakeMask } from "../../../world/climate"
import { worldHeight } from "../../../world/terrain"

/**
 * Shelter bounds where rain is occluded by roofs or umbrellas.
 */
export const SHELTER_VOLUMES: Array<{
  x: number
  z: number
  radius: number
  roofY: number
}> = [
  // Rainy moment bench umbrella
  { x: 10.8, z: -15.6, radius: 1.35, roofY: 1.85 },
  // Little wooden bridge underside
  { x: 0, z: -23.5, radius: 2.2, roofY: 0.55 },
  // corner café awning
  { x: 2.4, z: -10.8, radius: 3.5, roofY: 2.4 },
  // studio porch
  { x: -12.4, z: 3.2, radius: 3.2, roofY: 2.2 },
]

/**
 * Checks if a world position is sheltered under an umbrella, awning or roof.
 */
export const isSheltered = (x: number, y: number, z: number): boolean => {
  for (let i = 0; i < SHELTER_VOLUMES.length; i++) {
    const s = SHELTER_VOLUMES[i]
    const dx = x - s.x
    const dz = z - s.z
    if (dx * dx + dz * dz < s.radius * s.radius && y < s.roofY) {
      return true
    }
  }
  return false
}

/**
 * Checks if a world position (x, z) is over a water body (Pond, Creek or Waterfall lagoon).
 */
export const isOverWater = (x: number, z: number): boolean => {
  if (lakeMask(x, z) > 0 && worldHeight(x, z) < WATER_LEVEL) return true
  // 1. Pond check
  const dxPond = x - POND.x
  const dzPond = z - POND.z
  if (dxPond * dxPond + dzPond * dzPond < (POND.r + 0.3) * (POND.r + 0.3)) {
    return true
  }

  // 2. Creek / river check
  if (x >= RIVER_MIN_X && x <= RIVER_MAX_X) {
    const halfWidth = riverHalfWidthAt(x)
    if (Math.abs(z - riverCenterZ(x)) <= halfWidth + 0.2) {
      return true
    }
  }

  // 3. Sunken valley waterfall lagoon check
  if (Math.abs(x) < 12.0 && z <= -34.0 && z >= -48.0) {
    return true
  }

  return false
}

/**
 * Calculates surface wetness response for PBR materials:
 * - Roughness reduces as moisture film smooths microfacets
 * - Specular reflectivity increases at grazing angles
 * - Diffuse color darkens due to multiple internal refraction passes
 */
export const calculateWetMaterialParams = (
  baseRoughness: number,
  baseColor: THREE.Color,
  wetness: number,
): { roughness: number; color: THREE.Color } => {
  const wet = THREE.MathUtils.clamp(wetness, 0, 1)
  // Water film smooths roughness towards ~0.15 - 0.25
  const roughness = THREE.MathUtils.lerp(baseRoughness, Math.min(baseRoughness * 0.45, 0.22), wet)

  // Internal absorption darkens diffuse reflectance by up to ~22%
  const darkened = baseColor.clone().multiplyScalar(1.0 - wet * 0.22)

  return { roughness, color: darkened }
}
