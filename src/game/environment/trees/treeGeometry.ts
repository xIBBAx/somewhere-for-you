import * as THREE from "three"
import { makeRng } from "../../../utils/math"
import { groundHeight } from "../../world-layout"
import type { TreeSpeciesProfile } from "./treeArchetypes"

/**
 * Procedural geometry generators for realistic tree trunks, root flares,
 * hierarchical branches, and foliage/blossom clusters with dilated normals.
 * Built on:
 * - Algorithmic Beauty of Plants (Prusinkiewicz & Lindenmayer)
 * - Space Colonization Algorithm (Runions, Lane, Prusinkiewicz, 2007)
 * - Self-Organizing Tree Models (Pałubicki et al., SIGGRAPH 2009)
 * - Biomechanical Pipe-Model Rule (Leonardo da Vinci / PMC3979699)
 */

export type BranchSegment = {
  start: THREE.Vector3
  end: THREE.Vector3
  radiusStart: number
  radiusEnd: number
}

export type TreeStructure = {
  trunkGeometry: THREE.BufferGeometry
  branchGeometry: THREE.BufferGeometry
  clusterCenters: THREE.Vector3[]
  clusterScales: number[]
}

/**
 * Creates an organic lofted trunk geometry with natural taper, subtle curvature,
 * non-circular trunk section, and flared root buttresses that anchor convincingly into the local terrain.
 */
