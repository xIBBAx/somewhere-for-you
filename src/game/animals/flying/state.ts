import { flightPoint, flightRandom, identitySeed, type FlightPoint } from "./primitives"
import { FLYING_SPECIES, type FlyingSpecies, type FlyingSpeciesProfile } from "./species"

export type FlightMode = "ground" | "perched" | "launch" | "powered" | "glide" | "bound" | "hover" | "approach" | "contact" | "settle"
export type FlightActivity = "explore" | "forage" | "feed" | "rest" | "shelter" | "vigilant" | "escape" | "associate" | "court" | "nest" | "territory" | "hunt" | "signal"
export type FlightIndividual = {
  id: string
  species: FlyingSpecies
  profile: FlyingSpeciesProfile
  sex: "female" | "male"
  traits: { size: number; caution: number; sociability: number; curiosity: number; endurance: number; hue: number }
  home: FlightPoint
  position: FlightPoint
  previousPosition: FlightPoint
  velocity: FlightPoint
  acceleration: FlightPoint
  target: FlightPoint
  look: FlightPoint
  mode: FlightMode
  modeTime: number
  activity: FlightActivity
  activityTime: number
  decisionAt: number
  cooldownUntil: number
  supportId: string | null
  resourceId: string | null
  partnerId: string | null
  threatId: string | null
  memory: { refugeId: string | null; foodId: string | null; lastDanger: FlightPoint; safeSeconds: number }
  drives: { hunger: number; fatigue: number; fear: number; social: number; breeding: number }
  pose: { heading: number; pitch: number; bank: number; wingPhase: number; effort: number; wingFold: number; feet: number; tailFan: number; headYaw: number; flash: number }
  distanceTravelled: number
  transitions: number
  rng: () => number
}

export function createFlightIndividual(id: string, species: FlyingSpecies, position: FlightPoint, worldSeed = 20260907): FlightIndividual {
  const profile = FLYING_SPECIES[species]
  const rng = flightRandom(identitySeed(id, worldSeed))
  const copy = () => flightPoint(position.x, position.y, position.z)
  return {
    id, species, profile, sex: species === "honeybee" || rng() < 0.5 ? "female" : "male",
    traits: { size: 0.91 + rng() * 0.18, caution: profile.caution * (0.8 + rng() * 0.4), sociability: rng(), curiosity: rng(), endurance: 0.8 + rng() * 0.4, hue: (rng() - 0.5) * 0.035 },
    home: copy(), position: copy(), previousPosition: copy(), velocity: flightPoint(), acceleration: flightPoint(), target: copy(), look: flightPoint(0, 0, 1),
    mode: "perched", modeTime: 0, activity: "rest", activityTime: 0,
    decisionAt: rng() * 0.6, cooldownUntil: 0, supportId: null, resourceId: null, partnerId: null, threatId: null,
    memory: { refugeId: null, foodId: null, lastDanger: copy(), safeSeconds: 30 },
    drives: { hunger: 0.25 + rng() * 0.45, fatigue: rng() * 0.25, fear: 0, social: rng() * 0.5, breeding: species === "honeybee" ? 0 : rng() * 0.3 },
    pose: { heading: rng() * Math.PI * 2, pitch: 0, bank: 0, wingPhase: rng() * Math.PI * 2, effort: 0, wingFold: 1, feet: 1, tailFan: 0, headYaw: 0, flash: 0 },
    distanceTravelled: 0, transitions: 0, rng,
  }
}

export function setFlightMode(agent: FlightIndividual, mode: FlightMode): void {
  if (agent.mode === mode) return
  agent.mode = mode
  agent.modeTime = 0
  agent.transitions++
}

export function setFlightActivity(agent: FlightIndividual, activity: FlightActivity): void {
  if (agent.activity === activity) return
  agent.activity = activity
  agent.activityTime = 0
  agent.transitions++
}
