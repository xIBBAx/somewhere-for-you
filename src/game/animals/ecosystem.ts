import * as THREE from "three"
import { clamp, damp, dampAngle, makeRng } from "../../utils/math"
import { resolveCollisions } from "../movement"
import {
  findCatPath,
  isNavigationPointBlocked,
  segmentHasClearance,
  type NavPoint,
} from "../navigation/catNavigation"
import { catRT, avatarRT, worldRT } from "../runtime"
import {
  buildColliders,
  groundHeight,
  HOME_CENTER,
  HOME_RADIUS,
  POND,
  WATER_Y,
} from "../world-layout"
import { getEffectiveWeather, weatherRT } from "../weather/weatherState"
import { BRIDGE_HALF_WIDTH, RIVER_MAX_X, RIVER_MIN_X, keepOffLilyPads, riverCenterZ, riverHalfWidthAt } from "../../world/hubLayout"
import { waterInvitation } from "../../world/creatureWater"
import { emitRipple } from "../../world/render/waterFx"
import { getMonkeyMotion, stepMonkey } from "./monkeyMotion"

export type AnimalSpecies =
  | "companion-cat"
  | "garden-cat"
  | "rabbit"
  | "ground-bird"
  | "sky-bird"
  | "duck"
  | "deer"
  | "horse"
  | "monkey"
  | "butterfly"
  | "dragonfly"
  | "bee"

export type AnimalMobility = "land" | "air" | "water" | "arboreal"

export type AnimalActivity =
  | "roam"
  | "explore"
  | "rest"
  | "eat"
  | "drink"
  | "observe"
  | "socialize"
  | "investigate"
  | "play"
  | "flee"
  | "shelter"

export type AnimalPersonality = {
  curiosity: number
  caution: number
  sociability: number
  energy: number
  playfulness: number
}

export type AnimalPoint = { x: number; z: number; y?: number }

export type AnimalAgentConfig = {
  id: string
  species: AnimalSpecies
  mobility: AnimalMobility
  position: AnimalPoint
  seed: number
  radius?: number
  walkSpeed?: number
  runSpeed?: number
  perception?: number
  personalSpace?: number
  playerSpace?: number
  fleeDistance?: number
  altitude?: readonly [number, number]
  nocturnal?: boolean
  /** Registered for perception/debugging but driven by a parent rig (young/companion animals). */
  passive?: boolean
  personality?: Partial<AnimalPersonality>
  threats?: AnimalSpecies[]
  interests?: AnimalSpecies[]
  preferredPoints?: AnimalPoint[]
}

export type AnimalAgent = {
  readonly id: string
  readonly species: AnimalSpecies
  readonly mobility: AnimalMobility
  readonly config: Required<
    Omit<AnimalAgentConfig, "personality" | "threats" | "interests" | "preferredPoints" | "altitude">
  > & {
    personality: AnimalPersonality
    threats: AnimalSpecies[]
    interests: AnimalSpecies[]
    preferredPoints: AnimalPoint[]
    altitude: readonly [number, number]
  }
  readonly spawn: THREE.Vector3
  readonly position: THREE.Vector3
  readonly target: THREE.Vector3
  readonly velocity: THREE.Vector3
  readonly recentDestinations: THREE.Vector3[]
  activity: AnimalActivity
  previousActivity: AnimalActivity
  activityTime: number
  activityDuration: number
  decisionIn: number
  interactionCooldown: number
  targetAnimalId: string | null
  lastInteractionId: string | null
  lastThreatId: string | null
  fearTime: number
  heading: number
  speed: number
  moving: boolean
  distanceTravelled: number
  decisions: number
  transitions: number
  blockedTime: number
  path: THREE.Vector3[]
  pathIndex: number
  rng: () => number
}

export type AnimalSnapshot = {
  locomotion?: string
  phaseTime?: number
  verticalVelocity?: number
  completedJumps?: number
  groundVisits?: number
  id: string
  species: AnimalSpecies
  mobility: AnimalMobility
  activity: AnimalActivity
  previousActivity: AnimalActivity
  x: number
  y: number
  z: number
  targetX: number
  targetZ: number
  speed: number
  moving: boolean
  distanceFromSpawn: number
  distanceTravelled: number
  targetAnimalId: string | null
  lastInteractionId: string | null
  lastThreatId: string | null
  fearTime: number
  decisions: number
  transitions: number
}

const DEFAULT_PERSONALITY: AnimalPersonality = {
  curiosity: 0.5,
  caution: 0.5,
  sociability: 0.5,
  energy: 0.5,
  playfulness: 0.5,
}

/** Broad habitat magnets. They influence destination scoring but never act as cages. */
export const ANIMAL_WORLD_POINTS: AnimalPoint[] = [
  { x: -7.5, z: 14.5 },
  { x: 6.5, z: 12 },
  { x: -18, z: 7 },
  { x: 17, z: 2 },
  { x: -14, z: -9 },
  { x: 13, z: -12 },
  { x: -4, z: -17 },
  { x: 7, z: -19 },
  { x: -7, z: -28 },
  { x: 7, z: -29 },
  { x: 1, z: 24 },
]

/**
 * Where home's animals come down to drink: round the pond and along both
 * banks of the creek (clear of the bridge), each with the heading that faces
 * the water. The fence posts keep paws out of the pond; a neck over the edge
 * is enough to drink.
 */
type DrinkPoint = { x: number; z: number; face: number }
let drinkPoints: DrinkPoint[] | null = null
export const homeDrinkPoints = (): DrinkPoint[] => {
  if (drinkPoints) return drinkPoints
  const out: DrinkPoint[] = []
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    const x = POND.x + Math.cos(a) * (POND.r + 0.62) * 1.08, z = POND.z + Math.sin(a) * (POND.r + 0.62) * 0.88
    out.push({ x, z, face: Math.atan2(POND.x - x, POND.z - z) })
  }
  for (let x = RIVER_MIN_X + 2; x < RIVER_MAX_X - 2; x += 2.6) {
    if (Math.abs(x) < BRIDGE_HALF_WIDTH + 0.9) continue
    for (const side of [-1, 1]) {
      const z = riverCenterZ(x) + side * (riverHalfWidthAt(x) + 0.5)
      out.push({ x, z, face: side > 0 ? Math.PI : 0 })
    }
  }
  drinkPoints = out.filter((p) => !isNavigationPointBlocked({ x: p.x, z: p.z }, 0.2, circles, rects))
  return drinkPoints
}
const drinkFace = new WeakMap<AnimalAgent, number>()

