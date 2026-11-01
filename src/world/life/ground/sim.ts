import { WATER_LEVEL } from "../../climate"
import { hash01, hash3, hash32 } from "../../noise"
import { WORLD_SEED } from "../../worldConfig"
import {
  allActivity,
  COLONY_CELL,
  findTreeTrunk,
  insideScatter,
  landingOk,
  makeColonyPlan,
  makeEnv,
  planColony,
  planSlot,
  PLAN_CELL,
  PLAN_SLOTS,
  type ColonyPlan,
  type GroundEnv,
  type SlotPlan,
  type TreeFinder,
} from "./habitat"
import { groundHeightAt } from "./groundHeight"
import { ANTS_PER_COLONY, COLONY_MAX, K, KIND_ALERT, KIND_CAP, KIND_COUNT, KIND_SCALE, KIND_STRIDE } from "./roster"

/**
 * Ground-life simulation, in logical world coordinates only (float64 JS
 * numbers). Nothing here knows about the floating render origin, so origin
 * rebases can never move a creature; the renderer subtracts the origin when it
 * writes instance matrices.
 *
 * Two populations:
 *  - walkers: pooled individuals with small per-kind state machines,
 *    planned per 7 m cell from position hashes;
 *  - ant colonies: a nest, a food source and a scent trail; each ant's pose
 *    is an analytic function of time along the trail (no per-ant state).
 *
 * The hot path (`step`, `evalAnt`) allocates nothing.
 */

export const PLAN_RADIUS = 28
export const COLONY_RADIUS = 34
export const REFRESH_INTERVAL = 0.5
export const SEEN_RADIUS = 2.5
export const SEEN_DWELL = 1
export const TRAIL_N = 32

export const S = {
  idle: 0,
  walk: 1,
  flee: 2,
  hop: 3,
  fly: 4,
  curl: 5,
  climb: 6,
  perch: 7,
  descend: 8,
  hide: 9,
  dormant: 10,
  bob: 11,
  rear: 12,
  home: 13,
} as const

const SEED = WORLD_SEED ^ 0x51c7

/** How far a creature strays from its home spot (m). */
const LEASH: readonly number[] = [0, 0, 1.6, 2.6, 2.2, 2.4, 0.35, 2, 1.2, 1.5, 0.9, 1.1]

export type Critter = {
  live: boolean
  keep: boolean
  /** test/debug spawns survive refreshes */
  pinned: boolean
  key: number
  kind: number
  hx: number
  hz: number
  leash: number
  x: number
  z: number
  y: number
  lift: number
  liftTarget: number
  heading: number
  turn: number
  speed: number
  dash: number
  pitch: number
  roll: number
  state: number
  timer: number
  timer2: number
  cooldown: number
  rng: number
  /** activity threshold: out while u < kind activity */
  u: number
  /** snails: shown as a sealed shell while dormant when below 0.45 */
  shell: number
  active: boolean
  hidden: boolean
  presence: number
  size: number
  phase: number
  curl: number
  wing: number
  extra: number
  sing: number
  tr: number
  tg: number
  tb: number
  variant: number
  ax: number
  az: number
  ay: number
  bx: number
  bz: number
  arcT: number
  arcDur: number
  arcH: number
  arcLiftB: number
  gy: number
  gsx: number
  gsz: number
  dist: number
  burrowHeading: number
}

const makeCritter = (kind: number): Critter => ({
  live: false, keep: false, pinned: false, key: 0, kind,
  hx: 0, hz: 0, leash: 1, x: 0, z: 0, y: 0, lift: 0, liftTarget: 0,
  heading: 0, turn: 0, speed: 0, dash: 0, pitch: 0, roll: 0,
  state: 0, timer: 0, timer2: 0, cooldown: 0, rng: 1, u: 0, shell: 1, active: false, hidden: false,
  presence: 0, size: 1, phase: 0, curl: 0, wing: 0, extra: 0, sing: 0,
  tr: 0, tg: 0, tb: 0, variant: 0,
  ax: 0, az: 0, ay: 0, bx: 0, bz: 0, arcT: 0, arcDur: 1, arcH: 0, arcLiftB: 0,
  gy: 0, gsx: Number.NaN, gsz: Number.NaN, dist: Infinity, burrowHeading: 0,
})

export type Colony = {
  live: boolean
  keep: boolean
  key: number
  species: number
  nx: number
  nz: number
  ny: number
  size: number
  moundH: number
  tree: boolean
  trunkX: number
  trunkZ: number
  trunkR: number
  climb: number
  groundLen: number
  length: number
  step: number
  px: Float64Array
  pz: Float64Array
  py: Float32Array
  qx: Float32Array
  qz: Float32Array
  ants: number
  moundAnts: number
  antPhase: Float32Array
  antOmega: Float32Array
  antPause: Float32Array
  antSpeed: Float32Array
  antLane: Float32Array
  antCarry: Uint8Array
  /** smoothed share of the colony out foraging */
  out: number
}

const makeColony = (): Colony => ({
  live: false, keep: false, key: 0, species: 0, nx: 0, nz: 0, ny: 0, size: 0, moundH: 0,
  tree: false, trunkX: 0, trunkZ: 0, trunkR: 0, climb: 0, groundLen: 0, length: 0, step: 0,
  px: new Float64Array(TRAIL_N + 1), pz: new Float64Array(TRAIL_N + 1), py: new Float32Array(TRAIL_N + 1),
  qx: new Float32Array(TRAIL_N + 1), qz: new Float32Array(TRAIL_N + 1),
  ants: 0, moundAnts: 0,
  antPhase: new Float32Array(ANTS_PER_COLONY), antOmega: new Float32Array(ANTS_PER_COLONY),
  antPause: new Float32Array(ANTS_PER_COLONY), antSpeed: new Float32Array(ANTS_PER_COLONY),
  antLane: new Float32Array(ANTS_PER_COLONY), antCarry: new Uint8Array(ANTS_PER_COLONY),
  out: 0,
})

export type AntPose = {
  x: number
  y: number
  z: number
  heading: number
  pitch: number
  /** 0…1 scale: ants fade in and out at the nest entrance */
  vis: number
  carry: number
  wiggle: number
  gait: number
}

export const makeAntPose = (): AntPose => ({ x: 0, y: 0, z: 0, heading: 0, pitch: 0, vis: 0, carry: 0, wiggle: 0, gait: 0 })

/** Something big that creatures notice: the active avatar or the cat. */
export type Disturber = { x: number; z: number; speed: number; active: boolean }

export type GroundSimOptions = {
  ground?: (x: number, z: number) => number
  trees?: TreeFinder
  /** true where trunks or boulders stand (spawn-time check) */
  blocked?: (x: number, z: number) => boolean
}

// --- small helpers ------------------------------------------------------------

const TAU = Math.PI * 2

const rand = (c: Critter): number => {
  const a = (c.rng + 0x6d2b79f5) | 0
  c.rng = a
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const angleDiff = (a: number, b: number): number => {
  let d = (b - a) % TAU
  if (d > Math.PI) d -= TAU
  else if (d < -Math.PI) d += TAU
  return d
}

const turnToward = (a: number, b: number, max: number): number => {
  const d = angleDiff(a, b)
  return a + (d > max ? max : d < -max ? -max : d)
}

const approach = (v: number, target: number, rate: number, dt: number): number => {
  const step = rate * dt
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step)
}

const srgb = (v: number): number => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

