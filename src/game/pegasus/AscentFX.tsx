import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { cameraRT } from "../runtime"
import { useGame } from "../../state/gameStore"
import { useDiscoveries } from "../../state/discoveryStore"
import { sfx } from "../audio/audio"
import { spaceRT } from "../celestial/spaceState"
import { travelRT } from "../celestial/cosmicTravel"
import { DATUM_Y, KARMAN, KM, EARTH_SCALE, SAIL_ALTITUDE, realAirDensity } from "../celestial/scale"
import { mountQuaternion, tiltPivot } from "../horses/riding"
import type { HorseState } from "../horses/horseState"

/**
 * Going up, and coming down, through the top of the air on Starborn. What is
 * real and what is Starborn's magic are kept apart:
 *
 * Real (and only when the physics says so):
 * - Airglow, the thin green thread of oxygen light ~95 km up along the night
 *   limb (celestial/render/bodyShader.ts).
 * - The Kármán line, 100 km: a convention for where spaceflight begins, not
 *   an edge (the air thins on above it). Said once, plainly, as a card.
 * - A glowing shock layer ahead of her only when she moves through air fast
 *   enough to heat it to incandescence (≳4.5–7.5 km/s) in air dense enough
 *   for a shock to form (below ~110 km): a fast return from space. Never on
 *   an ordinary climb (starSail.ts keeps the climb under ~4.2 km/s).
 * - Re-entry (celestial/cosmicTravel.ts): the same layer, held at travelRT.heat
 *   while Starborn falls home, so the glow there is this one.
 *
 * Magic (Starborn's starlight, always blue-white, never mistaken for fire):
 * - At ~60 km, where wings stop finding air, her feathers become sails of
 *   starlight: a soft shimmer.
 * - At ~110 km, free of the air at last, the sails catch the full light of
 *   the stars: a ring of starlight runs out through the plane of her wings,
 *   a flash at her heart, sparks, her trail flares, and she is away.
 * - Folding the sails back into wings on the way down: a softer pulse.
 */

/** Free of the air: from here the sail runs free (starSail.ts airSpeedCap lifts from ~108 km). */
export const FREE_ALT = 110 * KM

/** Read by the trail: a flare of light that runs out along it after a release (0..1, decaying). */
export const ascentRT = {
  flare: 0,
  /** QA (`__worldDev.release(soft)`): fire a release now, wherever she is; parts to leave out (bisecting) */
  qa: null as boolean | null,
  qaHide: { rings: false, flash: false, sparks: false },
  /** QA (`__worldDev.shock(heat)`): hold the shock layer at this glow (0..1) in flight over Earth; null = physics */
  qaHeat: null as number | null,
}

/**
 * How brightly the air ahead glows (0..1) at a height over Earth's datum
 * and a speed through the air (both game units). Incandescence needs a
 * stagnation temperature of several thousand kelvin (speed), and a shock
 * layer needs continuum flow (density); brighter in denser air.
 */
export const shockGlow = (altitudeOverDatum: number, speed: number): number => {
  const kms = (speed * EARTH_SCALE) / 1000
  const rho = realAirDensity((Math.max(0, altitudeOverDatum) * EARTH_SCALE) / 1000)
  const s = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  const hot = s(4.5, 7.5, kms)
  // a shock layer needs continuum flow: a mean free path well under her few
  // metres, i.e. below ~105 km (above it the air is molecules, not a fluid)
  const continuum = s(1e-7, 6e-7, rho)
  const dense = Math.min(1, Math.max(0, 0.35 + 0.16 * Math.log10(rho / 1e-6)))
  return hot * continuum * dense
}

const SPARKS = 160

const RING_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
/**
 * A ring of starlight running out through the plane of the wings: a sharp
 * leading edge with a fading wake of light inside it, uneven along its
 * length (arcs and fine filaments, as real light fronts are never a perfect
 * line) and a faint violet fringe outside the blue-white.
 */
