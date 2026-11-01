import type { FlightPoint } from "./primitives"
import type { FlyingSpecies, FoodKind } from "./species"

export type FlightWeather = {
  /** World-space velocity toward which the air travels (not meteorological FROM direction). */
  wind: FlightPoint
  gust: number
  rain: number
  snow: number
  fog: number
  storm: boolean
  temperatureC: number | null
  daylight: number
  solarPhase: "dawn" | "day" | "dusk" | "night"
}

export type FlightThreat = {
  id: string
  kind: "player" | "cat" | "other-animal"
  position: FlightPoint
  velocity: FlightPoint
  radius: number
}

/** Resolves the actual support including any shader wind, into reusable output. */
export type PerchSample = {
  position: FlightPoint
  normal: FlightPoint
  tangent: FlightPoint
  velocity: FlightPoint
  radius: number
  shelter: number
  valid: boolean
}

export type FlightSupport = {
  id: string
  kind: "branch" | "rock" | "structure" | "stem" | "ground" | "nest"
  nestType?: "cup" | "cavity"
  /** Conservative broad-phase point; resolve() is authoritative for attachment. */
  position: FlightPoint
  allowed: readonly FlyingSpecies[] | null
  resolve: (time: number, out: PerchSample) => void
}

export type FlightResource = {
  id: string
  kind: FoodKind | "water" | "nest"
  supportId: string
  position: FlightPoint
  capacity: number
  /** Regenerating availability, not deletion/recreation of an animal or mesh. */
  availability: number
}

export type FlightObstacle =
  | { id: string; kind: "capsule"; a: FlightPoint; b: FlightPoint; radius: number }
  | { id: string; kind: "box"; min: FlightPoint; max: FlightPoint }

export type FlightEnvironment = {
  weather: FlightWeather
  threats: readonly FlightThreat[]
  supports: readonly FlightSupport[]
  resources: readonly FlightResource[]
  ground: (x: number, z: number) => number
  water: (x: number, z: number) => number | null
  /** Spatial broad phase supplied by the world adapter; writes indices into output. */
  obstaclesNear: (point: FlightPoint, radius: number, output: Int32Array) => number
  obstacles: readonly FlightObstacle[]
  habitatCenter: FlightPoint
  habitatRadius: number
}
