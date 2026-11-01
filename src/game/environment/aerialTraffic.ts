import * as THREE from "three"

export type AircraftType =
  | "commercial_jet"
  | "regional_turboprop"
  | "cargo_transport"
  | "business_jet"
  | "small_propeller"
  | "helicopter"
  | "glider"

export type AircraftDefinition = {
  type: AircraftType
  name: string
  category: "heavy_jet" | "turboprop" | "cargo" | "business_jet" | "light_prop" | "rotorcraft" | "glider"
  altitudeRange: [number, number] // [min, max] in world meters
  speedRange: [number, number] // [min, max] in world meters/sec
  transitDuration: [number, number] // [min, max] in seconds
  contrailEligible: boolean
  minContrailAltitude: number
  engineOffsets: Array<{ x: number; y: number; z: number }>
  spawnWeight: number // relative probability weight
  hasSpinningProp: boolean
  hasRotor: boolean
  audioProfile: "distant_jet" | "turboprop_hum" | "cargo_rumble" | "light_prop" | "rotor_rhythm" | "silent"
  maxAudioVolume: number
  weatherLimits: {
    maxRain: number
    maxCloud: number
    allowThunder: boolean
  }
}

export const AIRCRAFT_DEFINITIONS: Record<AircraftType, AircraftDefinition> = {
  commercial_jet: {
    type: "commercial_jet",
    name: "Airliner (Twin-Turbofan Jet)",
    category: "heavy_jet",
    altitudeRange: [52, 60],
    speedRange: [4.6, 5.4],
    transitDuration: [50, 58],
    contrailEligible: true,
    minContrailAltitude: 50,
    engineOffsets: [
      { x: -1.15, y: -0.22, z: -0.45 },
      { x: 1.15, y: -0.22, z: -0.45 },
    ],
    spawnWeight: 0.3,
    hasSpinningProp: false,
    hasRotor: false,
    audioProfile: "distant_jet",
    maxAudioVolume: 0.035,
    weatherLimits: { maxRain: 0.5, maxCloud: 0.95, allowThunder: false },
  },
  regional_turboprop: {
    type: "regional_turboprop",
    name: "Regional Commuter (Twin-Turboprop)",
    category: "turboprop",
    altitudeRange: [38, 46],
    speedRange: [3.8, 4.4],
    transitDuration: [58, 68],
    contrailEligible: false,
    minContrailAltitude: 60,
    engineOffsets: [
      { x: -1.05, y: 0.12, z: 0.2 },
      { x: 1.05, y: 0.12, z: 0.2 },
    ],
    spawnWeight: 0.22,
    hasSpinningProp: true,
    hasRotor: false,
    audioProfile: "turboprop_hum",
    maxAudioVolume: 0.04,
    weatherLimits: { maxRain: 0.45, maxCloud: 0.9, allowThunder: false },
  },
  cargo_transport: {
    type: "cargo_transport",
    name: "Heavy Transport (Cargo Carrier)",
    category: "cargo",
    altitudeRange: [50, 58],
    speedRange: [4.2, 4.8],
    transitDuration: [54, 64],
    contrailEligible: true,
    minContrailAltitude: 48,
    engineOffsets: [
      { x: -1.35, y: 0.05, z: -0.3 },
      { x: 1.35, y: 0.05, z: -0.3 },
    ],
    spawnWeight: 0.16,
    hasSpinningProp: false,
    hasRotor: false,
    audioProfile: "cargo_rumble",
    maxAudioVolume: 0.045,
    weatherLimits: { maxRain: 0.55, maxCloud: 0.95, allowThunder: false },
  },
  business_jet: {
    type: "business_jet",
    name: "Executive Business Jet",
    category: "business_jet",
    altitudeRange: [46, 54],
    speedRange: [5.0, 5.8],
    transitDuration: [44, 52],
    contrailEligible: true,
    minContrailAltitude: 48,
    engineOffsets: [
      { x: -0.48, y: 0.18, z: -1.15 },
      { x: 0.48, y: 0.18, z: -1.15 },
    ],
    spawnWeight: 0.14,
    hasSpinningProp: false,
    hasRotor: false,
    audioProfile: "distant_jet",
    maxAudioVolume: 0.028,
    weatherLimits: { maxRain: 0.4, maxCloud: 0.9, allowThunder: false },
  },
  small_propeller: {
    type: "small_propeller",
    name: "Civilian Light Monoplane",
    category: "light_prop",
    altitudeRange: [25, 34],
    speedRange: [2.8, 3.4],
    transitDuration: [70, 85],
    contrailEligible: false,
    minContrailAltitude: 60,
    engineOffsets: [{ x: 0, y: 0.02, z: 0.85 }],
    spawnWeight: 0.1,
    hasSpinningProp: true,
    hasRotor: false,
    audioProfile: "light_prop",
    maxAudioVolume: 0.038,
    weatherLimits: { maxRain: 0.25, maxCloud: 0.8, allowThunder: false },
  },
  helicopter: {
    type: "helicopter",
    name: "Scenic Civilian Helicopter",
    category: "rotorcraft",
    altitudeRange: [18, 26],
    speedRange: [2.0, 2.6],
    transitDuration: [85, 110],
    contrailEligible: false,
    minContrailAltitude: 60,
    engineOffsets: [],
    spawnWeight: 0.05,
    hasSpinningProp: false,
    hasRotor: true,
    audioProfile: "rotor_rhythm",
    maxAudioVolume: 0.045,
    weatherLimits: { maxRain: 0.2, maxCloud: 0.75, allowThunder: false },
  },
  glider: {
    type: "glider",
    name: "Recreational Soaring Sailplane",
    category: "glider",
    altitudeRange: [30, 38],
    speedRange: [1.8, 2.4],
    transitDuration: [95, 125],
    contrailEligible: false,
    minContrailAltitude: 60,
    engineOffsets: [],
    spawnWeight: 0.03,
    hasSpinningProp: false,
    hasRotor: false,
    audioProfile: "silent",
    maxAudioVolume: 0.0,
    weatherLimits: { maxRain: 0.1, maxCloud: 0.65, allowThunder: false },
  },
}

