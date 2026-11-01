import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { catRT, avatarRT, worldRT } from "../../game/runtime"
import { weatherRT } from "../../game/weather/weatherState"
import { skyLightLevel } from "../../game/environment/celestialLighting"
import { groundResources } from "../../game/environment/ground/groundMaterial"
import { trailResources, TRAIL_WINDOW } from "../../game/environment/ground/trailField"
import { GROUND_BOUNDS, SURFACE_RESOLUTION } from "../../game/environment/ground/groundSurface"
import { FIELD_N, FIELD_RES, FIELD_STEP, FLOWER_DENSITY } from "../chunkGen"
import { BIOME_COUNT, biomeWeights } from "../climate"
import { HUB_CENTER } from "../hubLayout"
import { hash01 } from "../noise"
import { WORLD_NOISE_GLSL, originRT, originUniforms } from "../origin"
import { WIND_GLSL, windUniforms } from "../wind"
import { worldStreamRT } from "../worldRuntime"
import { CHUNK_SIZE, WORLD_SEED } from "../worldConfig"
import { QUALITY, useQuality } from "../../state/qualityStore"

/**
 * Endless wind-swept grass.
 *
 * A ring of 8 m tiles is recycled around the explorer. Each tile's clumps are
 * deterministic (global grid + hash), take their density, height and tint
 * from the streamed chunk data (biome grass cover, soil, shore) — or, at
 * home, from the authored surface map so paths and plazas stay clear.
 *
 * Everything moves on the GPU: tip-weighted bending from the shared wind
 * (gust patches roll across the meadow), per-clump phase, push-away around
 * The explorer and the cat, and a soft radial fade so the field never shows an edge.
 */

export const GRASS_CONFIG = {
  tile: 8,
  /** dense layer: full detail right around the explorer (candidate clumps per m²) */
  near: { inner: 0, outer: 19, density: 10 },
  /** sparse layer: fills the meadow out to the fade */
  far: { inner: 14, outer: 36, density: 3 },
}

const TILE = GRASS_CONFIG.tile
type LayerSpec = { inner: number; outer: number; density: number }

const bladeGeometry = (blades: number): THREE.InstancedBufferGeometry => {
  // one clump = many fine (4–10 mm), tapered, arching blades of varied
  // height and lean, like a real tussock; aBlade seeds colour/flex per blade
  const pos: number[] = []
  const uv: number[] = []
  const seed: number[] = []
  // a flowering blade's shape: xz the side a vertex of the upper row sits on
  // (zero elsewhere), z its row along the blade (0 root .. 1 tip)
  const head: number[] = []
  const idx: number[] = []
  for (let b = 0; b < blades; b++) {
    const r1 = hash01(0x51, b, 3)
    const r2 = hash01(0x52, b, 7)
    const r3 = hash01(0x53, b, 11)
    const a = (b / blades) * Math.PI * 2 + r1 * 2.1
    const spread = 0.012 + Math.sqrt(r2) * 0.1
    const ox = Math.cos(a) * spread
    const oz = Math.sin(a) * spread
    // outer blades lean and arch further than the upright heart of the clump
    const lean = 0.05 + r1 * 0.22 + spread * 1.4
    const h = 0.45 + r3 * 0.65
    const facing = a + (r1 - 0.5) * 1.4
    const dx = Math.cos(a)
    const dz = Math.sin(a)
    const px = -Math.sin(facing)
    const pz = Math.cos(facing)
    const halfWidth = 0.0022 + r2 * 0.0026
    const base = pos.length / 3
    const rows = [0, 0.38, 0.72, 1]
    for (let r = 0; r < rows.length; r++) {
      const t = rows[r]
      const w = (1 - Math.pow(t, 1.6)) * halfWidth + 0.0004
      const cx = ox + dx * lean * t * t
      const cz = oz + dz * lean * t * t
      if (r < rows.length - 1) {
        pos.push(cx - px * w, t * h, cz - pz * w, cx + px * w, t * h, cz + pz * w)
        uv.push(0, t, 1, t)
        seed.push(r1, r1)
        if (r === rows.length - 2) head.push(-px, -pz, t, px, pz, t)
        else head.push(0, 0, t, 0, 0, t)
      } else {
        pos.push(cx, t * h, cz)
        uv.push(0.5, 1)
        seed.push(r1)
        head.push(0, 0, 1)
      }
    }
    for (let r = 0; r < rows.length - 2; r++) {
      const i = base + r * 2
      idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2)
    }
    const last = base + (rows.length - 2) * 2
    idx.push(last, last + 1, last + 2)
  }
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute("aBlade", new THREE.Float32BufferAttribute(seed, 1))
  g.setAttribute("aHead", new THREE.Float32BufferAttribute(head, 3))
  // up-facing normals: soft, meadow-like light response
  const nor = new Float32Array(pos.length)
  for (let i = 0; i < nor.length; i += 3) nor[i + 1] = 1
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3))
  g.setIndex(idx)
  return g
}

