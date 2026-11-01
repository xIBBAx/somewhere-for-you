import { highvaleWeight } from "../../world/highvale/highvaleLayout"
import { cloudLift } from "../../world/highvale/highvaleSky"
import { homeSky } from "../celestial/homeSky"
import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { windRT } from "../../world/wind"
import { originRT } from "../../world/origin"
import { groundHeight } from "../world-layout"
import { cirrusWispTexture, cloudPuffAtlasTexture } from "../../utils/canvasTexture"
import { makeRng, smoothstep } from "../../utils/math"
import { avatarRT, worldRT } from "../runtime"
import { weatherRT } from "../weather/weatherState"
import { keyLightDirection, nightBlend, skyLightLevel } from "./celestialLighting"
import { cloudFieldRT } from "./cloudField"

const nightCloudTop = new THREE.Color("#182239")
const nightCloudBase = new THREE.Color("#0c1425")
const dayCloudTop = new THREE.Color("#68a9cd")
const dayCloudBase = new THREE.Color("#ccebf4")
const dayCloudAmbient = new THREE.Color("#d1e0ed")
const sunsetCloudTop = new THREE.Color("#d4758e")
const sunsetCloudBase = new THREE.Color("#f0b37c")
const sunsetCloudAmbient = new THREE.Color("#e4b188")
const moonCloudLight = new THREE.Color("#bdcdea")

/**
 * ============================================================================
 * CLOUD SYSTEM CONFIGURATION
 * ============================================================================
 * Centralized parameters governing cloud coverage, morphology, lighting,
 * optical scattering, animation, and spatial distribution.
 */
export const CLOUD_CONFIG = {
  // Spatial domain & boundaries (meters)
  domainRadius: 270.0, // camera-centred sky domain (wraps invisibly at faded edges)
  zenithRadius: 28.0, // inner overhead sky dome (above home)
  midRadius: 62.0, // mid-range expansive cloud banks
  horizonRadius: 96.0, // outer scenic horizon reach

  // Altitude tiers (meters above ground level)
  cumulusBaseAltitude: 36.0,
  cumulusHeightSpread: 8.0,
  cirrusAltitude: 66.0,
  cirrusAltitudeSpread: 8.0,

  // Scale ranges
  macroScaleMin: 8.5,
  macroScaleMax: 26.0,

  // Optics & Lighting
  mieScatteringPower: 4.2,
  mieScatteringIntensity: 0.95,
  selfShadowDepth: 0.42, // subtle, cool, luminous shadow
  skyBounceIntensity: 0.65, // buoyant ambient fill

  // Animation & Dynamics
  windSpeedMultiplier: 0.48,
  cirrusWindMultiplier: 1.35,
  evolutionSpeed: 0.015,
} as const

/**
 * Types of cloud formations in the procedural sky.
 */
export type CloudArchetype =
  | "cumulus_congestus" // towering cauliflower with multiple rising heads
  | "cumulus_humilis" // wide, flat-bottomed fair-weather cumulus
  | "cumulus_mediocris" // classic cauliflower cloud
  | "cumulus_puff" // small isolated cotton puff
  | "pareidolia_heart" // rare cumulus evoking a heart via macro lobes
  | "pareidolia_wings" // rare towering bank suggesting outstretched wings
  | "pareidolia_cat" // rare formation suggesting a curled/resting cat

export type PuffDef = {
  dx: number
  dy: number
  dz: number
  sx: number
  sy: number
  sz: number
  atlasIndex: number // 0: crown, 1: flank, 2: base, 3: vapor wisp
  density: number
  heightRel: number // 0 (base) to 1 (apex)
  rotation: number
}

export type FormationDef = {
  id: number
  archetype: CloudArchetype
  x: number
  y: number
  z: number
  scale: number
  puffs: PuffDef[]
}

export type CirrusDef = {
  id: number
  x: number
  y: number
  z: number
  length: number
  height: number
  rotation: number
  opacity: number
}

/**
 * A hand-planned sky, scaled up and layered (rotated
 * copies with fresh seeds) so it fills a camera-centred domain over the
 * endless world. Pareidolia clouds (heart, wings, cat) still drift by.
 */
const expandSky = (): { cumulus: FormationDef[]; cirrus: CirrusDef[] } => {
  const layers: Array<{ seed: number; rot: number; spread: number; lift: number; scale: number }> = [
    { seed: 888, rot: 0, spread: 2.5, lift: 1.5, scale: 1.55 },
    { seed: 1888, rot: 1.9, spread: 2.0, lift: 1.62, scale: 1.4 },
    { seed: 2888, rot: 3.9, spread: 2.75, lift: 1.42, scale: 1.65 },
  ]
  const cumulus: FormationDef[] = []
  const cirrus: CirrusDef[] = []
  let id = 0
  for (const layer of layers) {
    const sky = generateCloudFormations(layer.seed)
    const c = Math.cos(layer.rot)
    const sn = Math.sin(layer.rot)
    for (const f of sky.cumulus) {
      // keep only one copy of each rare pareidolia shape
      if (layer.seed !== 888 && f.archetype.startsWith("pareidolia")) continue
      cumulus.push({ ...f, id: id++, x: (f.x * c - f.z * sn) * layer.spread, z: (f.x * sn + f.z * c) * layer.spread, y: f.y * layer.lift, scale: f.scale * layer.scale })
    }
    for (const w of sky.cirrus) {
      cirrus.push({ ...w, id: id++, x: (w.x * c - w.z * sn) * layer.spread, z: (w.x * sn + w.z * c) * layer.spread, y: w.y * layer.lift, length: w.length * 1.6, height: w.height * 1.4 })
    }
  }
  return { cumulus, cirrus }
}

/**
 * Procedural generation of organic cumulus cloud formations with multi-scale
 * cauliflower structure, flat condensation bases, zenith presence, and rare pareidolia silhouettes.
 */
