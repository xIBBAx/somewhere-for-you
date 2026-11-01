import { resolveCollisions } from "../movement"
import { buildColliders, groundHeight } from "../world-layout"
import { chunkColliders, pushOutOfScatter } from "../../world/colliders"
import { colliderTop } from "../movement"
import type { CircleCollider } from "../world-layout"
import { CHUNK_SIZE } from "../../world/worldConfig"
import { flightWaterSurfaceAt, waterSurfaceAt } from "../../world/waterSurface"
import { worldStreamRT } from "../../world/worldRuntime"
import { BREEDS } from "./breeds"
import { WATER_WAYS, creatureWaterY } from "../../world/creatureWater"
import { fwdX, fwdZ, type HorseState } from "./horseState"

/**
 * Physical movement shared by ridden and free horses.
 *
 * A horse is heavy: speed changes with the breed's and the individual's
 * acceleration, turning is limited by speed (a galloping horse needs a wide
 * arc, a walking one can turn on its forehand) and the yaw rate itself has
 * inertia, so it never pivots like a vehicle. The body is a capsule of three
 * circles (chest, barrel, quarters) that slides along trees, rocks and walls
 * instead of passing through them. Slopes steeper than a horse will climb
 * stop it; shallows are waded with high steps and deep water is swum.
 */

const colliders = buildColliders()
const NO_STREAMED: never[] = []
const pt = { x: 0, z: 0 }

/** Highest yaw rate (rad/s) at a speed: ~1.7 rad/s walking, ~0.75 at a gallop. */
export const maxTurnRate = (h: HorseState, speed: number): number => {
  const agility = BREEDS[h.ident.breed].agility * h.ident.traits.agility
  // from a standstill a horse pivots by stepping round (~60-80 deg/s, a quarter
  // turn in a second or so); only moving does it carry a quicker turn
  const pivot = 0.55 + 0.45 * Math.min(1, Math.abs(speed) / 1.5)
  return agility * Math.min(1.75, 3.0 / (1 + 0.15 * Math.abs(speed))) * pivot
}

/**
 * How springy a breed's jump is: a light Arabian or Mustang bounds higher
 * and quicker off the ground, a draft horse heaves itself over lower and
 * slower. Scales the arc's height and (inversely) its duration.
 */
export const JUMP_SPRING: Record<string, number> = {
  arabian: 1.12, mustang: 1.1, thoroughbred: 1.06, andalusian: 1.02, quarter: 1.0, friesian: 0.95, draft: 0.84,
}
const spring = (h: HorseState): number => JUMP_SPRING[h.ident.breed] ?? (h.flight ? 1.1 : 1)
/** Seconds the hooves take to settle after a landing before the next take-off. */
export const JUMP_SETTLE = 0.12

/** Streamed obstacles near a point, skipping any the hooves clear (jumps). */
const pushOutOfChunks = (p: { x: number; z: number }, r: number, feetY: number): boolean => {
  let hit = false
  const cx = Math.floor(p.x / CHUNK_SIZE)
  const cz = Math.floor(p.z / CHUNK_SIZE)
  for (let iz = -1; iz <= 1; iz++) for (let ix = -1; ix <= 1; ix++) {
    const list = chunkColliders.get(`${cx + ix},${cz + iz}`)
    if (!list) continue
    for (const c of list) {
      const dx = p.x - c.x
      const dz = p.z - c.z
      const min = c.r + r
      const d2 = dx * dx + dz * dz
      if (d2 >= min * min) continue
      if (c.height !== undefined && feetY >= colliderTop(c)) continue
      const d = Math.sqrt(d2)
      p.x = c.x + (d > 1e-8 ? dx / d : 1) * min
      p.z = c.z + (d > 1e-8 ? dz / d : 0) * min
      hit = true
    }
  }
  return hit
}

/** Push one circle out of everything solid; returns the displacement.
 * `feetY` (absolute) lets a jumping horse pass over what its hooves clear. */