const flowerScratch = new Float32Array(BIOME_COUNT)

export const grassUniforms = {
  uPlayer: { value: new THREE.Vector3(0, -1000, 0) },
  uCat: { value: new THREE.Vector3(0, -1000, 0) },
  uGrassLight: { value: 1 },
  /** a big wing's downwash (pegasus/downwash.ts): render-space xz, unused y, strength 0..~1.3; and its radius (m) */
  uDownwash: { value: new THREE.Vector4(0, 0, 0, 0) },
  uDownwashR: { value: 6 },
}

const grassMaterial = (spec: LayerSpec, widen: number): THREE.MeshStandardMaterial => {
  const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.85, metalness: 0 })
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, windUniforms, grassUniforms, trailResources().uniforms, {
      uWetness: groundResources().wetness,
      uSnow: groundResources().snow,
      uOriginWrap: originUniforms.uOriginWrap,
      uInner: { value: spec.inner },
      uOuter: { value: spec.outer },
      uWiden: { value: widen },
    })
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
${WORLD_NOISE_GLSL}
${WIND_GLSL}
attribute vec4 iPos;   // xyz render-space root (relative to mesh), w = height scale
attribute vec4 iData;  // x rotation, y width scale, z tint variation, w flower density
attribute vec3 iColor;
attribute float aBlade;
attribute vec3 aHead;
uniform vec3 uPlayer;
uniform vec3 uCat;
uniform vec4 uDownwash;
uniform float uDownwashR;
uniform sampler2D uTrailField;
uniform vec2 uTrailCenter;
uniform float uInner;
uniform float uOuter;
uniform float uWiden;
uniform float uWetness;
varying float vTip;
varying vec3 vGrassCol;
varying float vFade;
varying float vSheen;
varying float vBloom;
varying float vBloomRow;
varying vec3 vBloomCol;`,
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 root = (modelMatrix * vec4(iPos.xyz, 1.0)).xyz;
float camDist = length(cameraPosition.xz - root.xz);
// layer crossfade: clumps grow/shrink at the layer edges instead of popping
float fade = (1.0 - smoothstep(uOuter - (uInner > 0.0 ? 8.0 : 3.0), uOuter - 0.5, camDist));
if (uInner > 0.0) fade *= smoothstep(uInner, uInner + 3.0, camDist);
vFade = fade;
// Wildflowers in the sward: where the biome is flowery (iData.w, the density
// the flower clumps use) a share of the blades, drifting in patches, lifts its
// upper row into a small flower head - white, buttercup yellow, violet or pink
// by patch. Up close the authored flower clumps carry the detail, so the heads
// open only beyond a few metres, where they read as the meadow's colour.
// The noise is only paid for where flowers can grow (not at home).
vBloom = 0.0;
vBloomCol = vec3(0.0);
float bloomPick = fract(aBlade * 3.17 + iData.z * 29.3 + iData.x * 0.71);
if (bloomPick < iData.w * 0.34) {
  float bloomDrift = smoothstep(0.3, 0.68, wNoise(root.xz, 64.0) * 0.6 + wNoise(root.xz, 190.0) * 0.4);
  vBloom = step(bloomPick, iData.w * bloomDrift * 0.34) * fade * smoothstep(2.5, 6.0, camDist);
  float bloomHue = fract(wNoise(root.xz, 23.0) * 1.7 + iData.z * 0.35);
  vBloomCol = bloomHue < 0.3 ? vec3(0.86, 0.85, 0.80) : bloomHue < 0.55 ? vec3(0.92, 0.66, 0.06)
    : bloomHue < 0.78 ? vec3(0.44, 0.27, 0.74) : vec3(0.88, 0.36, 0.52);
}
float c = cos(iData.x), s = sin(iData.x);
vec3 p = position;
// A flowering blade becomes a hair-thin upright stalk standing a little above
// the sward: its middle row closes into a neck just under the head, its upper
// row opens into the head and the tip caps it.
float bladeH = position.y / max(aHead.z, 0.05);
float headSide = step(0.001, dot(aHead.xy, aHead.xy));
float neckRow = step(0.2, aHead.z) * step(aHead.z, 0.5);
p.xz *= 1.0 - vBloom * 0.8;
p.xz += aHead.xy * 0.016 * headSide * vBloom;
float flowerY = aHead.z < 0.1 ? 0.0 : bladeH * (neckRow > 0.5 ? 1.06 : headSide > 0.5 ? 1.13 : 1.2);
p.y = mix(p.y, flowerY, vBloom);
vBloomRow = aHead.z;
p.xz = mat2(c, -s, s, c) * (p.xz * vec2(iData.y * uWiden));
float h = iPos.w * fade;
vec2 trailUV=(root.xz-uTrailCenter)/${TRAIL_WINDOW.toFixed(1)}+0.5;
float trailInside=step(0.,trailUV.x)*step(trailUV.x,1.)*step(0.,trailUV.y)*step(trailUV.y,1.);
float pressed=texture2D(uTrailField,clamp(trailUV,0.,1.)).r*trailInside;
h*=1.-pressed*.82;
// a big wing beating low overhead: each downstroke presses the grass flat and outward
vec2 awayW = root.xz - uDownwash.xz;
float dW = length(awayW);
float wash = uDownwash.w * (1.0 - smoothstep(uDownwashR * 0.2, uDownwashR, dW));
h *= 1.0 - min(0.45, wash * 0.35);
p.y *= h;
float tip = position.y;
vTip = tip;
// wind: tip-weighted, quadratic so the root stays anchored
vec2 bend = windBend(root.xz, iData.z * 6.2831 + iData.x) * 0.55;
// a bent blade shows its paler, glossier side: gusts roll across as bright waves
vSheen = windSheen(root.xz) * (1.0 - uWetness * 0.6);
// push away from the explorer and the cat
vec2 away = root.xz - uPlayer.xz;
float d = length(away);
float push = (1.0 - smoothstep(0.25, 0.95, d)) * step(abs(root.y - uPlayer.y), 1.2);
vec2 awayC = root.xz - uCat.xz;
float dc = length(awayC);
float pushC = (1.0 - smoothstep(0.15, 0.55, dc)) * step(abs(root.y - uCat.y), 1.0);
bend += normalize(away + 1e-4) * push * 0.75 + normalize(awayC + 1e-4) * pushC * 0.5;
bend += normalize(awayW + 1e-4) * wash * 0.9;
float k = tip * tip;
p.xz += bend * k * h;
p.y -= length(bend) * k * h * 0.35;
// Water loading bends the tips slightly; rooted blades stay above shallow pools.
p.y *= 1.0 - uWetness * 0.10 * k;
p.xz *= 1.0 + uWetness * 0.18 * k;
vec3 transformed = iPos.xyz + p;
vGrassCol = iColor * meadowHue(root.xz);
vGrassCol=mix(vGrassCol,vGrassCol*vec3(1.10,.98,.83),pressed*.45);
// a few sun-cured straw blades and fresh lime shoots per tussock
float bladeKind = fract(aBlade * 7.31 + iData.z * 13.7);
vGrassCol = mix(vGrassCol, vec3(0.36, 0.31, 0.15), step(0.88, bladeKind) * 0.8);
vGrassCol = mix(vGrassCol, vGrassCol * vec3(0.78, 0.86, 0.7), step(0.62, bladeKind) * step(bladeKind, 0.88));
vGrassCol = mix(vGrassCol, vGrassCol * vec3(1.08, 1.12, 0.78), step(bladeKind, 0.16));`,
      )
      .replace("#include <beginnormal_vertex>", "vec3 objectNormal = normalize(vec3(0.0, 1.0, 0.0));")
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uGrassLight;\nuniform float uWetness;\nuniform float uSnow;\nvarying float vTip;\nvarying vec3 vGrassCol;\nvarying float vFade;\nvarying float vSheen;\nvarying float vBloom;\nvarying float vBloomRow;\nvarying vec3 vBloomCol;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
vec3 rootCol = vGrassCol * vec3(0.34, 0.38, 0.3);
vec3 tipCol = vGrassCol * vec3(1.06, 1.08, 0.84) + vec3(0.02, 0.022, 0.004);
diffuseColor.rgb = mix(rootCol, tipCol, smoothstep(0.0, 1.0, vTip)) * (1.0 - uWetness * 0.19);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.16, 1.15, 1.04) + vec3(0.018, 0.02, 0.012), vSheen * vTip * 0.85);
diffuseColor.rgb = mix(diffuseColor.rgb, vBloomCol * (1.0 - uWetness * 0.12), vBloom * step(0.36, vBloomRow));
// snow caught on the blades, thickest at the tips
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.94), uSnow * smoothstep(0.25, 1.0, vTip) * 0.78);`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = 0.85 - uWetness * 0.38;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
// light passing through blade tips
totalEmissiveRadiance += diffuseColor.rgb * 0.12 * vTip * uGrassLight;`,
      )
  }
  m.customProgramCacheKey = () => `grass-field-v7-sheen-${spec.inner}-${spec.outer}`
  return m
}

