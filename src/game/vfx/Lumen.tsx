import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import { qualityRT } from "../../state/qualityStore"
import { attachLumenGeometry, flushLumen, lumenBudget, makeLumenGeometry, makeLumenMaterial, vfxClock } from "./lumenCore"
import { attachPetalGeometry, flushPetals, makePetalGeometry, makePetalMaterial } from "./petals"
import * as THREE from "three"
import { registerDevTool } from "../../dev/devTools"
import { avatarRT, worldRT } from "../runtime"
import { originRT } from "../../world/origin"
import { weatherRT } from "../weather/weatherState"
import { homeGroundHidden } from "../celestial/spaceState"
import { nightBlend, sunDirection } from "../environment/celestialLighting"
import { emit, rand, Shape } from "./lumenCore"
import { waterSurfaceAt } from "../../world/waterSurface"
import { worldStreamRT } from "../../world/worldRuntime"
import { CHUNK_SIZE } from "../../world/worldConfig"
import { K, SCATTER_STRIDE } from "../../world/chunkGen"
import { windVelocity } from "../../world/wind"
import { waterBodyRT } from "../../world/render/waterFx"
import { emitPetal, PetalKind } from "./petals"
import * as fx from "./signatures"
import { stepSwimAura } from "./swimAura"

/** ?debug: __worldDev.vfx("hug") fires a moment's effect 2.5 m in front of the active character */
const QA_EFFECTS: Record<string, (at: THREE.Vector3, ground: number) => void> = {
  burst: (at) => fx.celebrate(at),
  hug: (at, g) => fx.hugBloom(at, g),
  five: (at, g) => fx.highFiveClap(at, g),
  dance: (at, g) => fx.danceBeat(at, g),
  fireflies: (at) => fx.fireflyCupped(at),
  bouquet: (at) => fx.bouquetGathered(at),
  confetti: (at) => fx.confettiCelebration(at, true),
  discovery: (at, g) => fx.discoveryPillar(at, g),
  pet: (at) => fx.affectionDrift(at),
  star: (at) => fx.starLift(at),
  finale: (at, g) => fx.gardenBloom(at, g),
  skip: (at, g) => fx.skipCrown(at.x, g, at.z, 1.3),
  lantern: (at) => fx.lanternEmbers(at),
}

/**
 * Draws every Lumen particle and petal in the world (two draw calls). Its
 * clock ticks first each frame, so anything born this frame starts at age 0.
 */
const _cam = new THREE.Vector3()
const _sun = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _tint = new THREE.Color()
const POLLEN_DAY = new THREE.Color("#fff3d6")
const POLLEN_GOLD = new THREE.Color("#ffc878")

/**
 * The air itself: pollen and dust drifting in the sunlight round the view,
 * the way a meadow's air glitters when you look toward the sun (they scatter
 * light forward, so they shine against it and all but vanish with it behind
 * you). Warmer in the evening light, none in rain, at night (the fireflies
 * have it), in space or on the lightest preset.
 */