const setTint = (c: Critter, hex: number, jitter: number): void => {
  const j = 1 + (rand(c) - 0.5) * jitter
  c.tr = srgb((hex >> 16) & 255) * j
  c.tg = srgb((hex >> 8) & 255) * j
  c.tb = srgb(hex & 255) * j
}

/** Sideways push (m) that bends an ant's path around a foot at (fx, fz). */
export const detourOffset = (qx: number, qz: number, nx: number, nz: number, fx: number, fz: number, radius: number): number => {
  const dx = qx - fx
  const dz = qz - fz
  const d2 = dx * dx + dz * dz
  if (d2 >= radius * radius) return 0
  const k = 1 - Math.sqrt(d2) / radius
  const push = radius * k * k * (3 - 2 * k)
  return dx * nx + dz * nz >= 0 ? push : -push
}

/**
 * Render-space coordinate of a logical one. Instances are written relative to
 * the floating origin (always a multiple of 1024 m near the player), so the
 * GPU only ever sees small, float32-exact numbers.
 */
export const renderCoord = (logical: number, origin: number): number => logical - origin

export const AVATAR_FOOT = 0.55
export const CAT_FOOT = 0.38

/** Mound profile shared with the nest geometry (dome of radius 0.5, height `h`). */
export const moundProfile = (r: number, radius: number, height: number): number => {
  if (r >= radius) return 0
  const t = 1 - (r / radius) * (r / radius)
  return height * Math.pow(t, 0.75)
}

/** Advances dwell timers; returns a kind that has just been met, or -1. */
export const updateSightings = (dwell: Float32Array, nearest: Float32Array, dt: number, alreadySeen: (kind: number) => boolean): number => {
  let fresh = -1
  for (let k = 0; k < dwell.length; k++) {
    if (nearest[k] <= SEEN_RADIUS) {
      dwell[k] += dt
      if (fresh < 0 && dwell[k] >= SEEN_DWELL && !alreadySeen(k)) fresh = k
    } else {
      dwell[k] = Math.max(0, dwell[k] - dt * 2)
    }
  }
  return fresh
}

const MAX_CANDIDATES = 256
const CACHE_SIZE = 1024
const COLONY_CACHE = 128

// --- simulation -------------------------------------------------------------

export class GroundLifeSim {
  readonly pools: Critter[][] = []
  readonly live = new Map<number, Critter>()
  readonly colonies: Colony[] = []
  readonly activity = new Float32Array(KIND_COUNT)
  readonly env: GroundEnv = makeEnv()
  readonly kindLive = new Int32Array(KIND_COUNT)
  time = 0
  /** debug/QA: everyone is out regardless of time, weather and habitat */
  forceActive = false
  showcase: { x: number; z: number; heading: number } | null = null
  capScale = 1
  private readonly ground: (x: number, z: number) => number
  private readonly trees: TreeFinder
  private readonly blocked: (x: number, z: number) => boolean
  private pinnedKey = -1_000_000
  private readonly avatar: Disturber = { x: 0, z: 0, speed: 0, active: false }
  private readonly cat: Disturber = { x: 0, z: 0, speed: 0, active: false }

  // candidate scratch (refresh only)
  private readonly candKey = new Int32Array(MAX_CANDIDATES)
  private readonly candKind = new Int8Array(MAX_CANDIDATES)
  private readonly candX = new Float64Array(MAX_CANDIDATES)
  private readonly candZ = new Float64Array(MAX_CANDIDATES)
  private readonly candD = new Float32Array(MAX_CANDIDATES)
  private readonly candOrder = new Int32Array(MAX_CANDIDATES)
  private readonly candSel = new Uint8Array(MAX_CANDIDATES)
  private readonly kindCount = new Int32Array(KIND_COUNT)
  // direct-mapped plan cache, keyed by exact cell coordinates
  private readonly cacheGx = new Int32Array(CACHE_SIZE)
  private readonly cacheGz = new Int32Array(CACHE_SIZE)
  private readonly cacheOk = new Uint8Array(CACHE_SIZE)
  private readonly cacheKind = new Int8Array(CACHE_SIZE * PLAN_SLOTS)
  private readonly cacheX = new Float64Array(CACHE_SIZE * PLAN_SLOTS)
  private readonly cacheZ = new Float64Array(CACHE_SIZE * PLAN_SLOTS)
  private readonly slotOut: SlotPlan = { kind: -1, x: 0, z: 0 }
  // colony plans
  private readonly colonyPlans: ColonyPlan[] = Array.from({ length: COLONY_CACHE }, makeColonyPlan)
  private readonly colonyGx = new Int32Array(COLONY_CACHE)
  private readonly colonyGz = new Int32Array(COLONY_CACHE)
  private readonly colonyCached = new Uint8Array(COLONY_CACHE)
  private readonly colonyCand: ColonyPlan[] = []
  private readonly colonyCandKey: number[] = []
  private readonly colonyCandD: number[] = []
  private readonly showcasePlans: ColonyPlan[] = [makeColonyPlan(), makeColonyPlan()]
  private readonly bez = new Float64Array(65 * 3)

  constructor(options: GroundSimOptions = {}) {
    this.ground = options.ground ?? groundHeightAt
    this.trees = options.trees ?? findTreeTrunk
    this.blocked = options.blocked ?? insideScatter
    for (let k = 0; k < KIND_COUNT; k++) {
      const pool: Critter[] = []
      for (let i = 0; i < KIND_CAP[k]; i++) pool.push(makeCritter(k))
      this.pools.push(pool)
    }
    for (let i = 0; i < COLONY_MAX; i++) this.colonies.push(makeColony())
  }

  // --- planning -------------------------------------------------------------

  /** Cached deterministic plan for one slot (writes into slotOut). */
  private plan(gx: number, gz: number, slot: number): SlotPlan {
    const i = hash32(Math.imul(gx, 73856093) ^ Math.imul(gz, 19349663)) & (CACHE_SIZE - 1)
    if (!this.cacheOk[i] || this.cacheGx[i] !== gx || this.cacheGz[i] !== gz) {
      for (let s = 0; s < PLAN_SLOTS; s++) {
        const p = planSlot(gx, gz, s, this.slotOut)
        this.cacheKind[i * PLAN_SLOTS + s] = p.kind
        this.cacheX[i * PLAN_SLOTS + s] = p.x
        this.cacheZ[i * PLAN_SLOTS + s] = p.z
      }
      this.cacheGx[i] = gx
      this.cacheGz[i] = gz
      this.cacheOk[i] = 1
    }
    const o = this.slotOut
    o.kind = this.cacheKind[i * PLAN_SLOTS + slot]
    o.x = this.cacheX[i * PLAN_SLOTS + slot]
    o.z = this.cacheZ[i * PLAN_SLOTS + slot]
    return o
  }

  /** Walker slot key: unique for every cell within ~114 km. */
  static slotKey(gx: number, gz: number, slot: number): number {
    return ((gx & 0x3fff) << 15) | ((gz & 0x3fff) << 1) | slot
  }

