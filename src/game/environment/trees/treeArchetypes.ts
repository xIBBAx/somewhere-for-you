import * as THREE from "three"
import { makeRng } from "../../../utils/math"
import { groundHeight } from "../../world-layout"

/**
 * Botanical Species Profiles and Architectural Growth Rules for the explorer's World.
 * Research-backed by:
 * - Algorithmic Beauty of Plants (Prusinkiewicz & Lindenmayer)
 * - Space Colonization Algorithm (Runions et al., 2007)
 * - Self-Organizing Tree Models (Pałubicki et al., SIGGRAPH 2009)
 * - Global spectrum of tree crown architecture (Nature Communications, 2025)
 * - Leonardo da Vinci's Rule vs Biomechanical Models (PMC3979699)
 * - NC State / Kew Botanical references for Prunus serrulata, Ficus benghalensis, Betula pendula, Cocos nucifera.
 */

export type TreeFamily =
  | "gulmohar"          // gulmohar, the flame tree (Delonix regia)
  | "broad_deciduous" // Oak / Banyan / Mango spreading decurrent archetype
  | "upright_deciduous" // Birch / Poplar / Apple / Lemon upright excurrent archetype
  | "dense_orchard"   // Dense round-crown Orange / Guava archetype
  | "palm"            // Coconut palm (Cocos nucifera) archetype

export type TreeSpeciesProfile = {
  family: TreeFamily
  name: string
  botanicalName: string

  // Trunk & Root contact architecture
  trunk: {
    baseRadiusRatio: number // Base relative to tree scale
    topRadiusRatio: number  // Apex relative to base
    rootLobeCount: number   // Distinct root flare buttresses
    rootFlareRadius: number // Ground anchoring spread
    heightMultiplier: number
    curvatureMagnitude: number
    curvatureFrequency: number
    taperExponent: number   // Non-linear taper curvature
    barkRoughness: number
    lenticelDensity: number // Horizontal lenticels (high in gulmohar/birch)
  }

  // Branch hierarchy architecture (Leonardo pipe model & biomechanics)
  branches: {
    primaryCount: number       // Major scaffold limbs
    insertionHeightMin: number // Fraction of trunk height
    insertionHeightMax: number
    insertionAngle: number     // Angle from trunk (radians)
    droopCurve: number         // Branch sag/droop under gravity load
    secondaryForkCount: number // Secondary child forks
    tertiaryTwigCount: number  // Tertiary boughs bearing leaves/blossoms
    taperRatio: number
    pipeModelExponent: number  // Leonardo da Vinci rule (2.2 to 2.8)
    apicalDominance: number    // Excurrent (high) vs decurrent (low)
  }

  // Crown & Foliage / Blossom Architecture
  crown: {
    shape: "vase_spreading" | "broad_horizontal" | "upright_ovate" | "round_tiered" | "palm_frond"
    widthMultiplier: number
    heightMultiplier: number
    clusterCount: number        // Foliage / blossom cluster nodes
    negativeSpaceFactor: number // Degree of canopy skylight gaps (0.2 to 0.55)
    interiorDensity: number     // Density of inner foliage vs bare structural wood
    cardScale: number           // Scale of individual leaf/blossom cards
    cardsPerCluster: number     // Geometric richness per cluster node
    silhouetteAsymmetry: number // Deterministic crown irregularity
  }

  // Visual & Lighting response
  material: {
    barkType: "gulmohar" | "deciduous" | "palm"
    barkRoughness: number
    foliageRoughness: number
    leafPalette: string[]       // Botanical tonal variation
    translucencyColor: string   // Backlit transmitted glow color
    translucencyIntensity: number
    alphaCutoff: number
    rainPorosity: number        // Wetness absorption & darkening rate (0 to 1)
  }

  // Hierarchical Wind response
  wind: {
    trunkStiffness: number
    branchFlexibility: number
    leafFlutterAmount: number
    dragCoefficient: number
    massInertia: number         // High for ancient oaks/banyans, low for saplings
    reconfigurationFactor: number // Aerodynamic streamlining under strong gusts
  }

  // Ecological & Animal integration metadata
  ecology: {
    toxicityToCats: boolean     // Prunus species contain cyanogenic glycosides
    perchSuitability: number    // Bird perching score (0 to 1)
    climbableByMonkeys: boolean
    fruitType?: "mango" | "apple" | "orange" | "lemon" | "guava" | "coconut"
  }
}

