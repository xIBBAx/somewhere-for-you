import * as THREE from "three"
import { mountDrivers, type MountBody } from "../mounts/mount"
import { resolveCollisions } from "../movement"
import { avatarRT, cameraRT, characterRT, companionRT, input, playerRT, takeAction, type AvatarBody, type CharacterId } from "../runtime"
import { buildColliders, groundHeight } from "../world-layout"
import { pushOutOfScatter } from "../../world/colliders"
import { CHUNK_SIZE } from "../../world/worldConfig"
import { waterSurfaceAt } from "../../world/waterSurface"
import { aiIntents } from "../characters/controller/avatarController"
import type { LocomotionIntent } from "../characters/controller/locomotion"
import { horseById, horseRT, fwdX, fwdZ, type HorseState } from "./horseState"
import { setMode } from "./horseBrain"
import { probeAhead, standable, startJump, stepHorseMotion } from "./horseMotion"
import { useGame } from "../../state/gameStore"
import { horseSounds } from "./horseAudio"
import { skipJourney, travelling, travelRT } from "../celestial/cosmicTravel"
import { groundDashKind, groundDashRT, SURGE, SURGE_AFTER } from "./groundDash"
import { autopilot, cancelLanding, clearLanding, flightQA, groundNow, isAirborne, requestGallopLanding, startTakeoff, stepFlight, type FlightIntent } from "../pegasus/flight"
import { sailRT, startStarPirouette } from "../celestial/starSail"
import { spaceRT } from "../celestial/spaceState"
import { inRealm, sameWorld } from "../../world/realmHook"
import { DATUM_Y, SAIL_ALTITUDE } from "../celestial/scale"
import { isPegasus, isTandem, pegasusRT } from "../pegasus/pegasi"
import { makeRollTap, rollTap } from "../pegasus/skills"
import { keyTrick, makeTrickTaps, tryTrick, type TrickRequest, type TrickTaps } from "../pegasus/aerobatics"
import { names } from "../../personalization"

/**
 * Riding for the explorer and the companion.
 *
 * Mounting follows real horsemanship: the rider steps to the near (left) side
 * by the shoulder, takes the reins, puts the left foot in the stirrup, springs
 * up, swings the right leg over the croup and settles into the saddle; they
 * use the off side only when the near side is blocked. Dismounting reverses
 * it onto whichever side has room (never into a trunk, a wall or the water).
 *
 * Controls (desktop): W asks the horse to move off at its cruising gait,
 * A/D steer, S slows and stops (held at a standstill, it backs up), a tap on
 * Shift spurs up a gait (walk, trot, canter) and holding Shift gallops; E
 * gets off, B pats the neck. Touch: the stick steers relative to the camera
 * and its deflection picks walk or the cruising gait; Run gallops.
 *
 * The other character, when riding, keeps you company: side by side when
 * there is room, behind when there is not, matching your pace and stopping
 * when you stop. When you ride off and they are on foot, they whistle up
 * their own horse and mount it.
 */

export type RidePhase = "none" | "mounting" | "riding" | "dismounting" | "rejecting"

export type RiderState = {
  id: CharacterId
  phase: RidePhase
  t: number
  horse: MountBody | null
  /** +1 near (left) side, −1 off (right) side */
  side: number
  startX: number
  startY: number
  startZ: number
  startFacing: number
  approach: number
  endX: number
  endZ: number
  cruise: 1 | 2 | 3
  shiftTime: number
  shiftWas: boolean
  sTime: number
  sWas: boolean
  /** waiting to dismount once the horse has slowed */
  wantOff: boolean
  /** Explicit Slow to stop wins over a still-held joystick until released. */
  groundBrake: boolean
  pat: number
  /** companion task: walking to their horse to mount it */
  task: "none" | "toHorse"
  taskTime: number
  /** body revision seen last frame: a teleport resets riding */
  rev: number
  // ---- outputs for the character (logical world space) ----------------------
  rootX: number
  rootY: number
  rootZ: number
  facing: number
  /** 0..1 seated-in-the-saddle weight for the animator */
  ride: number
  /** walking speed to animate during the approach to the stirrup */
  walk: number
  footL: THREE.Vector3
  footR: THREE.Vector3
  handL: THREE.Vector3
  handR: THREE.Vector3
  handW: number
  /** a hand patting the neck (right) */
  patTarget: THREE.Vector3
  /** model-space pelvis offset (posting, two-point) */
  hips: THREE.Vector3
  lean: number
  bank: number
  lookYaw: number
  /** 0..1 folded into the jumping seat */
  jump: number
  jumpBuffer: number
  rejected: boolean
  tumble: number
  /** 0 the front saddle (reins), 1 the rear seat of a tandem saddle */
  seat: 0 | 1
  /** small moments in the saddle: a glance back at the other rider, a look down */
  glanceT: number
  glance: number
}

const makeRider = (id: CharacterId): RiderState => ({
  id, phase: "none", t: 0, horse: null, side: 1, startX: 0, startY: 0, startZ: 0, startFacing: 0, approach: 0, endX: 0, endZ: 0,
  cruise: 1, shiftTime: 0, shiftWas: false, sTime: 0, sWas: false, wantOff: false, groundBrake: false, pat: 0, task: "none", taskTime: 0, rev: -1,
  rootX: 0, rootY: 0, rootZ: 0, facing: 0, ride: 0, walk: 0,
  footL: new THREE.Vector3(), footR: new THREE.Vector3(), handL: new THREE.Vector3(), handR: new THREE.Vector3(), handW: 0,
  patTarget: new THREE.Vector3(), hips: new THREE.Vector3(), lean: 0, bank: 0, lookYaw: 0, jump: 0, jumpBuffer: 0, rejected: false, tumble: 0,
  seat: 0, glanceT: 6, glance: 0,
})

export const riderRT: Record<CharacterId, RiderState> = { explorer: makeRider("explorer"), companion: makeRider("companion") }

/** Each rig's pelvis height above its soles (set by the characters when loaded). */
export const riderMetrics: Record<CharacterId, { hips: number; legs: number }> = {
  explorer: { hips: 0.93, legs: 0.86 },
  companion: { hips: 1.02, legs: 0.95 },
}

export const isMounted = (id: CharacterId): boolean => riderRT[id].phase !== "none"
export const isRiding = (id: CharacterId): boolean => riderRT[id].phase === "riding"

const bodyOf = (id: CharacterId): AvatarBody => (id === "explorer" ? playerRT : companionRT)
const otherOf = (id: CharacterId): CharacterId => (id === "explorer" ? "companion" : "explorer")

const isHorse = (h: MountBody): h is HorseState => h.kind === "horse"
const moveMount = (h: MountBody, dt: number, turn: number | null): void => {
  if (isHorse(h)) {
    // a Pegasus in the air flies; on the ground it moves as any horse
    if (h.flight && stepFlight(h, dt)) return
    stepHorseMotion(h, dt, turn)
  } else mountDrivers.get(h)?.motion(dt, turn)
}
const probeMount = (h: MountBody, heading: number, distance: number): number => isHorse(h) ? probeAhead(h, heading, distance) : mountDrivers.get(h)?.probe(heading, distance) ?? 1
const jumpMount = (h: MountBody): "ok" | "refuse" | "busy" => isHorse(h) ? startJump(h) : mountDrivers.get(h)?.jump() ?? "refuse"
const restMount = (h: MountBody): void => { if (isHorse(h)) setMode(h, "wait", 20); else mountDrivers.get(h)?.rest() }

// ---------------------------------------------------------------- anchors

type Anchors = { seatRest: THREE.Vector3; bitLRest: THREE.Vector3; bitRRest: THREE.Vector3; reinRestRest: THREE.Vector3; seat2Rest?: THREE.Vector3 }
const anchors = new WeakMap<MountBody, Anchors>()

/** Rest-pose (model space) tack anchors the animator poses each frame. */
export const ridingAnchors = (h: MountBody): Anchors | undefined => {
  if (!h.model) return undefined
  let a = anchors.get(h)
  if (!a) {
    const t = h.model.meta.tack
    a = {
      seatRest: new THREE.Vector3(...(t.seat as [number, number, number])),
      bitLRest: new THREE.Vector3(...(t.bitL as [number, number, number])),
      bitRRest: new THREE.Vector3(...(t.bitR as [number, number, number])),
      reinRestRest: new THREE.Vector3(...(t.reinRest as [number, number, number])),
      seat2Rest: t.seat2 ? new THREE.Vector3(...(t.seat2 as [number, number, number])) : undefined,
    }
    anchors.set(h, a)
  }
  return a
}

const ZERO_TILT: { pitch: number; roll: number; spin?: number } = { pitch: 0, roll: 0 }
/** A mount's attitude: flying Pegasi pitch and bank; everything else is level. */
export const mountTilt = (h: MountBody): { pitch: number; roll: number; spin?: number } => (h as HorseState).flight ?? ZERO_TILT
/** Height of the point a flying body pitches and banks about (its centre of mass), world metres. */
export const tiltPivot = (h: MountBody): number => (h.model?.meta.height ?? 1.6) * 0.62 * h.ident.scale
const _te = new THREE.Euler()
const _tq = new THREE.Quaternion()
/** The mount's full rotation (heading, then pitch, then bank). */
export const mountQuaternion = (h: MountBody, out: THREE.Quaternion): THREE.Quaternion => {
  const t = mountTilt(h)
  // a barrel roll (spin) turns the whole body, riders and all, about its long axis
  _te.set(-t.pitch, h.heading, -t.roll - (t.spin ?? 0), "YXZ")
  return out.setFromEuler(_te)
}