  /** Re-plan who lives near (px, pz). Call every ~0.5 s, not per frame. */
  refresh(px: number, pz: number): void {
    let n = 0
    if (this.showcase) {
      const { x, z, heading } = this.showcase
      for (let j = 0; j < 10; j++) {
        const angle = heading + (-1 + (2 * j) / 9) * 1.05
        const r = 1.45 + (j % 3) * 0.42
        this.candKey[n] = -(j + 1)
        this.candKind[n] = 2 + j
        this.candX[n] = x + Math.sin(angle) * r
        this.candZ[n] = z + Math.cos(angle) * r
        this.candD[n] = j
        n++
      }
    } else {
      const g0x = Math.floor((px - PLAN_RADIUS) / PLAN_CELL)
      const g1x = Math.floor((px + PLAN_RADIUS) / PLAN_CELL)
      const g0z = Math.floor((pz - PLAN_RADIUS) / PLAN_CELL)
      const g1z = Math.floor((pz + PLAN_RADIUS) / PLAN_CELL)
      for (let gz = g0z; gz <= g1z; gz++) {
        for (let gx = g0x; gx <= g1x; gx++) {
          for (let s = 0; s < PLAN_SLOTS; s++) {
            const p = this.plan(gx, gz, s)
            if (p.kind < 0) continue
            const d = Math.hypot(p.x - px, p.z - pz)
            if (d > PLAN_RADIUS || n >= MAX_CANDIDATES) continue
            this.candKey[n] = GroundLifeSim.slotKey(gx, gz, s)
            this.candKind[n] = p.kind
            this.candX[n] = p.x
            this.candZ[n] = p.z
            this.candD[n] = d
            n++
          }
        }
      }
    }
    // nearest first (insertion sort; n is a few hundred at most, twice a second)
    const order = this.candOrder
    for (let i = 0; i < n; i++) {
      const v = i
      let j = i - 1
      while (j >= 0 && this.candD[order[j]] > this.candD[v]) {
        order[j + 1] = order[j]
        j--
      }
      order[j + 1] = v
    }
    this.kindCount.fill(0)
    for (let i = 0; i < n; i++) {
      const c = order[i]
      const k = this.candKind[c]
      const cap = Math.max(1, Math.floor(KIND_CAP[k] * this.capScale))
      this.candSel[c] = this.kindCount[k] < cap ? 1 : 0
      if (this.candSel[c]) this.kindCount[k]++
    }
    // keep existing creatures that are still selected
    for (let k = 0; k < KIND_COUNT; k++) {
      const pool = this.pools[k]
      for (let i = 0; i < pool.length; i++) pool[i].keep = pool[i].pinned
    }
    for (let i = 0; i < n; i++) {
      if (!this.candSel[i]) continue
      const c = this.live.get(this.candKey[i])
      if (c && c.kind === this.candKind[i]) {
        c.keep = true
        this.candSel[i] = 2
      }
    }
    for (let k = 0; k < KIND_COUNT; k++) {
      const pool = this.pools[k]
      for (let i = 0; i < pool.length; i++) {
        const c = pool[i]
        if (c.live && !c.keep) this.release(c)
      }
    }
    for (let i = 0; i < n; i++) {
      if (this.candSel[i] !== 1) continue
      if (!this.showcase && this.blocked(this.candX[i], this.candZ[i])) continue
      const c = this.acquire(this.candKind[i])
      if (c) this.initCritter(c, this.candKey[i], this.candKind[i], this.candX[i], this.candZ[i])
    }
    this.refreshColonies(px, pz)
    this.kindLive.fill(0)
    for (let k = 0; k < KIND_COUNT; k++) for (const c of this.pools[k]) if (c.live) this.kindLive[k]++
  }

  private acquire(kind: number): Critter | null {
    const pool = this.pools[kind]
    for (let i = 0; i < pool.length; i++) if (!pool[i].live) return pool[i]
    return null
  }

  private release(c: Critter): void {
    if (this.live.get(c.key) === c) this.live.delete(c.key)
    c.live = false
    c.pinned = false
  }

  /** Deterministic initial state from the planned home position. */
  initCritter(c: Critter, key: number, kind: number, x: number, z: number): void {
    c.live = true
    c.keep = true
    c.key = key
    c.kind = kind
    c.rng = hash3(SEED, Math.floor(x * 64), Math.floor(z * 64)) || 1
    c.hx = c.x = x
    c.hz = c.z = z
    c.leash = LEASH[kind]
    c.heading = rand(c) * TAU
    c.burrowHeading = c.heading
    c.turn = 0
    c.speed = 0
    c.dash = 0
    c.pitch = 0
    c.roll = 0
    c.state = S.idle
    c.timer = rand(c) * 2
    c.timer2 = 0
    c.cooldown = 0
    c.u = rand(c)
    c.shell = rand(c)
    c.active = false
    c.hidden = false
    c.presence = 0
    c.size = 0.85 + rand(c) * 0.3
    c.phase = rand(c) * TAU
    c.curl = 0
    c.wing = 0
    c.extra = 0
    c.sing = 0
    c.lift = 0
    c.liftTarget = 0
    c.variant = 0
    c.gsx = Number.NaN
    c.gsz = Number.NaN
    c.dist = Infinity
    switch (kind) {
      case K.ladybird: setTint(c, rand(c) < 0.5 ? 0xc8231a : 0xd6361f, 0.12); break
      case K.groundBeetle: setTint(c, 0x141118, 0); break
      case K.stagBeetle: setTint(c, rand(c) < 0.5 ? 0x5e2a16 : 0x6e3519, 0.1); break
      case K.grasshopper: {
        const r = rand(c)
        setTint(c, r < 0.55 ? 0x6f8f3a : r < 0.8 ? 0x8d8c45 : 0x8a6a3e, 0.12)
        break
      }
      case K.fieldCricket: setTint(c, 0x1b1612, 0.1); break
      case K.harvestman: setTint(c, rand(c) < 0.5 ? 0x7a6650 : 0x8c7a60, 0.12); break
      case K.woodlouse: setTint(c, rand(c) < 0.75 ? 0x5a5e63 : 0x6a5f55, 0.14); break
      case K.millipede: setTint(c, 0x121014, 0); break
      case K.snail: {
        const r = rand(c)
        setTint(c, r < 0.4 ? 0xdcc45c : r < 0.7 ? 0xdba89a : 0x8e5d3c, 0.1)
        const b = rand(c)
        c.variant = b < 0.35 ? 0 : b < 0.6 ? 1 : 2
        break
      }
      case K.earthworm: setTint(c, 0xa86a64, 0.12); break
      default: setTint(c, 0x808080, 0)
    }
    if (kind === K.snail) c.size = 0.8 + rand(c) * 0.35
    this.live.set(key, c)
  }

  /** Test/debug: place a creature that refreshes never remove. */
  spawnAt(kind: number, x: number, z: number, heading?: number): Critter | null {
    const c = this.acquire(kind)
    if (!c) return null
    this.initCritter(c, this.pinnedKey--, kind, x, z)
    c.pinned = true
    if (heading !== undefined) c.heading = c.burrowHeading = heading
    return c
  }

  // --- colonies ---------------------------------------------------------------

  private colonyPlan(gx: number, gz: number): ColonyPlan {
    const i = hash32(Math.imul(gx, 83492791) ^ Math.imul(gz, 2654435761 | 0)) & (COLONY_CACHE - 1)
    const plan = this.colonyPlans[i]
    if (this.colonyCached[i] && this.colonyGx[i] === gx && this.colonyGz[i] === gz) return plan
    planColony(gx, gz, plan, this.trees)
    // a plan waiting on unbuilt chunks is retried on the next refresh
    this.colonyCached[i] = plan.pending ? 0 : 1
    this.colonyGx[i] = gx
    this.colonyGz[i] = gz
    return plan
  }

