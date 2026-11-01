import { WATER_LEVEL } from "../climate"
import { hash3, rng } from "../noise"
import { worldHeight } from "../terrain"
import { WORLD_SEED } from "../worldConfig"
import { aquaticEvents } from "./events"
import { BED_MARGIN, SURFACE_MARGIN, areaAt, fitsWater, footprintBed, riverFlow, type WaterArea, type WaterHabitat } from "./habitat"

export const FISH_TYPES = ["minnow", "carp", "trout", "river"] as const
export type FishType = (typeof FISH_TYPES)[number]
export const FISH_LIMITS = [12, 2, 2, 4] as const
export const FULL_RANGE = 40
export const ACTIVE_RANGE = 90
export const fishTier = (distance: number): "full" | "reduced" | "off" => distance < FULL_RANGE ? "full" : distance < ACTIVE_RANGE ? "reduced" : "off"
export const populationFactor = (particles: number, animals: number): number => Math.min(1, particles * animals / 28)
export const fishBudget = (particles: number, animals: number): number => Math.max(6, Math.round(16 * populationFactor(particles, animals)))

const LENGTH = [0.24, 0.57, 0.64, 0.36]
const CRUISE = [0.26, 0.16, 0.32, 0.16]
const DEPTH = [0.19, 0.24, 0.58, 0.23]
/**
 * How each species swims. Small fish (minnows, the creek fish) swim
 * kick-and-glide: a few strong tail beats, then a coast with the body held
 * straight while drag bleeds the speed away. Carp and trout beat more
 * steadily and glide less. `band` is how far below/above the wanted speed a
 * fish lets itself fall/rise before kicking/coasting.
 */
const BAND = [0.34, 0.2, 0.13, 0.3]
/** tail-tip amplitude while beating, as a fraction of body length (~0.1 L in real fish) */
const BEAT_AMP = [0.095, 0.075, 0.08, 0.09]
/** Quadratic drag: deceleration k v^2 with k ~ 1.3 / L (drag ~ L^2, mass ~ L^3). */
export const fishDrag = (size: number): number => 1.3 / Math.max(0.05, size)
/**
 * Tail-beat frequency (Hz) for a swimming speed, from Bainbridge (1958):
 * U = L (3f - 4) / 4, i.e. f = (4U/L + 4) / 3. A 24 cm minnow at 0.26 m/s
 * beats near 2.8 Hz; a darting one twice that.
 */
export const beatFrequency = (speed: number, size: number): number => Math.min(14, Math.max(1.6, (4 * speed / Math.max(0.05, size) + 4) / 3))
export type FishSpawn = {
  id: string; habitat: WaterHabitat; area: number; species: number; school: number; seed: number
  x: number; y: number; z: number; homeX: number; homeZ: number; size: number
}
export type FishAgent = FishSpawn & {
  active: boolean; heading: number; speed: number; phase: number; waveRate: number; waveAmp: number
  elapsed: number; age: number; swimPhase: number; burst: number; burstTimer: number; surfaceTimer: number; rise: number
  schoolTimer: number; schoolFX: number; schoolFZ: number; directionX: number; directionZ: number; simBucket: number
  jumping: number; jumpDuration: number; scatter: number; randomState: number
  /** 0..1 tail-beat envelope: 1 beating, 0 coasting straight */
  beat: number; kicking: boolean; turnRate: number
}
export type AquaticContext = { px: number; pz: number; rain: number; timeOfDay: number; time: number }
export type RippleSink = (x: number, z: number, strength: number, splash: boolean) => void