export const generateCloudFormations = (
  seed: number,
): { cumulus: FormationDef[]; cirrus: CirrusDef[] } => {
  const rng = makeRng(seed)
  const formations: FormationDef[] = []

  // Structured sky plan across three natural zones:
  // 1. Zenith zone (r in [4, 26]): clouds drifting directly overhead above home
  // 2. Mid-sky zone (r in [28, 62]): main cumulus banks & rare pareidolia formations
  // 3. Horizon zone (r in [64, 94]): distant dramatic cloud formations framing horizon
  const plan: Array<{
    archetype: CloudArchetype
    zone: "zenith" | "mid" | "horizon"
    rMin: number
    rMax: number
    scaleRange: [number, number]
  }> = [
    // --- Overhead Zenith Zone (direct skyward presence) ---
    { archetype: "cumulus_mediocris", zone: "zenith", rMin: 6, rMax: 18, scaleRange: [14, 18] },
    { archetype: "cumulus_puff", zone: "zenith", rMin: 8, rMax: 22, scaleRange: [7, 10] },
    { archetype: "cumulus_humilis", zone: "zenith", rMin: 14, rMax: 26, scaleRange: [12, 16] },
    { archetype: "cumulus_puff", zone: "zenith", rMin: 16, rMax: 26, scaleRange: [6.5, 9.5] },

    // --- Mid-Sky Zone (majestic fair-weather banks & rare pareidolia) ---
    { archetype: "cumulus_congestus", zone: "mid", rMin: 30, rMax: 48, scaleRange: [22, 26] },
    { archetype: "cumulus_humilis", zone: "mid", rMin: 32, rMax: 50, scaleRange: [14, 18] },
    { archetype: "pareidolia_heart", zone: "mid", rMin: 34, rMax: 52, scaleRange: [18, 22] }, // Rare Pareidolia #1
    { archetype: "cumulus_mediocris", zone: "mid", rMin: 36, rMax: 54, scaleRange: [16, 20] },
    { archetype: "cumulus_puff", zone: "mid", rMin: 38, rMax: 56, scaleRange: [8, 11] },
    { archetype: "pareidolia_wings", zone: "mid", rMin: 40, rMax: 58, scaleRange: [20, 24] }, // Rare Pareidolia #2
    { archetype: "cumulus_mediocris", zone: "mid", rMin: 42, rMax: 60, scaleRange: [15, 19] },
    { archetype: "pareidolia_cat", zone: "mid", rMin: 44, rMax: 60, scaleRange: [17, 21] }, // Rare Pareidolia #3
    { archetype: "cumulus_congestus", zone: "mid", rMin: 46, rMax: 62, scaleRange: [22, 26] },
    { archetype: "cumulus_humilis", zone: "mid", rMin: 48, rMax: 62, scaleRange: [13, 17] },

    // --- Horizon-Framing Zone (atmospheric depth & distant vistas) ---
    { archetype: "cumulus_congestus", zone: "horizon", rMin: 65, rMax: 86, scaleRange: [24, 28] },
    { archetype: "cumulus_mediocris", zone: "horizon", rMin: 68, rMax: 88, scaleRange: [18, 22] },
    { archetype: "cumulus_humilis", zone: "horizon", rMin: 70, rMax: 90, scaleRange: [15, 19] },
    { archetype: "cumulus_congestus", zone: "horizon", rMin: 72, rMax: 92, scaleRange: [24, 28] },
    { archetype: "cumulus_mediocris", zone: "horizon", rMin: 74, rMax: 92, scaleRange: [17, 21] },
    { archetype: "cumulus_puff", zone: "horizon", rMin: 76, rMax: 94, scaleRange: [9, 12] },
    { archetype: "cumulus_humilis", zone: "horizon", rMin: 78, rMax: 94, scaleRange: [16, 20] },
    { archetype: "cumulus_mediocris", zone: "horizon", rMin: 80, rMax: 94, scaleRange: [18, 22] },
  ]

  for (let i = 0; i < plan.length; i++) {
    const item = plan[i]
    // Distribute with organic golden ratio angle distribution to avoid grid/line patterns
    const angle = i * 2.399963 + (rng() - 0.5) * 0.45
    const radius = item.rMin + rng() * (item.rMax - item.rMin)

    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius

    // Base altitude with natural atmospheric variance
    const altitudeBase =
      item.zone === "zenith"
        ? CLOUD_CONFIG.cumulusBaseAltitude + 4.0
        : item.zone === "horizon"
          ? CLOUD_CONFIG.cumulusBaseAltitude - 2.5
          : CLOUD_CONFIG.cumulusBaseAltitude

    const y = altitudeBase + (rng() - 0.5) * CLOUD_CONFIG.cumulusHeightSpread
    const scale = item.scaleRange[0] + rng() * (item.scaleRange[1] - item.scaleRange[0])

    const puffs: PuffDef[] = []

    if (item.archetype === "pareidolia_heart") {
      // --------------------------------------------------------------------
      // RARE PAREIDOLIA: Soft Cumulus Heart
      // Natural fair-weather cumulus first, subtle heart pareidolia second.
      // Continuous flat condensation base shelf + dense central core
      // + two upper billowing cauliflower domes + tapered lower mass.
      // --------------------------------------------------------------------
      // 1. Continuous Flat Condensation Base (overlapping shelf)
      puffs.push({ dx: -0.65, dy: 0.12, dz: 0.0, sx: 1.45, sy: 0.65, sz: 1.25, atlasIndex: 2, density: 0.9, heightRel: 0.06, rotation: 0.0 })
      puffs.push({ dx: 0.65, dy: 0.12, dz: 0.0, sx: 1.45, sy: 0.65, sz: 1.25, atlasIndex: 2, density: 0.9, heightRel: 0.06, rotation: 0.05 })
      puffs.push({ dx: 0.0, dy: -0.15, dz: 0.05, sx: 1.35, sy: 0.65, sz: 1.15, atlasIndex: 2, density: 0.88, heightRel: 0.0, rotation: -0.05 })
      puffs.push({ dx: 0.0, dy: 0.22, dz: 0.0, sx: 1.75, sy: 0.75, sz: 1.4, atlasIndex: 2, density: 0.92, heightRel: 0.1, rotation: 0.0 })

      // 2. Central Unifying Core (dense continuous volume)
      puffs.push({ dx: 0.0, dy: 0.68, dz: 0.0, sx: 2.1, sy: 1.55, sz: 1.85, atlasIndex: 1, density: 0.98, heightRel: 0.35, rotation: 0.15 })
      puffs.push({ dx: -0.35, dy: 0.98, dz: 0.1, sx: 1.8, sy: 1.45, sz: 1.65, atlasIndex: 1, density: 0.95, heightRel: 0.5, rotation: -0.12 })
      puffs.push({ dx: 0.35, dy: 1.02, dz: -0.1, sx: 1.8, sy: 1.45, sz: 1.65, atlasIndex: 1, density: 0.95, heightRel: 0.52, rotation: 0.12 })

      // 3. Left Upper Billowing Lobe (cauliflower turret cluster)
      puffs.push({ dx: -1.05, dy: 1.65, dz: -0.08, sx: 1.75, sy: 1.6, sz: 1.55, atlasIndex: 0, density: 0.96, heightRel: 0.82, rotation: 0.25 })
      puffs.push({ dx: -1.5, dy: 1.38, dz: 0.12, sx: 1.45, sy: 1.35, sz: 1.35, atlasIndex: 0, density: 0.9, heightRel: 0.72, rotation: -0.18 })
      puffs.push({ dx: -0.85, dy: 2.05, dz: 0.0, sx: 1.35, sy: 1.25, sz: 1.25, atlasIndex: 0, density: 0.92, heightRel: 0.95, rotation: 0.35 })
      puffs.push({ dx: -1.3, dy: 1.9, dz: -0.1, sx: 1.15, sy: 1.1, sz: 1.1, atlasIndex: 0, density: 0.88, heightRel: 0.9, rotation: -0.1 })

      // 4. Right Upper Billowing Lobe (organic asymmetry)
      puffs.push({ dx: 1.1, dy: 1.72, dz: 0.1, sx: 1.8, sy: 1.65, sz: 1.6, atlasIndex: 0, density: 0.97, heightRel: 0.85, rotation: -0.22 })
      puffs.push({ dx: 1.55, dy: 1.42, dz: -0.12, sx: 1.48, sy: 1.38, sz: 1.38, atlasIndex: 0, density: 0.91, heightRel: 0.74, rotation: 0.15 })
      puffs.push({ dx: 0.95, dy: 2.12, dz: 0.05, sx: 1.38, sy: 1.28, sz: 1.28, atlasIndex: 0, density: 0.94, heightRel: 0.98, rotation: -0.28 })
      puffs.push({ dx: 1.35, dy: 1.98, dz: 0.08, sx: 1.18, sy: 1.12, sz: 1.12, atlasIndex: 0, density: 0.88, heightRel: 0.92, rotation: 0.18 })

      // 5. Central Dip / Negative Space (soft, lower-sitting middle lobe)
      puffs.push({ dx: 0.02, dy: 1.28, dz: -0.05, sx: 1.25, sy: 1.05, sz: 1.2, atlasIndex: 1, density: 0.85, heightRel: 0.62, rotation: 0.08 })

      // 6. Perimeter Cauliflower Breakup & Wisps
      for (let p = 0; p < 8; p++) {
        const u = (p / 8) * Math.PI * 2
        puffs.push({
          dx: Math.cos(u) * 1.5 + (rng() - 0.5) * 0.25,
          dy: 0.85 + Math.sin(u) * 0.8 + (rng() - 0.5) * 0.2,
          dz: (rng() - 0.5) * 0.55,
          sx: 0.95 + rng() * 0.35,
          sy: 0.85 + rng() * 0.3,
          sz: 0.9 + rng() * 0.3,
          atlasIndex: rng() > 0.4 ? 1 : 0,
          density: 0.75 + rng() * 0.15,
          heightRel: 0.45,
          rotation: rng() * Math.PI * 2,
        })
      }
      for (let p = 0; p < 6; p++) {
        const u = (p / 6) * Math.PI * 2
        puffs.push({
          dx: Math.cos(u) * 1.85 + (rng() - 0.5) * 0.2,
          dy: 0.9 + (rng() - 0.5) * 0.6,
          dz: (rng() - 0.5) * 0.65,
          sx: 0.8 + rng() * 0.35,
          sy: 0.7 + rng() * 0.3,
          sz: 0.8 + rng() * 0.35,
          atlasIndex: 3,
          density: 0.45 + rng() * 0.2,
          heightRel: 0.45,
          rotation: rng() * Math.PI * 2,
        })
      }
    } else if (item.archetype === "pareidolia_wings") {
      // --------------------------------------------------------------------
      // RARE PAREIDOLIA: Swept Cumulus Wings / Soaring Bird
      // Majestic cumulus congestus tower with sweeping, ascending cauliflower
      // wings and continuous horizontal base shelf.
      // --------------------------------------------------------------------
      // 1. Continuous Base Shelf (solid foundation across full span)
      puffs.push({ dx: 0.0, dy: 0.1, dz: 0.0, sx: 2.0, sy: 0.72, sz: 1.5, atlasIndex: 2, density: 0.92, heightRel: 0.05, rotation: 0.0 })
      puffs.push({ dx: -1.2, dy: 0.15, dz: 0.0, sx: 1.7, sy: 0.68, sz: 1.3, atlasIndex: 2, density: 0.88, heightRel: 0.07, rotation: 0.08 })
      puffs.push({ dx: 1.2, dy: 0.15, dz: 0.0, sx: 1.7, sy: 0.68, sz: 1.3, atlasIndex: 2, density: 0.88, heightRel: 0.07, rotation: -0.08 })
      puffs.push({ dx: -2.3, dy: 0.18, dz: -0.1, sx: 1.5, sy: 0.65, sz: 1.2, atlasIndex: 2, density: 0.85, heightRel: 0.08, rotation: 0.12 })
      puffs.push({ dx: 2.3, dy: 0.18, dz: 0.1, sx: 1.5, sy: 0.65, sz: 1.2, atlasIndex: 2, density: 0.85, heightRel: 0.08, rotation: -0.12 })

      // 2. Torso / Crest Core
      puffs.push({ dx: 0.0, dy: 0.85, dz: 0.0, sx: 2.1, sy: 1.65, sz: 1.8, atlasIndex: 0, density: 0.98, heightRel: 0.42, rotation: 0.12 })
      puffs.push({ dx: 0.0, dy: 1.75, dz: 0.05, sx: 1.65, sy: 1.5, sz: 1.5, atlasIndex: 0, density: 0.94, heightRel: 0.82, rotation: -0.08 })
      puffs.push({ dx: 0.0, dy: 2.4, dz: 0.08, sx: 1.25, sy: 1.15, sz: 1.2, atlasIndex: 0, density: 0.9, heightRel: 0.98, rotation: 0.05 })

      // 3. Left Wing Span (continuous stepped ascending billows)
      puffs.push({ dx: -1.0, dy: 1.05, dz: -0.1, sx: 1.75, sy: 1.4, sz: 1.45, atlasIndex: 1, density: 0.93, heightRel: 0.48, rotation: 0.18 })
      puffs.push({ dx: -1.8, dy: 1.45, dz: -0.2, sx: 1.65, sy: 1.35, sz: 1.4, atlasIndex: 1, density: 0.91, heightRel: 0.65, rotation: 0.28 })
      puffs.push({ dx: -2.6, dy: 1.85, dz: -0.3, sx: 1.5, sy: 1.25, sz: 1.3, atlasIndex: 0, density: 0.89, heightRel: 0.8, rotation: 0.38 })
      puffs.push({ dx: -3.4, dy: 2.22, dz: -0.4, sx: 1.35, sy: 1.15, sz: 1.2, atlasIndex: 0, density: 0.87, heightRel: 0.92, rotation: 0.48 })
      puffs.push({ dx: -4.1, dy: 2.55, dz: -0.5, sx: 1.15, sy: 0.95, sz: 1.05, atlasIndex: 3, density: 0.68, heightRel: 0.98, rotation: 0.58 })

      // 4. Right Wing Span (continuous stepped ascending billows)
      puffs.push({ dx: 1.05, dy: 1.02, dz: 0.08, sx: 1.75, sy: 1.4, sz: 1.45, atlasIndex: 1, density: 0.93, heightRel: 0.46, rotation: -0.18 })
      puffs.push({ dx: 1.85, dy: 1.4, dz: 0.18, sx: 1.65, sy: 1.35, sz: 1.4, atlasIndex: 1, density: 0.91, heightRel: 0.62, rotation: -0.28 })
      puffs.push({ dx: 2.65, dy: 1.78, dz: 0.28, sx: 1.5, sy: 1.25, sz: 1.3, atlasIndex: 0, density: 0.89, heightRel: 0.78, rotation: -0.38 })
      puffs.push({ dx: 3.45, dy: 2.15, dz: 0.38, sx: 1.35, sy: 1.15, sz: 1.2, atlasIndex: 0, density: 0.87, heightRel: 0.9, rotation: -0.48 })
      puffs.push({ dx: 4.15, dy: 2.48, dz: 0.48, sx: 1.15, sy: 0.95, sz: 1.05, atlasIndex: 3, density: 0.68, heightRel: 0.96, rotation: -0.58 })

      // 5. Organic Breakup Lobes along body and under wings
      for (let p = 0; p < 7; p++) {
        puffs.push({
          dx: (rng() - 0.5) * 3.4,
          dy: 0.6 + rng() * 1.0,
          dz: (rng() - 0.5) * 0.7,
          sx: 0.9 + rng() * 0.4,
          sy: 0.8 + rng() * 0.35,
          sz: 0.85 + rng() * 0.35,
          atlasIndex: 1,
          density: 0.72 + rng() * 0.18,
          heightRel: 0.45,
          rotation: rng() * Math.PI * 2,
        })
      }
    } else if (item.archetype === "pareidolia_cat") {
      // --------------------------------------------------------------------
      // RARE PAREIDOLIA: Sleeping Cat on Cloud Shelf
      // Smooth arched spine, curled sleeping flank, head bulge with subtle
      // ear-like mounds, and soft trailing tail wisp.
      // --------------------------------------------------------------------
      // Base shelf
      puffs.push({ dx: -0.8, dy: 0.1, dz: 0.0, sx: 1.8, sy: 0.7, sz: 1.4, atlasIndex: 2, density: 0.9, heightRel: 0.06, rotation: 0.0 })
      puffs.push({ dx: 0.8, dy: 0.1, dz: 0.0, sx: 1.8, sy: 0.7, sz: 1.4, atlasIndex: 2, density: 0.9, heightRel: 0.06, rotation: 0.0 })
      puffs.push({ dx: 1.9, dy: 0.12, dz: 0.05, sx: 1.4, sy: 0.65, sz: 1.2, atlasIndex: 2, density: 0.85, heightRel: 0.08, rotation: 0.05 })

      // Sleeping body core & arched spine
      puffs.push({ dx: 0.1, dy: 0.85, dz: 0.0, sx: 2.2, sy: 1.6, sz: 1.8, atlasIndex: 1, density: 0.98, heightRel: 0.48, rotation: 0.1 })
      puffs.push({ dx: -0.65, dy: 1.15, dz: 0.08, sx: 1.85, sy: 1.4, sz: 1.55, atlasIndex: 0, density: 0.95, heightRel: 0.68, rotation: -0.12 }) // arched back
      puffs.push({ dx: 0.85, dy: 0.92, dz: -0.05, sx: 1.75, sy: 1.35, sz: 1.5, atlasIndex: 1, density: 0.92, heightRel: 0.52, rotation: 0.15 })

      // Nestled head
      puffs.push({ dx: -1.65, dy: 0.78, dz: 0.1, sx: 1.45, sy: 1.25, sz: 1.3, atlasIndex: 0, density: 0.94, heightRel: 0.45, rotation: -0.2 })
      // Subtle ear-like billow mounds
      puffs.push({ dx: -1.85, dy: 1.25, dz: 0.12, sx: 0.85, sy: 0.82, sz: 0.85, atlasIndex: 0, density: 0.88, heightRel: 0.72, rotation: 0.3 })
      puffs.push({ dx: -1.35, dy: 1.32, dz: 0.05, sx: 0.82, sy: 0.8, sz: 0.82, atlasIndex: 0, density: 0.88, heightRel: 0.75, rotation: -0.2 })

      // Curled resting tail wisp
      puffs.push({ dx: 2.15, dy: 0.52, dz: 0.1, sx: 1.35, sy: 0.75, sz: 1.1, atlasIndex: 3, density: 0.65, heightRel: 0.32, rotation: -0.28 })
      puffs.push({ dx: -2.0, dy: 0.45, dz: 0.05, sx: 0.95, sy: 0.7, sz: 0.9, atlasIndex: 3, density: 0.5, heightRel: 0.28, rotation: 0.15 })
      puffs.push({ dx: 0.2, dy: 1.45, dz: -0.1, sx: 1.1, sy: 0.8, sz: 1.0, atlasIndex: 3, density: 0.48, heightRel: 0.78, rotation: -0.1 })

      // Breakup & vapor fringes
      for (let p = 0; p < 6; p++) {
        puffs.push({
          dx: (rng() - 0.5) * 2.8,
          dy: 0.5 + rng() * 0.8,
          dz: (rng() - 0.5) * 0.65,
          sx: 0.85 + rng() * 0.35,
          sy: 0.75 + rng() * 0.3,
          sz: 0.85 + rng() * 0.3,
          atlasIndex: 1,
          density: 0.7 + rng() * 0.18,
          heightRel: 0.4,
          rotation: rng() * Math.PI * 2,
        })
      }
    } else {
      // --------------------------------------------------------------------
      // NATURAL CUMULUS FORMATIONS (Congestus, Mediocris, Humilis, Puffs)
      // Genuine cauliflower anatomy:
      // 1. Horizontal Flat Condensation Base Shelf (LCL)
      // 2. Unified central dominant body mass
      // 3. Asymmetric rising cauliflower turrets
      // 4. Perimeter breakup & erosion nodules
      // 5. Feathered boundary vapor fringes
      // --------------------------------------------------------------------
      const isCongestus = item.archetype === "cumulus_congestus"
      const isHumilis = item.archetype === "cumulus_humilis"
      const isPuff = item.archetype === "cumulus_puff"

      const widthSpread = isHumilis ? 2.2 : isCongestus ? 1.6 : 1.85
      const verticalBoost = isCongestus ? 1.85 : isHumilis ? 0.85 : 1.3

      // 1. Continuous Flat Condensation Base Shelf (LCL)
      const baseCount = isPuff ? 2 : isHumilis ? 5 : 4
      for (let b = 0; b < baseCount; b++) {
        const t = (b / (baseCount - 1 || 1) - 0.5) * widthSpread
        puffs.push({
          dx: t * 0.92 + (rng() - 0.5) * 0.15,
          dy: 0.12 + (rng() - 0.5) * 0.06,
          dz: (rng() - 0.5) * 0.5,
          sx: 1.65 + rng() * 0.4,
          sy: 0.72 + rng() * 0.15,
          sz: 1.35 + rng() * 0.3,
          atlasIndex: 2, // flat base shelf
          density: 0.92 + rng() * 0.06,
          heightRel: 0.05,
          rotation: (rng() - 0.5) * 0.2,
        })
      }

      // 2. Central Dominant Body Mass (solid continuous volume)
      puffs.push({
        dx: (rng() - 0.5) * 0.2,
        dy: 0.72 * verticalBoost,
        dz: (rng() - 0.5) * 0.2,
        sx: 2.25 + rng() * 0.35,
        sy: 1.75 * verticalBoost,
        sz: 2.05 + rng() * 0.3,
        atlasIndex: 1,
        density: 0.98,
        heightRel: 0.38,
        rotation: rng() * Math.PI * 2,
      })
      if (!isPuff) {
        puffs.push({
          dx: (rng() - 0.5) * 0.65,
          dy: 0.62 * verticalBoost,
          dz: (rng() - 0.5) * 0.45,
          sx: 1.85 + rng() * 0.3,
          sy: 1.55 * verticalBoost,
          sz: 1.75 + rng() * 0.25,
          atlasIndex: 1,
          density: 0.95,
          heightRel: 0.34,
          rotation: rng() * Math.PI * 2,
        })
      }

      // 3. Asymmetric Cauliflower Turrets & Billowing Crowns
      const turretCount = isPuff ? 1 : isCongestus ? 7 : 5
      for (let tr = 0; tr < turretCount; tr++) {
        const u = (tr / turretCount) * Math.PI * 2 + rng() * 0.25
        const dist = 0.3 + rng() * (widthSpread * 0.4)
        const trH = (0.75 + rng() * 0.95) * verticalBoost
        puffs.push({
          dx: Math.cos(u) * dist + (rng() - 0.5) * 0.18,
          dy: trH,
          dz: Math.sin(u) * dist * 0.65 + (rng() - 0.5) * 0.18,
          sx: (1.4 + rng() * 0.4) * (1.0 - (trH / (2.2 * verticalBoost)) * 0.15),
          sy: (1.3 + rng() * 0.35) * (isCongestus ? 1.15 : 0.95),
          sz: 1.3 + rng() * 0.3,
          atlasIndex: tr % 2 === 0 ? 0 : 1,
          density: 0.94 - trH * 0.05,
          heightRel: Math.min(1.0, trH / (1.8 * verticalBoost)),
          rotation: rng() * Math.PI * 2,
        })
      }

      // 4. Perimeter Cauliflower Breakup & Erosion Lobes
      const erosionCount = isPuff ? 2 : isCongestus ? 9 : 6
      for (let er = 0; er < erosionCount; er++) {
        const u = rng() * Math.PI * 2
        const rDist = 0.75 + rng() * (widthSpread * 0.5)
        const erY = (0.35 + rng() * 1.15) * verticalBoost
        puffs.push({
          dx: Math.cos(u) * rDist,
          dy: erY,
          dz: Math.sin(u) * rDist * 0.65,
          sx: 0.9 + rng() * 0.4,
          sy: 0.8 + rng() * 0.35,
          sz: 0.9 + rng() * 0.35,
          atlasIndex: er % 3 === 0 ? 0 : 1,
          density: 0.78 + rng() * 0.18,
          heightRel: erY / (1.8 * verticalBoost),
          rotation: rng() * Math.PI * 2,
        })
      }

      // 5. Feathered Boundary Vapor Fringes
      const vaporCount = isPuff ? 2 : 5
      for (let vp = 0; vp < vaporCount; vp++) {
        const u = rng() * Math.PI * 2
        const vDist = 1.05 + rng() * (widthSpread * 0.5)
        const vpY = (0.3 + rng() * 0.95) * verticalBoost
        puffs.push({
          dx: Math.cos(u) * vDist,
          dy: vpY,
          dz: Math.sin(u) * vDist * 0.7,
          sx: 0.8 + rng() * 0.35,
          sy: 0.7 + rng() * 0.3,
          sz: 0.8 + rng() * 0.35,
          atlasIndex: 3, // wispy vapor
          density: 0.45 + rng() * 0.2,
          heightRel: vpY / (1.8 * verticalBoost),
          rotation: rng() * Math.PI * 2,
        })
      }
    }

    formations.push({
      id: i,
      archetype: item.archetype,
      x,
      y,
      z,
      scale,
      puffs,
    })
  }

  // ------------------------------------------------------------------------
  // HIGH-ALTITUDE CIRRUS WISPS
  // Wind-sheared, delicate, fibrous mares' tails high in the troposphere.
  // ------------------------------------------------------------------------
  const cirrus: CirrusDef[] = []
  const cirrusCount = 8
  for (let c = 0; c < cirrusCount; c++) {
    const angle = (c / cirrusCount) * Math.PI * 2 + (rng() - 0.5) * 0.4
    const radius = 35 + rng() * 55
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    const y =
      CLOUD_CONFIG.cirrusAltitude +
      (rng() - 0.5) * CLOUD_CONFIG.cirrusAltitudeSpread

    cirrus.push({
      id: c,
      x,
      y,
      z,
      length: 32.0 + rng() * 22.0,
      height: 6.0 + rng() * 3.5,
      rotation: angle + Math.PI * 0.5 + (rng() - 0.5) * 0.25,
      opacity: 0.42 + rng() * 0.26,
    })
  }

  return { cumulus: formations, cirrus }
}

