import { groundDashRT } from "./groundDash"
import { registerDevTool } from "../../dev/devTools"
import { worldRT } from "../runtime"
import { horseRT, type HorseState } from "./horseState"
import { setMode } from "./horseBrain"
import { JUMP_DOWN, JUMP_UP, jumpClearance, startJump } from "./horseMotion"
import { riderRT, startMount, requestDismount, callHorse } from "./riding"
import { cameraRT, characterRT } from "../runtime"
import type { HorseMode } from "./horseState"
import { avatarRT } from "../runtime"
import { groundHeight } from "../world-layout"
import { flightWaterSurfaceAt } from "../../world/waterSurface"

/**
 * `?debug` helpers for the horses:
 *   __worldDev.horses()                   list every live horse
 *   __worldDev.horse("Chetak", az?, d?, h?) orbit-look at a horse (azimuth deg, distance m, height m)
 *   __worldDev.horseMode("Chetak", "lie")   force a behaviour (graze, stand, walk, lie, alert, …)
 *   __worldDev.horseSpeed("Chetak", 6)      drive a horse at a speed (m/s) in a slow circle (gait QA)
 *   __worldDev.bringHorse("Chetak")         stand a horse beside the active character (then mount)
 *   __worldDev.deepWater()                 a deep-water point with a long clear run, and its heading
 *   __worldDev.placeMount(x, z, heading)   set the ridden mount down there (on the water if any)
 */
const find = (name: string): HorseState | undefined => [...horseRT.horses.values()].find((h) => h.ident.name.toLowerCase() === name.toLowerCase() || h.ident.id === name)

const deep = (x: number, z: number): boolean => {
  const w = flightWaterSurfaceAt(x, z)
  return w !== null && w - groundHeight(x, z) > 1.2
}