export const makePopulation = (h: WaterHabitat, focus?: { x: number; z: number }): FishSpawn[] => {
  const out: FishSpawn[] = []
  const r = rng(hash3(WORLD_SEED ^ 0xa91c, h.payload.cx, h.payload.cz))
  for (const a of h.areas) {
    if (!a.cells.length) continue
    // A few schools per large chunk, rather than a uniform aquarium carpet.
    const schools = Math.min(2, Math.max(1, Math.ceil(a.area / 1800)))
    const add = (species: number, count: number, school: number): void => {
      const size = LENGTH[species] * (0.84 + r() * 0.28), radius = size * 0.72, half = size * 0.25
      let anchor = a.cells[Math.floor(r() * a.cells.length)]
      if (focus) anchor = a.cells.reduce((best, c) => (c.x - focus.x) ** 2 + (c.z - focus.z) ** 2 < (best.x - focus.x) ** 2 + (best.z - focus.z) ** 2 ? c : best, anchor)
      else if (species === 0 && a.plants.length) {
        const plant = a.plants[Math.floor(r() * a.plants.length)]
        anchor = a.cells.reduce((best, c) => (c.x - plant.x) ** 2 + (c.z - plant.z) ** 2 < (best.x - plant.x) ** 2 + (best.z - plant.z) ** 2 ? c : best, anchor)
      }
      let found = false
      for (let attempt = 0; attempt < 45; attempt++) {
        if (attempt > 0) anchor = a.cells[Math.floor(r() * a.cells.length)]
        const bed = Math.max(footprintBed(h, anchor.x, anchor.z, radius), worldHeight(anchor.x, anchor.z))
        if (WATER_LEVEL - bed < half * 2 + BED_MARGIN + SURFACE_MARGIN + 0.04 || (species === 2 && anchor.depth < 1.15)) continue
        found = true; break
      }
      if (!found) return
      for (let i = 0; i < count; i++) {
        const individualSize = size * (0.88 + r() * 0.24), rad = individualSize * 0.72, hh = individualSize * 0.25
        for (let attempt = 0; attempt < 24; attempt++) {
          const spread = a.kind === "pond" ? 1.2 : species === 0 ? 2.6 : 3.4
          const x = anchor.x + (r() - 0.5) * spread, z = anchor.z + (r() - 0.5) * spread
          const bed = footprintBed(h, x, z, rad)
          const y = Math.max(bed + hh + BED_MARGIN + 0.015, WATER_LEVEL - hh - SURFACE_MARGIN - DEPTH[species] * (0.45 + r() * 0.65))
          if (!fitsWater(h, a.id, x, y, z, rad, hh)) continue
          const seed = hash3(WORLD_SEED ^ 0xf15a, h.payload.cx * 997 + out.length, h.payload.cz * 131 + a.id * 17)
          out.push({ id: `${h.key}:${a.id}:${species}:${school}:${i}`, habitat: h, area: a.id, species, school, seed,
            x, y, z, homeX: anchor.x, homeZ: anchor.z, size: individualSize })
          break
        }
      }
    }
    for (let s = 0; s < schools; s++) add(0, Math.min(focus ? 12 : 10, Math.max(5, Math.floor(a.area / 7))), a.id * 10 + s)
    if (a.kind === "river") add(3, 4 + Math.floor(r() * 3), a.id * 10 + 4)
    else {
      add(1, focus ? 3 : a.kind === "pond" ? 2 : 1 + Math.floor(r() * 2), a.id * 10 + 3)
      if (a.kind === "lake" && a.maxDepth > 1.35) add(2, focus ? 3 : 2, a.id * 10 + 4)
    }
  }
  return out
}

export const createFish = (s: FishSpawn): FishAgent => {
  const heading = s.species === 3 ? upstream(s.x) : (s.seed % 6283) * 0.001
  return { ...s, active: true, heading,
    speed: CRUISE[s.species] * 0.7, phase: (s.seed % 997) * 0.017, waveRate: 5 + (s.seed % 31) * 0.09, waveAmp: 0.055,
    elapsed: 0, age: 0, swimPhase: (s.seed % 997) * 0.017, burst: 0, burstTimer: 2 + (s.seed % 41) * 0.13, surfaceTimer: 12 + (s.seed % 97) * 0.31,
    schoolTimer: (s.seed % 13) * 0.01, schoolFX: 0, schoolFZ: 0, directionX: Math.sin(heading), directionZ: Math.cos(heading), simBucket: -1,
    rise: 0, jumping: 0, jumpDuration: 0.8, scatter: 0, randomState: s.seed, beat: 1, kicking: true, turnRate: 0 }
}

