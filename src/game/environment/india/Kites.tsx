import { useLayoutEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { smoothstep } from "../../../utils/math"
import { useHubFrame } from "../../hubGate"
import { worldRT } from "../../runtime"
import { weatherRT } from "../../weather/weatherState"
import { windRT } from "../../../world/wind"

/** Patang: bright paper kites over home on a dry day, each with its own string. */
const KITES = [
  { x: -12, z: 8, h: 24, a: "#e8381d", b: "#ffd34d", seed: 0.3 },
  { x: 9, z: 26, h: 30, a: "#1b8a5a", b: "#fff4e0", seed: 1.1 },
  { x: 20, z: 2, h: 22, a: "#d81b60", b: "#ffd34d", seed: 2.4 },
  { x: -24, z: -14, h: 34, a: "#2546b8", b: "#ffb72e", seed: 3.7 },
  { x: 4, z: -38, h: 28, a: "#f7a01c", b: "#7b2cbf", seed: 4.9 },
  { x: 28, z: -24, h: 36, a: "#e8381d", b: "#1b8a5a", seed: 5.6 },
]

const kiteGeometry = (): THREE.BufferGeometry => {
  // a diamond of two colours (the second is the vertex colour's dark half), with a small tail
  const w = 0.62, h = 0.78, t = 0.34
  const positions = new Float32Array([
    0, h, 0, -w, 0, 0, 0, -h, 0,
    0, h, 0, 0, -h, 0, w, 0, 0,
    -0.09, -h, 0, 0.09, -h, 0, 0, -h - t, 0,
  ])
  const side = new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2])
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3))
  g.setAttribute("aSide", new THREE.BufferAttribute(side, 1))
  g.computeVertexNormals()
  return g
}

export const Kites = (): React.ReactElement => {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const lines = useRef<THREE.LineSegments>(null)
  const geometry = useMemo(() => kiteGeometry(), [])
  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.7 })
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aSide;\nattribute vec3 aSecond;\nvarying vec3 vKite;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvKite = aSide < 0.5 ? instanceColor : aSecond;")
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vKite;")
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = vKite;")
    }
    return m
  }, [])
  const lineGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(KITES.length * 6), 3))
    return g
  }, [])

  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    const second = new Float32Array(KITES.length * 3)
    KITES.forEach((k, i) => {
      m.setColorAt(i, new THREE.Color(k.a))
      new THREE.Color(k.b).toArray(second, i * 3)
    })
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    geometry.setAttribute("aSecond", new THREE.InstancedBufferAttribute(second, 3))
    m.frustumCulled = false
  }, [geometry])

  const _m = useMemo(() => new THREE.Matrix4(), [])
  const _p = useMemo(() => new THREE.Vector3(), [])
  const _q = useMemo(() => new THREE.Quaternion(), [])
  const _e = useMemo(() => new THREE.Euler(), [])
  const _s = useMemo(() => new THREE.Vector3(1.9, 1.9, 1.9), [])

  useHubFrame((state) => {
    const m = mesh.current
    const l = lines.current
    if (!m || !l) return
    const day = smoothstep(0.26, 0.32, worldRT.timeOfDay) * (1 - smoothstep(0.7, 0.76, worldRT.timeOfDay))
    const dry = 1 - smoothstep(0.08, 0.3, weatherRT.rain)
    const up = day * dry
    m.visible = l.visible = up > 0.02
    if (!m.visible) return
    const t = state.clock.elapsedTime
    const pos = lineGeometry.attributes.position as THREE.BufferAttribute
    KITES.forEach((k, i) => {
      // a kite leans downwind and hunts about the end of its string
      const sway = Math.sin(t * 0.37 + k.seed) * 2.6 + Math.sin(t * 0.91 + k.seed * 2.0) * 0.8
      const bob = Math.sin(t * 0.53 + k.seed * 3.0) * 1.6
      const x = k.x + windRT.dirX * 6 + sway
      const z = k.z + windRT.dirZ * 6 + Math.cos(t * 0.31 + k.seed) * 2.0
      const y = k.h * up + bob
      _p.set(x, y, z)
      _e.set(-0.5 + Math.sin(t * 0.7 + k.seed) * 0.1, k.seed + t * 0.02, Math.sin(t * 1.3 + k.seed) * 0.32)
      _q.setFromEuler(_e)
      _m.compose(_p, _q, _s)
      m.setMatrixAt(i, _m)
      // the string runs down to the ground beyond the home meadow
      pos.setXYZ(i * 2, x, y, z)
      pos.setXYZ(i * 2 + 1, k.x * 0.55, 0.6, k.z * 0.55)
    })
    m.instanceMatrix.needsUpdate = true
    pos.needsUpdate = true
  })

  return (
    <group name="kites" userData={{ dynamic: true }}>
      <instancedMesh ref={mesh} args={[geometry, material, KITES.length]} />
      <lineSegments ref={lines} geometry={lineGeometry} frustumCulled={false}>
        <lineBasicMaterial color="#efe6d6" transparent opacity={0.2} />
      </lineSegments>
    </group>
  )
}
