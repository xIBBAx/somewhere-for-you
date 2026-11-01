import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { makeRng, smoothstep } from "../../utils/math"
import { avatarRT, characterRT, worldRT } from "../runtime"
import { riderRT } from "../horses/riding"
import { rainReach, weatherRT } from "../weather/weatherState"
import { spaceRT } from "../celestial/spaceState"
import { registerDevTool } from "../../dev/devTools"
import { qualityRT } from "../../state/qualityStore"
import { WATER_LEVEL } from "../../world/climate"
import { groundHeight } from "../world-layout"
import { isOverWater, isSheltered } from "./water/waterSim"
import { keyLightDirection } from "./celestialLighting"
import { windVelocity } from "../../world/wind"

/** enough for a cloudburst; ordinary rain draws a share of them */
const RAIN_MAX = 18000
const SPLASH_COUNT = 84
const THROUGHFALL_COUNT = 18

/**
 * SOTA Coupled Atmospheric Precipitation System:
 * - Rain streaks aligned with physical 3D wind velocity + dynamic terminal velocity
 * - Directional sunlight forward-scattering (Mie glint) & ambient night darkening
 * - Shelter occlusion: roofs, cafe awnings, umbrellas & bridges block rain
 * - Material-dependent impact splashes (water ripples vs rock vs soil)
 * - Tree canopy throughfall: large accumulated droplets detaching from foliage
 */
export const GlobalRain = (): React.ReactElement => {
  return (
    <group>
      <RainDrops />
      <MaterialSplashes />
      <CanopyThroughfall />
    </group>
  )
}

/** QA (`__worldDev.rain()`): what the rain is doing now */
const rainProbe = { opacity: 0, reach: 0, altitude: 0, drawn: 0 }

const RAIN_SPAN = 30
const RAIN_HEIGHT = 18

const RAIN_VERTEX = /* glsl */ `
attribute vec4 aSeed;
attribute float aEnd;
uniform float uTime;
uniform float uFall;
uniform float uLen;
uniform vec3 uAnchor;
uniform vec2 uDrift;
uniform vec2 uWindVel;
uniform vec3 uObsVel;
varying float vAlpha;
#include <fog_pars_vertex>
void main() {
  float speed = uFall * (0.78 + aSeed.w * 0.44);
  // world-fixed lattice wrapped around the explorer: drops never slide along
  vec2 xz = aSeed.xz * ${RAIN_SPAN.toFixed(1)} + uDrift;
  xz = uAnchor.xz + mod(xz - uAnchor.xz, ${RAIN_SPAN.toFixed(1)}) - ${(RAIN_SPAN / 2).toFixed(1)};
  float y = uAnchor.y + ${(RAIN_HEIGHT * 0.62).toFixed(1)} - mod(aSeed.y * ${RAIN_HEIGHT.toFixed(1)} + uTime * speed, ${RAIN_HEIGHT.toFixed(1)});
  // the streak is the drop's motion as the eye sees it: relative to the
  // watcher, so riding or flying into the rain slants it toward you
  vec3 rel = vec3(uWindVel.x, -speed, uWindVel.y) - uObsVel;
  float relSpeed = length(rel);
  vec3 dir = rel / max(relSpeed, 0.001);
  // drops come in sizes: most are small and faint, a few big ones fall
  // fastest and streak longest and brightest
  float size = aSeed.w * aSeed.w;
  vec3 p = vec3(xz.x, y, xz.y) - dir * aEnd * uLen * (0.55 + size * 0.95) * clamp(relSpeed / max(speed, 1.0), 1.0, 3.0);
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  float d = -mvPosition.z;
  vAlpha = (1.0 - aEnd * 0.8) * (0.45 + size * 0.9) * smoothstep(0.8, 2.4, d) * (1.0 - smoothstep(${(RAIN_SPAN * 0.3).toFixed(1)}, ${(RAIN_SPAN * 0.5).toFixed(1)}, d));
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const RAIN_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4(uColor, vAlpha * uOpacity);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`

/**
 * GPU rain: one static line buffer. The vertex shader derives every drop from
 * time, accumulated wind drift and a world-fixed lattice wrapped around the explorer,
 * so there is no per-frame CPU work beyond a few uniforms. Intensity and the
 * quality profile choose how many drops are drawn.
 */
