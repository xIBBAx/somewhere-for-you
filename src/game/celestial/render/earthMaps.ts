import * as THREE from "three"

/**
 * Earth's maps (the intro's NASA set, public/assets/cinematic/earth), shared
 * by the globe and the horizon lands, loaded once.
 */
const FILES = {
  day: "earth_day_4k.jpg", night: "earth_night_4k.jpg", clouds: "earth_clouds_4k.jpg", normal: "earth_normal_4k.jpg", water: "earth_water_2k.png",
} as const
const cache = new Map<string, THREE.Texture>()

/** How far Earth's clouds have drifted (u offset), shared by the globe and the horizon lands so they agree. */
export const earthCloudShift = { value: 0 }
const loader = new THREE.TextureLoader()

export const earthTexture = (kind: keyof typeof FILES): THREE.Texture => {
  let t = cache.get(kind)
  if (!t) {
    t = loader.load(`/assets/cinematic/earth/${FILES[kind]}`)
    t.anisotropy = 8
    t.wrapS = THREE.RepeatWrapping
    cache.set(kind, t)
  }
  return t
}

/**
 * GLSL: the equirectangular uv of the Earth under a logical point (x, z):
 * its arc from home tilts home's up vector, which the game→ECEF matrix
 * turns into latitude and longitude.
 */
export const EARTH_UV_GLSL = /* glsl */ `
vec2 earthUv(vec2 xz, mat3 toEcef, float radius) {
  float d = length(xz);
  float th = d / radius;
  vec2 dir = d > 1e-3 ? xz / d : vec2(0.0);
  vec3 n = vec3(sin(th) * dir.x, cos(th), sin(th) * dir.y);
  vec3 e = toEcef * n;
  return vec2(atan(e.y, e.x) / 6.2831853 + 0.5, asin(clamp(e.z, -1.0, 1.0)) / 3.14159265 + 0.5);
}
`
