import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { qualityRT } from "../../../state/qualityStore"
import { useDiscoveries } from "../../../state/discoveryStore"
import { audioContext, audioLive, audioOut } from "../../audio/audio"
import type { HorseState } from "../../horses/horseState"
import { tiltPivot } from "../../horses/riding"
import { spaceRT, sunFromEye, universeDirToLocal } from "../spaceState"
import { mountUniverse } from "../starSail"
import { travelling } from "../cosmicTravel"
import { universe } from "../universe"
import { RING_FIELD_HEIGHT, RING_TAU_GLSL, ringCoords, ringPlaneWeight, ringRegion, ringRT, ringTau, ringThickness, type RingCoords, type RingRegion } from "./ringPhysics"

/**
 * Flying among Saturn's rings: the ice around Starborn, drawn in 3D.
 *
 * From afar the rings are the ring disc (CelestialSky). Near the ring plane
 * this takes over around her: a field of life-size water-ice pieces — a few
 * house-sized boulders, many fists and grains (a size^-3 power law) — in a
 * layer about ten metres thick, its density read from Cassini's radial
 * profile at her exact radius (ringPhysics.ts): the dense B ring is a wall of
 * ice, the Cassini Division and the C ring thin, the Encke and Keeler gaps
 * empty, the A ring rippled by density waves. In the dense rings the pieces
 * gather into self-gravity wakes canted ~20° to the orbit. Every piece turns
 * slowly; neighbours shear past one another (inner faster), as orbits do.
 *
 * Light: sunlight (and Saturn's shadow across the rings, via sunFromEye), a
 * warm fill of light reflected from Saturn, frosty glints, and fine dust
 * that glows when the explorer looks toward the Sun through it (forward scattering,
 * as Cassini saw the faint rings light up from the night side).
 *
 * Magic, and safety: a sphere of Starborn's starlight about her and about the
 * camera parts the ice — a piece entering it is eased aside and rims with
 * blue light — so nothing ever strikes her and the view never clips into a
 * boulder. Near-misses of the big pieces answer with a soft chime: Starborn's
 * voice, since space carries no sound.
 *
 * Precision: her ring coordinates are float64 on the CPU and only the field's
 * small wrapped offsets (±80 m) reach the GPU. The field is a periodic tile
 * that follows her, so it never runs out in any direction.
 */

const L = 160
const SHEAR = 0.012
const _u = new THREE.Vector3()
const _sun = new THREE.Vector3()
const _sat = new THREE.Vector3()
const axes = { er: new THREE.Vector3(), en: new THREE.Vector3(), ephi: new THREE.Vector3() }
const _er = new THREE.Vector3(), _en = new THREE.Vector3(), _ep = new THREE.Vector3()
const coords: RingCoords = { r: 0, y: 0, s: 0, rkm: 0 }
const _m4 = new THREE.Matrix4()

const COMMON = /* glsl */ `
  uniform vec3 uSit;     // her place in tile coordinates: x radial (mod L), y height over the plane, z arc (mod L)
  uniform float uL;
  uniform float uTime;
  uniform float uShear;
  uniform float uRkm;    // her radius, real km
  uniform float uThick;  // half-thickness (life-size m)
  uniform float uVis;
  uniform vec3 uER;
  uniform vec3 uEN;
  uniform vec3 uEP;
  uniform vec3 uCenter;  // her chest (logical)
  uniform vec3 uCam;     // the camera (logical)
  uniform float uBubble;
  ${RING_TAU_GLSL}
  // where a piece is now, relative to her, and whether it is there at all
  vec3 ringPlace(vec3 tile, float seed, out float present, out float push) {
    float dx = mod(tile.x - uSit.x + 0.5 * uL, uL) - 0.5 * uL;
    float zt = tile.z + uShear * dx * uTime;
    float dz = mod(zt - uSit.z + 0.5 * uL, uL) - 0.5 * uL;
    float dy = tile.y * uThick - uSit.y;
    float rkm = uRkm + dx * 0.06371;
    float tau = ringTau(rkm);
    // self-gravity wakes: clumps elongated along a line canted ~20 deg to the orbit
    float wake = 0.55 + 0.45 * sin((dx * 0.94 - dz * 0.34) * 0.21 + seed * 0.7) * smoothstep(0.6, 1.4, tau);
    float density = (1.0 - exp(-tau * 1.7)) * wake;
    present = step(seed, density) * (1.0 - smoothstep(0.36 * uL, 0.5 * uL, max(abs(dx), abs(dz)))) * uVis;
    vec3 c = uCenter + uER * dx + uEN * dy + uEP * dz;
    // Starborn's starlight parts the ice round her and round the view
    push = 0.0;
    vec3 a = c - uCenter;
    float da = length(a);
    if (da < uBubble) { push = 1.0 - da / uBubble; c = uCenter + a / max(da, 1e-3) * (uBubble + (da - uBubble) * 0.25); }
    vec3 b = c - uCam;
    float db = length(b);
    float camR = uBubble * 0.55;
    if (db < camR) { push = max(push, 1.0 - db / camR); c = uCam + b / max(db, 1e-3) * camR; }
    return c;
  }
`

