import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { useHubFrame } from "../../hubGate"
import { VirtualLight, type VirtualPointLight } from "../../lightPool"
import { avatarRT, worldRT } from "../../runtime"
import { qualityRT } from "../../../state/qualityStore"
import { nightBlend } from "../../environment/celestialLighting"
import { FILAMENT_FS, FILAMENT_VS, GEM_FS, GEM_VS, GLOW_FS, GLOW_VS, MOTE_FS, MOTE_VS } from "./wispShaders"
import { signatureFor, type WispSignature } from "./wispSignatures"
import { LIGHT_BLENDING } from "../../render/lightBlending"

const SEGMENTS = 28
const MAX_STRANDS = 6
const ABSORB_SECONDS = 2.6
const FAR_FILAMENTS = 55
const FAR_MOTES = 110

/** Seeds are generated once per count, shuffled, so a draw range is a fair subset. */
const moteGeometry = (count: number, salt: number): THREE.BufferGeometry => {
  let s = (salt * 9301 + 49297) % 233280
  const rand = (): number => (s = (s * 9301 + 49297) % 233280) / 233280
  const seeds = new Float32Array(count * 4)
  for (let i = 0; i < seeds.length; i++) seeds[i] = rand()
  const g = new THREE.BufferGeometry()
  // positions are computed in the shader; the attribute only sets the count
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4))
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 4)
  return g
}

const filamentGeometry = (strands: number): THREE.BufferGeometry => {
  const verts = strands * SEGMENTS * 2
  const strand = new Float32Array(verts)
  const seg = new Float32Array(verts)
  const side = new Float32Array(verts)
  const index: number[] = []
  let v = 0
  for (let k = 0; k < strands; k++) {
    const seed = (k + 0.5) / strands
    for (let i = 0; i < SEGMENTS; i++) {
      for (const sd of [-1, 1]) {
        strand[v] = seed
        seg[v] = i / (SEGMENTS - 1)
        side[v] = sd
        v++
      }
      if (i < SEGMENTS - 1) {
        const a = (k * SEGMENTS + i) * 2
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts * 3), 3))
  g.setAttribute("aStrand", new THREE.BufferAttribute(strand, 1))
  g.setAttribute("aSeg", new THREE.BufferAttribute(seg, 1))
  g.setAttribute("aSide", new THREE.BufferAttribute(side, 1))
  g.setIndex(index)
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 4)
  return g
}

const additive = (vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    vertexShader, fragmentShader, uniforms,
    transparent: true, depthWrite: false, depthTest: true,
    ...LIGHT_BLENDING, toneMapped: false,
  })

type Phase = { perform: number; absorb: number; absorbing: boolean }

/**
 * A memory stop's living energy. It hangs over the ground in its own
 * signature, notices the explorer coming close, gathers into a rising column
 * while the memory performs, and streams into her when the card closes.
 * Visited stops rest as a small ember with a few slow motes.
 */