const flow = { x: 0, z: 0 }
const upstream = (x: number): number => { riverFlow(x, flow); return Math.atan2(-flow.x, -flow.z) }
const random = (a: FishAgent): number => { a.randomState = hash3(a.randomState, 7, 19); return a.randomState / 4294967296 }
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
const areaFor = (a: FishAgent): WaterArea => a.habitat.areas[a.area - 1]

export const resetFish = (a: FishAgent, s: FishSpawn): void => {
  Object.assign(a, s)
  a.active = true; a.heading = s.species === 3 ? upstream(s.x) : (s.seed % 6283) * 0.001
  a.speed = CRUISE[s.species] * 0.7; a.phase = (s.seed % 997) * 0.017; a.swimPhase = a.phase
  a.waveRate = 5 + (s.seed % 31) * 0.09; a.waveAmp = 0.055; a.elapsed = 0; a.age = 0
  a.schoolTimer = (s.seed % 13) * 0.01; a.schoolFX = 0; a.schoolFZ = 0; a.directionX = Math.sin(a.heading); a.directionZ = Math.cos(a.heading)
  a.simBucket = -1
  a.burst = 0; a.burstTimer = 2 + (s.seed % 41) * 0.13; a.surfaceTimer = 12 + (s.seed % 97) * 0.31
  a.rise = 0; a.jumping = 0; a.jumpDuration = 0.8; a.scatter = 0; a.randomState = s.seed
  a.beat = 1; a.kicking = true; a.turnRate = 0
}

/** Mutates one pooled fish. Neighbours are bounded by the global population;
 * separate schools never align, and every proposed step must fit its water. */
