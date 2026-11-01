import { clamp } from "../../../utils/math"
import { GROUND_BOUNDS, groundHash, sampleGround, type GroundSurface } from "./groundSurface"

export const TRACK_CAPACITY = 4096
export const WEAR_RESOLUTION = 512
export type TrackShape = "shoe" | "paw" | "hoof" | "cloven" | "bird" | "rabbit" | "hand" | "webbed"
export const TRACK_SHAPES: TrackShape[] = ["shoe", "paw", "hoof", "cloven", "bird", "rabbit", "hand", "webbed"]
export type TrackProfile = { shape: TrackShape; width: number; length: number; mass: number; stride: number; gauge: number; quadruped: boolean }
export const TRACK_PROFILES: Record<string, TrackProfile> = {
  explorer: { shape: "shoe", width: 0.174, length: 0.226, mass: 52, stride: 0.5, gauge: 0.204, quadruped: false },
  "companion-cat": { shape: "paw", width: 0.085, length: 0.10, mass: 4, stride: 0.28, gauge: 0.16, quadruped: true },
  "garden-cat": { shape: "paw", width: 0.09, length: 0.105, mass: 4.5, stride: 0.29, gauge: 0.17, quadruped: true },
  horse: { shape: "hoof", width: 0.16, length: 0.19, mass: 420, stride: 0.65, gauge: 0.40, quadruped: true },
  deer: { shape: "cloven", width: 0.10, length: 0.15, mass: 70, stride: 0.45, gauge: 0.25, quadruped: true },
  rabbit: { shape: "rabbit", width: 0.065, length: 0.12, mass: 1.8, stride: 0.33, gauge: 0.14, quadruped: true },
  "ground-bird": { shape: "bird", width: 0.075, length: 0.09, mass: 0.3, stride: 0.17, gauge: 0.10, quadruped: false },
  duck: { shape: "webbed", width: 0.10, length: 0.10, mass: 1.2, stride: 0.20, gauge: 0.17, quadruped: false },
  monkey: { shape: "hand", width: 0.085, length: 0.13, mass: 6, stride: 0.3, gauge: 0.19, quadruped: true },
  fox: { shape: "paw", width: 0.065, length: 0.09, mass: 6, stride: 0.38, gauge: 0.16, quadruped: true },
  tiger: { shape: "paw", width: 0.18, length: 0.22, mass: 170, stride: 0.7, gauge: 0.4, quadruped: true },
  cheetah: { shape: "paw", width: 0.12, length: 0.16, mass: 50, stride: 0.65, gauge: 0.3, quadruped: true },
  gorilla: { shape: "hand", width: 0.19, length: 0.25, mass: 150, stride: 0.55, gauge: 0.52, quadruped: true },
}

export type GroundTrack = {
  active: boolean; serial: number; maker: string; x: number; z: number; angle: number; side: number
  width: number; length: number; shape: TrackShape; pressure: number; depth: number
  age: number; lifetime: number; integrity: number; surface: GroundSurface; cell: string
}
type Walker = { x: number; z: number; angle: number; distance: number; step: number; speed: number; airborne: boolean }
export type GroundContact = { maker: string; profile: TrackProfile; x: number; z: number; angle: number; side?: number; speed?: number; impact?: number; age?: number; wetness?: number; size?: number; height?: number }

/** Bounded individual impressions plus a slower, spatially aggregated traffic field.
 * No footprint is a React object. Reusing a slot also removes its spatial index. */
export class GroundHistory {
  readonly tracks: Array<GroundTrack | undefined> = new Array(TRACK_CAPACITY)
  readonly field = new Uint8Array(WEAR_RESOLUTION ** 2 * 4)
  readonly bend = new Float32Array(WEAR_RESOLUTION ** 2)
  readonly wear = new Float32Array(WEAR_RESOLUTION ** 2)
  readonly activeCells = new Set<number>()
  readonly walkers = new Map<string, Walker>()
  readonly spatial = new Map<string, Set<number>>()
  next = 0
  serial = 0
  version = 0
  fieldVersion = 0
  emitted = 0
  updateMs = 0

  constructor() {
    for (let i = 0; i < this.field.length; i += 4) { this.field[i + 2] = 128; this.field[i + 3] = 128 }
  }

