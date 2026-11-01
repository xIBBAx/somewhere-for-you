import { useHubFrame } from "../hubGate"

import { useLayoutEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { groundHeight } from "../world-layout"
import { weatherRT } from "../weather/weatherState"
import { worldRT } from "../runtime"
import { makeRng } from "../../utils/math"
import { GULMOHAR_PROFILE } from "./trees/treeArchetypes"
import {
  buildOrganicTrunkGeometry,
  buildHierarchicalBranchGeometry,
  buildFoliageClusterGeometry,
} from "./trees/treeGeometry"
import {
  gulmoharBarkTexture,
  gulmoharBlossomClusterTexture,
  gulmoharPetalTexture,
} from "./trees/treeTextures"
import {
  createVegetationUniforms,
  enhanceVegetationMaterial,
  updateVegetationUniforms,
} from "./trees/vegetationShaders"

export type GulmoharTreeDef = {
  x: number
  z: number
  scale: number
  rotation: number
}

export const GULMOHAR_TREES: GulmoharTreeDef[] = [
  { x: 9.5, z: 9.2, scale: 1.15, rotation: 0.4 },     // Beside reflection pond
  { x: -15.8, z: 3.8, scale: 1.2, rotation: 1.2 },    // near the studio
  { x: 14.2, z: -5.5, scale: 1.1, rotation: 2.1 },    // Eastern flower slope
  { x: -4.5, z: -4.8, scale: 1.25, rotation: -0.6 },  // Creek bridge entrance
  { x: -6.8, z: 17.2, scale: 1.05, rotation: 0.9 },   // Fair celebration lawn
  { x: 3.6, z: -23.5, scale: 1.3, rotation: -1.4 },   // finale garden approach
  { x: 12.8, z: -16.2, scale: 1.15, rotation: 2.7 },  // Southern hilltop overlook
]

const GULMOHAR_PALETTE = [
  "#ffe3c2", // the pale flecked standard petal
  "#ffb37a", // sunlit edge
  "#ff8a4a", // warm orange
  "#ff6a33", // flame
  "#f4502a", // vermilion
  "#e03a1f", // deep scarlet
]

const FALLING_PETALS_COUNT = 96

type FallingPetal = {
  treeIndex: number
  pos: THREE.Vector3
  rot: THREE.Euler
  rotSpeed: THREE.Vector3
  speedY: number
  driftPhase: number
  size: number
  color: THREE.Color
  active: boolean
}

export const GulmoharTrees = (): React.ReactElement => {
  const clustersMesh = useRef<THREE.InstancedMesh>(null)
  const fallenPetalsMesh = useRef<THREE.InstancedMesh>(null)
  const fallingPetalsMesh = useRef<THREE.InstancedMesh>(null)

  // 1. Textures & Shaders
  const barkTex = useMemo(() => gulmoharBarkTexture(), [])
  const blossomTex = useMemo(() => gulmoharBlossomClusterTexture(), [])
  const petalTex = useMemo(() => gulmoharPetalTexture(), [])

  const uniforms = useMemo(
    () =>
      createVegetationUniforms({
        translucencyColor: GULMOHAR_PROFILE.material.translucencyColor,
        translucencyIntensity: GULMOHAR_PROFILE.material.translucencyIntensity,
        translucencyPower: 2.4,
        trunkFlexibility: GULMOHAR_PROFILE.wind.trunkStiffness,
        branchFlexibility: GULMOHAR_PROFILE.wind.branchFlexibility,
        leafFlutter: GULMOHAR_PROFILE.wind.leafFlutterAmount,
        porosity: GULMOHAR_PROFILE.material.rainPorosity,
      }),
    [],
  )

  const barkMat = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      map: barkTex,
      roughness: 0.68,
      metalness: 0.05,
      bumpMap: barkTex,
      bumpScale: 0.025,
    })
    enhanceVegetationMaterial(mat, uniforms, false)
    return mat
  }, [barkTex, uniforms])

  const blossomMat = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      map: blossomTex,
      alphaTest: 0.38,
      transparent: false,
      depthWrite: true,
      roughness: 0.52,
      metalness: 0.02,
      side: THREE.DoubleSide,
    })
    enhanceVegetationMaterial(mat, uniforms, true)
    return mat
  }, [blossomTex, uniforms])

  const petalMat = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      map: petalTex,
      alphaTest: 0.32,
      transparent: false,
      depthWrite: true,
      roughness: 0.62,
      side: THREE.DoubleSide,
    })
  }, [petalTex])

  // 2. Procedural Geometries for each of the 7 Hero Gulmohar Trees
  const treeData = useMemo(() => {
    // Delicately scaled foliage clusters with 11-card 3D cupping
    const clusterCardGeo = buildFoliageClusterGeometry(11, 0.60, 8812, 0.82)

    const trees = GULMOHAR_TREES.map((tree, idx) => {
      const seed = 77123 + idx * 313
      const rng = makeRng(seed)
      const y = groundHeight(tree.x, tree.z)
      const trunkHeight = 2.4 * tree.scale

      // Terrain-conforming root buttresses
      const trunkGeo = buildOrganicTrunkGeometry(
        GULMOHAR_PROFILE,
        tree.scale,
        seed,
        16,
        8,
        { x: tree.x, z: tree.z },
      )
      const { geometry: branchGeo, clusterAnchors } = buildHierarchicalBranchGeometry(
        GULMOHAR_PROFILE,
        tree.scale,
        seed,
        trunkHeight,
        8,
      )

      // Compute cluster transforms - rich, lush gulmohar canopy with even 360-degree coverage
      const clusterTransforms: Array<{
        matrix: THREE.Matrix4
        color: THREE.Color
      }> = []

      const clusterQuat = new THREE.Quaternion()
      const clusterEuler = new THREE.Euler()
      const clusterScale = new THREE.Vector3()

      const addBlossomCluster = (
        p: THREE.Vector3,
        scaleVal: number,
        colorHex: string,
        rotSeed: number,
      ) => {
        clusterEuler.set(
          Math.sin(rotSeed * 3.1) * 0.22,
          (rotSeed * 1.618) % (Math.PI * 2),
          Math.cos(rotSeed * 2.7) * 0.22,
        )
        clusterQuat.setFromEuler(clusterEuler)
        clusterScale.set(scaleVal, scaleVal * 0.94, scaleVal)
        const m = new THREE.Matrix4().compose(p, clusterQuat, clusterScale)
        clusterTransforms.push({ matrix: m, color: new THREE.Color(colorHex) })
      }

      // 1. Primary and secondary branch anchor clusters along branch skeleton
      clusterAnchors.forEach((anchor, aIdx) => {
        const p1 = anchor.clone()
        p1.x += (rng() - 0.5) * 0.12 * tree.scale
        p1.y += (rng() - 0.2) * 0.12 * tree.scale
        p1.z += (rng() - 0.5) * 0.12 * tree.scale
        const s1 = (0.92 + rng() * 0.22) * tree.scale
        const col1 = GULMOHAR_PALETTE[(idx * 3 + aIdx) % GULMOHAR_PALETTE.length]
        addBlossomCluster(p1, s1, col1, seed + aIdx * 7)
      })

      // 2. Scaffold bridge clusters connecting primary limbs to inner volume
      const bridgeCount = 12
      for (let b = 0; b < bridgeCount; b++) {
        const thetaB = (b / bridgeCount) * Math.PI * 2 + 0.26
        const rB = tree.scale * (0.52 + ((b + idx) % 3) * 0.10)
        const yB = trunkHeight * 0.76 + (0.10 + (b % 3) * 0.12) * tree.scale
        const pB = new THREE.Vector3(Math.cos(thetaB) * rB, yB, Math.sin(thetaB) * rB)
        const sB = (0.86 + rng() * 0.20) * tree.scale
        const colB = GULMOHAR_PALETTE[(idx * 2 + b + 2) % GULMOHAR_PALETTE.length]
        addBlossomCluster(pB, sB, colB, seed + b * 11 + 201)
      }

      // 3. Intermediate scaffold zones adorning spreading limbs
      const scaffoldCount = 16
      for (let s = 0; s < scaffoldCount; s++) {
        const thetaS = (s / scaffoldCount) * Math.PI * 2 + (rng() - 0.5) * 0.15
        const rS = tree.scale * (0.75 + rng() * 0.35)
        const yS = trunkHeight * 0.82 + (0.12 + (s % 3) * 0.12) * tree.scale
        const pS = new THREE.Vector3(Math.cos(thetaS) * rS, yS, Math.sin(thetaS) * rS)
        const sScale = (0.90 + rng() * 0.22) * tree.scale
        const sCol = GULMOHAR_PALETTE[(idx * 2 + s + 1) % GULMOHAR_PALETTE.length]
        addBlossomCluster(pS, sScale, sCol, seed + s * 13 + 301)
      }

      // 4. Spreading outer canopy vase mantle (full 360-degree shell)
      const mantleCount = 22
      for (let m = 0; m < mantleCount; m++) {
        const thetaM = (m / mantleCount) * Math.PI * 2 + (rng() - 0.5) * 0.12
        const rM = GULMOHAR_PROFILE.crown.widthMultiplier * tree.scale * (0.82 + (m % 3) * 0.08)
        const yM = trunkHeight * 0.90 + (0.04 + ((m * 3) % 4) * 0.10) * tree.scale
        const pM = new THREE.Vector3(Math.cos(thetaM) * rM, yM, Math.sin(thetaM) * rM)
        const mScale = (0.96 + rng() * 0.22) * tree.scale
        const mCol = GULMOHAR_PALETTE[(idx * 3 + m) % 3] // ivory and blush highlights
        addBlossomCluster(pM, mScale, mCol, seed + m * 17 + 501)
      }

      // 5. Upper crown mantle shell (interlocked by half-phase)
      const upperCount = 16
      for (let u = 0; u < upperCount; u++) {
        const thetaU = ((u + 0.5) / upperCount) * Math.PI * 2 + (rng() - 0.5) * 0.10
        const rU = GULMOHAR_PROFILE.crown.widthMultiplier * tree.scale * (0.62 + (u % 2) * 0.08)
        const yU = trunkHeight * 1.04 + (0.06 + (u % 3) * 0.09) * tree.scale
        const pU = new THREE.Vector3(Math.cos(thetaU) * rU, yU, Math.sin(thetaU) * rU)
        const uScale = (0.92 + rng() * 0.20) * tree.scale
        const uCol = GULMOHAR_PALETTE[(idx + u) % GULMOHAR_PALETTE.length]
        addBlossomCluster(pU, uScale, uCol, seed + u * 23 + 601)
      }

      // 6. Sunlit apical dome crest
      const apexCount = 8
      for (let a = 0; a < apexCount; a++) {
        const thetaA = (a / apexCount) * Math.PI * 2 + rng() * 0.15
        const rA = (0.24 + rng() * 0.14) * tree.scale
        const yA = trunkHeight * 1.15 + (0.18 + (a % 2) * 0.12) * tree.scale
        const pA = new THREE.Vector3(Math.cos(thetaA) * rA, yA, Math.sin(thetaA) * rA)
        const aScale = (0.88 + rng() * 0.18) * tree.scale
        const aCol = GULMOHAR_PALETTE[a % 2 === 0 ? 0 : 1] // purest ivory & blush highlights
        addBlossomCluster(pA, aScale, aCol, seed + a * 19 + 701)
      }

      return {
        tree,
        y,
        trunkGeo,
        branchGeo,
        clusterTransforms,
      }
    })

    // Flatten all blossom clusters for InstancedMesh
    const allClusters: Array<{
      matrix: THREE.Matrix4
      color: THREE.Color
    }> = []

    const dummy = new THREE.Object3D()
    trees.forEach((t) => {
      t.clusterTransforms.forEach((c) => {
        dummy.matrix.copy(c.matrix)
        dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale)
        // Transform into world space of tree
        dummy.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), t.tree.rotation)
        dummy.position.add(new THREE.Vector3(t.tree.x, t.y, t.tree.z))
        dummy.quaternion.multiplyQuaternions(
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.tree.rotation),
          dummy.quaternion,
        )
        dummy.updateMatrix()
        allClusters.push({ matrix: dummy.matrix.clone(), color: c.color })
      })
    })

    // Ground fallen petal carpets beneath canopies
    const fallenPetals: Array<{ matrix: THREE.Matrix4; color: THREE.Color }> = []
    const fallenRng = makeRng(20260906)
    trees.forEach((t) => {
      const petalCount = 40
      for (let p = 0; p < petalCount; p++) {
        const angle = fallenRng() * Math.PI * 2
        const dist = (0.4 + fallenRng() * 2.8) * t.tree.scale
        const px = t.tree.x + Math.cos(angle) * dist
        const pz = t.tree.z + Math.sin(angle) * dist
        const py = groundHeight(px, pz) + 0.018
        const pSize = (0.045 + fallenRng() * 0.035) * t.tree.scale

        const mat = new THREE.Matrix4()
        const q = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(-Math.PI / 2 + (fallenRng() - 0.5) * 0.2, 0, fallenRng() * Math.PI * 2),
        )
        mat.compose(new THREE.Vector3(px, py, pz), q, new THREE.Vector3(pSize * 1.3, pSize, pSize))
        const col = new THREE.Color(
          GULMOHAR_PALETTE[Math.floor(fallenRng() * GULMOHAR_PALETTE.length)],
        )
        fallenPetals.push({ matrix: mat, color: col })
      }
    })

    return {
      trees,
      clusterCardGeo,
      allClusters,
      fallenPetals,
    }
  }, [])

  // 3. Falling petals simulation particles
  const fallingPetals = useMemo<FallingPetal[]>(() => {
    const rng = makeRng(99812)
    return Array.from({ length: FALLING_PETALS_COUNT }, (_, i) => {
      const treeIdx = i % GULMOHAR_TREES.length
      const tree = GULMOHAR_TREES[treeIdx]
      const y = groundHeight(tree.x, tree.z)
      const h = 2.4 * tree.scale
      return {
        treeIndex: treeIdx,
        pos: new THREE.Vector3(
          tree.x + (rng() - 0.5) * 2.5 * tree.scale,
          y + h + (rng() - 0.2) * 1.5 * tree.scale,
          tree.z + (rng() - 0.5) * 2.5 * tree.scale,
        ),
        rot: new THREE.Euler(rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2),
        rotSpeed: new THREE.Vector3(
          (rng() - 0.5) * 3.5,
          (rng() - 0.5) * 2.5,
          (rng() - 0.5) * 3.5,
        ),
        speedY: 0.38 + rng() * 0.42,
        driftPhase: rng() * Math.PI * 2,
        size: 0.048 + rng() * 0.032,
        color: new THREE.Color(GULMOHAR_PALETTE[i % GULMOHAR_PALETTE.length]),
        active: true,
      }
    })
  }, [])

  // 4. Initial layout of instanced meshes
  useLayoutEffect(() => {
    if (clustersMesh.current) {
      treeData.allClusters.forEach((c, i) => {
        clustersMesh.current?.setMatrixAt(i, c.matrix)
        clustersMesh.current?.setColorAt(i, c.color)
      })
      clustersMesh.current.instanceMatrix.needsUpdate = true
      if (clustersMesh.current.instanceColor) clustersMesh.current.instanceColor.needsUpdate = true
    }

    if (fallenPetalsMesh.current) {
      treeData.fallenPetals.forEach((p, i) => {
        fallenPetalsMesh.current?.setMatrixAt(i, p.matrix)
        fallenPetalsMesh.current?.setColorAt(i, p.color)
      })
      fallenPetalsMesh.current.instanceMatrix.needsUpdate = true
      if (fallenPetalsMesh.current.instanceColor) fallenPetalsMesh.current.instanceColor.needsUpdate = true
    }

    if (fallingPetalsMesh.current) {
      fallingPetals.forEach((p, i) => {
        fallingPetalsMesh.current?.setColorAt(i, p.color)
      })
      if (fallingPetalsMesh.current.instanceColor) fallingPetalsMesh.current.instanceColor.needsUpdate = true
    }
  }, [treeData, fallingPetals])

  // 5. Per-frame wind, sun direction, and falling petals update
  const petalDummy = useMemo(() => new THREE.Object3D(), [])
  const sunPosVec = useMemo(() => new THREE.Vector3(), [])

  useHubFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const tod = worldRT.timeOfDay
    const cloud = weatherRT.cloud

    // Direction vector to sun
    const sunAngle = THREE.MathUtils.lerp(0.9, 2.2, tod)
    sunPosVec.set(
      Math.cos(sunAngle) * 30,
      THREE.MathUtils.lerp(22, 6, tod),
      Math.sin(sunAngle) * 16 + 6,
    ).normalize()

    // Calculate solar intensity for realistic backlit translucency
    const golden = Math.max(0, 1 - Math.abs(tod - 0.72) * 3.2)
    const dusk = Math.max(0, (tod - 0.78) * 4)
    const day = Math.max(0, 1 - dusk * 1.5 - golden * 0.5)
    const sunIntensity = (day * 0.68 + golden * 0.92) * (1 - cloud * 0.6)

    updateVegetationUniforms(uniforms, t, sunPosVec, sunIntensity)

    // Physics-driven falling gulmohar petals
    if (fallingPetalsMesh.current) {
      const wind = Math.min(1.0, weatherRT.wind + weatherRT.gust * 0.7)
      const windAngle = weatherRT.windDirectionRad
      const wx = Math.cos(windAngle) * (0.6 + wind * 2.4)
      const wz = Math.sin(windAngle) * (0.6 + wind * 2.4)

      fallingPetals.forEach((petal, i) => {
        const tree = GULMOHAR_TREES[petal.treeIndex]
        const groundY = groundHeight(petal.pos.x, petal.pos.z)

        // Flutter dynamics with turbulence
        const flutter = Math.sin(t * 3.6 + petal.driftPhase) * 0.38
        petal.pos.x += (wx + flutter * -Math.sin(windAngle)) * delta
        petal.pos.z += (wz + flutter * Math.cos(windAngle)) * delta
        petal.pos.y -= petal.speedY * delta

        petal.rot.x += petal.rotSpeed.x * delta
        petal.rot.y += petal.rotSpeed.y * delta
        petal.rot.z += petal.rotSpeed.z * delta

        // Respawn above tree canopy when reaching ground, with gust-accelerated release
        if (petal.pos.y <= groundY + 0.04) {
          const spawnY = groundHeight(tree.x, tree.z)
          const h = 2.4 * tree.scale
          petal.pos.set(
            tree.x + (Math.random() - 0.5) * 2.2 * tree.scale,
            spawnY + h + 0.4 + Math.random() * 1.2 * tree.scale,
            tree.z + (Math.random() - 0.5) * 2.2 * tree.scale,
          )
        }

        petalDummy.position.copy(petal.pos)
        petalDummy.rotation.copy(petal.rot)
        petalDummy.scale.set(petal.size * 1.3, petal.size, petal.size)
        petalDummy.updateMatrix()
        fallingPetalsMesh.current?.setMatrixAt(i, petalDummy.matrix)
      })
      fallingPetalsMesh.current.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <group name="gulmohar-blossoms-sota">
      {/* 1. Trunks & Structural Branches for each Gulmohar Tree */}
      {treeData.trees.map((t, idx) => (
        <group
          key={idx}
          position={[t.tree.x, t.y, t.tree.z]}
          rotation-y={t.tree.rotation}
        >
          {/* Lofted organic trunk with flared root buttresses anchored into local slope */}
          <mesh
            geometry={t.trunkGeo}
            material={barkMat}
            castShadow
            receiveShadow
          />
          {/* Sculptural spreading scaffold limbs */}
          <mesh
            geometry={t.branchGeo}
            material={barkMat}
            castShadow
            receiveShadow
          />
        </group>
      ))}

      {/* 2. Instanced High-Quality Gulmohar Blossom Clusters with Translucency */}
      <instancedMesh
        ref={clustersMesh}
        args={[treeData.clusterCardGeo, blossomMat, treeData.allClusters.length]}
        castShadow
        receiveShadow
      />

      {/* 3. Fallen Petals carpet on ground under canopy */}
      <instancedMesh
        ref={fallenPetalsMesh}
        args={[treeData.clusterCardGeo, petalMat, treeData.fallenPetals.length]}
        receiveShadow
      />

      {/* 4. Dynamic airborne falling petals with wind flutter */}
      <instancedMesh
        ref={fallingPetalsMesh}
        args={[treeData.clusterCardGeo, petalMat, fallingPetals.length]}
        frustumCulled={false}
      />
    </group>
  )
}
