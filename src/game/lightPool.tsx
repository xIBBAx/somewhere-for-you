import { useFrame } from "@react-three/fiber"
import { useLayoutEffect, useMemo, useRef, type Ref } from "react"
import * as THREE from "three"
import { originRT } from "../world/origin"
import { avatarRT } from "./runtime"

/**
 * Clustered-light substitute for a forward renderer.
 *
 * Every authored lamp, glow and fairy light is a *virtual* light. A fixed
 * pool of real PointLights is reassigned each few frames to the virtual
 * lights that matter most around the explorer. The real light count never changes,
 * so shaders never recompile, and every pixel evaluates 4 lights instead of
 * dozens.
 */
export class VirtualPointLight extends THREE.Object3D {
  readonly isVirtualPointLight = true
  color = new THREE.Color("#ffffff")
  intensity = 1
  distance = 5
  decay = 2
}

const registry = new Set<VirtualPointLight>()
export const lightPoolStats = { virtual: 0, assigned: 0 }

type VirtualLightProps = {
  ref?: Ref<VirtualPointLight>
  position?: [number, number, number]
  color?: THREE.ColorRepresentation
  intensity?: number
  distance?: number
  decay?: number
}

/** Drop-in replacement for <pointLight> inside authored scenery. */
export const VirtualLight = ({ ref, position, color = "#ffffff", intensity = 1, distance = 5, decay = 2 }: VirtualLightProps): React.ReactElement => {
  const light = useMemo(() => new VirtualPointLight(), [])
  useLayoutEffect(() => {
    light.color.set(color)
    light.intensity = intensity
    light.distance = distance
    light.decay = decay
  }, [light, color, intensity, distance, decay])
  useLayoutEffect(() => {
    registry.add(light)
    if (typeof ref === "function") ref(light)
    else if (ref && typeof ref === "object") (ref as { current: VirtualPointLight | null }).current = light
    return () => {
      registry.delete(light)
      if (typeof ref === "function") ref(null)
    }
  }, [light, ref])
  return <primitive object={light} position={position} />
}

/** A light made in code rather than in a scene (The dragon's pearl): returns its release. */
export const registerVirtualLight = (light: VirtualPointLight): (() => void) => {
  registry.add(light)
  return () => { registry.delete(light) }
}

const POOL = 4
const tmp = new THREE.Vector3()

const visibleInHierarchy = (o: THREE.Object3D): boolean => {
  let n: THREE.Object3D | null = o
  while (n) {
    if (!n.visible) return false
    n = n.parent
  }
  return true
}

export const LightPool = (): React.ReactElement => {
  const lights = useMemo(
    () =>
      Array.from({ length: POOL }, () => {
        const l = new THREE.PointLight("#ffffff", 0, 5, 2)
        l.castShadow = false
        return l
      }),
    [],
  )
  const frame = useRef(0)
  const candidates = useMemo(() => [] as Array<{ light: VirtualPointLight; score: number; x: number; y: number; z: number }>, [])
  useFrame(() => {
    if (frame.current++ % 4 !== 0) return
    candidates.length = 0
    const px = avatarRT().pos.x
    const pz = avatarRT().pos.z
    for (const v of registry) {
      if (v.intensity <= 0.01) continue
      v.getWorldPosition(tmp)
      const x = tmp.x + originRT.x
      const z = tmp.z + originRT.z
      const d = Math.hypot(x - px, z - pz)
      if (d > v.distance + 30) continue
      if (!visibleInHierarchy(v)) continue
      candidates.push({ light: v, score: (v.intensity * v.distance) / (1 + d * d * 0.05), x, y: tmp.y, z })
    }
    candidates.sort((a, b) => b.score - a.score)
    lightPoolStats.virtual = registry.size
    lightPoolStats.assigned = Math.min(POOL, candidates.length)
    for (let i = 0; i < POOL; i++) {
      const real = lights[i]
      const c = candidates[i]
      if (!c) {
        real.intensity = 0
        continue
      }
      real.position.set(c.x, c.y, c.z)
      real.color.copy(c.light.color)
      real.intensity = c.light.intensity
      real.distance = c.light.distance
      real.decay = c.light.decay
    }
  })
  return (
    <group name="light-pool">
      {lights.map((l, i) => (
        <primitive key={i} object={l} />
      ))}
    </group>
  )
}
