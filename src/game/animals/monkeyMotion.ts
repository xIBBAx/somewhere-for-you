import * as THREE from "three"
import type { AnimalActivity, AnimalAgent } from "./ecosystem"
import { branchFootPoint, kickBranch, loadBranch, MONKEY_BRANCHES, nearbyBranches, type MonkeyBranch } from "./monkeyHabitat"
import { dampAngle } from "../../utils/math"
import { buildColliders, groundHeight } from "../world-layout"
import { findCatPath, segmentHasClearance } from "../navigation/catNavigation"
import { resolveCollisions } from "../movement"
import { avatarRT } from "../runtime"
import { weatherRT } from "../weather/weatherState"

export const MONKEY_GRAVITY = 13
export type MonkeyPhase = "branch-idle" | "branch-walk" | "prepare" | "takeoff" | "airborne" | "landing" | "recovery" | "climb-down" | "ground-idle" | "ground-walk" | "ground-run" | "approach-tree" | "climb-up" | "groom-approach" | "grooming"
/** who works and who is worked on in a grooming bout */
export type GroomRole = "groomer" | "groomee"
export type MonkeyMotion = {
  phase: MonkeyPhase
  time: number
  duration: number
  branch: MonkeyBranch
  destination: MonkeyBranch | null
  start: THREE.Vector3
  end: THREE.Vector3
  launchVelocity: THREE.Vector3
  flightTime: number
  branchT: number
  branchTargetT: number
  groundVisits: number
  jumps: number
  lastChoice: "jump" | "ground" | "walk"
  afterWalk: "idle" | "jump" | "down"
  /** the other monkey in a grooming bout, and this one's part in it */
  partner: AnimalAgent | null
  groomRole: GroomRole | null
  /** turns taken in this bout: macaques usually swap once, groomer for groomee */
  groomTurns: number
  /** finished bouts, and time since the last one (a monkey is not groomed nonstop) */
  grooms: number
  sinceGroom: number
}

const motions = new WeakMap<AnimalAgent, MonkeyMotion>()
const { circles, rects } = buildColliders()
const previous = new THREE.Vector3()
const point = new THREE.Vector3()
const resolved = { x: 0, z: 0 }

export const getMonkeyMotion = (agent: AnimalAgent): MonkeyMotion => {
  let motion = motions.get(agent)
  if (!motion) {
    const branch = MONKEY_BRANCHES.reduce((best, candidate) =>
      candidate.tip.distanceToSquared(agent.position) < best.tip.distanceToSquared(agent.position) ? candidate : best)
    motion = {
      phase: "branch-idle", time: 0, duration: 1 + agent.rng() * 3,
      branch, destination: null, start: agent.position.clone(), end: agent.position.clone(),
      launchVelocity: new THREE.Vector3(), flightTime: 0, branchT: 0.85, branchTargetT: 0.85,
      groundVisits: 0, jumps: 0, lastChoice: "walk", afterWalk: "idle",
      partner: null, groomRole: null, groomTurns: 0, grooms: 0, sinceGroom: 8 + agent.rng() * 10,
    }
    branchFootPoint(branch, motion.branchT, agent.position)
    motions.set(agent, motion)
  }
  return motion
}

const enter = (agent: AnimalAgent, motion: MonkeyMotion, phase: MonkeyPhase, duration: number, activity: AnimalActivity): void => {
  motion.phase = phase
  motion.time = 0
  motion.duration = duration
  agent.previousActivity = agent.activity
  agent.activity = activity
  agent.activityTime = 0
  agent.transitions++
}

/** Solve an ordinary gravity arc from two fixed contact points. */
export const solveMonkeyJump = (from: THREE.Vector3, to: THREE.Vector3, outVelocity: THREE.Vector3): number => {
  const distance = Math.hypot(to.x - from.x, to.z - from.z)
  const apex = Math.max(from.y, to.y) + 0.30 + distance * 0.12
  const upTime = Math.sqrt(2 * (apex - from.y) / MONKEY_GRAVITY)
  const downTime = Math.sqrt(2 * (apex - to.y) / MONKEY_GRAVITY)
  const duration = upTime + downTime
  outVelocity.set((to.x - from.x) / duration, MONKEY_GRAVITY * upTime, (to.z - from.z) / duration)
  return duration
}