/**
 * GLSL Vertex Shader for Instanced Cumulus Clouds.
 * Features:
 * - Spherical puff billboarding towards camera using viewMatrix basis vectors.
 * - Outward-pointing macro formation normal for cohesive 3D volume lighting.
 * - Dynamic seamless toroidal horizontal wind advection across square sky domain.
 * - Horizon boundary distance fade to guarantee zero-popping wrap transitions.
 * - Near-camera softness to prevent abrupt clipping when moving close to clouds.
 */
const CUMULUS_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aPuffOffset;  // Local offset of puff within formation (dx, dy, dz)
  attribute vec3 aPuffScale;   // Local scale of puff (sx, sy, sz)
  attribute vec4 aPuffParams;  // x: atlasIndex, y: density, z: heightRel, w: rotation
  attribute vec4 aCloudCenter; // xyz: formation center, w: formation scale

  uniform vec2 uWindOffset;
  uniform vec2 uDomainCenter;
  uniform float uAltitude;
  uniform float uDomainRadius;
  uniform float uTime;
  uniform float uClear;

  varying vec2 vUv;
  varying vec2 vAtlasUv;
  varying vec3 vWorldPos;
  varying vec3 vMacroNormal;
  varying float vDensity;
  varying float vHeightRel;
  varying float vDistanceFade;

  void main() {
    vUv = uv;

    float atlasIdx = aPuffParams.x;
    float density  = aPuffParams.y;
    float heightRel = aPuffParams.z;
    float rot      = aPuffParams.w;

    // Map [0, 1] UV to 2x2 atlas quadrant
    vec2 quadBase = vec2(
      mod(atlasIdx, 2.0) * 0.5,
      atlasIdx >= 2.0 ? 0.0 : 0.5
    );
    vAtlasUv = quadBase + uv * 0.5;
    vDensity = density;
    vHeightRel = heightRel;

    // Seamless toroidal wrap across square sky domain [-R, R] x [-R, R]
    float diam = uDomainRadius * 2.0;
    vec2 p = aCloudCenter.xz + uWindOffset - uDomainCenter;
    p.x = mod(p.x + uDomainRadius, diam) - uDomainRadius;
    p.y = mod(p.y + uDomainRadius, diam) - uDomainRadius;
    vec2 rel = p;
    vec3 formCenter = vec3(p.x + uDomainCenter.x, aCloudCenter.y + uAltitude, p.y + uDomainCenter.y);

    // Extremely subtle organic breathing phase modulation
    float breathe = 1.0 + sin(uTime * 0.04 + aPuffOffset.x * 1.6 + aPuffOffset.y * 2.0) * 0.016;

    // Puff center in world coordinates
    vec3 puffOffset = aPuffOffset * aCloudCenter.w;
    vec3 puffCenter = formCenter + puffOffset;

    // Local billboard quad vertices
    vec2 localQuad = position.xy;

    float cosR = cos(rot);
    float sinR = sin(rot);
    vec2 rotatedQuad = vec2(
      localQuad.x * cosR - localQuad.y * sinR,
      localQuad.x * sinR + localQuad.y * cosR
    );

    rotatedQuad *= aPuffScale.xy * aCloudCenter.w * breathe;

    // Camera billboard basis vectors
    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);

    vec3 worldPos = puffCenter + camRight * rotatedQuad.x + camUp * rotatedQuad.y;
    vWorldPos = worldPos;

    // Macro normal: vector pointing outward from the cloud formation center of mass
    // Gives all overlapping puffs cohesive 3D volume lighting as one unified entity!
    // NOTE: uses formation-space offset only (no billboard corner offset) so lighting
    // stays stable when the camera moves instead of swimming with view.
    vec3 macroDisp = puffOffset;
    macroDisp.y *= 1.35; // boost vertical dome curvature
    vMacroNormal = normalize(macroDisp + vec3(0.0, 0.12, 0.0));

    // Seamless boundary distance fade: fades smoothly to 0.0 over 22m near any domain edge
    float edgeDistX = uDomainRadius - abs(rel.x);
    float edgeDistZ = uDomainRadius - abs(rel.y);
    float edgeDist  = min(edgeDistX, edgeDistZ);
    float horizonFade = smoothstep(0.0, 60.0, edgeDist);

    // Near camera softness
    float distToCam = length(cameraPosition - worldPos);
    // Flying through a cloud, the puffs round the lens part into a soft
    // tunnel (uClear eases up as the view enters cloud): wisps stream past
    // at its edge, but the whole screen never flashes white and back with
    // every layer she climbs through
    float camFade = smoothstep(4.0 + 26.0 * uClear, 12.0 + 62.0 * uClear, distToCam);

    vDistanceFade = horizonFade * camFade;

    gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
  }
