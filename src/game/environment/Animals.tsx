import { useHubFrame } from "../hubGate"

import { useLayoutEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { clamp, damp, dampAngle, makeRng, smoothstep } from "../../utils/math"
import { sfx } from "../audio/audio"
import {
  createAnimalAgent,
  registerAnimalAgent,
  stepAnimalAgent,
  type AnimalPersonality,
} from "../animals/ecosystem"
import { createFlightFollower, flightWingAngle, mapToFlightSpecies, stepFlightFollower } from "../animals/flying/adapter"
import { flightPoint } from "../animals/flying/primitives"
import { RiggedHomeAnimal } from "../animals/RiggedHomeAnimal"
import {
  BIRD_ELBOW,
  BIRD_SHOULDER,
  getHomeBirdMaterial,
  getHomeBirdParts,
  HOME_BIRD_PALETTES,
  poseHomeBirdWings,
} from "../../world/life/homeBirdAppearance"
import { catRT, avatarRT, worldRT } from "../runtime"
import { groundHeight, POND, WATER_Y } from "../world-layout"
import { keepOffLilyPads } from "../../world/hubLayout"
import { weatherRT } from "../weather/weatherState"

/**
 * Living Wildlife Engine:
 * 1) Autonomous Sky Flock: Birds soaring, banking, and flapping freely across the upper sky.
 * 2) Pond Family: Mother duck + paddling yellow ducklings.
 * 3) Meadow Deer & Fawn grazing with wagging tail & ear twitches.
 * 4) Hopping Rabbits with twitching ears.
 * 5) Vibrant Multicolored Butterflies (cat-chaseable).
 */
export const Animals = (): React.ReactElement => {
  return (
    <>
      <SkyFlock />
      {/* 5 Playful Butterflies (Cat chase targets) */}
      <Butterfly anchor={new THREE.Vector3(6.5, 0, 8.5)} radius={2.4} speed={0.65} color="#38bdf8" seed={0} />
      <Butterfly anchor={new THREE.Vector3(12, 0, 1.5)} radius={2.0} speed={0.75} color="#f472b6" seed={2} />
      <Butterfly anchor={new THREE.Vector3(-10, 0, 14)} radius={2.2} speed={0.7} color="#fb923c" seed={4} />
      <Butterfly anchor={new THREE.Vector3(-8, 0, -12)} radius={2.5} speed={0.6} color="#a855f7" seed={6} />
      <Butterfly anchor={new THREE.Vector3(2.5, 0, -18.5)} radius={2.1} speed={0.72} color="#34d399" seed={8} />

      {/* 4 Interactive Ground Birds */}
      <GroundBird position={new THREE.Vector3(5.2, 0, 9.6)} bodyColor="#e07a5f" breastColor="#f4a261" name="robin" />
      <GroundBird position={new THREE.Vector3(-12.4, 0, 8.2)} bodyColor="#3b82f6" breastColor="#93c5fd" name="bluebird" />
      <GroundBird position={new THREE.Vector3(-4.8, 0, -18.2)} bodyColor="#eab308" breastColor="#fef08a" name="goldfinch" />
      <GroundBird position={new THREE.Vector3(11.8, 0, 8.6)} bodyColor="#854d0e" breastColor="#d97706" name="sparrow" />

      {/* 4 Hopping Meadow Rabbits */}
      <Rabbit id="rabbit-curious" seed={3101} position={new THREE.Vector3(13.8, 0, -2.6)} color="#f5ede2" earColor="#eddcd0" personality={{ curiosity: 0.86, caution: 0.52, sociability: 0.62, energy: 0.72, playfulness: 0.68 }} />
      <Rabbit id="rabbit-cautious" seed={3102} position={new THREE.Vector3(-15.2, 0, -8.4)} color="#d1d5db" earColor="#9ca3af" personality={{ curiosity: 0.32, caution: 0.94, sociability: 0.38, energy: 0.7, playfulness: 0.34 }} />
      <Rabbit id="rabbit-russet" seed={3103} position={new THREE.Vector3(7.2, 0, 4.8)} color="#d97706" earColor="#b45309" personality={{ curiosity: 0.7, caution: 0.72, sociability: 0.78, energy: 0.84, playfulness: 0.82 }} />
      <Rabbit id="rabbit-snow" seed={3104} position={new THREE.Vector3(-7.5, 0, 12.2)} color="#ffffff" earColor="#fee2e2" personality={{ curiosity: 0.58, caution: 0.8, sociability: 0.86, energy: 0.55, playfulness: 0.5 }} />

      {/* Deer Family & Ducks Family */}
      <MeadowDeer position={new THREE.Vector3(-18.5, 0, 6.2)} />
      <DucksFamily />

      {/* Enchanted Twilight & Night Fireflies */}
      <Fireflies />
    </>
  )
}

/** Butterflies register themselves here so the cat can chase them. */
export const butterflyPositions: THREE.Vector3[] = []

/**
 * Autonomous Flying Sky Birds (Soaring & Flocking in 3D open space)
 */
const BIRDS_DATA = [
  { cx: 0, cz: 0, r: 24, y: 18, speed: 0.38, phase: 0, palette: "skyWhite", wingSpan: 1.5, scale: 1.15 },
  { cx: 8, cz: 6, r: 28, y: 22, speed: 0.32, phase: 1.2, palette: "skyBlue", wingSpan: 1.3, scale: 1.05 },
  { cx: -6, cz: -8, r: 20, y: 16, speed: 0.42, phase: 2.5, palette: "skyWhite", wingSpan: 1.45, scale: 1.1 },
  { cx: 12, cz: -14, r: 26, y: 24, speed: 0.35, phase: 3.8, palette: "skyGold", wingSpan: 1.25, scale: 1.0 },
  { cx: -10, cz: 12, r: 22, y: 19, speed: 0.4, phase: 4.6, palette: "skyTeal", wingSpan: 1.35, scale: 1.08 },
  { cx: 4, cz: -4, r: 32, y: 26, speed: 0.28, phase: 5.4, palette: "skyWhite", wingSpan: 1.55, scale: 1.2 },
]

/**
 * Articulated wings for a home bird: two shoulder groups, each carrying an inner
 * panel and an elbow group with the primaries. It uses the split pieces from the
 * shared bird geometry, so the silhouette is identical to the streamed flock's
 * while the flap runs on the CPU.
 *
 * Three meshes per bird (inner + outer per side, plus the body) is a fixed,
 * bounded cost for the handful of home birds — no per-bird React churn, and the
 * streamed world flock is untouched.
 */
const BirdWings = ({
  material,
  scale,
  wingSpan,
  shoulderL,
  shoulderR,
  elbowL,
  elbowR,
}: {
  material: THREE.Material
  scale: number
  /** multiplies the outboard reach of the wings */
  wingSpan: number
  shoulderL: (g: THREE.Group | null) => void
  shoulderR: (g: THREE.Group | null) => void
  elbowL: (g: THREE.Group | null) => void
  elbowR: (g: THREE.Group | null) => void
}): React.ReactElement => {
  const parts = useMemo(() => getHomeBirdParts("wings"), [])
  const inner = useMemo(() => parts.wingInner, [parts])
  const outer = useMemo(() => parts.wingOuter, [parts])

  return (
    <group scale={scale}>
      {([-1, 1] as const).map((side) => (
        <group
          key={side}
          ref={(g) => {
            if (side < 0) shoulderL(g)
            else shoulderR(g)
          }}
          position={[side * BIRD_SHOULDER.x, BIRD_SHOULDER.y, 0]}
        >
          {/* inner panel (humerus) — pivot-relative geometry */}
          <mesh geometry={inner} material={material} scale={[side * wingSpan, 1, 1]} castShadow />
          <group
            ref={(g) => {
              if (side < 0) elbowL(g)
              else elbowR(g)
            }}
            position={[
              side * (BIRD_ELBOW.x - BIRD_SHOULDER.x) * wingSpan,
              BIRD_ELBOW.y - BIRD_SHOULDER.y,
              0,
            ]}
          >
            {/* primaries past the elbow — pivot-relative to the elbow */}
            <mesh
              geometry={outer}
              material={material}
              scale={[(side * wingSpan) / 1, 1, 1]}
              castShadow
            />
          </group>
        </group>
      ))}
    </group>
  )
}

const SkyFlock = (): React.ReactElement => {
  const flock = useRef<THREE.Group>(null)
  const birds = useRef<Array<THREE.Group | null>>([])
  const wingsL = useRef<Array<THREE.Group | null>>([])
  const wingsR = useRef<Array<THREE.Group | null>>([])
  const elbowsL = useRef<Array<THREE.Group | null>>([])
  const elbowsR = useRef<Array<THREE.Group | null>>([])
  const activity = useRef(1)
  const agents = useMemo(
    () =>
      BIRDS_DATA.map((bird, index) =>
        createAnimalAgent({
          id: `sky-bird-${index + 1}`,
          species: "sky-bird",
          mobility: "air",
          position: {
            x: bird.cx + Math.cos(bird.phase) * bird.r * 0.45,
            y: bird.y,
            z: bird.cz + Math.sin(bird.phase) * bird.r * 0.4,
          },
          seed: 18000 + index * 41,
          radius: 0.16,
          walkSpeed: 3.2 + index * 0.16,
          runSpeed: 6.2,
          perception: 13,
          personalSpace: 1.4,
          playerSpace: 2,
          altitude: [14 + index * 0.8, 24 + index * 1.1],
          interests: ["sky-bird"],
          preferredPoints: [
            { x: -18, z: 8 },
            { x: 18, z: 3 },
            { x: -12, z: -18 },
            { x: 12, z: -22 },
            { x: 0, z: 20 },
          ],
          personality: {
            curiosity: 0.42 + index * 0.07,
            caution: 0.48 + (index % 3) * 0.12,
            sociability: 0.58 + (index % 2) * 0.24,
            energy: 0.72 + (index % 3) * 0.08,
            playfulness: 0.4 + (index % 4) * 0.1,
          },
        }),
      ),
    [],
  )

  useLayoutEffect(() => {
    const unregister = agents.map(registerAnimalAgent)
    return () => unregister.forEach((dispose) => dispose())
  }, [agents])

  // Bounded flight followers: ecosystem agents decide WHERE, the flight
  // envelope decides HOW (no velocity/position snaps, species turn limits).
  const flights = useMemo(
    () =>
      agents.map((agent, index) =>
        createFlightFollower(
          agent.id,
          mapToFlightSpecies("sky-bird", index),
          flightPoint(agent.position.x, agent.position.y, agent.position.z),
        ),
      ),
    [agents],
  )

  // One shared detailed songbird for the whole flock: the same silhouette the
  // world birds fly, tinted per bird and articulated on real shoulder/elbow
  // groups. Six birds in six bounded groups, so there is still no per-bird
  // React object explosion.
  const birdBody = useMemo(() => getHomeBirdParts("wings").body, [])
  const birdMaterials = useMemo(
    () => BIRDS_DATA.map((bird) => getHomeBirdMaterial(HOME_BIRD_PALETTES[bird.palette])),
    [],
  )

  useHubFrame((_state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const night = smoothstep(0.72, 0.98, worldRT.timeOfDay)
    activity.current = damp(
      activity.current,
      clamp(1 - weatherRT.rain * 1.35 - night * 0.86, 0, 1),
      1.2,
      dt,
    )

    flights.forEach((flight, i) => {
      const g = birds.current[i]
      if (!g) return
      const agent = agents[i]
      stepAnimalAgent(agent, dt)
      flight.target.x = agent.position.x
      flight.target.y = agent.position.y
      flight.target.z = agent.position.z
      stepFlightFollower(flight, flight.target, dt, agent.velocity)
      g.visible = activity.current > (i / BIRDS_DATA.length) * 0.72
      g.position.set(flight.position.x, flight.position.y, flight.position.z)
      g.rotation.order = "YXZ"
      g.rotation.y = flight.pose.heading
      g.rotation.x = -flight.pose.pitch * 0.85
      g.rotation.z = flight.pose.bank

      // Pose-driven flap: wingHz + effort come from the species envelope.
      const flap = flightWingAngle(flight)
      const shoulderL = wingsL.current[i]
      const shoulderR = wingsR.current[i]
      if (shoulderL && shoulderR) {
        poseHomeBirdWings(
          {
            shoulderL,
            shoulderR,
            elbowL: elbowsL.current[i],
            elbowR: elbowsR.current[i],
          },
          flap,
          flight.pose.effort,
          flight.pose.wingFold,
        )
      }
    })
  })

  return (
    <group ref={flock}>
      {BIRDS_DATA.map((b, i) => (
        <group
          key={i}
          name={`home-sky-bird:${i + 1}`}
          ref={(r) => {
            birds.current[i] = r
          }}
        >
          {/* Detailed songbird body: swept torso, rounded head, two-part bill,
              bead eyes, notched tail fan. Beak faces +Z, matching the rig
              convention. The wings are the split pieces below. */}
          <mesh
            geometry={birdBody}
            material={birdMaterials[i]}
            scale={b.scale}
            castShadow
          />
          <BirdWings
            material={birdMaterials[i]}
            scale={b.scale}
            wingSpan={b.wingSpan}
            shoulderL={(g) => {
              wingsL.current[i] = g
            }}
            shoulderR={(g) => {
              wingsR.current[i] = g
            }}
            elbowL={(g) => {
              elbowsL.current[i] = g
            }}
            elbowR={(g) => {
              elbowsR.current[i] = g
            }}
          />
        </group>
      ))}
    </group>
  )
}

const Butterfly = ({
  anchor,
  radius: _radius,
  speed,
  color,
  seed,
}: {
  anchor: THREE.Vector3
  radius: number
  speed: number
  color: string
  seed: number
}): React.ReactElement => {
  const ref = useRef<THREE.Group>(null)
  const wingL = useRef<THREE.Mesh>(null)
  const wingR = useRef<THREE.Mesh>(null)
  const pos = useMemo(() => new THREE.Vector3(), [])
  const idx = useMemo(() => {
    butterflyPositions.push(new THREE.Vector3())
    return butterflyPositions.length - 1
  }, [])
  const agent = useMemo(
    () =>
      createAnimalAgent({
        id: `feature-butterfly-${seed}`,
        species: "butterfly",
        mobility: "air",
        position: { x: anchor.x, y: groundHeight(anchor.x, anchor.z) + 1.1, z: anchor.z },
        seed: 29000 + seed,
        radius: 0.04,
        walkSpeed: speed,
        runSpeed: 2.3,
        perception: 5.5,
        personalSpace: 0.24,
        playerSpace: 0.9,
        fleeDistance: 3.5,
        altitude: [0.55, 1.55],
        threats: ["companion-cat", "garden-cat"],
        interests: ["butterfly", "bee", "ground-bird"],
        preferredPoints: [
          { x: anchor.x, z: anchor.z },
          { x: 9.5, z: 9.2 },
          { x: -8.6, z: 13.6 },
          { x: 14.2, z: -5.5 },
          { x: 1.8, z: -26.2 },
        ],
        personality: {
          curiosity: 0.52 + (seed % 4) * 0.1,
          caution: 0.68 + (seed % 3) * 0.08,
          sociability: 0.48 + (seed % 5) * 0.08,
          energy: 0.76,
          playfulness: 0.82,
        },
      }),
    [anchor.x, anchor.z, seed, speed],
  )

  useLayoutEffect(() => registerAnimalAgent(agent), [agent])

  const flight = useMemo(
    () =>
      createFlightFollower(
        agent.id,
        mapToFlightSpecies("butterfly", seed, color),
        flightPoint(agent.position.x, agent.position.y, agent.position.z),
      ),
    [agent, color, seed],
  )
  const wingGeometry = useMemo(() => {
    const shape = new THREE.Shape()
    shape.moveTo(0, 0.03)
    shape.quadraticCurveTo(0.05, 0.13, 0.15, 0.11)
    shape.quadraticCurveTo(0.19, 0.07, 0.13, 0.03)
    shape.quadraticCurveTo(0.16, -0.03, 0.09, -0.065)
    shape.quadraticCurveTo(0.03, -0.07, 0, -0.03)
    shape.lineTo(0, 0.03)
    const geometry = new THREE.ShapeGeometry(shape, 8)
    geometry.rotateX(-Math.PI / 2)
    return geometry
  }, [])

  useHubFrame((_state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    stepAnimalAgent(agent, dt)
    flight.target.x = agent.position.x
    flight.target.y = agent.position.y
    flight.target.z = agent.position.z
    stepFlightFollower(flight, flight.target, dt)

    const g = ref.current
    if (!g) return
    pos.set(flight.position.x, flight.position.y, flight.position.z)
    g.position.copy(pos)
    g.rotation.order = "YXZ"
    g.rotation.y = flight.pose.heading
    g.rotation.z = flight.pose.bank * 0.7
    const flap = flightWingAngle(flight)
    if (wingL.current) wingL.current.rotation.y = flap
    if (wingR.current) wingR.current.rotation.y = -flap

    butterflyPositions[idx].copy(pos)
  })

  return (
    <group ref={ref}>
      <mesh ref={wingL} geometry={wingGeometry} position={[-0.008, 0, 0]} scale={[-1, 1, 1]}>
        <meshStandardMaterial color={color} side={THREE.DoubleSide} roughness={0.5} />
      </mesh>
      <mesh ref={wingR} geometry={wingGeometry} position={[0.008, 0, 0]}>
        <meshStandardMaterial color={color} side={THREE.DoubleSide} roughness={0.5} />
      </mesh>
      <mesh scale={[0.35, 1, 0.35]}>
        <capsuleGeometry args={[0.02, 0.08, 3, 6]} />
        <meshStandardMaterial color="#332211" />
      </mesh>
    </group>
  )
}

const GroundBird = ({ position, bodyColor = "#e07a5f", breastColor = "#f4a261", name }: {
  position: THREE.Vector3; bodyColor?: string; breastColor?: string; name: string
}): React.ReactElement => {
  const ref = useRef<THREE.Group>(null)
  const peck = useRef<THREE.Group>(null)
  const wings = useRef<{ shoulderL: THREE.Group | null; shoulderR: THREE.Group | null; elbowL: THREE.Group | null; elbowR: THREE.Group | null }>({ shoulderL: null, shoulderR: null, elbowL: null, elbowR: null })
  const flightLift = useRef(0)
  const peckTimer = useRef(0)
  const agent = useMemo(
    () =>
      createAnimalAgent({
        id: `ground-bird-${name}`,
        species: "ground-bird",
        mobility: "land",
        position: { x: position.x, z: position.z },
        seed: 4200 + name.length * 17 + name.charCodeAt(0),
        radius: 0.12,
        walkSpeed: 0.5,
        runSpeed: 3.25,
        perception: 9,
        personalSpace: 0.5,
        playerSpace: 1.45,
        fleeDistance: name === "bluebird" ? 6.2 : 5.2,
        threats: ["companion-cat", "garden-cat"],
        interests: ["ground-bird", "butterfly", "rabbit", "duck", "monkey"],
        preferredPoints: [
          { x: -7, z: 16 },
          { x: 8, z: 11 },
          { x: 14, z: -5 },
          { x: -5, z: -17 },
          { x: 4, z: -22 },
        ],
        personality:
          name === "bluebird"
            ? { curiosity: 0.38, caution: 0.92, sociability: 0.56, energy: 0.8, playfulness: 0.48 }
            : name === "sparrow"
              ? { curiosity: 0.78, caution: 0.58, sociability: 0.84, energy: 0.72, playfulness: 0.7 }
              : { curiosity: 0.62, caution: 0.74, sociability: 0.68, energy: 0.66, playfulness: 0.55 },
      }),
    [name, position.x, position.z],
  )

  useLayoutEffect(() => registerAnimalAgent(agent), [agent])
  const bodyGeometry = useMemo(() => getHomeBirdParts("feet").body, [])
  const scale = 0.45
  const standLift = useMemo(() => {
    bodyGeometry.computeBoundingBox()
    return -bodyGeometry.boundingBox!.min.y * scale
  }, [bodyGeometry])
  const material = useMemo(() => getHomeBirdMaterial(HOME_BIRD_PALETTES[name] ?? {
    name, body: bodyColor, breast: breastColor, dark: "#2a2119", wing: bodyColor,
  }), [bodyColor, breastColor, name])
  useHubFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20), g = ref.current
    if (!g) return
    stepAnimalAgent(agent, dt)
    const shouldFly = agent.activity === "flee" || (agent.moving && agent.speed > 1.35)
    flightLift.current = damp(flightLift.current, shouldFly ? (agent.activity === "flee" ? 2.8 : 1.25) : 0, shouldFly ? 4.5 : 1.8, dt)
    const hop = !shouldFly && agent.moving ? Math.abs(Math.sin(state.clock.elapsedTime * 5.4 + agent.config.seed)) * 0.07 : 0
    g.position.set(agent.position.x, groundHeight(agent.position.x, agent.position.z) + standLift + flightLift.current + hop, agent.position.z)
    g.rotation.y = agent.heading
    const w = wings.current
    if (w.shoulderL && w.shoulderR) poseHomeBirdWings({ shoulderL: w.shoulderL, shoulderR: w.shoulderR, elbowL: w.elbowL, elbowR: w.elbowR },
      flightLift.current > 0.08 ? Math.sin(state.clock.elapsedTime * 22) * 0.62 : 0, 1, flightLift.current > 0.08 ? 0 : 0.95)
    peckTimer.current += dt
    if (peck.current) {
      const isPecking = flightLift.current < 0.08 && agent.activity === "eat" && Math.floor(peckTimer.current * 1.5) % 3 === 0
      // a songbird drinks by dipping its bill and tipping its head back to swallow
      const sip = flightLift.current < 0.08 && agent.activity === "drink" && !agent.moving ? (peckTimer.current * 0.9) % 1 : -1
      const drinkTilt = sip < 0 ? 0 : sip < 0.35 ? 0.5 : sip < 0.6 ? -0.28 : 0
      peck.current.rotation.x = damp(peck.current.rotation.x, isPecking ? 0.35 + Math.sin(state.clock.elapsedTime * 12) * 0.12 : drinkTilt, 12, dt)
    }
  })
  return <group ref={ref} name={`home-bird:${name}`}>
    <group ref={peck}>
      <mesh geometry={bodyGeometry} material={material} scale={scale} castShadow />
      <BirdWings material={material} scale={scale} wingSpan={0.75}
        shoulderL={g => { wings.current.shoulderL = g }} shoulderR={g => { wings.current.shoulderR = g }}
        elbowL={g => { wings.current.elbowL = g }} elbowR={g => { wings.current.elbowR = g }} />
    </group>
  </group>
}

