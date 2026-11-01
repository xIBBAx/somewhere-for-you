import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { horseRT, type HorseState } from "../horses/horseState"
import { originRT } from "../../world/origin"
import { spaceRT } from "../celestial/spaceState"
import { isPegasus } from "./pegasi"
import { skillsOf } from "./skills"
import { sailRT } from "../celestial/starSail"
import { ascentRT } from "./AscentFX"
import { travelRT } from "../celestial/cosmicTravel"

/**
 * The light a Pegasus leaves in the air: liquid starlight running off each
 * wingtip and a softer stream from the tail, in that Pegasus's own colours
 * (skills.ts: Ivory rose-pearl, Onyx molten gold, Starborn starlight).
 *
 * It is drawn like a thick, flowing liquid, not a flat streak: a bright core
 * with coloured edges, pulses running down its length as if it were poured,
 * thinning and cooling as it ages, and shedding droplets of light that fall
 * under gravity in the air (and drift free in space). It brightens with
 * speed and most of all in a dash, and fades when the hooves are down.
 *
 * In deep space the Pegasus stays parked at a fixed point and the universe
 * moves (celestial/spaceState.ts), so there the trail is carried back by her
 * real velocity, capped to what the eye can follow.
 */

const SAMPLES = 56
const LIFE = 1.8
/** seconds between history samples: the ring holds exactly one LIFE */
const STEP = LIFE / (SAMPLES - 1)
/** curve points drawn per history sample, and per emitter's strip */
const SUB = 3
const VERTS = (SAMPLES - 1) * SUB + 1
const DROPS = 260
/** how many beads a second's worth of stream breaks into */
const BEAD_HZ = 7

/** A ring of the last positions (logical, float64) and their birth times; `head` is the newest. */
type Emitter = {
  xyz: Float64Array
  born: Float64Array
  head: number
  n: number
  last: THREE.Vector3
  /** the emitter's offset from her body, eased: the stream follows her line, not every wingbeat */
  off: THREE.Vector3
  offOk: boolean
}

type Trail = {
  id: string
  emitters: Emitter[]
  mesh: THREE.Mesh
  geo: THREE.BufferGeometry
  mat: THREE.ShaderMaterial
  glow: number
  dropAt: number
  /** how long the stream lasts now (s): the whole LIFE when slow, shorter at speed */
  life: number
  /** where she was last frame (logical): her stream is carried with her at sail speeds */
  carryFrom: THREE.Vector3
  carryOk: boolean
}

const VERT = /* glsl */ `
attribute vec2 trailUv;
attribute float trailAge;
varying vec2 vUv;
varying float vAge;
varying float vNear;
void main() {
  vUv = trailUv;
  vAge = trailAge;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // what streams past right by the lens fades, so it never smears across the view
  vNear = smoothstep(2.5, 8.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`