`

/**
 * GLSL Fragment Shader for Instanced Cumulus Clouds.
 * Features:
 * - Unified surface normal blending macro formation volume with micro cauliflower curvature.
 * - Soft Half-Lambert volumetric light transmission (porous vapor scattering).
 * - Mie forward-scattering (radiant silver-lining) along sun-facing contours.
 * - Dynamic diurnal scene response: golden sunrise/sunset, crisp daylight, and moonlit indigo.
 * - Buoyant ambient ground & horizon bounce illuminating cloud undersides without murky mud.
 */
const CUMULUS_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uPuffAtlas;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunIntensity;
  uniform vec3 uSkyTopColor;
  uniform vec3 uSkyBottomColor;
  uniform vec3 uAmbientColor;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uWeatherCloud;
  uniform float uWeatherRain;
  uniform float uHomeSky;

  varying vec2 vUv;
  varying vec2 vAtlasUv;
  varying vec3 vWorldPos;
  varying vec3 vMacroNormal;
  varying float vDensity;
  varying float vHeightRel;
  varying float vDistanceFade;

  void main() {
    vec4 texSample = texture2D(uPuffAtlas, vAtlasUv);
    float puffAlpha = texSample.a;
    if (puffAlpha < 0.005) discard;

    // Normalized coordinate within puff disc [-1, 1]
    vec2 p = vUv * 2.0 - 1.0;
    float r2 = dot(p, p);
    float nz = sqrt(max(0.0, 1.0 - clamp(r2, 0.0, 1.0)));

    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 camDir   = normalize(vWorldPos - cameraPosition);

    // 1. Micro normal from billboard disc curvature
    vec3 N_micro = normalize(camRight * p.x + camUp * p.y - camDir * nz);

    // 2. Composite Unified Normal:
    // Blend macro formation normal (62%) with micro cauliflower normal (38%)
    // This produces continuous 3D volume lighting across all overlapping billows!
    vec3 N = normalize(mix(N_micro, vMacroNormal, 0.62));

    // 3. Volumetric Sunlight Wrap Transmission (Half-Lambert)
    vec3 L = normalize(uSunDir);
    vec3 V = -camDir;

    float NdotL = dot(N, L);
    float wrapLight = clamp((NdotL + 0.46) / 1.46, 0.0, 1.0);

    // Direct sun contribution based on height in the cloud
    float heightSunFactor = smoothstep(0.05, 0.82, vHeightRel);
    float directSun = wrapLight * (0.32 + 0.68 * heightSunFactor);

    // 4. Cauliflower Crown Highlight
    float crownHighlight = pow(max(0.0, NdotL), 3.0) * heightSunFactor * 0.42;

    // 5. Mie Forward-Scattering (Silver Lining)
    float VdotL = dot(V, L);
    float forwardScatter = pow(max(0.0, VdotL), 4.2);
    float edgeThinness = pow(clamp(1.0 - nz, 0.0, 1.0), 1.8) * (1.0 - vDensity * 0.35);
    float silverLining = forwardScatter * edgeThinness * uSunIntensity * 0.95 * (0.35 + 0.65 * heightSunFactor);

    // 6. Ambient Shadow & Ground/Sky Bounce Palette
    // Cloud undersides receive warm terrain/ocean ambient bounce and lower horizon sky
    vec3 baseShadow = mix(uSkyBottomColor * 0.88, uAmbientColor * 0.95, 0.45);
    // Upper shaded crevices receive cooler zenith sky ambient
    vec3 upperShadow = mix(baseShadow, uSkyTopColor * 0.82, 0.38);
    vec3 shadowColor = mix(baseShadow, upperShadow, smoothstep(0.0, 0.7, vHeightRel));

    // 7. Sunlit Palette
    vec3 sunlitColor = mix(vec3(0.99, 0.99, 1.0), uSunColor, 0.75) * uSunIntensity;
    sunlitColor += uSunColor * (silverLining + crownHighlight * uSunIntensity);

    // 8. Composite Cloud Color
    vec3 cloudColor = mix(shadowColor, sunlitColor, directSun);

    // Weather response: overcast / storm diffusion
    float storm = max(uWeatherCloud * 0.45, uWeatherRain * 0.65);
    cloudColor *= 1.0 - storm * 0.32;

    // 9. Alpha & Distance/Atmospheric Integration
    float finalAlpha = puffAlpha * vDensity * vDistanceFade;

    // Atmospheric Fog Integration
    float dist = length(vWorldPos - cameraPosition);
    float fogFactor = smoothstep(uFogNear, uFogFar, dist);
    cloudColor = mix(cloudColor, uFogColor, fogFactor * 0.78);
    finalAlpha *= (1.0 - fogFactor * 0.55);

    if (finalAlpha < 0.006) discard;

    gl_FragColor = vec4(cloudColor, finalAlpha * uHomeSky);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/**
 * GLSL Vertex Shader for High-Altitude Cirrus Wisps.
 */
const CIRRUS_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aCirrusPos;
  attribute vec2 aCirrusScale; // length, height
  attribute vec2 aCirrusParams; // rotation, opacity

  uniform vec2 uCirrusWindOffset;
  uniform vec2 uDomainCenter;
  uniform float uAltitude;
  uniform float uDomainRadius;

  varying vec2 vUv;
  varying float vOpacity;
  varying vec3 vWorldPos;
  varying float vDistanceFade;

  vec3 wrapPosition(vec3 baseCenter, vec2 wind, float R) {
    float diam = R * 2.0;
    vec2 p = baseCenter.xz + wind - uDomainCenter;
    p.x = mod(p.x + R, diam) - R;
    p.y = mod(p.y + R, diam) - R;
    return vec3(p.x + uDomainCenter.x, baseCenter.y + uAltitude, p.y + uDomainCenter.y);
  }

  void main() {
    vUv = uv;
    vOpacity = aCirrusParams.y;

    vec3 center = wrapPosition(aCirrusPos, uCirrusWindOffset, uDomainRadius);

    float rot = aCirrusParams.x;
    float cosR = cos(rot);
    float sinR = sin(rot);

    vec2 local = position.xy * aCirrusScale;
    vec2 rotated = vec2(
      local.x * cosR - local.y * sinR,
      local.x * sinR + local.y * cosR
    );

    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);

    vec3 worldPos = center + camRight * rotated.x + camUp * rotated.y;
    vWorldPos = worldPos;

    float edgeDistX = uDomainRadius - abs(center.x - uDomainCenter.x);
    float edgeDistZ = uDomainRadius - abs(center.z - uDomainCenter.y);
    float edgeDist  = min(edgeDistX, edgeDistZ);
    vDistanceFade = smoothstep(0.0, 24.0, edgeDist);

    gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
  }
`