export const GULMOHAR_PROFILE: TreeSpeciesProfile = {
  family: "gulmohar",
  name: "Gulmohar (Delonix regia)",
  botanicalName: "Delonix regia",
  trunk: {
    baseRadiusRatio: 0.125,
    topRadiusRatio: 0.48,
    rootLobeCount: 4,
    rootFlareRadius: 0.34,
    heightMultiplier: 1.15,
    curvatureMagnitude: 0.14,
    curvatureFrequency: 1.8,
    taperExponent: 1.35,
    barkRoughness: 0.65,
    lenticelDensity: 0.95,
  },
  branches: {
    primaryCount: 4,
    insertionHeightMin: 0.56,
    insertionHeightMax: 0.88,
    insertionAngle: 0.84, // wide, spreading, umbrella-like habit
    droopCurve: 0.16,
    secondaryForkCount: 3,
    tertiaryTwigCount: 4,
    taperRatio: 0.65,
    pipeModelExponent: 2.45,
    apicalDominance: 0.28, // Strongly decurrent spreading architecture
  },
  crown: {
    shape: "vase_spreading",
    widthMultiplier: 1.48,
    heightMultiplier: 1.05,
    clusterCount: 16,
    negativeSpaceFactor: 0.42, // High negative space so dark mahogany boughs show through blossoms
    interiorDensity: 0.24,
    cardScale: 0.72,
    cardsPerCluster: 9,
    silhouetteAsymmetry: 0.25,
  },
  material: {
    barkType: "gulmohar",
    barkRoughness: 0.68,
    foliageRoughness: 0.52,
    leafPalette: [
      "#ffffff", // pure ivory blossom highlight
      "#fce7f3", // delicate blush white
      "#fbcfe8", // soft gulmohar pink
      "#f9a8d4", // warm blossom petal
      "#fda4af", // peach blossom nuance
      "#f472b6", // vibrant rose accent
    ],
    translucencyColor: "#ffd6e7", // Luminous soft pink/ivory transmission
    translucencyIntensity: 1.15,
    alphaCutoff: 0.38,
    rainPorosity: 0.35, // Smooth bark sheds water quickly with high specular sheen
  },
  wind: {
    trunkStiffness: 0.038,
    branchFlexibility: 0.16,
    leafFlutterAmount: 0.12,
    dragCoefficient: 0.62,
    massInertia: 0.45,
    reconfigurationFactor: 0.48,
  },
  ecology: {
    toxicityToCats: true, // NC State: Prunus twigs contain cyanogenic compounds
    perchSuitability: 0.92,
    climbableByMonkeys: false,
  },
}

export const BROAD_DECIDUOUS_PROFILE: TreeSpeciesProfile = {
  family: "broad_deciduous",
  name: "Broad Spreading Banyan / Oak / Mango",
  botanicalName: "Ficus benghalensis / Quercus robur",
  trunk: {
    baseRadiusRatio: 0.18,
    topRadiusRatio: 0.52,
    rootLobeCount: 5,
    rootFlareRadius: 0.46,
    heightMultiplier: 1.08,
    curvatureMagnitude: 0.08,
    curvatureFrequency: 1.4,
    taperExponent: 1.42,
    barkRoughness: 0.92,
    lenticelDensity: 0.12,
  },
  branches: {
    primaryCount: 4,
    insertionHeightMin: 0.50,
    insertionHeightMax: 0.82,
    insertionAngle: 1.05, // Heavy horizontal scaffold limbs
    droopCurve: 0.14,
    secondaryForkCount: 3,
    tertiaryTwigCount: 4,
    taperRatio: 0.62,
    pipeModelExponent: 2.65, // Thick structural boughs
    apicalDominance: 0.22, // Decurrent spreading canopy
  },
  crown: {
    shape: "broad_horizontal",
    widthMultiplier: 1.58,
    heightMultiplier: 0.96,
    clusterCount: 18,
    negativeSpaceFactor: 0.35,
    interiorDensity: 0.32,
    cardScale: 0.72,
    cardsPerCluster: 9,
    silhouetteAsymmetry: 0.22,
  },
  material: {
    barkType: "deciduous",
    barkRoughness: 0.92,
    foliageRoughness: 0.68,
    leafPalette: [
      "#22c55e", // fresh emerald
      "#16a34a", // rich green
      "#15803d", // forest deep
      "#4ade80", // sunlit lime highlight
      "#86efac", // bright spring tip
      "#14532d", // deep shadow
    ],
    translucencyColor: "#a3e635", // Warm golden-emerald sun transmission
    translucencyIntensity: 0.95,
    alphaCutoff: 0.42,
    rainPorosity: 0.75, // Deeply fissured bark absorbs rain, darkening noticeably
  },
  wind: {
    trunkStiffness: 0.032,
    branchFlexibility: 0.11,
    leafFlutterAmount: 0.09,
    dragCoefficient: 0.78,
    massInertia: 0.85, // Heavy mass responds with slow majestic inertia
    reconfigurationFactor: 0.40,
  },
  ecology: {
    toxicityToCats: false,
    perchSuitability: 0.95,
    climbableByMonkeys: true,
  },
}

