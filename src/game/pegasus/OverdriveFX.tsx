import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { qualityRT } from "../../state/qualityStore"
import { useGame } from "../../state/gameStore"
import { ridingCelestial } from "../celestial/CelestialController"
import { spaceRT } from "../celestial/spaceState"
import { solarVisibility } from "../environment/celestialLighting"
import { worldRT } from "../runtime"
import { waterSurfaceAt } from "../../world/waterSurface"
import { groundHeight } from "../world-layout"
import { climbMistRT } from "./ClimbMistFX"
import { flightReducedMotion } from "./flightCamera"
import { overdriveRT, syncOverdrive } from "./overdrive"
import { names } from "../../personalization"

/**
 * Starborn's overdrive, seen in the air around her (overdrive.ts says why each
 * answer is the air's own):
 *
 *   streaks   the air itself, made visible by her speed: thin lines of
 *             moisture and light standing still in the world, so she tears
 *             past them (their length is the distance she covers in a
 *             blink). Whiter and thicker in a cloud, sea-blue low over the
 *             water, faint and silver at night.
 *   cone      a vapour cone round her chest at the onset, the air's moisture
 *             wrung out by the pressure (as round a jet going through the
 *             barrier), lingering faintly in wet air.
 *   spray     low over water, a rooster tail of white spray thrown up where
 *             she has just been, left standing behind her.
 *
 * Only for the active rider's own mount (Starborn: only she has an overdrive),
 * only in the air (on the sails, the sky's starbow and the space dust answer).
 * Every effect writes no alpha (additive light, so ambient occlusion never
 * treats it as cover). Fixed pools; nothing allocates per frame.
 */

const STREAKS = 240
const SPRAY = 360

const STREAK_VERT = /* glsl */ `
attribute vec3 aCentre;
attribute float aSeed;
uniform vec3 uAxis;
uniform vec3 uCam;
uniform float uLen;
uniform float uWidth;
varying vec2 vUv;
varying float vSeed;
varying float vFade;
void main() {
  vec3 c = aCentre;
  vec3 world = (modelMatrix * vec4(c, 1.0)).xyz;
  vec3 toCam = normalize(uCam - world);
  vec3 side = normalize(cross(uAxis, toCam));
  float len = uLen * (0.55 + 0.9 * fract(aSeed * 7.13));
  float wid = uWidth * (0.6 + 0.8 * fract(aSeed * 3.71));
  vec3 p = c + uAxis * (uv.x - 0.5) * len + side * (uv.y - 0.5) * wid;
  vUv = uv;
  vSeed = aSeed;
  float d = distance(uCam, world);
  // never across the riders or the lens: they fade in from a few metres out
  vFade = smoothstep(4.0, 11.0, d) * (1.0 - smoothstep(140.0, 220.0, d));
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
}
`
const STREAK_FRAG = /* glsl */ `
uniform vec3 uCol;
uniform float uA;
varying vec2 vUv;
varying float vSeed;
varying float vFade;
void main() {
  float across = 1.0 - abs(vUv.y * 2.0 - 1.0);
  float along = sin(3.14159 * vUv.x);
  // brightest at the leading end, as a trace of something already passed
  float a = uA * vFade * across * across * along * mix(0.45, 1.0, vUv.x) * (0.5 + 0.5 * fract(vSeed * 13.7));
  // a few of them catch her light: a faint cyan or violet in the air she tears through
  float k = fract(vSeed * 5.31);
  vec3 tint = k < 0.18 ? vec3(0.62, 0.92, 1.1) : k < 0.32 ? vec3(0.85, 0.7, 1.1) : vec3(1.0);
  gl_FragColor = vec4(uCol * tint * a, 0.0);
}
`
const CONE_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying float vY;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - w.xyz);
  vY = uv.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
