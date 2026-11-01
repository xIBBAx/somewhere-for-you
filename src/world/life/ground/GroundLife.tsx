import { debugEnabled } from "../../../dev/debugFlag"
import { useFrame } from "@react-three/fiber"
import { awayFromEarth } from "../../realmHook"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { GROUND_KINDS, GROUND_LIFE } from "../../../content/groundLife"
import { avatarRT, catRT, worldRT } from "../../../game/runtime"
import { weatherRT } from "../../../game/weather/weatherState"
import { useDiscoveries } from "../../../state/discoveryStore"
import { useFieldGuide } from "../../../state/fieldGuideStore"
import { useGame } from "../../../state/gameStore"
import { qualityRT } from "../../../state/qualityStore"
import { originRT } from "../../origin"
import { createAntGeometry, createBeetleGeometry, createCrawlerGeometry, createNestGeometry, createWalkerGeometry } from "./geometry"
import { groundHeightAt } from "./groundHeight"
import { stepDampness } from "./habitat"
import { createGroundLifeMaterial, groundLifeUniforms } from "./material"
import { BATCH, BATCH_CAP, BATCH_COUNT, BATCH_NAMES, K, KIND_BATCH, KIND_COUNT, KIND_SCALE, KIND_SUB, KIND_VIEW, NEST, NEST_VIEW } from "./roster"
import { groundLifeRT } from "./runtime"
import { GroundLifeSim, makeAntPose, REFRESH_INTERVAL, renderCoord, S, updateSightings, type Critter, type Disturber } from "./sim"

/**
 * Visible ground life near the player: ants on scent trails, ladybirds,
 * beetles, grasshoppers, crickets, harvestmen, woodlice, millipedes, snails
 * and earthworms. Five instanced draw calls in total.
 *
 * Floating origin: the root group sits at +origin, cancelling WorldRoot's
 * −origin, and every instance matrix is written in render space
 * (logical − origin), exactly like AquaticLife. Simulation stays logical.
 */

type Batch = {
  mesh: THREE.InstancedMesh
  anim: THREE.InstancedBufferAttribute
  tint: THREE.InstancedBufferAttribute
  count: number
}

const makeBatch = (index: number, geometry: THREE.BufferGeometry): Batch => {
  const cap = BATCH_CAP[index]
  const anim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage)
  const tint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute("iAnim", anim)
  geometry.setAttribute("iTint", tint)
  const mesh = new THREE.InstancedMesh(geometry, createGroundLifeMaterial(index), cap)
  mesh.name = `ground-life:${BATCH_NAMES[index]}`
  mesh.frustumCulled = false
  mesh.count = 0
  mesh.receiveShadow = true
  mesh.castShadow = false
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  return { mesh, anim, tint, count: 0 }
}

const makeSystem = () => {
  const root = new THREE.Group()
  root.name = "ground-life"
  const geometries = [createAntGeometry(), createBeetleGeometry(), createWalkerGeometry(), createCrawlerGeometry(), createNestGeometry()]
  const batches = geometries.map((g, i) => makeBatch(i, g))
  for (const b of batches) root.add(b.mesh)
  return {
    root,
    batches,
    sim: new GroundLifeSim(),
    refresh: 0,
    lastX: Number.NaN,
    lastZ: Number.NaN,
    avatar: { x: 0, z: 0, speed: 0, active: true } as Disturber,
    cat: { x: 0, z: 0, speed: 0, active: true } as Disturber,
    pose: makeAntPose(),
    nearest: new Float32Array(KIND_COUNT),
    nearX: new Float64Array(KIND_COUNT),
    nearY: new Float64Array(KIND_COUNT),
    nearZ: new Float64Array(KIND_COUNT),
    dwell: new Float32Array(KIND_COUNT),
    metAt: new Float64Array(KIND_COUNT).fill(-Infinity),
    pendingToast: -1,
    // scratch for matrices and culling
    m: new THREE.Matrix4(),
    p: new THREE.Vector3(),
    q: new THREE.Quaternion(),
    s: new THREE.Vector3(),
    e: new THREE.Euler(0, 0, 0, "YXZ"),
    frustum: new THREE.Frustum(),
    pv: new THREE.Matrix4(),
    sphere: new THREE.Sphere(),
    lastSeen: 0,
  }
}

type System = ReturnType<typeof makeSystem>

