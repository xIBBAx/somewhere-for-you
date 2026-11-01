import * as THREE from "three"

/**
 * The dragon, the golden dragon: a long Eastern (lung) dragon who swims through
 * the air rather than flapping. Only the head is flown; the body follows the
 * exact path the head has taken (a ring of samples spaced along its length),
 * with a travelling wave on top, so every turn and climb ripples down to the
 * tail the way a serpent's does.
 *
 * Pure logic, no rendering: the renderer (Dragon.tsx) reads the trail and
 * poses the bones; tests drive it directly.
 */

export type DragonMode =
  /** lazy loops high over the wide world */
  | "soar"
  /** answering her call: flying in from wherever it is */
  | "come"
  /** low, slow circles about her, waiting to be ridden */
  | "circle"
  /** she is lifted onto the neck */
  | "board"
  /** she flies it */
  | "ride"
  /** settling low so she can step down */
  | "alight"

export type DragonControls = {
  /** -1 left … 1 right */
  turn: number
  /** -1 slow … 1 faster (W/S) */
  throttle: number
  /** -1 dive (C) … 1 climb (Space) */
  climb: number
  /** Shift: the golden rush */
  surge: boolean
}

/** samples along the path the head has flown, newest first (metres apart) */
export const TRAIL_SPACING = 0.45
export const TRAIL_SAMPLES = 160

export type DragonTrail = {
  /** x, y, z per sample */
  pos: Float64Array
  /** the body's up (banked) per sample */
  up: Float32Array
  /** index of the newest sample */
  head: number
  /** samples written so far (≤ TRAIL_SAMPLES) */
  count: number
  /** metres the head has flown since the newest sample */
  lead: number
}

export type DragonState = {
  mode: DragonMode
  modeT: number
  /** the head (the joint behind the skull), logical world space */
  x: number
  y: number
  z: number
  heading: number
  pitch: number
  bank: number
  speed: number
  /** 0..1 the golden rush */
  surge: number
  /** where it wanders: a waypoint while soaring, her position while circling */
  goalX: number
  goalY: number
  goalZ: number
  /** the circle's turn direction (1 or -1) */
  orbit: number
  trail: DragonTrail
  /** seconds flown: drives the swim wave */
  clock: number
  /** 0..1 how low it is to the ground (claws reach out, legs paddle less) */
  low: number
}

export type DragonWorld = {
  /** the top of whatever is solid under a point (ground, water, tree crowns) */
  top: (x: number, z: number) => number
  random: () => number
}

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
const damp = (a: number, b: number, k: number, dt: number): number => a + (b - a) * (1 - Math.exp(-k * dt))
const angleTo = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from))

/** forward for a heading (0 = +z, turning toward +x) and a pitch (up positive) */
export const forwardOf = (heading: number, pitch: number, out: THREE.Vector3): THREE.Vector3 =>
  out.set(Math.sin(heading) * Math.cos(pitch), Math.sin(pitch), Math.cos(heading) * Math.cos(pitch))

const _f = new THREE.Vector3()
const _r = new THREE.Vector3()
const _u = new THREE.Vector3()
const WORLD_UP = new THREE.Vector3(0, 1, 0)

/** the head's banked up vector */
export const upOf = (heading: number, pitch: number, bank: number, out: THREE.Vector3): THREE.Vector3 => {
  forwardOf(heading, pitch, _f)
  // right = forward × up (at heading 0 that is −x: the model's right)
  _r.crossVectors(_f, WORLD_UP)
  if (_r.lengthSq() < 1e-6) _r.set(-Math.cos(heading), 0, Math.sin(heading))
  _r.normalize()
  _u.crossVectors(_r, _f).normalize()
  // a positive bank rolls the up vector toward the right wing (a right turn)
  return out.copy(_u).multiplyScalar(Math.cos(bank)).addScaledVector(_r, Math.sin(bank)).normalize()
}

export const makeTrail = (): DragonTrail => ({
  pos: new Float64Array(TRAIL_SAMPLES * 3),
  up: new Float32Array(TRAIL_SAMPLES * 3),
  head: 0,
  count: 0,
  lead: 0,
})