export const UPRIGHT_DECIDUOUS_PROFILE: TreeSpeciesProfile = {
  family: "upright_deciduous",
  name: "Tall Upright Birch / Poplar / Apple",
  botanicalName: "Betula pendula / Populus tremula",
  trunk: {
    baseRadiusRatio: 0.13,
    topRadiusRatio: 0.48,
    rootLobeCount: 4,
    rootFlareRadius: 0.32,
    heightMultiplier: 1.32,
    curvatureMagnitude: 0.06,
    curvatureFrequency: 2.2,
    taperExponent: 1.25,
    barkRoughness: 0.78,
    lenticelDensity: 0.82,
  },
  branches: {
    primaryCount: 5,
    insertionHeightMin: 0.48,
    insertionHeightMax: 0.92,
    insertionAngle: 0.64, // Ascending limbs with graceful pendulous tips
    droopCurve: 0.09,
    secondaryForkCount: 2,
    tertiaryTwigCount: 3,
    taperRatio: 0.58,
    pipeModelExponent: 2.35,
    apicalDominance: 0.68, // Strong central leader
  },
  crown: {
    shape: "upright_ovate",
    widthMultiplier: 0.98,
    heightMultiplier: 1.42,
    clusterCount: 15,
    negativeSpaceFactor: 0.32,
    interiorDensity: 0.28,
    cardScale: 0.72,
    cardsPerCluster: 9,
    silhouetteAsymmetry: 0.18,
  },
  material: {
    barkType: "deciduous",
    barkRoughness: 0.85,
    foliageRoughness: 0.64,
    leafPalette: [
      "#4ade80", // bright spring emerald
      "#65a30d", // olive tone
      "#84cc16", // vibrant chartreuse
      "#a3e635", // golden lime
      "#15803d", // deep shadow green
    ],
    translucencyColor: "#bef264", // Vivid translucent lime
    translucencyIntensity: 1.05,
    alphaCutoff: 0.42,
    rainPorosity: 0.55,
  },
  wind: {
    trunkStiffness: 0.048,
    branchFlexibility: 0.14,
    leafFlutterAmount: 0.11,
    dragCoefficient: 0.55,
    massInertia: 0.52,
    reconfigurationFactor: 0.55,
  },
  ecology: {
    toxicityToCats: false,
    perchSuitability: 0.88,
    climbableByMonkeys: true,
  },
}

export const DENSE_ORCHARD_PROFILE: TreeSpeciesProfile = {
  family: "dense_orchard",
  name: "Dense Round-Crown Orange / Guava",
  botanicalName: "Citrus sinensis / Psidium guajava",
  trunk: {
    baseRadiusRatio: 0.15,
    topRadiusRatio: 0.55,
    rootLobeCount: 4,
    rootFlareRadius: 0.35,
    heightMultiplier: 1.02,
    curvatureMagnitude: 0.07,
    curvatureFrequency: 1.6,
    taperExponent: 1.30,
    barkRoughness: 0.84,
    lenticelDensity: 0.25,
  },
  branches: {
    primaryCount: 4,
    insertionHeightMin: 0.52,
    insertionHeightMax: 0.85,
    insertionAngle: 0.85,
    droopCurve: 0.12,
    secondaryForkCount: 3,
    tertiaryTwigCount: 4,
    taperRatio: 0.64,
    pipeModelExponent: 2.50,
    apicalDominance: 0.35,
  },
  crown: {
    shape: "round_tiered",
    widthMultiplier: 1.28,
    heightMultiplier: 1.08,
    clusterCount: 16,
    negativeSpaceFactor: 0.28,
    interiorDensity: 0.38,
    cardScale: 0.72,
    cardsPerCluster: 9,
    silhouetteAsymmetry: 0.15,
  },
  material: {
    barkType: "deciduous",
    barkRoughness: 0.88,
    foliageRoughness: 0.62,
    leafPalette: [
      "#15803d",
      "#16a34a",
      "#22c55e",
      "#4ade80",
      "#14532d",
    ],
    translucencyColor: "#86efac",
    translucencyIntensity: 0.88,
    alphaCutoff: 0.42,
    rainPorosity: 0.60,
  },
  wind: {
    trunkStiffness: 0.042,
    branchFlexibility: 0.12,
    leafFlutterAmount: 0.08,
    dragCoefficient: 0.72,
    massInertia: 0.60,
    reconfigurationFactor: 0.42,
  },
  ecology: {
    toxicityToCats: false,
    perchSuitability: 0.85,
    climbableByMonkeys: true,
  },
}