/** Horse-local (model, metres) to logical world. */
const toWorld = (h: MountBody, lx: number, ly: number, lz: number, out: THREE.Vector3): THREE.Vector3 => {
  const s = h.ident.scale
  const t = mountTilt(h)
  if (t.pitch === 0 && t.roll === 0 && !t.spin) {
    const c = Math.cos(h.heading)
    const si = Math.sin(h.heading)
    return out.set(h.x + (c * lx + si * lz) * s, h.y + h.jumpY + ly * s, h.z + (-si * lx + c * lz) * s)
  }
  const pv = tiltPivot(h)
  out.set(lx * s, ly * s - pv, lz * s).applyQuaternion(mountQuaternion(h, _tq))
  return out.set(out.x + h.x, out.y + h.y + h.jumpY + pv, out.z + h.z)
}

type TackKey = "seat" | "stirrupL" | "stirrupR" | "pommel" | "seat2" | "stirrupL2" | "stirrupR2"
const tackRest = (h: MountBody, key: TackKey): [number, number, number] => {
  const t = h.model?.meta.tack as Record<string, number[] | undefined> | undefined
  const v = t?.[key] ?? (key.endsWith("2") ? t?.[key.slice(0, -1)] : undefined)
  return (v as [number, number, number] | undefined) ?? (key.startsWith("seat") ? [0, 1.35, 0.1] : key === "pommel" ? [0, 1.42, 0.28] : [key.startsWith("stirrupL") ? 0.3 : -0.3, 0.8, 0.12])
}
/** The tack key for a rider's seat. */
const seatKey = (seat: 0 | 1): "seat" | "seat2" => (seat ? "seat2" : "seat")

/** The posed seat (animator, model space) with the horse's current transform. */
const seatW = (h: MountBody, out: THREE.Vector3, seat: 0 | 1 = 0): THREE.Vector3 => {
  // bareback the rider sits right on the back, a saddle's thickness lower
  const drop = h.ident.saddled ? 0 : 0.05
  const an = h.animator as { seat: THREE.Vector3; seat2?: THREE.Vector3 } | null
  const posed = an ? (seat ? an.seat2 : an.seat) : undefined
  if (posed && (seat === 0 || posed.lengthSq() > 0)) return toWorld(h, posed.x, posed.y - drop, posed.z, out)
  const s = tackRest(h, seatKey(seat))
  return toWorld(h, s[0], s[1], s[2], out)
}
const _seat = new THREE.Vector3()

/** Where a small passenger sits: on the croup just behind the cantle (world). */
export const croupPoint = (h: MountBody, out: THREE.Vector3): THREE.Vector3 => {
  seatW(h, out)
  const back = 0.46 * h.ident.scale * (h.model ? h.model.meta.height / 1.6 : 1)
  out.x -= fwdX(h.heading) * back
  out.z -= fwdZ(h.heading) * back
  out.y -= 0.035
  return out
}

/**
 * Where the cat rides a two-seat mount (Starborn): on the croup behind the last
 * rider, low over the loins where the back is broad and still, clear of the
 * wings at the shoulders and of the riders' backs. With one rider she has
 * the ordinary croup place behind the cantle.
 */
export const catRidePoint = (h: MountBody, out: THREE.Vector3): THREE.Vector3 => {
  const two = !!(h as HorseState).passenger || (riderRT.companion.horse === h && riderRT.companion.seat === 1)
  seatW(h, out, two ? 1 : 0)
  const back = (two ? 0.42 : 0.46) * h.ident.scale * (h.model ? h.model.meta.height / 1.6 : 1)
  // along the body, so she stays on the back however Starborn pitches and banks
  mountQuaternion(h, _tq)
  _catAxis.set(0, 0, 1).applyQuaternion(_tq)
  out.addScaledVector(_catAxis, -back)
  _catAxis.set(0, 1, 0).applyQuaternion(_tq)
  return out.addScaledVector(_catAxis, two ? -0.05 : -0.035)
}
const _catAxis = new THREE.Vector3()

/** Posed stirrup in world space: rides with the saddle (seat) motion. Bareback,
 * the lower legs hang against the barrel instead. */
const stirrup = (h: MountBody, side: number, out: THREE.Vector3, seatNo: 0 | 1 = 0): THREE.Vector3 => {
  const seat = tackRest(h, seatKey(seatNo))
  const st0 = tackRest(h, (side > 0 ? "stirrupL" : "stirrupR") + (seatNo ? "2" : "") as TackKey)
  const st: [number, number, number] = h.ident.saddled ? st0 : [st0[0] * 0.82, st0[1] + 0.12, st0[2] - 0.06]
  toWorld(h, st[0], st[1], st[2], out)
  // the saddle moves with the back; carry the stirrup with the seat's offset
  // (own scratch: mounting passes _a and _b in as `out`)
  toWorld(h, seat[0], seat[1], seat[2], _stA)
  out.add(_stB.copy(seatW(h, _seat, seatNo)).sub(_stA))
  return out
}
const _stA = new THREE.Vector3()
const _stB = new THREE.Vector3()

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _c = new THREE.Vector3()
const colliders = buildColliders()
const spot = { x: 0, z: 0 }

/** Can a person stand at (x, z)? */
const personFits = (x: number, z: number): boolean => {
  spot.x = x
  spot.z = z
  // (feet on the ground here: on a flat roof that is the slab, inside the parapet)
  let hit = resolveCollisions(spot, 0.32, colliders.circles, colliders.rects, { streamed: [], canSwim: false, feetY: groundHeight(x, z) + 0.05, stepUp: 0.05 })
  if (pushOutOfScatter(spot, 0.32, CHUNK_SIZE)) hit = true
  if (hit) return false
  const s = waterSurfaceAt(x, z)
  if (s !== null && s - groundHeight(x, z) > 0.45) return false
  return Math.abs(groundHeight(x, z) - groundHeight(x + 0.3, z)) < 0.25
}

/** Where a rider stands to get on or off on a side, or null if blocked. */
/** How far out from the spine a rider stands to get on or off (model metres;
 * toWorld scales them): wider for a bigger build, and for a winged horse,
 * whose folded wing hangs beside the saddle. */
const standOff = (h: MountBody): number => (isPegasus(h as HorseState) ? 0.86 : 0.68) * ((h.model?.meta.height ?? 1.6) / 1.6) ** 0.5

const sideSpot = (h: MountBody, side: number, seatNo: 0 | 1 = 0): { x: number; z: number } | null => {
  const seat = tackRest(h, seatKey(seatNo))
  const out = standOff(h)
  const p = toWorld(h, side * out, 0, seat[2] + 0.12, _c)
  if (!personFits(p.x, p.z)) return null
  // the ground under the stirrup must be reachable (no ledge to fall down)
  if (Math.abs(groundHeight(p.x, p.z) - h.y) > 0.5) return null
  return { x: p.x, z: p.z }
}

// ---------------------------------------------------------------- start/stop

export type MountResult = "ok" | "busy" | "blocked" | "far" | "small"

/** Someone is climbing on or off: the mount must stand still. */
const boarding = (h: MountBody): boolean => {
  for (const id of ["explorer", "companion"] as const) {
    const r = riderRT[id]
    if (r.horse === h && (r.phase === "mounting" || r.phase === "dismounting" || r.phase === "rejecting")) return true
  }
  return false
}

/** Begin getting on `h`. The near side is preferred, the off side if blocked.
 * On a tandem saddle that already has a rider, the rear seat is taken. */
export const startMount = (id: CharacterId, h: MountBody): MountResult => {
  const r = riderRT[id]
  if (r.phase !== "none") return "busy"
  const hs = h as HorseState
  if (isAirborne(hs)) return "busy"
  // a new ride opens with the chase view, until she turns the camera herself
  if (id === characterRT.active) cameraRT.userHold = false
  const tandem = isTandem(hs)
  const seatNo: 0 | 1 = tandem && h.rider && h.rider !== id && !hs.passenger ? 1 : 0
  if (seatNo === 0 && (h.rider || (h.reservedBy && h.reservedBy !== id))) return "busy"
  if (seatNo === 1 && h.reservedBy && h.reservedBy !== id && h.reservedBy !== h.rider) return "busy"
  const permission = isHorse(h) ? "accept" : mountDrivers.get(h)?.permission(id) ?? "small"
  if (permission === "small") return "small"
  if (h.pose.lie > 0.1) return "busy"
  const body = bodyOf(id)
  const near = sideSpot(h, 1, seatNo)
  const off = sideSpot(h, -1, seatNo)
  // pick the side the rider is on if both are free, else whichever is free
  const lx = Math.cos(h.heading) * (body.pos.x - h.x) - Math.sin(h.heading) * (body.pos.z - h.z)
  let side = 0
  if (near && off) side = lx >= -0.2 ? 1 : -1
  else if (near) side = 1
  else if (off) side = -1
  if (!side) return "blocked"
  const dist = Math.hypot(body.pos.x - h.x, body.pos.z - h.z)
  if (dist > (tandem ? 5.5 : 4.5)) return "far"
  if (seatNo === 1) hs.passenger = id
  else {
    h.reservedBy = id
    h.rider = id
  }
  h.targetSpeed = 0
  if (isHorse(h)) setMode(h, "ridden", 999)
  r.horse = h
  r.seat = seatNo
  r.side = side
  r.rejected = permission === "reject"
  r.tumble = 0
  r.phase = "mounting"
  r.t = 0
  r.startX = body.pos.x
  r.startY = body.pos.y
  r.startZ = body.pos.z
  r.startFacing = body.facing
  const s = (side > 0 ? near : off)!
  r.approach = Math.max(0.2, Math.min(1.6, Math.hypot(s.x - body.pos.x, s.z - body.pos.z) / 1.5))
  r.cruise = 1
  r.wantOff = false
  r.groundBrake = false
  if (isHorse(h)) {
    // (a Pegasus is its own bond: pegasusRT.own; U still calls your horse)
    if (seatNo === 0 && !isPegasus(h)) horseRT.bonded[id] = h.ident.id
    h.persistent = true
    h.trust = Math.max(h.trust, 0.8)
    horseRT.stats.mounts++
    if (h.ident.breed === "starborn") pegasusRT.starbornMet = true
  } else mountDrivers.get(h)?.attempt(id, !r.rejected)
  return "ok"
}

