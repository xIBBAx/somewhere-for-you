import { useHubFrame } from "../hubGate"

import { useMemo, useRef, useState } from "react"
import * as THREE from "three"
import { useGame } from "../../state/gameStore"
import { makeRng, smoothstep } from "../../utils/math"
import { avatarRT, worldRT } from "../runtime"
import { weatherRT } from "../weather/weatherState"
import { groundHeight } from "../world-layout"
import { Bench, Lantern, PALETTE } from "./props"

const SPOT = { x: 10.8, z: -15.6 }
const RAIN_COUNT = 70
const RAIN_RADIUS = 2.6

/**
 * Rainy Little Moment — one umbrella, one bench, localized cozy rain.
 * When world weather is rainy, the global rain covers the whole world
 * and this spot simply becomes a sheltered bench. When weather is dry,
 * activating its memory briefly shows a cinematic vignette (see
 * MemoryAnchors). No permanent localized storm next to sunshine.
 */
export const RainSpot = (): React.ReactElement => {
  const visited = useGame((s) => s.visited["rain-spot"] ?? false)
  const activeMemoryId = useGame((s) => s.activeMemoryId)
  const rain = useRef<THREE.InstancedMesh>(null)
  const drops = useMemo(() => {
    const rng = makeRng(20260829)
    return Array.from({ length: RAIN_COUNT }, () => ({
      x: SPOT.x + (rng() - 0.5) * RAIN_RADIUS * 2,
      z: SPOT.z + (rng() - 0.5) * RAIN_RADIUS * 2,
      y: 2.2 + rng() * 2.4,
      v: 5.5 + rng() * 2.5,
    }))
  }, [])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const y = groundHeight(SPOT.x, SPOT.z)

  useHubFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    // Global weather owns rain. Local rain only as a memory vignette or when it is already raining worldwide.
    const isCinematic = activeMemoryId === "rain-spot"
    const globalRaining = weatherRT.rain > 0.18
    const shouldRain = isCinematic || (globalRaining && weatherRT.wetness > 0.12)
    const mat = rain.current?.material as THREE.MeshBasicMaterial | undefined
    if (mat) {
      const target = shouldRain ? 0.72 : 0
      mat.opacity = THREE.MathUtils.damp(mat.opacity, target, 5, dt)
      if (rain.current) rain.current.visible = mat.opacity > 0.01
    }
    const dx = avatarRT().pos.x - SPOT.x
    const dz = avatarRT().pos.z - SPOT.z
    const near = dx * dx + dz * dz < 196
    if (!rain.current || !near || !shouldRain) return
    for (let i = 0; i < RAIN_COUNT; i++) {
      const d = drops[i]
      d.y -= d.v * dt * (isCinematic ? 1 : 0.9 + weatherRT.rain * 0.4)
      if (d.y < 0.02) {
        d.y = 2.2 + ((i * 0.73 + d.v) % 2.4)
        d.x = SPOT.x + ((((i * 37) % 97) / 97) - 0.5) * RAIN_RADIUS * 2
        d.z = SPOT.z + ((((i * 61) % 89) / 89) - 0.5) * RAIN_RADIUS * 2
      }
      // keep the umbrella dry
      const underUmbrella =
        Math.hypot(d.x - SPOT.x, d.z - SPOT.z) < 1.15 && d.y < 1.75
      dummy.position.set(d.x, underUmbrella ? 1.8 : d.y, d.z)
      dummy.updateMatrix()
      rain.current.setMatrixAt(i, dummy.matrix)
    }
    rain.current.instanceMatrix.needsUpdate = true
  })

  // wetness of the bench micro-climate – global rain or memory vignette only
  const wetGround = useRef<THREE.MeshStandardMaterial>(null)
  const puddleMats = useRef<Array<THREE.MeshStandardMaterial | null>>([])
  useHubFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const isCinematic = useGame.getState().activeMemoryId === "rain-spot"
    const targetWet = isCinematic ? 1 : weatherRT.wetness > 0.15 ? weatherRT.wetness : 0
    if (wetGround.current) {
      const want = targetWet > 0 ? 0.28 * Math.min(1, targetWet * 1.2) : 0
      wetGround.current.opacity = THREE.MathUtils.damp(wetGround.current.opacity, want, 1.5, dt)
    }
    puddleMats.current.forEach((m) => {
      if (!m) return
      const want = targetWet > 0 ? 0.6 : 0
      m.opacity = THREE.MathUtils.damp(m.opacity, want, 2, dt)
    })
  })

  return (
    <group>
      {/* darker wet ground – only when globally wet or during the memory vignette */}
      <mesh position={[SPOT.x, y + 0.018, SPOT.z]} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[3.25, 32]} />
        <meshStandardMaterial
          ref={wetGround}
          color="#668f7d"
          transparent
          opacity={0}
          roughness={0.35}
          depthWrite={false}
        />
      </mesh>
      {/* bench under umbrella */}
      <Bench position={[SPOT.x, y, SPOT.z]} rotationY={-2.2} />
      <group position={[SPOT.x, y, SPOT.z]}>
        <mesh position={[0.15, 1.05, 0.15]} rotation-z={0.12}>
          <cylinderGeometry args={[0.03, 0.04, 2.1, 8]} />
          <meshStandardMaterial color={PALETTE.woodDark} roughness={0.9} />
        </mesh>
        <mesh position={[0, 2.0, 0]} rotation-x={-0.18} rotation-z={0.1} castShadow>
          <coneGeometry args={[1.25, 0.5, 10]} />
          <meshStandardMaterial color="#c86e5a" roughness={0.9} flatShading />
        </mesh>
        <mesh position={[0, 2.3, 0]}>
          <sphereGeometry args={[0.05, 8, 6]} />
          <meshStandardMaterial color={PALETTE.woodDark} />
        </mesh>
      </group>
      {/* warm lantern once visited / in the evening */}
      <RainLantern position={[SPOT.x + 1.5, y, SPOT.z + 1.2]} visited={visited} />
      {/* puddles – tied to the same wetness */}
      {[
        [SPOT.x - 1.4, SPOT.z + 1.8, 0.7],
        [SPOT.x + 2.1, SPOT.z - 0.6, 0.5],
      ].map(([px, pz, r], i) => (
        <group key={i} position={[px, groundHeight(px, pz) + 0.03, pz]} rotation-x={-Math.PI / 2}>
          <mesh>
            <circleGeometry args={[r, 18]} />
            <meshStandardMaterial
              ref={(m) => {
                puddleMats.current[i] = m
              }}
              color="#91bac8"
              transparent
              opacity={0}
              roughness={0.12}
              depthWrite={false}
            />
          </mesh>
          <RipplePuddle radius={r} phase={i * 1.7} />
        </group>
      ))}
      {/* rain */}
      <instancedMesh ref={rain} args={[undefined, undefined, RAIN_COUNT]}>
        <boxGeometry args={[0.025, 0.28, 0.025]} />
        <meshBasicMaterial color="#d7ebf4" transparent opacity={0.72} depthWrite={false} />
      </instancedMesh>
    </group>
  )
}