export const buildOrganicTrunkGeometry = (
  profile: TreeSpeciesProfile,
  scale: number,
  seed: number,
  radialSegments = 16,
  heightSegments = 8,
  worldPos?: { x: number; z: number },
): THREE.BufferGeometry => {
  const rng = makeRng(seed)
  const baseRadius = profile.trunk.baseRadiusRatio * scale
  const topRadius = baseRadius * profile.trunk.topRadiusRatio
  const height = profile.trunk.heightMultiplier * 2.4 * scale

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  const curvatureX = (rng() - 0.5) * profile.trunk.curvatureMagnitude * height
  const curvatureZ = (rng() - 0.5) * profile.trunk.curvatureMagnitude * height

  // Pre-sample terrain height offsets for root lobes if world position is provided
  const rootTerrainDeltas: number[] = []
  const treeBaseY = worldPos ? groundHeight(worldPos.x, worldPos.z) : 0
  const flareRadius = profile.trunk.rootFlareRadius * scale

  for (let xIdx = 0; xIdx <= radialSegments; xIdx++) {
    const u = xIdx / radialSegments
    const theta = u * Math.PI * 2
    if (worldPos) {
      const rx = worldPos.x + Math.cos(theta) * (baseRadius + flareRadius)
      const rz = worldPos.z + Math.sin(theta) * (baseRadius + flareRadius)
      const sampleY = groundHeight(rx, rz)
      rootTerrainDeltas.push(sampleY - treeBaseY)
    } else {
      rootTerrainDeltas.push(0)
    }
  }

  for (let yIdx = 0; yIdx <= heightSegments; yIdx++) {
    const v = yIdx / heightSegments
    const currentY = v * height

    // Gentle organic spine curvature with phototropic correction
    const curveAmount = Math.sin(v * Math.PI * 0.72)
    const spineX = curvatureX * curveAmount
    const spineZ = curvatureZ * curveAmount

    // Natural non-linear taper (wider base, gentle parabolic taper, slight flare at branch junction)
    const taper = Math.pow(1 - v, profile.trunk.taperExponent || 1.35)
    let currentRadius = topRadius + (baseRadius - topRadius) * taper

    // Top branch collar flare where primary scaffold limbs emerge
    if (v > 0.82) {
      const collarT = (v - 0.82) / 0.18
      currentRadius += baseRadius * 0.14 * (collarT * collarT)
    }

    // Smooth root buttress flare at ground contact (v < 0.28)
    if (v < 0.28) {
      const rootStrength = Math.pow(1 - v / 0.28, 2.0)
      currentRadius += flareRadius * rootStrength * 0.40
    }

    for (let xIdx = 0; xIdx <= radialSegments; xIdx++) {
      const u = xIdx / radialSegments
      const theta = u * Math.PI * 2

      // Smooth multi-harmonic root lobes modulation (no sharp faceted creases)
      let lobeDisplacement = 0
      if (v < 0.32) {
        const rootFalloff = Math.pow(1 - v / 0.32, 1.8)
        const primaryLobe = Math.cos(theta * profile.trunk.rootLobeCount + seed * 0.6)
        const secondaryLobe = Math.cos(theta * profile.trunk.rootLobeCount * 2 + seed) * 0.25
        lobeDisplacement = (primaryLobe + secondaryLobe) * (baseRadius * 0.36) * rootFalloff
      }

      // Micro-roughness along trunk perimeter
      const barkNoise = (rng() - 0.5) * (baseRadius * 0.035)
      // Slight elliptical cross-section asymmetry
      const ovality = 1.0 + Math.cos(theta * 2.0 + seed) * 0.05
      const r = Math.max(0.02, (currentRadius + lobeDisplacement + barkNoise) * ovality)

      const px = spineX + Math.cos(theta) * r
      const pz = spineZ + Math.sin(theta) * r

      // Adapt root ground vertices to terrain slope contours
      let py = currentY
      if (v < 0.22 && worldPos) {
        const groundDelta = rootTerrainDeltas[xIdx] || 0
        const slopeBlend = Math.pow(1 - v / 0.22, 1.5)
        py += groundDelta * slopeBlend
      }

      positions.push(px, py, pz)

      // Outward normal from spine center
      const nx = Math.cos(theta)
      const nz = Math.sin(theta)
      const ny = (baseRadius - topRadius) / height
      const nLen = Math.hypot(nx, ny, nz)
      normals.push(nx / nLen, ny / nLen, nz / nLen)

      // UVs with vertical repetition for bark tiling
      uvs.push(u * 2, v * 3)
    }
  }

  // Generate face indices
  for (let y = 0; y < heightSegments; y++) {
    for (let x = 0; x < radialSegments; x++) {
      const a = y * (radialSegments + 1) + x
      const b = (y + 1) * (radialSegments + 1) + x
      const c = (y + 1) * (radialSegments + 1) + (x + 1)
      const d = y * (radialSegments + 1) + (x + 1)

      indices.push(a, b, d)
      indices.push(b, c, d)
    }
  }

  // Smooth dome cap closing the top rim into scaffold boughs (never a hollow open cylinder)
  const spineTopX = curvatureX * Math.sin(Math.PI * 0.72)
  const spineTopZ = curvatureZ * Math.sin(Math.PI * 0.72)
  const topCenterIdx = positions.length / 3
  positions.push(spineTopX, height + topRadius * 0.42, spineTopZ)
  normals.push(0, 1, 0)
  uvs.push(0.5, 3.0)

  const lastRow = heightSegments * (radialSegments + 1)
  for (let x = 0; x < radialSegments; x++) {
    indices.push(lastRow + x, topCenterIdx, lastRow + x + 1)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

/**
 * Builds connected hierarchical branch geometry for a given tree archetype.
 * Incorporates Leonardo da Vinci pipe model, gravitational cantilever sag,
 * and multi-level child branching.
 */
export const buildHierarchicalBranchGeometry = (
  profile: TreeSpeciesProfile,
  scale: number,
  seed: number,
  trunkHeight: number,
  radialSegments = 8,
): { geometry: THREE.BufferGeometry; clusterAnchors: THREE.Vector3[] } => {
  const rng = makeRng(seed + 101)
  const clusterAnchors: THREE.Vector3[] = []
  const segments: BranchSegment[] = []

  const branchCount = profile.branches.primaryCount
  const baseRadius = profile.trunk.baseRadiusRatio * scale * 0.55

  for (let b = 0; b < branchCount; b++) {
    const vHeight =
      profile.branches.insertionHeightMin +
      (b / Math.max(1, branchCount - 1)) *
        (profile.branches.insertionHeightMax - profile.branches.insertionHeightMin)
    const startY = trunkHeight * vHeight

    const baseAngle = (b / branchCount) * Math.PI * 2 + (rng() - 0.5) * 0.4
    const length = scale * (0.85 + rng() * 0.5)
    const angle = profile.branches.insertionAngle + (rng() - 0.5) * 0.2
    const cosA = Math.cos(baseAngle)
    const sinA = Math.sin(baseAngle)

    const endX = cosA * Math.sin(angle) * length
    const endZ = sinA * Math.sin(angle) * length
    // Cantilever gravitational sag increases with length squared
    const endY = startY + Math.cos(angle) * length - profile.branches.droopCurve * length

    const pStart = new THREE.Vector3(cosA * baseRadius * 0.7, startY, sinA * baseRadius * 0.7)
    const pEnd = new THREE.Vector3(endX, endY, endZ)

    // Leonardo da Vinci rule: branch thickness preserves biomechanical section
    const rStart = baseRadius * 0.65
    const rEnd = rStart * profile.branches.taperRatio

    segments.push({ start: pStart, end: pEnd, radiusStart: rStart, radiusEnd: rEnd })

    // Mid-scaffold branch anchor for blossom & foliage volume
    const scaffoldMid = pStart.clone().lerp(pEnd, 0.55)
    clusterAnchors.push(scaffoldMid)

    // Secondary forks
    const forks = profile.branches.secondaryForkCount
    for (let f = 0; f < forks; f++) {
      const forkT = 0.45 + (f / forks) * 0.5
      const forkBase = pStart.clone().lerp(pEnd, forkT)
      const forkSide = f % 2 === 0 ? 1 : -1
      const forkAngle = baseAngle + forkSide * (0.6 + rng() * 0.3)
      const forkLen = length * (0.45 + rng() * 0.25)

      const fEnd = forkBase.clone().add(
        new THREE.Vector3(
          Math.cos(forkAngle) * forkLen,
          forkLen * (0.2 + rng() * 0.25) - profile.branches.droopCurve * forkLen,
          Math.sin(forkAngle) * forkLen,
        ),
      )

      segments.push({
        start: forkBase,
        end: fEnd,
        radiusStart: rEnd * 0.8,
        radiusEnd: rEnd * 0.45,
      })

      // Foliage / blossom cluster anchor at branch tip
      clusterAnchors.push(fEnd.clone())

      // Tertiary twigs
      if (profile.branches.tertiaryTwigCount > 0) {
        const twigLen = forkLen * 0.45
        const twigEnd = fEnd.clone().add(
          new THREE.Vector3(
            (rng() - 0.5) * twigLen * 1.5,
            twigLen * 0.3,
            (rng() - 0.5) * twigLen * 1.5,
          ),
        )
        segments.push({
          start: fEnd,
          end: twigEnd,
          radiusStart: rEnd * 0.45,
          radiusEnd: rEnd * 0.25,
        })
        clusterAnchors.push(twigEnd)
      }
    }

    clusterAnchors.push(pEnd.clone())
  }

  // Top apical bough
  const apexStart = new THREE.Vector3(0, trunkHeight * 0.9, 0)
  const apexEnd = new THREE.Vector3(
    (rng() - 0.5) * scale * 0.3,
    trunkHeight + scale * 0.65,
    (rng() - 0.5) * scale * 0.3,
  )
  segments.push({
    start: apexStart,
    end: apexEnd,
    radiusStart: baseRadius * 0.5,
    radiusEnd: baseRadius * 0.2,
  })
  clusterAnchors.push(apexEnd)

  // Construct combined buffer geometry for all branch segments
  const up = new THREE.Vector3(0, 1, 0)
  const dir = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const matrix = new THREE.Matrix4()

  const geometries: THREE.BufferGeometry[] = []

  segments.forEach((seg) => {
    dir.subVectors(seg.end, seg.start)
    const len = dir.length()
    if (len < 0.01) return

    dir.normalize()
    quat.setFromUnitVectors(up, dir)

    const mid = seg.start.clone().add(seg.end).multiplyScalar(0.5)
    matrix.compose(mid, quat, new THREE.Vector3(1, 1, 1))

    const cyl = new THREE.CylinderGeometry(
      seg.radiusEnd,
      seg.radiusStart,
      len,
      radialSegments,
      2,
      false,
    )
    cyl.applyMatrix4(matrix)
    geometries.push(cyl)

    // Smooth spherical knuckle at branch attachment node
    const knuckle = new THREE.SphereGeometry(seg.radiusStart * 1.08, radialSegments, 4)
    knuckle.translate(seg.start.x, seg.start.y, seg.start.z)
    geometries.push(knuckle)
  })

  let branchGeo = mergeBufferGeometries(geometries)
  if (!branchGeo) {
    branchGeo = new THREE.CylinderGeometry(0.04, 0.08, 1, 6)
  }
  return { geometry: branchGeo, clusterAnchors }
}

/**
 * Builds volumetric foliage / blossom cluster cards with 3D parabolic cupping and
 * Sphericalized (Dilated) Normals:
 * 9 cards distributed across full 3D hemispherical angles with cupped depth,
 * so the cluster never exposes razor-thin cards or harsh flat intersections!
 */
export const buildFoliageClusterGeometry = (
  cardCount = 9,
  cardRadius = 0.68,
  seed = 42,
  dilationStrength = 0.82,
): THREE.BufferGeometry => {
  const rng = makeRng(seed)
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  let vertOffset = 0

  // 9 Multi-axial orientations covering vertical, diagonal, and horizontal mantle
  const baseOrientations = [
    { pitch: 0.05, yaw: 0, roll: 0 },
    { pitch: -0.05, yaw: Math.PI * 0.25, roll: 0.1 },
    { pitch: 0.08, yaw: Math.PI * 0.5, roll: -0.05 },
    { pitch: -0.04, yaw: Math.PI * 0.75, roll: 0.08 },
    { pitch: 0.52, yaw: Math.PI * 0.15, roll: -0.18 },
    { pitch: 0.52, yaw: Math.PI * 0.65, roll: 0.18 },
    { pitch: -0.42, yaw: Math.PI * 0.35, roll: 0.14 },
    { pitch: -0.42, yaw: Math.PI * 0.85, roll: -0.14 },
    { pitch: Math.PI * 0.48, yaw: Math.PI * 0.42, roll: 0 },
  ]

  const orientations = [...baseOrientations]
  if (cardCount > orientations.length) {
    const extraNeeded = cardCount - orientations.length
    for (let k = 0; k < extraNeeded; k++) {
      const phi = Math.acos(1 - (2 * (k + 0.5)) / extraNeeded) - Math.PI * 0.5
      const theta = Math.PI * (1 + Math.sqrt(5)) * (k + 1)
      orientations.push({
        pitch: phi * 0.45,
        yaw: theta % (Math.PI * 2),
        roll: ((k % 2 === 0 ? 1 : -1) * 0.15),
      })
    }
  }

  const actualCount = Math.min(cardCount, orientations.length)

  for (let c = 0; c < actualCount; c++) {
    const o = orientations[c]
    const pitch = o.pitch + (rng() - 0.5) * 0.15
    const yaw = o.yaw + (rng() - 0.5) * 0.2
    const roll = o.roll + (rng() - 0.5) * 0.15

    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll))
    const scale = cardRadius * (0.88 + rng() * 0.28)

    // Volumetric offset spreading cards outward from cluster core
    const off = new THREE.Vector3(
      (rng() - 0.5) * cardRadius * 0.45,
      (rng() - 0.3) * cardRadius * 0.35,
      (rng() - 0.5) * cardRadius * 0.45,
    )

    // 4 Quad vertices with parabolic 3D cupping (z curvature)
    const cardVerts = [
      { x: -0.5, y: -0.5 },
      { x: 0.5, y: -0.5 },
      { x: 0.5, y: 0.5 },
      { x: -0.5, y: 0.5 },
    ].map((coord) => {
      // Gentle parabolic bowl cupping gives 3D thickness from any angle
      const cupping = -(coord.x * coord.x + coord.y * coord.y) * 0.32
      const v = new THREE.Vector3(coord.x * scale, coord.y * scale, cupping * scale)
      v.applyQuaternion(q)
      v.add(off)
      return v
    })

    cardVerts.forEach((v) => {
      positions.push(v.x, v.y, v.z)

      // Sphericalized / Dilated Normal pointing outward from cluster center
      const radialNormal = v.clone().normalize()
      const faceNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(q)
      const blendedNormal = faceNormal.lerp(radialNormal, dilationStrength).normalize()

      normals.push(blendedNormal.x, blendedNormal.y, blendedNormal.z)
    })

    uvs.push(0, 0, 1, 0, 1, 1, 0, 1)

    // Both front and back triangle winding for two-sided stability
    indices.push(vertOffset, vertOffset + 1, vertOffset + 2)
    indices.push(vertOffset, vertOffset + 2, vertOffset + 3)
    // Backside faces
    indices.push(vertOffset, vertOffset + 2, vertOffset + 1)
    indices.push(vertOffset, vertOffset + 3, vertOffset + 2)

    vertOffset += 4
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  return geo
}

/**
 * Lightweight geometry merger for Three.js without external dependencies.
 */
export const mergeBufferGeometries = (
  geometries: THREE.BufferGeometry[],
): THREE.BufferGeometry | null => {
  if (geometries.length === 0) return null
  if (geometries.length === 1) return geometries[0]

  let totalPositions = 0
  let totalNormals = 0
  let totalUvs = 0
  let totalIndices = 0

  geometries.forEach((g) => {
    const pos = g.getAttribute("position")
    if (pos) totalPositions += pos.array.length
    const norm = g.getAttribute("normal")
    if (norm) totalNormals += norm.array.length
    const uv = g.getAttribute("uv")
    if (uv) totalUvs += uv.array.length
    if (g.index) totalIndices += g.index.array.length
  })

  const mergedPos = new Float32Array(totalPositions)
  const mergedNorm = new Float32Array(totalNormals)
  const mergedUvs = new Float32Array(totalUvs)
  const mergedIndices = new Uint32Array(totalIndices)

  let posOffset = 0
  let normOffset = 0
  let uvOffset = 0
  let indexOffset = 0
  let vertexOffset = 0

  geometries.forEach((g) => {
    const pos = g.getAttribute("position")
    if (pos) {
      mergedPos.set(pos.array, posOffset)
      posOffset += pos.array.length
    }

    const norm = g.getAttribute("normal")
    if (norm) {
      mergedNorm.set(norm.array, normOffset)
      normOffset += norm.array.length
    }

    const uv = g.getAttribute("uv")
    if (uv) {
      mergedUvs.set(uv.array, uvOffset)
      uvOffset += uv.array.length
    }

    if (g.index) {
      for (let i = 0; i < g.index.array.length; i++) {
        mergedIndices[indexOffset + i] = g.index.array[i] + vertexOffset
      }
      indexOffset += g.index.array.length
    }

    if (pos) {
      vertexOffset += pos.count
    }
  })

  const merged = new THREE.BufferGeometry()
  merged.setAttribute("position", new THREE.BufferAttribute(mergedPos, 3))
  merged.setAttribute("normal", new THREE.BufferAttribute(mergedNorm, 3))
  merged.setAttribute("uv", new THREE.BufferAttribute(mergedUvs, 2))
  merged.setIndex(new THREE.BufferAttribute(mergedIndices, 1))
  return merged
}