  private refreshColonies(px: number, pz: number): void {
    const cand = this.colonyCand
    const keys = this.colonyCandKey
    const dists = this.colonyCandD
    cand.length = 0
    keys.length = 0
    dists.length = 0
    if (this.showcase) {
      const { x, z, heading } = this.showcase
      const sx = Math.sin(heading)
      const sz = Math.cos(heading)
      const [garden, wood] = this.showcasePlans
      Object.assign(garden, { ok: true, pending: false, species: 0, size: 0.2, bend: 0.22, tree: false,
        nx: x + sz * 2.4 + sx * 0.6, nz: z - sx * 2.4 + sz * 0.6, fx: x - sz * 1.2 + sx * 3.4, fz: z + sx * 1.2 + sz * 3.4 })
      Object.assign(wood, { ok: true, pending: false, species: 1, size: 0.95, bend: -0.2, tree: false,
        nx: x - sz * 3.2 + sx * 4.2, nz: z + sx * 3.2 + sz * 4.2, fx: x + sz * 0.6 + sx * 6.8, fz: z - sx * 0.6 + sz * 6.8 })
      cand.push(garden, wood)
      keys.push(-11, -12)
      dists.push(0, 1)
    } else {
      const g0x = Math.floor((px - COLONY_RADIUS) / COLONY_CELL)
      const g1x = Math.floor((px + COLONY_RADIUS) / COLONY_CELL)
      const g0z = Math.floor((pz - COLONY_RADIUS) / COLONY_CELL)
      const g1z = Math.floor((pz + COLONY_RADIUS) / COLONY_CELL)
      for (let gz = g0z; gz <= g1z; gz++) {
        for (let gx = g0x; gx <= g1x; gx++) {
          const plan = this.colonyPlan(gx, gz)
          if (!plan.ok) continue
          const d = Math.hypot(plan.nx - px, plan.nz - pz)
          if (d > COLONY_RADIUS) continue
          // insert sorted by distance (arrays are reused; tiny n)
          let at = dists.length
          while (at > 0 && dists[at - 1] > d) at--
          cand.splice(at, 0, plan)
          keys.splice(at, 0, ((gx & 0x7fff) << 15) | (gz & 0x7fff))
          dists.splice(at, 0, d)
        }
      }
    }
    const count = Math.min(cand.length, COLONY_MAX)
    for (const col of this.colonies) col.keep = false
    for (let i = 0; i < count; i++) {
      for (const col of this.colonies) if (col.live && col.key === keys[i]) col.keep = true
    }
    for (const col of this.colonies) if (col.live && !col.keep) col.live = false
    for (let i = 0; i < count; i++) {
      let exists = false
      for (const col of this.colonies) if (col.live && col.key === keys[i]) exists = true
      if (exists) continue
      const free = this.colonies.find((c) => !c.live)
      if (!free) break
      if (!this.buildColony(free, keys[i], cand[i])) cand[i].ok = false
    }
  }

  /** Lay out the scent trail; false when it would cross water. */
  private buildColony(col: Colony, key: number, plan: ColonyPlan): boolean {
    const wood = plan.species === 1
    if (!this.showcase && this.blocked(plan.nx, plan.nz)) return false
    col.key = key
    col.species = plan.species
    col.nx = plan.nx
    col.nz = plan.nz
    col.ny = this.ground(plan.nx, plan.nz)
    col.size = plan.size
    col.moundH = wood ? plan.size * 0.42 : plan.size * 0.16
    col.tree = plan.tree
    col.trunkX = plan.trunkX
    col.trunkZ = plan.trunkZ
    col.trunkR = plan.trunkR
    const seed = hash3(SEED ^ 0x77, Math.floor(plan.nx * 16), Math.floor(plan.nz * 16))
    col.climb = plan.tree ? 1.1 + hash01(seed, 1, 2) * 0.9 : 0
    // trail: from the nest's edge (or its central hole) to the food
    let dx = plan.fx - plan.nx
    let dz = plan.fz - plan.nz
    const dl = Math.hypot(dx, dz) || 1
    dx /= dl
    dz /= dl
    const start = wood ? plan.size * 0.5 * 0.82 : 0
    const sx = plan.nx + dx * start
    const sz = plan.nz + dz * start
    const span = Math.hypot(plan.fx - sx, plan.fz - sz)
    const mx = (sx + plan.fx) / 2 + dz * plan.bend * span
    const mz = (sz + plan.fz) / 2 - dx * plan.bend * span
    const bez = this.bez
    let total = 0
    for (let i = 0; i <= 64; i++) {
      const t = i / 64
      const a = (1 - t) * (1 - t)
      const b = 2 * (1 - t) * t
      const c = t * t
      bez[i * 3] = a * sx + b * mx + c * plan.fx
      bez[i * 3 + 1] = a * sz + b * mz + c * plan.fz
      if (i > 0) total += Math.hypot(bez[i * 3] - bez[i * 3 - 3], bez[i * 3 + 1] - bez[i * 3 - 2])
      bez[i * 3 + 2] = total
    }
    col.groundLen = total
    col.step = total / TRAIL_N
    let seg = 1
    for (let i = 0; i <= TRAIL_N; i++) {
      const target = i * col.step
      while (seg < 64 && bez[seg * 3 + 2] < target) seg++
      const l0 = bez[seg * 3 - 1]
      const l1 = bez[seg * 3 + 2]
      const f = l1 > l0 ? Math.min(1, Math.max(0, (target - l0) / (l1 - l0))) : 0
      const x = bez[seg * 3 - 3] + (bez[seg * 3] - bez[seg * 3 - 3]) * f
      const z = bez[seg * 3 - 2] + (bez[seg * 3 + 1] - bez[seg * 3 - 2]) * f
      if (!this.showcase && !landingOk(x, z)) return false
      col.px[i] = x
      col.pz[i] = z
      const r = Math.hypot(x - col.nx, z - col.nz)
      col.py[i] = this.ground(x, z) + moundProfile(r, col.size * 0.5, col.moundH)
    }
    for (let i = 0; i <= TRAIL_N; i++) {
      const a = Math.max(0, i - 1)
      const b = Math.min(TRAIL_N, i + 1)
      let tx = col.px[b] - col.px[a]
      let tz = col.pz[b] - col.pz[a]
      const tl = Math.hypot(tx, tz) || 1
      tx /= tl
      tz /= tl
      col.qx[i] = tz
      col.qz[i] = -tx
    }
    col.length = col.groundLen + col.climb
    col.ants = wood ? ANTS_PER_COLONY : 20
    col.moundAnts = wood ? 6 : 3
    for (let i = 0; i < col.ants; i++) {
      col.antPhase[i] = hash01(seed, i, 3) * TAU
      col.antOmega[i] = TAU / (2.2 + hash01(seed, i, 4) * 3.2)
      col.antPause[i] = 0.55 + hash01(seed, i, 5) * 0.4
      col.antSpeed[i] = (wood ? 0.065 : 0.045) * (0.85 + hash01(seed, i, 6) * 0.3)
      col.antLane[i] = hash01(seed, i, 7) < 0.5 ? -1 : 1
      col.antCarry[i] = hash01(seed, i, 8) < (wood ? 0.45 : 0.55) ? 1 : 0
    }
    col.out = 0
    col.live = true
    col.keep = true
    return true
  }

