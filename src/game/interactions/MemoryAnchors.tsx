import { useEffect, useMemo } from "react"
import { useGame } from "../../state/gameStore"
import { MEMORIES } from "../../content/memories"
import { groundHeight } from "../world-layout"
import { MemoryWisp } from "./wisps/MemoryWisp"
import { registerDevTool } from "../../dev/devTools"
import { avatarRT, cameraRT, resetRuntime } from "../runtime"

/**
 * One living wisp per memory stop, each in the energy of its own memory.
 * Visited stops rest as a small ember (see wisps/MemoryWisp.tsx).
 */
export const MemoryAnchors = (): React.ReactElement => {
  useEffect(() => {
    // QA: stand `back` m south of a memory's wisp, inside its radius, camera behind her
    registerDevTool("wisp", ((id: string, back = 2.0) => {
      const m = MEMORIES.find((x) => x.id === id)
      if (!m) return null
      resetRuntime({ x: m.worldPosition[0] + 0.5, z: m.worldPosition[2] + back })
      cameraRT.yaw = cameraRT.targetYaw = 0.25
      return m.id
    }) as (...args: never[]) => unknown)
    // QA: each stop's layout ground height beside the standing avatar's real height
    registerDevTool("wispGround", (() => MEMORIES.map((m) => [m.id, +groundHeight(m.worldPosition[0], m.worldPosition[2]).toFixed(2)])) as (...args: never[]) => unknown)
    registerDevTool("avatarY", (() => +avatarRT().pos.y.toFixed(2)) as (...args: never[]) => unknown)
  }, [])
  return <>
    {MEMORIES.map((m) => (
      <Anchor key={m.id} id={m.id} position={[m.worldPosition[0], m.worldPosition[2]]} />
    ))}
  </>
}

const Anchor = ({ id, position }: { id: string; position: [number, number] }): React.ReactElement => {
  const visited = useGame((s) => s.visited[id] ?? false)
  const y = useMemo(() => groundHeight(position[0], position[1]), [position])
  return <MemoryWisp id={id} position={position} groundY={y} visited={visited} />
}