export const pushMountCircle = (x: number, z: number, r: number, out: { dx: number; dz: number }, feetY?: number): boolean => {
  pt.x = x
  pt.z = z
  let hit = resolveCollisions(pt, r, colliders.circles, colliders.rects, { streamed: NO_STREAMED, canSwim: true, feetY, stepUp: 0.05 })
  if (feetY === undefined ? pushOutOfScatter(pt, r, CHUNK_SIZE) : pushOutOfChunks(pt, r, feetY)) hit = true
  out.dx = pt.x - x
  out.dz = pt.z - z
  return hit
}

/** Highest obstacle a horse can clear (hoof clearance, m): ~2.1 m for a fit
 * 16 hh horse (the high-jump record is 2.47 m; a draft is less scopey). */
export const jumpClearance = (h: HorseState): number => {
  const k = h.ident.breed === "draft" ? 0.7 : h.ident.breed === "friesian" ? 0.82 : h.ident.breed === "quarter" ? 0.9 : 1.0
  return 2.1 * k * h.ident.scale * (0.8 + 0.2 * h.stamina)
}

export type JumpResult = "ok" | "refuse" | "busy"

/**
 * Jump now. From a canter or gallop the horse flies; from a walk or a halt it
 * gathers and leaps a shorter, lower arc. The arc is sized to the tallest thing
 * in the take-off path, and a horse refuses — stops short with a snort — only
 * what nothing could clear: a trunk, a wall, a building.
 */
export const startJump = (h: HorseState): JumpResult => {
  if (h.jumpT >= 0 || h.jumpCool > 0 || h.wade > 0.6) return "busy"
  const clear = jumpClearance(h)
  const standing = h.speed < 1.8
  if (standing) h.speed = Math.max(h.speed, 3.2)
  const reach = Math.max(2.8, h.speed * 0.95)
  const fx = fwdX(h.heading)
  const fz = fwdZ(h.heading)
  let need = 0
  for (let d = 0.8; d <= reach; d += 0.4) {
    const x = h.x + fx * d
    const z = h.z + fz * d
    const g = groundHeight(x, z)
    const top = mountObstacleTop(x, z, 0.5) - g
    if (top > clear) return "refuse"
    need = Math.max(need, top, g - h.y)
  }
  const k = spring(h)
  h.jumpT = 0
  h.jumpDur = ((standing ? 0.7 : 0.72) + Math.min(0.28, h.speed * 0.014)) / Math.sqrt(k)
  h.jumpH = Math.min(clear, Math.max((standing ? 0.6 : 0.85) * k * Math.min(clear, 1.25), need + 0.3))
  return "ok"
}

/** Height of the tallest solid thing under a footprint (absolute, −∞ if none). */
export const mountObstacleTop = (x: number, z: number, r: number): number => {
  let top = -Infinity
  const test = (c: CircleCollider): void => {
    const min = c.r + r
    if ((x - c.x) ** 2 + (z - c.z) ** 2 >= min * min) return
    top = Math.max(top, c.height === undefined || c.height <= 0 ? -Infinity : colliderTop(c))
  }
  for (const c of colliders.circles) test(c)
  for (const rc of colliders.rects) if (x > rc.minX - r && x < rc.maxX + r && z > rc.minZ - r && z < rc.maxZ + r) top = Infinity
  const cx = Math.floor(x / CHUNK_SIZE)
  const cz = Math.floor(z / CHUNK_SIZE)
  for (let iz = -1; iz <= 1; iz++) for (let ix = -1; ix <= 1; ix++) {
    const list = chunkColliders.get(`${cx + ix},${cz + iz}`)
    if (list) for (const c of list) test(c)
  }
  return top
}

/** The highest solid surface a Pegasus could stand on at (x, z): ground, roof or a big rock's top. */
export const mountSurfaceTop = (x: number, z: number): number => Math.max(groundHeight(x, z), standTop(x, z, Infinity))

/** Top of a standable surface (boulder, rock) the hooves can be on, or −∞. */
const standTop = (x: number, z: number, feetY: number): number => {
  let best = -Infinity
  const test = (c: CircleCollider): void => {
    if (!c.standable) return
    if ((x - c.x) ** 2 + (z - c.z) ** 2 >= c.r * c.r * 0.7) return
    const t = colliderTop(c)
    if (t <= feetY + 0.35 && t > best) best = t
  }
  for (const c of colliders.circles) test(c)
  const cx = Math.floor(x / CHUNK_SIZE)
  const cz = Math.floor(z / CHUNK_SIZE)
  for (let iz = -1; iz <= 1; iz++) for (let ix = -1; ix <= 1; ix++) {
    const list = chunkColliders.get(`${cx + ix},${cz + iz}`)
    if (list) for (const c of list) test(c)
  }
  return best
}

