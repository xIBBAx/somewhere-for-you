import { useLayoutEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { smoothstep } from "../../../utils/math"
import { useHubFrame } from "../../hubGate"
import { LIGHT_BLENDING } from "../../render/lightBlending"
import { worldRT } from "../../runtime"
import { weatherRT } from "../../weather/weatherState"
import { diyaSpots } from "./indiaLayout"

const FLAME_VERTEX = /* glsl */ `
attribute float aPhase;
uniform float uTime;
uniform float uLit;
varying vec2 vUv;
varying float vFlicker;
void main() {
  vUv = uv;
  vFlicker = 0.82 + 0.18 * sin(uTime * 9.0 + aPhase) * sin(uTime * 3.7 + aPhase * 2.1);
  // always faces the camera: the flame is a soft card, not a mesh
  vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float lick = sin(uTime * 6.0 + aPhase) * 0.012 * position.y;
  centre.xy += vec2(position.x + lick, position.y) * 0.34 * uLit;
  gl_Position = projectionMatrix * centre;
}`

const FLAME_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying float vFlicker;
void main() {
  vec2 p = vUv - vec2(0.5, 0.36);
  // the tongue: narrower toward the tip
  float tongue = exp(-(p.x * p.x) / (0.006 * max(0.05, 1.0 - p.y * 2.0)) - (p.y * p.y) * 20.0);
  float halo = exp(-dot(p, p) * 14.0) * 0.16;
  vec3 hot = mix(vec3(1.0, 0.42, 0.08), vec3(1.0, 0.86, 0.5), smoothstep(0.1, 0.8, tongue));
  // added as light; alpha stays 0 so ambient occlusion leaves no disc behind it
  gl_FragColor = vec4((hot * tongue * 1.7 + vec3(1.0, 0.55, 0.2) * halo) * vFlicker, 0.0);
}`

/**
 * Diyas: small clay oil lamps along the path and round each rangoli. Lit from
 * dusk until morning, and rain puts them out. Two draw calls for all of them.
 */
export const Diyas = (): React.ReactElement => {
  const spots = useMemo(() => diyaSpots(), [])
  const clay = useRef<THREE.InstancedMesh>(null)
  const flames = useRef<THREE.InstancedMesh>(null)

  const clayGeometry = useMemo(() => {
    const profile = [[0, 0], [0.05, 0], [0.085, 0.022], [0.09, 0.042], [0.078, 0.042], [0.05, 0.022], [0, 0.018]]
      .map(([x, y]) => new THREE.Vector2(x, y))
    return new THREE.LatheGeometry(profile, 12)
  }, [])

  const flameGeometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1)
    g.translate(0, 0.32, 0)
    g.setAttribute("aPhase", new THREE.InstancedBufferAttribute(Float32Array.from(spots, (_, i) => i * 2.399), 1))
    return g
  }, [spots])

  const flameMaterial = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: FLAME_VERTEX,
    fragmentShader: FLAME_FRAGMENT,
    uniforms: { uTime: { value: 0 }, uLit: { value: 0 } },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    ...LIGHT_BLENDING,
  }), [])

  useLayoutEffect(() => {
    const m = new THREE.Matrix4()
    spots.forEach((s, i) => {
      m.makeTranslation(s.x, s.y + 0.012, s.z)
      clay.current?.setMatrixAt(i, m)
      m.makeTranslation(s.x, s.y + 0.05, s.z)
      flames.current?.setMatrixAt(i, m)
    })
    if (clay.current) clay.current.instanceMatrix.needsUpdate = true
    if (flames.current) {
      flames.current.instanceMatrix.needsUpdate = true
      flames.current.frustumCulled = false
    }
  }, [spots])

  useHubFrame((state) => {
    const u = flameMaterial.uniforms
    u.uTime.value = state.clock.elapsedTime
    const evening = smoothstep(0.7, 0.8, worldRT.timeOfDay)
    const dry = 1 - smoothstep(0.35, 0.7, weatherRT.rain)
    u.uLit.value = evening * dry
    if (flames.current) flames.current.visible = u.uLit.value > 0.01
  })

  return (
    <group>
      <instancedMesh ref={clay} args={[clayGeometry, undefined, spots.length]} castShadow={false} receiveShadow>
        <meshStandardMaterial color="#a4502a" roughness={0.92} />
      </instancedMesh>
      <instancedMesh ref={flames} args={[flameGeometry, flameMaterial, spots.length]} />
    </group>
  )
}
