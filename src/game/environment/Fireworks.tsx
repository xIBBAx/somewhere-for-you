import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { makeRng, smoothstep } from "../../utils/math"
import { avatarRT, cameraRT, worldRT } from "../runtime"
import { spaceRT } from "../celestial/spaceState"
import { weatherRT } from "../weather/weatherState"
import { LIGHT_BLENDING } from "../render/lightBlending"
import { nightBlend } from "./celestialLighting"
import { registerDevTool } from "../../dev/devTools"
import { useGame } from "../../state/gameStore"
import { isCelebrationDay, story } from "../../content/story"
import { syncWorldTimeToClimate } from "../weather/WeatherController"

/**
 * Fireworks, in light only (the world keeps its one music track).
 *
 * They open over the finale garden when the closing card is set down, and on
 * the gift's celebration day (personalization `occasion`) they fill every
 * evening and night sky at home. Shells climb on a faint spark, then burst as
 * peonies, rings, willows that hang and drift, crackling chrysanthemums, and
 * now and then a heart; each burst washes the meadow in its colour for a
 * moment. Fired across the part of the sky she is looking at, a few hundred
 * metres out, never through a storm or out in space.
 */

/** the finale's volley lasts this long after the closing card is set down (s) */
const FINALE_SHOW = 90
const CAPACITY = 3200
const look = new THREE.Vector3()
const PALETTE = ["#ff8fb8", "#ffd27a", "#c9a7ff", "#8ff0d0", "#fff1dc", "#ff9f7a", "#9fd0ff"].map((c) => new THREE.Color(c))

type Kind = "peony" | "ring" | "willow" | "crackle" | "heart"
type Spark = { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; r: number; g: number; b: number; size: number; drag: number; fall: number; twinkle: number; trail: boolean }
type Shell = { x: number; y: number; z: number; vx: number; vy: number; vz: number; fuse: number; kind: Kind; color: THREE.Color; color2: THREE.Color }

/** QA (`?debug`): live counts, and what keeps the show running */
export const fireworksRT = { flash: 0, flashColor: new THREE.Color(), shells: 0, sparks: 0, forced: false }

const VERTEX = /* glsl */ `
attribute float size;
attribute vec3 color;
uniform float uScale;
varying vec3 vColor;
void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.5, size * uScale / -mv.z);
  gl_Position = projectionMatrix * mv;
}`

