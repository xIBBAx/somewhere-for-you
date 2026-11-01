import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { characterRT } from "../runtime"
import { horseRT, fwdX, fwdZ } from "../horses/horseState"
import { spaceRT } from "../celestial/spaceState"
import { qualityRT } from "../../state/qualityStore"
import { isPegasus } from "./pegasi"
import { skillsOf } from "./skills"
import { emitterPoint } from "./PegasusTrail"
import { dashSound } from "./dashAudio"
import { densityScale, motionScale, nearCameraFade, onsetPunch, ringFade, ringGrowth, strokeCrossed, type DashSignature } from "./dashSignature"

/**
 * Each Pegasus's own dash, drawn in her colours (dashSignature.ts has the
 * timing; dashAudio.ts the sound). Horses surge with their own effects drawn in the world (GroundDashFX);
 * a Pegasus in the air gets none of them.
 *
 *   Ivory (swift)     an air-lens ripple on onset; rose-pearl vortices peeling off
 *                    each wingtip in a helix, and flickering feathers of air.
 *   Onyx (thunder) a golden condensation cone on onset; a pressure ring thrown
 *                    back on every driving downstroke (the bottom of the stroke,
 *                    flight.ts), with sparks off the wingtips.
 *   Starborn (starfall) her light gathered in out of the air round her on onset
 *                    and let go along both wings on her first great downstroke,
 *                    a softer pulse of it on every beat after; a comet tail of
 *                    starlight; a rare star glint; and, once the air is thin,
 *                    a rip of light beside her (her wings and wake carry the
 *                    rest: horseAssets feather light, PegasusTrail aurora).
 *
 * Real: the wingtip points (the rig, via PegasusTrail), the stroke phase, the dash
 * (flight.ts boostT), the thin air (spaceState.ts). Everything else is styling.
 *
 * Every effect is born in logical coordinates and co-moves with her (the air
 * she has just left would otherwise stream past the chase camera at dash speed),
 * so rings and wisps stay around her. In deep space she is parked and the
 * universe moves, so they are carried back by the same drift the trail uses.
 * Sparks fade as they near the lens (dashSignature.nearCameraFade).
 *
 * Cost: one draw call each for rings, points, lines and rips (instanced or
 * pooled), and two translucent shells. Pools are fixed; nothing allocates per frame.
 *
 * QA: `dashFxRT.punch` and `dashFxRT.kind` are for the camera (a FOV kick on
 * onset); nothing here moves the camera.
 */

/** Read by the camera (wiring is for the lead): 1 on the frame a dash begins, decaying over ~0.6 s; scaled down under reduced motion. */
export const dashFxRT = { punch: 0, kind: "" as "" | DashSignature }

const RINGS = 40
const PARTS = 900
const LINKS = 48
const RIPS = 12

const PAL = {
  pearl: new THREE.Color("#ffc6dc"),
  rose: new THREE.Color("#f4a6c4"),
  white: new THREE.Color("#fff6f2"),
  gold: new THREE.Color("#ffb040"),
  goldHot: new THREE.Color("#fff0c8"),
  star: new THREE.Color("#f6f8ff"),
  blue: new THREE.Color("#8ea0ff"),
  rip: new THREE.Color("#dfe8ff"),
  // Starborn's light: moon-silver, violet, an electric cyan and a little rose
  moon: new THREE.Color("#e4e8ff"),
  violet: new THREE.Color("#9a6cff"),
  cyan: new THREE.Color("#62e6ff"),
  roseN: new THREE.Color("#ff6fcf"),
}

/** Starborn's colour along her wing's span (0 root .. 1 tip): moon at the shoulder, violet, cyan at the tips, rose now and then. */
const starbornHue = (u: number): THREE.Color => (Math.random() < 0.1 ? PAL.roseN : u < 0.35 ? PAL.moon : u < 0.7 ? PAL.violet : PAL.cyan)

const RING_VERT = /* glsl */ `
attribute float aMode;
attribute vec3 aCol;
attribute float aAlpha;
varying vec3 vCol;
varying float vA;
varying float vMode;
varying float vR;
varying float vAng;
void main() {
  vCol = aCol; vA = aAlpha; vMode = aMode;
  vR = length(position.xy);
  vAng = atan(position.y, position.x);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`
