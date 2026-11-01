import { names } from "../../personalization"
import { VirtualLight, VirtualPointLight } from "../lightPool"
import { useHubFrame } from "../hubGate"
import { useLayoutEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"

import { useGame } from "../../state/gameStore"
import { makeRng, smoothstep } from "../../utils/math"
import { textTexture } from "../../utils/canvasTexture"
import { worldRT } from "../runtime"
import { groundHeight } from "../world-layout"
import { makeGroundMaterial } from "./ground/groundMaterial"
import { Bench, Lantern, PALETTE } from "./props"

const GATE = { x: 0, z: -26.5 }
const GARDEN = { x: 0, z: -30.5 }

/** Lantern arc positions — the finale lights these one by one. */
export const GARDEN_LANTERNS: Array<[number, number]> = Array.from({ length: 7 }, (_, i) => {
  const a = Math.PI * (0.15 + (i / 6) * 0.7)
  return [GARDEN.x + Math.cos(a) * 7.2, GARDEN.z - Math.sin(a) * 6.4]
})

/**
 * The finale garden is the visual reward for the journey: a framed gate,
 * flower-ringed clearing, cake table, tiny guests, lantern arc and a warm
 * fairy-light arch. The director controls when the light layers wake up.
 */
export const FinaleGarden = (): React.ReactElement => {
  const finaleStatus = useGame((s) => s.finale)
  const finaleDone = finaleStatus === "done"
  const surpriseOpen = finaleStatus !== "locked"
  const archLights = useRef<THREE.InstancedMesh>(null)
  const gardenGlow = useRef<VirtualPointLight>(null)
  const entryGate = useRef<THREE.Group>(null)
  const fairyArch = useRef<THREE.Group>(null)
  const y = groundHeight(GATE.x, GATE.z)
  const gy = groundHeight(GARDEN.x, GARDEN.z)

  const gateSign = useMemo(
    () =>
      textTexture(
        "gate-sign-v2",
        (ctx, w, h) => {
          ctx.fillStyle = "#fffaf0"
          ctx.fillRect(0, 0, w, h)
          ctx.strokeStyle = "#d9b8a0"
          ctx.lineWidth = 7
          ctx.strokeRect(7, 7, w - 14, h - 14)
          ctx.fillStyle = "#6b4a36"
          ctx.font = "italic 600 40px 'Fraunces', serif"
          ctx.textAlign = "center"
          ctx.textBaseline = "middle"
          ctx.fillText(`for ${names.recipient}`, w / 2, h / 2)
        },
        256,
        110,
      ),
    [],
  )

  const archBulbs = useMemo(() => {
    const pts: THREE.Matrix4[] = []
    for (let i = 0; i <= 18; i++) {
      const t = i / 18
      const x = -2.2 + t * 4.4
      const arcY = 1.36 + Math.sin(t * Math.PI) * 2.15
      pts.push(new THREE.Matrix4().makeTranslation(x, arcY, 0.03))
    }
    return pts
  }, [])

  useLayoutEffect(() => {
    const mesh = archLights.current
    if (!mesh) return
    archBulbs.forEach((matrix, i) => mesh.setMatrixAt(i, matrix))
    mesh.instanceMatrix.needsUpdate = true
  }, [archBulbs])

  useHubFrame((state) => {
    const finaleLit = worldRT.finalePhase >= 3 || finaleDone
    const dusk = smoothstep(0.58, 0.95, worldRT.timeOfDay)
    const intensity = finaleLit ? 2.1 : dusk * 0.65
    if (archLights.current) {
      const mat = archLights.current.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = intensity * (0.88 + Math.sin(state.clock.elapsedTime * 2.2) * 0.12)
    }
    if (gardenGlow.current) {
      gardenGlow.current.intensity =
        (surpriseOpen ? (finaleLit ? 7.5 : dusk * 2.0) : 0) *
        (0.94 + Math.sin(state.clock.elapsedTime * 1.1) * 0.06)
    }
    // The closing card masks this cinematic cut: once the message appears,
    // the entrance is behind the settled shot and no longer crosses the pair.
    const entryVisible = worldRT.finalePhase < 5
    if (entryGate.current) entryGate.current.visible = entryVisible
    if (fairyArch.current) fairyArch.current.visible = surpriseOpen && entryVisible
  })

  return (
    <group>
      <group visible={surpriseOpen}>
        <GardenFloor y={gy} />
        <GardenFlowers y={gy} />
        <CakeTable y={gy} />
        <GardenGuests y={gy} />
        <Bench position={[-4.0, gy, GARDEN.z - 0.25]} rotationY={1.0} />
        <Bench position={[4.1, gy, GARDEN.z - 0.6]} rotationY={-1.0} />
      </group>

      {/* The entrance reads as a gate, but the opening stays generous. */}
      <group ref={entryGate} position={[GATE.x, y, GATE.z]}>
        {[-1.9, 1.9].map((x) => (
          <group key={x} position={[x, 0, 0]}>
            <mesh position={[0, 1.12, 0]} castShadow>
              <cylinderGeometry args={[0.25, 0.34, 2.24, 10]} />
              <meshStandardMaterial color={PALETTE.stone} roughness={1} />
            </mesh>
            <mesh position={[0, 2.32, 0]} castShadow>
              <sphereGeometry args={[0.3, 10, 8]} />
              <meshStandardMaterial color="#efe4d3" roughness={1} />
            </mesh>
            <mesh position={[x < 0 ? 0.18 : -0.18, 1.55, 0.24]} scale={[1, 1.35, 0.7]}>
              <sphereGeometry args={[0.17, 8, 7]} />
              <meshStandardMaterial color={PALETTE.leafDeep} roughness={1} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 2.46, 0]} castShadow>
          <boxGeometry args={[4.45, 0.28, 0.42]} />
          <meshStandardMaterial color={PALETTE.wood} roughness={0.9} />
        </mesh>
        <mesh position={[0, 2.88, 0.02]}>
          <boxGeometry args={[1.5, 0.52, 0.08]} />
          <meshStandardMaterial map={gateSign} roughness={0.9} />
        </mesh>
        {[-1.25, -0.72, 0.72, 1.25].map((x, i) => (
          <mesh
            key={x}
            position={[x, 2.25 + (i % 2) * 0.08, 0.18]}
            rotation-z={i % 2 ? 0.35 : -0.35}
          >
            <icosahedronGeometry args={[0.13, 0]} />
            <meshStandardMaterial color={i % 2 ? "#f2a2b8" : "#f6c76b"} roughness={0.9} />
          </mesh>
        ))}
      </group>

      {/* Fairy-light vine arch frames the companion and the constellation. */}
      <group ref={fairyArch} position={[GARDEN.x, gy, GARDEN.z + 2.45]}>
        {[-2.2, 2.2].map((x) => (
          <mesh key={x} position={[x, 0.68, 0]} castShadow>
            <cylinderGeometry args={[0.06, 0.075, 1.36, 7]} />
            <meshStandardMaterial color={PALETTE.woodDark} roughness={1} />
          </mesh>
        ))}
        <mesh position={[0, 1.36, 0]} castShadow>
          <torusGeometry args={[2.2, 0.065, 8, 32, Math.PI]} />
          <meshStandardMaterial color={PALETTE.leafDeep} roughness={1} />
        </mesh>
        <instancedMesh ref={archLights} args={[undefined, undefined, archBulbs.length]}>
          <sphereGeometry args={[0.072, 8, 6]} />
          <meshStandardMaterial
            color="#fff7e8"
            emissive="#ffd9a0"
            emissiveIntensity={0.35}
            roughness={0.45}
          />
        </instancedMesh>
      </group>

      {/* Repeating the café's warm light ties the future dream to the finale. */}
      <VirtualLight
        ref={gardenGlow}
        position={[0, gy + 3.4, GARDEN.z]}
        color="#ffd7a0"
        intensity={0}
        distance={15}
        decay={2}
      />

      {GARDEN_LANTERNS.map(([lx, lz], i) => (
        <GardenLantern key={i} index={i} position={[lx, groundHeight(lx, lz), lz]} />
      ))}
    </group>
  )
}

const GardenFloor = ({ y }: { y: number }): React.ReactElement => {
  const lawnMaterial = useMemo(() => makeGroundMaterial(), [])
  const pathStones = Array.from({ length: 7 }, (_, i) => ({
    x: Math.sin(i * 1.31) * 0.18,
    z: THREE.MathUtils.lerp(GATE.z - 0.35, GARDEN.z + 0.55, i / 6),
  }))
  return (
    <group>
      <mesh position={[GARDEN.x, y - 0.015, GARDEN.z]} receiveShadow>
        <cylinderGeometry args={[6.45, 6.9, 0.14, 28]} />
        <primitive object={lawnMaterial} attach="material" />
      </mesh>
      <mesh position={[GARDEN.x, y + 0.055, GARDEN.z]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[3.25, 0.075, 8, 36]} />
        <meshStandardMaterial
          color="#e8c47a"
          emissive="#c9964e"
          emissiveIntensity={0.18}
          roughness={0.8}
        />
      </mesh>
      <mesh
        position={[GARDEN.x, y + 0.02, GARDEN.z]}
        rotation-x={-Math.PI / 2}
        receiveShadow
      >
        <circleGeometry args={[2.9, 28]} />
        <primitive object={lawnMaterial} attach="material" />
      </mesh>
      {pathStones.map((stone, i) => (
        <mesh
          key={i}
          position={[stone.x, groundHeight(stone.x, stone.z) + 0.065, stone.z]}
          rotation-x={-Math.PI / 2}
          rotation-z={i * 0.47}
          scale={[1.2, 0.72, 1]}
          receiveShadow
        >
          <circleGeometry args={[0.5, 10]} />
          <meshStandardMaterial color={i % 2 ? "#eadcc2" : "#d9c9ae"} roughness={1} />
        </mesh>
      ))}
      {/* heart-shaped petal inlay at the center */}
      {[
        [-0.36, 0],
        [0.36, 0],
        [-0.68, -0.22],
        [0.68, -0.22],
        [-0.48, -0.56],
        [0.48, -0.56],
        [0, -0.92],
        [0, -0.42],
      ].map(([x, z], i) => (
        <mesh
          key={i}
          position={[x, y + 0.055, GARDEN.z + z]}
          rotation-x={-Math.PI / 2}
          rotation-z={i * 0.8}
          scale={[1, 0.55, 1]}
        >
          <circleGeometry args={[0.22, 8]} />
          <meshStandardMaterial color={i % 2 ? "#e8a08a" : "#f2b1bf"} roughness={0.9} />
        </mesh>
      ))}
    </group>
  )
}

const GardenFlowers = ({ y }: { y: number }): React.ReactElement => {
  const stems = useRef<THREE.InstancedMesh>(null)
  const heads = useRef<THREE.InstancedMesh>(null)
  const data = useMemo(() => {
    const rng = makeRng(8262026)
    return Array.from({ length: 52 }, (_, i) => {
      const a = (i / 52) * Math.PI * 2 + (rng() - 0.5) * 0.14
      const r = 3.8 + rng() * 1.95
      return {
        x: GARDEN.x + Math.cos(a) * r,
        z: GARDEN.z + Math.sin(a) * r,
        h: 0.26 + rng() * 0.22,
        color: new THREE.Color(["#f2a2b8", "#f6c76b", "#e8956d", "#cfa9e8"][i % 4]),
      }
    })
  }, [])

  useLayoutEffect(() => {
    if (!stems.current || !heads.current) return
    const stemMatrix = new THREE.Matrix4()
    const headMatrix = new THREE.Matrix4()
    data.forEach((flower, i) => {
      stemMatrix.makeTranslation(flower.x, y + flower.h / 2, flower.z)
      stemMatrix.scale(new THREE.Vector3(1, flower.h / 0.35, 1))
      headMatrix.makeTranslation(flower.x, y + flower.h, flower.z)
      stems.current?.setMatrixAt(i, stemMatrix)
      heads.current?.setMatrixAt(i, headMatrix)
      heads.current?.setColorAt(i, flower.color)
    })
    stems.current.instanceMatrix.needsUpdate = true
    heads.current.instanceMatrix.needsUpdate = true
    if (heads.current.instanceColor) heads.current.instanceColor.needsUpdate = true
  }, [data, y])

  return (
    <group>
      <instancedMesh ref={stems} args={[undefined, undefined, data.length]}>
        <cylinderGeometry args={[0.018, 0.024, 0.35, 5]} />
        <meshStandardMaterial color={PALETTE.leafDeep} roughness={1} />
      </instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, data.length]}>
        <icosahedronGeometry args={[0.11, 0]} />
        <meshStandardMaterial roughness={0.85} flatShading />
      </instancedMesh>
    </group>
  )
}