const FRAG = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uEdge;
uniform float uGlow;
uniform float uTime;
uniform float uAurora;
uniform float uPower;
varying vec2 vUv;
varying float vAge;
varying float vNear;
float h11(float p) { return fract(sin(p * 127.1) * 43758.5453); }
float n11(float x) { float i = floor(x); float f = fract(x); return mix(h11(i), h11(i + 1.0), f * f * (3.0 - 2.0 * f)); }
void main() {
  // across it: a thin white-hot filament, a coloured sheath round it, a faint halo
  float across = abs(vUv.y * 2.0 - 1.0);
  float core = exp(-across * across * 70.0);
  float sheath = exp(-across * across * 9.0);
  float halo = 1.0 - smoothstep(0.35, 1.0, across);
  float age = clamp(vAge, 0.0, 1.0);
  // along it: slow swells of light poured down its length, and quick glints running back
  float along = vUv.x;
  float flow = 0.62 + 0.38 * n11(along * 7.0 - uTime * 2.6);
  float glint = smoothstep(0.8, 1.0, n11(along * 29.0 - uTime * 8.0)) * (1.0 - age);
  float life = (1.0 - age) * (1.0 - age);
  float head = smoothstep(0.0, 0.03, age + 0.01);
  vec3 col = mix(uEdge, uCore, core * 0.85 + sheath * 0.15);
  float a = (core * 0.9 + sheath * 0.3 + halo * 0.06) * (flow + glint) * life * head * uGlow * vNear;
  vec3 light = col * (0.75 + core * (1.3 + glint * 1.4) * (1.0 - age));
  if (uAurora > 0.5) {
    // Starborn: an aurora braid. Two filaments twist round the stream's line
    // (each wingtip's vortex), born electric cyan, cooling through violet to
    // a rose-indigo as they age, and eaten into strands as they fade, so the
    // wake frays into the air instead of ending in a line. At an easy cruise
    // it is a quiet thread of moonlight; her dash wakes the colour.
    float y = vUv.y * 2.0 - 1.0;
    float tw = sin(along * 34.0 - uTime * 4.2) * (0.25 + 0.3 * age);
    float f1 = exp(-(y - tw) * (y - tw) * 55.0);
    float f2 = exp(-(y + tw) * (y + tw) * 55.0);
    float braid = max(f1, f2 * 0.8);
    float veil = exp(-y * y * 4.0) * 0.22;
    float fray = smoothstep(age * 1.1 - 0.1, age * 1.1 + 0.25, n11(along * 23.0 + y * 2.7 - uTime * 0.9));
    vec3 cyan = vec3(0.38, 0.92, 1.0), violet = vec3(0.58, 0.38, 1.0), rose = vec3(0.86, 0.36, 0.84), moon = vec3(0.86, 0.88, 1.0);
    vec3 hue = mix(mix(cyan, violet, smoothstep(0.04, 0.3, age)), rose, smoothstep(0.35, 0.8, age));
    hue = mix(moon, hue, uPower);
    float hot = (1.0 - age) * (1.0 - age);
    light = hue * (0.55 + braid * (0.9 + 0.6 * uPower) * (0.6 + 0.4 * hot) + glint * 0.8) + moon * f1 * hot * 0.25 * uPower;
    a = (braid * 0.95 + veil) * (flow + glint * 0.6) * fray * life * head * uGlow * vNear;
  }
  // additive: the filament runs hot enough for the soft bloom, the sheath does not
  gl_FragColor = vec4(light, min(a, 1.0));
}
`

const DROP_VERT = /* glsl */ `
attribute float dropLife;
attribute float dropSize;
varying float vLife;
void main() {
  vLife = dropLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = dropSize * (300.0 / max(0.5, -mv.z)) * (0.4 + 0.6 * dropLife);
  gl_Position = projectionMatrix * mv;
}
`
const DROP_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vLife;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  float a = exp(-d * 3.0) * vLife;
  gl_FragColor = vec4(uColor * (1.0 + 1.5 * exp(-d * 8.0)), a);
}
`

const _p = new THREE.Vector3()
const _a = new THREE.Vector3()
const _t = new THREE.Vector3()
const _side = new THREE.Vector3()
const _view = new THREE.Vector3()
const _drift = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _c0 = new THREE.Vector3()
const _c1 = new THREE.Vector3()
const _c2 = new THREE.Vector3()
const _c3 = new THREE.Vector3()
/** one emitter's smoothed curve (logical, float64) and each point's birth time; reused every frame */
const curve = new Float64Array(VERTS * 3)
const curveBorn = new Float64Array(VERTS)

const makeEmitter = (): Emitter => ({
  xyz: new Float64Array(SAMPLES * 3),
  born: new Float64Array(SAMPLES),
  head: 0,
  n: 0,
  last: new THREE.Vector3(Infinity, 0, 0),
  off: new THREE.Vector3(),
  offOk: false,
})

/** The i-th newest sample's slot. */
const slot = (em: Emitter, i: number): number => (em.head - i + SAMPLES) % SAMPLES
const sample = (em: Emitter, i: number, out: THREE.Vector3): THREE.Vector3 => {
  const k = slot(em, i) * 3
  return out.set(em.xyz[k], em.xyz[k + 1], em.xyz[k + 2])
}
const write = (em: Emitter, p: THREE.Vector3): void => {
  const k = em.head * 3
  em.xyz[k] = p.x; em.xyz[k + 1] = p.y; em.xyz[k + 2] = p.z
}

