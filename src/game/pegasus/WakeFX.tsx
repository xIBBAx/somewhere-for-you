import { useEffect, useMemo } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { avatarRT } from "../runtime"
import { horseRT, fwdX, fwdZ } from "../horses/horseState"
import { originRT } from "../../world/origin"
import { flightWaterSurfaceAt } from "../../world/waterSurface"
import { dominantBiome, type BiomeId } from "../../world/climate"
import { groundHeight } from "../world-layout"
import { sampleGround, type GroundKind } from "../environment/ground/groundSurface"
import { spaceRT } from "../celestial/spaceState"
import { weatherRT } from "../weather/weatherState"
import { qualityRT } from "../../state/qualityStore"
import { cloudFieldRT } from "../environment/cloudField"
import { emitWaterWake, updateWaterWake, clearWaterWake, WAKE_LIFE, WAKE_SLOTS } from "../../world/render/waterWake"
import { isPegasus } from "./pegasi"
import { downwashStrength } from "./downwash"
import { CloudWake } from "./CloudWakeFX"
import { makeWakePool } from "./wakePool"
import { driveAir } from "./airAudio"
import { airSound, dashTowards, effectScale, feedFor, sprayStrength, smooth, wakeRingStrength, type AirSound, type Feed } from "./flightAir"

/**
 * What a flying Pegasus does to the world below her, all read from her flight
 * state (flight.ts) and the surface under her:
 *
 *   water   she skims a lake, home pond or creek: rings of wave the lake shader draws (waterWake.ts)
 *           that fan out into a V behind a faster flyer, a churned rotor patch
 *           under her wings, and sheets of spray thrown up and back, full in a
 *           dash a few metres up and gone by ~25 m
 *   ground  low over dry ground, dust; over snow, powder whirled up; over
 *           meadows, petals or leaves (flightAir.ts feedFor)
 *   air     the rush of air, a roar in dense low air, a hiss over spray (airAudio.ts)
 *
 * Wind in cloud is in CloudWakeFX. Nothing here runs on the ground, in the sail
 * phase, or out of the Earth's air. Every effect is pooled with one draw each.
 */

const TAU = Math.PI * 2
const MAX_SPRAY = 40
const SPRAY_CAP = 260
const DEBRIS_CAP = 240

type Rig = {
  dash: number
  /** distance (m) carried over toward the next ring of wave */
  acc: number
  spray: number
  debris: number
  /** surface cache, refreshed a few times a second */
  refresh: number
  x: number
  z: number
  water: boolean
  surface: number | null
  ground: GroundKind
  groundY: number
  biome: BiomeId
  snowy: boolean
}

type Rotor = { x: number; z: number; radius: number; strength: number }

const makeRig = (): Rig => ({
  dash: 0, acc: 0, spray: 0, debris: 0, refresh: 0,
  x: Infinity, z: Infinity, water: false, surface: null, ground: "grass", groundY: 0, biome: "meadow", snowy: false,
})

const sprayColour = [0.93, 0.98, 1.0] as const
const DEBRIS_COLOUR: Record<Exclude<Feed, "none">, { cols: readonly (readonly [number, number, number])[]; size: number; life: number; gravity: number; drag: number }> = {
  dust: { cols: [[0.83, 0.70, 0.52], [0.6, 0.45, 0.3]], size: 0.9, life: 2.6, gravity: 0.7, drag: 0.9 },
  powder: { cols: [[0.97, 0.99, 1.0]], size: 0.8, life: 2.4, gravity: 0.45, drag: 0.8 },
  petal: { cols: [[0.97, 0.75, 0.83], [1.0, 0.88, 0.92]], size: 0.13, life: 4.2, gravity: 0.9, drag: 1.6 },
  leaf: { cols: [[0.82, 0.57, 0.22], [0.62, 0.7, 0.29]], size: 0.17, life: 3.6, gravity: 1.4, drag: 1.2 },
}