/** The nearest free drinking place a land animal can walk to. */
const pickDrinkPoint = (agent: AnimalAgent): DrinkPoint | null => {
  let best: DrinkPoint | null = null
  let bestD = Infinity
  for (const p of homeDrinkPoints()) {
    const d = Math.hypot(p.x - agent.position.x, p.z - agent.position.z) * (0.8 + agent.rng() * 0.5)
    if (d > 24 || destinationWasRecent(agent, p.x, p.z)) continue
    // someone already drinking there: shuffle along the bank
    let taken = false
    for (const o of agents.values()) if (o !== agent && o.activity === "drink" && o.target.distanceToSquared(new THREE.Vector3(p.x, o.target.y, p.z)) < 0.6) { taken = true; break }
    if (taken) continue
    if (d < bestD) { bestD = d; best = p }
  }
  return best
}

export const ANIMAL_SHELTER_POINTS: AnimalPoint[] = [
  { x: -7.1, z: 16.5 },
  { x: -14.9, z: 4.9 },
  { x: -4.7, z: -4.4 },
  { x: 13.8, z: -5.2 },
  { x: 12.3, z: -16.4 },
  { x: 4.8, z: -11.3 },
]

const { circles, rects } = buildColliders()
const agents = new Map<string, AnimalAgent>()
const candidate = { x: 0, z: 0 }
const resolvedStep = { x: 0, z: 0 }
const SESSION_SEED = ((Math.random() * 0xffffffff) ^ Date.now()) >>> 0

