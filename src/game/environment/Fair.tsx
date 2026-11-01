import { VirtualLight } from "../lightPool"
import { useHubFrame } from "../hubGate"

import { useMemo, useRef } from "react"
import * as THREE from "three"
import { smoothstep } from "../../utils/math"
import { worldRT } from "../runtime"
import { weatherRT } from "../weather/weatherState"
import { FAIR_LAYOUT, groundHeight } from "../world-layout"
import { PALETTE } from "./props"
import { makeBuiltGroundMaterial } from "./ground/builtGroundMaterial"
import { makeGroundMaterial } from "./ground/groundMaterial"

// Fair centered behind spawn so turning around immediately reveals it.
// Placed north of spawn (spawn at 0,22.5) toward the edge of home, framed by trees.
export const FAIR = FAIR_LAYOUT

/**
 * The home mela: a small fairground behind spawn.
 * Three rides (Ferris, Carousel, Swings), stalls, bunting, string lights,
 * and a tiny fountain. Responds to time (evening lights) and weather
 * (wet ground, shelter, softer shadows). Designed to be beautiful from the
 * spawn camera when the player turns 180°.
 */
export const Fair = (): React.ReactElement => {
  const y = groundHeight(FAIR.x, FAIR.z)
  return (
    <group position={[FAIR.x, y, FAIR.z]}>
      <FairGround y={0} />
      <FerrisWheel position={[...FAIR.ferris.position]} />
      <Carousel position={[...FAIR.carousel.position]} />
      <SwingRide position={[...FAIR.swings.position]} />
      <FairStalls />
      <FairDecor />
      <FairLights />
      <FairVisitors />
      <SmallFountain position={[...FAIR.fountain.position]} />
      <SignBoardFair />
    </group>
  )
}

