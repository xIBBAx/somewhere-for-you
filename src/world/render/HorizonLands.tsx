import { highvaleHole } from "../highvale/render/highvaleClarity"
import { HIGHVALE_CENTER } from "../highvale/highvaleLayout"
import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { avatarRT } from "../../game/runtime"
import { spaceRT } from "../../game/celestial/spaceState"
import { DATUM_Y, EARTH_R } from "../../game/celestial/scale"
import { GAME_TO_ECEF } from "../../game/celestial/universe"
import { EARTH_UV_GLSL, earthCloudShift, earthTexture } from "../../game/celestial/render/earthMaps"
import { LANDS_RINGS, LANDS_SEGMENTS, landsCentre, type HorizonLandsData } from "../horizonLands"
import type { LandsRequest } from "../horizonLands.worker"
import { WORLD_NOISE_GLSL, originUniforms } from "../origin"
import { AERIAL_LOOK_GLSL } from "./aerialLook"

/**
 * The world from high in the sky, out to and over the horizon
 * (horizonLands.ts). Hidden near the ground, where the haze ends the view
 * long before it; shown once you climb past the clouds; dissolved (dithered,
 * so it never blends through itself) as Earth's own globe takes over from
 * orbit.
 */

export const landsRT = { builds: 0, lastMs: 0, cx: Number.NaN, cz: Number.NaN, visible: false }

const SHOW_FROM = 70
const FADE_FROM = 6_500
const FADE_TO = 14_000

