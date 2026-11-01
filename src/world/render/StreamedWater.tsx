import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { worldRT } from "../../game/runtime"
import { weatherRT } from "../../game/weather/weatherState"
import { WORLD_NOISE_GLSL, originUniforms } from "../origin"
import { subscribeChunks } from "../worldRuntime"
import { CHUNK_SIZE } from "../worldConfig"
import { windUniforms } from "../wind"
import { buildWaterGeometry } from "./waterGeometry"
import { WATER_WAKE_GLSL, waterWakeUniforms } from "./waterWake"

export const waterStats = { chunks: 0, triangles: 0 }

const makeWaterMaterial = (): THREE.ShaderMaterial => new THREE.ShaderMaterial({
  uniforms: {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    ...waterWakeUniforms,
    uOriginWrap: originUniforms.uOriginWrap, uTime: windUniforms.uTime, uWindDir: windUniforms.uWindDir, uWindStrength: windUniforms.uWindStrength,
    uNight: { value: 0 }, uRain: { value: 0 }, uSky: { value: new THREE.Color("#cae8f1") },
    uDeep: { value: new THREE.Color("#21545b") }, uShallow: { value: new THREE.Color("#84aaa0") },
    uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() }, uSunColor: { value: new THREE.Color("#fff3d6") },
  },
  vertexShader: /* glsl */ `
    #include <common>
    #include <fog_pars_vertex>
    ${WORLD_NOISE_GLSL}
    uniform float uTime; uniform float uWindStrength; uniform vec2 uWindDir;
    attribute float waterDepth;
    varying float vDepth; varying vec3 vWater; varying vec3 vEye;
    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vec2 p = wPos(world.xz);
      float wave = sin(dot(p, vec2(13.0, 17.0)) * 0.006135923 + uTime * 1.15)
                 + sin(dot(p, vec2(-23.0, 11.0)) * 0.006135923 - uTime * 0.8);
      world.y += wave * (0.007 + uWindStrength * 0.006) * smoothstep(0.0, 0.45, waterDepth);
      vWater = world.xyz; vEye = cameraPosition - world.xyz; vDepth = waterDepth;
      vec4 mvPosition = viewMatrix * world;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: /* glsl */ `
    #include <common>
    #include <fog_pars_fragment>
    ${WORLD_NOISE_GLSL}
    uniform float uTime; uniform float uWindStrength; uniform vec2 uWindDir;
    uniform float uNight; uniform float uRain; uniform vec3 uSky; uniform vec3 uDeep; uniform vec3 uShallow;
    uniform vec3 uSunDir; uniform vec3 uSunColor;
    ${WATER_WAKE_GLSL}
    varying float vDepth; varying vec3 vWater; varying vec3 vEye;
    // Sum of directional waves. Integer lattice vectors keep every wave
    // periodic over the 1024 m origin wrap, so rebasing never seams.
    vec2 waveSlope(vec2 p, vec2 v, float slope, float speed) {
      vec2 k = v * 0.006135923;
      float ph = dot(p, k) + uTime * speed;
      // Filter each wavelength in screen space, including the long waves at
      // grazing angles. A shared distance fade leaves their specular glints
      // undersampled even after the shortest waves have disappeared.
      float resolved = 1.0 - smoothstep(0.75, 3.141593, fwidth(ph));
      return k / max(length(k), 1e-4) * cos(ph) * slope * resolved;
    }
    void main() {
      vec2 p = wPos(vWater.xz);
      float drift = wNoise(vWater.xz - uWindDir * uTime * 0.12, 128.0);
      // gust "cat's paws": patches where the surface is ruffled more
      float paws = smoothstep(0.35, 0.8, wNoise(vWater.xz - uWindDir * uTime * 0.9, 64.0) * 0.7 + wNoise(vWater.xz + uWindDir * uTime * 0.4, 192.0) * 0.3);
      float rough = (0.55 + uWindStrength * 0.9) * (0.6 + paws * 0.8);
      // Wave trains wander: bend their crests with a slow warp (periodic over
      // the origin wrap, so rebasing stays seamless). Without it the nearly
      // square wave directions crossed in a lattice and the sun's glints lit
      // it up as a grid of bright blocks instead of scattered glitter.
      vec2 warp = (vec2(wNoise(vWater.xz, 24.0), wNoise(vWater.xz + 191.0, 24.0)) - 0.5) * 9.0
                + (vec2(wNoise(vWater.xz + 57.0, 96.0), wNoise(vWater.xz - 83.0, 96.0)) - 0.5) * 1.6;
      vec2 pw = p + warp;
      vec2 g = vec2(0.0);
      g += waveSlope(pw, vec2(211.0, -157.0), 0.05, 1.9);
      g += waveSlope(pw, vec2(-389.0, -260.0), 0.05, 2.6);
      g += waveSlope(pw, vec2(683.0, 329.0), 0.055, 3.4);
      g += waveSlope(pw, vec2(-947.0, 1101.0), 0.05, 4.3);
      g += waveSlope(pw, vec2(1531.0, -702.0), 0.045, 4.9);
      g += waveSlope(pw, vec2(2203.0, 1870.0), 0.035, 6.1);
      g += waveSlope(pw, vec2(-3011.0, 2207.0), 0.03, 7.0);
      // Ripples with no lattice: the slope of drifting value noise at two
      // fine scales (2 m and 0.7 m), so the sun's glints land at random, as
      // on real water, rather than on the crossings of the sine waves.
      vec2 rd = uWindDir * uTime * 0.6;
      float rn = wNoise(vWater.xz + rd, 512.0);
      vec2 rg = vec2(wNoise(vWater.xz + rd + vec2(0.3, 0.0), 512.0) - rn, wNoise(vWater.xz + rd + vec2(0.0, 0.3), 512.0) - rn) / 0.3;
      float rn2 = wNoise(vWater.xz - rd * 1.4 + 7.0, 1536.0);
      vec2 rg2 = vec2(wNoise(vWater.xz - rd * 1.4 + vec2(7.1, 0.0), 1536.0) - rn2, wNoise(vWater.xz - rd * 1.4 + vec2(7.0, 0.1), 1536.0) - rn2) / 0.1;
      float rippleOk = 1.0 - smoothstep(0.08, 0.5, length(fwidth(vWater.xz)));
      vec2 ripples = (rg * 0.07 + rg2 * 0.025 * rippleOk) * rippleOk * (0.7 + paws * 0.6);
      vec2 distortion = g * rough + ripples + vec2(drift - 0.5) * 0.02;
      // a Pegasus's wash: rings of wave, a churned rotor patch, foam (waterWake.ts)
      vec4 wash = pegasusWash(vWater.xz);
      distortion += wash.xy;
      // One bounded impact per cell; the lifetime and edge envelopes vanish
      // before either wraps. Jitter both axes and use the impact's own radial
      // direction, so rain no longer forms aligned rows or square seams.
      // Take derivatives before branching; dry weather skips the ring work.
      vec2 rainFootprint = fwidth(p * 1.5);
      if (uRain > 0.001) {
        vec2 cell = mod(floor(p * 1.5), 1536.0), local = fract(p * 1.5);
        float seed = wHash(cell);
        vec2 center = 0.2 + vec2(seed, wHash(mod(cell + vec2(37.0, 91.0), 1536.0))) * 0.6;
        vec2 offset = local - center;
        float radius = length(offset);
        float age = fract(uTime * 0.75 + seed * 9.0);
        float front = radius - age * 0.7;
        float edge = smoothstep(0.0, 0.16, min(min(local.x, local.y), min(1.0 - local.x, 1.0 - local.y)));
        float resolved = 1.0 - smoothstep(0.75, 3.141593, length(rainFootprint) * 65.0);
        float ripple = sin(front * 65.0) * exp(-abs(front) * 24.0) * sin(age * 3.141593);
        distortion += offset / max(radius, 0.02) * ripple * edge * resolved * uRain * 0.025;
      }
      // The pinned shoreline geometry must also settle its surface normals.
      distortion *= smoothstep(0.0, 0.18, vDepth);
      vec3 normal = normalize(vec3(-distortion.x, 1.0, -distortion.y));
      vec3 eye = normalize(vEye);
      float cosV = max(0.0, dot(normal, eye));
      float fresnel = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
      // water body: turquoise shallows over the bed, blue-green depths
      float depth = 1.0 - exp(-vDepth * 0.9);
      vec3 bed = mix(uShallow, uDeep, depth);
      bed *= 0.94 + 0.08 * drift;
      // reflected sky: horizon colour near grazing angles, deeper blue above
      vec3 r = reflect(-eye, normal);
      vec3 zenith = uSky * vec3(0.48, 0.72, 1.05);
      vec3 sky = mix(uSky, zenith, smoothstep(0.02, 0.6, r.y));
      vec3 color = mix(bed, sky, clamp(fresnel * 1.15, 0.0, 1.0));
      // churned rotor water runs darker and frothier
      color *= 1.0 - 0.35 * wash.w;
      color = mix(color, vec3(0.86, 0.93, 0.94), clamp(wash.z, 0.0, 0.7));
      // Sun glitter: a soft sheen, and within it the glint broken into tiny
      // sparkles (facets of the ripples catching the sun one by one, drifting
      // with the wind) instead of saturated slabs of white. Sparkles finer
      // than a pixel fade to their average so distance never shimmers.
      float facing = max(0.0, dot(r, uSunDir));
      vec2 drift2 = uWindDir * uTime * 0.35;
      float sparkle = smoothstep(0.62, 0.92, wNoise(vWater.xz + drift2, 1024.0)) * 0.6
                    + smoothstep(0.66, 0.94, wNoise(vWater.xz - drift2 * 1.7 + 13.0, 2048.0)) * 0.8;
      float fineOk = 1.0 - smoothstep(0.35, 1.2, length(fwidth(vWater.xz)) * 2.0);
      sparkle = mix(0.35, sparkle, fineOk);
      float spec = pow(facing, 180.0) * (0.25 + sparkle * 2.4) + pow(facing, 40.0) * 0.12;
      color += uSunColor * spec * (1.0 - uNight * 0.85) * (1.0 - uRain * 0.75);
      float shore = (1.0 - smoothstep(0.03, 0.22, vDepth)) * (0.03 + 0.02 * sin(dot(p, vec2(147.0, 114.0)) * 0.006135923 + uTime * 1.3));
      color += shore * (1.0 - uNight * 0.85);
      float alpha = smoothstep(0.0, 0.09, vDepth) * (0.55 + depth * 0.4 + fresnel * 0.3);
      alpha = clamp(alpha + wash.w * 0.25 + wash.z * 0.15, 0.0, 0.97);
      gl_FragColor = vec4(color, alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
  transparent: true, depthWrite: false, fog: true,
})

/** Lake surfaces stream with the same lifecycle as terrain; no reflection
 * pass, global water plane or retained meshes for previously visited lakes. */
export const StreamedWater = (): React.ReactElement => {
  const { scene } = useThree()
  const root = useMemo(() => { const g = new THREE.Group(); g.name = "streamed-water"; return g }, [])
  const material = useMemo(() => makeWaterMaterial(), [])
  useEffect(() => {
    const meshes = new Map<string, THREE.Mesh>()
    const remove = (key: string): void => {
      const m = meshes.get(key)
      if (m) { waterStats.triangles -= m.geometry.attributes.position.count / 3; m.geometry.dispose(); root.remove(m); meshes.delete(key) }
      waterStats.chunks = meshes.size
    }
    const unsubscribe = subscribeChunks({
      onChunkReady: chunk => {
        if (!chunk.payload || meshes.has(chunk.key)) return
        const g = buildWaterGeometry(chunk.payload)
        if (!g) return
        const m = new THREE.Mesh(g, material)
        m.name = `lake:${chunk.key}`; m.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE)
        m.matrixAutoUpdate = false; m.updateMatrix(); m.renderOrder = 1
        root.add(m); meshes.set(chunk.key, m)
        waterStats.chunks = meshes.size; waterStats.triangles += g.attributes.position.count / 3
      },
      onChunkUnload: chunk => remove(chunk.key),
    })
    return () => { unsubscribe(); for (const key of meshes.keys()) remove(key); material.dispose() }
  }, [root, material])
  const sun = useMemo(() => ({ light: null as THREE.DirectionalLight | null }), [])
  useFrame(() => {
    if (!sun.light) scene.traverse((o) => { if (!sun.light && (o as THREE.DirectionalLight).isDirectionalLight && o.castShadow) sun.light = o as THREE.DirectionalLight })
    if (sun.light) {
      material.uniforms.uSunDir.value.subVectors(sun.light.position, sun.light.target.position).normalize()
      material.uniforms.uSunColor.value.copy(sun.light.color)
    }
    const night = THREE.MathUtils.smoothstep(worldRT.timeOfDay, 0.65, 0.97)
    material.uniforms.uNight.value = night; material.uniforms.uRain.value = weatherRT.rain
    if (scene.background instanceof THREE.Color) material.uniforms.uSky.value.copy(scene.background)
    material.uniforms.uDeep.value.setRGB(0.008 * (1 - night * 0.82), 0.06 * (1 - night * 0.76), 0.085 * (1 - night * 0.6))
    material.uniforms.uShallow.value.setRGB(0.1 * (1 - night * 0.88), 0.36 * (1 - night * 0.86), 0.34 * (1 - night * 0.72))
  })
  return <primitive object={root} />
}
