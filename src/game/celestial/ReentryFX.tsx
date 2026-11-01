import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { qualityRT } from "../../state/qualityStore"
import { tiltPivot } from "../horses/riding"
import type { HorseState } from "../horses/horseState"
import { DATUM_Y } from "./scale"
import { travelRT } from "./cosmicTravel"
import { makeStreaks } from "./WarpCorridor"
import { windVisibility, wispVisibility } from "./travelEnvelope"

/**
 * The fall home, through the air over Earth. The glowing plasma sheath is
 * drawn by AscentFX (its heat section reads travelRT.heat), and this file
 * adds what the fall feels like around her.
 *
 * Real: the air really does rush up past a body falling through it, and the
 * wind and the hot air really do stream back along her flight. The wisps are
 * the clouds of home's own sky, drawn as the air they belong to is passed.
 *
 * Magic (Starborn's): the embers streaming off her wings, the warm shimmer
 * round her chest, and the pull-out's calm are Starborn's starlight, not fire.
 * The shimmer is a soft, distorted glow on a shell, not a true screen-space
 * heat haze: it reads as the air bending, without re-sampling the frame.
 *
 * Everything reads travelRT (heat, pull, phase) and her altitude. The wind
 * and embers are the same streak field as the corridor, flowing back along
 * her forward, so the one shader does the motion.
 */

const Z = new THREE.Vector3(0, 0, 1)
const _f = new THREE.Vector3()
const _c = new THREE.Color()