const FairGround = (_props: { y: number }): React.ReactElement => {
  const plazaMat = useMemo(
    () => makeBuiltGroundMaterial("#ead8bf"),
    [],
  )
  const grassRingMat = useMemo(
    () => makeGroundMaterial(),
    [],
  )
  return (
    <group>
      <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[FAIR.r, 36]} />
        <primitive object={plazaMat} attach="material" />
      </mesh>
      <mesh position={[0, 0.015, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <ringGeometry args={[FAIR.r, FAIR.r + 0.55, 36]} />
        <primitive object={grassRingMat} attach="material" />
      </mesh>
    </group>
  )
}

const FerrisWheel = ({ position }: { position: [number, number, number] }): React.ReactElement => {
  const wheel = useRef<THREE.Group>(null)
  const cabins = useRef<Array<THREE.Group | null>>([])
  const lights = useRef<Array<THREE.Mesh | null>>([])
  const cabinCount = 8
  const radius = 2.15
  const centerY = 2.85

  const bulbMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#fff4dd",
        emissive: "#ffb86a",
        emissiveIntensity: 0,
      }),
    [],
  )

  const cabinColors = ["#f472b6", "#fbbf24", "#38bdf8", "#a78bfa", "#34d399", "#fb923c", "#f43f5e", "#60a5fa"]

  useHubFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const evening = smoothstep(0.48, 0.82, worldRT.timeOfDay)
    const rainDim = 1 - weatherRT.rain * 0.15
    const target = evening * 2.4 * rainDim
    // Ferris rotates slowly, slight variance with wind (gentle)
    const speed = 0.18 + weatherRT.wind * 0.04
    if (wheel.current) {
      wheel.current.rotation.z += speed * dt
      // keep cabins upright
      for (let i = 0; i < cabinCount; i++) {
        const g = cabins.current[i]
        if (g) g.rotation.z = -wheel.current.rotation.z
      }
    }
    // twinkle the rim lights subtly, stronger at night
    const t = state.clock.elapsedTime
    for (let i = 0; i < cabinCount; i++) {
      const m = lights.current[i]
      if (!m) continue
      const sparkle = Math.sin(t * 1.4 + i * 1.7) * 0.15
      ;(m.material as THREE.MeshStandardMaterial).emissiveIntensity =
        THREE.MathUtils.damp(
          (m.material as THREE.MeshStandardMaterial).emissiveIntensity,
          target + sparkle * evening,
          3,
          dt,
        )
    }
    bulbMat.emissiveIntensity = THREE.MathUtils.damp(bulbMat.emissiveIntensity, target * 0.7, 2, dt)
  })

  return (
    <group position={position}>
      {/* Heavy A-frame legs front and back */}
      {[-1.0, 1.0].map((x) =>
        [-0.32, 0.32].map((z) => (
          <mesh
            key={`leg:${x}:${z}`}
            position={[x, centerY * 0.5, z]}
            rotation-z={x > 0 ? -0.19 : 0.19}
            rotation-x={z > 0 ? 0.05 : -0.05}
            castShadow
          >
            <boxGeometry args={[0.1, centerY * 1.08, 0.08]} />
            <meshStandardMaterial color={PALETTE.woodDark} roughness={0.92} />
          </mesh>
        )),
      )}
      {/* Horizontal base support beams */}
      {[-0.32, 0.32].map((z) => (
        <mesh key={`cross:${z}`} position={[0, 0.75, z]}>
          <boxGeometry args={[1.55, 0.07, 0.07]} />
          <meshStandardMaterial color={PALETTE.woodDark} roughness={0.9} />
        </mesh>
      ))}
      {/* Plaza Platform Base */}
      <mesh position={[0, 0.18, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.2, 0.36, 1.35]} />
        <meshStandardMaterial color="#ebdcc4" roughness={0.88} />
      </mesh>

      {/* Main Wheel Structure */}
      <group ref={wheel} position={[0, centerY, 0]}>
        {/* Center Hub & Axle */}
        <mesh rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.26, 0.26, 0.85, 16]} />
          <meshStandardMaterial color="#d4a373" roughness={0.6} metalness={0.2} />
        </mesh>
        {[-0.43, 0.43].map((z) => (
          <mesh key={`hub-cap:${z}`} position={[0, 0, z]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.3, 0.3, 0.04, 16]} />
            <meshStandardMaterial color="#f5cd68" roughness={0.4} metalness={0.6} />
          </mesh>
        ))}

        {/* Dual Outer Structural Rims (Front and Back) */}
        {[-0.26, 0.26].map((z) => (
          <group key={`rim:${z}`} position={[0, 0, z]}>
            <mesh>
              <torusGeometry args={[radius, 0.045, 8, 36]} />
              <meshStandardMaterial color="#8c5836" roughness={0.85} />
            </mesh>
            <mesh>
              <torusGeometry args={[radius * 0.65, 0.035, 8, 32]} />
              <meshStandardMaterial color="#b07d58" roughness={0.88} />
            </mesh>
            {/* Radial Spokes */}
            {Array.from({ length: cabinCount }, (_, i) => {
              const a = (i / cabinCount) * Math.PI * 2
              return (
                <mesh
                  key={`spoke:${i}`}
                  position={[Math.cos(a) * radius * 0.5, Math.sin(a) * radius * 0.5, 0]}
                  rotation-z={a}
                >
                  <boxGeometry args={[radius, 0.035, 0.035]} />
                  <meshStandardMaterial color="#a67c52" roughness={0.88} />
                </mesh>
              )
            })}
          </group>
        ))}

        {/* Cross axle bars connecting front and back rims */}
        {Array.from({ length: cabinCount }, (_, i) => {
          const a = (i / cabinCount) * Math.PI * 2
          return (
            <mesh
              key={`cross-axle:${i}`}
              position={[Math.cos(a) * radius, Math.sin(a) * radius, 0]}
              rotation-x={Math.PI / 2}
            >
              <cylinderGeometry args={[0.024, 0.024, 0.54, 8]} />
              <meshStandardMaterial color="#d4a373" roughness={0.7} />
            </mesh>
          )
        })}

        {/* Gondola Cabins */}
        {Array.from({ length: cabinCount }, (_, i) => {
          const a = (i / cabinCount) * Math.PI * 2
          const col = cabinColors[i % cabinColors.length]
          return (
            <group
              key={`cabin:${i}`}
              ref={(r) => {
                cabins.current[i] = r
              }}
              position={[Math.cos(a) * radius, Math.sin(a) * radius, 0]}
            >
              {/* Suspension hanger swivel */}
              <mesh position={[0, -0.06, 0]}>
                <cylinderGeometry args={[0.018, 0.018, 0.16, 6]} />
                <meshStandardMaterial color="#8c5836" roughness={0.8} />
              </mesh>
              {/* Cabin Canopy Roof */}
              <mesh position={[0, -0.14, 0]} castShadow>
                <coneGeometry args={[0.34, 0.18, 8]} />
                <meshStandardMaterial color={col} roughness={0.75} />
              </mesh>
              {/* Main Cabin Basket */}
              <mesh position={[0, -0.34, 0]} castShadow>
                <boxGeometry args={[0.52, 0.28, 0.38]} />
                <meshStandardMaterial color={col} roughness={0.82} />
              </mesh>
              {/* Inner bench */}
              <mesh position={[0, -0.38, 0]}>
                <boxGeometry args={[0.44, 0.06, 0.28]} />
                <meshStandardMaterial color="#e8dcc4" roughness={0.9} />
              </mesh>
              {/* Safety bar */}
              <mesh position={[0, -0.24, 0.17]}>
                <boxGeometry args={[0.48, 0.03, 0.03]} />
                <meshStandardMaterial color="#f5cd68" roughness={0.4} metalness={0.6} />
              </mesh>
              {/* Front decorative bulb */}
              <mesh position={[0, -0.32, 0.2]} material={bulbMat}>
                <sphereGeometry args={[0.05, 8, 6]} />
              </mesh>
              {/* Outer rim light fixture */}
              <mesh
                ref={(m) => {
                  lights.current[i] = m
                }}
                position={[0, -0.04, 0.28]}
              >
                <sphereGeometry args={[0.065, 8, 6]} />
                <meshStandardMaterial color="#ffe8b8" emissive="#ffb86a" emissiveIntensity={0} />
              </mesh>
            </group>
          )
        })}
      </group>
    </group>
  )
}

