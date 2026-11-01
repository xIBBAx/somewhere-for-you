import * as THREE from "three"
import { B, BIOME_COUNT, biomeWeights, lakeMask } from "../climate"
import { worldHeight } from "../terrain"
import { hash01 } from "../noise"

export type ButterflySpecies =
  | "monarch"
  | "swallowtail"
  | "morpho"
  | "pink"
  | "dusk_moth"

export type MicroSpecies = "bee" | "gnat"

export type InsectSlot = {
  id: number
  type: "butterfly" | "micro" | "firefly"
  active: boolean
  species: string
  color: THREE.Color
  cx: number
  cz: number
  x: number
  y: number
  z: number
  heading: number
  scale: number
  opacity: number
  speed: number
  radius: number
  yBase: number
  phase: number
  flutterPhase: number
  twinkleSpeed: number
}

export const BUTTERFLY_COLORS: Record<ButterflySpecies, string> = {
  monarch: "#ea580c",
  swallowtail: "#facc15",
  morpho: "#0284c7",
  pink: "#f472b6",
  dusk_moth: "#d6d3d1",
}

export const BUTTERFLY_COUNT = 20
export const MICRO_COUNT = 24
export const FIREFLY_COUNT = 36

export type InsectsSimState = {
  butterflies: InsectSlot[]
  micros: InsectSlot[]
  fireflies: InsectSlot[]
  stats: {
    butterflies: number
    moths: number
    bees: number
    gnats: number
    fireflies: number
    activeSpecies: string[]
  }
}

const _weightsScratch = new Float32Array(BIOME_COUNT)

export const createInsectsSimulation = (): InsectsSimState => {
  const butterflies: InsectSlot[] = []
  for (let i = 0; i < BUTTERFLY_COUNT; i++) {
    butterflies.push({
      id: i,
      type: "butterfly",
      active: false,
      species: "monarch",
      color: new THREE.Color(BUTTERFLY_COLORS.monarch),
      cx: 0,
      cz: 0,
      x: 0,
      y: -100,
      z: 0,
      heading: 0,
      scale: 0.85,
      opacity: 0,
      speed: 0.8,
      radius: 1.5,
      yBase: 0.7,
      phase: i * 1.618,
      flutterPhase: i * 0.9,
      twinkleSpeed: 0,
    })
  }

  const micros: InsectSlot[] = []
  for (let i = 0; i < MICRO_COUNT; i++) {
    micros.push({
      id: i,
      type: "micro",
      active: false,
      species: "bee",
      color: new THREE.Color("#eab308"),
      cx: 0,
      cz: 0,
      x: 0,
      y: -100,
      z: 0,
      heading: 0,
      scale: 0.7,
      opacity: 0,
      speed: 1.2,
      radius: 1.2,
      yBase: 0.5,
      phase: i * 1.618,
      flutterPhase: 0,
      twinkleSpeed: 0,
    })
  }

  const fireflies: InsectSlot[] = []
  for (let i = 0; i < FIREFLY_COUNT; i++) {
    fireflies.push({
      id: i,
      type: "firefly",
      active: false,
      species: "firefly",
      color: new THREE.Color("#ffe9a8"),
      cx: 0,
      cz: 0,
      x: 0,
      y: -100,
      z: 0,
      heading: 0,
      scale: 0.8,
      opacity: 0,
      speed: 0.5 + (i % 5) * 0.1,
      radius: 0.9 + (i % 4) * 0.4,
      yBase: 0.6 + (i % 6) * 0.25,
      phase: i * 1.3,
      flutterPhase: 0,
      twinkleSpeed: 1.2 + (i % 5) * 0.35,
    })
  }

  return {
    butterflies,
    micros,
    fireflies,
    stats: {
      butterflies: 0,
      moths: 0,
      bees: 0,
      gnats: 0,
      fireflies: 0,
      activeSpecies: [],
    },
  }
}

