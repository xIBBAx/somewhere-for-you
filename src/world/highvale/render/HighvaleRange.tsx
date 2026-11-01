import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { lightingRT } from "../../../game/environment/Lighting"
import { EARTH_R } from "../../../game/celestial/scale"
import { highvaleHole } from "./highvaleClarity"
import { highvaleMaps } from "../highvaleData"
import { COARSE_HALF, COARSE_N, HEIGHT_BASE, HEIGHT_SPAN, LOOK_N, HIGHVALE_CENTER } from "../highvaleLayout"

/**
 * The mountains beyond the far plane.
 *
 * On foot the camera sees 520 m; the streamed chunks and the far grid end
 * there. Highvale's walls and peaks stand kilometres off, so the whole massif
 * is drawn once more from its baked heights, and every vertex past the far
 * plane is slid along its own line of sight into a thin band just inside
 * it: on screen it lands exactly where the real mountain would, and it is
 * always behind anything nearer. Fragments closer than the band are left to
 * the real terrain.
 *
 * Shading reads the same 8 m height map for its normals (crisp ridges and
 * gullies from a 43 m mesh), the bake's forest map for the cedar slopes,
 * and lays autumn snow on the high ground where the slope holds it. The
 * distance is seen through air: Rayleigh-weighted extinction toward the
 * scene's haze colour, and the planet's curve (the same 100 km Earth as
 * the horizon lands).
 */
const SEGMENTS = 320

const heightTexture = (): THREE.DataTexture => {
  const src = highvaleMaps.data!.coarse
  const n = COARSE_N
  const half = new Uint16Array(n * n)
  const q = HEIGHT_SPAN / 65535
  for (let i = 0; i < n * n; i++) half[i] = THREE.DataUtils.toHalfFloat(src[i] * q + HEIGHT_BASE)
  const tex = new THREE.DataTexture(half, n, n, THREE.RedFormat, THREE.HalfFloatType)
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  tex.flipY = false
  tex.needsUpdate = true
  return tex
}

const lookTexture = (): THREE.DataTexture => {
  const src = highvaleMaps.data!.look
  const rgba = new Uint8Array(LOOK_N * LOOK_N * 4)
  for (let i = 0; i < LOOK_N * LOOK_N; i++) { rgba[i * 4] = src[i * 2]; rgba[i * 4 + 1] = src[i * 2 + 1]; rgba[i * 4 + 3] = 255 }
  const tex = new THREE.DataTexture(rgba, LOOK_N, LOOK_N, THREE.RGBAFormat)
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.needsUpdate = true
  return tex
}

const COMMON = /* glsl */ `
uniform sampler2D uHeight;
uniform sampler2D uLook;
uniform float uHalf;
uniform float uFar;
uniform vec3 uCamWorld;
varying vec2 vLocal;
varying float vRealDist;
varying vec3 vWorldReal;
vec2 mapUV(vec2 local) { return vec2((local.x + uHalf) / (2.0 * uHalf), (uHalf - local.y) / (2.0 * uHalf)); }
float hAt(vec2 local) { return texture2D(uHeight, mapUV(local)).r; }
`

export const HighvaleRange = (): React.ReactElement | null => {
  const { camera, scene } = useThree()
  const built = useMemo(() => {
    if (!highvaleMaps.data) return null
    const geometry = new THREE.PlaneGeometry(2 * COARSE_HALF, 2 * COARSE_HALF, SEGMENTS, SEGMENTS)
    // plane in (east, north) → x = east, z = -north
    geometry.rotateX(-Math.PI / 2)
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 600, 0), COARSE_HALF * 1.6)
    const height = heightTexture()
    const look = lookTexture()
    const uniforms = {
      uHeight: { value: height }, uLook: { value: look }, uHalf: { value: COARSE_HALF }, uFar: { value: 520 }, uVeil: { value: new THREE.Vector3() },
      uCamWorld: { value: new THREE.Vector3() }, uHaze: { value: new THREE.Color() }, uEarthR: { value: EARTH_R },
      uTexel: { value: (2 * COARSE_HALF) / COARSE_N },
    }
    const material = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, fog: false })
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${COMMON}\nuniform float uEarthR;`)
        .replace("#include <begin_vertex>", `
vec3 transformed = vec3(position);
vLocal = vec2(position.x, -position.z);
transformed.y = hAt(vLocal);`)
        .replace("#include <project_vertex>", `
vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
vec3 toV = worldPos.xyz - cameraPosition;
vRealDist = length(toV);
vWorldReal = worldPos.xyz;
// the planet's curve, as the horizon lands bend it; and tucked under the
// far grid where both are drawn, so the finer real terrain always wins
// (deeper near the eye, where its coarse cells could stand proud of the chunks on steep ground)
worldPos.y -= dot(toV.xz, toV.xz) / (2.0 * uEarthR) + 4.0 * (1.0 - smoothstep(900.0, 1400.0, vRealDist)) + 10.0 * (1.0 - smoothstep(800.0, 1050.0, vRealDist));
toV = worldPos.xyz - cameraPosition;
float d = length(toV);
float D0 = uFar * 0.972, D1 = uFar * 0.997;
if (d > D0) worldPos.xyz = cameraPosition + toV / d * (D0 + (D1 - D0) * (1.0 - exp(-(d - D0) / 7000.0)));
vec4 mvPosition = viewMatrix * worldPos;
gl_Position = projectionMatrix * mvPosition;`)
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${COMMON}\nuniform vec3 uHaze;\nuniform vec3 uVeil;\nuniform float uTexel;
float rhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rnoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(rhash(i), rhash(i + vec2(1, 0)), u.x), mix(rhash(i + vec2(0, 1)), rhash(i + vec2(1, 1)), u.x), u.y); }
vec3 rNormal;
float rSlope;`)
        .replace("#include <color_fragment>", `#include <color_fragment>
// near fragments belong to the real terrain (the far grid reaches ~900 m)
// (from 650 m: where, seen from above, the far grid already ends; the range
// sits a few metres under both finer layers wherever they overlap)
if (vRealDist < min(uFar * 0.955, 650.0)) discard;
float t = uTexel;
float hL = hAt(vLocal - vec2(t, 0.0)), hR = hAt(vLocal + vec2(t, 0.0));
float hD = hAt(vLocal - vec2(0.0, t)), hU = hAt(vLocal + vec2(0.0, t));
// world normal (x east, z south)
rNormal = normalize(vec3(hL - hR, 2.0 * t, hU - hD));
rSlope = length(vec2(hR - hL, hU - hD)) / (2.0 * t);
float h = hAt(vLocal);
vec4 look = texture2D(uLook, mapUV(vLocal));
float n1 = rnoise(vLocal / 180.0), n2 = rnoise(vLocal / 37.0), n3 = rnoise(vLocal / 9.0);
// late-autumn palette, linear: tawny alpine grass, dry gold valley grass, cedar, granite, snow
vec3 grass = mix(vec3(0.17, 0.2, 0.06), vec3(0.3, 0.22, 0.09), smoothstep(560.0, 760.0, h + n1 * 60.0));
vec3 col = grass;
float forest = look.r * (1.0 - smoothstep(0.85, 1.15, rSlope));
col = mix(col, vec3(0.035, 0.058, 0.04) * (0.8 + 0.4 * n3), forest);
float rock = smoothstep(0.62, 1.0, rSlope + (n2 - 0.5) * 0.25);
vec3 granite = vec3(0.26, 0.25, 0.235) * (0.75 + 0.45 * n2) * (0.85 + 0.3 * n3);
col = mix(col, granite, rock);
// snow: high, and only where the slope can hold it; gullies keep it longest
float snow = smoothstep(940.0, 1060.0, h + (n1 - 0.5) * 120.0 + (n2 - 0.5) * 32.0 + look.g * 50.0);
snow *= 1.0 - smoothstep(0.95, 1.45, rSlope + (n3 - 0.5) * 0.3);
col = mix(col, vec3(0.8, 0.82, 0.86) * (0.92 + 0.08 * n3), snow);
diffuseColor.rgb = col;`)
        .replace("#include <normal_fragment_begin>", `#include <normal_fragment_begin>
normal = normalize((viewMatrix * vec4(rNormal, 0.0)).xyz);`)
        .replace("#include <normal_fragment_maps>", "")
        .replace("#include <opaque_fragment>", `
// seen through kilometres of air: blue goes first, the haze takes over
vec3 ext = vec3(0.046, 0.108, 0.265) / 2400.0;
vec3 trans = exp(-ext * vRealDist);
outgoingLight = outgoingLight * trans + uHaze * (1.0 - trans) * 1.05;
// weather in the valley (fog, rain) veils the range as it does the land below it
outgoingLight = mix(outgoingLight, uHaze, uVeil.x * smoothstep(uVeil.y, uVeil.z, vRealDist));
#include <opaque_fragment>`)
    }
    material.customProgramCacheKey = () => "highvale-range-v2"
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = "highvale-range"
    mesh.frustumCulled = false
    mesh.renderOrder = -5
    mesh.receiveShadow = false
    mesh.castShadow = false
    return { mesh, uniforms, height, look }
  }, [])

  useEffect(() => () => {
    highvaleHole.value = 0
    if (!built) return
    built.mesh.geometry.dispose()
    ;(built.mesh.material as THREE.Material).dispose()
    built.height.dispose()
    built.look.dispose()
  }, [built])

  useFrame(() => {
    if (!built) return
    const { mesh, uniforms } = built
    const cam = camera as THREE.PerspectiveCamera
    // children of WorldRoot keep logical coordinates (world/origin.ts); so does the camera
    mesh.position.set(HIGHVALE_CENTER.x, 0, HIGHVALE_CENTER.z)
    const dx = cam.position.x - HIGHVALE_CENTER.x, dz = cam.position.z - HIGHVALE_CENTER.z
    // within reach of the valley (the horizon lands leave the massif to it)
    mesh.visible = Math.hypot(dx, dz) < 16_000
    highvaleHole.value = mesh.visible ? 1 : 0
    uniforms.uFar.value = cam.far
    const fog = scene.fog as THREE.Fog | null
    if (fog) {
      uniforms.uHaze.value.copy(fog.color)
      uniforms.uVeil.value.set(lightingRT.veil, fog.near, fog.far)
    }
  })

  return built ? <primitive object={built.mesh} /> : null
}
