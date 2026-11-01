import { useHubFrame } from "../../hubGate"

import { useLayoutEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { TREES, groundHeight } from "../../world-layout"
import { MONKEY_BRANCHES } from "../../animals/monkeyHabitat"
import { weatherRT } from "../../weather/weatherState"
import { worldRT } from "../../runtime"
import { keyLightDirection, skyLightLevel } from "../celestialLighting"
import {
  getProfileForTree,
  generateTreeInstanceDNA,
  BROAD_DECIDUOUS_PROFILE,
  UPRIGHT_DECIDUOUS_PROFILE,
  DENSE_ORCHARD_PROFILE,
  PALM_PROFILE,
} from "./treeArchetypes"
import {
  buildOrganicTrunkGeometry,
  buildFoliageClusterGeometry,
} from "./treeGeometry"
import {
  deciduousBarkTexture,
  deciduousLeafCardTexture,
  palmFrondTexture,
  birchBarkTexture,
} from "./treeTextures"
import {
  createVegetationUniforms,
  enhanceVegetationMaterial,
  updateVegetationUniforms,
} from "./vegetationShaders"

const PALETTE_LEAVES = [
  "#738c60",
  "#647f55",
  "#536e49",
  "#8a9b6b",
  "#a0ad7e",
  "#929c66",
  "#4f674a",
]

const MONKEY_TREE_IDS = new Set([36, 38, 39, 42, 43, 46, 47, 49, 50, 51, 53, 55])

export const DeciduousTreeSystem = (): React.ReactElement => {
  const trunksMeshV0 = useRef<THREE.InstancedMesh>(null)
  const trunksMeshV1 = useRef<THREE.InstancedMesh>(null)
  const trunksMeshV2 = useRef<THREE.InstancedMesh>(null)
  const trunksMeshPalm = useRef<THREE.InstancedMesh>(null)

  const branchesMeshV0 = useRef<THREE.InstancedMesh>(null)
  const branchesMeshV12 = useRef<THREE.InstancedMesh>(null)
  const foliageMesh = useRef<THREE.InstancedMesh>(null)
  const palmFrondsMesh = useRef<THREE.InstancedMesh>(null)

  // 1. Textures & Shaders
  const oakBarkTex = useMemo(() => deciduousBarkTexture(), [])
  const birchBarkTex = useMemo(() => birchBarkTexture(), [])
  const leafTex = useMemo(() => deciduousLeafCardTexture(), [])
  const palmTex = useMemo(() => palmFrondTexture(), [])

  const uniforms = useMemo(
    () =>
      createVegetationUniforms({
        translucencyColor: "#c4d58b",
        translucencyIntensity: 0.55,
        translucencyPower: 2.6,
        trunkFlexibility: 0.038,
        branchFlexibility: 0.12,
        leafFlutter: 0.09,
        porosity: 0.65,
      }),
    [],
  )

  // Species-specific bark materials
  const oakBarkMat = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      map: oakBarkTex,
      roughness: 0.92,
      metalness: 0.04,
      bumpMap: oakBarkTex,
      bumpScale: 0.045,
    })
    enhanceVegetationMaterial(mat, uniforms, false)
    return mat
  }, [oakBarkTex, uniforms])

  const birchBarkMat = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      map: birchBarkTex,
      roughness: 0.78,
      metalness: 0.02,
      bumpMap: birchBarkTex,
      bumpScale: 0.025,
    })
    enhanceVegetationMaterial(mat, uniforms, false)
    return mat
  }, [birchBarkTex, uniforms])

  const leafMat = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      map: leafTex,
      alphaTest: 0.42,
      transparent: false,
      depthWrite: true,
      roughness: 0.85,
      metalness: 0,
      side: THREE.DoubleSide,
    })
    enhanceVegetationMaterial(mat, uniforms, true)
    return mat
  }, [leafTex, uniforms])

  const palmMat = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      map: palmTex,
      alphaTest: 0.45,
      transparent: false,
      depthWrite: true,
      roughness: 0.8,
      side: THREE.DoubleSide,
    })
    enhanceVegetationMaterial(mat, uniforms, true)
    return mat
  }, [palmTex, uniforms])

  // 2. Archetype Geometries (lofted organic trunks with smooth root buttresses)
  const trunkGeometries = useMemo(() => {
    return {
      v0: buildOrganicTrunkGeometry(UPRIGHT_DECIDUOUS_PROFILE, 1.0, 1001, 16, 8),
      v1: buildOrganicTrunkGeometry(BROAD_DECIDUOUS_PROFILE, 1.0, 1002, 16, 8),
      v2: buildOrganicTrunkGeometry(DENSE_ORCHARD_PROFILE, 1.0, 1003, 16, 8),
      palm: buildOrganicTrunkGeometry(PALM_PROFILE, 1.0, 1004, 16, 9),
    }
  }, [])

  // Branch Geometry: realistic structural boughs including monkey-compatible paths
  const branchUnitGeo = useMemo(() => {
    const geo = new THREE.CylinderGeometry(0.042, 0.095, 1.0, 8, 2, true)
    geo.translate(0, 0.5, 0)
    return geo
  }, [])

  const foliageClusterGeo = useMemo(() => {
    return buildFoliageClusterGeometry(11, 0.72, 54321, 0.82)
  }, [])

  const palmFrondCardGeo = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1.05, 2.6, 2, 8)
    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const vY = pos.getY(i)
      const normY = (vY + 1.3) / 2.6
      const bow = Math.pow(normY, 1.8) * 0.55
      pos.setZ(i, -bow)
    }
    geo.translate(0, 1.3, 0)
    geo.computeVertexNormals()
    return geo
  }, [])

  // 3. Compute Transforms for all 56 trees with environmental competition & slope adaptation
  const {
    trunksV0,
    trunksV1,
    trunksV2,
    trunksPalm,
    branchInstancesV0,
    branchInstancesV12,
    foliageInstances,
    palmFrondInstances,
  } = useMemo(() => {
    const tV0: THREE.Matrix4[] = []
    const tV1: THREE.Matrix4[] = []
    const tV2: THREE.Matrix4[] = []
    const tPalm: THREE.Matrix4[] = []

    const branchesV0: THREE.Matrix4[] = []
    const branchesV12: THREE.Matrix4[] = []
    const foliage: Array<{ matrix: THREE.Matrix4; color: THREE.Color }> = []
    const palms: THREE.Matrix4[] = []

    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const p = new THREE.Vector3()
    const s = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    const dir = new THREE.Vector3()

    TREES.forEach((tree, i) => {
      const isPalm = i === 53
      const isBoundary = i < 30
      const profile = getProfileForTree(i, tree.variant)
      const y = groundHeight(tree.x, tree.z)

      const dna = generateTreeInstanceDNA(i, tree.variant, false, tree.x, tree.z, tree.s, TREES)

      const height = dna.height
      const thickness = dna.trunkRadius / profile.trunk.baseRadiusRatio

      // Individual lean influenced by terrain slope & phototropism
      e.set(
        Math.cos(dna.leanYaw) * dna.leanAngle,
        i * 0.42,
        Math.sin(dna.leanYaw) * dna.leanAngle,
      )
      q.setFromEuler(e)
      p.set(tree.x, y, tree.z)
      s.set(thickness, height / (profile.trunk.heightMultiplier * 2.4), thickness)
      m.compose(p, q, s)

      if (isPalm) {
        tPalm.push(m.clone())
      } else if (tree.variant === 0) {
        tV0.push(m.clone())
      } else if (tree.variant === 1) {
        tV1.push(m.clone())
      } else {
        tV2.push(m.clone())
      }

      if (isPalm) {
        // Radiating arching palm fronds drooping downward gracefully in 360-degree crown
        const frondCount = 14
        for (let f = 0; f < frondCount; f++) {
          const fa = (f / frondCount) * Math.PI * 2 + i * 0.4
          const fPos = new THREE.Vector3(tree.x, y + height * 0.98, tree.z)
          const tier = f % 2
          // Droop downward past horizontal (1.57 rad) to 1.70 - 2.05 rad
          const pitch = tier === 0 ? 2.02 : 1.72
          const roll = ((f * 3) % 2 === 0 ? 1 : -1) * 0.12
          const fEuler = new THREE.Euler(pitch, fa, roll, "YXZ")
          const fQuat = new THREE.Quaternion().setFromEuler(fEuler)
          const frondScale = tree.s * (tier === 0 ? 1.25 : 1.05)
          const fScale = new THREE.Vector3(frondScale, frondScale, frondScale)
          m.compose(fPos, fQuat, fScale)
          palms.push(m.clone())
        }
        return
      }

      // Structural Branches
      // For interior trees (i >= 30), ensure branches connect seamlessly to monkey habitat
      const isMonkeyTree = MONKEY_TREE_IDS.has(i)
      const branchCount = isBoundary ? 2 : isMonkeyTree ? 3 : 3 + ((i + tree.variant) % 2)
      const branchTips: THREE.Vector3[] = []
      const branchMids: THREE.Vector3[] = []
      const branchScaffolds: THREE.Vector3[] = []
      const branchDirs: THREE.Vector3[] = []

      for (let b = 0; b < branchCount; b++) {
        let start: THREE.Vector3
        let end: THREE.Vector3

        if (isMonkeyTree && b < 2) {
          // Exact alignment with MONKEY_BRANCHES for seamless monkey locomotion
          const habitat = MONKEY_BRANCHES.find(branch => branch.tree === i && branch.id % 2 === b)!
          start = habitat.base.clone()
          end = habitat.tip.clone()
        } else {
          const bAngle = i * 1.73 + b * ((Math.PI * 2) / branchCount)
          const bStartY = y + height * (0.62 + b * 0.08)
          const bLen = tree.s * (0.65 + ((i + b * 3) % 5) * 0.1)

          start = new THREE.Vector3(
            tree.x + Math.cos(bAngle) * thickness * 0.15,
            bStartY,
            tree.z + Math.sin(bAngle) * thickness * 0.15,
          )
          end = new THREE.Vector3(
            start.x + Math.cos(bAngle) * bLen + dna.competitionOffset.x * 0.5,
            start.y + bLen * (0.35 + (b % 2) * 0.15),
            start.z + Math.sin(bAngle) * bLen + dna.competitionOffset.z * 0.5,
          )
        }

        dir.subVectors(end, start)
        const branchLen = dir.length()
        q.setFromUnitVectors(up, dir.normalize())
        p.copy(start)
        s.set(tree.s * 0.72, branchLen, tree.s * 0.72)
        m.compose(p, q, s)
        // The monkeys' own boughs bend under them, so Monkeys draws those
        // (monkeyBoughs.ts, same size and bark); the crown is still built here.
        if (!(isMonkeyTree && b < 2)) {
          if (tree.variant === 0) {
            branchesV0.push(m.clone())
          } else {
            branchesV12.push(m.clone())
          }
        }

        branchTips.push(end)
        branchMids.push(start.clone().lerp(end, 0.58))
        branchScaffolds.push(start.clone().lerp(end, 0.28))
        branchDirs.push(dir.clone())
      }

      // Canopy Foliage Clusters
      // Multi-tier, 360-degree even distribution around branch skeleton, inner core, outer mantle shells, and apex
      const crownCenterY = y + height * 0.96
      const crownCenterX = tree.x + dna.competitionOffset.x
      const crownCenterZ = tree.z + dna.competitionOffset.z
      const baseCr = tree.s * (isBoundary ? 1.25 : tree.variant === 1 ? 1.45 : tree.variant === 0 ? 1.24 : 1.36)
      const mantleWidth = profile.crown.widthMultiplier * tree.s * (isBoundary ? 0.90 : 1.02)

      const speciesWide = tree.variant === 1 ? 1.40 : tree.variant === 2 ? 1.18 : tree.variant === 0 ? 0.96 : 1.12
      const speciesTall = tree.variant === 0 ? 1.30 : tree.variant === 2 ? 1.10 : tree.variant === 1 ? 0.96 : 1.12

      const addCluster = (
        cx: number,
        cy: number,
        cz: number,
        cr: number,
        baseCol: THREE.Color,
        rotSeed: number,
      ) => {
        // Keep a small opening above the occupied boughs. Previously the low
        // tip clusters enclosed the entire monkey and both adjacent perches.
        if (isMonkeyTree) {
          for (let b = 0; b < 2; b++) {
            const perch = branchTips[b]
            if (Math.hypot(cx - perch.x, cz - perch.z) < cr * speciesWide + 0.40) {
              // The ballistic leap rises above a perched head as well.
              cy = Math.max(cy, perch.y + 1.30 + cr * speciesTall)
            }
          }
        }
        p.set(cx, cy, cz)
        e.set(
          Math.sin(rotSeed * 3.7) * 0.20,
          (rotSeed * 1.9) % (Math.PI * 2),
          Math.cos(rotSeed * 4.3) * 0.20,
        )
        q.setFromEuler(e)
        s.set(cr * speciesWide, cr * speciesTall, cr * speciesWide)
        m.compose(p, q, s)
        foliage.push({ matrix: m.clone(), color: baseCol })
      }

      // 1. Branch Skeleton & Bough Clusters (Tips, Mids, Lateral Flanks & Attachment Crotches)
      // Fully clothes the branch framework so structural limbs are rich and natural
      for (let b = 0; b < branchTips.length; b++) {
        const bDir = branchDirs[b]
        const perpX = -bDir.z * 0.18 * tree.s
        const perpZ = bDir.x * 0.18 * tree.s

        // Terminal branch tip cluster
        const tip = branchTips[b]
        const tipX = tip.x + Math.sin(b * 2.3 + i) * 0.10 * tree.s
        const tipY = tip.y + 0.14 * tree.s
        const tipZ = tip.z + Math.cos(b * 2.3 + i) * 0.10 * tree.s
        const tipCol = new THREE.Color(PALETTE_LEAVES[(i * 3 + b) % PALETTE_LEAVES.length])
        addCluster(tipX, tipY, tipZ, baseCr * 1.04, tipCol, i * 11 + b * 5)

        // Mid-bough cluster
        const mid = branchMids[b]
        const midX = mid.x + Math.cos(b * 1.7 + i) * 0.08 * tree.s
        const midY = mid.y + 0.12 * tree.s
        const midZ = mid.z + Math.sin(b * 1.7 + i) * 0.08 * tree.s
        const midCol = new THREE.Color(PALETTE_LEAVES[(i * 2 + b + 1) % PALETTE_LEAVES.length])
        addCluster(midX, midY, midZ, baseCr * 0.98, midCol, i * 13 + b * 7 + 101)

        // Lateral flank cluster providing volume along branch spread
        const flankX = mid.x + perpX
        const flankY = mid.y + 0.08 * tree.s
        const flankZ = mid.z + perpZ
        const flankCol = new THREE.Color(PALETTE_LEAVES[(i * 4 + b + 2) % PALETTE_LEAVES.length])
        addCluster(flankX, flankY, flankZ, baseCr * 0.92, flankCol, i * 15 + b * 9 + 151)

        // Branch-trunk scaffold crotch cluster
        const scaf = branchScaffolds[b]
        const scafX = scaf.x - perpX * 0.5
        const scafY = scaf.y + 0.10 * tree.s
        const scafZ = scaf.z - perpZ * 0.5
        const scafCol = new THREE.Color(PALETTE_LEAVES[(i + b * 2) % PALETTE_LEAVES.length])
        addCluster(scafX, scafY, scafZ, baseCr * 0.90, scafCol, i * 17 + b * 11 + 181)
      }

      // 2. Core Interior Foliage (Shadow Depth & Heartwood)
      // 2 vertical tiers: lower inner shadow ring and upper inner heartwood
      const coreCount = isBoundary ? 6 : 8
      for (let k = 0; k < coreCount; k++) {
        const inAngle = (k / coreCount) * Math.PI * 2 + i * 1.25
        const inDist = tree.s * (0.24 + 0.08 * (k % 2))
        const cx = crownCenterX + Math.cos(inAngle) * inDist
        const cy = y + height * (k % 2 === 0 ? 0.74 : 0.88) + ((k * 3) % 3) * 0.06 * tree.s
        const cz = crownCenterZ + Math.sin(inAngle) * inDist
        const cr = baseCr * 0.92
        const inCol = new THREE.Color("#14532d").lerp(
          new THREE.Color("#15803d"),
          ((k + i) % 3) * 0.35,
        )
        addCluster(cx, cy, cz, cr, inCol, i * 19 + k * 9 + 201)
      }

      // 3. Multi-Tier Outer Canopy Mantle (Full 360-degree Even Azimuthal Shells)
      // Tier A: Lower mantle (skirt coverage)
      const lowerMantleCount = isBoundary ? 12 : tree.variant === 1 ? 16 : tree.variant === 2 ? 14 : 12
      for (let mIdx = 0; mIdx < lowerMantleCount; mIdx++) {
        const mantleAngle = (mIdx / lowerMantleCount) * Math.PI * 2 + i * 0.72
        const mantleDist = mantleWidth * (0.86 + ((mIdx + i) % 3) * 0.07)
        const cx = crownCenterX + Math.cos(mantleAngle) * mantleDist
        const cy = crownCenterY - 0.12 * tree.s + ((mIdx * 3) % 4) * 0.06 * tree.s
        const cz = crownCenterZ + Math.sin(mantleAngle) * mantleDist
        const cr = baseCr * 1.04
        const colIdx = (i * 4 + mIdx * 2) % PALETTE_LEAVES.length
        addCluster(cx, cy, cz, cr, new THREE.Color(PALETTE_LEAVES[colIdx]), i * 23 + mIdx * 11 + 301)
      }

      // Tier B: Mid mantle (equatorial perimeter & full canopy closure)
      const midMantleCount = isBoundary ? 14 : tree.variant === 1 ? 18 : tree.variant === 2 ? 16 : 14
      for (let uIdx = 0; uIdx < midMantleCount; uIdx++) {
        const midAngle = ((uIdx + 0.5) / midMantleCount) * Math.PI * 2 + i * 0.72
        const midDist = mantleWidth * (0.96 + ((uIdx * 2 + i) % 3) * 0.06)
        const cx = crownCenterX + Math.cos(midAngle) * midDist
        const cy = crownCenterY + 0.08 * tree.s + ((uIdx * 5) % 3) * 0.07 * tree.s
        const cz = crownCenterZ + Math.sin(midAngle) * midDist
        const cr = baseCr * 1.02
        const colIdx = (i * 3 + uIdx * 3 + 1) % PALETTE_LEAVES.length
        addCluster(cx, cy, cz, cr, new THREE.Color(PALETTE_LEAVES[colIdx]), i * 29 + uIdx * 13 + 401)
      }

      // Tier C: Upper mantle shoulder (smooth curvature toward apex)
      const upperMantleCount = isBoundary ? 10 : tree.variant === 1 ? 14 : tree.variant === 2 ? 12 : 10
      for (let sIdx = 0; sIdx < upperMantleCount; sIdx++) {
        const upperAngle = ((sIdx + 0.25) / upperMantleCount) * Math.PI * 2 + i * 1.414
        const upperDist = mantleWidth * (0.70 + ((sIdx + i) % 3) * 0.06)
        const cx = crownCenterX + Math.cos(upperAngle) * upperDist
        const cy = crownCenterY + 0.28 * tree.s + ((sIdx * 3) % 3) * 0.06 * tree.s
        const cz = crownCenterZ + Math.sin(upperAngle) * upperDist
        const cr = baseCr * 0.96
        const colIdx = (i * 2 + sIdx * 4) % PALETTE_LEAVES.length
        addCluster(cx, cy, cz, cr, new THREE.Color(PALETTE_LEAVES[colIdx]), i * 31 + sIdx * 17 + 451)
      }

      // 4. Apical Top Dome (Sunlit Crown Cap)
      const apexCount = isBoundary ? 6 : 8
      for (let a = 0; a < apexCount; a++) {
        const apexAngle = (a / apexCount) * Math.PI * 2 + i * 1.85
        const apexDist = tree.s * (0.22 + 0.08 * (a % 2))
        const cx = crownCenterX + Math.cos(apexAngle) * apexDist
        const cy = crownCenterY + (0.42 + (a % 2) * 0.12) * tree.s
        const cz = crownCenterZ + Math.sin(apexAngle) * apexDist
        const cr = baseCr * 0.90
        const apexCol = new THREE.Color((i + a) % 2 === 0 ? "#84cc16" : "#4ade80")
        addCluster(cx, cy, cz, cr, apexCol, i * 37 + a * 19 + 501)
      }
    })

    return {
      trunksV0: tV0,
      trunksV1: tV1,
      trunksV2: tV2,
      trunksPalm: tPalm,
      branchInstancesV0: branchesV0,
      branchInstancesV12: branchesV12,
      foliageInstances: foliage,
      palmFrondInstances: palms,
    }
  }, [])

  // 4. Initial Buffer Layout
  useLayoutEffect(() => {
    const apply = (
      mesh: THREE.InstancedMesh | null,
      matrices: THREE.Matrix4[],
      colors?: THREE.Color[],
    ) => {
      if (!mesh) return
      matrices.forEach((mat, i) => {
        mesh.setMatrixAt(i, mat)
        if (colors && colors[i]) mesh.setColorAt(i, colors[i])
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor && colors) mesh.instanceColor.needsUpdate = true
    }

    apply(trunksMeshV0.current, trunksV0)
    apply(trunksMeshV1.current, trunksV1)
    apply(trunksMeshV2.current, trunksV2)
    apply(trunksMeshPalm.current, trunksPalm)
    apply(branchesMeshV0.current, branchInstancesV0)
    apply(branchesMeshV12.current, branchInstancesV12)
    apply(
      foliageMesh.current,
      foliageInstances.map((f) => f.matrix),
      foliageInstances.map((f) => f.color),
    )
    apply(palmFrondsMesh.current, palmFrondInstances)
  }, [
    trunksV0,
    trunksV1,
    trunksV2,
    trunksPalm,
    branchInstancesV0,
    branchInstancesV12,
    foliageInstances,
    palmFrondInstances,
  ])

  // 5. Per-frame Wind & Sun Uniform Sync
  const sunPosVec = useMemo(() => new THREE.Vector3(), [])

  useHubFrame((state) => {
    const t = state.clock.elapsedTime
    const tod = worldRT.timeOfDay
    const cloud = weatherRT.cloud

    // Direction vector to sun for transmission
    keyLightDirection(tod, sunPosVec)
    const sunIntensity = skyLightLevel(tod, cloud, weatherRT.rain)

    updateVegetationUniforms(uniforms, t, sunPosVec, sunIntensity)
  })

  return (
    <group name="deciduous-trees-sota">
      {/* 1. Trunks by Archetype: Birch for V0, Oak for V1, Orchard for V2, Palm */}
      <instancedMesh
        ref={trunksMeshV0}
        args={[trunkGeometries.v0, birchBarkMat, trunksV0.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={trunksMeshV1}
        args={[trunkGeometries.v1, oakBarkMat, trunksV1.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={trunksMeshV2}
        args={[trunkGeometries.v2, oakBarkMat, trunksV2.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={trunksMeshPalm}
        args={[trunkGeometries.palm, oakBarkMat, trunksPalm.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />

      {/* 2. Structural Branches: Birch Bark for V0, Oak Bark for V1/V2 */}
      <instancedMesh
        ref={branchesMeshV0}
        args={[branchUnitGeo, birchBarkMat, branchInstancesV0.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={branchesMeshV12}
        args={[branchUnitGeo, oakBarkMat, branchInstancesV12.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />

      {/* 3. Translucent Foliage Clusters with Dilated Normals */}
      <instancedMesh
        ref={foliageMesh}
        args={[foliageClusterGeo, leafMat, foliageInstances.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />

      {/* 4. Subtropical Palm Fronds */}
      <instancedMesh
        ref={palmFrondsMesh}
        args={[palmFrondCardGeo, palmMat, palmFrondInstances.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />
    </group>
  )
}
