import { VirtualLight, VirtualPointLight } from "../lightPool"
import { useHubFrame } from "../hubGate"

import { useLayoutEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { smoothstep } from "../../utils/math"
import { worldRT } from "../runtime"
import { PATH_CURVE, groundHeight } from "../world-layout"
import { PALETTE } from "./props"

const LANTERN_STOPS = [0.055, 0.14, 0.225, 0.315, 0.405, 0.5, 0.59, 0.68, 0.765, 0.85, 0.925]

type LanternPoint = { x: number; y: number; z: number }

/** Small pools of warm light guide the authored route after dark. */
export const PathLanterns = (): React.ReactElement => {
  const poles = useRef<THREE.InstancedMesh>(null)
  const bulbs = useRef<THREE.InstancedMesh>(null)
  const caps = useRef<THREE.InstancedMesh>(null)
  const pools = useRef<Array<VirtualPointLight | null>>([])

  const points = useMemo<LanternPoint[]>(
    () =>
      LANTERN_STOPS.map((t, index) => {
        const point = PATH_CURVE.getPointAt(t)
        const tangent = PATH_CURVE.getTangentAt(t).normalize()
        const side = index % 2 === 0 ? 1 : -1
        const offset = 2.05 + (index % 3) * 0.18
        const x = point.x - tangent.z * side * offset
        const z = point.z + tangent.x * side * offset
        return { x, y: groundHeight(x, z), z }
      }),
    [],
  )

  const bulbMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#ffe8a8",
        emissive: "#ffb347",
        emissiveIntensity: 0,
        roughness: 0.48,
      }),
    [],
  )

  useLayoutEffect(() => {
    const matrix = new THREE.Matrix4()
    points.forEach((point, index) => {
      matrix.makeTranslation(point.x, point.y + 0.6, point.z)
      poles.current?.setMatrixAt(index, matrix)
      matrix.makeTranslation(point.x, point.y + 1.27, point.z)
      bulbs.current?.setMatrixAt(index, matrix)
      matrix.makeTranslation(point.x, point.y + 1.42, point.z)
      caps.current?.setMatrixAt(index, matrix)
    })
    if (poles.current) poles.current.instanceMatrix.needsUpdate = true
    if (bulbs.current) bulbs.current.instanceMatrix.needsUpdate = true
    if (caps.current) caps.current.instanceMatrix.needsUpdate = true
  }, [points])

  useHubFrame((state) => {
    const night = smoothstep(0.56, 0.96, worldRT.timeOfDay)
    const breathe = 0.88 + Math.sin(state.clock.elapsedTime * 0.85) * 0.12
    const flicker = 0.96 + Math.sin(state.clock.elapsedTime * 3.7) * 0.04
    bulbMaterial.emissiveIntensity = night * 4.2 * breathe * flicker
    pools.current.forEach((light, index) => {
      if (light) {
        const personal = Math.sin(state.clock.elapsedTime * 0.62 + index * 1.3)
        light.intensity = night * (2.2 + personal * 0.25) * flicker
      }
    })
  })

  return (
    <group>
      <instancedMesh ref={poles} args={[undefined, undefined, points.length]} castShadow>
        <cylinderGeometry args={[0.035, 0.055, 1.2, 7]} />
        <meshStandardMaterial color={PALETTE.woodDark} roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={bulbs} args={[undefined, undefined, points.length]} material={bulbMaterial}>
        <sphereGeometry args={[0.13, 12, 9]} />
      </instancedMesh>
      <instancedMesh ref={caps} args={[undefined, undefined, points.length]}>
        <coneGeometry args={[0.13, 0.13, 8]} />
        <meshStandardMaterial color={PALETTE.woodDark} roughness={0.95} />
      </instancedMesh>
      {points.map((point, index) => (
        <VirtualLight
          key={`${point.x}:${point.z}`}
          ref={(light) => {
            pools.current[index] = light
          }}
          position={[point.x, point.y + 1.15, point.z]}
          color={PALETTE.lantern}
          intensity={0}
          distance={7.5}
          decay={2}
        />
      ))}
    </group>
  )
}
