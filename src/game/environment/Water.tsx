import { useHubFrame } from "../hubGate"

import { originUniforms } from "../../world/origin"
import { waterWakeUniforms } from "../../world/render/waterWake"
import { useLayoutEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { makeRng, smoothstep } from "../../utils/math"
import { avatarRT, worldRT } from "../runtime"
import { weatherRT } from "../weather/weatherState"
import {
  POND,
  RIVER_MAX_X,
  RIVER_MIN_X,
  WATER_Y,
  groundHeight,
  riverCenterZ,
  riverEnvelope,
  riverHalfWidthAt,
} from "../world-layout"
import { waterFragmentShader, waterVertexShader } from "./water/waterShaders"
import { seatAquaticBank } from "../../world/aquatic/bankGeometry"
import { keyLightDirection } from "./celestialLighting"

const CREEK_SEGMENTS_X = 96
const CREEK_SEGMENTS_Z = 8
const POND_RADIAL_SEGS = 64
const POND_RINGS = 12

// Vibrant natural aquatic palettes
const dayShallow = new THREE.Color("#38bdf8")
const dayDeep = new THREE.Color("#0c4a6e")
const nightShallow = new THREE.Color("#1e3a8a")
const nightDeep = new THREE.Color("#06172e")

const daySky = new THREE.Color("#7dd3fc")
const dayHorizon = new THREE.Color("#bae6fd")
const nightSky = new THREE.Color("#0b192e")
const nightHorizon = new THREE.Color("#132847")

const daySun = new THREE.Color("#fff7ed")
const nightMoon = new THREE.Color("#93c5fd")
const rainSky = new THREE.Color("#94a3b8")
const rainHorizon = new THREE.Color("#cbd5e1")
const weatherTint = new THREE.Color()

const makeCreekGeometry = (edge: number, y: number): THREE.BufferGeometry => {
  const positions: number[] = []
  const uvs: number[] = []
  const depths: number[] = []
  const indices: number[] = []

  for (let i = 0; i <= CREEK_SEGMENTS_X; i++) {
    const tx = i / CREEK_SEGMENTS_X
    const x = THREE.MathUtils.lerp(RIVER_MIN_X, RIVER_MAX_X, tx)
    const envelope = riverEnvelope(x)
    const irregularity = Math.sin(x * 1.17) * 0.06 + Math.sin(x * 0.43 + 1.8) * 0.08
    const halfWidth = Math.max(0.025, riverHalfWidthAt(x) + (edge + irregularity) * envelope)
    const centerZ = riverCenterZ(x)

    for (let j = 0; j <= CREEK_SEGMENTS_Z; j++) {
      const tz = j / CREEK_SEGMENTS_Z
      const z = centerZ - halfWidth + tz * (halfWidth * 2)
      positions.push(x, y, z)
      uvs.push(tx, tz)
      // Natural parabolic creek bed cross-section: 0 at shore banks, 0.45m at mid-channel
      const crossProfile = Math.sin(tz * Math.PI)
      depths.push(crossProfile * 0.45)

      if (i < CREEK_SEGMENTS_X && j < CREEK_SEGMENTS_Z) {
        const row1 = i * (CREEK_SEGMENTS_Z + 1) + j
        const row2 = (i + 1) * (CREEK_SEGMENTS_Z + 1) + j
        indices.push(row1, row2, row1 + 1)
        indices.push(row2, row2 + 1, row1 + 1)
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute("aDepth", new THREE.Float32BufferAttribute(depths, 1))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

const pondRadiusAt = (angle: number, edge: number): number =>
  POND.r + edge + Math.sin(angle * 3 + 0.6) * 0.22 + Math.sin(angle * 7 - 0.3) * 0.1

const makePondGeometry = (edge: number, y: number): THREE.BufferGeometry => {
  const positions: number[] = []
  const uvs: number[] = []
  const depths: number[] = []
  const indices: number[] = []

  // Center vertex: deep bowl epicenter
  positions.push(POND.x, y, POND.z)
  uvs.push(0.5, 0.5)
  depths.push(0.52)

  for (let r = 1; r <= POND_RINGS; r++) {
    const ringFrac = r / POND_RINGS
    const ringDepth = Math.cos(ringFrac * Math.PI * 0.5) * 0.52
    for (let i = 0; i <= POND_RADIAL_SEGS; i++) {
      const angle = (i / POND_RADIAL_SEGS) * Math.PI * 2
      const radius = pondRadiusAt(angle, edge) * ringFrac
      const x = POND.x + Math.cos(angle) * radius * 1.08
      const z = POND.z + Math.sin(angle) * radius * 0.88
      positions.push(x, y, z)
      uvs.push(0.5 + (Math.cos(angle) * ringFrac) * 0.5, 0.5 + (Math.sin(angle) * ringFrac) * 0.5)
      depths.push(ringDepth)

      if (r === 1) {
        if (i < POND_RADIAL_SEGS) {
          indices.push(0, i + 1, i + 2)
        }
      } else {
        if (i < POND_RADIAL_SEGS) {
          const inner = 1 + (r - 2) * (POND_RADIAL_SEGS + 1) + i
          const outer = 1 + (r - 1) * (POND_RADIAL_SEGS + 1) + i
          indices.push(inner, outer, inner + 1)
          indices.push(outer, outer + 1, inner + 1)
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute("aDepth", new THREE.Float32BufferAttribute(depths, 1))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * SOTA Physically-based Living Water:
 * - Multi-scale wave undulation + wind alignment
 * - Schlick's Fresnel reflection + sky/cloud mirror
 * - Depth-dependent Beer-Lambert optical extinction
 * - Substrate caustics + soft shoreline blending
 * - Rain disturbance ripples + interactive player wading wake
 * - Floating fallen gulmohar blossom petals
 */
export const Water = (): React.ReactElement => {
  const creek = useMemo(() => makeCreekGeometry(0, WATER_Y), [])
  const creekBank = useMemo(() => seatAquaticBank(makeCreekGeometry(0.32, WATER_Y - 0.04)), [])
  const pond = useMemo(() => makePondGeometry(0, WATER_Y), [])
  const pondBank = useMemo(() => seatAquaticBank(makePondGeometry(0.32, WATER_Y - 0.05)), [])

  const uniforms = useMemo(
    () => ({
      ...waterWakeUniforms,
      uOriginWrap: originUniforms.uOriginWrap,
      uTime: { value: 0 },
      uWaterY: { value: WATER_Y },
      uSunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      uSunColor: { value: new THREE.Color(daySun) },
      uSkyColor: { value: new THREE.Color(daySky) },
      uHorizonColor: { value: new THREE.Color(dayHorizon) },
      uGroundColor: { value: new THREE.Color("#d4b886") },
      uWaterShallowColor: { value: new THREE.Color(dayShallow) },
      uWaterDeepColor: { value: new THREE.Color(dayDeep) },
      uNight: { value: 0 },
      uWindSpeed: { value: 0.1 },
      uWindDir: { value: 0 },
      uRainIntensity: { value: 0 },
      uWetness: { value: 0 },
      uPlayerPos: { value: new THREE.Vector3() },
    }),
    [],
  )

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: waterVertexShader,
        fragmentShader: waterFragmentShader,
        uniforms,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    [uniforms],
  )

  useHubFrame((state) => {
    const t = state.clock.elapsedTime
    const timeOfDay = worldRT.timeOfDay
    const night = smoothstep(0.55, 0.95, timeOfDay)
    const rain = weatherRT.rain
    const wet = weatherRT.wetness
    const wind = weatherRT.wind
    const windRad = weatherRT.windDirectionRad

    uniforms.uTime.value = t
    uniforms.uNight.value = night
    uniforms.uWindSpeed.value = wind
    uniforms.uWindDir.value = windRad
    uniforms.uRainIntensity.value = rain
    uniforms.uWetness.value = wet

    // Dynamic sun / moon directional lighting
    keyLightDirection(timeOfDay, uniforms.uSunDirection.value)

    uniforms.uSunColor.value.copy(daySun).lerp(nightMoon, night)
    uniforms.uSkyColor.value.copy(daySky).lerp(nightSky, night)
    uniforms.uHorizonColor.value.copy(dayHorizon).lerp(nightHorizon, night)

    // Overcast desaturation when raining
    if (rain > 0.1) {
      uniforms.uSkyColor.value.lerp(weatherTint.copy(rainSky).lerp(nightSky, night), rain * 0.45)
      uniforms.uHorizonColor.value.lerp(weatherTint.copy(rainHorizon).lerp(nightHorizon, night), rain * 0.45)
    }

    // Depth water colors
    uniforms.uWaterShallowColor.value.copy(dayShallow).lerp(nightShallow, night)
    uniforms.uWaterDeepColor.value.copy(dayDeep).lerp(nightDeep, night)

    // Player position for interactive wake
    uniforms.uPlayerPos.value.copy(avatarRT().pos)
  })

  return (
    <group>
      {/* Sandy submerged contact bank */}
      <mesh geometry={creekBank} receiveShadow>
        <meshStandardMaterial color="#cbb387" roughness={0.94} />
      </mesh>
      <mesh geometry={pondBank} receiveShadow>
        <meshStandardMaterial color="#cfb98e" roughness={0.94} />
      </mesh>

      {/* Living Water Surfaces */}
      <mesh geometry={creek} material={material} receiveShadow />
      <mesh geometry={pond} material={material} receiveShadow />

      {/* Reeds, Riverbank Stones & Fallen Gulmohar Petals */}
      <WaterEdgeDetails />
      <FloatingGulmoharPetals />
    </group>
  )
}

const PETAL_COUNT = 24

/**
 * Floating gulmohar blossom petals on the pond surface:
 * Drifts gently with surface wave phase, collects softly near shorelines.
 */
const FloatingGulmoharPetals = (): React.ReactElement => {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])

  const petals = useMemo(() => {
    const rng = makeRng(54921)
    return Array.from({ length: PETAL_COUNT }, () => {
      const angle = rng() * Math.PI * 2
      const rad = 0.5 + rng() * (POND.r - 0.7)
      return {
        x: POND.x + Math.cos(angle) * rad * 1.08,
        z: POND.z + Math.sin(angle) * rad * 0.88,
        scale: 0.08 + rng() * 0.04,
        rot: rng() * Math.PI * 2,
        driftSpeed: 0.12 + rng() * 0.18,
        phase: rng() * Math.PI * 2,
      }
    })
  }, [])

  useHubFrame((state) => {
    if (!mesh.current) return
    const t = state.clock.elapsedTime
    const wind = weatherRT.wind
    const windRad = weatherRT.windDirectionRad

    for (let i = 0; i < PETAL_COUNT; i++) {
      const p = petals[i]
      // Subtle surface bobbing and circular drift
      const driftX = Math.cos(t * p.driftSpeed + p.phase) * 0.15 + Math.cos(windRad) * wind * 0.2
      const driftZ = Math.sin(t * p.driftSpeed + p.phase) * 0.15 + Math.sin(windRad) * wind * 0.2
      const bob = Math.sin(t * 1.2 + p.phase) * 0.008

      dummy.position.set(p.x + driftX, WATER_Y + 0.006 + bob, p.z + driftZ)
      dummy.rotation.set(-Math.PI / 2 + Math.sin(t + p.phase) * 0.05, 0, p.rot + t * 0.08)
      dummy.scale.set(p.scale * 1.3, p.scale * 0.85, 1)
      dummy.updateMatrix()
      mesh.current.setMatrixAt(i, dummy.matrix)
    }
    mesh.current.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, PETAL_COUNT]} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <meshStandardMaterial
        color="#ff7a3c"
        roughness={0.65}
        side={THREE.DoubleSide}
        transparent
        opacity={0.88}
        depthWrite={false}
      />
    </instancedMesh>
  )
}

const REEDS: Array<[number, number, number]> = [
  [-11.9, riverCenterZ(-11.9) - 0.8, -0.12],
  [-11.5, riverCenterZ(-11.5) + 0.75, 0.08],
  [-10.9, riverCenterZ(-10.9) - 1.05, -0.05],
  [11.2, riverCenterZ(11.2) + 0.85, 0.1],
  [11.8, riverCenterZ(11.8) - 0.7, -0.08],
  [12.1, riverCenterZ(12.1) + 0.5, 0.04],
  [POND.x - 2.5, POND.z + 1.25, -0.08],
  [POND.x - 2.75, POND.z + 0.85, 0.06],
  [POND.x + 2.45, POND.z - 0.9, 0.1],
  [POND.x + 2.7, POND.z - 0.35, -0.05],
  [POND.x + 1.7, POND.z + 1.95, 0.04],
]

const STONES: Array<[number, number, number]> = [
  [-12.4, riverCenterZ(-12.4) - 0.25, 0.65],
  [-11.7, riverCenterZ(-11.7) + 0.4, 0.45],
  [11.7, riverCenterZ(11.7) - 0.25, 0.5],
  [12.5, riverCenterZ(12.5) + 0.35, 0.7],
  [POND.x - 2.65, POND.z - 1.0, 0.5],
  [POND.x + 2.55, POND.z + 0.75, 0.55],
  [POND.x + 0.9, POND.z - 2.45, 0.42],
]

const WaterEdgeDetails = (): React.ReactElement => {
  const reeds = useRef<THREE.InstancedMesh>(null)
  const stones = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    const euler = new THREE.Euler()

    REEDS.forEach(([x, z, lean], index) => {
      const height = 0.44 + (index % 3) * 0.09
      position.set(x, groundHeight(x, z) + height / 2, z)
      euler.set(lean, index * 0.91, lean * 0.45)
      quaternion.setFromEuler(euler)
      scale.set(1, height / 0.55, 1)
      matrix.compose(position, quaternion, scale)
      reeds.current?.setMatrixAt(index, matrix)
    })
    if (reeds.current) reeds.current.instanceMatrix.needsUpdate = true

    STONES.forEach(([x, z, size], index) => {
      position.set(x, groundHeight(x, z) + size * 0.11, z)
      euler.set(index * 0.31, index * 1.17, index * 0.19)
      quaternion.setFromEuler(euler)
      scale.set(size, size * 0.55, size * 0.8)
      matrix.compose(position, quaternion, scale)
      stones.current?.setMatrixAt(index, matrix)
    })
    if (stones.current) stones.current.instanceMatrix.needsUpdate = true
  }, [])

  // Responsive wetness for water's edge stones and reeds
  useHubFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const wet = weatherRT.wetness
    if (stones.current) {
      const mat = stones.current.material as THREE.MeshStandardMaterial
      mat.roughness = THREE.MathUtils.damp(mat.roughness, 0.95 - wet * 0.55, 2, dt)
    }
  })

  return (
    <group>
      <instancedMesh ref={reeds} args={[undefined, undefined, REEDS.length]} castShadow>
        <cylinderGeometry args={[0.018, 0.028, 0.55, 5]} />
        <meshStandardMaterial color="#6f9c59" roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={stones} args={[undefined, undefined, STONES.length]} receiveShadow>
        <dodecahedronGeometry args={[0.32, 0]} />
        <meshStandardMaterial color="#aaa89e" roughness={0.95} flatShading />
      </instancedMesh>
    </group>
  )
}
