import { useHubFrame } from "../hubGate"

import { useMemo, useRef } from "react"
import * as THREE from "three"
import { makeRng } from "../../utils/math"
import { TREES, groundHeight, type Prop } from "../world-layout"
import { weatherRT } from "../weather/weatherState"
import { PALETTE } from "./props"

type FruitKind = "mango" | "apple" | "orange" | "lemon" | "guava" | "coconut"

const FRUIT_TREE_SPECS: Array<{ treeIndex: number; kind: FruitKind }> = [
  { treeIndex: 30, kind: "mango" },
  { treeIndex: 34, kind: "apple" },
  { treeIndex: 38, kind: "orange" },
  { treeIndex: 43, kind: "lemon" },
  { treeIndex: 48, kind: "guava" },
  { treeIndex: 53, kind: "coconut" },
]

const FRUIT_COLORS: Record<FruitKind, string> = {
  mango: "#f3b83f",
  apple: "#d94b48",
  orange: "#ee8d2d",
  lemon: "#efd64e",
  guava: "#92c85f",
  coconut: "#7a5435",
}

const NEST_TREE_INDICES = [32, 41, 50]

type FruitMatrices = Record<FruitKind, THREE.Matrix4[]>

const emptyFruitMatrices = (): FruitMatrices => ({
  mango: [],
  apple: [],
  orange: [],
  lemon: [],
  guava: [],
  coconut: [],
})

/** Fruit, nest and monkey discoveries placed only on intentionally selected interior trees. */
export const LivingTreeDetails = (): React.ReactElement => {
  const fruitMatrices = useMemo(() => {
    const result = emptyFruitMatrices()
    const rng = makeRng(20260830)
    const position = new THREE.Vector3()
    const scale = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const euler = new THREE.Euler()
    const matrix = new THREE.Matrix4()

    FRUIT_TREE_SPECS.forEach(({ treeIndex, kind }) => {
      const tree = TREES[treeIndex]
      if (!tree) return
      const ground = groundHeight(tree.x, tree.z)
      const count = kind === "coconut" ? 5 : 6 + Math.floor(rng() * 3)
      for (let index = 0; index < count; index++) {
        const angle = (index / count) * Math.PI * 2 + rng() * 0.7
        const radius = tree.s * (0.34 + rng() * 0.4)
        position.set(
          tree.x + Math.cos(angle) * radius,
          ground + tree.s * (1.25 + rng() * 0.72),
          tree.z + Math.sin(angle) * radius,
        )
        const size = (kind === "coconut" ? 0.13 : 0.085) * (0.82 + rng() * 0.36)
        if (kind === "mango") scale.set(size * 0.82, size * 1.28, size * 0.82)
        else if (kind === "lemon") scale.set(size * 0.9, size * 1.12, size * 0.9)
        else if (kind === "coconut") scale.set(size * 0.88, size * 1.2, size)
        else scale.setScalar(size)
        euler.set(rng() * 0.35, rng() * Math.PI * 2, rng() * 0.35)
        quaternion.setFromEuler(euler)
        matrix.compose(position, quaternion, scale)
        result[kind].push(matrix.clone())
      }
    })
    return result
  }, [])

  return (
    <group>
      {(Object.keys(FRUIT_COLORS) as FruitKind[]).map((kind) => (
        <FruitInstances
          key={kind}
          kind={kind}
          matrices={fruitMatrices[kind]}
          color={FRUIT_COLORS[kind]}
        />
      ))}
      {NEST_TREE_INDICES.map((treeIndex, index) => {
        const tree = TREES[treeIndex]
        return tree ? <NestDiscovery key={treeIndex} tree={tree} seed={index} occupied={index !== 1} /> : null
      })}
    </group>
  )
}

