import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { originRT } from "../../world/origin"

/**
 * A gentle starlight down-draft where Starborn comes out of the sky: soft motes
 * spiral in from above, sink with her as she lands and settle into the grass,
 * twinkling out within a few seconds. Set by
 * shimmerAt() (pegasus/starbornCall.ts) at her arrival point, in logical world
 * coordinates like every other scene object.
 */
export const shimmer = { x: 0, y: 0, z: 0, t: -1 }
const SHIMMER_TIME = 2.6
const COUNT = 80

/** Start the shimmer at a point (logical world metres). */
export const shimmerAt = (x: number, y: number, z: number): void => {
  shimmer.x = x
  shimmer.y = y
  shimmer.z = z
  shimmer.t = 0
}

export const StarShimmer = (): React.ReactElement => {
  const ref = useRef<THREE.Points>(null)
  const { geo, mat, dirs } = useMemo(() => {
    // each mote: a fixed direction around the ring and its own lift
    // each mote: its own angle, starting height and radius, and a twinkle phase
    const dirs = new Float32Array(COUNT * 4)
    for (let i = 0; i < COUNT; i++) {
      const h = (n: number): number => (Math.sin(i * n) * 43758.5453) % 1
      dirs[i * 4] = (i / COUNT) * Math.PI * 2 + Math.abs(h(12.9898)) * 2
      dirs[i * 4 + 1] = 2.5 + Math.abs(h(78.233)) * 4.5
      dirs[i * 4 + 2] = 1.2 + Math.abs(h(39.425)) * 2.6
      dirs[i * 4 + 3] = Math.abs(h(93.989)) * 6.283
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3))
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3))
    const mat = new THREE.PointsMaterial({
      size: 0.16, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
    })
    // a soft disc with a hot core, not the default square sprite
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_particle_fragment>", `
        #include <map_particle_fragment>
        float r = length(gl_PointCoord - vec2(0.5));
        diffuseColor.rgb *= 1.0 + 1.6 * exp(-r * r * 90.0);
        diffuseColor.a *= 1.0 - smoothstep(0.05, 0.5, r);
        if (diffuseColor.a < 0.01) discard;
      `)
    }
    mat.customProgramCacheKey = () => "star-shimmer-disc-v1"
    return { geo, mat, dirs }
  }, [])

  useEffect(() => () => {
    geo.dispose()
    mat.dispose()
  }, [geo, mat])

  useFrame((_, dt) => {
    const p = ref.current
    if (!p) return
    if (shimmer.t < 0) { p.visible = false; return }
    shimmer.t += dt
    const k = shimmer.t / SHIMMER_TIME
    if (k >= 1) { shimmer.t = -1; p.visible = false; return }
    p.visible = true
    p.position.set(shimmer.x - originRT.x, shimmer.y, shimmer.z - originRT.z)
    const pos = geo.getAttribute("position") as THREE.BufferAttribute
    const col = geo.getAttribute("color") as THREE.BufferAttribute
    const t = shimmer.t
    for (let i = 0; i < COUNT; i++) {
      // staggered descent: high motes arrive last, so it pours rather than drops
      const start = dirs[i * 4 + 1]
      const d = THREE.MathUtils.clamp(k * 1.5 - (start - 2.5) / 9, 0, 1)
      const e = 1 - (1 - d) * (1 - d)
      const a = dirs[i * 4] + e * 2.4
      const r = dirs[i * 4 + 2] * (1 - e * 0.65)
      pos.setXYZ(i, Math.cos(a) * r, start * (1 - e) + 0.05, Math.sin(a) * r)
      const twinkle = 0.65 + 0.35 * Math.sin(t * 9 + dirs[i * 4 + 3])
      const life = Math.sin(Math.PI * Math.min(1, k * 1.15)) * (d >= 1 ? 1 - (k - 0.6) * 2.5 : 1)
      const v = Math.max(0, life) * twinkle * 0.9
      col.setXYZ(i, 0.87 * v, 0.91 * v, v)
    }
    col.needsUpdate = true
    pos.needsUpdate = true
  })

  return <points ref={ref} geometry={geo} material={mat} visible={false} frustumCulled={false} renderOrder={6} />
}
