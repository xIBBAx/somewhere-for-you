import * as THREE from "three"

/**
 * Creates butterfly/moth geometry with shaped wings that can flap
 * in the vertex shader.
 */
export const createButterflyGeometry = (): THREE.BufferGeometry => {
  const geom = new THREE.BufferGeometry()

  const vertices: number[] = []
  const normals: number[] = []
  const wingWeights: number[] = []
  const indices: number[] = []

  // Torso (center black slender capsule)
  // Left wing (-X), Right wing (+X)
  // Torso vertices
  const addV = (x: number, y: number, z: number, w: number): number => {
    vertices.push(x, y, z)
    normals.push(0, 1, 0)
    wingWeights.push(w)
    return vertices.length / 3 - 1
  }

  // Torso
  const vHead = addV(0, 0, 0.04, 0)
  const vTail = addV(0, 0, -0.04, 0)
  const vThoraxL = addV(-0.008, 0.005, 0, 0)
  const vThoraxR = addV(0.008, 0.005, 0, 0)

  // Left wing (broad forewing + rounded hindwing)
  const vForeTipL = addV(-0.16, 0.01, 0.07, 1)
  const vForeMidL = addV(-0.14, 0.01, -0.01, 1)
  const vHindTipL = addV(-0.11, 0.008, -0.06, 1)
  const vHindMidL = addV(-0.04, 0.005, -0.05, 1)

  // Right wing
  const vForeTipR = addV(0.16, 0.01, 0.07, 1)
  const vForeMidR = addV(0.14, 0.01, -0.01, 1)
  const vHindTipR = addV(0.11, 0.008, -0.06, 1)
  const vHindMidR = addV(0.04, 0.005, -0.05, 1)

  // Torso faces
  indices.push(vHead, vThoraxL, vThoraxR)
  indices.push(vTail, vThoraxR, vThoraxL)

  // Left wing faces (double-sided)
  indices.push(vThoraxL, vForeTipL, vForeMidL)
  indices.push(vThoraxL, vForeMidL, vForeTipL)

  indices.push(vThoraxL, vForeMidL, vHindTipL)
  indices.push(vThoraxL, vHindTipL, vForeMidL)

  indices.push(vThoraxL, vHindTipL, vHindMidL)
  indices.push(vThoraxL, vHindMidL, vHindTipL)

  // Right wing faces (double-sided)
  indices.push(vThoraxR, vForeMidR, vForeTipR)
  indices.push(vThoraxR, vForeTipR, vForeMidR)

  indices.push(vThoraxR, vHindTipR, vForeMidR)
  indices.push(vThoraxR, vForeMidR, vHindTipR)

  indices.push(vThoraxR, vHindMidR, vHindTipR)
  indices.push(vThoraxR, vHindTipR, vHindMidR)

  geom.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3))
  geom.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3))
  geom.setAttribute("aWing", new THREE.Float32BufferAttribute(wingWeights, 1))
  geom.setIndex(indices)
  geom.computeVertexNormals()

  return geom
}

/**
 * Creates compact bee / gnat micro-geometry.
 */
export const createMicroInsectGeometry = (): THREE.BufferGeometry => {
  // Capsule body with tiny cross wings
  const geom = new THREE.BufferGeometry()
  const vertices: number[] = []
  const normals: number[] = []
  const indices: number[] = []

  const addV = (x: number, y: number, z: number, nx: number, ny: number, nz: number): number => {
    vertices.push(x, y, z)
    normals.push(nx, ny, nz)
    return vertices.length / 3 - 1
  }

  // Small body: length ~0.04m, width ~0.02m
  const vHead = addV(0, 0, 0.025, 0, 0, 1)
  const vTail = addV(0, 0, -0.025, 0, 0, -1)
  const vMidTop = addV(0, 0.012, 0, 0, 1, 0)
  const vMidBottom = addV(0, -0.012, 0, 0, -1, 0)
  const vMidL = addV(-0.014, 0, 0, -1, 0, 0)
  const vMidR = addV(0.014, 0, 0, 1, 0, 0)

  // Wings (translucent quads)
  const vWingL1 = addV(-0.045, 0.018, 0.01, 0, 1, 0)
  const vWingL2 = addV(-0.04, 0.016, -0.015, 0, 1, 0)
  const vWingR1 = addV(0.045, 0.018, 0.01, 0, 1, 0)
  const vWingR2 = addV(0.04, 0.016, -0.015, 0, 1, 0)

  // Body faces
  indices.push(vHead, vMidTop, vMidL)
  indices.push(vHead, vMidR, vMidTop)
  indices.push(vHead, vMidBottom, vMidR)
  indices.push(vHead, vMidL, vMidBottom)

  indices.push(vTail, vMidL, vMidTop)
  indices.push(vTail, vMidTop, vMidR)
  indices.push(vTail, vMidR, vMidBottom)
  indices.push(vTail, vMidBottom, vMidL)

  // Wing faces (double-sided)
  indices.push(vMidTop, vWingL1, vWingL2)
  indices.push(vMidTop, vWingL2, vWingL1)
  indices.push(vMidTop, vWingR2, vWingR1)
  indices.push(vMidTop, vWingR1, vWingR2)

  geom.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3))
  geom.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3))
  geom.setIndex(indices)
  geom.computeVertexNormals()

  return geom
}

/**
 * Creates firefly glowing point geometry (sphere).
 */
export const createFireflyGeometry = (): THREE.BufferGeometry => {
  return new THREE.SphereGeometry(0.045, 8, 6)
}
