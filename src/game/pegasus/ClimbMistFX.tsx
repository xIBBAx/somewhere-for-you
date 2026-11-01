import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { characterRT, worldRT } from "../runtime"
import { riderRT } from "../horses/riding"
import type { HorseState } from "../horses/horseState"
import { spaceRT } from "../celestial/spaceState"
import { weatherRT } from "../weather/weatherState"
import { nightBlend, skyLightLevel } from "../environment/celestialLighting"
import { cloudFieldRT } from "../environment/cloudField"
import { originRT } from "../../world/origin"
import { insideCloudDeck } from "./CloudWakeFX"

/**
 * Flying up through the cloud deck on a Pegasus. The cloud shader clears
 * the puffs about the camera (so the view is never a smear of quads), which
 * left a climb through the deck looking like a climb through clear air.
 * Here, while the rider's Pegasus is in the deck's height band:
 *
 *  - wisps: soft, sunlit tatters of cloud held still in the world, so as she
 *    climbs they pour down past her with true parallax, thicker the more
 *    the sky is clouded and thickest inside a puff;
 *  - inside a puff, the white-out of being in a cloud, lifting as she breaks
 *    out of its top (CloudWakeFX lets the vapour she carries go there);
 *  - `climbMistRT.wet`: the moisture she flies through, beading on the lens
 *    (horses/RainLens.tsx).
 *
 * Nothing glows and nothing is drawn as a line: it is water in the air, lit
 * by the sky it is in.
 */
export const climbMistRT = { wet: 0, whiteout: 0 }

const WISPS = 16
const NEAR = 2.5
const FAR = 36

type Wisp = { sprite: THREE.Sprite; life: number; size: number; seed: number }

