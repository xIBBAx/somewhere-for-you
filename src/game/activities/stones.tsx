import { useFrame } from "@react-three/fiber"
import { useMemo, useRef } from "react"
import * as THREE from "three"
import { waterDepthAt, waterSurfaceAt } from "../../world/waterSurface"
import { emitSplash } from "../../world/render/waterFx"
import { useAdventures } from "../../state/adventureStore"
import { sfx } from "../audio/audio"
import { cameraRT, worldRT, type AvatarBody, type CharacterId } from "../runtime"
import { togetherRT } from "../together/togetherState"
import { say } from "../together/Together"
import { activityRT, useActivityUI } from "./activityState"
import { forwardOf, rightOf, type ActivityContext } from "./context"
import { skipCrown } from "../vfx/signatures"

/**
 * Skipping stones: at a lake or pond shore, E picks up a flat pebble and a
 * marker swings across a power bar; E again throws. The closer to the bright
 * centre, the more times the stone skips (up to about a dozen), each touch
 * leaving a ring and a plink.
 */
const _f = new THREE.Vector3()
const _r = new THREE.Vector3()
const _p = new THREE.Vector3()

type Hop = { x: number; z: number; y: number; t0: number; t1: number; peak: number }
export const stoneRT = {
  active: false,
  t: 0,
  hops: [] as Hop[],
  start: new THREE.Vector3(),
  pos: new THREE.Vector3(),
  index: 0,
  skips: 0,
  aimTime: 0,
  throwTime: -1,
  accuracy: 0,
  body: null as AvatarBody | null,
  who: "explorer" as CharacterId,
}

/** Distance ahead (m) where open water begins, if this is a good shore. */
const waterAhead = (body: AvatarBody): number | null => {
  forwardOf(body.facing, _f)
  let start: number | null = null
  for (let d = 0.6; d <= 4; d += 0.4) {
    if (waterDepthAt(body.pos.x + _f.x * d, body.pos.z + _f.z * d) > 0.12) { start = d; break }
  }
  if (start === null) return null
  // enough open water beyond for a few skips
  let open = 0
  for (let d = start; d <= start + 9; d += 1) if (waterDepthAt(body.pos.x + _f.x * d, body.pos.z + _f.z * d) > 0.25) open++
  return open >= 6 ? start : null
}

export const stonesPrompt = (ctx: ActivityContext): string | null =>
  !stoneRT.active && ctx.water !== "swim" && waterAhead(ctx.body) !== null ? "E — skip a stone" : null

export const startStoneAim = (ctx: ActivityContext): void => {
  stoneRT.body = ctx.body
  stoneRT.who = ctx.id
  stoneRT.aimTime = 0
  stoneRT.throwTime = -1
  ctx.body.paused = true
  ctx.body.vel.set(0, 0, 0)
  useActivityUI.getState().setMode("stoneAim")
  // look out over the water from just behind the thrower
  const f = worldRT.focus
  forwardOf(ctx.body.facing, _f)
  f.active = true
  f.x = ctx.body.pos.x + _f.x * 7
  f.z = ctx.body.pos.z + _f.z * 7
  f.yaw = ctx.body.facing + Math.PI + 0.35
  f.pitch = 0.16
  f.distance = 6.5
  sfx.pop()
}

const releaseCamera = (): void => {
  worldRT.focus.active = false
  worldRT.focus.yaw = worldRT.focus.pitch = worldRT.focus.distance = null
  cameraRT.targetYaw = cameraRT.yaw
}

export const cancelStones = (): void => {
  if (stoneRT.body) stoneRT.body.paused = false
  stoneRT.body = null
  releaseCamera()
  useActivityUI.getState().setMode("none")
}

/** Second E: release at the current marker position. */
export const throwStone = (): void => {
  const body = stoneRT.body
  if (!body) return
  stoneRT.accuracy = 1 - Math.min(1, Math.abs(activityRT.meter - 0.5) * 2)
  stoneRT.throwTime = 0
  useActivityUI.getState().setMode("stoneThrow")
}