const Carousel = ({ position }: { position: [number, number, number] }): React.ReactElement => {
  const platform = useRef<THREE.Group>(null)
  const horses = useRef<Array<THREE.Group | null>>([])
  const roofLights = useRef<Array<THREE.Mesh | null>>([])

  const horseCount = 6
  const radius = 1.15

  useHubFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const evening = smoothstep(0.48, 0.82, worldRT.timeOfDay)
    // Carousel gentle rotation, slightly faster than Ferris
    const speed = 0.55 + Math.sin(state.clock.elapsedTime * 0.11) * 0.06
    if (platform.current) platform.current.rotation.y += speed * dt
    const t = state.clock.elapsedTime
    for (let i = 0; i < horseCount; i++) {
      const g = horses.current[i]
      if (g) {
        const phase = (i / horseCount) * Math.PI * 2
        g.position.y = 0.62 + Math.sin(t * 1.6 + phase * 2) * 0.1
        g.rotation.z = Math.sin(t * 1.2 + phase) * 0.08
      }
      const m = roofLights.current[i]
      if (m) {
        ;(m.material as THREE.MeshStandardMaterial).emissiveIntensity = THREE.MathUtils.damp(
          (m.material as THREE.MeshStandardMaterial).emissiveIntensity,
          evening * (1.4 + Math.sin(t * 1.3 + i) * 0.2),
          3,
          dt,
        )
      }
    }
  })

  return (
    <group position={position}>
      <mesh position={[0, 0.14, 0]} castShadow>
        <cylinderGeometry args={[1.45, 1.5, 0.28, 16]} />
        <meshStandardMaterial color="#f3e8d4" roughness={0.9} />
      </mesh>
      <group ref={platform} position={[0, 0.28, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[1.25, 1.25, 0.06, 16]} />
          <meshStandardMaterial color="#e8dcc0" roughness={0.92} />
        </mesh>
        {/* center pole */}
        <mesh position={[0, 0.9, 0]} castShadow>
          <cylinderGeometry args={[0.07, 0.08, 1.9, 8]} />
          <meshStandardMaterial color={PALETTE.woodDark} roughness={0.88} />
        </mesh>
        {/* roof */}
        <mesh position={[0, 1.85, 0]} castShadow>
          <coneGeometry args={[1.55, 0.55, 16]} />
          <meshStandardMaterial color="#d96a6a" roughness={0.88} />
        </mesh>
        <mesh position={[0, 1.92, 0]}>
          <sphereGeometry args={[0.12, 10, 8]} />
          <meshStandardMaterial color="#ffd9a0" emissive="#ffb86a" emissiveIntensity={0.5} />
        </mesh>
        {Array.from({ length: horseCount }, (_, i) => {
          const a = (i / horseCount) * Math.PI * 2
          return (
            <group
              key={i}
              ref={(r) => {
                horses.current[i] = r
              }}
              position={[Math.cos(a) * radius, 0.62, Math.sin(a) * radius]}
              rotation-y={a + Math.PI / 2}
            >
              <mesh position={[0, 0.18, 0]} rotation-x={0.1} castShadow>
                <capsuleGeometry args={[0.11, 0.32, 6, 10]} />
                <meshStandardMaterial color={i % 2 === 0 ? "#f2ede6" : "#c9b0a1"} roughness={0.85} />
              </mesh>
              <mesh position={[0, 0.52, 0.08]} rotation-x={-0.2}>
                <coneGeometry args={[0.09, 0.18, 6]} />
                <meshStandardMaterial color="#5c4433" roughness={0.9} />
              </mesh>
              {/* pole */}
              <mesh position={[0, -0.1, 0]}>
                <cylinderGeometry args={[0.015, 0.015, 1.1, 6]} />
                <meshStandardMaterial color="#a8793a" roughness={0.9} />
              </mesh>
            </group>
          )
        })}
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2
          return (
            <mesh
              key={`roof-${i}`}
              ref={(m) => {
                roofLights.current[i] = m as unknown as THREE.Mesh
              }}
              position={[Math.cos(a) * 1.18, 1.55, Math.sin(a) * 1.18]}
            >
              <sphereGeometry args={[0.06, 8, 6]} />
              <meshStandardMaterial color="#ffe8b8" emissive="#ffb86a" emissiveIntensity={0} />
            </mesh>
          )
        })}
      </group>
    </group>
  )
}