/** Fill the whole trail straight out behind the head (on spawn or a teleport). */
export const resetTrail = (d: DragonState): void => {
  const t = d.trail
  forwardOf(d.heading, d.pitch, _f)
  upOf(d.heading, d.pitch, 0, _u)
  for (let i = 0; i < TRAIL_SAMPLES; i++) {
    const s = i * TRAIL_SPACING
    t.pos[i * 3] = d.x - _f.x * s
    t.pos[i * 3 + 1] = d.y - _f.y * s
    t.pos[i * 3 + 2] = d.z - _f.z * s
    t.up[i * 3] = _u.x
    t.up[i * 3 + 1] = _u.y
    t.up[i * 3 + 2] = _u.z
  }
  t.head = 0
  t.count = TRAIL_SAMPLES
  t.lead = 0
}

export const makeDragon = (x: number, y: number, z: number, heading: number): DragonState => {
  const d: DragonState = {
    mode: "soar", modeT: 0, x, y, z, heading, pitch: 0, bank: 0, speed: 15, surge: 0,
    goalX: x, goalY: y, goalZ: z, orbit: 1, trail: makeTrail(), clock: 0, low: 0,
  }
  resetTrail(d)
  return d
}

/** Record the head's travel: a new sample each TRAIL_SPACING metres. */
const recordTrail = (d: DragonState, moved: number): void => {
  const t = d.trail
  // a teleport (QA, a fast-travel) re-lays the body behind it rather than stretching it
  const n0 = t.head * 3
  if (Math.hypot(d.x - t.pos[n0], d.y - t.pos[n0 + 1], d.z - t.pos[n0 + 2]) > t.lead + moved + TRAIL_SPACING * 8) {
    resetTrail(d)
    return
  }
  t.lead += moved
  if (t.lead < TRAIL_SPACING) return
  upOf(d.heading, d.pitch, d.bank, _u)
  const n = t.head * 3
  const px = t.pos[n], py = t.pos[n + 1], pz = t.pos[n + 2]
  // lay samples exactly TRAIL_SPACING apart on the segment toward the head
  let ax = d.x - px, ay = d.y - py, az = d.z - pz
  const len = Math.hypot(ax, ay, az) || 1
  ax /= len; ay /= len; az /= len
  let sx = px, sy = py, sz = pz
  let guard = 0
  while (t.lead >= TRAIL_SPACING && guard++ < 64) {
    sx += ax * TRAIL_SPACING
    sy += ay * TRAIL_SPACING
    sz += az * TRAIL_SPACING
    t.head = (t.head - 1 + TRAIL_SAMPLES) % TRAIL_SAMPLES
    const k = t.head * 3
    t.pos[k] = sx; t.pos[k + 1] = sy; t.pos[k + 2] = sz
    t.up[k] = _u.x; t.up[k + 1] = _u.y; t.up[k + 2] = _u.z
    t.lead -= TRAIL_SPACING
    t.count = Math.min(TRAIL_SAMPLES, t.count + 1)
  }
  if (guard >= 64) resetTrail(d)
}

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()

/**
 * A point on the body `s` metres back along the path from the head (and the
 * up vector there). Beyond the recorded trail the body continues straight.
 */
export const trailAt = (d: DragonState, s: number, outPos: THREE.Vector3, outUp?: THREE.Vector3): THREE.Vector3 => {
  const t = d.trail
  if (s <= t.lead) {
    // between the head and the newest sample
    const n = t.head * 3
    const k = t.lead > 1e-6 ? s / t.lead : 0
    outPos.set(d.x + (t.pos[n] - d.x) * k, d.y + (t.pos[n + 1] - d.y) * k, d.z + (t.pos[n + 2] - d.z) * k)
    if (outUp) upOf(d.heading, d.pitch, d.bank, outUp).lerp(_b.set(t.up[n], t.up[n + 1], t.up[n + 2]), k).normalize()
    return outPos
  }
  const j = (s - t.lead) / TRAIL_SPACING
  const i0 = Math.floor(j)
  const f = j - i0
  const last = t.count - 1
  if (i0 >= last) {
    // past the end: extend along the last segment
    const iL = ((t.head + last) % TRAIL_SAMPLES) * 3
    const iP = ((t.head + Math.max(0, last - 1)) % TRAIL_SAMPLES) * 3
    _a.set(t.pos[iL] - t.pos[iP], t.pos[iL + 1] - t.pos[iP + 1], t.pos[iL + 2] - t.pos[iP + 2])
    const over = (j - last) * TRAIL_SPACING
    if (_a.lengthSq() > 1e-9) _a.normalize().multiplyScalar(over)
    outPos.set(t.pos[iL] + _a.x, t.pos[iL + 1] + _a.y, t.pos[iL + 2] + _a.z)
    if (outUp) outUp.set(t.up[iL], t.up[iL + 1], t.up[iL + 2])
    return outPos
  }
  const a = ((t.head + i0) % TRAIL_SAMPLES) * 3
  const b = ((t.head + i0 + 1) % TRAIL_SAMPLES) * 3
  outPos.set(t.pos[a] + (t.pos[b] - t.pos[a]) * f, t.pos[a + 1] + (t.pos[b + 1] - t.pos[a + 1]) * f, t.pos[a + 2] + (t.pos[b + 2] - t.pos[a + 2]) * f)
  if (outUp) outUp.set(t.up[a] + (t.up[b] - t.up[a]) * f, t.up[a + 1] + (t.up[b + 1] - t.up[a + 1]) * f, t.up[a + 2] + (t.up[b + 2] - t.up[a + 2]) * f).normalize()
  return outPos
}

