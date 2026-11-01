import * as THREE from "three"
import { dampAngle } from "../../../utils/math"
import { resolveCollisions, stepMovement, supportTop, STEP_UP } from "../../movement"
import type { CircleCollider, RectCollider } from "../../world-layout"
import { groundHeight } from "../../world-layout"
import { waterSurfaceAt } from "../../../world/waterSurface"
import { gravityAt } from "../../../world/realmHook"
import { nearbyWorldColliders } from "../../../world/colliders"
import { createPlayerMotion, resetPlayerMotion, runningLaunch, stepPlayerMotion, type PlayerMotion } from "../playerMotion"

/** Low gravity: the loping bound of a fast walk on the Moon (Apollo crews moved this way), m/s at take-off. */
const LOPE_LAUNCH = 1.7

/**
 * Shared locomotion for every playable character (The explorer, the companion, …): walking,
 * running, stepping onto rocks, jumping, falling off ledges, wading and
 * swimming. Characters differ only in their `LocomotionTuning` and in the
 * animator that turns the resulting state into a pose.
 */

export type LocomotionTuning = {
  radius: number
  walkSpeed: number
  runSpeed: number
  accel: number
  decel: number
  turnRate: number
  swimSpeed: number
  swimSprint: number
  /** feet-to-waterline distance while floating (roughly chest height) */
  floatDraft: number
  /** water depth at which the body starts to float / stops floating */
  swimEnter: number
  swimExit: number
}

export type LocomotionIntent = {
  /** camera-relative world-space move (x, z as y), length ≤ 1 */
  move: { x: number; y: number }
  sprint: boolean
  /** edge-triggered; buffered for a short time */
  jump: boolean
  /** the jump button is still held (releasing cuts the rise short); unset counts as held */
  jumpHeld?: boolean
}

/** The physical body a controller moves. playerRT satisfies this. */
export type LocomotionBody = {
  pos: THREE.Vector3
  vel: THREE.Vector3
  facing: number
  speed: number
  moving: boolean
  idleTime: number
}

export type WaterState = "land" | "wade" | "swim"

export type LocomotionState = {
  motion: PlayerMotion
  jumpBuffer: number
  water: WaterState
  /** seconds in the current water state (hysteresis against flicker) */
  waterTime: number
  /** 0..1 smoothed float weight for posing */
  swim: number
  /** 0..1 depth of water on the legs (0 dry, 1 chest deep) */
  wade: number
  waterSurface: number | null
  /** extra vertical offset that eases small step-ups instead of popping */
  stepSmooth: number
  /** smoothed root height while floating */
  floatY: number
  collided: boolean
  /** events for audio / effects this frame */
  landed: boolean
  enteredWater: boolean
  startedSwimming: boolean
  leftWater: boolean
  /** absolute feet height of the surface currently supporting the body */
  support: number
  /** horizontal speed carried out of the last take-off (air momentum is kept up to it) */
  airSpeed: number
}

export const createLocomotion = (): LocomotionState => ({
  motion: createPlayerMotion(),
  jumpBuffer: 0,
  water: "land",
  waterTime: 0,
  swim: 0,
  wade: 0,
  waterSurface: null,
  stepSmooth: 0,
  floatY: 0,
  collided: false,
  landed: false,
  enteredWater: false,
  startedSwimming: false,
  leftWater: false,
  support: 0,
  airSpeed: 0,
})

/** Teleports, respawns and scripted placement: settle on whatever is below. */
export const resetLocomotion = (state: LocomotionState, body: LocomotionBody, tuning?: LocomotionTuning, circles: CircleCollider[] = [], streamed: CircleCollider[] = nearbyWorldColliders): void => {
  const ground = Math.max(groundHeight(body.pos.x, body.pos.z), supportTop(body.pos.x, body.pos.z, tuning?.radius ?? 0.34, body.pos.y, circles, streamed))
  resetPlayerMotion(state.motion, ground)
  state.jumpBuffer = 0
  state.stepSmooth = 0
  state.floatY = ground
  state.support = ground
  const surface = waterSurfaceAt(body.pos.x, body.pos.z)
  const depth = surface === null ? 0 : surface - ground
  state.water = depth > 0.25 ? (depth > (tuning?.swimEnter ?? 1.25) ? "swim" : "wade") : "land"
  state.swim = state.water === "swim" ? 1 : 0
  state.wade = THREE.MathUtils.clamp(depth / (tuning?.swimEnter ?? 1.25), 0, 1)
  state.waterSurface = surface
  state.floatY = state.water === "swim" ? Math.max(ground, surface! - (tuning?.floatDraft ?? 1.12)) : ground
  body.pos.y = state.floatY
  body.vel.y = 0
  state.waterTime = 1
  state.landed = state.enteredWater = state.startedSwimming = state.leftWater = false
}

