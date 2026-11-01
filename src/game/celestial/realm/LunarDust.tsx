import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { characterRT, companionRT, playerRT } from "../../runtime"
import { groundHeight } from "../../world-layout"
import { PLAYER_GRAVITY } from "../../characters/playerMotion"
import { inRealm, realmGround } from "../../../world/realmHook"
import { riderRT } from "../../horses/riding"
import type { HorseState } from "../../horses/horseState"
import { spaceRT } from "../spaceState"
import { sailRT } from "../starSail"

/**
 * Regolith kicked up on the Moon. With no air there is no drag and no
 * drifting cloud: every grain flies a clean parabola under the Moon's
 * gravity and stops dead where it lands, so a footstep throws a crisp little
 * fan of dust that falls back at once, and Starborn's descent blows a flat,
 * fast sheet out sideways from under her (as the Apollo landers' exhaust did).
 */

const N = 1600
const SPRITE = (() => {
  if (typeof document === "undefined") return null
  const c = document.createElement("canvas")
  c.width = c.height = 32
  const g = c.getContext("2d")!
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16)
  grad.addColorStop(0, "rgba(255,255,255,1)")
  grad.addColorStop(0.6, "rgba(255,255,255,0.55)")
  grad.addColorStop(1, "rgba(255,255,255,0)")
  g.fillStyle = grad
  g.fillRect(0, 0, 32, 32)
  return new THREE.CanvasTexture(c)
})()

const VERT = /* glsl */ `
attribute float aAlpha;
attribute float aSize;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * (520.0 / max(0.5, -mv.z));
}
`
const FRAG = /* glsl */ `
uniform sampler2D uSprite;
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float a = texture2D(uSprite, gl_PointCoord).a * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}
`

type Emitter = { last: THREE.Vector3; travelled: number; wasAir: boolean }

