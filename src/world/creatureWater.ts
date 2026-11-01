import { POND, RIVER_MAX_X, RIVER_MIN_X, WATER_Y, riverCenterZ, riverHalfWidthAt } from "./hubLayout"
import { riverFlow } from "./aquatic/habitat"
import { riverFall } from "./highvale/highvaleRiver"
import { highvaleWeight } from "./highvale/highvaleLayout"
import { RIVER_N0, riverE, toLocal, toWorld } from "./highvale/highvaleLayout"
import { worldHeight } from "./terrain"
import { waterSurfaceAt } from "./waterSurface"
import { weatherRT } from "../game/weather/weatherState"
import { emitCreatureSplash, emitDrips, emitRipple, setCreatureSplashSurface } from "./render/waterFx"

/**
 * Water as the animals know it.
 *
 * `waterSurfaceAt` is the swimming contract for the players (wild lakes and
 * The river). Animals also know the home pond and creek, which are fenced for
 * The explorer's feet but are exactly where a garden's animals go to drink and
 * paddle. Everything here is cheap and pure: brains ask it while choosing a
 * spot or stepping a body, never for animals nobody is near.
 *
 * Each species keeps the way its body actually meets water (see
 * WATER_WAYS): a horse swims with only its head and a ridge of back above
 * the surface, nostrils high; a deer is buoyant (hollow winter hair) and
 * swims fast with the neck stretched forward; a dog-paddling fox or cat
 * keeps its chin up and strokes quickly; a rabbit paddles in short bursts
 * close to the bank; tigers lie in water to cool and swim strongly;
 * macaques sit in the shallows; gorillas wade upright-ish and sit to feed.
 * Nothing here is afraid of water.
 */

export type WaterWay = {
  /** 0..1 how much it enjoys water: how often a drink turns into a bathe or a swim */
  love: number
  /** swims when out of its depth (otherwise it keeps to wading depth) */
  swims: boolean
  /** shoulder height (m at scale 1): sets wading depth and how low it floats */
  shoulder: number
  /** deepest water stood in, as a fraction of the shoulder height */
  wade: number
  /** fraction of the shoulder height under water while swimming */
  draft: number
  /** swimming speed, m/s */
  swimSpeed: number
  /** strokes per second (a small paddler strokes fast, a horse slowly) */
  stroke: number
  /** 0..1 body mass for the size of splashes and wakes */
  mass: number
  /** seconds for its coat to dry in mild weather */
  dry: number
  /** shakes the water out of its coat on the bank */
  shakes: boolean
  /** how far out from the bank it ventures (m) */
  reach: number
}

export type WaterSpecies =
  | "cat" | "rabbit" | "deer" | "fox" | "duck" | "horse" | "monkey" | "tiger" | "cheetah" | "gorilla"
  | "companion-cat" | "pegasus"

