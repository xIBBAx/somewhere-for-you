import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { characterRT } from "../runtime"
import { riderRT } from "./riding"
import { groundHeight } from "../world-layout"
import { flightWaterSurfaceAt } from "../../world/waterSurface"
import { emitterPoint } from "../pegasus/PegasusTrail"
import type { HorseState } from "./horseState"
import { qualityRT } from "../../state/qualityStore"
import { flightReducedMotion } from "../pegasus/flightCamera"
import { dashSound } from "../pegasus/dashAudio"
import { groundDashRT, type GroundDashKind } from "./groundDash"
import type { MountBody } from "../mounts/mount"

/**
 * Each mount's ground dash, drawn in the world around her (groundDash.ts says
 * when). One pool of GPU-drawn particles: every one is a camera-facing quad
 * stretched along its own motion on screen (a streak of air at speed, a
 * tumbling leaf when slow), or, for Starborn's hoofprints, a quad lying flat on
 * the ground. Positions are logical metres, so they stay in the world as she
 * runs on; nothing is attached to the camera or drawn on the screen.
 *
 *   gale   what a real galloping horse throws: clods of turf and soil flung up
 *          and back from each hoof strike on a true ballistic arc, tumbling as
 *          they fall, pale dust from the strike and a low haze hanging behind
 *          (air itself is invisible: the old white swirls read as drawn strips)
 *   grove  leaves torn up from the ground spiralling up in her wake, warm
 *          pollen motes, a green breath of air at each bound
 *   pearl  rose-pearl petals and a soft pearly mist
 *   ember  gold embers struck from the hooves, arcing and falling, cooling red
 *   star   a hoofprint of starlight at each strike that glows and fades, and
 *          stardust rising from it; a fine blue-white wake from mane and tail
 *
 * And for any Pegasus galloping on water (dash or not): spray thrown up at
 * each hoof strike and falling back, a ripple spreading from every footfall,
 * and a bow wave off her chest that grows with her speed, the spray glinting
 * with her own colour.
 *
 * Calm by design: nothing flashes; reduced motion halves the counts and slows
 * the swirl. One draw call; the pool is fixed and nothing allocates per frame.
 */

