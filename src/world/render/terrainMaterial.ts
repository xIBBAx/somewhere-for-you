import * as THREE from "three"
import { groundCommon, groundResources } from "../../game/environment/ground/groundMaterial"
import { WORLD_NOISE_GLSL, originUniforms } from "../origin"
import { HUB_CENTER } from "../hubLayout"
import { surfaceWaterShader } from "./surfaceWaterShader"
import { MORPH_BAND } from "./terrainGeometry"
import { vegetationUniforms } from "./vegetationMaterials"
import { TERRAIN_TEXTURE_GLSL, loadTerrainTextures, terrainTextureUniforms } from "./terrainTextures"

/**
 * One material for every streamed terrain chunk.
 *
 *  - Wild terrain: per-vertex biome albedo + detail masks from the chunk
 *    worker, layered with 1024 m-periodic macro/meso/micro variation,
 *    litter speckles (petals, autumn leaves, needles), slope soil, shore sand
 *    and weather wetness.
 *  - Home region: the original authored ground (path, banks, footprint wear,
 *    surface field textures) blended in with a soft radial mask, so the
 *    home region flows seamlessly into the endless landscape.
 */
let shared: THREE.MeshStandardMaterial | null = null

export const terrainMaterial = (): THREE.MeshStandardMaterial => {
  if (shared) return shared
  const resources = groundResources()
  const material = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, color: "white", vertexColors: false })
  void loadTerrainTextures()
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, terrainTextureUniforms, {
      gSurface: resources.surface,
      gHistory: resources.history,
      gWetness: resources.wetness,
      gSnow: resources.snow,
      gSurfaceWater: resources.surfaceWater,
      gRain: resources.rain,
      gTime: resources.time,
      gSkyColor: resources.skyColor,
      uOrigin: originUniforms.uOrigin,
      uOriginWrap: originUniforms.uOriginWrap,
      uPlayerRender: vegetationUniforms.uPlayerRender,
    })
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec4 color;
attribute vec4 aux;
attribute vec2 aMorph;
attribute vec4 aCoarseColor;
attribute vec4 aCoarseAux;
uniform vec3 uOrigin;
uniform vec3 uPlayerRender;
varying vec3 gWorld;
varying vec3 tRender;
varying vec3 tNormalW;
varying vec4 tColor;
varying vec4 tAux;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
// geomorph toward the next coarser LOD with distance (terrainGeometry.ts)
float tMorphW = smoothstep(aMorph.y - ${MORPH_BAND.toFixed(1)}, aMorph.y, length((modelMatrix * vec4(position, 1.0)).xz - uPlayerRender.xz));
transformed.y += aMorph.x * tMorphW;`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
tRender = (modelMatrix * vec4(transformed, 1.0)).xyz;
gWorld = tRender + uOrigin;
tNormalW = normalize(mat3(modelMatrix) * objectNormal);
tColor = mix(color, aCoarseColor, tMorphW);
tAux = mix(aux, aCoarseAux, tMorphW);`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
${groundCommon}
${surfaceWaterShader}
uniform float gSnow;
${WORLD_NOISE_GLSL}
${TERRAIN_TEXTURE_GLSL}
varying vec3 tRender;
varying vec3 tNormalW;
varying vec4 tColor;
varying vec4 tAux;
const vec2 HUB_C = vec2(${HUB_CENTER.x.toFixed(1)}, ${HUB_CENTER.z.toFixed(1)});
`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
vec2 rp = tRender.xz;
float macro = wNoise(rp, 9.0) * 0.6 + wNoise(rp, 27.0) * 0.4;
float meso = wNoise(rp, 280.0);
float micro = wNoise(rp, 9000.0);
float aaMicro = 1.0 - smoothstep(0.35, 1.4, length(fwidth(rp * 9.0)));
vec3 col = tColor.rgb;
col *= 0.9 + macro * 0.2;
col *= 1.0 + (meso - 0.5) * 0.16;
col *= 1.0 + (micro - 0.5) * 0.2 * aaMicro;
// clover-dark / sun-bleached blades at a mid scale reads as grass from afar
float tuft = wNoise(rp, 1600.0);
float grassCover = tAux.a;
col = mix(col, col * meadowHue(rp), grassCover);
// under a sward the soil reads as deep blade shadow with sunlit flecks
float sward = wNoise(rp, 14000.0) * 0.55 + wNoise(rp, 5200.0) * 0.45;
col *= mix(1.0, 0.72 + sward * 0.5, grassCover * aaMicro * 0.8);
col = mix(col, col * vec3(0.78, 0.86, 0.72), smoothstep(0.55, 0.9, tuft) * grassCover * 0.5);
col = mix(col, col * vec3(1.12, 1.08, 0.86), smoothstep(0.6, 0.95, 1.0 - tuft) * grassCover * 0.35);
// litter speckles: 1 petals, 2 leaves, 3 needles (type in the high bits)
float litterCode = tAux.b * 255.0;
float litterType = floor(litterCode / 60.0);
float litterAmt = (litterCode - litterType * 60.0) / 59.0;
float speck = wNoise(rp, 11000.0) * 0.6 + wNoise(rp, 4100.0) * 0.25 + wNoise(rp, 900.0) * 0.15;
float litterVis = smoothstep(0.66, 0.74, speck) * smoothstep(0.35, 0.8, litterAmt) * (1.0 - smoothstep(0.6, 1.6, length(fwidth(rp * 5.0))) * 0.5);
vec3 litterCol = litterType < 1.5 ? vec3(0.78, 0.46, 0.56) : litterType < 2.5 ? mix(vec3(0.55, 0.2, 0.05), vec3(0.62, 0.42, 0.08), wNoise(rp, 700.0)) : vec3(0.26, 0.17, 0.09);
if (litterType > 0.5) col = mix(col, litterCol, litterVis * (litterType < 1.5 ? 0.45 : 0.7));
// photographic layer weights for the wilds (see terrainTextures.ts)
vec3 geoN = normalize(tNormalW);
float rockW = smoothstep(0.2, 0.4, 1.0 - geoN.y);
float sandW = tAux.g * (1.0 - rockW);
float restW = max(1.0 - rockW - sandW, 0.0);
float leafLitter = (litterType > 1.5 && litterType < 2.5) ? smoothstep(0.2, 0.8, litterAmt) : 0.0;
float grassW = restW * grassCover;
float bareW = restW - grassW;
float leafW = bareW * leafLitter * 0.85 + grassW * leafLitter * 0.3;
bareW -= bareW * leafLitter * 0.85;
grassW -= grassW * leafLitter * 0.3;
// sun-dried patches follow the procedural tone drift and warm biome tints
float dryness = clamp(smoothstep(0.5, 0.85, tuft * 0.55 + meso * 0.45) * 0.55 + smoothstep(0.0, 0.12, tColor.r - tColor.g * 0.75) * 0.6, 0.0, 0.85);
vec4 tw0 = vec4(grassW * (1.0 - dryness), grassW * dryness, bareW, leafW);
vec3 tw1 = vec3(rockW, sandW, 0.0);
// home region: authored ground
float hub = 1.0 - smoothstep(34.0, 46.0, length(gWorld.xz - HUB_C));
vec4 field = vec4(0.0);
vec4 traffic = vec4(0.0);
if (hub > 0.001) {
  field = texture2D(gSurface, groundUV(gWorld.xz));
  traffic = texture2D(gHistory, groundUV(gWorld.xz));
  col = mix(col, groundColor(gWorld, field, traffic), hub);
  float hubWorn = smoothstep(0.22, 0.78, traffic.g);
  float hubPath = max(field.g, hubWorn) * (1.0 - field.r);
  float hubSand = field.r;
  float hubGrass = max(1.0 - hubPath - hubSand, 0.0);
  tw0 = mix(tw0, vec4(hubGrass * 0.85, hubGrass * 0.15, hubPath * 0.25, 0.0), hub);
  tw1 = mix(tw1, vec3(0.0, hubSand, hubPath * 0.75), hub);
}
float tRough = 0.92;
vec3 tNTS = vec3(0.0, 0.0, 1.0);
if (tReady > 0.5) {
  vec2 tp = tRender.xz + uOriginWrap;
  float tMix = smoothstep(0.3, 0.7, wNoise(tRender.xz, 16.0) * 0.7 + wNoise(tRender.xz, 211.0) * 0.3);
  tTriPos = vec3(tp.x, tRender.y, tp.y);
  tTriN = geoN;
  TLayerOut tl = tLayers(tp, tMix, tw0, tw1);
  // keep each biome's hue: the scan supplies detail, the climate its colour
  vec3 tint = clamp(col / max(tl.mean, vec3(0.004)), vec3(0.35), vec3(2.6));
  // bare rock keeps more of its own grey: a cliff is not grass-coloured
  col = tl.albedo * mix(vec3(1.0), tint, 0.6 - 0.35 * tw1.x);
  tRough = tl.rough;
  tNTS = tl.nTS;
}
// weather wetness darkens soil and sand more than grass
float shoreWet = tColor.a;
float bare = max(tAux.r, tAux.g);
float exposure = rainExposure(gWorld);
float wet = clamp(max(shoreWet, gWetness * exposure * (0.45 + bare * 0.55)), 0.0, 1.0);
// wet ground deepens and gains chroma instead of only going dark
float wetAmt = wet * (0.35 + bare * 0.65);
col = mix(col, pow(col, vec3(1.18)) * 0.92, wetAmt);
// Retained water occupies irregular shallow depressions. Slopes drain, sandy
// substrate absorbs more, and grass remains visible above a thin water film.
vec3 surfaceN = normalize(cross(dFdx(tRender), dFdy(tRender)));
float poolingFlatness = smoothstep(0.965, 0.998, abs(surfaceN.y));
float basin = gNoise(gWorld.xz * 0.62) * 0.7 + gNoise(gWorld.xz * 1.8) * 0.3;
float fill = gSurfaceWater * (0.58 - tAux.g * 0.18);
float puddle = (1.0 - smoothstep(fill - 0.025, fill + 0.025, basin)) * poolingFlatness * exposure;
col *= 1.0 - puddle * 0.16;
// a first snow: it lies on open, level ground in drifts, thin under shelter and gone on rock faces
if (gSnow > 0.001) {
  float drift = gNoise(gWorld.xz * 0.35) * 0.6 + gNoise(gWorld.xz * 2.7) * 0.4;
  float lie = smoothstep(0.72, 0.9, geoN.y) * exposure * smoothstep(1.0 - gSnow * 1.25, 1.12 - gSnow * 1.25, drift);
  vec3 snowCol = vec3(0.86, 0.89, 0.94) * (0.94 + gNoise(gWorld.xz * 31.0) * 0.08);
  col = mix(col, snowCol, lie * 0.92);
  puddle *= 1.0 - lie;
}
diffuseColor.rgb = col;
`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
roughnessFactor = mix(clamp(mix(0.95, tRough, tReady) - wet * 0.38 - tAux.g * 0.05, 0.45, 0.99), 0.1 + gRain * 0.12, puddle);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
if (tReady > 0.5) normal = normalize((viewMatrix * vec4(tWorldNormal(tNTS, geoN, 1.0), 0.0)).xyz);
float reliefH = (micro - 0.5) * 0.0022 * aaMicro + (meso - 0.5) * 0.004;
if (hub > 0.001) reliefH = mix(reliefH, groundRelief(gWorld, field, traffic.r * 0.5), hub);
normal = normalize(mix(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), puddle));
normal = groundBump(normal, reliefH * (1.0 - puddle) + puddleRipple(gWorld.xz) * puddle);`,
      )
      .replace("#include <opaque_fragment>", `
float waterFresnel = 0.02 + 0.98 * pow(1.0 - max(dot(normal, normalize(vViewPosition)), 0.0), 5.0);
outgoingLight = mix(outgoingLight, gSkyColor, puddle * waterFresnel);
#include <opaque_fragment>`)
  }
  material.customProgramCacheKey = () => "streamed-terrain-v5-rock-sides"
  shared = material
  return material
}

/** Shadow geometry must follow the same morph as the visible terrain. */
let depth: THREE.MeshDepthMaterial | null = null
export const terrainDepthMaterial = (): THREE.MeshDepthMaterial => {
  if (depth) return depth
  depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  depth.onBeforeCompile = shader => {
    shader.uniforms.uPlayerRender = vegetationUniforms.uPlayerRender
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 aMorph;\nuniform vec3 uPlayerRender;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
float weight = smoothstep(aMorph.y - ${MORPH_BAND.toFixed(1)}, aMorph.y, length((modelMatrix * vec4(position, 1.0)).xz - uPlayerRender.xz));
transformed.y += aMorph.x * weight;`)
  }
  depth.customProgramCacheKey = () => "terrain-morph-depth-v1"
  return depth
}
