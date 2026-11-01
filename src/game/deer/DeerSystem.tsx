import { debugEnabled } from "../../dev/debugFlag"
import { useEffect, useMemo } from "react"
import { awayFromEarth } from "../../world/realmHook"
import { useFrame } from "@react-three/fiber"
import { useExplorationUI } from "../../state/explorationUIStore"
import * as THREE from "three"
import { subscribeChunks } from "../../world/worldRuntime"
import { qualityRT } from "../../state/qualityStore"
import { avatarRT, characterRT, playerRT, companionRT, worldRT } from "../runtime"
import { groundHeight } from "../world-layout"
import { stepWaterContact } from "../../world/creatureWater"
import { deerWay } from "./motion"
import { weatherRT } from "../weather/weatherState"
import { originRT } from "../../world/origin"
import { climateAt } from "../../world/climate"
import { groundShadowTexture } from "../../utils/groundShadow"
import { SPECIES } from "./species"
import { updateDeerAudio } from "./audio"
import { deerForChunk, type DeerHome } from "./population"
import { deerRT, makeDeer } from "./state"
import { shareDeerSignals, stepDeerBrain, type DeerContext } from "./brain"
import { stepDeerMotion } from "./motion"
import { disposeDeerModel, makeDeerModel } from "./assets"
import { DeerAnimator } from "./DeerAnimator"
import { glideTo } from "../../utils/renderGlide"
import { advanceAppearance, fadeByDistance, makeFadeable } from "../../world/render/aerialFog"
import { loadDeerMemories, rememberDeer, saveDeerMemories } from "./persistence"
import { installDeerInteraction, registerDeerMount } from "./interactions"
import { installDeerDev } from "./dev"
import { riderRT } from "../horses/riding"
import { pushFromCapsule } from "../mounts/contact"

const cam = new THREE.Vector3()
const frustum = new THREE.Frustum(),
  clip = new THREE.Matrix4(),
  bounds = new THREE.Sphere()
const shadowMatrix = new THREE.Matrix4(),
  shadowPosition = new THREE.Vector3(),
  shadowScale = new THREE.Vector3(),
  shadowRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
