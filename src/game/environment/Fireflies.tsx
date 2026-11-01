import { useHubFrame } from "../hubGate"

import { useMemo, useRef } from "react"
import * as THREE from "three"
import { makeRng, smoothstep } from "../../utils/math"
import { avatarRT, worldRT } from "../runtime"
import { weatherRT } from "../weather/weatherState"
import { groundHeight } from "../world-layout"

const COUNT = 34

type Firefly = {
  cx: number
  cz: number
  yBase: number
  radius: number
  speed: number
  phase: number
  twinkle: number
}

export const Fireflies = (): React.ReactElement => {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const color = useMemo(() => new THREE.Color("#ffe9a8"), [])
  const data = useMemo<Firefly[]>(() => {
    const rng = makeRng(44912)
    const zones = [
      { x: 9.2, z: 7.0 },
      { x: -8.6, z: 13.6 },
      { x: 12.4, z: 0.4 },
      { x: -12.4, z: 3.2 },
      { x: 0, z: -30.5 },
      { x: 0.8, z: 30.2 },
      { x: -4.4, z: -17.8 },
    ]
    return Array.from({ length: COUNT }, (_, i) => {
      const zone = zones[i % zones.length]
      return {
        cx: zone.x + (rng() - 0.5) * 4.2,
        cz: zone.z + (rng() - 0.5) * 4.2,
        yBase: 0.55 + rng() * 0.85,
        radius: 0.55 + rng() * 1.1,
        speed: 0.6 + rng() * 0.9,
        phase: rng() * Math.PI * 2,
        twinkle: 0.7 + rng() * 1.3,
      }
    })
  }, [])

  useHubFrame((state, rawDt) => {
    if (!mesh.current) return
    const dt = Math.min(rawDt, 0.25)
    const t = state.clock.elapsedTime
    const tod = worldRT.timeOfDay
    const dusk = smoothstep(0.62, 0.92, tod)
    const nightBoost = smoothstep(0.78, 1, tod)
    const cloud = weatherRT.cloud
    const rain = weatherRT.rain
    const snow = weatherRT.snow
    const heat = weatherRT.heat

    const warmNight = (dusk > 0.25 || (heat > 0.28 && nightBoost > 0.3)) && cloud < 0.78 && rain < 0.22 && snow < 0.1
    const targetOpacity = warmNight ? THREE.MathUtils.mapLinear(Math.max(dusk, heat * 0.9), 0.25, 1, 0.08, 0.72) : 0
    const mat = mesh.current.material as THREE.MeshStandardMaterial
    const wantEmissive = warmNight ? 1.2 + nightBoost * 1.4 : 0
    mat.emissiveIntensity = THREE.MathUtils.damp(mat.emissiveIntensity, wantEmissive, 2.2, dt)
    mat.opacity = THREE.MathUtils.damp(mat.opacity, targetOpacity, 1.8, dt)
    mesh.current.visible = mat.opacity > 0.008
    if (!mesh.current.visible) return

    const px = avatarRT().pos.x
    const pz = avatarRT().pos.z

    for (let i = 0; i < COUNT; i++) {
      const f = data[i]
      const ang = t * f.speed + f.phase
      const x = f.cx + Math.cos(ang) * f.radius
      const z = f.cz + Math.sin(ang * 0.85) * f.radius * 0.9
      const y = groundHeight(x, z) + f.yBase + Math.sin(t * 1.6 + f.phase) * 0.28

      const dist = Math.hypot(x - px, z - pz)
      const nearFade = THREE.MathUtils.clamp((35 - dist) / 7, 0, 1)

      const pulse = 0.45 + Math.sin(t * f.twinkle + f.phase) * 0.45
      const scale = (0.55 + pulse * 0.5) * nearFade

      dummy.position.set(x, y, z)
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      mesh.current.setMatrixAt(i, dummy.matrix)
    }
    mesh.current.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COUNT]} frustumCulled={false}>
      <sphereGeometry args={[0.018, 8, 6]} />
      <meshStandardMaterial color={color} emissive="#ffb86a" emissiveIntensity={0} transparent opacity={0} depthWrite={false} />
    </instancedMesh>
  )
}
