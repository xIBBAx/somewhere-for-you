import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { useHubFrame } from "../../hubGate"
import { playerRT } from "../../runtime"
import { groundHeight } from "../../world-layout"
import { PEACOCK_HOMES } from "./indiaLayout"

/**
 * Peacocks, India's national bird: three of them wander the home meadow,
 * peck at the grass, and fan their trains when someone comes close. Built in
 * code: no model file to download.
 */
const painted = (g: THREE.BufferGeometry, colour: string): THREE.BufferGeometry => {
  const c = new THREE.Color(colour)
  const n = g.attributes.position.count
  const colours = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) c.toArray(colours, i * 3)
  g.setAttribute("color", new THREE.BufferAttribute(colours, 3))
  return g.index ? g.toNonIndexed() : g
}

const ellipsoid = (rx: number, ry: number, rz: number, x: number, y: number, z: number, colour: string): THREE.BufferGeometry => {
  const g = new THREE.SphereGeometry(1, 14, 10)
  g.scale(rx, ry, rz)
  g.translate(x, y, z)
  return painted(g, colour)
}

const stick = (a: THREE.Vector3, b: THREE.Vector3, r: number, colour: string): THREE.BufferGeometry => {
  const g = new THREE.CylinderGeometry(r, r, a.distanceTo(b), 6)
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()))
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
  return painted(g, colour)
}

const COBALT = "#0d3fb4"
const BRONZE = "#5c7a2a"

const bodyGeometry = (): THREE.BufferGeometry => mergeGeometries([
  ellipsoid(0.15, 0.155, 0.27, 0, 0.5, 0, COBALT),
  ellipsoid(0.13, 0.13, 0.2, 0, 0.52, -0.14, BRONZE),
  ellipsoid(0.035, 0.1, 0.2, -0.14, 0.5, -0.03, "#8d6b3f"),
  ellipsoid(0.035, 0.1, 0.2, 0.14, 0.5, -0.03, "#8d6b3f"),
])

/** Neck, head and crest, built around the neck's base at the origin. */
const neckGeometry = (): THREE.BufferGeometry => {
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.2, 0.02), new THREE.Vector3(0, 0.38, 0.12))
  const parts = [
    painted(new THREE.TubeGeometry(curve, 8, 0.043, 8), COBALT),
    ellipsoid(0.046, 0.05, 0.062, 0, 0.4, 0.14, COBALT),
    ellipsoid(0.012, 0.018, 0.03, -0.042, 0.405, 0.15, "#f6f1e4"),
    ellipsoid(0.012, 0.018, 0.03, 0.042, 0.405, 0.15, "#f6f1e4"),
    ellipsoid(0.007, 0.009, 0.009, -0.047, 0.41, 0.163, "#0a0a12"),
    ellipsoid(0.007, 0.009, 0.009, 0.047, 0.41, 0.163, "#0a0a12"),
  ]
  const beak = new THREE.ConeGeometry(0.016, 0.05, 6)
  beak.rotateX(Math.PI / 2)
  beak.translate(0, 0.39, 0.21)
  parts.push(painted(beak, "#c9b48a"))
  // the crest: a little fan of bare shafts tipped with blue
  for (let i = -3; i <= 3; i++) {
    const a = new THREE.Vector3(i * 0.005, 0.44, 0.13)
    const b = new THREE.Vector3(i * 0.016, 0.53 - Math.abs(i) * 0.004, 0.11 - Math.abs(i) * 0.002)
    parts.push(stick(a, b, 0.0028, "#3a4a6a"))
    parts.push(ellipsoid(0.011, 0.015, 0.006, b.x, b.y, b.z, "#1a5fd0"))
  }
  return mergeGeometries(parts)
}

const legGeometry = (): THREE.BufferGeometry => mergeGeometries([
  stick(new THREE.Vector3(0, 0.38, 0), new THREE.Vector3(0, 0.02, 0.01), 0.013, "#7d6a58"),
  ellipsoid(0.028, 0.012, 0.075, 0, 0.012, 0.045, "#6c5a4a"),
])

const TRAIN_W = 1024
const TRAIN_H = 512
const FAN = 1.42 // half the fan's spread (rad)

