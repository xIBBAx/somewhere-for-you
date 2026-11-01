import * as THREE from "three"
import { BIRD_ELBOW, BIRD_SHOULDER, createBirdGeometry, createBirdParts, type BirdParts } from "./birdsGeometry"

/**
 * Shared detailed-bird appearance for the home animals (the handful that land,
 * stand and perch) — the same recognised songbird silhouette the streamed world
 * flock flies, but tinted per species and driven from the CPU.
 *
 * The home birds are few and bounded, so they keep real shoulder/elbow groups
 * and one shared geometry + one material per species. Nothing here simulates:
 * the ecosystem agents still decide where each bird goes, and the callers still
 * own glide/flap/landing/perch. This module only supplies appearance.
 */
export type HomeBirdPalette = {
  name: string
  /** mantle / back / crown */
  body: string
  /** throat, breast and belly */
  breast: string
  /** bill, eyes and legs */
  dark: string
  /** primaries and tail, mixed in at the wing tips */
  wing: string
}

export const HOME_BIRD_PALETTES: Record<string, HomeBirdPalette> = {
  robin: { name: "robin", body: "#6f6a4e", breast: "#c8642a", dark: "#241d16", wing: "#4a4436" },
  bluebird: { name: "bluebird", body: "#3f5f9e", breast: "#c98a4b", dark: "#1d1a17", wing: "#2c4676" },
  goldfinch: { name: "goldfinch", body: "#c8a520", breast: "#e8cf5e", dark: "#2b2415", wing: "#3d3418" },
  sparrow: { name: "sparrow", body: "#7a6146", breast: "#ded2bc", dark: "#2a231b", wing: "#574330" },
  skyWhite: { name: "skyWhite", body: "#e8e4dc", breast: "#f5f2ec", dark: "#3a352e", wing: "#b9b3a6" },
  skyBlue: { name: "skyBlue", body: "#5b7fc4", breast: "#dbe6f5", dark: "#2a3040", wing: "#3f5f96" },
  skyGold: { name: "skyGold", body: "#d8b03c", breast: "#f0d98c", dark: "#3a3018", wing: "#a8842a" },
  skyTeal: { name: "skyTeal", body: "#4b93a8", breast: "#d6ecf2", dark: "#26343a", wing: "#35707f" },
}

/** One shared geometry per variant, cached for the lifetime of the scene. */
const geometryCache = new Map<string, THREE.BufferGeometry>()

/** `wings` for birds that are always airborne, `feet` for anything that lands. */
export const getHomeBirdGeometry = (variant: "wings" | "feet"): THREE.BufferGeometry => {
  let geometry = geometryCache.get(variant)
  if (!geometry) {
    geometry = createBirdGeometry({ feet: variant === "feet" })
    geometryCache.set(variant, geometry)
  }
  return geometry
}

/**
 * Body / inner-wing / outer-wing pieces for CPU articulation, shared per
 * variant. The inner piece is expressed relative to the shoulder pivot and the
 * outer piece relative to the elbow, so each attaches straight onto its group.
 */
const partsCache = new Map<string, BirdParts>()

export const getHomeBirdParts = (variant: "wings" | "feet"): BirdParts => {
  let parts = partsCache.get(variant)
  if (!parts) {
    parts = createBirdParts({ feet: variant === "feet" })
    partsCache.set(variant, parts)
  }
  return parts
}

/**
 * Tint material driven by the geometry's `aBirdPart` region ids, so a robin
 * reads as a robin from uniforms alone — one shared geometry, no per-bird
 * rebuild. The baked vertex colour is kept as a base and only overridden per
 * region, which preserves the per-vertex shading (mantle, flank, crown) that
 * was baked into the silhouette.
 */
export const createHomeBirdMaterial = (palette: HomeBirdPalette): THREE.MeshStandardMaterial => {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.84,
    metalness: 0,
    side: THREE.DoubleSide,
  })
  const uniforms = {
    uBody: { value: new THREE.Color(palette.body) },
    uBreast: { value: new THREE.Color(palette.breast) },
    uDark: { value: new THREE.Color(palette.dark) },
  }
  mat.userData.palette = uniforms
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float aBirdPart;
varying float vBirdPart;
`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vBirdPart = aBirdPart;
`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform vec3 uBody;
uniform vec3 uBreast;
uniform vec3 uDark;
varying float vBirdPart;
`,
      )
      .replace(
        "#include <color_fragment>",
        `// region 0 mantle/head, 1 breast & belly, 2 bill/eyes/legs. The baked
// vertex colour still carries the per-vertex shading within each region.
#include <color_fragment>
vec3 birdTint = vBirdPart > 0.5 ? uBreast : uBody;
float shade = max(vColor.r,max(vColor.g,vColor.b));
if(vBirdPart<1.5) diffuseColor.rgb=birdTint*mix(.60,1.08,shade);
`,
      )
  }
  mat.customProgramCacheKey = () => "home-bird-v1"
  return mat
}

/** Materials are shared per species: the four ground birds and the sky flock
 * reuse one material each instead of allocating per instance. */
const materialCache = new Map<string, THREE.MeshStandardMaterial>()

export const getHomeBirdMaterial = (palette: HomeBirdPalette): THREE.MeshStandardMaterial => {
  let material = materialCache.get(palette.name)
  if (!material) {
    material = createHomeBirdMaterial(palette)
    materialCache.set(palette.name, material)
  }
  return material
}

/**
 * Disposes the shared home-bird resources. Geometry and materials are shared
 * across every home bird, so they are only released together, on teardown —
 * disposing one instance's geometry would blank every other bird.
 */
export const disposeHomeBirdResources = (): void => {
  for (const geometry of geometryCache.values()) geometry.dispose()
  geometryCache.clear()
  for (const parts of partsCache.values()) {
    parts.body.dispose()
    parts.wingInner.dispose()
    parts.wingOuter.dispose()
  }
  partsCache.clear()
  for (const material of materialCache.values()) material.dispose()
  materialCache.clear()
}

/**
 * Articulated wing flap for a CPU-driven home bird. The same two-hinge ramp the
 * GPU uses is applied to real shoulder and elbow groups, so a perched bird
 * flicking its wings and a flying bird flapping read identically.
 */
export type HomeBirdWings = {
  shoulderL: THREE.Object3D
  shoulderR: THREE.Object3D
  elbowL: THREE.Object3D | null
  elbowR: THREE.Object3D | null
}

const ELBOW_HINGE = 0.9
const MAX_FLAP = 0.62

/**
 * `flap` is the stroke phase −1..1, `effort` scales the amplitude, and
 * `folded` tucks the wing back along the body (the perched/landing pose).
 */
export const poseHomeBirdWings = (
  wings: HomeBirdWings,
  flap: number,
  effort: number,
  folded: number,
): void => {
  const shoulder = THREE.MathUtils.clamp(flap, -MAX_FLAP, MAX_FLAP) * Math.max(0.15, effort) * (1 - folded * 0.8)
  const elbow = shoulder * ELBOW_HINGE
  wings.shoulderL.rotation.set(0, -folded * 1.2, -shoulder)
  wings.shoulderR.rotation.set(0, folded * 1.2, shoulder)
  if (wings.elbowL) wings.elbowL.rotation.set(0, -folded * 1.1, -elbow)
  if (wings.elbowR) wings.elbowR.rotation.set(0, folded * 1.1, elbow)
}

export { ELBOW_HINGE, BIRD_SHOULDER, BIRD_ELBOW }
