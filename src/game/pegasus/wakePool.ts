import * as THREE from "three"

/**
 * A fixed pool of ballistic particles drawn as one soft point sprite each (one
 * draw call per pool). Simulation is in logical float64 coordinates and only the
 * GPU buffer is written relative to the floating origin, so a particle thrown
 * near a far-off lake keeps its place through rebases. Dead particles are
 * zero-alpha, so a pool never allocates while it runs.
 */

const VERT = /* glsl */ `
attribute float aLife;
attribute float aSize;
attribute vec3 aCol;
uniform float uScale;
varying float vLife;
varying vec3 vCol;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // size in metres, scaled to pixels at its distance (uScale = px per m at 1 m)
  gl_PointSize = max(1.0, aSize * uScale / max(0.5, -mv.z));
  vLife = aLife;
  vCol = aCol;
  gl_Position = projectionMatrix * mv;
}`

const FRAG = /* glsl */ `
uniform float uOpacity;
varying float vLife;
varying vec3 vCol;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0 || vLife <= 0.0) discard;
  // a soft round grain: crisp enough for droplets, feathered for vapour
  gl_FragColor = vec4(vCol, exp(-d * 2.6) * vLife * uOpacity);
}`

export type WakePool = ReturnType<typeof makeWakePool>

export const makeWakePool = (capacity: number, opacity: number, name: string) => {
  const pos = new Float64Array(capacity * 3)
  const vel = new Float32Array(capacity * 3)
  const life = new Float32Array(capacity)
  const total = new Float32Array(capacity).fill(1)
  const size = new Float32Array(capacity)
  const grav = new Float32Array(capacity)
  const drag = new Float32Array(capacity)
  const floor = new Float32Array(capacity)
  const col = new Float32Array(capacity * 3)
  const position = new Float32Array(capacity * 3)
  const aLife = new Float32Array(capacity)
  const aSize = new Float32Array(capacity)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute("aLife", new THREE.BufferAttribute(aLife, 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute("aSize", new THREE.BufferAttribute(aSize, 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute("aCol", new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage))
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: { uScale: { value: 400 }, uOpacity: { value: opacity } },
  })
  const points = new THREE.Points(geometry, material)
  points.name = name
  points.frustumCulled = false
  points.renderOrder = 4
  let next = 0
  let live = 0

  return {
    points,
    material,
    /** the number of particles alive right now */
    get live() { return live },
    /**
     * Throw one particle from logical `(x, y, z)` with velocity `(vx, vy, vz)`.
     * `floorY` kills it when it falls to that height (a lake or ground surface).
     */
    spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, lifetime: number, sz: number, r: number, g: number, b: number, gravity: number, damping: number, floorY: number): void {
      const i = next
      next = (next + 1) % capacity
      if (life[i] <= 0) live++
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z
      vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz
      life[i] = total[i] = lifetime
      size[i] = sz
      col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b
      grav[i] = gravity
      drag[i] = damping
      floor[i] = floorY
    },
    /** advance every particle; the number of particles still alive is returned */
    step(dt: number): number {
      if (live === 0) return 0
      for (let i = 0; i < capacity; i++) {
        if (life[i] <= 0) continue
        life[i] -= dt
        const k = Math.max(0, 1 - drag[i] * dt)
        vel[i * 3] *= k; vel[i * 3 + 2] *= k
        vel[i * 3 + 1] = vel[i * 3 + 1] * k - grav[i] * dt
        pos[i * 3] += vel[i * 3] * dt
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt
        if (life[i] <= 0 || pos[i * 3 + 1] < floor[i]) { life[i] = 0; live-- }
      }
      return live
    },
    /** write the buffers relative to the origin (render space); parent is the origin-cancelling root */
    write(originX: number, originZ: number): void {
      points.visible = live > 0
      if (live === 0) return
      for (let i = 0; i < capacity; i++) {
        const o = i * 3
        position[o] = pos[o] - originX
        position[o + 1] = pos[o + 1]
        position[o + 2] = pos[o + 2] - originZ
        aLife[i] = life[i] > 0 ? life[i] / total[i] : 0
        aSize[i] = life[i] > 0 ? size[i] * (0.6 + 0.4 * (1 - aLife[i])) : 0
      }
      const g = geometry.attributes
      g.position.needsUpdate = g.aLife.needsUpdate = g.aSize.needsUpdate = g.aCol.needsUpdate = true
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
