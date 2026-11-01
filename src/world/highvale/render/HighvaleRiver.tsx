import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { worldRT } from "../../../game/runtime"
import { weatherRT } from "../../../game/weather/weatherState"
import { WATER_LEVEL } from "../../climate"
import { worldHeight } from "../../terrain"
import { HIGHVALE_CENTER, RIVER_N0, RIVER_N1, riverE, toWorld } from "../highvaleLayout"
import { riverFall, riverReach, surfaceLevel } from "../highvaleRiver"

/**
 * The river, running. A ribbon down the carved channel whose surface follows
 * the river's own fall (highvaleRiver.ts), drawn in pieces so only the reach
 * near the eye is sent to the GPU. Glacial water: grey-green and clear in
 * the shallows over the shingle, darker in the pools, broken white where the
 * bed steepens or the water runs thin over stones. It moves downstream.
 */
const ROW = 4
const ACROSS = 12
const PIECE = 256
const DRAW = 2600

type Piece = { mesh: THREE.Mesh; cx: number; cz: number }

const buildPiece = (n0: number, n1: number): THREE.BufferGeometry | null => {
  const rows = Math.max(2, Math.round((n1 - n0) / ROW) + 1)
  const pos: number[] = [], depth: number[] = [], flow: number[] = []
  const index: number[] = []
  let wet = false
  for (let r = 0; r < rows; r++) {
    const n = n0 + ((n1 - n0) * r) / (rows - 1)
    const level = surfaceLevel(n)
    if (level === null) return null
    const reach = riverReach(n), c = riverE(n), fall = riverFall(n)
    for (let a = 0; a <= ACROSS; a++) {
      const u = a / ACROSS * 2 - 1
      const e = c + u * reach
      const [x, z] = toWorld(e, n)
      // the lake at the foot is drawn by the lakes (StreamedWater)
      const d = level <= WATER_LEVEL + 0.05 ? -0.5 : level - worldHeight(x, z)
      if (d > 0.02) wet = true
      pos.push(e, level, -n)
      depth.push(Math.max(-0.5, d))
      // across (m from the centre line), distance down the river (m), local fall, edge (0..1)
      flow.push(u * reach, RIVER_N1 - n, fall, Math.abs(u))
    }
  }
  if (!wet) return null
  const w = ACROSS + 1
  for (let r = 0; r < rows - 1; r++) for (let a = 0; a < ACROSS; a++) {
    const i = r * w + a
    // rows run north (-z), columns east (+x): wound to face the sky
    index.push(i, i + 1, i + w, i + 1, i + w + 1, i + w)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute("waterDepth", new THREE.Float32BufferAttribute(depth, 1))
  g.setAttribute("flow", new THREE.Float32BufferAttribute(flow, 4))
  g.setIndex(index)
  g.computeBoundingSphere()
  return g
}

const makeMaterial = (): THREE.ShaderMaterial => new THREE.ShaderMaterial({
  uniforms: {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uTime: { value: 0 }, uNight: { value: 0 }, uRain: { value: 0 },
    uSky: { value: new THREE.Color("#cae8f1") },
    uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() }, uSunColor: { value: new THREE.Color("#fff3d6") },
  },
  vertexShader: /* glsl */ `
    #include <common>
    #include <fog_pars_vertex>
    attribute float waterDepth;
    attribute vec4 flow;
    varying float vDepth; varying vec4 vFlow; varying vec3 vEye; varying vec3 vWorld;
    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vDepth = waterDepth; vFlow = flow; vWorld = world.xyz;
      vEye = cameraPosition - world.xyz;
      vec4 mvPosition = viewMatrix * world;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: /* glsl */ `
    #include <common>
    #include <fog_pars_fragment>
    uniform float uTime; uniform float uNight; uniform float uRain;
    uniform vec3 uSky; uniform vec3 uSunDir; uniform vec3 uSunColor;
    varying float vDepth; varying vec4 vFlow; varying vec3 vEye; varying vec3 vWorld;
    // the lattice wraps (289 cells), keeping the hash exact kilometres down the river
    float h21(vec2 p) { p = mod(p, 289.0); p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
    // the surface in the river's own frame, metres: x across, y down the river.
    // The current draws everything out along itself: long streaks, short across.
    // each octave turned off the lattice (and stretched along the current),
    // so no grid or chevron survives into the glints at grazing angles
    float oct(vec2 q, float sx, float sy, float ang, float t, vec2 off) {
      float c = cos(ang), s = sin(ang);
      vec2 p = vec2(q.x * sx, (q.y - t) * sy);
      return vnoise(mat2(c, -s, s, c) * p + off);
    }
    float surf(vec2 q, float speed, float fine) {
      float t = uTime * speed;
      float a = oct(q, 0.2, 0.06, 0.37, t, vec2(0.0));
      float b = oct(q, 0.7, 0.3, -0.61, t * 1.2, vec2(7.0, 3.0));
      float c = oct(q, 2.1, 1.2, 1.13, t * 1.4, vec2(-3.0, 11.0));
      float d = oct(q, 5.3, 3.4, -0.29, t * 1.6, vec2(13.0, -5.0));
      return a * 0.42 + b * 0.3 + c * 0.2 * fine + d * 0.08 * fine * fine + 0.14 * (1.0 - fine);
    }
    void main() {
      if (vDepth <= 0.0) discard;
      float fall = vFlow.z;
      // a lowland river walks; this one runs, faster in its falls and its middle
      float mid = 1.0 - vFlow.w * vFlow.w;
      float speed = (1.3 + min(fall, 0.08) * 30.0) * (0.5 + 0.65 * mid);
      vec2 q = vFlow.xy;
      float px = length(fwidth(q));
      float fine = 1.0 - smoothstep(0.05, 0.35, px);
      float h0 = surf(q, speed, fine);
      float e = 0.25;
      float hx = surf(q + vec2(e, 0.0), speed, fine), hy = surf(q + vec2(0.0, e), speed, fine);
      float rapidC = smoothstep(0.42, 0.7, vnoise(vec2(3.7, q.y * 0.011)) * 0.7 + vnoise(vec2(q.x * 0.05, q.y * 0.04)) * 0.3);
      float choppy = (0.5 + min(fall, 0.08) * 9.0 + (1.0 - smoothstep(0.15, 0.9, vDepth)) * 0.6 + rapidC * 0.9) * mix(0.35, 1.0, fine);
      // q.y grows downstream, which is world +z (south)
      vec3 normal = normalize(vec3(-(hx - h0) / e * choppy * 0.5, 1.0, -(hy - h0) / e * choppy * 0.5));
      vec3 eye = normalize(vEye);
      float cosV = max(0.0, dot(normal, eye));
      // broken water reflects less of the sky than a still pool would
      float fresnel = (0.02 + 0.98 * pow(1.0 - cosV, 5.0)) * 0.72;
      // glacial water: rock flour keeps it a milky grey-green
      float deep = 1.0 - exp(-vDepth * 0.75);
      vec3 shallow = vec3(0.17, 0.24, 0.205), pool = vec3(0.035, 0.08, 0.075);
      vec3 body = mix(shallow, pool, deep) * (0.92 + 0.16 * h0);
      vec3 r = reflect(-eye, normal);
      vec3 sky = mix(uSky * 0.85, uSky * vec3(0.5, 0.7, 0.95), smoothstep(0.02, 0.6, r.y));
      vec3 color = mix(body, sky, clamp(fresnel, 0.0, 1.0));
      // white water: riffles over shallow stones, standing waves in the falls,
      // streaks drawn out by the current; fades to its average far away
      float streak = vnoise(vec2(q.x * 0.9, (q.y - uTime * speed * 1.1) * 0.12));
      float thin = 1.0 - smoothstep(0.12, 0.55, vDepth);
      // reaches of rapids every hundred metres or so, where the bed is rockier
      float rapid = smoothstep(0.42, 0.7, vnoise(vec2(3.7, q.y * 0.011)) * 0.7 + vnoise(vec2(q.x * 0.05, q.y * 0.04)) * 0.3);
      float rough = clamp(min(fall, 0.1) * 11.0 + thin * 0.75 + rapid * 0.65 * mid, 0.0, 1.0);
      // patches where the water breaks (a metre or two across, drawn out by
      // the current), and inside them the foam itself: a lace of bubbles and
      // threads a hand's width across, never a painted band
      float patchN = oct(q, 1.1, 0.45, 0.6, uTime * speed * 1.05, vec2(5.0, 9.0)) * 0.75 + streak * 0.25;
      float patchW = smoothstep(0.7 - rough * 0.18, 0.88 - rough * 0.14, patchN) * smoothstep(0.25, 0.6, rough);
      float lace = oct(q, 3.6, 2.4, -0.8, uTime * speed * 1.2, vec2(17.0, 3.0)) * 0.6 + oct(q, 7.5, 5.0, 0.35, uTime * speed * 1.3, vec2(-4.0, 21.0)) * 0.4;
      float bubbles = mix(0.45, smoothstep(0.42, 0.7, lace), fine);
      float foam = clamp(patchW * bubbles * (0.18 + 0.36 * rough), 0.0, 0.42);
      vec3 lit = uSunColor * (0.55 + 0.45 * max(0.0, uSunDir.y)) * (1.0 - uNight * 0.85);
      color = mix(color, vec3(0.78, 0.82, 0.8) * (0.35 + 0.65 * length(lit) / 1.7), foam);
      float facing = max(0.0, dot(r, uSunDir));
      float spec = pow(facing, 160.0) * (0.3 + fine * 1.4 * step(0.55, h0)) + pow(facing, 36.0) * 0.08;
      color += uSunColor * spec * (1.0 - uNight * 0.85) * (1.0 - uRain * 0.7) * (1.0 - foam);
      color *= 1.0 - uNight * 0.55;
      // a film over a shingle bar is barely there, and the ribbon's own
      // outer limit never shows as an edge
      float body0 = smoothstep(0.02, 0.32, vDepth) * (1.0 - smoothstep(0.78, 0.98, vFlow.w));
      float alpha = body0 * (0.5 + deep * 0.45 + fresnel * 0.3);
      alpha = clamp(max(alpha, foam * body0), 0.0, 0.96);
      gl_FragColor = vec4(color, alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
  transparent: true, depthWrite: false, fog: true,
})

export const HighvaleRiver = (): React.ReactElement => {
  const { scene, camera } = useThree()
  const material = useMemo(() => makeMaterial(), [])
  // one memo for the group and its pieces: StrictMode may run it twice
  const { root, pieces } = useMemo(() => {
    const root = new THREE.Group()
    root.name = "highvale-river"
    const out: Piece[] = []
    for (let n0 = RIVER_N0; n0 < RIVER_N1; n0 += PIECE) {
      const n1 = Math.min(RIVER_N1, n0 + PIECE)
      const g = buildPiece(n0, n1)
      if (!g) continue
      const mesh = new THREE.Mesh(g, material)
      mesh.name = `river:${n0}`
      mesh.renderOrder = 1
      mesh.position.set(HIGHVALE_CENTER.x, 0, HIGHVALE_CENTER.z)
      mesh.updateMatrix()
      mesh.matrixAutoUpdate = false
      root.add(mesh)
      const nm = (n0 + n1) / 2
      const [cx, cz] = toWorld(riverE(nm), nm)
      out.push({ mesh, cx, cz })
    }
    return { root, pieces: out }
  }, [material])
  useEffect(() => () => {
    for (const p of pieces) p.mesh.geometry.dispose()
    material.dispose()
  }, [pieces, material])
  const sun = useMemo(() => ({ light: null as THREE.DirectionalLight | null }), [])
  useFrame((_, dt) => {
    // children of WorldRoot keep logical coordinates (world/origin.ts); so does the camera
    const cam = camera.position
    for (const p of pieces) p.mesh.visible = Math.hypot(p.cx - cam.x, p.cz - cam.z) < DRAW
    if (!sun.light) scene.traverse((o) => { if (!sun.light && (o as THREE.DirectionalLight).isDirectionalLight && o.castShadow) sun.light = o as THREE.DirectionalLight })
    const u = material.uniforms
    if (sun.light) {
      u.uSunDir.value.subVectors(sun.light.position, sun.light.target.position).normalize()
      u.uSunColor.value.copy(sun.light.color)
    }
    u.uTime.value = (u.uTime.value + Math.min(dt, 0.1)) % 3600
    u.uNight.value = THREE.MathUtils.smoothstep(worldRT.timeOfDay, 0.65, 0.97)
    u.uRain.value = weatherRT.rain
    if (scene.background instanceof THREE.Color) u.uSky.value.copy(scene.background)
  })
  return <primitive object={root} />
}