const CONE_FRAG = /* glsl */ `
uniform vec3 uCol;
uniform float uA;
uniform float uT;
varying vec3 vN;
varying vec3 vV;
varying float vY;
void main() {
  // seen edge-on the shell is thickest: a soft rim, banded as the moisture condenses
  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6);
  float bands = 0.65 + 0.35 * sin(vY * 22.0 - uT * 30.0);
  float a = uA * rim * bands * smoothstep(0.0, 0.25, vY) * (1.0 - smoothstep(0.7, 1.0, vY));
  gl_FragColor = vec4(uCol * a, 0.0);
}
`
const SPRAY_VERT = /* glsl */ `
attribute float aLife;
attribute float aSize;
uniform float uScale;
varying float vLife;
void main() {
  vLife = aLife;
  vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.0);
  gl_PointSize = aLife > 0.0 ? aSize * uScale / max(1.0, -mv.z) : 0.0;
  gl_Position = projectionMatrix * mv;
}
`
const SPRAY_FRAG = /* glsl */ `
uniform vec3 uCol;
uniform float uA;
varying float vLife;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = dot(q, q);
  if (r > 1.0 || vLife <= 0.0) discard;
  float a = uA * (1.0 - r) * smoothstep(0.0, 0.25, vLife) * vLife;
  gl_FragColor = vec4(uCol * a, 0.0);
}
`

const additive = { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor } as const

const makeSystem = () => {
  const root = new THREE.Group()
  root.name = "starborn-overdrive"
  root.frustumCulled = false
  // streaks: one instanced quad
  const quad = new THREE.PlaneGeometry(1, 1)
  const sg = new THREE.InstancedBufferGeometry()
  sg.index = quad.index
  sg.setAttribute("position", quad.getAttribute("position"))
  sg.setAttribute("uv", quad.getAttribute("uv"))
  const centres = new Float32Array(STREAKS * 3)
  const seeds = new Float32Array(STREAKS)
  for (let i = 0; i < STREAKS; i++) seeds[i] = Math.random()
  const cAttr = new THREE.InstancedBufferAttribute(centres, 3)
  cAttr.setUsage(THREE.DynamicDrawUsage)
  sg.setAttribute("aCentre", cAttr)
  sg.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1))
  sg.instanceCount = 0
  const sMat = new THREE.ShaderMaterial({
    vertexShader: STREAK_VERT, fragmentShader: STREAK_FRAG, ...additive, side: THREE.DoubleSide,
    uniforms: { uAxis: { value: new THREE.Vector3(0, 0, 1) }, uCam: { value: new THREE.Vector3() }, uLen: { value: 6 }, uWidth: { value: 0.06 }, uCol: { value: new THREE.Color() }, uA: { value: 0 } },
  })
  const streaks = new THREE.Mesh(sg, sMat)
  streaks.frustumCulled = false
  root.add(streaks)
  // the vapour cone: an open shell along her path, its narrow end at her chest
  const cg = new THREE.CylinderGeometry(1, 0.18, 1, 28, 1, true)
  cg.translate(0, -0.5, 0)
  const cMat = new THREE.ShaderMaterial({ vertexShader: CONE_VERT, fragmentShader: CONE_FRAG, ...additive, side: THREE.DoubleSide, uniforms: { uCol: { value: new THREE.Color("#eef4ff") }, uA: { value: 0 }, uT: { value: 0 } } })
  const cone = new THREE.Mesh(cg, cMat)
  cone.frustumCulled = false
  cone.visible = false
  root.add(cone)
  // spray: points standing in the world where she threw them up
  const pg = new THREE.BufferGeometry()
  const pos = new Float32Array(SPRAY * 3), vel = new Float32Array(SPRAY * 3), life = new Float32Array(SPRAY), size = new Float32Array(SPRAY)
  const pAttr = new THREE.BufferAttribute(pos, 3), lAttr = new THREE.BufferAttribute(life, 1)
  pAttr.setUsage(THREE.DynamicDrawUsage); lAttr.setUsage(THREE.DynamicDrawUsage)
  pg.setAttribute("position", pAttr); pg.setAttribute("aLife", lAttr); pg.setAttribute("aSize", new THREE.BufferAttribute(size, 1))
  const pMat = new THREE.ShaderMaterial({ vertexShader: SPRAY_VERT, fragmentShader: SPRAY_FRAG, ...additive, uniforms: { uCol: { value: new THREE.Color("#e8f6ff") }, uA: { value: 0.5 }, uScale: { value: 400 } } })
  const spray = new THREE.Points(pg, pMat)
  spray.frustumCulled = false
  spray.visible = false
  root.add(spray)
  return {
    root, streaks, sg, sMat, centres, cAttr, cone, cMat, spray, pg, pMat, pos, vel, life, size, pAttr, lAttr,
    anchor: new THREE.Vector3(), seeded: false, told: false, coneT: 9, wasOn: false, sprayAcc: 0, nextSpray: 0, frame: "", t: 0,
  }
}
type Sys = ReturnType<typeof makeSystem>

