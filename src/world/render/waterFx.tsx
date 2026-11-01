import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { avatarRT } from "../../game/runtime"
import { sfx } from "../../game/audio/audio"
import { originRT } from "../origin"
import { waterSurfaceAt } from "../waterSurface"
import { captureWaterSplash, writeWaterDropPositions, writeWaterRingMatrix, type WaterSplash } from "./waterEffectState"

/**
 * Water contact effects for characters: expanding ripple rings on the surface,
 * a short burst of droplets when a body enters the water, and the rhythmic
 * rings and sounds of wading and swimming. Everything is pooled: one instanced
 * draw for rings and one point draw for droplets. Simulation stays in logical
 * world coordinates; GPU buffers are relative to the floating origin.
 */

/** Water contact of the controlled character, written by its controller. */
export const waterBodyRT = { surface: null as number | null, swim: 0, wade: 0 }

const RINGS = 48
const DROPS = 160

const pending: WaterSplash[] = []

const ripplesPending: Array<{ x: number; y: number; z: number; size: number; life: number }> = []

/**
 * Queue a small ripple ring on the water from another swimmer (a duck's
 * wake). Shares the characters' ring pool; ignored off the water or when
 * the queue is already full, so many swimmers never crowd the pool.
 */
export const emitRipple = (x: number, z: number, size: number, life = 1.4): void => {
  if (ripplesPending.length >= 6) return
  const y = waterSurfaceAt(x, z) ?? homeSurface(x, z)
  if (y === null) return
  ripplesPending.push({ x, y, z, size, life })
}

/** Queue a splash (entry, jump landing, dive) at a point on the surface. */
export const emitSplash = (x: number, z: number, strength = 1): void => {
  if (pending.length >= 8) return
  const splash = captureWaterSplash(x, z, strength, waterSurfaceAt)
  if (splash) pending.push(splash)
}

const ringVertex = /* glsl */ `
attribute float aBirth;
attribute float aSize;
attribute float aLife;
uniform float uTime;
varying vec2 vUv;
varying float vAge;
void main() {
  vUv = uv * 2.0 - 1.0;
  float age = (uTime - aBirth) / aLife;
  vAge = age;
  float grow = mix(0.25, 1.0, 1.0 - pow(1.0 - clamp(age, 0.0, 1.0), 2.2));
  vec3 p = position * aSize * grow;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
}`