/** Ask to get off. A moving horse is brought to a halt first; a flying
 * Pegasus glides down and lands first. */
export const requestDismount = (id: CharacterId): "ok" | "slowing" | "landing" | "blocked" => {
  const r = riderRT[id]
  const h = r.horse
  if (r.phase !== "riding" || !h) return "blocked"
  const hs = h as HorseState
  // E is always the deliberate stop-and-get-off path. It must never inherit
  // the mounted gallop latch from an earlier R landing (including a passenger).
  if (isHorse(h) && hs.flight) clearLanding(hs)
  if (isAirborne(hs)) {
    r.wantOff = true
    return "landing"
  }
  if (Math.abs(h.speed) > 0.6) {
    r.wantOff = true
    return "slowing"
  }
  const near = sideSpot(h, 1, r.seat)
  const off = near ? null : sideSpot(h, -1, r.seat)
  if (!near && !off) return "blocked"
  const s = (near ?? off)!
  r.side = near ? 1 : -1
  r.endX = s.x
  r.endZ = s.z
  r.phase = "dismounting"
  r.t = 0
  r.wantOff = false
  // sharing a saddle: when the front rider gets off, so does the one behind
  if (r.seat === 0 && hs.passenger) {
    const other = riderRT[hs.passenger]
    if (other.phase === "riding") {
      const opposite = sideSpot(h, -r.side, 1)
      const o = opposite ?? sideSpot(h, r.side, 1)
      if (o) {
        other.side = opposite ? -r.side : r.side
        other.endX = o.x
        other.endZ = o.z
        other.phase = "dismounting"
        other.t = -0.25
        other.wantOff = false
      }
    }
  }
  return "ok"
}

/** R changes locomotion without releasing either seat. */
export const toggleLandGallop = (id: CharacterId): "approach" | "fly" | "slow" | "blocked" => {
  const r = riderRT[id], h = r.horse
  if (r.phase !== "riding" || !h || !isHorse(h) || !h.flight || h.flight.mode === "sail" || travelling()) return "blocked"
  const f = h.flight
  if (f.mode === "ground") {
    if (!f.landing.run) return "blocked"
    f.landing.run = false
    for (const seat of Object.values(riderRT)) if (seat.horse === h) seat.groundBrake = true
    h.targetSpeed = 0
    return "slow"
  }
  // The active tandem passenger has the same controls as the front rider.
  for (const seat of Object.values(riderRT)) if (seat.horse === h) { seat.wantOff = false; seat.groundBrake = false }
  f.intent.land = false
  if (f.landing.style === "gallop" && f.landing.requested) {
    cancelLanding(h)
    return "fly"
  }
  return requestGallopLanding(h) ? "approach" : "blocked"
}

const releaseSeat = (r: RiderState, h: MountBody): void => {
  const hs = h as HorseState
  if (r.seat === 1) {
    if (hs.passenger === r.id) hs.passenger = null
  } else {
    if (h.rider === r.id) h.rider = null
    if (h.reservedBy === r.id) h.reservedBy = null
    // a passenger left alone (seated or still climbing on) moves up to hold the reins
    if (hs.passenger) {
      const p = riderRT[hs.passenger]
      if (p.phase === "riding" || p.phase === "mounting") {
        hs.passenger = null
        h.rider = p.id
        p.seat = 0
      }
    }
  }
}

const finishDismount = (r: RiderState): void => {
  const h = r.horse
  const body = bodyOf(r.id)
  if (h) {
    releaseSeat(r, h)
    if (!h.rider && !(h as HorseState).passenger) {
      h.speed = 0
      h.targetSpeed = 0
      restMount(h)
    }
  }
  body.pos.set(r.endX, groundHeight(r.endX, r.endZ), r.endZ)
  body.vel.set(0, 0, 0)
  body.rideY = null
  body.ridePitch = 0
  body.rideRoll = 0
  body.revision++
  r.rev = body.revision
  r.phase = "none"
  r.horse = null
  r.ride = 0
  r.tumble = 0
  r.rejected = false
  r.handW = 0
  r.seat = 0
  horseRT.stats.dismounts++
}

/** Teleports, the finale and the intro reset riding without animation. */
export const resetRider = (id: CharacterId): void => {
  const r = riderRT[id]
  if (r.horse) {
    const h = r.horse
    releaseSeat(r, h)
    if (!h.rider && !(h as HorseState).passenger) {
      if (isHorse(h)) {
        if (isAirborne(h)) groundNow(h)
        setMode(h, "graze", 10)
      } else mountDrivers.get(h)?.rest()
    }
  }
  r.phase = "none"
  r.horse = null
  r.ride = 0
  r.tumble = 0
  r.rejected = false
  r.handW = 0
  r.task = "none"
  r.groundBrake = false
  r.seat = 0
  const body = bodyOf(id)
  body.rideY = null
  body.ridePitch = 0
  body.rideRoll = 0
}

/**
 * Whistle a character's own horse. Near (in view) it simply comes; far away
 * it is brought round out of sight first and canters in. A Pegasus called
 * from far away flies in and lands beside you.
 */
export const callHorse = (id: CharacterId, which?: HorseState): HorseState | null => {
  const h = which ?? horseById(horseRT.bonded[id])
  const body = bodyOf(id)
  if (!h || h.rider || h.passenger) return null
  const d = Math.hypot(h.x - body.pos.x, h.z - body.pos.z)
  if (isPegasus(h) && h.flight) {
    h.tx = body.pos.x
    h.tz = body.pos.z
    h.reservedBy = id
    if (d > 220) {
      // far away, on the ground or already flying somewhere: bring it round
      // out of sight, already on the wing, so it is never simulated across
      // unstreamed country and always arrives in well under a minute. The
      // camera sits towards viewYaw from the player, so that side (and a
      // little off it) is behind the view: it sweeps in over the shoulder.
      const a = cameraRT.viewYaw + (Math.random() < 0.5 ? -0.55 : 0.55)
      h.x = body.pos.x + Math.sin(a) * 170
      h.z = body.pos.z + Math.cos(a) * 170
      h.y = Math.max(groundHeight(h.x, h.z), groundHeight(body.pos.x, body.pos.z)) + 45
      h.heading = Math.atan2(body.pos.x - h.x, body.pos.z - h.z)
      h.speed = h.flight.spec.cruise
      h.flight.mode = "air"
      h.flight.spread = 1
      h.flight.t = 0
    } else if (d > 60 && !isAirborne(h)) {
      startTakeoff(h)
      h.speed = Math.max(h.speed, 3)
    }
    if (!isAirborne(h)) setMode(h, "come", 40)
    horseRT.stats.calls++
    return h
  }
  if (d > 110) {
    // arrive from behind the camera, ~45 m out, somewhere a horse can stand
    for (let i = 0; i < 16; i++) {
      const a = cameraRT.viewYaw + (i % 2 ? 1 : -1) * Math.floor(i / 2) * 0.35
      const x = body.pos.x + Math.sin(a) * 45
      const z = body.pos.z + Math.cos(a) * 45
      if (!standable(x, z, 0.8)) continue
      h.x = x
      h.z = z
      h.y = groundHeight(x, z)
      h.heading = Math.atan2(body.pos.x - x, body.pos.z - z)
      break
    }
  }
  h.tx = body.pos.x
  h.tz = body.pos.z
  h.reservedBy = id
  setMode(h, "come", 40)
  horseRT.stats.calls++
  return h
}

/**
 * A Pegasus in the air with nobody aboard: flying in to whoever called it,
 * or back down to the meadow. It lands near the goal and walks the rest.
 */
const freeGoal = { x: 0, z: 0, y: null as number | null, speed: null as number | null, land: true, heading: null as number | null }
export const stepFreeFlight = (h: HorseState, dt: number): void => {
  const f = h.flight
  if (!f || f.mode === "ground") return
  // flying in to whoever whistled: follow them as they move
  if (h.reservedBy) {
    const caller = bodyOf(h.reservedBy)
    h.tx = caller.pos.x
    h.tz = caller.pos.z
  }
  freeGoal.x = h.tx
  freeGoal.z = h.tz
  freeGoal.y = null
  freeGoal.speed = null
  freeGoal.land = true
  freeGoal.heading = null
  autopilot(h, freeGoal, f.intent)
  // land a few metres short, beside rather than on top of the caller
  const d = Math.hypot(h.tx - h.x, h.tz - h.z)
  if (f.mode === "air" && d < 22) f.intent.land = true
  moveMount(h, dt, null)
  if ((f.mode as string) === "ground") {
    setMode(h, "come", 30)
    horseSounds.nicker(h, Math.hypot(h.tx - h.x, h.tz - h.z))
  }
}