const FRAGMENT = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float r2 = dot(p, p) * 4.0;
  if (r2 > 1.0) discard;
  // a hot white core inside a soft coloured glow
  float glow = exp(-r2 * 5.0);
  vec3 c = vColor * glow + vec3(1.0, 0.96, 0.9) * exp(-r2 * 26.0) * dot(vColor, vec3(0.3));
  gl_FragColor = vec4(c, 0.0);
  // added as light, untouched: tone mapping and encoding each addend on the
  // Balanced and Light presets washed the colours out to white
}`

export const Fireworks = (): React.ReactElement => {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const rng = useMemo(() => makeRng(41126), [])
  const sparks = useRef<Spark[]>([])
  const shells = useRef<Shell[]>([])
  const clock = useRef({ next: 1.5, finaleStart: -1, elapsed: 0, celebrationCheck: 0, celebration: isCelebrationDay(), announced: false, finaleReleased: false })
  const { geometry, material, positions, colors, sizes } = useMemo(() => {
    const positions = new Float32Array(CAPACITY * 3)
    const colors = new Float32Array(CAPACITY * 3)
    const sizes = new Float32Array(CAPACITY)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage))
    geometry.setDrawRange(0, 0)
    const material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      ...LIGHT_BLENDING,
    })
    return { geometry, material, positions, colors, sizes }
  }, [])
  const points = useRef<THREE.Points>(null)
  const size = useMemo(() => new THREE.Vector2(), [])
  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])
  useEffect(() => registerDevTool("fireworks", ((on?: boolean) => {
    if (on !== undefined) fireworksRT.forced = on
    return { forced: fireworksRT.forced, shells: fireworksRT.shells, sparks: fireworksRT.sparks, celebration: clock.current.celebration }
  }) as never), [])

  const launch = (): void => {
    const p = avatarRT().pos
    // across the part of the sky she is facing
    const fwd = Math.atan2(camera.position.x - p.x, camera.position.z - p.z) + Math.PI
    const az = fwd + (rng() - 0.5) * 1.6
    const dist = 150 + rng() * 110
    const x = p.x + Math.sin(az) * dist, z = p.z + Math.cos(az) * dist
    // burst in the band of sky the view actually holds, below its top edge
    camera.getWorldDirection(look)
    const cam = camera as THREE.PerspectiveCamera
    const top = Math.asin(THREE.MathUtils.clamp(look.y, -1, 1)) + THREE.MathUtils.degToRad((cam.fov ?? 40) / 2)
    // clear of the treeline; if the view holds little sky she has been told to look up
    const deg = THREE.MathUtils.degToRad
    const elev = top > deg(20)
      ? THREE.MathUtils.clamp(top - deg(4 + rng() * 12), deg(13), deg(40))
      : deg(14 + rng() * 12)
    const height = Math.max(30, camera.position.y - p.y + dist * Math.tan(elev))
    const climb = 1.6 + rng() * 0.6
    const roll = rng()
    const kind: Kind = roll < 0.12 ? "heart" : roll < 0.3 ? "ring" : roll < 0.48 ? "willow" : roll < 0.64 ? "crackle" : "peony"
    const color = PALETTE[Math.floor(rng() * PALETTE.length)]
    const color2 = PALETTE[Math.floor(rng() * PALETTE.length)]
    const g = 9.8
    // launched to arrive at its height just as the climb ends
    const vy = height / climb + 0.5 * g * climb
    shells.current.push({ x, y: p.y - 4, z, vx: (rng() - 0.5) * 3, vy, vz: (rng() - 0.5) * 3, fuse: climb, kind, color, color2 })
  }

  const spark = (s: Omit<Spark, "age">): void => {
    if (sparks.current.length >= CAPACITY) sparks.current.shift()
    sparks.current.push({ ...s, age: 0 })
  }

  const burst = (sh: Shell): void => {
    const n = sh.kind === "heart" ? 120 : sh.kind === "ring" ? 90 : sh.kind === "willow" ? 110 : 150
    const speed = sh.kind === "willow" ? 21 : sh.kind === "heart" ? 1 : 28 + rng() * 9
    // a ring and a heart face the one watching
    const toEye = new THREE.Vector3(camera.position.x - sh.x, 0, camera.position.z - sh.z).normalize()
    const right = new THREE.Vector3(toEye.z, 0, -toEye.x)
    const tiltUp = new THREE.Vector3(0, 1, 0)
    const ringAxisA = right.clone(), ringAxisB = tiltUp.clone().multiplyScalar(0.55).addScaledVector(toEye, 0.84).normalize()
    for (let i = 0; i < n; i++) {
      let vx: number, vy: number, vz: number
      if (sh.kind === "heart") {
        const t = (i / n) * Math.PI * 2
        const hx = 16 * Math.pow(Math.sin(t), 3)
        const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
        const k = 1.9
        vx = right.x * hx * k; vz = right.z * hx * k; vy = hy * k + 4
      } else if (sh.kind === "ring") {
        const t = (i / n) * Math.PI * 2
        const a = Math.cos(t) * speed, b = Math.sin(t) * speed
        vx = ringAxisA.x * a + ringAxisB.x * b; vy = ringAxisA.y * a + ringAxisB.y * b; vz = ringAxisA.z * a + ringAxisB.z * b
      } else {
        // an even sphere of stars (golden-angle spiral), each a little different
        const yy = 1 - (2 * (i + 0.5)) / n
        const rr = Math.sqrt(1 - yy * yy)
        const th = i * 2.399963
        const s = speed * (0.88 + rng() * 0.24)
        vx = Math.cos(th) * rr * s; vy = yy * s; vz = Math.sin(th) * rr * s
      }
      const c = sh.kind === "peony" && i % 2 ? sh.color2 : sh.color
      const willow = sh.kind === "willow"
      const hot = willow ? 1.9 : 2.6
      spark({
        x: sh.x, y: sh.y, z: sh.z, vx: vx + sh.vx * 0.3, vy: vy + sh.vy * 0.1, vz: vz + sh.vz * 0.3,
        life: willow ? 3.6 + rng() * 0.8 : sh.kind === "heart" ? 2.6 : 2 + rng() * 0.7,
        r: (willow ? 1 : c.r) * hot, g: (willow ? 0.78 : c.g) * hot, b: (willow ? 0.45 : c.b) * hot,
        size: willow ? 2.7 : 3.3, drag: willow ? 1.15 : sh.kind === "heart" ? 1.6 : 1.45, fall: willow ? 4.2 : 6.5,
        twinkle: sh.kind === "crackle" ? 1 : 0, trail: willow,
      })
    }
    fireworksRT.flash = Math.min(1, fireworksRT.flash + 0.7)
    fireworksRT.flashColor.copy(sh.color)
  }

  useFrame((_, rawDt) => {
    const dt = Math.min(Math.max(rawDt, 1e-4), 0.1)
    const c = clock.current
    c.elapsed += dt
    // the calendar is checked now and then (a session can run past midnight)
    if ((c.celebrationCheck -= dt) <= 0) { c.celebrationCheck = 30; c.celebration = isCelebrationDay() }
    const night = nightBlend(worldRT.timeOfDay)
    const dusk = smoothstep(0.74, 0.86, worldRT.timeOfDay)
    // the finale's volley begins as the closing card is set down and the
    // view returns to the sky (the finale's own camera looks down on the garden)
    if (c.finaleStart < 0 && worldRT.finaleActive && worldRT.finalePhase >= 5 && !useGame.getState().finaleMessage) {
      c.finaleStart = c.elapsed
      // and the view lifts gently from the garden to the sky (hers to move again at once)
      cameraRT.targetPitch = Math.min(cameraRT.targetPitch, -0.16)
    }
    const finale = c.finaleStart >= 0 && c.elapsed - c.finaleStart < FINALE_SHOW
    // the evening holds at the blue hour while the show lasts, then the clock takes the sky back
    if (finale) worldRT.timeOfDayTarget = Math.max(worldRT.timeOfDayTarget, 0.88)
    else if (c.finaleStart >= 0 && !c.finaleReleased) { c.finaleReleased = true; syncWorldTimeToClimate() }
    const clearSky = weatherRT.rain < 0.6 && weatherRT.burst < 0.1
    const home = spaceRT.realm === "earth" && spaceRT.skyAltitude < 400
    const show = home && clearSky && (finale || fireworksRT.forced || (c.celebration && Math.max(night, dusk) > 0.4))

    if (show) {
      // the celebration evening says so once (the finale has its own words)
      if (!finale && !c.announced && !worldRT.finaleActive) {
        c.announced = true
        useGame.getState().showHint(story.fireworksHint)
      }
      c.next -= dt
      if (c.next <= 0) {
        launch()
        // now and then a few go up together
        if (rng() < 0.28) launch()
        c.next = finale ? 0.7 + rng() * 1.3 : 1.4 + rng() * 2.6
      }
    } else c.next = Math.min(c.next, 1.2)

    // shells climbing, shedding a faint spark
    for (let i = shells.current.length - 1; i >= 0; i--) {
      const sh = shells.current[i]
      sh.vy -= 9.8 * dt
      sh.x += sh.vx * dt; sh.y += sh.vy * dt; sh.z += sh.vz * dt
      sh.fuse -= dt
      if (rng() < 0.6) spark({ x: sh.x, y: sh.y, z: sh.z, vx: (rng() - 0.5) * 1.2, vy: -2 - rng() * 2, vz: (rng() - 0.5) * 1.2, life: 0.5 + rng() * 0.3, r: 1.6, g: 1.2, b: 0.8, size: 1.6, drag: 2, fall: 3, twinkle: 0, trail: false })
      if (sh.fuse <= 0) {
        burst(sh)
        shells.current.splice(i, 1)
      }
    }

    // the stars of each burst: drag, gravity, a long fade, some crackle out
    let n = 0
    const list = sparks.current
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i]
      s.age += dt
      if (s.age >= s.life) { list[i] = list[list.length - 1]; list.pop(); continue }
      const d = Math.exp(-s.drag * dt)
      s.vx *= d; s.vy = s.vy * d - s.fall * dt; s.vz *= d
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt
      if (s.trail && rng() < 0.08 && list.length < CAPACITY - 8) {
        list.push({ ...s, vx: 0, vy: -0.6, vz: 0, age: 0, life: 0.9, size: s.size * 0.7, r: s.r * 0.6, g: s.g * 0.5, b: s.b * 0.4, trail: false })
      }
    }
    for (const s of list) {
      if (n >= CAPACITY) break
      const k = s.age / s.life
      let fade = (1 - smoothstep(0.55, 1, k)) * (0.6 + 0.4 * (1 - k))
      if (s.twinkle > 0 && k > 0.45) fade *= Math.random() < 0.5 ? 1.6 : 0.08
      positions[n * 3] = s.x; positions[n * 3 + 1] = s.y; positions[n * 3 + 2] = s.z
      colors[n * 3] = s.r * fade; colors[n * 3 + 1] = s.g * fade; colors[n * 3 + 2] = s.b * fade
      sizes[n] = s.size * (s.twinkle > 0 && k > 0.45 ? 0.8 : 1)
      n++
    }
    geometry.setDrawRange(0, n)
    if (n > 0) {
      geometry.attributes.position.needsUpdate = true
      geometry.attributes.color.needsUpdate = true
      geometry.attributes.size.needsUpdate = true
      geometry.computeBoundingSphere()
    }
    gl.getDrawingBufferSize(size)
    material.uniforms.uScale.value = size.y * 0.5 / Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov ?? 40) / 2)
    if (points.current) points.current.visible = n > 0
    fireworksRT.flash = Math.max(0, fireworksRT.flash - dt * 2.2)
    fireworksRT.shells = shells.current.length
    fireworksRT.sparks = n
  })

  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} renderOrder={-2} visible={false} />
}
