import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { qualityRT } from "../../state/qualityStore"
import { tiltPivot } from "../horses/riding"
import type { HorseState } from "../horses/horseState"
import { travelRT } from "./cosmicTravel"
import { updateTravelSound } from "./travelAudio"
import { corridorFovBoost, nebulaCount, nebulaMoment, warpBloom, warpPhaseRate, warpSpeed } from "./travelEnvelope"

/**
 * What the explorer sees around Starborn on a journey between worlds.
 *
 * The journey's real spectacle is the sky itself: at the height of the run
 * the true stars and the Milky Way crowd forward into a blazing, colour-banded
 * cone ahead and fall dim and red behind (render/aberration.ts, driven by
 * travelRT.beta). This file adds what is close to her:
 *
 * - stardust: sparse motes through a box of space, streaking past with
 *   parallax (not a tube), so the near and the far read as depth;
 * - nebula banks: two or three clouds of glowing gas, in real emission-line
 *   colours, that she runs through at set moments, so a long journey has
 *   landmarks and a rhythm;
 * - her envelope: a soft rim of light that hugs her while she is fast;
 * - her heart: the light gathering in her chest before the launch;
 * - a ring of light, square to her course, at the launch and the arrival.
 *
 * Calm by design: no strobing, the flash never more than a third strong;
 * under reduced motion everything is quieter, sparser and slower.
 *
 * Everything reads travelRT. The mount's frame is her forward (+z).
 */

const LZ = 260
const Z = new THREE.Vector3(0, 0, 1)
const _f = new THREE.Vector3()
const _roll = new THREE.Quaternion()
const _axis = new THREE.Vector3(0, 0, 1)
const WHITE = new THREE.Color("#ffffff")
const _tint = new THREE.Color()
/** the destination's light as a colour (scratch, read at once) */
const tint = (css: string): THREE.Color => _tint.set(css)
const STARLIGHT = new THREE.Color("#d9e4ff")

const STREAK_VERT = /* glsl */ `
attribute vec4 aSeed;
attribute float aEnd;
uniform float uPhase;
uniform float uLZ;
uniform float uR0;
uniform float uR1;
uniform float uStretch;
uniform float uConv;
uniform float uFall;
uniform float uAlpha;
varying float vA;
void main() {
  // a streak's head travels back along -z, the tail trailing behind it
  float z = mod(aSeed.z * uLZ + uPhase, uLZ) - uLZ * 0.5;
  float rr = mix(uR0, uR1, aSeed.y);
  // gather: drawn in towards her heart; emerge: falling away outward
  rr = mix(rr, 0.4, uConv * 0.92) * (1.0 + uFall * 1.4);
  float L = uStretch * (0.35 + 0.65 * aSeed.w);
  float fz = abs(z) / (uLZ * 0.5);
  float ends = 1.0 - smoothstep(0.7, 1.0, fz);
  vA = uAlpha * aSeed.w * ends * mix(1.0, 0.12, aEnd) * (1.0 - uFall);
  vec3 p = vec3(cos(aSeed.x) * rr, sin(aSeed.x) * rr, z + aEnd * L);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`