/** Check biome weights and environment conditions for butterflies and moths */
const getButterflyBiomeSuitability = (
  x: number,
  z: number,
  timeOfDay: number,
): { allowed: boolean; species: ButterflySpecies } => {
  biomeWeights(x, z, _weightsScratch)
  const meadow = _weightsScratch[B.meadow]
  const flower = _weightsScratch[B.flowerMeadow]
  const gulmohar = _weightsScratch[B.gulmohar]
  const glade = _weightsScratch[B.glade]
  const forest = _weightsScratch[B.forest]
  const lake = lakeMask(x, z)
  if (lake > 0.4) return { allowed: false, species: "monarch" }

  const isDusk = timeOfDay >= 0.62 && timeOfDay <= 0.82
  const isDay = timeOfDay < 0.65

  if (isDusk && (glade > 0.2 || forest > 0.25 || meadow > 0.2)) {
    return { allowed: true, species: "dusk_moth" }
  }

  if (isDay && (flower > 0.15 || meadow > 0.25 || gulmohar > 0.2)) {
    const h = hash01(1234, Math.floor(x / 16), Math.floor(z / 16))
    if (gulmohar > 0.25 || h < 0.25) return { allowed: true, species: "pink" }
    if (flower > 0.25 || h < 0.5) return { allowed: true, species: "swallowtail" }
    if (h < 0.75) return { allowed: true, species: "morpho" }
    return { allowed: true, species: "monarch" }
  }

  return { allowed: false, species: "monarch" }
}

/** Step butterflies and moths */
const stepButterflies = (
  sim: InsectsSimState,
  _dt: number,
  time: number,
  playerX: number,
  playerZ: number,
  timeOfDay: number,
  rain: number,
): void => {
  // Rain suppresses flying insects
  const rainSuppressed = rain > 0.32

  for (let i = 0; i < BUTTERFLY_COUNT; i++) {
    const b = sim.butterflies[i]

    if (rainSuppressed) {
      b.active = false
      continue
    }

    const distToPlayer = Math.hypot(b.cx - playerX, b.cz - playerZ)

    // Recycle if inactive or moved too far (> 38m)
    if (!b.active || distToPlayer > 38 || distToPlayer < 2) {
      // Find candidate position in a ring around the player: 6m to 30m
      const cellAngle = (i / BUTTERFLY_COUNT) * Math.PI * 2 + (Math.floor(time * 0.1) % 10) * 0.1
      const cellRadius = 8 + (i % 6) * 3.5
      const candX = playerX + Math.cos(cellAngle) * cellRadius
      const candZ = playerZ + Math.sin(cellAngle) * cellRadius

      const suit = getButterflyBiomeSuitability(candX, candZ, timeOfDay)
      if (suit.allowed) {
        b.active = true
        b.species = suit.species
        b.color.set(BUTTERFLY_COLORS[suit.species])
        b.cx = candX
        b.cz = candZ
        b.phase = (i * 1.618) % (Math.PI * 2)
        b.speed = suit.species === "dusk_moth" ? 0.65 : 0.85 + (i % 4) * 0.12
        b.radius = 1.0 + (i % 3) * 0.6
        b.yBase = 0.55 + (i % 5) * 0.18
      } else {
        b.active = false
        continue
      }
    }

    // Erratic flutter flight
    const ang = time * b.speed + b.phase
    const flutterX = Math.sin(time * 7.5 + b.phase) * 0.12
    const flutterZ = Math.cos(time * 6.8 + b.phase) * 0.12
    const prevX = b.x
    const prevZ = b.z

    b.x = b.cx + Math.cos(ang) * b.radius + flutterX
    b.z = b.cz + Math.sin(ang * 0.85) * b.radius * 0.9 + flutterZ
    b.y = worldHeight(b.x, b.z) + b.yBase + Math.sin(time * 3.8 + b.phase) * 0.16

    const dx = b.x - prevX
    const dz = b.z - prevZ
    if (Math.hypot(dx, dz) > 1e-4) {
      b.heading = Math.atan2(dx, dz)
    }
  }
}

