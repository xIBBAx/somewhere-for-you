import { useHubFrame } from "../hubGate"

import { useMemo, useRef } from "react"
import * as THREE from "three"
import { weatherRT } from "../weather/weatherState"
import { groundHeight } from "../world-layout"

type FogPatch = {
  x: number
  z: number
  radius: number
  baseOpacity: number
  driftPhase: number
}

const PATCHES: FogPatch[] = [
  { x: -9.2, z: 8.4, radius: 6.2, baseOpacity: 0.42, driftPhase: 0.1 },
  { x: 4.8, z: 11.2, radius: 5.4, baseOpacity: 0.38, driftPhase: 1.4 },
  { x: -3.2, z: -5.8, radius: 7.1, baseOpacity: 0.45, driftPhase: 2.2 },
  { x: 11.1, z: -7.2, radius: 4.8, baseOpacity: 0.36, driftPhase: 3.1 },
  { x: 1.2, z: -19.2, radius: 5.9, baseOpacity: 0.4, driftPhase: 4.5 },
  { x: 0, z: 27.5, radius: 4.2, baseOpacity: 0.32, driftPhase: 5.7 },
]

/**
 * Each patch fades out from its middle with slow swirls, so it reads as a
 * low cloud of fog rather than a flat, hard-edged disc on the grass.
 */
const softenPatch = (m: THREE.MeshBasicMaterial | null, seed: number): void => {
  if (!m || m.userData.softened) return
  m.userData.softened = true
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFogTime = fogTime
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vFogUv;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvFogUv = uv;")
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vFogUv;\nuniform float uFogTime;")
      .replace(
        "#include <alphamap_fragment>",
        `#include <alphamap_fragment>
  vec2 fp = (vFogUv - 0.5) * 2.0;
  float fr = length(fp);
  float swirlA = sin(fp.x * 3.1 + uFogTime * 0.11 + ${seed.toFixed(2)} + sin(fp.y * 2.3 + uFogTime * 0.07) * 1.4);
  float swirlB = sin(fp.y * 4.2 - uFogTime * 0.09 + fp.x * 1.3);
  diffuseColor.a *= (1.0 - smoothstep(0.15, 1.0, fr + swirlA * 0.08)) * (0.8 + 0.12 * swirlA + 0.08 * swirlB);`,
      )
  }
  m.customProgramCacheKey = () => "ground-fog-soft-v1"
  m.needsUpdate = true
}
const fogTime = { value: 0 }

export const GroundFog = (): React.ReactElement => {
  const mats = useRef<Array<THREE.MeshBasicMaterial | null>>([])
  const meshes = useRef<Array<THREE.Mesh | null>>([])

  const fogColor = useMemo(() => new THREE.Color("#e6eef6"), [])

  useHubFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.25)
    const t = state.clock.elapsedTime
    fogTime.value = t % 3600
    const cloud = weatherRT.cloud
    const wet = weatherRT.wetness
    const isFog = weatherRT.condition === "fog"
    const isCloudy = weatherRT.condition === "cloudy"
    const isHeavyRain = weatherRT.condition === "heavy-rain" || weatherRT.condition === "thunderstorm"

    const fogStrength = isFog ? 0.95 : isHeavyRain ? 0.72 : isCloudy ? 0.55 : Math.max(0, (cloud - 0.62) * 1.6)
    const wetBoost = wet > 0.2 ? wet * 0.25 : 0
    const target = Math.min(0.85, fogStrength + wetBoost)

    for (let i = 0; i < PATCHES.length; i++) {
      const mat = mats.current[i]
      const mesh = meshes.current[i]
      if (!mat || !mesh) continue
      const patch = PATCHES[i]
      const drift = Math.sin(t * 0.07 + patch.driftPhase) * 0.6
      const breathe = 0.92 + Math.sin(t * 0.12 + patch.driftPhase) * 0.08
      mesh.position.x = patch.x + drift
      mesh.position.z = patch.z + Math.cos(t * 0.05 + patch.driftPhase) * 0.5
      mesh.position.y = groundHeight(mesh.position.x, mesh.position.z) + 0.14
      mesh.scale.setScalar(breathe)
      const want = target * patch.baseOpacity * (0.88 + Math.sin(t * 0.11 + i) * 0.12)
      mat.opacity = THREE.MathUtils.damp(mat.opacity, want, 1.2, dt)
      mat.color.copy(fogColor)
      mesh.visible = mat.opacity > 0.008
    }
  })

  return (
    <group>
      {PATCHES.map((p, i) => (
        <mesh
          key={i}
          ref={(m) => {
            meshes.current[i] = m
          }}
          rotation-x={-Math.PI / 2}
          renderOrder={2}
          frustumCulled={false}
        >
          <circleGeometry args={[p.radius, 22]} />
          <meshBasicMaterial
            ref={(m) => {
              mats.current[i] = m
              softenPatch(m, p.driftPhase)
            }}
            color="#e6eef6"
            transparent
            opacity={0}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  )
}