const CakeTable = ({ y }: { y: number }): React.ReactElement => (
  <group position={[-2.65, y, GARDEN.z - 0.15]}>
    <mesh position={[0, 0.48, 0]} castShadow>
      <cylinderGeometry args={[0.62, 0.55, 0.09, 16]} />
      <meshStandardMaterial color="#f6ead7" roughness={0.85} />
    </mesh>
    <mesh position={[0, 0.24, 0]}>
      <cylinderGeometry args={[0.07, 0.1, 0.48, 10]} />
      <meshStandardMaterial color={PALETTE.woodDark} roughness={0.9} />
    </mesh>
    <mesh position={[0, 0.59, 0]} castShadow>
      <cylinderGeometry args={[0.3, 0.34, 0.2, 14]} />
      <meshStandardMaterial color="#f3bdc5" roughness={0.8} />
    </mesh>
    <mesh position={[0, 0.75, 0]} castShadow>
      <cylinderGeometry args={[0.21, 0.24, 0.16, 14]} />
      <meshStandardMaterial color="#fff0dc" roughness={0.8} />
    </mesh>
    {[-0.1, 0, 0.1].map((x, i) => (
      <group key={x} position={[x, 0.9, 0]}>
        <mesh position={[0, -0.06, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 0.12, 6]} />
          <meshStandardMaterial color={i % 2 ? "#cfa9e8" : "#e8a08a"} />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.026, 8, 6]} />
          <meshStandardMaterial color="#fff4c9" emissive="#ffbd62" emissiveIntensity={1.8} />
        </mesh>
      </group>
    ))}
  </group>
)

