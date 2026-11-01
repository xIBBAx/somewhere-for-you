import { useHubFrame } from "../hubGate"
import { useMemo, useRef } from "react"

import * as THREE from "three"
import { groundHeight } from "../world-layout"
import { weatherRT } from "../weather/weatherState"

/**
 * Cute romantic scatters to fill quiet meadow gaps:
 * - tiny heart-shaped stones arranged like love notes on the grass
 * - mini rose bouquets with soft pastel petals
 * - little woven picnic hearts
 * All sway very gently with wind — never colliders, pure eye candy.
 */
const SPOTS: Array<{ x: number; z: number; kind: "heart" | "bouquet" | "woven"; rot: number; scale: number }> = [
  { x: -9.2, z: 5.8, kind: "bouquet", rot: 0.3, scale: 1.0 },
  { x: 9.8, z: -4.6, kind: "heart", rot: -0.4, scale: 0.92 },
  { x: -13.2, z: -1.8, kind: "woven", rot: 0.5, scale: 1.08 },
  { x: 6.8, z: 12.4, kind: "bouquet", rot: -0.2, scale: 0.95 },
  { x: -4.2, z: 9.1, kind: "heart", rot: 0.6, scale: 0.88 },
  { x: 14.2, z: -6.4, kind: "bouquet", rot: 0.2, scale: 1.05 },
  { x: -15.6, z: 3.9, kind: "heart", rot: -0.3, scale: 0.96 },
  { x: 8.4, z: 14.8, kind: "woven", rot: -0.5, scale: 1.0 },
]

const makeHeartShape = (): THREE.Shape => {
  const s = new THREE.Shape()
  s.moveTo(0, -0.08)
  s.bezierCurveTo(-0.14, 0.02, -0.09, 0.14, 0, 0.09)
  s.bezierCurveTo(0.09, 0.14, 0.14, 0.02, 0, -0.08)
  return s
}

export const MeadowScatters = (): React.ReactElement => {
  const heartShape = useMemo(() => makeHeartShape(), [])
  const heartGeo = useMemo(() => new THREE.ShapeGeometry(heartShape, 6), [heartShape])
  const groups = useRef<Array<THREE.Group | null>>([])

  useHubFrame((state) => {
    const t = state.clock.elapsedTime
    const wind = weatherRT.wind
    groups.current.forEach((g, i) => {
      if (!g) return
      const sway = Math.sin(t * 0.9 + i * 1.3) * wind * 0.06
      const bob = Math.sin(t * 1.2 + i) * 0.015
      g.rotation.z = sway
      g.position.y = groundHeight(SPOTS[i].x, SPOTS[i].z) + 0.06 + bob
    })
  })

  return (
    <group>
      {SPOTS.map((spot, i) => {
        const y = groundHeight(spot.x, spot.z)
        return (
          <group
            key={i}
            ref={(r) => {
              groups.current[i] = r
            }}
            position={[spot.x, y + 0.06, spot.z]}
            rotation-y={spot.rot}
            scale={spot.scale}
          >
            {spot.kind === "heart" && (
              <>
                <mesh geometry={heartGeo} rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
                  <meshStandardMaterial color="#ff8aa1" roughness={0.55} />
                </mesh>
                {/* tiny gold edge */}
                <mesh rotation-x={-Math.PI / 2} position={[0, 0.021, 0]}>
                  <shapeGeometry args={[heartShape]} />
                  <meshBasicMaterial color="#ffd1dc" transparent opacity={0.0} />
                </mesh>
                {/* pebble border */}
                <mesh position={[0, -0.015, 0]} rotation-x={Math.PI / 2}>
                  <ringGeometry args={[0.18, 0.2, 16]} />
                  <meshStandardMaterial color="#e8ddd0" roughness={0.9} />
                </mesh>
              </>
            )}
            {spot.kind === "bouquet" && (
              <group>
                {/* woven basket base */}
                <mesh position={[0, 0.04, 0]} castShadow>
                  <cylinderGeometry args={[0.13, 0.15, 0.08, 10]} />
                  <meshStandardMaterial color="#d9b089" roughness={0.85} />
                </mesh>
                {/* 5 pastel roses */}
                {[-2, -1, 0, 1, 2].map((k) => {
                  const angle = (k / 5) * Math.PI * 1.6
                  const r = 0.07 + Math.abs(k) * 0.01
                  const px = Math.cos(angle) * r
                  const pz = Math.sin(angle) * r
                  const col = k % 2 === 0 ? "#ff6b9d" : "#ffb3c6"
                  const col2 = k === 0 ? "#ff8fab" : col
                  return (
                    <group key={k} position={[px, 0.11, pz]}>
                      <mesh>
                        <sphereGeometry args={[0.045, 8, 6]} />
                        <meshStandardMaterial color={col2} roughness={0.6} />
                      </mesh>
                      {/* tiny center */}
                      <mesh position={[0, 0.018, 0]}>
                        <sphereGeometry args={[0.012, 6, 4]} />
                        <meshStandardMaterial color="#fff0c8" roughness={0.5} />
                      </mesh>
                    </group>
                  )
                })}
                {/* green leaves peeking */}
                <mesh position={[0, 0.06, 0]} scale={[1.2, 0.35, 1.2]}>
                  <dodecahedronGeometry args={[0.14, 0]} />
                  <meshStandardMaterial color="#6bbd5a" roughness={0.8} />
                </mesh>
              </group>
            )}
            {spot.kind === "woven" && (
              <group>
                <mesh rotation-x={-Math.PI / 2} position={[0, 0.015, 0]}>
                  <circleGeometry args={[0.22, 16]} />
                  <meshStandardMaterial color="#fff7e8" roughness={0.92} />
                </mesh>
                <mesh rotation-x={-Math.PI / 2} position={[0, 0.018, 0]}>
                  <ringGeometry args={[0.18, 0.22, 16]} />
                  <meshStandardMaterial color="#f5c2d0" roughness={0.8} />
                </mesh>
                {/* centered heart */}
                <mesh geometry={heartGeo} rotation-x={-Math.PI / 2} position={[0, 0.032, 0]}>
                  <meshStandardMaterial color="#ff6b8f" roughness={0.5} />
                </mesh>
                {/* tiny fairy light dots */}
                {[-0.12, 0.12].map((x) => (
                  <mesh key={x} position={[x, 0.09, 0]}>
                    <sphereGeometry args={[0.018, 6, 4]} />
                    <meshStandardMaterial color="#ffe8a8" emissive="#ffba4d" emissiveIntensity={0.6} roughness={0.5} />
                  </mesh>
                ))}
              </group>
            )}
          </group>
        )
      })}
    </group>
  )
}