const ROCK_VERT = /* glsl */ `
  attribute vec3 aTile;
  attribute vec4 aShape;  // xyz stretch, w size (m)
  attribute vec4 aSpin;   // axis, rate
  attribute float aSeed;
  uniform float uSpinK;
  ${COMMON}
  varying vec3 vN;
  varying vec3 vW;
  varying float vPush;
  varying float vAlb;
  varying vec3 vObj;
  varying float vSeed;
  vec3 rot(vec3 v, vec3 k, float a) { float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }
  void main() {
    float present, push;
    vec3 c = ringPlace(aTile, aSeed, present, push);
    float ang = aSpin.w * uSpinK * uTime + aSeed * 6.2831;
    vec3 k = normalize(aSpin.xyz);
    vec3 p = rot(position * aShape.xyz, k, ang) * aShape.w * present;
    vN = rot(normal / aShape.xyz, k, ang);
    vW = c + p;
    vPush = push;
    vAlb = 0.72 + 0.28 * fract(aSeed * 13.7);
    vObj = position * aShape.w;
    vSeed = aSeed;
    gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
  }
`
const ROCK_FRAG = /* glsl */ `
  uniform vec3 uSun;
  uniform float uLit;
  uniform vec3 uSaturnDir;
  uniform vec3 uTint;
  uniform vec3 uCam;
  varying vec3 vN;
  varying vec3 vW;
  varying float vPush;
  varying float vAlb;
  varying vec3 vObj;
  varying float vSeed;
  float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  void main() {
    // regolith: a frost of fine grains over the ice, in the piece's own space (it turns with it)
    vec3 o = vObj * 3.0 + vSeed * 31.0;
    // how much of a piece one pixel covers: finer frost than that is left out, not aliased
    float fp = length(fwidth(vObj));
    float fr = n3(o) * 0.6 + n3(o * 2.7) * 0.4;
    vec3 n = normalize(vN);
    vec3 v = normalize(uCam - vW);
    // water ice: bright, a little translucent (light wraps round the terminator)
    float diff = clamp((dot(n, uSun) + 0.25) / 1.25, 0.0, 1.0) * uLit;
    vec3 h = normalize(uSun + v);
    float glint = pow(max(dot(n, h), 0.0), 40.0) * 0.35 * uLit;
    // crystals in the frost catch the Sun one by one as the piece turns
    float cell = h3(floor(vObj * 28.0 + vSeed * 97.0));
    glint += step(0.965, cell) * pow(max(dot(n, h), 0.0), 6.0) * 1.6 * uLit * (1.0 - smoothstep(0.012, 0.035, fp));
    // backlit: the frost glows at its edges when she looks toward the Sun through the ring
    float back = pow(max(dot(-v, uSun), 0.0), 8.0) * pow(max(1.0 - abs(dot(n, v)), 0.0), 2.0) * 0.8 * uLit;
    // Saturnshine: the warm light of the planet on the night side of each piece
    float shine = max(dot(n, uSaturnDir), 0.0) * 0.09;
    float alb = vAlb * (0.82 + 0.3 * mix(fr, 0.5, smoothstep(0.05, 0.2, fp)));
    vec3 col = uTint * alb * (diff * 1.15 + shine * vec3(1.0, 0.86, 0.62) + 0.025) + vec3(0.9, 0.95, 1.0) * glint + vec3(0.85, 0.92, 1.0) * back;
    // parted by her starlight: a cool rim of light
    col += vec3(0.45, 0.6, 1.0) * vPush * pow(max(1.0 - abs(dot(n, v)), 0.0), 2.0) * 0.9;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/**
 * The ring as a sheet at true scale out to 24 km round her: between the
 * pieces drawn one by one (the first ~80 m) and the far disc (which the sky
 * draws shrunk toward the camera, so its near part would fall inside the
 * near plane), the same Cassini profile, lit the same way, fading in beyond
 * the field and out toward its edge where the far disc carries on.
 */
const SHEET_VERT = /* glsl */ `
  uniform vec3 uCenter;
  uniform float uSheetR;
  varying vec2 vP;
  varying vec3 vRel;
  void main() {
    vP = position.xy * uSheetR;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vRel = w.xyz - uCenter;
    gl_Position = projectionMatrix * viewMatrix * w;
    // drawn with the sky (no depth test), so pinned at the far depth: never
    // clipped by the far plane however wide the sheet grows
    gl_Position.z = gl_Position.w * 0.99999;
  }