const Rabbit = ({ id, seed, position, color = "#f5ede2", personality }: {
  id: string; seed: number; position: THREE.Vector3; color?: string; earColor?: string; personality: Partial<AnimalPersonality>
}): React.ReactElement => {
  const agent = useMemo(
    () =>
      createAnimalAgent({
        id,
        species: "rabbit",
        mobility: "land",
        position: { x: position.x, z: position.z },
        seed,
        radius: 0.18,
        walkSpeed: 0.78,
        runSpeed: 3.15,
        perception: 8.5,
        personalSpace: 0.62,
        playerSpace: 1.35,
        fleeDistance: 5.3,
        threats: ["companion-cat", "garden-cat"],
        interests: ["rabbit", "ground-bird", "butterfly", "deer"],
        preferredPoints: [
          { x: -17, z: 8 },
          { x: 15, z: -7 },
          { x: -9, z: -11 },
          { x: 8, z: 15 },
          { x: -5, z: -18 },
        ],
        personality,
      }),
    [id, personality, position.x, position.z, seed],
  )

  useLayoutEffect(() => registerAnimalAgent(agent), [agent])
  useHubFrame((_state, rawDt) => stepAnimalAgent(agent, Math.min(rawDt, 1 / 20)))
  const coat = color === "#d1d5db" ? 1 : color === "#d97706" ? 0 : 2
  return <RiggedHomeAnimal agent={agent} species="rabbit" coat={coat} scale={1.3} />
}

