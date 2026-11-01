import * as THREE from "three"

/** Fine radial filaments, with a brown seed underneath the airborne umbrella.
 * Geometry rather than opaque billboards keeps the silhouette light at any angle. */
export const makeDandelionFluff = (clock: boolean): THREE.BufferGeometry => {
  const positions: number[] = [], colors: number[] = [], indices: number[] = []
  const ivory = new THREE.Color("#f3ead9"), seed = new THREE.Color("#8d7452")
  const ribbon = (a: THREE.Vector3, b: THREE.Vector3, width: number, color: THREE.Color): void => {
    const normal = new THREE.Vector3(0, 0, 1)
    const side = b.clone().sub(a).cross(normal)
    if (side.lengthSq() < 0.001) side.set(1, 0, 0)
    side.normalize().multiplyScalar(width)
    const start = positions.length / 3
    for (const [p, sign] of [[a, -1], [a, 1], [b, -1], [b, 1]] as const) {
      positions.push(p.x + side.x * sign, p.y + side.y * sign, p.z + side.z * sign)
      colors.push(color.r, color.g, color.b)
    }
    indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3)
  }
  const count = clock ? 72 : 16
  for (let i = 0; i < count; i++) {
    const theta = i * 2.399963
    const y = clock ? 1 - 2 * (i + 0.5) / count : 0.38
    const radius = clock ? Math.sqrt(1 - y * y) : 0.58
    const end = new THREE.Vector3(Math.cos(theta) * radius, y, Math.sin(theta) * radius)
    const start = clock ? end.clone().multiplyScalar(0.28) : new THREE.Vector3(0, 0.05, 0)
    ribbon(start, end, clock ? 0.011 : 0.009, ivory)
    // The feathery terminal branches make an airy head, with gaps between hairs.
    for (const sign of [-1, 1]) {
      const fork = end.clone().multiplyScalar(0.88)
      fork.x += Math.cos(theta + Math.PI / 2) * sign * 0.10
      fork.z += Math.sin(theta + Math.PI / 2) * sign * 0.10
      ribbon(end.clone().lerp(start, 0.28), fork, 0.007, ivory)
    }
  }
  if (!clock) ribbon(new THREE.Vector3(0, -0.62, 0), new THREE.Vector3(0, 0.08, 0), 0.025, seed)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}