/** Write one instance in render space; returns false when culled. */
const writeInstance = (
  sys: System, batch: Batch, x: number, y: number, z: number, heading: number, pitch: number, roll: number, scale: number,
  a0: number, a1: number, a2: number, a3: number, t0: number, t1: number, t2: number, t3: number,
): boolean => {
  if (batch.count >= batch.mesh.instanceMatrix.count) return false
  const rx = renderCoord(x, originRT.x)
  const rz = renderCoord(z, originRT.z)
  sys.sphere.center.set(rx, y, rz)
  sys.sphere.radius = scale * 1.6 + 0.25
  if (!sys.frustum.intersectsSphere(sys.sphere)) return false
  sys.p.set(rx, y, rz)
  sys.e.set(pitch, heading, roll)
  sys.q.setFromEuler(sys.e)
  sys.s.setScalar(scale)
  sys.m.compose(sys.p, sys.q, sys.s)
  const i = batch.count++
  sys.m.toArray(batch.mesh.instanceMatrix.array, i * 16)
  const a = batch.anim.array as Float32Array
  a[i * 4] = a0
  a[i * 4 + 1] = a1
  a[i * 4 + 2] = a2
  a[i * 4 + 3] = a3
  const t = batch.tint.array as Float32Array
  t[i * 4] = t0
  t[i * 4 + 1] = t1
  t[i * 4 + 2] = t2
  t[i * 4 + 3] = t3
  return true
}

const ANT_TINT = [
  [0.022, 0.012, 0.009],
  [0.2, 0.045, 0.016],
]

/** Per-kind instance pose details derived from simulation state. */
const writeCritter = (sys: System, c: Critter, px: number, pz: number): void => {
  const k = c.kind
  const d = Math.hypot(c.x - px, c.z - pz)
  if (d > KIND_VIEW[k] || c.presence <= 0.01) return
  const ease = c.presence * c.presence * (3 - 2 * c.presence)
  const scale = KIND_SCALE[k] * c.size * (0.35 + 0.65 * ease)
  // sink a little while fading so creatures seem to slip under the litter
  const y = c.y + 0.0015 - (1 - ease) * 0.02
  const batch = sys.batches[KIND_BATCH[k]]
  let a2 = 0
  let a3 = 0
  switch (k) {
    case K.ladybird:
    case K.stagBeetle:
      a2 = c.wing
      a3 = c.extra
      break
    case K.grasshopper:
    case K.fieldCricket:
      a2 = c.extra
      a3 = c.sing
      break
    case K.harvestman:
      a3 = c.extra
      break
    case K.woodlouse:
    case K.millipede:
    case K.earthworm:
      a2 = c.curl
      break
    case K.snail:
      a2 = c.curl
      a3 = c.extra
      break
  }
  if (!writeInstance(sys, batch, c.x, y, c.z, c.heading, c.pitch, c.roll, scale, KIND_SUB[k], c.phase, a2, a3, c.tr, c.tg, c.tb, c.variant)) return
  groundLifeRT.visible[GROUND_KINDS[k]]++
  // only creatures out in the open count as met (not one hidden in its burrow)
  if (!c.hidden && c.presence > 0.6 && c.state !== S.hide) {
    const ad = Math.hypot(c.x - sys.avatar.x, c.z - sys.avatar.z)
    if (ad < sys.nearest[k]) {
      sys.nearest[k] = ad
      sys.nearX[k] = c.x
      sys.nearY[k] = c.y
      sys.nearZ[k] = c.z
    }
  }
}