export const WATER_WAYS: Record<WaterSpecies, WaterWay> = {
  // a domestic cat swims competently (a fast, high-chinned dog paddle) when it chooses to
  cat: { love: 0.32, swims: true, shoulder: 0.25, wade: 0.55, draft: 0.78, swimSpeed: 0.55, stroke: 2.4, mass: 0.05, dry: 120, shakes: true, reach: 2.2 },
  "companion-cat": { love: 0.5, swims: true, shoulder: 0.25, wade: 0.55, draft: 0.78, swimSpeed: 0.6, stroke: 2.4, mass: 0.05, dry: 110, shakes: true, reach: 2.6 },
  rabbit: { love: 0.14, swims: true, shoulder: 0.17, wade: 0.5, draft: 0.72, swimSpeed: 0.45, stroke: 3.2, mass: 0.03, dry: 90, shakes: true, reach: 1.2 },
  fox: { love: 0.45, swims: true, shoulder: 0.36, wade: 0.6, draft: 0.8, swimSpeed: 0.7, stroke: 2.0, mass: 0.14, dry: 120, shakes: true, reach: 3.5 },
  deer: { love: 0.6, swims: true, shoulder: 0.95, wade: 0.62, draft: 0.82, swimSpeed: 1.1, stroke: 1.2, mass: 0.5, dry: 160, shakes: true, reach: 7 },
  horse: { love: 0.55, swims: true, shoulder: 1.5, wade: 0.6, draft: 0.9, swimSpeed: 1.35, stroke: 0.95, mass: 1, dry: 220, shakes: true, reach: 8 },
  duck: { love: 1, swims: true, shoulder: 0.2, wade: 0.5, draft: 0.4, swimSpeed: 0.35, stroke: 1.6, mass: 0.04, dry: 20, shakes: false, reach: 9 },
  // macaques bathe and sit in shallow water; wading only, no ape-in-the-deep
  monkey: { love: 0.62, swims: false, shoulder: 0.42, wade: 0.85, draft: 0, swimSpeed: 0, stroke: 0, mass: 0.12, dry: 140, shakes: true, reach: 2.4 },
  // tigers soak to cool off and swim well
  tiger: { love: 0.95, swims: true, shoulder: 0.95, wade: 0.7, draft: 0.8, swimSpeed: 1.0, stroke: 1.05, mass: 0.75, dry: 200, shakes: true, reach: 7 },
  // a cheetah keeps to the edge: drinks, cools its paws, wades a little
  cheetah: { love: 0.22, swims: true, shoulder: 0.8, wade: 0.5, draft: 0.8, swimSpeed: 0.85, stroke: 1.3, mass: 0.45, dry: 160, shakes: true, reach: 3 },
  // gorillas wade (often upright) and sit in shallows to feed; not swimmers
  gorilla: { love: 0.38, swims: false, shoulder: 1.0, wade: 0.75, draft: 0, swimSpeed: 0, stroke: 0, mass: 0.85, dry: 220, shakes: false, reach: 3 },
  pegasus: { love: 0.5, swims: true, shoulder: 1.6, wade: 0.6, draft: 0.9, swimSpeed: 1.4, stroke: 0.95, mass: 1, dry: 200, shakes: true, reach: 8 },
}

/** Surface of the home pond or creek at (x, z), or null. */
export const homeWaterSurfaceAt = (x: number, z: number): number | null => {
  const pd = Math.hypot((x - POND.x) / 1.08, (z - POND.z) / 0.88)
  if (pd < POND.r - 0.15) return worldHeight(x, z) < WATER_Y ? WATER_Y : null
  if (x > RIVER_MIN_X + 0.4 && x < RIVER_MAX_X - 0.4 && Math.abs(z - riverCenterZ(x)) < riverHalfWidthAt(x) - 0.1) {
    return worldHeight(x, z) < WATER_Y ? WATER_Y : null
  }
  return null
}

/** Every water an animal can drink from or step into: lakes, the river, home's pond and creek. */
export const creatureWaterSurfaceAt = (x: number, z: number): number | null =>
  waterSurfaceAt(x, z) ?? homeWaterSurfaceAt(x, z)

export const creatureWaterDepthAt = (x: number, z: number): number => {
  const s = creatureWaterSurfaceAt(x, z)
  return s === null ? 0 : Math.max(0, s - worldHeight(x, z))
}

/** Current (m/s, world x/z) at a point: The river runs fast through its rapids, the creek gently. */
export const waterCurrentAt = (x: number, z: number, out: { x: number; z: number }): { x: number; z: number } => {
  out.x = 0; out.z = 0
  if (highvaleWeight(x, z) > 0) {
    const [, n] = toLocal(x, z)
    const [ax, az] = toWorld(riverE(n), n)
    const [bx, bz] = toWorld(riverE(Math.max(RIVER_N0, n - 6)), n - 6)
    const len = Math.hypot(bx - ax, bz - az) || 1
    const speed = 0.35 + Math.min(1.4, riverFall(n) * 30)
    out.x = (bx - ax) / len * speed
    out.z = (bz - az) / len * speed
    return out
  }
  if (x > RIVER_MIN_X && x < RIVER_MAX_X && Math.abs(z - riverCenterZ(x)) < riverHalfWidthAt(x) + 0.2) {
    riverFlow(x, out)
    out.x *= 0.18; out.z *= 0.18
  }
  return out
}

/**
 * How inviting water is right now, 0..1 (0.5 is a mild day). Heat draws
 * animals in to cool; cold, storms and the dark keep them on the bank.
 * `nocturnal` animals (tigers) don't mind the dark.
 */