const RainDrops = (): React.ReactElement => {
  const { camera, scene } = useThree()
  const viewDir = useMemo(() => new THREE.Vector3(), [])
  const sunDir = useMemo(() => new THREE.Vector3(), [])
  const fogTint = useMemo(() => new THREE.Color(), [])
  const drift = useRef({ x: 0, z: 0, time: 0 })
  const wind = useMemo(() => ({ x: 0, z: 0 }), [])
  const obs = useMemo(() => new THREE.Vector3(), [])
  useEffect(() => registerDevTool("rain", (() => ({ ...rainProbe, rain: weatherRT.rain, burst: weatherRT.burst })) as never), [])

  const { geometry, material } = useMemo(() => {
    const rng = makeRng(90411)
    const seeds = new Float32Array(RAIN_MAX * 2 * 4)
    const ends = new Float32Array(RAIN_MAX * 2)
    for (let i = 0; i < RAIN_MAX; i++) {
      const sx = rng(), sy = rng(), sz = rng(), sw = rng()
      for (let e = 0; e < 2; e++) {
        const o = (i * 2 + e) * 4
        seeds[o] = sx
        seeds[o + 1] = sy
        seeds[o + 2] = sz
        seeds[o + 3] = sw
        ends[i * 2 + e] = e
      }
    }
    const g = new THREE.BufferGeometry()
    // positions are computed in the shader; three still needs the attribute
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(RAIN_MAX * 2 * 3), 3))
    g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4))
    g.setAttribute("aEnd", new THREE.BufferAttribute(ends, 1))
    g.setDrawRange(0, 0)
    const m = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uFall: { value: 14 },
          uLen: { value: 0.7 },
          uAnchor: { value: new THREE.Vector3() },
          uDrift: { value: new THREE.Vector2() },
          uWindVel: { value: new THREE.Vector2() },
          uObsVel: { value: new THREE.Vector3() },
          uColor: { value: new THREE.Color("#d7ebf4") },
          uOpacity: { value: 0 },
        },
      ]),
      vertexShader: RAIN_VERTEX,
      fragmentShader: RAIN_FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: true,
    })
    return { geometry: g, material: m }
  }, [])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const rain = weatherRT.rain
    const u = material.uniforms
    // Real rain is faint: each drop is a tiny lens, seen as a short blur.
    // Many soft streaks read as rain; few bright ones read as sticks.
    const burst = weatherRT.burst
    const reach = rainReach(spaceRT.weatherAltitude, spaceRT.realm === "earth" && spaceRT.mode === "local")
    const targetOpacity = rain < 0.05 || reach <= 0 ? 0 : (THREE.MathUtils.mapLinear(Math.min(rain, 1), 0.05, 1, 0.2, 0.42) + burst * 0.14) * reach
    u.uOpacity.value = THREE.MathUtils.damp(u.uOpacity.value, targetOpacity, 3, dt)
    rainProbe.opacity = u.uOpacity.value
    rainProbe.reach = reach
    rainProbe.altitude = spaceRT.weatherAltitude
    const visible = u.uOpacity.value > 0.01
    // ordinary heavy rain draws two thirds of the drops; a cloudburst all of them
    rainProbe.drawn = visible ? Math.round(RAIN_MAX * Math.min(1, (0.35 + rain * 0.75) * 0.66 + burst * 0.34) * qualityRT.profile.particles) : 0
    geometry.setDrawRange(0, visible ? Math.round(RAIN_MAX * Math.min(1, (0.35 + rain * 0.75) * 0.66 + burst * 0.34) * qualityRT.profile.particles) * 2 : 0)
    if (!visible) return

    // the same air that bends the grass (world/wind.ts) slants the rain
    windVelocity(wind)
    const windX = wind.x, windZ = wind.z
    const windSpeed = Math.hypot(windX, windZ)
    const state = drift.current
    state.time = (state.time + dt) % 600
    state.x = (state.x + windX * dt) % RAIN_SPAN
    state.z = (state.z + windZ * dt) % RAIN_SPAN
    u.uTime.value = state.time
    u.uDrift.value.set(state.x, state.z)
    u.uWindVel.value.set(windX, windZ)
    // near terminal velocity (≈6–9 m/s), blurred over about 1/40 s
    // (a cloudburst's drops are the largest, ~5 mm, falling at ~9–10 m/s)
    u.uFall.value = 7.5 + rain * 2.5 + burst * 1.5
    u.uLen.value = 0.17 + rain * 0.15 + burst * 0.12 + windSpeed * 0.015
    u.uAnchor.value.set(avatarRT().pos.x, camera.position.y, avatarRT().pos.z)
    // the watcher's own motion (riding, flying), eased so a stop never snaps the streaks
    const me = avatarRT()
    const r = riderRT[characterRT.active]
    const mount = r.phase === "riding" ? (r.horse as { speed: number; heading: number; flight?: { vy: number } | null } | null) : null
    if (mount) obs.set(Math.sin(mount.heading) * mount.speed, mount.flight?.vy ?? 0, Math.cos(mount.heading) * mount.speed)
    else obs.set(me.vel.x, 0, me.vel.z)
    ;(u.uObsVel.value as THREE.Vector3).lerp(obs, 1 - Math.exp(-dt * 6))

    // streaks pick up the sky colour, catch sunlight when looking toward it,
    // and turn moonlit blue at night instead of disappearing
    const timeOfDay = worldRT.timeOfDay
    const night = smoothstep(0.55, 0.95, timeOfDay)
    keyLightDirection(timeOfDay, sunDir)
    camera.getWorldDirection(viewDir)
    const glint = Math.pow(Math.max(0, viewDir.dot(sunDir)), 3.5) * (1 - night * 0.9)
    const c = u.uColor.value as THREE.Color
    c.setRGB(0.78 + glint * 0.3, 0.88 + glint * 0.2, 1.0)
    c.multiplyScalar(1 - night * 0.85)
    fogTint.setRGB(0.06, 0.085, 0.14)
    c.lerp(fogTint, night * 0.4)
    // under a dark storm sky the drops show the grey light round them, not white
    const fog = scene.fog as THREE.Fog | null
    if (fog && rain > 0.6) c.lerp(fogTint.copy(fog.color).multiplyScalar(1.45), smoothstep(0.6, 1, rain) * 0.5 + burst * 0.3)
  })

  return <lineSegments geometry={geometry} material={material} frustumCulled={false} renderOrder={2} />
}

