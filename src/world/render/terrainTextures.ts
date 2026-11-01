import * as THREE from "three"

/**
 * Photographic ground layers (CC0 scans from Poly Haven, see
 * ASSET_LICENSES.md). Every layer is stored in two texture arrays so
 * one terrain material can blend all of them without running out of samplers:
 *
 *   albedo array: sRGB colour with a share of the scan's ambient occlusion
 *   detail array: tangent normal X/Y (OpenGL) + roughness in blue
 *
 * The arrays decode asynchronously; until they arrive the terrain keeps its
 * procedural colouring, so the world is never blocked on these downloads.
 */
export const TERRAIN_LAYERS = [
  "rocky_terrain_02", // 0 lush grass
  "leafy_grass", // 1 sun-dried meadow
  "forest_ground_04", // 2 forest floor / soil
  "forest_leaves_02", // 3 leaf litter
  "aerial_rocks_02", // 4 rock outcrops on steep ground
  "coast_sand_01", // 5 shore sand
  "grass_path_2", // 6 trodden path
] as const

/** Linear mean albedo of each layer (from asset-pipeline/textures/pack_terrain.py). */
const LINEAR_MEANS: [number, number, number][] = [
  [0.0784, 0.0733, 0.01],
  [0.2595, 0.1908, 0.0835],
  [0.1366, 0.0958, 0.0548],
  [0.2189, 0.1325, 0.0411],
  [0.1458, 0.1019, 0.0423],
  [0.2199, 0.1674, 0.1038],
  [0.2488, 0.2034, 0.1187],
]

const empty = (srgb: boolean): THREE.DataArrayTexture => {
  const texture = new THREE.DataArrayTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, 1)
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

export const terrainTextureUniforms = {
  tAlbedo: { value: empty(true) as THREE.DataArrayTexture },
  tDetail: { value: empty(false) as THREE.DataArrayTexture },
  tReady: { value: 0 },
  tMeans: { value: LINEAR_MEANS.map(([r, g, b]) => new THREE.Vector3(r, g, b)) },
}

const decode = async (url: string, size: number): Promise<Uint8ClampedArray> => {
  const blob = await (await fetch(url)).blob()
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none", resizeWidth: size, resizeHeight: size, resizeQuality: "high" })
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(size, size) : Object.assign(document.createElement("canvas"), { width: size, height: size })
  const context = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  context.drawImage(bitmap, 0, 0, size, size)
  bitmap.close()
  return context.getImageData(0, 0, size, size).data
}