const sunlitAir = { carry: 0 }
const stepSunlitAir = (camera: THREE.Camera, dt: number): void => {
  if (homeGroundHidden() || qualityRT.level === "low") return
  const night = nightBlend(worldRT.timeOfDay)
  const clear = (1 - Math.min(1, weatherRT.rain * 3)) * (1 - weatherRT.cloud * 0.6)
  const level = (1 - night) * clear
  if (level < 0.05) return
  camera.getWorldPosition(_cam)
  _cam.x += originRT.x
  _cam.z += originRT.z
  camera.getWorldDirection(_fwd)
  sunDirection(worldRT.timeOfDay, _sun).normalize()
  // golden hour: low sun, warm light
  const evening = THREE.MathUtils.smoothstep(worldRT.timeOfDay, 0.45, 0.75)
  _tint.copy(POLLEN_DAY).lerp(POLLEN_GOLD, evening)
  sunlitAir.carry += dt * 34 * level * qualityRT.profile.particles
  while (sunlitAir.carry > 1) {
    sunlitAir.carry -= 1
    // somewhere in the view, 2 to 16 m out
    const d = rand(2, 16)
    _dir.copy(_fwd).multiplyScalar(d)
    _dir.x += rand(-1, 1) * d * 0.7
    _dir.y += rand(-0.35, 0.6) * d * 0.5
    _dir.z += rand(-1, 1) * d * 0.7
    const x = _cam.x + _dir.x, y = _cam.y + _dir.y, z = _cam.z + _dir.z
    const toward = Math.max(0, _dir.normalize().dot(_sun))
    const glow = 0.18 + 2.4 * toward * toward * toward
    const w = weatherRT.wind + weatherRT.gust
    emit({ x, y, z, vx: rand(-0.12, 0.12) + w * 0.25, vy: rand(-0.04, 0.08), vz: rand(-0.12, 0.12) + w * 0.12,
      life: rand(5, 9), color: _tint, intensity: glow * (0.6 + 0.4 * level), size: rand(0.014, 0.03), drag: 0.6, gravity: 0.004, shape: Shape.Mote, curl: 0.12 })
  }
}

const GLITTER = new THREE.Color("#fff8e8")
const GLITTER_GOLD = new THREE.Color("#ffd9a0")
const _ray = new THREE.Vector3()
/**
 * Sun glitter on open water: wherever a ripple could tip the sun's mirror
 * image straight into the eye (the view ray reflected off the water lands
 * close to the sun) a facet flashes for a moment. Together they draw the
 * glittering path toward a low sun that real lakes and rivers have.
 */
const glitter = { carry: 0, emitted: 0, sunUp: 0, water: 0, view: 0 }
const stepWaterGlitter = (camera: THREE.Camera, dt: number): void => {
  if (homeGroundHidden() || qualityRT.level === "low") return
  const night = nightBlend(worldRT.timeOfDay)
  const sunUp = (1 - night) * (1 - weatherRT.cloud * 0.8) * (1 - Math.min(1, weatherRT.rain * 2))
  glitter.sunUp = sunUp
  if (sunUp < 0.08) return
  camera.getWorldPosition(_cam)
  _cam.x += originRT.x
  _cam.z += originRT.z
  camera.getWorldDirection(_fwd)
  sunDirection(worldRT.timeOfDay, _sun).normalize()
  if (_sun.y < 0.02) return
  const evening = THREE.MathUtils.smoothstep(worldRT.timeOfDay, 0.45, 0.75)
  // candidates are drawn where the glitter can be: round the sun's mirror
  // point, spread by how far ripples tilt a facet (a reflection turns by
  // twice the tilt, so the glitter reaches far out toward a low sun)
  const sunAz = Math.atan2(_sun.x, _sun.z)
  const sunEl = Math.asin(Math.min(1, _sun.y))
  glitter.carry += dt * 240 * qualityRT.profile.particles
  let tries = 0
  while (glitter.carry > 1 && tries++ < 200) {
    glitter.carry -= 1
    const da = rand(-0.5, 0.5), de = rand(-0.8, 0.3)
    const el = sunEl + de
    if (el < 0.012 || el > 1.3) continue
    const az = sunAz + da
    const ground = waterSurfaceAt(_cam.x + Math.sin(az) * 8, _cam.z + Math.cos(az) * 8)
    const h = _cam.y - (ground ?? _cam.y - 2)
    if (h < 0.3) continue
    const d = Math.min(240, h / Math.tan(el))
    const x = _cam.x + Math.sin(az) * d, z = _cam.z + Math.cos(az) * d
    const w = waterSurfaceAt(x, z)
    if (w === null || _cam.y < w) continue
    glitter.water++
    // only what is in view, and rarer away from the exact mirror point
    _ray.set(x - _cam.x, w - _cam.y, z - _cam.z).normalize()
    if (_ray.dot(_fwd) < 0.45) continue
    glitter.view++
    const off = (da * da) / (0.5 * 0.5) + (de * de) / (0.8 * 0.8)
    if (Math.random() > Math.exp(-off * 1.6)) continue
    glitter.emitted++
    emit({ x, y: w + 0.03, z, life: rand(0.1, 0.28), color: evening > 0.5 ? GLITTER_GOLD : GLITTER, intensity: rand(2.5, 5.5) * sunUp,
      size: 0.06 + d * 0.0075, drag: 1, shape: Shape.Glint, spin: rand(-1, 1) })
  }
  glitter.carry = Math.min(glitter.carry, 4)
}