/** Speeds (m/s): a slow swim when circling her, a cruise, and the golden rush. */
export const DRAGON_SPEED = { circle: 9, soar: 16, cruise: 24, fast: 36, rush: 64, min: 7 }
/** metres above whatever is below that it keeps (riding, soaring) */
const CLEAR_RIDE = 6
const CLEAR_SOAR = 38
const SOAR_RADIUS = 420
const CEILING = 900

export type DragonStepInput = {
  dt: number
  /** where she is (for come / circle / board) */
  her: { x: number; y: number; z: number }
  controls: DragonControls | null
  /** the wide world's centre (home) for soaring */
  homeX: number
  homeZ: number
}

const setMode = (d: DragonState, mode: DragonMode): void => {
  if (d.mode === mode) return
  d.mode = mode
  d.modeT = 0
}

export const setDragonMode = setMode

/** Steer the head toward a point at a speed (soar / come / circle / alight). */
const steerToward = (d: DragonState, gx: number, gy: number, gz: number, speed: number, dt: number, agility = 1): void => {
  const dx = gx - d.x, dz = gz - d.z
  const horizontal = Math.hypot(dx, dz)
  const want = Math.atan2(dx, dz)
  const turn = clamp(angleTo(d.heading, want), -1.2, 1.2)
  const rate = turn * 1.1 * agility
  d.heading += rate * dt
  // a rising heading turns toward +x, its left: the roll goes the other way
  d.bank = damp(d.bank, clamp(-rate * d.speed * 0.045, -0.75, 0.75), 3, dt)
  const wantPitch = clamp(Math.atan2(gy - d.y, Math.max(horizontal, 8)), -0.55, 0.55)
  d.pitch = damp(d.pitch, wantPitch, 1.6 * agility, dt)
  d.speed = damp(d.speed, speed, 1.2, dt)
}

/**
 * One step of the dragon's flight. Returns the distance the head moved (so
 * the renderer can turn the swim wave by distance, not time).
 */
