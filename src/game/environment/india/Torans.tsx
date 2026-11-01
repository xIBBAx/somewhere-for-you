import { useLayoutEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { groundHeight } from "../../world-layout"
import { LADIS, TORANS } from "./indiaLayout"

const MARIGOLD = ["#ff8c00", "#ffa31a", "#ffb72e", "#f97a0a", "#ffc53d"].map((c) => new THREE.Color(c))
const SPACING = 0.105

type Bead = { x: number; y: number; z: number; s: number; c: THREE.Color }

const strand = (a: THREE.Vector3, b: THREE.Vector3, droop: number, seed: number): Bead[] => {
  const n = Math.max(2, Math.round(a.distanceTo(b) / SPACING))
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n
    const sag = droop * 4 * t * (1 - t)
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t - sag,
      z: a.z + (b.z - a.z) * t,
      s: 0.9 + ((i * 7 + seed) % 5) * 0.06,
      c: MARIGOLD[(i * 3 + seed) % MARIGOLD.length],
    }
  })
}

/** Marigold torans on the gateways: one instanced draw call for every flower. */
export const Torans = (): React.ReactElement => {
  const beads = useMemo(() => {
    const out: Bead[] = []
    TORANS.forEach((t, k) => {
      const a = new THREE.Vector3(t.a[0], groundHeight(t.a[0], t.a[2]) + t.a[1], t.a[2])
      const b = new THREE.Vector3(t.b[0], groundHeight(t.b[0], t.b[2]) + t.b[1], t.b[2])
      out.push(...strand(a, b, t.droop, k))
    })
    LADIS.forEach((l, k) => {
      const g = groundHeight(l.x, l.z)
      out.push(...strand(new THREE.Vector3(l.x, g + l.top, l.z), new THREE.Vector3(l.x, g + l.top - l.length, l.z), 0, k + 11))
    })
    return out
  }, [])
  const ref = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    beads.forEach((b, i) => {
      e.set(b.x * 13.1, b.y * 7.7, b.z * 11.3)
      q.setFromEuler(e)
      m.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.s, b.s * 0.82, b.s))
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, b.c)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [beads])

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, beads.length]} name="torans" castShadow>
      <icosahedronGeometry args={[0.062, 1]} />
      <meshStandardMaterial roughness={0.82} flatShading />
    </instancedMesh>
  )
}