// mode 0: a soft air lens (a faint, wide edge); 1: a crisp pressure ring; 2: a starburst rupture
// (the ring, sixteen rays inside it, a small bright heart). Additive: light, never a solid shape.
const RING_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
varying float vMode;
varying float vR;
varying float vAng;
void main() {
  float band = smoothstep(0.84, 0.92, vR) * (1.0 - smoothstep(0.96, 1.0, vR));
  float rays = pow(abs(cos(vAng * 8.0)), 36.0) * (1.0 - vR) * (1.0 - vR) * 1.2;
  float heart = exp(-vR * vR * 60.0) * 0.9;
  float shape = vMode < 0.5 ? band * 0.45 : vMode < 1.5 ? band : band + rays + heart;
  gl_FragColor = vec4(vCol * (0.8 + band + heart), vA * shape);
}
`

const PT_VERT = /* glsl */ `
attribute vec3 aCol;
attribute float aSize;
attribute float aAlpha;
varying vec3 vCol;
varying float vA;
void main() {
  vCol = aCol; vA = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(64.0, aSize * 300.0 / max(0.5, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`
const PT_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  gl_FragColor = vec4(vCol * (0.6 + exp(-d * 5.0) * 1.2), vA * exp(-d * 2.5));
}
`

const LINE_VERT = /* glsl */ `
attribute vec3 aCol;
attribute float aAlpha;
varying vec3 vCol;
varying float vA;
void main() {
  vCol = aCol; vA = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const LINE_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
void main() { gl_FragColor = vec4(vCol, vA); }
`

// a rip of light: a bright, thin slit along its length that tapers at both ends
const RIP_VERT = /* glsl */ `
attribute vec3 aCol;
attribute float aAlpha;
attribute float aSeed;
varying vec2 vUv;
varying vec3 vCol;
varying float vA;
varying float vSeed;
void main() {
  vUv = uv; vCol = aCol; vA = aAlpha; vSeed = aSeed;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`
const RIP_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec3 vCol;
varying float vA;
varying float vSeed;
void main() {
  float across = abs(vUv.x * 2.0 - 1.0);
  float core = exp(-across * across * 90.0);
  float halo = exp(-across * across * 8.0) * 0.25;
  float taper = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y));
  // a slow shimmer, never a strobe
  float flick = 0.85 + 0.15 * sin(uTime * 2.5 + vSeed * 6.2831);
  gl_FragColor = vec4(vCol * (0.5 + core * 1.8), (core + halo) * taper * vA * flick);
}
`

// a fresnel shell: its rim glows and its middle stays clear, so the creature inside stays readable
const SHELL_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`
const SHELL_FRAG = /* glsl */ `
uniform vec3 uCol;
uniform float uA;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = pow(max(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0), 2.2);
  gl_FragColor = vec4(uCol * (0.5 + f), uA * f);
}
`

/** The wings' line-up for this frame, and the dash's frame of reference. */
type Body = { c: THREE.Vector3; fwd: THREE.Vector3; side: THREE.Vector3; up: THREE.Vector3; wl: THREE.Vector3; wr: THREE.Vector3; carry: THREE.Vector3; speed: number; dist: number }
type Trace = { dashing: boolean; prevFlap: number; cool: number; lens: number; rip: number; burst: number; acc: [number, number, number, number]; ripped: boolean; launched: boolean
  /** Starborn: seconds left to release the light she gathered (the first great downstroke), or −1 */
  release: number }

const makeSystem = () => {
  const root = new THREE.Group()
  root.name = "pegasus-dash"
  // rings: lens ripples, pressure rings and starbursts, one instanced draw
  const ringGeo = new THREE.RingGeometry(0, 1, 96, 1)
  const ringMode = new Float32Array(RINGS), ringCol = new Float32Array(RINGS * 3), ringAlpha = new Float32Array(RINGS)
  const ringAttr = { mode: new THREE.InstancedBufferAttribute(ringMode, 1), col: new THREE.InstancedBufferAttribute(ringCol, 3), alpha: new THREE.InstancedBufferAttribute(ringAlpha, 1) }
  ringGeo.setAttribute("aMode", ringAttr.mode)
  ringGeo.setAttribute("aCol", ringAttr.col)
  ringGeo.setAttribute("aAlpha", ringAttr.alpha)
  const ringMat = new THREE.ShaderMaterial({ vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, RINGS)
  rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  rings.frustumCulled = false
  rings.renderOrder = 6
  // rips of light: a pool of billboarded slits
  const ripGeo = new THREE.PlaneGeometry(1, 1)
  const ripCol = new Float32Array(RIPS * 3), ripAlpha = new Float32Array(RIPS), ripSeed = new Float32Array(RIPS)
  const ripAttr = { col: new THREE.InstancedBufferAttribute(ripCol, 3), alpha: new THREE.InstancedBufferAttribute(ripAlpha, 1), seed: new THREE.InstancedBufferAttribute(ripSeed, 1) }
  ripGeo.setAttribute("aCol", ripAttr.col)
  ripGeo.setAttribute("aAlpha", ripAttr.alpha)
  ripGeo.setAttribute("aSeed", ripAttr.seed)
  const ripMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: RIP_VERT, fragmentShader: RIP_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  const rips = new THREE.InstancedMesh(ripGeo, ripMat, RIPS)
  rips.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  rips.frustumCulled = false
  rips.renderOrder = 6
  // particles: vortices, feathers, comet beads and stars share one points draw
  const pGeo = new THREE.BufferGeometry()
  const pPos = new Float32Array(PARTS * 3), pCol = new Float32Array(PARTS * 3), pSize = new Float32Array(PARTS), pAlpha = new Float32Array(PARTS)
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage))
  pGeo.setAttribute("aCol", new THREE.BufferAttribute(pCol, 3))
  pGeo.setAttribute("aSize", new THREE.BufferAttribute(pSize, 1).setUsage(THREE.DynamicDrawUsage))
  pGeo.setAttribute("aAlpha", new THREE.BufferAttribute(pAlpha, 1).setUsage(THREE.DynamicDrawUsage))
  const pMat = new THREE.ShaderMaterial({ vertexShader: PT_VERT, fragmentShader: PT_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  const points = new THREE.Points(pGeo, pMat)
  points.frustumCulled = false
  points.renderOrder = 7
  // constellation lines between linked stars
  const lGeo = new THREE.BufferGeometry()
  const lPos = new Float32Array(LINKS * 6), lCol = new Float32Array(LINKS * 6), lAlpha = new Float32Array(LINKS * 2)
  for (let i = 0; i < LINKS * 2; i++) { lCol[i * 3] = PAL.star.r; lCol[i * 3 + 1] = PAL.star.g; lCol[i * 3 + 2] = PAL.star.b }
  lGeo.setAttribute("position", new THREE.BufferAttribute(lPos, 3).setUsage(THREE.DynamicDrawUsage))
  lGeo.setAttribute("aCol", new THREE.BufferAttribute(lCol, 3))
  lGeo.setAttribute("aAlpha", new THREE.BufferAttribute(lAlpha, 1).setUsage(THREE.DynamicDrawUsage))
  const lMat = new THREE.ShaderMaterial({ vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  const lines = new THREE.LineSegments(lGeo, lMat)
  lines.frustumCulled = false
  lines.renderOrder = 7
  lines.visible = false
  // the shells: Starborn's lensing bubble, Onyx's golden vapour cone
  const bubbleMat = new THREE.ShaderMaterial({ uniforms: { uCol: { value: new THREE.Color("#8ea0ff") }, uA: { value: 0 } }, vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(2.2, 32, 16), bubbleMat)
  bubble.frustumCulled = false
  bubble.renderOrder = 6
  const coneMat = new THREE.ShaderMaterial({ uniforms: { uCol: { value: new THREE.Color("#ffa040") }, uA: { value: 0 } }, vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
  // open-ended, narrow at the front (+Y is the front once oriented), 3.5 m long
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 1.6, 3.5, 28, 1, true), coneMat)
  cone.frustumCulled = false
  cone.renderOrder = 6
  root.add(rings, rips, points, lines, bubble, cone)
  return {
    root, rings, ringGeo, ringMat, ringAttr, ringMode, ringCol, ringAlpha,
    rips, ripGeo, ripMat, ripAttr, ripCol, ripAlpha, ripSeed,
    points, pGeo, pMat, pPos, pCol, pSize, pAlpha,
    lines, lGeo, lMat, lPos, lAlpha,
    bubble, bubbleMat, cone, coneMat,
    // ring: logical centre, normal, velocity, orientation, age and life, radii, strength
    rPos: new Float64Array(RINGS * 3), rVel: new Float32Array(RINGS * 3), rNorm: new Float32Array(RINGS * 3), rQuat: new Float32Array(RINGS * 4),
    rAge: new Float32Array(RINGS), rLife: new Float32Array(RINGS), rR0: new Float32Array(RINGS), rR1: new Float32Array(RINGS), rStr: new Float32Array(RINGS),
    rNext: 0,
    // rip: logical centre, velocity, forward, age, life, length, width, strength, seed
    qPos: new Float64Array(RIPS * 3), qVel: new Float32Array(RIPS * 3), qFwd: new Float32Array(RIPS * 3),
    qAge: new Float32Array(RIPS), qLife: new Float32Array(RIPS), qLen: new Float32Array(RIPS), qW: new Float32Array(RIPS), qStr: new Float32Array(RIPS),
    qNext: 0,
    // particle: logical base, velocity, spiral axes side and up, spiral (phase, rate, radius, growth), age, life, size, peak, seed
    pBase: new Float64Array(PARTS * 3), pVel: new Float32Array(PARTS * 3), pSide: new Float32Array(PARTS * 3), pUp: new Float32Array(PARTS * 3),
    pSpin: new Float32Array(PARTS * 4), pAge: new Float32Array(PARTS), pLife: new Float32Array(PARTS), pSizeBase: new Float32Array(PARTS), pPeak: new Float32Array(PARTS), pSeed: new Float32Array(PARTS),
    pNext: 0,
    // constellation links between two particles
    lA: new Int32Array(LINKS), lB: new Int32Array(LINKS), lAge: new Float32Array(LINKS), lLife: new Float32Array(LINKS), lNext: 0,
    traces: new Map<string, Trace>(),
    /** the active rider's mount last frame (logical), for carrying the effects along at sail speeds */
    carryFrom: new THREE.Vector3(), carryOk: false,
    bubbleOn: false, bubbleC: new THREE.Vector3(), bubbleT: 9, bubbleA: 0,
    coneOn: false, coneC: new THREE.Vector3(), coneFwd: new THREE.Vector3(0, 0, 1), coneT: 9, coneA: 0,
    punchT: 9,
    frame: "",
    anchor: new THREE.Vector3(),
    cam: new THREE.Vector3(),
  }
}
type Sys = ReturnType<typeof makeSystem>

const _q = new THREE.Quaternion()
const _z = new THREE.Vector3(0, 0, 1)
const _m = new THREE.Matrix4()
const _s = new THREE.Vector3()
const _v = new THREE.Vector3()
const _w = new THREE.Vector3()
const _t = new THREE.Vector3()
const _drift = new THREE.Vector3()
const _zero = new THREE.Vector3()
const _n = new THREE.Vector3()
const _s2 = new THREE.Vector3()
const _y = new THREE.Vector3(0, 1, 0)
const B: Body = { c: new THREE.Vector3(), fwd: new THREE.Vector3(), side: new THREE.Vector3(), up: new THREE.Vector3(), wl: new THREE.Vector3(), wr: new THREE.Vector3(), carry: new THREE.Vector3(), speed: 0, dist: 0 }
const reducedRT = { on: false }

/** A particle: its base, its velocity, and an optional spiral about (side, up): phase, rate, radius, growth. */
const spawnP = (sys: Sys, base: THREE.Vector3, vel: THREE.Vector3, side: THREE.Vector3, up: THREE.Vector3, spin: [number, number, number, number], life: number, size: number, peak: number, col: THREE.Color): void => {
  const i = sys.pNext
  sys.pNext = (i + 1) % PARTS
  const o = i * 3
  sys.pBase[o] = base.x; sys.pBase[o + 1] = base.y; sys.pBase[o + 2] = base.z
  sys.pVel[o] = vel.x; sys.pVel[o + 1] = vel.y; sys.pVel[o + 2] = vel.z
  sys.pSide[o] = side.x; sys.pSide[o + 1] = side.y; sys.pSide[o + 2] = side.z
  sys.pUp[o] = up.x; sys.pUp[o + 1] = up.y; sys.pUp[o + 2] = up.z
  sys.pSpin[i * 4] = spin[0]; sys.pSpin[i * 4 + 1] = spin[1]; sys.pSpin[i * 4 + 2] = spin[2]; sys.pSpin[i * 4 + 3] = spin[3]
  sys.pAge[i] = 0
  sys.pLife[i] = life
  sys.pSizeBase[i] = size
  sys.pPeak[i] = peak
  sys.pSeed[i] = Math.random() * 6.2832
  sys.pCol[o] = col.r; sys.pCol[o + 1] = col.g; sys.pCol[o + 2] = col.b
}

const NO_SPIN: [number, number, number, number] = [0, 0, 0, 0]

const spawnRing = (sys: Sys, mode: number, col: THREE.Color, r0: number, r1: number, life: number, back: number, str: number, at: THREE.Vector3): void => {
  const i = sys.rNext
  sys.rNext = (i + 1) % RINGS
  const o = i * 3
  sys.rPos[o] = at.x; sys.rPos[o + 1] = at.y; sys.rPos[o + 2] = at.z
  sys.rNorm[o] = B.fwd.x; sys.rNorm[o + 1] = B.fwd.y; sys.rNorm[o + 2] = B.fwd.z
  // co-moving with her, drifting back at `back` m/s relative to her
  sys.rVel[o] = B.carry.x - B.fwd.x * back; sys.rVel[o + 1] = B.carry.y - B.fwd.y * back; sys.rVel[o + 2] = B.carry.z - B.fwd.z * back
  _q.setFromUnitVectors(_z, B.fwd)
  sys.rQuat[i * 4] = _q.x; sys.rQuat[i * 4 + 1] = _q.y; sys.rQuat[i * 4 + 2] = _q.z; sys.rQuat[i * 4 + 3] = _q.w
  sys.rAge[i] = 0; sys.rLife[i] = life; sys.rR0[i] = r0; sys.rR1[i] = r1; sys.rStr[i] = str
  sys.ringMode[i] = mode
  sys.ringCol[o] = col.r; sys.ringCol[o + 1] = col.g; sys.ringCol[o + 2] = col.b
}

const spawnRip = (sys: Sys, at: THREE.Vector3, len: number, width: number, life: number): void => {
  const i = sys.qNext
  sys.qNext = (i + 1) % RIPS
  const o = i * 3
  sys.qPos[o] = at.x; sys.qPos[o + 1] = at.y; sys.qPos[o + 2] = at.z
  sys.qVel[o] = B.carry.x; sys.qVel[o + 1] = B.carry.y; sys.qVel[o + 2] = B.carry.z
  sys.qFwd[o] = B.fwd.x; sys.qFwd[o + 1] = B.fwd.y; sys.qFwd[o + 2] = B.fwd.z
  sys.qAge[i] = 0; sys.qLife[i] = life; sys.qLen[i] = len; sys.qW[i] = width; sys.qStr[i] = 1
  sys.ripSeed[i] = Math.random()
  sys.ripCol[o] = PAL.rip.r; sys.ripCol[o + 1] = PAL.rip.g; sys.ripCol[o + 2] = PAL.rip.b
}

/** Random unit vector into `out`, without allocating. */
const randomDir = (out: THREE.Vector3): THREE.Vector3 => out.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()

/**
 * Star sparks: `n` glints scattered on a shell round her. (They were once
 * joined into a chain of "constellation" lines; drawn at dash speed the
 * chain read as jagged white lightning, so the stars now stand alone.)
 */
const starBurst = (sys: Sys, n: number, motion: number): void => {
  for (let j = 0; j < n; j++) {
    randomDir(_w).multiplyScalar(1.8 + Math.random() * 1.4).add(B.c)
    _t.set((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4).add(B.carry)
    spawnP(sys, _w, _t, _zero, _zero, NO_SPIN, 1.5, 0.2 * motion, 1, PAL.star)
  }
}

/** The first frame of a dash: each Pegasus's own opening. */
const onsetFx = (sys: Sys, kind: DashSignature, dens: number, motion: number, full: boolean, launch = false): void => {
  if (kind === "swift") {
    // a soft air lens: the air ahead of her bulging out and settling
    spawnRing(sys, 0, PAL.pearl, 1, 7, 1.1, 0.5, 0.7, B.c)
    // feathers of air flare up off the wings
    for (let j = 0; j < Math.round(22 * dens); j++) {
      randomDir(_w).multiplyScalar(1 + Math.random() * 2.5).add(B.c)
      spawnP(sys, _w, B.carry, _zero, _zero, NO_SPIN, 0.9, 0.1 * motion, 0.9, PAL.white)
    }
  } else if (kind === "thunder") {
    if (full) { sys.coneOn = true; sys.coneT = 0 }
    spawnRing(sys, 1, PAL.gold, 1.5, 6, 0.9, 3, 0.7, B.c)
    for (let j = 0; j < Math.round(28 * dens); j++) {
      randomDir(_w).multiplyScalar(0.8 + Math.random()).add(B.c)
      spawnP(sys, _w, _t.copy(B.carry), _zero, _zero, NO_SPIN, 0.9, 0.12 * motion, 1, PAL.goldHot)
    }
  } else {
    // Starborn gathers her light before she lets it go: motes drawn in out of
    // the air from all round her into the wings (a quarter of a second), and
    // released on her first great downstroke (dashFx below). No ring: the air
    // she draws from has no edge.
    const n = Math.round((launch ? 18 : 30) * dens)
    for (let j = 0; j < n; j++) {
      randomDir(_w)
      const r = 3.5 + Math.random() * 3
      const life = 0.22 + Math.random() * 0.12
      _t.copy(_w).multiplyScalar(-r / life).add(B.carry)
      _w.multiplyScalar(r).add(B.c)
      spawnP(sys, _w, _t, _zero, _zero, NO_SPIN, life, 0.2 * motion, 0.9, Math.random() < 0.55 ? PAL.cyan : PAL.violet)
    }
  }
}

/**
 * Starborn's light let go along the trailing edge of both wings: motes from
 * shoulder to tip, coloured by their place on the span, thrown back and a
 * little out into the air she leaves. `n` per wing; `push` how hard (m/s).
 */
const shedLight = (sys: Sys, n: number, push: number, life: number, motion: number): void => {
  for (const wing of [B.wl, B.wr]) {
    for (let j = 0; j < n; j++) {
      const u = (j + Math.random()) / n
      _w.copy(B.c).lerp(wing, u).addScaledVector(B.fwd, -0.5 - 0.4 * u)
      _n.copy(wing).sub(B.c).normalize()
      _v.copy(B.carry).addScaledVector(B.fwd, -push * (0.6 + 0.6 * Math.random()))
        .addScaledVector(_n, 1.2 + 2.5 * u * Math.random()).addScaledVector(B.up, (Math.random() - 0.4) * 1.6)
      spawnP(sys, _w, _v, _zero, _zero, NO_SPIN, life * (0.7 + 0.6 * Math.random()), (0.2 + 0.16 * u) * motion, 1, starbornHue(u))
    }
  }
}

/** Every frame of a dash: the wake that keeps coming off her. */
const dashFx = (sys: Sys, tr: Trace, kind: DashSignature, dt: number, dens: number, motion: number, full: boolean, airless: boolean, prevFlap: number, flap: number): void => {
  if (kind === "swift") {
    // wingtip vortices: the helix a wingtip leaves, the two wings turning opposite ways
    tr.acc[0] += 80 * dens * dt
    while (tr.acc[0] >= 1) {
      tr.acc[0] -= 1
      const side = Math.random() < 0.5 ? 0 : 1
      const wing = side ? B.wr : B.wl
      _v.copy(B.carry).addScaledVector(B.fwd, -0.4)
      spawnP(sys, wing, _v, B.side, B.up, [Math.random() * 6.28, side ? -13 : 13, 0.04, 0.3], 1.4, 0.12 * motion, 0.9, Math.random() < 0.5 ? PAL.pearl : PAL.white)
    }
    // feathers of air, flickering in the wake
    tr.acc[1] += 18 * dens * dt
    while (tr.acc[1] >= 1) {
      tr.acc[1] -= 1
      randomDir(_w).multiplyScalar(0.6 + Math.random() * 1.2).add(B.c)
      spawnP(sys, _w, B.carry, _zero, _zero, NO_SPIN, 0.6, 0.07 * motion, 0.8, PAL.rose)
    }
    // the air-lens ripple, every ~0.9 s
    tr.lens -= dt
    if (tr.lens <= 0 && full) {
      tr.lens = 1.5
      spawnRing(sys, 0, PAL.rose, 1.5, 5, 1.1, 0.8, 0.3, B.c)
    }
  } else if (kind === "thunder") {
    // sparks off the wingtips and the shoulders, falling back
    tr.acc[0] += 16 * dens * dt
    while (tr.acc[0] >= 1) {
      tr.acc[0] -= 1
      const wing = Math.random() < 0.5 ? B.wl : B.wr
      randomDir(_v).multiplyScalar(1.4)
      spawnP(sys, wing, _v.add(B.carry), _zero, _zero, NO_SPIN, 0.7, 0.09 * motion, 1, PAL.gold)
    }
  } else {
    // the light she gathered, let go on the first great downstroke (or a
    // third of a second in, whichever is first): a wing's length of it
    if (tr.release >= 0) {
      tr.release -= dt
      if (tr.release < 0 || strokeCrossed(prevFlap, flap)) {
        tr.release = -1
        tr.cool = 0.45
        shedLight(sys, Math.round(26 * dens), 9, 1.1, motion)
      }
    } else if (tr.cool <= 0 && strokeCrossed(prevFlap, flap)) {
      // and every beat after it sheds a softer pulse of the same light
      tr.cool = 0.4
      shedLight(sys, Math.round(7 * dens), 6, 0.8, motion)
    }
    // starlight: a comet tail beading off behind her, in her colours
    tr.acc[0] += 60 * dens * dt
    while (tr.acc[0] >= 1) {
      tr.acc[0] -= 1
      randomDir(_w).multiplyScalar(0.3).addScaledVector(B.fwd, -2.4).add(B.c)
      _v.copy(B.carry).addScaledVector(B.fwd, -4)
      const r = Math.random()
      spawnP(sys, _w, _v, _zero, _zero, NO_SPIN, 1.1, 0.13 * motion, 0.9, r < 0.45 ? PAL.moon : r < 0.8 ? PAL.violet : PAL.cyan)
    }
    tr.burst -= dt
    if (tr.burst <= 0 && full) {
      tr.burst = 0.7
      starBurst(sys, Math.max(1, Math.round(2 * dens)), motion)
    }
    // a rip of light opens beside her once the air is thin (above the weather, or in space)
    tr.rip -= dt
    // (slow and soft: a bright slit repeating every half second read as a strobe)
    if (airless && full && !reducedRT.on && tr.rip <= 0) {
      tr.rip = 2.2
      const side = (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 3)
      _w.copy(B.c).addScaledVector(B.side, side).addScaledVector(B.up, (Math.random() - 0.5) * 3)
      spawnRip(sys, _w, 8 + Math.random() * 6, 0.25, 0.9)
      if (!tr.ripped) { tr.ripped = true; dashSound.rip(B.dist) }
    }
  }
}

const clearAll = (sys: Sys): void => {
  sys.rLife.fill(0)
  sys.qLife.fill(0)
  sys.pLife.fill(0)
  sys.lLife.fill(0)
}

const frame = (sys: Sys, cam: THREE.Camera, dt: number): void => {
  const level = qualityRT.level
  const dens = densityScale(level, reducedRT.on)
  const motion = motionScale(reducedRT.on)
  // Starborn's bubble and Onyx's cone are the big, soft shells: left out on low quality
  const full = level !== "low"
  sys.anchor.set(Math.round(cam.position.x), Math.round(cam.position.y), Math.round(cam.position.z))
  sys.cam.copy(cam.position)
  sys.root.position.copy(sys.anchor)
  const A = sys.anchor
  // the air is still in the universe; when parked (deep space) it streams back at the real speed, capped to what reads
  const deep = spaceRT.mode === "deep"
  if (deep) {
    _drift.copy(spaceRT.vel).applyQuaternion(_q.copy(spaceRT.park).invert())
    const v = _drift.length()
    if (v > 1e-3) _drift.multiplyScalar(-Math.min(v, 70) / v)
  } else _drift.set(0, 0, 0)
  const airless = deep || spaceRT.realm !== "earth" || spaceRT.thin > 0.35
  // a change of frame moves everything at once; the old effects would streak across the sky
  const key = `${spaceRT.mode}:${spaceRT.realm}`
  if (key !== sys.frame) { sys.frame = key; clearAll(sys) }
  sys.bubbleOn = false
  sys.coneOn = false
  sys.punchT += dt
  // On her sails near a world she flies far faster than anything can be poured
  // out and still be seen (orbit is ~7.5 km/s): her light is carried along with
  // her and streams back at a speed the eye can follow, as it does in deep space.
  let carried = false
  for (const h of horseRT.horses.values()) {
    if (!isPegasus(h) || !h.flight || (h.rider !== characterRT.active && h.passenger !== characterRT.active)) continue
    const f = h.flight
    const v = f.mode === "air" ? Math.hypot(h.speed, f.vy) : f.mode === "sail" ? h.speed : 0
    if (sys.carryOk && !deep && v > 120 && f.mode !== "ground") {
      _w.set(h.x, h.y, h.z).sub(sys.carryFrom).multiplyScalar(1 - 70 / v)
      for (let i = 0; i < PARTS; i++) if (sys.pLife[i] > 0) { const o = i * 3; sys.pBase[o] += _w.x; sys.pBase[o + 1] += _w.y; sys.pBase[o + 2] += _w.z }
      for (let i = 0; i < RIPS; i++) if (sys.qLife[i] > 0) { const o = i * 3; sys.qPos[o] += _w.x; sys.qPos[o + 1] += _w.y; sys.qPos[o + 2] += _w.z }
    }
    sys.carryFrom.set(h.x, h.y, h.z)
    carried = true
  }
  sys.carryOk = carried
  for (const h of horseRT.horses.values()) {
    if (!isPegasus(h) || !h.flight) continue
    const f = h.flight
    const kind = (f.skills ?? skillsOf(h.ident.breed))?.signature
    if (!kind) continue
    let tr = sys.traces.get(h.ident.id)
    if (!tr) {
      tr = { dashing: false, prevFlap: f.flap, cool: 0, lens: 0, rip: 0, burst: 0, acc: [0, 0, 0, 0], ripped: false, launched: false, release: -1 }
      sys.traces.set(h.ident.id, tr)
    }
    const prevFlap = tr.prevFlap
    tr.prevFlap = f.flap
    tr.cool -= dt
    const flying = h.visible && f.mode !== "ground"
    if (!flying || !emitterPoint(h, 0, B.wl) || !emitterPoint(h, 1, B.wr)) {
      tr.dashing = false
      tr.ripped = false
      tr.launched = false
      continue
    }
    // (on her sails Shift is a surge, starSail.ts: for Starborn that is her dash among the stars)
    const dashing = f.boostT > 0 || (kind === "starfall" && f.mode === "sail" && f.surge > 0.3)
    if (!dashing) tr.ripped = false
    B.c.copy(B.wl).add(B.wr).multiplyScalar(0.5)
    // along the flight path, not the heading: a launch throws its rings and wisps back down the climb
    B.fwd.set(fwdX(h.heading) * h.speed, f.mode === "air" ? f.vy : 0, fwdZ(h.heading) * h.speed)
    if (B.fwd.lengthSq() < 1e-4) B.fwd.set(fwdX(h.heading), 0, fwdZ(h.heading))
    B.fwd.normalize()
    // the wing's own axis, made to lie across the flight line: the spiral's plane
    B.side.copy(B.wr).sub(B.wl)
    B.side.addScaledVector(B.fwd, -B.side.dot(B.fwd))
    if (B.side.lengthSq() < 1e-6) B.side.set(1, 0, 0)
    B.side.normalize()
    B.up.crossVectors(B.fwd, B.side)
    B.speed = THREE.MathUtils.clamp(f.mode === "air" ? Math.hypot(h.speed, f.vy) : h.speed, -70, 70)
    if (deep) B.carry.copy(_drift)
    else B.carry.copy(B.fwd).multiplyScalar(B.speed)
    B.dist = Math.hypot(h.x - cam.position.x, h.z - cam.position.z)
    // the launch (Shift with Space, flight.ts) breaks out of the dash with an onset of its own, round the climb
    const launched = f.launch > 0.55
    const onset = (dashing && !tr.dashing) || (launched && !tr.launched)
    tr.dashing = dashing
    tr.launched = launched
    if (onset) {
      // A companion's dash is visible and audible nearby, but the camera's
      // acceleration belongs only to the mount carrying the active rider.
      if (h.rider === characterRT.active || h.passenger === characterRT.active) {
        sys.punchT = 0
        dashFxRT.kind = kind
      }
      onsetFx(sys, kind, dens, motion, full, launched)
      if (kind === "starfall") tr.release = 0.34
      dashSound.onset(kind, B.dist)
    }
    if (dashing) {
      dashFx(sys, tr, kind, dt, dens, motion, full, airless, prevFlap, f.flap)
      // a driving downstroke throws a pressure ring backward and thumps
      if (kind === "thunder" && tr.cool <= 0 && strokeCrossed(prevFlap, f.flap)) {
        tr.cool = 0.55
        spawnRing(sys, 1, PAL.gold, 1.2, 5.5, 1, 4, 0.38, B.c)
        dashSound.stroke(B.dist)
      }
      if (kind === "thunder" && full) { sys.coneOn = true; sys.coneC.copy(B.c).addScaledVector(B.fwd, -1); sys.coneFwd.copy(B.fwd) }
    }
  }
  dashFxRT.punch = sys.punchT < 3 ? onsetPunch(sys.punchT) * (reducedRT.on ? 0.35 : 1) : 0
  updateRings(sys, dt, A, motion)
  updateRips(sys, dt, A)
  updateParticles(sys, dt, A, motion)
  updateShells(sys, dt, A, full)
}

const updateRings = (sys: Sys, dt: number, A: THREE.Vector3, motion: number): void => {
  for (let i = 0; i < RINGS; i++) {
    const o = i * 3
    const life = sys.rLife[i]
    if (life <= 0) { sys.ringAlpha[i] = 0; continue }
    sys.rAge[i] += dt
    const u = sys.rAge[i] / life
    if (u >= 1) { sys.rLife[i] = 0; sys.ringAlpha[i] = 0; continue }
    sys.rPos[o] += sys.rVel[o] * dt; sys.rPos[o + 1] += sys.rVel[o + 1] * dt; sys.rPos[o + 2] += sys.rVel[o + 2] * dt
    const r = (sys.rR0[i] + (sys.rR1[i] - sys.rR0[i]) * ringGrowth(u)) * motion
    // fades with its distance to the lens, so a ring never sweeps across it
    const dc = Math.hypot(sys.rPos[o] - sys.cam.x, sys.rPos[o + 1] - sys.cam.y, sys.rPos[o + 2] - sys.cam.z)
    sys.ringAlpha[i] = sys.rStr[i] * ringFade(u) * nearCameraFade(dc, 1.5, 6)
    _q.set(sys.rQuat[i * 4], sys.rQuat[i * 4 + 1], sys.rQuat[i * 4 + 2], sys.rQuat[i * 4 + 3])
    _m.compose(_v.set(sys.rPos[o] - A.x, sys.rPos[o + 1] - A.y, sys.rPos[o + 2] - A.z), _q, _s.set(r, r, r))
    sys.rings.setMatrixAt(i, _m)
  }
  sys.rings.instanceMatrix.needsUpdate = true
  sys.ringAttr.alpha.needsUpdate = true
  sys.ringAttr.mode.needsUpdate = true
  sys.ringAttr.col.needsUpdate = true
}

const updateRips = (sys: Sys, dt: number, A: THREE.Vector3): void => {
  sys.ripMat.uniforms.uTime.value += dt
  for (let i = 0; i < RIPS; i++) {
    const o = i * 3
    const life = sys.qLife[i]
    if (life <= 0) { sys.ripAlpha[i] = 0; continue }
    sys.qAge[i] += dt
    const u = sys.qAge[i] / life
    if (u >= 1) { sys.qLife[i] = 0; sys.ripAlpha[i] = 0; continue }
    sys.qPos[o] += sys.qVel[o] * dt; sys.qPos[o + 1] += sys.qVel[o + 1] * dt; sys.qPos[o + 2] += sys.qVel[o + 2] * dt
    const at = _v.set(sys.qPos[o] - A.x, sys.qPos[o + 1] - A.y, sys.qPos[o + 2] - A.z)
    const fwd = _w.set(sys.qFwd[o], sys.qFwd[o + 1], sys.qFwd[o + 2])
    // from the rip to the lens, in the same render space as `at`
    const toCam = _t.copy(sys.cam).sub(A).sub(at)
    // billboard the slit: its length along the flight, its width across the view
    const side = _n.crossVectors(fwd, toCam).normalize()
    const nrm = _s2.crossVectors(side, fwd)
    const ripLen = sys.qLen[i] * (0.4 + 0.6 * Math.min(1, u * 4))
    _m.makeBasis(side.multiplyScalar(sys.qW[i]), fwd.multiplyScalar(ripLen), nrm)
    _m.setPosition(at)
    sys.rips.setMatrixAt(i, _m)
    sys.ripAlpha[i] = sys.qStr[i] * Math.min(1, u * 8) * (1 - u) ** 1.2 * nearCameraFade(toCam.length(), 1, 5) * 0.9
  }
  sys.rips.instanceMatrix.needsUpdate = true
  sys.ripAttr.alpha.needsUpdate = true
  sys.ripAttr.col.needsUpdate = true
  sys.ripAttr.seed.needsUpdate = true
}

const updateParticles = (sys: Sys, dt: number, A: THREE.Vector3, motion: number): void => {
  const cam = sys.cam
  for (let i = 0; i < PARTS; i++) {
    const o = i * 3
    if (sys.pLife[i] <= 0) { sys.pAlpha[i] = 0; sys.pSize[i] = 0; continue }
    sys.pAge[i] += dt
    const age = sys.pAge[i]
    const u = age / sys.pLife[i]
    if (u >= 1) { sys.pLife[i] = 0; sys.pAlpha[i] = 0; sys.pSize[i] = 0; continue }
    sys.pBase[o] += sys.pVel[o] * dt; sys.pBase[o + 1] += sys.pVel[o + 1] * dt; sys.pBase[o + 2] += sys.pVel[o + 2] * dt
    // a spiral about the flight line: the helix a wingtip leaves; zero for plain sparks
    const th = sys.pSpin[i * 4] + sys.pSpin[i * 4 + 1] * age
    const rad = sys.pSpin[i * 4 + 2] + sys.pSpin[i * 4 + 3] * age
    const cs = Math.cos(th) * rad, sn = Math.sin(th) * rad
    const bx = sys.pBase[o], by = sys.pBase[o + 1], bz = sys.pBase[o + 2]
    sys.pPos[o] = bx + sys.pSide[o] * cs + sys.pUp[o] * sn - A.x
    sys.pPos[o + 1] = by + sys.pSide[o + 1] * cs + sys.pUp[o + 1] * sn - A.y
    sys.pPos[o + 2] = bz + sys.pSide[o + 2] * cs + sys.pUp[o + 2] * sn - A.z
    const dc = Math.hypot(bx - cam.x, by - cam.y, bz - cam.z)
    // feathers and sparks flicker gently (about once a second), and die away
    const flick = 1 - 0.3 * (0.5 + 0.5 * Math.sin(age * 7 + sys.pSeed[i]))
    sys.pAlpha[i] = sys.pPeak[i] * Math.min(1, age * 8) * (1 - u) ** 1.3 * flick * nearCameraFade(dc)
    sys.pSize[i] = sys.pSizeBase[i] * motion * (1 - 0.4 * u)
  }
  sys.pGeo.getAttribute("position").needsUpdate = true
  sys.pGeo.getAttribute("aAlpha").needsUpdate = true
  sys.pGeo.getAttribute("aSize").needsUpdate = true
  // constellation lines: each link between the particle positions it joins, fading with its stars
  for (let j = 0; j < LINKS; j++) {
    const life = sys.lLife[j]
    const a = sys.lA[j], b = sys.lB[j]
    let alpha = 0
    if (life > 0) {
      sys.lAge[j] += dt
      const u = sys.lAge[j] / life
      if (u >= 1) sys.lLife[j] = 0
      else alpha = 0.7 * Math.min(1, u * 6) * (1 - u) ** 1.4 * Math.min(sys.pAlpha[a] > 0 ? 1 : 0, sys.pAlpha[b] > 0 ? 1 : 0)
    }
    sys.lAlpha[j * 2] = alpha
    sys.lAlpha[j * 2 + 1] = alpha
    for (let k = 0; k < 2; k++) {
      const p = (k ? b : a) * 3
      sys.lPos[(j * 2 + k) * 3] = sys.pPos[p]
      sys.lPos[(j * 2 + k) * 3 + 1] = sys.pPos[p + 1]
      sys.lPos[(j * 2 + k) * 3 + 2] = sys.pPos[p + 2]
    }
  }
  sys.lGeo.getAttribute("position").needsUpdate = true
  sys.lGeo.getAttribute("aAlpha").needsUpdate = true
}

const updateShells = (sys: Sys, dt: number, A: THREE.Vector3, full: boolean): void => {
  // the lensing bubble: swells on onset, then holds round her while the dash lasts
  sys.bubbleT += dt
  sys.bubbleA += ((sys.bubbleOn ? 1 : 0) - sys.bubbleA) * (1 - Math.exp(-dt * (sys.bubbleOn ? 5 : 2)))
  const bubbleA = full ? sys.bubbleA * (0.12 + 0.3 * onsetPunch(sys.bubbleT)) * (reducedRT.on ? 0.5 : 1) : 0
  sys.bubble.visible = bubbleA > 0.002
  sys.bubbleMat.uniforms.uA.value = bubbleA
  sys.bubble.position.copy(sys.bubbleC).sub(A)
  sys.bubble.scale.setScalar(0.85 + 0.15 * ringGrowth(Math.min(1, sys.bubbleT / 0.6)))
  // the golden cone: a shell that opens behind the wings on onset (a condensation cone, drawn)
  sys.coneT += dt
  sys.coneA += ((sys.coneOn ? 1 : 0) - sys.coneA) * (1 - Math.exp(-dt * (sys.coneOn ? 5 : 2)))
  const coneA = full ? sys.coneA * (0.06 + 0.22 * onsetPunch(sys.coneT)) * (reducedRT.on ? 0.6 : 1) : 0
  sys.cone.visible = coneA > 0.002
  sys.coneMat.uniforms.uA.value = coneA
  sys.cone.position.copy(sys.coneC).sub(A)
  sys.cone.quaternion.setFromUnitVectors(_y, sys.coneFwd)
  const grow = 0.5 + 0.5 * ringGrowth(Math.min(1, sys.coneT / 0.45))
  sys.cone.scale.set(grow, 1, grow)
}

/** The Pegasi's dashes: rings, wisps and shells, each in its own colours. */
export const DashFX = (): React.ReactElement => {
  const sys = useMemo(() => makeSystem(), [])
  useEffect(() => {
    const mq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null
    if (!mq) return
    const set = (): void => { reducedRT.on = mq.matches }
    set()
    mq.addEventListener("change", set)
    return () => mq.removeEventListener("change", set)
  }, [])
  useEffect(() => () => {
    sys.ringGeo.dispose(); sys.ringMat.dispose()
    sys.ripGeo.dispose(); sys.ripMat.dispose()
    sys.pGeo.dispose(); sys.pMat.dispose()
    sys.lGeo.dispose(); sys.lMat.dispose()
    sys.bubble.geometry.dispose(); sys.bubbleMat.dispose()
    sys.cone.geometry.dispose(); sys.coneMat.dispose()
  }, [sys])
  useFrame((state, rawDt) => frame(sys, state.camera, Math.min(rawDt, 0.05)))
  return <primitive object={sys.root} />
}