const _cam = new THREE.Vector3(), _fwd = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _y = new THREE.Vector3(0, 1, 0)
const _col = new THREE.Color(), WHITE = new THREE.Color("#f4f8ff"), SEA = new THREE.Color("#bfe8f2"), NIGHT = new THREE.Color("#9fb4d8")
const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

/** a streak somewhere in the tube of air ahead of the view (relative to the anchor) */
const placeStreak = (sys: Sys, i: number, near: number, far: number, low: number | null): void => {
  const along = near + Math.random() * (far - near)
  // a disc across the path: a ring of radii so the middle (her) stays clear
  const r = 5 + Math.pow(Math.random(), 0.7) * 34, a = Math.random() * Math.PI * 2
  _a.set(1, 0, 0)
  if (Math.abs(_fwd.y) < 0.95) _a.crossVectors(_fwd, _y).normalize()
  _b.crossVectors(_a, _fwd).normalize()
  let x = _cam.x + _fwd.x * along + (_a.x * Math.cos(a) + _b.x * Math.sin(a)) * r
  let y = _cam.y + _fwd.y * along + (_a.y * Math.cos(a) + _b.y * Math.sin(a)) * r
  let z = _cam.z + _fwd.z * along + (_a.z * Math.cos(a) + _b.z * Math.sin(a)) * r
  // low over water half of them skim it, where the spray and the wind lie
  if (low !== null && Math.random() < 0.5) y = low + 0.4 + Math.random() * 3
  // never under the land
  const g = groundHeight(x, z) + 0.6
  if (y < g) y = g + Math.random() * 4
  x -= sys.anchor.x; y -= sys.anchor.y; z -= sys.anchor.z
  sys.centres[i * 3] = x; sys.centres[i * 3 + 1] = y; sys.centres[i * 3 + 2] = z
}