const SwingRide = ({ position }: { position: [number, number, number] }): React.ReactElement => {
  const center = useRef<THREE.Group>(null)
  const swings = useRef<Array<THREE.Group | null>>([])

  useHubFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const t = state.clock.elapsedTime
    if (center.current) center.current.rotation.y += 0.42 * dt
    for (let i = 0; i < 6; i++) {
      const g = swings.current[i]
      if (!g) continue
      const phase = (i / 6) * Math.PI * 2
      const swing = Math.sin(t * 1.4 + phase) * 0.18 + Math.sin(t * 0.7 + phase * 1.3) * 0.08
      g.rotation.z = swing
      g.rotation.x = Math.cos(t * 1.1 + phase) * 0.07
    }
  })

  return (
    <group position={position}>
      <mesh position={[0, 0.12, 0]} castShadow>
        <cylinderGeometry args={[0.9, 0.95, 0.24, 12]} />
        <meshStandardMaterial color="#e8dcc0" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.1, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.08, 2.2, 8]} />
        <meshStandardMaterial color={PALETTE.woodDark} roughness={0.9} />
      </mesh>
      <group position={[0, 2.05, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.55, 0.62, 0.18, 12]} />
          <meshStandardMaterial color="#8b70a7" roughness={0.85} />
        </mesh>
      </group>
      <group ref={center} position={[0, 2.05, 0]}>
        {Array.from({ length: 6 }, (_, i) => {
          const a = (i / 6) * Math.PI * 2
          return (
            <group key={i} position={[Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55]} rotation-y={a}>
              <group ref={(r) => (swings.current[i] = r)}>
                <mesh position={[0.28, -0.25, 0]} rotation-z={0.2}>
                  <cylinderGeometry args={[0.012, 0.012, 0.9, 4]} />
                  <meshStandardMaterial color="#c0c0c0" roughness={0.6} />
                </mesh>
                <mesh position={[-0.28, -0.25, 0]} rotation-z={-0.2}>
                  <cylinderGeometry args={[0.012, 0.012, 0.9, 4]} />
                  <meshStandardMaterial color="#c0c0c0" roughness={0.6} />
                </mesh>
                <mesh position={[0, -0.72, 0]} castShadow>
                  <boxGeometry args={[0.32, 0.06, 0.28]} />
                  <meshStandardMaterial color={i % 2 === 0 ? "#f6c76b" : "#8ec9b5"} roughness={0.85} />
                </mesh>
              </group>
            </group>
          )
        })}
      </group>
    </group>
  )
}

