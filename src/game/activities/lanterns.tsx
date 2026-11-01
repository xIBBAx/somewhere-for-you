import { useFrame } from "@react-three/fiber"
import { useMemo, useRef } from "react"
import * as THREE from "three"
import { useAdventures } from "../../state/adventureStore"
import { waterDepthAt } from "../../world/waterSurface"
import { windRT } from "../../world/wind"
import { sfx } from "../audio/audio"
import { cameraRT, characterRT, companionRT, playerRT, worldRT, type AvatarBody, type CharacterId } from "../runtime"
import { togetherRT } from "../together/togetherState"
import { say } from "../together/Together"
import { useActivityUI } from "./activityState"
import { forwardOf, rightOf, type ActivityContext } from "./context"
import { lanternEmbers } from "../vfx/signatures"

/**
 * Sky lanterns: in the evening or at night, E lights a paper lantern held in
 * both hands; after a quiet wish it lifts away on the wind. If the two of
 * you are together, you both release one. Up to 24 drift at once.
 */
const MAX = 24
type Lantern = { pos: THREE.Vector3; vel: THREE.Vector3; age: number; seed: number; held: CharacterId | null; flame: number }
const lanterns: Lantern[] = []
const ritual = { t: -1, who: [] as CharacterId[], yaw: 0 }
const _f = new THREE.Vector3()
const _r = new THREE.Vector3()
const bodyOf = (id: CharacterId): AvatarBody => (id === "explorer" ? playerRT : companionRT)

export const lanternPrompt = (ctx: ActivityContext): string | null =>
  ctx.night && ritual.t < 0 && ctx.water === "land" && cameraRT.canopy < 0.35 && waterDepthAt(ctx.body.pos.x, ctx.body.pos.z) === 0
    ? "E — release an akash deep, a sky lantern" : null

const spawn = (who: CharacterId): void => {
  if (lanterns.length >= MAX) lanterns.shift()
  lanterns.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), age: 0, seed: Math.random() * 100, held: who, flame: 0 })
}

export const startLantern = (ctx: ActivityContext): void => {
  ritual.t = 0
  ritual.who = [ctx.id]
  // the other one joins in when they are right there
  if (characterRT.companionPresent && togetherRT.partnerNear) ritual.who.push(ctx.id === "explorer" ? "companion" : "explorer")
  for (const id of ritual.who) {
    const body = bodyOf(id)
    body.paused = true
    body.vel.set(0, 0, 0)
    spawn(id)
  }
  useActivityUI.getState().setMode("lantern")
  sfx.pop()
}

