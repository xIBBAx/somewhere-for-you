import { HOME_LATITUDE, HOME_LONGITUDE } from "./celestial/universe"
import { useFrame, useLoader, useThree } from "@react-three/fiber"
import { useMemo, useRef } from "react"
import * as THREE from "three"
import { makeRng, smoothstep } from "../utils/math"
import { playerRT, worldRT } from "./runtime"
import { isThunderstormCondition } from "./weather/weatherMapping"
import { getEffectiveWeather } from "./weather/weatherState"

/**
 * The first-launch journey's space and atmosphere set, rendered by the game's
 * own renderer and camera (camera path: FollowCamera CINEMATIC_KEYS).
 *
 * Everything is real imagery (NASA, public domain — see CREDITS.md): the
 * Blue Marble surface, Black Marble city lights, a real cloud map, terrain
 * relief from GEBCO elevation, the Milky Way from NASA's Deep Star Maps and
 * the Moon from LRO. The globe turns to bring home (personalization
 * `world.home`) under the camera while dawn sweeps across it, then the
 * camera dives through the clouds into the world.
 */
const EARTH_CENTER = new THREE.Vector3(0, 58, 92)
const EARTH_RADIUS = 9
const HOME = { lat: HOME_LATITUDE, lon: HOME_LONGITUDE }
const MAPS = ["earth_day_4k.jpg", "earth_night_4k.jpg", "earth_clouds_4k.jpg", "earth_normal_4k.jpg", "earth_water_2k.png", "stars_4k.jpg", "moon_2k.jpg"]
  .map((file) => `/assets/cinematic/earth/${file}`)
/** Globe rotation that puts a latitude/longitude on the camera-facing (+Z) side. */
const FACE_HOME = new THREE.Euler(THREE.MathUtils.degToRad(HOME.lat), -Math.PI / 2 - THREE.MathUtils.degToRad(HOME.lon), 0, "XYZ")