const material = (): THREE.MeshStandardMaterial => {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 })
  // the ground world dissolves into these lands from high up (aerialFog.ts)
  m.defines = { AERIAL_KEEP: "" }
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uOriginWrap: originUniforms.uOriginWrap, uOrigin: originUniforms.uOrigin, uKeep: landsUniforms.uKeep,
      uEarthDay: landsUniforms.uEarthDay, uEarthWater: landsUniforms.uEarthWater, uToEcef: { value: GAME_TO_ECEF }, uRadius: { value: EARTH_R }, uDatum: { value: DATUM_Y },
      uEarthClouds: landsUniforms.uEarthClouds, uCloudShift: earthCloudShift, uOrbitW: landsUniforms.uOrbitW,
      uHighvaleHole: highvaleHole,
    })
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
attribute vec2 aKind;
varying vec2 vKind;
varying vec3 vLandsWorld;
varying vec2 vEarthUv;
varying float vEarthW;
uniform vec3 uOrigin;
uniform mat3 uToEcef;
uniform float uRadius;
uniform float uDatum;
uniform sampler2D uEarthWater;
${EARTH_UV_GLSL}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
  // far from home the land becomes the real Earth under it (Blue Marble),
  // the same planet seen from orbit: its seas lie flat at sea level
  vec3 landsLogical = (modelMatrix * vec4(transformed, 1.0)).xyz + uOrigin;
  vEarthUv = earthUv(landsLogical.xz, uToEcef, uRadius);
  vEarthW = smoothstep(3000.0, 18000.0, length(landsLogical.xz));
  float sea = texture2D(uEarthWater, vEarthUv).r * vEarthW;
  float across = length(transformed.xz);
  float drop = uRadius * (1.0 - cos(asin(min(across / uRadius, 1.0))));
  transformed.y = mix(transformed.y, uDatum - drop - 1.0, smoothstep(0.35, 0.65, sea));`)
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvKind = aKind;\nvLandsWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;")
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${WORLD_NOISE_GLSL}\n${AERIAL_LOOK_GLSL}\nuniform vec3 uOrigin;\nuniform float uHighvaleHole;\nuniform float uKeep;\nuniform sampler2D uEarthDay;\nuniform sampler2D uEarthWater;\nuniform sampler2D uEarthClouds;\nuniform float uCloudShift;\nuniform float uOrbitW;\nvarying vec2 vKind;\nvarying vec3 vLandsWorld;\nvarying vec2 vEarthUv;\nvarying float vEarthW;`)
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
  // dissolve as the globe takes over, without self-blending
  if (uKeep < 0.999 && uKeep < fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))))) discard;
  // Highvale's massif is drawn by its own range (world/highvale/render/HighvaleRange.tsx)
  if (uHighvaleHole > 0.5) {
    vec3 lg = vLandsWorld + uOrigin;
    if (length(vec2((lg.x - ${HIGHVALE_CENTER.x.toFixed(1)}) * 0.95, (${HIGHVALE_CENTER.z.toFixed(1)} - lg.z) - 300.0)) < 7600.0) discard;
  }`)
      .replace("#include <color_fragment>", `#include <color_fragment>
  // woods mottle gently; far out the colours are Earth's own
  float crowns = wNoise(vLandsWorld.xz, 140.0) * 0.6 + wNoise(vLandsWorld.xz, 520.0) * 0.4;
  diffuseColor.rgb *= mix(1.0, 0.78 + crowns * 0.4, vKind.x);
  vec3 earthDay = pow(texture2D(uEarthDay, vEarthUv).rgb, vec3(2.2));
  // climbing out of the air, all of it becomes the real Earth under you
  // (uOrbitW, by the camera's height: the same planet the globe and the
  // opening film show), not only the far lands
  float earthW = max(vEarthW, uOrbitW);
  diffuseColor.rgb = mix(diffuseColor.rgb, earthDay * 1.1, earthW);
  // (haze and the muting of far colour: the shared aerial fog, aerialFog.ts)
  // the game's own ponds and lakes, cleanly shored; where the land has become
  // Earth's maps they are gone (its seas come from the water map below)
  float landsPond = aerialShore(vKind.y, vLandsWorld.xz, 3.0) * (1.0 - earthW);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.1, 0.14), landsPond);
  // and its clouds, drifting with the globe's (bright: albedo 0.5-0.9)
  float landsCloud = smoothstep(0.08, 0.9, texture2D(uEarthClouds, vEarthUv + vec2(uCloudShift, 0.0)).r) * uOrbitW;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9), landsCloud * 0.95);`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.1, landsPond);
// open sea from orbit: a soft sheen of sunglint, never under cloud
float landsSea = texture2D(uEarthWater, vEarthUv).r * uOrbitW * (1.0 - landsCloud);
roughnessFactor = mix(roughnessFactor, 0.32, landsSea);`)
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>
  // Never hand the composer an overflow. Under 4x MSAA, edge samples on these
  // long grazing triangles shade with extrapolated inputs, and a few pixels
  // came out past half-float range (+-Inf in red, the sun's warmest channel);
  // the bloom spread them into whole black frames in a fast dive at ~400 m.
  // Non-finite values are caught by their bits (ANGLE may fold isnan away),
  // and far terrain is never brighter than this in linear HDR anyway.
  uvec3 landsBits = floatBitsToUint(gl_FragColor.rgb) & 0x7f800000u;
  if (any(equal(landsBits, uvec3(0x7f800000u)))) gl_FragColor.rgb = vec3(0.0);
  gl_FragColor.rgb = clamp(gl_FragColor.rgb, 0.0, 64.0);`)
  }
  m.customProgramCacheKey = () => "horizon-lands-v8"
  return m
}

const landsUniforms = {
  uKeep: { value: 1 },
  uEarthDay: { value: null as THREE.Texture | null },
  uEarthWater: { value: null as THREE.Texture | null },
  uEarthClouds: { value: null as THREE.Texture | null },
  /** 0..1 how far the lands have become Earth's own maps, by the camera's height */
  uOrbitW: { value: 0 },
}

const makeIndex = (): THREE.BufferAttribute => {
  const R = LANDS_RINGS, S = LANDS_SEGMENTS
  const index = new Uint32Array((R - 1) * S * 6)
  let o = 0
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < S; j++) {
    const a = i * S + j, b = i * S + ((j + 1) % S), c = a + S, d = b + S
    index[o++] = a; index[o++] = b; index[o++] = c
    index[o++] = b; index[o++] = d; index[o++] = c
  }
  return new THREE.BufferAttribute(index, 1)
}

export const HorizonLands = (): React.ReactElement => {
  const sys = useMemo(() => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material())
    mesh.name = "horizon-lands"
    mesh.visible = false
    mesh.matrixAutoUpdate = false
    mesh.frustumCulled = false
    mesh.receiveShadow = false
    mesh.castShadow = false
    // under the far terrain, which is under the chunks
    mesh.renderOrder = -1.5
    return { mesh, index: makeIndex(), worker: null as Worker | null, pending: 0, sent: 0, nextId: 1, cx: Number.NaN, cz: Number.NaN }
  }, [])

  useEffect(() => {
    landsUniforms.uEarthDay.value = earthTexture("day")
    landsUniforms.uEarthWater.value = earthTexture("water")
    landsUniforms.uEarthClouds.value = earthTexture("clouds")
    const worker = new Worker(new URL("../horizonLands.worker.ts", import.meta.url), { type: "module" })
    sys.worker = worker
    worker.onmessage = (event: MessageEvent<{ id: number; data?: HorizonLandsData; error?: string }>) => {
      const { id, data, error } = event.data
      if (id !== sys.pending) return
      sys.pending = 0
      if (!data) { console.warn("[world] horizon lands failed", error); return }
      const g = new THREE.BufferGeometry()
      g.setAttribute("position", new THREE.BufferAttribute(data.positions, 3))
      g.setAttribute("color", new THREE.BufferAttribute(data.colors, 3))
      g.setAttribute("aKind", new THREE.BufferAttribute(data.kinds, 2))
      g.setIndex(sys.index)
      g.computeVertexNormals()
      const old = sys.mesh.geometry
      sys.mesh.geometry = g
      old.dispose()
      sys.mesh.position.set(data.cx, 0, data.cz)
      sys.mesh.updateMatrix()
      sys.cx = data.cx; sys.cz = data.cz
      landsRT.cx = data.cx; landsRT.cz = data.cz
      landsRT.builds++
      landsRT.lastMs = performance.now() - sys.sent
    }
    return () => {
      worker.terminate()
      sys.worker = null
      sys.mesh.geometry.dispose()
      ;(sys.mesh.material as THREE.Material).dispose()
    }
  }, [sys])

  useFrame(() => {
    const earthLocal = spaceRT.realm === "earth" && spaceRT.mode === "local"
    const alt = earthLocal ? spaceRT.skyAltitude : -1
    const wanted = alt > SHOW_FROM && alt < FADE_TO
    landsUniforms.uKeep.value = 1 - THREE.MathUtils.smoothstep(alt, FADE_FROM, FADE_TO)
    // ~64 to ~180 km: the biome palette below hands over to Earth's own colours and clouds
    landsUniforms.uOrbitW.value = THREE.MathUtils.smoothstep(alt, 1000, 2800)
    sys.mesh.visible = wanted && Number.isFinite(sys.cx)
    landsRT.visible = sys.mesh.visible
    // Prepare the hidden horizon while walking and during the opening film.
    // Waiting for SHOW_FROM exposes the far terrain's square outer edge during
    // the first worker build after a fast takeoff or return to Earth. The
    // snapped cache and one in-flight request bound the work on the ground too.
    if (!earthLocal || !sys.worker || sys.pending) return
    const p = avatarRT().pos
    const cx = landsCentre(p.x), cz = landsCentre(p.z)
    if (cx === sys.cx && cz === sys.cz) return
    const request: LandsRequest = { id: sys.nextId++, cx, cz, radius: EARTH_R }
    sys.pending = request.id
    sys.sent = performance.now()
    sys.worker.postMessage(request)
  })

  return <primitive object={sys.mesh} />
}