export const waterInvitation = (tod: number, nocturnal = false): number => {
  const temp = weatherRT.data.temperatureC
  const cold = Math.max(weatherRT.snow > 0.05 ? 1 : 0, temp === null ? 0 : Math.min(1, Math.max(0, (12 - temp) / 10)))
  const hot = Math.max(weatherRT.heat, temp === null ? 0 : Math.min(1, Math.max(0, (temp - 24) / 10)))
  const storm = Math.min(1, Math.max(0, (weatherRT.rain - 0.55) / 0.3)) + (weatherRT.burst > 0.2 ? 1 : 0)
  const night = nocturnal ? 0 : Math.min(1, Math.max(0, (tod - 0.82) / 0.15))
  const v = 0.5 + hot * 0.45 - cold * 0.55 - night * 0.35 - Math.min(1, storm) * 0.6 + (weatherRT.rain > 0.15 && weatherRT.rain < 0.5 ? -0.08 : 0)
  return Math.min(1, Math.max(0, v))
}

/** True when nobody sensible would stay in the water: lightning storms, cloudbursts, deep cold. */
export const waterUnwelcoming = (): boolean => {
  const temp = weatherRT.data.temperatureC
  return weatherRT.rain > 0.78 || weatherRT.burst > 0.35 || weatherRT.snow > 0.3 || (temp !== null && temp < 3)
}

/** Seconds-scale drying factor: sun and wind dry a coat, rain and cold keep it wet. */
export const dryingRate = (way: WaterWay): number => {
  if (weatherRT.rain > 0.3) return 0
  const temp = weatherRT.data.temperatureC ?? 18
  const k = (0.6 + weatherRT.heat * 0.9 + Math.min(0.6, weatherRT.wind * 0.8)) * Math.min(1.4, Math.max(0.35, (temp + 4) / 22))
  return k / way.dry
}

/**
 * A point in the water reached from a bank spot along `face`, at a depth the
 * animal wants (`deep`: out of its depth for a swim; otherwise a comfortable
 * wade), or null when no such water lies within its reach.
 */
export const pickWaterSpot = (
  x: number, z: number, face: number, way: WaterWay, scale: number, deep: boolean, random: () => number,
): { x: number; z: number; depth: number } | null => {
  const wadeMax = way.shoulder * scale * way.wade
  let best: { x: number; z: number; depth: number } | null = null
  for (let i = 0; i < 9; i++) {
    const a = face + (random() - 0.5) * 1.1
    const d = 0.7 + random() * way.reach
    const px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d
    const s = creatureWaterSurfaceAt(px, pz)
    if (s === null) continue
    const depth = s - worldHeight(px, pz)
    if (depth < 0.06) continue
    if (deep ? depth < wadeMax * 1.15 : depth > wadeMax) continue
    // the whole way out must be water or bank, never a far shore across a spit
    let wet = true
    for (let k = 1; k <= 3; k++) {
      const t = k / 4
      const qx = x + (px - x) * t, qz = z + (pz - z) * t
      if (creatureWaterSurfaceAt(qx, qz) === null && worldHeight(qx, qz) > (s + 0.35)) { wet = false; break }
    }
    if (!wet) continue
    if (!best || (deep ? depth > best.depth : depth > best.depth && depth < wadeMax * 0.8)) best = { x: px, z: pz, depth }
  }
  return best
}

/** Body height for a creature at a point: on the bed while wading, floating while swimming. */
export const creatureWaterY = (
  x: number, z: number, way: WaterWay, scale: number, bed: number,
): { y: number; surface: number | null; depth: number; swim: number } => {
  const surface = creatureWaterSurfaceAt(x, z)
  if (surface === null || surface <= bed) return { y: bed, surface: null, depth: 0, swim: 0 }
  const depth = surface - bed
  const wadeMax = way.shoulder * scale * way.wade
  if (!way.swims || depth <= wadeMax) return { y: bed, surface, depth, swim: 0 }
  const float = surface - way.shoulder * scale * way.draft
  // blend over a short band so the feet leave the bed rather than pop
  const swim = Math.min(1, (depth - wadeMax) / Math.max(0.05, way.shoulder * scale * 0.2))
  return { y: Math.max(bed, bed + (float - bed) * swim), surface, depth, swim }
}

setCreatureSplashSurface(homeWaterSurfaceAt)

