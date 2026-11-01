import * as THREE from "three"
import { LIGHT_BLENDING } from "../render/lightBlending"

/**
 * Ribbons of light: a strip that follows a moving point (a dragon's
 * whisker, the tip of its tail), laid down as it goes and turned to face the
 * camera in the vertex shader, tapering and fading toward its far end. It
 * flutters a little sideways, like silk in the wind of its own passing.
 */
const POINTS = 56

const VERTEX = /* glsl */ `
attribute vec3 aNext;
attribute float aSide;
attribute float aAlong;
uniform float uWidth;
uniform float uTime;
uniform float uFlutter;
varying float vAlong;
varying float vSide;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec4 wn = modelMatrix * vec4(aNext, 1.0);
  vec3 tangent = wn.xyz - wp.xyz;
  float tl = length(tangent);
  tangent = tl > 1e-5 ? tangent / tl : vec3(1.0, 0.0, 0.0);
  vec3 toCam = normalize(cameraPosition - wp.xyz);
  vec3 side = cross(tangent, toCam);
  float sl = length(side);
  side = sl > 1e-5 ? side / sl : vec3(0.0, 1.0, 0.0);
  // silk: a wave that runs back along the ribbon
  float wave = sin(aAlong * 9.0 - uTime * 6.0) * uFlutter * aAlong;
  float width = uWidth * (1.0 - aAlong) * (0.35 + 0.65 * smoothstep(0.0, 0.08, aAlong));
  wp.xyz += side * (aSide * width + wave);
  vAlong = aAlong;
  vSide = aSide;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uTip;
uniform float uIntensity;
varying float vAlong;
varying float vSide;
void main() {
  float core = exp(-vSide * vSide * 3.5);
  float fade = (1.0 - vAlong) * (1.0 - vAlong);
  vec3 c = mix(uColor, uTip, vAlong);
  gl_FragColor = vec4(c * core * fade * uIntensity, 0.0);
}`

export class Ribbon {
  readonly mesh: THREE.Mesh
  private readonly pts: Float64Array
  private count = 0
  private readonly geometry: THREE.BufferGeometry
  private readonly pos: Float32Array
  private readonly next: Float32Array
  readonly material: THREE.ShaderMaterial

  constructor(color: string, tip: string, width: number, private spacing = 0.35) {
    this.pts = new Float64Array(POINTS * 3)
    this.geometry = new THREE.BufferGeometry()
    this.pos = new Float32Array(POINTS * 2 * 3)
    this.next = new Float32Array(POINTS * 2 * 3)
    const side = new Float32Array(POINTS * 2)
    const along = new Float32Array(POINTS * 2)
    const index: number[] = []
    for (let i = 0; i < POINTS; i++) {
      side[i * 2] = -1
      side[i * 2 + 1] = 1
      along[i * 2] = along[i * 2 + 1] = i / (POINTS - 1)
      if (i < POINTS - 1) {
        const a = i * 2
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute("aNext", new THREE.BufferAttribute(this.next, 3).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute("aSide", new THREE.BufferAttribute(side, 1))
    this.geometry.setAttribute("aAlong", new THREE.BufferAttribute(along, 1))
    this.geometry.setIndex(index)
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uWidth: { value: width }, uTime: { value: 0 }, uFlutter: { value: 0.08 },
        uColor: { value: new THREE.Color(color) }, uTip: { value: new THREE.Color(tip) }, uIntensity: { value: 1.4 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      ...LIGHT_BLENDING,
    })
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 8
  }

  /** Start again at a point (no streak back to where it was). */
  reset(p: THREE.Vector3): void {
    for (let i = 0; i < POINTS; i++) {
      this.pts[i * 3] = p.x
      this.pts[i * 3 + 1] = p.y
      this.pts[i * 3 + 2] = p.z
    }
    this.count = POINTS
  }

  /** Follow the anchor; call every frame. */
  update(p: THREE.Vector3, time: number): void {
    if (this.count === 0) this.reset(p)
    const dx = p.x - this.pts[3], dy = p.y - this.pts[4], dz = p.z - this.pts[5]
    if (dx * dx + dy * dy + dz * dz > 60 * 60) this.reset(p)
    // the head point always sits on the anchor; a new joint is laid every `spacing` metres
    this.pts[0] = p.x
    this.pts[1] = p.y
    this.pts[2] = p.z
    if (dx * dx + dy * dy + dz * dz > this.spacing * this.spacing) {
      this.pts.copyWithin(3, 0, (POINTS - 1) * 3)
    }
    for (let i = 0; i < POINTS; i++) {
      const j = Math.min(POINTS - 1, i + 1)
      const k = i === POINTS - 1 ? i - 1 : j
      for (const s of [0, 1]) {
        const v = (i * 2 + s) * 3
        this.pos[v] = this.pts[i * 3]
        this.pos[v + 1] = this.pts[i * 3 + 1]
        this.pos[v + 2] = this.pts[i * 3 + 2]
        // the last joint looks back at the one before it, reversed: keep the strip's side consistent
        const sign = i === POINTS - 1 ? -1 : 1
        this.next[v] = this.pts[i * 3] + (this.pts[k * 3] - this.pts[i * 3]) * sign
        this.next[v + 1] = this.pts[i * 3 + 1] + (this.pts[k * 3 + 1] - this.pts[i * 3 + 1]) * sign
        this.next[v + 2] = this.pts[i * 3 + 2] + (this.pts[k * 3 + 2] - this.pts[i * 3 + 2]) * sign
      }
    }
    ;(this.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true
    ;(this.geometry.getAttribute("aNext") as THREE.BufferAttribute).needsUpdate = true
    this.material.uniforms.uTime.value = time
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}
