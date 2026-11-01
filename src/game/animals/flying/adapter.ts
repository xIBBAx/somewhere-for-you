import { flightPoint, type FlightPoint } from "./primitives"
import { arrivalVelocity, integrateFlight } from "./locomotion"
import { FLYING_SPECIES, type FlyingSpecies } from "./species"
import { createFlightIndividual, setFlightMode, type FlightIndividual } from "./state"

/**
 * Thin bridge between the existing ecosystem agents (`AnimalAgent` in
 * `../ecosystem.ts`) and the bounded flight simulation.
 *
 * The ecosystem keeps owning decisions (goals, threats, cat chase, preferred
 * points). This adapter owns only physical smoothing + pose:
 * - ecosystem target position feeds `arrivalVelocity` (braking-distance)
 * - `integrateFlight` bounds acceleration/turn rate per species envelope
 * - render reads position + pose (heading/bank/pitch/wingPhase) — never raw snaps
 *
 * No THREE import here: the sim stays renderer-independent. Callers copy the
 * resulting FlightPoint into Object3D positions.
 */

export type EcosystemFlightKind = "sky-bird" | "butterfly" | "dragonfly" | "bee" | "firefly" | "ground-bird"

const SKY_ROTATION: FlyingSpecies[] = ["goldfinch", "robin", "sparrow", "bluebird"]

export function mapToFlightSpecies(kind: EcosystemFlightKind, index = 0, colorHint?: string): FlyingSpecies {
  switch (kind) {
    case "sky-bird":
    case "ground-bird":
      return SKY_ROTATION[Math.abs(index) % SKY_ROTATION.length]
    case "dragonfly":
      return "dragonfly"
    case "bee":
      return "honeybee"
    case "firefly":
      return "firefly"
    case "butterfly": {
      const c = (colorHint ?? "").toLowerCase()
      if (c.includes("38bdf8") || c.includes("blue")) return "morpho"
      if (c.includes("f97316") || c.includes("orange")) return "monarch"
      if (c.includes("facc15") || c.includes("yellow")) return "swallowtail"
      if (c.includes("f472b6") || c.includes("rose") || c.includes("pink")) return "rose-butterfly"
      if (c.includes("c084fc") || c.includes("a855f7") || c.includes("violet") || c.includes("purple")) return "violet-butterfly"
      if (c.includes("34d399") || c.includes("green")) return "green-butterfly"
      const fallbacks: FlyingSpecies[] = ["monarch", "swallowtail", "morpho", "rose-butterfly", "violet-butterfly", "green-butterfly"]
      return fallbacks[Math.abs(index) % fallbacks.length]
    }
  }
}

export function initialFlightMode(species: FlyingSpecies): FlightIndividual["mode"] {
  if (species === "dragonfly" || species === "honeybee") return "hover"
  return "powered"
}

/** Create a follower seeded deterministically from the ecosystem agent id. */
export function createFlightFollower(
  ecosystemId: string,
  species: FlyingSpecies,
  initial: FlightPoint,
): FlightIndividual {
  const flight = createFlightIndividual(`flight-${ecosystemId}`, species, initial)
  flight.mode = initialFlightMode(species)
  flight.pose.wingFold = 0
  flight.pose.feet = 0
  return flight
}

const scratchDesired: FlightPoint = flightPoint()
const scratchTargetVel: FlightPoint = flightPoint()

/**
 * Advance one follower toward the ecosystem target. The ecosystem remains the
 * authority on *where* to go; the flight envelope decides *how* to get there
 * without velocity or position snaps.
 */
export function stepFlightFollower(
  flight: FlightIndividual,
  target: FlightPoint,
  dt: number,
  targetVelocity?: FlightPoint,
): void {
  const clampedDt = Math.min(Math.max(dt, 0), 1 / 20)
  if (clampedDt <= 0) return
  const cruise = flight.profile.flight.cruise
  const clearance = flight.profile.flight.clearance * 0.5
  scratchTargetVel.x = targetVelocity?.x ?? 0
  scratchTargetVel.y = targetVelocity?.y ?? 0
  scratchTargetVel.z = targetVelocity?.z ?? 0
  arrivalVelocity(flight, target, scratchTargetVel, clearance, cruise, scratchDesired)
  // Goldfinch bounding emerges at cruise: alternate powered/bound on a slow cycle.
  if (flight.species === "goldfinch") {
    const cycle = (flight.distanceTravelled / Math.max(0.6, cruise)) % 1.6
    setFlightMode(flight, cycle > 1.1 ? "bound" : "powered")
  } else if (flight.profile.family === "bird") {
    if (flight.mode !== "powered" && flight.mode !== "approach" && flight.mode !== "contact") {
      setFlightMode(flight, "powered")
    }
  }
  integrateFlight(flight, scratchDesired, clampedDt)
  flight.modeTime += clampedDt
  flight.activityTime += clampedDt
}

/** Wing flap angle (radians) derived from the integrated wingPhase — never wall-clock sin. */
export function flightWingAngle(flight: FlightIndividual): number {
  const family = flight.profile.family
  const amplitude =
    family === "bird" ? 0.72 : family === "butterfly" ? 0.95 : family === "dragonfly" ? 0.45 : family === "bee" ? 0.6 : 0.4
  // Bound phase folds wings instead of flapping wide.
  const foldDamp = 1 - flight.pose.wingFold * 0.75
  return Math.sin(flight.pose.wingPhase) * amplitude * foldDamp
}

/** Species wingbeat frequency for QA / debug display. */
export function flightWingHz(species: FlyingSpecies): number {
  return FLYING_SPECIES[species].flight.wingHz
}
