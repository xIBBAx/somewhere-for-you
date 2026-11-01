import type { BufferGeometry } from "three"
import { worldHeight } from "../terrain"

/** The authored sandy banks were flat sheets 4–5 cm below the surface and
 * occluded every submerged animal. Seat their existing vertices on the bed. */
export const seatAquaticBank = (geometry: BufferGeometry): BufferGeometry => {
  const p = geometry.attributes.position
  for (let i = 0; i < p.count; i++) p.setY(i, worldHeight(p.getX(i), p.getZ(i)) + 0.012)
  p.needsUpdate = true; geometry.computeVertexNormals(); geometry.computeBoundingSphere()
  return geometry
}