export const LunarDust = (): React.ReactElement => {
  const sys = useMemo(() => {
    const pos = new Float32Array(N * 3)
    const vel = new Float32Array(N * 3)
    const alpha = new Float32Array(N)
    const size = new Float32Array(N)
    const life = new Float32Array(N)
    const settled = new Uint8Array(N)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage))
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage))
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1))
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      uniforms: { uSprite: { value: SPRITE }, uColor: { value: new THREE.Color("#a8a196") } },
    })
    const points = new THREE.Points(geo, mat)
    points.frustumCulled = false
    points.name = "lunar-dust"
    const origin = new THREE.Vector2(NaN, NaN)
    return {
      points, pos, vel, alpha, size, life, settled, geo, mat, origin, next: 0,
      emitters: new Map<string, Emitter>(),
    }
  }, [])

  useEffect(() => () => { sys.geo.dispose(); sys.mat.dispose() }, [sys])

  const emit = (x: number, y: number, z: number, vx: number, vy: number, vz: number, s: number): void => {
    const i = sys.next
    sys.next = (sys.next + 1) % N
    sys.pos[i * 3] = x - sys.origin.x
    sys.pos[i * 3 + 1] = y
    sys.pos[i * 3 + 2] = z - sys.origin.y
    sys.vel[i * 3] = vx
    sys.vel[i * 3 + 1] = vy
    sys.vel[i * 3 + 2] = vz
    sys.life[i] = 0
    sys.settled[i] = 0
    sys.alpha[i] = 0.75
    sys.size[i] = s
  }

  /** A fan of grains from a foot or a hoof, thrown back and up from the direction of travel. */
  const kick = (x: number, z: number, fx: number, fz: number, count: number, power: number): void => {
    const y = groundHeight(x, z) + 0.03
    for (let k = 0; k < count; k++) {
      const a = (Math.random() - 0.5) * 1.6
      const sp = power * (0.4 + Math.random() * 0.8)
      const bx = -fx * Math.cos(a) + fz * Math.sin(a), bz = -fz * Math.cos(a) - fx * Math.sin(a)
      emit(x, y, z, bx * sp, power * (0.5 + Math.random() * 0.9), bz * sp, 0.018 + Math.random() * 0.03)
    }
  }

  /** A ring of grains blown flat and fast from under a descending (or rising) Starborn. */
  const blast = (x: number, z: number, strength: number, count: number): void => {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2
      const r = 0.6 + Math.random() * 1.6
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r
      const sp = (3 + Math.random() * 7) * strength
      emit(px, groundHeight(px, pz) + 0.04, pz, Math.cos(a) * sp, 0.15 + Math.random() * 0.7 * strength, Math.sin(a) * sp, 0.02 + Math.random() * 0.035)
    }
  }

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const on = spaceRT.realm === "moon" && spaceRT.mode === "local"
    sys.points.visible = on
    if (!on) {
      if (sys.emitters.size) {
        sys.emitters.clear()
        sys.alpha.fill(0)
        ;(sys.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true
      }
      return
    }
    const active = characterRT.active === "explorer" ? playerRT : companionRT
    // keep the buffer near the riders (float32), shifting it when they move far
    const ox = Math.round(active.pos.x / 256) * 256, oz = Math.round(active.pos.z / 256) * 256
    if (ox !== sys.origin.x || oz !== sys.origin.y) {
      if (Number.isFinite(sys.origin.x)) for (let i = 0; i < N; i++) { sys.pos[i * 3] += sys.origin.x - ox; sys.pos[i * 3 + 2] += sys.origin.y - oz }
      sys.origin.set(ox, oz)
      sys.points.position.set(ox, 0, oz)
    }
    const g = PLAYER_GRAVITY * realmGround.gravityScale

    // ---- feet: a little fan every stride, a burst on landing from a bound
    for (const [id, body] of [["explorer", playerRT], ["companion", companionRT]] as const) {
      if (!inRealm(body.pos.x, body.pos.z) || riderRT[id].phase !== "none") { sys.emitters.delete(id); continue }
      let e = sys.emitters.get(id)
      if (!e) { e = { last: body.pos.clone(), travelled: 0, wasAir: false }; sys.emitters.set(id, e) }
      const ground = groundHeight(body.pos.x, body.pos.z)
      const air = body.pos.y - ground > 0.08
      const step = Math.hypot(body.pos.x - e.last.x, body.pos.z - e.last.z)
      if (!air) e.travelled += step
      const fx = step > 1e-4 ? (body.pos.x - e.last.x) / step : Math.sin(body.facing)
      const fz = step > 1e-4 ? (body.pos.z - e.last.z) / step : Math.cos(body.facing)
      if (e.wasAir && !air) kick(body.pos.x, body.pos.z, fx, fz, 26, 1.4)
      else if (e.travelled > 0.75) {
        e.travelled = 0
        kick(body.pos.x, body.pos.z, fx, fz, 7, 0.9 + Math.min(1, body.speed / 3))
      }
      e.wasAir = air
      e.last.copy(body.pos)
    }

    // ---- Starborn: hooves on the dust, and the sheet blown from under her
    const r = riderRT[characterRT.active]
    const h = r.horse as HorseState | null
    if (h?.flight && inRealm(h.x, h.z)) {
      const f = h.flight
      const ground = groundHeight(h.x, h.z)
      const agl = h.y - ground
      if (f.mode === "ground") {
        let e = sys.emitters.get("mount")
        if (!e) { e = { last: new THREE.Vector3(h.x, h.y, h.z), travelled: 0, wasAir: false }; sys.emitters.set("mount", e) }
        const step = Math.hypot(h.x - e.last.x, h.z - e.last.z)
        e.travelled += step
        if (e.wasAir) blast(h.x, h.z, 0.6, 90)
        else if (e.travelled > 0.6) {
          e.travelled = 0
          const fx = Math.sin(h.heading), fz = Math.cos(h.heading)
          kick(h.x + fx * 0.6, h.z + fz * 0.6, fx, fz, 6, 1 + h.speed * 0.3)
          kick(h.x - fx * 0.7, h.z - fz * 0.7, fx, fz, 6, 1 + h.speed * 0.3)
        }
        e.wasAir = false
        e.last.set(h.x, h.y, h.z)
      } else {
        const e = sys.emitters.get("mount")
        if (e) e.wasAir = true
        if ((sailRT.descending || f.rise > 0) && agl < 14) {
          const strength = 1 - agl / 14
          blast(h.x, h.z, 0.4 + strength, Math.ceil(strength * 140 * dt * 10))
        }
      }
    }

    // ---- integrate: no drag, only gravity; a grain that lands stays
    for (let i = 0; i < N; i++) {
      if (sys.alpha[i] <= 0) continue
      sys.life[i] += dt
      if (!sys.settled[i]) {
        const j = i * 3
        sys.vel[j + 1] -= g * dt
        sys.pos[j] += sys.vel[j] * dt
        sys.pos[j + 1] += sys.vel[j + 1] * dt
        sys.pos[j + 2] += sys.vel[j + 2] * dt
        const floor = groundHeight(sys.pos[j] + sys.origin.x, sys.pos[j + 2] + sys.origin.y) + 0.01
        if (sys.pos[j + 1] < floor) {
          sys.pos[j + 1] = floor
          sys.settled[i] = 1
          sys.life[i] = 0
        }
      } else {
        // landed grains are part of the ground again: they fade as they become it
        sys.alpha[i] = Math.max(0, 0.75 - sys.life[i] * 1.5)
      }
    }
    ;(sys.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true
    ;(sys.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true
    ;(sys.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true
  })

  return <primitive object={sys.points} />
}