export const GroundLife = (): React.ReactElement => {
  const sys = useMemo(() => makeSystem(), [])

  useEffect(() => {
    const debug = debugEnabled()
    if (debug) {
      window.__worldDev = window.__worldDev || {}
      window.__worldDev.groundLife = {
        stats: () => ({ ...sys.sim.stats(), rt: { ...groundLifeRT, visible: { ...groundLifeRT.visible } }, activity: Array.from(sys.sim.activity) }),
        /** place one of every walker kind (and two ant colonies) around a point, all active */
        showcase: (x?: number | null, z?: number, heading?: number) => {
          if (x === null) {
            sys.sim.showcase = null
            sys.sim.forceActive = false
          } else {
            const body = avatarRT()
            sys.sim.showcase = { x: x ?? body.pos.x, z: z ?? body.pos.z, heading: heading ?? body.facing }
            sys.sim.forceActive = true
          }
          sys.refresh = 0
          sys.lastX = Number.NaN
          return sys.sim.showcase
        },
        force: (on = true) => {
          sys.sim.forceActive = !!on
          return sys.sim.forceActive
        },
        spawn: (kind: string, x?: number, z?: number) => {
          const k = GROUND_KINDS.indexOf(kind as (typeof GROUND_KINDS)[number])
          if (k < 2) return null
          const body = avatarRT()
          const c = sys.sim.spawnAt(k, x ?? body.pos.x + Math.sin(body.facing) * 1.5, z ?? body.pos.z + Math.cos(body.facing) * 1.5)
          return c ? { kind, x: c.x, z: c.z } : null
        },
        creatures: () => sys.sim.pools.flat().filter((c) => c.live).map((c) => ({ kind: GROUND_KINDS[c.kind], x: +c.x.toFixed(2), y: +c.y.toFixed(3), z: +c.z.toFixed(2), state: c.state, presence: +c.presence.toFixed(2), active: c.active, curl: +c.curl.toFixed(2) })),
        ground: (x: number, z: number) => groundHeightAt(x, z),
        colonies: () => sys.sim.colonies.filter((c) => c.live).map((c) => ({ species: GROUND_KINDS[c.species], nx: c.nx, nz: c.nz, length: +c.length.toFixed(2), tree: c.tree, out: +c.out.toFixed(2) })),
      }
    }
    return () => {
      if (debug && window.__worldDev) delete window.__worldDev.groundLife
      for (const b of sys.batches) {
        b.mesh.geometry.dispose()
        ;(b.mesh.material as THREE.Material).dispose()
        b.mesh.dispose()
      }
      groundLifeRT.instances = 0
      groundLifeRT.drawCalls = 0
      groundLifeRT.nearestKind = null
      groundLifeRT.nearestDistance = Infinity
    }
  }, [sys])

  useFrame((state, rawDt) => {
    // on the Moon: home's life waits, paused, for the riders to come back
    if (awayFromEarth(avatarRT().pos)) return
    const dt = Math.min(rawDt, 0.1)
    const show = groundLifeRT.enabled && !worldRT.introActive
    sys.root.visible = show
    if (!show) return
    const time = state.clock.elapsedTime
    groundLifeUniforms.uGLTime.value = time % 3600
    // cancel WorldRoot's −origin: instance matrices are written in render space
    sys.root.position.set(originRT.x, 0, originRT.z)

    const body = avatarRT()
    const px = body.pos.x
    const pz = body.pos.z
    const env = sys.sim.env
    env.tod = worldRT.timeOfDay
    env.rain = weatherRT.rain
    env.snow = weatherRT.snow
    env.cloud = weatherRT.cloud
    env.wet = stepDampness(env.wet, weatherRT.rain, weatherRT.wetness, dt)
    groundLifeRT.dampness = env.wet
    sys.avatar.x = px
    sys.avatar.z = pz
    sys.avatar.speed = body.speed
    sys.avatar.active = true
    sys.cat.x = catRT.pos.x
    sys.cat.z = catRT.pos.z
    sys.cat.speed = catRT.speed
    sys.cat.active = !catRT.hidden

    // Re-plan after walking a little way (or now and then): planning is
    // cached per cell, but there is no need to sort the neighbourhood when
    // The explorer stands still. Activity changes are applied every frame anyway.
    sys.refresh -= dt
    const moved = !(Math.abs(px - sys.lastX) < 1.5 && Math.abs(pz - sys.lastZ) < 1.5)
    if (sys.refresh <= 0 && (moved || sys.refresh < -3)) {
      sys.refresh = REFRESH_INTERVAL
      sys.lastX = px
      sys.lastZ = pz
      sys.sim.capScale = 0.6 + 0.4 * qualityRT.profile.particles
      const anchor = sys.sim.showcase
      sys.sim.refresh(anchor ? anchor.x : px, anchor ? anchor.z : pz)
    }
    sys.sim.step(dt, time, sys.avatar, sys.cat)

    // camera frustum (render space) for per-instance culling
    const cam = state.camera
    sys.pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
    sys.frustum.setFromProjectionMatrix(sys.pv)

    for (let i = 0; i < BATCH_COUNT; i++) sys.batches[i].count = 0
    for (let k = 0; k < KIND_COUNT; k++) groundLifeRT.visible[GROUND_KINDS[k]] = 0
    sys.nearest.fill(Infinity)

    // wandering creatures
    for (let k = 0; k < KIND_COUNT; k++) {
      const pool = sys.sim.pools[k]
      for (let i = 0; i < pool.length; i++) if (pool[i].live) writeCritter(sys, pool[i], px, pz)
    }

    // ant colonies: nests are drawn further out than the ants themselves
    const ants = sys.batches[BATCH.ants]
    const nests = sys.batches[BATCH.nests]
    let colonies = 0
    for (let ci = 0; ci < sys.sim.colonies.length; ci++) {
      const col = sys.sim.colonies[ci]
      if (!col.live) continue
      colonies++
      const nd = Math.hypot(col.nx - px, col.nz - pz)
      if (nd < NEST_VIEW) {
        const wood = col.species === 1
        writeInstance(sys, nests, col.nx, col.ny - (wood ? 0.02 : 0.004), col.nz, (col.nx * 7.3) % (Math.PI * 2), 0, 0, col.size,
          wood ? NEST.woodMound : NEST.gardenNest, 0, 0, 0, 0, 0, 0, 0)
      }
      if (nd > KIND_VIEW[col.species] + col.length) continue
      const runners = col.ants - col.moundAnts
      const out = Math.round(col.out * runners * sys.sim.capScale)
      const tint = ANT_TINT[col.species]
      const scale = KIND_SCALE[col.species]
      for (let i = 0; i < col.ants; i++) {
        if (i >= col.moundAnts && i - col.moundAnts >= out) break
        const pose = sys.sim.evalAnt(col, i, time, sys.pose)
        if (pose.vis <= 0.02) continue
        const ad = Math.hypot(pose.x - px, pose.z - pz)
        if (ad > KIND_VIEW[col.species]) continue
        const size = scale * (0.9 + ((i * 37) % 10) * 0.02) * (0.4 + 0.6 * pose.vis)
        if (!writeInstance(sys, ants, pose.x, pose.y + 0.001, pose.z, pose.heading, pose.pitch, 0, size,
          col.species, pose.gait, pose.wiggle, pose.carry, tint[0], tint[1], tint[2], 0)) continue
        groundLifeRT.visible[GROUND_KINDS[col.species]]++
        if (pose.vis > 0.6 && ad < sys.nearest[col.species]) {
          sys.nearest[col.species] = ad
          sys.nearX[col.species] = pose.x
          sys.nearY[col.species] = pose.y
          sys.nearZ[col.species] = pose.z
        }
      }
    }
    // a burrow at every field cricket's home, even while it hides inside
    const crickets = sys.sim.pools[K.fieldCricket]
    for (let i = 0; i < crickets.length; i++) {
      const c = crickets[i]
      if (!c.live || Math.hypot(c.hx - px, c.hz - pz) > NEST_VIEW * 0.6) continue
      writeInstance(sys, nests, c.hx, c.gy - 0.003, c.hz, c.burrowHeading, 0, 0, 0.13, NEST.burrow, 0, 0, 0, 0, 0, 0, 0)
    }

    let instances = 0
    let drawCalls = 0
    for (let i = 0; i < BATCH_COUNT; i++) {
      const b = sys.batches[i]
      b.mesh.count = b.count
      b.mesh.visible = b.count > 0
      if (b.count > 0) {
        b.mesh.instanceMatrix.needsUpdate = true
        b.anim.needsUpdate = true
        b.tint.needsUpdate = true
        instances += b.count
        drawCalls++
      }
    }
    groundLifeRT.instances = instances
    groundLifeRT.drawCalls = drawCalls
    groundLifeRT.colonies = colonies

    // nearest creature, and field-guide sightings (~2.5 m for ~1 s)
    let best = -1
    for (let k = 0; k < KIND_COUNT; k++) if (sys.nearest[k] < (best < 0 ? Infinity : sys.nearest[best])) best = k
    groundLifeRT.nearestKind = best >= 0 && sys.nearest[best] < Infinity ? GROUND_KINDS[best] : null
    groundLifeRT.nearestDistance = best >= 0 ? sys.nearest[best] : Infinity
    if (best >= 0 && sys.nearest[best] < Infinity) {
      groundLifeRT.nearestX = sys.nearX[best]
      groundLifeRT.nearestY = sys.nearY[best]
      groundLifeRT.nearestZ = sys.nearZ[best]
    }
    const now = time
    const met = updateSightings(sys.dwell, sys.nearest, dt, (k) => now - sys.metAt[k] < 60)
    if (met >= 0 && canCelebrate()) {
      sys.metAt[met] = now
      if (useFieldGuide.getState().markSeen(GROUND_KINDS[met]) && sys.pendingToast < 0) sys.pendingToast = met
    }
    // a gentle toast, waiting politely for any discovery card on screen
    if (sys.pendingToast >= 0 && !useDiscoveries.getState().toast && canCelebrate()) {
      const info = GROUND_LIFE[GROUND_KINDS[sys.pendingToast]]
      useDiscoveries.getState().showToast({ title: `Field guide: ${info.name}`, line: info.toast, kind: "field-guide" })
      sys.pendingToast = -1
    }
  })

  return <primitive object={sys.root} />
}

const canCelebrate = (): boolean => useGame.getState().started && !worldRT.introActive && !worldRT.finaleActive