// ---------------------------------------------------------------- per-frame

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const lerp = THREE.MathUtils.lerp
const intents: Record<CharacterId, LocomotionIntent> = {
  explorer: { move: { x: 0, y: 0 }, sprint: false, jump: false },
  companion: { move: { x: 0, y: 0 }, sprint: false, jump: false },
}

/** Mounts already moved this frame (two riders share one tandem mount). */
const moved = new Set<MountBody>()
const moveOnce = (h: MountBody, dt: number, turn: number | null): void => {
  if (moved.has(h)) return
  moved.add(h)
  moveMount(h, dt, turn)
}

/** Player controls for the horse under the active character. */
const controlHorse = (r: RiderState, h: MountBody, dt: number): void => {
  const hs = h as HorseState
  if (isHorse(h) && h.flight && h.flight.mode !== "ground") {
    if (r === riderRT[characterRT.active]) groundDashRT.on = false
    controlFlight(r, hs, dt)
    return
  }
  const sp = h.pose.speeds
  const forward = -input.move.y
  let steer = -input.move.x
  // Shift: a tap spurs up a gait, holding it gallops
  const shift = input.sprint
  if (shift) r.shiftTime += dt
  else {
    if (r.shiftWas && r.shiftTime < 0.28 && forward > 0) r.cruise = Math.min(3, r.cruise + 1) as 1 | 2 | 3
    r.shiftTime = 0
  }
  r.shiftWas = shift
  // S: a tap drops a gait; held, it stops and then backs up
  const back = input.move.y > 0.5
  const landing = isHorse(h) ? h.flight?.landing : null
  if (back && landing) landing.run = false
  if (back) r.sTime += dt
  else {
    if (r.sWas && r.sTime < 0.28) r.cruise = Math.max(1, r.cruise - 1) as 1 | 2 | 3
    r.sTime = 0
  }
  r.sWas = back
  let target = 0
  let surging = false
  if (landing?.run && !back) {
    // Landing & Gallop continues the run with loose reins. Steering remains
    // available; S / Slow to stop returns to ordinary held movement controls.
    target = sp[3] * (h.wade > 0.1 ? Math.max(0.35, 1 - h.wade * 0.7) : 1)
  } else if (forward > 0.1) {
    const galloping = shift && r.shiftTime >= 0.28
    const level = galloping ? 4 : r.cruise
    target = sp[level - 1]
    // held on at a full gallop: the surge, each kind's own dash (groundDash.ts)
    const kind = groundDashKind(h as never)
    if (galloping && kind && h.speed > sp[2] && r.shiftTime >= SURGE_AFTER && h.wade < 0.3) {
      surging = true
      target = sp[3] * SURGE[kind]
    }
  } else if (back) {
    // held at a standstill (or already backing): rein back steadily
    target = h.speed < 0.3 && r.sTime > 0.35 ? -0.85 : 0
  }
  if (r.groundBrake && Math.abs(h.speed) < 0.3 && Math.abs(forward) < 0.1 && Math.abs(steer) < 0.1) r.groundBrake = false
  if (r.wantOff || r.groundBrake || boarding(h)) { target = 0; surging = false }
  h.targetSpeed = target
  if (r === riderRT[characterRT.active]) {
    groundDashRT.on = surging || groundDashRT.qa
    groundDashRT.kind = groundDashKind(h as never)
    groundDashRT.id = h.ident.id
  }
  // A horse looks where it is going: galloping at a trunk or a boulder, it
  // bears off to the clearer side by itself instead of running into it.
  if (h.speed > 2 && h.jumpT < 0) {
    const look = 2 + h.speed * 0.4
    if (probeMount(h, h.heading, look) > 0.5) {
      const left = probeMount(h, h.heading + 0.5, look)
      const right = probeMount(h, h.heading - 0.5, look)
      const away = left <= right ? 1 : -1
      // only while the rider is not steering herself: her hands come first
      if (Math.abs(steer) < 0.3) steer = Math.max(-1, Math.min(1, steer + away * 0.9))
    }
  }
  h.steer = steer * (h.jumpT >= 0 ? 0.55 : 1)
  // Space: jump at once (a press during a landing is kept for a moment); a
  // Pegasus spreads its wings and takes off instead
  r.jumpBuffer = Math.max(0, r.jumpBuffer - dt)
  if (input.jump || (r.jumpBuffer > 0 && h.jumpT < 0 && h.jumpCool <= 0)) {
    input.jump = false
    r.jumpBuffer = 0
    if (isHorse(h) && h.flight) {
      if (boarding(h)) {
        useGame.getState().showHint(`Wait — ${hs.passenger && riderRT[hs.passenger].phase !== "riding" ? "someone is still climbing on" : "hold on"}.`)
        return
      }
      const left = partnerLeftBehind(hs)
      if (left) {
        useGame.getState().showHint(`Wait for ${left} — nobody is left behind on the Moon.`)
        return
      }
      const res = startTakeoff(hs)
      if (res === "water") useGame.getState().showHint(`${h.ident.name} needs firmer footing to take off.`)
      // (the flying keys stay on screen while in the air: Hud, PegasusKeys)
      else if (res === "ok") {
        resetFlightControls(r.id, true)
        horseSounds.snort(hs, 2)
      }
      return
    }
    const res = jumpMount(h)
    // pressed in the air or as the hooves land: kept until it can happen
    if (res === "busy") r.jumpBuffer = Math.min(0.6, (h.jumpT >= 0 ? (1 - h.jumpT) * h.jumpDur : 0) + h.jumpCool + 0.18)
    else if (res === "refuse") {
      useGame.getState().showHint(`${h.ident.name} refuses — that's too high to jump.`)
      h.targetSpeed = 0
      h.speed *= 0.5
      if (isHorse(h)) { h.gestureTimers.snort = 0; h.gestureTimers.headShake = 0 }
    }
  }
}

/**
 * Flying controls. Keyboard: W/S speed, A/D bank, Space climb, C descend,
 * Shift dash, E land. Touch: the stick steers toward where it points
 * (relative to the camera) and its push asks for speed; the climb and
 * descend buttons hold height changes; Dash toggles faster flight.
 */
const rollTaps = { explorer: makeRollTap(), companion: makeRollTap() }
const trickTaps: Record<CharacterId, TrickTaps> = { explorer: makeTrickTaps(), companion: makeTrickTaps() }

/** Discard taps and landing requests when a journey or recovery takes control. */
export const resetFlightControls = (id: CharacterId, preserveLandingResponse = false): void => {
  rollTaps[id] = makeRollTap()
  trickTaps[id] = makeTrickTaps()
  riderRT[id].wantOff = false
  riderRT[id].groundBrake = false
  riderRT[id].shiftTime = 0
  const mount = riderRT[id].horse
  if (mount?.kind === "horse") {
    const f = (mount as HorseState).flight
    if (f) {
      const contact = f.landing.contact, settle = f.landing.settle
      f.intent.roll = 0; f.intent.land = false
      clearLanding(mount as HorseState)
      if (preserveLandingResponse) { f.landing.contact = contact; f.landing.settle = settle }
    }
  }
}
/** Ask for a trick and say so gently when there is no room for it. */
const askTrick = (h: HorseState, req: TrickRequest): void => {
  // on the sails W W is the star pirouette (celestial/starSail.ts); the other tricks need air
  if (h.flight?.mode === "sail") {
    if (req.kind === "pirouette") startStarPirouette(h, req.dir)
    return
  }
  if (tryTrick(h, req.kind, req.dir) !== "low") return
  useGame.getState().showHint(`Not enough sky for that — ${h.ident.name} needs more height to ${req.kind === "roll" ? "roll" : req.kind === "split" ? "flip" : req.kind === "pirouette" ? "spin" : req.kind === "corkscrew" ? "spiral" : "loop"}. Climb first.`)
}
const controlFlight = (r: RiderState, h: HorseState, dt: number): void => {
  const f = h.flight!
  const i: FlightIntent = f.intent
  r.groundBrake = false
  const resuming = (input.ascend || input.cancel) && (f.mode === "landing" || f.landing.requested || r.wantOff)
  if (resuming && f.mode !== "sail" && !travelling()) {
    cancelLanding(h)
    for (const seat of Object.values(riderRT)) if (seat.horse === h) seat.wantOff = false
    input.cancel = false
  }
  i.thrust = -input.move.y
  i.turn = -input.move.x
  // A or D tapped twice: a barrel roll
  const roll = rollTap(rollTaps[r.id], i.turn, dt)
  if (roll) i.roll = roll
  // S S loop, C C dive flip, Space Space corkscrew, W W pirouette
  const req = keyTrick(trickTaps[r.id], input.move, input.ascend, input.descend, input.sprint, i.turn, dt)
  if (req) askTrick(h, req)
  i.climb = (input.ascend ? 1 : 0) - (input.descend ? 1 : 0)
  // C is also the cat's call on foot: in the air it only means "down"
  input.call = false
  input.jump = false
  // held for as long as the rider likes: a Pegasus never tires (with C it is a stoop)
  i.boost = input.sprint
  if (input.sprint) r.shiftTime += dt
  else r.shiftTime = 0
  // The gallop approach owns its request independently. E keeps its original
  // safe land-and-dismount intent; climbing explicitly cancels either path.
  i.land = r.wantOff
  if (flightQA.override) Object.assign(i, flightQA.override)
  if (f.refused) {
    const reason = f.refused === "water" ? "Find shallower water or dry ground" : f.refused === "obstacle" ? "Choose a clear stretch ahead" : f.refused === "terrain" ? "The ground ahead is still arriving" : "Choose open, gentle ground"
    useGame.getState().showHint(`${reason} — ${h.ident.name} keeps you safely in flight.`)
    f.refused = null
    r.wantOff = false
  }
  // a destination or home chosen on the star chart: Starborn climbs to her
  // sails by herself. Returning home gives the rider control in the air.
  if (sailRT.autopilot && f.mode !== "sail") {
    if (sailRT.autopilot.kind === "home" && spaceRT.realm === "earth" && h.y - DATUM_Y < SAIL_ALTITUDE + 50) {
      sailRT.autopilot = null
      i.land = false
      r.wantOff = false
    } else if (!r.wantOff) {
      i.climb = 1
      i.thrust = 1
      i.turn = Math.abs(input.move.x) > 0.1 ? -input.move.x : 0
    }
  }
  const s = f.spec
  if (s.ceiling !== Infinity && f.alt > s.ceiling - 40 && i.climb > 0) {
    useGame.getState().showHint(`The air is too thin — ${h.ident.name} can climb no higher. Only a star-born Pegasus could.`)
  }
}