const EARTH_VERTEX = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const EARTH_FRAGMENT = /* glsl */ `
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform sampler2D uClouds;
  uniform sampler2D uNormal;
  uniform sampler2D uWater;
  uniform vec3 uSun;
  uniform float uCloudShift;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  varying vec2 vUv;
  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 v = normalize(cameraPosition - vWorldPos);
    // terrain relief in a local east/north frame around the geometric normal
    vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), n) + vec3(1e-4, 0.0, 0.0));
    vec3 north = cross(n, east);
    vec3 tn = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
    vec3 surfaceN = normalize(n + (east * tn.x + north * tn.y) * 0.55);
    float sunN = dot(n, uSun);
    float lambert = max(dot(surfaceN, uSun), 0.0);
    float daylight = smoothstep(-0.08, 0.22, sunN);
    vec3 day = pow(texture2D(uDay, vUv).rgb, vec3(2.2));
    float water = texture2D(uWater, vUv).r;
    // soft cloud shadows fall slightly away from the sun
    float shadow = texture2D(uClouds, vUv + vec2(uCloudShift - 0.0015, 0.0008)).r;
    vec3 color = day * (lambert * 1.25 + 0.015) * (1.0 - shadow * 0.45 * daylight);
    // ocean sun glint (Blinn-Phong) and a little sky reflected at grazing angles
    vec3 h = normalize(uSun + v);
    float glint = pow(max(dot(n, h), 0.0), 120.0) * 2.4 + pow(max(dot(n, h), 0.0), 18.0) * 0.12;
    color += vec3(1.0, 0.93, 0.8) * glint * water * daylight;
    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 5.0);
    color += vec3(0.12, 0.25, 0.5) * fresnel * water * daylight * 0.6;
    // warm city lights where it is night
    // Black Marble has a faint blue land/ocean base: keep only the lights
    vec3 night = texture2D(uNight, vUv).rgb;
    float glow = max(dot(night, vec3(0.62, 0.38, 0.0)) - 0.13, 0.0);
    vec3 lights = vec3(1.0, 0.72, 0.38) * pow(glow * 1.6, 1.6);
    color += lights * (1.0 - smoothstep(-0.2, 0.08, sunN)) * 2.4;
    // aerial perspective: thin blue haze thickening toward the limb
    float limb = pow(1.0 - max(dot(n, v), 0.0), 2.2);
    color = mix(color, vec3(0.32, 0.55, 1.0) * daylight, limb * 0.42 * daylight);
    // the terminator glows orange through the long path of sunrise light
    float dawn = exp(-pow(sunN / 0.12, 2.0));
    color += vec3(1.0, 0.45, 0.15) * dawn * 0.05;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const CLOUD_FRAGMENT = /* glsl */ `
  uniform sampler2D uClouds;
  uniform vec3 uSun;
  uniform float uCloudShift;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  varying vec2 vUv;
  void main() {
    vec3 n = normalize(vWorldNormal);
    float c = texture2D(uClouds, vUv + vec2(uCloudShift, 0.0)).r;
    c = smoothstep(0.08, 0.9, c);
    float sunN = dot(n, uSun);
    float lit = smoothstep(-0.1, 0.35, sunN);
    vec3 color = mix(vec3(0.015, 0.018, 0.03), vec3(1.0, 0.99, 0.97) * 1.15, lit);
    color = mix(color, vec3(1.0, 0.55, 0.3), exp(-pow(sunN / 0.1, 2.0)) * 0.6);
    gl_FragColor = vec4(color, c * 0.95);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** Rayleigh-blue rim, warm where sunlight skims the limb, from an outer shell. */
const ATMOSPHERE_FRAGMENT = /* glsl */ `
  uniform vec3 uSun;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 v = normalize(cameraPosition - vWorldPos);
    float rim = 1.0 - abs(dot(n, v));
    float glow = pow(rim, 3.2);
    float sunN = dot(n, uSun);
    float lit = smoothstep(-0.35, 0.4, sunN);
    // forward scattering: the limb blazes when the sun sits just behind it
    float forward = pow(max(dot(-v, uSun), 0.0), 6.0);
    vec3 blue = vec3(0.28, 0.55, 1.0);
    vec3 sunset = vec3(1.0, 0.55, 0.25);
    vec3 color = mix(blue, sunset, exp(-pow(sunN / 0.25, 2.0)) * 0.8) * (lit + forward * 1.6);
    gl_FragColor = vec4(color * glow * 1.6, glow * (lit + forward));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const MOON_FRAGMENT = /* glsl */ `
  uniform sampler2D uMoon;
  uniform vec3 uSun;
  varying vec3 vWorldNormal;
  varying vec2 vUv;
  void main() {
    vec3 albedo = pow(texture2D(uMoon, vUv).rgb, vec3(2.2));
    float light = max(dot(normalize(vWorldNormal), uSun), 0.0);
    gl_FragColor = vec4(albedo * (light * 1.4 + 0.01), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const STAR_FRAGMENT = /* glsl */ `
  uniform sampler2D uStars;
  uniform float uFade;
  varying vec2 vUv;
  void main() {
    vec3 stars = pow(texture2D(uStars, vUv).rgb, vec3(2.2));
    gl_FragColor = vec4(stars * 0.55 * uFade, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** A soft, lumpy cloud puff with a lit top, drawn once into a canvas. */
let puffTexture: THREE.CanvasTexture | null = null
const cloudPuff = (): THREE.CanvasTexture => {
  if (puffTexture) return puffTexture
  const size = 256
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = size
  const ctx = canvas.getContext("2d")!
  const rng = makeRng(7171)
  for (let i = 0; i < 70; i++) {
    const a = rng() * Math.PI * 2
    const r = Math.sqrt(rng()) * size * 0.28
    const x = size / 2 + Math.cos(a) * r
    const y = size / 2 + Math.sin(a) * r * 0.62
    const radius = size * (0.07 + rng() * 0.12)
    const g = ctx.createRadialGradient(x, y - radius * 0.25, radius * 0.1, x, y, radius)
    const shade = 225 + Math.round((size / 2 - y) / size * 60)
    g.addColorStop(0, `rgba(${shade},${shade},${Math.min(255, shade + 8)},0.55)`)
    g.addColorStop(1, `rgba(${shade - 30},${shade - 26},${shade - 18},0)`)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  puffTexture = new THREE.CanvasTexture(canvas)
  puffTexture.colorSpace = THREE.SRGBColorSpace
  return puffTexture
}

type Puff = { x: number; y: number; z: number; scale: number; spin: number }
const puffs: Puff[] = (() => {
  const rng = makeRng(30303)
  return Array.from({ length: 34 }, () => ({
    x: (rng() - 0.5) * 18,
    y: (rng() - 0.5) * 10,
    z: -16 + rng() * 20,
    scale: 3 + rng() * 5,
    spin: (rng() - 0.5) * 0.3,
  }))
})()

const _sun = new THREE.Vector3()
const _euler = new THREE.Euler()

export const CinematicJourney = (): React.ReactElement => {
  const { camera } = useThree()
  const space = useRef<THREE.Group>(null)
  const earth = useRef<THREE.Group>(null)
  const moon = useRef<THREE.Mesh>(null)
  const sunGlow = useRef<THREE.Sprite>(null)
  const cloudPass = useRef<THREE.Group>(null)
  const puffRefs = useRef<Array<THREE.Sprite | null>>([])
  const veil = useRef<THREE.Mesh>(null)
  const veilMat = useRef<THREE.MeshBasicMaterial>(null)
  const homeMarker = useRef<THREE.Sprite>(null)
  // These maps participate in the scene's Suspense/readiness boundary. A hard
  // refresh must not reveal a blank globe while textures arrive.
  const maps = useLoader(THREE.TextureLoader, MAPS)
  const uniforms = useMemo(() => {
    maps.forEach((texture, i) => {
      texture.anisotropy = 8
      // decoded manually in the shaders (pow 2.2), so no colour-space tag
      if (i !== 5) texture.wrapS = THREE.RepeatWrapping
    })
    const sun = { value: new THREE.Vector3(0, 0, -1) }
    const shift = { value: 0 }
    return {
      earth: { uDay: { value: maps[0] }, uNight: { value: maps[1] }, uClouds: { value: maps[2] }, uNormal: { value: maps[3] }, uWater: { value: maps[4] }, uSun: sun, uCloudShift: shift },
      clouds: { uClouds: { value: maps[2] }, uSun: sun, uCloudShift: shift },
      atmosphere: { uSun: sun },
      moon: { uMoon: { value: maps[6] }, uSun: sun },
      stars: { uStars: { value: maps[5] }, uFade: { value: 1 } },
    }
  }, [maps])
  const glowTexture = useMemo(() => {
    const c = document.createElement("canvas")
    c.width = c.height = 128
    const ctx = c.getContext("2d")!
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, "rgba(255,255,255,1)")
    g.addColorStop(0.08, "rgba(255,246,225,0.95)")
    g.addColorStop(0.25, "rgba(255,214,160,0.35)")
    g.addColorStop(1, "rgba(255,190,120,0)")
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])
  const puffMap = useMemo(() => cloudPuff(), [])

  useFrame((state) => {
    const p = worldRT.introProgress
    const elapsed = state.clock.elapsedTime
    const weather = getEffectiveWeather()
    const thunderstorm = isThunderstormCondition(weather.condition)
    const rainy = weather.condition === "rain" || weather.condition === "heavy-rain"
    const overcast = rainy || weather.condition === "cloudy" || weather.condition === "fog" || thunderstorm

    // dawn: the sun starts behind the globe (city lights, a blazing limb) and
    // swings round to the front-right, sweeping morning across home
    const dawn = smoothstep(0.02, 0.42, p)
    const sunAngle = THREE.MathUtils.lerp(2.62, 0.62, dawn)
    _sun.set(Math.sin(sunAngle), 0.24, Math.cos(sunAngle)).normalize()
    uniforms.earth.uSun.value.copy(_sun)
    uniforms.earth.uCloudShift.value = (elapsed * 0.0009) % 1

    if (space.current) space.current.visible = p < 0.535
    if (earth.current) {
      earth.current.visible = p < 0.49
      // the globe turns to bring home under the camera
      const turn = (1 - smoothstep(0.0, 0.4, p)) * 0.9
      _euler.set(FACE_HOME.x, FACE_HOME.y + turn, 0, "XYZ")
      earth.current.quaternion.setFromEuler(_euler)
    }
    if (moon.current) moon.current.rotation.y = elapsed * 0.01
    if (sunGlow.current) {
      sunGlow.current.position.copy(EARTH_CENTER).addScaledVector(_sun, 60)
      const material = sunGlow.current.material as THREE.SpriteMaterial
      material.opacity = 0.9
    }
    if (homeMarker.current) {
      // a small warm light over the place where they met, as the dive begins
      const show = smoothstep(0.24, 0.32, p) * (1 - smoothstep(0.41, 0.46, p))
      const m = homeMarker.current.material as THREE.SpriteMaterial
      m.opacity = show * (0.75 + Math.sin(elapsed * 3) * 0.25)
      homeMarker.current.visible = show > 0.01
    }

    // cloud crossing: lit puffs stream past the lens, then the inside of a
    // real cloud fills it to bridge the change of scale
    const cloudEnvelope = smoothstep(0.345, 0.43, p) * (1 - smoothstep(0.545, 0.615, p))
    const crossing = smoothstep(0.345, 0.635, p)
    if (cloudPass.current) {
      cloudPass.current.visible = cloudEnvelope > 0.01
      cloudPass.current.position.copy(camera.position)
      cloudPass.current.quaternion.copy(camera.quaternion)
      const tint = thunderstorm ? "#5c6878" : rainy ? "#94a2b2" : overcast ? "#cfd6dd" : "#ffffff"
      puffRefs.current.forEach((sprite, i) => {
        if (!sprite) return
        const puff = puffs[i]
        const z = puff.z + crossing * 26
        sprite.position.set(puff.x + Math.sin(elapsed * 0.2 + i) * 0.3, puff.y + Math.cos(elapsed * 0.15 + i) * 0.2, z)
        sprite.scale.set(puff.scale * 1.6, puff.scale, 1)
        const material = sprite.material as THREE.SpriteMaterial
        material.color.set(tint)
        material.rotation = puff.spin * elapsed
        // fade puffs that have passed the lens
        material.opacity = cloudEnvelope * (z > -0.5 ? 0 : Math.min(1, -z / 3)) * 0.85
      })
    }
    const mask = Math.exp(-Math.pow((p - 0.505) / 0.071, 2))
    worldRT.introLightning = 0
    playerRT.frightened = 0
    if (veil.current && veilMat.current) {
      veil.current.visible = mask > 0.008
      veil.current.position.copy(camera.position)
      veilMat.current.color.set(rainy || thunderstorm ? "#8999a9" : overcast ? "#cbd3da" : "#f4f9ff")
      veilMat.current.opacity = Math.min(0.985, mask * (thunderstorm ? 0.93 : 0.97))
    }
  })

  // place the home marker on the globe's surface at home
  const homePos = useMemo(() => {
    const lat = THREE.MathUtils.degToRad(HOME.lat), lon = THREE.MathUtils.degToRad(HOME.lon)
    // SphereGeometry: u = (lon + 180) / 360 maps to x = cos(lon), z = -sin(lon)
    return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)).multiplyScalar(EARTH_RADIUS * 1.012)
  }, [])

  return (
    <group name="cinematic-temporary-set">
      <group ref={space}>
        <mesh position={EARTH_CENTER} renderOrder={-100} frustumCulled={false}>
          <sphereGeometry args={[78, 64, 32]} />
          <shaderMaterial vertexShader={`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`}
            fragmentShader={STAR_FRAGMENT} uniforms={uniforms.stars} side={THREE.BackSide} depthWrite={false} depthTest={false} fog={false} />
        </mesh>
        <sprite ref={sunGlow} scale={[22, 22, 1]} renderOrder={-80}>
          <spriteMaterial map={glowTexture} transparent depthWrite={false} blending={THREE.AdditiveBlending} fog={false} />
        </sprite>
        <mesh ref={moon} position={[-34, 73, 48]} frustumCulled={false}>
          <sphereGeometry args={[2.45, 48, 32]} />
          <shaderMaterial vertexShader={EARTH_VERTEX} fragmentShader={MOON_FRAGMENT} uniforms={uniforms.moon} fog={false} />
        </mesh>
        <group ref={earth} position={EARTH_CENTER}>
          <mesh>
            <sphereGeometry args={[EARTH_RADIUS, 160, 96]} />
            <shaderMaterial vertexShader={EARTH_VERTEX} fragmentShader={EARTH_FRAGMENT} uniforms={uniforms.earth} fog={false} />
          </mesh>
          <mesh>
            <sphereGeometry args={[EARTH_RADIUS * 1.006, 160, 96]} />
            <shaderMaterial vertexShader={EARTH_VERTEX} fragmentShader={CLOUD_FRAGMENT} uniforms={uniforms.clouds} transparent depthWrite={false} fog={false} />
          </mesh>
          <mesh>
            <sphereGeometry args={[EARTH_RADIUS * 1.045, 96, 64]} />
            <shaderMaterial vertexShader={EARTH_VERTEX} fragmentShader={ATMOSPHERE_FRAGMENT} uniforms={uniforms.atmosphere}
              transparent side={THREE.BackSide} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
          </mesh>
          <sprite ref={homeMarker} position={homePos} scale={[0.55, 0.55, 1]} visible={false}>
            <spriteMaterial map={glowTexture} color="#ffb7c9" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} />
          </sprite>
        </group>
      </group>

      <group ref={cloudPass} renderOrder={900}>
        {puffs.map((_, i) => (
          <sprite key={i} ref={(node) => { puffRefs.current[i] = node }} renderOrder={900 + i} frustumCulled={false}>
            <spriteMaterial map={puffMap} transparent opacity={0} depthWrite={false} depthTest={false} fog={false} />
          </sprite>
        ))}
      </group>
      <mesh ref={veil} renderOrder={1000} frustumCulled={false}>
        <sphereGeometry args={[4.5, 18, 12]} />
        <meshBasicMaterial ref={veilMat} color="#f2f9ff" transparent opacity={0} side={THREE.BackSide} depthWrite={false} depthTest={false} fog={false} />
      </mesh>
    </group>
  )
}