export const sampleMonkeyJump = (from: THREE.Vector3, velocity: THREE.Vector3, time: number, out: THREE.Vector3): void => {
  out.copy(from).addScaledVector(velocity, time)
  out.y -= 0.5 * MONKEY_GRAVITY * time * time
}

const walkBranch = (agent: AnimalAgent, motion: MonkeyMotion, t: number, after: MonkeyMotion["afterWalk"]): void => {
  motion.branchTargetT = t
  motion.afterWalk = after
  enter(agent, motion, "branch-walk", 0, "explore")
}

const planGround = (agent: AnimalAgent, target: THREE.Vector3): boolean => {
  agent.target.copy(target)
  if (segmentHasClearance(agent.position, target, agent.config.radius, circles, rects)) {
    agent.path = [target.clone()]
  } else {
    agent.path = findCatPath(agent.position, target, agent.config.radius, circles, rects)
      .map((node) => new THREE.Vector3(node.x, groundHeight(node.x, node.z), node.z))
  }
  agent.pathIndex = 0
  return agent.path.length > 0
}

const moveGround = (agent: AnimalAgent, dt: number, speed: number): boolean => {
  const next = agent.path[agent.pathIndex]
  if (!next) return true
  const dx = next.x - agent.position.x
  const dz = next.z - agent.position.z
  const distance = Math.hypot(dx, dz)
  if (distance < 0.1) {
    agent.pathIndex++
    return agent.pathIndex >= agent.path.length
  }
  const step = Math.min(speed * dt, distance)
  resolved.x = agent.position.x + dx / distance * step
  resolved.z = agent.position.z + dz / distance * step
  resolveCollisions(resolved, agent.config.radius, circles, rects)
  agent.position.set(resolved.x, groundHeight(resolved.x, resolved.z), resolved.z)
  agent.heading = dampAngle(agent.heading, Math.atan2(dx, dz), 12, dt)
  return false
}

/** Spacing between the pair: the groomer sits just behind the other's shoulder. */
export const GROOM_DISTANCE = 0.2
const GROOM_BOUT = [7, 13] as const

/** Where a groomer sits for a partner facing `heading`: behind and a little to one side. */
export const groomSeat = (partner: AnimalAgent, side: number, out: THREE.Vector3): THREE.Vector3 => {
  const back = partner.heading + Math.PI + side * 0.55
  out.set(partner.position.x + Math.sin(back) * GROOM_DISTANCE, 0, partner.position.z + Math.cos(back) * GROOM_DISTANCE)
  out.y = groundHeight(out.x, out.z)
  return out
}

const groomable = (other: AnimalAgent): boolean => {
  const o = getMonkeyMotion(other)
  return o.phase === "ground-idle" && !o.partner && o.sinceGroom > 6
}

const endGroom = (agent: AnimalAgent, m: MonkeyMotion): void => {
  const partner = m.partner
  m.partner = null
  m.groomRole = null
  m.groomTurns = 0
  m.grooms++
  m.sinceGroom = 0
  agent.targetAnimalId = null
  enter(agent, m, "ground-idle", 1.2 + agent.rng() * 2.5, "observe")
  if (partner) {
    const o = getMonkeyMotion(partner)
    if (o.partner === agent) endGroom(partner, o)
  }
}

/** Both sit for a bout; the groomee waits facing away while the groomer settles. */
const startBout = (agent: AnimalAgent, m: MonkeyMotion, role: GroomRole, partner: AnimalAgent, duration: number): void => {
  m.partner = partner
  m.groomRole = role
  agent.targetAnimalId = partner.id
  enter(agent, m, "grooming", duration, "socialize")
}

