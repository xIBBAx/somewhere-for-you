import { useHubFrame } from "../hubGate"

import { useLayoutEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { groundHeight, HOME_CENTER, HOME_RADIUS, distToPath, CLEARINGS } from "../world-layout"
import { weatherRT } from "../weather/weatherState"
import { avatarRT, catRT } from "../runtime"
import { makeRng } from "../../utils/math"
import { makeDandelionFluff } from "./dandelionGeometry"

const DANDELION_GROUND_COUNT = 64
const AIRBORNE_SEED_COUNT = 48

type AirborneDandelion = {
  pos: THREE.Vector3
  vel: THREE.Vector3
  rot: THREE.Euler
  rotSpeed: THREE.Vector3
  scale: number
  phase: number
  baseHeight: number
  scatterTime: number
}

const seedDummy = new THREE.Object3D()
const tempQuat = new THREE.Quaternion()

export const Dandelions = (): React.ReactElement => {
  const bloomMesh = useRef<THREE.InstancedMesh>(null)
  const clockMesh = useRef<THREE.InstancedMesh>(null)
  const stemMesh = useRef<THREE.InstancedMesh>(null)
  const seedsMesh = useRef<THREE.InstancedMesh>(null)
  const seedGeometry = useMemo(() => makeDandelionFluff(false), [])
  const clockGeometry = useMemo(() => makeDandelionFluff(true), [])

  // 1) Compute ground dandelion positions (blooms vs fluffy seed clocks)
  const { blooms, clocks, stems } = useMemo(() => {
    const rng = makeRng(419827)
    const blooms: Array<{ matrix: THREE.Matrix4; color: THREE.Color }> = []
    const clocks: Array<{ matrix: THREE.Matrix4; color: THREE.Color }> = []
    const stems: Array<{ matrix: THREE.Matrix4 }> = []

    const m = new THREE.Matrix4()
    const p = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const s = new THREE.Vector3()

    let count = 0
    let guard = 0
    while (count < DANDELION_GROUND_COUNT && guard < 600) {
      guard++
      const a = rng() * Math.PI * 2
      const r = 3.5 + rng() * (HOME_RADIUS - 4.5)
      const x = HOME_CENTER.x + Math.cos(a) * r
      const z = HOME_CENTER.y + Math.sin(a) * r

      const inAnyClearing = CLEARINGS.some((c) => Math.hypot(x - c.x, z - c.z) < c.r)
      if (distToPath(x, z) < 1.2 || inAnyClearing) continue
      const y = groundHeight(x, z)
      const scale = 0.75 + rng() * 0.45
      const stemHeight = 0.22 * scale

      // Stem
      p.set(x, y + stemHeight * 0.5, z)
      e.set((rng() - 0.5) * 0.15, rng() * Math.PI * 2, (rng() - 0.5) * 0.15)
      q.setFromEuler(e)
      s.set(0.018 * scale, stemHeight, 0.018 * scale)
      m.compose(p, q, s)
      stems.push({ matrix: m.clone() })

      // Head: 55% yellow blooms, 45% white seed clocks (puffballs)
      const isClock = rng() < 0.45
      p.set(x, y + stemHeight, z)
      if (isClock) {
        s.setScalar(0.075 * scale)
        m.compose(p, q, s)
        clocks.push({
          matrix: m.clone(),
          color: new THREE.Color(rng() < 0.5 ? "#ffffff" : "#f1f5f9"),
        })
      } else {
        s.set(0.09 * scale, 0.04 * scale, 0.09 * scale)
        m.compose(p, q, s)
        blooms.push({
          matrix: m.clone(),
          color: new THREE.Color(rng() < 0.5 ? "#facc15" : "#eab308"),
        })
      }
      count++
    }

    return { blooms, clocks, stems }
  }, [])

  // 2) Initialize airborne dandelion seeds (flying fluff)
  const airborneSeeds = useMemo<AirborneDandelion[]>(() => {
    const rng = makeRng(928471)
    return Array.from({ length: AIRBORNE_SEED_COUNT }, () => {
      const a = rng() * Math.PI * 2
      const r = rng() * (HOME_RADIUS - 2.5)
      const x = HOME_CENTER.x + Math.cos(a) * r
      const z = HOME_CENTER.y + Math.sin(a) * r
      const gh = groundHeight(x, z)
      const baseHeight = 0.5 + rng() * 2.8
      return {
        pos: new THREE.Vector3(x, gh + baseHeight, z),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(rng() * Math.PI, rng() * Math.PI * 2, rng() * Math.PI),
        rotSpeed: new THREE.Vector3((rng() - 0.5) * 1.5, (rng() - 0.5) * 2.0, (rng() - 0.5) * 1.5),
        scale: 0.045 + rng() * 0.025,
        phase: rng() * Math.PI * 2,
        baseHeight,
        scatterTime: 0,
      }
    })
  }, [])

  // Set initial matrices & colors
  useLayoutEffect(() => {
    if (stemMesh.current) {
      stems.forEach((st, i) => stemMesh.current?.setMatrixAt(i, st.matrix))
      stemMesh.current.instanceMatrix.needsUpdate = true
    }
    if (bloomMesh.current) {
      blooms.forEach((b, i) => {
        bloomMesh.current?.setMatrixAt(i, b.matrix)
        bloomMesh.current?.setColorAt(i, b.color)
      })
      bloomMesh.current.instanceMatrix.needsUpdate = true
      if (bloomMesh.current.instanceColor) bloomMesh.current.instanceColor.needsUpdate = true
    }
    if (clockMesh.current) {
      clocks.forEach((c, i) => {
        clockMesh.current?.setMatrixAt(i, c.matrix)
        clockMesh.current?.setColorAt(i, c.color)
      })
      clockMesh.current.instanceMatrix.needsUpdate = true
      if (clockMesh.current.instanceColor) clockMesh.current.instanceColor.needsUpdate = true
    }
  }, [blooms, clocks, stems])

  // Airborne Dandelion Physics Simulation
  useHubFrame((state, rawDt) => {
    const mesh = seedsMesh.current
    if (!mesh) return
    const dt = Math.min(Math.max(rawDt, 1e-4), 1 / 20)
    const t = state.clock.elapsedTime

    const windSpeed = 0.4 + weatherRT.wind * 2.4 + weatherRT.gust * 1.2
    const windDir = weatherRT.windDirectionRad
    const windX = Math.cos(windDir) * windSpeed
    const windZ = Math.sin(windDir) * windSpeed

    const pPos = avatarRT().pos
    const cPos = catRT.pos

    for (let i = 0; i < airborneSeeds.length; i++) {
      const s = airborneSeeds[i]

      // Wind drift + thermal lift
      const thermal = Math.sin(t * 1.4 + s.phase) * 0.35 + Math.cos(t * 0.7 + s.phase * 2) * 0.15
      s.vel.x = windX * (0.6 + Math.sin(t + s.phase) * 0.3)
      s.vel.z = windZ * (0.6 + Math.cos(t + s.phase) * 0.3)
      s.vel.y = thermal * 0.25 - 0.05 // slight gravity balanced by wind lift

      // Player & Cat proximity interaction (swirling scatter)
      const dPlayer = Math.hypot(s.pos.x - pPos.x, s.pos.z - pPos.z)
      const dCat = Math.hypot(s.pos.x - cPos.x, s.pos.z - cPos.z)
      if (dPlayer < 2.0) {
        const angle = Math.atan2(s.pos.z - pPos.z, s.pos.x - pPos.x)
        s.vel.x += Math.cos(angle) * (avatarRT().speed + 1.2) * 1.5
        s.vel.z += Math.sin(angle) * (avatarRT().speed + 1.2) * 1.5
        s.vel.y += 1.8 // burst upwards
      }
      if (dCat < 1.6) {
        const angle = Math.atan2(s.pos.z - cPos.z, s.pos.x - cPos.x)
        s.vel.x += Math.cos(angle) * 2.0
        s.vel.z += Math.sin(angle) * 2.0
        s.vel.y += 1.2
      }

      s.pos.x += s.vel.x * dt
      s.pos.y += s.vel.y * dt
      s.pos.z += s.vel.z * dt

      // Ground clearance & world wrapping
      const gh = groundHeight(s.pos.x, s.pos.z)
      if (s.pos.y < gh + 0.25) {
        s.pos.y = gh + 0.25 + Math.random() * 0.4
      } else if (s.pos.y > gh + 4.5) {
        s.pos.y = gh + 4.5
      }

      const distCenter = Math.hypot(s.pos.x - HOME_CENTER.x, s.pos.z - HOME_CENTER.y)
      if (distCenter > HOME_RADIUS) {
        // Wrap around upstream
        const upWindAngle = windDir + Math.PI + (Math.random() - 0.5) * 1.2
        s.pos.x = HOME_CENTER.x + Math.cos(upWindAngle) * (HOME_RADIUS - 1.5)
        s.pos.z = HOME_CENTER.y + Math.sin(upWindAngle) * (HOME_RADIUS - 1.5)
        s.pos.y = groundHeight(s.pos.x, s.pos.z) + 0.8 + Math.random() * 2.0
      }

      // Rotation
      s.rot.x += s.rotSpeed.x * dt
      s.rot.y += s.rotSpeed.y * dt
      s.rot.z += s.rotSpeed.z * dt

      tempQuat.setFromEuler(s.rot)
      seedDummy.position.copy(s.pos)
      seedDummy.quaternion.copy(tempQuat)
      seedDummy.scale.setScalar(s.scale)
      seedDummy.updateMatrix()
      mesh.setMatrixAt(i, seedDummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      {/* Ground Dandelion Stems */}
      <instancedMesh ref={stemMesh} args={[undefined, undefined, stems.length]}>
        <cylinderGeometry args={[1, 1, 1, 5]} />
        <meshStandardMaterial color="#65a30d" roughness={0.88} />
      </instancedMesh>

      {/* Ground Yellow Blooming Dandelions */}
      <instancedMesh ref={bloomMesh} args={[undefined, undefined, blooms.length]} castShadow>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial roughness={0.72} flatShading />
      </instancedMesh>

      {/* Ground Fluffy White Dandelion Seed Clocks (Puffballs) */}
      <instancedMesh ref={clockMesh} args={[clockGeometry, undefined, clocks.length]}>
        <meshStandardMaterial roughness={0.95} vertexColors side={THREE.DoubleSide} />
      </instancedMesh>

      {/* Windborne Flying Dandelion Fluff Particles */}
      <instancedMesh name="dandelion-seeds" ref={seedsMesh} args={[seedGeometry, undefined, AIRBORNE_SEED_COUNT]}>
        <meshStandardMaterial roughness={0.95} vertexColors side={THREE.DoubleSide} />
      </instancedMesh>
    </group>
  )
}
