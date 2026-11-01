import { POND, WATER_Y, riverCenterZ, riverEnvelope, riverHalfWidthAt } from "./hubLayout"
import { inRealm } from "./realmHook"
import { WATER_LEVEL, lakeMask } from "./climate"
import { worldHeight } from "./terrain"
import { highvaleWeight } from "./highvale/highvaleLayout"
import { highvaleRiverSurfaceAt } from "./highvale/highvaleRiver"

/**
 * Where is open water, and how deep is it? Wild lakes fill every basin of the
 * lake mask up to WATER_LEVEL (exactly what StreamedWater renders). The home
 * pond and river are authored and fenced by colliders, so they are not
 * swimmable and report no surface here.
 */
export const waterSurfaceAt = (x: number, z: number): number | null => {
  if (inRealm(x, z)) return null
  // The river runs downhill, so it has its own surface (highvale/highvaleRiver.ts)
  if (highvaleWeight(x, z) > 0) {
    const river = highvaleRiverSurfaceAt(x, z)
    if (river !== null) return river
  }
  if (lakeMask(x, z) <= 0) return null
  return worldHeight(x, z) < WATER_LEVEL ? WATER_LEVEL : null
}

/** Depth of water over the bed at (x, z), 0 on dry land. */
export const waterDepthAt = (x: number, z: number): number => {
  const surface = waterSurfaceAt(x, z)
  return surface === null ? 0 : Math.max(0, surface - worldHeight(x, z))
}

/** Rendered authored water, independently of the swimming/collider contract.
 * Match the pond ellipse and irregular banks used by Water.tsx. */
export const flightWaterSurfaceAt = (x: number, z: number): number | null => {
  if (inRealm(x, z)) return null
  const dx = (x - POND.x) / 1.08, dz = (z - POND.z) / 0.88
  const angle = Math.atan2(dz, dx)
  const radius = POND.r + Math.sin(angle * 3 + 0.6) * 0.22 + Math.sin(angle * 7 - 0.3) * 0.1
  if (dx * dx + dz * dz < radius * radius) return WATER_Y
  const envelope = riverEnvelope(x)
  const bank = riverHalfWidthAt(x) + (Math.sin(x * 1.17) * 0.06 + Math.sin(x * 0.43 + 1.8) * 0.08) * envelope
  if (envelope > 0 && Math.abs(z - riverCenterZ(x)) < bank) return WATER_Y
  return waterSurfaceAt(x, z)
}