const buildArray = (layers: Uint8ClampedArray[], size: number, srgb: boolean): THREE.DataArrayTexture => {
  const data = new Uint8Array(size * size * 4 * layers.length)
  layers.forEach((layer, i) => data.set(layer, i * size * size * 4))
  const texture = new THREE.DataArrayTexture(data, size, size, layers.length)
  texture.format = THREE.RGBAFormat
  texture.type = THREE.UnsignedByteType
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 8
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

let loading: Promise<void> | null = null

/** Starts (once) the download and GPU upload of the ground scans. */
export const loadTerrainTextures = (size = 1024): Promise<void> => {
  if (loading) return loading
  loading = (async () => {
    try {
      const base = "/assets/textures/terrain/"
      const [albedo, detail] = await Promise.all([
        Promise.all(TERRAIN_LAYERS.map(name => decode(`${base}${name}_albedo.jpg`, size))),
        Promise.all(TERRAIN_LAYERS.map(name => decode(`${base}${name}_nr.jpg`, size))),
      ])
      terrainTextureUniforms.tAlbedo.value.dispose()
      terrainTextureUniforms.tDetail.value.dispose()
      terrainTextureUniforms.tAlbedo.value = buildArray(albedo, size, true)
      terrainTextureUniforms.tDetail.value = buildArray(detail, size, false)
      terrainTextureUniforms.tReady.value = 1
    } catch (error) {
      console.warn("[world] ground scans failed to load; keeping procedural ground", error)
    }
  })()
  return loading
}

/**
 * GLSL helpers. `tLayers(p, mixB, w0, w1)` blends linear albedo, roughness
 * and a tangent-space normal for 7 layer weights (w0: layers 0–3, w1: 4–6).
 * `p` is the origin-wrapped world XZ; `mixB` (0–1, slow world noise from the
 * caller) blends two decorrelated samples to hide the texture period.
 */
export const TERRAIN_TEXTURE_GLSL = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray tAlbedo;
uniform sampler2DArray tDetail;
uniform float tReady;
uniform vec3 tMeans[7];
struct TLayerOut { vec3 albedo; float rough; vec3 nTS; vec3 mean; };
void tAccum(inout TLayerOut o, float w, float layer, vec2 uvA, vec2 uvB, float mixB) {
  if (w < 0.004) return;
  vec4 a = texture(tAlbedo, vec3(uvA, layer));
  vec4 da = texture(tDetail, vec3(uvA, layer));
  if (mixB > 0.01) {
    a = mix(a, texture(tAlbedo, vec3(uvB, layer)), mixB);
    da = mix(da, texture(tDetail, vec3(uvB, layer)), mixB);
  }
  o.albedo += a.rgb * w;
  o.rough += da.b * w;
  o.nTS += vec3(da.rg * 2.0 - 1.0, 0.0) * w;
  o.mean += tMeans[int(layer + 0.5)] * w;
}
// Steep ground: the rock layer is also projected from the side (set by the
// caller before tLayers), so a cliff shows rock, not the ground smeared down it.
vec3 tTriPos = vec3(0.0);
vec3 tTriN = vec3(0.0, 1.0, 0.0);
void tAccumSide(inout TLayerOut o, float w, float layer, vec2 uv) {
  if (w < 0.004) return;
  vec4 a = texture(tAlbedo, vec3(uv, layer));
  vec4 da = texture(tDetail, vec3(uv, layer));
  o.albedo += a.rgb * w;
  o.rough += da.b * w;
  o.mean += tMeans[int(layer + 0.5)] * w;
}
TLayerOut tLayers(vec2 p, float mixB, vec4 w0, vec3 w1) {
  TLayerOut o = TLayerOut(vec3(0.0), 0.0, vec3(0.0), vec3(0.0));
  float total = dot(w0, vec4(1.0)) + dot(w1, vec3(1.0));
  w0 /= max(total, 1e-4); w1 /= max(total, 1e-4);
  // 4 m tile plus a quarter-turned 9.85 m tile; both periods divide the
  // 1024 m origin wrap, so floating-origin rebases never shift the ground.
  vec2 uvA = p * (256.0 / 1024.0);
  vec2 uvB = vec2(p.y, -p.x) * (104.0 / 1024.0) + vec2(0.37, 0.71);
  tAccum(o, w0.x, 0.0, uvA, uvB, mixB);
  tAccum(o, w0.y, 1.0, uvA, uvB, mixB);
  tAccum(o, w0.z, 2.0, uvA, uvB, mixB);
  tAccum(o, w0.w, 3.0, uvA, uvB, mixB);
  vec3 triW = pow(abs(tTriN), vec3(4.0));
  triW /= dot(triW, vec3(1.0));
  if (triW.y > 0.97) tAccum(o, w1.x, 4.0, uvA * 0.75, uvB * 0.75, mixB);
  else {
    tAccum(o, w1.x * triW.y, 4.0, uvA * 0.75, uvB * 0.75, mixB);
    float ts = 0.75 * 256.0 / 1024.0;
    // two scales a turn apart, half each, so a long cliff never shows its tile
    vec2 sx = vec2(tTriPos.z, -tTriPos.y), sz = vec2(tTriPos.x, -tTriPos.y);
    tAccumSide(o, w1.x * triW.x * 0.5, 4.0, sx * ts);
    tAccumSide(o, w1.x * triW.x * 0.5, 4.0, vec2(-sx.y, sx.x) * ts * 0.41 + vec2(0.61, 0.17));
    tAccumSide(o, w1.x * triW.z * 0.5, 4.0, sz * ts + vec2(0.29, 0.53));
    tAccumSide(o, w1.x * triW.z * 0.5, 4.0, vec2(-sz.y, sz.x) * ts * 0.41 + vec2(0.13, 0.77));
  }
  tAccum(o, w1.y, 5.0, uvA, uvB, mixB);
  tAccum(o, w1.z, 6.0, uvA, uvB, mixB);
  o.nTS.z = sqrt(max(1.0 - dot(o.nTS.xy, o.nTS.xy), 0.05));
  return o;
}
/** World-aligned UVs: u follows +X, v follows +Z. */
vec3 tWorldNormal(vec3 nTS, vec3 geomN, float strength) {
  vec3 t = normalize(vec3(1.0, 0.0, 0.0) - geomN * geomN.x);
  vec3 b = normalize(cross(t, geomN)) * -1.0;
  return normalize(t * nTS.x * strength + b * nTS.y * strength + geomN * nTS.z);
}
`
