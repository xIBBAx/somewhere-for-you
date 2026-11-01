import * as THREE from "three"
import { WORLD_NOISE_GLSL, originUniforms } from "../origin"
import { WIND_GLSL, windUniforms } from "../wind"

/**
 * Materials for batched vegetation. All share the world wind; vertex colour
 * alpha carries the per-vertex wind weight authored in Blender.
 *
 *  bark    – vertex-coloured, procedural bark grain + birch lenticels
 *  foliage – atlas leaf cards, alpha-to-coverage, soft translucency
 *  props   – rocks, flowers, reeds, mushrooms (glow when tinted magical)
 */

export const vegetationUniforms = {
  /** 0 day … 1 night: night dims foliage glow and wakes up magical props */
  uNight: { value: 0 },
  /** soft forward-scattering through leaves */
  uLeafGlow: { value: 0.12 },
  uWetness: { value: 0 },
  /** player's chest in render space, for see-through occlusion fading */
  uPlayerRender: { value: new THREE.Vector3(0, -1000, 0) },
  /** photographed bark detail: R luminance, G cavity AO, B moss (bark_brown_02, CC0) */
  uBarkTex: { value: null as THREE.Texture | null },
  uBarkReady: { value: 0 },
}

export const setBarkDetail = (texture: THREE.Texture): void => {
  vegetationUniforms.uBarkTex.value = texture
  vegetationUniforms.uBarkReady.value = 1
}

/**
 * Dithered fade of vegetation that is very close to the camera or sits
 * between the camera and the explorer, so canopies never swallow the view. Written
 * against vVegWorld and uPlayerRender; the hub's hand-placed trees
 * (game/environment/trees/vegetationShaders.ts) share it.
 */
export const VEG_OCCLUSION_CLIP_GLSL = /* glsl */ `
float vegBayer(vec2 p) {
  // Stable screen-space noise avoids a visible repeating checkerboard.
  return fract(52.9829189 * fract(dot(floor(p), vec2(0.06711056, 0.00583715))));
}
void vegOcclusionClip() {
  float camD = distance(vVegWorld, cameraPosition);
  // a crown right in front of the lens is never worth its screen space
#ifdef VEG_WIDE_NEAR_FADE
  float keep = smoothstep(3.0, 4.8, camD);
#else
  float keep = smoothstep(1.6, 1.85, camD);
#endif
  vec3 seg = uPlayerRender - cameraPosition;
  float len = max(length(seg), 1e-3);
  float t = dot(vVegWorld - cameraPosition, seg) / (len * len);
  // Clear the view all the way to her shoulders, including a canopy touching
  // the explorer. Leave scenery behind them intact. The narrow edge avoids a screen
  // full of semitransparent leaves when the camera is inside a crown.
  if (t > 0.0 && t < 1.025) {
    float dLine = distance(vVegWorld, cameraPosition + seg * t);
#ifdef VEG_WIDE_NEAR_FADE
    float radius = mix(1.1, 0.78, clamp(t, 0.0, 1.0));
#else
    // trunks only clear when squarely between lens and the explorer
    float radius = mix(0.55, 0.3, clamp(t, 0.0, 1.0));
#endif
    keep = min(keep, smoothstep(radius, radius + 0.18, dLine));
  }
  if (keep < 0.999 && keep < vegBayer(gl_FragCoord.xy)) discard;
}
`

const OCCLUSION_GLSL = /* glsl */ `
uniform vec3 uPlayerRender;
varying vec3 vVegWorld;
${VEG_OCCLUSION_CLIP_GLSL}
`

type Kind = "bark" | "foliage" | "props"

const VERTEX_COMMON = /* glsl */ `
${WORLD_NOISE_GLSL}
${WIND_GLSL}
varying float vWindW;
`

/**
 * Wind injection after begin_vertex. Works for BatchedMesh, InstancedMesh and
 * plain meshes. `strength` scales displacement per material kind.
 */