export type CelestialFlightRoute = {
  id: string
  name: string
  start: [number, number]
  end: [number, number]
  arcPeak: number
  headingOffsetRad: number
}

// 8 Independent routes spanning the entire 360-degree celestial sky
export const CELESTIAL_ROUTES: CelestialFlightRoute[] = [
  { id: "nw_se", name: "Northwest to Southeast", start: [-125, -60], end: [125, 50], arcPeak: 3.5, headingOffsetRad: 0 },
  { id: "sw_ne", name: "Southwest to Northeast", start: [-110, 85], end: [115, -75], arcPeak: 4.0, headingOffsetRad: 0 },
  { id: "w_e", name: "West to East Trans-Island", start: [-130, -10], end: [130, 20], arcPeak: 3.0, headingOffsetRad: 0 },
  { id: "e_w", name: "East to West Northern Arc", start: [128, -50], end: [-128, -25], arcPeak: 3.2, headingOffsetRad: 0 },
  { id: "n_s", name: "North to South Celestial Meridian", start: [20, -130], end: [-15, 130], arcPeak: 3.8, headingOffsetRad: 0 },
  { id: "s_n", name: "South to North Meridian", start: [-35, 125], end: [45, -125], arcPeak: 3.6, headingOffsetRad: 0 },
  { id: "se_nw_diag", name: "Southeast to Northwest Diagonal", start: [110, 90], end: [-115, -85], arcPeak: 4.2, headingOffsetRad: 0 },
  { id: "scenic_south", name: "Distant Scenic Southern Horizon", start: [-120, 105], end: [120, 95], arcPeak: 2.2, headingOffsetRad: 0 },
]

export type ActiveAircraftInstance = {
  id: string
  type: AircraftType
  route: CelestialFlightRoute
  progress: number // 0.0 to 1.0
  duration: number // total seconds
  altitude: number
  arcHeight: number
  startPos: THREE.Vector3
  endPos: THREE.Vector3
  currentPos: THREE.Vector3
  currentRotation: THREE.Euler
  propellerAngle: number
  rotorAngle: number
  tailRotorAngle: number
  contrailHistory: Array<{ left: THREE.Vector3; right: THREE.Vector3; age: number }>
  audioGain: number
  colorTheme: {
    fuselage: string
    wings: string
    accent: string
    tail: string
  }
}

/** Palette liveries for believable variety without commercial branding */
export const CIVILIAN_LIVERIES: Record<
  AircraftType,
  Array<{ fuselage: string; wings: string; accent: string; tail: string }>
