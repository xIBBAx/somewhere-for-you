import { useHubFrame } from "../hubGate"

import { useMemo, useRef } from "react"
import * as THREE from "three"
import { makeRng } from "../../utils/math"
import { avatarRT } from "../runtime"
import { weatherRT } from "../weather/weatherState"
import { groundHeight, HOME_CENTER, HOME_RADIUS } from "../world-layout"

const COUNT = 110
const HALF = 22

export const HeatHaze = (): React.ReactElement => {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const data = useMemo(() => {
    const rng = makeRng(77291)
    return Array.from({ length: COUNT }, () => {
      const a = rng() * Math.PI * 2
      const r = Math.sqrt(rng()) * (HOME_RADIUS - 5)
      const x = HOME_CENTER.x + Math.cos(a) * r
      const z = HOME_CENTER.y + Math.sin(a) * r
      return {
        baseX: x,
        baseZ: z,
        y: groundHeight(x, z) + 0.12 + rng() * 0.22,
        scale: 0.55 + rng() * 0.9,
        phase: rng() * Math.PI * 2,
        speed: 0.9 + rng() * 1.1,
      }
    })
  }, [])

  useHubFrame((state, rawDt) => {
    if (!mesh.current) return
    const dt = Math.min(rawDt, 0.25)
    const heat = weatherRT.heat
    const rain = weatherRT.rain
    const cloud = weatherRT.cloud
    const snow = weatherRT.snow

    const hotClear = heat > 0.45 && rain < 0.12 && cloud < 0.45 && snow < 0.05
    const targetOpacity = hotClear ? THREE.MathUtils.mapLinear(heat, 0.45, 1, 0.08, 0.26) : 0

    const mat = mesh.current.material as THREE.MeshBasicMaterial
    mat.opacity = THREE.MathUtils.damp(mat.opacity, targetOpacity, 1.6, dt)
    mesh.current.visible = mat.opacity > 0.008
    if (!mesh.current.visible) return

    const t = state.clock.elapsedTime
    const px = avatarRT().pos.x
    const pz = avatarRT().pos.z
    const windX = Math.cos(weatherRT.windDirectionRad) * weatherRT.wind * 0.6
    const windZ = Math.sin(weatherRT.windDirectionRad) * weatherRT.wind * 0.6

    for (let i = 0; i < COUNT; i++) {
      const d = data[i]
      const near = Math.hypot(d.baseX - px, d.baseZ - pz) < HALF + 6
      if (!near) {
        dummy.position.set(0, -20, 0)
        dummy.scale.setScalar(0.001)
        dummy.updateMatrix()
        mesh.current.setMatrixAt(i, dummy.matrix)
        continue
      }
      const wobX = Math.sin(t * d.speed + d.phase) * 0.18
      const wobZ = Math.cos(t * d.speed * 0.9 + d.phase) * 0.14
      const wobY = Math.sin(t * 1.8 + d.phase) * 0.07
      const sx = d.scale * (0.9 + Math.sin(t * 1.2 + d.phase) * 0.12)
      dummy.position.set(d.baseX + wobX + windX * 0.2, d.y + wobY, d.baseZ + wobZ + windZ * 0.2)
      dummy.rotation.set(-Math.PI / 2 + Math.sin(t * 0.6 + d.phase) * 0.08, 0, Math.cos(t * 0.7 + d.phase) * 0.06)
      dummy.scale.set(sx * 1.6, sx, 1)
      dummy.updateMatrix()
      mesh.current.setMatrixAt(i, dummy.matrix)
    }
    mesh.current.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COUNT]} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial color="#fff7e0" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
    </instancedMesh>
  )
}