const launch = (body: AvatarBody): void => {
  const a = stoneRT.accuracy
  forwardOf(body.facing, _f)
  rightOf(body.facing, _r)
  stoneRT.start.copy(body.pos).addScaledVector(_r, 0.35).addScaledVector(_f, 0.2)
  stoneRT.start.y += 0.95
  // a great release skims low and far; a poor one plops in nearby
  const skips = Math.max(0, Math.round(Math.pow(a, 1.6) * 11.5 + Math.random() * 1.6 - (a < 0.2 ? 1 : 0)))
  const hops: Hop[] = []
  let dist = waterAhead(body) ?? 2
  dist += 2.5 + a * 4
  let reach = 2.2 + a * 3.2
  let t = 0
  let speed = 13 + a * 5
  let peak = 1.4
  let x = stoneRT.start.x, z = stoneRT.start.z
  for (let i = 0; i <= skips; i++) {
    const nx = body.pos.x + _f.x * dist + _r.x * Math.sin(i * 0.7) * 0.15
    const nz = body.pos.z + _f.z * dist + _r.z * Math.sin(i * 0.7) * 0.15
    const surface = waterSurfaceAt(nx, nz)
    const span = Math.hypot(nx - x, nz - z)
    const duration = span / speed
    const hit = surface !== null && waterDepthAt(nx, nz) > 0.05
    hops.push({ x: nx, z: nz, y: hit ? surface : body.pos.y, t0: t, t1: t + duration, peak })
    t += duration
    x = nx
    z = nz
    if (!hit) break
    dist += reach
    reach *= 0.8
    speed *= 0.86
    peak = 0.25 + 0.5 * Math.pow(0.72, i)
  }
  stoneRT.hops = hops
  stoneRT.index = 0
  stoneRT.skips = 0
  stoneRT.t = 0
  stoneRT.active = true
  stoneRT.pos.copy(stoneRT.start)
  sfx.pop()
}

const finish = (): void => {
  const skips = stoneRT.skips
  const adventures = useAdventures.getState()
  const best = adventures.records.bestSkips
  adventures.bump("stonesThrown", 1)
  adventures.bump("bestSkips", skips, "max")
  const ui = useActivityUI.getState()
  if (skips === 0) ui.showResult("Plop.", "Straight to the bottom. The fish say hello.")
  else ui.showResult(`${skips} skip${skips === 1 ? "" : "s"}!`, skips > best ? "A new best for the journal." : skips >= 8 ? "That stone had places to be." : "Plink, plink, plink.")
  if (skips > best && skips >= 3 && stoneRT.body) stoneRT.body.celebrate = 1.3
  if (skips >= 5 && togetherRT.distance < 12) say(stoneRT.who === "explorer" ? "companion" : "explorer", skips >= 9 ? "No way. That was amazing!" : "Nice one!")
}