const hashId = (id: string): number => {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const clamp01 = (value: number): number => clamp(value, 0, 1)

const normalizedPersonality = (
  personality: Partial<AnimalPersonality> | undefined,
): AnimalPersonality => ({
  curiosity: clamp01(personality?.curiosity ?? DEFAULT_PERSONALITY.curiosity),
  caution: clamp01(personality?.caution ?? DEFAULT_PERSONALITY.caution),
  sociability: clamp01(personality?.sociability ?? DEFAULT_PERSONALITY.sociability),
  energy: clamp01(personality?.energy ?? DEFAULT_PERSONALITY.energy),
  playfulness: clamp01(personality?.playfulness ?? DEFAULT_PERSONALITY.playfulness),
})

const pointY = (config: AnimalAgentConfig, point: AnimalPoint): number => {
  if (point.y !== undefined) return point.y
  if (config.mobility === "water") return WATER_Y + 0.06
  const altitude = config.altitude ?? [0, 0]
  return groundHeight(point.x, point.z) + altitude[0]
}

export const createAnimalAgent = (config: AnimalAgentConfig): AnimalAgent => {
  const position = new THREE.Vector3(
    config.position.x,
    pointY(config, config.position),
    config.position.z,
  )
  const seed = (config.seed ^ hashId(config.id) ^ SESSION_SEED) >>> 0
  const radius = config.radius ?? (config.mobility === "land" ? 0.24 : 0.08)
  const walkSpeed = config.walkSpeed ?? 0.9
  const runSpeed = config.runSpeed ?? walkSpeed * 2.2
  const perception = config.perception ?? 7
  const personalSpace = config.personalSpace ?? Math.max(0.45, radius * 2.4)
  const playerSpace = config.playerSpace ?? Math.max(1.2, radius + 0.9)
  const fleeDistance = config.fleeDistance ?? perception * 0.58
  const altitude = config.altitude ?? ([0, 0] as const)

  return {
    id: config.id,
    species: config.species,
    mobility: config.mobility,
    config: {
      id: config.id,
      species: config.species,
      mobility: config.mobility,
      position: config.position,
      seed: config.seed,
      radius,
      walkSpeed,
      runSpeed,
      perception,
      personalSpace,
      playerSpace,
      fleeDistance,
      nocturnal: config.nocturnal ?? false,
      passive: config.passive ?? false,
      altitude,
      personality: normalizedPersonality(config.personality),
      threats: config.threats ?? [],
      interests: config.interests ?? [],
      preferredPoints: config.preferredPoints ?? [],
    },
    spawn: position.clone(),
    position,
    target: position.clone(),
    velocity: new THREE.Vector3(),
    recentDestinations: [],
    activity: "observe",
    previousActivity: "observe",
    activityTime: 0,
    activityDuration: 1.2,
    decisionIn: (seed % 37) / 90,
    interactionCooldown: 1 + (seed % 29) / 10,
    targetAnimalId: null,
    lastInteractionId: null,
    lastThreatId: null,
    fearTime: 0,
    heading: (seed % 628) / 100,
    speed: 0,
    moving: false,
    distanceTravelled: 0,
    decisions: 0,
    transitions: 0,
    blockedTime: 0,
    path: [],
    pathIndex: 0,
    rng: makeRng(seed),
  }
}

export const registerAnimalAgent = (agent: AnimalAgent): (() => void) => {
  agents.set(agent.id, agent)
  return () => {
    if (agents.get(agent.id) === agent) agents.delete(agent.id)
  }
}

export const getAnimalAgent = (id: string): AnimalAgent | undefined => agents.get(id)
/** Every registered agent of a species (The cat looks for her friends among the garden cats). */
export const animalAgentsOf = (species: AnimalSpecies): AnimalAgent[] => [...agents.values()].filter((a) => a.species === species)

const snapshotAgent = (agent: AnimalAgent): AnimalSnapshot => ({
  ...(agent.species === "monkey" ? {
    locomotion: getMonkeyMotion(agent).phase,
    phaseTime: getMonkeyMotion(agent).time,
    verticalVelocity: agent.velocity.y,
    completedJumps: getMonkeyMotion(agent).jumps,
    groundVisits: getMonkeyMotion(agent).groundVisits,
  } : {}),
  id: agent.id,
  species: agent.species,
  mobility: agent.mobility,
  activity: agent.activity,
  previousActivity: agent.previousActivity,
  x: agent.position.x,
  y: agent.position.y,
  z: agent.position.z,
  targetX: agent.target.x,
  targetZ: agent.target.z,
  speed: agent.speed,
  moving: agent.moving,
  distanceFromSpawn: Math.hypot(
    agent.position.x - agent.spawn.x,
    agent.position.z - agent.spawn.z,
  ),
  distanceTravelled: agent.distanceTravelled,
  targetAnimalId: agent.targetAnimalId,
  lastInteractionId: agent.lastInteractionId,
  lastThreatId: agent.lastThreatId,
  fearTime: agent.fearTime,
  decisions: agent.decisions,
  transitions: agent.transitions,
})

export const animalEcosystemRT = {
  sessionSeed: SESSION_SEED,
  agents,
  decisionCount: 0,
  transitionCount: 0,
  threatEvents: 0,
  crossSpeciesEvents: 0,
  snapshots: (): AnimalSnapshot[] => Array.from(agents.values(), snapshotAgent),
  monkeyMotionForQA: (id: string) => {
    const agent = agents.get(id)
    return agent?.species === "monkey" ? getMonkeyMotion(agent) : null
  },
  forceDecision: (id?: string): void => {
    if (id) {
      const agent = agents.get(id)
      if (agent) agent.decisionIn = 0
      return
    }
    agents.forEach((agent) => {
      agent.decisionIn = 0
      agent.activityDuration = 0
    })
  },
  /** Debug QA only: advance the same mutable agents without depending on headless rAF speed. */
  advanceForQA: (seconds: number): void => {
    const safeSeconds = clamp(seconds, 0, 90)
    const step = 1 / 30
    const iterations = Math.ceil(safeSeconds / step)
    for (let frame = 0; frame < iterations; frame++) {
      agents.forEach((agent) => {
        if (!agent.config.passive) stepAnimalAgent(agent, step)
      })
    }
  },
}

const isStationaryActivity = (activity: AnimalActivity): boolean =>
  activity === "rest" || activity === "eat" || activity === "observe"

const isStorm = (): boolean =>
  weatherRT.condition === "thunderstorm" ||
  getEffectiveWeather().condition === "thunderstorm" ||
  weatherRT.rain > 0.72 ||
  worldRT.lightning > 0.35

const isNight = (): boolean => worldRT.timeOfDay > 0.72

const destinationWasRecent = (agent: AnimalAgent, x: number, z: number): boolean =>
  agent.recentDestinations.some((point) => (point.x - x) ** 2 + (point.z - z) ** 2 < 4.5 ** 2)

const isLandPointValid = (agent: AnimalAgent, point: NavPoint): boolean =>
  !isNavigationPointBlocked(point, agent.config.radius, circles, rects)

const randomWorldCandidate = (agent: AnimalAgent): AnimalPoint => {
  const { rng } = agent
  const journeyChance = 0.2 + agent.config.personality.curiosity * 0.28
  if (rng() < journeyChance) {
    const pool =
      agent.config.preferredPoints.length > 0 && rng() < 0.58
        ? agent.config.preferredPoints
        : ANIMAL_WORLD_POINTS
    const point = pool[Math.floor(rng() * pool.length)]
    return {
      x: point.x + (rng() - 0.5) * 4.5,
      z: point.z + (rng() - 0.5) * 4.5,
      y: point.y,
    }
  }

  const angle = rng() * Math.PI * 2
  const range = 3.5 + rng() * (8 + agent.config.personality.energy * 8)
  return {
    x: agent.position.x + Math.cos(angle) * range,
    z: agent.position.z + Math.sin(angle) * range,
  }
}

const candidateScore = (agent: AnimalAgent, point: AnimalPoint): number => {
  const homeDistance = Math.hypot(point.x - HOME_CENTER.x, point.z - HOME_CENTER.y)
  if (homeDistance > HOME_RADIUS - agent.config.radius - 0.8) return -Infinity
  if (agent.mobility === "land" && !isLandPointValid(agent, point)) return -Infinity

  let score = agent.rng() * 1.4
  const travel = Math.hypot(point.x - agent.position.x, point.z - agent.position.z)
  score += Math.min(travel, 18) * (0.03 + agent.config.personality.curiosity * 0.035)
  if (destinationWasRecent(agent, point.x, point.z)) score -= 3.2

  const playerDistance = Math.hypot(point.x - avatarRT().pos.x, point.z - avatarRT().pos.z)
  if (playerDistance < agent.config.playerSpace + 0.8) score -= 5

  for (const preferred of agent.config.preferredPoints) {
    const distance = Math.hypot(point.x - preferred.x, point.z - preferred.z)
    score += Math.max(0, 1 - distance / 11) * 0.65
  }
  return score
}

/** how far a swimming duck's centre keeps from a lily leaf's rim */
const DUCK_CLEARANCE = 0.18

const pickDestination = (agent: AnimalAgent, shelter = false): THREE.Vector3 => {
  if (agent.mobility === "water") {
    // open water between the lily leaves
    const point = new THREE.Vector3()
    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = agent.rng() * Math.PI * 2
      const radius = POND.r * (0.26 + agent.rng() * 0.48)
      point.set(POND.x + Math.cos(angle) * radius, WATER_Y + 0.07, POND.z + Math.sin(angle) * radius * 0.83)
      if (!keepOffLilyPads({ x: point.x, z: point.z }, DUCK_CLEARANCE)) break
    }
    return point
  }

  const source = shelter ? ANIMAL_SHELTER_POINTS : undefined
  let best: AnimalPoint | null = null
  let bestScore = -Infinity
  const attempts = shelter ? source!.length : 12
  for (let i = 0; i < attempts; i++) {
    const point = source
      ? source[i]
      : randomWorldCandidate(agent)
    const score = candidateScore(agent, point) - (source ? Math.hypot(
      point.x - agent.position.x,
      point.z - agent.position.z,
    ) * 0.06 : 0)
    if (score > bestScore) {
      best = point
      bestScore = score
    }
  }

  if (!best || bestScore === -Infinity) {
    best = {
      x: agent.position.x + Math.sin(agent.heading + Math.PI / 2) * 2,
      z: agent.position.z + Math.cos(agent.heading + Math.PI / 2) * 2,
    }
  }
  const altitude = THREE.MathUtils.lerp(
    agent.config.altitude[0],
    agent.config.altitude[1],
    agent.rng(),
  )
  const y = best.y ?? groundHeight(best.x, best.z) + altitude
  return new THREE.Vector3(best.x, y, best.z)
}