/**
 * Leaving another world: whoever came along on foot must be aboard first.
 * Returns their name while they are still walking back, or null.
 */
export const partnerLeftBehind = (h: HorseState): string | null => {
  if (!inRealm(h.x, h.z)) return null
  for (const id of ["explorer", "companion"] as const) {
    if (riderRT[id].horse === h) continue
    if (id === "companion" && !characterRT.companionPresent) continue
    const b = bodyOf(id).pos
    if (inRealm(b.x, b.z)) return id === "explorer" ? `${names.explorer}` : `${names.companion}`
  }
  return null
}

/** Where Starborn sets down when she brings you home: open ground by the meadow. */
let homeSpot: { x: number; z: number } | null = null
export const homeLanding = (): { x: number; z: number } => {
  if (homeSpot) return homeSpot
  for (let r = 0; r < 60 && !homeSpot; r += 4) {
    for (let a = 0; a < 12; a++) {
      const x = -18 + Math.cos(a * 0.52) * r, z = 46 + Math.sin(a * 0.52) * r
      if (standable(x, z, 2.2)) { homeSpot = { x, z }; break }
    }
  }
  return homeSpot ?? { x: -18, z: 46 }
}

/** The companion on horseback keeps you company. */
const formation = { x: 0, z: 0, y: null as number | null, speed: null as number | null, land: false, heading: null as number | null }
const companionRide = (r: RiderState, h: MountBody, dt: number): void => {
  const leaderId = otherOf(r.id)
  const leader = bodyOf(leaderId)
  const lr = riderRT[leaderId]
  const lh = lr.horse
  const lf = lh ? lh.heading : leader.facing
  const lSpeed = lh ? lh.speed : leader.speed
  const hs = h as HorseState
  const leaderFlying = !!lh && isAirborne(lh as HorseState)
  // ---- the leader has sailed beyond the sky, or stands on the Moon: no wing
  // of theirs can follow, so they come home and wait there --------------------
  const leaderAway = spaceRT.mode === "deep" || spaceRT.realm !== "earth" || (lh as HorseState | null)?.flight?.mode === "sail" || !sameWorld(leader.pos, { x: h.x, z: h.z })
  if (leaderAway && !inRealm(h.x, h.z)) {
    if (isHorse(h) && h.flight && h.flight.mode !== "ground") {
      const spot = homeLanding()
      const sideSign = r.id === "companion" ? -1 : 1
      Object.assign(formation, { x: spot.x + 5 * sideSign, z: spot.z + 3, y: null, speed: null, land: true, heading: null })
      autopilot(hs, formation, h.flight.intent)
      if (Math.hypot(formation.x - h.x, formation.z - h.z) < 20 && h.flight.mode === "air") h.flight.intent.land = true
    } else {
      h.steer = 0
      h.targetSpeed = 0
    }
    return
  }
  // ---- on the wing: keep station off the leader's wingtip -------------------
  if (isHorse(h) && h.flight) {
    const f = h.flight
    if (leaderFlying && f.mode === "ground" && !boarding(h)) startTakeoff(hs)
    if (f.mode !== "ground") {
      const sideSign = r.id === "companion" ? -1 : 1
      const span = (h.model?.meta.wing?.semi ?? 3.2) + ((lh as HorseState | null)?.model?.meta.wing?.semi ?? 3.2) + 1.6
      formation.x = leader.pos.x + Math.cos(lf) * span * sideSign - Math.sin(lf) * 3
      formation.z = leader.pos.z - Math.sin(lf) * span * sideSign - Math.cos(lf) * 3
      formation.y = leaderFlying ? (lh as HorseState).y + 0.5 : null
      formation.speed = leaderFlying ? Math.max(f.spec.minSpeed, lSpeed) : null
      formation.heading = lf
      formation.land = !leaderFlying
      if (!leaderFlying) {
        // the leader has landed: come down beside them
        formation.x = leader.pos.x + Math.cos(lf) * 6 * sideSign
        formation.z = leader.pos.z - Math.sin(lf) * 6 * sideSign
      }
      autopilot(hs, formation, f.intent)
      if (leaderFlying) {
        // close the gap: a little faster when behind the slot, slower ahead
        const ahead = (formation.x - h.x) * fwdX(h.heading) + (formation.z - h.z) * fwdZ(h.heading)
        f.intent.thrust = Math.max(-1, Math.min(1, (lSpeed - h.speed) / 4 + ahead * 0.08))
        f.intent.boost = ahead > 35
        f.intent.land = false
      } else if (Math.hypot(formation.x - h.x, formation.z - h.z) < 20 && f.mode === "air") f.intent.land = true
      return
    }
  }
  // side by side: The companion rides on her right, the explorer on his left
  const sideSign = r.id === "companion" ? -1 : 1
  let ox = Math.cos(lf) * 2.6 * sideSign
  let oz = -Math.sin(lf) * 2.6 * sideSign
  // no room beside: drop in behind
  const bx = leader.pos.x + ox
  const bz = leader.pos.z + oz
  if (lh && probeMount(h, Math.atan2(bx - h.x, bz - h.z), Math.min(4, Math.hypot(bx - h.x, bz - h.z))) > 0.5) {
    ox = -Math.sin(lf) * 3.6
    oz = -Math.cos(lf) * 3.6
  }
  const lead = Math.min(6, Math.max(0, lSpeed)) * 0.6
  const tx = leader.pos.x + ox + Math.sin(lf) * lead
  const tz = leader.pos.z + oz + Math.cos(lf) * lead
  const dx = tx - h.x
  const dz = tz - h.z
  const dist = Math.hypot(dx, dz)
  const want = Math.atan2(dx, dz)
  const ahead = dx * fwdX(h.heading) + dz * fwdZ(h.heading)
  const sp = h.pose.speeds
  let target = lh || lr.phase === "mounting" ? Math.max(0, lSpeed + ahead * 0.9) : dist > 5 ? sp[0] : 0
  if (dist > 12) target = Math.max(target, sp[2])
  if (dist > 25) target = Math.max(target, sp[3], lSpeed * 1.15)
  if (dist < 1.2 && lSpeed < 0.3) target = 0
  // keep pace with the leader even on a slower breed: a little behind at most
  target = Math.min(target, Math.max(sp[3], lSpeed) * 1.18)
  if (boarding(h)) target = 0
  // facing: steer to the slot while far; match the leader's heading in the slot
  const align = dist < 2.5 ? lf : want
  let d = Math.atan2(Math.sin(align - h.heading), Math.cos(align - h.heading))
  if (probeMount(h, h.heading, 2.5 + Math.max(0, h.speed) * 0.5) > 0.5) d += probeMount(h, h.heading + 0.6, 3) <= probeMount(h, h.heading - 0.6, 3) ? 0.9 : -0.9
  h.steer = Math.max(-1, Math.min(1, d * 1.8))
  h.targetSpeed = target
  // following through: jump the same low obstacles the leader cleared
  if (h.speed > 2 && h.jumpT < 0 && probeMount(h, h.heading, Math.max(1.6, h.speed * 0.35)) > 0.5) jumpMount(h)
  // the leader has got off: ride up and get off too
  if (!lh && lr.phase === "none" && dist < 4.5 && Math.abs(h.speed) < 0.4) requestDismount(r.id)
  void dt
}

/** Rider body posture from the horse's gait (posting trot, two-point gallop),
 * or the flying seat on a Pegasus. */