const frame = (sys: Sys, camera: THREE.Camera, dt: number, viewHeight: number): void => {
  sys.t += dt
  const h = ridingCelestial()
  syncOverdrive(h, camera, dt)
  const f = h?.flight
  const level = overdriveRT.level
  // the first time, once: what has just happened, and how to let it go
  if (level > 0.6 && !sys.told) { sys.told = true; useGame.getState().showHint(`${names.starborn}'s overdrive. Keep Shift held and steer; let go and she coasts.`) }
  const quality = qualityRT.level
  const calm = flightReducedMotion()
  const inAir = !!h && !!f && f.mode === "air" && spaceRT.mode !== "deep" && spaceRT.realm === "earth" && spaceRT.thin < 0.35
  // a change of frame moves everything at once: start again
  const key = `${spaceRT.mode}:${spaceRT.realm}`
  if (key !== sys.frame) { sys.frame = key; sys.seeded = false; sys.life.fill(0) }
  _cam.copy(camera.position)
  // re-anchor near the view so the pool's numbers stay small (positions are kept in the world)
  if (_cam.distanceTo(sys.anchor) > 400 || !sys.seeded) {
    const dx = Math.round(_cam.x) - sys.anchor.x, dy = Math.round(_cam.y) - sys.anchor.y, dz = Math.round(_cam.z) - sys.anchor.z
    sys.anchor.set(Math.round(_cam.x), Math.round(_cam.y), Math.round(_cam.z))
    for (let i = 0; i < STREAKS; i++) { sys.centres[i * 3] -= dx; sys.centres[i * 3 + 1] -= dy; sys.centres[i * 3 + 2] -= dz }
    for (let i = 0; i < SPRAY; i++) { sys.pos[i * 3] -= dx; sys.pos[i * 3 + 1] -= dy; sys.pos[i * 3 + 2] -= dz }
  }
  sys.root.position.copy(sys.anchor)
  _fwd.copy(overdriveRT.dir)
  const speed = overdriveRT.speed
  const water = h ? waterSurfaceAt(h.x, h.z) : null
  const overWater = water !== null && !!f && h!.y - water < 18 && water > groundHeight(h!.x, h!.z) + 0.3
  const wet = climbMistRT.wet
  const day = solarVisibility(worldRT.timeOfDay)

  // ---- streaks
  const show = inAir && level > 0.02
  const count = quality === "low" ? 90 : quality === "medium" ? 170 : STREAKS
  sys.streaks.visible = show
  if (show) {
    if (!sys.seeded) { for (let i = 0; i < STREAKS; i++) placeStreak(sys, i, 6, 200, overWater ? water : null); sys.seeded = true }
    // a streak she has passed (behind the view), or one left far off by a turn, starts again ahead
    for (let i = 0; i < count; i++) {
      const x = sys.centres[i * 3] + sys.anchor.x - _cam.x, y = sys.centres[i * 3 + 1] + sys.anchor.y - _cam.y, z = sys.centres[i * 3 + 2] + sys.anchor.z - _cam.z
      const along = x * _fwd.x + y * _fwd.y + z * _fwd.z
      if (along < -4 || x * x + y * y + z * z > 230 * 230) placeStreak(sys, i, 60, 210, overWater ? water : null)
    }
    sys.cAttr.needsUpdate = true
    sys.sg.instanceCount = count
    const u = sys.sMat.uniforms
    u.uAxis.value.copy(_fwd)
    u.uCam.value.copy(_cam)
    // the length is how far she goes in a sixtieth of a second, held a little longer in the eye
    u.uLen.value = Math.min(22, Math.max(2, speed * 0.075)) * (0.4 + 0.6 * level)
    u.uWidth.value = 0.05 + 0.09 * wet
    _col.copy(overWater ? SEA : WHITE).lerp(NIGHT, 1 - day)
    u.uCol.value.copy(_col)
    u.uA.value = level * (0.42 + 0.5 * wet) * (0.5 + 0.5 * day) * (calm ? 0.5 : 1)
  }

  // ---- the vapour cone: at the onset, and faintly while the air is wet
  const on = level > 0.35
  if (on && !sys.wasOn && inAir) sys.coneT = 0
  sys.wasOn = on
  sys.coneT += dt
  const onset = sys.coneT < 0.9 ? Math.sin(Math.PI * Math.min(1, sys.coneT / 0.9)) : 0
  const linger = on ? Math.max(wet, overWater ? 0.4 : 0) * 0.35 : 0
  // (only where the air is wet enough to condense: in dry air a shell round the riders read as a bubble)
  const coneA = inAir && quality !== "low" ? Math.max(onset * smooth(0.15, 0.6, wet), linger) * (calm ? 0.4 : 1) : 0
  sys.cone.visible = coneA > 0.01
  if (sys.cone.visible && h) {
    const r = (h.model?.meta.wing?.semi ?? 3.2) * (0.75 + 0.35 * Math.min(1, sys.coneT / 0.9))
    // its narrow end just ahead of her chest, opening back along her path over the riders
    sys.cone.position.set(h.x + _fwd.x * 1.8 - sys.anchor.x, h.y + h.jumpY + 1.2 + _fwd.y * 1.8 - sys.anchor.y, h.z + _fwd.z * 1.8 - sys.anchor.z)
    sys.cone.quaternion.copy(_q.setFromUnitVectors(_y, _fwd))
    sys.cone.scale.set(r, 3.4 + speed * 0.02, r)
    sys.cMat.uniforms.uA.value = coneA * 0.42 * (0.55 + 0.45 * day)
    sys.cMat.uniforms.uT.value = sys.t
  }

  // ---- spray off the water: thrown up where she has been, and left there
  const spraying = inAir && overWater && level > 0.2 && quality !== "low" && !!h && !!f
  if (spraying) {
    const height = h!.y - water!
    const rate = 900 * level * (1 - smooth(4, 18, height)) * (calm ? 0.4 : 1)
    sys.sprayAcc += rate * dt
    while (sys.sprayAcc >= 1) {
      sys.sprayAcc -= 1
      const i = sys.nextSpray
      sys.nextSpray = (sys.nextSpray + 1) % SPRAY
      const back = Math.random() * speed * dt * 2, side = (Math.random() - 0.5) * 4
      sys.pos[i * 3] = h!.x - _fwd.x * back + _fwd.z * side - sys.anchor.x
      sys.pos[i * 3 + 1] = water! + 0.1 - sys.anchor.y
      sys.pos[i * 3 + 2] = h!.z - _fwd.z * back - _fwd.x * side - sys.anchor.z
      // up and out to both sides, a little of her speed carried along
      sys.vel[i * 3] = _fwd.z * side * 1.6 + _fwd.x * speed * 0.08
      sys.vel[i * 3 + 1] = 3 + Math.random() * 7 * (1 - smooth(2, 18, height) * 0.6)
      sys.vel[i * 3 + 2] = -_fwd.x * side * 1.6 + _fwd.z * speed * 0.08
      sys.life[i] = 1
      sys.size[i] = 0.5 + Math.random() * 1.3
    }
  }
  let alive = false
  for (let i = 0; i < SPRAY; i++) {
    if (sys.life[i] <= 0) continue
    alive = true
    sys.life[i] -= dt / 1.4
    sys.vel[i * 3 + 1] -= 9.8 * dt
    sys.vel[i * 3] *= 1 - 1.2 * dt; sys.vel[i * 3 + 2] *= 1 - 1.2 * dt
    sys.pos[i * 3] += sys.vel[i * 3] * dt
    sys.pos[i * 3 + 1] += sys.vel[i * 3 + 1] * dt
    sys.pos[i * 3 + 2] += sys.vel[i * 3 + 2] * dt
  }
  sys.spray.visible = alive
  if (alive) {
    sys.pAttr.needsUpdate = true; sys.lAttr.needsUpdate = true
    sys.pg.attributes.aSize.needsUpdate = true
    sys.pMat.uniforms.uA.value = 0.42 * (0.5 + 0.5 * day)
    // a point's size in pixels per metre at one metre away: the drawing buffer's height over the view's height
    const fov = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera).fov : 50
    sys.pMat.uniforms.uScale.value = viewHeight / (2 * Math.tan((fov * Math.PI) / 360))
  }
}

export const OverdriveFX = (): React.ReactElement => {
  const sys = useMemo(() => makeSystem(), [])
  useEffect(() => () => {
    sys.sg.dispose(); sys.sMat.dispose(); sys.cone.geometry.dispose(); sys.cMat.dispose(); sys.pg.dispose(); sys.pMat.dispose()
  }, [sys])
  useFrame((state, rawDt) => frame(sys, state.camera, Math.min(rawDt, 0.05), state.gl.domElement.height))
  return <primitive object={sys.root} />
}