const rememberDestination = (agent: AnimalAgent, point: THREE.Vector3): void => {
  if (agent.recentDestinations.some((recent) => recent.distanceToSquared(point) < 1)) return
  agent.recentDestinations.push(point.clone())
  if (agent.recentDestinations.length > 4) agent.recentDestinations.shift()
}

const planLandPath = (agent: AnimalAgent): void => {
  agent.path.length = 0
  agent.pathIndex = 0
  if (agent.mobility !== "land") return
  const start = { x: agent.position.x, z: agent.position.z }
  const end = { x: agent.target.x, z: agent.target.z }
  if (segmentHasClearance(start, end, agent.config.radius, circles, rects)) {
    agent.path.push(agent.target.clone())
    return
  }
  const path = findCatPath(start, end, agent.config.radius, circles, rects)
  for (const waypoint of path) {
    agent.path.push(
      new THREE.Vector3(waypoint.x, groundHeight(waypoint.x, waypoint.z), waypoint.z),
    )
  }
}

const setTarget = (agent: AnimalAgent, point: THREE.Vector3, remember = true): void => {
  agent.target.copy(point)
  // A flock member's curiosity must never turn a ground animal into a landing
  // site. This flock has no perch/contact state and stays above the canopy.
  if (agent.species === "sky-bird") agent.target.y = Math.max(agent.target.y,
    groundHeight(point.x, point.z) + agent.config.altitude[0])
  if (remember) rememberDestination(agent, point)
  planLandPath(agent)
}

const setActivity = (
  agent: AnimalAgent,
  activity: AnimalActivity,
  duration: number,
  target?: THREE.Vector3,
): void => {
  if (activity !== agent.activity) {
    agent.previousActivity = agent.activity
    agent.activity = activity
    agent.activityTime = 0
    agent.transitions++
    animalEcosystemRT.transitionCount++
  }
  agent.activityDuration = Math.max(0.45, duration)
  if (target) setTarget(agent, target, activity !== "flee")
  else if (isStationaryActivity(activity)) setTarget(agent, agent.position, false)
}

type PerceivedThreat = { id: string; x: number; z: number; distance: number }

const nearestThreat = (agent: AnimalAgent): PerceivedThreat | null => {
  let nearest: PerceivedThreat | null = null
  const accepts = (species: AnimalSpecies): boolean => agent.config.threats.includes(species)

  // A fast-moving player is a disturbance, not a predator. Cautious animals
  // still yield the route instead of becoming a gameplay obstacle.
  if (avatarRT().moving && avatarRT().speed > 1.1 && agent.mobility !== "arboreal") {
    const distance = Math.hypot(agent.position.x - avatarRT().pos.x, agent.position.z - avatarRT().pos.z)
    const threshold = agent.config.playerSpace + 0.7 + agent.config.personality.caution * 1.5
    if (distance < threshold) {
      nearest = { id: "explorer-moving", x: avatarRT().pos.x, z: avatarRT().pos.z, distance }
    }
  }

  if (accepts("companion-cat")) {
    const distance = Math.hypot(agent.position.x - catRT.pos.x, agent.position.z - catRT.pos.z)
    const catIsIntentional = catRT.state === "chase" || catRT.state === "crouch" || catRT.speed > 3.2
    const threshold = agent.config.fleeDistance * (catIsIntentional ? 1.2 : 0.72)
    if (distance < threshold) nearest = { id: "companion-cat", x: catRT.pos.x, z: catRT.pos.z, distance }
  }

  for (const other of agents.values()) {
    if (other === agent || !accepts(other.species)) continue
    const distance = Math.hypot(
      agent.position.x - other.position.x,
      agent.position.z - other.position.z,
    )
    if (distance >= agent.config.fleeDistance || (nearest && distance >= nearest.distance)) continue
    nearest = { id: other.id, x: other.position.x, z: other.position.z, distance }
  }
  return nearest
}

const fleeTarget = (agent: AnimalAgent, threat: PerceivedThreat): THREE.Vector3 => {
  let awayX = agent.position.x - threat.x
  let awayZ = agent.position.z - threat.z
  const length = Math.hypot(awayX, awayZ) || 1
  awayX /= length
  awayZ /= length
  const side = agent.rng() < 0.5 ? -1 : 1
  const distance = 5 + agent.rng() * 5
  const angle = Math.atan2(awayX, awayZ) + side * (agent.rng() - 0.5) * 0.5
  const point = new THREE.Vector3(
    agent.position.x + Math.sin(angle) * distance,
    agent.position.y,
    agent.position.z + Math.cos(angle) * distance,
  )

  if (agent.mobility === "water") {
    const dx = point.x - POND.x
    const dz = (point.z - POND.z) / 0.83
    const radius = Math.hypot(dx, dz)
    const maxRadius = POND.r * 0.76
    if (radius > maxRadius) {
      point.x = POND.x + (dx / radius) * maxRadius
      point.z = POND.z + (dz / radius) * maxRadius * 0.83
    }
    keepOffLilyPads(point, DUCK_CLEARANCE)
    point.y = WATER_Y + 0.07
  } else if (agent.mobility === "land" && !isLandPointValid(agent, point)) {
    const alternatives = [0.75, -0.75, 1.35, -1.35, Math.PI]
    for (const offset of alternatives) {
      candidate.x = agent.position.x + Math.sin(angle + offset) * distance
      candidate.z = agent.position.z + Math.cos(angle + offset) * distance
      if (isLandPointValid(agent, candidate)) {
        point.set(candidate.x, groundHeight(candidate.x, candidate.z), candidate.z)
        break
      }
    }
  } else {
    const altitude = agent.config.altitude[1]
    point.y = groundHeight(point.x, point.z) + altitude
  }
  return point
}