export const PALM_PROFILE: TreeSpeciesProfile = {
  family: "palm",
  name: "Subtropical Coastal Coconut Palm",
  botanicalName: "Cocos nucifera",
  trunk: {
    baseRadiusRatio: 0.14,
    topRadiusRatio: 0.72,
    rootLobeCount: 4,
    rootFlareRadius: 0.32,
    heightMultiplier: 1.45,
    curvatureMagnitude: 0.08,
    curvatureFrequency: 1.0,
    taperExponent: 1.10,
    barkRoughness: 0.94,
    lenticelDensity: 0.05,
  },
  branches: {
    primaryCount: 0,
    insertionHeightMin: 0.95,
    insertionHeightMax: 1.0,
    insertionAngle: 0.5,
    droopCurve: 0.45,
    secondaryForkCount: 0,
    tertiaryTwigCount: 0,
    taperRatio: 0.85,
    pipeModelExponent: 2.0,
    apicalDominance: 1.0,
  },
  crown: {
    shape: "palm_frond",
    widthMultiplier: 1.6,
    heightMultiplier: 0.75,
    clusterCount: 14, // 14 radiating arching pinnate fronds
    negativeSpaceFactor: 0.50,
    interiorDensity: 0.10,
    cardScale: 0.85,
    cardsPerCluster: 1,
    silhouetteAsymmetry: 0.20,
  },
  material: {
    barkType: "palm",
    barkRoughness: 0.94,
    foliageRoughness: 0.60,
    leafPalette: ["#16a34a", "#22c55e", "#4ade80", "#15803d"],
    translucencyColor: "#a3e635",
    translucencyIntensity: 1.10,
    alphaCutoff: 0.45,
    rainPorosity: 0.40,
  },
  wind: {
    trunkStiffness: 0.055,
    branchFlexibility: 0.24,
    leafFlutterAmount: 0.14,
    dragCoefficient: 0.58,
    massInertia: 0.42,
    reconfigurationFactor: 0.65,
  },
  ecology: {
    toxicityToCats: false,
    perchSuitability: 0.65,
    climbableByMonkeys: true,
    fruitType: "coconut",
  },
}

/**
 * Maps tree index & variant to its species profile.
 */
export const getProfileForTree = (
  treeIndex: number,
  variant: number,
  isGulmohar = false,
): TreeSpeciesProfile => {
  if (isGulmohar) return GULMOHAR_PROFILE
  if (treeIndex === 53) return PALM_PROFILE
  if (variant === 0) return UPRIGHT_DECIDUOUS_PROFILE
  if (variant === 1) return BROAD_DECIDUOUS_PROFILE
  return DENSE_ORCHARD_PROFILE
}

/**
 * Deterministic Individual Tree Instance DNA:
 * Every persistent tree is generated from:
 * Species DNA + Age + Health + Environment + Competition + Exposure + Deterministic Seed
 */
export type TreeInstanceDNA = {
  treeIndex: number
  id: string
  seed: number
  profile: TreeSpeciesProfile
  position: { x: number; y: number; z: number }
  scale: number
  height: number
  trunkRadius: number
  age: number // 0.75 (young) to 1.35 (ancient)
  health: number // 0.85 to 1.0
  leanAngle: number
  leanYaw: number
  // Canopy competition displacement vector (shifted away from dense neighbors)
  competitionOffset: { x: number; z: number }
  // Local terrain slope vector for root buttress grounding
  terrainSlope: { normal: THREE.Vector3; slopeAngle: number; downhillDir: THREE.Vector2 }
  // Micro-imperfection state
  imperfections: {
    hasDeadBranch: boolean
    deadBranchIndex: number
    barkScarHeight: number
  }
}

/**
 * Computes terrain slope and normal at (x, z) via central finite differences.
 */