const RING_FRAG = /* glsl */ `
uniform float uR;
uniform float uW;
uniform float uLife;
uniform float uSeed;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vP;
void main() {
  float d = length(vP);
  if (d > 1.0) discard;
  float x = (d - uR) / uW;
  float ang = atan(vP.y, vP.x);
  // the front itself, and the light it leaves behind it (inside), fading inward
  // a soft front, never a drawn line, and fainter as it spreads
  float front = exp(-x * x * 2.6);
  float hot = exp(-x * x * 18.0);
  float wake = x < 0.0 ? exp(x * 0.55) * 0.22 * smoothstep(-0.2, 0.0, d - 0.02) : 0.0;
  // broken into arcs drifting round it, like a curtain of aurora seen end on,
  // with fine filaments across it: a wave of light, not a hoop
  float arcs = (0.5 + 0.5 * sin(ang * 5.0 + uSeed)) * (0.5 + 0.5 * sin(ang * 3.0 - uSeed * 1.7 + uTime * 0.9));
  arcs = 0.12 + 0.88 * smoothstep(0.08, 0.7, arcs);
  float fil = 0.9 + 0.1 * sin(ang * 53.0 + uSeed * 3.1 + x * 2.0);
  vec3 col = mix(uColor, vec3(1.0), hot * 0.6);
  col = mix(col, vec3(0.66, 0.58, 1.0), smoothstep(0.25, 1.6, x) * 0.75);
  float a = (front * arcs * fil + wake * arcs) * uLife * (1.0 - 0.55 * uR);
  gl_FragColor = vec4(col * (0.85 + hot * 0.7), a);
}
`

const FLASH_VERT = RING_VERT
/**
 * The flash at her heart: a point of starlight, not a cloud: a small
 * white-hot core with fine diffraction spikes, four long and four faint,
 * as a bright star shows through a lens.
 */
const FLASH_FRAG = /* glsl */ `
uniform float uLife;
uniform float uRot;
uniform vec3 uColor;
varying vec2 vP;
float spike(vec2 p, float a) {
  vec2 q = vec2(cos(a) * p.x + sin(a) * p.y, -sin(a) * p.x + cos(a) * p.y);
  return exp(-abs(q.y) * 140.0) * exp(-abs(q.x) * 7.0);
}
void main() {
  vec2 p = vP;
  float d2 = dot(p, p);
  float core = exp(-d2 * 900.0) * 3.0 + exp(-d2 * 110.0) * 0.6 + exp(-d2 * 14.0) * 0.06;
  float sp = spike(p, uRot) + spike(p, uRot + 1.5708);
  float faint = spike(p, uRot + 0.7854) + spike(p, uRot + 2.3562);
  float a = (core + sp * 0.45 + faint * 0.12) * uLife;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), clamp(core, 0.0, 1.0)) * 1.6, a);
}
`

/**
 * The shock layer as a surface of revolution round her flight path (local +z,
 * the way she moves through the air), in metres from her chest: a blunt cap
 * standing off ahead (a paraboloid, as a bow shock is near its nose), the
 * sheath round her body, then the hot wake closing in behind. `aS` is the
 * distance back along the flow from the nose, `aA` the turn round it (0..1).
 */
const SHOCK_NOSE = 2.6
const SHOCK_LENGTH = 30
const shockGeometry = (): THREE.BufferGeometry => {
  const rings = 96, turns = 48
  const pos: number[] = [], s: number[] = [], a: number[] = [], index: number[] = []
  for (let i = 0; i <= rings; i++) {
    // denser near the nose, where the shape and the light change fastest
    const d = SHOCK_LENGTH * Math.pow(i / rings, 1.5)
    const flank = Math.sqrt(2 * 1.7 * d)
    const r = (flank * 4.4) / Math.pow(Math.pow(flank, 4) + Math.pow(4.4, 4), 0.25) * Math.exp(-Math.max(0, d - 6.5) / 6.5)
    for (let j = 0; j <= turns; j++) {
      const t = (j / turns) * Math.PI * 2
      pos.push(Math.cos(t) * r, Math.sin(t) * r, SHOCK_NOSE - d)
      s.push(d); a.push(j / turns)
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < turns; j++) {
    const k = i * (turns + 1) + j
    index.push(k, k + turns + 1, k + 1, k + 1, k + turns + 1, k + turns + 2)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute("aS", new THREE.Float32BufferAttribute(s, 1))
  g.setAttribute("aA", new THREE.Float32BufferAttribute(a, 1))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}

const SHELL_VERT = /* glsl */ `
attribute float aS;
attribute float aA;
varying vec3 vN;
varying vec3 vV;
varying float vS;
varying float vA;
varying float vR;
void main() {
  vS = aS;
  vA = aA;
  vR = length(position.xy);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

/**
 * The glow of the hot gas filling the shock layer and wake. Seen through a
 * glowing volume, the light gathered is the length of the sight line inside
 * it, and through a rounded body that chord goes as |n·v| at the surface:
 * full through the middle, nothing at the silhouette, so the layer has no
 * hard edge. White-hot at the stagnation point ahead of her chest, the
 * pink-orange of hot air (N2, O) round her, cooling to a deeper red down the
 * wake, and drawn out in streamers running back past her with the flow.
 */
const PLASMA_FRAG = /* glsl */ `
uniform float uHeat;
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
varying float vS;
varying float vA;
varying float vR;
float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
// value noise, periodic in x with period k (round the flow axis)
float pn(vec2 p, float k) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, k), x1 = mod(i.x + 1.0, k);
  return mix(mix(h21(vec2(x0, i.y)), h21(vec2(x1, i.y)), f.x), mix(h21(vec2(x0, i.y + 1.0)), h21(vec2(x1, i.y + 1.0)), f.x), f.y); }
