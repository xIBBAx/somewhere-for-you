import { WATER_WAYS, pickWaterSpot, waterInvitation, waterUnwelcoming } from "../../world/creatureWater"
import { worldRT } from "../runtime"
import { SPECIES } from "./species"
import { observePerson } from "./relationships"
import { routineAt } from "./population"
import type { DeerMode, DeerState } from "./state"
import type { CharacterId } from "../runtime"
import { deerProbe, deerWay } from "./motion"

export type DeerPerson = { id: CharacterId; x: number; z: number; vx: number; vz: number; speed: number }
export type DeerContext = { time: number; people: DeerPerson[]; rain: number; thunder: number }
export const deerMode = (d: DeerState, mode: DeerMode): void => {
  if (d.mode !== mode) {
    d.mode = mode
    d.modeTime = 0
    if (mode !== "drink") d.bathe = 0
  }
}
/** Snapshot propagation avoids order-dependent domino alarms. The bounded
 * active population exchanges signals only within sight/call distance. */
export const shareDeerSignals = (animals: readonly DeerState[]): number => {
  let warnings = 0
  for (const d of animals) {
    const previous = d.protect
    d.socialAlarm = 0
    d.protect = 0
    for (const other of animals) {
      if (other === d) continue
      const dist = Math.hypot(other.x - d.x, other.z - d.z)
      if (dist > 22) continue
      const family = other.ident.mother === d.ident.id
      const herd = other.ident.herd === d.ident.herd
      const signal = other.alarm * Math.max(0, 1 - dist / 22) * (herd ? 0.65 : 0.24)
      d.socialAlarm = Math.max(d.socialAlarm, signal)
      if (family && other.alarm > 0.5 && dist < 18) {
        d.protect = other.alarm
        d.watchX = other.watchX
        d.watchZ = other.watchZ
      }
    }
    if (previous <= 0.5 && d.protect > 0.5) warnings++
  }
  return warnings
}
export const stepDeerBrain = (
  d: DeerState,
  ctx: DeerContext,
  dt: number,
  animals: ReadonlyMap<string, DeerState>,
): void => {
  d.modeTime += dt
  d.react = Math.max(0, d.react - dt)
  d.affection = Math.max(0, d.affection - dt)
  if (d.rider) {
    deerMode(d, "ridden")
    return
  }
  const p = SPECIES[d.ident.species]
  let nearest: DeerPerson | null = null,
    distance = Infinity,
    threat = false,
    calm = false
  for (const person of ctx.people) {
    const dx = d.x - person.x,
      dz = d.z - person.z,
      dist = Math.hypot(dx, dz)
    const approach = (person.vx * dx + person.vz * dz) / Math.max(0.01, dist)
    const response = observePerson(d.relationships[person.id], d.ident, dist, person.speed, approach, dt, ctx.time)
    if (response === "threat") threat = true
    if (dist < distance) {
      distance = dist
      nearest = person
      calm = response === "calm"
    }
  }
  const rel = nearest ? d.relationships[nearest.id] : null
  const fear = rel?.fear ?? 0
  const startle = Math.max(fear, d.socialAlarm, ctx.thunder * 0.65)
  d.alarm += (startle - d.alarm) * (1 - Math.exp(-dt * (startle > d.alarm ? 3 : 0.4)))
  if (nearest && distance < 24) {
    d.watchX = nearest.x
    d.watchZ = nearest.z
  }
  if (d.debugMode) {
    deerMode(d, d.debugMode)
    d.targetSpeed = d.debugSpeed ?? 0
    return
  }
  if (
    d.protect > 0.5 &&
    distance < 13 &&
    !calm &&
    d.ident.age === "adult" &&
    d.ident.traits.protective > 0.45 &&
    distance > 3
  ) {
    deerMode(d, "protect")
  } else if (d.alarm > 0.62 || threat) {
    deerMode(d, d.ident.age === "fawn" && p.hidesYoung && distance > 4 ? "hide" : "flee")
  } else if (d.protect > 0.5 && distance < 13 && !calm && (rel?.trust ?? 0) < 0.65) {
    deerMode(d, "protect")
  } else if (d.affection > 0) {
    deerMode(d, "affection")
  } else if (d.alarm > 0.25 || (distance < 3 && (rel?.trust ?? 0) < 0.3)) {
    deerMode(d, "retreat")
  } else if (nearest && distance < 11 && (rel?.trust ?? 0) > 0.18 && d.ident.traits.curious > 0.35 && d.modeTime > 4) {
    deerMode(d, "curious")
  } else if (nearest && distance < 14 && (rel?.trust ?? 0) < 0.15 && d.modeTime > 7) {
    deerMode(d, "alert")
  } else if ((d.modeTime > 8 && d.bathe === 0) || ["flee", "retreat", "protect", "hide", "affection"].includes(d.mode)) {
    const coarse = routineAt(d.home, ctx.time)
    deerMode(d, coarse.mode)
    d.tx = coarse.x
    d.tz = coarse.z
    if (ctx.rain > 0.6) {
      d.tx = d.home.shelterX
      d.tz = d.home.shelterZ
      deerMode(d, "walk")
    }
    if (d.ident.age === "fawn" && d.ident.traits.playful > 0.7 && d.modeTime > 14 && d.alarm < 0.1) deerMode(d, "play")
  }
  if (d.mode === "flee" || d.mode === "retreat") {
    const dx = d.x - d.watchX,
      dz = d.z - d.watchZ,
      len = Math.hypot(dx, dz) || 1
    d.tx = d.x + (dx / len) * 10
    d.tz = d.z + (dz / len) * 10
    d.targetSpeed = d.mode === "flee" ? d.pose.speeds[2] : d.pose.speeds[0]
  } else if ((d.mode === "curious" || d.mode === "affection") && nearest) {
    const stop = d.mode === "affection" ? 1.25 : (rel?.trust ?? 0) > 0.5 ? 2.9 : 3.7
    d.tx = nearest.x
    d.tz = nearest.z
    d.targetSpeed = distance > stop ? d.pose.speeds[0] * 0.55 : 0
  } else if (d.mode === "protect") {
    d.tx = d.watchX
    d.tz = d.watchZ
    d.targetSpeed = distance > 5 ? d.pose.speeds[0] * 0.65 : 0
  } else if (d.mode === "walk" || d.mode === "play") {
    const mother = d.ident.mother ? animals.get(d.ident.mother) : null
    if (mother && (!p.hidesYoung || d.mode === "play")) {
      d.tx = mother.x + 2
      d.tz = mother.z + 1
    }
    d.targetSpeed = Math.hypot(d.tx - d.x, d.tz - d.z) > 1 ? d.pose.speeds[d.mode === "play" ? 1 : 0] : 0
  } else if (d.mode === "drink" && d.bathe === 0 && d.modeTime > 5 && d.modeTime - dt <= 5) {
    // having drunk, on a warm day a deer may wade out to cool its legs (deer
    // are at home in water: they cross lakes and stand in the shallows)
    const invite = waterInvitation(worldRT.timeOfDay)
    d.targetSpeed = 0
    if (!waterUnwelcoming() && Math.random() < WATER_WAYS.deer.love * (0.1 + invite * 1.0)) {
      const way = deerWay(d)
      let spot = null
      for (let k = 0; k < 4 && !spot; k++) spot = pickWaterSpot(d.x, d.z, d.heading + k * Math.PI / 2, { ...way, wade: Math.min(way.wade, 0.4) }, d.ident.scale, false, Math.random)
      if (spot) { d.bathe = 1; d.bankX = d.x; d.bankZ = d.z; d.tx = spot.x; d.tz = spot.z }
    }
  } else if (d.mode === "drink" && d.bathe > 0) {
    if (d.bathe === 2) {
      d.targetSpeed = 0
      if (d.modeTime > 22 || waterUnwelcoming()) { d.bathe = 3; d.tx = d.bankX; d.tz = d.bankZ }
    } else {
      d.targetSpeed = Math.hypot(d.tx - d.x, d.tz - d.z) > 0.7 ? d.pose.speeds[0] * 0.6 : 0
      if (d.targetSpeed === 0 || d.blocked > 1.5) d.bathe = d.bathe === 1 ? 2 : 0
    }
    // the water is where it means to be: no steering around it
    return
  } else d.targetSpeed = 0
  // Personal space belongs to the species and family.
  if (d.targetSpeed > 0 && d.mode !== "flee" && d.mode !== "affection") {
    let sx = 0,
      sz = 0
    for (const o of animals.values()) {
      if (o === d) continue
      const dx = d.x - o.x,
        dz = d.z - o.z,
        l = Math.hypot(dx, dz)
      const space = o.ident.mother === d.ident.id || d.ident.mother === o.ident.id ? 1.5 : p.separation
      if (l > 0.01 && l < space) {
        sx += (dx / l) * (space - l)
        sz += (dz / l) * (space - l)
      }
    }
    const len = Math.hypot(d.tx - d.x, d.tz - d.z) || 1
    d.tx = d.x + ((d.tx - d.x) / len) * 4 + sx
    d.tz = d.z + ((d.tz - d.z) / len) * 4 + sz
  }
  if (d.targetSpeed > 0 && deerProbe(d, Math.atan2(d.tx - d.x, d.tz - d.z), 2) > 0) {
    const sign = deerProbe(d, d.heading + 0.8, 2) <= deerProbe(d, d.heading - 0.8, 2) ? 1 : -1
    d.tx = d.x + Math.sin(d.heading + sign * 1.1) * 4
    d.tz = d.z + Math.cos(d.heading + sign * 1.1) * 4
    if (d.blocked > 2) {
      d.targetSpeed = 0
      deerMode(d, "alert")
    }
  }
  // Stay within the home territory unless escaping immediate danger. Family
  // reunion is spatial, never a teleport or a globally propagated alarm.
  if (d.alarm < 0.3 && Math.hypot(d.x - d.home.x, d.z - d.home.z) > p.range) {
    d.tx = d.home.x
    d.tz = d.home.z
    d.targetSpeed = d.pose.speeds[0]
  }
}