/** The train: rows of overlapping eyed feathers, painted from the tips inward. */
const trainTexture = (): THREE.CanvasTexture => {
  const c = document.createElement("canvas")
  c.width = TRAIN_W
  c.height = TRAIN_H
  const ctx = c.getContext("2d")!
  const rows = 7
  for (let row = rows - 1; row >= 0; row--) {
    const v = 0.2 + (0.8 * (row + 1)) / rows
    const reach = 0.16 + v * 1.25
    const count = Math.max(10, Math.round((reach * 2 * FAN) / 0.082))
    const px = TRAIN_W / count
    const len = (TRAIN_H * 1.5) / rows
    for (let i = 0; i < count; i++) {
      ctx.save()
      ctx.translate(((i + (row % 2 ? 0.5 : 0)) / count) * TRAIN_W, v * TRAIN_H - 2)
      // the feather: fine bronze-green barbs either side of a pale shaft
      const body = ctx.createLinearGradient(0, -len, 0, 0)
      body.addColorStop(0, "#86b03a")
      body.addColorStop(0.7, "#3f9a52")
      body.addColorStop(1, "#a2b64a")
      ctx.fillStyle = body
      ctx.beginPath()
      ctx.ellipse(0, -len / 2, px * 0.66, len / 2, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = "rgba(226, 216, 150, 0.55)"
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.moveTo(0, -len)
      ctx.lineTo(0, 0)
      ctx.stroke()
      // the eye at its tip
      const ex = px * 0.46
      const ey = Math.min(len * 0.2, ex * 1.5)
      const cy = -ey * 1.18
      const ring = (w: number, h: number, colour: string, y = 0): void => {
        ctx.fillStyle = colour
        ctx.beginPath()
        ctx.ellipse(0, cy + y, w, h, 0, 0, Math.PI * 2)
        ctx.fill()
      }
      ring(ex, ey, "#b9892c")
      ring(ex * 0.76, ey * 0.76, "#1f8a5a")
      ring(ex * 0.52, ey * 0.56, "#0d4fc4", ey * 0.08)
      ring(ex * 0.28, ey * 0.32, "#10123c", ey * 0.1)
      ctx.restore()
    }
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.flipY = false
  t.wrapS = THREE.RepeatWrapping
  t.anisotropy = 8
  return t
}

const SPOKES = 30
const RINGS = 10
const vertexCount = (SPOKES + 1) * (RINGS + 1)

const trainGeometry = (): THREE.BufferGeometry => {
  const uv = new Float32Array(vertexCount * 2)
  const index: number[] = []
  for (let s = 0; s <= SPOKES; s++) {
    for (let r = 0; r <= RINGS; r++) {
      const k = s * (RINGS + 1) + r
      uv[k * 2] = s / SPOKES
      uv[k * 2 + 1] = r / RINGS
      if (s < SPOKES && r < RINGS) {
        const b = k + RINGS + 1
        index.push(k, b, k + 1, b, b + 1, k + 1)
      }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3))
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2))
  g.setIndex(index)
  return g
}

/** Blend the train between trailing behind (0) and fanned upright (1). */
const poseTrain = (g: THREE.BufferGeometry, open: number): void => {
  const p = g.attributes.position as THREE.BufferAttribute
  const tilt = 0.2
  for (let s = 0; s <= SPOKES; s++) {
    const side = (s / SPOKES) * 2 - 1
    for (let r = 0; r <= RINGS; r++) {
      const v = r / RINGS
      const k = s * (RINGS + 1) + r
      // folded: a long narrow sweep over the ground
      const fx = side * (0.09 + 0.15 * v)
      const fy = 0.44 - v * 0.4 + 0.02 * (1 - side * side)
      const fz = -0.2 - v * 1.42
      // open: a fan standing behind the bird, cupped a little forward
      const a = side * FAN
      const reach = 0.16 + v * 1.25
      const ox = Math.sin(a) * reach
      const oy = 0.45 + Math.cos(a) * reach * Math.cos(tilt)
      const oz = -0.2 - Math.cos(a) * reach * Math.sin(tilt) + Math.abs(side) * v * 0.16
      p.setXYZ(k, fx + (ox - fx) * open, fy + (oy - fy) * open, fz + (oz - fz) * open)
    }
  }
  p.needsUpdate = true
  g.computeVertexNormals()
  g.computeBoundingSphere()
}

type Bird = {
  x: number; z: number; yaw: number; tx: number; tz: number
  mode: "stand" | "peck" | "walk" | "display"
  timer: number; open: number; shownOpen: number; phase: number; neck: number; cooldown: number
}

const smooth = (v: number): number => v * v * (3 - 2 * v)

