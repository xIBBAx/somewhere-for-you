import { VirtualLight, VirtualPointLight } from "../lightPool"
import { useHubFrame } from "../hubGate"

import { useEffect, useMemo, useRef } from "react"
import { useGLTF } from "@react-three/drei"
import { assets } from "../../content/assets"
import * as THREE from "three"
import { useGame } from "../../state/gameStore"
import { smoothstep } from "../../utils/math"
import { textTexture } from "../../utils/canvasTexture"
import { worldRT, avatarRT } from "../runtime"
import { sfx } from "../audio/audio"
import { BUILDINGS, groundHeight } from "../world-layout"
import { spawnBurst } from "../particles/sparkles"

const { studio } = BUILDINGS

const monitorTexture = (): ReturnType<typeof textTexture> =>
  textTexture(
    "studio-monitor",
    (ctx, w, h) => {
      ctx.fillStyle = "#f3e9f7"
      ctx.fillRect(0, 0, w, h)
      // generic design-tool look: artboard, shapes, handles
      ctx.fillStyle = "#fff"
      ctx.fillRect(24, 24, w - 48, h - 48)
      ctx.strokeStyle = "#b3a0dd"
      ctx.lineWidth = 3
      ctx.strokeRect(24, 24, w - 48, h - 48)
      ctx.fillStyle = "#e8a08a"
      ctx.beginPath()
      ctx.arc(w / 2 - 30, h / 2 - 10, 26, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = "#8fbf6f"
      ctx.fillRect(w / 2 - 4, h / 2 - 34, 40, 40)
      ctx.strokeStyle = "#6b5a8a"
      ctx.lineWidth = 2
      ctx.strokeRect(w / 2 - 34, h / 2 - 40, 80, 80)
      ctx.fillStyle = "#c9c2b5"
      for (const [hx, hy] of [
        [w / 2 - 34, h / 2 - 40],
        [w / 2 + 46, h / 2 - 40],
        [w / 2 - 34, h / 2 + 40],
        [w / 2 + 46, h / 2 + 40],
      ]) {
        ctx.fillRect(hx - 3, hy - 3, 6, 6)
      }
    },
    256,
    192,
  )

const stickyColors = ["#f6c76b", "#f2a2b8", "#a9d3e8", "#cfa9e8"]

/**
 * A small open studio. Interacting turns a late night of work into a small
 * celebration.
 */
export const LittleStudio = (): React.ReactElement => {
  const visited = useGame((s) => s.visited["little-studio"] ?? false)
  const seq = useRef(visited ? 3 : -1)
  const gltf = useGLTF(assets.environment.littleStudio)
  const model = useMemo(() => {
    const scene = gltf.scene.clone(true)
    const materials: THREE.MeshStandardMaterial[] = []
    scene.traverse(object => {
      // duck-typed: instanceof fails if the loader resolved another three copy
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      const material = (mesh.material as THREE.MeshStandardMaterial).clone()
      mesh.material = material
      materials.push(material)
      mesh.castShadow = material.name !== "Studio_LampGlow"
      mesh.receiveShadow = true
    })
    return { scene, materials, lamp: materials.find(m => m.name === "Studio_LampGlow")! }
  }, [gltf.scene])
  useEffect(() => () => model.materials.forEach(material => material.dispose()), [model])
  const glow = useRef<VirtualPointLight>(null)
  const flags = useRef<THREE.Group>(null)
  const y = groundHeight(studio.x, studio.z)
  const monitor = useMemo(() => monitorTexture(), [])
  const doorSign = useMemo(
    () =>
      textTexture(
        "studio-sign",
        (ctx, w, h) => {
          ctx.fillStyle = "#fffaf0"
          ctx.fillRect(0, 0, w, h)
          ctx.fillStyle = "#6b4a36"
          ctx.font = "600 30px 'Fraunces', serif"
          ctx.textAlign = "center"
          ctx.textBaseline = "middle"
          ctx.fillText("the studio", w / 2, h / 2)
        },
        220,
        68,
      ),
    [],
  )

  useHubFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const evening = smoothstep(0.45, 0.8, worldRT.timeOfDay)
    if (seq.current < 0 && worldRT.performingMemoryId === "little-studio") seq.current = 0
    if (seq.current < 0) {
      model.lamp.emissiveIntensity = 0.5 + evening * 0.6
      if (glow.current) glow.current.intensity = 0.6 + evening * 1.4
      return
    }
    if (seq.current < 3) {
      const prev = seq.current
      seq.current += dt
      if (prev < 0.1 && seq.current >= 0.1) {
        sfx.chime()
        playerCelebrate()
      }
      if (prev < 1.4 && seq.current >= 1.4) {
        spawnBurst(new THREE.Vector3(studio.x + 1.6, y + 2.2, studio.z + 1.8), 26, "#f2a2b8")
        sfx.sparkle()
      }
    }
    const s = seq.current
    model.lamp.emissiveIntensity = THREE.MathUtils.lerp(0.5 + evening * 0.6, 2.4, smoothstep(0, 0.8, s))
    if (glow.current) glow.current.intensity = THREE.MathUtils.lerp(0.6 + evening * 1.4, 3.2, smoothstep(0, 0.8, s))
    if (flags.current) {
      flags.current.scale.y = smoothstep(1.0, 1.6, s)
      flags.current.rotation.z = Math.sin(state.clock.elapsedTime * 1.2) * 0.04
    }
  })

  return (
    <group position={[studio.x, y, studio.z]} name="little-studio">
      <primitive object={model.scene} name="little-studio-model" dispose={null} />
      <mesh position={[0.06, 1.41, 0.19]}>
        <planeGeometry args={[0.81, 0.51]} />
        <meshStandardMaterial map={monitor} emissive="#ffffff" emissiveMap={monitor} emissiveIntensity={0.4} roughness={0.6} />
      </mesh>
      <VirtualLight ref={glow} position={[0.1, 1.7, 0.7]} color="#ffd9a0" intensity={0.8} distance={5} decay={2} />
      <DeskCat position={[-0.24, 1.06, 0.69]} />
      <group ref={flags} position={[0, 2.24, 1.45]} scale={[1, 0.001, 1]} name="studio-bunting">
        <mesh rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.009, 0.009, 3.15, 6]} />
          <meshStandardMaterial color="#b69974" roughness={1} />
        </mesh>
        {Array.from({ length: 7 }, (_, i) => (
          <mesh key={i} position={[-1.25 + i * 0.42, -0.11 - Math.sin(i / 6 * Math.PI) * 0.06, 0]} rotation-z={Math.PI}>
            <coneGeometry args={[0.10, 0.21, 3]} />
            <meshStandardMaterial color={stickyColors[i % 4]} roughness={0.95} />
          </mesh>
        ))}
      </group>
      <mesh position={[0, 2.59, 1.50]}>
        <boxGeometry args={[1.18, 0.31, 0.045]} />
        <meshStandardMaterial map={doorSign} roughness={0.9} />
      </mesh>
    </group>
  )
}

/** The professionally inconvenient sleeping cat on the desk. */
const DeskCat = ({ position }: { position: [number, number, number] }): React.ReactElement => {
  const ref = useRef<THREE.Group>(null)
  useHubFrame((state) => {
    if (ref.current) {
      ref.current.scale.y = 0.6 + Math.sin(state.clock.elapsedTime * 1.1) * 0.03
    }
  })
  const fur = useMemo(() => new THREE.MeshStandardMaterial({ color: "#8f8a9e", roughness: 0.95 }), [])
  return (
    <group ref={ref} position={position}>
      <mesh material={fur} castShadow>
        <capsuleGeometry args={[0.08, 0.16, 6, 10]} />
      </mesh>
      <mesh position={[0, 0.06, 0.13]} material={fur}>
        <sphereGeometry args={[0.085, 10, 8]} />
      </mesh>
      {[-0.045, 0.045].map((x) => (
        <mesh key={x} position={[x, 0.13, 0.11]} material={fur}>
          <coneGeometry args={[0.028, 0.055, 5]} />
        </mesh>
      ))}
    </group>
  )
}

/** Ask the explorer's character to do a little celebration hop. */
const playerCelebrate = (): void => {
  avatarRT().celebrate = 1.6
}
