import { debugEnabled } from "../../../dev/debugFlag"
import { useFrame } from "@react-three/fiber"
import { awayFromEarth } from "../../../world/realmHook"
import { useEffect, useMemo, useRef } from "react"

import * as THREE from "three"
import { useGame } from "../../../state/gameStore"
import { animalEcosystemRT } from "../../animals/ecosystem"
import { avatarRT, catRT, characterRT, companionRT, playerRT, worldRT } from "../../runtime"
import { horseRT, type HorseState } from "../../horses/horseState"
import { groundHeight, PATH_POINTS } from "../../world-layout"
import { weatherRT } from "../../weather/weatherState"
import { groundHistory, TRACK_PROFILES, TRACK_SHAPES } from "./groundHistory"
import { groundResources, makeWorldTrackMaterial } from "./groundMaterial"
import { groundHash, groundObstacle, renderedGroundHeight } from "./groundSurface"
import { packTrailField, trailResources } from "./trailField"
import { originRT } from "../../../world/origin"
import { wildlifeRT } from "../../../world/wildlife/runtime"
import { waterSurfaceAt } from "../../../world/waterSurface"
import { worldStreamRT } from "../../../world/worldRuntime"
import { CHUNK_SIZE, chunkKey } from "../../../world/worldConfig"

const VISIBLE_TRACKS = 768
const GRID = 4
const trackShapes = new WeakMap<object, { pos: Float32Array; nrm: Float32Array; lod: number }>()
const VERTICES = (GRID + 1) ** 2
const TINT = {
  grass: new THREE.Color("#60723d"), soil: new THREE.Color("#69492d"), sand: new THREE.Color("#aa8961"),
  mud: new THREE.Color("#4e3523"), rock: new THREE.Color("#baab93"), built: new THREE.Color("#baab93"), water: new THREE.Color(),
}

const makeTrackGeometry = (): THREE.BufferGeometry => {
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(VISIBLE_TRACKS * VERTICES * 3)
  const normals = new Float32Array(positions.length)
  const uv = new Float32Array(VISIBLE_TRACKS * VERTICES * 2)
  const data = new Float32Array(VISIBLE_TRACKS * VERTICES * 4)
  const clarity = new Float32Array(VISIBLE_TRACKS * VERTICES)
  const colors = new Float32Array(VISIBLE_TRACKS * VERTICES * 3)
  const indices: number[] = []
  for (let t = 0; t < VISIBLE_TRACKS; t++) for (let z = 0; z <= GRID; z++) for (let x = 0; x <= GRID; x++) {
    const i = t * VERTICES + z * (GRID + 1) + x
    uv[i * 2] = x / GRID; uv[i * 2 + 1] = z / GRID
    normals[i * 3 + 1] = 1
    if (x < GRID && z < GRID) indices.push(i, i + GRID + 1, i + 1, i + 1, i + GRID + 1, i + GRID + 2)
  }
  geometry.setIndex(indices)
  for (const [name, array, size] of [["position", positions, 3], ["normal", normals, 3], ["uv", uv, 2], ["color", colors, 3], ["printData", data, 4], ["printClarity", clarity, 1]] as const) {
    geometry.setAttribute(name, new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage))
  }
  geometry.setDrawRange(0, 0)
  return geometry
}

let seeded = false
const seedAuthoredPathHistory = (): void => {
  if (seeded) return
  seeded = true
  // Historical journeys follow the existing path samples. Remote meadow stays
  // quiet. Distinct journeys have different lanes, directions and exposure ages.
  for (let journey = 0; journey < 5; journey++) {
    for (let i = 1; i < PATH_POINTS.length - 1; i++) {
      const point = PATH_POINTS[i], next = PATH_POINTS[i + 1]
      const angle = Math.atan2(next.x - point.x, next.z - point.z) + (journey % 2 ? Math.PI : 0)
      const lane = (journey - 2) * 0.17 + Math.sin(i * 0.14 + journey) * 0.12
      const side = i % 2 ? -1 : 1
      const x = point.x + Math.cos(angle) * (lane + side * 0.102)
      const z = point.z - Math.sin(angle) * (lane + side * 0.102)
      if (groundObstacle(x, z)) continue
      groundHistory.stamp({ maker: `path-history-${journey}`, profile: TRACK_PROFILES.explorer, x, z, angle, side, speed: 1.2 + journey * 0.12, age: 70 + journey * 48 + groundHash(i, journey) * 80 })
    }
  }
}