const windVertex = (strength: number, stiff: number): string => /* glsl */ `
#ifdef USE_BATCHING
  mat4 vegInstance = batchingMatrix;
#elif defined(USE_INSTANCING)
  mat4 vegInstance = instanceMatrix;
#else
  mat4 vegInstance = mat4(1.0);
#endif
  vec3 vegRoot = (modelMatrix * vegInstance[3]).xyz;
  float vegScale = length(vegInstance[0].xyz);
  float vegPhase = wHash(floor(vegRoot.xz * 3.1 + uOriginWrap * 3.1)) * 6.2831;
  #ifdef USE_COLOR_ALPHA
    float vegW = color.a;
  #else
    float vegW = clamp(position.y / 4.0, 0.0, 1.0);
  #endif
  vWindW = vegW;
  vec2 bend = windBend(vegRoot.xz, vegPhase) * ${strength.toFixed(3)};
  // stiffness: height-squared response so roots stay planted
  float hNorm = max(0.0, position.y) * vegScale;
  float resp = vegW * (${stiff.toFixed(3)} + hNorm * 0.06);
  vec3 axisX = normalize(vegInstance[0].xyz);
  vec3 axisZ = normalize(vegInstance[2].xyz);
  vec2 local = vec2(dot(vec3(bend.x, 0.0, bend.y), axisX), dot(vec3(bend.x, 0.0, bend.y), axisZ)) / max(vegScale, 0.001);
  transformed.x += local.x * resp;
  transformed.z += local.y * resp;
  transformed.y -= (abs(local.x) + abs(local.y)) * resp * 0.18;
`

const patchVertex = (shader: THREE.WebGLProgramParametersWithUniforms, kind: Kind): void => {
  Object.assign(shader.uniforms, windUniforms, { uOriginWrap: originUniforms.uOriginWrap })
  const strength = kind === "foliage" ? 0.55 : kind === "bark" ? 0.22 : 0.5
  const stiff = kind === "bark" ? 0.05 : kind === "foliage" ? 0.35 : 0.6
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${VERTEX_COMMON}\nvarying vec3 vVegWorld;`)
    .replace("#include <begin_vertex>", `#include <begin_vertex>\n${windVertex(strength, stiff)}`)
    .replace("#include <worldpos_vertex>", `#include <worldpos_vertex>\nvVegWorld = (modelMatrix * vegInstance * vec4(transformed, 1.0)).xyz;`)
}

const materials = new Map<string, THREE.Material>()