const nearestInterestingAnimal = (agent: AnimalAgent): AnimalAgent | null => {
  let best: AnimalAgent | null = null
  let bestScore = Infinity
  for (const other of agents.values()) {
    if (other === agent || other.id === agent.lastInteractionId) continue
    if (agent.species === "sky-bird" && other.species !== "sky-bird") continue
    const explicitlyInteresting = agent.config.interests.includes(other.species)
    if (!explicitlyInteresting && agent.config.personality.sociability < 0.58) continue
    const distance = Math.hypot(
      agent.position.x - other.position.x,
      agent.position.z - other.position.z,
    )
    if (distance > agent.config.perception) continue
    const crossSpeciesBonus = other.species === agent.species ? 0.9 : 0.72
    const score = distance * crossSpeciesBonus
    if (score < bestScore) {
      best = other
      bestScore = score
    }
  }
  return best
}

const interactionTarget = (agent: AnimalAgent, other: AnimalAgent): THREE.Vector3 => {
  const dx = agent.position.x - other.position.x
  const dz = agent.position.z - other.position.z
  const distance = Math.hypot(dx, dz) || 1
  const desired = agent.config.personalSpace + other.config.personalSpace + 0.25
  return new THREE.Vector3(
    other.position.x + (dx / distance) * desired,
    other.position.y,
    other.position.z + (dz / distance) * desired,
  )
}

const chooseOrdinaryActivity = (agent: AnimalAgent): void => {
  if (agent.species === "sky-bird") {
    setActivity(agent, "roam", 7 + agent.rng() * 8, pickDestination(agent))
    return
  }
  const personality = agent.config.personality
  const nightRestBias = isNight() && !agent.config.nocturnal ? 0.24 : 0
  const roll = agent.rng()

  if (roll < 0.14 + nightRestBias - personality.energy * 0.05) {
    setActivity(agent, "rest", 4 + agent.rng() * 8)
    return
  }
  if (roll < 0.31 + nightRestBias) {
    setActivity(agent, "eat", 3 + agent.rng() * 6)
    return
  }
  if (roll < 0.4 + personality.caution * 0.08) {
    setActivity(agent, "observe", 2.5 + agent.rng() * 5)
    return
  }
  if (agent.mobility === "water" && roll < 0.52) {
    setActivity(agent, "drink", 3 + agent.rng() * 4, pickDestination(agent))
    return
  }
  // thirst: the garden's land animals walk down to the pond or the creek,
  // more often on a hot day, rarely in the dark
  if (agent.mobility === "land" && !agent.config.passive && roll < 0.5 + waterInvitation(worldRT.timeOfDay, agent.config.nocturnal) * 0.12 && agent.rng() < 0.42) {
    const spot = pickDrinkPoint(agent)
    if (spot) {
      drinkFace.set(agent, spot.face)
      const travel = Math.hypot(spot.x - agent.position.x, spot.z - agent.position.z) / Math.max(0.3, agent.config.walkSpeed)
      setActivity(agent, "drink", travel * 1.4 + 5 + agent.rng() * 6, new THREE.Vector3(spot.x, groundHeight(spot.x, spot.z), spot.z))
      return
    }
  }

  const activity: AnimalActivity =
    roll > 0.82 - personality.playfulness * 0.13
      ? "play"
      : roll > 0.58 - personality.curiosity * 0.12
        ? "explore"
        : "roam"
  setActivity(
    agent,
    activity,
    4 + agent.rng() * (6 + personality.energy * 7),
    pickDestination(agent),
  )
}