const POOL = 900
const _f = new THREE.Vector3()
const _r = new THREE.Vector3()
const _v = new THREE.Vector3()

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iCol;
attribute vec4 iMisc; // size, stretch, shape, spin
varying vec2 vUv;
varying vec4 vCol;
varying float vShape;
varying float vGlow;
void main() {
  vUv = position.xy;
  vCol = iCol;
  // shapes 10+ are light (stardust, embers, pollen, air): added to the scene, not painted over it
  vGlow = step(9.5, iMisc.z);
  float shape = iMisc.z - vGlow * 10.0;
  vShape = shape;
  float size = iMisc.x;
  if (shape > 2.5 && shape < 4.5) {
    // a hoofprint or a ripple: lies flat on the ground (or the water), turned to her heading
    float c = cos(iMisc.w), s = sin(iMisc.w);
    vec3 off = vec3(position.x * c - position.y * s, 0.0, position.x * s + position.y * c) * size;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(iPos + off, 1.0);
    return;
  }
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
  float sp = length(vv.xy);
  vec2 dir = sp > 1e-4 ? vv.xy / sp : vec2(cos(iMisc.w), sin(iMisc.w));
  // leaves and petals tumble (their own spin), air streaks follow their flight
  if ((shape > 0.5 && shape < 2.5) || shape > 4.5) dir = vec2(cos(iMisc.w), sin(iMisc.w));
  vec2 side = vec2(-dir.y, dir.x);
  float len = size + sp * iMisc.y;
  mv.xy += dir * position.x * len + side * position.y * size;
  gl_Position = projectionMatrix * mv;
}
`

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vCol;
varying float vShape;
varying float vGlow;
void main() {
  vec2 p = vUv;
  float a;
  if (vShape < 0.5) {
    // air, dust, motes: a soft streak, brightest along its spine
    a = exp(-p.y * p.y * 5.0) * (1.0 - smoothstep(0.55, 1.0, abs(p.x)));
  } else if (vShape < 1.5) {
    // a leaf: a pointed ellipse with a darker midrib
    float w = (1.0 - p.x * p.x) * 0.55;
    a = smoothstep(w, w - 0.12, abs(p.y));
    a *= 1.0 - 0.35 * exp(-p.y * p.y * 400.0);
  } else if (vShape < 2.5) {
    // a petal: rounded, cupped (brighter edge)
    float r = length(p * vec2(1.0, 1.45));
    a = smoothstep(1.0, 0.82, r) * (0.75 + 0.25 * r);
  } else if (vShape > 6.5) {
    // a droplet: round, a bright core in a soft rim
    float d = dot(p, p);
    a = exp(-d * 4.0) * (1.0 - smoothstep(0.7, 1.0, d));
  } else if (vShape > 5.5) {
    // a clod of soil or turf: an irregular lump, a little darker at its rim
    float ang = atan(p.y, p.x);
    float r = length(p) * (1.0 + 0.16 * sin(ang * 3.0 + 1.3) + 0.09 * sin(ang * 5.0 + 0.4));
    a = smoothstep(0.95, 0.75, r);
  } else if (vShape > 4.5) {
    // a small feather: a slim vane either side of a pale shaft, tapering to the tip
    float t = p.x * 0.5 + 0.5;
    float w = 0.42 * sin(3.14159 * pow(t, 0.8)) * (1.0 - 0.25 * t);
    a = smoothstep(w, w - 0.08, abs(p.y)) * smoothstep(1.0, 0.92, abs(p.x));
    a = max(a, exp(-p.y * p.y * 900.0) * step(abs(p.x), 1.0) * 0.9);
  } else if (vShape > 3.5) {
    // a ripple on the water: a thin ring with a soft inner swell
    float r = length(p);
    // (a soft swell catching the light, brightest on its outer crest, never a drawn hoop)
    a = exp(-pow((r - 0.75) / 0.22, 2.0)) * 0.45;
  } else {
    // a hoofprint of starlight: a crescent, glowing at its rim
    float r = length(p * vec2(1.0, 0.85));
    float ring = exp(-pow((r - 0.62) / 0.16, 2.0));
    float cut = smoothstep(-0.55, -0.25, p.y);
    a = (ring * 0.9 + exp(-r * r * 3.0) * 0.25) * cut;
  }
  a *= vCol.a;
  if (a < 0.004) discard;
  // premultiplied: matter covers (alpha a); light mostly adds, but also
  // covers a little, so gold sparks and starlight still read against bright
  // grass and sky by day instead of vanishing into it
  gl_FragColor = vec4(vCol.rgb * a * (1.0 + vGlow * 0.8), a * (1.0 - vGlow * 0.6));
}
`

type Pool = {
  mesh: THREE.Mesh
  geo: THREE.InstancedBufferGeometry
  mat: THREE.ShaderMaterial
  pos: Float32Array
  vel: Float32Array
  col: Float32Array
  misc: Float32Array
  /** per particle: age, life, base alpha, swirl rate, axis xz (2), gravity, drag, spin rate, base size, grow */
  st: Float32Array
  next: number
}
const ST = 11

const build = (): Pool => {
  const geo = new THREE.InstancedBufferGeometry()
  geo.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3))
  geo.setIndex([0, 1, 2, 0, 2, 3])
  const pos = new Float32Array(POOL * 3), vel = new Float32Array(POOL * 3), col = new Float32Array(POOL * 4), misc = new Float32Array(POOL * 4)
  geo.setAttribute("iPos", new THREE.InstancedBufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage))
  geo.setAttribute("iVel", new THREE.InstancedBufferAttribute(vel, 3).setUsage(THREE.DynamicDrawUsage))
  geo.setAttribute("iCol", new THREE.InstancedBufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage))
  geo.setAttribute("iMisc", new THREE.InstancedBufferAttribute(misc, 4).setUsage(THREE.DynamicDrawUsage))
  geo.instanceCount = POOL
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.NormalBlending, premultipliedAlpha: true })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = 7
  mesh.name = "ground-dash"
  return { mesh, geo, mat, pos, vel, col, misc, st: new Float32Array(POOL * ST), next: 0 }
}

type Spawn = {
  x: number; y: number; z: number; vx: number; vy: number; vz: number
  color: THREE.Color; alpha: number; life: number; size: number; stretch: number; shape: number
  swirl?: number; gravity?: number; drag?: number; spin?: number; angle?: number; grow?: number
  /** additive-looking glow: the colour is premultiplied as light (alpha kept low) */
  glow?: boolean
}

