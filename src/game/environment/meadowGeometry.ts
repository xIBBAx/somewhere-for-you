import * as THREE from "three"

/** Three folded, bending leaves share one instanced tuft; the root is at y=0. */
export const makeGrassTuft = (): THREE.BufferGeometry => {
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const root = new THREE.Color("#afbc91")
  const tip = new THREE.Color("#f0e9b5")
  const color = new THREE.Color()
  for (let blade = 0; blade < 3; blade++) {
    const angle = blade * 2.3
    const height = [1, 0.78, 0.63][blade]
    const start = positions.length / 3
    for (let row = 0; row < 3; row++) {
      const t = row / 2
      const width = (1 - t) * 0.13
      const bend = t * t * (0.35 + blade * 0.1)
      for (let side = -1; side <= 1; side++) {
        positions.push(Math.cos(angle) * bend + Math.sin(angle) * width * side,
          t * height, Math.sin(angle) * bend - Math.cos(angle) * width * side + (side === 0 ? 0.035 * Math.sin(t * Math.PI) : 0))
        color.copy(root).lerp(tip, t * 0.8)
        colors.push(color.r, color.g, color.b)
      }
      if (row < 2) {
        const i = start + row * 3
        indices.push(i, i + 3, i + 1, i + 1, i + 3, i + 4, i + 1, i + 4, i + 2, i + 2, i + 4, i + 5)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** Rounded five-petal blossom, cupped upward so it reads from the game camera. */
export const makeMeadowBlossom = (): THREE.BufferGeometry => {
  const positions: number[] = []
  const indices: number[] = []
  for (let petal = 0; petal < 5; petal++) {
    const a = petal / 5 * Math.PI * 2
    const start = positions.length / 3
    positions.push(Math.cos(a) * 0.04, 0.014, Math.sin(a) * 0.04)
    for (let edge = 0; edge <= 12; edge++) {
      const t = edge / 12 * Math.PI * 2
      const radial = 0.04 + Math.cos(t) * 0.038
      const side = Math.sin(t) * 0.026
      positions.push(Math.cos(a) * radial - Math.sin(a) * side,
        0.007 + Math.max(0, radial) * 0.22,
        Math.sin(a) * radial + Math.cos(a) * side)
      if (edge < 12) indices.push(start, start + edge + 2, start + edge + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}
