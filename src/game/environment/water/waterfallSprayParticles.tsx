import { useHubFrame } from "../../hubGate"
import * as THREE from "three"

import { useMemo, useRef } from "react"
import { makeRng } from "../../../utils/math"
import { textTexture } from "../../../utils/canvasTexture"
import { weatherRT } from "../../weather/weatherState"
import { worldRT } from "../../runtime"

const SPRAY_COUNT = 96
const MIST_COUNT = 48

const mistVaporTexture = (): THREE.CanvasTexture =>
  textTexture(
    "waterfall-mist-vapor-soft",
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h)
      const cx = w / 2
      const cy = h / 2
      const r = w * 0.48
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
      grad.addColorStop(0, "rgba(235, 245, 255, 0.75)")
      grad.addColorStop(0.25, "rgba(225, 240, 255, 0.52)")
      grad.addColorStop(0.55, "rgba(215, 235, 255, 0.22)")
      grad.addColorStop(0.8, "rgba(205, 230, 255, 0.06)")
      grad.addColorStop(1.0, "rgba(200, 225, 255, 0)")
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
    },
    128,
    128,
  )

export const WaterfallSprayAndMist = ({
  x,
  bottomY,
  z,
  scale,
}: {
  x: number
  bottomY: number
  z: number
  scale: number
}): React.ReactElement => {
  const sprayMesh = useRef<THREE.InstancedMesh>(null)
  const mistMesh = useRef<THREE.InstancedMesh>(null)

  const dummy = useMemo(() => new THREE.Object3D(), [])
  const mistDummy = useMemo(() => new THREE.Object3D(), [])
  const mistTex = useMemo(() => mistVaporTexture(), [])

  // Ballistic spray droplets thrown upward and outward from impact
  const sprayParticles = useMemo(() => {
    const rng = makeRng(19283 + Math.floor(Math.abs(x * 100 + z * 10)))
    return Array.from({ length: SPRAY_COUNT }, () => {
      const angle = rng() * Math.PI * 2
      const speed = 1.8 + rng() * 3.2
      return {
        // Initial offset around plunge impact
        ox: (rng() - 0.5) * 1.6 * scale,
        oz: (rng() - 0.5) * 1.2 * scale + 0.4,
        vx: Math.cos(angle) * speed * 0.7,
        vy: 2.2 + rng() * 3.8,
        vz: Math.sin(angle) * speed * 0.7,
        size: 0.035 + rng() * 0.045,
        life: 0.6 + rng() * 0.7,
        phase: rng() * 2.0,
      }
    })
  }, [scale, x, z])

  // Soft billowing mist volume lingering around impact basin
  const mistParticles = useMemo(() => {
    const rng = makeRng(83721 + Math.floor(Math.abs(x * 50 + z * 5)))
    return Array.from({ length: MIST_COUNT }, () => ({
      ox: (rng() - 0.5) * 2.6 * scale,
      oz: (rng() - 0.5) * 2.0 * scale + 0.4,
      baseY: bottomY + 0.15 + rng() * 1.2,
      speed: 0.3 + rng() * 0.4,
      radius: 0.28 + rng() * 0.32,
      phase: rng() * Math.PI * 2,
    }))
  }, [bottomY, scale, x, z])

  useHubFrame((state) => {
    const t = state.clock.elapsedTime
    const wind = weatherRT.wind
    const windRad = weatherRT.windDirectionRad
    const windX = Math.cos(windRad) * wind * 2.5
    const windZ = Math.sin(windRad) * wind * 2.5
    const night = worldRT.timeOfDay > 0.6 ? 1 : 0
    const rain = weatherRT.rain

    // 1. Update ballistic spray droplets
    if (sprayMesh.current) {
      for (let i = 0; i < SPRAY_COUNT; i++) {
        const p = sprayParticles[i]
        const age = (t + p.phase) % p.life
        const progress = age / p.life

        // Parabolic arc under gravity
        const px = x + p.ox + (p.vx + windX) * age
        const py = bottomY + 0.08 + p.vy * age - 0.5 * 9.8 * age * age
        const pz = z + p.oz + (p.vz + windZ) * age

        if (py < bottomY || progress >= 1.0) {
          dummy.position.set(0, -100, 0)
          dummy.scale.setScalar(0.001)
        } else {
          dummy.position.set(px, py, pz)
          dummy.quaternion.identity()
          const s = p.size * (1.0 - progress * 0.4) * scale
          dummy.scale.set(s, s * 1.5, s)
        }
        dummy.updateMatrix()
        sprayMesh.current.setMatrixAt(i, dummy.matrix)
      }
      sprayMesh.current.instanceMatrix.needsUpdate = true
    }

    // 2. Update drifting mist billows
    if (mistMesh.current) {
      const mat = mistMesh.current.material as THREE.MeshBasicMaterial
      mat.opacity = 0.14 + night * 0.04 + rain * 0.06
      for (let i = 0; i < MIST_COUNT; i++) {
        const m = mistParticles[i]
        const cycle = ((t * m.speed + m.phase) % 1)
        const mx = x + m.ox + Math.sin(t * 0.8 + m.phase) * 0.4 + windX * cycle * 1.5
        const my = m.baseY + cycle * 1.8
        const mz = z + m.oz + Math.cos(t * 0.7 + m.phase) * 0.35 + windZ * cycle * 1.5

        mistDummy.position.set(mx, my, mz)
        mistDummy.quaternion.copy(state.camera.quaternion)
        const growth = (0.5 + cycle * 1.0) * m.radius * scale
        mistDummy.scale.setScalar(growth)
        mistDummy.updateMatrix()
        mistMesh.current.setMatrixAt(i, mistDummy.matrix)
      }
      mistMesh.current.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <group>
      {/* Ballistic whitewater spray droplets */}
      <instancedMesh ref={sprayMesh} args={[undefined, undefined, SPRAY_COUNT]} frustumCulled={false}>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial
          color="#f0f9ff"
          roughness={0.2}
          transparent
          opacity={0.85}
          depthWrite={false}
        />
      </instancedMesh>

      {/* Atmospheric participating mist cloud (camera-facing soft billboards) */}
      <instancedMesh ref={mistMesh} args={[undefined, undefined, MIST_COUNT]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={mistTex}
          color="#f0f9ff"
          transparent
          opacity={0.08}
          depthWrite={false}
          blending={THREE.NormalBlending}
        />
      </instancedMesh>
    </group>
  )
}
