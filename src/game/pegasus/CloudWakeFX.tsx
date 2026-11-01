import { useEffect, useMemo } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { avatarRT } from "../runtime"
import { horseRT, fwdX, fwdZ } from "../horses/horseState"
import { originRT } from "../../world/origin"
import { spaceRT } from "../celestial/spaceState"
import { weatherRT } from "../weather/weatherState"
import { qualityRT } from "../../state/qualityStore"
import { CLOUD_CONFIG } from "../environment/Clouds"
import { cloudFieldRT } from "../environment/cloudField"
import { isPegasus } from "./pegasi"
import { makeWakePool } from "./wakePool"
import { dashTowards, effectScale, smooth, wrapDomain } from "./flightAir"

/**
 * Flying through cloud. The deck is drawn from puffs whose place the cloud shader
 * computes; cloudField.ts carries the same wind offset, domain and altitude, so
 * "is she inside a puff" is the same test the eye sees. Inside, shredded vapour
 * streams past her; a dashing Pegasus in moist air trails vapour from each wingtip
 * (the wingtip vortex condenses where the pressure drops); and on punching out of
 * the top of a cloud, a soft burst of vapour bursts off her as the air lets go.
 */

const TAU = Math.PI * 2
const CAP = 360
const MAX_PER_FRAME = 48

type CloudRig = {
  dash: number
  inTime: number
  outTime: number
  inside: boolean
  cover: number
  vapour: number
  tip: number
}

const makeRig = (): CloudRig => ({ dash: 0, inTime: 0, outTime: 0, inside: false, cover: 0, vapour: 0, tip: 0 })

/** Is the point (render space) inside any cumulus puff as the cloud shader draws it this frame. */
export const insideCloudDeck = (px: number, py: number, pz: number): boolean => {
  const F = cloudFieldRT
  const R = CLOUD_CONFIG.domainRadius
  const dx = F.domain.x, dz = F.domain.y
  for (const f of F.formations) {
    // the shader's wrap: the formation's place is its own plus the wind, wrapped about the camera
    const cx = wrapDomain(f.x + F.wind.x - dx, R) + dx
    const cz = wrapDomain(f.z + F.wind.y - dz, R) + dz
    const reach = f.scale * 40 + 6
    if (Math.abs(cx - px) > reach || Math.abs(cz - pz) > reach) continue
    const cy = f.y + F.altitude
    for (const p of f.puffs) {
      const ex = cx + p.dx * f.scale - px
      const ey = cy + p.dy * f.scale - py
      const ez = cz + p.dz * f.scale - pz
      // Tall and flat formations have different vertical extents. A sphere
      // based on width incorrectly triggered vapour far above thin clouds.
      const rx = Math.max(0.01, p.sx * f.scale * 0.5)
      const ry = Math.max(0.01, p.sy * f.scale * 0.5)
      const rz = Math.max(0.01, p.sz * f.scale * 0.5)
      if ((ex / rx) ** 2 + (ey / ry) ** 2 + (ez / rz) ** 2 < 1) return true
    }
  }
  return false
}

