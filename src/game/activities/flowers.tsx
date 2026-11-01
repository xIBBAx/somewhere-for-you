import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { K, SCATTER_STRIDE } from "../../world/chunkGen"
import { CHUNK_SIZE } from "../../world/worldConfig"
import { worldStreamRT } from "../../world/worldRuntime"
import { pickedScatter, removeScatterItem } from "../../world/render/WorldScatter"
import { loadVegetationLibrary } from "../../world/render/vegetationLibrary"
import { useAdventures } from "../../state/adventureStore"
import { sfx } from "../audio/audio"
import { characterRT, companionRT, playerRT, type AvatarBody, type CharacterId } from "../runtime"
import { togetherRT } from "../together/togetherState"
import { say } from "../together/Together"
import { groundHeight } from "../world-layout"
import { useGame } from "../../state/gameStore"
import { worldRT } from "../runtime"
import { activityRT, useActivityUI } from "./activityState"
import { forwardOf, rightOf, type ActivityContext } from "./context"
import { bouquetGathered } from "../vfx/signatures"

/**
 * Picking wildflowers: walk up to a flower in a meadow and press E to pick
 * it; the bouquet grows in your hand (up to nine). With five or more, E next
 * to the other one of you hands it over with both hands.
 */
const MAX_BOUQUET = 9
const SPECIES = ["daisy", "poppy", "buttercup", "cosmos", "cornflower", "lavender", "tulip"]
type Target = { key: string; item: number; x: number; y: number; z: number; species: number }
const flowerRT = {
  holder: "explorer" as CharacterId,
  species: [] as number[],
  pick: null as Target | null,
  t: -1,
  give: -1,
  received: 0,
  receiver: "companion" as CharacterId,
  version: 0,
  placing: -1,
  placePoint: new THREE.Vector3(),
  placed: 0,
}
const _f = new THREE.Vector3()
const _r = new THREE.Vector3()
const _hand = new THREE.Vector3()
const bodyOf = (id: CharacterId): AvatarBody => (id === "explorer" ? playerRT : companionRT)
const other = (id: CharacterId): CharacterId => (id === "explorer" ? "companion" : "explorer")