export const DeerSystem = (): React.ReactElement => {
  const root = useMemo(() => {
    const g = new THREE.Group()
    g.name = "living-deer"
    return g
  }, [])
  const shadows = useMemo(() => {
    const m = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: groundShadowTexture(),
        color: 0x24302b,
        transparent: true,
        opacity: 0.27,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
      64,
    )
    m.frustumCulled = false
    m.count = 0
    m.name = "deer-contact-shadows"
    return m
  }, [])
  const sys = useMemo(
    () => ({
      chunks: new Map<string, DeerHome[]>(),
      refresh: 0,
      signal: 0,
      ctx: { time: 0, people: [], rain: 0, thunder: 0 } as DeerContext,
    }),
    [],
  )
  useEffect(() => {
    loadDeerMemories()
    root.add(shadows)
    const stop = subscribeChunks({
      onChunkReady: (c) => {
        if (!sys.chunks.has(c.key)) sys.chunks.set(c.key, deerForChunk(c.cx, c.cz))
      },
      onChunkUnload: (c) => {
        sys.chunks.delete(c.key)
      },
    })
    const stopInteraction = installDeerInteraction()
    const save = (): void => {
      for (const d of deerRT.animals.values())
        rememberDeer({ id: d.ident.id, relationships: d.relationships, x: d.x, z: d.z, updated: deerRT.time })
      saveDeerMemories()
    }
    const timer = window.setInterval(save, 5000)
    window.addEventListener("pagehide", save)
    if (debugEnabled()) installDeerDev()
    return () => {
      save()
      stop()
      stopInteraction()
      clearInterval(timer)
      window.removeEventListener("pagehide", save)
      for (const d of deerRT.animals.values()) if (d.model) disposeDeerModel(d.model)
      deerRT.animals.clear()
      shadows.geometry.dispose()
      ;(shadows.material as THREE.Material).dispose()
      shadows.dispose()
      root.clear()
      sys.chunks.clear()
    }
  }, [root, sys, shadows])
  useFrame((state, rawDt) => {
    if (useExplorationUI.getState().panel === "controls") return
    // on the Moon: home's life waits, paused, for the riders to come back
    if (awayFromEarth(avatarRT().pos)) return
    const started = performance.now(),
      dt = Math.min(0.1, rawDt),
      me = avatarRT()
    const time = Date.now() / 1000
    deerRT.time = time
    sys.refresh -= dt
    sys.signal -= dt
    const range = qualityRT.profile.animalRange + 35
    if (sys.refresh <= 0) {
      sys.refresh = 0.8
      const homes = new Map<string, DeerHome>()
      for (const group of sys.chunks.values()) for (const h of group) homes.set(h.ident.id, h)
      const limit = Math.max(8, Math.min(32, Math.round(qualityRT.profile.animals * 0.75)))
      const candidates = [...homes.values()]
        .filter((h) => Math.hypot(h.x - me.pos.x, h.z - me.pos.z) < range + 60)
        .sort((a, b) => Math.hypot(a.x - me.pos.x, a.z - me.pos.z) - Math.hypot(b.x - me.pos.x, b.z - me.pos.z))
        .slice(0, limit)
      const keep = new Set(candidates.map((h) => h.ident.id))
      for (const [id, d] of deerRT.animals) {
        if (
          d.rider ||
          d.reservedBy ||
          d.debugMode ||
          (import.meta.env.DEV && d.ident.herd.startsWith("qa:")) ||
          Math.hypot(d.x - me.pos.x, d.z - me.pos.z) < 18
        )
          continue
        if (!keep.has(id)) {
          rememberDeer({ id, relationships: d.relationships, x: d.x, z: d.z, updated: time })
          if (d.model) disposeDeerModel(d.model)
          deerRT.animals.delete(id)
        }
      }
      for (const h of candidates)
        if (!deerRT.animals.has(h.ident.id)) {
          const d = makeDeer(h, time)
          d.y = groundHeight(d.x, d.z)
          deerRT.animals.set(h.ident.id, d)
          registerDeerMount(d)
        }
      deerRT.stats.territories = new Set(candidates.map((h) => h.ident.herd)).size
    }
    const list = [...deerRT.animals.values()]
    for (const [id, body] of [
      ["explorer", playerRT],
      ["companion", companionRT],
    ] as const) {
      if (riderRT[id].phase !== "none" || body.rideY !== null || (id === "companion" && !characterRT.companionPresent))
        continue
      for (const d of list) {
        const H = SPECIES[d.ident.species].height * d.ident.scale
        if (
          Math.abs(body.pos.x - d.x) > H * 1.5 ||
          Math.abs(body.pos.z - d.z) > H * 1.5 ||
          body.pos.y > d.y + H ||
          body.pos.y < d.y - 0.3
        )
          continue
        pushFromCapsule(body.pos, d, H * 0.35, H * (d.ident.species === "yak" ? 0.29 : 0.22) + 0.28)
      }
    }
    if (sys.signal <= 0) {
      deerRT.stats.familiesAlerted += shareDeerSignals(list)
      sys.signal = 0.2
    }
    const ctx = sys.ctx
    ctx.time = time
    ctx.rain = weatherRT.rain
    ctx.thunder = worldRT.lightning
    ctx.people.length = 0
    for (const [id, body] of [
      ["explorer", playerRT],
      ["companion", companionRT],
    ] as const) {
      if (id === "companion" && !characterRT.companionPresent) continue
      ctx.people.push({ id, x: body.pos.x, z: body.pos.z, vx: body.vel.x, vz: body.vel.z, speed: body.speed })
    }
    state.camera.getWorldPosition(cam)
    frustum.setFromProjectionMatrix(
      clip.multiplyMatrices(state.camera.projectionMatrix, state.camera.matrixWorldInverse),
    )
    const cameraX = cam.x + originRT.x,
      cameraZ = cam.z + originRT.z
    let rendered = 0,
      simulated = 0
    for (const d of list) {
      const dist = Math.hypot(d.x - me.pos.x, d.z - me.pos.z),
        viewDist = Math.min(dist, Math.hypot(d.x - cameraX, d.z - cameraZ))
      d.simTime += dt
      d.animTime += dt
      if (d.simTime >= (dist < 30 ? 0 : dist < 90 ? 0.12 : 0.65)) {
        if (!worldRT.introActive && !worldRT.finaleActive) stepDeerBrain(d, ctx, d.simTime, deerRT.animals)
        if (!d.rider) {
          if (d.debugSpeed !== null) d.targetSpeed = d.debugSpeed
          stepDeerMotion(d, d.simTime, null)
        }
        d.simTime = 0
        simulated++
      }
      bounds.center.set(d.x - originRT.x, d.y + SPECIES[d.ident.species].height, d.z - originRT.z)
      bounds.radius = SPECIES[d.ident.species].height * 2.2
      const visible = !!d.rider || (viewDist < range && frustum.intersectsSphere(bounds))
      const lod: 0 | 1 = viewDist > (d.model?.lod === 1 ? 40 : 48) ? 1 : 0
      if (visible && !d.loading && !d.failed && (!d.model || d.model.lod !== lod)) {
        d.loading = true
        void makeDeerModel(d.ident, lod)
          .then((m) => {
            d.loading = false
            if (deerRT.animals.get(d.ident.id) !== d) {
              disposeDeerModel(m)
              return
            }
            if (d.model) disposeDeerModel(d.model)
            const appearance = d.model ? Number(d.model.root.userData.appearance ?? 1) : 0
            m.root.userData.appearance = appearance
            m.root.userData.fade = 1 - appearance
            m.root.visible = false
            makeFadeable(m.root)
            d.animator = new DeerAnimator(m, d.ident.seed)
            d.model = m
            const season = 0.5 + 0.5 * Math.cos(((new Date().getUTCMonth() + 0.5) * Math.PI) / 6)
            m.winter.value = Math.max(0, Math.min(1, -climateAt(d.home.x, d.home.z).temperature * 2)) * season
            m.root.scale.setScalar(d.ident.scale)
            root.add(m.root)
            d.animTime = 1
          })
          .catch((error) => {
            d.loading = false
            d.failed = true
            console.error(`[deer] ${d.ident.species} model unavailable`, error)
          })
      }
      const m = d.model
      if (!m || !d.animator) continue
      const appearance = d.rider ? 1 : advanceAppearance(Number(m.root.userData.appearance ?? 0), visible, dt)
      m.root.userData.appearance = appearance
      m.root.visible = appearance > 0
      // dissolves at the edge of its range rather than popping (aerialFog.ts)
      m.root.userData.fade = d.rider ? 0 : 1 - appearance * (1 - fadeByDistance(viewDist, range))
      d.visible = m.root.visible
      if (!m.root.visible) continue
      rendered++
      // drawn gliding between its motion steps, not jumping on each (renderGlide.ts)
      const g = glideTo(d.glide, d.x, d.z, d.heading, d.speed, d.turnRate, d.simTime, dist < 30 || !!d.rider, dt)
      // afloat, the body keeps to the surface rather than the bed under it
      const gy = (g.x === d.x && g.z === d.z) || d.swim > 0.05 ? d.y : groundHeight(g.x, g.z)
      const sin = Math.sin(g.heading),
        cos = Math.cos(g.heading),
        s = d.ident.scale
      d.pose.ground = (x, z) => (groundHeight(g.x + (cos * x + sin * z) * s, g.z + (-sin * x + cos * z) * s) - gy) / s
      if (d.animTime >= (viewDist < 28 ? 0 : lod === 0 ? 0.06 : 0.16)) {
        d.animator.update(d, d.animTime, state.clock.elapsedTime)
        d.animTime = 0
      }
      // a swim leaves the coat dark and dripping until it dries
      stepWaterContact(d.water, deerWay(d), s, d.x, d.z, groundHeight(d.x, d.z), d.heading, Math.abs(d.speed), dt, viewDist < 45)
      m.wet.value = Math.max(weatherRT.wetness, d.water.wet * 0.9)
      m.root.position.set(g.x, gy + d.jumpY, g.z)
      m.root.rotation.y = g.heading
      updateDeerAudio(d, state.clock.elapsedTime)
      if (rendered <= 64) {
        const H = SPECIES[d.ident.species].height * s
        shadowPosition.set(g.x, gy + 0.025, g.z)
        const presence = (1 - Number(m.root.userData.fade)) * Math.exp(-Math.max(0, d.jumpY) * 2)
        shadowScale.set(H * 0.85 * presence, H * 1.5 * presence, 1)
        shadows.setMatrixAt(rendered - 1, shadowMatrix.compose(shadowPosition, shadowRotation, shadowScale))
      }
    }
    shadows.count = Math.min(64, rendered)
    shadows.instanceMatrix.needsUpdate = true
    deerRT.stats.rendered = rendered
    deerRT.stats.simulated = simulated
    deerRT.stats.ms = performance.now() - started
    // Shared riding advances mounts at -30. Pose/render afterwards so a running
    // deer's body and its rider use the same position, even at low frame rates.
  }, -29)
  return <primitive object={root} />
}
