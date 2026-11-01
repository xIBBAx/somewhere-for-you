import * as THREE from "three"

/**
 * Reachable echoes of the Sun's field, not surface plasma at Starborn's safe
 * 3.5R approach. Shapes studied from NASA/SDO: prominence_sdo_2010090,
 * PIA21101 (171Å field-line fans), and PIA22196 (cool curling prominence).
 * Unequal, partially traced field lines share a root region; none is a hoop.
 */
export const SOLAR_STRANDS = 24
export const SOLAR_SEGMENTS = 64
export const SOLAR_INDICES_PER_STRAND = SOLAR_SEGMENTS * 6 * 2
const TAU = Math.PI * 2
const hash = (n: number): number => {
  const h = Math.sin(n * 127.1 + 31.7) * 43758.5453
  return h - Math.floor(h)
}
const path = (points: number[][]): THREE.CatmullRomCurve3 => new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), false, "centripetal")
const PATHS = [
  // A leaning fan: high, narrow roots split into open, falling threads.
  path([[-90, -55, -85], [-98, 5, -30], [-63, 83, 10], [-8, 112, 26], [48, 76, -12], [65, 12, -95]]),
  // A lopsided hooked return, never a complete ellipse or a navigational gate.
  path([[-68, -48, -80], [-48, 12, -18], [-12, 77, 16], [39, 103, 30], [74, 73, 1], [48, 28, -54], [14, 4, -108]]),
  // A low, torn streamer; its long free end bends back toward the star.
  path([[-83, -39, -100], [-38, -5, -39], [4, 34, 3], [49, 56, 20], [101, 43, -7], [130, 12, -83]]),
]

/** Deterministic local metres, reusable out parameter; build time only. */
export const sampleSolarStrand = (cluster: number, strand: number, u: number, out: THREE.Vector3): THREE.Vector3 => {
  const seed = cluster * 41 + strand * 1.71
  const type = strand % 4
  const start = type === 2 ? 0.18 + hash(seed + 9) * 0.15 : type === 3 ? 0.43 + hash(seed + 8) * 0.12 : 0
  const end = type === 0 ? 0.62 + hash(seed + 6) * 0.22 : type === 1 ? 0.45 + hash(seed + 3) * 0.27 : type === 2 ? 0.68 + hash(seed + 4) * 0.16 : 1
  const t = start + (end - start) * Math.min(1, Math.max(0, u))
  PATHS[cluster % 3].getPoint(t, out)
  const envelope = Math.sin(Math.PI * t)
  out.x += (hash(seed + 1) - 0.5) * (20 + envelope * 28) + envelope * Math.sin(t * TAU * 1.3 + seed) * 4
  out.y *= 0.76 + hash(seed + 2) * 0.46
  out.y += envelope * (hash(seed + 5) - 0.5) * 17
  out.z += (hash(seed + 7) - 0.5) * (13 + envelope * 34)
  // Bounded multiscale meanders: nearby strands share a magnetic direction,
  // but the plasma breaks into wrinkled rivulets rather than polished cables.
  const bend = Math.sin(t * TAU * 2.1 + seed) * 4.2 + Math.sin(t * TAU * 5.3 + seed * 1.7) * 1.8
  const fray = Math.sin(t * TAU * 9.7 + seed * 2.1) * 0.65
  out.x += envelope * (bend + fray)
  out.y += envelope * (Math.sin(t * TAU * 3.7 + seed * 0.7) * 4.4 + fray)
  out.z += envelope * bend * 0.7
  if (type === 3) out.y -= Math.sin(Math.PI * u) * (12 + hash(seed + 12) * 26)
  // A nearby echo must remain a small detail against the distant stellar disc.
  out.multiplyScalar([0.4, 0.5, 0.36][cluster % 3])
  return out
}

/** Crossed ribbons mix thin rivulets and broad eroded veils at grazing views. One
 * indexed mesh per cluster, no tubes, billboards, per-frame buffers or trails. */