const FairStalls = (): React.ReactElement => {
  return (
    <group>
      {/* Ticket booth at entrance (south side, facing spawn) */}
      <group position={[...FAIR.ticket.position]} rotation-y={Math.PI}>
        <mesh position={[0, 0.65, 0]} castShadow>
          <boxGeometry args={[1.4, 1.3, 0.9]} />
          <meshStandardMaterial color="#fdf3e3" roughness={0.9} />
        </mesh>
        <mesh position={[0, 1.45, 0]}>
          <boxGeometry args={[1.55, 0.22, 1.05]} />
          <meshStandardMaterial color={PALETTE.woodDark} roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.75, 0.46]}>
          <boxGeometry args={[0.7, 0.45, 0.06]} />
          <meshStandardMaterial color="#8ec9b5" roughness={0.8} />
        </mesh>
        {/* warm light */}
        <VirtualLight position={[0, 0.9, 0.6]} color="#ffca7a" intensity={1.2} distance={4} decay={2} />
      </group>
      {/* Pastry/food stall */}
      <group position={[...FAIR.pastry.position]} rotation-y={0.5}>
        <mesh position={[0, 0.6, 0]} castShadow>
          <boxGeometry args={[1.5, 1.2, 0.9]} />
          <meshStandardMaterial color="#f6c76b" roughness={0.9} />
        </mesh>
        <mesh position={[0, 1.35, 0.12]} rotation-x={0.25} castShadow>
          <boxGeometry args={[1.7, 0.6, 0.9]} />
          <meshStandardMaterial color="#fefefe" roughness={0.9} />
        </mesh>
        {[-0.3, 0, 0.3].map((x, i) => (
          <mesh key={x} position={[x, 0.92, 0.38]} scale={[1.2, 0.6, 1]}>
            <sphereGeometry args={[0.09, 8, 6]} />
            <meshStandardMaterial color={i === 1 ? "#d59a67" : "#e8bc84"} roughness={0.8} />
          </mesh>
        ))}
      </group>
      {/* Game booth */}
      <group position={[...FAIR.game.position]} rotation-y={-0.6}>
        <mesh position={[0, 0.6, 0]} castShadow>
          <boxGeometry args={[1.4, 1.2, 0.9]} />
          <meshStandardMaterial color="#cfa9e8" roughness={0.9} />
        </mesh>
        <mesh position={[0, 1.35, 0]}>
          <boxGeometry args={[1.5, 0.18, 1]} />
          <meshStandardMaterial color={PALETTE.woodDark} roughness={0.9} />
        </mesh>
        {/* plush prizes */}
        {[-0.4, 0, 0.4].map((x, i) => (
          <mesh key={x} position={[x, 1.02, 0.18]} scale={0.9}>
            <sphereGeometry args={[0.13, 10, 8]} />
            <meshStandardMaterial color={i === 0 ? "#f2a2b8" : i === 1 ? "#b9d89a" : "#f6c76b"} roughness={0.9} />
          </mesh>
        ))}
      </group>
      {/* Balloon stand */}
      <group position={[2.0, 0, -2.6]}>
        <mesh position={[0, 0.5, 0]} castShadow>
          <cylinderGeometry args={[0.03, 0.03, 1.0, 6]} />
          <meshStandardMaterial color={PALETTE.woodDark} roughness={0.9} />
        </mesh>
        {[
          "#f2a2b8",
          "#f6c76b",
          "#8ec9b5",
          "#cfa9e8",
          "#ff9a76",
        ].map((col, i) => (
          <mesh key={col} position={[(i - 2) * 0.16, 1.1 + (i % 2) * 0.08, 0]}>
            <sphereGeometry args={[0.13, 10, 8]} />
            <meshStandardMaterial color={col} roughness={0.85} />
          </mesh>
        ))}
        {/* strings */}
        {Array.from({ length: 5 }, (_, i) => (
          <mesh key={i} position={[(i - 2) * 0.16, 0.75, 0]} rotation-z={(i - 2) * 0.04}>
            <cylinderGeometry args={[0.004, 0.004, 0.7, 3]} />
            <meshStandardMaterial color="#fff" roughness={0.9} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

const FairDecor = (): React.ReactElement => {
  const buntingColors = ["#f2a2b8", "#f6c76b", "#8ec9b5", "#cfa9e8"]
  return (
    <group>
      {/* Bunting around fair perimeter */}
      {Array.from({ length: 18 }, (_, i) => {
        const a = (i / 18) * Math.PI * 2
        const r = FAIR.r - 0.15
        const x = Math.cos(a) * r
        const z = Math.sin(a) * r * 0.92
        return (
          <mesh key={i} position={[x, 1.6 + Math.sin(a * 3) * 0.07, z]} rotation-y={-a} rotation-z={0.15}>
            <coneGeometry args={[0.16, 0.28, 3]} />
            <meshStandardMaterial color={buntingColors[i % 4]} roughness={0.9} side={THREE.DoubleSide} />
          </mesh>
        )
      })}
      {/* Benches */}
      <BenchFair position={[-2.2, 0, -2.8]} rotationY={0.9} />
      <BenchFair position={[2.4, 0, -2.4]} rotationY={-0.7} />
      {/* Flowers around fountain */}
      {Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2
        const r = 1.35
        return (
          <group
            key={i}
            position={[Math.cos(a) * r, 0, Math.sin(a) * r + 0.9]}
            rotation-y={-a}
          >
            <mesh position={[0, 0.06, 0]}>
              <cylinderGeometry args={[0.012, 0.014, 0.14, 5]} />
              <meshStandardMaterial color="#6f9c59" roughness={1} />
            </mesh>
            <mesh position={[0, 0.16, 0]}>
              <sphereGeometry args={[0.045, 6, 5]} />
              <meshStandardMaterial color={["#f2a2b8", "#f6c76b", "#cfa9e8"][i % 3]} roughness={0.9} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

const BenchFair = ({ position, rotationY }: { position: [number, number, number]; rotationY: number }): React.ReactElement => {
  const y = groundHeight(FAIR.x + position[0], FAIR.z + position[2])
  return (
    <group position={[position[0], y - groundHeight(FAIR.x, FAIR.z), position[2]]} rotation-y={rotationY}>
      <mesh position={[0, 0.22, 0]} castShadow>
        <boxGeometry args={[0.9, 0.06, 0.32]} />
        <meshStandardMaterial color="#b89a6a" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.12, 0]}>
        <boxGeometry args={[0.88, 0.04, 0.28]} />
        <meshStandardMaterial color={PALETTE.woodDark} roughness={0.9} />
      </mesh>
      {[-0.38, 0.38].map((x) => (
        <mesh key={x} position={[x, 0.08, 0]}>
          <boxGeometry args={[0.06, 0.16, 0.32]} />
          <meshStandardMaterial color={PALETTE.woodDark} roughness={0.9} />
        </mesh>
      ))}
    </group>
  )
}

const FairLights = (): React.ReactElement => {
  const points = useMemo(() => {
    const pts: Array<[number, number, number]> = []
    for (let i = 0; i <= 14; i++) {
      const t = i / 14
      const a = t * Math.PI * 1.15 - 0.15
      const r = FAIR.r - 0.3
      pts.push([Math.cos(a) * r, 1.55 - Math.abs(Math.sin(t * Math.PI)) * 0.12, Math.sin(a) * r * 0.92])
    }
    return pts
  }, [])

  const bulbMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#fff4dd",
        emissive: "#ffd9a0",
        emissiveIntensity: 0,
      }),
    [],
  )

  useHubFrame(() => {
    const evening = smoothstep(0.45, 0.82, worldRT.timeOfDay)
    const target = evening * 1.6
    bulbMat.emissiveIntensity = target
  })

  return (
    <group>
      {points.map((p, i) => (
        <mesh key={i} position={p} material={bulbMat}>
          <sphereGeometry args={[0.045, 8, 6]} />
        </mesh>
      ))}
      {/* warm path lights */}
      {[
        [-1.2, -2.4],
        [1.2, -2.4],
        [-3.0, 0.2],
        [3.0, 0.5],
      ].map(([x, z], i) => (
        <VirtualLight
          key={i}
          position={[x, 1.2, z]}
          color="#ffc77e"
          intensity={1.0}
          distance={5}
          decay={2}
        />
      ))}
    </group>
  )
}

const FairVisitors = (): React.ReactElement => {
  return (
    <group>
      <VisitorSmall position={[-1.0, 0, -1.8]} rotation={0.4} coat="#73918a" />
      <VisitorSmall position={[1.4, 0, -1.1]} rotation={-0.9} coat="#d9a08a" />
      <VisitorChild position={[2.7, 0, 1.1]} />
      <StallOperator position={[0, 0, -3.2]} />
    </group>
  )
}

const VisitorSmall = ({ position, rotation, coat }: { position: [number, number, number]; rotation: number; coat: string }): React.ReactElement => {
  const y = groundHeight(FAIR.x + position[0], FAIR.z + position[2]) - groundHeight(FAIR.x, FAIR.z)
  return (
    <group position={[position[0], y, position[2]]} rotation-y={rotation} scale={0.72}>
      <mesh position={[0, 0.48, 0]} castShadow>
        <capsuleGeometry args={[0.13, 0.18, 6, 8]} />
        <meshStandardMaterial color={coat} roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.77, 0]} castShadow>
        <sphereGeometry args={[0.14, 10, 8]} />
        <meshStandardMaterial color="#e9c7aa" roughness={0.92} />
      </mesh>
      {/* ice cream when hot */}
      <mesh position={[0.12, 0.52, 0.12]} castShadow>
        <coneGeometry args={[0.06, 0.12, 8]} />
        <meshStandardMaterial color="#f6c76b" roughness={0.9} />
      </mesh>
      <mesh position={[0.12, 0.6, 0.12]}>
        <sphereGeometry args={[0.06, 8, 6]} />
        <meshStandardMaterial color="#fff" roughness={0.9} />
      </mesh>
    </group>
  )
}