export const updateLanterns = (ctx: ActivityContext): void => {
  if (ritual.t >= 0) {
    ritual.t += ctx.dt
    const t = ritual.t
    for (const id of ritual.who) {
      const body = bodyOf(id)
      const lantern = lanterns.find((l) => l.held === id)
      forwardOf(body.facing, _f)
      rightOf(body.facing, _r)
      const lift = THREE.MathUtils.smoothstep(t, 2.4, 3.2)
      const height = 1.05 + lift * 0.7
      if (lantern) {
        lantern.pos.copy(body.pos).addScaledVector(_f, 0.42)
        lantern.pos.y += height
        lantern.flame = THREE.MathUtils.smoothstep(t, 0.6, 1.4)
      }
      // both hands cradle the lantern's base, then push it gently skyward
      const pose = togetherRT.pose[id]
      const hold = THREE.MathUtils.smoothstep(t, 0.0, 0.4) * (1 - THREE.MathUtils.smoothstep(t, 3.1, 3.6))
      for (const [goal, side] of [[pose.reachL, -1], [pose.reachR, 1]] as const) {
        goal.target.copy(body.pos).addScaledVector(_f, 0.4).addScaledVector(_r, 0.13 * side)
        goal.target.y += height - 0.18
        goal.fingers.copy(_f).multiplyScalar(0.5).add(_r.clone().multiplyScalar(-0.5 * side)).normalize()
        goal.palm.set(0, 1, 0)
        goal.weight = hold
        goal.grip = 0.3
      }
      pose.love = THREE.MathUtils.smoothstep(t, 1.2, 2) * 0.6
      if (t > 3.2 && lantern?.held) {
        lantern.held = null
        lanternEmbers(lantern.pos)
        lantern.vel.set(0, 0.32, 0)
      }
    }
    if (t > 3.2 && t - ctx.dt <= 3.2) {
      sfx.whoosh()
      const adventures = useAdventures.getState()
      adventures.bump("lanterns", 1)
      adventures.bump("wishes", 1)
    }
    if (t > 1.0 && t - ctx.dt <= 1.0 && ritual.who.length > 1) say(ritual.who[1], "Make a wish.", 2.6)
    // watch them rise for a moment, looking up from beside the two of you
    const lead = bodyOf(ritual.who[0])
    if (t > 2.8 && t < 7.2) {
      const f = worldRT.focus
      forwardOf(lead.facing, _f)
      if (t - ctx.dt <= 2.8) {
        // stand the camera on the side away from the other one of you
        const mate = ritual.who.length > 1 ? bodyOf(ritual.who[1]) : null
        const score = (yaw: number): number => mate ? Math.hypot(lead.pos.x + Math.sin(yaw) * 5 - mate.pos.x, lead.pos.z + Math.cos(yaw) * 5 - mate.pos.z) : 0
        const a = lead.facing + Math.PI + 0.75, b = lead.facing + Math.PI - 0.75
        ritual.yaw = score(a) >= score(b) ? a : b
      }
      f.active = true
      f.x = lead.pos.x + _f.x * 1.2
      f.z = lead.pos.z + _f.z * 1.2
      f.yaw = ritual.yaw
      // a gentle upward tilt; steeper would bury the boom in the ground
      f.pitch = -0.06 - THREE.MathUtils.smoothstep(t, 3.4, 6.5) * 0.12
      f.distance = 6.4 + THREE.MathUtils.smoothstep(t, 3.4, 6.5) * 1.6
    }
    if (t > 7.2) {
      worldRT.focus.active = false
      worldRT.focus.yaw = worldRT.focus.pitch = worldRT.focus.distance = null
      cameraRT.targetYaw = cameraRT.yaw
      for (const id of ritual.who) bodyOf(id).paused = false
      ritual.t = -1
      useActivityUI.getState().setMode("none")
      useActivityUI.getState().showResult("A lantern wish", ritual.who.length > 1 ? "Two little lights, side by side." : "Up it goes, carrying your wish.")
    }
  }
  for (let i = lanterns.length - 1; i >= 0; i--) {
    const l = lanterns[i]
    if (l.held) continue
    l.age += ctx.dt
    // buoyant, slowly accelerating climb that drifts with the wind
    l.vel.y = Math.min(0.48, l.vel.y + ctx.dt * 0.03)
    l.vel.x = THREE.MathUtils.damp(l.vel.x, windRT.dirX * (0.18 + windRT.strength * 0.35) + Math.sin(l.age * 0.7 + l.seed) * 0.08, 0.5, ctx.dt)
    l.vel.z = THREE.MathUtils.damp(l.vel.z, windRT.dirZ * (0.18 + windRT.strength * 0.35) + Math.cos(l.age * 0.6 + l.seed) * 0.08, 0.5, ctx.dt)
    l.pos.addScaledVector(l.vel, ctx.dt)
    if (l.age > 140) lanterns.splice(i, 1)
  }
}

/** Instanced paper lanterns with a warm inner glow (bloom on High). */
export const LanternVisual = (): React.ReactElement => {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const geometry = useMemo(() => {
    // a tapered paper shade, open at the bottom
    const g = new THREE.CylinderGeometry(0.17, 0.13, 0.42, 14, 3, true)
    g.translate(0, 0.21, 0)
    return g
  }, [])
  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: "#f3c78c", emissive: "#ff9a3c", emissiveIntensity: 0, roughness: 0.9, side: THREE.DoubleSide, transparent: true, opacity: 0.94 })
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aFlame;\nvarying float vFlame;\nvarying float vH;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFlame = aFlame;\nvH = position.y / 0.42;")
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vFlame;\nvarying float vH;")
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
  // brightest near the flame at the base, paper ribs darker
  float rib = 0.85 + 0.15 * step(0.08, fract(vH * 6.0));
  totalEmissiveRadiance = vec3(1.0, 0.55, 0.2) * vFlame * (2.6 - vH * 1.6) * rib;`)
    }
    m.customProgramCacheKey = () => "sky-lantern-v1"
    return m
  }, [])
  const flame = useMemo(() => new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1), [])
  const matrix = useMemo(() => new THREE.Matrix4(), [])
  useFrame(() => {
    const m = mesh.current
    if (!m) return
    if (!m.geometry.getAttribute("aFlame")) m.geometry.setAttribute("aFlame", flame)
    for (let i = 0; i < lanterns.length; i++) {
      const l = lanterns[i]
      const sway = Math.sin(l.age * 1.3 + l.seed) * 0.06
      matrix.makeRotationZ(sway).setPosition(l.pos)
      m.setMatrixAt(i, matrix)
      // far lanterns fade after a couple of minutes
      ;(flame.array as Float32Array)[i] = l.flame * (1 - THREE.MathUtils.smoothstep(l.age, 110, 140)) * (l.held ? 1 : 1 + Math.sin(l.age * 7 + l.seed) * 0.08)
    }
    m.count = lanterns.length
    m.instanceMatrix.needsUpdate = true
    flame.needsUpdate = true
  })
  return <instancedMesh ref={mesh} args={[geometry, material, MAX]} frustumCulled={false} />
}