export const buildSolarFilaments = (cluster: number): THREE.BufferGeometry => {
  const n = SOLAR_STRANDS * 2 * (SOLAR_SEGMENTS + 1) * 2
  const positions = new Float32Array(n * 3), offsets = new Float32Array(n * 3)
  const uv = new Float32Array(n * 2), seeds = new Float32Array(n), heat = new Float32Array(n), body = new Float32Array(n)
  const index = new Uint16Array(SOLAR_STRANDS * SOLAR_INDICES_PER_STRAND)
  const p = new THREE.Vector3(), next = new THREE.Vector3(), prev = new THREE.Vector3(), tangent = new THREE.Vector3()
  const across = new THREE.Vector3(), second = new THREE.Vector3(), reference = new THREE.Vector3(0, 0, 1)
  let v = 0, at = 0
  for (let strand = 0; strand < SOLAR_STRANDS; strand++) {
    const seed = hash(strand * 3.31 + cluster * 19)
    const sheet = strand % 4 === 0
    const scale = [0.4, 0.5, 0.36][cluster % 3]
    const width = (sheet ? 13 + 12 * hash(strand + 4) : strand % 4 === 3 ? 3 + 5 * hash(strand + 8) : 0.8 + 2.1 * hash(strand + cluster * 31 + 4)) * scale
    for (let ribbon = 0; ribbon < 2; ribbon++) {
      const first = v
      for (let j = 0; j <= SOLAR_SEGMENTS; j++) {
        const u = j / SOLAR_SEGMENTS
        sampleSolarStrand(cluster, strand, u, p)
        sampleSolarStrand(cluster, strand, Math.min(1, u + 0.004), next)
        sampleSolarStrand(cluster, strand, Math.max(0, u - 0.004), prev)
        tangent.subVectors(next, prev).normalize()
        across.crossVectors(tangent, reference).normalize()
        if (across.lengthSq() < 0.1) across.set(1, 0, 0)
        second.crossVectors(tangent, across).normalize()
        const angle = seed * Math.PI + ribbon * Math.PI / 2
        const envelope = Math.sin(Math.PI * u)
        const thickness = width * (0.12 + 0.88 * envelope ** 0.6) * (0.7 + 0.3 * Math.sin(u * 19 + seed * 13) ** 2)
        for (const sign of [-1, 1]) {
          positions.set([p.x, p.y, p.z], v * 3)
          offsets[v * 3] = (across.x * Math.cos(angle) + second.x * Math.sin(angle)) * thickness * sign
          offsets[v * 3 + 1] = (across.y * Math.cos(angle) + second.y * Math.sin(angle)) * thickness * sign
          offsets[v * 3 + 2] = (across.z * Math.cos(angle) + second.z * Math.sin(angle)) * thickness * sign
          uv[v * 2] = u; uv[v * 2 + 1] = sign
          seeds[v] = seed; heat[v] = sheet ? 0.12 + seed * 0.3 : 0.45 + seed * 0.55; body[v] = sheet ? 1 : 0
          v++
        }
        if (j < SOLAR_SEGMENTS) {
          const a = first + j * 2
          index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], at)
          at += 6
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute("aOffset", new THREE.BufferAttribute(offsets, 3))
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2))
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1))
  geometry.setAttribute("aHeat", new THREE.BufferAttribute(heat, 1))
  geometry.setAttribute("aBody", new THREE.BufferAttribute(body, 1))
  geometry.setIndex(new THREE.BufferAttribute(index, 1))
  geometry.computeBoundingSphere()
  return geometry
}

export const SOLAR_FILAMENT_VERT = /* glsl */ `
attribute vec3 aOffset;
attribute float aSeed;
attribute float aHeat;
attribute float aBody;
uniform float uTime;
uniform float uWake;
uniform float uCalm;
uniform float uHalo;
varying vec2 vUv;
varying float vSeed;
varying float vHeat;
varying float vBody;
void main() {
  vUv = uv; vSeed = aSeed; vHeat = aHeat; vBody = aBody;
  float envelope = sin(uv.x * 3.14159265);
  // Slow field breathing and a small travelling response; roots stay put.
  float shift = sin(uv.x * 8.1 + uTime * 0.19 + aSeed * 6.28) * (1.0 - uCalm * 0.8);
  vec3 p = position + aOffset * mix(1.0, mix(3.8, 1.65, aBody), uHalo);
  p += vec3(shift * 1.8, sin(uTime * 0.13 + aSeed * 7.0) * 1.2, shift) * envelope;
  // Her pass ripples the light, not the size or shape of the field.
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`