const barkVariant = (log: boolean): THREE.MeshStandardMaterial => {
  const key = log ? "log" : "bark"
  const cached = materials.get(key)
  if (cached) return cached as THREE.MeshStandardMaterial
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 })
  m.onBeforeCompile = (shader) => {
    patchVertex(shader, "bark")
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vBarkLocal;\nvarying vec3 vBarkNormal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBarkLocal = position;\nvBarkNormal = normal;")
    Object.assign(shader.uniforms, vegetationUniforms, { uOriginWrap: originUniforms.uOriginWrap })
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${log ? "#define BARK_LOG" : ""}\n${WORLD_NOISE_GLSL}\n${OCCLUSION_GLSL}\nuniform float uWetness;\nuniform sampler2D uBarkTex;\nuniform float uBarkReady;\nvarying vec3 vBarkLocal;\nvarying vec3 vBarkNormal;\nfloat barkRelief = 0.0;`)
      .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\n  vegOcclusionClip();")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
  float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  float grain = wNoise(vVegWorld.xz + vec2(vVegWorld.y * 0.15), 2400.0) * 0.6 + wNoise(vec2(vVegWorld.x + vVegWorld.z, vVegWorld.y * 0.25), 900.0) * 0.4;
  diffuseColor.rgb *= 0.82 + grain * 0.32;
  // Bark in the mesh's own frame: angle around the stem axis maps onto one
  // full noise period (no seam), length runs along it, so fissures always
  // follow the wood whether the stem stands or lies.
#ifdef BARK_LOG
  vec3 bl = vBarkLocal.yxz;
  float endCap = smoothstep(0.9, 0.97, abs(normalize(vBarkNormal).x));
#else
  vec3 bl = vBarkLocal.xyz;
  float endCap = 0.0;
#endif
  float ang = atan(bl.z, bl.x) / 6.2831853 + 0.5;
  vec2 barkP = vec2(ang * 1024.0, bl.y * 1024.0 * 3.6 / 38.0);
  float barkAA = 1.0 - smoothstep(0.35, 1.1, length(fwidth(barkP)) * 38.0 / 1024.0);
  float ridge = abs(wNoise(barkP, 38.0) * 2.0 - 1.0);
  float ridge2 = abs(wNoise(barkP * vec2(1.0, 1.0) + 173.0, 76.0) * 2.0 - 1.0);
  float fissure = smoothstep(0.0, 0.22, ridge) * mix(1.0, smoothstep(0.0, 0.3, ridge2), 0.5);
  float plates = wNoise(barkP, 13.0);
  barkRelief = (fissure * 0.7 + plates * 0.3) * barkAA + (1.0 - barkAA) * 0.7;
  // photographed bark replaces the procedural fissures once it has loaded
  vec3 barkScan = texture2D(uBarkTex, vec2(ang * 3.0, bl.y / 1.6)).rgb;
  float scanOn = uBarkReady * (1.0 - endCap);
  diffuseColor.rgb *= mix(1.0, 0.45 + barkRelief * 0.7, barkAA * (1.0 - endCap) * (1.0 - uBarkReady));
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.2 + barkScan.r * 1.6) * (0.6 + 0.4 * barkScan.g), scanOn);
  // moss gathers on darker, rougher trunks (birch stays clean)
  float mossy = barkScan.b * scanOn * (1.0 - smoothstep(0.45, 0.62, lum)) * 0.85;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.17, 0.06) * (0.6 + barkScan.r), mossy);
  barkRelief = mix(barkRelief, barkScan.r * 0.6 + barkScan.g * 0.4, scanOn);
  // sawn or broken end: pale heartwood with growth rings
  float rings = sin(length(vBarkLocal.yz) * 140.0 + wNoise(vBarkLocal.yz * 300.0, 64.0) * 3.0) * 0.5 + 0.5;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.36, 0.22) * (0.82 + rings * 0.22), endCap);
  barkRelief = mix(barkRelief, rings * 0.3, endCap);
  // birch: dark horizontal lenticels on pale bark
  if (lum > 0.62) {
    float band = wNoise(vec2(vVegWorld.x * 0.4 + vVegWorld.z * 0.4, vVegWorld.y * 4.0), 6000.0);
    float mark = smoothstep(0.72, 0.8, band) * smoothstep(0.35, 0.6, wNoise(vVegWorld.xz * 2.0 + vec2(vVegWorld.y), 3000.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.08, 0.07, 0.07), mark * 0.9);
  }
  diffuseColor.rgb *= 1.0 - uWetness * 0.35;`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
  {
    vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
    vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
    float det = dot(sx, r1);
    float h = barkRelief * 0.035;
    normal = normalize(abs(det) * normal - sign(det) * (dFdx(h) * r1 + dFdy(h) * r2));
  }`,
      )
  }
  m.customProgramCacheKey = () => `veg-${key}-v4-scan`
  materials.set(key, m)
  return m
}

export const barkMaterial = (): THREE.MeshStandardMaterial => barkVariant(false)
export const logMaterial = (): THREE.MeshStandardMaterial => barkVariant(true)

let atlasTexture: THREE.Texture | null = null
export const setFoliageAtlas = (texture: THREE.Texture): void => {
  atlasTexture = texture
  const foliage = materials.get("foliage") as THREE.MeshStandardMaterial | undefined
  if (foliage) {
    foliage.map = texture
    foliage.needsUpdate = true
  }
}

export const foliageMaterial = (): THREE.MeshStandardMaterial => {
  const cached = materials.get("foliage")
  if (cached) return cached as THREE.MeshStandardMaterial
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: atlasTexture,
    alphaTest: 0.42,
    // Alpha-to-coverage drew a pale fringe round every leaf card (GPU A/B,
    // the crowns read as a white speckle by day and
    // glittered at night. The sharpened cutout below is crisp on its own.
    alphaToCoverage: false,
    side: THREE.DoubleSide,
    roughness: 0.82,
    metalness: 0,
  })
  m.onBeforeCompile = (shader) => {
    patchVertex(shader, "foliage")
    Object.assign(shader.uniforms, vegetationUniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n#define VEG_WIDE_NEAR_FADE\n${OCCLUSION_GLSL}\nuniform float uLeafGlow;\nuniform float uNight;\nuniform float uWetness;\nvarying float vWindW;`)
      .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\n  vegOcclusionClip();")
      .replace("#include <color_fragment>", "#include <color_fragment>\n  // vertex alpha is wind weight, not coverage; sharpen the cutout so\n  // alpha-to-coverage gives crisp anti-aliased leaf edges instead of dither\n  diffuseColor.a = opacity * clamp((leafAlpha - 0.3) / max(fwidth(leafAlpha), 1e-4) + 0.5, 0.0, 1.0);")
      .replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
  vec4 leafTex = texture2D(map, vMapUv);
  // atlas stores neutral luminance; boost contrast slightly, colour from vertex/instance
  diffuseColor.rgb *= mix(vec3(0.42), vec3(1.12), leafTex.rgb);
  // crowns lose chroma in self-shadow; keep blossoms pink and leaves green
  diffuseColor.rgb = max(mix(vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))), diffuseColor.rgb, 1.3), 0.0);
  // mip-aware coverage: averaged alpha in distant mips falls under the cutout,
  // turning far crowns see-through (sky showed through as a teal speckle)
  vec2 leafTexel = vMapUv * vec2(2048.0, 1024.0);
  float leafLod = max(0.0, 0.5 * log2(max(dot(dFdx(leafTexel), dFdx(leafTexel)), dot(dFdy(leafTexel), dFdy(leafTexel)))));
  // distant (sparser LOD) crowns read as the dense masses real trees are
  float leafFar = smoothstep(18.0, 70.0, distance(vVegWorld, cameraPosition));
  float leafAlpha = leafTex.a * (1.0 + leafLod * 0.3 + leafFar * 1.6);
  float leafSpark = step(0.97, min(leafTex.r, leafTex.b)) * step(0.75, vMapUv.x) * step(0.5, vMapUv.y);