export const MemoryWisp = ({
  id,
  position,
  groundY,
  visited,
}: {
  id: string
  position: [number, number]
  groundY: number
  visited: boolean
}): React.ReactElement => {
  const sig: WispSignature = useMemo(() => signatureFor(id), [id])
  const salt = useMemo(() => [...id].reduce((a, c) => a + c.charCodeAt(0), 0), [id])

  const shared = useMemo(() => ({
    uTime: { value: 0 }, uHalfH: { value: 540 }, uCoreH: { value: sig.coreH },
    uNear: { value: 0 }, uWake: { value: 1 }, uPerform: { value: 0 }, uAbsorb: { value: 0 },
    uTarget: { value: new THREE.Vector3(0, 1.1, 2) },
    uHot: { value: new THREE.Color(sig.hot) }, uCool: { value: new THREE.Color(sig.cool) },
    uGain: { value: 1 },
  }), [sig])

  const parts = useMemo(() => {
    const motes = new THREE.Points(moteGeometry(Math.max(sig.motes, 1), salt), additive(MOTE_VS, MOTE_FS, {
      ...shared,
      uM0: { value: new THREE.Vector4(...sig.m0) }, uM1: { value: new THREE.Vector4(...sig.m1) },
      uM2: { value: new THREE.Vector4(...sig.m2) },
      // the future streams toward the finale garden (-z, slightly toward x = 0)
      uDir: { value: new THREE.Vector2(0.22, -1).normalize() },
    }))
    const strands = Math.min(sig.strands, MAX_STRANDS)
    const filaments = new THREE.Mesh(filamentGeometry(strands), additive(FILAMENT_VS, FILAMENT_FS, {
      ...shared,
      uF0: { value: new THREE.Vector4(...sig.f0) }, // widths are authored as the hot core; the soft falloff needs ~2.3x that
      uF1: { value: new THREE.Vector4(sig.f1[0], sig.f1[1], sig.f1[2] * 2.3, sig.f1[3]) },
      uF2: { value: new THREE.Vector4(...sig.f2) },
    }))
    const glowMat = additive(GLOW_VS, GLOW_FS, {
      uCenter: { value: new THREE.Vector3() }, uSigma: { value: sig.glow[0] }, uDensity: { value: sig.glow[1] },
      uHot: shared.uHot, uCool: shared.uCool, uTime: shared.uTime,
    })
    glowMat.side = THREE.BackSide
    const glow = new THREE.Mesh(new THREE.SphereGeometry(Math.min(sig.glow[0] * 3.2, sig.coreH * 0.9), 20, 14), glowMat)
    glow.position.y = sig.coreH
    const gemMat = new THREE.ShaderMaterial({
      vertexShader: GEM_VS, fragmentShader: GEM_FS, toneMapped: false,
      uniforms: { uHot: shared.uHot, uCool: shared.uCool, uTime: shared.uTime, uBeat: { value: 0 }, uLit: { value: 1 } },
    })
    const gem = new THREE.Mesh(crystalGeometry(), gemMat)
    gem.position.y = sig.coreH
    for (const o of [motes, filaments, glow]) o.renderOrder = 3
    // the gem writes depth, so ribbons passing behind it are really behind it
    gem.renderOrder = 2
    return { motes, filaments, glow, gem, strands }
  }, [sig, salt, shared])

  useEffect(() => () => {
    for (const o of [parts.motes, parts.filaments, parts.glow, parts.gem]) {
      o.geometry.dispose()
      ;(o.material as THREE.Material).dispose()
    }
  }, [parts])

  const light = useRef<VirtualPointLight>(null)
  const phase = useRef<Phase>({ perform: 0, absorb: 0, absorbing: false })
  const wasPerforming = useRef(false)
  const wake = useRef(visited ? 0 : 1)
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const settle = useRef(1)
  const camWorld = useMemo(() => new THREE.Vector3(), [])

  useHubFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const t = state.clock.elapsedTime
    const p = phase.current
    const performing = worldRT.performingMemoryId === id
    if (wasPerforming.current && !performing) {
      // The card closed (or the performance was cancelled): only a visit flows into her.
      p.absorbing = true
      p.absorb = 0
    }
    wasPerforming.current = performing
    // keep the column up while the card is open; it was the performance that raised it
    p.perform = THREE.MathUtils.damp(p.perform, performing ? 1 : 0, performing ? 1.6 : 4, dt)
    if (p.absorbing) {
      p.absorb += dt / ABSORB_SECONDS
      if (p.absorb >= 1) { p.absorbing = false; p.absorb = 0 }
    }
    wake.current = THREE.MathUtils.damp(wake.current, visited && !p.absorbing && !performing ? 0 : 1, 1.2, dt)

    const body = avatarRT().pos
    const dx = body.x - position[0]
    const dz = body.z - position[1]
    const dist = Math.hypot(dx, dz)
    const near = THREE.MathUtils.clamp(1 - (dist - 1.2) / 6, 0, 1) * (visited ? 0.3 : 1)
    const u = shared
    u.uTime.value = t
    u.uHalfH.value = (state.size.height / 2) * state.viewport.dpr
    u.uNear.value = THREE.MathUtils.damp(u.uNear.value, near, 3, dt)
    u.uWake.value = wake.current
    u.uPerform.value = p.perform
    u.uAbsorb.value = p.absorbing ? p.absorb : 0
    u.uTarget.value.set(dx, body.y - groundY + 1.15, dz)
    // Day light eats additive light; dusk shows it off. Keep both readable.
    const night = nightBlend(worldRT.timeOfDay)
    u.uGain.value = THREE.MathUtils.lerp(1.1, 0.82, night) * (qualityRT.level === "high" ? 1 : 1.15)

    // distance tiers from the camera, so a long view keeps only the beacon
    camWorld.copy(state.camera.position)
    parts.gem.getWorldPosition(tmp)
    const camD = camWorld.distanceTo(tmp)
    const particleScale = qualityRT.profile.particles
    parts.filaments.visible = camD < FAR_FILAMENTS && qualityRT.level !== "low" || p.absorbing
    parts.motes.visible = camD < FAR_MOTES || p.absorbing
    parts.motes.geometry.setDrawRange(0, Math.round(sig.motes * particleScale))

    const beat = Math.pow(Math.max(Math.sin(t * 1.9 + salt), 0), 6) * (0.4 + 0.6 * wake.current)
    const gemMat = parts.gem.material as THREE.ShaderMaterial
    gemMat.uniforms.uBeat.value = beat + p.perform * 0.8
    gemMat.uniforms.uLit.value = THREE.MathUtils.lerp(0.55, 1, wake.current)
    const gemSize = THREE.MathUtils.lerp(0.045, 0.07, wake.current) * (1 + near * 0.15 + p.perform * 0.3) * (1 - smoothPulse(p.absorb) * 0.35)
    parts.gem.scale.setScalar(gemSize)
    parts.gem.position.y = sig.coreH + Math.sin(t * 1.1 + salt) * 0.05 + p.perform * 0.35
    parts.gem.rotation.set(t * 0.21, t * 0.37 * (0.4 + wake.current), 0)
    const glowMat = parts.glow.material as THREE.ShaderMaterial
    // The absorb: in daylight the streams alone are specks against sunlit
    // grass, so the glow itself rides their arc, brightest in flight, and
    // settles into her chest. Afterwards the resting ember fades back in.
    let travel: number
    if (p.absorbing) {
      const a = THREE.MathUtils.smoothstep(p.absorb, 0.12, 0.82)
      const arc = Math.sin(Math.PI * a) * 1.1
      const tx = u.uTarget.value
      parts.glow.position.set(tx.x * a, THREE.MathUtils.lerp(parts.gem.position.y, tx.y, a) + arc, tx.z * a)
      travel = (1 + 1.6 * Math.sin(Math.PI * a)) * (1 - THREE.MathUtils.smoothstep(p.absorb, 0.86, 1))
      settle.current = 0
    } else {
      parts.glow.position.set(0, parts.gem.position.y, 0)
      settle.current = Math.min(1, settle.current + dt / 1.6)
      travel = settle.current
    }
    glowMat.uniforms.uCenter.value.copy(parts.glow.getWorldPosition(tmp))
    glowMat.uniforms.uDensity.value = sig.glow[1] * (0.45 + 0.55 * wake.current) * (1 + near * 0.4 + p.perform * 1.2 + beat * 0.25) * u.uGain.value * travel

    if (light.current) {
      light.current.position.y = parts.gem.position.y
      // a glow on the grass at dusk and night; in sunlight such a small light would not show
      light.current.intensity = (0.3 + 0.7 * wake.current) * (0.8 + near * 0.4 + p.perform * 1.2 + beat * 0.15) * THREE.MathUtils.lerp(0.06, 0.22, night)
    }

  })

  return (
    <group position={[position[0], groundY, position[1]]} name={`memory-wisp-${id}`} userData={{ dynamic: true }}>
      <primitive object={parts.gem} />
      <primitive object={parts.glow} />
      <primitive object={parts.filaments} />
      <primitive object={parts.motes} />
      <VirtualLight ref={light} position={[0, sig.coreH, 0]} color={sig.hot} intensity={0.3} distance={4} decay={2} />
    </group>
  )
}

/** A six-sided bipyramid, taller than wide: reads as a crystal shard, not a die. */
const crystalGeometry = (): THREE.BufferGeometry => {
  const pts: number[] = []
  const top = [0, 1.55, 0], bot = [0, -1.1, 0]
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2
    const p0 = [Math.cos(a0) * 0.62, 0.15, Math.sin(a0) * 0.62]
    const p1 = [Math.cos(a1) * 0.62, 0.15, Math.sin(a1) * 0.62]
    pts.push(...top, ...p1, ...p0, ...bot, ...p0, ...p1)
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3))
  return out
}

const smoothPulse = (x: number): number => (x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x))