const riderPosture = (r: RiderState, h: MountBody, dt: number, time: number): void => {
  const hs = h as HorseState
  if (isHorse(h) && h.flight && h.flight.mode !== "ground") {
    const f = h.flight
    const fast = Math.max(0, Math.min(1, (h.speed - f.spec.cruise) / Math.max(1, f.spec.boost - f.spec.cruise)))
    // forward over the withers, more for a dash or the climb of a takeoff;
    // settled back for the landing flare
    const leanT = 0.22 + fast * 0.3 + (f.mode === "takeoff" ? 0.25 : 0) - f.flare * 0.2 - f.landing.brake * 0.12 + (r.seat ? 0.08 : 0)
    r.lean += (leanT - r.lean) * (1 - Math.exp(-dt * 3))
    r.bank += (Math.max(-0.2, Math.min(0.2, f.roll * 0.18)) - r.bank) * (1 - Math.exp(-dt * 3))
    // a slow rise and fall with the wingbeat
    const heave = Math.sin(Math.PI * 2 * (f.flap - 0.15)) * 0.012 * f.power * (1 - f.glide)
    r.hips.set(0, heave, 0.02 + fast * 0.03)
    r.jump = 0
    // looking about: into the turn, and now and then down at the world below
    // or back at the other rider
    r.glanceT -= dt
    if (r.glanceT <= 0) {
      r.glance = r.glance !== 0 ? 0 : (hs.passenger || r.seat ? (Math.sin(time * 1.3 + (r.id === "explorer" ? 0 : 2)) > 0 ? 1 : -1) : Math.sin(time) > 0 ? 0.6 : -0.6)
      r.glanceT = r.glance !== 0 ? 2.2 : 7 + (Math.sin(time * 0.71) + 1) * 5
    }
    const glanceYaw = r.glance * (r.seat ? 0.55 : 0.75)
    const target = Math.max(-0.9, Math.min(0.9, f.intent.turn * 0.4 + glanceYaw))
    r.lookYaw += (target - r.lookYaw) * (1 - Math.exp(-dt * 3))
    return
  }
  const an = h.animator
  const gw = an?.gaitW ?? [1, 0, 0, 0]
  const ph = an ? an.stride : 0
  const move = Math.min(1, Math.abs(h.speed) / 0.8)
  // rising trot: up on one diagonal, sitting on the other (once per stride)
  const post = Math.max(0, Math.sin(ph * Math.PI * 2)) ** 1.5 * 0.075 * gw[1] * move
  // canter: the seat swings with the rocking stride
  const swing = Math.sin(ph * Math.PI * 2 - 0.4) * 0.025 * gw[2]
  // gallop: two-point, seat out of the saddle and forward over the withers
  const two = gw[3] * move
  // jumping seat: up out of the saddle, folded forward with the hands up the crest
  const jt = h.jumpT
  const jump = jt >= 0 ? Math.sin(Math.PI * Math.min(1, jt * 1.15)) : 0
  const contact = hs.flight?.landing.contact ?? 0
  const settle = hs.flight?.landing.settle ?? 0
  r.hips.set(0, post + two * 0.11 + jump * 0.12 - contact * 0.025, swing + two * 0.05 + post * 0.15 + jump * 0.08 - settle * 0.025)
  r.jump = jump
  const brake = Math.max(0, -h.accel) * 0.02
  const leanT = 0.05 + gw[1] * 0.14 + gw[2] * 0.12 + Math.max(two * 0.62, jump * 0.7) - Math.min(0.2, brake) - contact * 0.14
  r.lean += (leanT - r.lean) * (1 - Math.exp(-dt * 5))
  r.bank += (Math.max(-0.25, Math.min(0.25, h.turnRate * Math.abs(h.speed) * 0.03)) - r.bank) * (1 - Math.exp(-dt * 4))
  r.lookYaw = Math.max(-0.5, Math.min(0.5, h.steer * 0.45 + Math.sin(time * 0.3) * 0.1 * (1 - move)))
}

/** Reins in the hands, just above and in front of the pommel. The rider on
 * the rear seat of a tandem saddle holds the front rider round the waist. */
const setHands = (r: RiderState, h: MountBody, w: number): void => {
  if (r.seat === 1) {
    const front = h.rider ? riderRT[h.rider] : null
    if (front && front.phase === "riding") {
      const fm = riderMetrics[front.id]
      mountQuaternion(h, _tq)
      for (const [hand, sx] of [[r.handL, 1], [r.handR, -1]] as const) {
        hand.set(sx * 0.15, fm.hips + 0.04, 0.05).applyQuaternion(_tq)
        hand.x += front.rootX
        hand.y += front.rootY
        hand.z += front.rootZ
      }
      r.handW = w
      return
    }
    // nobody in front: a hand on the pommel of the rear seat
  }
  const seat = tackRest(h, seatKey(r.seat))
  const two = h.animator ? h.animator.gaitW[3] : 0
  const bare = h.kind === "deer"
  const H = h.model?.meta.height ?? 1.4
  const fz = seat[2] + (bare ? H * 0.2 : 0.34) + two * 0.12 + r.jump * 0.2
  const fy = seat[1] + (bare ? H * 0.07 : 0.26) - two * 0.08 - r.jump * 0.06
  const spread = bare ? H * 0.13 : 0.075
  toWorld(h, spread, fy, fz, r.handL).add(_b.copy(seatW(h, _seat, r.seat)).sub(toWorld(h, seat[0], seat[1], seat[2], _a)))
  toWorld(h, -spread, fy, fz, r.handR).add(_b.copy(seatW(h, _seat, r.seat)).sub(toWorld(h, seat[0], seat[1], seat[2], _a)))
  r.handW = w
}

const _up = new THREE.Vector3()
const placeSeated = (r: RiderState, h: MountBody): void => {
  const m = riderMetrics[r.id]
  // the pelvis joint sits ~9 cm above the saddle's seat; in flight the body
  // pitches and banks with the mount about the seat
  seatW(h, _seat, r.seat)
  _up.set(0, 0.09 - m.hips, 0)
  const t = mountTilt(h)
  if (t.pitch !== 0 || t.roll !== 0 || t.spin) _up.applyQuaternion(mountQuaternion(h, _tq))
  r.rootX = _seat.x + _up.x
  r.rootY = _seat.y + _up.y
  r.rootZ = _seat.z + _up.z
  r.facing = h.heading
  stirrup(h, 1, r.footL, r.seat)
  stirrup(h, -1, r.footR, r.seat)
}

/** Restore a known occupied saddle after a trusted travel/recovery placement.
 * The caller relocates the mount first; no mount animation or movement runs.
 */
export const restoreRiderSeat = (id: CharacterId, h: HorseState, seat: 0 | 1): void => {
  const r = riderRT[id]
  if (r.horse && r.horse !== h) releaseSeat(r, r.horse)
  Object.assign(r, makeRider(id))
  r.horse = h
  r.seat = seat
  r.phase = "riding"
  r.ride = 1
  const body = bodyOf(id)
  r.rev = body.revision
  if (seat === 1) h.passenger = id
  else { h.rider = id; h.reservedBy = null }
  h.persistent = true
  setMode(h, "ridden", 999)
  resetFlightControls(id)
  placeSeated(r, h)
  riderPosture(r, h, 0.1, 0)
  setHands(r, h, 1)
  body.pos.set(r.rootX, r.rootY, r.rootZ)
  body.rideY = r.rootY
  body.facing = r.facing
  const tilt = mountTilt(h)
  body.ridePitch = tilt.pitch
  body.rideRoll = tilt.roll + (tilt.spin ?? 0)
  body.vel.set(fwdX(h.heading) * h.speed, 0, fwdZ(h.heading) * h.speed)
  body.gesture = "none"
  body.paused = false
}

const MOUNT = 1.75
const DISMOUNT = 1.45

