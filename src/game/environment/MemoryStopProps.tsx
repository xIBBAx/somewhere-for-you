import { useHubFrame } from "../hubGate"

import { useRef, useState } from "react"
import { smoothstep } from "../../utils/math"
import { worldRT } from "../runtime"
import { groundHeight } from "../world-layout"
import { Bench, Lantern, TableSet } from "./props"

/**
 * Physical dressing for the shared-memory stops that don't have a
 * dedicated area component — each stop keeps its own little scene.
 */
export const MemoryStopProps = (): React.ReactElement => (
  <>
    {/* the long way round: a bench under a lamp by the pond */}
    <Bench position={[7.6, groundHeight(7.6, 11.4), 11.4]} rotationY={-0.6} />
    <EveningLantern position={[8.8, groundHeight(8.8, 10.3), 10.3]} />
    {/* the verandah table: cups left out */}
    <group position={[-8.9, groundHeight(-8.9, 12.4), 12.4]} rotation-y={0.5}>
      <mesh position={[0, 0.03, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[1.15, 20]} />
        <meshStandardMaterial color="#e8c4b0" roughness={1} />
      </mesh>
      <TableSet position={[0, 0, 0]} rotationY={0} cups={2} />
    </group>
  </>
)

const EveningLantern = ({ position }: { position: [number, number, number] }): React.ReactElement => {
  const [shown, setShown] = useState(0)
  const last = useRef(0)
  useHubFrame(() => {
    const target = Math.round(smoothstep(0.55, 0.85, worldRT.timeOfDay) * 4) / 4
    if (target !== last.current) {
      last.current = target
      setShown(target)
    }
  })
  return <Lantern position={position} lit={shown} scale={0.9} />
}