const FruitInstances = ({
  kind,
  matrices,
  color,
}: {
  kind: FruitKind
  matrices: THREE.Matrix4[]
  color: string
}): React.ReactElement => (
  <instancedMesh
    ref={(mesh) => {
      if (!mesh) return
      matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix))
      mesh.instanceMatrix.needsUpdate = true
    }}
    args={[undefined, undefined, matrices.length]}
    castShadow
  >
    {kind === "coconut" ? <dodecahedronGeometry args={[1, 1]} /> : <sphereGeometry args={[1, 10, 8]} />}
    <meshStandardMaterial color={color} roughness={kind === "apple" ? 0.52 : 0.78} />
  </instancedMesh>
)

const NestDiscovery = ({
  tree,
  seed,
  occupied,
}: {
  tree: Prop
  seed: number
  occupied: boolean
}): React.ReactElement => {
  const group = useRef<THREE.Group>(null)
  const wing = useRef<THREE.Mesh>(null)
  const ground = groundHeight(tree.x, tree.z)
  const angle = seed * 2.1 + 0.55
  const x = tree.x + Math.cos(angle) * tree.s * 0.42
  const z = tree.z + Math.sin(angle) * tree.s * 0.42
  const y = ground + tree.s * (1.22 + (seed % 2) * 0.2)

  useHubFrame((state) => {
    const wind = Math.min(1, weatherRT.wind + weatherRT.gust * 0.55)
    if (group.current) {
      group.current.rotation.z = Math.sin(state.clock.elapsedTime * 1.4 + seed) * wind * 0.035
    }
    if (wing.current) {
      const flutter = Math.sin(state.clock.elapsedTime * 6.5 + seed) > 0.8 ? 0.42 : 0.08
      wing.current.rotation.z = flutter
    }
  })

  return (
    <group ref={group} position={[x, y, z]} rotation-y={-angle}>
      <mesh position={[0, -0.06, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.045, 0.075, tree.s * 0.92, 6]} />
        <meshStandardMaterial color={PALETTE.trunk} roughness={1} />
      </mesh>
      <group position={[0, 0.02, 0]} scale={tree.s * 0.82}>
        {[0, 1, 2].map((ring) => (
          <mesh key={`nest-ring:${ring}`} rotation-x={Math.PI / 2} rotation-z={ring * 0.7} position={[0, ring * 0.018, 0]}>
            <torusGeometry args={[0.16 - ring * 0.025, 0.024, 5, 16]} />
            <meshStandardMaterial color={ring === 1 ? "#7b5737" : "#956a42"} roughness={1} />
          </mesh>
        ))}
        {!occupied &&
          [-0.05, 0.04].map((eggX) => (
            <mesh key={`egg:${eggX}`} position={[eggX, 0.075, 0]} scale={[0.72, 1, 0.72]}>
              <sphereGeometry args={[0.038, 8, 6]} />
              <meshStandardMaterial color="#d8e7df" roughness={0.72} />
            </mesh>
          ))}
        {occupied && (
          <group position={[0.02, 0.13, 0]} rotation-y={0.4}>
            <mesh scale={[0.75, 0.65, 1]}>
              <sphereGeometry args={[0.09, 9, 7]} />
              <meshStandardMaterial color="#648095" roughness={0.86} />
            </mesh>
            <mesh ref={wing} position={[-0.055, 0.01, 0]} scale={[0.7, 0.22, 0.9]}>
              <sphereGeometry args={[0.08, 8, 6]} />
              <meshStandardMaterial color="#445d70" roughness={0.9} />
            </mesh>
            <mesh position={[0, 0.075, 0.065]}>
              <sphereGeometry args={[0.055, 8, 6]} />
              <meshStandardMaterial color="#718da1" roughness={0.86} />
            </mesh>
            <mesh position={[0, 0.065, 0.125]} rotation-x={Math.PI / 2}>
              <coneGeometry args={[0.015, 0.045, 5]} />
              <meshStandardMaterial color="#d9a23b" roughness={0.7} />
            </mesh>
          </group>
        )}
      </group>
    </group>
  )
}