/** Step micro-insects: bees in meadows, gnats in forest light shafts */
const stepMicros = (
  sim: InsectsSimState,
  _dt: number,
  time: number,
  playerX: number,
  playerZ: number,
  timeOfDay: number,
  rain: number,
): void => {
  const rainSuppressed = rain > 0.3

  // Low sun angle (morning 0.1-0.28, evening 0.58-0.74) for glinting forest gnats
  const isLowSun = (timeOfDay >= 0.1 && timeOfDay <= 0.28) || (timeOfDay >= 0.58 && timeOfDay <= 0.74)
  const isDay = timeOfDay < 0.68

  for (let i = 0; i < MICRO_COUNT; i++) {
    const m = sim.micros[i]

    if (rainSuppressed) {
      m.active = false
      continue
    }

    const distToPlayer = Math.hypot(m.cx - playerX, m.cz - playerZ)

    if (!m.active || distToPlayer > 36) {
      const ang = (i / MICRO_COUNT) * Math.PI * 2
      const rad = 7 + (i % 6) * 3.8
      const candX = playerX + Math.cos(ang) * rad
      const candZ = playerZ + Math.sin(ang) * rad

      biomeWeights(candX, candZ, _weightsScratch)
      const meadow = _weightsScratch[B.meadow]
      const flower = _weightsScratch[B.flowerMeadow]
      const forest = _weightsScratch[B.forest]
      const glade = _weightsScratch[B.glade]
      const pine = _weightsScratch[B.pine]

      if (isLowSun && (forest > 0.3 || glade > 0.25 || pine > 0.3)) {
        // Gnat pillar
        m.active = true
        m.species = "gnat"
        m.color.set("#fef08a") // glinting sunbeam gold
        m.cx = candX
        m.cz = candZ
        m.scale = 0.55
        m.yBase = 1.2 + (i % 5) * 0.3
        m.radius = 0.4 + (i % 3) * 0.25
        m.speed = 1.8 + (i % 4) * 0.3
      } else if (isDay && (flower > 0.18 || meadow > 0.28)) {
        // Bee
        m.active = true
        m.species = "bee"
        m.color.set("#eab308") // warm amber yellow
        m.cx = candX
        m.cz = candZ
        m.scale = 0.72
        m.yBase = 0.4 + (i % 4) * 0.15
        m.radius = 1.4 + (i % 3) * 0.5
        m.speed = 1.3 + (i % 3) * 0.2
      } else {
        m.active = false
        continue
      }
    }

    if (m.species === "gnat") {
      // Hovering dancing pillar of gnats
      m.x = m.cx + Math.sin(time * m.speed + m.phase) * m.radius
      m.z = m.cz + Math.cos(time * m.speed * 0.9 + m.phase) * m.radius
      m.y = worldHeight(m.cx, m.cz) + m.yBase + Math.sin(time * 3.5 + m.phase * 2) * 0.35
      m.heading = time * 2.0
    } else {
      // Honeybee darting between blossoms
      const ang = time * m.speed + m.phase
      m.x = m.cx + Math.cos(ang) * m.radius + Math.sin(time * 8.0) * 0.05
      m.z = m.cz + Math.sin(ang * 1.2) * m.radius * 0.8 + Math.cos(time * 8.0) * 0.05
      m.y = worldHeight(m.x, m.z) + m.yBase + Math.sin(time * 6.0) * 0.06
      m.heading = ang + Math.PI * 0.5
    }
  }
}