export const stepDragon = (d: DragonState, world: DragonWorld, input: DragonStepInput): number => {
  const dt = clamp(input.dt, 0, 0.1)
  if (dt <= 0) return 0
  d.modeT += dt
  d.clock += dt
  const her = input.her

  if (d.mode === "soar") {
    // a new waypoint when the old one is reached: anywhere over the wide world, high
    if (Math.hypot(d.goalX - d.x, d.goalZ - d.z) < 70 || d.modeT > 90) {
      const a = world.random() * Math.PI * 2
      const r = SOAR_RADIUS * (0.35 + world.random() * 0.65)
      d.goalX = input.homeX + Math.cos(a) * r
      d.goalZ = input.homeZ + Math.sin(a) * r
      d.goalY = world.top(d.goalX, d.goalZ) + CLEAR_SOAR + 40 + world.random() * 90
      d.modeT = 0
    }
    steerToward(d, d.goalX, d.goalY, d.goalZ, DRAGON_SPEED.soar, dt, 0.6)
    d.surge = damp(d.surge, 0, 2, dt)
  } else if (d.mode === "come") {
    const gy = Math.max(world.top(her.x, her.z) + 14, her.y + 12)
    steerToward(d, her.x, gy, her.z, DRAGON_SPEED.fast, dt, 1)
    if (Math.hypot(her.x - d.x, her.z - d.z) < 46) setMode(d, "circle")
    d.surge = damp(d.surge, 0, 2, dt)
  } else if (d.mode === "circle" || d.mode === "board" || d.mode === "alight") {
    // circles round her, low and slow; boarding draws the circle in to her side
    const radius = d.mode === "board" ? 9 : d.mode === "alight" ? 11 : 15
    const ground = world.top(her.x, her.z)
    const height = d.mode === "board" || d.mode === "alight" ? Math.max(her.y + 1.2, ground + 1.8) : Math.max(her.y + 3.2, ground + 3.6)
    const ang = Math.atan2(d.x - her.x, d.z - her.z) + d.orbit * 0.55
    const gx = her.x + Math.sin(ang) * radius
    const gz = her.z + Math.cos(ang) * radius
    steerToward(d, gx, height, gz, d.mode === "circle" ? DRAGON_SPEED.circle : DRAGON_SPEED.min + 1.5, dt, 1.4)
    d.surge = damp(d.surge, 0, 2, dt)
  } else if (d.mode === "ride" && input.controls) {
    const c = input.controls
    const want = c.surge ? DRAGON_SPEED.rush : c.throttle > 0.2 ? DRAGON_SPEED.fast : c.throttle < -0.2 ? DRAGON_SPEED.min + 2 : DRAGON_SPEED.cruise
    d.surge = damp(d.surge, c.surge ? 1 : 0, c.surge ? 2.2 : 1.4, dt)
    d.speed = damp(d.speed, want, c.surge ? 1.6 : 1.1, dt)
    // turning is sharper slow and steadier fast: a serpent carves its curves
    const agility = 1.25 - 0.45 * clamp((d.speed - DRAGON_SPEED.cruise) / (DRAGON_SPEED.rush - DRAGON_SPEED.cruise), 0, 1)
    const rate = -c.turn * agility
    d.heading += rate * dt
    d.bank = damp(d.bank, clamp(-rate * (0.3 + d.speed * 0.02), -0.85, 0.85), 3.2, dt)
    d.pitch = damp(d.pitch, c.climb * 0.62, 2.2, dt)
  }

  // never into the ground, the water or the crowns: climb over what is ahead
  const clearance = d.mode === "ride" ? CLEAR_RIDE : d.mode === "soar" ? CLEAR_SOAR * 0.4 : d.mode === "circle" ? 2.4 : 0.9
  forwardOf(d.heading, d.pitch, _f)
  const look = Math.max(10, d.speed * 1.6)
  const aheadTop = Math.max(world.top(d.x + _f.x * look, d.z + _f.z * look), world.top(d.x + _f.x * look * 0.5, d.z + _f.z * look * 0.5))
  const floor = Math.max(world.top(d.x, d.z), aheadTop) + clearance
  if (d.y < floor + 4) d.pitch = Math.max(d.pitch, clamp((floor + 4 - d.y) * 0.08, 0, 0.7))
  if (d.y > CEILING) d.pitch = Math.min(d.pitch, -0.05)

  forwardOf(d.heading, d.pitch, _f)
  const step = d.speed * dt
  d.x += _f.x * step
  d.y += _f.y * step
  d.z += _f.z * step
  const hard = world.top(d.x, d.z) + Math.min(clearance, 1.2)
  if (d.y < hard) d.y = hard
  d.low = damp(d.low, clamp(1 - (d.y - world.top(d.x, d.z)) / 12, 0, 1), 2, dt)
  recordTrail(d, step)
  return step
}

/** The swim wave across the body, `s` metres from the head (render-side offset, metres). */
export const swimWave = (d: DragonState, s: number, length: number, out: { side: number; lift: number }): void => {
  const ramp = clamp((s - 2.5) / 5, 0, 1) * (1 - 0.35 * clamp(s / length, 0, 1))
  const slow = 1 - 0.55 * d.low
  // the wave travels down the body: its phase moves tail-ward with the clock
  const phase = s * (Math.PI * 2 / 13) - d.clock * (2.6 + d.speed * 0.05)
  out.side = Math.sin(phase) * 0.9 * ramp * slow
  out.lift = Math.sin(phase * 0.5 + 1.3) * 0.7 * ramp * slow
}