const spawn = (P: Pool, s: Spawn): void => {
  const i = P.next
  P.next = (i + 1) % POOL
  P.pos.set([s.x, s.y, s.z], i * 3)
  P.vel.set([s.vx, s.vy, s.vz], i * 3)
  P.col.set([s.color.r, s.color.g, s.color.b, 0], i * 4)
  P.misc.set([s.size, s.stretch, s.shape + (s.glow ? 10 : 0), s.angle ?? 0], i * 4)
  const o = i * ST
  P.st[o] = 0
  P.st[o + 1] = s.life
  P.st[o + 2] = s.alpha
  P.st[o + 3] = s.swirl ?? 0
  // the swirl's axis: her line of running at the moment it was shed
  P.st[o + 4] = _f.x
  P.st[o + 5] = _f.z
  P.st[o + 6] = s.gravity ?? 0
  P.st[o + 7] = s.drag ?? 1.5
  P.st[o + 8] = s.spin ?? 0
  P.st[o + 9] = s.size
  P.st[o + 10] = s.grow ?? 0
}

const C = {
  soil: new THREE.Color("#5a4330"),
  soilDark: new THREE.Color("#3e2e21"),
  turf: new THREE.Color("#4e5a2a"),
  dust: new THREE.Color("#b49c7c"),
  leafA: new THREE.Color("#6f9a3c"),
  leafB: new THREE.Color("#c9a03a"),
  leafC: new THREE.Color("#a2c25a"),
  pollen: new THREE.Color("#fff0a8"),
  breeze: new THREE.Color("#dff5d0"),
  petal: new THREE.Color("#ffc6dc"),
  pearl: new THREE.Color("#fff3f6"),
  gold: new THREE.Color("#ffc25a"),
  goldHot: new THREE.Color("#fff1c4"),
  starPrint: new THREE.Color("#bcd2ff"),
  printGlow: new THREE.Color("#6f95ff"),
  star: new THREE.Color("#eef3ff"),
  spray: new THREE.Color("#eef7ff"),
  featherIvory: new THREE.Color("#f6dfe8"),
  featherOnyx: new THREE.Color("#8a5a2e"),
  featherStarborn: new THREE.Color("#3a3f9a"),
  ripple: new THREE.Color("#d8ecff"),
}

/** The four hooves of a galloping mount, from her stride phase (rotary gallop footfalls). */
const HOOF_PHASE = [0.0, 0.12, 0.5, 0.62]
const hoof = (h: MountBody, k: number, out: THREE.Vector3): THREE.Vector3 => {
  const s = h.ident.scale
  const fx = Math.sin(h.heading), fz = Math.cos(h.heading)
  const along = (k < 2 ? 0.75 : -0.85) * s * (h.kind === "deer" ? 0.7 : 1)
  const side = (k % 2 === 0 ? 0.22 : -0.22) * s
  out.set(h.x + fx * along + fz * side, 0, h.z + fz * along - fx * side)
  out.y = groundHeight(out.x, out.z)
  return out
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a)

