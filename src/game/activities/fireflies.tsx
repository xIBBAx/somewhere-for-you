import { useFrame } from "@react-three/fiber"
import { useMemo, useRef } from "react"
import * as THREE from "three"
import { useAdventures } from "../../state/adventureStore"
import { renderedGroundHeight } from "../environment/ground/groundSurface"
import { sfx } from "../audio/audio"
import { worldRT, type AvatarBody } from "../runtime"
import { togetherRT } from "../together/togetherState"
import { say } from "../together/Together"
import { activityRT, useActivityUI } from "./activityState"
import { forwardOf, type ActivityContext } from "./context"
import { fireflyCupped } from "../vfx/signatures"

/**
 * Catching fireflies: at night a few dozen drift around you wherever you are.
 * Walk up to one and press E to scoop it into cupped hands; twelve fill the
 * jar, and then they are all set free in a glowing spiral.
 */
const COUNT = 26
const JAR_FULL = 12
type Fly = { pos: THREE.Vector3; home: THREE.Vector3; phase: number; speed: number; caught: number; free: number }
const flies: Fly[] = Array.from({ length: COUNT }, (_, i) => ({ pos: new THREE.Vector3(0, -100, 0), home: new THREE.Vector3(0, -100, 0), phase: i * 1.7, speed: 0.4 + (i % 5) * 0.08, caught: 0, free: 0 }))
const catchRT = { t: -1, target: -1, body: null as AvatarBody | null, releasing: -1, nightAmount: 0 }
const _f = new THREE.Vector3()

const respawn = (fly: Fly, body: AvatarBody, near: boolean): void => {
  const a = Math.random() * Math.PI * 2
  const r = near ? 3 + Math.random() * 10 : 12 + Math.random() * 8
  const x = body.pos.x + Math.sin(a) * r
  const z = body.pos.z + Math.cos(a) * r
  fly.home.set(x, renderedGroundHeight(x, z) + 0.5 + Math.random() * 1.1, z)
  fly.pos.copy(fly.home)
  fly.caught = 0
}

const nearest = (body: AvatarBody): number => {
  let best = -1
  let bestD = 1.35
  for (let i = 0; i < flies.length; i++) {
    const f = flies[i]
    if (f.caught > 0 || f.free > 0) continue
    const d = Math.hypot(f.pos.x - body.pos.x, f.pos.z - body.pos.z)
    if (d < bestD && f.pos.y - body.pos.y < 2.1) { bestD = d; best = i }
  }
  return best
}

export const fireflyPrompt = (ctx: ActivityContext): string | null => {
  if (!ctx.night || ctx.water === "swim" || catchRT.releasing >= 0) return null
  if (activityRT.jar >= JAR_FULL) return "E — let the fireflies go"
  return nearest(ctx.body) >= 0 ? "E — catch the firefly" : null
}

export const startCatch = (ctx: ActivityContext): void => {
  if (activityRT.jar >= JAR_FULL) {
    catchRT.releasing = 0
    catchRT.body = ctx.body
    sfx.whoosh()
    const adventures = useAdventures.getState()
    adventures.bump("bestJar", activityRT.jar, "max")
    useActivityUI.getState().showResult("Free again", "Twelve little stars, back to the night.")
    if (togetherRT.distance < 10) say(ctx.id === "explorer" ? "companion" : "explorer", "That was beautiful.")
    return
  }
  catchRT.target = nearest(ctx.body)
  if (catchRT.target < 0) return
  catchRT.t = 0
  catchRT.body = ctx.body
  ctx.body.paused = true
  ctx.body.vel.set(0, 0, 0)
  useActivityUI.getState().setMode("catch")
}

