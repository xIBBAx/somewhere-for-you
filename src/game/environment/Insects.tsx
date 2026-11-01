import { useHubFrame } from "../hubGate"

import { useLayoutEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { makeRng } from "../../utils/math"
import {
  createFlightFollower,
  flightWingAngle,
  mapToFlightSpecies,
  stepFlightFollower,
} from "../animals/flying/adapter"
import { flightPoint } from "../animals/flying/primitives"
import {
  createAnimalAgent,
  registerAnimalAgent,
  stepAnimalAgent,
  type AnimalAgent,
} from "../animals/ecosystem"
import { worldRT } from "../runtime"
import { groundHeight, POND, WATER_Y } from "../world-layout"
import { weatherRT } from "../weather/weatherState"

/**
 * Living Insect Ecosystem:
 * 1) Colorful fluttering Butterflies (Monarch, Swallowtail, Blue Morpho, Rose Petal)
 * 2) Iridescent darting Dragonflies hovering over pond waters and reeds
 * 3) Busy Honeybees buzzing around flower blossoms
 */
export const Insects = (): React.ReactElement => {
  return (
    <group>
      <Butterflies />
      <Dragonflies />
      <Honeybees />
    </group>
  )
}

// -----------------------------------------------------------------------------
// 1) BUTTERFLIES
// -----------------------------------------------------------------------------
type Butterfly = {
  cx: number
  cz: number
  r: number
  speed: number
  phase: number
  yBase: number
  color: string
  agent: AnimalAgent
}

const BUTTERFLY_SPECIES = ["#f97316", "#facc15", "#38bdf8", "#f472b6", "#c084fc"]

const Butterflies = (): React.ReactElement => {
  const groupRef = useRef<THREE.Group>(null)
  const leftWings = useRef<Array<THREE.Mesh | null>>([])
  const rightWings = useRef<Array<THREE.Mesh | null>>([])
  const roots = useRef<Array<THREE.Group | null>>([])

  const data = useMemo(() => {
    const rng = makeRng(198273)
    const list: Butterfly[] = []
    const zones = [
      { x: 9.5, z: 9.2 },   // Pond flowers
      { x: -8.6, z: 13.6 }, // Memory cafe
      { x: 6.8, z: 10.2 },  // Walk bench
      { x: 14.2, z: -5.5 }, // Eastern meadow
      { x: 1.8, z: -26.2 }, // finale garden approach
      { x: -11.2, z: -6.8 },// Training corner
    ]

    for (let i = 0; i < 18; i++) {
      const z = zones[i % zones.length]
      const cx = z.x + (rng() - 0.5) * 3.5
      const cz = z.z + (rng() - 0.5) * 3.5
      const yBase = 0.6 + rng() * 0.5
      list.push({
        cx,
        cz,
        r: 0.8 + rng() * 1.5,
        speed: 0.8 + rng() * 0.9,
        phase: rng() * Math.PI * 2,
        yBase,
        color: BUTTERFLY_SPECIES[i % BUTTERFLY_SPECIES.length],
        agent: createAnimalAgent({
          id: `meadow-butterfly-${i + 1}`,
          species: "butterfly",
          mobility: "air",
          position: { x: cx, y: groundHeight(cx, cz) + yBase, z: cz },
          seed: 198273 + i * 19,
          radius: 0.04,
          walkSpeed: 0.58 + rng() * 0.22,
          runSpeed: 2.15,
          perception: 5.5,
          personalSpace: 0.24,
          playerSpace: 0.9,
          fleeDistance: 3.4,
          altitude: [0.55, 1.45],
          threats: ["companion-cat", "garden-cat"],
          interests: ["butterfly", "bee", "ground-bird"],
          preferredPoints: zones,
          personality: {
            curiosity: 0.55 + (i % 4) * 0.1,
            caution: 0.62 + (i % 3) * 0.1,
            sociability: 0.45 + (i % 5) * 0.1,
            energy: 0.72 + (i % 3) * 0.08,
            playfulness: 0.7 + (i % 4) * 0.07,
          },
        }),
      })
    }
    return list
  }, [])

  useLayoutEffect(() => {
    const unregister = data.map((butterfly) => registerAnimalAgent(butterfly.agent))
    return () => unregister.forEach((dispose) => dispose())
  }, [data])

  // Bounded followers preserve foraging decisions; render follows physics pose.
  const flights = useMemo(
    () =>
      data.map((butterfly, index) =>
        createFlightFollower(
          butterfly.agent.id,
          mapToFlightSpecies("butterfly", index, butterfly.color),
          flightPoint(butterfly.agent.position.x, butterfly.agent.position.y, butterfly.agent.position.z),
        ),
      ),
    [data],
  )

  // Butterfly wing planform: broad forewing + rounded hindwing (no rectangles).
  const wingGeometry = useMemo(() => {
    const shape = new THREE.Shape()
    shape.moveTo(0, 0.02)
    shape.quadraticCurveTo(0.03, 0.09, 0.1, 0.075)
    shape.quadraticCurveTo(0.13, 0.05, 0.09, 0.02)
    shape.quadraticCurveTo(0.11, -0.02, 0.06, -0.045)
    shape.quadraticCurveTo(0.02, -0.05, 0, -0.02)
    shape.lineTo(0, 0.02)
    const geometry = new THREE.ShapeGeometry(shape, 8)
    geometry.rotateX(-Math.PI / 2)
    return geometry
  }, [])

  useHubFrame((state, rawDt) => {
    const t = state.clock.elapsedTime
    const dt = Math.min(rawDt, 1 / 20)
    const daytime = 1 - Math.max(0, Math.min(1, (worldRT.timeOfDay - 0.6) / 0.3))
    if (groupRef.current) groupRef.current.visible = daytime > 0.05 && weatherRT.rain < 0.42

    for (let i = 0; i < data.length; i++) {
      const b = data[i]
      const r = roots.current[i]
      const wl = leftWings.current[i]
      const wr = rightWings.current[i]
      if (!r || !wl || !wr) continue
      stepAnimalAgent(b.agent, rawDt)
      const flight = flights[i]
      flight.target.x = b.agent.position.x
      flight.target.y = b.agent.position.y
      flight.target.z = b.agent.position.z
      stepFlightFollower(flight, flight.target, dt)
      r.position.set(
        flight.position.x,
        flight.position.y + Math.sin(t * 3.5 + b.phase) * 0.03,
        flight.position.z,
      )
      r.rotation.order = "YXZ"
      r.rotation.y = flight.pose.heading
      r.rotation.z = flight.pose.bank * 0.7

      // Species-rate flap from integrated wingPhase (7Hz envelope).
      const flap = flightWingAngle(flight)
      wl.rotation.y = flap
      wr.rotation.y = -flap
    }
  })

  return (
    <group ref={groupRef}>
      {data.map((b, i) => (
        <group
          key={i}
          ref={(g) => {
            roots.current[i] = g
          }}
          scale={0.85}
        >
          {/* Slender Black Torso */}
          <mesh>
            <cylinderGeometry args={[0.01, 0.008, 0.08, 4]} />
            <meshBasicMaterial color="#1c1917" />
          </mesh>
          {/* Left Wing (shaped, root at thorax) */}
          <mesh
            ref={(m) => {
              leftWings.current[i] = m
            }}
            geometry={wingGeometry}
            position={[-0.008, 0.01, 0]}
            scale={[-1, 1, 1]}
          >
            <meshStandardMaterial color={b.color} side={THREE.DoubleSide} roughness={0.4} />
          </mesh>
          {/* Right Wing */}
          <mesh
            ref={(m) => {
              rightWings.current[i] = m
            }}
            geometry={wingGeometry}
            position={[0.008, 0.01, 0]}
          >
            <meshStandardMaterial color={b.color} side={THREE.DoubleSide} roughness={0.4} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

// -----------------------------------------------------------------------------
// 2) DRAGONFLIES
// -----------------------------------------------------------------------------
const DRAGONFLY_COUNT = 8

const Dragonflies = (): React.ReactElement => {
  const roots = useRef<Array<THREE.Group | null>>([])
  const foreL = useRef<Array<THREE.Mesh | null>>([])
  const foreR = useRef<Array<THREE.Mesh | null>>([])
  const hindL = useRef<Array<THREE.Mesh | null>>([])
  const hindR = useRef<Array<THREE.Mesh | null>>([])

  const data = useMemo(() => {
    const rng = makeRng(338291)
    const pondPoints = [
      { x: POND.x - 1.8, z: POND.z },
      { x: POND.x + 1.6, z: POND.z + 0.6 },
      { x: POND.x, z: POND.z - 1.7 },
      { x: 6.2, z: 10.8 },
      { x: 12.8, z: 3.4 },
    ]
    return Array.from({ length: DRAGONFLY_COUNT }, (_, i) => {
      const radius = 1.2 + rng() * 2.2
      const phase = rng() * Math.PI * 2
      const x = POND.x + Math.cos(phase) * radius * 0.55
      const z = POND.z + Math.sin(phase) * radius * 0.45
      const yBase = WATER_Y + 0.25 + rng() * 0.35
      return {
        phase,
        color: i % 2 === 0 ? "#06b6d4" : "#10b981",
        agent: createAnimalAgent({
          id: `dragonfly-${i + 1}`,
          species: "dragonfly",
          mobility: "air",
          position: { x, y: yBase, z },
          seed: 338291 + i * 23,
          radius: 0.035,
          walkSpeed: 1.05 + rng() * 0.35,
          runSpeed: 2.9,
          perception: 5,
          personalSpace: 0.22,
          playerSpace: 0.8,
          altitude: [0.35, 1.1],
          interests: ["dragonfly", "duck", "butterfly"],
          preferredPoints: pondPoints,
          personality: { curiosity: 0.72, caution: 0.58, sociability: 0.64, energy: 0.94, playfulness: 0.8 },
        }),
      }
    })
  }, [])

  useLayoutEffect(() => {
    const unregister = data.map((dragonfly) => registerAnimalAgent(dragonfly.agent))
    return () => unregister.forEach((dispose) => dispose())
  }, [data])

  const flights = useMemo(
    () =>
      data.map((dragonfly) =>
        createFlightFollower(
          dragonfly.agent.id,
          mapToFlightSpecies("dragonfly"),
          flightPoint(dragonfly.agent.position.x, dragonfly.agent.position.y, dragonfly.agent.position.z),
        ),
      ),
    [data],
  )

  // Narrow tapered Anisoptera wing (fore pair longer than hind pair via scale).
  const dragonWing = useMemo(() => {
    const shape = new THREE.Shape()
    shape.moveTo(0, 0.008)
    shape.lineTo(0.09, 0.014)
    shape.quadraticCurveTo(0.115, 0.008, 0.09, 0.0)
    shape.lineTo(0, -0.008)
    shape.lineTo(0, 0.008)
    const geometry = new THREE.ShapeGeometry(shape, 4)
    geometry.rotateX(-Math.PI / 2)
    return geometry
  }, [])

  useHubFrame((_state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    for (let i = 0; i < DRAGONFLY_COUNT; i++) {
      const d = data[i]
      const r = roots.current[i]
      const fl = foreL.current[i]
      const fr = foreR.current[i]
      const hl = hindL.current[i]
      const hr = hindR.current[i]
      if (!r || !fl || !fr || !hl || !hr) continue
      stepAnimalAgent(d.agent, rawDt)
      const flight = flights[i]
      flight.target.x = d.agent.position.x
      flight.target.y = d.agent.position.y
      flight.target.z = d.agent.position.z
      stepFlightFollower(flight, flight.target, dt)
      r.position.set(flight.position.x, flight.position.y, flight.position.z)
      r.rotation.order = "YXZ"
      r.rotation.y = flight.pose.heading
      r.rotation.x = -flight.pose.pitch * 0.6
      r.rotation.z = flight.pose.bank * 0.8

      // Counter-stroking fore/hind pairs from the 32Hz envelope.
      const flap = flightWingAngle(flight)
      fl.rotation.z = flap
      fr.rotation.z = -flap
      hl.rotation.z = -flap * 0.9
      hr.rotation.z = flap * 0.9
    }
  })

  return (
    <group>
      {data.map((d, i) => (
        <group
          key={i}
          ref={(g) => {
            roots.current[i] = g
          }}
          scale={0.9}
        >
          {/* Slender needle abdomen */}
          <mesh rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.008, 0.004, 0.16, 4]} />
            <meshStandardMaterial color={d.color} emissive={d.color} emissiveIntensity={0.5} />
          </mesh>
          {/* Head & Eyes */}
          <mesh position={[0, 0, 0.09]}>
            <sphereGeometry args={[0.016, 6, 5]} />
            <meshStandardMaterial color="#0f172a" roughness={0.2} />
          </mesh>
          {/* Fore wings (longer pair) */}
          <mesh
            ref={(m) => {
              foreL.current[i] = m
            }}
            geometry={dragonWing}
            position={[-0.008, 0.012, 0.03]}
            scale={[-1, 1, 1.15]}
          >
            <meshBasicMaterial color="#e0f2fe" transparent opacity={0.65} side={THREE.DoubleSide} />
          </mesh>
          <mesh
            ref={(m) => {
              foreR.current[i] = m
            }}
            geometry={dragonWing}
            position={[0.008, 0.012, 0.03]}
            scale={[1, 1, 1.15]}
          >
            <meshBasicMaterial color="#e0f2fe" transparent opacity={0.65} side={THREE.DoubleSide} />
          </mesh>
          {/* Hind wings (shorter pair) */}
          <mesh
            ref={(m) => {
              hindL.current[i] = m
            }}
            geometry={dragonWing}
            position={[-0.008, 0.012, 0.0]}
            scale={[-1, 1, 0.95]}
          >
            <meshBasicMaterial color="#e0f2fe" transparent opacity={0.6} side={THREE.DoubleSide} />
          </mesh>
          <mesh
            ref={(m) => {
              hindR.current[i] = m
            }}
            geometry={dragonWing}
            position={[0.008, 0.012, 0.0]}
            scale={[1, 1, 0.95]}
          >
            <meshBasicMaterial color="#e0f2fe" transparent opacity={0.6} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

// -----------------------------------------------------------------------------
// 3) HONEYBEES
// -----------------------------------------------------------------------------
const BEE_COUNT = 10

const Honeybees = (): React.ReactElement => {
  const groupRef = useRef<THREE.Group>(null)
  const roots = useRef<Array<THREE.Group | null>>([])
  const data = useMemo(() => {
    const rng = makeRng(882914)
    const flowerBeds = [
      { x: 13.4, z: 1.4 },   // Cat garden flowers
      { x: 6.2, z: 10.8 },   // Bleeding heart trail
      { x: 0, z: -30.5 },    // finale garden
      { x: 10.8, z: -15.6 }, // Rain spot flowers
    ]
    return Array.from({ length: BEE_COUNT }, (_, i) => {
      const fb = flowerBeds[i % flowerBeds.length]
      const cx = fb.x + (rng() - 0.5) * 2.2
      const cz = fb.z + (rng() - 0.5) * 2.2
      const yBase = 0.35 + rng() * 0.35
      return {
        phase: rng() * Math.PI * 2,
        agent: createAnimalAgent({
          id: `honeybee-${i + 1}`,
          species: "bee",
          mobility: "air",
          position: { x: cx, y: groundHeight(cx, cz) + yBase, z: cz },
          seed: 882914 + i * 29,
          radius: 0.03,
          walkSpeed: 0.82 + rng() * 0.28,
          runSpeed: 2.25,
          perception: 4.5,
          personalSpace: 0.2,
          playerSpace: 0.75,
          altitude: [0.28, 0.92],
          interests: ["bee", "butterfly"],
          preferredPoints: flowerBeds,
          personality: { curiosity: 0.58, caution: 0.46, sociability: 0.84, energy: 0.9, playfulness: 0.36 },
        }),
      }
    })
  }, [])

  useLayoutEffect(() => {
    const unregister = data.map((bee) => registerAnimalAgent(bee.agent))
    return () => unregister.forEach((dispose) => dispose())
  }, [data])

  const flights = useMemo(
    () =>
      data.map((bee) =>
        createFlightFollower(
          bee.agent.id,
          mapToFlightSpecies("bee"),
          flightPoint(bee.agent.position.x, bee.agent.position.y, bee.agent.position.z),
        ),
      ),
    [data],
  )
  const beeWingsL = useRef<Array<THREE.Mesh | null>>([])
  const beeWingsR = useRef<Array<THREE.Mesh | null>>([])

  useHubFrame((state, rawDt) => {
    const t = state.clock.elapsedTime
    const dt = Math.min(rawDt, 1 / 20)
    if (groupRef.current) {
      groupRef.current.visible = worldRT.timeOfDay < 0.68 && weatherRT.rain < 0.35
    }
    for (let i = 0; i < BEE_COUNT; i++) {
      const b = data[i]
      const r = roots.current[i]
      if (!r) continue
      stepAnimalAgent(b.agent, rawDt)
      const flight = flights[i]
      flight.target.x = b.agent.position.x
      flight.target.y = b.agent.position.y
      flight.target.z = b.agent.position.z
      stepFlightFollower(flight, flight.target, dt)
      r.position.set(flight.position.x, flight.position.y, flight.position.z)
      r.rotation.order = "YXZ"
      r.rotation.y = flight.pose.heading
      r.rotation.z = flight.pose.bank * 0.6
      // 180Hz wingbeat exceeds frame rate: render as paired blurred wings
      // with shimmer around the integrated envelope instead of literal phase.
      const shimmer = Math.sin(t * 90 + b.phase * 7) * 0.18 + flightWingAngle(flight) * 0.25
      const wl = beeWingsL.current[i]
      const wr = beeWingsR.current[i]
      if (wl) wl.rotation.z = 0.5 + shimmer
      if (wr) wr.rotation.z = -0.5 - shimmer
    }
  })

  return (
    <group ref={groupRef}>
      {data.map((_, i) => (
        <group
          key={i}
          ref={(g) => {
            roots.current[i] = g
          }}
          scale={0.75}
        >
          {/* Yellow & Black Striped Fuzzy Body */}
          <mesh rotation-x={Math.PI / 2}>
            <capsuleGeometry args={[0.016, 0.038, 4, 6]} />
            <meshStandardMaterial color="#facc15" roughness={0.8} />
          </mesh>
          <mesh position={[0, 0, 0]} rotation-x={Math.PI / 2} scale={[1.05, 0.35, 1.05]}>
            <capsuleGeometry args={[0.016, 0.038, 4, 6]} />
            <meshBasicMaterial color="#1e293b" />
          </mesh>
          {/* Paired translucent wings (blur approximation, not one slab) */}
          <mesh
            ref={(m) => {
              beeWingsL.current[i] = m
            }}
            position={[-0.012, 0.018, -0.005]}
            rotation-x={-0.35}
          >
            <planeGeometry args={[0.035, 0.018]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.55} side={THREE.DoubleSide} />
          </mesh>
          <mesh
            ref={(m) => {
              beeWingsR.current[i] = m
            }}
            position={[0.012, 0.018, -0.005]}
            rotation-x={-0.35}
          >
            <planeGeometry args={[0.035, 0.018]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.55} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
