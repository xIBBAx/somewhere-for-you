import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { avatarRT, worldRT } from "../../game/runtime"
import { celestialRT } from "../../game/environment/celestialLighting"
import { weatherRT } from "../../game/weather/weatherState"
import { WATER_LEVEL } from "../climate"
import { hash3 } from "../noise"
import { originRT } from "../origin"
import { waterDepthAt } from "../waterSurface"
import { windRT } from "../wind"
import { WORLD_SEED } from "../worldConfig"

/**
 * Mist over the lakes: soft sheets of vapour that gather over still water
 * in the cool of dawn, dusk and night, after rain and in foggy weather, and
 * drift slowly downwind, thinning and re-forming.
 *
 * Puffs live on a world-aligned lattice (MIST_CELL) so they stay put as the
 * player moves; each is an upright billboard that fades to nothing at its
 * foot, so it never draws a line where it meets the water.
 */

export const MIST_CELL = 14
const MIST_RANGE = 96
const MAX_PUFFS = 220

export type MistPuff = { x: number; z: number; seed: number; size: number }

/** Deterministic puffs over open water around a point. */
export const mistPuffsNear = (px: number, pz: number, out: MistPuff[] = []): MistPuff[] => {
  out.length = 0
  const c0x = Math.floor((px - MIST_RANGE) / MIST_CELL), c1x = Math.floor((px + MIST_RANGE) / MIST_CELL)
  const c0z = Math.floor((pz - MIST_RANGE) / MIST_CELL), c1z = Math.floor((pz + MIST_RANGE) / MIST_CELL)
  for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
    const h = hash3(WORLD_SEED ^ 0x3157, cx, cz)
    const x = (cx + 0.15 + ((h & 0xffff) / 0xffff) * 0.7) * MIST_CELL
    const z = (cz + 0.15 + ((h >>> 16) / 0xffff) * 0.7) * MIST_CELL
    if (Math.hypot(x - px, z - pz) > MIST_RANGE) continue
    // keep to open water, clear of the banks
    if (waterDepthAt(x, z) < 0.7) continue
    out.push({ x, z, seed: (h % 9973) / 9973, size: 7 + ((h >>> 8) % 100) / 100 * 7 })
    if (out.length >= MAX_PUFFS) return out
  }
  return out
}

/**
 * 0 … 1: how much mist the air holds over water. Cool, still, humid air
 * makes it: twilight and night, a wet world after rain, fog. Wind and the
 * full warmth of the day burn it off.
 */
export const mistAmount = (tod: number, wetness: number, rain: number, wind: number, fog: boolean, morning: boolean): number => {
  const s = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
  const cool = s(0.4, 0.75, tod) * (morning ? 1 : 0.7)
  const humid = Math.max(wetness * 0.75, fog ? 1 : 0, rain * 0.35)
  const still = 1 - s(0.35, 0.9, wind)
  return Math.min(1, Math.max(cool * 0.85, humid) * still * (1 - rain * 0.4))
}

const VERT = /* glsl */ `
attribute vec4 aPuff; // xyz render-space foot, w seed
attribute float aSize;
uniform float uTime;
uniform vec2 uDrift;
varying vec2 vUv;
varying float vSeed;
varying float vFade;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vSeed = aPuff.w;
  // each puff drifts downwind round a little loop, then thins and re-forms
  float life = fract(uTime * 0.018 + aPuff.w * 7.0);
  vFade = sin(life * 3.14159);
  vec3 foot = aPuff.xyz + vec3(uDrift.x, 0.0, uDrift.y) * (life - 0.5) * 9.0;
  float w = aSize * (0.8 + 0.4 * life);
  float h = aSize * 0.32;
  // upright billboard facing the camera about the vertical axis
  vec3 toCam = cameraPosition - foot;
  vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-4, 0.0, 0.0));
  vec3 p = foot + right * (uv.x - 0.5) * w + vec3(0.0, uv.y * h, 0.0);
  // never fill the lens: thin out when the camera is inside the sheet
  vFade *= smoothstep(2.0, 7.0, length(toCam));
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAmount;
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
varying float vFade;
#include <fog_pars_fragment>
// Continuous swirls from a few crossed sines. A sin-hash value noise drew
// hard, cell-aligned blocks on some GPUs (hash precision), so no hashing here.
float swirl(vec2 p) {
  float a = sin(p.x * 1.7 + sin(p.y * 1.3 + p.x * 0.4) * 1.6);
  float b = sin(p.y * 2.3 - p.x * 0.9 + sin(p.x * 0.8) * 1.2);
  float c = sin((p.x + p.y) * 3.1 + a * 1.1);
  return 0.5 + 0.28 * a + 0.16 * b + 0.06 * c;
}
void main() {
  vec2 c = vUv - vec2(0.5, 0.0);
  // a low, wide bank: densest a little above the water, fading up and out
  float across = 1.0 - smoothstep(0.18, 0.5, abs(c.x));
  float up = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.3, 1.0, vUv.y));
  vec2 q = vec2(vUv.x * 3.0 + vSeed * 6.28 + uTime * 0.03, vUv.y * 1.6 - uTime * 0.02);
  float wisps = swirl(q);
  float a = across * up * smoothstep(0.25, 0.75, wisps) * vFade * uAmount * 0.8;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`

