import { debugEnabled } from "../../dev/debugFlag"
import { useFrame } from "@react-three/fiber"
import { awayFromEarth } from "../realmHook"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { avatarRT, worldRT } from "../../game/runtime"
import { sfx } from "../../game/audio/audio"
import { useGame } from "../../state/gameStore"
import { weatherRT } from "../../game/weather/weatherState"
import { qualityRT } from "../../state/qualityStore"
import { WATER_LEVEL } from "../climate"
import { originRT } from "../origin"
import { subscribeChunks } from "../worldRuntime"
import { aquaticEvents } from "./events"
import { fitsWater } from "./habitat"
import { writeFishPose } from "./instancePose"
import { makeFishGeometry, makeFishMaterial, makeRippleGeometry, makeRippleMaterial, makeSurfaceGeometry, makeSurfaceMaterial } from "./geometry"
import { AquaticPopulation } from "./population"
import { aquaticRT, aquaticStats, sampleAquaticWater, spawnAquaticTestPopulation } from "./runtime"
import { ACTIVE_RANGE, FISH_LIMITS, FISH_TYPES, fishTier, fishVisualY, stepFish, type AquaticContext } from "./simulation"
import { RIPPLE_LIMIT, SURFACE_LIMIT, stepSurface, surfaceVisible } from "./surface"

type Ripple = { key: string; x: number; z: number; age: number; strength: number; splash: boolean }

const dynamicAttribute = (geometry: THREE.BufferGeometry, name: string, count: number, stride: number): THREE.InstancedBufferAttribute => {
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(count * stride), stride).setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute(name, attr)
  return attr
}

const makeSystem = () => {
  const root = new THREE.Group(); root.name = "aquatic-life"
  const fish = FISH_TYPES.map((type, i) => {
    const geometry = makeFishGeometry(i), material = makeFishMaterial()
    const swim = dynamicAttribute(geometry, "aSwim", FISH_LIMITS[i], 4)
    const mesh = new THREE.InstancedMesh(geometry, material, FISH_LIMITS[i])
    mesh.name = `aquatic:${type}`; mesh.frustumCulled = false; mesh.count = 0; mesh.renderOrder = 2
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(mesh)
    return { mesh, swim }
  })
  const surfaceGeometry = makeSurfaceGeometry(), surfaceMaterial = makeSurfaceMaterial()
  const life = dynamicAttribute(surfaceGeometry, "aLife", SURFACE_LIMIT, 4)
  const surfaceMesh = new THREE.InstancedMesh(surfaceGeometry, surfaceMaterial, SURFACE_LIMIT)
  surfaceMesh.name = "aquatic:shore-life"; surfaceMesh.frustumCulled = false; surfaceMesh.count = 0
  surfaceMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(surfaceMesh)
  const rippleGeometry = makeRippleGeometry(), rippleMaterial = makeRippleMaterial()
  const rippleAttr = dynamicAttribute(rippleGeometry, "aRipple", RIPPLE_LIMIT, 3)
  const rippleMesh = new THREE.InstancedMesh(rippleGeometry, rippleMaterial, RIPPLE_LIMIT)
  rippleMesh.name = "aquatic:ripples"; rippleMesh.frustumCulled = false; rippleMesh.count = 0; rippleMesh.renderOrder = 3
  rippleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(rippleMesh)
  return { root, fish, life, surfaceMesh, surfaceMaterial, rippleAttr, rippleMesh, rippleMaterial,
    population: new AquaticPopulation(), dummy: new THREE.Object3D(), refresh: 0, cpuTotal: 0,
    pending: null as null | { x: number; z: number }, counts: new Uint16Array(4),
    context: { px: 0, pz: 0, rain: 0, timeOfDay: 0, time: 0 } as AquaticContext,
    ripples: Array.from({ length: RIPPLE_LIMIT }, (): Ripple => ({ key: "", x: 0, z: 0, age: 2, strength: 0, splash: false })) }
}