export const Peacocks = (): React.ReactElement => {
  const body = useMemo(() => bodyGeometry(), [])
  const neck = useMemo(() => neckGeometry(), [])
  const leg = useMemo(() => legGeometry(), [])
  const skin = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.18 }), [])
  const map = useMemo(() => trainTexture(), [])
  const feathers = useMemo(() => new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, emissive: "#ffffff", emissiveMap: map, emissiveIntensity: 0.16 }), [map])
  const trains = useMemo(() => PEACOCK_HOMES.map(() => {
    const g = trainGeometry()
    poseTrain(g, 0)
    return g
  }), [])
  const birds = useRef<Bird[]>(PEACOCK_HOMES.map((h) => ({
    x: h.x, z: h.z, yaw: h.seed * 2.1, tx: h.x, tz: h.z, mode: "stand" as const, timer: h.seed, open: 0, shownOpen: 0, phase: h.seed * 1.7, neck: 0, cooldown: 0,
  })))
  const roots = useRef<Array<THREE.Group | null>>([])
  const necks = useRef<Array<THREE.Group | null>>([])
  const legs = useRef<Array<[THREE.Mesh | null, THREE.Mesh | null]>>(PEACOCK_HOMES.map(() => [null, null]))

  useEffect(() => () => {
    body.dispose(); neck.dispose(); leg.dispose(); skin.dispose(); feathers.dispose(); map.dispose()
    trains.forEach((g) => g.dispose())
  }, [body, neck, leg, skin, feathers, map, trains])

  useHubFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const t = state.clock.elapsedTime
    birds.current.forEach((b, i) => {
      const home = PEACOCK_HOMES[i]
      const root = roots.current[i]
      const nk = necks.current[i]
      if (!root || !nk) return
      const px = playerRT.pos.x - b.x
      const pz = playerRT.pos.z - b.z
      const near = px * px + pz * pz < 49
      b.cooldown -= dt
      b.timer -= dt
      if (near && b.cooldown <= 0 && b.mode !== "display") {
        b.mode = "display"
        b.timer = 9
        b.cooldown = 30
      }
      if (b.timer <= 0) {
        const roll = Math.abs(Math.sin(t * 12.9898 + b.phase * 78.233)) % 1
        if (b.mode === "display" || roll < 0.42) {
          b.mode = "stand"
          b.timer = 2 + roll * 3
        } else if (roll < 0.7) {
          b.mode = "peck"
          b.timer = 2.4
        } else {
          b.mode = "walk"
          b.timer = 7
          const a = roll * 47
          b.tx = home.x + Math.cos(a) * 2.6
          b.tz = home.z + Math.sin(a) * 2.6
        }
      }
      let moving = false
      if (b.mode === "walk") {
        const dx = b.tx - b.x
        const dz = b.tz - b.z
        const d = Math.hypot(dx, dz)
        if (d < 0.12) b.timer = 0
        else {
          const want = Math.atan2(dx, dz)
          let turn = want - b.yaw
          while (turn > Math.PI) turn -= Math.PI * 2
          while (turn < -Math.PI) turn += Math.PI * 2
          b.yaw += turn * Math.min(1, dt * 2.4)
          if (Math.abs(turn) < 0.5) {
            b.x += (dx / d) * 0.34 * dt
            b.z += (dz / d) * 0.34 * dt
            moving = true
          }
        }
      }
      if (b.mode === "display") {
        // turns to show the fan to whoever came near
        let turn = Math.atan2(px, pz) - b.yaw
        while (turn > Math.PI) turn -= Math.PI * 2
        while (turn < -Math.PI) turn += Math.PI * 2
        b.yaw += turn * Math.min(1, dt * 1.2)
      }
      b.open += ((b.mode === "display" ? 1 : 0) - b.open) * Math.min(1, dt * 1.7)
      const open = smooth(Math.min(1, b.open))
      if (Math.abs(open - b.shownOpen) > 0.002) {
        poseTrain(trains[i], open)
        b.shownOpen = open
      }
      const dip = b.mode === "peck" ? Math.max(0, Math.sin((2.4 - b.timer) * Math.PI * 1.25)) : 0
      b.neck += (dip - b.neck) * Math.min(1, dt * 7)
      const stride = moving ? Math.sin(t * 7 + b.phase) : 0
      nk.rotation.x = 0.1 + b.neck * 1.35 + (moving ? stride * 0.12 : Math.sin(t * 0.9 + b.phase) * 0.03)
      const [left, right] = legs.current[i]
      if (left) left.rotation.x = stride * 0.42
      if (right) right.rotation.x = -stride * 0.42
      root.position.set(b.x, groundHeight(b.x, b.z), b.z)
      root.rotation.y = b.yaw
    })
  })

  return (
    <group name="peacocks" userData={{ dynamic: true }}>
      {PEACOCK_HOMES.map((h, i) => (
        <group key={h.seed} ref={(g) => { roots.current[i] = g }}>
          <mesh geometry={body} material={skin} castShadow />
          <group position={[0, 0.56, 0.2]} ref={(g) => { necks.current[i] = g }}>
            <mesh geometry={neck} material={skin} castShadow />
          </group>
          <mesh geometry={leg} material={skin} position={[-0.06, 0, 0.02]} ref={(m) => { legs.current[i][0] = m }} />
          <mesh geometry={leg} material={skin} position={[0.06, 0, 0.02]} ref={(m) => { legs.current[i][1] = m }} />
          <mesh geometry={trains[i]} material={feathers} castShadow />
        </group>
      ))}
    </group>
  )
}