  stamp(contact: GroundContact): GroundTrack | undefined {
    const { x, z, profile } = contact
    const surface = sampleGround(x, z, contact.wetness ?? 0)
    if (contact.height !== undefined && contact.height - surface.height > 0.16) {
      surface.height = contact.height; surface.kind = "rock"; surface.softness = 0.03; surface.slope = 0
    }
    if (surface.softness === 0 || surface.slope > 0.65) return
    const size = contact.size ?? 1
    const width = profile.width * size, length = profile.length * size
    // Pressure is a restrained mass / contact-area estimate, with a shallow
    // compressible layer. Artistic body mass values are category approximations.
    const stress = profile.mass / (width * length * (profile.quadruped ? 2.8 : 1.2))
    const pressure = clamp(Math.sqrt(stress / 1400) * (0.65 + (contact.speed ?? 1) * 0.12 + (contact.impact ?? 0) * 0.55), 0.15, 2.2)
    const angle = contact.angle + (groundHash(this.serial, 7) - 0.5) * 0.06
    const cellX = Math.floor(x / 0.5), cellZ = Math.floor(z / 0.5)
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const slots = this.spatial.get(`${cellX + dx}:${cellZ + dz}`)
      if (!slots) continue
      for (const index of slots) {
        const old = this.tracks[index]!
        const distance = Math.hypot(old.x - x, old.z - z)
        const overlap = 1 - distance / Math.max(width, length, old.length)
        if (overlap > 0) old.integrity *= Math.max(0.1, 1 - overlap * 0.83)
      }
    }
    const old = this.tracks[this.next]
    if (old) {
      const slots = this.spatial.get(old.cell)
      slots?.delete(this.next)
      if (slots?.size === 0) this.spatial.delete(old.cell)
    }
    const age = contact.age ?? 0
    const hard = surface.kind === "rock" || surface.kind === "built"
    const lifetime = hard ? 18 : surface.kind === "mud" ? 1400 : surface.kind === "sand" ? 900 : surface.kind === "grass" ? 90 : 380
    const track: GroundTrack = {
      active: true, serial: this.serial++, maker: contact.maker, x, z, angle, side: contact.side ?? 1,
      width, length, shape: profile.shape, pressure,
      depth: surface.kind === "grass" || hard ? 0 : Math.min(0.035, 0.018 * pressure * surface.softness),
      age, lifetime, integrity: 1, surface, cell: `${cellX}:${cellZ}`,
    }
    this.tracks[this.next] = track
    let slots = this.spatial.get(track.cell)
    if (!slots) { slots = new Set(); this.spatial.set(track.cell, slots) }
    slots.add(this.next)
    this.next = (this.next + 1) % TRACK_CAPACITY
    this.emitted++
    this.version++
    this.disturb(track)
    return track
  }

  private disturb(track: GroundTrack): void {
    const { x, z, angle, pressure } = track
    if (x < GROUND_BOUNDS.x || x >= GROUND_BOUNDS.x + GROUND_BOUNDS.width || z < GROUND_BOUNDS.z || z >= GROUND_BOUNDS.z + GROUND_BOUNDS.depth) return
    const cellW = GROUND_BOUNDS.width / WEAR_RESOLUTION, cellD = GROUND_BOUNDS.depth / WEAR_RESOLUTION
    const cx = (x - GROUND_BOUNDS.x) / cellW, cz = (z - GROUND_BOUNDS.z) / cellD
    const w = Math.max(track.width * 0.8, 0.16), l = Math.max(track.length * 0.85, 0.24)
    const radius = Math.ceil(Math.max(w, l) / Math.min(cellW, cellD)) + 1
    const sin = Math.sin(angle), cos = Math.cos(angle)
    for (let iz = Math.max(0, Math.floor(cz) - radius); iz <= Math.min(WEAR_RESOLUTION - 1, Math.ceil(cz) + radius); iz++) {
      for (let ix = Math.max(0, Math.floor(cx) - radius); ix <= Math.min(WEAR_RESOLUTION - 1, Math.ceil(cx) + radius); ix++) {
        const dx = (ix + 0.5 - cx) * cellW, dz = (iz + 0.5 - cz) * cellD
        const lateral = (dx * cos - dz * sin) / w, forward = (dx * sin + dz * cos) / l
        const influence = Math.max(0, 1 - lateral * lateral - forward * forward)
        if (influence <= 0) continue
        const i = iz * WEAR_RESOLUTION + ix
        this.bend[i] = Math.max(this.bend[i], influence * Math.min(1, pressure) * Math.exp(-track.age / 18))
        this.wear[i] = Math.min(1, this.wear[i] + influence * pressure * 0.028)
        this.field[i * 4 + 2] = (sin * 0.5 + 0.5) * 255
        this.field[i * 4 + 3] = (cos * 0.5 + 0.5) * 255
        this.activeCells.add(i)
        this.pack(i)
      }
    }
    this.fieldVersion++
  }

  private pack(i: number): void {
    this.field[i * 4] = this.bend[i] * 255
    this.field[i * 4 + 1] = this.wear[i] * 255
  }

  advance(dt: number, rain: number, wind: number): void {
    for (const track of this.tracks) {
      if (!track?.active) continue
      const erosion = track.surface.kind === "sand" ? 1 + rain * 5 + wind * (1 - track.surface.moisture) * 1.8 : track.surface.kind === "mud" ? 1 + rain * 1.8 : 1 + rain * 7
      track.age += dt * erosion
      if (track.age >= track.lifetime || track.integrity < 0.07) track.active = false
    }
    for (const i of this.activeCells) {
      this.bend[i] *= Math.exp(-dt / (12 + this.wear[i] * 80))
      // Established routes survive for the session. A single light contact does not.
      if (this.wear[i] < 0.72) this.wear[i] *= Math.exp(-dt / 1400)
      this.pack(i)
      if (this.bend[i] < 0.001 && this.wear[i] < 0.001) { this.activeCells.delete(i); this.bend[i] = 0; this.wear[i] = 0; this.pack(i) }
    }
    this.version++
    if (this.activeCells.size) this.fieldVersion++
  }

  observe(maker: string, profile: TrackProfile, x: number, z: number, speed: number, airborne: boolean, wetness: number, dt: number, size = 1, height?: number): void {
    let walker = this.walkers.get(maker)
    if (!walker) { walker = { x, z, angle: 0, distance: 0, step: 0, speed, airborne }; this.walkers.set(maker, walker); return }
    const dx = x - walker.x, dz = z - walker.z, distance = Math.hypot(dx, dz)
    const angle = distance > 0.001 ? Math.atan2(dx, dz) : walker.angle
    // Teleports and airborne trajectories never draw a line of phantom contacts.
    if (distance > Math.max(1.5, speed * dt * 2.5) || airborne) { walker.x = x; walker.z = z; walker.distance = 0; walker.airborne = airborne; return }
    if (walker.airborne && !airborne) {
      for (const side of [-1, 1]) this.stamp({ maker, profile, x: x + Math.cos(angle) * profile.gauge * side / 2, z: z - Math.sin(angle) * profile.gauge * side / 2, angle, side, speed, wetness, impact: 1, size, height })
    }
    const stride = maker === "explorer" ? 0.50 + 0.12 * Math.min(1, speed / 5.2) : profile.stride * size * (1 + Math.min(speed, 6) * 0.10)
    let remaining = stride - walker.distance
    while (distance >= remaining && distance > 0.001) {
      const t = remaining / distance
      const side = walker.step % 2 ? 1 : -1
      const irregular = (groundHash(walker.step, profile.mass) - 0.5) * profile.width * 0.10
      const offset = side * profile.gauge * size / 2 + irregular
      const px = walker.x + dx * t + Math.cos(angle) * offset, pz = walker.z + dz * t - Math.sin(angle) * offset
      const turn = Math.abs(Math.atan2(Math.sin(angle - walker.angle), Math.cos(angle - walker.angle)))
      this.stamp({ maker, profile, x: px, z: pz, angle, side, speed, wetness, impact: Math.min(0.3, turn * 0.3 + Math.max(0, speed - walker.speed) * 0.07), size, height })
      if (profile.quadruped) this.stamp({ maker, profile, x: px - Math.sin(angle) * profile.length * 1.2, z: pz - Math.cos(angle) * profile.length * 1.2, angle, side: -side, speed, wetness, size: size * (profile.shape === "rabbit" ? 0.63 : 0.87), height })
      walker.step++
      remaining += stride * (0.97 + groundHash(walker.step, 83) * 0.06)
    }
    walker.distance = Math.max(0, stride - (remaining - distance))
    walker.x = x; walker.z = z; walker.angle = angle; walker.speed = speed; walker.airborne = airborne
  }

  /** Streamed wildlife IDs come and go. Forget their stride accumulators along
   * with their agents so exploration never retains every visited animal. */
  retainWalkers(alive: ReadonlySet<string>): void {
    for (const id of this.walkers.keys()) if (!alive.has(id)) this.walkers.delete(id)
  }

  summary(): { active: number; capacity: number; emitted: number; cells: number; shapes: Record<string, number>; updateMs: number } {
    const shapes: Record<string, number> = {}
    let active = 0
    for (const t of this.tracks) if (t?.active) { active++; shapes[t.shape] = (shapes[t.shape] ?? 0) + 1 }
    return { active, capacity: TRACK_CAPACITY, emitted: this.emitted, cells: this.activeCells.size, shapes, updateMs: this.updateMs }
  }
}

export const groundHistory = new GroundHistory()