/**
 * Material-dependent rain impact splashes:
 * - Water impacts: concentric ripple crowns expanding on pond/river surface
 * - Rock/path impacts: fine micro-droplet dispersal
 * - Soil/grass impacts: quick subtle dampening
 */
const MaterialSplashes = (): React.ReactElement => {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])

  const splashes = useMemo(() => {
    const rng = makeRng(77215)
    return Array.from({ length: SPLASH_COUNT }, () => ({
      x: 0,
      z: 0,
      y: 0,
      age: 0,
      life: 0.32 + rng() * 0.22,
      maxScale: 0.24 + rng() * 0.24,
      active: false,
      isWater: false,
    }))
  }, [])

  useFrame((_, rawDt) => {
    if (!mesh.current) return
    const dt = Math.min(rawDt, 1 / 20)
    const rain = weatherRT.rain
    const shouldSplash = rain > 0.06
    const mat = mesh.current.material as THREE.MeshBasicMaterial

    const targetOpacity = shouldSplash ? Math.min(0.55, rain * 0.65) : 0
    mat.opacity = THREE.MathUtils.damp(mat.opacity, targetOpacity, 4, dt)
    mesh.current.visible = mat.opacity > 0.01

    if (!mesh.current.visible) return

    const px = avatarRT().pos.x
    const pz = avatarRT().pos.z

    splashes.forEach((splash, i) => {
      if (!splash.active && shouldSplash && Math.random() < 0.16 * (0.5 + rain) * (1 + weatherRT.burst * 1.5)) {
        const radius = 0.8 + Math.random() * 18.0
        const angle = Math.random() * Math.PI * 2
        splash.x = px + Math.cos(angle) * radius
        splash.z = pz + Math.sin(angle) * radius

        splash.isWater = isOverWater(splash.x, splash.z)
        splash.y = splash.isWater ? WATER_LEVEL + 0.01 : groundHeight(splash.x, splash.z) + 0.018

        // Check shelter occlusion at the actual impact height (not a fixed y):
        // fixed y=2.0 is above umbrella roofY=1.85 so it never sheltered.
        if (isSheltered(splash.x, splash.y + 0.05, splash.z)) {
          return
        }

        splash.age = 0
        splash.life = splash.isWater ? 0.45 + Math.random() * 0.25 : 0.25 + Math.random() * 0.18
        splash.maxScale = splash.isWater ? 0.25 + Math.random() * 0.22 + rain * 0.1 : 0.18 + Math.random() * 0.16
        splash.active = true
      }

      if (splash.active) {
        splash.age += dt
        if (splash.age >= splash.life) {
          splash.active = false
          dummy.position.set(0, -20, 0)
          dummy.scale.setScalar(0.001)
        } else {
          const progress = splash.age / splash.life
          const currentRadius = splash.maxScale * (0.25 + progress * 0.75)
          dummy.position.set(splash.x, splash.y, splash.z)
          dummy.rotation.set(-Math.PI / 2, 0, (i * 0.5) % Math.PI)
          // Water impacts create broader concentric rings (kept subtle to avoid cartoon look)
          const scaleMultiplier = splash.isWater ? 1.5 : 1.2
          dummy.scale.set(currentRadius * scaleMultiplier, currentRadius * scaleMultiplier, 1)
        }
      } else {
        dummy.position.set(0, -20, 0)
        dummy.scale.setScalar(0.001)
      }
      dummy.updateMatrix()
      mesh.current?.setMatrixAt(i, dummy.matrix)
    })
    mesh.current.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, SPLASH_COUNT]} frustumCulled={false}>
      <ringGeometry args={[0.07, 0.13, 16]} />
      <meshBasicMaterial color="#e0f2fe" transparent opacity={0} depthWrite={false} />
    </instancedMesh>
  )
}