export const updateFireflies = (ctx: ActivityContext): void => {
  catchRT.nightAmount = THREE.MathUtils.damp(catchRT.nightAmount, ctx.night ? 1 : 0, 0.8, ctx.dt)
  if (!ctx.night && activityRT.jar > 0 && worldRT.timeOfDay < 0.5) activityRT.jar = 0
  const body = ctx.body
  for (const f of flies) {
    const away = Math.hypot(f.home.x - body.pos.x, f.home.z - body.pos.z)
    if (f.home.y < -50 || (away > 24 && f.caught === 0 && f.free === 0)) respawn(f, body, f.home.y < -50)
    if (f.caught > 0 || f.free > 0) continue
    f.phase += ctx.dt * f.speed
    // lazy looping flight around a home point, bobbing up and down
    f.pos.set(f.home.x + Math.sin(f.phase * 1.3) * 0.9 + Math.sin(f.phase * 0.37) * 0.6, f.home.y + Math.sin(f.phase * 2.1) * 0.25, f.home.z + Math.cos(f.phase * 1.1) * 0.9)
  }
  if (catchRT.t >= 0 && catchRT.body) {
    catchRT.t += ctx.dt
    const t = catchRT.t
    const b = catchRT.body
    const fly = flies[catchRT.target]
    forwardOf(b.facing, _f)
    const pose = togetherRT.pose[ctx.id]
    const reach = THREE.MathUtils.smoothstep(t, 0, 0.3) * (1 - THREE.MathUtils.smoothstep(t, 0.9, 1.3))
    const hands = new THREE.Vector3().copy(b.pos).addScaledVector(_f, 0.38)
    hands.y += 1.0 + (fly ? THREE.MathUtils.clamp(fly.pos.y - b.pos.y - 1.0, -0.4, 0.5) * (1 - THREE.MathUtils.smoothstep(t, 0.4, 0.8)) : 0)
    for (const [goal, side] of [[pose.reachL, 1], [pose.reachR, -1]] as const) {
      goal.target.copy(hands).add(new THREE.Vector3(-_f.z * 0.04 * side, 0, _f.x * 0.04 * side))
      goal.fingers.copy(_f).normalize()
      goal.palm.set(_f.z * side, 0.4, -_f.x * side).normalize()
      goal.weight = reach
      goal.grip = t > 0.35 ? 0.65 : 0.1
    }
    pose.bow = 0.1 * reach
    if (fly && t < 0.4) fly.pos.lerp(hands, 0.15)
    if (fly && t >= 0.4 && fly.caught === 0) {
      fly.caught = 1
      activityRT.jar++
      sfx.twinkle()
      useAdventures.getState().bump("fireflies", 1)
      fireflyCupped(hands)
      if (activityRT.jar === JAR_FULL) useActivityUI.getState().showResult("The jar is full", "Twelve fireflies. Press E to let them go.")
    }
    if (t > 1.3) {
      b.paused = false
      catchRT.t = -1
      useActivityUI.getState().setMode("none")
    }
  }
  if (catchRT.releasing >= 0 && catchRT.body) {
    catchRT.releasing += ctx.dt
    const r = catchRT.releasing
    let i = 0
    for (const f of flies) {
      if (f.caught === 0 && f.free === 0) continue
      if (f.free === 0) { f.free = 0.001; f.pos.copy(catchRT.body.pos).setY(catchRT.body.pos.y + 1.1) }
      f.free += ctx.dt
      const a = f.free * 2.2 + i * 0.52
      const rad = 0.3 + f.free * 0.55
      f.pos.set(catchRT.body.pos.x + Math.sin(a) * rad, catchRT.body.pos.y + 1.1 + f.free * 0.9, catchRT.body.pos.z + Math.cos(a) * rad)
      i++
    }
    if (r > 6) {
      for (const f of flies) if (f.free > 0) { f.free = 0; respawn(f, catchRT.body, false) }
      activityRT.jar = 0
      catchRT.releasing = -1
    }
  }
}

/** Soft blinking glow points. */
export const FireflyVisual = (): React.ReactElement => {
  const points = useRef<THREE.Points>(null)
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3))
    g.setAttribute("aGlow", new THREE.BufferAttribute(new Float32Array(COUNT), 1))
    return g
  }, [])
  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uSize: { value: 52 } },
    vertexShader: /* glsl */ `
      attribute float aGlow;
      uniform float uSize;
      varying float vGlow;
      void main() {
        vGlow = aGlow;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * (0.35 + aGlow * 0.65) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vGlow;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float core = exp(-r * r * 18.0);
        float halo = exp(-r * r * 3.5) * 0.35;
        float a = (core + halo) * vGlow;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vec3(1.0, 0.92, 0.45) * (1.0 + core * 2.5), a);
      }`,
  }), [])
  useFrame((state) => {
    const p = geometry.attributes.position.array as Float32Array
    const g = geometry.attributes.aGlow.array as Float32Array
    const time = state.clock.elapsedTime
    for (let i = 0; i < COUNT; i++) {
      const f = flies[i]
      p[i * 3] = f.pos.x
      p[i * 3 + 1] = f.pos.y
      p[i * 3 + 2] = f.pos.z
      // slow pulses like real fireflies; caught ones vanish into the jar
      const blink = Math.pow(Math.max(0, Math.sin(time * 1.4 + i * 2.3)), 3)
      g[i] = catchRT.nightAmount * (f.caught > 0 && f.free === 0 ? 0 : f.free > 0 ? 1 : 0.25 + blink * 0.75)
    }
    geometry.attributes.position.needsUpdate = true
    geometry.attributes.aGlow.needsUpdate = true
    if (points.current) points.current.visible = catchRT.nightAmount > 0.01
  })
  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} />
}