/** Per-body water contact: entry splashes, wake rings, wetness and drips. */
export type WaterContact = {
  inWater: boolean
  depth: number
  /** 0..1 how wet the coat is; dries on land */
  wet: number
  /** distance travelled since the last wake ring */
  wake: number
  /** seconds to the next still-water ring / drip */
  ring: number
  drip: number
}

export const makeWaterContact = (): WaterContact => ({ inWater: false, depth: 0, wet: 0, wake: 0, ring: 1, drip: 0.5 })

/**
 * Step a body's contact with water. `near` gates every visual (nobody sees
 * the rings of an animal 80 m away). Returns "enter" / "exit" on the frame
 * it happens so a brain can react (a shake on the bank).
 */
export const stepWaterContact = (
  c: WaterContact, way: WaterWay, scale: number,
  x: number, z: number, ground: number, heading: number, speed: number, dt: number, near: boolean,
): "enter" | "exit" | null => {
  const surface = creatureWaterSurfaceAt(x, z)
  const depth = surface === null ? 0 : Math.max(0, surface - ground)
  const shoulder = way.shoulder * scale
  const wasIn = c.inWater
  // paws in a film of water at the edge don't count; the hysteresis keeps a
  // body walking the waterline from flickering in and out
  c.inWater = depth > (wasIn ? 0.03 : Math.max(0.05, shoulder * 0.12))
  c.depth = depth
  let event: "enter" | "exit" | null = null
  const k = Math.min(1, depth / Math.max(0.05, shoulder))
  if (c.inWater) {
    c.wet = Math.min(1, c.wet + dt * (0.15 + k * 1.6))
    if (!wasIn) {
      event = "enter"
      if (near && speed > 0.25) {
        emitCreatureSplash(x + Math.sin(heading) * shoulder * 0.4, z + Math.cos(heading) * shoulder * 0.4,
          way.mass * scale * (0.35 + Math.min(1, speed / 3)), Math.sin(heading) * Math.min(1, speed / 3), Math.cos(heading) * Math.min(1, speed / 3))
      }
    }
    if (near) {
      c.wake += speed * dt
      const spacing = Math.max(0.3, shoulder * 0.9)
      if (speed > 0.12 && c.wake > spacing) {
        c.wake = 0
        // the ring is born at the chest, where the body parts the water
        emitRipple(x + Math.sin(heading) * shoulder * 0.3, z + Math.cos(heading) * shoulder * 0.3,
          0.18 + way.mass * scale * 1.1 + Math.min(0.5, speed * 0.12), 1.1 + way.mass * 0.9)
        // a horse or tiger ploughing through the shallows throws spray off its legs
        if (speed > 2.2 && depth < shoulder * 0.7 && way.mass > 0.3) emitCreatureSplash(x, z, way.mass * scale * 0.35, Math.sin(heading), Math.cos(heading))
      }
      c.ring -= dt
      if (speed <= 0.12 && c.ring <= 0) {
        // standing or floating still: the slow rings of breathing and treading water
        c.ring = 1.8 + Math.random() * 2.2
        emitRipple(x, z, 0.15 + way.mass * scale * 0.6, 2 + way.mass)
      }
    }
  } else {
    if (wasIn) event = "exit"
    c.wet = Math.max(0, c.wet - dt * dryingRate(way))
    if (near && c.wet > 0.3) {
      c.drip -= dt
      if (c.drip <= 0) {
        c.drip = 0.18 + Math.random() * 0.5 + (1 - c.wet) * 0.8
        emitDrips(x, ground + shoulder * (0.45 + Math.random() * 0.4), z, ground, c.wet > 0.7 ? 2 : 1, shoulder * 0.35)
      }
    }
  }
  return event
}

/** A shake throws a ring of water off the coat (call once as the shake starts). */
export const shakeOffWater = (c: WaterContact, way: WaterWay, scale: number, x: number, z: number, ground: number): void => {
  if (c.wet < 0.2) return
  const shoulder = way.shoulder * scale
  emitDrips(x, ground + shoulder * 0.75, z, ground, Math.round(6 + 14 * Math.min(1, way.mass * 3 + 0.2) * c.wet), Math.max(0.35, shoulder * 0.6))
  c.wet *= 0.35
}
