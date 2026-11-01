import type { Matrix4 } from "three"
import { fishVisualY, type FishAgent } from "./simulation"

/** Compose the common yaw-only pose without Object3D/Euler/quaternion work.
 * Cached steering tangents also avoid repeated trig across distant instances. */
export const writeFishPose = (matrix: Matrix4, fish: FishAgent, originX: number, originZ: number): void => {
  const e = matrix.elements, size = fish.size, s = fish.directionX, c = fish.directionZ
  const pitch = fish.jumping > 0 ? -Math.cos(fish.jumping / fish.jumpDuration * Math.PI) * 0.55 : 0
  const sp = pitch === 0 ? 0 : Math.sin(pitch), cp = pitch === 0 ? 1 : Math.cos(pitch)
  e[0] = c * size; e[1] = 0; e[2] = -s * size; e[3] = 0
  e[4] = s * sp * size; e[5] = cp * size; e[6] = c * sp * size; e[7] = 0
  e[8] = s * cp * size; e[9] = -sp * size; e[10] = c * cp * size; e[11] = 0
  e[12] = fish.x - originX; e[13] = fishVisualY(fish); e[14] = fish.z - originZ; e[15] = 1
}