  /**
   * Pose of ant `i` of a colony at `time`. Trail runners shuttle nest → food
   * → nest with time-warped pauses (s = v·(t − A·sin(ωt+φ)/ω) never runs
   * backwards but slows almost to a stop), keep to a lane, wiggle their
   * antennae while paused and bend their path around feet. A few ants potter
   * about on the nest itself.
   */
  evalAnt(col: Colony, i: number, time: number, out: AntPose): AntPose {
    const ph = col.antPhase[i]
    const om = col.antOmega[i]
    const A = col.antPause[i]
    const v = col.antSpeed[i]
    const cycles = (KIND_STRIDE[col.species] / KIND_SCALE[col.species]) * TAU
    out.carry = 0
    if (i < col.moundAnts) {
      const R = col.species === 1 ? col.size * 0.5 * 0.8 : 0.22
      const dir = i % 2 === 0 ? 1 : -1
      const ang = ph + dir * (time * 0.16 + 0.5 * Math.sin(time * 0.31 + ph))
      const rr = R * (0.3 + 0.6 * (0.5 + 0.5 * Math.sin(time * 0.21 + ph * 1.7)))
      out.x = col.nx + Math.cos(ang) * rr
      out.z = col.nz + Math.sin(ang) * rr
      out.y = col.ny + moundProfile(rr, col.size * 0.5, col.moundH)
      // tangent of the circular-ish wander
      out.heading = Math.atan2(-Math.sin(ang) * dir, Math.cos(ang) * dir)
      out.pitch = 0
      out.vis = col.out > 0.05 ? 1 : 0
      out.wiggle = 0.6
      out.gait = (time * v * cycles) % (TAU * 1000)
      return out
    }
    const L = col.length
    const warp = time - (A * Math.sin(om * time + ph)) / om
    let s = (warp * v + (ph / TAU) * 2 * L) % (2 * L)
    if (s < 0) s += 2 * L
    const outbound = s < L
    const d = outbound ? s : 2 * L - s
    const slow = (1 - A * Math.cos(om * time + ph)) / (1 + A)
    out.wiggle = 0.25 + 0.75 * (1 - slow)
    out.gait = (s * cycles) % (TAU * 1000)
    out.carry = !outbound && col.antCarry[i] ? 1 : 0
    out.vis = Math.min(1, d / 0.1)
    if (d > col.groundLen) {
      // climbing the trunk to the aphids, spread round its foot
      const h = d - col.groundLen
      const baseAng = Math.atan2(col.px[TRAIL_N] - col.trunkX, col.pz[TRAIL_N] - col.trunkZ) + col.antLane[i] * 0.22
      const r = col.trunkR + 0.012
      out.x = col.trunkX + Math.sin(baseAng) * r
      out.z = col.trunkZ + Math.cos(baseAng) * r
      out.y = col.py[TRAIL_N] + h
      // belly to the bark: nose up facing the trunk, nose down facing away
      out.heading = outbound ? baseAng + Math.PI : baseAng
      out.pitch = outbound ? -Math.PI / 2 : Math.PI / 2
      return out
    }
    this.trailPoint(col, i, d, outbound, time, out)
    const x0 = out.x
    const y0 = out.y
    const z0 = out.z
    // heading from a point slightly ahead, so detours and bends turn the body
    this.trailPoint(col, i, Math.min(col.groundLen, Math.max(0, d + (outbound ? 0.035 : -0.035))), outbound, time, out)
    const hx = out.x - x0
    const hz = out.z - z0
    out.heading = Math.abs(hx) + Math.abs(hz) > 1e-6 ? Math.atan2(hx, hz) : 0
    out.x = x0
    out.y = y0
    out.z = z0
    out.pitch = 0
    return out
  }

  /** Position at trail distance d with lane, wander and foot detours (writes x, y, z). */
  private trailPoint(col: Colony, i: number, d: number, outbound: boolean, time: number, out: AntPose): void {
    const f = Math.min(TRAIL_N - 1e-6, Math.max(0, d / col.step))
    const k = Math.floor(f)
    const t = f - k
    const qx = col.px[k] + (col.px[k + 1] - col.px[k]) * t
    const qz = col.pz[k] + (col.pz[k + 1] - col.pz[k]) * t
    const nx = col.qx[k] + (col.qx[k + 1] - col.qx[k]) * t
    const nz = col.qz[k] + (col.qz[k + 1] - col.qz[k]) * t
    let off = (outbound ? 1 : -1) * col.antLane[i] * 0.011 + 0.009 * Math.sin(time * 1.1 + col.antPhase[i] * 3 + d * 9)
    if (this.avatar.active) off += detourOffset(qx, qz, nx, nz, this.avatar.x, this.avatar.z, AVATAR_FOOT)
    if (this.cat.active) off += detourOffset(qx, qz, nx, nz, this.cat.x, this.cat.z, CAT_FOOT)
    out.x = qx + nx * off
    out.z = qz + nz * off
    out.y = col.py[k] + (col.py[k + 1] - col.py[k]) * t
  }

  // --- per-frame step -------------------------------------------------------

  step(dt: number, time: number, avatar: Disturber, cat: Disturber): void {
    this.time = time
    this.avatar.x = avatar.x
    this.avatar.z = avatar.z
    this.avatar.speed = avatar.speed
    this.avatar.active = avatar.active
    this.cat.x = cat.x
    this.cat.z = cat.z
    this.cat.speed = cat.speed
    this.cat.active = cat.active
    if (this.forceActive) this.activity.fill(1)
    else allActivity(this.env, this.activity)
    for (let k = 0; k < KIND_COUNT; k++) {
      const pool = this.pools[k]
      for (let i = 0; i < pool.length; i++) if (pool[i].live) this.stepCritter(pool[i], dt)
    }
    for (let i = 0; i < this.colonies.length; i++) {
      const col = this.colonies[i]
      if (!col.live) continue
      col.out = approach(col.out, this.activity[col.species], 0.25, dt)
    }
  }

  private stepCritter(c: Critter, dt: number): void {
    const k = c.kind
    c.active = c.u < this.activity[k]
    const av = this.avatar
    c.dist = av.active ? Math.hypot(av.x - c.x, av.z - c.z) : Infinity
    // A walking avatar alarms at the full radius; a still one only up close.
    const R = KIND_ALERT[k]
    let threatened = false
    let tx = 0
    let tz = 0
    if (av.active && c.dist < R && (av.speed > 0.35 || c.dist < R * 0.55)) {
      threatened = true
      tx = av.x
      tz = av.z
    } else if (this.cat.active) {
      const dc = Math.hypot(this.cat.x - c.x, this.cat.z - c.z)
      if (dc < R * 0.8 && (this.cat.speed > 0.5 || dc < R * 0.4)) {
        threatened = true
        tx = this.cat.x
        tz = this.cat.z
      }
    }
    c.timer -= dt
    c.timer2 -= dt
    c.cooldown -= dt
    switch (k) {
      case K.ladybird: this.ladybird(c, dt, threatened, tx, tz); break
      case K.groundBeetle: this.groundBeetle(c, dt, threatened, tx, tz); break
      case K.stagBeetle: this.stagBeetle(c, dt, threatened); break
      case K.grasshopper: this.grasshopper(c, dt, threatened, tx, tz); break
      case K.fieldCricket: this.cricket(c, dt, threatened); break
      case K.harvestman: this.harvestman(c, dt, threatened, tx, tz); break
      case K.woodlouse:
      case K.millipede: this.roller(c, dt, threatened); break
      case K.snail: this.snail(c, dt, threatened); break
      case K.earthworm: this.worm(c, dt, threatened); break
    }
    // presence: fade in when out, fade away when sheltering
    let target = c.active && !c.hidden ? 1 : 0
    if (k === K.snail && !c.active && c.shell < 0.45) target = 1
    c.presence = approach(c.presence, target, c.hidden ? 3 : 0.8, dt)
    // ground follow (resampled only after moving a few centimetres)
    if (!(Math.abs(c.x - c.gsx) < 0.04 && Math.abs(c.z - c.gsz) < 0.04)) {
      const gy = this.ground(c.x, c.z)
      if (gy < WATER_LEVEL + 0.04 && c.lift <= 0.001 && c.state !== S.hop && c.state !== S.fly && !Number.isNaN(c.gsx)) {
        // never walk into water: step back and turn round
        c.x = c.gsx
        c.z = c.gsz
        c.heading += Math.PI
      } else {
        c.gy = gy
        c.gsx = c.x
        c.gsz = c.z
      }
    }
    c.y = c.gy + c.lift
  }