const RipplePuddle = ({
  radius,
  phase,
}: {
  radius: number
  phase: number
}): React.ReactElement => {
  const ring = useRef<THREE.Mesh>(null)
  useHubFrame((state) => {
    if (!ring.current) return
    const isCinematic = useGame.getState().activeMemoryId === "rain-spot"
    const targetWet = isCinematic ? 1 : weatherRT.wetness > 0.12 ? 1 : 0
    if (targetWet === 0) {
      ;(ring.current.material as THREE.MeshBasicMaterial).opacity = 0
      return
    }
    const pulse = (state.clock.elapsedTime * 0.42 + phase) % 1
    ring.current.scale.setScalar(0.4 + pulse * 0.9)
    const base = (1 - pulse) * 0.36
    // damp with wetness so puddles fade out cleanly when drying
    ;(ring.current.material as THREE.MeshBasicMaterial).opacity = base * Math.min(1, weatherRT.wetness * 1.5 + (isCinematic ? 0.6 : 0))
  })
  return (
    <mesh ref={ring} position={[0, 0, 0.012]}>
      <ringGeometry args={[radius * 0.38, radius * 0.43, 22]} />
      <meshBasicMaterial color="#d8edf3" transparent opacity={0} depthWrite={false} />
    </mesh>
  )
}

const RainLantern = ({
  position,
  visited,
}: {
  position: [number, number, number]
  visited: boolean
}): React.ReactElement => {
  const [lit, setLit] = useState(visited ? 1 : 0)
  const last = useRef(lit)
  useHubFrame(() => {
    const target = visited ? 1 : Math.round(smoothstep(0.55, 0.85, worldRT.timeOfDay) * 4) / 4
    if (target !== last.current) {
      last.current = target
      setLit(target)
    }
  })
  return <Lantern position={position} lit={lit} scale={0.85} />
}