export const installHorseDev = (): void => {
  registerDevTool("bringHorse", ((name: string) => {
    const h = find(name)
    if (!h) return null
    const me = avatarRT()
    const a = me.facing + Math.PI / 2
    h.x = me.pos.x + Math.sin(a) * 1.6
    h.z = me.pos.z + Math.cos(a) * 1.6
    h.y = groundHeight(h.x, h.z)
    h.heading = me.facing
    h.speed = 0
    h.targetSpeed = 0
    return { x: +h.x.toFixed(1), z: +h.z.toFixed(1) }
  }) as never)
  // the nearest deep water to the character with 90 m of open run along some heading
  registerDevTool("deepWater", (() => {
    const me = avatarRT()
    let best: { x: number; z: number; heading: number; d: number } | null = null
    for (let r = 0; r < 1600 && !best; r += 20) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2
        const x = me.pos.x + Math.sin(a) * r, z = me.pos.z + Math.cos(a) * r
        if (!deep(x, z)) continue
        for (let j = 0; j < 8; j++) {
          const hd = (j / 8) * Math.PI * 2
          let ok = true
          for (let s = 6; s <= 90 && ok; s += 6) ok = deep(x + Math.sin(hd) * s, z + Math.cos(hd) * s)
          if (ok) { best = { x, z, heading: hd, d: r }; break }
        }
        if (best) break
      }
    }
    return best && { x: +best.x.toFixed(1), z: +best.z.toFixed(1), heading: +best.heading.toFixed(3), d: best.d }
  }) as never)
  registerDevTool("placeMount", ((x: number, z: number, heading: number) => {
    const h = riderRT[characterRT.active].horse as HorseState | null
    if (!h) return null
    h.x = x
    h.z = z
    const w = flightWaterSurfaceAt(x, z)
    h.y = w ?? groundHeight(x, z)
    h.heading = heading
    // the chase camera behind her, so "forward" keeps her heading
    cameraRT.yaw = cameraRT.targetYaw = heading + Math.PI
    worldRT.snapCamera = true
    return { y: +h.y.toFixed(2), water: w !== null }
  }) as never)
  ;(window as unknown as { __worldHorses?: typeof horseRT }).__worldHorses = horseRT
  registerDevTool("horses", () => [...horseRT.horses.values()].map((h) => ({
    name: h.ident.name, breed: h.ident.breed, coat: h.ident.coat.name, face: h.ident.face, x: +h.x.toFixed(1), z: +h.z.toFixed(1),
    mode: h.mode, speed: +h.speed.toFixed(2), gait: h.animator?.gait, rider: h.rider, stamina: +h.stamina.toFixed(2), visible: h.visible, lod: h.model?.level,
  })))
  registerDevTool("horse", ((name: string, az = 90, d = 4.5, height = 1.4) => {
    const h = find(name)
    if (!h) return null
    const a = h.heading + (az * Math.PI) / 180
    const cam = worldRT.inspectionCamera
    cam.active = true
    cam.follow = false
    cam.px = h.x + Math.sin(a) * d
    cam.pz = h.z + Math.cos(a) * d
    cam.py = h.y + height
    cam.tx = h.x
    cam.ty = h.y + 1.0 * h.ident.scale
    cam.tz = h.z
    return { x: h.x, z: h.z }
  }) as never)
  registerDevTool("horseMode", ((name: string, mode: HorseMode, t = 30) => {
    const h = find(name)
    if (!h) return null
    setMode(h, mode, t)
    return h.mode
  }) as never)
  registerDevTool("mount", ((name: string) => {
    const h = find(name)
    if (!h) return null
    const id = characterRT.active
    return startMount(id, h)
  }) as never)
  registerDevTool("dismount", (() => requestDismount(characterRT.active)) as never)
  registerDevTool("callHorse", (() => callHorse(characterRT.active)?.ident.name ?? null) as never)
  registerDevTool("rideCruise", ((level: 1 | 2 | 3) => { riderRT[characterRT.active].cruise = level; return level }) as never)
  registerDevTool("rider", (() => {
    const r = riderRT[characterRT.active]
    return { phase: r.phase, horse: r.horse?.ident.name ?? null, cruise: r.cruise, speed: r.horse ? +r.horse.speed.toFixed(2) : 0, target: r.horse ? +r.horse.targetSpeed.toFixed(2) : 0, shiftTime: +r.shiftTime.toFixed(2), surge: +groundDashRT.amount.toFixed(2), gait: r.horse?.animator?.gait, riders: Object.fromEntries(Object.entries(riderRT).map(([id, rider]) => [id, { phase: rider.phase, seat: rider.seat, horse: rider.horse?.ident.name ?? null }])), stamina: r.horse ? +r.horse.stamina.toFixed(2) : 0 }
  }) as never)
  registerDevTool("horsePhase", ((name: string, gait: number | null, phase = 0) => {
    const h = find(name)
    if (!h?.animator) return null
    h.animator.debug = gait === null ? null : { gait, phase }
    const p = h.pose
    p.graze = p.drink = p.alert = p.restLeg = p.lie = p.lieSide = p.rising = p.look = 0
    h.debugSpeed = gait === null ? null : 0
    if (gait !== null) h.speed = h.pose.speeds[gait]
    return h.animator.debug
  }) as never)
  // model-space hoof positions of a horse right now (QA of footfall sweep)
  registerDevTool("hooves", ((name: string) => {
    const h = find(name)
    if (!h?.model) return null
    const out: Record<string, number[]> = {}
    for (const b of ["hoofFL", "hoofFR", "hoofBL", "hoofBR"]) {
      const bone = h.model.bones.get(b)
      if (!bone) continue
      const v = bone.getWorldPosition(new (bone.position.constructor as typeof import("three").Vector3)())
      h.model.root.worldToLocal(v)
      out[b] = [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]
    }
    return out
  }) as never)
  registerDevTool("legs", ((name: string, side = "L") => {
    const h = find(name)
    if (!h?.model) return null
    const out: Record<string, number[]> = {}
    for (const b of [`femur${side}`, `tibia${side}`, `cannonB${side}`, `pasternB${side}`, `hoofB${side}`, `humerus${side}`, `radius${side}`, `cannonF${side}`, `pasternF${side}`, `hoofF${side}`]) {
      const bone = h.model.bones.get(b)
      if (!bone) continue
      const v = bone.getWorldPosition(new (bone.position.constructor as typeof import("three").Vector3)())
      h.model.root.worldToLocal(v)
      out[b] = [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]
    }
    return out
  }) as never)
  registerDevTool("legTargets", ((name: string) => find(name)?.animator?.dbg ?? null) as never)
  registerDevTool("horseSolo", ((name: string | null) => {
    for (const h of horseRT.horses.values()) h.soloHidden = name !== null && h.ident.name !== name
    return name
  }) as never)
  // freeze a horse at a point of a jump (0..1) cantering in place, or null
  registerDevTool("jumpPose", ((name: string, t: number | null) => {
    const h = find(name)
    if (!h?.animator) return null
    if (t === null) { h.jumpT = -1; h.jumpY = 0; h.animator.debug = null; h.debugSpeed = null; return null }
    h.animator.debug = { gait: 2, phase: 0.3 }
    h.jumpH = jumpClearance(h)
    h.jumpT = t
    const a = (t - JUMP_UP) / (JUMP_DOWN - JUMP_UP)
    h.jumpY = a > 0 && a < 1 ? h.jumpH * 4 * a * (1 - a) : 0
    return { t, y: +h.jumpY.toFixed(2) }
  }) as never)
  registerDevTool("jump", (() => {
    const h = riderRT[characterRT.active].horse
    if (!h || h.kind !== "horse") return "no horse"
    return { res: startJump(h as HorseState), jumpT: h.jumpT, cool: h.jumpCool, wade: h.wade, speed: h.speed, clear: jumpClearance(h as HorseState) }
  }) as never)
  registerDevTool("horsesVisible", ((on: boolean) => { horseRT.hidden = !on; return on }) as never)
  registerDevTool("groundDash", ((on: boolean) => { groundDashRT.qa = on; return on }) as never)
  registerDevTool("horseSpeed", ((name: string, speed: number | null) => {
    const h = find(name)
    if (!h) return null
    h.debugSpeed = speed
    return speed
  }) as never)
}