const makeTexture = (): THREE.CanvasTexture => {
  const N = 128
  const c = document.createElement("canvas")
  c.width = c.height = N
  const g = c.getContext("2d")!
  const img = g.createImageData(N, N)
  // a ragged, soft-edged tatter: radial falloff broken by two octaves of value noise
  const grid = (cells: number, seed: number): number[] => Array.from({ length: (cells + 1) * (cells + 1) }, (_, k) => {
    const s = Math.sin((k + 1) * 12.9898 + seed * 78.233) * 43758.5453
    return s - Math.floor(s)
  })
  const sample = (v: number[], cells: number, x: number, y: number): number => {
    const fx = x * cells, fy = y * cells
    const i = Math.min(cells - 1, Math.floor(fx)), j = Math.min(cells - 1, Math.floor(fy))
    const u = fx - i, w = fy - j
    const su = u * u * (3 - 2 * u), sw = w * w * (3 - 2 * w)
    const a = v[j * (cells + 1) + i], b = v[j * (cells + 1) + i + 1], cc = v[(j + 1) * (cells + 1) + i], d = v[(j + 1) * (cells + 1) + i + 1]
    return (a * (1 - su) + b * su) * (1 - sw) + (cc * (1 - su) + d * su) * sw
  }
  const n1 = grid(5, 1), n2 = grid(11, 2)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / (N - 1), v = y / (N - 1)
    const r = Math.hypot(u - 0.5, v - 0.5) * 2
    const n = sample(n1, 5, u, v) * 0.65 + sample(n2, 11, u, v) * 0.35
    const a = Math.max(0, 1 - r * (1.15 - n * 0.55)) ** 1.6 * (0.55 + n * 0.6)
    const k = (y * N + x) * 4
    img.data[k] = img.data[k + 1] = img.data[k + 2] = 255
    img.data[k + 3] = Math.round(Math.min(1, a) * 255)
  }
  g.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export const ClimbMist = (): React.ReactElement => {
  const { camera } = useThree()
  const fx = useMemo(() => {
    const texture = makeTexture()
    const root = new THREE.Group()
    root.name = "pegasus-climb-mist"
    const wisps: Wisp[] = []
    for (let k = 0; k < WISPS; k++) {
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, fog: false, opacity: 0 })
      const sprite = new THREE.Sprite(material)
      sprite.visible = false
      sprite.renderOrder = 4
      material.rotation = k * 2.39996
      root.add(sprite)
      wisps.push({ sprite, life: 0, size: 8, seed: (k * 0.618034) % 1 })
    }
    // the white-out: a veil just in front of the eye (depth-tested off, drawn last)
    const veilMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false })
    const veil = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), veilMat)
    veil.renderOrder = 999
    veil.frustumCulled = false
    veil.visible = false
    return { texture, root, wisps, veil, veilMat, band: [0, 0] as [number, number], bandAge: 99, mist: 0, inside: 0, colour: new THREE.Color() }
  }, [])

  useEffect(() => {
    camera.add(fx.veil)
    return () => {
      camera.remove(fx.veil)
      fx.veil.geometry.dispose()
      fx.veilMat.dispose()
      for (const w of fx.wisps) w.sprite.material.dispose()
      fx.texture.dispose()
    }
  }, [camera, fx])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const r = riderRT[characterRT.active]
    const h = r.phase === "riding" ? (r.horse as HorseState | null) : null
    const f = h?.flight
    const flying = !!f && (f.mode === "air" || f.mode === "takeoff" || f.mode === "landing")
    const earth = spaceRT.realm === "earth" && spaceRT.mode === "local"

    // the deck's height band (over the terrain it floats above), refreshed now and then
    fx.bandAge += dt
    if (fx.bandAge > 1 && cloudFieldRT.formations.length) {
      fx.bandAge = 0
      let lo = Infinity, hi = -Infinity
      for (const fm of cloudFieldRT.formations) for (const p of fm.puffs) {
        lo = Math.min(lo, fm.y + (p.dy - p.sy * 0.5) * fm.scale)
        hi = Math.max(hi, fm.y + (p.dy + p.sy * 0.5) * fm.scale)
      }
      fx.band = [lo, hi]
    }
    const cam = camera.position
    const camY = cam.y - cloudFieldRT.altitude
    const inBand = fx.band[1] > fx.band[0] ? smooth(fx.band[0] - 12, fx.band[0] + 4, camY) * (1 - smooth(fx.band[1] - 4, fx.band[1] + 14, camY)) : 0
    const puff = flying && earth && h ? insideCloudDeck(h.x - originRT.x, h.y, h.z - originRT.z) : false
    // how much cloud there is to fly through: a few tatters on a fine day, a deck in an overcast
    const clouded = 0.2 + 0.8 * smooth(0.12, 0.75, weatherRT.cloud)
    const want = flying && earth ? Math.max(inBand * clouded, puff ? 1 : 0) : 0
    fx.mist += (want - fx.mist) * (1 - Math.exp(-dt * (want > fx.mist ? 3 : 1.4)))
    fx.inside += ((puff ? 1 : 0) - fx.inside) * (1 - Math.exp(-dt * (puff ? 2.5 : 1.8)))
    if (fx.mist < 0.002) fx.mist = 0
    climbMistRT.wet = fx.mist * (h ? smooth(2, 16, Math.hypot(h.speed, f?.vy ?? 0)) : 0)
    climbMistRT.whiteout = fx.inside

    // lit as the cloud around it: sunlit white by day, grey under rain, dim at night
    const light = skyLightLevel(worldRT.timeOfDay, weatherRT.cloud, weatherRT.rain)
    const night = nightBlend(worldRT.timeOfDay)
    const tone = (0.42 + 0.58 * light) * (1 - night * 0.85)
    fx.colour.setRGB(tone * 0.98, tone * 0.99, tone)

    // ---- wisps, still in the world ----------------------------------------------
    fx.root.position.set(0, 0, 0)
    const vx = h && f ? Math.sin(h.heading) * h.speed : 0
    const vz = h && f ? Math.cos(h.heading) * h.speed : 0
    const vy = f?.vy ?? 0
    const vel = Math.hypot(vx, vy, vz)
    for (const w of fx.wisps) {
      const s = w.sprite
      const m = s.material
      if (fx.mist <= 0) { s.visible = false; w.life = 0; continue }
      const dx = s.position.x - cam.x, dy = s.position.y - cam.y, dz = s.position.z - cam.z
      const d = Math.hypot(dx, dy, dz)
      // ahead of her (and above in a climb), within reach: respawn when passed or lost
      if (w.life <= 0 || d > FAR || (vel > 1 && (dx * vx + dy * vy + dz * vz) / vel < -6)) {
        const ux = vel > 1 ? vx / vel : 0, uy = vel > 1 ? vy / vel : 0.3, uz = vel > 1 ? vz / vel : 0
        const ahead = 10 + Math.random() * 22
        s.position.set(
          cam.x + ux * ahead + (Math.random() - 0.5) * 26,
          cam.y + uy * ahead + (Math.random() - 0.5) * 14,
          cam.z + uz * ahead + (Math.random() - 0.5) * 26,
        )
        w.size = 6 + Math.random() * 10
        w.life = 1
        w.seed = Math.random()
        m.rotation = Math.random() * Math.PI * 2
        m.opacity = 0
      }
      w.life = Math.min(1, w.life + dt * 0.8)
      s.scale.setScalar(w.size)
      // never a sprite edge against the lens: thin out very close, and far off
      const near = smooth(NEAR, NEAR + 5, d) * (1 - smooth(FAR - 10, FAR, d))
      const target = fx.mist * near * (0.28 + 0.25 * w.seed) * (1 - fx.inside * 0.4)
      m.opacity += (target - m.opacity) * (1 - Math.exp(-dt * 3))
      m.color.copy(fx.colour)
      s.visible = m.opacity > 0.004
    }

    // ---- the white-out ----------------------------------------------------------
    const cam3 = camera as THREE.PerspectiveCamera
    const dist = 0.4
    const hgt = Math.tan((cam3.fov * Math.PI) / 360) * dist * 2.2
    fx.veil.position.set(0, 0, -dist)
    fx.veil.scale.set(hgt * cam3.aspect, hgt, 1)
    fx.veilMat.color.copy(fx.colour)
    // she is a few metres off: the murk greys her a little, the world beyond a lot (the wisps)
    fx.veilMat.opacity = fx.inside * 0.4
    fx.veil.visible = fx.veilMat.opacity > 0.004
  })

  return <primitive object={fx.root} />
}