export const stepRiding = (dt: number, time: number): void => {
  moved.clear()
  // Resolve placement revisions before a controlled mount can move. In a
  // tandem seat either rider may hold the controls, but both must be posed
  // from the same completed movement step (including when the companion is active).
  for (const id of ["explorer", "companion"] as const) {
    const r = riderRT[id], body = bodyOf(id)
    if (r.rev !== body.revision) {
      if (r.rev >= 0 && r.phase !== "none") resetRider(id)
      r.rev = body.revision
    }
  }
  if (takeAction("landGallop")) {
    const result = toggleLandGallop(characterRT.active)
    if (result === "approach") useGame.getState().showHint("Land & Gallop — coming down, onto land or water. R or Climb keeps you flying.")
    else if (result === "fly") useGame.getState().showHint("Keep flying — your Pegasus opens its wings again.")
    else if (result === "slow") useGame.getState().showHint("Slowing to a stop. Stay seated; Take Off whenever you're ready.")
    else {
      const h = riderRT[characterRT.active].horse
      if (h?.kind === "horse" && (h as HorseState).flight?.landing.goAround) useGame.getState().showHint("Your Pegasus is gaining safe clearance. Steer toward open ground, then try Land & Gallop again.")
    }
  }
  const controlling = riderRT[characterRT.active]
  if (controlling.phase === "riding" && controlling.horse) {
    controlHorse(controlling, controlling.horse, dt)
    moveOnce(controlling.horse, dt, controlling.horse.steer)
  }
  for (const id of ["explorer", "companion"] as const) {
    const r = riderRT[id]
    const body = bodyOf(id)
    const active = characterRT.active === id
    const h = r.horse
    // ---- companion on foot: go and fetch their own horse ---------------------
    if (!active && r.phase === "none") companionOnFoot(r, dt)
    if (!h || r.phase === "none") continue
    const hs = h as HorseState
    r.t += dt
    r.pat = Math.max(0, r.pat - dt)
    // who holds the mount this frame: on a shared saddle, whoever the player is
    const sharing = isHorse(h) && !!h.rider && !!hs.passenger
    const controller: CharacterId = sharing ? (h.rider === characterRT.active || hs.passenger === characterRT.active ? characterRT.active : h.rider!) : id
    if (r.phase === "mounting") {
      h.targetSpeed = 0
      if (!sharing || riderRT[otherOf(id)].phase !== "riding") moveOnce(h, dt, 0)
      const seat = tackRest(h, seatKey(r.seat))
      const out = standOff(h)
      const spotW = toWorld(h, r.side * out, 0, seat[2] + 0.12, _c).clone()
      const facingSide = h.heading - r.side * Math.PI / 2 + r.side * 0.3
      const ta = r.approach
      if (r.t < ta) {
        // walk to the stirrup
        const u = smooth(0, 1, r.t / ta)
        r.rootX = lerp(r.startX, spotW.x, u)
        r.rootZ = lerp(r.startZ, spotW.z, u)
        r.rootY = groundHeight(r.rootX, r.rootZ)
        const want = Math.atan2(spotW.x - r.startX, spotW.z - r.startZ)
        r.facing = lerpAngle(r.startFacing, u < 0.75 ? want : facingSide, Math.min(1, u * 1.4))
        r.walk = Math.hypot(spotW.x - r.startX, spotW.z - r.startZ) / ta
        r.ride = 0
        r.handW = 0
      } else {
        const u = Math.min(1, (r.t - ta) / MOUNT)
        r.walk = 0
        const near = r.side > 0 ? r.footL : r.footR
        const far = r.side > 0 ? r.footR : r.footL
        stirrup(h, r.side, _a, r.seat)
        const sFar = stirrup(h, -r.side, _b, r.seat).clone()
        const m = riderMetrics[id]
        const seatedY = seatW(h, _seat, r.seat).y + 0.09 - m.hips
        const standY = groundHeight(spotW.x, spotW.z)
        // 0-0.25 foot in the stirrup, 0.25-0.6 spring up, 0.35-0.8 swing over, 0.8-1 settle
        const up = smooth(0.22, 0.6, u)
        const settle = smooth(0.6, 1, u)
        const over = smooth(0.32, 0.82, u)
        const sx = lerp(spotW.x, lerp((spotW.x + seatW(h, _seat, r.seat).x) / 2, seatW(h, _seat, r.seat).x, settle), up)
        const sz = lerp(spotW.z, lerp((spotW.z + seatW(h, _seat, r.seat).z) / 2, seatW(h, _seat, r.seat).z, settle), up)
        r.rootX = sx
        r.rootZ = sz
        const peak = Math.max(seatedY, _a.y + 0.08) + 0.06
        r.rootY = lerp(lerp(standY, peak, up), seatedY, settle)
        r.facing = lerpAngle(facingSide, h.heading, over)
        // near foot: lifted into the stirrup and kept there
        near.copy(_a)
        if (u < 0.22) near.lerpVectors(_c.set(spotW.x, standY + 0.02, spotW.z), _a, smooth(0, 0.22, u))
        // far foot: on the ground, then arcing up over the croup to its stirrup
        const croup = toWorld(h, 0, seat[1] + 0.35, seat[2] - 0.55, new THREE.Vector3())
        const ground = _c.set(spotW.x + Math.cos(h.heading) * r.side * -0.15, standY + 0.02, spotW.z - Math.sin(h.heading) * r.side * -0.15)
        if (over < 0.5) far.lerpVectors(ground, croup, over * 2)
        else far.lerpVectors(croup, sFar, (over - 0.5) * 2)
        r.ride = smooth(0.0, 0.18, u)
        // hands: reins and the pommel, then into riding position
        setHands(r, h, smooth(0.0, 0.2, u))
        r.lean = lerp(0.35, 0.05, settle)
        r.hips.set(0, 0, 0)
        if (r.rejected && u >= 0.68) {
          const safe = sideSpot(h, r.side) ?? sideSpot(h, -r.side)
          if (!safe) { r.t = ta + MOUNT * 0.67; continue }
          const awayX=safe.x-h.x,awayZ=safe.z-h.z,awayLength=Math.hypot(awayX,awayZ)||1
          const fartherX=safe.x+awayX/awayLength*.65,fartherZ=safe.z+awayZ/awayLength*.65
          if(personFits(fartherX,fartherZ)&&Math.abs(groundHeight(fartherX,fartherZ)-h.y)<.4){safe.x=fartherX;safe.z=fartherZ}
          r.endX = safe.x; r.endZ = safe.z
          r.startX = r.rootX; r.startY = r.rootY; r.startZ = r.rootZ
          r.phase = "rejecting"; r.t = 0
          mountDrivers.get(h)?.reject(id)
        } else if (u >= 1) {
          r.phase = "riding"
          r.t = 0
          if (h.reservedBy === id) h.reservedBy = null
          if (isHorse(h)) { horseSounds.creak(); if (Math.random() < 0.5) horseSounds.nicker(h, 2) }
          if (r.seat === 1 && isHorse(h)) useGame.getState().showHint(`Riding together on ${h.ident.name}.`)
        }
      }
    } else if (r.phase === "riding") {
      if (id === controller) {
        if (active) { if (!moved.has(h)) controlHorse(r, h, dt) }
        else if (!sharing) companionRide(r, h, dt)
        moveOnce(h, dt, h.steer)
      }
      // a horse being ridden still flicks an ear back to its rider now and then
      h.pose.earSplit = Math.sin(time * 0.37 + h.ident.seed) > 0.85 ? 0.8 : 0
      h.pose.ears = 0.35 + Math.min(0.4, h.speed * 0.05)
      h.pose.graze = Math.max(0, h.pose.graze - dt * 2)
      h.pose.look = Math.max(0, h.pose.look - dt * 2)
      h.pose.collect = r.cruise > 1 ? 0.3 : 0.1
      // flying lead change: lead with the inside leg in a sustained turn
      if (Math.abs(h.turnRate) > 0.15) h.lead = h.turnRate > 0 ? 1 : -1
      if (r.wantOff && Math.abs(h.speed) < 0.6 && !isAirborne(hs)) {
        const res = requestDismount(id)
        if (res === "blocked") r.wantOff = false
      }
      placeSeated(r, h)
      riderPosture(r, h, dt, time)
      setHands(r, h, 1)
      r.ride = 1
      if (r.pat > 0) {
        toWorld(h, r.side * 0.06, tackRest(h, "seat")[1] + 0.1, tackRest(h, "seat")[2] + 0.62, r.patTarget)
      }
    } else if (r.phase === "rejecting") {
      h.targetSpeed = 0
      moveOnce(h, dt, 0)
      const flight = smooth(0.28, 1.05, r.t)
      const recover = smooth(1.3, 2.7, r.t)
      const g = groundHeight(r.endX, r.endZ)
      r.rootX = lerp(r.startX, r.endX, flight)
      r.rootZ = lerp(r.startZ, r.endZ, flight)
      r.rootY = lerp(r.startY, g - 0.52 * (1 - recover), flight) + Math.sin(flight * Math.PI) * 0.22
      r.tumble = Math.sin(smooth(0.15, 2.65, r.t) * Math.PI) * r.side
      r.ride = 1 - recover
      r.lean = 0.5 * (1 - recover)
      r.bank = r.tumble * .15
      r.walk = 0; r.handW = smooth(.1,.4,r.t)*(1-recover); r.hips.set(0, 0, 0)
      // Legs tuck during flight, unfold against the grass during recovery.
      const sideX = Math.cos(h.heading), sideZ = -Math.sin(h.heading)
      for (const [foot, sign] of [[r.footL, 1], [r.footR, -1]] as const) {
        foot.set(r.rootX + sideX * sign * 0.20, Math.max(g+.03,lerp(r.rootY + 0.38, g + 0.02, recover)), r.rootZ + sideZ * sign * 0.20 + 0.2 * (1 - recover))
      }
      // Open palms brace softly on the grass; during the spring sideways
      // they stay close to the chest rather than reaching for invisible reins.
      for(const [hand,sign] of [[r.handL,1],[r.handR,-1]] as const){
        hand.set(r.rootX+sideX*(sign*.30-r.tumble*.25),Math.max(g+.06,r.rootY+.92-flight*.40),r.rootZ+sideZ*sign*.30+.25)
      }
      if (r.t >= 2.7) finishDismount(r)
    } else if (r.phase === "dismounting") {
      h.targetSpeed = 0
      moveOnce(h, dt, 0)
      const u = Math.max(0, Math.min(1, r.t / DISMOUNT))
      const m = riderMetrics[id]
      const seatedY = seatW(h, _seat, r.seat).y + 0.09 - m.hips
      const standY = groundHeight(r.endX, r.endZ)
      // lean forward, swing the far leg back over the croup, slide down the side
      const swing = smooth(0.0, 0.45, u)
      const down = smooth(0.4, 0.9, u)
      const side = r.side
      const st = tackRest(h, seatKey(r.seat))
      const out = toWorld(h, side * 0.32, 0, st[2], _c).clone()
      r.rootX = lerp(lerp(seatW(h, _seat, r.seat).x, out.x, swing), r.endX, down)
      r.rootZ = lerp(lerp(seatW(h, _seat, r.seat).z, out.z, swing), r.endZ, down)
      r.rootY = lerp(seatedY + swing * 0.08, standY, down)
      r.facing = lerpAngle(h.heading, h.heading - side * Math.PI / 2 + side * 0.3, swing)
      stirrup(h, side, r.side > 0 ? r.footL : r.footR, r.seat)
      const far = side > 0 ? r.footR : r.footL
      const croup = toWorld(h, 0, st[1] + 0.35, st[2] - 0.55, new THREE.Vector3())
      stirrup(h, -side, _a, r.seat)
      if (swing < 0.5) far.lerpVectors(_a, croup, swing * 2)
      else far.lerpVectors(croup, _b.set(r.endX, standY + 0.02, r.endZ), (swing - 0.5) * 2)
      if (down > 0.5) (side > 0 ? r.footL : r.footR).lerp(_b.set(r.endX, standY + 0.02, r.endZ), (down - 0.5) * 2)
      r.ride = 1 - smooth(0.75, 1, u)
      setHands(r, h, 1 - smooth(0.5, 0.9, u))
      r.lean = 0.25 * (1 - down)
      r.hips.set(0, 0, 0)
      if (u >= 1) finishDismount(r)
    }
    // ---- drive the character's body -----------------------------------------
    if ((r.phase as RidePhase) !== "none") {
      body.pos.x = r.rootX
      body.pos.z = r.rootZ
      body.rideY = r.rootY
      body.pos.y = r.rootY
      body.facing = r.facing
      const tilt = r.phase === "riding" ? mountTilt(h) : ZERO_TILT
      body.ridePitch = tilt.pitch
      // a barrel roll turns the riders with the body (the same rotation as mountQuaternion)
      body.rideRoll = tilt.roll + (tilt.spin ?? 0)
      const v = r.phase === "riding" ? h.speed : 0
      body.vel.set(fwdX(h.heading) * v, 0, fwdZ(h.heading) * v)
      body.gesture = "none"
      body.paused = false
    }
  }
}