const GardenGuests = ({ y }: { y: number }): React.ReactElement => (
  <group>
    <TinyGardenCat position={[-3.55, y, GARDEN.z + 1.35]} color="#f0b66f" rotationY={0.8} />
    <TinyGardenCat position={[3.45, y, GARDEN.z - 0.25]} color="#d8d0c4" rotationY={-1.3} />
    <TinyGardenCat position={[2.45, y, GARDEN.z + 2.25]} color="#6f655e" rotationY={2.8} />
    <group position={[2.8, y, GARDEN.z - 2.0]} rotation-y={-0.3}>
      <mesh position={[0, 0.18, 0]} castShadow>
        <boxGeometry args={[0.52, 0.36, 0.52]} />
        <meshStandardMaterial color="#cfa9e8" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.38, 0]}>
        <boxGeometry args={[0.6, 0.08, 0.6]} />
        <meshStandardMaterial color="#fff0dc" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.4, 0]}>
        <boxGeometry args={[0.09, 0.08, 0.72]} />
        <meshStandardMaterial color="#e8c47a" />
      </mesh>
    </group>
  </group>
)

const TinyGardenCat = ({
  position,
  color,
  rotationY,
}: {
  position: [number, number, number]
  color: string
  rotationY: number
}): React.ReactElement => (
  <group position={position} rotation-y={rotationY} scale={0.82}>
    <mesh position={[0, 0.18, 0]} scale={[1, 0.82, 1.3]} castShadow>
      <sphereGeometry args={[0.2, 10, 8]} />
      <meshStandardMaterial color={color} roughness={0.95} />
    </mesh>
    <mesh position={[0, 0.38, 0.16]} castShadow>
      <sphereGeometry args={[0.17, 10, 8]} />
      <meshStandardMaterial color={color} roughness={0.95} />
    </mesh>
    {[-0.1, 0.1].map((x) => (
      <mesh
        key={x}
        position={[x, 0.53, 0.15]}
        rotation={[0.05, 0, x < 0 ? -0.18 : 0.18]}
      >
        <coneGeometry args={[0.075, 0.17, 4]} />
        <meshStandardMaterial color={color} roughness={0.95} />
      </mesh>
    ))}
    <mesh position={[0.2, 0.19, -0.18]} rotation={[0.3, 0, 0.7]}>
      <torusGeometry args={[0.19, 0.035, 6, 14, Math.PI * 1.35]} />
      <meshStandardMaterial color={color} roughness={0.95} />
    </mesh>
  </group>
)

const GardenLantern = ({
  index,
  position,
}: {
  index: number
  position: [number, number, number]
}): React.ReactElement => {
  const litRef = useRef(0)
  const [lit, setLit] = useState(0)
  useHubFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.2)
    let target = smoothstep(0.62, 0.95, worldRT.timeOfDay) * 0.35
    if (worldRT.finalePhase >= 1 && worldRT.finaleTime > index * 0.38) target = 1
    if (worldRT.finalePhase >= 3) target = 1
    litRef.current = THREE.MathUtils.damp(litRef.current, target, 5, dt)
    const rounded = Math.round(litRef.current * 4) / 4
    if (rounded !== lit) setLit(rounded)
  })
  return <Lantern position={position} lit={lit} scale={1.1} />
}
