import { useHubFrame } from "../hubGate"

import { useMemo, useRef } from "react"
import * as THREE from "three"
import { useGame } from "../../state/gameStore"
import { SECRETS } from "../../content/secrets"
import { catRT } from "../runtime"
import { groundHeight } from "../world-layout"

/**
 * Paw trails: once the cat heads for a secret, paw prints fade in along
 * the trail behind her, and the hidden item glows at the end.
 */
export const Secrets = (): React.ReactElement => (
  <>
    {SECRETS.map((s) => (
      <PawTrail key={s.id} secretId={s.id} start={s.trailStart} end={s.trailEnd} />
    ))}
  </>
)

const PawTrail = ({
  secretId,
  start,
  end,
}: {
  secretId: string
  start: [number, number]
  end: [number, number]
}): React.ReactElement => {
  const found = useGame((s) => s.secrets.includes(secretId))
  const prints = useMemo(() => {
    const arr: Array<{ x: number; z: number; rot: number; t: number }> = []
    const dx = end[0] - start[0]
    const dz = end[1] - start[1]
    const len = Math.hypot(dx, dz)
    const n = Math.max(4, Math.floor(len / 0.55))
    const ang = Math.atan2(dx, dz)
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1)
      const px = start[0] + dx * t
      const pz = start[1] + dz * t
      const side = i % 2 === 0 ? 0.12 : -0.12
      arr.push({
        x: px + Math.cos(ang) * side,
        z: pz - Math.sin(ang) * side,
        rot: ang,
        t: (i + 1) / n,
      })
    }
    return arr
  }, [start, end])

  const group = useRef<THREE.Group>(null)
  const item = useRef<THREE.Mesh>(null)
  const revealed = useRef(0)

  const printGeo = useMemo(() => {
    const pads = [[0, -0.018, 0.048], [-0.047, 0.033, 0.020], [-0.018, 0.064, 0.022], [0.022, 0.064, 0.022], [0.05, 0.031, 0.020]]
    return new THREE.ShapeGeometry(pads.map(([x, y, r]) => {
      const pad = new THREE.Shape()
      pad.absellipse(x, y, r, r * 0.85, 0, Math.PI * 2, false, 0)
      return pad
    }), 8)
  }, [])

  useHubFrame((state) => {
    const g = group.current
    if (!g) return
    // reveal prints as the cat passes them (progress along the trail)
    const active = catRT.poiKind === "secret" && catRT.poi &&
      Math.hypot(catRT.poi.x - end[0], catRT.poi.z - end[1]) < 0.5
    const catT = active
      ? 1 -
        Math.hypot(catRT.pos.x - end[0], catRT.pos.z - end[1]) /
          Math.max(0.001, Math.hypot(end[0] - start[0], end[1] - start[1]))
      : 0
    revealed.current = Math.max(revealed.current, catT)
    g.children.forEach((child, i) => {
      if (i < prints.length) {
        const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial
        const target = found ? 0.4 : revealed.current >= prints[i].t - 0.05 ? 0.65 : 0
        mat.opacity += (target - mat.opacity) * 0.08
      }
    })
    if (item.current) {
      const reachable = found ? 0 : revealed.current > 0.92 ? 1 : 0.35
      const mat = item.current.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = reachable * (0.8 + Math.sin(state.clock.elapsedTime * 3) * 0.3)
      item.current.position.y = groundHeight(end[0], end[1]) + 0.35 + Math.sin(state.clock.elapsedTime * 1.8) * 0.06
      item.current.visible = !found || mat.emissiveIntensity > 0
    }
  })

  const y0 = groundHeight(end[0], end[1])

  return (
    <group>
      <group ref={group}>
        {prints.map((p, i) => (
          <mesh
            key={i}
            geometry={printGeo}
            position={[p.x, groundHeight(p.x, p.z) + 0.03, p.z]}
            rotation={[-Math.PI / 2, 0, -p.rot]}
          >
            <meshBasicMaterial color="#5c4a3d" transparent opacity={0} depthWrite={false} />
          </mesh>
        ))}
      </group>
      {/* hidden item at the end: a tiny glowing envelope/note */}
      <mesh
        ref={item}
        position={[end[0], y0 + 0.35, end[1]]}
        rotation={[0, Math.PI / 4, 0]}
      >
        <boxGeometry args={[0.3, 0.2, 0.04]} />
        <meshStandardMaterial
          color="#fffaf0"
          emissive="#cfa9e8"
          emissiveIntensity={0.4}
          roughness={0.7}
        />
      </mesh>
    </group>
  )
}
