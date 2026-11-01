import { WATER_LEVEL } from "../climate"
import { hash3, rng } from "../noise"
import { WORLD_SEED } from "../worldConfig"
import { aquaticEvents } from "./events"
import { areaAt, footprintBed, type WaterHabitat } from "./habitat"
import type { AquaticContext, RippleSink } from "./simulation"

export const SURFACE_LIMIT = 8
export const RIPPLE_LIMIT = 6
export type SurfaceSpawn = {
  id: string; habitat: WaterHabitat; area: number; kind: number; x: number; y: number; z: number
  homeX: number; homeY: number; homeZ: number; waterX: number; waterZ: number; phase: number
}
export type SurfaceAgent = SurfaceSpawn & {
  active: boolean; heading: number; timer: number; croak: number; hop: number; submerged: number; returning: boolean; elapsed: number
}
export const surfaceVisible = (a: SurfaceAgent, c: AquaticContext, wind: number): boolean => {
  if (a.kind === 0) return a.submerged <= 0
  if (a.kind === 1) return c.rain < 0.18 && wind < 0.55
  return c.rain <= 0.3 && c.timeOfDay < 0.9 && (c.timeOfDay < 0.78 || a.phase % 3 < 1)
}

export const makeSurfacePopulation = (h: WaterHabitat): SurfaceSpawn[] => {
  const out: SurfaceSpawn[] = [], r = rng(hash3(WORLD_SEED ^ 0x5fa1, h.payload.cx, h.payload.cz))
  for (const a of h.areas) {
    if (a.kind === "river") continue
    // Prefer cover already supplied by the scatter system.
    const shores = [...a.shores].sort((s, t) => {
      const distance = (x: number, z: number): number => a.plants.reduce((best, p) => Math.min(best, (p.x - x) ** 2 + (p.z - z) ** 2), 10000)
      return distance(s.x, s.z) - distance(t.x, t.z)
    })
    for (let i = 0; i < Math.min(2, shores.length); i++) {
      const s = shores[i]
      out.push({ id: `${h.key}:frog:${a.id}:${i}`, habitat: h, area: a.id, kind: 0, x: s.x, y: s.y, z: s.z,
        homeX: s.x, homeY: s.y, homeZ: s.z, waterX: s.waterX, waterZ: s.waterZ, phase: r() * 100 })
    }
    const wet = a.cells.filter(c => footprintBed(h, c.x, c.z, 0.2) < WATER_LEVEL - 0.09)
    const shallow = wet.filter(c => c.depth < 1.1 && c.depth > 0.25)
    const cells = shallow.length ? shallow : wet
    for (let kind = 1; kind <= 2; kind++) {
      if (kind === 1 && a.kind !== "pond") continue
      for (let i = 0; i < (kind === 1 ? 3 : 2); i++) {
        const c = cells[Math.floor(r() * cells.length)]
        if (!c) continue
        const y = WATER_LEVEL + (kind === 1 ? 0.008 : 0.95)
        out.push({ id: `${h.key}:${kind}:${a.id}:${i}`, habitat: h, area: a.id, kind, x: c.x, y, z: c.z,
          homeX: c.x, homeY: y, homeZ: c.z, waterX: c.x, waterZ: c.z, phase: r() * 100 })
      }
    }
  }
  return out
}

export const createSurfaceAgent = (s: SurfaceSpawn): SurfaceAgent => ({ ...s, active: true, heading: Math.atan2(s.waterX - s.x, s.waterZ - s.z),
  timer: 8 + s.phase * 0.2, croak: 0, hop: 0, submerged: 0, returning: false, elapsed: 0 })

export const stepSurface = (a: SurfaceAgent, c: AquaticContext, dt: number, ripple: RippleSink): void => {
  if (a.kind !== 0) {
    if (a.kind === 2 && c.rain > 0.3) return
    const t = c.time, dart = a.kind === 2 ? 1.35 + Math.sin(t * 0.27 + a.phase) * 0.65 : 0.44
    const tx = a.homeX + Math.sin(t * (a.kind === 2 ? 0.65 : 0.21) + a.phase) * dart
    const tz = a.homeZ + Math.cos(t * (a.kind === 2 ? 0.79 : 0.17) + a.phase) * dart
    const k = 1 - Math.exp(-dt * (a.kind === 2 ? 3 : 1))
    const nx = a.x + (tx - a.x) * k, nz = a.z + (tz - a.z) * k
    if (areaAt(a.habitat, nx, nz) === a.area && footprintBed(a.habitat, nx, nz, 0.18) < WATER_LEVEL - 0.06) {
      if ((nx - a.x) ** 2 + (nz - a.z) ** 2 > 1e-7) a.heading = Math.atan2(nx - a.x, nz - a.z)
      a.x = nx; a.z = nz
    }
    a.y = a.homeY + (a.kind === 2 ? Math.sin(t * 1.7 + a.phase) * 0.14 : 0)
    return
  }
  a.croak = Math.max(0, a.croak - dt)
  const near = (a.homeX - c.px) ** 2 + (a.homeZ - c.pz) ** 2 < 4
  if (a.submerged > 0) {
    a.submerged = Math.max(0, a.submerged - dt)
    if (a.submerged <= 0 && near) a.submerged = 3
    else if (a.submerged <= 0) { a.returning = true; a.hop = dt; ripple(a.waterX, a.waterZ, 0.28, false) }
    return
  }
  if (a.hop > 0) {
    a.hop += dt
    const t = Math.min(1, a.hop / 0.65), f = a.returning ? 1 - t : t
    a.x = a.homeX + (a.waterX - a.homeX) * f; a.z = a.homeZ + (a.waterZ - a.homeZ) * f
    a.y = a.homeY + (WATER_LEVEL - 0.045 - a.homeY) * f + Math.sin(t * Math.PI) * 0.32
    a.heading = Math.atan2(a.waterX - a.homeX, a.waterZ - a.homeZ) + (a.returning ? Math.PI : 0)
    if (t >= 1) {
      a.hop = 0
      if (!a.returning) { a.submerged = 9 + a.phase * 0.13; ripple(a.waterX, a.waterZ, 0.45, true); aquaticEvents.emit("splash", a.waterX, WATER_LEVEL, a.waterZ, 0.35) }
      a.returning = false; a.timer = 12 + a.phase * 0.15
    }
    return
  }
  a.timer -= dt * (c.timeOfDay > 0.85 ? 1.8 : 0.65)
  if (near || (a.timer <= 0 && Math.sin(a.phase + c.time * 0.1) > 0.86)) {
    a.hop = dt; aquaticEvents.emit("frog-hop", a.x, a.y, a.z, 0.4)
  } else if (a.timer <= 0) {
    a.croak = 0.8; a.timer = 17 + a.phase * 0.17
    aquaticEvents.emit("croak", a.x, a.y, a.z, c.timeOfDay > 0.85 ? 0.8 : 0.45)
  }
}
