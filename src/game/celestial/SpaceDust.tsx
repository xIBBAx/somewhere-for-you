import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { qualityRT } from "../../state/qualityStore"
import { dustAlpha, dustStreak } from "./travelEnvelope"
import { spaceRT, universeDirToLocal } from "./spaceState"

/**
 * Space is never empty or still. Out of the air, ice-dust motes hang round the
 * camera, and faint wisps of nebula drift far off; as the Pegasus sails, the
 * dust streams past her and the wisps slide by more slowly (parallax).
 *
 * Real: the dust and the nebula wisps are where space is thin and dusty
 * (the motes are ice and grit, the wisps are gas clouds, in the right
 * colours). The motion is real too: it is her real speed through the
 * universe (spaceRT.vel, spaceRT.speed), rotated into the view. Their
 * brightness is a painter's choice: they are faint on purpose.
 *
 * Magic: the glints in the dust that catch the starlight, and the colour of
 * the wisps, are Starborn's light.
 *
 * Still, the motes are points. Moving fast they become short streaks whose
 * length follows her speed. Nothing shows in home's air (spaceRT.thin).
 */

const BOX = 160
const WISP_BOX = 600
const MOTE_VERT = /* glsl */ `
attribute vec4 aSeed;
attribute float aEnd;
uniform vec3 uDrift;
uniform vec3 uFlow;
uniform float uLen;
uniform float uBox;
uniform float uAlpha;
varying float vA;
void main() {
  // motes are fixed in the universe: they stream past by the relative drift, wrapped in a box round the camera
  vec3 p = mod(aSeed.xyz * uBox + uDrift, uBox) - uBox * 0.5;
  // the tail trails where the mote came from; still, the streak is a point
  p -= aEnd * uFlow * uLen;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // fade the motes that pass right by the lens: they would swamp the view
  float near = smoothstep(2.0, 14.0, -mv.z);
  vA = uAlpha * aSeed.w * near * mix(1.0, 0.25, aEnd);
}
`
const MOTE_FRAG = /* glsl */ `
varying float vA;
void main() {
  gl_FragColor = vec4(vec3(0.86, 0.91, 1.0) * vA, vA);
}
`

const WISP_VERT = /* glsl */ `
attribute vec4 aW;
uniform vec3 uDrift;
uniform float uPx;
uniform float uBox;
uniform float uAlpha;
varying vec3 vC;
varying float vA;
void main() {
  // far away, so it slides by slowly as she sails (a quarter of the drift)
  vec3 p = mod(position + uDrift * 0.25, uBox) - uBox * 0.5;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aW.w * uPx / max(-mv.z, 1.0), 1.0, 700.0);
  vC = aW.xyz;
  vA = uAlpha * smoothstep(30.0, 140.0, -mv.z);
}
`
const WISP_FRAG = /* glsl */ `
varying vec3 vC;
varying float vA;
float h2(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float n = vn(p * 3.0 + vC.xy * 7.0) * 0.6 + vn(p * 6.0 - vC.z * 5.0) * 0.4;
  float a = (1.0 - smoothstep(0.1, 1.0, r)) * smoothstep(0.35, 0.8, n) * vA;
  gl_FragColor = vec4(vC * a, a);
}
`

type Sys = ReturnType<typeof build>

