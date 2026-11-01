import * as THREE from "three"
import { qualityRT } from "../../../state/qualityStore"
import { universeDirToLocal, universeToView } from "../spaceState"
import { MANTA_FS, MANTA_VS } from "./wonderShaders"
import { sitePoint, type Offset, type WonderSite, type WonderTick } from "./wonderWorlds"

/**
 * Star mantas: slow, graceful, luminous rays that live near a giant world's
 * arrival point (a magic of Starborn's, not a claim about any real animal).
 * They wander a ring round the arrival point. Fly gently near them and one
 * notices and swims alongside her for a while; surge and they scatter, then
 * drift back in their own time. Procedural geometry, one instanced draw call.
 */

const MAX = 6
/** wingspan is about 2 × this, in game metres */
const SIZE = 13
/** how near she must be (game m) for them to notice, and how fast she may go to be noticed */
const NOTICE = 700
const NOTICE_SPEED = 30
/** surging past this speed sends them scattering */
const SURGE_SPEED = 45
const SCATTER_RANGE = 900

type Mode = "wander" | "swim" | "scatter"
type Manta = { pos: THREE.Vector3; vel: THREE.Vector3; home: Offset; mode: Mode; timer: number; cool: number; side: number; k: number }

/** The outline in the manta's own plane (x across, z forward), a fan of triangles, plus a trailing tail. */
const buildManta = (): THREE.BufferGeometry => {
  const outline: Array<[number, number]> = [
    [0, 1], [0.35, 0.8], [0.78, 0.42], [1, 0], [0.92, -0.35], [0.55, -0.7], [0.2, -0.92], [0, -0.95],
    [-0.2, -0.92], [-0.55, -0.7], [-0.92, -0.35], [-1, 0], [-0.78, 0.42], [-0.35, 0.8],
  ]
  const pos: number[] = [0, 0, 0], wing: number[] = [0], idx: number[] = []
  for (const [x, z] of outline) { pos.push(x, 0, z); wing.push(Math.min(1, Math.abs(x))) }
  const n = outline.length
  for (let i = 0; i < n; i++) idx.push(0, 1 + i, 1 + ((i + 1) % n))
  const t0 = pos.length / 3
  pos.push(-0.05, 0, -0.9, 0.05, 0, -0.9, 0, 0, -2.6)
  wing.push(0.3, 0.3, 0.05)
  idx.push(t0, t0 + 1, t0 + 2)
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute("aWing", new THREE.Float32BufferAttribute(wing, 1))
  g.setIndex(idx)
  return g
}

export type StarMantas = {
  root: THREE.Group
  bind: (s: WonderSite | null) => void
  update: (t: WonderTick) => void
  dispose: () => void
}

