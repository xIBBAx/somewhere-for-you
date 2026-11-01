import { VirtualLight, VirtualPointLight } from "../lightPool"
import { useHubFrame } from "../hubGate"

import { useMemo, useRef } from "react"
import * as THREE from "three"
import { worldRT } from "../runtime"
import { groundHeight } from "../world-layout"
import { smoothstep } from "../../utils/math"

type TreeLightStrand = {
  treeX: number
  treeZ: number
  trunkRadius: number
  height: number
  loops: number
  bulbCount: number
  palette: string[]
}

const STRANDS: TreeLightStrand[] = [
  {
    treeX: 9.5,
    treeZ: 9.2, // Pond Gulmohar Tree
    trunkRadius: 0.55,
    height: 3.2,
    loops: 4.5,
    bulbCount: 36,
    palette: ["#fef08a", "#f472b6", "#fde047", "#fda4af"],
  },
  {
    treeX: -15.8,
    treeZ: 3.8, // Studio Gulmohar Tree
    trunkRadius: 0.58,
    height: 3.4,
    loops: 5.0,
    bulbCount: 40,
    palette: ["#fef08a", "#7dd3fc", "#a7f3d0", "#f472b6"],
  },
  {
    treeX: 3.6,
    treeZ: -23.5, // garden arch gulmohar tree
    trunkRadius: 0.62,
    height: 3.6,
    loops: 5.2,
    bulbCount: 44,
    palette: ["#fef08a", "#fcd34d", "#f472b6", "#c084fc"],
  },
]

export const TreeFairyLights = (): React.ReactElement => {
  return (
    <group>
      {STRANDS.map((strand, i) => (
        <SingleTreeFairyLights key={i} strand={strand} />
      ))}
    </group>
  )
}

const dummy = new THREE.Object3D()

const SingleTreeFairyLights = ({ strand }: { strand: TreeLightStrand }): React.ReactElement => {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const lightRef = useRef<VirtualPointLight>(null)
  const gy = groundHeight(strand.treeX, strand.treeZ)

  const { bulbs, colors } = useMemo(() => {
    const list: Array<{ x: number; y: number; z: number; phase: number }> = []
    const cols: THREE.Color[] = []

    for (let i = 0; i < strand.bulbCount; i++) {
      const t = i / strand.bulbCount
      const angle = t * Math.PI * 2 * strand.loops
      const r = strand.trunkRadius * (1.05 - t * 0.25)
      const x = Math.cos(angle) * r
      const z = Math.sin(angle) * r
      const y = 0.6 + t * strand.height

      list.push({ x, y, z, phase: i * 0.73 })
      cols.push(new THREE.Color(strand.palette[i % strand.palette.length]))
    }
    return { bulbs: list, colors: cols }
  }, [strand])

  useHubFrame((state) => {
    const mesh = meshRef.current
    if (!mesh) return
    const night = smoothstep(0.52, 0.85, worldRT.timeOfDay)
    if (night <= 0.01) {
      mesh.visible = false
      if (lightRef.current) lightRef.current.intensity = 0
      return
    }
    mesh.visible = true

    const t = state.clock.elapsedTime
    for (let i = 0; i < bulbs.length; i++) {
      const b = bulbs[i]
      const twinkle = 0.75 + Math.sin(t * 3.5 + b.phase) * 0.25
      const s = 0.038 * twinkle * night

      dummy.position.set(b.x, b.y, b.z)
      dummy.scale.setScalar(s)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, colors[i])
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

    if (lightRef.current) {
      lightRef.current.intensity = night * 0.95
    }
  })

  return (
    <group position={[strand.treeX, gy, strand.treeZ]}>
      <instancedMesh ref={meshRef} args={[undefined, undefined, strand.bulbCount]}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </instancedMesh>
      {/* Warm ambient tree lantern glow */}
      <VirtualLight ref={lightRef} color="#fef08a" distance={4.5} position={[0, 1.8, 0]} />
    </group>
  )
}