type Tile = { key: string; tx: number; tz: number; slot: number; built: boolean }

const hubSurface = (): Uint8Array | null => {
  const tex = groundResources().surface.value
  return (tex.image as { data?: Uint8Array }).data ?? null
}

export const grassStats = { tiles: 0, instances: 0, pendingTiles: 0 }

export const GrassField = (): React.ReactElement => {
  const level = useQuality((s) => s.level)
  const layers = useMemo(() => ({
    near: { ...GRASS_CONFIG.near, density: GRASS_CONFIG.near.density * QUALITY[level].grass },
    far: { ...GRASS_CONFIG.far, density: GRASS_CONFIG.far.density * QUALITY[level].grass, outer: QUALITY[level].grassRange },
  }), [level])
  // the far layer uses fewer, wider blades: thin geometry would alias there
  return <><GrassLayer spec={layers.near} widen={1} blades={20} salt={0} /><GrassLayer spec={layers.far} widen={2.4} blades={10} salt={1} /></>
}

const GrassLayer = ({ spec, widen, blades, salt }: { spec: LayerSpec; widen: number; blades: number; salt: number }): React.ReactElement => {
  const PER_TILE = Math.ceil(TILE * TILE * spec.density)
  const state = useMemo(() => {
    const geometry = bladeGeometry(blades)
    const R = spec.outer
    const span = Math.ceil(R / TILE) + 1
    const maxTiles = (span * 2 + 1) ** 2
    const capacity = maxTiles * PER_TILE
    const iPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
    const iData = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
    const iColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
    iPos.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute("iPos", iPos)
    geometry.setAttribute("iData", iData)
    geometry.setAttribute("iColor", iColor)
    geometry.instanceCount = capacity
    const mesh = new THREE.Mesh(geometry, grassMaterial(spec, widen))
    mesh.name = "grass-field"
    mesh.frustumCulled = false
    mesh.receiveShadow = true
    mesh.castShadow = false
    return { mesh, geometry, iPos, iData, iColor, maxTiles, capacity, span }
  }, [spec, widen, blades, PER_TILE])

  useEffect(() => () => {
    state.geometry.dispose()
    ;(state.mesh.material as THREE.Material).dispose()
  }, [state])

  const runtime = useMemo(() => {
    const tiles = new Map<string, Tile>()
    // lowest slots first so the drawn instance range stays compact
    const freeSlots: number[] = []
    for (let i = state.maxTiles - 1; i >= 0; i--) freeSlots.push(i)
    const takeSlot = (): number | undefined => {
      if (!freeSlots.length) return undefined
      let best = 0
      for (let i = 1; i < freeSlots.length; i++) if (freeSlots[i] < freeSlots[best]) best = i
      const v = freeSlots[best]
      freeSlots[best] = freeSlots[freeSlots.length - 1]
      freeSlots.pop()
      return v
    }
    return { tiles, freeSlots, takeSlot, originVersion: -1, originX: Number.NaN, originZ: Number.NaN, lastTx: Number.NaN, lastTz: Number.NaN }
  }, [state])

  useFrame(() => {
    const { tiles, freeSlots } = runtime
    const body = avatarRT()
    const px = body.pos.x
    const pz = body.pos.z
    state.mesh.position.set(originRT.x, 0, originRT.z)
    grassUniforms.uPlayer.value.set(px - originRT.x, body.pos.y, pz - originRT.z)
    grassUniforms.uCat.value.set(catRT.pos.x - originRT.x, catRT.pos.y, catRT.pos.z - originRT.z)
    grassUniforms.uGrassLight.value = skyLightLevel(worldRT.timeOfDay, weatherRT.cloud, weatherRT.rain)

    // on a rebase every blade moves into the new render frame at once (a
    // whole-metre shift, exact in float). Rebuilding the tiles instead took
    // 9 to 23 frames, the near grass a kilometre away meanwhile: it blinked.
    if (runtime.originVersion !== originRT.version) {
      runtime.originVersion = originRT.version
      const dx = originRT.x - runtime.originX, dz = originRT.z - runtime.originZ
      runtime.originX = originRT.x
      runtime.originZ = originRT.z
      if (Number.isFinite(dx) && Number.isFinite(dz) && (dx !== 0 || dz !== 0)) {
        const a = state.iPos.array as Float32Array
        for (let i = 0; i < a.length; i += 4) {
          a[i] -= dx
          a[i + 2] -= dz
        }
        state.iPos.clearUpdateRanges()
        state.iPos.needsUpdate = true
      }
    }

    const ptx = Math.floor(px / TILE)
    const ptz = Math.floor(pz / TILE)
    const R = spec.outer
    if (ptx !== runtime.lastTx || ptz !== runtime.lastTz) {
      runtime.lastTx = ptx
      runtime.lastTz = ptz
      // release far tiles
      for (const [key, t] of tiles) {
        const cx = (t.tx + 0.5) * TILE
        const cz = (t.tz + 0.5) * TILE
        if (Math.hypot(cx - px, cz - pz) > R + TILE * 1.2) {
          clearSlot(t.slot)
          freeSlots.push(t.slot)
          tiles.delete(key)
        }
      }
      // claim new tiles
      for (let dz = -state.span; dz <= state.span; dz++) {
        for (let dx = -state.span; dx <= state.span; dx++) {
          const tx = ptx + dx
          const tz = ptz + dz
          const key = `${tx},${tz}`
          if (tiles.has(key)) continue
          const nx = Math.max(tx * TILE, Math.min(px, (tx + 1) * TILE))
          const nz = Math.max(tz * TILE, Math.min(pz, (tz + 1) * TILE))
          if (Math.hypot(nx - px, nz - pz) > R) continue
          // the far layer skips tiles entirely inside the near layer's core
          const fx = Math.abs((tx + 0.5) * TILE - px) + TILE / 2
          const fz = Math.abs((tz + 0.5) * TILE - pz) + TILE / 2
          if (spec.inner > 0 && Math.hypot(fx, fz) < spec.inner) continue
          const slot = runtime.takeSlot()
          if (slot === undefined) continue
          tiles.set(key, { key, tx, tz, slot, built: false })
        }
      }
    }

    // build a few pending tiles per frame, nearest first (time-sliced)
    let budget = 3
    const order = [...tiles.values()].filter((t) => !t.built)
    let pending = order.length
    order.sort((a, b) => Math.hypot((a.tx + 0.5) * TILE - px, (a.tz + 0.5) * TILE - pz) - Math.hypot((b.tx + 0.5) * TILE - px, (b.tz + 0.5) * TILE - pz))
    for (const t of order) {
      if (budget-- <= 0) break
      if (buildTile(t)) pending--
    }
    let maxSlot = -1
    for (const t of tiles.values()) if (t.slot > maxSlot) maxSlot = t.slot
    state.geometry.instanceCount = (maxSlot + 1) * PER_TILE
    if (salt === 0) {
      grassStats.tiles = tiles.size
      grassStats.pendingTiles = pending
    }
  })

  const clearSlot = (slot: number): void => {
    const a = state.iPos.array as Float32Array
    const start = slot * PER_TILE
    for (let i = 0; i < PER_TILE; i++) a[(start + i) * 4 + 3] = 0
    state.iPos.addUpdateRange(start * 4, PER_TILE * 4)
    state.iPos.needsUpdate = true
  }

  const buildTile = (t: Tile): boolean => {
    const streamer = worldStreamRT.streamer
    if (!streamer) return false
    const ox = t.tx * TILE
    const oz = t.tz * TILE
    const chunk = streamer.getChunkAt(ox + TILE / 2, oz + TILE / 2)
    const payload = chunk?.payload
    if (!payload) return false
    const cox = chunk!.cx * CHUNK_SIZE
    const coz = chunk!.cz * CHUNK_SIZE
    const P = state.iPos.array as Float32Array
    const D = state.iData.array as Float32Array
    const C = state.iColor.array as Float32Array
    const start = t.slot * PER_TILE
    const surface = hubSurface()
    // the biome's flower density at the tile (biomes change over ~100 m) for
    // the blossoms in the sward; home keeps its own authored flowers
    biomeWeights(ox + TILE / 2, oz + TILE / 2, flowerScratch)
    let flowers = 0
    for (let q = 0; q < BIOME_COUNT; q++) flowers += FLOWER_DENSITY[q] * flowerScratch[q]
    flowers *= Math.max(0, Math.min(1, (Math.hypot(ox + TILE / 2 - HUB_CENTER.x, oz + TILE / 2 - HUB_CENTER.z) - 40) / 20))
    const side = Math.sqrt(PER_TILE)
    const cell = TILE / side
    let count = 0
    for (let j = 0; j < side; j++) {
      for (let i = 0; i < side; i++) {
        const gx = t.tx * side + i
        const gz = t.tz * side + j
        const x = (gx + hash01(WORLD_SEED ^ (0x601 + salt * 16), gx, gz)) * cell
        const z = (gz + hash01(WORLD_SEED ^ (0x602 + salt * 16), gx, gz)) * cell
        const lx = (x - cox) / FIELD_STEP
        const lz = (z - coz) / FIELD_STEP
        const ix = Math.min(FIELD_RES - 1, Math.max(0, Math.floor(lx)))
        const iz = Math.min(FIELD_RES - 1, Math.max(0, Math.floor(lz)))
        const u = Math.min(1, Math.max(0, lx - ix))
        const v = Math.min(1, Math.max(0, lz - iz))
        const k = iz * FIELD_N + ix
        let density = (payload.aux[k * 4 + 3] * (1 - u) * (1 - v) + payload.aux[(k + 1) * 4 + 3] * u * (1 - v) + payload.aux[(k + FIELD_N) * 4 + 3] * (1 - u) * v + payload.aux[(k + FIELD_N + 1) * 4 + 3] * u * v) / 255
        // at home: the authored surface map keeps paths, plazas and water clear
        const hd = Math.hypot(x - HUB_CENTER.x, z - HUB_CENTER.z)
        if (surface && hd < 46) {
          const sx = Math.floor(((x - GROUND_BOUNDS.x) / GROUND_BOUNDS.width) * SURFACE_RESOLUTION)
          const sz = Math.floor(((z - GROUND_BOUNDS.z) / GROUND_BOUNDS.depth) * SURFACE_RESOLUTION)
          if (sx >= 0 && sz >= 0 && sx < SURFACE_RESOLUTION && sz < SURFACE_RESOLUTION) {
            const hubGrass = surface[(sz * SURFACE_RESOLUTION + sx) * 4 + 3] / 255
            const w = 1 - Math.max(0, Math.min(1, (hd - 34) / 12))
            density = density * (1 - w) + hubGrass * 1.1 * w
          }
        }
        const r = hash01(WORLD_SEED ^ 0x603, gx, gz)
        if (r > density) continue
        const h00 = payload.heights[k], h10 = payload.heights[k + 1], h01 = payload.heights[k + FIELD_N], h11 = payload.heights[k + FIELD_N + 1]
        const y = u + v <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v)
        const o = start + count
        const variation = hash01(WORLD_SEED ^ 0x604, gx, gz)
        P[o * 4] = x - originRT.x
        P[o * 4 + 1] = y - 0.02
        P[o * 4 + 2] = z - originRT.z
        P[o * 4 + 3] = (0.2 + variation ** 1.5 * 0.26) * (0.55 + density * 0.55)
        D[o * 4] = hash01(WORLD_SEED ^ 0x605, gx, gz) * Math.PI * 2
        D[o * 4 + 1] = 0.85 + hash01(WORLD_SEED ^ 0x606, gx, gz) * 0.5
        D[o * 4 + 2] = variation
        D[o * 4 + 3] = flowers
        const ck = (Math.round(lz) * FIELD_N + Math.round(lx)) * 4
        const lift = 0.92 + variation * 0.25
        // living blades are slightly greener than the soil-mixed ground colour
        C[o * 3] = (payload.colors[ck] / 255) * lift * 0.9
        C[o * 3 + 1] = (payload.colors[ck + 1] / 255) * lift * 1.04
        C[o * 3 + 2] = (payload.colors[ck + 2] / 255) * lift * 0.82
        count++
      }
    }
    for (let i = count; i < PER_TILE; i++) P[(start + i) * 4 + 3] = 0
    for (const attr of [state.iPos, state.iData]) {
      attr.addUpdateRange(start * 4, PER_TILE * 4)
      attr.needsUpdate = true
    }
    state.iColor.addUpdateRange(start * 3, PER_TILE * 3)
    state.iColor.needsUpdate = true
    t.built = true
    return true
  }

  return <primitive object={state.mesh} />
}