const STREAK_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.5) * vA, vA);
}
`

/**
 * Starlight streaks: a fixed set of line segments, each a point of light
 * with a tail. All the motion is in the shader (no per-frame CPU work
 * beyond a few uniforms). Shared with the re-entry wind (ReentryFX).
 */
export const makeStreaks = (count: number, r0: number, r1: number, color: THREE.Color): { line: THREE.LineSegments; mat: THREE.ShaderMaterial } => {
  const seed = new Float32Array(count * 2 * 4)
  const end = new Float32Array(count * 2)
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2
    // more streaks nearer the middle than the walls: the eye reads a tube, not a sheet
    const y = Math.pow(Math.random(), 0.7)
    const z = Math.random(), w = 0.4 + Math.random() * 0.6
    for (let v = 0; v < 2; v++) {
      seed.set([a, y, z, w], (i * 2 + v) * 4)
      end[i * 2 + v] = v
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 6), 3))
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4))
  geo.setAttribute("aEnd", new THREE.BufferAttribute(end, 1))
  const mat = new THREE.ShaderMaterial({
    vertexShader: STREAK_VERT, fragmentShader: STREAK_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uPhase: { value: 0 }, uLZ: { value: LZ }, uR0: { value: r0 }, uR1: { value: r1 }, uStretch: { value: 0 },
      uConv: { value: 0 }, uFall: { value: 0 }, uAlpha: { value: 0 }, uColor: { value: color.clone() },
    },
  })
  const line = new THREE.LineSegments(geo, mat)
  line.frustumCulled = false
  line.visible = false
  return { line, mat }
}

/**
 * Stardust: motes scattered through a box of space round her (not a tube),
 * flowing back past her as she runs. Near motes cross the view fast and far
 * ones slowly — parallax, the cue that space has depth — and each draws a
 * short tail by its speed. Sparse and faint: the sky ahead is the show.
 */
const DUST_VERT = /* glsl */ `
attribute vec4 aSeed;
attribute float aEnd;
uniform float uPhase;
uniform float uLZ;
uniform float uTail;
uniform float uConv;
uniform float uAlpha;
varying float vA;
void main() {
  float z = mod(aSeed.z * uLZ - uPhase, uLZ) - uLZ * 0.35;
  vec2 xy = aSeed.xy * (1.0 - 0.55 * uConv);
  float fz = z > 0.0 ? z / (uLZ * 0.65) : -z / (uLZ * 0.35);
  float ends = 1.0 - smoothstep(0.6, 1.0, fz);
  // nearer the path, the faster it crosses and the longer it draws
  float near = 1.0 / (1.0 + length(xy) * 0.025);
  vA = uAlpha * aSeed.w * ends * mix(1.0, 0.0, aEnd);
  vec3 p = vec3(xy, z + aEnd * uTail * (0.5 + near));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`

/**
 * Nebula banks: two or three clouds of glowing gas she runs through on a long
 * journey, so the way has landmarks and a rhythm instead of one endless loop.
 * Each is a cluster of soft billboards with drifting fbm, coloured from real
 * emission lines (hydrogen-alpha rose, doubly-ionised oxygen teal, the blue of
 * reflection nebulae, the amber of warm dust) and leaning to the destination's
 * light. They swell ahead, open round her and fall away behind.
 */
const NEB_VERT = /* glsl */ `
attribute vec3 aOff;
attribute vec4 aN;
uniform float uZ;
uniform float uSpread;
varying vec2 vUv;
varying float vSeed;
varying float vFade;
void main() {
  vUv = uv * 2.0 - 1.0;
  vSeed = aN.x;
  vec3 c = vec3(aOff.xy * uSpread, aOff.z + uZ);
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  float size = aN.y;
  mv.xy += position.xy * size;
  // never a wall in her face: a cloud thins as the eye enters it
  float dist = length(mv.xyz);
  vFade = smoothstep(size * 0.25, size * 1.1, dist) * (1.0 - smoothstep(520.0, 760.0, dist));
  gl_Position = projectionMatrix * mv;
}
`
const NEB_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
uniform vec3 uColA;
uniform vec3 uColB;
varying vec2 vUv;
varying float vSeed;
varying float vFade;
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  vec2 q = vUv * 1.7 + vSeed * 13.0;
  // domain-warped: filaments and pillars rather than round puffs
  vec2 w = vec2(fbm(q + uTime * 0.04), fbm(q + 5.2 - uTime * 0.03));
  float n = fbm(q + 2.2 * w);
  float body = smoothstep(0.38, 0.85, n) * (1.0 - smoothstep(0.35, 1.0, r));
  float rim = smoothstep(0.55, 0.62, n) * (1.0 - smoothstep(0.62, 0.8, n));
  vec3 col = mix(uColA, uColB, smoothstep(0.3, 0.8, w.x));
  col += vec3(1.0) * rim * 0.25;
  float a = body * uAlpha * vFade;
  gl_FragColor = vec4(col * a, a);
}
`

/**
 * The light round her: a soft envelope that hugs her as she runs, brightest
 * at its rim (fresnel), with faint lines of light sliding back along it.
 * It is Starborn's starlight parting space for her riders, never a hard shield.
 */
const HALO_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  vP = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`
const HALO_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uFlow;
uniform vec3 uColor;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  // max(): interpolated unit vectors can dot a hair past 1 (more so on MSAA
  // edge samples), and pow() of a negative base is NaN, which the bloom
  // spread into a black frame as the corridor opened
  float fr = pow(max(1.0 - abs(dot(vN, vV)), 0.0), 2.6);
  float th = atan(vP.y, vP.x);
  float lines = pow(0.5 + 0.5 * sin(th * 23.0 + sin(th * 5.0) * 2.0), 18.0);
  float flow = fract(vP.z * 0.08 + uFlow);
  lines *= smoothstep(0.0, 0.2, flow) * (1.0 - smoothstep(0.35, 0.9, flow));
  // brightest at the nose, gone towards the open end behind her
  float along = smoothstep(-9.0, 2.0, vP.z);
  float a = (fr * 0.75 + lines * 0.5) * along * uAlpha;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.35) * a, a);
}
`

const CORE_VERT = /* glsl */ `
uniform float uPx;
uniform float uSize;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * uPx / max(-mv.z, 0.5), 1.0, 512.0);
}
`
/** the heart of the light: a white-hot point with a soft bloom, never a hard disc */
const CORE_FRAG = /* glsl */ `
uniform float uAlpha;
uniform vec3 uColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  float core = exp(-d * 40.0);
  float g = exp(-d * 5.5) * 0.7 + core * 0.9;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), core) * g, g * uAlpha);
}
`

const RING_FRAG = /* glsl */ `
uniform float uR;
uniform float uW;
uniform float uA;
uniform vec3 uColor;
varying vec2 vP;
void main() {
  float d = length(vP);
  if (d > 1.0) discard;
  float x = (d - uR) / uW;
  float a = exp(-x * x * 2.2) * uA;
  gl_FragColor = vec4(uColor * a, a);
}
`
const RING_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

type Sys = ReturnType<typeof build>

/** emission colours of real nebulae: [core, edge] pairs (linear-ish RGB) */
const NEBULAE: Array<[string, string]> = [
  ["#ff5f8f", "#ffb0a0"], // hydrogen-alpha rose, warm rim
  ["#3fd6c8", "#8fa8ff"], // doubly-ionised oxygen teal into blue
  ["#6f8dff", "#c9d6ff"], // reflection-nebula blue
  ["#ffad66", "#ff6f7a"], // warm dust lit from within
]

const NEB_SPRITES = 9
const NEB_SPEED = 300
const DUST_LZ = 420

const build = (reduced: boolean) => {
  const level = qualityRT.level
  const scale = reduced ? 0.5 : 1
  const root = new THREE.Group()
  root.name = "warp-corridor"
  // ---- stardust: a box of motes, never on her own path
  const dustCount = Math.round((level === "low" ? 260 : level === "medium" ? 420 : 600) * scale)
  const dSeed = new Float32Array(dustCount * 2 * 4)
  const dEnd = new Float32Array(dustCount * 2)
  for (let i = 0; i < dustCount; i++) {
    let x: number, y: number
    do { x = (Math.random() * 2 - 1) * 120; y = (Math.random() * 2 - 1) * 90 } while (Math.hypot(x, y * 1.3) < 9)
    const z = Math.random(), w = 0.25 + Math.random() * 0.75
    for (let v = 0; v < 2; v++) {
      dSeed.set([x, y, z, w], (i * 2 + v) * 4)
      dEnd[i * 2 + v] = v
    }
  }
  const dustGeo = new THREE.BufferGeometry()
  dustGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(dustCount * 6), 3))
  dustGeo.setAttribute("aSeed", new THREE.BufferAttribute(dSeed, 4))
  dustGeo.setAttribute("aEnd", new THREE.BufferAttribute(dEnd, 1))
  const dustMat = new THREE.ShaderMaterial({
    vertexShader: DUST_VERT, fragmentShader: STREAK_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uPhase: { value: 0 }, uLZ: { value: DUST_LZ }, uTail: { value: 0 }, uConv: { value: 0 }, uAlpha: { value: 0 }, uColor: { value: STARLIGHT.clone() } },
  })
  const dust = new THREE.LineSegments(dustGeo, dustMat)
  dust.frustumCulled = false
  // ---- nebula banks: one cluster of soft billboards each
  const bankCount = level === "low" ? 2 : 3
  const sprites = level === "low" ? 5 : NEB_SPRITES
  const banks: Array<{ mesh: THREE.Mesh; mat: THREE.ShaderMaterial; geo: THREE.BufferGeometry }> = []
  for (let b = 0; b < bankCount; b++) {
    const pos: number[] = [], uv: number[] = [], off: number[] = [], nn: number[] = [], idx: number[] = []
    for (let k = 0; k < sprites; k++) {
      // a ragged cloud off to one side, so she runs through its edge, not its heart
      const ox = (Math.random() * 2 - 1) * 1.1, oy = (Math.random() * 2 - 1) * 0.7, oz = (Math.random() * 2 - 1) * 90
      const size = 110 + Math.random() * 150
      const seed = Math.random()
      const base = k * 4
      for (const [qx, qy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        pos.push(qx, qy, 0)
        uv.push((qx + 1) / 2, (qy + 1) / 2)
        off.push(ox, oy, oz)
        nn.push(seed, size, 0, 0)
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
    geo.setAttribute("aOff", new THREE.Float32BufferAttribute(off, 3))
    geo.setAttribute("aN", new THREE.Float32BufferAttribute(nn, 4))
    geo.setIndex(idx)
    const mat = new THREE.ShaderMaterial({
      vertexShader: NEB_VERT, fragmentShader: NEB_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uZ: { value: 0 }, uSpread: { value: 110 }, uAlpha: { value: 0 }, uTime: { value: 0 }, uColA: { value: new THREE.Color() }, uColB: { value: new THREE.Color() } },
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.frustumCulled = false
    mesh.visible = false
    mesh.renderOrder = 6
    banks.push({ mesh, mat, geo })
  }
  // ---- the envelope of light round her
  const prof: THREE.Vector2[] = []
  for (let k = 0; k <= 16; k++) {
    const r = (k / 16) * 7.5
    prof.push(new THREE.Vector2(r, 3.6 - (r * r) / 4.2))
  }
  const haloGeo = new THREE.LatheGeometry(prof, 48)
  haloGeo.rotateX(Math.PI / 2)
  const haloMat = new THREE.ShaderMaterial({
    vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uAlpha: { value: 0 }, uFlow: { value: 0 }, uColor: { value: STARLIGHT.clone() } },
  })
  const halo = new THREE.Mesh(haloGeo, haloMat)
  halo.frustumCulled = false
  halo.visible = false
  // her heart: one point of light, sized in metres
  const coreGeo = new THREE.BufferGeometry()
  coreGeo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0.5, 0.8], 3))
  const coreMat = new THREE.ShaderMaterial({
    vertexShader: CORE_VERT, fragmentShader: CORE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uAlpha: { value: 0 }, uPx: { value: 1000 }, uSize: { value: 2 }, uColor: { value: STARLIGHT.clone() } },
  })
  const core = new THREE.Points(coreGeo, coreMat)
  core.frustumCulled = false
  core.visible = false
  // the ring of light at the launch and the arrival, square to her course
  const ringGeo = new THREE.PlaneGeometry(2, 2)
  const ringMat = new THREE.ShaderMaterial({
    vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uR: { value: 0 }, uW: { value: 0.12 }, uA: { value: 0 }, uColor: { value: STARLIGHT.clone() } },
  })
  const ring = new THREE.Mesh(ringGeo, ringMat)
  ring.frustumCulled = false
  ring.visible = false
  dust.renderOrder = 8
  halo.renderOrder = 8
  core.renderOrder = 9
  ring.renderOrder = 9
  root.add(dust, halo, core, ring, ...banks.map((b) => b.mesh))
  return {
    root, dust, dustGeo, dustMat, banks, halo, haloGeo, haloMat, core, coreMat, ring, ringMat, ringGeo, coreGeo, reduced,
    phase: 0, flow: 0, last: "idle" as string, burstT: 9,
  }
}

