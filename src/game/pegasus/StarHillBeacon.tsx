import { useFrame } from "@react-three/fiber"
import { useMemo } from "react"
import * as THREE from "three"
import { horseRT } from "../horses/horseState"
import { pegasusRT } from "./pegasi"
import { worldRT } from "../runtime"

/**
 * A soft column of starlight over the Star Hill while Starborn is at home there,
 * a landmark for the hill: faint by day, clearer at dusk and night, with motes
 * drifting up through it. It is gone whenever she is away from the hill.
 */
const vertex = `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`
const fragment = `
uniform float uTime, uStrength;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
float h(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
void main() {
  // soft at the edges of the column, brightest low down, gone at the top
  float edge = pow(abs(dot(vN, vV)), 1.6);
  float fall = smoothstep(1.0, 0.0, vUv.y) * smoothstep(0.0, 0.03, vUv.y);
  // rising motes
  vec2 g = vec2(vUv.x * 18.0, vUv.y * 70.0 - uTime * 0.9);
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;
  float mote = step(0.86, h(cell)) * smoothstep(0.22, 0.0, length(f));
  float a = (edge * 0.55 + mote * 0.9) * fall * uStrength;
  vec3 col = mix(vec3(0.62, 0.68, 1.0), vec3(0.95, 0.9, 1.0), mote);
  gl_FragColor = vec4(col * a, a);
}`

export const StarHillBeacon = (): React.ReactElement => {
  const { mesh, mat } = useMemo(() => {
    const geo = new THREE.CylinderGeometry(2.2, 3.4, 160, 24, 1, true)
    geo.translate(0, 80, 0)
    const m = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, fog: false, uniforms: { uTime: { value: 0 }, uStrength: { value: 0 } },
    })
    const me = new THREE.Mesh(geo, m)
    me.frustumCulled = false
    me.renderOrder = 5
    me.visible = false
    return { mesh: me, mat: m }
  }, [])

  useFrame((state, dt) => {
    const starborn = horseRT.horses.get("pegasus:starborn")
    const hill = pegasusRT.starHill
    const atHill = !!starborn && Math.hypot(starborn.x - hill.x, starborn.z - hill.z) < 25 && !starborn.rider
    // worldRT.timeOfDay runs 0 (day) … 1 (night)
    const night = Math.max(0, Math.min(1, (worldRT.timeOfDay - 0.45) / 0.4))
    // a landmark only: Starborn is always the explorer's, so the column stays dimmer than before
    const want = atHill ? 0.12 + 0.5 * night : 0
    const u = mat.uniforms
    u.uStrength.value += (want - u.uStrength.value) * (1 - Math.exp(-dt * 0.8))
    u.uTime.value = state.clock.elapsedTime
    mesh.visible = u.uStrength.value > 0.01
    if (starborn) mesh.position.set(starborn.x, starborn.y - 2, starborn.z)
  })

  return <primitive object={mesh} />
}
