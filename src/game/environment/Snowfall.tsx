import { useFrame, useThree } from "@react-three/fiber"
import { useMemo, useRef } from "react"
import * as THREE from "three"
import { makeRng } from "../../utils/math"
import { avatarRT } from "../runtime"
import { weatherRT } from "../weather/weatherState"

const SNOW_COUNT = 900
const HALF_SPAN = 30

export const Snowfall = (): React.ReactElement => {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const { camera } = useThree()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const flakes = useMemo(() => {
    const rng = makeRng(90412 + 771)
    return Array.from({ length: SNOW_COUNT }, () => ({
      x: (rng() - 0.5) * HALF_SPAN * 2,
      z: (rng() - 0.5) * HALF_SPAN * 2,
      y: 5 + rng() * 14,
      size: 0.06 + rng() * 0.09,
      speed: 1.6 + rng() * 1.9,
      drift: (rng() - 0.5) * 0.4,
      phase: rng() * Math.PI * 2,
      spin: (rng() - 0.5) * 1.2,
    }))
  }, [])

  useFrame((_, rawDt) => {
    if (!mesh.current) return
    const dt = Math.min(rawDt, 1 / 20)
    const snow = weatherRT.snow
    const wind = weatherRT.wind
    const windRad = weatherRT.windDirectionRad
    const windX = Math.cos(windRad) * wind * 3.4
    const windZ = Math.sin(windRad) * wind * 1.6

    const mat = mesh.current.material as THREE.MeshBasicMaterial
    const targetOpacity = snow < 0.05 ? 0 : THREE.MathUtils.mapLinear(snow, 0.05, 1, 0.2, 0.86)
    mat.opacity = THREE.MathUtils.damp(mat.opacity, targetOpacity, 3.2, dt)
    mesh.current.visible = mat.opacity > 0.01
    if (!mesh.current.visible) return

    const followX = avatarRT().pos.x
    const followZ = avatarRT().pos.z
    const camY = camera.position.y

    for (let i = 0; i < SNOW_COUNT; i++) {
      const f = flakes[i]
      const fall = f.speed * (0.7 + snow * 0.6)
      f.y -= fall * dt
      f.x += (windX + f.drift + Math.sin(f.phase + f.y * 0.3) * 0.2) * dt
      f.z += windZ * dt

      if (f.y < 0.18) {
        f.y = camY + 9 + ((i * 0.618) % 1) * 7
        f.x = followX + ((((i * 53) % 97) / 97) - 0.5) * HALF_SPAN * 2
        f.z = followZ + ((((i * 67) % 89) / 89) - 0.5) * HALF_SPAN * 2
      }
      if (Math.abs(f.x - followX) > HALF_SPAN) f.x = followX + Math.sign(f.x - followX) * (HALF_SPAN - 0.5)
      if (Math.abs(f.z - followZ) > HALF_SPAN) f.z = followZ + Math.sign(f.z - followZ) * (HALF_SPAN - 0.5)

      dummy.position.set(f.x, f.y, f.z)
      dummy.rotation.set(f.phase + f.y * 0.15, f.spin * f.y * 0.08, Math.sin(f.phase + f.y * 0.2) * 0.4)
      dummy.scale.setScalar(f.size * (0.9 + snow * 0.35))
      dummy.updateMatrix()
      mesh.current.setMatrixAt(i, dummy.matrix)
    }
    mesh.current.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, SNOW_COUNT]} frustumCulled={false}>
      {/* a soft round flake, not a square of paper */}
      <circleGeometry args={[0.5, 10]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
    </instancedMesh>
  )
}