export const sampleTerrainSlope = (
  x: number,
  z: number,
  eps = 0.35,
): { normal: THREE.Vector3; slopeAngle: number; downhillDir: THREE.Vector2 } => {
  const hL = groundHeight(x - eps, z)
  const hR = groundHeight(x + eps, z)
  const hD = groundHeight(x, z - eps)
  const hU = groundHeight(x, z + eps)

  const dhdx = (hR - hL) / (2 * eps)
  const dhdz = (hU - hD) / (2 * eps)

  const normal = new THREE.Vector3(-dhdx, 1.0, -dhdz).normalize()
  const slopeAngle = Math.acos(Math.max(0, Math.min(1, normal.y)))
  const downhillDir = new THREE.Vector2(-dhdx, -dhdz)
  if (downhillDir.lengthSq() > 1e-5) downhillDir.normalize()

  return { normal, slopeAngle, downhillDir }
}

/**
 * Generates deterministic individual Tree DNA respecting species rules and local environment.
 */
export const generateTreeInstanceDNA = (
  treeIndex: number,
  variant: number,
  isGulmohar: boolean,
  x: number,
  z: number,
  baseScale: number,
  allTreePositions?: Array<{ x: number; z: number }>,
): TreeInstanceDNA => {
  const seed = (isGulmohar ? 91823 : 31415) + treeIndex * 487
  const rng = makeRng(seed)
  const profile = getProfileForTree(treeIndex, variant, isGulmohar)
  const groundY = groundHeight(x, z)

  // Correlated age: affects trunk thickness, branch spread, and root flare
  const age = 0.85 + rng() * 0.40 // 0.85 to 1.25
  const height = baseScale * (profile.trunk.heightMultiplier * (0.92 + rng() * 0.22) * age)
  const trunkRadius = profile.trunk.baseRadiusRatio * baseScale * (0.90 + rng() * 0.25) * Math.pow(age, 0.7)

  // Subtle natural lean (tending toward vertical phototropism on slopes)
  const terrain = sampleTerrainSlope(x, z)
  // Roots adapt downhill, but trunk phototropically corrects toward vertical
  const phototropicLean = terrain.slopeAngle * 0.35
  const naturalLean = (rng() - 0.5) * 0.08
  const leanAngle = naturalLean + phototropicLean
  const leanYaw = terrain.downhillDir.lengthSq() > 0.01
    ? Math.atan2(terrain.downhillDir.y, terrain.downhillDir.x) + Math.PI // lean slightly toward uphill
    : rng() * Math.PI * 2

  // Canopy competition from neighbors (Runions et al. Space Colonization / Oxford Forestry 2026)
  const compOffset = { x: 0, z: 0 }
  if (allTreePositions && allTreePositions.length > 0) {
    let compX = 0
    let compZ = 0
    let totalWeight = 0
    for (let j = 0; j < allTreePositions.length; j++) {
      if (j === treeIndex) continue
      const other = allTreePositions[j]
      const dx = x - other.x
      const dz = z - other.z
      const dist = Math.hypot(dx, dz)
      if (dist > 0.5 && dist < 6.5) {
        // Repulsive force away from neighbor crown
        const weight = (6.5 - dist) / 6.5
        compX += (dx / dist) * weight
        compZ += (dz / dist) * weight
        totalWeight += weight
      }
    }
    if (totalWeight > 0.1) {
      const dispLen = Math.min(0.45 * baseScale, (compX * compX + compZ * compZ) * 0.2)
      const compNorm = Math.hypot(compX, compZ)
      if (compNorm > 1e-4) {
        compOffset.x = (compX / compNorm) * dispLen
        compOffset.z = (compZ / compNorm) * dispLen
      }
    }
  }

  // Controlled deterministic imperfections
  const hasDeadBranch = age > 1.15 && rng() < 0.28
  const deadBranchIndex = Math.floor(rng() * 4)
  const barkScarHeight = rng() < 0.22 ? 0.3 + rng() * 0.5 : -1

  return {
    treeIndex,
    id: `tree_${isGulmohar ? "gulmohar" : "deciduous"}_${treeIndex}`,
    seed,
    profile,
    position: { x, y: groundY, z },
    scale: baseScale,
    height,
    trunkRadius,
    age,
    health: 0.92 + rng() * 0.08,
    leanAngle,
    leanYaw,
    competitionOffset: compOffset,
    terrainSlope: terrain,
    imperfections: {
      hasDeadBranch,
      deadBranchIndex,
      barkScarHeight,
    },
  }
}
