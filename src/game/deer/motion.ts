import { groundHeight } from "../world-layout"
import { waterSurfaceAt } from "../../world/waterSurface"
import { pushMountCircle, mountObstacleTop } from "../horses/horseMotion"
import { SPECIES } from "./species"
import { WATER_WAYS, creatureWaterY, type WaterWay } from "../../world/creatureWater"
import type { DeerState } from "./state"

const push = { dx: 0, dz: 0 }
/** A deer's way with water, sized to its own species (a muntjac or a moose). */
const ways = new Map<string, WaterWay>()
export const deerWay = (d: DeerState): WaterWay => {
  let w = ways.get(d.ident.species)
  if (!w) { w = { ...WATER_WAYS.deer, shoulder: SPECIES[d.ident.species].height * 0.92, mass: Math.min(1, SPECIES[d.ident.species].height / 1.9) }; ways.set(d.ident.species, w) }
  return w
}
export const deerProbe = (d: DeerState, heading: number, distance: number): number => {
  const x = d.x + Math.sin(heading) * distance,
    z = d.z + Math.cos(heading) * distance
  const radius = SPECIES[d.ident.species].height * d.ident.scale * 0.22
  if (pushMountCircle(x, z, radius, push)) return 1
  const g = groundHeight(x, z),
    water = waterSurfaceAt(x, z)
  return Math.abs(g - d.y) / Math.max(0.5, distance) > 0.62 ||
    (water !== null && water - g > SPECIES[d.ident.species].height * d.ident.scale * 0.42)
    ? 1
    : 0
}
export const deerJump = (d: DeerState): "ok" | "refuse" | "busy" => {
  if (d.jumpT >= 0 || d.jumpCool > 0 || d.wade > 0.4) return "busy"
  if (d.ident.species === "yak") return "refuse"
  const height = SPECIES[d.ident.species].height * d.ident.scale
  let need = 0
  for (let t = 0.6; t < Math.max(2, d.speed * 0.85); t += 0.4) {
    const x = d.x + Math.sin(d.heading) * t,
      z = d.z + Math.cos(d.heading) * t
    need = Math.max(need, mountObstacleTop(x, z, height * 0.22) - d.y, groundHeight(x, z) - d.y)
    if (need > height * 0.9) return "refuse"
  }
  // a deer is a spring: the more agile the species, the higher and quicker the bound
  const agility = SPECIES[d.ident.species].agility
  d.jumpT = 0
  d.jumpDur = 0.86 / Math.sqrt(agility)
  d.jumpH = Math.max(0.7 * agility, need + 0.25)
  return "ok"
}
export const stepDeerMotion = (d: DeerState, dt: number, turn: number | null): void => {
  const p = SPECIES[d.ident.species],
    s = d.ident.scale,
    height = p.height * s
  d.jumpCool = Math.max(0, d.jumpCool - dt)
  if (d.jumpT >= 0) {
    d.jumpT += dt / d.jumpDur
    d.jumpY = Math.sin(Math.min(1, d.jumpT) * Math.PI) * d.jumpH
    if (d.jumpT >= 1) {
      d.jumpT = -1
      d.jumpY = 0
      d.jumpCool = 0.1
    }
  }
  const desired =
    turn === null
      ? Math.abs(d.targetSpeed) > 0.02
        ? Math.atan2(
            Math.sin(Math.atan2(d.tx - d.x, d.tz - d.z) - d.heading),
            Math.cos(Math.atan2(d.tx - d.x, d.tz - d.z) - d.heading),
          ) * 2
        : 0
      : turn * 2.1
  const limit = p.agility * (d.ident.rare ? 1.12 : 1) * Math.min(2.2, 3.3 / (1 + Math.abs(d.speed) * 0.19))
  d.turnRate += (Math.max(-limit, Math.min(limit, desired)) - d.turnRate) * (1 - Math.exp(-dt * 6))
  d.heading += d.turnRate * dt
  const old = d.speed,
    // swimming is a steady paddle (~1.1 m/s for a white-tail; faster ridden)
    target = d.swim > 0.4 ? Math.sign(d.targetSpeed) * Math.min(Math.abs(d.targetSpeed), d.rider ? d.pose.speeds[1] * 0.6 : deerWay(d).swimSpeed) : d.targetSpeed
  const change = (target > old ? 3.8 : 6) * p.agility * dt
  d.speed += Math.max(-change, Math.min(change, target - old))
  d.accel = (d.speed - old) / Math.max(0.001, dt)
  const length = height * (d.ident.species === "yak" ? 0.95 : 0.7),
    radius = height * (d.ident.species === "yak" ? 0.29 : 0.2)
  // Substeps bound travel even during a low-frequency distant update.
  const steps = Math.max(1, Math.ceil((Math.abs(d.speed) * dt) / 0.3))
  for (let i = 0; i < steps; i++) {
    let x = d.x + (Math.sin(d.heading) * d.speed * dt) / steps,
      z = d.z + (Math.cos(d.heading) * d.speed * dt) / steps
    for (const o of [-length * 0.4, 0, length * 0.4]) {
      if (
        pushMountCircle(
          x + Math.sin(d.heading) * o,
          z + Math.cos(d.heading) * o,
          radius,
          push,
          d.jumpT >= 0 ? d.y + d.jumpY : undefined,
        )
      ) {
        x += push.dx
        z += push.dz
        d.blocked += dt / steps
      }
    }
    const g = groundHeight(x, z),
      water = waterSurfaceAt(x, z)
    // deer are buoyant, strong swimmers: deep water is crossed, not refused
    const bedFrom = d.swim > 0.3 ? groundHeight(d.x, d.z) : d.y
    if (Math.abs(g - bedFrom) > 0.45 && Math.abs(g - bedFrom) / Math.max(0.25, Math.hypot(x - d.x, z - d.z)) > 0.7 && !(water !== null && d.swim > 0.3)) {
      d.speed *= 0.3
      d.blocked += dt / steps
      break
    }
    d.x = x
    d.z = z
    d.y = g
    d.wade = water === null ? 0 : Math.max(0, water - g)
    const w = creatureWaterY(x, z, deerWay(d), s, g)
    d.swim += (w.swim - d.swim) * (1 - Math.exp(-dt / steps * 3))
    if (w.swim > 0) d.y = g + (w.y - g) * Math.min(1, d.swim * 1.4)
  }
  d.blocked = Math.max(0, d.blocked - dt * 0.3)
  // deer never tire either: a bolt or a ride lasts as long as it is wanted
  d.stamina = 1

}