export const GroundDashFX = (): React.ReactElement => {
  const P = useMemo(() => build(), [])
  const strides = useMemo(() => ({ last: 0, kind: null as GroundDashKind | null, emit: 0, waterLast: 0, wave: 0, feather: 0 }), [])
  useEffect(() => () => { P.geo.dispose(); P.mat.dispose() }, [P])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const r = riderRT[characterRT.active]
    const h = r.phase === "riding" ? r.horse : null
    const want = h && groundDashRT.on ? 1 : 0
    groundDashRT.amount += (want - groundDashRT.amount) * (1 - Math.exp(-dt * (want ? 3 : 2)))
    if (want && groundDashRT.since === 0 && h) {
      const kind = groundDashRT.kind
      if (kind === "pearl") dashSound.onset("swift", 0)
      else if (kind === "ember") dashSound.onset("thunder", 0)
      else if (kind === "star") dashSound.onset("starfall", 0)
      else dashSound.ground(kind === "grove" ? "grove" : "gale")
    }
    groundDashRT.since = want ? groundDashRT.since + 1 : 0
    const calm = flightReducedMotion()
    const density = (qualityRT.level === "low" ? 0.45 : qualityRT.level === "medium" ? 0.75 : 1) * (calm ? 0.5 : 1)
    const A = groundDashRT.amount
    // ---- a loose feather now and then from the wings of a Pegasus in flight:
    // rare in an easy cruise, more in a dash, a hard turn or a powerful
    // stroke; it tumbles and flutters down on the air (drag, a slow spiral),
    // and a star-born feather fades into starlight as it falls
    const fl = h ? (h as HorseState).flight : null
    if (h && fl && (fl.mode === "air" || fl.mode === "landing" || fl.mode === "takeoff") && h.kind === "horse") {
      const effort = Math.min(1, 0.06 + (fl.boostT > 0 ? 0.7 : 0) + Math.abs(fl.roll) * 0.5 + fl.power * 0.25 + (fl.trick.kind ? 0.4 : 0))
      strides.feather += dt * effort * 0.9 * (calm ? 0.5 : 1)
      if (strides.feather >= 1) {
        strides.feather -= 1 + Math.random() * 0.6
        if (emitterPoint(h as HorseState, Math.random() < 0.5 ? 0 : 1, _v)) {
          const breed = (h.ident as { breed?: string }).breed
          const star = breed === "starborn"
          const col = star ? C.featherStarborn : breed === "onyx" ? C.featherOnyx : C.featherIvory
          const fx = Math.sin(h.heading), fz = Math.cos(h.heading)
          _f.set(fx, 0, fz)
          spawn(P, { x: _v.x, y: _v.y, z: _v.z, vx: fx * h.speed * 0.25 + rand(-0.6, 0.6), vy: rand(-0.2, 0.6), vz: fz * h.speed * 0.25 + rand(-0.6, 0.6), color: col, alpha: 0.95, life: star ? rand(2.4, 3.4) : rand(4, 6), size: rand(0.07, 0.1) * h.ident.scale, stretch: 0, shape: 5, gravity: 0.7, drag: 2.6, swirl: (Math.random() < 0.5 ? -1 : 1) * rand(1.5, 3), spin: rand(-3, 3), angle: rand(0, 6.28) })
          if (star) spawn(P, { x: _v.x, y: _v.y, z: _v.z, vx: fx * h.speed * 0.25, vy: 0.2, vz: fz * h.speed * 0.25, color: C.star, alpha: 0.6, life: 2.4, size: 0.04 * h.ident.scale, stretch: 0.05, shape: 0, gravity: 0.5, drag: 2.6, glow: true })
        }
      }
    }
    // ---- a Pegasus running on the water: spray at each hoof, ripples spreading, a bow wave
    const flier = h && (h as { flight?: { mode: string } | null }).flight
    const wsurf = h ? flightWaterSurfaceAt(h.x, h.z) : null
    const onWater = !!flier && flier.mode === "ground" && wsurf !== null && wsurf > groundHeight(h!.x, h!.z) + 0.15 && Math.abs(h!.y - wsurf) < 0.3 && Math.abs(h!.speed) > 1.5
    if (h && onWater && wsurf !== null) {
      const kind = groundDashRT.kind
      const tint = kind === "star" ? C.starPrint : kind === "pearl" ? C.petal : kind === "ember" ? C.goldHot : C.spray
      const v = Math.abs(h.speed), s = h.ident.scale
      _f.set(Math.sin(h.heading), 0, Math.cos(h.heading))
      _r.set(_f.z, 0, -_f.x)
      const stride = ((h as { animator?: { stride: number } | null }).animator?.stride ?? (performance.now() / 420) % 1) % 1
      for (let k = 0; k < 4; k++) {
        const ph = HOOF_PHASE[k]
        const last = strides.waterLast
        if (!((last < ph && stride >= ph) || (last > stride && (ph > last || ph <= stride)))) continue
        hoof(h, k, _v)
        _v.y = wsurf
        spawn(P, { x: _v.x, y: _v.y + 0.02, z: _v.z, vx: 0, vy: 0, vz: 0, color: C.ripple, alpha: 0.03 + 0.08 * (1 - Math.min(1, Math.max(0, (v - 4) / 8))), life: 1.8, size: 0.3 * s, stretch: 0, shape: 4, angle: 0, drag: 0, grow: 4 })
        // droplets, round and falling back (stretched, they read as scratches)
        const n = Math.round((5 + v * 0.45) * density)
        for (let m = 0; m < n; m++) {
          spawn(P, { x: _v.x + rand(-0.15, 0.15), y: _v.y + 0.05, z: _v.z + rand(-0.15, 0.15), vx: -_f.x * v * rand(0.05, 0.25) + _r.x * rand(-1.4, 1.4), vy: rand(1.5, 3.2 + v * 0.08), vz: -_f.z * v * rand(0.05, 0.25) + _r.z * rand(-1.4, 1.4), color: m % 4 === 0 ? tint : C.spray, alpha: 0.7, life: rand(0.45, 0.8), size: rand(0.022, 0.045) * s, stretch: 0, shape: 7, gravity: 9.8, drag: 0.5 })
        }
        // the splash crown: a puff of white water and mist where the hoof went in
        for (let m = 0; m < 2; m++) spawn(P, { x: _v.x + rand(-0.1, 0.1), y: _v.y + 0.06, z: _v.z + rand(-0.1, 0.1), vx: -_f.x * v * 0.1 + _r.x * rand(-0.4, 0.4), vy: rand(0.5, 1.1), vz: -_f.z * v * 0.1 + _r.z * rand(-0.4, 0.4), color: C.spray, alpha: 0.2, life: rand(0.35, 0.55), size: rand(0.16, 0.26) * s, stretch: 0.01, shape: 0, gravity: 3, drag: 2, grow: 0.9 })
      }
      strides.waterLast = stride
      // the bow wave, growing with speed: white water heaped at her chest and
      // carried along with her, a fan of droplets thrown out to each side,
      // and foam left along her flanks spreading into the wake
      strides.wave += dt * Math.min(70, v * 4) * density
      while (strides.wave >= 1) {
        strides.wave -= 1
        const side = Math.random() < 0.5 ? -1 : 1
        const cx = h.x + _f.x * 0.9 * s + _r.x * side * 0.3 * s
        const cz = h.z + _f.z * 0.9 * s + _r.z * side * 0.3 * s
        const roll = Math.random()
        if (roll < 0.45) {
          spawn(P, { x: cx, y: wsurf + 0.05, z: cz, vx: _r.x * side * rand(1, 2.5) + _f.x * v * 0.3, vy: rand(0.8, 1.6 + v * 0.05), vz: _r.z * side * rand(1, 2.5) + _f.z * v * 0.3, color: C.spray, alpha: 0.6, life: rand(0.4, 0.7), size: rand(0.025, 0.05) * s, stretch: 0, shape: 7, gravity: 9.8, drag: 0.8 })
        } else if (roll < 0.75) {
          // the heap at the chest moves at nearly her speed: it is pushed, not left
          spawn(P, { x: cx, y: wsurf + 0.07, z: cz, vx: _r.x * side * rand(0.6, 1.4) + _f.x * v * 0.85, vy: rand(0.1, 0.4), vz: _r.z * side * rand(0.6, 1.4) + _f.z * v * 0.85, color: C.spray, alpha: 0.3 * Math.min(1, v / 8), life: rand(0.25, 0.4), size: rand(0.22, 0.38) * s, stretch: 0.008, shape: 0, gravity: 1, drag: 1.2, grow: 0.6 })
        } else {
          // foam on the flank, left behind and drifting outward
          const fx = h.x + _f.x * rand(-0.8, 0.6) * s + _r.x * side * 0.45 * s
          const fz = h.z + _f.z * rand(-0.8, 0.6) * s + _r.z * side * 0.45 * s
          spawn(P, { x: fx, y: wsurf + 0.03, z: fz, vx: _r.x * side * rand(0.4, 0.9), vy: 0, vz: _r.z * side * rand(0.4, 0.9), color: C.ripple, alpha: 0.08 * Math.min(1, v / 8), life: rand(0.9, 1.4), size: rand(0.25, 0.4) * s, stretch: 0.006, shape: 0, drag: 1.5, grow: 1.2 })
        }
      }
    } else if (h && wsurf !== null && ((h as { wade?: number }).wade ?? 0) > 0.08 && Math.abs(h.speed) > 0.3) {
      // wading (any mount, any gait): each hoof that goes in sets a soft
      // ripple spreading from it and, faster, kicks up a few droplets
      const v = Math.abs(h.speed), s = h.ident.scale
      _f.set(Math.sin(h.heading), 0, Math.cos(h.heading))
      _r.set(_f.z, 0, -_f.x)
      const stride = ((h as { animator?: { stride: number } | null }).animator?.stride ?? (performance.now() / 420) % 1) % 1
      for (let k = 0; k < 4; k++) {
        const ph = HOOF_PHASE[k]
        const last = strides.waterLast
        if (!((last < ph && stride >= ph) || (last > stride && (ph > last || ph <= stride)))) continue
        hoof(h, k, _v)
        spawn(P, { x: _v.x, y: wsurf + 0.02, z: _v.z, vx: 0, vy: 0, vz: 0, color: C.ripple, alpha: 0.1, life: 1.6, size: 0.22 * s, stretch: 0, shape: 4, angle: 0, drag: 0, grow: 3 })
        const n = Math.round(Math.min(10, v * 1.2) * density)
        for (let m = 0; m < n; m++) spawn(P, { x: _v.x + rand(-0.1, 0.1), y: wsurf + 0.04, z: _v.z + rand(-0.1, 0.1), vx: -_f.x * v * rand(0.05, 0.2) + _r.x * rand(-0.9, 0.9), vy: rand(0.8, 1.6 + v * 0.12), vz: -_f.z * v * rand(0.05, 0.2) + _r.z * rand(-0.9, 0.9), color: C.spray, alpha: 0.65, life: rand(0.35, 0.6), size: rand(0.018, 0.035) * s, stretch: 0, shape: 7, gravity: 9.8, drag: 0.5 })
      }
      strides.waterLast = stride
    } else strides.waterLast = 0
    if (h && A > 0.02) {
      const kind = groundDashRT.kind ?? "gale"
      strides.kind = kind
      _f.set(Math.sin(h.heading), 0, Math.cos(h.heading))
      _r.set(_f.z, 0, -_f.x)
      const v = Math.abs(h.speed)
      const s = h.ident.scale
      const ground = groundHeight(h.x, h.z)
      // hoof strikes: from the stride phase of the gait animation
      const stride = ((h as { animator?: { stride: number } | null }).animator?.stride ?? (performance.now() / 420) % 1) % 1
      for (let k = 0; k < 4; k++) {
        const ph = HOOF_PHASE[k]
        const crossed = (strides.last < ph && stride >= ph) || (strides.last > stride && (ph > strides.last || ph <= stride))
        if (!crossed || Math.random() > A * density + 0.15) continue
        hoof(h, k, _v)
        if (kind === "gale") {
          for (let n = 0; n < 3; n++) spawn(P, { x: _v.x + rand(-0.2, 0.2), y: _v.y + 0.05, z: _v.z + rand(-0.2, 0.2), vx: -_f.x * v * 0.15 + rand(-0.8, 0.8), vy: rand(0.6, 1.6), vz: -_f.z * v * 0.15 + rand(-0.8, 0.8), color: C.dust, alpha: 0.26 * A, life: rand(0.8, 1.3), size: rand(0.3, 0.55) * s, stretch: 0.05, shape: 0, drag: 2.5, grow: 1.6 })
          // the hoof breaks the turf: clods flung up and back, falling under
          // gravity, gone when they reach the ground again
          const clods = 3 + Math.floor(Math.random() * 4)
          for (let n = 0; n < clods; n++) {
            const vy = rand(1.8, 3.8)
            const fall = (vy + Math.sqrt(vy * vy + 2 * 9.8 * 0.06)) / 9.8
            const turf = Math.random() < 0.4
            spawn(P, { x: _v.x + rand(-0.08, 0.08), y: _v.y + 0.06, z: _v.z + rand(-0.08, 0.08), vx: -_f.x * v * rand(0.25, 0.45) + _r.x * rand(-0.7, 0.7), vy, vz: -_f.z * v * rand(0.25, 0.45) + _r.z * rand(-0.7, 0.7), color: turf ? C.turf : Math.random() < 0.5 ? C.soil : C.soilDark, alpha: A, life: fall * 1.05, size: rand(0.045, 0.1) * s, stretch: 0, shape: 6, gravity: 9.8, drag: 0.25, spin: rand(-14, 14), angle: rand(0, 6.28) })
          }
        } else if (kind === "grove") {
          for (let n = 0; n < 3; n++) {
            const leaf = Math.random() < 0.5 ? C.leafA : Math.random() < 0.5 ? C.leafB : C.leafC
            spawn(P, { x: _v.x + rand(-0.3, 0.3), y: _v.y + 0.08, z: _v.z + rand(-0.3, 0.3), vx: -_f.x * v * 0.2 + _r.x * rand(-1.5, 1.5), vy: rand(1.4, 3.2), vz: -_f.z * v * 0.2 + _r.z * rand(-1.5, 1.5), color: leaf, alpha: 0.95 * A, life: rand(1.6, 2.6), size: rand(0.1, 0.16) * s, stretch: 0, shape: 1, swirl: rand(2.5, 4), gravity: 1.6, drag: 1.6, spin: rand(-7, 7), angle: rand(0, 6.28) })
          }
          spawn(P, { x: _v.x, y: _v.y + 0.3, z: _v.z, vx: -_f.x * v * 0.3, vy: 0.6, vz: -_f.z * v * 0.3, color: C.breeze, alpha: 0.18 * A, life: 0.8, size: 0.5 * s, stretch: 0.06, shape: 0, swirl: 3, drag: 2, grow: 1.2 })
        } else if (kind === "ember") {
          for (let n = 0; n < 6; n++) spawn(P, { x: _v.x, y: _v.y + 0.05, z: _v.z, vx: -_f.x * v * 0.1 + rand(-1.8, 1.8), vy: rand(2.2, 4.6), vz: -_f.z * v * 0.1 + rand(-1.8, 1.8), color: n % 2 ? C.gold : C.goldHot, alpha: A, life: rand(0.8, 1.4), size: rand(0.07, 0.1) * s, stretch: 0.09, shape: 0, gravity: 7, drag: 0.6, glow: true })
        } else if (kind === "star") {
          // the print stays where the hoof was; stardust lifts off it
          spawn(P, { x: _v.x, y: _v.y + (onWater ? 0.03 : 0.1), z: _v.z, vx: 0, vy: 0, vz: 0, color: C.starPrint, alpha: A, life: 3.4, size: 0.55 * s, stretch: 0, shape: 3, angle: h.heading, drag: 0, glow: true })
          // the print's light rises through the grass blades round it (a flat
          // print alone is hidden by grass), and stardust lifts off it: tiny
          // round glints, not streaks
          spawn(P, { x: _v.x, y: _v.y + 0.12, z: _v.z, vx: 0, vy: 0, vz: 0, color: C.printGlow, alpha: 0.42 * A, life: 2.2, size: 0.16 * s, stretch: 0, shape: 0, angle: 0, drag: 0, glow: true })
          for (let n = 0; n < 5; n++) spawn(P, { x: _v.x + rand(-0.18, 0.18), y: _v.y + 0.12, z: _v.z + rand(-0.18, 0.18), vx: rand(-0.25, 0.25), vy: rand(0.4, 1.1), vz: rand(-0.25, 0.25), color: C.star, alpha: A, life: rand(1.4, 2.4), size: rand(0.022, 0.04) * s, stretch: 0.01, shape: 0, gravity: -0.1, drag: 1.6, glow: true })
        } else if (kind === "pearl") {
          spawn(P, { x: _v.x, y: _v.y + 0.1, z: _v.z, vx: -_f.x * v * 0.2, vy: rand(0.5, 1.2), vz: -_f.z * v * 0.2, color: C.pearl, alpha: 0.22 * A, life: 1.2, size: 0.45 * s, stretch: 0.04, shape: 0, drag: 2.2, grow: 1.6 })
        }
      }
      strides.last = stride
      // continuous: the swirls and wakes along her body. Whatever she sheds
      // leaves her carried forward at part of her speed and slows in the air,
      // so she outruns it and it falls behind as a trail (thrown backwards at
      // speed it streaked past the camera like drawn speed lines)
      strides.emit += dt * A * density * (kind === "gale" ? 4 : kind === "grove" ? 14 : kind === "pearl" ? 18 : kind === "star" ? 22 : 10)
      while (strides.emit >= 1) {
        strides.emit -= 1
        const side = Math.random() < 0.5 ? -1 : 1
        const along = rand(-0.9, 0.9) * s
        const up = rand(0.3, 1.5) * s
        const x = h.x + _f.x * along + _r.x * side * rand(0.45, 0.8) * s
        const z = h.z + _f.z * along + _r.z * side * rand(0.45, 0.8) * s
        const y = ground + up
        if (kind === "gale") {
          // the dust she raised, hanging low behind her and drifting apart
          spawn(P, { x: h.x - _f.x * rand(0.6, 1.2) * s + _r.x * side * rand(0, 0.4) * s, y: ground + rand(0.05, 0.35) * s, z: h.z - _f.z * rand(0.6, 1.2) * s + _r.z * side * rand(0, 0.4) * s, vx: _f.x * v * 0.12 + _r.x * side * 0.3, vy: rand(0.05, 0.3), vz: _f.z * v * 0.12 + _r.z * side * 0.3, color: C.dust, alpha: 0.06, life: rand(1.2, 1.8), size: rand(0.4, 0.7) * s, stretch: 0.02, shape: 0, swirl: calm ? 0 : side * 0.6, drag: 1.6, grow: 1.4 })
        } else if (kind === "grove") {
          spawn(P, { x, y, z, vx: _f.x * v * 0.2, vy: rand(0.2, 0.9), vz: _f.z * v * 0.2, color: C.pollen, alpha: 0.8, life: rand(1.2, 2), size: 0.04 * s, stretch: 0.04, shape: 0, swirl: side * 3, drag: 1.4, gravity: -0.15, glow: true })
        } else if (kind === "pearl") {
          spawn(P, { x, y, z, vx: _f.x * v * 0.2 + rand(-0.5, 0.5), vy: rand(0.2, 1), vz: _f.z * v * 0.2 + rand(-0.5, 0.5), color: C.petal, alpha: 0.9, life: rand(1.4, 2.2), size: rand(0.07, 0.11) * s, stretch: 0, shape: 2, swirl: side * 2.5, gravity: 0.8, drag: 1.8, spin: rand(-5, 5), angle: rand(0, 6.28) })
        } else if (kind === "star") {
          // a fine starlit wake from her mane and tail
          const back = Math.random() < 0.5 ? -1.1 : 0.7
          spawn(P, { x: h.x + _f.x * back * s, y: ground + rand(1.3, 1.9) * s, z: h.z + _f.z * back * s, vx: _f.x * v * 0.2, vy: rand(0, 0.4), vz: _f.z * v * 0.2, color: C.star, alpha: 0.6, life: rand(0.6, 1.1), size: 0.045 * s, stretch: 0.03, shape: 0, drag: 1.4, glow: true })
        } else {
          spawn(P, { x: h.x + _f.x * 0.2 * s, y: ground + rand(1.0, 1.6) * s, z: h.z + _f.z * 0.2 * s, vx: _f.x * v * 0.2, vy: 0.3, vz: _f.z * v * 0.2, color: C.goldHot, alpha: 0.12, life: 0.7, size: 0.4 * s, stretch: 0.05, shape: 0, drag: 2, grow: 0.8 })
        }
      }
    } else strides.last = 0
    // ---- integrate
    let live = 0
    for (let i = 0; i < POOL; i++) {
      const o = i * ST
      const life = P.st[o + 1]
      if (life <= 0) continue
      const age = (P.st[o] += dt)
      const u = age / life
      const a4 = i * 4
      if (u >= 1) { P.st[o + 1] = 0; P.col[a4 + 3] = 0; continue }
      live++
      const p3 = i * 3
      let vx = P.vel[p3], vy = P.vel[p3 + 1], vz = P.vel[p3 + 2]
      const swirl = P.st[o + 3]
      if (swirl !== 0) {
        // turn the velocity about the axis it was shed along: a helix round her line
        const ax = P.st[o + 4], az = P.st[o + 5]
        const w = swirl * dt
        // axis × v, with the axis lying in the ground plane
        const cx = -az * vy, cy = az * vx - ax * vz, cz = ax * vy
        vx += cx * w; vy += cy * w; vz += cz * w
      }
      const drag = Math.exp(-P.st[o + 7] * dt)
      vx *= drag; vz *= drag; vy = vy * drag - P.st[o + 6] * dt
      P.vel[p3] = vx; P.vel[p3 + 1] = vy; P.vel[p3 + 2] = vz
      P.pos[p3] += vx * dt; P.pos[p3 + 1] += vy * dt; P.pos[p3 + 2] += vz * dt
      const fade = Math.min(1, u * 8) * (1 - u) * (1 - u)
      P.col[a4 + 3] = P.st[o + 2] * fade
      P.misc[a4] = P.st[o + 9] * (1 + P.st[o + 10] * u)
      P.misc[a4 + 3] += P.st[o + 8] * dt
      if (P.misc[a4 + 2] % 10 === 0 && P.st[o + 6] > 3 && P.st[o + 6] < 8) {
        // embers cool from gold to red as they fall
        P.col[a4 + 1] = Math.max(0.3, P.col[a4 + 1] - dt * 0.5)
        P.col[a4 + 2] = Math.max(0.1, P.col[a4 + 2] - dt * 0.6)
      }
    }
    P.mesh.visible = live > 0
    if (!live) return
    for (const k of ["iPos", "iVel", "iCol", "iMisc"]) (P.geo.getAttribute(k) as THREE.InstancedBufferAttribute).needsUpdate = true
  })

  return <primitive object={P.mesh} />
}