  // --- movement helpers -------------------------------------------------------

  private advance(c: Critter, speed: number, dt: number): void {
    c.speed = speed
    c.x += Math.sin(c.heading) * speed * dt
    c.z += Math.cos(c.heading) * speed * dt
    c.phase = (c.phase + ((speed * dt * KIND_STRIDE[c.kind]) / (KIND_SCALE[c.kind] * c.size)) * TAU) % (TAU * 1000)
  }

  private wander(c: Critter, speed: number, jitter: number, dt: number): void {
    c.turn += (rand(c) - 0.5) * jitter * dt * 8
    c.turn *= Math.exp(-dt * 2)
    const dx = c.hx - c.x
    const dz = c.hz - c.z
    if (dx * dx + dz * dz > c.leash * c.leash) c.heading = turnToward(c.heading, Math.atan2(dx, dz), dt * 1.6)
    c.heading += c.turn * dt
    this.advance(c, speed, dt)
  }

  private awayFrom(c: Critter, tx: number, tz: number, spread: number): number {
    return Math.atan2(c.x - tx, c.z - tz) + (rand(c) - 0.5) * spread
  }

  private startArc(c: Critter, heading: number, dist: number, duration: number, height: number, landLift: number): void {
    let bx = c.x + Math.sin(heading) * dist
    let bz = c.z + Math.cos(heading) * dist
    // stay near home and on dry land: try the mirrored direction toward home
    const far = Math.hypot(bx - c.hx, bz - c.hz) > c.leash * 2.2
    if (far || !landingOk(bx, bz)) {
      const back = Math.atan2(c.hx - c.x, c.hz - c.z) + (rand(c) - 0.5) * 0.8
      bx = c.x + Math.sin(back) * dist * 0.7
      bz = c.z + Math.cos(back) * dist * 0.7
      if (!landingOk(bx, bz)) {
        bx = c.x
        bz = c.z
      }
    }
    c.ax = c.x
    c.az = c.z
    c.ay = c.lift
    c.bx = bx
    c.bz = bz
    c.arcT = 0
    c.arcDur = duration
    c.arcH = height
    c.arcLiftB = landLift
    if (Math.abs(bx - c.x) + Math.abs(bz - c.z) > 1e-4) c.heading = Math.atan2(bx - c.x, bz - c.z)
  }

  /** Advance a hop/flight arc; true once landed. */
  private stepArc(c: Critter, dt: number): boolean {
    c.arcT = Math.min(1, c.arcT + dt / c.arcDur)
    const t = c.arcT
    const px = c.x
    const pz = c.z
    c.x = c.ax + (c.bx - c.ax) * t
    c.z = c.az + (c.bz - c.az) * t
    c.lift = c.ay + (c.arcLiftB - c.ay) * t + c.arcH * 4 * t * (1 - t)
    const moved = Math.hypot(c.x - px, c.z - pz)
    c.speed = dt > 0 ? moved / dt : 0
    c.phase = (c.phase + dt * 20) % (TAU * 1000)
    return t >= 1
  }

  // --- kinds --------------------------------------------------------------------

  /** Slow wander, climbs to a grass tip to perch, and flies off when disturbed. */
  private ladybird(c: Critter, dt: number, threatened: boolean, tx: number, tz: number): void {
    c.wing = approach(c.wing, c.state === S.fly ? 1 : 0, 5, dt)
    if (c.state === S.fly) {
      c.pitch = approach(c.pitch, -0.25, 3, dt)
      c.roll = Math.sin(this.time * 9 + c.phase) * 0.12
      if (this.stepArc(c, dt)) {
        c.roll = 0
        c.lift = c.arcLiftB
        c.state = c.lift > 0.02 ? S.perch : S.idle
        c.timer = 2 + rand(c) * 4
        c.cooldown = 1.2
      }
      return
    }
    if (!c.active) {
      c.speed = 0
      return
    }
    if (threatened && c.cooldown <= 0) {
      const dist = 1.4 + rand(c) * 1.6
      this.startArc(c, this.awayFrom(c, tx, tz, 1.2), dist, dist / 0.9 + 0.3, 0.35 + rand(c) * 0.35, rand(c) < 0.5 ? 0.06 + rand(c) * 0.14 : 0)
      c.state = S.fly
      return
    }
    switch (c.state) {
      case S.idle:
        c.speed = 0
        c.pitch = approach(c.pitch, 0, 3, dt)
        if (c.timer < 0) {
          const r = rand(c)
          if (r < 0.45) {
            c.state = S.walk
            c.timer = 2.5 + rand(c) * 4
          } else if (r < 0.8) {
            c.state = S.climb
            c.liftTarget = 0.06 + rand(c) * 0.2
          } else c.timer = 1 + rand(c) * 2
        }
        break
      case S.walk:
        c.pitch = approach(c.pitch, 0, 3, dt)
        this.wander(c, 0.03, 1.2, dt)
        if (c.timer < 0) {
          c.state = S.idle
          c.timer = 1 + rand(c) * 3
        }
        break
      case S.climb:
        c.speed = 0.025
        c.pitch = approach(c.pitch, -1.35, 4, dt)
        c.lift += 0.025 * dt
        c.phase = (c.phase + dt * 9) % (TAU * 1000)
        if (c.lift >= c.liftTarget) {
          c.state = S.perch
          c.timer = 3 + rand(c) * 6
        }
        break
      case S.perch:
        c.speed = 0
        c.pitch = approach(c.pitch, 0, 3, dt)
        c.heading += Math.sin(this.time * 0.7 + c.phase) * 0.3 * dt
        if (c.timer < 0) {
          if (rand(c) < 0.55) c.state = S.descend
          else {
            const dist = 1 + rand(c) * 1.8
            this.startArc(c, rand(c) * TAU, dist, dist / 0.9 + 0.3, 0.3 + rand(c) * 0.3, rand(c) < 0.5 ? 0.06 + rand(c) * 0.12 : 0)
            c.state = S.fly
          }
        }
        break
      case S.descend:
        c.speed = 0.025
        c.pitch = approach(c.pitch, 1.35, 4, dt)
        c.lift -= 0.025 * dt
        c.phase = (c.phase + dt * 9) % (TAU * 1000)
        if (c.lift <= 0) {
          c.lift = 0
          c.state = S.idle
          c.timer = 0.5 + rand(c) * 2
        }
        break
      default:
        c.state = S.idle
    }
  }

