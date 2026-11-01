import { useEffect, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { useGame } from "../../state/gameStore"
import { starLift, trailMote } from "../vfx/signatures"
import { avatarRT } from "../runtime"

/**
 * When a memory card closes, the stop's wisp streams into the explorer; once it has
 * arrived a little star lifts off her and drifts up, the visible echo of the
 * ✦ added to the HUD.
 */
/** the wisp's streams take about this long to reach her */
const ARRIVE = 2.1

export const StarCollect = (): React.ReactElement => {
  const mesh = useRef<THREE.Mesh>(null)
  const anim = useRef<{ t: number; pos: THREE.Vector3; burst: boolean } | null>(null)

  useEffect(() => {
    const unsub = useGame.subscribe((state, prev) => {
      if (!prev.activeMemoryId && state.activeMemoryId === null && state.stars > prev.stars) {
        if (mesh.current) anim.current = { t: -ARRIVE, pos: new THREE.Vector3(), burst: false }
      }
    })
    return unsub
  }, [])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const a = anim.current
    const m = mesh.current
    if (!a || !m) return
    a.t += dt
    if (a.t < 0) return
    if (!a.burst) {
      // leave from where she stands when the energy reaches her
      const body = avatarRT().pos
      a.pos.set(body.x, body.y + 1.25, body.z)
      starLift(a.pos)
      a.burst = true
    }
    const t = a.t / 1.4
    if (t >= 1) {
      anim.current = null
      m.visible = false
      return
    }
    m.visible = true
    m.position.set(a.pos.x, a.pos.y + t * 2.4, a.pos.z)
    m.rotation.y = a.t * 4
    // a tail of light behind the rising star
    trailMote(m.position, "#ffe3a3", 2, 0.05)
    const s = 0.22 * (1 - Math.max(0, t - 0.7) * 2.4)
    m.scale.setScalar(Math.max(0.001, s))
  })

  return (
    <mesh ref={mesh} visible={false}>
      <octahedronGeometry args={[1, 0]} />
      <meshStandardMaterial
        color="#ffe9b8"
        emissive="#e8c47a"
        emissiveIntensity={2}
        roughness={0.3}
      />
    </mesh>
  )
}