/** Species-specific locomotion. No air steering can modify a committed jump. */
export const stepMonkey = (agent: AnimalAgent, dt: number, neighbors: Iterable<AnimalAgent>): void => {
  const m = getMonkeyMotion(agent)
  previous.copy(agent.position)
  m.time += dt
  agent.activityTime += dt
  const storm = weatherRT.condition === "thunderstorm" || weatherRT.rain > 0.7
  m.sinceGroom += dt
  // Perched, a monkey rides its bough: the contact point is re-sampled each
  // frame from the bending wood, and its weight is what bends it.
  if (m.phase === "branch-idle" || m.phase === "landing" || m.phase === "recovery" || m.phase === "prepare") {
    if (m.phase !== "prepare" || m.time < m.duration) branchFootPoint(m.branch, m.branchT, agent.position)
    // crouching to spring, the legs load the wood harder before they let go
    loadBranch(m.branch, m.branchT, m.phase === "prepare" ? 1 + 0.8 * Math.min(1, m.time / m.duration) : 1)
  }
  switch (m.phase) {
    case "branch-idle": {
      if (m.time < m.duration) break
      agent.decisions++
      const candidates = nearbyBranches(m.branch).filter((branch) => {
        for (const other of neighbors) {
          if (other !== agent && other.species === "monkey" && other.position.distanceTo(branch.tip) < 0.8) return false
        }
        return true
      })
      const roll = agent.rng()
      if (!storm && candidates.length && m.lastChoice !== "jump" && roll < 0.6) {
        m.destination = candidates[Math.floor(agent.rng() * candidates.length)]
        m.lastChoice = "jump"
        walkBranch(agent, m, 0.98, "jump")
      } else if (!storm && (roll < 0.8 || m.lastChoice === "jump")) {
        m.lastChoice = "ground"
        walkBranch(agent, m, 0, "down")
      } else {
        m.lastChoice = "walk"
        walkBranch(agent, m, m.branchT > 0.55 ? 0.3 : 0.9, "idle")
      }
      break
    }
    case "branch-walk": {
      const distance = m.branch.base.distanceTo(m.branch.tip)
      const delta = m.branchTargetT - m.branchT
      m.branchT += Math.sign(delta) * Math.min(Math.abs(delta), dt * 0.45 / distance)
      branchFootPoint(m.branch, m.branchT, agent.position)
      loadBranch(m.branch, m.branchT)
      const facing = Math.atan2(m.branch.tip.x - m.branch.base.x, m.branch.tip.z - m.branch.base.z)
      agent.heading = dampAngle(agent.heading, facing + (delta < 0 ? Math.PI : 0), 10, dt)
      if (Math.abs(m.branchTargetT - m.branchT) > 0.001) break
      if (m.afterWalk === "jump" && m.destination) {
        m.start.copy(agent.position)
        branchFootPoint(m.destination, 0.98, m.end)
        m.duration = solveMonkeyJump(m.start, m.end, m.launchVelocity)
        m.flightTime = 0
        enter(agent, m, "prepare", 0.26, "play")
      } else if (m.afterWalk === "down") {
        m.start.copy(agent.position)
        m.end.copy(m.branch.trunk).lerp(m.branch.base, 1)
        m.end.y = groundHeight(m.end.x, m.end.z)
        enter(agent, m, "climb-down", Math.max(0.8, (m.start.y - m.end.y) / 0.65), "explore")
      } else enter(agent, m, "branch-idle", 1.8 + agent.rng() * 3.5, storm ? "shelter" : "observe")
      break
    }
    case "prepare":
      agent.heading = dampAngle(agent.heading, Math.atan2(m.end.x - m.start.x, m.end.z - m.start.z), 14, dt)
      if (m.time >= m.duration) {
        // launch from where the bough has bent to, and push it down as she goes
        m.start.copy(agent.position)
        branchFootPoint(m.destination!, 0.98, m.end)
        enter(agent, m, "takeoff", solveMonkeyJump(m.start, m.end, m.launchVelocity), "play")
        kickBranch(m.branch, m.branchT, m.launchVelocity.y)
      }
      break
    case "takeoff":
    case "airborne": {
      m.flightTime += dt
      const flight = Math.min(m.flightTime, m.duration)
      sampleMonkeyJump(m.start, m.launchVelocity, flight, agent.position)
      if (m.phase === "takeoff" && m.flightTime > 0.065) m.phase = "airborne"
      if (m.flightTime >= m.duration) {
        agent.position.copy(m.end)
        // the landing drives the new bough down with her falling speed
        kickBranch(m.destination!, 0.98, Math.max(0, MONKEY_GRAVITY * m.duration - m.launchVelocity.y))
        m.branch = m.destination!
        m.branchT = 0.98
        m.destination = null
        m.jumps++
        enter(agent, m, "landing", 0.13, "play")
      }
      break
    }
    case "landing":
      if (m.time >= m.duration) enter(agent, m, "recovery", 0.28, "observe")
      break
    case "recovery":
      if (m.time >= m.duration) enter(agent, m, "branch-idle", 1.2 + agent.rng() * 2, "observe")
      break
    case "climb-down":
    case "climb-up": {
      const t = Math.min(1, m.time / m.duration)
      // Constant trunk contact; horizontal movement only steps off at ground level.
      agent.position.copy(m.start).lerp(m.end, t)
      agent.heading = Math.atan2(m.branch.trunk.x - agent.position.x, m.branch.trunk.z - agent.position.z)
      if (t < 1) break
      if (m.phase === "climb-down") {
        m.groundVisits++
        // Move radially away from the trunk before enabling normal ground collision.
        m.start.copy(agent.position)
        m.end.copy(m.branch.approach)
        enter(agent, m, "ground-walk", 0.8, "explore")
        agent.path = []
        agent.pathIndex = 0
      } else {
        if (m.end.y < m.branch.base.y - 0.1) {
          m.start.copy(agent.position)
          branchFootPoint(m.branch, 0, m.end)
          m.time = 0
          m.duration = Math.max(0.8, (m.end.y - m.start.y) / 0.65)
        } else {
          m.branchT = 0
          walkBranch(agent, m, 0.85, "idle")
        }
      }
      break
    }
    case "ground-walk":
    case "ground-run": {
      if (m.duration === 0.8 && !agent.path.length) {
        agent.position.copy(m.start).lerp(m.end, Math.min(1, m.time / 0.8))
        agent.position.y = groundHeight(agent.position.x, agent.position.z)
        if (m.time >= 0.8) enter(agent, m, "ground-idle", 1.4, "observe")
      } else if (moveGround(agent, dt, m.phase === "ground-run" ? 1.7 : 0.65) || m.time > 12) {
        enter(agent, m, "ground-idle", 1.5 + agent.rng() * 3, agent.rng() < 0.4 ? "eat" : "rest")
      }
      break
    }
    case "ground-idle": {
      if (m.time < m.duration) break
      agent.decisions++
      // Grooming is the macaque's social glue: an idle monkey on the ground
      // seeks out another resting nearby, sits behind it and works its fur.
      if (!storm && m.sinceGroom > 6) {
        let partner: AnimalAgent | null = null
        let best = 6
        for (const other of neighbors) {
          if (other === agent || other.species !== "monkey" || !groomable(other)) continue
          const d = other.position.distanceTo(agent.position)
          if (d < best) { best = d; partner = other }
        }
        if (partner && agent.rng() < 0.55 && avatarRT().pos.distanceTo(partner.position) > 1.6) {
          const side = agent.rng() < 0.5 ? -1 : 1
          groomSeat(partner, side, point)
          if (planGround(agent, point)) {
            // the partner settles and waits, facing away, for the groomer
            startBout(partner, getMonkeyMotion(partner), "groomee", agent, 12)
            m.partner = partner
            m.groomRole = "groomer"
            agent.targetAnimalId = partner.id
            enter(agent, m, "groom-approach", 10, "socialize")
            break
          }
        }
      }
      if (agent.rng() < 0.48 || storm) {
        const choices = MONKEY_BRANCHES.filter((branch) => branch.approach.distanceTo(agent.position) < 7)
        m.branch = choices[Math.floor(agent.rng() * choices.length)] ?? m.branch
        if (planGround(agent, m.branch.approach)) enter(agent, m, "approach-tree", 15, "explore")
        else enter(agent, m, "ground-idle", 1, "observe")
      } else {
        let social: AnimalAgent | null = null
        for (const other of neighbors) {
          if (other !== agent && other.species === "monkey" && Math.abs(other.position.y - groundHeight(other.position.x, other.position.z)) < 0.2 && other.position.distanceTo(agent.position) < 5) social = other
        }
        const angle = agent.rng() * Math.PI * 2
        const radius = 1.2 + agent.rng() * 2
        point.set(agent.position.x + Math.sin(angle) * radius, 0, agent.position.z + Math.cos(angle) * radius)
        if (social) point.copy(agent.position).sub(social.position).normalize().multiplyScalar(0.8).add(social.position)
        point.y = groundHeight(point.x, point.z)
        const run = avatarRT().pos.distanceTo(agent.position) < 2 || agent.rng() < 0.3
        agent.targetAnimalId = social?.id ?? null
        if (planGround(agent, point)) enter(agent, m, run ? "ground-run" : "ground-walk", 12, social ? "socialize" : "explore")
        else enter(agent, m, "ground-idle", 1, "observe")
      }
      break
    }
    case "groom-approach": {
      const partner = m.partner
      const o = partner ? getMonkeyMotion(partner) : null
      if (!partner || !o || o.partner !== agent || o.phase !== "grooming" || storm || m.time > m.duration) {
        endGroom(agent, m)
        break
      }
      if (moveGround(agent, dt, 0.65)) {
        const duration = GROOM_BOUT[0] + agent.rng() * (GROOM_BOUT[1] - GROOM_BOUT[0])
        startBout(agent, m, "groomer", partner, duration)
        // the groomee's bout is the groomer's: they finish together
        o.time = 0
        o.duration = duration
      }
      break
    }
    case "grooming": {
      const partner = m.partner
      const o = partner ? getMonkeyMotion(partner) : null
      if (!partner || !o || o.partner !== agent || storm) {
        endGroom(agent, m)
        break
      }
      // The avatar coming close breaks the bout up; they part calmly.
      if (avatarRT().pos.distanceTo(agent.position) < 1.1) {
        endGroom(agent, m)
        break
      }
      const toPartner = Math.atan2(partner.position.x - agent.position.x, partner.position.z - agent.position.z)
      if (m.groomRole === "groomer" && o.phase === "grooming") {
        // sit facing the partner's back, turning on the spot to keep it in front
        agent.heading = dampAngle(agent.heading, toPartner, 6, dt)
      } else if (m.groomRole === "groomee" && o.phase === "grooming") {
        // present the back: settle, turned away from the groomer's hands
        agent.heading = dampAngle(agent.heading, toPartner + Math.PI, 2.5, dt)
      }
      if (m.groomRole === "groomee" && m.time > m.duration + 15) {
        endGroom(agent, m)
        break
      }
      if (m.time < m.duration || m.groomRole !== "groomer") break
      // Reciprocity: most bouts swap once. The groomee turns its back on
      // the old groomer's side and the old groomer turns to it in turn.
      if (m.groomTurns === 0 && agent.rng() < 0.6) {
        const duration = GROOM_BOUT[0] + agent.rng() * (GROOM_BOUT[1] - GROOM_BOUT[0])
        m.groomTurns = o.groomTurns = 1
        m.groomRole = "groomee"
        o.groomRole = "groomer"
        m.time = o.time = 0
        m.duration = o.duration = duration
      } else endGroom(agent, m)
      break
    }
    case "approach-tree": {
      if (moveGround(agent, dt, 0.85)) {
        // First reach the bark at ground height, then ascend along that bark.
        m.start.copy(agent.position)
        m.end.copy(m.branch.base)
        m.end.y = groundHeight(m.end.x, m.end.z)
        enter(agent, m, "climb-up", 0.75, "explore")
      } else if (m.time > m.duration) enter(agent, m, "ground-idle", 1.3, "observe")
      break
    }
  }
  agent.velocity.copy(agent.position).sub(previous).divideScalar(dt)
  agent.speed = agent.velocity.length()
  agent.moving = agent.speed > 0.025
  agent.distanceTravelled += agent.position.distanceTo(previous)
}

/** QA: seat two monkeys on the ground and start a grooming bout between them now. */
export const forceGroomBout = (groomer: AnimalAgent, groomee: AnimalAgent, at: THREE.Vector3): void => {
  const gm = getMonkeyMotion(groomer)
  const em = getMonkeyMotion(groomee)
  groomee.position.set(at.x, groundHeight(at.x, at.z), at.z)
  groomSeat(groomee, 1, groomer.position)
  groomer.heading = Math.atan2(groomee.position.x - groomer.position.x, groomee.position.z - groomer.position.z)
  gm.partner = em.partner = null
  startBout(groomee, em, "groomee", groomer, 30)
  startBout(groomer, gm, "groomer", groomee, 30)
  gm.groomTurns = em.groomTurns = 0
}

/** QA: walk to the tip and leap to a neighbouring bough as soon as possible. */
export const forceMonkeyLeap = (agent: AnimalAgent): boolean => {
  const m = getMonkeyMotion(agent)
  if (m.phase !== "branch-idle" && m.phase !== "branch-walk") return false
  const candidates = nearbyBranches(m.branch)
  if (!candidates.length) return false
  m.destination = candidates[0]
  m.lastChoice = "jump"
  walkBranch(agent, m, 0.98, "jump")
  return true
}