/** Step glowing night fireflies */
const stepFireflies = (
  sim: InsectsSimState,
  _dt: number,
  time: number,
  playerX: number,
  playerZ: number,
  timeOfDay: number,
  rain: number,
): void => {
  // Fireflies appear at night: tod > 0.68, suppressed by rain
  const isNight = timeOfDay > 0.68
  const rainSuppressed = rain > 0.22

  if (!isNight || rainSuppressed) {
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      sim.fireflies[i].active = false
    }
    return
  }

  // Smooth night intensity (higher at full night)
  const nightIntensity = Math.min(1.0, (timeOfDay - 0.68) / 0.18)

  for (let i = 0; i < FIREFLY_COUNT; i++) {
    const f = sim.fireflies[i]
    const distToPlayer = Math.hypot(f.cx - playerX, f.cz - playerZ)

    if (!f.active || distToPlayer > 40) {
      const ang = (i / FIREFLY_COUNT) * Math.PI * 2 + (i % 3) * 0.4
      const rad = 6 + (i % 7) * 4.2
      const candX = playerX + Math.cos(ang) * rad
      const candZ = playerZ + Math.sin(ang) * rad

      biomeWeights(candX, candZ, _weightsScratch)
      const meadow = _weightsScratch[B.meadow]
      const flower = _weightsScratch[B.flowerMeadow]
      const glade = _weightsScratch[B.glade]
      const lake = lakeMask(candX, candZ)

      // Fireflies thrive in glades, meadows, and near water
      if (glade > 0.15 || meadow > 0.2 || flower > 0.15 || lake > 0.1) {
        f.active = true
        f.cx = candX
        f.cz = candZ
        f.phase = (i * 1.618) % (Math.PI * 2)
        f.yBase = 0.5 + (i % 5) * 0.35
        f.radius = 0.8 + (i % 4) * 0.4
        f.speed = 0.45 + (i % 4) * 0.1
        f.twinkleSpeed = 1.4 + (i % 4) * 0.4
      } else {
        f.active = false
        continue
      }
    }

    // Slow drifting hover with gentle vertical rise and twinkle
    const ang = time * f.speed + f.phase
    f.x = f.cx + Math.cos(ang) * f.radius
    f.z = f.cz + Math.sin(ang * 0.85) * f.radius * 0.95
    f.y = worldHeight(f.x, f.z) + f.yBase + Math.sin(time * 1.5 + f.phase) * 0.28

    // Twinkling pulse
    const pulse = 0.4 + Math.sin(time * f.twinkleSpeed + f.phase) * 0.45
    f.scale = Math.max(0.1, (0.6 + pulse * 0.6) * nightIntensity)
  }
}

/** Step all insect simulations */
export const stepInsectsSimulation = (
  sim: InsectsSimState,
  dt: number,
  time: number,
  playerX: number,
  playerZ: number,
  timeOfDay: number,
  rain: number,
): void => {
  stepButterflies(sim, dt, time, playerX, playerZ, timeOfDay, rain)
  stepMicros(sim, dt, time, playerX, playerZ, timeOfDay, rain)
  stepFireflies(sim, dt, time, playerX, playerZ, timeOfDay, rain)

  // Diagnostics
  let bCount = 0
  let mCount = 0
  let beeCount = 0
  let gnatCount = 0
  let fCount = 0
  const speciesSet = new Set<string>()

  for (const b of sim.butterflies) {
    if (b.active) {
      if (b.species === "dusk_moth") mCount++
      else bCount++
      speciesSet.add(b.species)
    }
  }

  for (const m of sim.micros) {
    if (m.active) {
      if (m.species === "bee") beeCount++
      else gnatCount++
      speciesSet.add(m.species)
    }
  }

  for (const f of sim.fireflies) {
    if (f.active) {
      fCount++
      speciesSet.add("firefly")
    }
  }

  sim.stats.butterflies = bCount
  sim.stats.moths = mCount
  sim.stats.bees = beeCount
  sim.stats.gnats = gnatCount
  sim.stats.fireflies = fCount
  sim.stats.activeSpecies = Array.from(speciesSet)
}
