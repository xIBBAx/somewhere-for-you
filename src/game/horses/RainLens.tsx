import { useFrame } from "@react-three/fiber"
import { useMemo } from "react"
import { avatarRT, cameraRT, characterRT, worldRT } from "../runtime"
import { rainReach, weatherRT } from "../weather/weatherState"
import { riderRT } from "./riding"
import { spaceRT } from "../celestial/spaceState"
import { isSheltered } from "../environment/water/waterSim"
import { usePhoto } from "../activities/photo"
import { LENS_H, lensRT, makeDropStamp } from "../render/LensRain"
import { climbMistRT } from "../pegasus/ClimbMistFX"

/**
 * Raindrops on the lens (the refraction itself is render/LensRain.ts).
 *
 * Drops land at the rate the rain allows: often while riding or flying into
 * it, now and then on foot in heavy rain, almost never under trees or a roof,
 * never above the clouds or out of the air. Small ones bead and stay until
 * they dry; bigger ones (and drops that merge) start to slide, stop and
 * slide on, leaving a trail of tiny beads; a fast ride's airflow sweeps them
 * out toward the edges. When the rain stops they dry off over a few seconds.
 */

type Drop = { x: number; y: number; r: number; life: number; vx: number; vy: number; stick: number; ax: number; ay: number }

const MAX_DROPS = 140