  /** Dash-and-stop hunter; bolts away from feet, then freezes. */
  private groundBeetle(c: Critter, dt: number, threatened: boolean, tx: number, tz: number): void {
    if (!c.active) {
      c.speed = 0
      c.state = S.idle
      return
    }
    if (threatened && c.state !== S.flee && c.cooldown <= 0) {
      c.state = S.flee
      c.timer = 0.9 + rand(c) * 0.7
      c.heading = this.awayFrom(c, tx, tz, 0.7)
    }
    switch (c.state) {
      case S.flee:
        this.advance(c, 0.34, dt)
        if (c.timer < 0) {
          c.state = S.idle
          c.timer = 2 + rand(c) * 2
          c.cooldown = 1.2
        }
        break
      case S.walk:
        this.wander(c, c.dash, 0.6, dt)
        if (c.timer < 0) {
          c.state = S.idle
          c.timer = 0.6 + rand(c) * 2
        }
        break
      default:
        c.speed = 0
        if (c.timer < 0) {
          c.state = S.walk
          c.timer = 0.4 + rand(c) * 1
          c.dash = 0.16 + rand(c) * 0.08
        }
    }
  }

  /** Lumbers about; rears up gently when approached; flies clumsily at dusk. */
  private stagBeetle(c: Critter, dt: number, threatened: boolean): void {
    c.wing = approach(c.wing, c.state === S.fly ? 1 : 0, 3, dt)
    if (c.state === S.fly) {
      c.pitch = approach(c.pitch, -0.75, 2, dt)
      if (this.stepArc(c, dt)) {
        c.lift = 0
        c.state = S.idle
        c.timer = 3 + rand(c) * 4
        c.cooldown = 2
      }
      return
    }
    if (!c.active) {
      c.speed = 0
      c.extra = approach(c.extra, 0, 1, dt)
      c.pitch = approach(c.pitch, 0, 1, dt)
      return
    }
    if (threatened && c.state !== S.rear && c.cooldown <= 0) {
      c.state = S.rear
      c.timer = 2 + rand(c)
    }
    switch (c.state) {
      case S.rear:
        c.speed = 0
        c.extra = approach(c.extra, 1, 2.5, dt)
        c.pitch = approach(c.pitch, -0.22, 1.5, dt)
        if (c.timer < 0) {
          c.state = S.idle
          c.timer = 1 + rand(c) * 2
          c.cooldown = 2.5
        }
        break
      case S.walk:
        c.extra = approach(c.extra, 0, 1.5, dt)
        c.pitch = approach(c.pitch, 0, 1.5, dt)
        this.wander(c, 0.035, 0.5, dt)
        if (c.timer < 0) {
          c.state = S.idle
          c.timer = 1.5 + rand(c) * 3
        }
        break
      default:
        c.speed = 0
        c.extra = approach(c.extra, 0, 1.5, dt)
        c.pitch = approach(c.pitch, 0, 1.5, dt)
        if (c.timer < 0) {
          const r = rand(c)
          if (r < 0.75) {
            c.state = S.walk
            c.timer = 3 + rand(c) * 5
          } else if (r < 0.87 && this.activity[K.stagBeetle] > 0.6) {
            const dist = 3 + rand(c) * 3
            this.startArc(c, rand(c) * TAU, dist, dist / 0.7, 0.9 + rand(c) * 0.6, 0)
            c.state = S.fly
          } else c.timer = 2 + rand(c) * 3
        }
    }
  }

  /** Sits on the grass, sings, and leaps in arcs — further when startled. */
  private grasshopper(c: Critter, dt: number, threatened: boolean, tx: number, tz: number): void {
    if (c.state === S.hop) {
      c.extra = c.arcT < 0.2 ? 1 : Math.max(0, 1 - (c.arcT - 0.2) * 2.5)
      c.pitch = -0.45 * (1 - c.arcT * 2) * (c.arcT < 0.5 ? 1 : 0.4)
      if (this.stepArc(c, dt)) {
        c.lift = c.arcLiftB
        c.pitch = 0
        c.state = S.idle
        c.timer = 2 + rand(c) * 6
        c.cooldown = 0.15
      }
      return
    }
    c.extra = approach(c.extra, 0, 3, dt)
    c.speed = 0
    if (!c.active) {
      c.sing = approach(c.sing, 0, 2, dt)
      return
    }
    if (threatened && c.cooldown <= 0) {
      const dist = 0.7 + rand(c) * 0.6
      this.startArc(c, this.awayFrom(c, tx, tz, 1), dist, 0.34 + dist * 0.16, 0.22 + rand(c) * 0.16, rand(c) < 0.6 ? rand(c) * 0.09 : 0)
      c.state = S.hop
      c.sing = 0
      return
    }
    c.sing = approach(c.sing, c.timer2 > 0 ? 1 : 0, 3, dt)
    if (c.timer < 0) {
      if (rand(c) < 0.3) {
        c.timer2 = 1.5 + rand(c) * 2.5
        c.timer = c.timer2 + 0.5
      } else {
        const dist = 0.3 + rand(c) * 0.4
        this.startArc(c, c.heading + (rand(c) - 0.5) * 2.4, dist, 0.32 + dist * 0.18, 0.12 + rand(c) * 0.1, rand(c) < 0.6 ? rand(c) * 0.09 : 0)
        c.state = S.hop
      }
    }
  }

  /** Sings at its burrow door and scurries inside when feet come near. */
  private cricket(c: Critter, dt: number, threatened: boolean): void {
    const dHome = Math.hypot(c.hx - c.x, c.hz - c.z)
    if (c.state === S.hide) {
      c.speed = 0
      c.sing = 0
      c.lift = approach(c.lift, -0.03, 0.2, dt)
      const clear = c.dist > 2.8
      if (c.timer < 0 && c.active && clear) {
        c.hidden = false
        c.lift = 0
        c.state = S.idle
        c.heading = c.burrowHeading
        c.timer = 2 + rand(c) * 4
      } else if (!clear) c.timer = Math.max(c.timer, 1.5)
      return
    }
    if (!c.active || threatened) {
      if (dHome < 0.03) {
        c.state = S.hide
        c.hidden = true
        c.timer = 4 + rand(c) * 4
        return
      }
      const toHome = Math.atan2(c.hx - c.x, c.hz - c.z)
      c.heading = dHome < 0.15 ? toHome : turnToward(c.heading, toHome, dt * 12)
      this.advance(c, Math.min(0.3, dHome / Math.max(dt, 1e-3)), dt)
      c.sing = 0
      return
    }
    switch (c.state) {
      case S.walk:
        this.wander(c, 0.05, 1, dt)
        if (c.timer < 0) c.state = S.home
        break
      case S.home: {
        const toHome = Math.atan2(c.hx - c.x, c.hz - c.z)
        c.heading = dHome < 0.1 ? toHome : turnToward(c.heading, toHome, dt * 6)
        this.advance(c, Math.min(0.05, dHome / Math.max(dt, 1e-3)), dt)
        if (dHome < 0.02) {
          c.state = S.idle
          c.timer = 2 + rand(c) * 4
        }
        break
      }
      default: {
        c.speed = 0
        c.heading = turnToward(c.heading, c.burrowHeading, dt * 2)
        // males call through warm afternoons and into the night
        const singing = this.env.tod > 0.4 || rand(c) < 0.002
        c.sing = approach(c.sing, singing && c.timer2 < 0 ? 1 : 0, 3, dt)
        if (c.timer < 0) {
          if (rand(c) < 0.3) {
            c.state = S.walk
            c.timer = 1.5 + rand(c) * 2
            c.heading = c.burrowHeading + (rand(c) - 0.5) * 2
          } else {
            c.timer = 2 + rand(c) * 4
            c.timer2 = rand(c) < 0.25 ? 1 + rand(c) * 2 : -1
          }
        }
      }
    }
  }