export const SOLAR_FILAMENT_FRAG = /* glsl */ `
uniform float uTime;
uniform float uWake;
uniform float uCalm;
uniform float uHalo;
varying vec2 vUv;
varying float vSeed;
varying float vHeat;
varying float vBody;
float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + 1.0), f.x), f.y);
}
float cloud(vec2 p) {
  return noise2(p) * 0.57 + noise2(p * 2.03 + 17.1) * 0.29 + noise2(p * 4.11 - 8.7) * 0.14;
}
void main() {
  float direction = vSeed < 0.48 ? -1.0 : 1.0;
  float t = uTime * (0.36 - uCalm * 0.27) * direction;
  vec2 field = vec2(vUv.x * 12.0 - t * 0.23 + vSeed * 17.0, vUv.y * 1.9 + vSeed * 31.0);
  float warp = noise2(field * 0.6 + vec2(t * 0.04, 0.0));
  float density = cloud(field + vec2(warp * 2.1, warp * 1.7));
  float wrinkles = noise2(field * vec2(2.1, 1.4) + 21.0);
  float edge = 1.0 - smoothstep(0.0, 0.98, abs(vUv.y + (density - 0.5) * 0.75));
  edge = pow(edge, mix(1.6, 0.8, vBody));
  float ends = smoothstep(0.0, 0.12, vUv.x) * (1.0 - smoothstep(0.73, 1.0, vUv.x));
  // Eroded translucent folds between bright broken rivulets. Broad sheets
  // supply volume; the cool falling material is not a uniform glowing cable.
  float veil = smoothstep(0.28, 0.73, density) * (0.5 + wrinkles * 0.5);
  // Sparse broken runoff, not an unbroken bright edge tracing the curve.
  float rivulet = smoothstep(0.52, 0.78, density + wrinkles * 0.12);
  float knot = smoothstep(0.61, 0.85, noise2(vec2(vUv.x * 21.0 - t, vSeed * 17.0) + warp));
  float pulse = uWake * (0.5 + 0.5 * sin(vUv.x * 24.0 - uTime * (0.9 - uCalm * 0.6))) * 0.26;
  float bright = clamp(vHeat * 0.4 + knot * 0.7 + pulse, 0.0, 1.0);
  vec3 cool = mix(vec3(0.62, 0.015, 0.025), vec3(1.3, 0.07, 0.012), density);
  vec3 hot = mix(vec3(1.35, 0.13, 0.008), vec3(2.4, 0.72, 0.12), knot);
  vec3 colour = mix(cool, hot, bright * mix(1.0, 0.8, vBody));
  // The filmy body carries the emission; the thin knots are supporting detail.
  float alpha = edge * ends * mix(rivulet, veil, vBody) * mix(0.23, 0.74, vBody);
  colour = mix(colour, vec3(1.0, 0.08, 0.008) * (0.35 + bright), uHalo);
  alpha *= mix(1.0, 0.10, uHalo);
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(colour, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

export const createSolarFilament = (cluster: number) => {
  const geometry = buildSolarFilaments(cluster)
  const uniforms = { uTime: { value: 0 }, uWake: { value: 0 }, uCalm: { value: 0 } }
  const material = (halo: boolean) => new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uHalo: { value: halo ? 1 : 0 } },
    vertexShader: SOLAR_FILAMENT_VERT, fragmentShader: SOLAR_FILAMENT_FRAG,
    transparent: true, depthWrite: false, depthTest: true, fog: false,
    // Emission adds light. Alpha-over broad sheets made gray opaque streaks
    // on the photographed-bright Sun, contradicting the near-field echo.
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  })
  const coreMaterial = material(false), haloMaterial = material(true)
  const root = new THREE.Group()
  root.name = `solar-field-echo-${cluster}`
  const core = new THREE.Mesh(geometry, coreMaterial), halo = new THREE.Mesh(geometry, haloMaterial)
  core.name = "plasma-threads"; halo.name = "plasma-thread-haze"
  core.frustumCulled = halo.frustumCulled = false
  halo.renderOrder = 1; core.renderOrder = 2
  root.add(halo, core)
  return {
    root,
    update(time: number, wake: number, calm: boolean, quality: "low" | "medium" | "high"): void {
      uniforms.uTime.value = time; uniforms.uWake.value = wake; uniforms.uCalm.value = calm ? 1 : 0
      const count = quality === "low" ? 12 : quality === "medium" ? 18 : SOLAR_STRANDS
      geometry.setDrawRange(0, count * SOLAR_INDICES_PER_STRAND)
      halo.visible = quality !== "low"
    },
    dispose(): void { geometry.dispose(); coreMaterial.dispose(); haloMaterial.dispose() },
  }
}