`
/**
 * Light on the ring, the same model as the far disc (CelestialSky) so the two
 * meet without a seam: the lit face, or light diffusing through thin ring
 * from the night side; forward scattering toward the Sun; Saturn's shadow
 * across the ice. And the slant path: looked at low across the plane, the
 * line of sight crosses far more ice (optical depth tau / mu), so toward the
 * horizon even a thin ring becomes a solid, bright floor.
 */
const SHEET_FRAG = /* glsl */ `
  uniform float uRkm;
  uniform float uVis;
  uniform vec3 uSun;
  uniform vec3 uEN;
  uniform vec3 uTint;
  uniform vec3 uCam;
  uniform vec3 uCenter;
  uniform vec3 uSatRel;   // Saturn's centre from her chest (local, game m)
  uniform float uSatR;
  uniform float uSheet;   // 0..1 how present the sheet is
  uniform float uSheetR;  // its radius (game m)
  uniform float uInner;   // 0..1 the 3D ice is drawn round her (the sheet opens there)
  varying vec2 vP;
  varying vec3 vRel;
  ${RING_TAU_GLSL}
  void main() {
    float d = length(vP);
    // the pixel's footprint across the rings (real km), from the local offset (precise near her)
    float dx = vP.x * 0.06371;
    float tau = ringTauF(uRkm + dx, fwidth(dx));
    vec3 vd = normalize((uCam - uCenter) - vRel);
    float mu = max(abs(dot(vd, uEN)), 0.015);
    float inner = mix(1.0, smoothstep(36.0, 90.0, d), uInner);
    float a = (1.0 - exp(-tau * 1.3 / mu)) * inner * (1.0 - smoothstep(uSheetR * 0.6, uSheetR * 0.95, d)) * uSheet;
    if (a < 0.003) discard;
    float sunSide = dot(uEN, uSun);
    float same = sunSide * dot(uEN, vd) > 0.0 ? 1.0 : 0.0;
    float through = exp(-tau * 1.3) * 0.6 + 0.08;
    float lit = mix(through, 1.0, same) * (0.35 + 0.65 * abs(sunSide)) * 1.4;
    float fwd = pow(max(dot(-vd, uSun), 0.0), 8.0) * 2.5;
    // Saturn's shadow on the rings (soft at the edge, as the Sun is a disc)
    vec3 o = (vRel - uSatRel) / uSatR;
    float along = -dot(o, uSun);
    float miss = length(o + uSun * along);
    float shadow = along > 0.0 ? mix(0.04, 1.0, smoothstep(0.99, 1.01, miss)) : 1.0;
    float groove = ringGrooves(uRkm + dx, fwidth(dx));
    gl_FragColor = vec4(uTint * groove * (lit + fwd) * shadow * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const DUST_VERT = /* glsl */ `
  attribute vec3 aTile;
  attribute float aSeed;
  ${COMMON}
  uniform float uPx;
  uniform vec3 uSun;
  uniform float uLit;
  varying float vB;
  void main() {
    float present, push;
    vec3 c = ringPlace(aTile, aSeed, present, push);
    vec4 mv = viewMatrix * vec4(c, 1.0);
    gl_Position = projectionMatrix * mv;
    float d = max(-mv.z, 0.3);
    // forward scattering (Henyey-Greenstein, g = 0.7): grains light up toward the Sun
    float cosT = dot(normalize(c - uCam), uSun);
    float g = 0.7;
    float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5) * 0.08;
    vB = present * (0.25 + hg) * uLit * (1.0 - smoothstep(30.0, 80.0, d));
    gl_PointSize = clamp(uPx * (0.06 + 0.04 * fract(aSeed * 7.1)) / d, 1.0, 4.0);
  }
`
const DUST_FRAG = /* glsl */ `
  varying float vB;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float a = exp(-dot(q, q) * 3.0) * vB;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vec3(0.95, 0.96, 1.0) * a, 0.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/**
 * A ring particle: not a cut stone but a rounded aggregate of ice, its
 * surface lumpy at two scales (a smooth icosphere pushed in and out by a few
 * random lobes), with smooth normals; the frost and glints are in the shader.
 */
const iceGeometry = (): THREE.BufferGeometry => {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 2)
  g.deleteAttribute("normal")
  g.deleteAttribute("uv")
  g = mergeVertices(g)
  const pos = g.getAttribute("position") as THREE.BufferAttribute
  const v = new THREE.Vector3()
  const lobes = Array.from({ length: 6 }, () => ({ d: new THREE.Vector3().randomDirection(), k: 0.1 + Math.random() * 0.22, w: 2 + Math.random() * 4 }))
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize()
    let r = 1
    for (const l of lobes) r += l.k * (Math.max(0, v.dot(l.d)) ** l.w) - l.k * 0.25
    r += Math.sin(v.x * 7.3 + 1.1) * Math.sin(v.y * 6.1 + 2.3) * Math.sin(v.z * 8.7) * 0.06
    v.multiplyScalar(r)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  g.computeVertexNormals()
  return g
}

const randn = (): number => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random())

const REGION_TOAST: Partial<Record<Exclude<RingRegion, null>, { title: string; line: string }>> = {
  A: { title: "The A ring", line: "Water ice, pieces from grains to houses, in a layer about ten metres thick. The ripples you cross are density waves raised by Saturn's moons." },
  B: { title: "The B ring", line: "The densest of all: in places so thick with ice that sunlight cannot get through. The pieces clump into long wakes as they orbit." },
  C: { title: "The C ring", line: "Thin and darker: fewer pieces, with a little more dust and rock among the ice." },
  Cassini: { title: "The Cassini Division", line: "A 4,700 km lane kept nearly clear by the moon Mimas, whose pull every second orbit empties it." },
  Encke: { title: "The Encke Gap", line: "325 km of clear space swept open by the tiny moon Pan, which orbits right inside it." },
  Keeler: { title: "The Keeler Gap", line: "Only 42 km wide, kept open by the moonlet Daphnis, whose pull ruffles its edges into waves." },
  F: { title: "The F ring", line: "A narrow, braided strand, herded by two small shepherd moons, Prometheus and Pandora." },
  D: { title: "The D ring", line: "The innermost and faintest: mostly fine dust, closest to Saturn's clouds." },
}

const ROCKS = { low: 1200, medium: 2200, high: 3600 }
const DUST = { low: 1500, medium: 3000, high: 5000 }
const reducedMotion = (): boolean => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

const buildRingField = () => {
  // allocated for the highest quality; each frame draws as many as the current level allows
  const rocks = ROCKS.high
  const dustN = DUST.high
  const uniforms = {
    uSit: { value: new THREE.Vector3() }, uL: { value: L }, uTime: { value: 0 }, uShear: { value: SHEAR }, uRkm: { value: 0 },
    uThick: { value: 10 }, uVis: { value: 0 }, uER: { value: new THREE.Vector3(1, 0, 0) }, uEN: { value: new THREE.Vector3(0, 1, 0) },
    uEP: { value: new THREE.Vector3(0, 0, 1) }, uCenter: { value: new THREE.Vector3() }, uCam: { value: new THREE.Vector3() }, uBubble: { value: 4 },
    uSun: { value: new THREE.Vector3(0, 1, 0) }, uLit: { value: 1 }, uSaturnDir: { value: new THREE.Vector3(0, -1, 0) }, uTint: { value: new THREE.Color("#e8ded2") },
    uPx: { value: 600 }, uSpinK: { value: 1 }, uSatRel: { value: new THREE.Vector3() }, uSatR: { value: 1 },
  }
  // ---- the boulders and fists of ice
  const ice = iceGeometry()
  const geo = new THREE.InstancedBufferGeometry().copy(ice as unknown as THREE.InstancedBufferGeometry)
  ice.dispose()
  geo.instanceCount = rocks
  const tile = new Float32Array(rocks * 3), shape = new Float32Array(rocks * 4), spin = new Float32Array(rocks * 4), seed = new Float32Array(rocks)
  const big: Array<{ i: number; size: number }> = []
  for (let i = 0; i < rocks; i++) {
    tile.set([Math.random() * L, randn() * 0.6, Math.random() * L], i * 3)
    // number ∝ size^-3 between 15 cm and 4 m (the grains are the dust below)
    const size = Math.min(4, 0.15 / Math.sqrt(1 - Math.random() * 0.9986))
    shape.set([0.7 + Math.random() * 0.6, 0.6 + Math.random() * 0.5, 0.7 + Math.random() * 0.6, size], i * 4)
    spin.set([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, (Math.random() - 0.5) * 0.25 / Math.sqrt(size)], i * 4)
    seed[i] = Math.random()
    if (size > 0.9) big.push({ i, size })
  }
  geo.setAttribute("aTile", new THREE.InstancedBufferAttribute(tile, 3))
  geo.setAttribute("aShape", new THREE.InstancedBufferAttribute(shape, 4))
  geo.setAttribute("aSpin", new THREE.InstancedBufferAttribute(spin, 4))
  geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 1))
  const rockMat = new THREE.ShaderMaterial({ vertexShader: ROCK_VERT, fragmentShader: ROCK_FRAG, uniforms })
  const rocksMesh = new THREE.Mesh(geo, rockMat)
  rocksMesh.frustumCulled = false
  rocksMesh.name = "saturn-ring-ice"
  // ---- the glittering dust
  const dg = new THREE.BufferGeometry()
  const dTile = new Float32Array(dustN * 3), dSeed = new Float32Array(dustN)
  for (let i = 0; i < dustN; i++) {
    dTile.set([Math.random() * L, randn() * 0.9, Math.random() * L], i * 3)
    dSeed[i] = Math.random()
  }
  dg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(dustN * 3), 3))
  dg.setAttribute("aTile", new THREE.BufferAttribute(dTile, 3))
  dg.setAttribute("aSeed", new THREE.BufferAttribute(dSeed, 1))
  const dustMat = new THREE.ShaderMaterial({ vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true })
  const dust = new THREE.Points(dg, dustMat)
  dust.frustumCulled = false
  // a unit disc, scaled each frame to the sheet's radius
  const sheetGeo = new THREE.CircleGeometry(1, 128)
  const sheetUniforms = { ...uniforms, uSheet: { value: 0 }, uSheetR: { value: 24_000 }, uInner: { value: 0 } }
  const sheetMat = new THREE.ShaderMaterial({
    vertexShader: SHEET_VERT, fragmentShader: SHEET_FRAG, side: THREE.DoubleSide,
    // drawn in the sky's pass, after Saturn and its far disc and before the world
    transparent: false, depthTest: false, depthWrite: false, fog: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: sheetUniforms,
  })
  const sheet = new THREE.Mesh(sheetGeo, sheetMat)
  sheet.frustumCulled = false
  sheet.renderOrder = -8.9
  const root = new THREE.Group()
  root.name = "saturn-ring-field"
  root.add(sheet, rocksMesh, dust)
  root.visible = false
  // the big pieces, for near-miss chimes (positions recomputed on the CPU, float64)
  big.sort((a, b) => b.size - a.size)
  const watch = big.slice(0, 48).map(({ i, size }) => ({ i, x: tile[i * 3], y: tile[i * 3 + 1], z: tile[i * 3 + 2], size, seed: seed[i], near: false }))
  return { root, rocksMesh, dust, geo, rockMat, dg, dustMat, sheet, sheetGeo, sheetMat, sheetUniforms, uniforms, watch, region: null as RingRegion, chimeT: 0, reduced: reducedMotion(), sPrev: 0, sAcc: 0, sInit: false, toasted: new Set<string>() }
}
export const RingField = ({ pilot }: { pilot: () => HorseState | null }): React.ReactElement => {
  const sys = useMemo(() => buildRingField(), [])

  useEffect(() => () => { sys.geo.dispose(); sys.rockMat.dispose(); sys.dg.dispose(); sys.dustMat.dispose(); sys.sheetGeo.dispose(); sys.sheetMat.dispose() }, [sys])

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const u = sys.uniforms
    const h = pilot()
    const saturn = universe.byId.get("saturn")
    let want = 0
    if (h && saturn) {
      mountUniverse(h, _u)
      ringCoords(_u, saturn.pos, saturn.pole, coords, axes)
    }
    if (h && saturn && !travelling() && spaceRT.realm === "earth") {
      const inRings = coords.rkm > 66_000 && coords.rkm < 141_000
      want = inRings ? 1 - THREE.MathUtils.smoothstep(Math.abs(coords.y), RING_FIELD_HEIGHT * 0.6, RING_FIELD_HEIGHT) : 0
      // far too fast to see each piece: the field gives way to the disc's light
      want *= 1 - THREE.MathUtils.smoothstep(h.speed, 160, 600)
    }
    // her true place over the rings, whether or not the ice is drawn (HUD, sound, QA)
    if (h && saturn) {
      ringRT.rkm = coords.rkm
      ringRT.y = coords.y
      ringRT.tau = ringTau(coords.rkm)
    }
    ringRT.vis += (want - ringRT.vis) * (1 - Math.exp(-dt * 3))
    // the true-scale ring sheet under her reaches well above the ice (the far
    // disc cannot be drawn so close beneath her), growing with her height so
    // it always hands over to the far disc at a distance it draws well
    const sheetWant = want > 0 || (h && saturn && !travelling() && spaceRT.realm === "earth") ? ringPlaneWeight(coords) : 0
    ringRT.sheet += (sheetWant - ringRT.sheet) * (1 - Math.exp(-dt * 3))
    ringRT.sheetR = Math.max(24_000, Math.abs(coords.y) * 60)
    sys.rocksMesh.visible = sys.dust.visible = ringRT.vis > 0.003
    sys.sheet.visible = ringRT.sheet > 0.003
    sys.root.visible = sys.rocksMesh.visible || sys.sheet.visible
    if (!sys.root.visible || !h || !saturn) {
      ringRT.region = null
      sys.sInit = false
      return
    }
    const region = ringRegion(coords.rkm)
    ringRT.region = region
    // tile coordinates (float64 mod, small numbers to the GPU)
    const tx = ((coords.r % L) + L) % L
    // arc length unwrapped across the azimuth seam (s jumps by 2πr there,
    // which is no multiple of the tile, so the ice would jump with it)
    let ds = coords.s - sys.sPrev
    if (Math.abs(ds) > Math.PI * coords.r) ds -= Math.sign(ds) * 2 * Math.PI * coords.r
    if (!sys.sInit || Math.abs(ds) > 5000) ds = 0
    sys.sInit = true
    sys.sPrev = coords.s
    sys.sAcc = (sys.sAcc + ds) % (L * 1e4)
    const tz = ((sys.sAcc % L) + L) % L
    u.uSit.value.set(tx, coords.y, tz)
    u.uRkm.value = coords.rkm
    u.uThick.value = ringThickness(coords.rkm)
    u.uTime.value = state.clock.elapsedTime
    // the tile is shuffled, so the first n pieces are a fair sample at any level
    const level = qualityRT.level === "low" || qualityRT.level === "medium" ? qualityRT.level : "high"
    sys.geo.instanceCount = ROCKS[level]
    sys.dg.setDrawRange(0, DUST[level])
    u.uSpinK.value = sys.reduced ? 0.3 : 1
    u.uVis.value = ringRT.vis
    universeDirToLocal(axes.er, _er)
    universeDirToLocal(axes.en, _en)
    universeDirToLocal(axes.ephi, _ep)
    // (ring tile x grows with radius, z with arc length, y with the pole)
    ringRT.qa = { en: _en.toArray().map((v) => +v.toFixed(3)), er: _er.toArray().map((v) => +v.toFixed(3)), ep: _ep.toArray().map((v) => +v.toFixed(3)) }
    u.uER.value.copy(_er)
    u.uEN.value.copy(_en)
    u.uEP.value.copy(_ep)
    u.uCenter.value.set(h.x, h.y + tiltPivot(h), h.z)
    u.uCam.value.copy(state.camera.position)
    u.uBubble.value = 3.6 * h.ident.scale
    u.uLit.value = sunFromEye(_sun)
    u.uSun.value.copy(_sun)
    universeDirToLocal(_sat.copy(saturn.pos).sub(_u).normalize(), u.uSaturnDir.value)
    u.uPx.value = state.size.height * state.camera.projectionMatrix.elements[5] / 2
    // the B ring a little tan, the C ring greyer, the A ring nearly white
    // the sheet: in the ring plane under her (its x along her radial, y along the orbit)
    sys.sheet.position.copy(u.uCenter.value).addScaledVector(_en, -coords.y)
    _m4.makeBasis(_er, _ep, _en)
    sys.sheet.quaternion.setFromRotationMatrix(_m4)
    sys.sheet.scale.setScalar(ringRT.sheetR)
    sys.sheetUniforms.uSheet.value = ringRT.sheet
    sys.sheetUniforms.uSheetR.value = ringRT.sheetR
    sys.sheetUniforms.uInner.value = ringRT.vis
    // Saturn from her chest, for its shadow across the sheet
    _sat.copy(saturn.pos).sub(_u)
    universeDirToLocal(_sat, u.uSatRel.value)
    u.uSatR.value = saturn.radius
    u.uTint.value.set(region === "B" ? "#efdcc6" : region === "C" || region === "D" ? "#c9c0b6" : region === "Cassini" ? "#d4ccc4" : "#ece6de")

    // ---- a first visit to each part of the rings is named, once
    if (region && region !== sys.region && region !== "gap" && ringRT.vis > 0.5 && !sys.toasted.has(region)) {
      sys.toasted.add(region)
      const t = REGION_TOAST[region]
      if (t) useDiscoveries.getState().showToast({ title: t.title, line: t.line, kind: "sky" })
    }
    sys.region = region

    // ---- near-misses with the big pieces: Starborn's chime (space itself is silent)
    sys.chimeT = Math.max(0, sys.chimeT - dt)
    const thick = u.uThick.value
    for (const w of sys.watch) {
      // only the pieces actually drawn at this quality
      if (w.i >= sys.geo.instanceCount) continue
      const dx = ((w.x - tx + L / 2) % L + L) % L - L / 2
      const zt = w.z + SHEAR * dx * u.uTime.value
      const dz = ((zt - tz + L / 2) % L + L) % L - L / 2
      const dy = w.y * thick - coords.y
      const d = Math.hypot(dx, dy, dz)
      const density = (1 - Math.exp(-ringTau(coords.rkm + dx * 0.06371) * 1.7))
      const close = d < 4.5 + w.size && w.seed < density
      if (close && !w.near && sys.chimeT <= 0) {
        sys.chimeT = 0.3
        chime(440 * Math.pow(2, Math.round((1 - Math.min(1, w.size / 3.5)) * 12) / 12), Math.min(1, w.size / 2))
      }
      w.near = close
    }
  })

  return <primitive object={sys.root} />
}

/** a soft crystalline chime: Starborn's starlight brushing the ice aside */
const chime = (freq: number, weight: number): void => {
  const ctx = audioContext()
  const out = audioOut()
  if (!ctx || !out || !audioLive()) return
  const t0 = ctx.currentTime
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(0.03 + 0.03 * weight, t0 + 0.015)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6)
  g.connect(out)
  const nodes: AudioNode[] = [g]
  for (const [m, k] of [[1, 1], [2.76, 0.35], [5.4, 0.12]] as const) {
    const o = ctx.createOscillator()
    o.type = "sine"
    o.frequency.value = freq * m
    const og = ctx.createGain()
    og.gain.value = k
    o.connect(og).connect(g)
    o.start(t0)
    o.stop(t0 + 1.7)
    nodes.push(o, og)
  }
  window.setTimeout(() => nodes.forEach((n) => { try { n.disconnect() } catch { /* gone */ } }), 2000)
}