  /** Stilt-walks slowly; bobs its body when alarmed, then strides away. */
  private harvestman(c: Critter, dt: number, threatened: boolean, tx: number, tz: number): void {
    if (!c.active) {
      c.speed = 0
      c.extra = approach(c.extra, 0, 2, dt)
      return
    }
    if (threatened && c.state !== S.bob && c.state !== S.flee && c.cooldown <= 0) {
      c.state = S.bob
      c.timer = 1.2
    }
    switch (c.state) {
      case S.bob:
        c.speed = 0
        c.extra = approach(c.extra, 1, 4, dt)
        if (c.timer < 0) {
          c.state = S.flee
          c.timer = 2.2
          c.heading = this.awayFrom(c, tx, tz, 0.6)
        }
        break
      case S.flee:
        c.extra = approach(c.extra, 0, 3, dt)
        this.advance(c, 0.16, dt)
        if (c.timer < 0) {
          c.state = S.idle
          c.timer = 1 + rand(c) * 2
          c.cooldown = 2
        }
        break
      case S.walk:
        c.extra = approach(c.extra, 0, 3, dt)
        this.wander(c, 0.05, 0.8, dt)
        if (c.timer < 0) {
          c.state = S.idle
          c.timer = 1 + rand(c) * 3
        }
        break
      default:
        c.speed = 0
        c.extra = approach(c.extra, 0, 3, dt)
        if (c.timer < 0) {
          c.state = S.walk
          c.timer = 2 + rand(c) * 4
        }
    }
  }

  /** Woodlice roll into a ball, millipedes coil into a spiral. */
  private roller(c: Critter, dt: number, threatened: boolean): void {
    const pill = c.kind === K.woodlouse
    if (!c.active) {
      c.speed = 0
      c.curl = approach(c.curl, 0, 0.8, dt)
      if (c.state !== S.curl) c.state = S.idle
      return
    }
    if (threatened && c.state !== S.curl && c.cooldown <= 0) {
      c.state = S.curl
      c.timer = 3 + rand(c) * 2
    }
    switch (c.state) {
      case S.curl:
        c.speed = 0
        c.curl = approach(c.curl, 1, pill ? 3 : 2, dt)
        if (threatened) c.timer = Math.max(c.timer, 1)
        if (c.timer < 0 && c.dist > KIND_ALERT[c.kind] * 1.5) {
          c.state = S.idle
          c.timer = 1 + rand(c) * 2
          c.cooldown = 1
        }
        break
      case S.walk:
        this.wander(c, pill ? 0.03 : 0.022, pill ? 1.5 : 0.4, dt)
        if (c.timer < 0) {
          c.state = S.idle
          c.timer = 0.5 + rand(c) * 2
        }
        break
      default:
        c.speed = 0
        c.curl = approach(c.curl, 0, 0.8, dt)
        if (c.timer < 0 && c.curl < 0.05) {
          c.state = S.walk
          c.timer = 2 + rand(c) * 4
        }
    }
  }

  /** Glides with a stretching foot; withdraws into its shell when disturbed or dry. */
  private snail(c: Critter, dt: number, threatened: boolean): void {
    if (!c.active) {
      c.state = S.dormant
      c.speed = 0
      // found already sealed in (not seen retracting) when it first appears
      c.curl = c.presence < 0.05 ? 1 : approach(c.curl, 1, 0.5, dt)
      c.extra = approach(c.extra, 0, 0.5, dt)
      return
    }
    if (threatened && c.state !== S.curl && c.cooldown <= 0) {
      c.state = S.curl
      c.timer = 3 + rand(c) * 3
    }
    switch (c.state) {
      case S.curl:
        c.speed = 0
        c.curl = approach(c.curl, 1, 2.5, dt)
        if (threatened) c.timer = Math.max(c.timer, 1)
        if (c.timer < 0 && c.dist > 1.4) {
          c.state = S.idle
          c.timer = 2 + rand(c) * 2
          c.cooldown = 1.5
        }
        break
      case S.walk: {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 0.9 + c.hx * 7)
        c.extra = approach(c.extra, pulse, 1, dt)
        this.wander(c, 0.006 * (0.6 + 0.4 * pulse), 0.25, dt)
        if (c.timer < 0) {
          c.state = S.idle
          c.timer = 3 + rand(c) * 6
        }
        break
      }
      default:
        c.speed = 0
        c.curl = approach(c.curl, 0, 0.35, dt)
        c.extra = approach(c.extra, 0.3, 0.5, dt)
        if (c.timer < 0 && c.curl < 0.05) {
          c.state = S.walk
          c.timer = 6 + rand(c) * 10
        }
    }
  }

  /** Crawls on wet ground; slides back down its burrow at footsteps or as it dries. */
  private worm(c: Critter, dt: number, threatened: boolean): void {
    if (c.state === S.hide) {
      c.speed = 0
      c.curl = approach(c.curl, 1, 2.2, dt)
      if (c.curl > 0.97) c.hidden = true
      if (c.timer < 0 && c.active && c.dist > 2) {
        c.state = S.idle
        c.hidden = false
        c.timer = 2 + rand(c) * 3
      }
      return
    }
    if (!c.active || (threatened && c.cooldown <= 0)) {
      c.state = S.hide
      c.timer = 5 + rand(c) * 5
      c.cooldown = 3
      if (c.presence < 0.05) {
        // never seen: simply still underground
        c.curl = 1
        c.hidden = true
      }
      return
    }
    switch (c.state) {
      case S.walk:
        c.curl = approach(c.curl, 0, 0.5, dt)
        this.wander(c, 0.012, 0.5, dt)
        c.phase = (c.phase + dt * 3) % (TAU * 1000)
        if (c.timer < 0) {
          c.state = S.idle
          c.timer = 2 + rand(c) * 4
        }
        break
      default:
        c.speed = 0
        c.curl = approach(c.curl, 0, 0.5, dt)
        c.phase = (c.phase + dt * 0.6) % (TAU * 1000)
        if (c.timer < 0 && c.curl < 0.05) {
          c.state = S.walk
          c.timer = 4 + rand(c) * 8
        }
    }
  }

  // --- inspection -----------------------------------------------------------

  stats(): { walkers: number; colonies: number; ants: number; perKind: number[]; active: number[] } {
    const perKind: number[] = []
    const active: number[] = []
    let walkers = 0
    for (let k = 0; k < KIND_COUNT; k++) {
      let n = 0
      let a = 0
      for (const c of this.pools[k]) {
        if (!c.live) continue
        n++
        if (c.active && !c.hidden) a++
      }
      perKind.push(n)
      active.push(a)
      walkers += n
    }
    let colonies = 0
    let ants = 0
    for (const col of this.colonies) {
      if (!col.live) continue
      colonies++
      ants += col.ants
      perKind[col.species] += col.ants
      active[col.species] += Math.round(col.out * col.ants)
    }
    return { walkers, colonies, ants, perKind, active }
  }
}