/**
 * The trees let go: blossom drifts down from the gulmohar and leaves turn
 * down from the maples round the view, on the wind. The trees are read from
 * the streamed chunks (re-gathered once a second); each falls as a real lit
 * petal or leaf, never a sprite.
 */
const canopy = { trees: [] as { x: number; y: number; z: number; s: number; kind: number }[], gather: 0, carry: 0, wind: { x: 0, z: 0 } }
const GULMOHAR_TINTS = ["#ffe3c2", "#ffb37a", "#ff6a33", "#f4502a"].map((h) => new THREE.Color(h))
const MAPLE_TINTS = ["#e8552a", "#f08a2c", "#c8371f", "#f2b33d"].map((h) => new THREE.Color(h))
const stepCanopy = (camera: THREE.Camera, dt: number): void => {
  if (homeGroundHidden() || qualityRT.level === "low") return
  camera.getWorldPosition(_cam)
  _cam.x += originRT.x
  _cam.z += originRT.z
  canopy.gather -= dt
  const streamer = worldStreamRT.streamer
  if (canopy.gather <= 0 && streamer) {
    canopy.gather = 1
    canopy.trees.length = 0
    const ccx = Math.floor(_cam.x / CHUNK_SIZE), ccz = Math.floor(_cam.z / CHUNK_SIZE)
    for (const chunk of streamer.chunks.values()) {
      if (!chunk.payload || Math.abs(chunk.cx - ccx) > 1 || Math.abs(chunk.cz - ccz) > 1) continue
      const sc = chunk.payload.scatter
      for (let i = 0; i < chunk.payload.scatterCount; i++) {
        const o = i * SCATTER_STRIDE
        const kind = sc[o + 5]
        if (kind !== K.gulmohar && kind !== K.maple) continue
        const x = chunk.cx * CHUNK_SIZE + sc[o], z = chunk.cz * CHUNK_SIZE + sc[o + 2]
        if (Math.hypot(x - _cam.x, z - _cam.z) > 55) continue
        canopy.trees.push({ x, y: sc[o + 1], z, s: sc[o + 3], kind })
      }
    }
  }
  if (!canopy.trees.length) return
  windVelocity(canopy.wind)
  const storm = Math.min(1, weatherRT.rain * 2)
  canopy.carry += dt * Math.min(40, canopy.trees.length * 2.2) * qualityRT.profile.particles * (1 + storm)
  while (canopy.carry > 1) {
    canopy.carry -= 1
    const t = canopy.trees[Math.floor(Math.random() * canopy.trees.length)]
    const gulmohar = t.kind === K.gulmohar
    const r = rand(0.4, 2.4) * t.s
    const a = rand(0, Math.PI * 2)
    const tints = gulmohar ? GULMOHAR_TINTS : MAPLE_TINTS
    emitPetal({
      x: t.x + Math.cos(a) * r, y: t.y + t.s * rand(2.6, 4.6), z: t.z + Math.sin(a) * r,
      vx: canopy.wind.x * 0.6 + rand(-0.2, 0.2), vy: rand(-0.3, 0), vz: canopy.wind.z * 0.6 + rand(-0.2, 0.2),
      life: rand(5, 8), color: tints[Math.floor(Math.random() * tints.length)], kind: gulmohar ? PetalKind.Blossom : PetalKind.Leaf,
      size: gulmohar ? rand(0.05, 0.075) : rand(0.08, 0.12), drag: gulmohar ? 2.6 : 2, gravity: gulmohar ? 0.7 : 1.1, spin: rand(1.5, 4), flutter: gulmohar ? rand(0.35, 0.7) : rand(0.25, 0.5),
    })
  }
}