const reducedMotion = (): boolean => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

/** The FOV boost the camera owner may apply while the journey runs (degrees). */
export const travelFovBoost = (): number => corridorFovBoost(travelRT.intensity)

const smooth = (u: number): number => u * u * (3 - 2 * u)

/** A journey's own nebulae: picked once per journey, so the same trip is not always the same sky. */
const paintBanks = (sys: Sys): void => {
  const seed = (travelRT.journeys * 7 + travelRT.name.length * 3) % NEBULAE.length
  sys.banks.forEach((b, i) => {
    const [a, c] = NEBULAE[(seed + i) % NEBULAE.length]
    b.mat.uniforms.uColA.value.set(a).lerp(tint(travelRT.color), 0.2)
    b.mat.uniforms.uColB.value.set(c)
    // alternate sides, so she threads between them
    b.mesh.position.set((i % 2 ? -1 : 1) * (60 + 40 * Math.random()), (Math.random() * 2 - 1) * 35, 0)
  })
}

export const WarpCorridor = ({ pilot }: { pilot: () => HorseState | null }): React.ReactElement => {
  const reduced = useMemo(() => reducedMotion(), [])
  const sys: Sys = useMemo(() => build(reduced), [reduced])

  useEffect(() => () => {
    sys.dustGeo.dispose(); sys.dustMat.dispose()
    for (const b of sys.banks) { b.geo.dispose(); b.mat.dispose() }
    sys.haloGeo.dispose(); sys.haloMat.dispose()
    sys.coreGeo.dispose(); sys.coreMat.dispose()
    sys.ringGeo.dispose(); sys.ringMat.dispose()
  }, [sys])

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const ph = travelRT.phase
    const I = travelRT.intensity
    updateTravelSound()
    // the burst at the launch and the arrival: a ring of light, once
    if (ph !== sys.last) {
      if (ph === "corridor" || ph === "emerge") sys.burstT = 0
      if (ph === "corridor") paintBanks(sys)
      sys.last = ph
    }
    const h = pilot()
    const on = !!h && (ph === "gather" || ph === "corridor" || ph === "emerge" || I > 0.003)
    sys.root.visible = on
    if (!on || !h) return

    const u = travelRT.u
    const beta = travelRT.beta
    const speed = warpSpeed(ph, u)
    const calm = reduced ? 0.5 : 1
    const conv = ph === "gather" ? smooth(u) : 0
    const fall = ph === "emerge" ? smooth(u) : 0
    // the dust runs with the sky's speed (β), so the near and the far agree
    const rate = warpPhaseRate(speed, reduced) * (0.4 + 1.8 * beta)
    sys.phase = (sys.phase + rate * dt) % DUST_LZ
    sys.flow = (sys.flow + dt * (0.4 + 2.2 * beta)) % 1

    const dm = sys.dustMat.uniforms
    sys.dust.visible = I > 0.003
    dm.uPhase.value = sys.phase
    dm.uTail.value = Math.min(34, rate * 0.05) * (reduced ? 0.6 : 1)
    dm.uConv.value = conv
    dm.uAlpha.value = Math.min(1, I) * 0.55 * calm * (1 - 0.7 * fall)
    dm.uColor.value.copy(WHITE).lerp(tint(travelRT.color), 0.3)

    // the nebulae: each one passes at its moment in the corridor
    const inCorridor = ph === "corridor" && travelRT.style !== "quick"
    const K = nebulaCount(travelRT.duration, sys.banks.length)
    sys.banks.forEach((b, i) => {
      const tc = nebulaMoment(travelRT.duration, i, K)
      const z = (tc - travelRT.t) * NEB_SPEED
      const show = inCorridor && i < K && z < 780 && z > -340
      b.mesh.visible = show
      if (!show) return
      b.mat.uniforms.uZ.value = z
      b.mat.uniforms.uTime.value = state.clock.elapsedTime
      b.mat.uniforms.uAlpha.value = 0.24 * calm * Math.min(1, I)
    })

    // the envelope: there while she is fast, a breath of light at the nose
    const hm = sys.haloMat.uniforms
    sys.halo.visible = beta > 0.02
    hm.uAlpha.value = smooth(Math.min(1, beta / 0.6)) * 0.22 * calm
    hm.uFlow.value = sys.flow
    hm.uColor.value.copy(tint(travelRT.color)).lerp(WHITE, 0.4)

    // her heart: the light gathers in, holds steady on the way, falls back on arrival
    const bloom = warpBloom(travelRT.flash, reduced)
    const base = ph === "gather" ? 0.15 + 0.8 * conv : ph === "emerge" ? 0.5 * (1 - fall) : 0.3 + 0.05 * Math.sin(state.clock.elapsedTime * 2.1)
    sys.core.visible = (ph === "gather" || ph === "corridor" || ph === "emerge") && (base + bloom) > 0.005
    sys.coreMat.uniforms.uAlpha.value = base * I + bloom
    sys.coreMat.uniforms.uSize.value = 1.2 + 2.8 * conv + 0.6 * travelRT.flash
    sys.coreMat.uniforms.uPx.value = state.size.height * state.camera.projectionMatrix.elements[5] / 2
    sys.coreMat.uniforms.uColor.value.copy(tint(travelRT.color)).lerp(WHITE, 0.6)

    // the ring: runs out over ~1.1 s from each burst, square to her course
    sys.burstT += dt
    const rt = Math.min(1, sys.burstT / 1.1)
    sys.ring.visible = rt < 1
    if (sys.ring.visible) {
      const e = 1 - Math.pow(1 - rt, 3)
      sys.ring.scale.setScalar(16 + 70 * e)
      sys.ring.position.set(0, 0.5, ph === "emerge" ? 6 : -2 - 10 * e)
      sys.ringMat.uniforms.uR.value = 0.82
      sys.ringMat.uniforms.uW.value = 0.05 + 0.08 * e
      sys.ringMat.uniforms.uA.value = (1 - rt) * (1 - rt) * (reduced ? 0.1 : 0.26) * Math.max(0.4, I)
      sys.ringMat.uniforms.uColor.value.copy(WHITE).lerp(tint(travelRT.color), 0.35)
    }

    // her frame: her chest, turned to her forward (+z), leaning with the sway
    sys.root.position.set(h.x, h.y + tiltPivot(h), h.z)
    const pitch = h.flight?.pitch ?? 0
    _f.set(Math.sin(h.heading) * Math.cos(pitch), Math.sin(pitch), Math.cos(h.heading) * Math.cos(pitch))
    if (_f.lengthSq() > 1e-6) sys.root.quaternion.setFromUnitVectors(Z, _f.normalize())
    _roll.setFromAxisAngle(_axis, -travelRT.sway * 0.08)
    sys.root.quaternion.multiply(_roll)
  })

  return <primitive object={sys.root} />
}