export const lakeMistRT = { puffs: 0, amount: 0 }
const MOONLIT = new THREE.Color(0.035, 0.042, 0.058)

export const LakeMist = (): React.ReactElement => {
  const sys = useMemo(() => {
    const base = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0)
    const g = new THREE.InstancedBufferGeometry()
    g.index = base.index
    g.setAttribute("position", base.getAttribute("position"))
    g.setAttribute("uv", base.getAttribute("uv"))
    const puff = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 4), 4).setUsage(THREE.DynamicDrawUsage)
    const size = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS), 1).setUsage(THREE.DynamicDrawUsage)
    g.setAttribute("aPuff", puff)
    g.setAttribute("aSize", size)
    g.instanceCount = 0
    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 }, uDrift: { value: new THREE.Vector2() }, uColor: { value: new THREE.Color() }, uAmount: { value: 0 },
      }]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    })
    const mesh = new THREE.Mesh(g, material)
    mesh.name = "lake-mist"
    mesh.frustumCulled = false
    // after the lake surface (renderOrder 1), so the vapour sits on the water
    mesh.renderOrder = 3
    // N8AO masks AO under transparent objects through a half-res, nearest-
    // filtered pass: each soft puff turned into a hard-edged bright rectangle
    // on the water. Vapour this thin needs no AO masking.
    mesh.userData.treatAsOpaque = true
    // instances are written in render space; cancel WorldRoot's -origin
    mesh.matrixAutoUpdate = false
    return { mesh, puff, size, list: [] as MistPuff[], lastX: Number.NaN, lastZ: Number.NaN, version: -1, base }
  }, [])

  useEffect(() => () => {
    sys.mesh.geometry.dispose()
    sys.base.dispose()
    ;(sys.mesh.material as THREE.Material).dispose()
  }, [sys])

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const u = (sys.mesh.material as THREE.ShaderMaterial).uniforms
    const target = mistAmount(worldRT.timeOfDay, weatherRT.wetness, weatherRT.rain, weatherRT.wind + weatherRT.gust * 0.5,
      weatherRT.condition === "fog", celestialRT.morning > 0.5)
    u.uAmount.value = THREE.MathUtils.damp(u.uAmount.value, target, 0.4, dt)
    lakeMistRT.amount = u.uAmount.value
    sys.mesh.visible = u.uAmount.value > 0.01 && !worldRT.introActive
    if (!sys.mesh.visible) return
    u.uTime.value = state.clock.elapsedTime % 3600
    u.uDrift.value.set(windRT.dirX, windRT.dirZ)
    // vapour takes the colour of the air around it, a touch brighter: water
    // droplets scatter the sky and moonlight, so mist stays pale at night
    const fog = state.scene.fog as THREE.Fog | null
    if (fog) (u.uColor.value as THREE.Color).copy(fog.color).multiplyScalar(1.18).add(MOONLIT)
    sys.mesh.position.set(originRT.x, 0, originRT.z)
    sys.mesh.updateMatrix()
    const p = avatarRT().pos
    if (Math.abs(p.x - sys.lastX) < 6 && Math.abs(p.z - sys.lastZ) < 6 && sys.version === originRT.version) return
    sys.lastX = p.x; sys.lastZ = p.z; sys.version = originRT.version
    mistPuffsNear(p.x, p.z, sys.list)
    const a = sys.puff.array as Float32Array, s = sys.size.array as Float32Array
    for (let i = 0; i < sys.list.length; i++) {
      const m = sys.list[i]
      a[i * 4] = m.x - originRT.x; a[i * 4 + 1] = WATER_LEVEL + 0.05; a[i * 4 + 2] = m.z - originRT.z; a[i * 4 + 3] = m.seed
      s[i] = m.size
    }
    sys.puff.needsUpdate = true; sys.size.needsUpdate = true
    ;(sys.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = sys.list.length
    lakeMistRT.puffs = sys.list.length
  })

  return <primitive object={sys.mesh} />
}