const next = { x: 0, z: 0 }
/** A press this long before touchdown still jumps on landing. */
const JUMP_BUFFER = 0.15
/** In the air: steering authority (1/s) and how little she slows with no input. */
const AIR_ACCEL = 6.5
const AIR_DRAG = 0.6

/**
 * Advance one body by `dt`. `intent` null means the body is not under
 * control (cutscene, inactive character): it decelerates and keeps physics.
 */
export const stepLocomotion = (
  body: LocomotionBody,
  state: LocomotionState,
  tuning: LocomotionTuning,
  intent: LocomotionIntent | null,
  circles: CircleCollider[],
  rects: RectCollider[],
  dt: number,
  streamed: CircleCollider[] = nearbyWorldColliders,
): void => {
  state.landed = false
  state.enteredWater = false
  state.startedSwimming = false
  state.leftWater = false
  state.waterTime += dt

  const motion = state.motion
  const feetY = body.pos.y
  const grounded = motion.phase === "grounded" || motion.phase === "landing"
  const stepUp = grounded ? STEP_UP : 0

  // --- horizontal --------------------------------------------------------------
  const move = intent?.move ?? ZERO_MOVE
  const stick = Math.min(1, Math.hypot(move.x, move.y))
  // water resists: wading slows her progressively, swimming is its own gait
  const wadeDrag = 1 - 0.45 * state.wade * (1 - state.swim)
  // another world's gravity: under a sixth of a g the feet find little grip,
  // so starting, stopping and the top speed all come down (traction ∝ weight)
  const g = gravityAt(body.pos.x, body.pos.z)
  const grip = g < 1 ? 0.35 + 0.65 * g : 1
  const lowG = g < 1 ? (intent?.sprint ? 0.78 : 0.82) + 0.2 * g : 1
  const landSpeed = (intent?.sprint ? tuning.runSpeed : tuning.walkSpeed) * wadeDrag * lowG
  const swimSpeed = intent?.sprint ? tuning.swimSprint : tuning.swimSpeed
  const maxSpeed = THREE.MathUtils.lerp(landSpeed, swimSpeed, state.swim)
  // Airborne she keeps the momentum she jumped with and can still steer it:
  // less authority than on the ground, but no braking when the stick is let go.
  const airborne = !grounded && state.swim < 0.5
  const accel = airborne ? AIR_ACCEL * grip : THREE.MathUtils.lerp(tuning.accel * grip, 6.5, state.swim)
  const decel = airborne ? AIR_DRAG : THREE.MathUtils.lerp(tuning.decel * grip, 2.2, state.swim)
  stepMovement(body.vel, move, dt, airborne ? Math.max(maxSpeed, state.airSpeed) : maxSpeed, accel, decel)

  next.x = body.pos.x + body.vel.x * dt
  next.z = body.pos.z + body.vel.z * dt
  state.collided = resolveCollisions(next, tuning.radius, circles, rects, { feetY, stepUp, canSwim: true, streamed })
  if (state.collided && dt > 0) {
    // keep only the motion that actually happened: she slides along obstacles
    // instead of grinding into them (frame-rate independent blend)
    const k = 1 - Math.exp(-30 * dt)
    body.vel.x += ((next.x - body.pos.x) / dt - body.vel.x) * k
    body.vel.z += ((next.z - body.pos.z) / dt - body.vel.z) * k
  }
  body.pos.x = next.x
  body.pos.z = next.z
  body.speed = Math.hypot(body.vel.x, body.vel.z)
  body.moving = body.speed > 0.1

  // Facing follows what the player asks for, not the post-collision slide,
  // so brushing a rock never twists her body sideways.
  if (stick > 0.05) {
    const target = Math.atan2(move.x, move.y)
    const rate = THREE.MathUtils.lerp(tuning.turnRate + body.speed * 0.6, 4.2, state.swim)
    body.facing = dampAngle(body.facing, target, rate, dt)
    body.idleTime = 0
  } else {
    body.idleTime += dt
  }

  // --- vertical ------------------------------------------------------------------
  const terrain = groundHeight(body.pos.x, body.pos.z)
  const support = Math.max(terrain, supportTop(body.pos.x, body.pos.z, tuning.radius, feetY, circles, streamed, stepUp))
  const surface = waterSurfaceAt(body.pos.x, body.pos.z)
  state.waterSurface = surface
  const depth = surface === null ? 0 : Math.max(0, surface - support)

  // water state machine with hysteresis + minimum dwell, so the shoreline
  // never flickers between walking and swimming
  const previous = state.water
  let water = previous
  const dwell = state.waterTime > 0.25
  if (previous === "swim") {
    if (depth < tuning.swimExit && dwell) water = depth > 0.25 ? "wade" : "land"
  } else if (depth > tuning.swimEnter && (grounded || feetY < (surface ?? -Infinity))) {
    water = "swim"
  } else if (depth > 0.25) {
    water = "wade"
  } else if (depth < 0.18 || surface === null) {
    water = "land"
  }
  if (water !== previous) {
    state.water = water
    state.waterTime = 0
    if (previous === "land") state.enteredWater = true
    if (water === "swim") state.startedSwimming = true
    if (water === "land") state.leftWater = true
  }
  state.swim += ((water === "swim" ? 1 : 0) - state.swim) * (1 - Math.exp(-3.2 * dt))
  const wadeTarget = surface === null ? 0 : THREE.MathUtils.clamp(depth / tuning.swimEnter, 0, 1)
  state.wade += (wadeTarget - state.wade) * (1 - Math.exp(-8 * dt))

  // A short press just before touchdown survives until the next update.
  if (intent?.jump) state.jumpBuffer = JUMP_BUFFER
  else state.jumpBuffer = Math.max(0, state.jumpBuffer - dt)
  const wantJump = state.jumpBuffer > 0 && grounded && state.water !== "swim"
  // a jump pressed a moment after running off an edge still takes off
  const coyote = !wantJump && state.jumpBuffer > 0 && motion.phase === "falling" && motion.coyote > 0 && state.water !== "swim"
  if (wantJump || coyote) state.jumpBuffer = 0

  const floatLine = (surface ?? support) - tuning.floatDraft
  const caught = grounded || (motion.phase === "falling" && feetY <= floatLine + 0.05)
  if (state.water === "swim" && caught) {
    if (!grounded) state.landed = true // a splash-down
    // floating: no gravity, the body eases to the waterline and bobs gently
    resetPlayerMotion(motion, support)
    if (state.waterTime === 0 || !grounded) state.floatY = feetY
    state.floatY += (Math.max(floatLine, support) - state.floatY) * (1 - Math.exp(-3.5 * dt))
    body.pos.y = state.floatY
    state.support = support
    state.stepSmooth = 0
    return
  }

  const before = motion.ground
  // a quick pace in low gravity becomes a run of low, floating bounds
  const lope = !wantJump && g < 0.5 && grounded && motion.phase === "grounded" && !!intent?.sprint && stick > 0.6 && body.speed > maxSpeed * 0.55
  const jumpHeld = intent ? intent.jumpHeld ?? true : true
  state.landed = stepPlayerMotion(motion, dt, support, wantJump || lope || coyote, g, lope ? LOPE_LAUNCH : runningLaunch(g, body.speed), jumpHeld)
  if (motion.phase === "rising" && motion.time <= dt + 1e-6) state.airSpeed = body.speed
  else if (grounded) state.airSpeed = 0
  // A grounded step up onto a rock is eased over ~0.1 s rather than popping,
  // and a small step down settles instead of snapping.
  if (grounded && support > before + 0.02 && support - before <= 0.4) state.stepSmooth -= support - before
  // (only real steps: a slope descends a few cm a frame and must not float)
  if (grounded && motion.phase !== "rising" && support < before - 0.08 && before - support <= 0.42) state.stepSmooth += before - support
  state.stepSmooth *= Math.exp(-(state.stepSmooth > 0 ? 16 : 22) * dt)
  // Leaving the float: start the walk from where the body was, not the bed.
  if (state.swim > 0.02 && state.water !== "swim") {
    state.floatY += (support + motion.lift - state.floatY) * (1 - Math.exp(-4 * dt))
    body.pos.y = Math.max(support + motion.lift, state.floatY * state.swim + (support + motion.lift) * (1 - state.swim))
  } else {
    state.floatY = support + motion.lift
    body.pos.y = support + motion.lift
  }
  state.support = support
}

const ZERO_MOVE = { x: 0, y: 0 }