/**
 * Home-wide nocturnal fireflies
 * 140 glowing bioluminescent fireflies dancing across ponds, flower groves, gulmohar trees,
 * bridges, clearings, and the finale garden at dusk/night.
 */
const FIREFLY_COUNT = 140

const FIREFLY_PALETTES = [
  "#fef08a", // warm golden glow (40%)
  "#fde047", // rich sunny amber (25%)
  "#86efac", // ethereal soft jade (20%)
  "#7dd3fc", // starlight cyan (10%)
  "#fbcfe8", // blossom rose (5%)
]

const fireflyDummy = new THREE.Object3D()

const Fireflies = (): React.ReactElement => {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const { data } = useMemo(() => {
    const rng = makeRng(881923)
    const data: Array<{
      cx: number
      cz: number
      r: number
      speed: number
      phase: number
      yBase: number
      color: THREE.Color
    }> = []

    const centers = [
      { x: POND.x, z: POND.z, count: 24, spread: 4.5 },   // Reflection pond & reeds
      { x: 0, z: -28.5, count: 20, spread: 5.5 },        // finale garden & arch
      { x: -14.5, z: 4.5, count: 18, spread: 4.2 },       // Western grove & studio
      { x: 12.5, z: -8.5, count: 18, spread: 4.8 },       // Eastern flower meadow
      { x: -3.5, z: -3.5, count: 16, spread: 3.8 },       // River bridge crossing
      { x: -5.5, z: 16.5, count: 16, spread: 4.5 },       // Fair celebration lawn
      { x: 11.5, z: -16.5, count: 14, spread: 3.5 },      // Southern hilltop
      { x: 0, z: 18.5, count: 14, spread: 4.0 },          // Central meadow glade
    ]

    centers.forEach(({ x, z, count, spread }) => {
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + rng() * 0.6
        const r = 0.8 + rng() * spread
        const cx = x + Math.cos(angle) * r
        const cz = z + Math.sin(angle) * r
        const pick = rng()
        const colStr =
          pick < 0.4
            ? FIREFLY_PALETTES[0]
            : pick < 0.65
              ? FIREFLY_PALETTES[1]
              : pick < 0.85
                ? FIREFLY_PALETTES[2]
                : pick < 0.95
                  ? FIREFLY_PALETTES[3]
                  : FIREFLY_PALETTES[4]

        data.push({
          cx,
          cz,
          r: 0.6 + rng() * 1.6,
          speed: 0.45 + rng() * 0.65,
          phase: rng() * Math.PI * 2,
          yBase: groundHeight(cx, cz) + 0.45 + rng() * 1.5,
          color: new THREE.Color(colStr),
        })
      }
    })
    return { data }
  }, [])

  useLayoutEffect(() => {
    if (meshRef.current) {
      data.forEach((f, i) => {
        meshRef.current?.setColorAt(i, f.color)
      })
      if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true
    }
  }, [data])

  useHubFrame((state) => {
    const mesh = meshRef.current
    if (!mesh) return
    const night = smoothstep(0.58, 0.92, worldRT.timeOfDay)
    if (night <= 0.005) {
      mesh.visible = false
      return
    }
    mesh.visible = true

    const t = state.clock.elapsedTime
    const pPos = avatarRT().pos
    const cPos = catRT.pos

    for (let i = 0; i < data.length; i++) {
      const f = data[i]
      let px = f.cx + Math.cos(t * f.speed + f.phase) * f.r
      let pz = f.cz + Math.sin(t * f.speed * 0.85 + f.phase) * f.r
      let py = f.yBase + Math.sin(t * 1.8 + f.phase) * 0.35

      // Player & Cat proximity reaction (gentle upward flutter)
      const dPlayer = Math.hypot(px - pPos.x, pz - pPos.z)
      const dCat = Math.hypot(px - cPos.x, pz - cPos.z)
      if (dPlayer < 2.4) {
        const lift = (1 - dPlayer / 2.4) * 0.8
        py += lift
        px += (px - pPos.x) * 0.35
        pz += (pz - pPos.z) * 0.35
      }
      if (dCat < 1.8) {
        const lift = (1 - dCat / 1.8) * 0.6
        py += lift
      }

      const pulse = 0.55 + Math.sin(t * 3.2 + f.phase) * 0.45
      const scale = 0.052 * pulse * night

      fireflyDummy.position.set(px, py, pz)
      fireflyDummy.scale.setScalar(scale)
      fireflyDummy.updateMatrix()
      mesh.setMatrixAt(i, fireflyDummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, FIREFLY_COUNT]}>
      <sphereGeometry args={[1, 8, 6]} />
      <meshBasicMaterial color="#ffffff" />
    </instancedMesh>
  )
}