const updateDecision = (agent: AnimalAgent): void => {
  agent.decisions++
  animalEcosystemRT.decisionCount++
  const threat = nearestThreat(agent)
  if (threat) {
    const isNewThreat = agent.lastThreatId !== threat.id || agent.fearTime <= 0
    agent.lastThreatId = threat.id
    agent.fearTime = 2.8 + agent.config.personality.caution * 3.6
    agent.targetAnimalId = threat.id
    setActivity(
      agent,
      "flee",
      agent.fearTime,
      fleeTarget(agent, threat),
    )
    if (isNewThreat) {
      animalEcosystemRT.threatEvents++
      if (threat.id !== "explorer-moving") animalEcosystemRT.crossSpeciesEvents++
    }
    return
  }

  if (agent.activity === "flee" && agent.fearTime > 0) return

  if (isStorm() && agent.mobility !== "water" && agent.species !== "sky-bird") {
    if (agent.activity !== "shelter" || agent.activityTime >= agent.activityDuration) {
      agent.targetAnimalId = null
      setActivity(agent, "shelter", 8 + agent.rng() * 10, pickDestination(agent, true))
    }
    return
  }

  const arrived = agent.position.distanceToSquared(agent.target) < 0.65 ** 2
  if (agent.activityTime < agent.activityDuration && !(arrived && !isStationaryActivity(agent.activity) && agent.activity !== "drink")) {
    if (agent.targetAnimalId) {
      const other = agents.get(agent.targetAnimalId)
      if (other) setTarget(agent, interactionTarget(agent, other), false)
      else agent.targetAnimalId = null
    }
    return
  }

  if (agent.interactionCooldown <= 0 && agent.rng() < 0.22 + agent.config.personality.sociability * 0.28) {
    const other = nearestInterestingAnimal(agent)
    if (other) {
      const playfulInterest = agent.config.interests.includes(other.species) && agent.config.personality.playfulness > 0.55
      agent.targetAnimalId = other.id
      agent.lastInteractionId = other.id
      agent.interactionCooldown = 6 + agent.rng() * 12
      setActivity(
        agent,
        playfulInterest ? "play" : agent.config.personality.sociability > 0.56 ? "socialize" : "investigate",
        3 + agent.rng() * 5,
        interactionTarget(agent, other),
      )
      if (other.species !== agent.species) animalEcosystemRT.crossSpeciesEvents++
      return
    }
  }

  const playerDistance = Math.hypot(
    agent.position.x - avatarRT().pos.x,
    agent.position.z - avatarRT().pos.z,
  )
  const mayApproachPlayer =
    !avatarRT().moving &&
    avatarRT().idleTime > 1.2 &&
    playerDistance < agent.config.perception &&
    agent.config.personality.curiosity > 0.58 &&
    agent.rng() < 0.2 + agent.config.personality.curiosity * 0.28
  if (mayApproachPlayer) {
    const angle = Math.atan2(
      agent.position.x - avatarRT().pos.x,
      agent.position.z - avatarRT().pos.z,
    )
    const distance = agent.config.playerSpace + 0.55 + agent.rng() * 0.65
    agent.targetAnimalId = null
    setActivity(
      agent,
      "investigate",
      3 + agent.rng() * 5,
      new THREE.Vector3(
        avatarRT().pos.x + Math.sin(angle) * distance,
        agent.position.y,
        avatarRT().pos.z + Math.cos(angle) * distance,
      ),
    )
    return
  }

  agent.targetAnimalId = null
  chooseOrdinaryActivity(agent)
}

const personalSpaceSteering = (agent: AnimalAgent): { x: number; z: number } => {
  let x = 0
  let z = 0
  for (const other of agents.values()) {
    if (other === agent || other.mobility !== agent.mobility) continue
    const dx = agent.position.x - other.position.x
    const dz = agent.position.z - other.position.z
    const desired = agent.config.personalSpace + other.config.personalSpace
    const distanceSq = dx * dx + dz * dz
    if (distanceSq <= 1e-6 || distanceSq >= desired * desired) continue
    const distance = Math.sqrt(distanceSq)
    const strength = (1 - distance / desired) * 1.15
    x += (dx / distance) * strength
    z += (dz / distance) * strength
  }

  const playerDx = agent.position.x - avatarRT().pos.x
  const playerDz = agent.position.z - avatarRT().pos.z
  const playerDistance = Math.hypot(playerDx, playerDz)
  const playerReach = agent.config.playerSpace + (avatarRT().moving ? 1.15 : 0)
  if (playerDistance > 1e-4 && playerDistance < playerReach) {
    const strength = (1 - playerDistance / playerReach) * (avatarRT().moving ? 2.4 : 1.1)
    x += (playerDx / playerDistance) * strength
    z += (playerDz / playerDistance) * strength
  }
  return { x, z }
}

const currentLandTarget = (agent: AnimalAgent): THREE.Vector3 => {
  while (
    agent.pathIndex < agent.path.length &&
    agent.position.distanceToSquared(agent.path[agent.pathIndex]) < 0.42 ** 2
  ) {
    agent.pathIndex++
  }
  return agent.path[agent.pathIndex] ?? agent.target
}

const movementSpeed = (agent: AnimalAgent): number => {
  if (isStationaryActivity(agent.activity)) return 0
  if (agent.activity === "flee") return agent.config.runSpeed
  if (agent.activity === "play") {
    return THREE.MathUtils.lerp(agent.config.walkSpeed, agent.config.runSpeed, 0.58)
  }
  if (agent.activity === "shelter") return agent.config.walkSpeed * 1.2
  return agent.config.walkSpeed * (0.78 + agent.config.personality.energy * 0.44)
}

const stepLand = (agent: AnimalAgent, dt: number): void => {
  const destination = currentLandTarget(agent)
  let dx = destination.x - agent.position.x
  let dz = destination.z - agent.position.z
  const distance = Math.hypot(dx, dz)
  const wantedSpeed = movementSpeed(agent)
  if (wantedSpeed <= 0 || distance < 0.16) {
    // at the water's edge: turn to face it to drink
    const face = agent.activity === "drink" ? drinkFace.get(agent) : undefined
    if (face !== undefined && distance < 0.7) agent.heading = dampAngle(agent.heading, face, 3, dt)
    agent.speed = damp(agent.speed, 0, 10, dt)
    agent.velocity.set(0, 0, 0)
    agent.moving = false
    return
  }

  dx /= distance
  dz /= distance
  const separation = personalSpaceSteering(agent)
  dx += separation.x * 0.82
  dz += separation.z * 0.82
  const length = Math.hypot(dx, dz) || 1
  dx /= length
  dz /= length
  const wantedHeading = Math.atan2(dx, dz)
  agent.heading = dampAngle(agent.heading, wantedHeading, agent.activity === "flee" ? 9 : 4.5, dt)
  const turnX = Math.sin(agent.heading)
  const turnZ = Math.cos(agent.heading)
  agent.speed = damp(agent.speed, wantedSpeed, agent.activity === "flee" ? 7 : 3.8, dt)
  const step = Math.min(agent.speed * dt, distance)
  const oldX = agent.position.x
  const oldZ = agent.position.z
  resolvedStep.x = oldX + turnX * step
  resolvedStep.z = oldZ + turnZ * step
  const collided = resolveCollisions(resolvedStep, agent.config.radius, circles, rects)
  agent.position.x = resolvedStep.x
  agent.position.z = resolvedStep.z
  agent.position.y = groundHeight(agent.position.x, agent.position.z)
  agent.velocity.set((agent.position.x - oldX) / dt, 0, (agent.position.z - oldZ) / dt)
  const actualSpeed = Math.hypot(agent.velocity.x, agent.velocity.z)
  agent.distanceTravelled += actualSpeed * dt
  agent.moving = actualSpeed > 0.08

  if (collided && actualSpeed < wantedSpeed * 0.18) {
    agent.blockedTime += dt
    if (agent.blockedTime > 0.7) {
      agent.blockedTime = 0
      agent.decisionIn = 0
      agent.activityDuration = 0
      planLandPath(agent)
    }
  } else {
    agent.blockedTime = Math.max(0, agent.blockedTime - dt * 2)
  }
}