/** The airborne part of a jump within its 0..1 progress (take-off 0.16, landing 0.84). */
export const JUMP_UP = 0.07
export const JUMP_DOWN = 0.86

const push = { dx: 0, dz: 0 }

/** Water deeper than this at the barrel is no place to stand (a horse swims there). */
const DEEP = 1.05

/** Felt by the rider when the mount runs into something (0..1, decaying; read by the camera). */
export const mountContactRT = { jolt: 0 }

/** Is a spot somewhere a horse can stand? */
export const standable = (x: number, z: number, radius = 0.55): boolean => {
  const g = groundHeight(x, z)
  const s = waterSurfaceAt(x, z)
  if (s !== null && s - g > DEEP * 0.75) return false
  // hooves on whatever is solid here: the ground, a flat roof's slab, the top of a big rock
  const top = Math.max(g, standTop(x, z, Infinity))
  if (pushMountCircle(x, z, radius, push, top + 0.3)) return false
  const e = 0.9
  const slope = Math.max(Math.abs(groundHeight(x + e, z) - groundHeight(x - e, z)), Math.abs(groundHeight(x, z + e) - groundHeight(x, z - e))) / (2 * e)
  // standing on a rock's flat top, the ground's slope round it does not matter
  return slope < 0.55 || top > g + 0.2
}

/** A short probe ahead for steering: 0 clear … 1 blocked. */
export const probeAhead = (h: HorseState, heading: number, dist: number): number => {
  const x = h.x + fwdX(heading) * dist
  const z = h.z + fwdZ(heading) * dist
  if (pushMountCircle(x, z, 0.6 * h.ident.scale, push)) return 1
  const g1 = groundHeight(x, z)
  if (Math.abs(g1 - groundHeight(h.x, h.z)) / dist > 0.6) return 0.8
  const s = waterSurfaceAt(x, z)
  if (s !== null && s - g1 > DEEP) return 1
  return 0
}

/** Sweep the capsule in short steps, including low-rate distant herd updates. */
export const stepHorseMotion = (h: HorseState, dt: number, wantTurnRate: number | null): void => {
  if (dt <= 0) return
  const count = Math.min(240, Math.ceil(Math.max(dt * 60, Math.abs(h.speed) * dt / 0.3)))
  for (let n = 0; n < count; n++) stepHorseSlice(h, dt / count, wantTurnRate)
}

