/** Push a point out of a horizontal body capsule; inputs remain in world metres. */
export const pushFromCapsule = (
  point: { x: number; z: number },
  body: { x: number; z: number; heading: number },
  halfLength: number,
  radius: number,
): boolean => {
  const fx = Math.sin(body.heading),
    fz = Math.cos(body.heading)
  const along = Math.max(-halfLength, Math.min(halfLength, (point.x - body.x) * fx + (point.z - body.z) * fz))
  const x = body.x + fx * along,
    z = body.z + fz * along
  const dx = point.x - x,
    dz = point.z - z,
    distance = Math.hypot(dx, dz)
  if (distance >= radius) return false
  const nx = distance > 1e-6 ? dx / distance : fz
  const nz = distance > 1e-6 ? dz / distance : -fx
  point.x = x + nx * radius
  point.z = z + nz * radius
  return true
}