/** Per-frame update while aiming, throwing or while the stone flies. */
export const updateStones = (ctx: ActivityContext): void => {
  const mode = useActivityUI.getState().mode
  const body = stoneRT.body
  if ((mode === "stoneAim" || mode === "stoneThrow") && body) {
    const pose = togetherRT.pose[ctx.id]
    forwardOf(body.facing, _f)
    rightOf(body.facing, _r)
    if (mode === "stoneAim") {
      stoneRT.aimTime += ctx.dt
      // a marker that sweeps back and forth, a little faster each pass
      const speed = 1.15 + Math.min(stoneRT.aimTime * 0.05, 0.4)
      activityRT.meter = 0.5 - 0.5 * Math.cos(stoneRT.aimTime * Math.PI * speed)
      // crouched, pebble held low and back, ready to throw sidearm
      _p.copy(body.pos).addScaledVector(_r, 0.42).addScaledVector(_f, -0.25)
      _p.y += 0.85
      setReach(pose.reachR, _p, _f, _r, 1, 0.9)
      pose.bow = 0.22
      if (stoneRT.aimTime > 12) cancelStones()
    } else {
      stoneRT.throwTime += ctx.dt
      const t = stoneRT.throwTime
      // wind up → sweep forward low and flat → follow through
      const sweep = THREE.MathUtils.smoothstep(t, 0.05, 0.3)
      _p.copy(body.pos).addScaledVector(_r, 0.45 - sweep * 0.3).addScaledVector(_f, -0.3 + sweep * 0.85)
      _p.y += 0.9 + sweep * 0.05
      setReach(pose.reachR, _p, _f, _r, 1 - THREE.MathUtils.smoothstep(t, 0.55, 0.9), sweep > 0.6 ? 0.2 : 0.9)
      pose.bow = 0.22 - sweep * 0.12
      if (t >= 0.24 && !stoneRT.active && stoneRT.hops.length === 0) launch(body)
      if (t > 0.9) {
        body.paused = false
        useActivityUI.getState().setMode("none")
      }
    }
  }
  if (stoneRT.active) {
    stoneRT.t += ctx.dt
    const hop = stoneRT.hops[stoneRT.index]
    if (!hop) {
      stoneRT.active = false
      stoneRT.hops = []
      releaseCamera()
      finish()
      return
    }
    const prev = stoneRT.index === 0 ? stoneRT.start : _p.set(stoneRT.hops[stoneRT.index - 1].x, stoneRT.hops[stoneRT.index - 1].y, stoneRT.hops[stoneRT.index - 1].z)
    const k = THREE.MathUtils.clamp((stoneRT.t - hop.t0) / Math.max(hop.t1 - hop.t0, 1e-3), 0, 1)
    stoneRT.pos.set(
      THREE.MathUtils.lerp(prev.x, hop.x, k),
      THREE.MathUtils.lerp(prev.y, hop.y, k) + Math.sin(k * Math.PI) * hop.peak,
      THREE.MathUtils.lerp(prev.z, hop.z, k),
    )
    if (k >= 1) {
      const last = stoneRT.index === stoneRT.hops.length - 1
      const wet = waterSurfaceAt(hop.x, hop.z) !== null
      if (wet) emitSplash(hop.x, hop.z, last ? 0.5 : 0.22)
      if (wet) skipCrown(hop.x, waterSurfaceAt(hop.x, hop.z) ?? hop.y, hop.z, last ? 1.3 : 0.75)
      if (last) {
        if (wet) sfx.plop()
      } else {
        sfx.plink(stoneRT.skips)
        stoneRT.skips++
      }
      stoneRT.index++
    }
  }
}

const setReach = (goal: { target: THREE.Vector3; fingers: THREE.Vector3; palm: THREE.Vector3; weight: number; grip: number }, target: THREE.Vector3, f: THREE.Vector3, r: THREE.Vector3, weight: number, grip: number): void => {
  goal.target.copy(target)
  goal.fingers.copy(f).multiplyScalar(0.6).addScaledVector(r, 0.2).normalize()
  goal.palm.set(0, -1, 0)
  goal.weight = weight
  goal.grip = grip
}

/** The pebble itself: a flattened, slightly irregular grey stone. */
export const StoneVisual = (): React.ReactElement => {
  const mesh = useRef<THREE.Mesh>(null)
  const geometry = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(1, 2)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) {
      const n = 1 + Math.sin(p.getX(i) * 5.1) * 0.06 + Math.cos(p.getZ(i) * 4.3) * 0.05
      p.setXYZ(i, p.getX(i) * 0.055 * n, p.getY(i) * 0.018 * n, p.getZ(i) * 0.045 * n)
    }
    g.computeVertexNormals()
    return g
  }, [])
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: "#8a8780", roughness: 0.62 }), [])
  useFrame(() => {
    if (!mesh.current) return
    const holding = activityRT.mode === "stoneAim" || (activityRT.mode === "stoneThrow" && !stoneRT.active)
    mesh.current.visible = stoneRT.active || (holding && stoneRT.body !== null)
    if (stoneRT.active) {
      mesh.current.position.copy(stoneRT.pos)
      mesh.current.rotation.y += 0.6
    } else if (holding && stoneRT.body) {
      mesh.current.position.copy(togetherRT.pose[stoneRT.who].reachR.target)
    }
  })
  return <mesh ref={mesh} geometry={geometry} material={material} castShadow visible={false} />
}