const ringFragment = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
varying float vAge;
void main() {
  if (vAge < 0.0 || vAge > 1.0) discard;
  float r = length(vUv);
  // a ripple is a swell catching the light, not a drawn hoop: a soft leading
  // crest with a fainter one inside it, both spreading wider as they age
  // (the ring disperses) while they fade
  float aa = fwidth(r);
  float w = max(mix(0.07, 0.2, clamp(vAge, 0.0, 1.0)), aa);
  float crest = exp(-pow((r - 0.88) / w, 2.0)) + 0.35 * exp(-pow((r - 0.62) / (w * 1.3), 2.0));
  float fade = (1.0 - vAge) * (1.0 - vAge);
  float a = crest * fade * 0.26;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}`

const creaturePending: Array<WaterSplash & { dirX: number; dirZ: number }> = []
const dripsPending: Array<{ x: number; y: number; z: number; ground: number; count: number; spread: number }> = []

/**
 * An animal's entry into (or a burst of play in) the water: drops and rings
 * scaled to its body. `strength` ~0.05 for a rabbit's toe, ~1 for a horse
 * plunging in; (dirX, dirZ) throws the spray the way it was moving. No sound.
 */
export const emitCreatureSplash = (x: number, z: number, strength: number, dirX = 0, dirZ = 0): void => {
  if (creaturePending.length >= 6) return
  const splash = captureWaterSplash(x, z, strength, waterSurfaceAt) ?? captureWaterSplash(x, z, strength, homeSurface)
  if (splash) creaturePending.push({ ...splash, dirX, dirZ })
}

/**
 * Water running off a coat: a few drops falling from (x, y, z) to `ground`.
 * A wet animal on the bank sheds these for a little while; a shake throws
 * a ring of them (`spread`).
 */
export const emitDrips = (x: number, y: number, z: number, ground: number, count = 2, spread = 0.15): void => {
  if (dripsPending.length >= 8) return
  dripsPending.push({ x, y, z, ground, count, spread })
}

let homeSurface: (x: number, z: number) => number | null = () => null
/** creatureWater.ts lends its home pond/creek surface here (no import cycle). */
export const setCreatureSplashSurface = (fn: (x: number, z: number) => number | null): void => { homeSurface = fn }

export const WaterFx = (): React.ReactElement => {
  const root = useMemo(() => { const group = new THREE.Group(); group.name = "water-contact-effects"; return group }, [])
  const rings = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(2, 2)
    geometry.rotateX(-Math.PI / 2)
    const birth = new THREE.InstancedBufferAttribute(new Float32Array(RINGS).fill(-100), 1)
    const size = new THREE.InstancedBufferAttribute(new Float32Array(RINGS).fill(1), 1)
    const life = new THREE.InstancedBufferAttribute(new Float32Array(RINGS).fill(1), 1)
    geometry.setAttribute("aBirth", birth)
    geometry.setAttribute("aSize", size)
    geometry.setAttribute("aLife", life)
    const material = new THREE.ShaderMaterial({
      vertexShader: ringVertex,
      fragmentShader: ringFragment,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color("#f4fbff") } },
      transparent: true,
      depthWrite: false,
    })
    const mesh = new THREE.InstancedMesh(geometry, material, RINGS)
    mesh.frustumCulled = false
    mesh.renderOrder = 2
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    return { mesh, birth, size, life, next: 0, positions: new Float64Array(RINGS * 3) }
  }, [])

  const drops = useMemo(() => {
    const positions = new Float64Array(DROPS * 3).fill(-1e5)
    const rendered = new Float32Array(DROPS * 3).fill(-1e5)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.BufferAttribute(rendered, 3).setUsage(THREE.DynamicDrawUsage))
    const material = new THREE.PointsMaterial({ color: "#eef8ff", size: 0.07, transparent: true, opacity: 0.85, depthWrite: false })
    const points = new THREE.Points(geometry, material)
    points.frustumCulled = false
    points.renderOrder = 2
    const vel = new Float32Array(DROPS * 3)
    const life = new Float32Array(DROPS)
    return { points, positions, rendered, vel, life, next: 0, surface: new Float32Array(DROPS) }
  }, [])

  useEffect(() => () => {
    rings.mesh.geometry.dispose()
    ;(rings.mesh.material as THREE.Material).dispose()
    rings.mesh.dispose()
    drops.points.geometry.dispose()
    ;(drops.points.material as THREE.Material).dispose()
  }, [rings, drops])

  const clock = useMemo(() => ({ t: 0, nextRing: 0, nextStroke: 0, originVersion: -1 }), [])
  const m = useMemo(() => new THREE.Matrix4(), [])

  const ring = (x: number, y: number, z: number, size: number, life: number): void => {
    const i = rings.next
    rings.next = (rings.next + 1) % RINGS
    rings.positions[i * 3] = x
    rings.positions[i * 3 + 1] = y + 0.012
    rings.positions[i * 3 + 2] = z
    writeWaterRingMatrix(m, rings.positions, i, originRT.x, originRT.z)
    rings.mesh.setMatrixAt(i, m)
    rings.birth.setX(i, clock.t)
    rings.size.setX(i, size)
    rings.life.setX(i, life)
    rings.birth.needsUpdate = rings.size.needsUpdate = rings.life.needsUpdate = true
    rings.mesh.instanceMatrix.needsUpdate = true
  }

  const spray = (x: number, y: number, z: number, count: number, power: number): void => {
    for (let k = 0; k < count; k++) {
      const i = drops.next
      drops.next = (drops.next + 1) % DROPS
      const a = Math.random() * Math.PI * 2
      const out = (0.4 + Math.random() * 1.2) * power
      drops.positions[i * 3] = x + Math.cos(a) * 0.2
      drops.positions[i * 3 + 1] = y + 0.05
      drops.positions[i * 3 + 2] = z + Math.sin(a) * 0.2
      drops.vel[i * 3] = Math.cos(a) * out
      drops.vel[i * 3 + 1] = (1.6 + Math.random() * 2.4) * power
      drops.vel[i * 3 + 2] = Math.sin(a) * out
      drops.life[i] = 1.4
      drops.surface[i] = y
    }
  }

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    clock.t += dt
    ;(rings.mesh.material as THREE.ShaderMaterial).uniforms.uTime.value = clock.t

    // Cancel WorldRoot's translation, then update every existing effect when
    // the origin changes so active wakes never jump during a rebase.
    root.position.set(originRT.x, 0, originRT.z)
    const rebased = clock.originVersion !== originRT.version
    if (rebased) {
      clock.originVersion = originRT.version
      for (let i = 0; i < RINGS; i++) {
        writeWaterRingMatrix(m, rings.positions, i, originRT.x, originRT.z)
        rings.mesh.setMatrixAt(i, m)
      }
      rings.mesh.instanceMatrix.needsUpdate = true
    }

    const surface = waterBodyRT.surface
    while (pending.length) {
      const s = pending.pop()!
      spray(s.x, s.y, s.z, Math.round(18 + 34 * s.strength), 0.55 + 0.6 * s.strength)
      ring(s.x, s.y, s.z, 1.2 + s.strength * 1.4, 1.6)
      ring(s.x, s.y, s.z, 0.6 + s.strength * 0.8, 1.1)
      sfx.splash(s.strength)
    }

    while (creaturePending.length) {
      const c = creaturePending.pop()!
      const k = Math.min(1.2, c.strength)
      for (let n = Math.round(3 + 30 * k); n > 0; n--) {
        const i = drops.next
        drops.next = (drops.next + 1) % DROPS
        const a = Math.random() * Math.PI * 2
        const out = (0.25 + Math.random() * 0.9) * (0.4 + k * 0.8)
        drops.positions[i * 3] = c.x + Math.cos(a) * 0.12 * (0.5 + k)
        drops.positions[i * 3 + 1] = c.y + 0.04
        drops.positions[i * 3 + 2] = c.z + Math.sin(a) * 0.12 * (0.5 + k)
        drops.vel[i * 3] = Math.cos(a) * out + c.dirX * 0.6
        drops.vel[i * 3 + 1] = (0.9 + Math.random() * 1.8) * (0.45 + k * 0.75)
        drops.vel[i * 3 + 2] = Math.sin(a) * out + c.dirZ * 0.6
        drops.life[i] = 1.2
        drops.surface[i] = c.y
      }
      ring(c.x, c.y, c.z, 0.35 + k * 1.6, 1.2 + k * 0.6)
      if (k > 0.25) ring(c.x, c.y, c.z, 0.2 + k * 0.9, 0.9)
    }
    while (dripsPending.length) {
      const d = dripsPending.pop()!
      for (let n = 0; n < d.count; n++) {
        const i = drops.next
        drops.next = (drops.next + 1) % DROPS
        const a = Math.random() * Math.PI * 2
        const r = Math.random() * d.spread
        drops.positions[i * 3] = d.x + Math.cos(a) * r
        drops.positions[i * 3 + 1] = d.y
        drops.positions[i * 3 + 2] = d.z + Math.sin(a) * r
        // a shake flings drops outward; a drip just falls
        const fling = d.spread > 0.3 ? 1.6 : 0.05
        drops.vel[i * 3] = Math.cos(a) * fling
        drops.vel[i * 3 + 1] = d.spread > 0.3 ? 0.6 + Math.random() * 0.8 : -0.2
        drops.vel[i * 3 + 2] = Math.sin(a) * fling
        drops.life[i] = 1.1
        drops.surface[i] = d.ground
      }
    }

    while (ripplesPending.length) {
      const r = ripplesPending.pop()!
      ring(r.x, r.y, r.z, r.size, r.life)
    }

    // a body in the water keeps making rings: a wake while moving, slow
    // treading rings while floating still
    if (surface !== null && (waterBodyRT.wade > 0.12 || waterBodyRT.swim > 0.5)) {
      const speed = avatarRT().speed
      const swimming = waterBodyRT.swim > 0.5
      clock.nextRing -= dt
      if (clock.nextRing <= 0) {
        const moving = speed > 0.25
        clock.nextRing = moving ? Math.max(0.16, 0.42 - speed * 0.05) : swimming ? 1.1 : 1.8
        const back = moving ? 0.25 : 0
        const fx = Math.sin(avatarRT().facing)
        const fz = Math.cos(avatarRT().facing)
        ring(avatarRT().pos.x - fx * back, surface, avatarRT().pos.z - fz * back, swimming ? 1.1 + speed * 0.25 : 0.55 + speed * 0.1, moving ? 1.3 : 2.2)
      }
      clock.nextStroke -= dt
      if (speed > 0.3 && clock.nextStroke <= 0) {
        clock.nextStroke = swimming ? 1.05 / Math.max(0.7, speed) : Math.max(0.28, 0.9 / speed)
        sfx.stroke(swimming ? 0.8 : 0.35 + waterBodyRT.wade * 0.4)
        // running through shallows kicks up spray
        if (!swimming && speed > 3 && waterBodyRT.wade > 0.08 && waterBodyRT.wade < 0.7) spray(avatarRT().pos.x, surface, avatarRT().pos.z, 5, 0.35)
      }
    }

    // droplets: ballistic, vanish when they fall back through the surface
    let live = false
    for (let i = 0; i < DROPS; i++) {
      if (drops.life[i] <= 0) continue
      live = true
      drops.life[i] -= dt
      drops.vel[i * 3 + 1] -= 9.8 * dt
      drops.positions[i * 3] += drops.vel[i * 3] * dt
      drops.positions[i * 3 + 1] += drops.vel[i * 3 + 1] * dt
      drops.positions[i * 3 + 2] += drops.vel[i * 3 + 2] * dt
      if (drops.positions[i * 3 + 1] < drops.surface[i] || drops.life[i] <= 0) {
        drops.life[i] = 0
        drops.positions[i * 3 + 1] = -1e5
      }
    }
    if (live || rebased) {
      writeWaterDropPositions(drops.positions, drops.rendered, originRT.x, originRT.z)
      drops.points.geometry.attributes.position.needsUpdate = true
    }
  })

  return (
    <primitive object={root}>
      <primitive object={rings.mesh} />
      <primitive object={drops.points} />
    </primitive>
  )
}