const nearestFlower = (body: AvatarBody): Target | null => {
  const streamer = worldStreamRT.streamer
  if (!streamer) return null
  let best: Target | null = null
  let bestD = 1.15
  const seen = new Set<string>()
  for (const [ox, oz] of [[0, 0], [1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) {
    const chunk = streamer.getChunkAt(body.pos.x + ox, body.pos.z + oz)
    if (!chunk?.payload || seen.has(chunk.key)) continue
    seen.add(chunk.key)
    const s = chunk.payload.scatter
    const bx = chunk.cx * CHUNK_SIZE, bz = chunk.cz * CHUNK_SIZE
    for (let item = 0; item < chunk.payload.scatterCount; item++) {
      const o = item * SCATTER_STRIDE
      if (s[o + 5] !== K.flower) continue
      const x = bx + s[o], z = bz + s[o + 2]
      const d = Math.hypot(x - body.pos.x, z - body.pos.z)
      if (d >= bestD || pickedScatter.has(`${chunk.key}:${item}`)) continue
      bestD = d
      best = { key: chunk.key, item, x, y: s[o + 1], z, species: Math.min(6, Math.floor(s[o + 6] * 7)) }
    }
  }
  return best
}

const holding = (): number => activityRT.bouquet

export const flowerPrompt = (ctx: ActivityContext): string | null => {
  if (ctx.water !== "land" || flowerRT.give >= 0) return null
  if (holding() > 0 && flowerRT.holder !== ctx.id) return null
  if (holding() >= 5 && characterRT.companionPresent && togetherRT.partnerNear) return "E — give the bouquet"
  if (holding() >= MAX_BOUQUET) return null
  return nearestFlower(ctx.body) ? "E — pick a flower" : null
}

export const startFlower = (ctx: ActivityContext): void => {
  if (holding() >= 5 && characterRT.companionPresent && togetherRT.partnerNear) {
    flowerRT.give = 0
    flowerRT.receiver = other(ctx.id)
    for (const id of ["explorer", "companion"] as const) { bodyOf(id).paused = true; bodyOf(id).vel.set(0, 0, 0) }
    useActivityUI.getState().setMode("pick")
    return
  }
  const target = nearestFlower(ctx.body)
  if (!target) return
  flowerRT.pick = target
  flowerRT.holder = ctx.id
  flowerRT.t = 0
  ctx.body.paused = true
  ctx.body.vel.set(0, 0, 0)
  useActivityUI.getState().setMode("pick")
}

/** A deliberate, gentle release. Z and the visible button share this path. */
export const putDownFlowers = (ctx: ActivityContext): boolean => {
  const game = useGame.getState()
  if (holding() === 0 || flowerRT.holder !== ctx.id || flowerRT.placing >= 0 || flowerRT.give >= 0 ||
    useActivityUI.getState().mode !== "none" || ctx.water !== "land" || ctx.body.rideY !== null ||
    ctx.body.paused || ctx.body.gesture !== "none" || characterRT.switching || worldRT.introActive ||
    worldRT.finaleActive || game.activeMemoryId || game.activeSecretId) return false
  flowerRT.placing = 0
  flowerRT.received = 0
  flowerRT.placePoint.copy(ctx.body.pos).addScaledVector(forwardOf(ctx.body.facing, _f), 0.58)
  flowerRT.placePoint.y = groundHeight(flowerRT.placePoint.x, flowerRT.placePoint.z) + 0.12
  ctx.body.paused = true
  ctx.body.vel.set(0, 0, 0)
  useActivityUI.getState().setMode("place")
  return true
}

const faceTowards = (body: AvatarBody, x: number, z: number, dt: number): void => {
  const want = Math.atan2(x - body.pos.x, z - body.pos.z)
  body.facing += Math.atan2(Math.sin(want - body.facing), Math.cos(want - body.facing)) * (1 - Math.exp(-9 * dt))
}

/** Where the bouquet is held: in the left hand, just in front of the chest. */
const carryPoint = (id: CharacterId, out: THREE.Vector3): THREE.Vector3 => {
  const body = bodyOf(id)
  forwardOf(body.facing, _f)
  rightOf(body.facing, _r)
  out.copy(body.pos).addScaledVector(_f, 0.26).addScaledVector(_r, -0.1)
  out.y += id === "explorer" ? 1.0 : 1.08
  if (flowerRT.placing >= 0) out.lerp(flowerRT.placePoint, THREE.MathUtils.smoothstep(flowerRT.placing, 0.2, 1.2))
  return out
}

export const updateFlowers = (ctx: ActivityContext): void => {
  const ui = useActivityUI.getState()
  const game = useGame.getState()
  ui.setCarried(holding() > 0 && flowerRT.holder === ctx.id && ctx.body.rideY === null &&
    !ctx.body.paused && !game.activeMemoryId && !game.activeSecretId && !worldRT.introActive && !worldRT.finaleActive
    ? holding() === 1 ? "Lay the flower down" : "Lay the flowers down" : null)
  // carrying: the left hand keeps the bouquet in front while walking
  if (holding() > 0 && flowerRT.give < 0) {
    const pose = togetherRT.pose[flowerRT.holder]
    carryPoint(flowerRT.holder, _hand)
    const goal = pose.reachL
    goal.target.copy(_hand)
    goal.fingers.set(0, 1, 0).addScaledVector(_f, 0.4).normalize()
    goal.palm.copy(_r)
    goal.weight = 0.9
    goal.grip = 0.85
  }
  if (flowerRT.placing >= 0) {
    flowerRT.placing += ctx.dt
    const t = flowerRT.placing
    const pose = togetherRT.pose[flowerRT.holder]
    const lower = THREE.MathUtils.smoothstep(t, 0, 0.45) * (1 - THREE.MathUtils.smoothstep(t, 1.35, 2.15))
    pose.kneel = lower
    pose.bow = 0.35 * lower
    pose.reachL.target.copy(flowerRT.placePoint)
    pose.reachL.weight = THREE.MathUtils.smoothstep(t, 0.2, 0.8) * (1 - THREE.MathUtils.smoothstep(t, 1.35, 2.0))
    pose.reachL.grip = 0.85 * (1 - THREE.MathUtils.smoothstep(t, 1.1, 1.3))
    if (t >= 1.25 && t - ctx.dt < 1.25) {
      // The visual snapshots this bouquet before its geometry is retired.
      flowerRT.placed++
      activityRT.bouquet = 0
      ui.setCarried(null)
    }
    if (t >= 2.2) {
      bodyOf(flowerRT.holder).paused = false
      flowerRT.placing = -1
      flowerRT.species = []
      flowerRT.version++
      ui.setMode("none")
    }
  }
  if (flowerRT.pick && flowerRT.t >= 0) {
    flowerRT.t += ctx.dt
    const t = flowerRT.t
    const body = bodyOf(flowerRT.holder)
    const p = flowerRT.pick
    faceTowards(body, p.x, p.z, ctx.dt)
    const pose = togetherRT.pose[flowerRT.holder]
    const reach = THREE.MathUtils.smoothstep(t, 0, 0.35) * (1 - THREE.MathUtils.smoothstep(t, 0.75, 1.15))
    const lift = THREE.MathUtils.smoothstep(t, 0.55, 0.9)
    pose.reachR.target.set(p.x, p.y + 0.28 + lift * 0.6, p.z)
    pose.reachR.fingers.set(0, -1, 0)
    pose.reachR.palm.copy(forwardOf(body.facing, _f)).multiplyScalar(-1)
    pose.reachR.weight = reach
    pose.reachR.grip = t > 0.5 ? 0.8 : 0.2
    pose.bow = 0.75 * reach
    if (t >= 0.55 && t - ctx.dt < 0.55) {
      removeScatterItem(p.key, p.item)
      flowerRT.species.push(p.species)
      activityRT.bouquet++
      flowerRT.version++
      sfx.pluck()
      useAdventures.getState().bump("flowers", 1)
      if (activityRT.bouquet === 5) ui.showResult("A little bouquet", characterRT.companionPresent ? "Five flowers. Someone nearby deserves these." : "Five flowers, carefully chosen.")
    }
    if (t > 1.2) {
      body.paused = false
      flowerRT.pick = null
      flowerRT.t = -1
      ui.setMode("none")
    }
  }
  if (flowerRT.give >= 0) {
    flowerRT.give += ctx.dt
    const t = flowerRT.give
    const giver = bodyOf(flowerRT.holder), receiver = bodyOf(flowerRT.receiver)
    faceTowards(giver, receiver.pos.x, receiver.pos.z, ctx.dt)
    faceTowards(receiver, giver.pos.x, giver.pos.z, ctx.dt)
    // offered with both hands, accepted with both hands
    _hand.copy(giver.pos).lerp(receiver.pos, 0.5)
    _hand.y = (giver.pos.y + receiver.pos.y) / 2 + 1.05
    const offer = THREE.MathUtils.smoothstep(t, 0.2, 0.8)
    const pass = THREE.MathUtils.smoothstep(t, 1.1, 1.4)
    for (const id of [flowerRT.holder, flowerRT.receiver]) {
      const self = bodyOf(id)
      const pose = togetherRT.pose[id]
      const isGiver = id === flowerRT.holder
      const w = isGiver ? offer * (1 - pass) + (1 - offer) * 0.9 : THREE.MathUtils.smoothstep(t, 0.7, 1.1)
      forwardOf(self.facing, _f)
      rightOf(self.facing, _r)
      for (const [goal, side] of [[pose.reachL, -1], [pose.reachR, 1]] as const) {
        goal.target.copy(isGiver ? _hand : _hand).addScaledVector(_r, 0.06 * side).addScaledVector(_f, isGiver ? -0.05 : 0.05)
        goal.fingers.copy(_f)
        goal.palm.set(0, 1, 0)
        goal.weight = w
        goal.grip = 0.7
      }
      pose.love = THREE.MathUtils.smoothstep(t, 1.2, 1.6)
    }
    if (t >= 1.3 && t - ctx.dt < 1.3) {
      bouquetGathered(_hand.clone().setY(_hand.y + 0.6))
      sfx.hug()
      useAdventures.getState().bump("bouquets", 1)
      say(flowerRT.receiver, flowerRT.receiver === "explorer" ? "For me? They're beautiful." : "For me? I'm keeping these forever.", 3.6)
    }
    if (t > 2.4) {
      for (const id of ["explorer", "companion"] as const) bodyOf(id).paused = false
      flowerRT.give = -1
      flowerRT.holder = flowerRT.receiver
      flowerRT.received = 25
      flowerRT.version++
      ui.setMode("none")
    }
  }
  // a received bouquet is carried for a while, then kept
  if (flowerRT.received > 0) {
    flowerRT.received -= ctx.dt
    if (flowerRT.received <= 0) {
      activityRT.bouquet = 0
      flowerRT.species = []
      flowerRT.version++
    }
  }
}

/** The bouquet: picked species gathered into a small hand-held bunch. */
export const BouquetVisual = (): React.ReactElement => {
  const group = useRef<THREE.Group>(null)
  const laid = useRef<THREE.Group>(null)
  const lastPlaced = useRef(0)
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null)
  const version = useRef(-1)
  const library = useRef<Map<string, THREE.BufferGeometry> | null>(null)
  const material = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }), [])
  useEffect(() => {
    let alive = true
    void loadVegetationLibrary().then((lib) => { if (alive) library.current = lib.geometries })
    return () => { alive = false }
  }, [])
  useEffect(() => () => {
    laid.current?.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose() })
    material.dispose()
  }, [material])
  useFrame((state) => {
    if (laid.current && flowerRT.placed !== lastPlaced.current && geometry) {
      lastPlaced.current = flowerRT.placed
      const mesh = new THREE.Mesh(geometry.clone(), material)
      mesh.position.copy(flowerRT.placePoint)
      mesh.rotation.set(Math.PI * 0.48, bodyOf(flowerRT.holder).facing, 0)
      mesh.castShadow = true
      mesh.userData.placedAt = state.clock.elapsedTime
      laid.current.add(mesh)
    }
    if (laid.current) for (const item of [...laid.current.children]) {
      const far = item.position.distanceTo(ctxBodyPosition()) > 120
      if (laid.current.children.length > 6 || far || state.clock.elapsedTime - item.userData.placedAt > 600) {
        laid.current.remove(item)
        ;(item as THREE.Mesh).geometry.dispose()
      }
    }
    if (flowerRT.version !== version.current && library.current) {
      version.current = flowerRT.version
      const parts: THREE.BufferGeometry[] = []
      flowerRT.species.forEach((species, i) => {
        const source = library.current!.get(`flower_${SPECIES[species]}_lod0`)
        if (!source) return
        const g = source.clone()
        for (const name of Object.keys(g.attributes)) if (!["position", "normal", "color"].includes(name)) g.deleteAttribute(name)
        if (!g.getAttribute("color")) {
          const c = new Float32Array(g.attributes.position.count * 4).fill(1)
          g.setAttribute("color", new THREE.BufferAttribute(c, 4))
        }
        const a = (i / Math.max(1, flowerRT.species.length)) * Math.PI * 2
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(Math.sin(a) * 0.025, -0.18, Math.cos(a) * 0.025),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.cos(a) * 0.22, a, Math.sin(a) * 0.22)),
          new THREE.Vector3(0.7, 0.62, 0.7),
        )
        g.applyMatrix4(m)
        parts.push(g)
      })
      geometry?.dispose()
      setGeometry(parts.length ? mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false) : null)
    }
    if (group.current) {
      group.current.visible = activityRT.bouquet > 0
      if (activityRT.bouquet > 0) {
        if (flowerRT.give >= 0 && flowerRT.give < 1.3) group.current.position.copy(_hand).add(new THREE.Vector3(0, 0.12, 0))
        else group.current.position.copy(carryPoint(flowerRT.holder, new THREE.Vector3())).add(new THREE.Vector3(0, 0.06, 0))
      }
    }
  })
  return <><group ref={group} visible={false}>{geometry && <mesh geometry={geometry} material={material} castShadow />}</group><group ref={laid} /></>
}

const ctxBodyPosition = (): THREE.Vector3 => bodyOf(characterRT.active).pos
