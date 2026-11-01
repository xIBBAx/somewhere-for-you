import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { smoothstep } from "../../utils/math"
import { worldRT } from "../runtime"
import { weatherRT } from "../weather/weatherState"
import { spaceRT } from "../celestial/spaceState"
import { LIGHT_BLENDING } from "../render/lightBlending"
import { nightBlend, solarVisibility, sunDirection } from "./celestialLighting"
import { registerDevTool } from "../../dev/devTools"

/**
 * Rainbows: sunlight turned back by falling drops, so a bow always stands
 * opposite the sun, 42° round the point of the observer's own shadow, red on
 * the outside; a fainter secondary bow at 51° has its colours reversed, and
 * the sky inside the primary is a little brighter than outside it.
 *
 * A bow shows in a sun shower and for a while after rain, once the sun is
 * back; it fades as the last drops fall out of the air.
 *
 * The sun here rides high (up to ~40°), which would sink a true bow almost
 * entirely below the horizon at midday; the bow is drawn as if the sun were
 * at most 18° up so a good arch of it always clears the hills.
 */

const MAX_ELEVATION = Math.sin(THREE.MathUtils.degToRad(18))

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const FRAGMENT = /* glsl */ `
uniform vec3 uAnti;
uniform float uAmt;
varying vec3 vDir;
vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
// x: 0 the violet edge .. 1 the red edge of a band
vec3 band(float x) {
  float w = smoothstep(0.0, 0.22, x) * (1.0 - smoothstep(0.78, 1.0, x));
  // drops of every size blur the spectrum toward white, most in the middle
  return mix(vec3(1.0), hue((1.0 - x) * 0.76), 0.74) * w;
}
void main() {
  vec3 d = normalize(vDir);
  float a = degrees(acos(clamp(dot(d, uAnti), -1.0, 1.0)));
  vec3 col = band((a - 40.3) / 2.5);
  // the secondary bow: reversed, broader, fainter
  col += band(1.0 - (a - 50.2) / 3.6) * 0.38;
  // light turned back inside the primary brightens the sky under the arch
  col += vec3(1.0, 0.98, 0.95) * 0.07 * smoothstep(18.0, 39.5, a) * (1.0 - smoothstep(39.5, 40.6, a));
  // the bow stands on the land, never below the horizon
  gl_FragColor = vec4(col * uAmt * smoothstep(-0.015, 0.06, d.y), 0.0);
  // added as light, untouched: tone mapping and encoding each addend on the
  // Balanced and Light presets washed the colours out to white
}`

const makeBowMaterial = (): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    uniforms: {
      uAnti: { value: new THREE.Vector3(0, -0.3, 1).normalize() },
      uAmt: { value: 0 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    ...LIGHT_BLENDING,
  })

const sun = new THREE.Vector3()
const anti = new THREE.Vector3()

/** QA (`?debug`): what the bows are doing */
export const rainbowRT = { sky: 0, afterRain: 0 }

export const Rainbow = (): React.ReactElement => {
  const camera = useThree((s) => s.camera)
  const skyMat = useMemo(() => makeBowMaterial(), [])
  const sky = useRef<THREE.Mesh>(null)
  const recentRain = useRef(0)
  useEffect(() => () => skyMat.dispose(), [skyMat])
  // QA: the bows' strengths, and the camera yaw that faces away from the sun
  useEffect(() => registerDevTool("rainbow", () => ({ ...rainbowRT, yaw: +Math.atan2(-anti.x, -anti.z).toFixed(3) })), [])

  useFrame((_, rawDt) => {
    const dt = Math.min(Math.max(rawDt, 1e-4), 0.25)
    const t = worldRT.timeOfDay
    // the drops hang in the air a while after the rain, then fall out of it
    recentRain.current = Math.max(weatherRT.rain, recentRain.current * Math.exp(-dt / 75))
    rainbowRT.afterRain = +recentRain.current.toFixed(3)
    const onEarth = spaceRT.realm === "earth"
    const low = onEarth ? 1 - smoothstep(160, 420, spaceRT.skyAltitude) : 0
    // the sun must reach the drops: not through a full overcast, a storm, or after it has set
    const sunlit = solarVisibility(t) * (1 - nightBlend(t)) * (1 - smoothstep(0.6, 0.9, weatherRT.cloud))
      * (1 - smoothstep(0.75, 1, weatherRT.rain)) * (1 - Math.min(1, weatherRT.burst * 2)) * low

    sunDirection(t, sun)
    if (sun.y > MAX_ELEVATION) {
      const h = Math.hypot(sun.x, sun.z) || 1
      const k = Math.sqrt(1 - MAX_ELEVATION * MAX_ELEVATION) / h
      sun.set(sun.x * k, MAX_ELEVATION, sun.z * k)
    }
    anti.copy(sun).negate()

    const skyAmt = sunlit * smoothstep(0.03, 0.22, recentRain.current) * 0.3
    rainbowRT.sky = +skyAmt.toFixed(3)
    if (sky.current) {
      sky.current.visible = skyAmt > 0.002
      sky.current.position.copy(camera.position)
      skyMat.uniforms.uAnti.value.copy(anti)
      skyMat.uniforms.uAmt.value = skyAmt
    }
  })

  return (
    <mesh ref={sky} material={skyMat} renderOrder={-4} frustumCulled={false} visible={false}>
      <sphereGeometry args={[430, 64, 32]} />
    </mesh>
  )
}