const stepHorseSlice = (h: HorseState, dt: number, wantTurnRate: number | null): void => {
  const breed = BREEDS[h.ident.breed]
  const tr = h.ident.traits
  const sp = h.pose.speeds
  // ---- no animal in the explorer's universe ever tires: stamina stays full, so a
  // gallop, a jump or a dash holds for as long as the rider asks. Only the
  // living signs of effort remain: deeper breathing and a damp coat at a
  // gallop (never the blowing of an exhausted horse).
  const v = Math.abs(h.speed)
  const gallopFrac = Math.max(0, (v - (sp[2] + sp[3]) * 0.5) / (sp[3] - (sp[2] + sp[3]) * 0.5))
  const canterFrac = Math.max(0, Math.min(1, (v - sp[1]) / (sp[2] - sp[1])))
  h.stamina = 1
  const easy = breed.flight ? 0.35 : 0.6
  h.exertion += ((Math.min(easy, gallopFrac + canterFrac * 0.45)) - h.exertion) * (1 - Math.exp(-dt * (gallopFrac > 0 ? 0.6 : 0.15)))
  let target = h.targetSpeed
  // a Pegasus is a strider: her hooves find the water's surface and she runs
  // on it (Starborn's starlight, Ivory's and Onyx's lift), so water neither
  // slows nor stops her; an ordinary horse wades and will not swim
  const strider = !!h.flight
  // deep or rough going slows a horse; swimming is a steady ~2 m/s whatever is asked
  if (h.wade > 0.05) target = Math.min(target, sp[1] * (1 - h.wade * 0.55))
  if (h.swim > 0.4) target = Math.sign(target) * Math.min(Math.abs(target), sp[1] * 0.58)
  // ---- speed with momentum
  // a companion catching up is pushed a little harder
  // (×1.3: a ridden horse answers the leg briskly; the gallop still takes a few strides)
  const accel = 1.3 * breed.accel * tr.accel * (0.85 + 0.15 * tr.sensitivity) * (h.targetSpeed > h.pose.speeds[3] ? 1.4 : 1)
  const brake = accel * 1.7
  if (h.flight?.landing.run && h.speed > 0 && h.jumpT < 0) {
    // Keep the automatic run physically stoppable at a shoreline, trunk or
    // unloaded chunk, rather than discovering it after the capsule hits it.
    const stop = h.speed * h.speed / (2 * brake) + 2
    const fx = fwdX(h.heading), fz = fwdZ(h.heading)
    for (let d = 1; d <= stop; d += 0.6) {
      const x = h.x + fx * d, z = h.z + fz * d
      if (!(worldStreamRT.streamer?.isAreaReady(x, z, 2) ?? true) || !(strider ? !pushMountCircle(x, z, 0.65 * h.ident.scale, push) : standable(x, z, 0.65 * h.ident.scale))) {
        target = Math.min(target, Math.sqrt(2 * brake * Math.max(0, d - 2)))
        break
      }
    }
  }
  const dv = target - h.speed
  // speed carried in from the air beyond the gallop runs off gradually (the
  // wings half open as air brakes, the strides lengthen then settle), never as
  // a wall: about 3–6 m/s² instead of a full brake
  const overrun = strider && dv < 0 && h.speed > sp[3] * 1.02 && target > 0
  const rate = dv > 0 ? (h.speed < 0 ? brake : accel * (1 - 0.35 * Math.min(1, h.speed / sp[3]))) : overrun ? Math.min(brake, 3 + 0.02 * (h.speed - sp[3]) ** 2) : brake
  const before = h.speed
  h.speed += Math.sign(dv) * Math.min(Math.abs(dv), rate * dt)
  h.accel = (h.speed - before) / Math.max(dt, 1e-4)
  // ---- turning with inertia
  const maxRate = maxTurnRate(h, h.speed)
  let wantRate = 0
  if (wantTurnRate !== null) wantRate = wantTurnRate * maxRate
  else if (h.wantHeading !== null) {
    const d = Math.atan2(Math.sin(h.wantHeading - h.heading), Math.cos(h.wantHeading - h.heading))
    wantRate = Math.max(-maxRate, Math.min(maxRate, d * 2.4))
  }
  const turnK = 5 + 5 * tr.sensitivity
  h.turnRate += (wantRate - h.turnRate) * (1 - Math.exp(-turnK * dt))
  h.heading += h.turnRate * dt
  // ---- jump: a ballistic arc between take-off and landing ----------------
  h.jumpCool = Math.max(0, h.jumpCool - dt)
  let feetY: number | undefined = h.y + 0.3
  if (h.jumpT >= 0) {
    h.jumpT += dt / h.jumpDur
    const a = (h.jumpT - JUMP_UP) / (JUMP_DOWN - JUMP_UP)
    h.jumpY = a > 0 && a < 1 ? h.jumpH * 4 * a * (1 - a) : 0
    // hooves are tucked well above the body's lowest point in the air
    feetY = h.y + h.jumpY * 1.15 - 0.05
    if (h.jumpT >= 1) {
      h.jumpT = -1
      h.jumpY = 0
      h.jumpCool = JUMP_SETTLE
      h.landed = true
    }
  }
  // ---- move the capsule and slide along obstacles
  const s = h.ident.scale
  const len = 0.85 * s * (breed.id === "draft" ? 1.08 : 1)
  const fx = fwdX(h.heading)
  const fz = fwdZ(h.heading)
  // a shove from another horse eases out over a few frames
  const shoveK = 1 - Math.exp(-dt * 8)
  let nx = h.x + fx * h.speed * dt + h.shoveX * shoveK
  let nz = h.z + fz * h.speed * dt + h.shoveZ * shoveK
  h.shoveX -= h.shoveX * shoveK
  h.shoveZ -= h.shoveZ * shoveK
  let mx = 0
  let mz = 0
  let frontHit = 0
  for (const [k, r] of [[len, 0.42], [0, 0.55], [-len, 0.47]] as const) {
    if (pushMountCircle(nx + fx * k, nz + fz * k, r * s, push, feetY)) {
      mx += push.dx
      mz += push.dz
      if (k > 0) frontHit = Math.max(0, -(push.dx * fx + push.dz * fz))
    }
  }
  nx += mx
  nz += mz
  // terrain ahead: refuse a wall of earth
  const chestX = nx + fx * len * Math.sign(h.speed || 1)
  const chestZ = nz + fz * len * Math.sign(h.speed || 1)
  const g1 = groundHeight(chestX, chestZ)
  const climb = (g1 - groundHeight(h.x + fx * len * Math.sign(h.speed || 1), h.z + fz * len * Math.sign(h.speed || 1))) / Math.max(1e-3, Math.hypot(nx - h.x, nz - h.z))
  // (out of its depth an ordinary horse swims: they are strong swimmers)
  const steep = Math.abs(h.speed) > 0.05 && climb > 0.75 && h.jumpT < 0
  h.impactCool = Math.max(0, h.impactCool - dt)
  h.impact = Math.max(0, h.impact - dt * 1.6)
  // running into a wall of earth, a trunk, a rock or a house at any pace is
  // felt: the horse is brought up short, rocks back a step, throws its head
  // and snorts, and the rider feels the jolt (never a glide into it)
  const struck = (steep || (frontHit > 0.02 && h.speed > 0)) && Math.abs(h.speed) > 2.4 && h.impactCool <= 0 && h.jumpT < 0
  if (struck) {
    const strength = Math.min(1, (Math.abs(h.speed) - 1.6) / 9)
    h.impact = Math.max(h.impact, strength)
    h.impactCool = 0.9
    h.shoveX -= fx * Math.min(0.8, Math.abs(h.speed) * 0.07)
    h.shoveZ -= fz * Math.min(0.8, Math.abs(h.speed) * 0.07)
    h.speed *= 0.25
    h.gestureTimers.snort = 0
    if (strength > 0.45) h.gestureTimers.headShake = 0
    h.irritated = Math.max(h.irritated, 0.8)
    if (h.rider) mountContactRT.jolt = Math.max(mountContactRT.jolt, strength)
  }
  if (steep) {
    nx = h.x
    nz = h.z
    h.speed *= Math.exp(-dt * 10)
    h.blocked = Math.min(2, h.blocked + dt)
  } else if (frontHit > 0.02 && h.speed > 0) {
    // ran into something: lose speed fast rather than grinding into it
    h.speed = Math.max(0, h.speed - frontHit / Math.max(dt, 1e-3) * 0.6)
    h.blocked = Math.min(2, h.blocked + dt)
  } else h.blocked = Math.max(0, h.blocked - dt * 2)
  h.x = nx
  h.z = nz
  const ground = groundHeight(h.x, h.z)
  // a horse that has jumped (or stepped) up onto a boulder stands on top of it
  const feet = h.y + h.jumpY
  const onTop = standTop(h.x, h.z, feet)
  h.y = Math.max(ground, onTop)
  if (strider && h.jumpT < 0) {
    // running on the water: the surface is her floor
    const fs = flightWaterSurfaceAt(h.x, h.z)
    if (fs !== null && fs > h.y) h.y = fs
  }
  const ws = waterSurfaceAt(h.x, h.z)
  h.wade = strider ? 0 : ws === null ? 0 : Math.max(0, Math.min(1, (ws - h.y) / 0.9))
  if (!strider && h.jumpT < 0) {
    // afloat: the body rides with only its head, neck and a ridge of back above the surface
    const w = creatureWaterY(h.x, h.z, WATER_WAYS.horse, h.ident.scale, h.y)
    h.swim += (w.swim - h.swim) * (1 - Math.exp(-dt * 3))
    if (w.swim > 0) h.y = h.y + (w.y - h.y) * Math.min(1, h.swim * 1.4)
  } else h.swim = Math.max(0, h.swim - dt * 3)
}