const addRipple = (sys: ReturnType<typeof makeSystem>, x: number, z: number, strength: number, splash: boolean): void => {
  let slot = sys.ripples[0]
  for (const r of sys.ripples) if (r.age >= 1) { slot = r; break } else if (r.age > slot.age) slot = r
  slot.x = x; slot.z = z; slot.age = 0; slot.strength = strength; slot.splash = splash
  slot.key = `${Math.floor(x / 64)},${Math.floor(z / 64)}`
}

/** Six persistent batches under WorldRoot. Chunk unload drops its CPU agents
 * and ripple slots; unmount disposes every shared GPU resource. */
export const AquaticLife = (): React.ReactElement => {
  const sys = useMemo(() => makeSystem(), [])
  useEffect(() => {
    let lastCroak = 0, lastSplash = 0
    const unsubscribeAudio = aquaticEvents.subscribe(event => {
      if (!useGame.getState().started || worldRT.introActive || worldRT.finaleActive) return
      const body = avatarRT(), range = event.kind === "croak" ? 28 : 18
      const distance = Math.hypot(body.pos.x - event.x, body.pos.z - event.z)
      if (distance >= range) return
      const now = performance.now(), loudness = Math.pow(1 - distance / range, 2) * Math.min(1, event.strength)
      if (event.kind === "croak") {
        if (now - lastCroak < 1300) return
        lastCroak = now; sfx.croak(loudness)
      } else if (event.kind === "splash" || event.kind === "jump") {
        if (now - lastSplash < 350) return
        lastSplash = now; sfx.waterLife(loudness)
      }
    })
    const unsubscribe = subscribeChunks({
      onChunkReady: chunk => { if (chunk.payload) { sys.population.add(chunk.payload); sys.refresh = 0 } },
      onChunkUnload: chunk => {
        sys.population.remove(chunk.key)
        for (const r of sys.ripples) if (r.key === chunk.key) r.age = 2
      },
    })
    aquaticRT.request = (x, z) => {
      const result = sys.population.force(x, z)
      sys.pending = result === "pending" ? { x, z } : null; sys.refresh = 0
      return result
    }
    aquaticRT.snapshots = () => ({
      fish: sys.population.fish.map(a => ({ id: a.id, species: FISH_TYPES[a.species], x: a.x, y: a.y, z: a.z,
        visualY: fishVisualY(a), size: a.size, heading: a.heading, speed: a.speed, scatter: a.scatter,
        jumping: a.jumping > 0, tier: fishTier(Math.hypot(a.x - avatarRT().pos.x, a.z - avatarRT().pos.z)),
        fits: fitsWater(a.habitat, a.area, a.x, a.y, a.z, a.size * 0.72, a.size * 0.25), kind: a.habitat.areas[a.area - 1].kind })),
      surface: sys.population.surface.map(a => ({ id: a.id, kind: ["frog", "strider", "dragonfly"][a.kind], x: a.x, y: a.y, z: a.z,
        homeX: a.homeX, homeZ: a.homeZ, waterX: a.waterX, waterZ: a.waterZ, hop: a.hop, submerged: a.submerged, visible: surfaceVisible(a, sys.context, weatherRT.wind + weatherRT.gust) })),
      areas: [...sys.population.chunks.values()].flatMap(c => c.habitat.areas.map(a => ({ chunk: c.habitat.key, kind: a.kind, x: a.x, z: a.z, area: a.area, maxDepth: a.maxDepth, plants: a.plants.length, shores: a.shores.length }))),
    })
    aquaticRT.exercise = kind => {
      if (kind === "croak") { const a = sys.population.surface.find(a => a.kind === 0); if (!a) return false; a.timer = 0; return true }
      const a = sys.population.fish.find(a => a.species !== 0)
      if (!a) return false
      if (kind === "jump") {
        a.jumping = 0.001; aquaticEvents.emit("jump", a.x, WATER_LEVEL, a.z, a.size); addRipple(sys, a.x, a.z, 0.35, false)
      } else { a.rise = 2; aquaticEvents.emit("rise", a.x, WATER_LEVEL, a.z, 0.4); addRipple(sys, a.x, a.z, 0.4, false) }
      return true
    }
    const debug = debugEnabled()
    if (debug) {
      window.__worldDev = window.__worldDev || {}
      window.__worldDev.spawnAquaticTestPopulation = spawnAquaticTestPopulation
      window.__worldDev.aquatic = { stats: aquaticStats, runtime: aquaticRT, sampleWater: sampleAquaticWater,
        snapshot: aquaticRT.snapshots, exercise: aquaticRT.exercise, events: aquaticEvents }
    }
    return () => {
      unsubscribe(); unsubscribeAudio(); sys.population.clear()
      aquaticRT.request = null; aquaticRT.exercise = null; aquaticRT.snapshots = () => ({})
      if (debug && window.__worldDev) { delete window.__worldDev.spawnAquaticTestPopulation; delete window.__worldDev.aquatic }
      for (const batch of sys.fish) { batch.mesh.geometry.dispose(); batch.mesh.material.dispose(); batch.mesh.dispose() }
      sys.surfaceMesh.geometry.dispose(); sys.surfaceMaterial.dispose(); sys.surfaceMesh.dispose()
      sys.rippleMesh.geometry.dispose(); sys.rippleMaterial.dispose(); sys.rippleMesh.dispose()
    }
  }, [sys])

  // A stable sink avoids closures or transient event objects in hot loops.
  const rippleSink = useMemo(() => (x: number, z: number, strength: number, splash: boolean): void => addRipple(sys, x, z, strength, splash), [sys])

  useFrame((state, rawDt) => {
    // on the Moon: home's life waits, paused, for the riders to come back
    if (awayFromEarth(avatarRT().pos)) return
    const started = performance.now(), dt = Math.min(rawDt, 0.1), c = sys.context
    c.px = avatarRT().pos.x; c.pz = avatarRT().pos.z; c.rain = weatherRT.rain; c.timeOfDay = worldRT.timeOfDay; c.time = state.clock.elapsedTime
    sys.root.visible = aquaticRT.enabled && (!worldRT.introActive || worldRT.introProgress >= 0.495)
    if (!sys.root.visible) return
    // Instance matrices use nearby render coordinates even millions of metres
    // from home. Root cancels its WorldRoot parent translation on every rebase.
    sys.root.position.set(originRT.x, 0, originRT.z)
    sys.refresh -= dt
    if (sys.refresh <= 0) {
      const refreshStart = performance.now()
      sys.refresh = 0.5
      if (sys.pending && sys.population.force(sys.pending.x, sys.pending.z) !== "pending") sys.pending = null
      sys.population.refresh(c.px, c.pz, qualityRT.profile.particles, qualityRT.profile.animals)
      aquaticStats.refreshMs = performance.now() - refreshStart
    }
    sys.counts.fill(0); aquaticStats.full = 0; aquaticStats.reduced = 0
    const dummy = sys.dummy
    for (const a of sys.population.fish) {
      const distance = Math.hypot(a.x - c.px, a.z - c.pz), tier = fishTier(distance)
      if (tier === "off") continue
      aquaticStats[tier]++
      a.elapsed += dt
      const bucket = Math.floor((c.time + a.phase * 0.073) / 0.2)
      if (tier === "full" || bucket !== a.simBucket) {
        // Substeps keep reactions and volume checks reliable at reduced rates.
        const steps = Math.ceil(a.elapsed / 0.1), step = a.elapsed / steps
        // Near fish advance their stroke inside the step, so each thrust pulse
        // lands on its own tail stroke; distant ones keep a per-frame phase.
        for (let i = 0; i < steps; i++) stepFish(a, sys.population.fish, c, step, rippleSink, tier === "full")
        a.elapsed = 0; a.simBucket = bucket
      }
      if (tier !== "full") a.swimPhase = (a.swimPhase + dt * a.waveRate) % (Math.PI * 2)
      const batch = sys.fish[a.species], index = sys.counts[a.species]++
      writeFishPose(dummy.matrix, a, originRT.x, originRT.z); batch.mesh.setMatrixAt(index, dummy.matrix)
      // the body curves into a turn (a C-bend), signed by the turn's direction
      batch.swim.setXYZW(index, a.swimPhase, a.waveAmp, WATER_LEVEL - fishVisualY(a), Math.max(-0.3, Math.min(0.3, a.turnRate * 0.1)))
    }
    let surfaceCount = 0
    for (const a of sys.population.surface) {
      const distance = Math.hypot(a.x - c.px, a.z - c.pz)
      if (distance >= ACTIVE_RANGE) continue
      a.elapsed += dt
      if (distance < 40 || a.elapsed >= 0.2) { stepSurface(a, c, a.elapsed, rippleSink); a.elapsed = 0 }
      if (!surfaceVisible(a, c, weatherRT.wind + weatherRT.gust)) continue
      dummy.position.set(a.x - originRT.x, a.y, a.z - originRT.z)
      dummy.rotation.set(a.hop > 0 ? -Math.cos(a.hop / 0.65 * Math.PI) * 0.3 : 0, a.heading, 0, "YXZ")
      dummy.scale.setScalar(a.kind === 0 ? 0.58 + (a.phase % 13) * 0.012 : a.kind === 1 ? 0.22 : 0.35)
      dummy.updateMatrix(); sys.surfaceMesh.setMatrixAt(surfaceCount, dummy.matrix)
      sys.life.setXYZW(surfaceCount++, a.kind, a.phase, a.croak, a.hop > 0 ? Math.sin(a.hop / 0.65 * Math.PI) : 0)
    }
    let rippleCount = 0
    for (const r of sys.ripples) {
      r.age += dt / 2.1
      if (r.age >= 1 || (r.x - c.px) ** 2 + (r.z - c.pz) ** 2 >= ACTIVE_RANGE * ACTIVE_RANGE) continue
      dummy.position.set(r.x - originRT.x, WATER_LEVEL + 0.045, r.z - originRT.z)
      dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(0.6 + r.strength * 0.4)
      dummy.updateMatrix(); sys.rippleMesh.setMatrixAt(rippleCount, dummy.matrix)
      sys.rippleAttr.setXYZ(rippleCount++, r.age, r.strength, r.splash ? 1 : 0)
    }
    const night = THREE.MathUtils.smoothstep(c.timeOfDay, 0.65, 0.97)
    let drawCalls = 0, fishCount = 0
    for (let i = 0; i < sys.fish.length; i++) {
      const batch = sys.fish[i], count = sys.counts[i]
      batch.mesh.count = count; batch.mesh.visible = count > 0
      if (count) { batch.mesh.instanceMatrix.needsUpdate = true; batch.swim.needsUpdate = true; drawCalls++; fishCount += count }
      batch.mesh.material.emissiveIntensity = 0.025 * (1 - night * 0.9)
      const water = batch.mesh.material.userData.water as THREE.Color
      water.setRGB(0.014 * (1 - night * 0.85), 0.1 * (1 - night * 0.85), 0.12 * (1 - night * 0.75))
    }
    sys.surfaceMesh.count = surfaceCount; sys.surfaceMesh.visible = surfaceCount > 0
    sys.rippleMesh.count = rippleCount; sys.rippleMesh.visible = rippleCount > 0
    if (surfaceCount) { sys.surfaceMesh.instanceMatrix.needsUpdate = true; sys.life.needsUpdate = true; drawCalls++ }
    if (rippleCount) { sys.rippleMesh.instanceMatrix.needsUpdate = true; sys.rippleAttr.needsUpdate = true; drawCalls++ }
    sys.surfaceMaterial.uniforms.uTime.value = c.time; sys.surfaceMaterial.uniforms.uNight.value = night
    sys.rippleMaterial.uniforms.uNight.value = night
    aquaticStats.chunks = sys.population.chunks.size; aquaticStats.fish = fishCount; aquaticStats.surface = surfaceCount
    aquaticStats.ripples = rippleCount; aquaticStats.drawCalls = drawCalls
    aquaticStats.cpuMs = performance.now() - started; sys.cpuTotal += aquaticStats.cpuMs; aquaticStats.frames++
    aquaticStats.averageCpuMs = sys.cpuTotal / aquaticStats.frames; aquaticStats.maxCpuMs = Math.max(aquaticStats.maxCpuMs, aquaticStats.cpuMs)
  })
  return <primitive object={sys.root} />
}
