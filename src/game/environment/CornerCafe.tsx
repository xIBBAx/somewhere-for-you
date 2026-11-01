import { VirtualLight, VirtualPointLight } from "../lightPool"
import { useHubFrame } from "../hubGate"

import { useEffect, useMemo, useRef } from "react"
import { useGLTF } from "@react-three/drei"
import { assets } from "../../content/assets"
import { story } from "../../content/story"
import * as THREE from "three"
import { useGame } from "../../state/gameStore"
import { smoothstep } from "../../utils/math"
import { textTexture } from "../../utils/canvasTexture"
import { worldRT } from "../runtime"
import { sfx } from "../audio/audio"
import { BUILDINGS, groundHeight } from "../world-layout"
import { Bench, PALETTE, SignBoard, TableSet } from "./props"
import { spawnBurst } from "../particles/sparkles"

const { cafe } = BUILDINGS

const menuTexture = (): ReturnType<typeof textTexture> =>
  textTexture(
    "cafe-menu",
    (ctx, w, h) => {
      ctx.fillStyle = "#3f4a44"
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = "#c9b98a"
      ctx.lineWidth = 4
      ctx.strokeRect(8, 8, w - 16, h - 16)
      ctx.fillStyle = "#e8dcc0"
      ctx.font = "600 26px 'Fraunces', serif"
      ctx.textAlign = "center"
      ctx.fillText("· aaj ka menu ·", w / 2, 44)
      ctx.font = "400 20px 'Nunito Sans', sans-serif"
      const items = ["cutting chai", "masala chai", "filter coffee", "gulab jamun"]
      items.forEach((it, i) => {
        ctx.textAlign = "left"
        ctx.fillText(it, 30, 86 + i * 30)
        ctx.textAlign = "right"
        ctx.fillText("✦", w - 30, 86 + i * 30)
      })
    },
    256,
    220,
  )

const signTex = (open: boolean): ReturnType<typeof textTexture> =>
  textTexture(
    open ? "cafe-sign-open" : "cafe-sign-closed",
    (ctx, w, h) => {
      ctx.fillStyle = "#5c4433"
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = open ? "#ffd9a0" : "#cbb4a0"
      ctx.font = "700 44px 'Fraunces', serif"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText(open ? "OPEN" : "CLOSED", w / 2, h / 2)
    },
    256,
    96,
  )

/**
 * The chai stall, closed until someone looks in. Activation brings it
 * alive: bell → sign flips → windows glow → string lights → cats arrive.
 */
export const CornerCafe = (): React.ReactElement => {
  const visited = useGame((s) => s.visited["corner-cafe"] ?? false)
  const seq = useRef(visited ? 3 : -1)
  const signRef = useRef<THREE.Mesh>(null)
  const cafeGlow = useRef<VirtualPointLight>(null)
  const gltf = useGLTF(assets.environment.cornerCafe)
  const model = useMemo(() => {
    const scene = gltf.scene.clone(true)
    const materials: THREE.MeshStandardMaterial[] = []
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      const material = (mesh.material as THREE.MeshStandardMaterial).clone()
      materials.push(material)
      mesh.material = material
      mesh.castShadow = !/Glow/.test(material.name)
      mesh.receiveShadow = true
    })
    return {
      scene, materials,
      windows: materials.find(m => m.name === "Cafe_WindowGlow")!,
      bulbs: materials.find(m => m.name === "Cafe_BulbGlow")!,
    }
  }, [gltf.scene])
  const signMaps = useMemo(() => [signTex(false), signTex(true)], [])
  const signMat = useMemo(() => new THREE.MeshStandardMaterial({
    map: signMaps[0], roughness: 0.85, side: THREE.DoubleSide,
  }), [signMaps])
  const titleMap = useMemo(() => textTexture(`corner-cafe-title:${story.cafeSign}`, (ctx, w, h) => {
    ctx.fillStyle = "#594533"
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = "#bda375"
    ctx.lineWidth = 3
    ctx.strokeRect(7, 7, w - 14, h - 14)
    ctx.fillStyle = "#f5e4c7"
    ctx.font = "600 38px Georgia, serif"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(story.cafeSign, w / 2, h / 2)
  }, 640, 96), [])
  const menu = useMemo(() => menuTexture(), [])
  const y = groundHeight(cafe.x, cafe.z)

  useEffect(() => () => {
    model.materials.forEach(material => material.dispose())
    signMat.dispose()
  }, [model, signMat])

  useHubFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const performing = worldRT.performingMemoryId === "corner-cafe"
    if (seq.current < 0 && (performing || visited)) seq.current = 0
    if (seq.current >= 0 && seq.current < 3) {
      const prev = seq.current
      seq.current = Math.min(3, prev + dt)
      if (prev < 0.05 && seq.current >= 0.05) sfx.bell()
      if (prev < 0.65 && seq.current >= 0.65) sfx.pop()
      if (prev < 1.3 && seq.current >= 1.3) {
        spawnBurst(new THREE.Vector3(cafe.x, y + 2.5, cafe.z + 2), 12, "#e8c897")
        sfx.sparkle()
      }
    }
    const evening = smoothstep(0.45, 0.8, worldRT.timeOfDay)
    const opening = smoothstep(0.45, 1.7, seq.current)
    const signMap = signMaps[seq.current >= 0.65 ? 1 : 0]
    if (signMat.map !== signMap) signMat.map = signMap
    if (signRef.current) {
      const turn = smoothstep(0.25, 1.05, seq.current)
      signRef.current.rotation.y = turn < 0.5 ? turn * Math.PI : (turn - 1) * Math.PI
    }
    model.windows.emissiveIntensity = evening * 0.28 + opening * 0.75
    model.bulbs.emissiveIntensity = evening * 0.75 + opening * 1.4
    if (cafeGlow.current) cafeGlow.current.intensity = evening * 1.7 + opening * 2.1
  })

  return (
    <group>
      <group position={[cafe.x, y, cafe.z]} name="corner-cafe">
        <primitive object={model.scene} dispose={null} name="corner-cafe-model" />
        <mesh position={[0, 2.79, 2.065]}>
          <boxGeometry args={[3.35, 0.46, 0.08]} />
          <meshStandardMaterial map={titleMap} roughness={0.86} />
        </mesh>
        <mesh ref={signRef} position={[2.4, 1.48, 1.83]} material={signMat}>
          <planeGeometry args={[0.65, 0.24]} />
        </mesh>
        <group position={[-3.04, 0.62, 2.47]} rotation-x={-0.12}>
          <mesh>
            <boxGeometry args={[0.64, 0.86, 0.07]} />
            <meshStandardMaterial color="#674b38" roughness={0.85} />
          </mesh>
          <mesh position={[0, 0, 0.041]}>
            <planeGeometry args={[0.55, 0.76]} />
            <meshStandardMaterial map={menu} roughness={0.9} />
          </mesh>
        </group>
        <VirtualLight ref={cafeGlow} position={[0, 2.1, 2.3]} color="#ffcb87" intensity={0} distance={7} decay={2} />
      </group>

      {/* outdoor seating */}
      <TableSet position={[5.4, groundHeight(5.4, -9.6), -9.6]} cups={2} />
      <TableSet position={[-0.6, groundHeight(-0.6, -9.4), -9.4]} rotationY={0.7} cups={1} />
      <SignBoard
        text={visited ? story.cafeSign : "soon →"}
        position={[4.9, groundHeight(4.9, -8.4), -8.4]}
        rotationY={-0.5}
        width={0.9}
      />
      {/* planters */}
      {[
        [-1.4, -9.0],
        [6.2, -11.2],
      ].map(([px, pz], i) => (
        <group key={i} position={[px, groundHeight(px, pz), pz]}>
          <mesh position={[0, 0.18, 0]} castShadow>
            <cylinderGeometry args={[0.22, 0.17, 0.36, 8]} />
            <meshStandardMaterial color={PALETTE.accent} roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.52, 0]} castShadow>
            <icosahedronGeometry args={[0.26, 1]} />
            <meshStandardMaterial color={PALETTE.leafDeep} roughness={1} flatShading />
          </mesh>
        </group>
      ))}
      {/* bench for cat loitering */}
      <Bench position={[6.8, groundHeight(6.8, -12.2), -12.2]} rotationY={1.2} />

      {/* resident café cat (appears when the café comes alive) */}
      <CafeCat active={visited} position={[5.4, groundHeight(5.4, -9.6) + 0.44, -9.6]} />
      <CafeVisitor position={[-1.25, groundHeight(-1.25, -9.35), -9.35]} />
    </group>
  )
}

