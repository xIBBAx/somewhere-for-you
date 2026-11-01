import { useHubFrame } from "../hubGate"

import { useMemo, useRef } from "react"
import * as THREE from "three"
import { groundHeight, TRAINING } from "../world-layout"
import { makeBuiltGroundMaterial } from "./ground/builtGroundMaterial"
import { sfx } from "../audio/audio"
import { spawnBurst } from "../particles/sparkles"
import { PALETTE, SignBoard } from "./props"
import { avatarRT, worldRT } from "../runtime"

const CORNER = TRAINING

/**
 * The practice corner. Interacting: stance → combo →
 * bag swings → the gym cat copies her paw motion → sparkle reward.
 */
export const TrainingCorner = (): React.ReactElement => {
  const previousTime = useRef(-1)
  const swing = useRef({ angle: 0, velocity: 0, x: 1, z: 0 })
  const bag = useRef<THREE.Group>(null)
  const gymCat = useRef<THREE.Group>(null)
  const gymCatPaw = useRef<THREE.Group>(null)
  const y = groundHeight(CORNER.x, CORNER.z)

  useHubFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const s = worldRT.performingMemoryId === "training-corner" ? worldRT.performanceTime : -1
    const prev = previousTime.current
    previousTime.current = s
    if (s >= 0) {
      for (const contact of [1.78, 2.21]) {
        if (prev < contact && s >= contact) {
          swing.current.velocity += 0.88
          swing.current.x = -Math.cos(avatarRT().facing)
          swing.current.z = Math.sin(avatarRT().facing)
          sfx.thump()
        }
      }
      if (prev < 3.7 && s >= 3.7) {
        spawnBurst(new THREE.Vector3(TRAINING.bagX, y + 1.4, TRAINING.bagZ), 12, "#e8c47a")
        sfx.sparkle()
      }
    }

    // damped pendulum bag swing, kicked at combo time
    if (bag.current) {
      const motion = swing.current
      motion.velocity = (motion.velocity - motion.angle * 18 * dt) * Math.exp(-2.1 * dt)
      motion.angle += motion.velocity * dt
      bag.current.rotation.x = motion.angle * motion.x
      bag.current.rotation.z = motion.angle * motion.z
    }

    // gym cat copies the combination with one raised paw
    if (gymCat.current && gymCatPaw.current) {
      const copying = s > 2.5 && s < 3.7
      const targetRot = copying ? -2.2 : 0
      gymCatPaw.current.rotation.z = THREE.MathUtils.damp(
        gymCatPaw.current.rotation.z,
        targetRot,
        6,
        dt,
      )
      gymCat.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.6) * 0.15
    }
  })

  const padMaterial = useMemo(() => makeBuiltGroundMaterial("#c8bda8"), [])
  const bagMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#8a4a3a", roughness: 0.8 }),
    [],
  )
  const matMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#7ba8a0", roughness: 1 }),
    [],
  )
  const bagGeometry = useMemo(() => new THREE.LatheGeometry([
    new THREE.Vector2(0, -1.65), new THREE.Vector2(.18, -1.63),
    new THREE.Vector2(.265, -1.55), new THREE.Vector2(.285, -1.43),
    new THREE.Vector2(.285, -.61), new THREE.Vector2(.26, -.51),
    new THREE.Vector2(.20, -.48), new THREE.Vector2(0, -.48),
  ], 24), [])

  return (
    <group position={[CORNER.x, y, CORNER.z]} name="training-corner">
      {/* shallow stone pad visually contains the corner */}
      <mesh position={[0.35, 0.015, 0.35]} receiveShadow>
        <cylinderGeometry args={[2.05, 2.18, 0.09, 8]} />
        <primitive object={padMaterial} attach="material" />
      </mesh>
      {/* mat */}
      <mesh position={[0.4, 0.04, 0.4]} receiveShadow material={matMat}>
        <boxGeometry args={[3.0, 0.08, 2.2]} />
      </mesh>
      <mesh position={[0.4, 0.085, 0.4]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.5, 0.62, 24]} />
        <meshStandardMaterial color="#e8e2d4" roughness={1} />
      </mesh>
      {/* bag frame */}
      <mesh position={[-0.8, 1.32, -0.8]}>
        <cylinderGeometry args={[0.07, 0.09, 2.64, 10]} />
        <meshStandardMaterial color={PALETTE.woodDark} roughness={0.9} />
      </mesh>
      <mesh position={[0.8, 1.32, -0.8]}>
        <cylinderGeometry args={[0.07, 0.09, 2.64, 10]} />
        <meshStandardMaterial color={PALETTE.woodDark} roughness={0.9} />
      </mesh>
      <mesh position={[0, 2.63, -0.8]}>
        <boxGeometry args={[1.9, 0.13, 0.14]} />
        <meshStandardMaterial color={PALETTE.woodDark} roughness={0.9} />
      </mesh>
      {/* a small striped shade gives the training spot its own silhouette */}
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={`shade:${i}`} position={[-1.5 + i * 0.6, 2.89, -0.92]} rotation-x={0.08} castShadow>
          <boxGeometry args={[0.6, 0.055, 1.05]} />
          <meshStandardMaterial
            color={i % 2 === 0 ? "#c87062" : "#ead9bf"}
            roughness={0.95}
          />
        </mesh>
      ))}
      {/* heavy bag on a rope */}
      <group ref={bag} name="training-bag" position={[0, 2.55, -0.8]}>
        <mesh position={[0, -0.25, 0]}>
          <cylinderGeometry args={[0.015, 0.015, 0.5, 6]} />
          <meshStandardMaterial color="#d9cbb0" />
        </mesh>
        <mesh geometry={bagGeometry} material={bagMat} castShadow />
        {[-0.63, -1.45].map(height => (
          <mesh key={height} position={[0, height, 0]} rotation-x={Math.PI / 2}>
            <torusGeometry args={[0.285, 0.009, 5, 24]} />
            <meshStandardMaterial color="#c99375" roughness={1} />
          </mesh>
        ))}
      </group>
      {/* glove shelf */}
      <mesh position={[1.3, 0.7, -0.7]}>
        <boxGeometry args={[0.7, 0.05, 0.35]} />
        <meshStandardMaterial color={PALETTE.wood} roughness={0.9} />
      </mesh>
      {[-0.14, 0.14].map((dx) => (
        <group key={dx} position={[1.3 + dx, 0.84, -0.7]} rotation-z={dx * 0.8}>
          <mesh scale={[0.8, 1, 1.1]} material={bagMat} castShadow>
            <sphereGeometry args={[0.11, 14, 10]} />
          </mesh>
          <mesh position={[-0.065, -0.015, 0.025]} rotation-z={-0.4} material={bagMat}>
            <capsuleGeometry args={[0.035, 0.06, 4, 8]} />
          </mesh>
          <mesh position={[0, -0.10, 0]}>
            <cylinderGeometry args={[0.072, 0.065, 0.085, 12]} />
            <meshStandardMaterial color="#4c3f45" roughness={0.9} />
          </mesh>
        </group>
      ))}
      {/* wraps draped from the shelf */}
      {[-0.2, 0.22].map((dx, i) => (
        <mesh key={`wrap:${dx}`} position={[1.3 + dx, 0.52 - i * 0.05, -0.68]} rotation-z={0.08 - i * 0.16}>
          <boxGeometry args={[0.08, 0.42, 0.035]} />
          <meshStandardMaterial color={i === 0 ? "#e6d7c0" : "#b99b87"} roughness={1} />
        </mesh>
      ))}
      {/* water bottle */}
      <mesh position={[1.7, 0.25, 0.6]}>
        <cylinderGeometry args={[0.05, 0.05, 0.22, 8]} />
        <meshStandardMaterial color="#a9d3e8" roughness={0.4} />
      </mesh>
      {/* compact gym bag and rolled towel */}
      <mesh position={[1.35, 0.22, 1.0]} rotation-z={Math.PI / 2} castShadow>
        <capsuleGeometry args={[0.16, 0.34, 5, 10]} />
        <meshStandardMaterial color="#5d596d" roughness={0.92} />
      </mesh>
      <mesh position={[1.35, 0.43, 1.0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.17, 0.025, 6, 14, Math.PI]} />
        <meshStandardMaterial color="#3f3a4d" roughness={0.9} />
      </mesh>
      <mesh position={[0.95, 0.16, 1.16]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.09, 0.09, 0.34, 10]} />
        <meshStandardMaterial color="#eee4d4" roughness={1} />
      </mesh>

      {/* the gym cat — raises a paw when the explorer trains */}
      <group ref={gymCat} name="gym-cat" position={[-0.95, 0.3, 1.0]} rotation-y={0.8}>
        <mesh material={bagMat}>
          <capsuleGeometry args={[0.1, 0.18, 6, 10]} />
        </mesh>
        <mesh position={[0, 0.15, 0.12]}>
          <sphereGeometry args={[0.11, 12, 10]} />
          <meshStandardMaterial color="#9c5a48" roughness={0.95} />
        </mesh>
        {[-0.05, 0.05].map((x) => (
          <mesh key={x} position={[x, 0.24, 0.1]}>
            <coneGeometry args={[0.035, 0.07, 5]} />
            <meshStandardMaterial color="#7a4234" roughness={0.95} />
          </mesh>
        ))}
        <mesh position={[0, 0.12, 0.213]} scale={[1.4, 0.8, 0.5]}>
          <sphereGeometry args={[0.036, 10, 8]} />
          <meshStandardMaterial color="#e8d8bf" roughness={1} />
        </mesh>
        {[-0.037, 0.037].map(x => (
          <mesh key={`eye:${x}`} position={[x, 0.176, 0.22]}>
            <sphereGeometry args={[0.011, 8, 6]} />
            <meshStandardMaterial color="#302723" roughness={0.6} />
          </mesh>
        ))}
        <group ref={gymCatPaw} name="gym-cat-paw" position={[0.1, 0.05, 0.05]}>
          <mesh position={[0, 0.06, 0]} material={bagMat}>
            <capsuleGeometry args={[0.03, 0.1, 4, 8]} />
          </mesh>
        </group>
        {/* tail */}
        <mesh position={[0, 0.12, -0.14]} rotation-x={-0.8}>
          <capsuleGeometry args={[0.025, 0.16, 4, 8]} />
          <meshStandardMaterial color="#7a4234" roughness={0.95} />
        </mesh>
      </group>
      <SignBoard text="tiny training" position={[-1.72, 0, 1.45]} rotationY={0.35} width={1.25} />
    </group>
  )
}