/** Swimming: droplets thrown off her arms with each stroke, catching the light. */
const swim = { carry: 0 }
const DROPLET = new THREE.Color("#e8f6ff")
const stepSwimSpray = (dt: number): void => {
  const b = avatarRT()
  if (waterBodyRT.swim < 0.5 || waterBodyRT.surface === null || b.speed < 0.4) return
  swim.carry += dt * 26 * Math.min(1.5, b.speed / 1.6)
  const fx = Math.sin(b.facing), fz = Math.cos(b.facing)
  while (swim.carry > 1) {
    swim.carry -= 1
    const side = Math.random() < 0.5 ? -1 : 1
    const x = b.pos.x + fx * 0.45 + fz * side * 0.32, z = b.pos.z + fz * 0.45 - fx * side * 0.32
    emit({ x, y: waterBodyRT.surface + 0.12, z, vx: fz * side * rand(0.3, 0.9) - fx * rand(0, 0.6), vy: rand(1, 2.2), vz: -fx * side * rand(0.3, 0.9) - fz * rand(0, 0.6),
      life: rand(0.35, 0.6), color: DROPLET, intensity: 1.3, size: 0.014, drag: 0.6, gravity: 9.8, shape: Shape.Streak, stretch: 0.035 })
  }
}

export const Lumen = (): React.ReactElement => {
  const geometry = useMemo(() => makeLumenGeometry(), [])
  const material = useMemo(() => makeLumenMaterial(), [])
  const petalGeometry = useMemo(() => makePetalGeometry(), [])
  const petalMaterial = useMemo(() => makePetalMaterial(), [])
  useEffect(() => {
    // ?debug: where the sun is (unit vector toward it), to aim captures into the glitter
    registerDevTool("glitter", () => ({ ...glitter }))
    registerDevTool("waterAt", (x: number, z: number) => waterSurfaceAt(x, z))
    registerDevTool("sun", () => sunDirection(worldRT.timeOfDay, new THREE.Vector3()).normalize().toArray().map((v) => +v.toFixed(3)))
    registerDevTool("vfx", (name: string) => {
      const b = avatarRT()
      const at = new THREE.Vector3(b.pos.x + Math.sin(b.facing) * 2.5, b.pos.y + 1.3, b.pos.z + Math.cos(b.facing) * 2.5)
      const effect = QA_EFFECTS[name]
      if (!effect) return Object.keys(QA_EFFECTS)
      effect(at, b.pos.y)
      return name
    })
  }, [])
  useEffect(() => {
    const releaseLight = attachLumenGeometry(geometry)
    const releasePetals = attachPetalGeometry(petalGeometry)
    return () => {
      releaseLight()
      releasePetals()
    }
  }, [geometry, petalGeometry])
  useEffect(() => () => {
    material.dispose()
    petalMaterial.dispose()
  }, [material, petalMaterial])

  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(Math.max(rawDt, 0), 0.1)
    vfxClock.t += dt
    lumenBudget.scale = qualityRT.profile.particles
    stepSunlitAir(camera, dt)
    stepWaterGlitter(camera, dt)
    stepCanopy(camera, dt)
    stepSwimSpray(dt)
    stepSwimAura(dt)
  }, -110)
  useFrame(() => {
    // after the systems that emit (all earlier priorities), before drawing
    material.uniforms.uTime.value = vfxClock.t
    ;(petalMaterial.userData.time as { value: number }).value = vfxClock.t
    flushLumen()
    flushPetals()
  }, -1)

  return (
    <>
      <mesh name="lumen-light" geometry={geometry} material={material} frustumCulled={false} renderOrder={9} />
      <mesh name="lumen-petals" geometry={petalGeometry} material={petalMaterial} frustumCulled={false} />
    </>
  )
}
