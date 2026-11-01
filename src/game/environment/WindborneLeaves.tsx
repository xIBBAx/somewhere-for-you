import { useHubFrame } from "../hubGate"

import { useLayoutEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { makeRng, smoothstep } from "../../utils/math"
import { HOME_CENTER, HOME_RADIUS, TREES, groundHeight } from "../world-layout"
import { weatherRT } from "../weather/weatherState"

import { GULMOHAR_TREES } from "./GulmoharTrees"

const AIRBORNE_COUNT = 64
const FALLEN_COUNT = 96

// warm leaf and gulmohar blossom colours
const LEAF_COLORS = [
  "#4ade80", // bright spring emerald
  "#22c55e", // rich meadow green
  "#86efac", // light lime green
  "#a3e635", // sunny chartreuse
  "#facc15", // golden amber
  "#fb923c", // warm maple orange
  "#ff9a5a", // gulmohar orange
  "#f4502a", // gulmohar vermilion
  "#fda4af", // peach blossom petal
  "#34d399", // soft mint jade
  "#65a30d", // deep olive green
]

type AirborneLeaf = {
  position: THREE.Vector3
  sourceIndex: number
  age: number
  life: number
  nextSpawn: number
  phase: number
  size: number
  colorIndex: number
  tumbleSpeed: number
  active: boolean
}

const leafSources = [
  ...TREES.slice(30).filter((_, index) => index % 2 === 0).map((t) => ({ x: t.x, z: t.z, s: t.s })),
  ...GULMOHAR_TREES.map((c) => ({ x: c.x, z: c.z, s: c.scale })),
]

const makeLeafGeometry = (): THREE.BufferGeometry => {
  const shape = new THREE.Shape()
  // Cute curved pointed leaf outline
  shape.moveTo(0, -0.5)
  shape.bezierCurveTo(0.35, -0.25, 0.45, 0.35, 0, 0.75)
  shape.bezierCurveTo(-0.45, 0.35, -0.35, -0.25, 0, -0.5)
  const geo = new THREE.ShapeGeometry(shape, 8)
  geo.computeVertexNormals()
  return geo
}

/**
 * Natural windborne leaves:
 * Realistically shaped pointed leaves fluttering gracefully on the breeze.
 * Lit by the world so fallen and airborne leaves darken naturally after sunset.
 */
export const WindborneLeaves = (): React.ReactElement => {
  const airborne = useRef<THREE.InstancedMesh>(null)
  const fallen = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const leafGeo = useMemo(() => makeLeafGeometry(), [])

  const reducedMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  )

  const leaves = useMemo<AirborneLeaf[]>(() => {
    const rng = makeRng(8302026)
    return Array.from({ length: AIRBORNE_COUNT }, (_, index) => ({
      position: new THREE.Vector3(0, -20, 0),
      sourceIndex: index % Math.max(1, leafSources.length),
      age: 0,
      life: 5.2 + rng() * 4.5,
      nextSpawn: 0.5 + rng() * 6.0,
      phase: rng() * Math.PI * 2,
      size: 0.045 + rng() * 0.035,
      colorIndex: index % LEAF_COLORS.length,
      tumbleSpeed: 1.2 + rng() * 2.2,
      active: false,
    }))
  }, [])

  useLayoutEffect(() => {
    if (airborne.current) {
      leaves.forEach((leaf, index) => {
        airborne.current?.setColorAt(index, new THREE.Color(LEAF_COLORS[leaf.colorIndex]))
      })
      if (airborne.current.instanceColor) airborne.current.instanceColor.needsUpdate = true
    }

    if (!fallen.current) return
    const rng = makeRng(31877)
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    const euler = new THREE.Euler()
    for (let index = 0; index < FALLEN_COUNT; index++) {
      const source = leafSources[index % Math.max(1, leafSources.length)]
      if (!source) continue
      const angle = rng() * Math.PI * 2
      const radius = 0.6 + rng() * 2.8
      const x = source.x + Math.cos(angle) * radius
      const z = source.z + Math.sin(angle) * radius
      position.set(x, groundHeight(x, z) + 0.018, z)
      euler.set(-Math.PI / 2 + (rng() - 0.5) * 0.25, rng() * Math.PI * 2, (rng() - 0.5) * 0.2)
      quaternion.setFromEuler(euler)
      const size = 0.055 + rng() * 0.045
      scale.set(size * 1.2, size, size)
      matrix.compose(position, quaternion, scale)
      fallen.current.setMatrixAt(index, matrix)
      fallen.current.setColorAt(index, new THREE.Color(LEAF_COLORS[(index * 3) % LEAF_COLORS.length]))
    }
    fallen.current.instanceMatrix.needsUpdate = true
    if (fallen.current.instanceColor) fallen.current.instanceColor.needsUpdate = true
  }, [leaves])

  useHubFrame((state, rawDt) => {
    const mesh = airborne.current
    if (!mesh) return
    const dt = Math.min(Math.max(rawDt, 1e-4), 1 / 20)
    const time = state.clock.elapsedTime
    const measuredAndGust = Math.min(1, weatherRT.wind + weatherRT.gust * 0.85)
    // Continuous gentle drift even during peaceful sunny conditions
    const activity = reducedMotion ? 0 : smoothstep(0.02, 0.35, measuredAndGust)
    const direction = weatherRT.windDirectionRad
    const windX = Math.cos(direction)
    const windZ = Math.sin(direction)

    leaves.forEach((leaf, index) => {
      if (!leaf.active && activity > 0.01 && time >= leaf.nextSpawn) {
        const source = leafSources[leaf.sourceIndex % Math.max(1, leafSources.length)]
        if (source) {
          const offset = Math.sin(leaf.phase + time * 0.2)
          leaf.position.set(
            source.x + offset * source.s * 0.6,
            groundHeight(source.x, source.z) + source.s * (1.4 + (index % 4) * 0.15),
            source.z + Math.cos(leaf.phase) * source.s * 0.55,
          )
          leaf.age = 0
          leaf.life = 5.2 + ((index * 17) % 29) * 0.15
          leaf.active = true
        }
      }

      if (leaf.active) {
        leaf.age += dt
        const swirl = Math.sin(time * 2.4 + leaf.phase + leaf.age * 1.8)
        const crossX = -windZ * swirl * 0.45
        const crossZ = windX * swirl * 0.45
        const speed = 0.75 + measuredAndGust * 3.4
        leaf.position.x += (windX * speed + crossX) * dt
        leaf.position.z += (windZ * speed + crossZ) * dt
        // Gentle undulating aerodynamic lift and descent
        leaf.position.y += (Math.sin(time * 3.2 + leaf.phase) * 0.42 - 0.16 + activity * 0.15) * dt

        const ground = groundHeight(leaf.position.x, leaf.position.z)
        const homeDistance = Math.hypot(
          leaf.position.x - HOME_CENTER.x,
          leaf.position.z - HOME_CENTER.y,
        )
        if (
          leaf.age >= leaf.life ||
          leaf.position.y <= ground + 0.035 ||
          homeDistance > HOME_RADIUS + 4
        ) {
          leaf.active = false
          leaf.sourceIndex = (leaf.sourceIndex + 5 + (index % 3)) % Math.max(1, leafSources.length)
          leaf.nextSpawn = time + 2.0 + ((index * 11) % 23) * 0.3
        }
      }

      if (!leaf.active) {
        dummy.position.set(0, -20, 0)
        dummy.scale.setScalar(0.001)
      } else {
        const fade = Math.min(1, (leaf.life - leaf.age) * 1.5)
        dummy.position.copy(leaf.position)
        // Natural leaf tumbling and fluttering in 3D air currents
        dummy.rotation.set(
          time * leaf.tumbleSpeed + leaf.phase,
          time * (leaf.tumbleSpeed * 0.8) + leaf.phase * 1.3,
          Math.sin(time * 2.5 + leaf.phase) * 0.6,
        )
        dummy.scale.set(leaf.size * 1.6 * fade, leaf.size * fade, leaf.size * 0.4 * fade)
      }
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.visible = leaves.some((leaf) => leaf.active)
  })

  return (
    <group>
      {/* Fallen leaves on meadow */}
      <instancedMesh ref={fallen} args={[leafGeo, undefined, FALLEN_COUNT]} receiveShadow>
        <meshLambertMaterial
          vertexColors
          side={THREE.DoubleSide}
        />
      </instancedMesh>

      {/* Airborne drifting leaves — warmly illuminated with sunny leaf translucency */}
      <instancedMesh
        ref={airborne}
        args={[leafGeo, undefined, AIRBORNE_COUNT]}
        frustumCulled={false}
        castShadow
      >
        <meshLambertMaterial
          vertexColors
          color="#ffffff"
          side={THREE.DoubleSide}
        />
      </instancedMesh>
    </group>
  )
}