export const PegasusWake = (): React.ReactElement => {
  const fx = useMemo(() => {
    const root = new THREE.Group()
    root.name = "pegasus-wake"
    const spray = makeWakePool(SPRAY_CAP, 0.9, "pegasus-spray")
    const debris = makeWakePool(DEBRIS_CAP, 0.8, "pegasus-debris")
    root.add(spray.points, debris.points)
    return { root, spray, debris, rigs: new Map<string, Rig>(), rotor: { x: 0, z: 0, radius: 1, strength: 0 } as Rotor, clock: 0, reduced: false }
  }, [])

  useEffect(() => {
    const q = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null
    fx.reduced = q?.matches ?? false
    const update = (e: MediaQueryListEvent): void => { fx.reduced = e.matches }
    q?.addEventListener("change", update)
    return () => q?.removeEventListener("change", update)
  }, [fx])

  useEffect(() => () => {
    fx.spray.dispose()
    fx.debris.dispose()
    clearWaterWake()
    driveAir(null)
  }, [fx])

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    fx.clock += dt
    const now = fx.clock
    // cancel WorldRoot's translation so the pools are written relative to the origin
    fx.root.position.set(originRT.x, 0, originRT.z)

    const earth = spaceRT.realm === "earth" && spaceRT.mode === "local"
    const scale = effectScale(qualityRT.profile.particles, fx.reduced)
    const rotor = fx.rotor
    rotor.strength = 0
    let loudest: AirSound | null = null
    let loudness = 0
    const snowy = weatherRT.snow > 0.3

    if (earth) {
      for (const h of horseRT.horses.values()) {
        if (!isPegasus(h) || !h.flight || !h.visible) continue
        const f = h.flight
        if (f.mode === "ground" || f.mode === "sail") continue
        let r = fx.rigs.get(h.ident.id)
        if (!r) { r = makeRig(); fx.rigs.set(h.ident.id, r) }
        const semi = h.model?.meta.wing?.semi ?? 3.2
        const speed = Math.abs(h.speed)
        r.dash = dashTowards(r.dash, f.boostT > 0, dt)
        // the surface under her, refreshed a few times a second (sampling the ground is not free)
        if (f.alt < 40) {
          r.refresh -= dt
          if (r.refresh <= 0 || Math.hypot(h.x - r.x, h.z - r.z) > 0.75) {
            r.refresh = 0.25
            r.x = h.x; r.z = h.z
            r.surface = flightWaterSurfaceAt(h.x, h.z)
            r.water = r.surface !== null
            r.ground = sampleGround(h.x, h.z).kind
            r.groundY = groundHeight(h.x, h.z)
            r.biome = dominantBiome(h.x, h.z)
            r.snowy = snowy
          }
        }
        const altitude = Math.max(0, h.y - (r.surface ?? r.groundY))
        const wash = downwashStrength(f, semi, altitude)
        const wet = r.water && altitude < 25 && f.alt < 40
        const spray = wet ? sprayStrength(altitude, speed, r.dash, wash) : 0

        // water: rings of wave laid down every stretch she covers
        if (wet && speed > 0.5 && (wash > 0.02 || spray > 0.02 || r.dash > 0.02)) {
          const ring = wakeRingStrength(speed, r.dash, wash) * (1 - smooth(3, 25, altitude)) * (fx.reduced ? 0.6 : 1)
          r.acc += speed * dt
          const spacing = Math.max(1.4 + 0.9 * r.dash, speed * WAKE_LIFE / (WAKE_SLOTS - 1))
          for (let k = 0; k < 4 && r.acc >= spacing; k++) {
            r.acc -= spacing
            emitWaterWake(h.x - fwdX(h.heading) * r.acc, h.z - fwdZ(h.heading) * r.acc, ring, now)
          }
        } else r.acc = 0
        // the churned rotor patch under the wings, the strongest one wins
        const patch = wet ? wash * (0.35 + 0.65 * r.dash) : 0
        if (patch > rotor.strength) {
          rotor.x = h.x; rotor.z = h.z; rotor.radius = semi * 2.4; rotor.strength = patch
        }

        // sheets of spray off the water, thrown up and back
        if (spray > 0.02) {
          r.spray += spray * (35 + 150 * r.dash) * scale * dt
          const surf = r.surface ?? 0
          for (let k = 0; k < MAX_SPRAY && r.spray >= 1; k++) {
            r.spray -= 1
            const a = Math.random() * TAU
            const rad = semi * (0.4 + 0.9 * Math.random())
            const throwBack = (2 + 8 * r.dash) * (0.4 + 0.6 * Math.random()) * (1 + spray)
            const side = (0.6 + 2 * Math.random()) * (0.5 + wash)
            fx.spray.spawn(
              h.x + Math.cos(a) * rad, surf, h.z + Math.sin(a) * rad,
              -fwdX(h.heading) * throwBack + Math.cos(a) * side,
              (2.5 + 5 * Math.random()) * (0.35 + spray),
              -fwdZ(h.heading) * throwBack + Math.sin(a) * side,
              0.9 + 0.7 * Math.random(), 0.1 + 0.1 * Math.random(),
              sprayColour[0], sprayColour[1], sprayColour[2], 9.8, 0.25, surf - 0.02,
            )
          }
        } else r.spray = 0

        // dust, powder, petals or leaves kicked up under a low wing over land
        const feed: Feed = !r.water && f.alt < 40 && altitude < 3 * semi && wash > 0.02 ? feedFor(r.ground, r.biome, r.snowy) : "none"
        if (feed !== "none") {
          const spec = DEBRIS_COLOUR[feed]
          r.debris += wash * (0.35 + 0.65 * r.dash) * (30 + 80 * wash) * scale * dt
          for (let k = 0; k < MAX_SPRAY && r.debris >= 1; k++) {
            r.debris -= 1
            const a = Math.random() * TAU
            const rad = semi * (0.5 + 1.1 * Math.random())
            const out = (2 + 6 * wash) * (0.6 + 0.4 * Math.random()) * (1 + r.dash)
            const swirl = feed === "powder" ? 2.5 * wash : 0
            const c = spec.cols[Math.floor(Math.random() * spec.cols.length)]
            fx.debris.spawn(
              h.x + Math.cos(a) * rad, r.groundY + 0.05, h.z + Math.sin(a) * rad,
              Math.cos(a) * out - Math.sin(a) * swirl, (0.6 + 1.8 * Math.random()) * (0.4 + wash) * (feed === "dust" ? 1.6 : 1),
              Math.sin(a) * out + Math.cos(a) * swirl,
              spec.life * (0.8 + 0.4 * Math.random()), spec.size * (0.7 + 0.6 * Math.random()),
              c[0], c[1], c[2], spec.gravity, spec.drag, r.groundY - 0.05,
            )
          }
        } else r.debris = 0

        // the air rushing past her: loudest of the Pegasi in the air decides the bed
        const cover = cloudFieldRT.cover
        const s = airSound(f.alt, speed, r.dash, cover, spray)
        const listener = avatarRT().pos
        const distance = Math.hypot(h.x - listener.x, h.y - listener.y, h.z - listener.z)
        const attenuation = 1 - Math.min(1, Math.max(0, (distance - 8) / 60))
        s.rush *= attenuation; s.roar *= attenuation; s.hiss *= attenuation
        const level = s.rush + s.roar + s.hiss
        if (level > loudness) { loudness = level; loudest = s }
      }
    } else {
      fx.rigs.clear()
    }

    updateWaterWake(now, rotor.strength > 0 ? rotor : null)
    fx.spray.step(dt)
    fx.spray.write(originRT.x, originRT.z)
    fx.debris.step(dt)
    fx.debris.write(originRT.x, originRT.z)
    // the pools' pixel scale follows the lens so a metre looks like a metre at any distance
    const cam = state.camera as THREE.PerspectiveCamera
    const px = state.size.height / (2 * Math.tan((cam.fov * Math.PI) / 360))
    fx.spray.material.uniforms.uScale.value = px
    fx.debris.material.uniforms.uScale.value = px
    driveAir(loudest)
  })

  return (
    <>
      <primitive object={fx.root} />
      <CloudWake />
    </>
  )
}