const WISP_VERT = /* glsl */ `
attribute vec4 aW;
uniform float uPhase;
uniform float uPx;
varying float vS;
varying float vH;
void main() {
  // the clouds rush up past her, wrapping in a column round her
  vec3 p = position;
  p.y = mod(p.y + uPhase, 600.0) - 300.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aW.w * uPx / max(-mv.z, 1.0), 1.0, 96.0);
  vS = aW.x;
  vH = aW.y * smoothstep(2.0, 24.0, -mv.z);
}
`
const WISP_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
varying float vS;
varying float vH;
float h2(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  // a torn, wind-stretched wisp: fbm, thinned to the edge, sheared along the rush
  vec2 q = vec2(p.x * 2.0 + vS * 9.0, p.y * 4.0 - uTime * 1.5 + vS * 5.0);
  float n = vn(q) * 0.6 + vn(q * 2.3 + 4.1) * 0.4;
  float a = (1.0 - smoothstep(0.25, 1.0, r)) * smoothstep(0.3, 0.75, n) * uAlpha * vH;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vec3(0.94, 0.96, 1.0), a);
}
`

const SHIMMER_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
/** the warm shimmer round her chest: strongest at the silhouette, rippling slowly, pink-white near the heart */
const SHIMMER_FRAG = /* glsl */ `
uniform float uHeat;
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
void main() {
  float rim = pow(max(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0), 2.0);
  float ripple = 0.75 + 0.25 * sin(uTime * 7.0 + rim * 18.0) * sin(uTime * 3.1 - rim * 9.0);
  vec3 col = mix(vec3(1.0, 0.55, 0.5), vec3(1.0, 0.92, 0.85), rim * 0.3);
  float a = rim * ripple * uHeat * 0.35;
  gl_FragColor = vec4(col * a, a);
}
`

const WISPS = { low: 14, medium: 24, high: 40 } as const

type Sys = ReturnType<typeof build>

const build = () => {
  const level = qualityRT.level
  const root = new THREE.Group()
  root.name = "reentry-fx"
  const wind = makeStreaks(level === "low" ? 360 : level === "medium" ? 600 : 900, 2, 60, new THREE.Color("#e4ecff"))
  const embers = makeStreaks(level === "low" ? 60 : 120, 1.2, 4.5, new THREE.Color("#ffb070"))
  // the wisps: soft points of cloud in a column round her, sized in metres
  const n = WISPS[level]
  const wGeo = new THREE.BufferGeometry()
  const pos = new Float32Array(n * 3)
  const aw = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 160
    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.random() * 600 - 300; pos[i * 3 + 2] = Math.sin(a) * r
    aw.set([Math.random(), Math.random(), 0, 20 + Math.random() * 60], i * 4)
  }
  wGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
  wGeo.setAttribute("aW", new THREE.BufferAttribute(aw, 4))
  const wMat = new THREE.ShaderMaterial({
    vertexShader: WISP_VERT, fragmentShader: WISP_FRAG, transparent: true, depthWrite: false,
    uniforms: { uPhase: { value: 0 }, uPx: { value: 1000 }, uAlpha: { value: 0 }, uTime: { value: 0 } },
  })
  const wisps = new THREE.Points(wGeo, wMat)
  wisps.frustumCulled = false
  wisps.visible = false
  wisps.renderOrder = 4
  const shGeo = new THREE.SphereGeometry(3.2, 24, 16)
  shGeo.scale(1, 1, 2.6)
  const shMat = new THREE.ShaderMaterial({
    vertexShader: SHIMMER_VERT, fragmentShader: SHIMMER_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uHeat: { value: 0 }, uTime: { value: 0 } },
  })
  const shimmer = new THREE.Mesh(shGeo, shMat)
  shimmer.position.z = 1.2
  shimmer.frustumCulled = false
  shimmer.visible = false
  shimmer.renderOrder = 7
  wind.line.renderOrder = 8
  embers.line.renderOrder = 8
  root.add(wind.line, embers.line, shimmer)
  // the wisps live in their own frame: they rush up past her, not with her turn
  const column = new THREE.Group()
  column.add(wisps)
  return { root, column, wind, embers, wisps, wGeo, wMat, shimmer, shGeo, shMat, phase: 0, k: 0, wk: 0, hk: 0 }
}

const reducedMotion = (): boolean => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
const damp = (a: number, b: number, k: number, dt: number): number => a + (b - a) * (1 - Math.exp(-k * dt))

export const ReentryFX = ({ pilot }: { pilot: () => HorseState | null }): React.ReactElement => {
  const reduced = useMemo(() => reducedMotion(), [])
  const sys: Sys = useMemo(() => build(), [])

  useEffect(() => () => {
    sys.wind.line.geometry.dispose(); sys.wind.mat.dispose()
    sys.embers.line.geometry.dispose(); sys.embers.mat.dispose()
    sys.wGeo.dispose(); sys.wMat.dispose()
    sys.shGeo.dispose(); sys.shMat.dispose()
  }, [sys])

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const h = pilot()
    const pull = travelRT.pull
    const heat = sys.hk
    // eased, so the wind and glow fade out after the pull-out rather than cutting
    sys.k = damp(sys.k, travelRT.phase === "reentry" ? windVisibility(pull) : 0, 3, dt)
    sys.hk = damp(sys.hk, travelRT.heat, 3, dt)
    sys.wk = damp(sys.wk, h ? wispVisibility((h.y - DATUM_Y)) * (travelRT.phase === "reentry" ? 1 : 0) : 0, 2, dt)
    const on = !!h && (sys.k > 0.005 || sys.hk > 0.005 || sys.wk > 0.005)
    sys.wind.line.visible = sys.embers.line.visible = on && sys.k > 0.005
    sys.root.visible = on
    sys.column.visible = on && sys.wk > 0.005
    if (!on || !h) return

    // the mount's frame: her forward is +z, and the air streams back past her along -z
    const pitch = h.flight?.pitch ?? 0
    _f.set(Math.sin(h.heading) * Math.cos(pitch), Math.sin(pitch), Math.cos(h.heading) * Math.cos(pitch))
    if (_f.lengthSq() > 1e-6) sys.root.quaternion.setFromUnitVectors(Z, _f.normalize())
    sys.root.position.set(h.x, h.y + tiltPivot(h), h.z)
    const calm = reduced ? 0.5 : 1

    // the wind: the faster the fall and the stronger the pull, the longer the streaks
    const speed = 0.35 + 0.65 * sys.k
    sys.phase = (sys.phase + (300 * speed * (reduced ? 0.5 : 1)) * dt) % 260
    const wu = sys.wind.mat.uniforms
    wu.uPhase.value = sys.phase
    wu.uStretch.value = 2 + 34 * sys.k
    wu.uAlpha.value = 0.55 * sys.k * calm
    wu.uConv.value = 0
    wu.uFall.value = 0
    wu.uColor.value.set("#e4ecff")
    // embers stream back from her wings while the sheath is hot
    const eu = sys.embers.mat.uniforms
    eu.uPhase.value = sys.phase * 1.1
    eu.uStretch.value = 0.5 + 6 * sys.k
    eu.uAlpha.value = Math.min(1, heat * 1.1) * calm
    eu.uConv.value = 0
    eu.uFall.value = 0
    eu.uColor.value.copy(_c.set("#ffb070")).lerp(_c.set("#ffffff"), 0.2 * heat)

    // the shimmer: a faint warm bend round her chest while the air is hot
    sys.shimmer.visible = heat > 0.005
    sys.shMat.uniforms.uHeat.value = heat * calm
    sys.shMat.uniforms.uTime.value = state.clock.elapsedTime

    // the clouds below ~15 km rush up past her
    sys.wisps.visible = sys.wk > 0.005
    sys.wMat.uniforms.uPhase.value = sys.phase * 1.4
    sys.wMat.uniforms.uTime.value = state.clock.elapsedTime
    sys.wMat.uniforms.uAlpha.value = 0.55 * sys.wk * calm
    sys.wMat.uniforms.uPx.value = state.size.height * state.camera.projectionMatrix.elements[5] / 2
    sys.column.position.set(h.x, h.y + tiltPivot(h), h.z)
  })

  return (
    <>
      <primitive object={sys.root} />
      <primitive object={sys.column} />
    </>
  )
}