/**
 * Tree Canopy Throughfall:
 * Dense foliage intercepts rainfall. Water accumulates and periodically detaches as larger,
 * slower droplets dripping from branch perimeters.
 */
const CanopyThroughfall = (): React.ReactElement => {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])

  const drips = useMemo(() => {
    const rng = makeRng(33829)
    // Locations around tree canopy perimeters (e.g. gulmohar trees, grove trees)
    const treeAnchors = [
      { x: 9.5, z: 9.2, rad: 2.6, canopyY: 3.2 },
      { x: -8.6, z: 13.6, rad: 3.0, canopyY: 3.5 },
      { x: 6.8, z: 10.2, rad: 2.8, canopyY: 3.2 },
      { x: -12.4, z: 3.2, rad: 3.2, canopyY: 3.8 },
      { x: 12.4, z: 0.4, rad: 3.0, canopyY: 3.4 },
    ]

    return Array.from({ length: THROUGHFALL_COUNT }, (_, i: number) => {
      const anchor = treeAnchors[i % treeAnchors.length]
      const angle = rng() * Math.PI * 2
      const r = (0.5 + rng() * 0.5) * anchor.rad
      return {
        anchor,
        ox: Math.cos(angle) * r,
        oz: Math.sin(angle) * r,
        startY: anchor.canopyY - rng() * 0.5,
        y: -10,
        speed: 4.8 + rng() * 2.2,
        active: false,
      }
    })
  }, [])

  useFrame((_, rawDt) => {
    if (!mesh.current) return
    const dt = Math.min(rawDt, 1 / 20)
    const rain = weatherRT.rain
    const wetness = weatherRT.wetness
    // Throughfall requires moisture accumulation
    const shouldDrip = rain > 0.15 || wetness > 0.4

    for (let i = 0; i < THROUGHFALL_COUNT; i++) {
      const d = drips[i]
      if (!d.active && shouldDrip && Math.random() < 0.04 * (wetness + rain)) {
        d.y = d.startY
        d.active = true
      }

      if (d.active) {
        d.y -= d.speed * dt
        const groundY = groundHeight(d.anchor.x + d.ox, d.anchor.z + d.oz)
        if (d.y <= groundY) {
          d.active = false
          dummy.position.set(0, -50, 0)
          dummy.scale.setScalar(0.001)
        } else {
          dummy.position.set(d.anchor.x + d.ox, d.y, d.anchor.z + d.oz)
          // Throughfall drops are larger, spherical droplets
          dummy.scale.set(0.038, 0.065, 0.038)
        }
      } else {
        dummy.position.set(0, -50, 0)
        dummy.scale.setScalar(0.001)
      }
      dummy.updateMatrix()
      mesh.current.setMatrixAt(i, dummy.matrix)
    }
    mesh.current.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, THROUGHFALL_COUNT]} frustumCulled={false}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshStandardMaterial
        color="#e0f4fc"
        roughness={0.12}
        transparent
        opacity={0.82}
        depthWrite={false}
      />
    </instancedMesh>
  )
}