/** One quiet background visitor supplies life and scale without a crowd. */
const CafeVisitor = ({ position }: { position: [number, number, number] }): React.ReactElement => {
  const ref = useRef<THREE.Group>(null)
  useHubFrame((state) => {
    if (ref.current) ref.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.75) * 0.018
  })
  return (
    <group ref={ref} position={position} rotation-y={-0.35} scale={0.78}>
      <mesh position={[0, 0.52, 0]} castShadow>
        <capsuleGeometry args={[0.14, 0.2, 5, 10]} />
        <meshStandardMaterial color="#73918a" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.83, 0]} castShadow>
        <sphereGeometry args={[0.16, 12, 10]} />
        <meshStandardMaterial color="#e9c7aa" roughness={0.92} />
      </mesh>
      <mesh position={[0, 0.9, -0.03]} scale={[1.06, 0.62, 1.06]}>
        <sphereGeometry args={[0.17, 12, 9]} />
        <meshStandardMaterial color="#51423a" roughness={0.95} />
      </mesh>
      <mesh position={[0.12, 0.5, 0.17]} rotation-z={-0.65}>
        <capsuleGeometry args={[0.035, 0.12, 4, 7]} />
        <meshStandardMaterial color="#73918a" roughness={0.95} />
      </mesh>
    </group>
  )
}

/** A tiny cat that hops onto a table once the café wakes up. */
const CafeCat = ({
  active,
  position,
}: {
  active: boolean
  position: [number, number, number]
}): React.ReactElement => {
  const ref = useRef<THREE.Group>(null)
  const t = useRef(0)
  useHubFrame((state, dt) => {
    if (!ref.current) return
    if (active) t.current = Math.min(1.2, t.current + Math.min(dt, 0.1))
    else t.current = 0
    const appear = active ? smoothstep(0, 1.2, t.current) : 0
    ref.current.scale.setScalar(Math.max(0.001, appear))
    ref.current.position.y = position[1] + (1 - appear) * -0.4
    ref.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.4) * 0.2
  })
  const fur = useMemo(() => new THREE.MeshStandardMaterial({ color: "#c9b0a1", roughness: 0.95 }), [])
  return (
    <group ref={ref} position={position} scale={0.001}>
      <mesh material={fur} castShadow>
        <capsuleGeometry args={[0.09, 0.18, 6, 10]} />
      </mesh>
      <mesh position={[0, 0.14, 0.12]} material={fur}>
        <sphereGeometry args={[0.1, 12, 10]} />
      </mesh>
      {[-0.055, 0.055].map((x) => (
        <mesh key={x} position={[x, 0.22, 0.1]} rotation-z={x > 0 ? -0.25 : 0.25} material={fur}>
          <coneGeometry args={[0.035, 0.07, 5]} />
        </mesh>
      ))}
    </group>
  )
}
