import { describe, expect, it } from "vitest"
import * as THREE from "three"
import {
  GULMOHAR_PROFILE,
  BROAD_DECIDUOUS_PROFILE,
  UPRIGHT_DECIDUOUS_PROFILE,
  DENSE_ORCHARD_PROFILE,
  PALM_PROFILE,
  getProfileForTree,
} from "../src/game/environment/trees/treeArchetypes"
import {
  buildOrganicTrunkGeometry,
  buildHierarchicalBranchGeometry,
  buildFoliageClusterGeometry,
} from "../src/game/environment/trees/treeGeometry"
import { createVegetationUniforms } from "../src/game/environment/trees/vegetationShaders"
import { TREES, groundHeight } from "../src/game/world-layout"
import { MONKEY_BRANCHES } from "../src/game/animals/monkeyHabitat"

describe("Tree Botanical Archetypes", () => {
  const profiles = [
    GULMOHAR_PROFILE,
    BROAD_DECIDUOUS_PROFILE,
    UPRIGHT_DECIDUOUS_PROFILE,
    DENSE_ORCHARD_PROFILE,
    PALM_PROFILE,
  ]

  it("defines physically sound trunk taper and root flares for all species", () => {
    profiles.forEach((profile) => {
      expect(profile.trunk.baseRadiusRatio).toBeGreaterThan(0.1)
      expect(profile.trunk.topRadiusRatio).toBeLessThan(1.0)
      expect(profile.trunk.topRadiusRatio).toBeGreaterThan(0.3)
      expect(profile.trunk.rootLobeCount).toBeGreaterThanOrEqual(3)
      expect(profile.trunk.rootFlareRadius).toBeGreaterThan(profile.trunk.baseRadiusRatio)
    })
  })

  it("configures hierarchical branching with negative space", () => {
    profiles
      .filter((p) => p.family !== "palm")
      .forEach((profile) => {
        expect(profile.branches.primaryCount).toBeGreaterThanOrEqual(3)
        expect(profile.branches.secondaryForkCount).toBeGreaterThanOrEqual(2)
        expect(profile.crown.negativeSpaceFactor).toBeGreaterThanOrEqual(0.2)
        expect(profile.crown.negativeSpaceFactor).toBeLessThanOrEqual(0.55)
        expect(profile.crown.cardsPerCluster).toBe(9)
      })
  })

  it("maps all 56 home trees to correct botanical archetypes", () => {
    expect(TREES.length).toBe(56)

    TREES.forEach((tree, idx) => {
      const profile = getProfileForTree(idx, tree.variant)
      expect(profile).toBeDefined()
      if (idx === 53) {
        expect(profile.family).toBe("palm")
      } else if (tree.variant === 0) {
        expect(profile.family).toBe("upright_deciduous")
      } else if (tree.variant === 1) {
        expect(profile.family).toBe("broad_deciduous")
      } else {
        expect(profile.family).toBe("dense_orchard")
      }
    })
  })
})

describe("Procedural Tree Geometries", () => {
  it("builds lofted organic trunks with root buttresses anchoring into ground", () => {
    const geo = buildOrganicTrunkGeometry(BROAD_DECIDUOUS_PROFILE, 1.2, 42, 10, 8)
    expect(geo.getAttribute("position")).toBeDefined()
    expect(geo.getAttribute("normal")).toBeDefined()
    expect(geo.getAttribute("uv")).toBeDefined()

    geo.computeBoundingBox()
    const bbox = geo.boundingBox!
    expect(bbox.min.y).toBeCloseTo(0, 1)
    expect(bbox.max.y).toBeGreaterThan(2.0)
    // Base width should exceed top width due to natural taper + buttresses
    expect(bbox.max.x - bbox.min.x).toBeGreaterThan(0.5)
  })

  it("builds hierarchical branch geometry with secondary and tertiary boughs", () => {
    const { geometry, clusterAnchors } = buildHierarchicalBranchGeometry(
      GULMOHAR_PROFILE,
      1.0,
      12345,
      2.5,
      6,
    )
    expect(geometry.getAttribute("position")).toBeDefined()
    expect(clusterAnchors.length).toBeGreaterThanOrEqual(20)

    // All cluster anchors should be within upper crown space
    clusterAnchors.forEach((anchor) => {
      expect(anchor.y).toBeGreaterThan(1.0)
    })
  })

  it("builds foliage clusters with 3D parabolic cupping and sphericalized normals", () => {
    const geo = buildFoliageClusterGeometry(9, 0.72, 999, 0.82)
    const pos = geo.getAttribute("position")
    const norm = geo.getAttribute("normal")
    const idx = geo.getIndex()

    expect(pos.count).toBe(9 * 4) // 9 quad cards * 4 vertices
    expect(idx).not.toBeNull()
    expect(idx!.count).toBe(9 * 12) // 4 triangles per card (front + back) * 9 cards

    // Check parabolic cupping: z coordinates must have non-zero bowl displacement
    let hasCurvature = false
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getZ(i)) > 0.01) {
        hasCurvature = true
        break
      }
    }
    expect(hasCurvature).toBe(true)

    // Check sphericalized normals: normals should point outward from origin
    for (let i = 0; i < norm.count; i++) {
      const px = pos.getX(i)
      const py = pos.getY(i)
      const pz = pos.getZ(i)
      const p = new THREE.Vector3(px, py, pz).normalize()

      const nx = norm.getX(i)
      const ny = norm.getY(i)
      const nz = norm.getZ(i)
      const n = new THREE.Vector3(nx, ny, nz)

      // Outward dot product should be positive (normals dilated towards sphere)
      expect(n.length()).toBeCloseTo(1.0, 2)
      expect(n.dot(p)).toBeGreaterThan(-0.2)
    }
  })
})