const VisitorChild = ({ position }: { position: [number, number, number] }): React.ReactElement => {
  const y = groundHeight(FAIR.x + position[0], FAIR.z + position[2]) - groundHeight(FAIR.x, FAIR.z)
  return (
    <group position={[position[0], y, position[2]]} rotation-y={-0.5} scale={0.62}>
      <mesh position={[0, 0.38, 0]} castShadow>
        <capsuleGeometry args={[0.11, 0.15, 5, 8]} />
        <meshStandardMaterial color="#f2a2b8" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.64, 0]} castShadow>
        <sphereGeometry args={[0.13, 10, 8]} />
        <meshStandardMaterial color="#e9c7aa" roughness={0.92} />
      </mesh>
      <mesh position={[0.18, 0.3, 0.08]}>
        <sphereGeometry args={[0.11, 8, 6]} />
        <meshStandardMaterial color="#f6c76b" roughness={0.85} />
      </mesh>
    </group>
  )
}

const StallOperator = ({ position }: { position: [number, number, number] }): React.ReactElement => {
  const y = groundHeight(FAIR.x + position[0], FAIR.z + position[2]) - groundHeight(FAIR.x, FAIR.z)
  return (
    <group position={[position[0], y, position[2]]} rotation-y={Math.PI} scale={0.74}>
      <mesh position={[0, 0.52, 0]} castShadow>
        <capsuleGeometry args={[0.12, 0.2, 6, 8]} />
        <meshStandardMaterial color="#8ec9b5" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.84, 0]} castShadow>
        <sphereGeometry args={[0.14, 10, 8]} />
        <meshStandardMaterial color="#e9c7aa" roughness={0.92} />
      </mesh>
    </group>
  )
}