const DEER_WAYPOINTS = [
  [-18.5, 6.2],
  [-15.2, 9.5],
  [-12.4, 13.8],
  [-16.8, 15.5],
  [-19.5, 11.2],
] as const

/**
 * Living Wildlife: Mother Deer + Baby Fawn.
 * - Autonomous roaming across meadow pastures
 * - Active grass grazing (lowering neck to ground, chewing, wagging tail)
 * - Look-up alert behavior when the explorer or Cat approaches
 * - Baby fawn following mother and mimicking grazing
 */
const MeadowDeer = ({ position: initPos }: { position: THREE.Vector3 }): React.ReactElement => {
  const motherAgent = useMemo(
    () =>
      createAnimalAgent({
        id: "deer-mother",
        species: "deer",
        mobility: "land",
        position: { x: initPos.x, z: initPos.z },
        seed: 62401,
        radius: 0.42,
        walkSpeed: 0.9,
        runSpeed: 3.25,
        perception: 9,
        personalSpace: 1.15,
        playerSpace: 2.1,
        interests: ["deer", "horse", "rabbit", "ground-bird"],
        preferredPoints: DEER_WAYPOINTS.map(([x, z]) => ({ x, z })),
        personality: {
          curiosity: 0.52,
          caution: 0.78,
          sociability: 0.68,
          energy: 0.58,
          playfulness: 0.26,
        },
      }),
    [initPos.x, initPos.z],
  )
  const fawnAgent = useMemo(
    () =>
      createAnimalAgent({
        id: "deer-fawn",
        species: "deer",
        mobility: "land",
        position: { x: initPos.x + 0.7, z: initPos.z + 1.1 },
        seed: 62402,
        radius: 0.25,
        walkSpeed: 1,
        runSpeed: 3.4,
        perception: 8,
        personalSpace: 0.72,
        playerSpace: 1.7,
        passive: true,
        personality: { curiosity: 0.67, caution: 0.82, sociability: 0.9, energy: 0.72, playfulness: 0.52 },
      }),
    [initPos.x, initPos.z],
  )

  useLayoutEffect(() => {
    const unregister = [registerAnimalAgent(motherAgent), registerAnimalAgent(fawnAgent)]
    return () => unregister.forEach(dispose => dispose())
  }, [motherAgent, fawnAgent])
  useHubFrame((_state, rawDt) => {
    const dt = Math.min(Math.max(rawDt, 1e-4), 1 / 20)
    stepAnimalAgent(motherAgent, dt)
    const pos = motherAgent.position, heading = motherAgent.heading
    const x = pos.x - Math.sin(heading) * 1.35 + Math.cos(heading) * 0.65
    const z = pos.z - Math.cos(heading) * 1.35 - Math.sin(heading) * 0.65
    fawnAgent.speed = Math.hypot(x - fawnAgent.position.x, z - fawnAgent.position.z) / dt
    fawnAgent.position.set(x, groundHeight(x, z), z)
    fawnAgent.heading = heading; fawnAgent.activity = motherAgent.activity; fawnAgent.moving = motherAgent.moving
    fawnAgent.distanceTravelled += fawnAgent.speed * dt
  })
  return <group>
    <RiggedHomeAnimal agent={motherAgent} species="deer" coat={0} scale={1.15} />
    <RiggedHomeAnimal agent={fawnAgent} species="deer" coat={0} scale={0.67} />
  </group>
}