describe("Vegetation Shader Uniforms", () => {
  it("creates valid transmission and wind uniforms", () => {
    const u = createVegetationUniforms({
      translucencyColor: "#ffd6e7",
      translucencyIntensity: 1.15,
      translucencyPower: 2.4,
      trunkFlexibility: 0.04,
      branchFlexibility: 0.15,
      leafFlutter: 0.1,
    })

    expect(u.uTranslucencyColor.value).toBeInstanceOf(THREE.Color)
    expect(u.uTranslucencyIntensity.value).toBe(1.15)
    expect(u.uTranslucencyPower.value).toBe(2.4)
    expect(u.uTrunkFlexibility.value).toBe(0.04)
    expect(u.uWindDirection.value).toBeInstanceOf(THREE.Vector2)
  })

  it("creates matching shadow depth materials with wind deformation", async () => {
    const { createVegetationDepthMaterial } = await import(
      "../src/game/environment/trees/vegetationShaders"
    )
    const u = createVegetationUniforms()
    const depthMat = createVegetationDepthMaterial(u, true, null, 0.4)
    expect(depthMat).toBeInstanceOf(THREE.MeshDepthMaterial)
    expect(depthMat.depthPacking).toBe(THREE.RGBADepthPacking)
  })
})

describe("Petal and Frond Botanical Textures", () => {
  it("generates authentic single gulmohar petal textures with clamp wrapping", async () => {
    const { gulmoharPetalTexture } = await import(
      "../src/game/environment/trees/treeTextures"
    )
    const tex = gulmoharPetalTexture()
    expect(tex).toBeInstanceOf(THREE.CanvasTexture)
    expect(tex.wrapS).toBe(THREE.ClampToEdgeWrapping)
    expect(tex.wrapT).toBe(THREE.ClampToEdgeWrapping)
  })

  it("generates palm frond and deciduous bark textures with sRGB color space", async () => {
    const { palmFrondTexture, deciduousBarkTexture } = await import(
      "../src/game/environment/trees/treeTextures"
    )
    const frond = palmFrondTexture()
    const bark = deciduousBarkTexture()
    expect(frond).toBeInstanceOf(THREE.CanvasTexture)
    expect(bark).toBeInstanceOf(THREE.CanvasTexture)
    expect(frond.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(bark.colorSpace).toBe(THREE.SRGBColorSpace)
  })

  it("updates vegetation uniforms dynamically with wind and sun direction", async () => {
    const { updateVegetationUniforms } = await import(
      "../src/game/environment/trees/vegetationShaders"
    )
    const u = createVegetationUniforms()
    const sun = new THREE.Vector3(0.2, 0.9, 0.3).normalize()

    updateVegetationUniforms(u, 45.2, sun)

    expect(u.uTime.value).toBe(45.2)
    expect(u.uSunDirection.value.x).toBeCloseTo(sun.x)
    expect(u.uSunDirection.value.y).toBeCloseTo(sun.y)
    expect(u.uSunDirection.value.z).toBeCloseTo(sun.z)
    expect(u.uWindDirection.value.length()).toBeCloseTo(1.0)
  })
})

describe("Monkey Habitat Alignment", () => {
  it("aligns monkey branches with world tree coordinates and heights", () => {
    expect(MONKEY_BRANCHES.length).toBe(24) // 12 trees * 2 sides

    MONKEY_BRANCHES.forEach((branch) => {
      const tree = TREES[branch.tree]
      expect(tree).toBeDefined()
      const y = groundHeight(tree.x, tree.z)

      // Base must be elevated along trunk height
      expect(branch.base.y).toBeGreaterThan(y + 0.4)
      // Tip must be higher than base
      expect(branch.tip.y).toBeGreaterThan(branch.base.y)
      // Base distance from trunk should be near base radius
      const baseDist = Math.hypot(branch.base.x - branch.trunk.x, branch.base.z - branch.trunk.z)
      expect(baseDist).toBeCloseTo(0.2 * tree.s, 2)
    })
  })
})