/**
 * GLSL Fragment Shader for Cirrus Wisps.
 */
const CIRRUS_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uCirrusTexture;
  uniform vec3 uSunColor;
  uniform vec3 uSkyTopColor;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uWeatherCloud;
  uniform float uHomeSky;

  varying vec2 vUv;
  varying float vOpacity;
  varying vec3 vWorldPos;
  varying float vDistanceFade;

  void main() {
    vec4 tex = texture2D(uCirrusTexture, vUv);
    float alpha = tex.a * vOpacity * vDistanceFade;
    if (alpha < 0.005) discard;

    vec3 col = mix(uSkyTopColor * 1.15, uSunColor, 0.35);
    // Cirrus thins out when overcast/rainy instead of getting more opaque.
    alpha *= (1.0 - uWeatherCloud * 0.7);

    float dist = length(vWorldPos - cameraPosition);
    float fogFactor = smoothstep(uFogNear, uFogFar, dist);
    col = mix(col, uFogColor, fogFactor * 0.7);
    alpha *= (1.0 - fogFactor * 0.6);

    if (alpha < 0.006) discard;

    gl_FragColor = vec4(col, alpha * uHomeSky);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/**
 * Living atmospheric cloud system.
 * Replaces hard low-poly plastic spheres with high-performance instanced
 * volumetric billows, soft feathered cauliflower domes, flat cumulus bases,
 * authentic lighting, calm wind advection, and rare pareidolia formations.
 */
export const Clouds = (): React.ReactElement => {
  const { scene } = useThree()

  // Generate deterministic formations & high cirrus wisps once
  const { cumulus, cirrus } = useMemo(() => expandSky(), [])

  // Expose cloud formations for diagnostics & automated verification
  useEffect(() => {
    if (typeof window !== "undefined") {
      ;(window as unknown as { __worldClouds?: FormationDef[] }).__worldClouds = cumulus
    }
    cloudFieldRT.formations = cumulus
  }, [cumulus])

  // Procedural canvas textures (cached & deterministic, zero network dependency)
  const puffAtlas = useMemo(() => cloudPuffAtlasTexture(), [])
  const cirrusTexture = useMemo(() => cirrusWispTexture(), [])

  // Refs for InstancedMesh instances
  const cumulusInstRef = useRef<THREE.InstancedMesh>(null)
  const cirrusInstRef = useRef<THREE.InstancedMesh>(null)

  // Animated wind displacement vectors (persisted across frames without allocation)
  const windOffsetRef = useRef(new THREE.Vector2())
  const cirrusWindOffsetRef = useRef(new THREE.Vector2())

  // Pre-allocated math objects for useFrame lighting updates (zero per-frame allocations)
  const tmpSunColor = useMemo(() => new THREE.Color(), [])
  const tmpSunDir = useMemo(() => new THREE.Vector3(), [])
  const tmpSkyTop = useMemo(() => new THREE.Color(), [])
  const tmpSkyBottom = useMemo(() => new THREE.Color(), [])
  const tmpAmbient = useMemo(() => new THREE.Color(), [])
  const tmpFogColor = useMemo(() => new THREE.Color(), [])

  // Reduced motion preference detection
  const reducedMotionRef = useRef(false)
  const skyAltitude = useRef(0)
  /** the cumulus deck's lowest and highest puff, over its altitude (render metres) */
  const deckBand = useRef<[number, number] | null>(null)
  /** 0..1 how far the view is inside cloud, eased (the shader's uClear) */
  const clearRef = useRef(0)
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)")
    reducedMotionRef.current = q.matches
    const update = (e: MediaQueryListEvent): void => {
      reducedMotionRef.current = e.matches
    }
    q.addEventListener("change", update)
    return () => q.removeEventListener("change", update)
  }, [])

  // Total puff count across all cumulus formations
  const totalCumulusPuffs = useMemo(() => {
    return cumulus.reduce((acc, f) => acc + f.puffs.length, 0)
  }, [cumulus])

  // Cumulus Geometry & Buffer Attributes
  const cumulusGeometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1)

    const offsetArray = new Float32Array(totalCumulusPuffs * 3)
    const scaleArray = new Float32Array(totalCumulusPuffs * 3)
    const paramsArray = new Float32Array(totalCumulusPuffs * 4)
    const centerArray = new Float32Array(totalCumulusPuffs * 4)

    let ptr = 0
    for (const f of cumulus) {
      for (const p of f.puffs) {
        const i3 = ptr * 3
        const i4 = ptr * 4

        offsetArray[i3] = p.dx
        offsetArray[i3 + 1] = p.dy
        offsetArray[i3 + 2] = p.dz

        scaleArray[i3] = p.sx
        scaleArray[i3 + 1] = p.sy
        scaleArray[i3 + 2] = p.sz

        paramsArray[i4] = p.atlasIndex
        paramsArray[i4 + 1] = p.density
        paramsArray[i4 + 2] = p.heightRel
        paramsArray[i4 + 3] = p.rotation

        centerArray[i4] = f.x
        centerArray[i4 + 1] = f.y
        centerArray[i4 + 2] = f.z
        centerArray[i4 + 3] = f.scale

        ptr++
      }
    }

    geo.setAttribute("aPuffOffset", new THREE.InstancedBufferAttribute(offsetArray, 3))
    geo.setAttribute("aPuffScale", new THREE.InstancedBufferAttribute(scaleArray, 3))
    geo.setAttribute("aPuffParams", new THREE.InstancedBufferAttribute(paramsArray, 4))
    geo.setAttribute("aCloudCenter", new THREE.InstancedBufferAttribute(centerArray, 4))

    return geo
  }, [cumulus, totalCumulusPuffs])

  // Cirrus Geometry & Buffer Attributes
  const cirrusGeometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1)

    const posArray = new Float32Array(cirrus.length * 3)
    const scaleArray = new Float32Array(cirrus.length * 2)
    const paramsArray = new Float32Array(cirrus.length * 2)

    for (let i = 0; i < cirrus.length; i++) {
      const c = cirrus[i]
      posArray[i * 3] = c.x
      posArray[i * 3 + 1] = c.y
      posArray[i * 3 + 2] = c.z

      scaleArray[i * 2] = c.length
      scaleArray[i * 2 + 1] = c.height

      paramsArray[i * 2] = c.rotation
      paramsArray[i * 2 + 1] = c.opacity
    }

    geo.setAttribute("aCirrusPos", new THREE.InstancedBufferAttribute(posArray, 3))
    geo.setAttribute("aCirrusScale", new THREE.InstancedBufferAttribute(scaleArray, 2))
    geo.setAttribute("aCirrusParams", new THREE.InstancedBufferAttribute(paramsArray, 2))

    return geo
  }, [cirrus])

  // Cumulus Shader Material
  const cumulusMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uPuffAtlas: { value: puffAtlas },
          uHomeSky: homeSky.clouds,
          uWindOffset: { value: new THREE.Vector2() },
          uDomainCenter: { value: new THREE.Vector2() },
          uAltitude: { value: 0 },
          uDomainRadius: { value: CLOUD_CONFIG.domainRadius },
          uTime: { value: 0 },
          uClear: { value: 0 },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uSunColor: { value: new THREE.Color("#fff8ea") },
          uSunIntensity: { value: 1.0 },
          uSkyTopColor: { value: new THREE.Color("#5daee0") },
          uSkyBottomColor: { value: new THREE.Color("#c5e8f0") },
          uAmbientColor: { value: new THREE.Color("#d1e0ed") },
          uFogColor: { value: new THREE.Color("#c4e5ec") },
          uFogNear: { value: 55.0 },
          uFogFar: { value: 165.0 },
          uWeatherCloud: { value: 0.05 },
          uWeatherRain: { value: 0.0 },
        },
        vertexShader: CUMULUS_VERTEX_SHADER,
        fragmentShader: CUMULUS_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending,
      }),
    [puffAtlas],
  )

  // Cirrus Shader Material
  const cirrusMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uCirrusTexture: { value: cirrusTexture },
          uHomeSky: homeSky.clouds,
          uCirrusWindOffset: { value: new THREE.Vector2() },
          uDomainCenter: { value: new THREE.Vector2() },
          uAltitude: { value: 0 },
          uDomainRadius: { value: CLOUD_CONFIG.domainRadius },
          uSunColor: { value: new THREE.Color("#fff8ea") },
          uSkyTopColor: { value: new THREE.Color("#5daee0") },
          uFogColor: { value: new THREE.Color("#c4e5ec") },
          uFogNear: { value: 55.0 },
          uFogFar: { value: 165.0 },
          uWeatherCloud: { value: 0.05 },
        },
        vertexShader: CIRRUS_VERTEX_SHADER,
        fragmentShader: CIRRUS_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending,
      }),
    [cirrusTexture],
  )

  // Initialize identity instance matrices for InstancedMesh
  useEffect(() => {
    if (cumulusInstRef.current) {
      const dummy = new THREE.Object3D()
      for (let i = 0; i < totalCumulusPuffs; i++) {
        cumulusInstRef.current.setMatrixAt(i, dummy.matrix)
      }
      cumulusInstRef.current.instanceMatrix.needsUpdate = true
    }
    if (cirrusInstRef.current) {
      const dummy = new THREE.Object3D()
      for (let i = 0; i < cirrus.length; i++) {
        cirrusInstRef.current.setMatrixAt(i, dummy.matrix)
      }
      cirrusInstRef.current.instanceMatrix.needsUpdate = true
    }
  }, [totalCumulusPuffs, cirrus.length])

  // Animation & Dynamic Lighting Loop
  useFrame((state, rawDt) => {
    const dt = Math.min(Math.max(rawDt, 1e-4), 0.1)
    const t = state.clock.elapsedTime
    const motionFactor = reducedMotionRef.current ? 0.45 : 1.0

    // 1. Horizontal wind advection from the shared world wind (same air as grass, trees and rain)
    const windSpeed = windRT.strength + windRT.gust * 0.5
    const drift = (CLOUD_CONFIG.windSpeedMultiplier + windSpeed * 2.0) * motionFactor
    const windVx = windRT.dirX * drift
    const windVz = windRT.dirZ * drift
    const diam = CLOUD_CONFIG.domainRadius * 2
    windOffsetRef.current.x = (windOffsetRef.current.x + windVx * dt) % diam
    windOffsetRef.current.y = (windOffsetRef.current.y + windVz * dt) % diam
    cirrusWindOffsetRef.current.x = (cirrusWindOffsetRef.current.x + windVx * CLOUD_CONFIG.cirrusWindMultiplier * dt) % diam
    cirrusWindOffsetRef.current.y = (cirrusWindOffsetRef.current.y + windVz * CLOUD_CONFIG.cirrusWindMultiplier * dt) % diam
    // the sky domain follows the camera; clouds stay fixed in the world and
    // wrap invisibly at the faded edges, so the sky never runs out
    const camX = state.camera.position.x
    const camZ = state.camera.position.z
    // over Highvale the deck rides the mountains' mean surface, not each ridge
    // and gully under you (world/highvale/highvaleSky.ts cloudLift)
    const ax = avatarRT().pos.x, az = avatarRT().pos.z
    const mw = highvaleWeight(ax, az)
    const floor = mw > 0 ? THREE.MathUtils.lerp(groundHeight(ax, az), cloudLift(ax, az) / mw, mw) : groundHeight(ax, az)
    skyAltitude.current = THREE.MathUtils.damp(skyAltitude.current, floor, 0.5, dt)
    // logical → render: subtract the floating origin (wrapped)
    const ox = originRT.x % diam
    const oz = originRT.z % diam

    // 2. Synchronized Celestial Sun Direction & Optical Palette
    const tod = worldRT.timeOfDay
    const cloud = weatherRT.cloud
    const rain = weatherRT.rain

    keyLightDirection(tod, tmpSunDir)
    const night = nightBlend(tod)

    // Diurnal Lighting Transitions
    const golden =
      Math.max(0, 1 - Math.abs(tod - 0.72) * 3.2) * (1 - cloud * 0.65)
    const dusk = Math.max(0, (tod - 0.78) * 4)

    tmpSunColor.setRGB(1.0, 0.96 - golden * 0.16 - dusk * 0.38, 0.9 - golden * 0.42 - dusk * 0.35).lerp(moonCloudLight, night)
    const sunIntensity = skyLightLevel(tod, cloud, rain)

    // Continuous palettes avoid abrupt colour pops at 0.6, 0.8 and 0.88.
    const sunset = smoothstep(0.55, 0.76, tod)
    tmpSkyTop.copy(dayCloudTop).lerp(sunsetCloudTop, sunset)
    tmpSkyBottom.copy(dayCloudBase).lerp(sunsetCloudBase, sunset)
    tmpAmbient.copy(dayCloudAmbient).lerp(sunsetCloudAmbient, sunset)
    tmpSkyTop.lerp(nightCloudTop, night)
    tmpSkyBottom.lerp(nightCloudBase, night)
    tmpAmbient.lerp(nightCloudBase, night)

    // Read current scene fog if available
    let fogNear = 55.0
    let fogFar = 165.0
    if (scene.fog instanceof THREE.Fog) {
      tmpFogColor.copy(scene.fog.color)
      // the cloud deck keeps its own short fade: the clear-day haze now reaches
      // far beyond the edge of the cloud domain around the camera
      fogNear = Math.min(scene.fog.near, 70)
      fogFar = Math.min(scene.fog.far, 270)
    } else {
      tmpFogColor.copy(tmpSkyBottom)
    }

    // 3. Update Cumulus Material Uniforms directly via refs
    const cMat = cumulusMaterial
    cMat.uniforms.uWindOffset.value.set(windOffsetRef.current.x - ox, windOffsetRef.current.y - oz)
    cMat.uniforms.uDomainCenter.value.set(camX, camZ)
    cMat.uniforms.uAltitude.value = skyAltitude.current
    cloudFieldRT.wind.copy(cMat.uniforms.uWindOffset.value)
    cloudFieldRT.domain.copy(cMat.uniforms.uDomainCenter.value)
    cloudFieldRT.altitude = skyAltitude.current
    cMat.uniforms.uTime.value = t
    // the view inside (or about to enter) the cloud deck: a Pegasus is in a
    // puff, or the camera is within the deck's band of heights while aloft.
    // Eased in and out over about a second, so a climb through several
    // layers is one long soft passage, never a strobe of white and blue.
    if (deckBand.current === null && cloudFieldRT.formations.length) {
      let lo = Infinity, hi = -Infinity
      for (const f of cloudFieldRT.formations) for (const p of f.puffs) {
        lo = Math.min(lo, f.y + (p.dy - p.sy * 0.5) * f.scale)
        hi = Math.max(hi, f.y + (p.dy + p.sy * 0.5) * f.scale)
      }
      deckBand.current = [lo, hi]
    }
    const camY = state.camera.position.y - skyAltitude.current
    const band = deckBand.current
    const inBand = band ? smoothstep(band[0] - 25, band[0] + 5, camY) * (1 - smoothstep(band[1] - 5, band[1] + 25, camY)) : 0
    const aloft = smoothstep(25, 60, state.camera.position.y - groundHeight(camX + originRT.x, camZ + originRT.z))
    const clearWant = Math.max(cloudFieldRT.cover, inBand * aloft)
    clearRef.current += (clearWant - clearRef.current) * (1 - Math.exp(-dt * (clearWant > clearRef.current ? 2.2 : 0.9)))
    cMat.uniforms.uClear.value = clearRef.current
    cMat.uniforms.uSunDir.value.copy(tmpSunDir)
    cMat.uniforms.uSunColor.value.copy(tmpSunColor)
    cMat.uniforms.uSunIntensity.value = sunIntensity
    cMat.uniforms.uSkyTopColor.value.copy(tmpSkyTop)
    cMat.uniforms.uSkyBottomColor.value.copy(tmpSkyBottom)
    cMat.uniforms.uAmbientColor.value.copy(tmpAmbient)
    cMat.uniforms.uFogColor.value.copy(tmpFogColor)
    cMat.uniforms.uFogNear.value = fogNear
    cMat.uniforms.uFogFar.value = fogFar
    cMat.uniforms.uWeatherCloud.value = cloud
    cMat.uniforms.uWeatherRain.value = rain

    // 4. Update Cirrus Material Uniforms
    const cirMat = cirrusMaterial
    cirMat.uniforms.uCirrusWindOffset.value.set(cirrusWindOffsetRef.current.x - ox, cirrusWindOffsetRef.current.y - oz)
    cirMat.uniforms.uDomainCenter.value.set(camX, camZ)
    cirMat.uniforms.uAltitude.value = skyAltitude.current
    cirMat.uniforms.uSunColor.value.copy(tmpSunColor).multiplyScalar(sunIntensity)
    cirMat.uniforms.uSkyTopColor.value.copy(tmpSkyTop)
    cirMat.uniforms.uFogColor.value.copy(tmpFogColor)
    cirMat.uniforms.uFogNear.value = fogNear
    cirMat.uniforms.uFogFar.value = fogFar
    cirMat.uniforms.uWeatherCloud.value = cloud

    // Weather visibility: cumulus always present; cirrus hides in rain/overcast.
    // (Avoids renderOrder collision with SkyLife contrails at -3 by using -4.)
    if (cirrusInstRef.current) {
      cirrusInstRef.current.visible = rain < 0.6 && cloud < 0.85
    }
  })

  return (
    <group name="cloud-system">
      {/* High-Performance Instanced Cumulus Clouds (1 Single Draw Call for all billows!) */}
      <instancedMesh
        ref={cumulusInstRef}
        args={[cumulusGeometry, cumulusMaterial, totalCumulusPuffs]}
        frustumCulled={false}
        renderOrder={-2}
      />

      {/* High-Altitude Wind-Sheared Cirrus Wisps (1 Single Draw Call!) */}
      <instancedMesh
        ref={cirrusInstRef}
        args={[cirrusGeometry, cirrusMaterial, cirrus.length]}
        frustumCulled={false}
        renderOrder={-4}
      />
    </group>
  )
}