const lerpAngle = (a: number, b: number, t: number): number => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t

/**
 * When the player rides off and their partner is on foot, the partner
 * whistles up their own horse and gets on it, rather than chasing a gallop
 * on foot or being teleported into the saddle. When the player sits in a
 * tandem saddle with the rear seat free, the partner climbs up behind them;
 * when the player rides a Pegasus, the partner calls their own.
 */
const companionOnFoot = (r: RiderState, dt: number): void => {
  if (!characterRT.companionPresent) return
  const leader = riderRT[otherOf(r.id)]
  const body = bodyOf(r.id)
  if (leader.phase === "none" || leader.phase === "rejecting" || leader.rejected) {
    r.task = "none"
    return
  }
  const lh = leader.horse as HorseState | null
  // someone on another world can't be followed (home waits for the Moon)
  if (!sameWorld(body.pos, bodyOf(otherOf(r.id)).pos)) {
    r.task = "none"
    return
  }
  const offWorld = inRealm(body.pos.x, body.pos.z)
  // a free seat behind the player on Starborn: ride together (on the Moon from
  // anywhere: nobody is left behind there)
  if (lh && isTandem(lh) && !lh.passenger && leader.seat === 0 && leader.phase === "riding" && !isAirborne(lh)) {
    const d = Math.hypot(lh.x - body.pos.x, lh.z - body.pos.z)
    if (d < 30 || offWorld) {
      if (d < 4.6 && Math.abs(lh.speed) < 0.6 && startMount(r.id, lh) === "ok") {
        r.task = "none"
        return
      }
      const intent = intents[r.id]
      intent.move.x = (lh.x - body.pos.x) / Math.max(d, 1e-3)
      intent.move.y = (lh.z - body.pos.z) / Math.max(d, 1e-3)
      intent.sprint = d > 6
      intent.jump = false
      aiIntents[r.id] = intent
      // the player waits a moment while they climb up
      return
    }
  }
  // no horse of their own to whistle for on the Moon, and none can follow
  // the star-born up into space
  if (offWorld || spaceRT.mode === "deep" || lh?.flight?.mode === "sail") {
    r.task = "none"
    return
  }
  const wantPegasus = !!lh && isPegasus(lh)
  let h = horseById(wantPegasus ? pegasusRT.own[r.id] : horseRT.bonded[r.id])
  if (!h || h.rider || h === leader.horse) {
    // any free saddled horse nearby will do
    h = [...horseRT.horses.values()].filter((x) => x.ident.saddled && !x.rider && !x.passenger && x !== leader.horse && !isAirborne(x) && isPegasus(x) === wantPegasus)
      .sort((a, b) => Math.hypot(a.x - body.pos.x, a.z - body.pos.z) - Math.hypot(b.x - body.pos.x, b.z - body.pos.z))[0]
    if (h && !wantPegasus) horseRT.bonded[r.id] = h.ident.id
  }
  if (!h) return
  const d = Math.hypot(h.x - body.pos.x, h.z - body.pos.z)
  if (r.task === "none") {
    r.task = "toHorse"
    r.taskTime = 0
    if (d > 12) callHorse(r.id, h)
  }
  r.taskTime += dt
  if (!isAirborne(h) && (h.mode === "come" || h.mode === "wait")) {
    h.tx = body.pos.x
    h.tz = body.pos.z
  }
  if (d < 2.8 && Math.abs(h.speed) < 0.5 && !isAirborne(h)) {
    if (startMount(r.id, h) === "ok") r.task = "none"
    return
  }
  // walk to meet it once it is close
  if (d < 18 && !isAirborne(h)) {
    const intent = intents[r.id]
    const dx = h.x - body.pos.x
    const dz = h.z - body.pos.z
    intent.move.x = dx / d
    intent.move.y = dz / d
    intent.sprint = d > 6
    intent.jump = false
    aiIntents[r.id] = intent
  }
  if (r.taskTime > (wantPegasus ? 60 : 40)) { r.task = "none"; r.taskTime = 0 }
}

/** The active character's horse prompt and E/B handling (called by HorseSystem). */
export const horseInteraction = (pat: boolean): string | null => {
  const id = characterRT.active
  const r = riderRT[id]
  const body = avatarRT()
  if (r.horse && !isHorse(r.horse)) return null
  if (r.phase === "riding" && r.horse && isHorse(r.horse)) {
    const h = r.horse
    const flying = isAirborne(h)
    if (pat && Math.abs(h.speed) < 4 && !flying) {
      r.pat = 1.8
      h.trust = Math.min(1, h.trust + 0.05)
      h.gestureTimers.snort = 0
    }
    // on a journey between worlds E means "arrive now", never "get off"
    if (travelling()) {
      if (input.interact) { input.interact = false; skipJourney() }
      return `To ${travelRT.name} · E arrive now · Esc stop here · A/D lean`
    }
    if (input.interact) {
      input.interact = false
      const res = requestDismount(id)
      if (res === "blocked") return "No room to get off here"
    }
    if (flying) {
      if (r.wantOff) return `${h.ident.name} lands to let you off · Climb to keep flying`
      if (h.flight?.mode === "sail") return "W/S sail · Space climb · C dive · Shift surge · M star chart · N travel · K home · E descend"
      if (h.flight?.landing.requested) return "Landing into a gallop · R / Space keep flying · E land & dismount"
      return "R land & gallop · Space climb · C descend · Shift dash · Shift+Space launch · E land & dismount"
    }
    if (r.wantOff) return `Slowing ${h.ident.name} to a halt…`
    if (h.flight?.landing.run) return "Galloping · S / R slow to stop · Space take off · E dismount"
    if (h.flight) return "E — dismount · Space — take off · B — pat"
    return `E — get off ${h.ident.name} · B — pat`
  }
  if (r.phase !== "none") return null
  // nearest horse in front of the character
  let best: HorseState | null = null
  let bestD = 3.2
  for (const h of horseRT.horses.values()) {
    if (!h.model || isAirborne(h)) continue
    const tandemSeat = isTandem(h) && !!h.rider && h.rider !== id && !h.passenger
    if (h.rider && !tandemSeat) continue
    const d = Math.hypot(h.x - body.pos.x, h.z - body.pos.z) - (isPegasus(h) ? 0.8 : 0)
    if (d < bestD) { best = h; bestD = d }
  }
  horseRT.near = best
  if (!best) return null
  if (pat) {
    best.trust = Math.min(1, best.trust + 0.25)
    best.lastPet = performance.now() / 1000
    best.watchX = body.pos.x
    best.watchZ = body.pos.z
    best.gestureTimers.snort = 0
    if (best.mode !== "ridden") setMode(best, best.mode === "lie" ? "lie" : "wait", 8)
    horseSounds.nicker(best, bestD)
    riderRT[id].pat = 1.6
  }
  if (input.interact) {
    input.interact = false
    const res = startMount(id, best)
    if (res === "blocked") return "No room beside the horse to get on"
    if (res === "busy") return `${best.ident.name} is busy`
  }
  if (best.rider && isTandem(best)) return `E — ride behind ${best.rider === "explorer" ? `${names.explorer}` : `${names.companion}`} on ${best.ident.name}`
  if (isPegasus(best)) return `E — ride ${best.ident.name} · B — stroke the neck`
  return best.ident.saddled ? `E — ride ${best.ident.name} · B — pat` : `E — ride ${best.ident.name} bareback · B — pat`
}