const constrainAirToHome = (agent: AnimalAgent): void => {
  const dx = agent.position.x - HOME_CENTER.x
  const dz = agent.position.z - HOME_CENTER.y
  const distance = Math.hypot(dx, dz)
  const max = HOME_RADIUS + (agent.species === "sky-bird" ? 14 : 1.5)
  if (distance <= max) return
  agent.position.x = HOME_CENTER.x + (dx / distance) * max
  agent.position.z = HOME_CENTER.y + (dz / distance) * max
  agent.decisionIn = 0
  agent.activityDuration = 0
}

const stepAirOrTree = (agent: AnimalAgent, dt: number): void => {
  if (agent.species === "sky-bird") {
    // Songbirds cannot idle in midair. Turn through a goal and choose another
    // one before arrival; preserve forward speed instead of braking to a hover.
    if (isStationaryActivity(agent.activity) || Math.hypot(agent.target.x - agent.position.x, agent.target.z - agent.position.z) < 4) {
      setActivity(agent, "roam", 7 + agent.rng() * 8, pickDestination(agent))
      agent.activityTime = 0
    }
    const dx = agent.target.x - agent.position.x, dz = agent.target.z - agent.position.z
    const separation = personalSpaceSteering(agent)
    const distance = Math.hypot(dx, dz) || 1
    const wantedHeading = Math.atan2(dx / distance + separation.x * 0.25, dz / distance + separation.z * 0.25)
    const turn = Math.atan2(Math.sin(wantedHeading - agent.heading), Math.cos(wantedHeading - agent.heading))
    agent.heading += clamp(turn, -1.15 * dt, 1.15 * dt)
    agent.speed = damp(agent.speed, Math.max(agent.config.walkSpeed, movementSpeed(agent)), 3.4, dt)
    const floor = groundHeight(agent.position.x, agent.position.z) + agent.config.altitude[0]
    const targetY = Math.max(floor, agent.target.y)
    agent.velocity.set(Math.sin(agent.heading) * agent.speed,
      damp(agent.velocity.y, clamp((targetY - agent.position.y) * 0.7, -1.6, 1.6), 3.4, dt),
      Math.cos(agent.heading) * agent.speed)
    agent.position.addScaledVector(agent.velocity, dt)
    constrainAirToHome(agent)
    agent.distanceTravelled += agent.velocity.length() * dt
    agent.moving = true
    return
  }
  const wantedSpeed = movementSpeed(agent)
  const dx = agent.target.x - agent.position.x
  const dy = agent.target.y - agent.position.y
  const dz = agent.target.z - agent.position.z
  const distance = Math.hypot(dx, dy, dz)
  if (wantedSpeed <= 0 || distance < 0.12) {
    agent.speed = damp(agent.speed, 0, 9, dt)
    agent.velocity.multiplyScalar(Math.exp(-8 * dt))
    agent.moving = false
    return
  }

  const separation = personalSpaceSteering(agent)
  const inv = 1 / (distance || 1)
  let dirX = dx * inv + separation.x * 0.35
  let dirY = dy * inv
  let dirZ = dz * inv + separation.z * 0.35
  const directionLength = Math.hypot(dirX, dirY, dirZ) || 1
  dirX /= directionLength
  dirY /= directionLength
  dirZ /= directionLength
  const rate = agent.activity === "flee" ? 8 : 3.4
  agent.velocity.x = damp(agent.velocity.x, dirX * wantedSpeed, rate, dt)
  agent.velocity.y = damp(agent.velocity.y, dirY * wantedSpeed, rate, dt)
  agent.velocity.z = damp(agent.velocity.z, dirZ * wantedSpeed, rate, dt)
  agent.speed = Math.hypot(agent.velocity.x, agent.velocity.y, agent.velocity.z)
  agent.heading = dampAngle(agent.heading, Math.atan2(agent.velocity.x, agent.velocity.z), 6, dt)
  agent.position.addScaledVector(agent.velocity, Math.min(dt, distance / Math.max(agent.speed, 0.01)))
  constrainAirToHome(agent)
  agent.distanceTravelled += agent.speed * dt
  agent.moving = agent.speed > 0.08
}