export const CloudWake = (): React.ReactElement => {
  const fx = useMemo(() => {
    const root = new THREE.Group()
    root.name = "pegasus-cloud-wake"
    const vapour = makeWakePool(CAP, 0.5, "pegasus-vapour")
    root.add(vapour.points)
    return { root, vapour, rigs: new Map<string, CloudRig>(), clock: 0, reduced: false }
  }, [])

  useEffect(() => {
    const q = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null
    fx.reduced = q?.matches ?? false
    const update = (e: MediaQueryListEvent): void => { fx.reduced = e.matches }
    q?.addEventListener("change", update)
    return () => q?.removeEventListener("change", update)
  }, [fx])

  useEffect(() => () => { fx.vapour.dispose() }, [fx])

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    fx.clock += dt
    fx.root.position.set(originRT.x, 0, originRT.z)
    const v = fx.vapour
    const scale = effectScale(qualityRT.profile.particles, fx.reduced)
    let cover = 0
    const earth = spaceRT.realm === "earth" && spaceRT.mode === "local"
    let budget = MAX_PER_FRAME
    if (earth) {
      const moistAir = weatherRT.cloud > 0.4 || weatherRT.rain > 0.05
      for (const h of horseRT.horses.values()) {
        if (!isPegasus(h) || !h.flight || !h.visible) continue
        const f = h.flight
        if (f.mode === "ground" || f.mode === "sail") continue
        let r = fx.rigs.get(h.ident.id)
        if (!r) { r = makeRig(); fx.rigs.set(h.ident.id, r) }
        const semi = h.model?.meta.wing?.semi ?? 3.2
        const speed = Math.abs(h.speed)
        const hx = fwdX(h.heading), hz = fwdZ(h.heading)
        // her velocity in logical space (heading, speed, climb)
        const vx = hx * h.speed, vy = f.vy, vz = hz * h.speed
        r.dash = dashTowards(r.dash, f.boostT > 0, dt)

        // hysteresis: a puff edge flickering past her does not count as entering or leaving
        const px = h.x - originRT.x, py = h.y, pz = h.z - originRT.z
        const hit = insideCloudDeck(px, py, pz)
        if (hit) { r.inTime += dt; r.outTime = 0 } else { r.outTime += dt; r.inTime = 0 }
        if (!r.inside && r.inTime > 0.12) r.inside = true
        else if (r.inside && r.outTime > 0.12) {
          r.inside = false
          // out through the top: the vapour she carries lets go in a soft burst
          if (vy > 0.4 && budget > 0) {
            const n = Math.round((18 + 24 * smooth(2, 18, speed)) * scale)
            for (let k = 0; k < n && budget > 0; k++, budget--) {
              const a = Math.random() * TAU
              const t = Math.random() * 2 - 1
              const s = Math.sqrt(1 - t * t)
              const out = 3 + 5 * Math.random()
              v.spawn(h.x, h.y, h.z, s * Math.cos(a) * out + vx * 0.3, t * out * 0.6 + 1, s * Math.sin(a) * out + vz * 0.3,
                1.6 + 0.8 * Math.random(), 3 + 3 * Math.random(), 0.97, 0.98, 1.0, 0.4, 2.2, -1e9)
            }
          }
        }
        const inside = r.inside ? 1 : 0
        r.cover += (inside - r.cover) * (1 - Math.exp(-dt * 4))
        const listener = avatarRT().pos
        // Only nearby vapour muffles the listener; a companion crossing a
        // distant cloud must not silence the player's clear air.
        if (Math.hypot(h.x - listener.x, h.y - listener.y, h.z - listener.z) < 16) cover = Math.max(cover, r.cover)
        if (r.cover < 0.02 && !r.inside) r.cover = 0

        // shredded vapour streaming past while she is in the cloud
        if (r.inside && budget > 0) {
          const pace = smooth(2, 20, speed)
          r.vapour += (10 + 40 * pace) * scale * dt
          for (let k = 0; r.vapour >= 1 && k < 16 && budget > 0; k++, budget--) {
            r.vapour -= 1
            const a = Math.random() * TAU
            const rad = 1 + 4 * Math.random()
            v.spawn(h.x + Math.cos(a) * rad, h.y + (Math.random() - 0.5) * 2.4, h.z + Math.sin(a) * rad,
              -vx * 0.5 + (Math.random() - 0.5) * 2, -vy * 0.3 + (Math.random() - 0.5), -vz * 0.5 + (Math.random() - 0.5) * 2,
              1.0 + 0.6 * Math.random(), 1.8 + 2.2 * Math.random(), 0.94, 0.96, 0.99, 0.2, 0.7, -1e9)
          }
        } else r.vapour = 0

        // wingtip vortices: a dash in moist air condenses a thread of vapour off each tip
        if (r.dash > 0.3 && (r.inside || moistAir) && budget > 0) {
          r.tip += (24 * r.dash + (r.inside ? 16 : 0)) * scale * dt
          const rx = hz, rz = -hx
          for (let k = 0; r.tip >= 1 && k < 12 && budget > 0; k++, budget--) {
            r.tip -= 1
            const side = Math.random() < 0.5 ? -1 : 1
            const th = Math.random() * TAU
            const tx = h.x + rx * side * semi * 0.95, tz = h.z + rz * side * semi * 0.95
            // a little swirl about the tip, carried back by her speed
            const ty = h.y + Math.cos(th) * 0.3
            v.spawn(tx, ty, tz, -vx * 0.6 + rx * side * 0.6, -vy * 0.2 + Math.sin(th) * 1.3, -vz * 0.6 + rz * side * 0.6,
              0.9 + 0.5 * Math.random(), 0.7 + 0.9 * Math.random(), 1, 1, 1, 0.1, 0.9, -1e9)
          }
        } else r.tip = 0
      }
    } else fx.rigs.clear()

    cloudFieldRT.cover = cover
    v.step(dt)
    v.write(originRT.x, originRT.z)
    const cam = state.camera as THREE.PerspectiveCamera
    v.material.uniforms.uScale.value = state.size.height / (2 * Math.tan((cam.fov * Math.PI) / 360))
  })

  return <primitive object={fx.root} />
}