const SmallFountain = ({ position }: { position: [number, number, number] }): React.ReactElement => {
  const waterMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: "#8ec8d8",
        roughness: 0.2,
        transparent: true,
        opacity: 0.85,
      }),
    [],
  )

  useHubFrame((state) => {
    const t = state.clock.elapsedTime
    waterMat.emissiveIntensity = 0.08 + Math.sin(t * 1.2) * 0.02
  })

  return (
    <group position={position}>
      <mesh position={[0, 0.12, 0]} castShadow>
        <cylinderGeometry args={[0.9, 0.95, 0.24, 16]} />
        <meshStandardMaterial color="#d9c8ad" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.26, 0]} material={waterMat}>
        <circleGeometry args={[0.78, 20]} />
      </mesh>
      <mesh position={[0, 0.45, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.12, 0.5, 8]} />
        <meshStandardMaterial color="#e8dcc0" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.78, 0]}>
        <sphereGeometry args={[0.11, 10, 8]} />
        <meshStandardMaterial color="#d9c8ad" roughness={0.9} />
      </mesh>
    </group>
  )
}

const SignBoardFair = (): React.ReactElement => {
  const y = groundHeight(FAIR.x, FAIR.z + FAIR.r + 0.9) - groundHeight(FAIR.x, FAIR.z)
  return (
    <group position={[0, y, FAIR.r + 0.9]} rotation-y={Math.PI}>
      <mesh position={[0, 0.7, 0]} castShadow>
        <boxGeometry args={[1.9, 0.55, 0.08]} />
        <meshStandardMaterial color="#5c4433" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.7, 0.05]}>
        <boxGeometry args={[1.75, 0.42, 0.02]} />
        <meshStandardMaterial color="#fdf3e3" roughness={0.9} />
      </mesh>
    </group>
  )
}