const stepWater = (agent: AnimalAgent, dt: number): void => {
  const wantedSpeed = movementSpeed(agent)
  let dx = agent.target.x - agent.position.x
  let dz = agent.target.z - agent.position.z
  const distance = Math.hypot(dx, dz)
  if (wantedSpeed <= 0 || distance < 0.12) {
    agent.speed = damp(agent.speed, 0, 8, dt)
    agent.velocity.set(0, 0, 0)
    agent.moving = false
    // a resting duck floats in open water too, not on a lily leaf
    keepOffLilyPads(agent.position, DUCK_CLEARANCE)
    return
  }
  dx /= distance
  dz /= distance
  const separation = personalSpaceSteering(agent)
  dx += separation.x * 0.5
  dz += separation.z * 0.5
  const length = Math.hypot(dx, dz) || 1
  dx /= length
  dz /= length
  agent.heading = dampAngle(agent.heading, Math.atan2(dx, dz), 5, dt)
  agent.speed = damp(agent.speed, wantedSpeed, agent.activity === "flee" ? 7 : 3.5, dt)
  const oldX = agent.position.x
  const oldZ = agent.position.z
  agent.position.x += Math.sin(agent.heading) * agent.speed * dt
  agent.position.z += Math.cos(agent.heading) * agent.speed * dt
  const pondDx = agent.position.x - POND.x
  const pondDz = (agent.position.z - POND.z) / 0.83
  const pondDistance = Math.hypot(pondDx, pondDz)
  const max = POND.r * 0.78
  if (pondDistance > max) {
    agent.position.x = POND.x + (pondDx / pondDistance) * max
    agent.position.z = POND.z + (pondDz / pondDistance) * max * 0.83
    agent.decisionIn = 0
    agent.activityDuration = 0
  }
  // swim round the lily leaves, never across them
  keepOffLilyPads(agent.position, DUCK_CLEARANCE)
  agent.velocity.set((agent.position.x - oldX) / dt, 0, (agent.position.z - oldZ) / dt)
  const actualSpeed = Math.hypot(agent.velocity.x, agent.velocity.z)
  // afloat: a slow heave on the pond's small swell (each duck on her own
  // beat), and she sits a little deeper as she paddles hard (the bow pushes
  // water up and the stern settles), rising again as she glides to a stop
  const swell = Math.sin(performance.now() * 0.0017 + agent.position.x * 0.9 + agent.position.z * 0.7) * 0.01
  agent.position.y = WATER_Y + 0.07 + swell - 0.014 * Math.min(1, actualSpeed / 0.6)
  agent.distanceTravelled += actualSpeed * dt
  agent.moving = actualSpeed > 0.05
  // her wake: a small ring spreading from behind her every few body lengths
  // as she paddles (none while she rests; larger when she hurries)
  const last = duckWakeAt.get(agent) ?? agent.distanceTravelled
  if (!agent.moving) duckWakeAt.set(agent, agent.distanceTravelled)
  else if (agent.distanceTravelled - last > 0.4) {
    duckWakeAt.set(agent, agent.distanceTravelled)
    emitRipple(agent.position.x - Math.sin(agent.heading) * 0.12, agent.position.z - Math.cos(agent.heading) * 0.12, 0.28 + Math.min(0.3, actualSpeed * 0.3), 1.5)
  }
}
const duckWakeAt = new WeakMap<AnimalAgent, number>()

/**
 * Staggered cognition + cheap per-frame steering. No raycasts, React state, or
 * per-frame path searches are used; A* runs only when a new blocked land goal is chosen.
 */
export const stepAnimalAgent = (agent: AnimalAgent, rawDt: number): void => {
  const dt = Math.min(Math.max(rawDt, 1e-4), 1 / 20)
  if (agent.species === "monkey") {
    const decisions = agent.decisions
    const transitions = agent.transitions
    stepMonkey(agent, dt, agents.values())
    animalEcosystemRT.decisionCount += agent.decisions - decisions
    animalEcosystemRT.transitionCount += agent.transitions - transitions
    return
  }
  agent.activityTime += dt
  agent.decisionIn -= dt
  agent.interactionCooldown = Math.max(0, agent.interactionCooldown - dt)
  agent.fearTime = Math.max(0, agent.fearTime - dt)
  if (agent.decisionIn <= 0) {
    updateDecision(agent)
    agent.decisionIn =
      0.34 +
      agent.rng() * 0.38 +
      (isStationaryActivity(agent.activity) ? 0.28 : 0) +
      (agent.mobility === "air" ? 0.12 : 0)
  }

  if (agent.mobility === "land") stepLand(agent, dt)
  else if (agent.mobility === "water") stepWater(agent, dt)
  else stepAirOrTree(agent, dt)
}

export type CompanionDistraction = {
  id: string
  species: AnimalSpecies
  kind: "observe" | "investigate" | "chase"
  target: THREE.Vector3
}

const COMPANION_CHASE_SPECIES: AnimalSpecies[] = [
  "butterfly",
  "ground-bird",
  "rabbit",
]

/** Read-only, allocation-light choice for the companion cat's next independent excursion. */
export const chooseCompanionDistraction = (
  maxDistance: number,
  recentId: string | null,
  roll: number,
): CompanionDistraction | null => {
  let chosen: AnimalAgent | null = null
  let bestScore = Infinity
  for (const other of agents.values()) {
    if (other.id === recentId || other.species === "companion-cat") continue
    const distanceFromCat = Math.hypot(
      other.position.x - catRT.pos.x,
      other.position.z - catRT.pos.z,
    )
    const distanceFromPlayer = Math.hypot(
      other.position.x - avatarRT().pos.x,
      other.position.z - avatarRT().pos.z,
    )
    if (distanceFromCat > maxDistance || distanceFromPlayer > 9.5) continue
    const interesting =
      COMPANION_CHASE_SPECIES.includes(other.species) ||
      other.species === "garden-cat" ||
      other.species === "duck" ||
      other.species === "monkey" ||
      other.species === "deer" ||
      other.species === "horse"
    if (!interesting) continue
    const score = distanceFromCat * (COMPANION_CHASE_SPECIES.includes(other.species) ? 0.78 : 1)
    if (score < bestScore) {
      chosen = other
      bestScore = score
    }
  }
  if (!chosen) return null
  const chaseable = COMPANION_CHASE_SPECIES.includes(chosen.species)
  const kind = chaseable && roll < 0.62 ? "chase" : roll < 0.82 ? "investigate" : "observe"
  return {
    id: chosen.id,
    species: chosen.species,
    kind,
    target: chosen.position,
  }
}

export const nearestShelterPoint = (position: { x: number; z: number }): THREE.Vector3 => {
  let best = ANIMAL_SHELTER_POINTS[0]
  let distance = Infinity
  for (const point of ANIMAL_SHELTER_POINTS) {
    const nextDistance = (point.x - position.x) ** 2 + (point.z - position.z) ** 2
    if (nextDistance < distance) {
      best = point
      distance = nextDistance
    }
  }
  return new THREE.Vector3(best.x, groundHeight(best.x, best.z), best.z)
}

export const animalWeatherIsThreatening = isStorm
