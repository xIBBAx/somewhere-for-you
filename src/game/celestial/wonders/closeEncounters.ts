import * as THREE from "three"
import { universeDirToLocal, universeToView } from "../spaceState"
import { qualityRT } from "../../../state/qualityStore"
import { createSolarFilament } from "./solarFilaments"
import { passedThrough } from "./wishes"
import { sitePoint, type WonderSite, type WonderTick } from "./wonderWorlds"

/** Reachable, imagined companions to the real worlds: parted cloud silk,
 * dancing dust, and flowing solar-field echoes. They never imply a safe landing. */
const VEIL_VERT = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uOpen;
void main() {
  vUv = uv;
  vec3 p = position;
  p.x += sign(p.x) * uOpen * 0.35 * (1.0 - abs(p.y) * 1.5);
  p.z += sin(uv.y * 8.0 + uTime * 0.4) * 0.06;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`
const VEIL_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uOpen;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float edge = (1.0 - smoothstep(0.6, 1.0, abs(p.x))) * (1.0 - smoothstep(0.5, 1.0, abs(p.y)));
  float silk = 0.5 + 0.5 * sin(p.y * 26.0 + sin(p.x * 5.0 + uTime * 0.3) * 3.0);
  float gap = smoothstep(uOpen * 0.65, uOpen * 0.65 + 0.15, abs(p.x));
  float a = edge * gap * (0.1 + silk * 0.18);
  gl_FragColor = vec4(mix(vec3(1.0, 0.55, 0.16), vec3(1.0, 0.88, 0.53), silk), a);
}`
const DUST_VERT = /* glsl */ `
uniform float uHalfH;
void main() {
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_PointSize = clamp(1.8 * uHalfH / max(1.0, -p.z), 1.0, 18.0);
}`
const DUST_FRAG = /* glsl */ `
uniform float uWake;
void main() {
  float r = length(gl_PointCoord * 2.0 - 1.0);
  float a = (1.0 - smoothstep(0.0, 1.0, r)) * 0.65;
  gl_FragColor = vec4(mix(vec3(0.85, 0.23, 0.08), vec3(1.0, 0.7, 0.33), uWake), a);
}`

export const encounterKind = (id: string): "veil" | "dust" | "solar" | null =>
  id === "venus" ? "veil" : id === "mars" ? "dust" : id === "sun" ? "solar" : null

export const createCloseEncounters = (onTouch: (world: string, index: number) => void) => {
  const root = new THREE.Group()
  root.name = "close-encounters"
  root.visible = false
  const plane = new THREE.PlaneGeometry(1, 1, 12, 8)
  const centres = Array.from({ length: 3 }, () => new THREE.Vector3())
  const glow = [0, 0, 0], last = [-100, -100, -100]
  const veils = centres.map(() => new THREE.Mesh(plane, new THREE.ShaderMaterial({
    vertexShader: VEIL_VERT, fragmentShader: VEIL_FRAG, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, uniforms: { uTime: { value: 0 }, uOpen: { value: 0 } },
  })))
  const solar = centres.map((_, i) => createSolarFilament(i))
  const dustGeometry = new THREE.BufferGeometry()
  const positions = new THREE.BufferAttribute(new Float32Array(144 * 3), 3)
  dustGeometry.setAttribute("position", positions)
  const dustMaterial = new THREE.ShaderMaterial({
    vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, transparent: true, depthWrite: false,
    uniforms: { uHalfH: { value: 540 }, uWake: { value: 0 } },
  })
  const dust = new THREE.Points(dustGeometry, dustMaterial)
  root.add(...veils, ...solar.map(s => s.root), dust)
  for (const child of root.children) child.frustumCulled = false
  let site: WonderSite | null = null
  const p = new THREE.Vector3(), x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3()
  const matrix = new THREE.Matrix4()
  const bind = (s: WonderSite | null): void => {
    site = s
    const kind = s ? encounterKind(s.world.id) : null
    root.visible = !!kind
    dust.visible = kind === "dust"
    for (let i = 0; i < 3; i++) {
      glow[i] = 0
      last[i] = -100
      veils[i].visible = kind === "veil"
      solar[i].root.visible = kind === "solar"
      if (s) sitePoint(s, (i - 1) * 150, i === 1 ? 25 : 0, 260 + i * (kind === "solar" ? 90 : 130), centres[i])
    }
  }
  const update = (t: WonderTick): void => {
    const s = site
    if (!s || !root.visible) return
    const kind = encounterKind(s.world.id)
    universeDirToLocal(s.right, x)
    universeDirToLocal(s.up, y)
    universeDirToLocal(z.copy(s.fwd).negate(), z)
    matrix.makeBasis(x, y, z)
    let wake = 0
    for (let i = 0; i < 3; i++) {
      const close = passedThrough(t.prev, t.mount, centres[i], kind === "solar" ? 42 : 55)
      if (close && t.time - last[i] > 5) { onTouch(s.world.id, i); last[i] = t.time }
      glow[i] += ((close ? 1 : 0) - glow[i]) * (1 - Math.exp(-t.dt * (close ? 5 : 1.2)))
      wake = Math.max(wake, glow[i])
      const mesh = kind === "veil" ? veils[i] : solar[i].root
      universeToView(centres[i], mesh.position)
      mesh.quaternion.setFromRotationMatrix(matrix)
      if (kind === "veil") {
        mesh.scale.set(190, 120, 120)
        veils[i].material.uniforms.uTime.value = t.time
        veils[i].material.uniforms.uOpen.value = glow[i]
      } else if (kind === "solar") {
        // Small, reachable echoes of the field at the safe arrival distance;
        // actual solar prominences belong to the star, millions of metres away.
        const distance = t.mount.distanceTo(centres[i])
        const near = 1 - THREE.MathUtils.smoothstep(distance, 40, 190)
        solar[i].update(t.time, Math.max(glow[i], near * 0.45), t.calm, qualityRT.level)
      }
    }
    if (kind === "dust") {
      for (let j = 0; j < 144; j++) {
        const i = Math.floor(j / 48), u = (j % 48) / 48
        const a = u * Math.PI * 12 + t.time * (t.calm ? 0.15 : 0.65)
        const radius = 12 + u * 28 + glow[i] * 42
        p.copy(centres[i]).addScaledVector(s.right, Math.cos(a) * radius)
          .addScaledVector(s.fwd, Math.sin(a) * radius).addScaledVector(s.up, (u - 0.5) * 140)
        universeToView(p, p)
        positions.setXYZ(j, p.x, p.y, p.z)
      }
      positions.needsUpdate = true
      dustMaterial.uniforms.uHalfH.value = t.halfH
      dustMaterial.uniforms.uWake.value = wake
    }
  }
  const dispose = (): void => {
    plane.dispose(); dustGeometry.dispose(); dustMaterial.dispose()
    veils.forEach(m => m.material.dispose()); solar.forEach(s => s.dispose())
  }
  return { root, bind, update, dispose }
}