export const stepFish = (a: FishAgent, neighbours: readonly FishAgent[], c: AquaticContext, dt: number, ripple: RippleSink, advancePhase = true): void => {
  a.age += dt
  a.burstTimer -= dt; a.surfaceTimer -= dt; a.burst = Math.max(0, a.burst - dt); a.rise = Math.max(0, a.rise - dt)
  if (a.burstTimer <= 0) { a.burst = 0.3 + random(a) * 0.35; a.burstTimer = 3 + random(a) * 6 }
  const area = areaFor(a), radius = a.size * 0.72, half = a.size * 0.25
  const leash = area.kind === "pond" ? 0.8 : 2.8
  const drift = a.school * 0.91 + c.time * 0.095
  const tx = a.homeX + Math.sin(drift) * leash, tz = a.homeZ + Math.cos(drift * 0.83) * leash
  let fx = (tx - a.x) * 0.24, fz = (tz - a.z) * 0.24
  if (a.species === 0) {
    a.schoolTimer -= dt
    if (a.schoolTimer <= 0) {
      // Per-fish staggered sensing at 8 Hz; steering, swimming and disturbance
      // still run every near frame. Cached headings avoid trig in neighbours.
      a.schoolTimer = 0.12; a.schoolFX = 0; a.schoolFZ = 0
      let nx = 0, nz = 0, vx = 0, vz = 0, count = 0
      for (const b of neighbours) {
        if (!b.active || b === a || b.species !== 0 || b.school !== a.school || b.habitat !== a.habitat) continue
        const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz
        if (d2 > 5 || d2 < 1e-7) continue
        if (d2 < 0.18) { a.schoolFX -= dx * 0.11 / d2; a.schoolFZ -= dz * 0.11 / d2 }
        nx += b.x; nz += b.z; vx += b.directionX; vz += b.directionZ; count++
      }
      if (count) { a.schoolFX += (nx / count - a.x) * 0.22 + vx / count * 0.32; a.schoolFZ += (nz / count - a.z) * 0.22 + vz / count * 0.32 }
    }
    fx += a.schoolFX; fz += a.schoolFZ
  } else if (a.species === 3) {
    riverFlow(a.x, flow)
    fx = -flow.x * 1.5 + (a.homeX - a.x) * 0.32; fz = -flow.z * 1.5 + (a.homeZ - a.z) * 0.32
  }
  fx += Math.sin(a.age * 0.73 + a.phase) * 0.09; fz += Math.cos(a.age * 0.67 + a.phase * 1.3) * 0.09
  const dx = a.x - c.px, dz = a.z - c.pz, d2 = dx * dx + dz * dz
  a.scatter = d2 < 6.25 ? 1 : Math.max(0, a.scatter - dt * 0.65)
  if (d2 < 6.25) { const inverse = 3 / Math.max(0.2, Math.sqrt(d2)); fx += dx * inverse; fz += dz * inverse }
  const aheadX = a.x + a.directionX * 0.7, aheadZ = a.z + a.directionZ * 0.7
  if (areaAt(a.habitat, aheadX, aheadZ) !== a.area || footprintBed(a.habitat, aheadX, aheadZ, radius) > WATER_LEVEL - half * 2 - BED_MARGIN - SURFACE_MARGIN) {
    fx += (a.homeX - a.x) * 2; fz += (a.homeZ - a.z) * 2
  }
  const targetHeading = Math.atan2(fx, fz)
  const turn = Math.atan2(Math.sin(targetHeading - a.heading), Math.cos(targetHeading - a.heading))
  // a fish turns by beating, not while coasting straight: a glide turns slowly
  const turnLimit = (a.scatter > 0 ? 5 : 1.8) * (0.45 + 0.55 * a.beat)
  const turned = clamp(turn, -dt * turnLimit, dt * turnLimit)
  a.heading += turned
  a.turnRate += (turned / Math.max(dt, 1e-4) - a.turnRate) * (1 - Math.exp(-dt * 6))
  a.directionX = Math.sin(a.heading); a.directionZ = Math.cos(a.heading)
  const glide = 0.64 + 0.22 * Math.sin(a.age * 1.4 + a.phase)
  const targetSpeed = CRUISE[a.species] * (a.burst > 0 ? 2.4 : glide) + a.scatter * 0.85
  // Thrust and drag. Each tail stroke (two per beat cycle) pushes as a pulse,
  // so speed surges with the strokes; between bouts the fish coasts and
  // quadratic drag, raised by turning, slows it. A startled or darting fish
  // beats without pause.
  const k = fishDrag(a.size) * (1 + 1.5 * Math.min(1, Math.abs(a.turnRate) * 0.5))
  const band = a.burst > 0 || a.scatter > 0.2 ? 0 : BAND[a.species]
  if (a.kicking && a.speed > targetSpeed * (1 + band)) a.kicking = band === 0
  else if (!a.kicking && a.speed < targetSpeed * (1 - band)) a.kicking = true
  if (band === 0) a.kicking = true
  a.beat += ((a.kicking ? 1 : 0) - a.beat) * (1 - Math.exp(-dt * (a.kicking ? 9 : 5)))
  // a beat sized to carry the fish a little past the speed it wants
  const drive = targetSpeed * (1 + band * 1.6 + 0.08)
  const frequency = beatFrequency(a.kicking ? drive : a.speed * 0.4, a.size)
  // the pulse shape needs the real stroke phase; coarse distant steps use its mean
  const pulse = dt < 0.05 ? Math.abs(Math.sin(a.swimPhase)) / 0.637 : 1
  const thrust = k * drive * drive * a.beat * pulse
  a.speed = Math.max(0.01, a.speed + (thrust - k * a.speed * a.speed) * dt)
  // coasting, the tail trails nearly straight with only a passive flutter
  a.waveRate = Math.PI * 2 * frequency * (0.35 + 0.65 * a.beat)
  a.waveAmp = BEAT_AMP[a.species] * (0.14 + 0.86 * a.beat) * (0.75 + 0.25 * Math.min(1.6, a.speed / CRUISE[a.species]))
  if (advancePhase) a.swimPhase = (a.swimPhase + dt * a.waveRate) % (Math.PI * 2)
  const currentBed = footprintBed(a.habitat, a.x, a.z, radius)
  const low = currentBed + half + BED_MARGIN
  const high = WATER_LEVEL - half - SURFACE_MARGIN
  let targetY = high - DEPTH[a.species] * (0.65 + 0.18 * Math.sin(a.age * 0.37 + a.phase)) - c.rain * 0.19
  if (a.rise > 0) targetY = high - 0.008
  const ny = clamp(a.y + (clamp(targetY, low, high) - a.y) * (1 - Math.exp(-dt * 2.4)), low, high)
  // River fish cancel the current between darts: station-holding and always
  // facing upstream, rather than steadily swimming out of the creek.
  const holding = a.species === 3 && a.burst === 0 && a.scatter === 0
  const movement = holding ? 0.02 : a.speed
  const nx = a.x + a.directionX * movement * dt, nz = a.z + a.directionZ * movement * dt
  if (a.jumping <= 0 && fitsWater(a.habitat, a.area, nx, ny, nz, radius, half)) { a.x = nx; a.z = nz; a.y = ny }
  else if (a.jumping <= 0) {
    a.y = clamp(a.y, low, high); a.speed *= 0.75
    a.heading += clamp(Math.atan2(Math.sin(Math.atan2(a.homeX - a.x, a.homeZ - a.z) - a.heading), Math.cos(Math.atan2(a.homeX - a.x, a.homeZ - a.z) - a.heading)), -dt * 4, dt * 4)
    a.directionX = Math.sin(a.heading); a.directionZ = Math.cos(a.heading)
  }
  if (a.surfaceTimer <= 0 && a.jumping <= 0) {
    a.surfaceTimer = 20 + random(a) * 42
    if (c.rain < 0.3 && a.scatter < 0.1) {
      const twilight = c.timeOfDay >= 0.6 && c.timeOfDay <= 0.85
      const dawn = c.timeOfDay >= 0.08 && c.timeOfDay <= 0.2
      if (a.species !== 0 && (twilight || dawn) && random(a) < 0.12 && WATER_LEVEL - currentBed > 0.55) {
        a.jumping = dt; a.jumpDuration = 0.85 + random(a) * 0.18
        aquaticEvents.emit("jump", a.x, WATER_LEVEL, a.z, a.size)
        ripple(a.x, a.z, 0.35, false)
      } else { a.rise = 2; ripple(a.x, a.z, 0.26, false); aquaticEvents.emit("rise", a.x, WATER_LEVEL, a.z, 0.26) }
    }
  }
  if (a.jumping > 0) {
    a.jumping += dt
    if (a.jumping >= a.jumpDuration) {
      a.jumping = 0; a.y = clamp(WATER_LEVEL - half - 0.12, low, high)
      ripple(a.x, a.z, 0.65, true); aquaticEvents.emit("splash", a.x, WATER_LEVEL, a.z, 0.65)
    }
  }
}

/** Jump is an explicit surface exception; the submerged simulation position
 * remains valid and horizontal movement pauses until its splash/landing. */
export const fishVisualY = (a: FishAgent): number => {
  if (a.jumping <= 0) return a.y
  const t = a.jumping / a.jumpDuration, rise = Math.min(1, t * 4), ease = rise * rise * (3 - 2 * rise)
  return a.y + (WATER_LEVEL - a.size * 0.25 - SURFACE_MARGIN - a.y) * ease + Math.sin(t * Math.PI) * 0.36
}