export const RainLens = (): null => {
  const sim = useMemo(() => ({ drops: [] as Drop[], acc: 0, stamp: null as HTMLCanvasElement | null, clear: true, strength: 0 }), [])

  useFrame((_, rawDt) => {
    const effect = lensRT.effect
    const canvas = lensRT.canvas
    if (!lensRT.active || !effect || !canvas || !lensRT.texture) {
      sim.drops.length = 0
      return
    }
    const dt = Math.min(rawDt, 0.05)
    // the frame's shape
    const aspect = Math.max(0.4, Math.min(3, window.innerWidth / Math.max(1, window.innerHeight)))
    const W = Math.round(LENS_H * aspect), H = LENS_H
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; sim.drops.length = 0 }
    effect.uniforms.get("uAspect")!.value = aspect

    // ---- how much rain reaches the lens --------------------------------------
    const r = riderRT[characterRT.active]
    const mount = r.phase === "riding" ? r.horse : null
    const speed = mount ? Math.abs(mount.speed) : avatarRT().vel.length()
    const cam = avatarRT().pos
    const earth = spaceRT.realm === "earth" && spaceRT.mode === "local"
    // rain falls from the storm cloud down: thinning inside it, none above it or out of the air
    const underCloud = rainReach(spaceRT.weatherAltitude, earth)
    const roofed = isSheltered(cam.x, cam.y + 1.6, cam.z) ? 0 : 1
    const open = (1 - cameraRT.canopy * 0.9) * roofed * underCloud
    const rain = Math.max(0, weatherRT.rain - 0.12) * open * (1 + weatherRT.burst * 1.5)
    // on foot the camera mostly keeps dry; moving into the rain it catches more
    // flying through cloud, the mist itself beads on the lens (pegasus/ClimbMistFX.tsx)
    const mist = climbMistRT.wet * (8 + Math.min(speed, 40) * 0.6)
    const rate = rain * (mount ? 6 + Math.min(speed, 40) * 0.9 : weatherRT.rain > 0.7 ? 1.4 : 0.3) + mist
    // photo mode and the opening film show the world clean
    const hidden = usePhoto.getState().open || worldRT.introActive
    sim.strength += ((hidden ? 0 : 1) - sim.strength) * (1 - Math.exp(-dt * 4))
    effect.uniforms.get("uStrength")!.value = sim.strength

    if (rate <= 0.01 && sim.drops.length === 0) {
      if (!sim.clear) {
        canvas.getContext("2d")!.clearRect(0, 0, W, H)
        lensRT.texture.needsUpdate = true
        sim.clear = true
      }
      return
    }
    sim.clear = false
    sim.stamp ??= makeDropStamp()

    // ---- new drops ---------------------------------------------------------------
    sim.acc += rate * dt
    while (sim.acc > 1) {
      sim.acc -= 1
      if (sim.drops.length >= MAX_DROPS) { sim.drops.shift() }
      // mostly fine beads, a few big drops (radius as a share of the frame's height)
      // cloud mist beads finer than rain: a fog of tiny droplets
      const u = Math.random()
      const fine = Math.random() * rate < mist
      const rr = fine ? H * (0.0022 + u * u * 0.005) : H * (0.004 + u * u * u * 0.02)
      sim.drops.push({ x: Math.random() * W, y: Math.random() * H, r: rr, life: 6 + Math.random() * 10, vx: 0, vy: 0, stick: 0.4 + Math.random() * 1.6, ax: 0.88 + Math.random() * 0.24, ay: 0.88 + Math.random() * 0.24 })
    }

    // ---- move them -------------------------------------------------------------
    const flow = mount ? Math.min(1, speed / 14) : 0
    const big = H * 0.012
    for (let i = sim.drops.length - 1; i >= 0; i--) {
      const d = sim.drops[i]
      // drying: faster once the rain has stopped
      d.life -= dt * (rain > 0.02 ? 1 : 2.5)
      if (d.r > big || flow > 0.2) {
        d.stick -= dt
        if (d.stick <= 0) {
          // gravity pulls a big drop down in fits and starts; the ride's
          // airflow drags everything outward from the middle of the view
          const ox = d.x - W / 2, oy = d.y - H / 2
          const len = Math.hypot(ox, oy) + 1
          const pull = (d.r / big) * 26
          d.vx += (ox / len) * flow * 140 * dt
          d.vy += (pull + (oy / len) * flow * 140) * dt
          if (Math.random() < dt * 0.8) { d.stick = 0.2 + Math.random() * 0.8; d.vx *= 0.3; d.vy *= 0.3 }
          // a sliding drop leaves a string of tiny beads
          if (Math.random() < dt * 9 && sim.drops.length < MAX_DROPS) {
            sim.drops.push({ x: d.x + (Math.random() - 0.5) * d.r * 0.5, y: d.y - d.r * 0.6, r: d.r * (0.18 + Math.random() * 0.15), life: 3 + Math.random() * 4, vx: 0, vy: 0, stick: 99, ax: 1, ay: 1 })
            d.r *= 0.985
          }
        }
      }
      d.x += d.vx * dt
      d.y += d.vy * dt
      if (d.life <= 0 || d.r < 0.6 || d.x < -d.r * 3 || d.x > W + d.r * 3 || d.y > H + d.r * 3) sim.drops.splice(i, 1)
    }
    // ---- drops that touch run together (the bigger takes the water) -----------
    for (let i = 0; i < sim.drops.length; i++) {
      const a = sim.drops[i]
      if (a.vx === 0 && a.vy === 0) continue
      for (let j = 0; j < sim.drops.length; j++) {
        if (i === j) continue
        const b = sim.drops[j]
        const dx = a.x - b.x, dy = a.y - b.y
        const rr = (a.r + b.r) * 0.8
        if (dx * dx + dy * dy < rr * rr) {
          // volumes add (r³)
          a.r = Math.cbrt(a.r ** 3 + b.r ** 3)
          a.life = Math.max(a.life, b.life)
          b.life = 0
          b.r = 0
        }
      }
    }

    // ---- draw the surface map ---------------------------------------------------
    const g = canvas.getContext("2d")!
    g.clearRect(0, 0, W, H)
    g.globalAlpha = 1
    for (const d of sim.drops) {
      if (d.r <= 0) continue
      const fade = Math.min(1, d.life / 1.5)
      // a sliding drop draws out long behind its head (the stamp's slopes
      // are never rotated: a turned stamp would bend the light the wrong way)
      const stretch = 1 + Math.min(1.2, Math.hypot(d.vx, d.vy) / 120)
      const rx = d.r * d.ax, ry = d.r * d.ay * stretch
      g.globalAlpha = fade
      g.drawImage(sim.stamp, d.x - rx, d.y + d.r * d.ay - ry * 2, rx * 2, ry * 2)
    }
    lensRT.texture.needsUpdate = true
  })
  return null
}
