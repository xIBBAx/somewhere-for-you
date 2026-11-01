import * as THREE from "three"
import type { GroundTrack } from "./groundHistory"

export const TRAIL_SIZE = 512
export const TRAIL_WINDOW = 64

/** A fixed-size moving window, rebuilt from the bounded contact history. All
 * calculations stay in logical doubles until offsets reach the texture. */
export const packTrailField = (data: Uint8Array, tracks: Iterable<GroundTrack | undefined>, x: number, z: number): void => {
  data.fill(0)
  const step = TRAIL_WINDOW / TRAIL_SIZE
  for (const track of tracks) {
    if (!track?.active || track.surface.kind !== "grass") continue
    const dx = track.x - x, dz = track.z - z
    if (Math.abs(dx) > TRAIL_WINDOW / 2 + 1 || Math.abs(dz) > TRAIL_WINDOW / 2 + 1) continue
    const strength = Math.min(1, track.pressure) * track.integrity * Math.exp(-track.age / 22)
    // The entire stamp rounds to zero in the byte texture below this bound.
    // Old footsteps stay in history without repeatedly rasterizing empty pixels.
    if (strength * 255 < 0.5) continue
    const cx = (dx / TRAIL_WINDOW + 0.5) * TRAIL_SIZE
    const cz = (dz / TRAIL_WINDOW + 0.5) * TRAIL_SIZE
    const width = Math.max(0.12, track.width * 0.75), length = Math.max(0.14, track.length * 0.75)
    const radius = Math.ceil(Math.max(width, length) / step) + 1
    const sin = Math.sin(track.angle), cos = Math.cos(track.angle)
    for (let iz = Math.max(0, Math.floor(cz) - radius); iz <= Math.min(TRAIL_SIZE - 1, Math.ceil(cz) + radius); iz++) {
      for (let ix = Math.max(0, Math.floor(cx) - radius); ix <= Math.min(TRAIL_SIZE - 1, Math.ceil(cx) + radius); ix++) {
        const rx = (ix + 0.5 - cx) * step, rz = (iz + 0.5 - cz) * step
        const lateral = (rx * cos - rz * sin) / width, forward = (rx * sin + rz * cos) / length
        const compression = Math.max(0, 1 - lateral * lateral - forward * forward) * strength
        const i = iz * TRAIL_SIZE + ix
        data[i] = Math.max(data[i], Math.round(compression * 255))
      }
    }
  }
}

let shared: ReturnType<typeof createTrailResources> | undefined
const createTrailResources = () => {
  const data = new Uint8Array(TRAIL_SIZE ** 2)
  const texture = new THREE.DataTexture(data, TRAIL_SIZE, TRAIL_SIZE, THREE.RedFormat)
  texture.minFilter = texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return { data, texture, centerX: 0, centerZ: 0,
    uniforms: { uTrailField: { value: texture }, uTrailCenter: { value: new THREE.Vector2() } } }
}
// Shared with both grass layers; one texture for the lifetime of the world.
export const trailResources = (): ReturnType<typeof createTrailResources> => shared ??= createTrailResources()