> = {
  commercial_jet: [
    { fuselage: "#f8fafc", wings: "#cbd5e1", accent: "#0284c7", tail: "#0369a1" }, // Azure Skyways
    { fuselage: "#ffffff", wings: "#e2e8f0", accent: "#e11d48", tail: "#be123c" }, // Rose Air
    { fuselage: "#f1f5f9", wings: "#94a3b8", accent: "#059669", tail: "#047857" }, // Emerald Line
    { fuselage: "#fffdfa", wings: "#cbd5e1", accent: "#d97706", tail: "#b45309" }, // Golden Horizon
  ],
  regional_turboprop: [
    { fuselage: "#f8fafc", wings: "#0d9488", accent: "#14b8a6", tail: "#0f766e" }, // Island Hopper Teal
    { fuselage: "#ffffff", wings: "#64748b", accent: "#f59e0b", tail: "#d97706" }, // Coastal Sun
    { fuselage: "#f1f5f9", wings: "#334155", accent: "#38bdf8", tail: "#0284c7" }, // Blue Peak Commuter
  ],
  cargo_transport: [
    { fuselage: "#e2e8f0", wings: "#64748b", accent: "#475569", tail: "#334155" }, // Universal Freight
    { fuselage: "#ffffff", wings: "#94a3b8", accent: "#ea580c", tail: "#c2410c" }, // Swift Cargo
  ],
  business_jet: [
    { fuselage: "#fdfefe", wings: "#cbd5e1", accent: "#e2b87f", tail: "#c59a58" }, // Champagne Pearl
    { fuselage: "#1e293b", wings: "#475569", accent: "#38bdf8", tail: "#0f172a" }, // Midnight Velvet
    { fuselage: "#f8fafc", wings: "#e2e8f0", accent: "#a855f7", tail: "#7e22ce" }, // Royal Violet
  ],
  small_propeller: [
    { fuselage: "#fef08a", wings: "#fef9c3", accent: "#ca8a04", tail: "#a16207" }, // Sunny Buttercup
    { fuselage: "#ffffff", wings: "#e0f2fe", accent: "#0284c7", tail: "#0369a1" }, // Sky Cruiser
    { fuselage: "#fed7aa", wings: "#fff7ed", accent: "#ea580c", tail: "#c2410c" }, // Peach Piper
    { fuselage: "#dcfce7", wings: "#f0fdf4", accent: "#16a34a", tail: "#15803d" }, // Meadow Grasshopper
  ],
  helicopter: [
    { fuselage: "#0284c7", wings: "#0369a1", accent: "#f8fafc", tail: "#075985" }, // Scenic Oceanic
    { fuselage: "#e11d48", wings: "#be123c", accent: "#ffffff", tail: "#9f1239" }, // Coast Patrol / Rescue
    { fuselage: "#f59e0b", wings: "#d97706", accent: "#1e293b", tail: "#b45309" }, // Golden Rotor
  ],
  glider: [
    { fuselage: "#ffffff", wings: "#e0f2fe", accent: "#38bdf8", tail: "#0284c7" }, // Cloud Soarer
    { fuselage: "#fffbeb", wings: "#fef3c7", accent: "#f59e0b", tail: "#d97706" }, // Thermal Breeze
  ],
}

/** Check if weather conditions allow aircraft of a given type to fly */
export const isAircraftWeatherPermitted = (
  type: AircraftType,
  weather: { rain: number; cloud: number; lightning?: number },
): boolean => {
  const def = AIRCRAFT_DEFINITIONS[type]
  if (!def) return false
  if (weather.rain > def.weatherLimits.maxRain) return false
  if (weather.cloud > def.weatherLimits.maxCloud) return false
  if (!def.weatherLimits.allowThunder && (weather.lightning ?? 0) > 0.05) return false
  return true
}

/** Select an aircraft type based on spawn weights and random roll */
export const selectRandomAircraftType = (
  randomRoll: number,
  weather: { rain: number; cloud: number; lightning?: number },
): AircraftType => {
  // Filter eligible types by weather
  const eligible = (Object.keys(AIRCRAFT_DEFINITIONS) as AircraftType[]).filter((t) =>
    isAircraftWeatherPermitted(t, weather),
  )

  if (eligible.length === 0) return "commercial_jet"

  const totalWeight = eligible.reduce((acc, t) => acc + AIRCRAFT_DEFINITIONS[t].spawnWeight, 0)
  let threshold = randomRoll * totalWeight

  for (const t of eligible) {
    threshold -= AIRCRAFT_DEFINITIONS[t].spawnWeight
    if (threshold <= 0) return t
  }
  return eligible[0]
}

/** Schedule initial delay (45–90s) and subsequent intervals (180–480s / 3–8 minutes) */
export const calculateNextSpawnInterval = (isFirstSpawn: boolean, randomValue = Math.random()): number => {
  if (isFirstSpawn) {
    // 45 to 90 seconds after gameplay begins
    return 45 + randomValue * 45
  }
  // 3 to 8 minutes (180s to 480s)
  return 180 + randomValue * 300
}

/** Calculate spatial audio volume based on horizontal distance to player and aircraft category */
export const calculateAircraftSpatialAudio = (
  aircraftPos: { x: number; y: number; z: number },
  playerPos: { x: number; y: number; z: number },
  maxVolume: number,
): number => {
  if (maxVolume <= 0) return 0
  const dx = aircraftPos.x - playerPos.x
  const dy = aircraftPos.y - playerPos.y
  const dz = aircraftPos.z - playerPos.z
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

  // Max audible range is ~110m
  if (dist > 110) return 0
  if (dist < 20) return maxVolume

  // Inverse distance falloff with atmospheric dampening
  const norm = (110 - dist) / 90
  return maxVolume * Math.pow(Math.max(0, norm), 1.5)
}