/**
 * No hoofprints while a horse is off the ground: jumping, lying down, or a
 * Pegasus on the wing (its flight leaves the ground below untouched; before
 * this, a flying Pegasus printed a line of hoofprints under its path).
 */
export const hoovesOffGround = (h: Pick<HorseState, "jumpY" | "pose" | "flight" | "x" | "y" | "z">, ground = groundHeight): boolean =>
  h.jumpY > 0.08 || h.pose.lie > 0.4 || (!!h.flight && h.flight.mode !== "ground") || h.y - ground(h.x, h.z) > 0.25

export const GroundSystem = (): React.ReactElement => {
  const geometry = useMemo(() => makeTrackGeometry(), [])
  const material = useMemo(() => makeWorldTrackMaterial(), [])
  const timer = useRef(0)
  const mesh = useRef<THREE.Mesh>(null)
  const aliveWalkers = useMemo(() => new Set<string>(), [])
  const resources = groundResources()
  const trail = trailResources()
  useEffect(() => {
    seedAuthoredPathHistory()
    const diagnostics = window as typeof window & { __worldGround?: unknown }
    if (debugEnabled()) {
      diagnostics.__worldGround = {
        summary: () => groundHistory.summary(),
        tracks: () => groundHistory.tracks.filter(t => t?.active).map(t => ({
          maker: t!.maker, x: t!.x, z: t!.z, shape: t!.shape, side: t!.side, angle: t!.angle,
          age: t!.age, depth: t!.depth, integrity: t!.integrity, surface: t!.surface.kind,
        })),
        wear: () => {
          let bend = 0, wear = 0, maxWear = 0
          for (const cell of groundHistory.activeCells) { bend += groundHistory.bend[cell]; wear += groundHistory.wear[cell]; maxWear = Math.max(maxWear, groundHistory.wear[cell]) }
          return { bend, wear, maxWear }
        },
      }
    }
    return () => { delete diagnostics.__worldGround; geometry.dispose(); material.dispose() }
  }, [geometry, material])

  useFrame(({ camera, scene }, rawDt) => {
    // on the Moon: home's life waits, paused, for the riders to come back
    if (awayFromEarth(avatarRT().pos)) return
    const dt = Math.min(rawDt, 0.1)
    resources.wetness.value = weatherRT.wetness
    resources.rain.value = weatherRT.rain
    resources.surfaceWater.value = weatherRT.surfaceWater
    if (scene.background instanceof THREE.Color) resources.skyColor.value.copy(scene.background)
    resources.gardenOpen.value = useGame.getState().finale === "locked" ? 0 : 1
    resources.time.value += dt
    resources.wind.value.set(Math.sin(weatherRT.windDirectionRad), Math.cos(weatherRT.windDirectionRad)).multiplyScalar(weatherRT.wind + weatherRT.gust * 0.3)
    trail.uniforms.uTrailCenter.value.set(trail.centerX - originRT.x, trail.centerZ - originRT.z)
    if (!worldRT.introActive) {
      aliveWalkers.clear()
      aliveWalkers.add("explorer")
      const explorerWater = waterSurfaceAt(playerRT.pos.x, playerRT.pos.z)
      groundHistory.observe("explorer", TRACK_PROFILES.explorer, playerRT.pos.x, playerRT.pos.z, playerRT.speed,
        playerRT.rideY !== null || playerRT.jumpPhase === "rising" || playerRT.jumpPhase === "falling" || (explorerWater !== null && playerRT.pos.y < explorerWater - 0.02), weatherRT.wetness, dt, 1, playerRT.pos.y)
      if (characterRT.companionPresent) {
        aliveWalkers.add("companion")
        const water = waterSurfaceAt(companionRT.pos.x, companionRT.pos.z)
        groundHistory.observe("companion", TRACK_PROFILES.explorer, companionRT.pos.x, companionRT.pos.z, companionRT.speed,
          companionRT.rideY !== null || companionRT.jumpPhase === "rising" || companionRT.jumpPhase === "falling" || (water !== null && companionRT.pos.y < water - 0.02), weatherRT.wetness, dt, 1.08, companionRT.pos.y)
      }
      if (!catRT.hidden) {
        aliveWalkers.add("companion")
        // paws leave prints only where they actually press the ground: never
        // aboard a mount (or hopping on or off), mid-leap, swimming or wading,
        // or anywhere her feet are not on the earth under her
        const catOff = catRT.navMode === "jump" || catRT.aboard || catRT.swim > 0.02 || catRT.wet > 0.02 && waterSurfaceAt(catRT.pos.x, catRT.pos.z) !== null ||
          Math.abs(catRT.pos.y - groundHeight(catRT.pos.x, catRT.pos.z)) > 0.1
        groundHistory.observe("companion", TRACK_PROFILES["companion-cat"], catRT.pos.x, catRT.pos.z, catRT.speed, catOff, weatherRT.wetness, dt, 1, catRT.pos.y)
      }
      // hoofprints of the horses near the player (none in the air or lying down)
      for (const h of horseRT.horses.values()) {
        if (!h.visible || Math.hypot(h.x - avatarRT().pos.x, h.z - avatarRT().pos.z) > 45) continue
        aliveWalkers.add(h.ident.id)
        groundHistory.observe(h.ident.id, TRACK_PROFILES.horse, h.x, h.z, Math.abs(h.speed), hoovesOffGround(h), weatherRT.wetness, dt, h.ident.scale, h.y)
      }
      for (const agent of animalEcosystemRT.agents.values()) {
        const profile = TRACK_PROFILES[agent.species]
        if (!profile || agent.species === "companion-cat") continue
        aliveWalkers.add(agent.id)
        const airborne = agent.position.y - groundHeight(agent.position.x, agent.position.z) > 0.24
        groundHistory.observe(agent.id, profile, agent.position.x, agent.position.z, agent.speed, airborne, weatherRT.wetness, dt,
          /fawn|foal|kitten|duckling/.test(agent.id) ? 0.62 : 1, agent.position.y)
      }
      for (const agent of wildlifeRT.walkers.values()) {
        const profile = TRACK_PROFILES[agent.species === "cat" ? "garden-cat" : agent.species]
        if (!profile) continue
        aliveWalkers.add(agent.id)
        groundHistory.observe(agent.id, profile, agent.x, agent.z, agent.speed, agent.swim > 0.2, weatherRT.wetness, dt, agent.scale, agent.y)
      }
      groundHistory.retainWalkers(aliveWalkers)
    }
    timer.current += dt
    if (timer.current < 0.10) return
    const start = performance.now()
    groundHistory.advance(timer.current, weatherRT.rain, weatherRT.wind)
    timer.current = 0
    resources.history.value.needsUpdate = true
    trail.centerX = Math.round(avatarRT().pos.x / 4) * 4
    trail.centerZ = Math.round(avatarRT().pos.z / 4) * 4
    packTrailField(trail.data, groundHistory.tracks, trail.centerX, trail.centerZ)
    trail.texture.needsUpdate = true
    trail.uniforms.uTrailCenter.value.set(trail.centerX - originRT.x, trail.centerZ - originRT.z)
    const positions = geometry.getAttribute("position") as THREE.BufferAttribute
    const normals = geometry.getAttribute("normal") as THREE.BufferAttribute
    const data = geometry.getAttribute("printData") as THREE.BufferAttribute
    const clarity = geometry.getAttribute("printClarity") as THREE.BufferAttribute
    const colors = geometry.getAttribute("color") as THREE.BufferAttribute
    const anchorX = Math.round(camera.position.x / 16) * 16, anchorZ = Math.round(camera.position.z / 16) * 16
    mesh.current?.position.set(anchorX, 0, anchorZ)
    let count = 0
    // Newest first: detail budget prioritizes current gameplay, while far traffic
    // remains in the bounded history. Each impression is part of one batch.
    for (let offset = 0; offset < groundHistory.tracks.length && count < VISIBLE_TRACKS; offset++) {
      const track = groundHistory.tracks[(groundHistory.next - 1 - offset + groundHistory.tracks.length) % groundHistory.tracks.length]
      if (!track?.active) continue
      if (Math.hypot(track.x - camera.position.x, track.z - camera.position.z) > 28) continue
      const freshness = Math.max(0, 1 - track.age / track.lifetime)
      // Offsets keep sub-centimetre print detail intact even millions of metres
      // from home. Re-conform when the rendered terrain switches LOD.
      let shape = trackShapes.get(track)
      const chunk = worldStreamRT.streamer?.chunks.get(chunkKey(Math.floor(track.x / CHUNK_SIZE), Math.floor(track.z / CHUNK_SIZE)))
      const lod = chunk?.payload ? chunk.lod : -1
      if (!shape || shape.lod !== lod) {
        shape = { pos: new Float32Array(VERTICES * 3), nrm: new Float32Array(VERTICES * 3), lod }
        const elevated = track.surface.height - renderedGroundHeight(track.x, track.z) > 0.16
        const sin = Math.sin(track.angle), cos = Math.cos(track.angle)
        for (let z = 0; z <= GRID; z++) for (let x = 0; x <= GRID; x++) {
          const v = (z * (GRID + 1) + x) * 3
          const lx = (x / GRID - 0.5) * track.width * 1.4, lz = (z / GRID - 0.5) * track.length * 1.35
          const wx = track.x + cos * lx + sin * lz, wz = track.z - sin * lx + cos * lz
          shape.pos[v] = wx - track.x
          shape.pos[v + 1] = (elevated ? track.surface.height : renderedGroundHeight(wx, wz)) + 0.003
          shape.pos[v + 2] = wz - track.z
          const nx = elevated ? 0 : (renderedGroundHeight(wx - 0.02, wz) - renderedGroundHeight(wx + 0.02, wz)) / 0.04
          const nz = elevated ? 0 : (renderedGroundHeight(wx, wz - 0.02) - renderedGroundHeight(wx, wz + 0.02)) / 0.04
          const norm = Math.hypot(nx, 1, nz)
          shape.nrm[v] = nx / norm
          shape.nrm[v + 1] = 1 / norm
          shape.nrm[v + 2] = nz / norm
        }
        trackShapes.set(track, shape)
      }
      ;(normals.array as Float32Array).set(shape.nrm, count * VERTICES * 3)
      const shapeIndex = TRACK_SHAPES.indexOf(track.shape)
      const hard = track.surface.kind === "rock" || track.surface.kind === "built"
      const fade = track.integrity * Math.min(1, freshness * 4) * (hard ? 0.30 : track.surface.kind === "grass" ? 0.54 : 0.85)
      const tint = TINT[track.surface.kind]
      for (let k = 0; k < VERTICES; k++) {
        const i = count * VERTICES + k
        positions.setXYZ(i, track.x - anchorX + shape.pos[k * 3], shape.pos[k * 3 + 1], track.z - anchorZ + shape.pos[k * 3 + 2])
        colors.setXYZ(i, tint.r, tint.g, tint.b)
        data.setXYZW(i, shapeIndex, track.side, track.depth, freshness)
        clarity.setX(i, fade)
      }
      count++
    }
    geometry.setDrawRange(0, count * GRID * GRID * 6)
    for (const attribute of [positions, normals, data, clarity, colors]) {
      attribute.clearUpdateRanges(); attribute.addUpdateRange(0, count * VERTICES * attribute.itemSize); attribute.needsUpdate = true
    }
    groundHistory.updateMs = performance.now() - start
  })
  return <mesh ref={mesh} name="ground-track-batch" geometry={geometry} material={material} frustumCulled={false} receiveShadow renderOrder={2} />
}