const DUCKLING_FORMATION = [
  { side: -0.2, behind: 0.45, scale: 0.5, phase: 0.2 },
  { side: 0.22, behind: 0.72, scale: 0.46, phase: 2.4 },
  { side: -0.05, behind: 1.0, scale: 0.43, phase: 4.6 },
] as const

/**
 * A cohesive pond family rather than three independent clockwork orbits.
 * Ducklings spring toward a spaced formation behind their mother; when the explorer
 * approaches, mother calls, checks the family, and leads them to the far side.
 */
const DucksFamily = (): React.ReactElement => {
  const mother = useRef<THREE.Group>(null)
  const motherHead = useRef<THREE.Group>(null)
  const motherWings = useRef<Array<THREE.Mesh | null>>([])
  const ducklings = useRef<Array<THREE.Group | null>>([])
  const ducklingHeads = useRef<Array<THREE.Group | null>>([])
  const wakes = useRef<Array<THREE.Mesh | null>>([])
  const callMarks = useRef<THREE.Group>(null)
  const familyHeading = useRef(0)
  const wasAlert = useRef(false)
  const motherAgent = useMemo(
    () =>
      createAnimalAgent({
        id: "duck-mother",
        species: "duck",
        mobility: "water",
        position: { x: POND.x + POND.r * 0.52, z: POND.z },
        seed: 77331,
        radius: 0.17,
        walkSpeed: 0.58,
        runSpeed: 1.55,
        perception: 7.5,
        personalSpace: 0.55,
        playerSpace: 1.9,
        fleeDistance: 4.8,
        threats: ["companion-cat", "garden-cat"],
        interests: ["duck", "ground-bird", "dragonfly"],
        personality: { curiosity: 0.54, caution: 0.78, sociability: 0.94, energy: 0.58, playfulness: 0.48 },
      }),
    [],
  )
  const ducklingAgents = useMemo(
    () =>
      DUCKLING_FORMATION.map((formation, index) =>
        createAnimalAgent({
          id: `duckling-${index + 1}`,
          species: "duck",
          mobility: "water",
          position: {
            x: POND.x + POND.r * 0.52 + formation.side,
            z: POND.z + formation.behind,
          },
          seed: 77340 + index,
          radius: 0.09,
          walkSpeed: 0.65,
          runSpeed: 1.65,
          perception: 6,
          personalSpace: 0.25,
          playerSpace: 1.5,
          passive: true,
          personality: { curiosity: 0.7, caution: 0.86, sociability: 1, energy: 0.8, playfulness: 0.72 },
        }),
      ),
    [],
  )
  const lastMotherPosition = useRef(
    new THREE.Vector3(POND.x + POND.r * 0.52, WATER_Y + 0.08, POND.z),
  )
  const ducklingPositions = useRef(
    DUCKLING_FORMATION.map((d) =>
      new THREE.Vector3(POND.x + POND.r * 0.52 + d.side, WATER_Y + 0.045, POND.z + d.behind),
    ),
  )

  useLayoutEffect(() => {
    const unregister = [registerAnimalAgent(motherAgent), ...ducklingAgents.map(registerAnimalAgent)]
    return () => unregister.forEach((dispose) => dispose())
  }, [ducklingAgents, motherAgent])

  useHubFrame((state, rawDt) => {
    const dt = Math.min(Math.max(rawDt, 1e-4), 1 / 20)
    const time = state.clock.elapsedTime
    stepAnimalAgent(motherAgent, dt)
    const avatar = avatarRT()
    const playerDistance = Math.hypot(
      avatar.pos.x - motherAgent.position.x,
      avatar.pos.z - motherAgent.position.z,
    )
    const catDistance = Math.hypot(
      catRT.pos.x - motherAgent.position.x,
      catRT.pos.z - motherAgent.position.z,
    )
    const alert = Math.max(
      motherAgent.activity === "flee" ? 1 : 0,
      avatar.moving ? smoothstep(5.2, 2.7, playerDistance) : 0,
      smoothstep(3.8, 1.8, catDistance),
    )
    const motherX = motherAgent.position.x
    const motherZ = motherAgent.position.z
    const motherY = motherAgent.position.y + 0.015 + Math.sin(time * 2.4) * 0.012
    const motionX = motherX - lastMotherPosition.current.x
    const motionZ = motherZ - lastMotherPosition.current.z
    if (Math.hypot(motionX, motionZ) > 1e-4) {
      familyHeading.current = dampAngle(
        familyHeading.current,
        motherAgent.heading,
        7,
        dt,
      )
    }
    lastMotherPosition.current.set(motherX, motherY, motherZ)

    if (mother.current) {
      mother.current.position.set(motherX, motherY, motherZ)
      mother.current.rotation.y = familyHeading.current
      mother.current.rotation.z = Math.sin(time * 2.4) * 0.025
    }

    const playerHeading = Math.atan2(avatar.pos.x - motherX, avatar.pos.z - motherZ)
    const relativeLook = Math.atan2(
      Math.sin(playerHeading - familyHeading.current),
      Math.cos(playerHeading - familyHeading.current),
    )
    if (motherHead.current) {
      motherHead.current.rotation.y = damp(
        motherHead.current.rotation.y,
        clamp(relativeLook, -0.72, 0.72) * alert + Math.sin(time * 0.65) * 0.12 * (1 - alert),
        5,
        dt,
      )
      motherHead.current.rotation.x = Math.sin(time * 1.7) * 0.05 - alert * 0.08
    }
    motherWings.current.forEach((wing, index) => {
      if (!wing) return
      wing.rotation.z = (index === 0 ? -1 : 1) * (0.18 + alert * (0.48 + Math.sin(time * 8) * 0.1))
    })

    if (alert > 0.58 && !wasAlert.current) sfx.quack()
    wasAlert.current = alert > 0.16
    if (callMarks.current) {
      callMarks.current.visible = alert > 0.25
      callMarks.current.position.set(motherX, motherY + 0.36, motherZ)
      const pulse = 0.82 + Math.sin(time * 5.2) * 0.12
      callMarks.current.scale.setScalar(pulse * alert)
      callMarks.current.rotation.y = -familyHeading.current
    }

    const forwardX = Math.sin(familyHeading.current)
    const forwardZ = Math.cos(familyHeading.current)
    const rightX = Math.cos(familyHeading.current)
    const rightZ = -Math.sin(familyHeading.current)

    DUCKLING_FORMATION.forEach((formation, index) => {
      const tighter = THREE.MathUtils.lerp(1, 0.74, alert)
      const wiggle = Math.sin(time * 2.7 + formation.phase) * 0.035
      let targetX =
        motherX - forwardX * formation.behind * tighter + rightX * (formation.side * tighter + wiggle)
      let targetZ =
        motherZ - forwardZ * formation.behind * tighter + rightZ * (formation.side * tighter + wiggle)

      // Keep the whole family comfortably inside the irregular pond edge.
      const pondDx = targetX - POND.x
      const pondDz = targetZ - POND.z
      const pondDistance = Math.hypot(pondDx, pondDz / 0.83)
      const maxRadius = POND.r * 0.72
      if (pondDistance > maxRadius) {
        const scale = maxRadius / pondDistance
        targetX = POND.x + pondDx * scale
        targetZ = POND.z + pondDz * scale
      }
      // ducklings paddle round the lily leaves too
      const off = { x: targetX, z: targetZ }
      keepOffLilyPads(off, 0.1)
      targetX = off.x
      targetZ = off.z

      const position = ducklingPositions.current[index]
      const followSpeed = 2.8 + alert * 3.8 + index * 0.25
      position.x = damp(position.x, targetX, followSpeed, dt)
      position.z = damp(position.z, targetZ, followSpeed, dt)
      keepOffLilyPads(position, 0.1)
      position.y = WATER_Y + 0.048 + Math.sin(time * 3.4 + formation.phase) * 0.01
      const ducklingAgent = ducklingAgents[index]
      const previousX = ducklingAgent.position.x
      const previousZ = ducklingAgent.position.z
      ducklingAgent.position.copy(position)
      ducklingAgent.heading = familyHeading.current
      ducklingAgent.activity = motherAgent.activity
      ducklingAgent.moving = motherAgent.moving
      ducklingAgent.speed = Math.hypot(position.x - previousX, position.z - previousZ) / dt
      ducklingAgent.distanceTravelled += ducklingAgent.speed * dt

      const duckling = ducklings.current[index]
      if (duckling) {
        duckling.position.copy(position)
        duckling.rotation.y = dampAngle(duckling.rotation.y, familyHeading.current, 8, dt)
        duckling.rotation.z = Math.sin(time * 3.4 + formation.phase) * 0.035
      }
      const childHead = ducklingHeads.current[index]
      if (childHead) {
        const siblingLook = Math.sin(time * (0.9 + index * 0.1) + formation.phase) * 0.28
        childHead.rotation.y = siblingLook * (1 - alert) + (index - 1) * -0.16 * alert
        childHead.position.y = 0.115 + Math.sin(time * 4.1 + formation.phase) * 0.012
      }
    })

    const wakePositions = [lastMotherPosition.current, ...ducklingPositions.current]
    wakes.current.forEach((wake, index) => {
      if (!wake) return
      const source = wakePositions[index]
      wake.position.set(source.x - forwardX * 0.12, WATER_Y + 0.018, source.z - forwardZ * 0.12)
      const pulse = 0.72 + ((time * (0.7 + index * 0.07) + index * 0.23) % 1)
      wake.scale.setScalar(pulse * (index === 0 ? 0.55 : 0.3))
    })
  })

  return (
    <group>
      <group ref={mother}>
        <RiggedHomeAnimal agent={motherAgent} species="duck" coat={0} scale={0.92} local />
      </group>
      {DUCKLING_FORMATION.map((formation, index) => (
        <group key={`duckling:${formation.phase}`} ref={group => { ducklings.current[index] = group }}>
          <RiggedHomeAnimal agent={ducklingAgents[index]} species="duck" coat={1} scale={formation.scale} local
            tint={{ base: "#e5c155", light: "#fff0b1", pattern: "#cca740" }} />
        </group>
      ))}

      {[0, 1, 2, 3].map((index) => (
        <mesh
          key={`duck-wake:${index}`}
          ref={(mesh) => {
            wakes.current[index] = mesh
          }}
          rotation-x={-Math.PI / 2}
        >
          <ringGeometry args={[0.16, 0.19, 22, 1, 0.3, Math.PI * 1.4]} />
          <meshBasicMaterial color="#e5f8ff" transparent opacity={0.38} depthWrite={false} />
        </mesh>
      ))}

      <group ref={callMarks} visible={false}>
        {[0, 1].map((index) => (
          <mesh key={`quack-mark:${index}`} position={[index * 0.1, index * 0.08, 0]} rotation-y={Math.PI / 2}>
            <torusGeometry args={[0.08 + index * 0.035, 0.012, 6, 18, Math.PI * 1.15]} />
            <meshBasicMaterial color="#f5b13a" transparent opacity={0.72} depthWrite={false} />
          </mesh>
        ))}
      </group>
    </group>
  )
}