const build = () => {
  const level = qualityRT.level
  const motes = level === "low" ? 160 : level === "medium" ? 260 : 420
  const wispN = level === "low" ? 3 : level === "medium" ? 5 : 7
  const root = new THREE.Group()
  root.name = "space-dust"
  // motes: a head and a tail per mote, all the motion in the shader
  const seed = new Float32Array(motes * 2 * 4)
  const end = new Float32Array(motes * 2)
  for (let i = 0; i < motes; i++) {
    const s = [Math.random(), Math.random(), Math.random(), 0.35 + 0.65 * Math.random()]
    for (let v = 0; v < 2; v++) { seed.set(s, (i * 2 + v) * 4); end[i * 2 + v] = v }
  }
  const mGeo = new THREE.BufferGeometry()
  mGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(motes * 6), 3))
  mGeo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4))
  mGeo.setAttribute("aEnd", new THREE.BufferAttribute(end, 1))
  const mMat = new THREE.ShaderMaterial({
    vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uDrift: { value: new THREE.Vector3() }, uFlow: { value: new THREE.Vector3(0, 0, 1) }, uLen: { value: 0 }, uBox: { value: BOX }, uAlpha: { value: 0 } },
  })
  const motesMesh = new THREE.LineSegments(mGeo, mMat)
  motesMesh.frustumCulled = false
  motesMesh.renderOrder = 3
  // wisps: a few soft clouds of nebula, far off
  const wGeo = new THREE.BufferGeometry()
  const wPos = new Float32Array(wispN * 3)
  const wW = new Float32Array(wispN * 4)
  for (let i = 0; i < wispN; i++) {
    for (let c = 0; c < 3; c++) wPos[i * 3 + c] = Math.random() * WISP_BOX - WISP_BOX * 0.5
    // hues from the nebula's own palette: rose, violet, cyan and a little gold
    const hue = [[0.9, 0.45, 0.7], [0.6, 0.45, 1.0], [0.4, 0.85, 1.0], [1.0, 0.8, 0.5]][i % 4]
    wW.set([hue[0], hue[1], hue[2], 180 + Math.random() * 260], i * 4)
  }
  wGeo.setAttribute("position", new THREE.BufferAttribute(wPos, 3))
  wGeo.setAttribute("aW", new THREE.BufferAttribute(wW, 4))
  const wMat = new THREE.ShaderMaterial({
    vertexShader: WISP_VERT, fragmentShader: WISP_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uDrift: { value: new THREE.Vector3() }, uPx: { value: 1000 }, uBox: { value: WISP_BOX }, uAlpha: { value: 0 } },
  })
  const wisps = new THREE.Points(wGeo, wMat)
  wisps.frustumCulled = false
  wisps.renderOrder = 2
  root.add(wisps, motesMesh)
  return { root, motesMesh, mGeo, mMat, wisps, wGeo, wMat, drift: new THREE.Vector3(), flow: new THREE.Vector3(0, 0, 1), v: new THREE.Vector3() }
}

const reducedMotion = (): boolean => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

export const SpaceDust = (): React.ReactElement => {
  const reduced = useMemo(() => reducedMotion(), [])
  const sys: Sys = useMemo(() => build(), [])

  useEffect(() => () => {
    sys.mGeo.dispose(); sys.mMat.dispose(); sys.wGeo.dispose(); sys.wMat.dispose()
  }, [sys])

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const thin = spaceRT.thin
    const spd = spaceRT.speed
    const alpha = dustAlpha(spd, thin) * (reduced ? 0.6 : 1)
    sys.root.visible = thin > 0.02
    if (!sys.root.visible) return
    // motion relative to the stars, in the view: where the dust streams from
    sys.v.copy(spaceRT.vel)
    if (sys.v.lengthSq() > 1e-6) universeDirToLocal(sys.v, sys.flow)
    else sys.flow.set(0, 0, 1)
    if (sys.flow.lengthSq() < 1e-8) sys.flow.set(0, 0, 1)
    sys.flow.normalize()
    // the dust drifts against her motion; in the corridor (no velocity: parked), along her forward
    const rate = Math.min(spd, 120) * (reduced ? 0.5 : 1)
    const step = rate * dt
    for (const c of ["x", "y", "z"] as const) {
      sys.drift[c] = (sys.drift[c] - sys.flow[c] * step) % BOX
    }
    sys.root.position.copy(state.camera.position)
    sys.mMat.uniforms.uDrift.value.copy(sys.drift)
    sys.mMat.uniforms.uFlow.value.copy(sys.flow).negate()
    sys.mMat.uniforms.uLen.value = dustStreak(spd) * (reduced ? 0.6 : 1)
    sys.mMat.uniforms.uAlpha.value = alpha
    sys.motesMesh.visible = alpha > 0.002
    // the wisps: a slow parallax of the same flow, and only faintly
    sys.wMat.uniforms.uDrift.value.copy(sys.drift)
    sys.wMat.uniforms.uPx.value = state.size.height * state.camera.projectionMatrix.elements[5] / 2
    sys.wMat.uniforms.uAlpha.value = thin * 0.07 * (reduced ? 0.6 : 1)
    sys.wisps.visible = thin > 0.02
  })

  return <primitive object={sys.root} />
}
