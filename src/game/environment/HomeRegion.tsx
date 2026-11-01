import { useMemo } from "react"
import { PALETTE } from "./props"
import { BRIDGE_HALF_WIDTH, RIVER_Z, groundHeight } from "../world-layout"
import { Water } from "./Water"

/**
 * The home region: creek, pond and bridge.
 * The terrain surface is rendered by the streamed world (src/world).
 */
export const HomeRegion = (): React.ReactElement => {
  // Terrain and contact history are shared with the streamed world.
  return (
    <group>
      <Water />
      <Bridge />
    </group>
  )
}

/** Little arched plank bridge over the river. */
const Bridge = (): React.ReactElement => {
  const planks = useMemo(() => {
    const arr: Array<{ pos: [number, number, number]; rot: number }> = []
    const n = 9
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1)
      const z = RIVER_Z + 2.4 - t * 4.8
      const y = groundHeight(0, z)
      arr.push({ pos: [0, y - 0.03, z], rot: (t - 0.5) * -0.3 })
    }
    return arr
  }, [])
  return (
    <group>
      {planks.map((p, i) => (
        <group key={i} position={p.pos} rotation-x={p.rot}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[BRIDGE_HALF_WIDTH * 2 + 0.3, 0.08, 0.5]} />
            <meshStandardMaterial color={PALETTE.wood} roughness={0.9} />
          </mesh>
        </group>
      ))}
      {[-1, 1].map((side) =>
        [-2.1, 2.1].map((dz) => (
          <mesh
            key={`${side}${dz}`}
            position={[side * (BRIDGE_HALF_WIDTH + 0.1), 0.42, RIVER_Z + dz]}
          >
            <cylinderGeometry args={[0.04, 0.05, 0.8, 6]} />
            <meshStandardMaterial color={PALETTE.woodDark} roughness={0.9} />
          </mesh>
        )),
      )}
      {[-1, 1].map((side) => (
        <mesh
          key={`rail${side}`}
          position={[side * (BRIDGE_HALF_WIDTH + 0.1), 0.78, RIVER_Z]}
          rotation-x={0.06}
        >
          <boxGeometry args={[0.07, 0.07, 4.4]} />
          <meshStandardMaterial color={PALETTE.woodDark} roughness={0.9} />
        </mesh>
      ))}
    </group>
  )
}
