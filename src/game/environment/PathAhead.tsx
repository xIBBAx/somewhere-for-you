import { useHubFrame } from "../hubGate"

import { useMemo, useRef } from "react"
import * as THREE from "three"
import { useGame } from "../../state/gameStore"
import { makeRng, smoothstep } from "../../utils/math"
import { softStarTexture } from "../../utils/canvasTexture"
import { worldRT } from "../runtime"
import { groundHeight } from "../world-layout"
import { Bench, PALETTE, SignBoard } from "./props"

const SPOT = { x: -4.4, z: -17.8 }
const OVERLOOK_STONES = [
  [-1.15, -0.6, 0.82, 0.2],
  [-0.35, -0.92, 0.74, -0.35],
  [0.55, -0.72, 0.88, 0.4],
  [1.2, -0.15, 0.7, -0.1],
  [0.72, 0.58, 0.82, 0.25],
  [-0.2, 0.7, 0.76, -0.42],
  [-1.05, 0.35, 0.7, 0.1],
] as const

/**
 * A Future We Haven't Seen Yet — a bench, a telescope, and a few early
 * stars that arrive before the sky is ready for them.
 */
export const PathAhead = (): React.ReactElement => {
  const visited = useGame((s) => s.visited["path-ahead"] ?? false)
  const stars = useRef<THREE.Points>(null)
  const y = groundHeight(SPOT.x, SPOT.z)

  const starGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pts: number[] = []
    const rng = makeRng(90210)
    for (let i = 0; i < 14; i++) {
      pts.push(SPOT.x - 3 + rng() * 8, 4.6 + rng() * 3.6, SPOT.z - 5 - rng() * 4)
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])
  const starMap = useMemo(() => softStarTexture(), [])
  const steppingStones = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const t = i / 6
        const x = THREE.MathUtils.lerp(SPOT.x + 1.4, -0.8, t) + Math.sin(i * 1.8) * 0.16
        const z = THREE.MathUtils.lerp(SPOT.z - 0.8, -21.2, t)
        return { x, z, s: 0.82 - t * 0.14 }
      }),
    [],
  )

  useHubFrame((state) => {
    if (stars.current) {
      const mat = stars.current.material as THREE.PointsMaterial
      const base = visited ? 0.9 : smoothstep(0.5, 0.9, worldRT.timeOfDay)
      mat.opacity = base * (0.75 + Math.sin(state.clock.elapsedTime * 1.3) * 0.25)
    }
  })

  return (
    <group>
      {/* irregular stone mosaic: a quiet overlook, without another geometric clearing disc */}
      {OVERLOOK_STONES.map(([dx, dz, scale, rotation], i) => (
        <mesh
          key={i}
          position={[SPOT.x + 0.2 + dx, y + 0.035, SPOT.z + dz]}
          rotation-y={rotation}
          scale={[scale * 1.25, 1, scale]}
          receiveShadow
        >
          <cylinderGeometry args={[0.7, 0.76, 0.08, 7]} />
          <meshStandardMaterial
            color={i % 2 ? "#c8b696" : "#d8c6a4"}
            emissive="#5d4b36"
            emissiveIntensity={0.1}
            roughness={1}
          />
        </mesh>
      ))}
      <Bench position={[SPOT.x, y, SPOT.z + 0.6]} rotationY={0.35} />
      <SignBoard
        text="still ahead..."
        position={[SPOT.x - 2.25, y, SPOT.z + 1.1]}
        rotationY={0.32}
        width={1.35}
      />
      {/* two tiny cups on the bench: a quiet visual promise rather than an exposition card */}
      {[-0.24, 0.04].map((x, i) => (
        <group key={x} position={[SPOT.x + x, y + 0.41, SPOT.z + 0.62]} rotation-y={0.35}>
          <mesh>
            <cylinderGeometry args={[0.055, 0.045, 0.09, 10]} />
            <meshStandardMaterial color={i === 0 ? "#f7ead6" : "#cfa9e8"} roughness={0.8} />
          </mesh>
          <mesh position={[0.058, 0, 0]} rotation-x={Math.PI / 2}>
            <torusGeometry args={[0.025, 0.008, 5, 10]} />
            <meshStandardMaterial color={i === 0 ? "#f7ead6" : "#cfa9e8"} />
          </mesh>
        </group>
      ))}
      {/* telescope */}
      <group position={[SPOT.x + 1.6, y, SPOT.z - 0.4]}>
        <mesh position={[0, 0.4, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.8, 6]} />
          <meshStandardMaterial color={PALETTE.woodDark} />
        </mesh>
        <mesh position={[0.1, 0.85, 0.1]} rotation={[0.9, 0.4, 0]}>
          <cylinderGeometry args={[0.07, 0.09, 0.5, 10]} />
          <meshStandardMaterial color="#5c6b7a" roughness={0.5} metalness={0.4} />
        </mesh>
        <mesh position={[-0.02, 1.02, -0.03]} rotation={[0.9, 0.4, 0]}>
          <cylinderGeometry args={[0.11, 0.11, 0.12, 12]} />
          <meshStandardMaterial color="#d7b66e" roughness={0.45} metalness={0.35} />
        </mesh>
        {[
          [0.18, -0.1],
          [-0.14, 0.12],
        ].map(([dx, dz], i) => (
          <mesh key={i} position={[dx, 0.35, dz]} rotation-z={dx > 0 ? -0.25 : 0.25}>
            <cylinderGeometry args={[0.02, 0.02, 0.8, 5]} />
            <meshStandardMaterial color={PALETTE.woodDark} />
          </mesh>
        ))}
      </group>
      {/* a faint trail of future-light leads naturally toward the bridge */}
      {steppingStones.map((stone, i) => {
        const sy = groundHeight(stone.x, stone.z)
        const glow = visited ? 0.55 : smoothstep(0.5, 0.95, worldRT.timeOfDay) * 0.35
        return (
          <mesh
            key={i}
            position={[stone.x, sy + 0.035, stone.z]}
            rotation-x={-Math.PI / 2}
            rotation-z={i * 0.62}
            scale={[stone.s, stone.s * 0.68, 1]}
            receiveShadow
          >
            <circleGeometry args={[0.42, 10]} />
            <meshStandardMaterial
              color="#efe2c4"
              emissive="#e8c47a"
              emissiveIntensity={glow}
              roughness={0.95}
            />
          </mesh>
        )
      })}
      <points ref={stars} geometry={starGeo}>
        <pointsMaterial
          map={starMap}
          color="#fff6dd"
          size={0.34}
          transparent
          opacity={0}
          depthWrite={false}
          alphaTest={0.025}
          blending={THREE.AdditiveBlending}
          sizeAttenuation
        />
      </points>
    </group>
  )
}