/** Where each emitter is on the horse now (logical); false when the model is not there. */
export const emitterPoint = (h: HorseState, k: number, out: THREE.Vector3): boolean => {
  const m = h.model
  if (!m) return false
  const name = k === 0 ? "wingTipL" : k === 1 ? "wingTipR" : "tail4"
  const bone = m.bones.get(name)
  if (!bone) return false
  // out to the end of the tip feathers (the bone runs along its local y)
  out.set(0, k < 2 ? 0.5 : 0.1, 0)
  // this frame's pose (the bones' world matrices are otherwise refreshed only at render)
  bone.updateWorldMatrix(true, false)
  bone.localToWorld(out)
  // render space → logical
  out.x += originRT.x
  out.z += originRT.z
  return true
}

export const PegasusTrail = (): React.ReactElement => {
  const sys = useMemo(() => {
    const root = new THREE.Group()
    root.name = "pegasus-trails"
    const trails = new Map<string, Trail>()
    // droplets of light, shared by every trail
    const dropGeo = new THREE.BufferGeometry()
    const dropPos = new Float32Array(DROPS * 3)
    const dropAt = new Float64Array(DROPS * 3)
    const dropVel = new Float32Array(DROPS * 3)
    const dropLife = new Float32Array(DROPS)
    const dropSize = new Float32Array(DROPS)
    dropGeo.setAttribute("position", new THREE.BufferAttribute(dropPos, 3))
    dropGeo.setAttribute("dropLife", new THREE.BufferAttribute(dropLife, 1))
    dropGeo.setAttribute("dropSize", new THREE.BufferAttribute(dropSize, 1))
    const dropMat = new THREE.ShaderMaterial({
      vertexShader: DROP_VERT, fragmentShader: DROP_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color("#fff1d8") } },
    })
    const drops = new THREE.Points(dropGeo, dropMat)
    drops.frustumCulled = false
    drops.renderOrder = 7
    root.add(drops)
    return { root, trails, dropGeo, dropPos, dropAt, dropVel, dropLife, dropSize, dropMat, drops, nextDrop: 0, time: 0, anchor: new THREE.Vector3(), frame: "" }
  }, [])

  useEffect(() => () => {
    for (const t of sys.trails.values()) { t.geo.dispose(); t.mat.dispose() }
    sys.dropGeo.dispose()
    sys.dropMat.dispose()
  }, [sys])

  const make = (h: HorseState): Trail | null => {
    const k = skillsOf(h.ident.breed)
    if (!k) return null
    const verts = 3 * VERTS * 2
    const geo = new THREE.BufferGeometry()
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts * 3), 3))
    geo.setAttribute("trailUv", new THREE.BufferAttribute(new Float32Array(verts * 2), 2))
    geo.setAttribute("trailAge", new THREE.BufferAttribute(new Float32Array(verts), 1))
    const idx: number[] = []
    for (let e = 0; e < 3; e++) for (let i = 0; i < VERTS - 1; i++) {
      const a = (e * VERTS + i) * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    geo.setIndex(idx)
    geo.setDrawRange(0, 0)
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uCore: { value: new THREE.Color(k.trail.core) }, uEdge: { value: new THREE.Color(k.trail.edge) }, uGlow: { value: 0 }, uTime: { value: 0 },
        uAurora: { value: k.signature === "starfall" ? 1 : 0 }, uPower: { value: 0 } },
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = `trail-${h.ident.id}`
    mesh.frustumCulled = false
    mesh.renderOrder = 6
    sys.root.add(mesh)
    return { id: h.ident.id, emitters: [makeEmitter(), makeEmitter(), makeEmitter()], mesh, geo, mat, glow: 0, dropAt: 0, life: LIFE, carryFrom: new THREE.Vector3(), carryOk: false }
  }

  const shed = (at: THREE.Vector3, vel: THREE.Vector3, size: number): void => {
    const i = sys.nextDrop
    sys.nextDrop = (i + 1) % DROPS
    sys.dropAt[i * 3] = at.x; sys.dropAt[i * 3 + 1] = at.y; sys.dropAt[i * 3 + 2] = at.z
    sys.dropVel[i * 3] = vel.x; sys.dropVel[i * 3 + 1] = vel.y; sys.dropVel[i * 3 + 2] = vel.z
    sys.dropLife[i] = 1
    sys.dropSize[i] = size
  }

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    sys.time += dt
    const now = sys.time
    const cam = state.camera
    // every vertex is written relative to a point near the camera, so a trail
    // over the Moon's ground (millions of metres out) is as crisp as at home
    sys.anchor.set(Math.round(cam.position.x), Math.round(cam.position.y), Math.round(cam.position.z))
    const A = sys.anchor
    sys.drops.position.copy(A)
    const deep = spaceRT.mode === "deep"
    // in deep space the scenery stands still and the universe streams past:
    // the trail is carried back at the real speed, capped to what reads
    if (deep) {
      _drift.copy(spaceRT.vel).applyQuaternion(_q.copy(spaceRT.park).invert())
      const v = _drift.length()
      if (v > 1e-3) _drift.multiplyScalar(-Math.min(v, 70) / v)
    } else _drift.set(0, 0, 0)
    const airless = deep || spaceRT.realm !== "earth"
    // a change of frame (into or out of deep space, onto another world) moves
    // every position at once: the old history would streak across the sky
    const frame = `${spaceRT.mode}:${spaceRT.realm}`
    const reframed = frame !== sys.frame
    sys.frame = frame
    for (const h of horseRT.horses.values()) {
      if (!isPegasus(h) || !h.flight) continue
      let t = sys.trails.get(h.ident.id)
      if (!t) {
        const made = make(h)
        if (!made) continue
        t = made
        sys.trails.set(h.ident.id, t)
      }
      const f = h.flight
      const k = f.skills ?? skillsOf(h.ident.breed)!
      const flying = h.visible && f.mode !== "ground"
      const fast = Math.min(1, Math.max(0, (h.speed - f.spec.minSpeed) / Math.max(1, f.spec.cruise * 1.6 - f.spec.minSpeed)))
      // the speed the stream is poured out at (deep space carries it back at most 70 m/s, see _drift)
      // (the history is carried back at the drift's speed, so that is the speed its length must answer to)
      // Starborn on her sails near a world (orbit is ~7.5 km/s): her stream is carried
      // along with her and pours back at 70 m/s, as in deep space, rather than thinning out
      const trueV = f.mode === "air" ? Math.hypot(h.speed, f.vy) : h.speed
      const carry = !deep && k.signature === "starfall" && trueV > 120 && flying && t.carryOk && !reframed
      if (carry) {
        _a.set(h.x, h.y, h.z).sub(t.carryFrom).multiplyScalar(1 - 70 / trueV)
        for (const em of t.emitters) for (let i = 0; i < em.n; i++) {
          const q = slot(em, i) * 3
          em.xyz[q] += _a.x; em.xyz[q + 1] += _a.y; em.xyz[q + 2] += _a.z
        }
      }
      t.carryFrom.set(h.x, h.y, h.z)
      t.carryOk = flying
      const seen = deep ? Math.max(Math.min(h.speed, 70), _drift.length()) : carry ? 70 : h.speed
      // past a few hundred m/s (the sail racing up out of the air) the light is left
      // behind faster than it can be seen, and the history (sampled in time) could
      // only draw it as straight rods kilometres long: the stream thins out instead
      const outrun = 1 - THREE.MathUtils.smoothstep(seen, 120, 400)
      // a glimmer at an easy cruise, building with speed; bright in a dash, a stoop or under sail,
      // and flaring for a moment when Starborn's sails release their light (AscentFX)
      // A cosmic journey has its own light (corridor, re-entry streaks). At those
      // speeds the trail's history stays inside its teleport threshold and drew
      // three straight rods from the top of the frame down to her on re-entry.
      const journeying = h === sailRT.pilot && travelRT.phase !== "idle" && travelRT.phase !== "gather"
      const want = flying && !journeying ? (0.12 + 0.5 * fast + (f.boostT > 0 ? 0.45 : 0) + (f.mode === "sail" ? 0.4 * Math.max(fast, f.boostT > 0 ? 1 : 0) : 0) + f.stoop * 0.35 + (h === sailRT.pilot ? ascentRT.flare * 0.8 : 0)) * outrun : 0
      // how far back it reaches: ~60 m at most, and under half the way to the camera, so
      // what a chase camera sees is a flourish behind her, never a beam running past the lens
      const camD = Math.hypot(h.x - cam.position.x, h.y - cam.position.y, h.z - cam.position.z)
      // (in airless space a stream with nothing to curl it reads as rods: shorter there)
      // and, carried straight back toward a chase camera, it foreshortens into
      // beams converging on the lens: in space it stays a short flourish)
      // (Starborn's aurora, under power, runs on past the view's sides: the wingtips are
      // metres either side of the lens and the stream fades before it nears it, vNear)
      const aur = k.signature === "starfall" ? (t.mat.uniforms.uPower.value as number) : 0
      const reach = airless ? Math.min(28 + 30 * aur, Math.max(3, camD * (0.22 + 0.8 * aur))) : Math.min(60 + 30 * aur, Math.max(10, camD * (0.45 + 1.6 * aur)))
      t.life += (Math.min(LIFE, Math.max(0.12, reach / Math.max(1, seen))) - t.life) * (1 - Math.exp(-dt * 3))
      t.glow += (want - t.glow) * (1 - Math.exp(-dt * (want > t.glow ? 3 : 1.6)))
      t.mat.uniforms.uGlow.value = Math.min(1.4, t.glow)
      t.mat.uniforms.uTime.value = now
      // the aurora's colour follows her power: a dash, the overdrive, a launch
      const power = Math.min(1, (f.boostT > 0 ? 0.6 : 0) + f.overdrive * 0.5 + f.launch * 0.5 + (f.mode === "sail" ? 0.6 * f.surge : 0))
      t.mat.uniforms.uPower.value += (power - t.mat.uniforms.uPower.value) * (1 - Math.exp(-dt * (power > t.mat.uniforms.uPower.value ? 6 : 1.5)))
      const aurora = k.signature === "starfall" ? 1 + 0.9 * t.mat.uniforms.uPower.value : 1
      const width = k.trail.width * (0.75 + 0.35 * Math.min(1, t.glow)) * aurora
      const pos = t.geo.attributes.position as THREE.BufferAttribute
      const uv = t.geo.attributes.trailUv as THREE.BufferAttribute
      const age = t.geo.attributes.trailAge as THREE.BufferAttribute
      let used = 0
      t.dropAt -= dt
      for (let e = 0; e < 3; e++) {
        const em = t.emitters[e]
        // the history ages; in deep space it is carried back
        if (deep) for (let i = 0; i < em.n; i++) {
          const k = slot(em, i) * 3
          em.xyz[k] += _drift.x * dt; em.xyz[k + 1] += _drift.y * dt; em.xyz[k + 2] += _drift.z * dt
        }
        while (em.n > 0 && now - em.born[slot(em, em.n - 1)] > t.life) em.n--
        if (reframed || journeying) em.n = 0
        if (!flying) em.offOk = false
        if (flying && t.glow > 0.03 && (e < 2 || k.trail.tail) && emitterPoint(h, e, _p)) {
          // A wingtip sweeps up and down a metre or more with every beat;
          // poured straight from it, the stream drew a sawtooth of white
          // lines round her. It flows from where the tip is on average
          // (its offset from the body, low-passed below the wingbeat), so the
          // light traces her flight and only a soft wave of the stroke.
          _c0.set(_p.x - h.x, _p.y - h.y, _p.z - h.z)
          if (!em.offOk || reframed) { em.off.copy(_c0); em.offOk = true }
          else em.off.lerp(_c0, 1 - Math.exp(-dt * 2.5))
          _p.set(h.x + em.off.x, h.y + em.off.y, h.z + em.off.z)
          // a teleport (a whistle bringing her round, a QA jump): start afresh rather than draw the jump
          if (em.n > 0) {
            sample(em, 0, _c0)
            if (_c0.distanceToSquared(_p) > (4 + h.speed * dt * 4) ** 2) em.n = 0
          }
          // sampled in time (not distance), so the ring always spans the whole LIFE at any speed
          if (em.n === 0 || now - em.born[em.head] >= STEP) {
            em.head = (em.head + 1) % SAMPLES
            em.born[em.head] = now
            em.n = Math.min(SAMPLES, em.n + 1)
            em.last.copy(_p)
          }
          // the newest point rides with the wingtip between samples
          write(em, _p)
          // droplets of light fall from the wingtips, more in a dash
          if (e < 2 && t.dropAt <= 0 && t.glow > 0.4) {
            _a.set((Math.random() - 0.5) * 0.6, airless ? (Math.random() - 0.5) * 0.4 : -0.3 - Math.random() * 0.4, (Math.random() - 0.5) * 0.6).addScaledVector(_drift, 0.6)
            shed(_p, _a, 0.05 + Math.random() * 0.05)
          }
        }
        if (em.n < 2) {
          for (let j = 0; j < VERTS; j++) { const v = (e * VERTS + j) * 2; pos.setXYZ(v, 0, 0, 0); pos.setXYZ(v + 1, 0, 0, 0); age.setX(v, 1); age.setX(v + 1, 1) }
          continue
        }
        // a smooth curve through the history (Catmull-Rom, SUB points a sample),
        // so a turn or a roll draws as a curve and never as a polygon
        let m = 0
        for (let i = 0; i < em.n - 1; i++) {
          sample(em, Math.max(0, i - 1), _c0)
          sample(em, i, _c1)
          sample(em, i + 1, _c2)
          sample(em, Math.min(em.n - 1, i + 2), _c3)
          const b1 = em.born[slot(em, i)], b2 = em.born[slot(em, i + 1)]
          for (let q = 0; q < SUB; q++) {
            const u = q / SUB, u2 = u * u, u3 = u2 * u
            const k0 = -0.5 * u3 + u2 - 0.5 * u, k1 = 1.5 * u3 - 2.5 * u2 + 1, k2 = -1.5 * u3 + 2 * u2 + 0.5 * u, k3 = 0.5 * u3 - 0.5 * u2
            curve[m * 3] = _c0.x * k0 + _c1.x * k1 + _c2.x * k2 + _c3.x * k3
            curve[m * 3 + 1] = _c0.y * k0 + _c1.y * k1 + _c2.y * k2 + _c3.y * k3
            curve[m * 3 + 2] = _c0.z * k0 + _c1.z * k1 + _c2.z * k2 + _c3.z * k3
            curveBorn[m] = b1 + (b2 - b1) * u
            m++
          }
        }
        sample(em, em.n - 1, _c1)
        curve[m * 3] = _c1.x; curve[m * 3 + 1] = _c1.y; curve[m * 3 + 2] = _c1.z
        curveBorn[m] = em.born[slot(em, em.n - 1)]
        m++
        // a ribbon facing the camera along the curve
        const base = e * VERTS * 2
        for (let j = 0; j < m; j++) {
          _p.set(curve[j * 3], curve[j * 3 + 1], curve[j * 3 + 2])
          const ja = Math.max(0, j - 1) * 3, jb = Math.min(m - 1, j + 1) * 3
          _t.set(curve[ja] - curve[jb], curve[ja + 1] - curve[jb + 1], curve[ja + 2] - curve[jb + 2])
          if (_t.lengthSq() < 1e-10) _t.set(0, 0, 1)
          _t.normalize()
          _view.copy(_p).sub(cam.position).normalize()
          _side.crossVectors(_t, _view)
          if (_side.lengthSq() < 1e-8) _side.set(1, 0, 0)
          _side.normalize()
          const born = curveBorn[j]
          // its age, and the last stretch tapers out so a young trail never ends in a hard edge
          const u = Math.max(Math.min(1, (now - born) / t.life), 1 - Math.min(1, (m - 1 - j) / (4 * SUB)))
          // a liquid jet beads up as it ages (Rayleigh–Plateau): the stream pinches into
          // drops strung along it, fixed to the air it was poured into
          const bead = Math.min(1, Math.max(0, (u - 0.25) / 0.45))
          const pinch = 1 - bead * 0.6 * (0.5 + 0.5 * Math.cos(born * BEAD_HZ * Math.PI * 2 + e * 2.1))
          // the wake spreads as it ages while it fades (it does not shrink to a point)
          const w = width * (e === 2 ? 0.8 : 1) * (1 + u * 1.3) * pinch * (j === 0 ? 0.5 : 1)
          // Starborn's streams under power wind into the helix a wingtip vortex makes,
          // fixed in the air they were poured into, the two wings turning opposite ways
          if (aur > 0.02 && e < 2) {
            const ang = born * (14 + 10 * aur) * (e === 0 ? 1 : -1)
            const rad = (0.15 + 0.85 * u) * 0.7 * aur
            _c3.crossVectors(_t, _side)
            _p.addScaledVector(_side, Math.cos(ang) * rad).addScaledVector(_c3, Math.sin(ang) * rad)
          }
          const v = base + j * 2
          pos.setXYZ(v, _p.x - A.x + _side.x * w, _p.y - A.y + _side.y * w, _p.z - A.z + _side.z * w)
          pos.setXYZ(v + 1, _p.x - A.x - _side.x * w, _p.y - A.y - _side.y * w, _p.z - A.z - _side.z * w)
          uv.setXY(v, j / (VERTS - 1), 0)
          uv.setXY(v + 1, j / (VERTS - 1), 1)
          age.setX(v, u)
          age.setX(v + 1, u)
        }
        // collapse the unused end of this emitter's strip onto its last point
        for (let j = m; j < VERTS; j++) {
          const v = base + j * 2
          pos.setXYZ(v, _p.x - A.x, _p.y - A.y, _p.z - A.z)
          pos.setXYZ(v + 1, _p.x - A.x, _p.y - A.y, _p.z - A.z)
          age.setX(v, 1)
          age.setX(v + 1, 1)
        }
        used = e + 1
      }
      if (t.dropAt <= 0) t.dropAt = f.boostT > 0 ? 0.025 : 0.07
      t.mesh.visible = used > 0 && t.glow > 0.01
      t.geo.setDrawRange(0, 3 * (VERTS - 1) * 6)
      pos.needsUpdate = uv.needsUpdate = age.needsUpdate = true
      t.mesh.position.copy(A)
    }
    // the droplets: gravity in the air, free drift in space; they cool and go out
    const g = airless ? 0 : -3.2
    for (let i = 0; i < DROPS; i++) {
      if (sys.dropLife[i] <= 0) continue
      sys.dropLife[i] = Math.max(0, sys.dropLife[i] - dt / 1.6)
      sys.dropVel[i * 3 + 1] += g * dt
      if (deep) { sys.dropVel[i * 3] += _drift.x * dt * 2; sys.dropVel[i * 3 + 1] += _drift.y * dt * 2; sys.dropVel[i * 3 + 2] += _drift.z * dt * 2 }
      sys.dropAt[i * 3] += sys.dropVel[i * 3] * dt
      sys.dropAt[i * 3 + 1] += sys.dropVel[i * 3 + 1] * dt
      sys.dropAt[i * 3 + 2] += sys.dropVel[i * 3 + 2] * dt
    }
    for (let i = 0; i < DROPS; i++) {
      sys.dropPos[i * 3] = sys.dropAt[i * 3] - A.x
      sys.dropPos[i * 3 + 1] = sys.dropAt[i * 3 + 1] - A.y
      sys.dropPos[i * 3 + 2] = sys.dropAt[i * 3 + 2] - A.z
    }
    ;(sys.dropGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true
    ;(sys.dropGeo.attributes.dropLife as THREE.BufferAttribute).needsUpdate = true
    ;(sys.dropGeo.attributes.dropSize as THREE.BufferAttribute).needsUpdate = true
  })

  return <primitive object={sys.root} />
}