export const createStarMantas = (): StarMantas => {
  const root = new THREE.Group()
  root.name = "star-mantas"
  const geo = buildManta()
  const uniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color("#ffffff") } }
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: MANTA_VS, fragmentShader: MANTA_FS,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  })
  const mesh = new THREE.InstancedMesh(geo, mat, MAX)
  mesh.frustumCulled = false
  mesh.count = 0
  root.add(mesh)
  root.visible = false

  const flock: Manta[] = Array.from({ length: MAX }, (_, i) => ({
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), home: [0, 0, 0] as Offset,
    mode: "wander" as Mode, timer: 0, cool: 0, side: i % 2 ? 1 : -1, k: i,
  }))
  let site: WonderSite | null = null
  let count = 0
  const _t = new THREE.Vector3(), _d = new THREE.Vector3(), _dir = new THREE.Vector3()
  const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4(), _v = new THREE.Vector3()
  const UPL = new THREE.Vector3(0, 1, 0)

  const bind = (s: WonderSite | null): void => {
    site = s
    root.visible = !!s && s.world.mantas > 0
    if (!s || s.world.mantas === 0) { mesh.count = 0; return }
    const scale = qualityRT.level === "low" ? 0.5 : qualityRT.level === "medium" ? 0.75 : 1
    count = Math.max(1, Math.min(MAX, Math.round(s.world.mantas * scale)))
    mesh.count = count
    uniforms.uColor.value.set(s.world.color)
    for (let i = 0; i < count; i++) {
      const f = flock[i]
      const a = (i / count) * Math.PI * 2 + 0.9
      f.home = [Math.cos(a) * 190, 20 + Math.sin(a * 2) * 50, 300 + Math.sin(a) * 90]
      sitePoint(s, f.home[0], f.home[1], f.home[2], f.pos)
      f.vel.set(0, 0, 0)
      f.mode = "wander"; f.timer = 0; f.cool = i * 0.7
    }
  }

  const update = (t: WonderTick): void => {
    if (!site || count === 0) return
    const s = site
    uniforms.uTime.value = t.time
    const calm = t.calm
    for (let i = 0; i < count; i++) {
      const f = flock[i]
      f.timer -= t.dt
      f.cool -= t.dt
      const d = f.pos.distanceTo(t.mount)
      // notice: a gentle approach is met with company; a surge scatters them
      if (f.mode === "wander" && f.cool <= 0 && d < NOTICE && t.speed < NOTICE_SPEED) {
        f.mode = "swim"; f.timer = calm ? 30 : 22
      } else if (f.mode !== "scatter" && !calm && t.speed > SURGE_SPEED && d < SCATTER_RANGE) {
        f.mode = "scatter"; f.timer = 2.2
        _d.subVectors(f.pos, t.mount)
        if (_d.lengthSq() < 1e-6) _d.copy(s.fwd)
        f.vel.copy(_d.normalize()).multiplyScalar(24)
      }
      if (f.mode === "swim" && (f.timer <= 0 || d > NOTICE * 2)) { f.mode = "wander"; f.cool = 10 }
      if (f.mode === "scatter" && f.timer <= 0) { f.mode = "wander"; f.cool = 8 }

      const tm = t.time * (calm ? 0.5 : 1) + f.k * 1.7
      let maxV = calm ? 3 : 7
      if (f.mode === "swim") {
        // alongside her: out to one side, above or below, keeping her pace
        const j = f.k >> 1
        _t.copy(t.mount)
          .addScaledVector(s.right, f.side * (18 + 7 * j) + Math.sin(tm * 0.6) * 3)
          .addScaledVector(s.up, 4 + 2 * j + Math.cos(tm * 0.5) * 2)
          .addScaledVector(s.fwd, Math.sin(tm * 0.4) * 5)
        maxV = Math.max(10, t.speed + 6)
      } else if (f.mode === "wander") {
        sitePoint(s,
          f.home[0] + Math.sin(tm * 0.09) * 40,
          f.home[1] + Math.cos(tm * 0.13) * 16,
          f.home[2] + Math.cos(tm * 0.07) * 30, _t)
      }
      if (f.mode !== "scatter") {
        // steer toward the target, never faster than maxV
        _d.subVectors(_t, f.pos).multiplyScalar(0.8)
        const L = _d.length()
        if (L > maxV) _d.multiplyScalar(maxV / L)
        f.vel.lerp(_d, 1 - Math.exp(-(f.mode === "swim" ? 2.5 : 1.4) * t.dt))
      } else {
        // scattered: the burst eases off into the drift
        f.vel.multiplyScalar(Math.exp(-0.9 * t.dt))
      }
      f.pos.addScaledVector(f.vel, t.dt)

      // face the way she is going (their own way when still), in the view's axes
      _dir.copy(f.vel)
      if (_dir.lengthSq() < 0.04) _dir.copy(s.fwd)
      universeDirToLocal(_dir.normalize(), _z)
      _x.crossVectors(UPL, _z)
      if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0)
      _x.normalize()
      _y.crossVectors(_z, _x).normalize()
      _m.makeBasis(_x.multiplyScalar(SIZE), _y.multiplyScalar(SIZE), _z.multiplyScalar(SIZE))
      _m.setPosition(universeToView(f.pos, _v))
      mesh.setMatrixAt(i, _m)
    }
    mesh.instanceMatrix.needsUpdate = true
  }

  const dispose = (): void => {
    geo.dispose()
    mat.dispose()
  }

  return { root, bind, update, dispose }
}