void main() {
  // the hotter the flow, the further back the glow reaches
  float reach = mix(5.0, ${SHOCK_LENGTH.toFixed(1)}, uHeat);
  float tail = 1.0 - smoothstep(reach * 0.45, reach, vS);
  if (tail <= 0.0) discard;
  float chord = abs(dot(normalize(vN), vV));
  // streamers, long along the flow and running back with it
  float st = pn(vec2(vA * 22.0, vS * 0.07 - uTime * 5.0), 22.0) * 0.6 + pn(vec2(vA * 53.0, vS * 0.2 - uTime * 11.0), 53.0) * 0.4;
  st = smoothstep(0.28, 0.92, st);
  float cap = exp(-vS / 1.1);
  float sheath = exp(-vS / 7.0) * st * st;
  float wake = exp(-vS / 14.0) * st * st * st;
  // the shock is strong (hot) where it stands square to the flow, round the
  // nose and close about her; out on its oblique flanks the gas is far cooler
  float strong = exp(-vR * vR / 12.0);
  float e = (cap * 1.6 + sheath * 0.6 + wake * 0.45) * strong * tail;
  vec3 col = mix(vec3(0.95, 0.34, 0.36), vec3(1.0, 0.5, 0.3), exp(-vS / 9.0));
  col = mix(col, vec3(1.0, 0.92, 0.84), cap);
  // a slow, gentle shimmer (never a flicker: nothing here pulses faster than ~1 Hz)
  float flicker = 0.95 + 0.05 * sin(uTime * 5.0 + vA * 31.4159);
  gl_FragColor = vec4(col * e * chord * 0.9 * uHeat * flicker, 1.0);
}
`

/**
 * Sparks as short glints along their flight (each a line from where it is to
 * where it was a moment ago), white at the head and fading back: sharp
 * points of starlight, never soft discs nor speed lines. One draw call.
 */
const SPARK_VERT = /* glsl */ `
attribute float sparkLife;
attribute float sparkHead;
varying float vA;
void main() {
  vA = sparkLife * sparkLife * mix(0.05, 1.0, sparkHead);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const SPARK_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  gl_FragColor = vec4(mix(uColor, vec3(1.0), vA) * 1.25, vA);
}
`

const STARLIGHT = new THREE.Color("#d9e4ff")
const _q = new THREE.Quaternion()
const _v = new THREE.Vector3()
const _w = new THREE.Vector3()
const Z = new THREE.Vector3(0, 0, 1)
/** the ring meshes lie in their local XZ plane (the wings' plane once turned with her) */
const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)

type Release = { t: number; dur: number; radius: number; soft: boolean; seed: number }

/** Starborn's overdrive is starlight parting the air ahead of her, not a body
 * ramming it: on the way up no shock layer forms (a re-entry still glows). */
const heatSpeed = (v: number, parted: number): number => v + (Math.min(v, 60) - v) * parted

export const AscentFX = ({ pilot }: { pilot: () => HorseState | null }): React.ReactElement => {
  const sys = useMemo(() => {
    const root = new THREE.Group()
    root.name = "ascent-fx"
    const plane = new THREE.PlaneGeometry(2, 2)
    const ringMat = (strength: number): THREE.ShaderMaterial => new THREE.ShaderMaterial({
      vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uR: { value: 0 }, uW: { value: 0.02 }, uLife: { value: 0 }, uSeed: { value: 0 }, uTime: { value: 0 }, uColor: { value: STARLIGHT.clone().multiplyScalar(strength) } },
    })
    const rings = [ringMat(1), ringMat(0.55)].map((m) => {
      const mesh = new THREE.Mesh(plane, m)
      mesh.visible = false
      mesh.frustumCulled = false
      mesh.renderOrder = 8
      return mesh
    })
    const flashMat = new THREE.ShaderMaterial({
      vertexShader: FLASH_VERT, fragmentShader: FLASH_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uLife: { value: 0 }, uRot: { value: 0 }, uColor: { value: STARLIGHT.clone() } },
    })
    const flash = new THREE.Mesh(plane, flashMat)
    flash.visible = false
    flash.frustumCulled = false
    flash.renderOrder = 9
    const shellGeo = shockGeometry()
    const plasmaMat = new THREE.ShaderMaterial({
      vertexShader: SHELL_VERT, fragmentShader: PLASMA_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, premultipliedAlpha: true,
      uniforms: { uHeat: { value: 0 }, uTime: { value: 0 } },
    })
    const plasma = new THREE.Mesh(shellGeo, plasmaMat)
    plasma.visible = false
    plasma.frustumCulled = false
    plasma.renderOrder = 7
    plasma.name = "shock-layer"
    // each spark a streak: two vertices (head, then where it was a moment ago)
    const sparkGeo = new THREE.BufferGeometry()
    const pos = new Float32Array(SPARKS * 6)
    const at = new Float64Array(SPARKS * 3)
    /** outward velocity (slows), and the velocity it was born with (hers, kept) */
    const vel = new Float32Array(SPARKS * 3)
    const base = new Float32Array(SPARKS * 3)
    const life = new Float32Array(SPARKS)
    const vLife = new Float32Array(SPARKS * 2)
    const head = new Float32Array(SPARKS * 2)
    for (let i = 0; i < SPARKS; i++) head[i * 2] = 1
    sparkGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
    sparkGeo.setAttribute("sparkLife", new THREE.BufferAttribute(vLife, 1))
    sparkGeo.setAttribute("sparkHead", new THREE.BufferAttribute(head, 1))
    const sparkMat = new THREE.ShaderMaterial({
      vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: STARLIGHT.clone() } },
    })
    const sparks = new THREE.LineSegments(sparkGeo, sparkMat)
    sparks.frustumCulled = false
    sparks.renderOrder = 8
    root.add(rings[0], rings[1], flash, plasma, sparks)
    return {
      root, plane, rings, flashMat, flash, shellGeo, plasmaMat, plasma, sparkGeo, sparkMat, sparks, pos, at, vel, base, life, vLife,
      release: null as Release | null,
      lastMode: "", lastAlt: 0, softWait: 0, freed: false, toldKarman: false, toldPlasma: false, time: 0,
      centre: new THREE.Vector3(),
    }
  }, [])

  useEffect(() => () => {
    sys.plane.dispose(); sys.shellGeo.dispose(); sys.sparkGeo.dispose()
    for (const r of sys.rings) (r.material as THREE.Material).dispose()
    sys.flashMat.dispose(); sys.plasmaMat.dispose(); sys.sparkMat.dispose()
  }, [sys])

  /** Starlight released through the wings: soft for the sails setting or folding, full when free of the air. */
  const release = (h: HorseState, soft: boolean): void => {
    sys.release = { t: 0, dur: soft ? 1.1 : 2.4, radius: soft ? 14 : 70, soft, seed: Math.random() * 6.283 }
    mountQuaternion(h, _q)
    sys.centre.set(h.x, h.y + tiltPivot(h), h.z)
    // the sparks are born moving with her, so the burst stays round her and
    // only slowly falls behind as she gathers speed
    const pitch = h.flight?.pitch ?? 0
    _w.set(Math.sin(h.heading) * Math.cos(pitch), Math.sin(pitch), Math.cos(h.heading) * Math.cos(pitch)).multiplyScalar(h.speed)
    const n = soft ? SPARKS / 4 : SPARKS
    for (let i = 0; i < SPARKS; i++) {
      if (i >= n) { sys.life[i] = 0; continue }
      // out through the plane of the wings, a little above and below it
      const a = Math.random() * Math.PI * 2
      _v.set(Math.cos(a), (Math.random() - 0.5) * 0.3, Math.sin(a)).normalize().applyQuaternion(_q)
      // most race out, a few drift and linger
      const s = soft ? 4 + Math.random() * 6 : Math.random() < 0.75 ? 18 + Math.random() * 30 : 4 + Math.random() * 8
      sys.at[i * 3] = sys.centre.x; sys.at[i * 3 + 1] = sys.centre.y; sys.at[i * 3 + 2] = sys.centre.z
      sys.vel[i * 3] = _v.x * s; sys.vel[i * 3 + 1] = _v.y * s; sys.vel[i * 3 + 2] = _v.z * s
      sys.base[i * 3] = _w.x; sys.base[i * 3 + 1] = _w.y; sys.base[i * 3 + 2] = _w.z
      sys.life[i] = 0.55 + Math.random() * 0.45
    }
    ascentRT.flare = soft ? 0.5 : 1
    cameraRT.fovBoost += soft ? 1.5 : 4
    if (soft) sfx.twinkle()
    else { sfx.whoosh(); sfx.chime() }
  }

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    sys.time += dt
    ascentRT.flare = Math.max(0, ascentRT.flare - dt * 0.6)
    const h = pilot()
    const f = h?.flight
    const mode = f?.mode ?? ""
    if (ascentRT.qa !== null && h) { release(h, ascentRT.qa); ascentRT.qa = null }
    const overEarth = !!h && spaceRT.realm === "earth" && spaceRT.mode === "local"
    const alt = h ? h.y - DATUM_Y : 0
    if (h && f && overEarth) {
      // ---- wings to sails (soft), sails back to wings (soft) ----------------------
      // (at most one soft release in eight seconds: hovering at the sail line used
      // to switch air ↔ sail over and over, and each switch fired its light, a strobe)
      sys.softWait = Math.max(0, sys.softWait - dt)
      if (sys.softWait <= 0 && ((sys.lastMode === "air" && mode === "sail") || (sys.lastMode === "sail" && mode === "air"))) {
        release(h, true)
        sys.softWait = 8
      }
      // ---- free of the air: the sails catch the stars --------------------------------
      if (mode === "sail" && !sys.freed && sys.lastAlt < FREE_ALT && alt >= FREE_ALT && f.vy > 0) {
        sys.freed = true
        release(h, false)
      }
      if (alt < SAIL_ALTITUDE) sys.freed = false
      // ---- the Kármán line, once per climb ------------------------------------------
      if (!sys.toldKarman && sys.lastAlt < KARMAN && alt >= KARMAN) {
        sys.toldKarman = true
        useDiscoveries.getState().showToast({
          title: "The Kármán line · 100 km",
          line: "Where spaceflight is said to begin: a line agreed on, not an edge — the air thins on above it. Along the night limb, the faint green thread of airglow is oxygen glowing 95 km up.",
          kind: "sky",
        })
      }
      if (alt < KARMAN * 0.8) sys.toldKarman = false
    }
    sys.lastMode = mode
    sys.lastAlt = alt

    // ---- the release: rings, the flash, the sparks ---------------------------------------
    const r = sys.release
    if (r) {
      r.t += dt
      if (h) sys.centre.set(h.x, h.y + tiltPivot(h), h.z)
      if (h) mountQuaternion(h, _q)
      for (let k = 0; k < 2; k++) {
        const ring = sys.rings[k]
        const u = (r.t - k * 0.14) / r.dur
        const m = ring.material as THREE.ShaderMaterial
        if (u <= 0 || u >= 1) { ring.visible = u <= 0 && r.t < r.dur; m.uniforms.uLife.value = 0; continue }
        ring.visible = true
        const scale = r.radius * 1.05
        ring.position.copy(sys.centre)
        ring.quaternion.copy(_q).multiply(FLAT)
        ring.scale.setScalar(scale)
        const ease = 1 - Math.pow(1 - u, 3)
        m.uniforms.uR.value = Math.max(0.01, ease * 0.95)
        // a crisp front, broadening a little as it runs out (in metres)
        m.uniforms.uW.value = (r.soft ? 0.3 + 0.5 * ease : 0.45 + 1.3 * ease) / scale
        // eased in, never popping on: a wave of light, not a flashbulb
        m.uniforms.uLife.value = Math.min(1, u / 0.15) ** 2 * (1 - u) * (1 - u) * (r.soft ? 0.4 : 0.75)
        m.uniforms.uSeed.value = r.seed + k * 2.3
        m.uniforms.uTime.value = r.t
      }
      const fu = Math.min(1, r.t / (r.soft ? 0.4 : 1.1))
      // the soft release is only its ring: no flash at all
      sys.flash.visible = fu < 1 && !r.soft
      if (sys.flash.visible) {
        sys.flash.position.copy(sys.centre)
        sys.flash.quaternion.copy(state.camera.quaternion)
        // the spikes reach well out; the core stays a point
        sys.flash.scale.setScalar(r.soft ? 4 : 11)
        // a breath of light: rising over about a quarter of a second, well
        // under full strength, then out (photosensitivity: no instant flashes)
        const rise = 0.3
        sys.flashMat.uniforms.uLife.value = (fu < rise ? (fu / rise) ** 2 : (1 - (fu - rise) / (1 - rise)) ** 2) * 0.42
        sys.flashMat.uniforms.uRot.value = r.seed * 0.1 + 0.18
      }
      if (ascentRT.qaHide.rings) for (const ring of sys.rings) ring.visible = false
      if (ascentRT.qaHide.flash) sys.flash.visible = false
      if (r.t > r.dur + 0.2) {
        sys.release = null
        for (const ring of sys.rings) ring.visible = false
        sys.flash.visible = false
      }
    }
    // sparks: out and slowing, going out (positions near the camera so they stay crisp anywhere)
    const A = state.camera.position
    let any = false
    for (let i = 0; i < SPARKS; i++) {
      const o = i * 6
      if (sys.life[i] <= 0) {
        for (let c = 0; c < 6; c++) sys.pos[o + c] = 0
        sys.vLife[i * 2] = sys.vLife[i * 2 + 1] = 0
        continue
      }
      any = true
      sys.life[i] = Math.max(0, sys.life[i] - dt / 1.7)
      const drag = Math.exp(-dt * 1.2)
      for (let c = 0; c < 3; c++) {
        sys.vel[i * 3 + c] *= drag
        sys.at[i * 3 + c] += (sys.vel[i * 3 + c] + sys.base[i * 3 + c]) * dt
      }
      // head where it is; tail where its own outward flight had it a moment
      // ago: a glint of starlight drifting out, not a speed line
      // at most ~0.3 m long whatever its speed
      const vx = sys.vel[i * 3], vy = sys.vel[i * 3 + 1], vz = sys.vel[i * 3 + 2]
      const tail = Math.min(0.025, 0.3 / Math.max(1e-3, Math.hypot(vx, vy, vz)))
      for (let c = 0; c < 3; c++) {
        const hd = sys.at[i * 3 + c] - A.getComponent(c)
        sys.pos[o + c] = hd
        sys.pos[o + 3 + c] = hd - sys.vel[i * 3 + c] * tail
      }
      sys.vLife[i * 2] = sys.vLife[i * 2 + 1] = sys.life[i]
    }
    sys.sparks.visible = any && !ascentRT.qaHide.sparks
    if (any) {
      sys.sparks.position.copy(A)
      ;(sys.sparkGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true
      ;(sys.sparkGeo.attributes.sparkLife as THREE.BufferAttribute).needsUpdate = true
    }

    // ---- the shock layer: only when the physics says the air glows ------------------------
    let glow = 0
    if (h && f && overEarth && (mode === "sail" || mode === "air")) glow = Math.max(ascentRT.qaHeat ?? shockGlow(alt, heatSpeed(mode === "air" ? Math.hypot(h.speed, f.vy) : h.speed, mode === "air" || f.pitch > -0.05 ? f.overdrive : 0)), travelRT.heat)
    const heat = sys.plasmaMat.uniforms.uHeat
    heat.value += (glow - heat.value) * (1 - Math.exp(-dt * 4))
    sys.plasma.visible = !!h && heat.value > 0.01
    if (h && f && sys.plasma.visible) {
      if (!sys.toldPlasma && heat.value > 0.4) {
        sys.toldPlasma = true
        useGame.getState().showHint("Coming in fast: the air ahead glows white-hot. The star-veil keeps you safe.")
      }
      // along her motion through the air (not where she faces): the cap ahead
      // of her chest and the riders, the wake streaming back behind
      if (mode === "air") _v.set(Math.sin(h.heading) * h.speed, f.vy, Math.cos(h.heading) * h.speed)
      else _v.set(Math.sin(h.heading) * Math.cos(f.pitch), Math.sin(f.pitch), Math.cos(h.heading) * Math.cos(f.pitch))
      if (_v.lengthSq() > 1e-6) sys.plasma.quaternion.setFromUnitVectors(Z, _v.normalize())
      sys.plasma.position.set(h.x, h.y + tiltPivot(h) + 0.4, h.z)
      sys.plasmaMat.uniforms.uTime.value = sys.time
    }
    if (glow <= 0 && heat.value < 0.01) sys.toldPlasma = false
  })

  return <primitive object={sys.root} />
}
