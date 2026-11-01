import * as THREE from "three"
import { characterRT, companionRT, playerRT, worldRT, type AvatarBody, type CharacterId } from "../runtime"
import { explorerMotionRT } from "../characters/ExplorerCharacter"
import { companionMotionRT } from "../characters/CompanionCharacter"
import { qualityRT } from "../../state/qualityStore"
import { nightBlend } from "../environment/celestialLighting"
import { waterSurfaceAt } from "../../world/waterSurface"
import { emitRipple, emitSplash } from "../../world/render/waterFx"
import { emitWaterWake, wakeClock } from "../../world/render/waterWake"
import { emit, rand, Shape } from "./lumenCore"

/**
 * Strong swimmers in real water. When the explorer or the companion swims, the water
 * answers: the lake surface itself rises in rings of wave behind them (the
 * same shader wake the flying pegasus leaves), a bow wave of spray breaks at
 * the chest, ripples run out ahead, the kicks churn spray up behind, a white
 * foam wake spreads out, and a sprint starts with a splash and a surge.
 */

type Aura = { wake: number; ripple: number; bow: number; aura: number; glow: number; sprint: boolean; spin: number }
const auras: Record<CharacterId, Aura> = {
  explorer: { wake: 0, ripple: 0, bow: 0, aura: 0, glow: 0, sprint: false, spin: 0 },
  companion: { wake: 0, ripple: 0, bow: 0, aura: 0, glow: 0, sprint: false, spin: Math.PI },
}
const SPRAY = new THREE.Color("#eaf4f8")
const FOAM = new THREE.Color("#f2f6f7")
/** faster than her cruise: the sprint has begun */
const SPRINT_SPEED = 4.2

const swimmer = (id: CharacterId): { body: AvatarBody; swimming: boolean } => {
  const body = id === "explorer" ? playerRT : companionRT
  const motion = id === "explorer" ? explorerMotionRT : companionMotionRT
  const present = id === "explorer" || characterRT.companionPresent
  return { body, swimming: present && motion.water === "swim" && motion.swim > 0.5 && body.rideY === null }
}

export const stepSwimAura = (dt: number): void => {
  if (worldRT.introActive) return
  const scale = qualityRT.profile.particles
  const night = nightBlend(worldRT.timeOfDay)
  for (const id of ["explorer", "companion"] as const) {
    const a = auras[id]
    const { body, swimming } = swimmer(id)
    if (!swimming) { a.sprint = false; continue }
    const surface = waterSurfaceAt(body.pos.x, body.pos.z)
    if (surface === null) continue
    const speed = body.speed
    const fx = Math.sin(body.facing), fz = Math.cos(body.facing)
    const moving = speed > 0.5
    const power = Math.min(1, speed / 6.8)

    // the surface itself moves: rings of wave in the lake shader
    // gentle rings (the shader's crests turn to foam where rings overlap; the
    // pegasus skim needs strong ones, a swimmer a soft swell)
    a.wake -= dt
    if (moving && a.wake <= 0) {
      a.wake = THREE.MathUtils.lerp(0.8, 0.5, power)
      emitWaterWake(body.pos.x - fx * 0.4, body.pos.z - fz * 0.4, 0.12 + 0.18 * power, wakeClock.now)
    }
    // ripples running out ahead of her
    // (sparse and small at speed: stacked rings read as painted bands, not water;
    // the lake's own wave rings, the foam and the spray carry a fast wake)
    a.ripple -= dt
    if (a.ripple <= 0) {
      a.ripple = moving ? 0.6 : 0.9
      emitRipple(body.pos.x + fx * 0.5, body.pos.z + fz * 0.5, 0.7 + Math.min(speed, 3) * 0.15, moving ? 1.1 : 2.2)
    }
    // a sprint begins with a splash and a ring of light on the water
    const sprint = speed > SPRINT_SPEED
    if (sprint && !a.sprint) {
      emitSplash(body.pos.x, body.pos.z, 0.8)
      emitWaterWake(body.pos.x, body.pos.z, 0.45, wakeClock.now)
    }
    a.sprint = sprint

    // the bow wave: spray breaking at her chest, thrown out to both sides
    a.bow += dt * (moving ? 10 + 40 * power : 0) * scale
    while (a.bow > 1) {
      a.bow -= 1
      const side = Math.random() < 0.5 ? -1 : 1
      const x = body.pos.x + fx * 0.55 + fz * side * 0.18, z = body.pos.z + fz * 0.55 - fx * side * 0.18
      const out = rand(0.6, 1.6) * (0.5 + power)
      emit({ x, y: surface + 0.06, z, vx: fz * side * out + fx * speed * 0.35, vy: rand(0.6, 1.6) * (0.6 + power), vz: -fx * side * out + fz * speed * 0.35, life: rand(0.4, 0.75), color: SPRAY, intensity: 1.1 + 0.6 * night, size: rand(0.012, 0.022), drag: 0.8, gravity: 9.8, shape: Shape.Streak, stretch: 0.03 })
    }

    // churned water: the kicks throw up spray behind her
    a.spin += dt * (1.6 + power * 3)
    a.aura += dt * (moving ? 6 + 26 * power : 0) * scale
    while (a.aura > 1) {
      a.aura -= 1
      const back = rand(0.55, 0.95)
      emit({ x: body.pos.x - fx * back + rand(-0.15, 0.15), y: surface + 0.04, z: body.pos.z - fz * back + rand(-0.15, 0.15), vx: rand(-0.4, 0.4) - fx * speed * 0.1, vy: rand(0.8, 1.9) * (0.5 + power), vz: rand(-0.4, 0.4) - fz * speed * 0.1, life: rand(0.35, 0.6), color: SPRAY, intensity: 1 + 0.4 * night, size: rand(0.01, 0.018), drag: 0.9, gravity: 9.8, shape: Shape.Streak, stretch: 0.025 })
    }

    // the foam wake: a white trail of broken water spreading behind her
    a.glow += dt * (moving ? 10 + 30 * power : 1.5) * scale
    while (a.glow > 1) {
      a.glow -= 1
      const back = rand(0.5, 1.6)
      const spread = 0.12 + back * 0.22
      emit({ x: body.pos.x - fx * back + fz * rand(-spread, spread), y: surface + 0.025, z: body.pos.z - fz * back - fx * rand(-spread, spread), vx: rand(-0.12, 0.12), vy: 0, vz: rand(-0.12, 0.12), life: rand(1.4, 2.4), color: FOAM, intensity: 0.55 + 0.25 * night, size: rand(0.05, 0.1), drag: 1.4, gravity: 0, shape: Shape.Mote, curl: 0.05 })
    }
  }
}