#else
  float leafAlpha = 1.0;
  float leafSpark = 0.0;
#endif`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
  // light scattering through thin leaves keeps crowns from going muddy
  totalEmissiveRadiance += diffuseColor.rgb * uLeafGlow * (0.5 + vWindW * 0.5);
  totalEmissiveRadiance += vec3(0.75, 1.0, 0.95) * leafSpark * (0.4 + uNight * 2.2);
  diffuseColor.rgb *= 1.0 - uWetness * 0.18;`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.45, uWetness);")
  }
  m.customProgramCacheKey = () => "veg-foliage-v3-cutout"
  materials.set("foliage", m)
  return m
}

/** Depth material for shadow casting leaves (alpha-tested + wind). */
export const foliageDepthMaterial = (): THREE.MeshDepthMaterial => {
  const cached = materials.get("foliageDepth")
  if (cached) return cached as THREE.MeshDepthMaterial
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlasTexture, alphaTest: 0.5, side: THREE.DoubleSide })
  m.onBeforeCompile = (shader) => {
    patchVertex(shader, "foliage")
    // depth material has no vertex colours: use height for wind weight
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute vec4 color;\n#define USE_COLOR_ALPHA")
  }
  m.customProgramCacheKey = () => "veg-foliage-depth-v1"
  materials.set("foliageDepth", m)
  return m
}

export const barkDepthMaterial = (): THREE.MeshDepthMaterial => {
  const cached = materials.get("barkDepth")
  if (cached) return cached as THREE.MeshDepthMaterial
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  m.onBeforeCompile = (shader) => {
    patchVertex(shader, "bark")
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute vec4 color;\n#define USE_COLOR_ALPHA")
  }
  m.customProgramCacheKey = () => "veg-bark-depth-v1"
  materials.set("barkDepth", m)
  return m
}

export const propsMaterial = (): THREE.MeshStandardMaterial => {
  const cached = materials.get("props")
  if (cached) return cached as THREE.MeshStandardMaterial
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, side: THREE.DoubleSide })
  m.onBeforeCompile = (shader) => {
    patchVertex(shader, "props")
    Object.assign(shader.uniforms, vegetationUniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${OCCLUSION_GLSL}\nuniform float uNight;\nuniform float uWetness;\nvarying float vWindW;`)
      .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\n  vegOcclusionClip();")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
  totalEmissiveRadiance += diffuseColor.rgb * 0.06 * (1.0 - uNight * 0.97);
  diffuseColor.rgb *= 1.0 - uWetness * 0.25;`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.35, uWetness * 0.8);")
  }
  m.customProgramCacheKey = () => "veg-props-v1"
  materials.set("props", m)
  return m
}

/** Boulders and stones: props shading plus granular stone, cracks and lichen. */
export const rockMaterial = (): THREE.MeshStandardMaterial => {
  const cached = materials.get("rock")
  if (cached) return cached as THREE.MeshStandardMaterial
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 })
  m.onBeforeCompile = (shader) => {
    patchVertex(shader, "props")
    Object.assign(shader.uniforms, vegetationUniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${WORLD_NOISE_GLSL}\n${OCCLUSION_GLSL}\nuniform float uNight;\nuniform float uWetness;\nvarying float vWindW;\nfloat rockH = 0.0;\nfloat rockN(vec3 p, float c) { return (wNoise(p.xz, c) + wNoise(p.xy + 31.0, c) + wNoise(p.zy + 57.0, c)) / 3.0; }`)
      .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\n  vegOcclusionClip();")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
  // three projected planes stand in for triplanar mapping on rounded stone
  vec3 rp = vVegWorld;
  float rockAA = 1.0 - smoothstep(0.004, 0.02, length(fwidth(rp.xz)));
  float coarse = rockN(rp, 2048.0);
  float grain = rockN(rp + 13.0, 16384.0);
  float crack = (1.0 - smoothstep(0.0, 0.025, abs(rockN(rp, 6144.0) - 0.5))) * smoothstep(0.5, 0.7, coarse);
  vec3 sc = floor(rp * 90.0);
  float speck = wHash(sc.xz + sc.y * vec2(17.0, 31.0));
  rockH = coarse * 0.6 + grain * 0.4 * rockAA - crack * 0.5 * rockAA;
  // neutral grey granite under the authored tint, with mineral speckle
  float lum0 = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 stone = mix(diffuseColor.rgb, vec3(lum0) * vec3(1.02, 1.0, 0.97), 0.8);
  stone *= 0.8 + coarse * 0.34;
  stone *= mix(1.0, 0.8 + grain * 0.4, rockAA);
  stone *= mix(1.0, speck > 0.92 ? 1.35 : speck < 0.1 ? 0.62 : 1.0, rockAA);
  stone *= 1.0 - crack * 0.4 * rockAA;
  // crustose lichen: grey-green patches and small, rare orange spots
  float lichen = smoothstep(0.6, 0.68, rockN(rp, 9000.0) * 0.7 + coarse * 0.3);
  float orange = smoothstep(0.76, 0.8, rockN(rp + 91.0, 24000.0)) * rockAA;
  stone = mix(stone, vec3(0.5, 0.52, 0.42), lichen * 0.5);
  stone = mix(stone, vec3(0.6, 0.38, 0.12), orange * 0.55);
  diffuseColor.rgb = stone * (1.0 - uWetness * 0.35);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
  {
    vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
    vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
    float det = dot(sx, r1);
    float h = rockH * 0.02;
    normal = normalize(abs(det) * normal - sign(det) * (dFdx(h) * r1 + dFdy(h) * r2));
  }`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, uWetness * 0.85);")
  }
  m.customProgramCacheKey = () => "veg-rock-v1"
  materials.set("rock", m)
  return m
}
