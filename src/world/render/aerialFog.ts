import * as THREE from "three"
import { AIR_SCALE_HEIGHT } from "../../game/celestial/scale"

/**
 * Aerial perspective for the whole world, folded into three.js's own fog.
 *
 * Seen from the air, the near chunks, the far terrain, its crowns and the
 * horizon lands are four separate meshes. When only the far layers took the
 * high-altitude haze and mute, each boundary between them read as a cliff of
 * colour: a saturated square of chunks on a pale blue plain. Here one function
 * of the sight-line length tints every fog-enabled material alike (terrain,
 * trees, water, animals, characters), so no layer can disagree with the next.
 *
 * `AERIAL` is a typed array, which UniformsUtils.clone shares by reference
 * rather than copying, so every material compiled from the fog uniforms reads
 * the same values; a material without it reads zero and is left as it was.
 * Imported first in main.tsx so it is installed before any material exists.
 *
 * xyz: Rayleigh extinction per metre of sight line, already scaled by the mean
 * air density between the ground and the eye and faded in with height.
 * w: how strongly distant colour mutes toward the greys of land under haze.
 */
export const AERIAL = new Float32Array(4)

/**
 * x: how far the ground world (chunks, trees, water, far terrain) has
 * dissolved into the horizon lands below, which alone carry the handover to
 * Earth's own photographed face; nearer than y metres nothing dissolves, so
 * Starborn and her riders stay whole. A material without it reads 0: kept.
 * The horizon lands opt out with the AERIAL_KEEP define.
 */
export const AERIAL_FADE = new Float32Array([0, 150, 0, 0])

/**
 * x: how far the model being drawn has dissolved (0 whole, 1 gone), written
 * per draw by fadeable() models, so animals and the like dither in and out at
 * the edge of their range instead of popping. Reset to 0 after each draw.
 */
export const OBJECT_FADE = new Float32Array(4)

/**
 * Sunlit haze. Real air is not one colour in every direction: looking toward
 * a low sun the haze glows (aerosols scatter forward, Mie), along the horizon
 * under it the light runs warm through a long path of air, and opposite the
 * sun at twilight the ground's own shadow rises as a cool band. Three's fog
 * mixes everything toward a single fogColor; here every fog-enabled material
 * and the sky dome (Lighting.tsx) add the same direction-dependent light to
 * it, so far hills, trees and the horizon line glow together and the sky
 * meets the land without an edge. Written each frame by Lighting.tsx.
 *
 * HAZE_SUN  xyz: unit direction to the sun (world), w: forward glow strength
 * HAZE_GLOW rgb: glow colour (linear), w: sharpness of the forward lobe
 * HAZE_BAND rgb: warm band along the horizon under the sun, w: its height falloff
 * HAZE_ANTI rgb: added opposite the sun (negative: Earth's shadow), w: unused
 */
export const HAZE_SUN = new Float32Array([0, 1, 0, 0])
export const HAZE_GLOW = new Float32Array([1, 1, 1, 6])
export const HAZE_BAND = new Float32Array([0, 0, 0, 8])
export const HAZE_ANTI = new Float32Array(4)

/** The haze's directional light, shared verbatim by the fog chunk and the sky dome. */
export const HAZE_GLSL = /* glsl */ `
vec3 hazeTint( vec3 dir ) {
	float mu = dot( dir, uHazeSun.xyz );
	float fwd = max( mu, 0.0 );
	// a sharp aureole round the sun and a broad forward lobe
	float lobe = pow( fwd, uHazeGlow.w ) + 0.28 * fwd * fwd * fwd;
	vec3 c = uHazeGlow.rgb * lobe * uHazeSun.w;
	// the long warm path along the horizon on the sun's side of the sky
	vec2 h = dir.xz;
	float hl = length( h );
	vec2 sh = uHazeSun.xz;
	float shl = length( sh );
	float az = ( hl > 1e-4 && shl > 1e-4 ) ? dot( h / hl, sh / shl ) : 0.0;
	float side = max( az * 0.5 + 0.5, 0.0 );
	side *= side;
	c += uHazeBand.rgb * side * exp( - max( dir.y, 0.0 ) * uHazeBand.w );
	// opposite the sun: the shadow of the ground on the air at twilight
	float anti = max( -az, 0.0 ) * exp( - max( dir.y, 0.0 ) * 6.0 );
	c += uHazeAnti.rgb * anti;
	return c;
}
`

/** Rayleigh extinction ratios (per scale height), red to blue. */
const RAYLEIGH = [0.046, 0.108, 0.265] as const
/** Distance over which colour mutes, metres. */
export const AERIAL_MUTE_DISTANCE = 600

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * Per frame, from the camera's height above sea level (game metres). Below
 * ~70 m the classic fog alone sets the look, exactly as before; by ~260 m the
 * aerial haze is full; from ~64 km real (1000 m) the land is Earth's own
 * photographed colour and stops muting. Pass a negative height off Earth.
 */
export const updateAerial = (altitude: number): void => {
  if (!(altitude > 0)) { AERIAL.fill(0); AERIAL_FADE[0] = 0; return }
  // the lands start becoming Earth's photograph at 1000 m (HorizonLands
  // uOrbitW); the procedural ground has gone before that shows
  AERIAL_FADE[0] = smooth(1000, 1500, altitude)
  const weight = smooth(70, 260, altitude)
  const camH = Math.max(altitude, 1)
  // mean density from the ground to the eye through air thinning with height
  const avgRho = (AIR_SCALE_HEIGHT / camH) * (1 - Math.exp(-camH / AIR_SCALE_HEIGHT))
  for (let i = 0; i < 3; i++) AERIAL[i] = (RAYLEIGH[i] / AIR_SCALE_HEIGHT) * avgRho * weight
  AERIAL[3] = weight * (1 - smooth(1000, 2800, altitude))
}

export const AERIAL_FOG_FRAGMENT = /* glsl */ `
	// interleaved gradient noise: a stable dither for every dissolve below
	float aerialDither = fract( 52.9829189 * fract( dot( floor( gl_FragCoord.xy ), vec2( 0.06711056, 0.00583715 ) ) ) );
	if ( uObjectFade.x > aerialDither ) discard;
	#ifndef AERIAL_KEEP
	if ( uAerialFade.x > 0.0 && vFogDist > uAerialFade.y ) {
		// dithered, so the layers never blend through each other
		if ( uAerialFade.x > aerialDither ) discard;
	}
	#endif
	if ( uAerial.x > 0.0 ) {
		// land under haze: muted with distance, then lit air in front of it
		float aerialLum = dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
		float aerialMuteW = uAerial.w * ( 1.0 - exp( - vFogDist / ${AERIAL_MUTE_DISTANCE.toFixed(1)} ) );
		gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( vec3( aerialLum ), gl_FragColor.rgb, 0.72 ) * 0.9, aerialMuteW );
		vec3 aerialT = exp( - uAerial.xyz * vFogDist );
		gl_FragColor.rgb = gl_FragColor.rgb * aerialT + hazeFogColor * 0.9 * ( 1.0 - aerialT );
	}
`

let installed = false
export const installAerialFog = (): void => {
  if (installed) return
  installed = true
  const shared = (): THREE.IUniform<Float32Array> => ({ value: AERIAL })
  const fade = (): THREE.IUniform<Float32Array> => ({ value: AERIAL_FADE })
  const object = (): THREE.IUniform<Float32Array> => ({ value: OBJECT_FADE })
  const haze = {
    uHazeSun: { value: HAZE_SUN }, uHazeGlow: { value: HAZE_GLOW }, uHazeBand: { value: HAZE_BAND }, uHazeAnti: { value: HAZE_ANTI },
  }
  const extra = (): Record<string, THREE.IUniform> => ({ uAerial: shared(), uAerialFade: fade(), uObjectFade: object(), ...haze })
  Object.assign(THREE.UniformsLib.fog, extra())
  for (const lib of Object.values(THREE.ShaderLib)) if (lib.uniforms.fogColor) Object.assign(lib.uniforms, extra())
  const chunk = THREE.ShaderChunk as Record<string, string>
  // the eye-space position (not only its length): the haze needs the direction of each fragment
  chunk.fog_pars_vertex += "\n#ifdef USE_FOG\n\tvarying vec3 vFogView;\n#endif\n"
  chunk.fog_vertex += "\n#ifdef USE_FOG\n\tvFogView = mvPosition.xyz;\n#endif\n"
  chunk.fog_pars_fragment += `
#ifdef USE_FOG
	uniform vec4 uAerial;
	uniform vec4 uAerialFade;
	uniform vec4 uObjectFade;
	uniform vec4 uHazeSun;
	uniform vec4 uHazeGlow;
	uniform vec4 uHazeBand;
	uniform vec4 uHazeAnti;
	varying vec3 vFogView;
	#define vFogDist length( vFogView )
	${HAZE_GLSL}
#endif
`
  chunk.fog_fragment = chunk.fog_fragment.replace(
    "gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );",
    `// eye space back to world: the view matrix's rotation is orthonormal
	vec3 hazeFogColor = max( fogColor + hazeTint( normalize( transpose( mat3( viewMatrix ) ) * vFogView ) ), 0.0 );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, hazeFogColor, fogFactor );\n${AERIAL_FOG_FRAGMENT}`,
  )
}

installAerialFog()

/** Each model owns its uniforms and material clones; source textures and live
 * coat/feather uniforms remain shared with the model's animator. A WeakMap
 * keeps lifecycle metadata out of glTF userData and handles late LOD meshes. */
type FadeOwner = {
  uniform: THREE.IUniform<Float32Array>
  clones: Map<THREE.Material, THREE.Material>
  owned: Set<THREE.Material>
  meshes: Map<THREE.Mesh, () => void>
  shadows: Map<THREE.Material, { depth: THREE.MeshDepthMaterial; distance: THREE.MeshDistanceMaterial }>
}
const fadeOwners = new WeakMap<THREE.Object3D, FadeOwner>()

/** Travelling subjects stay visible when Earth's distant ground dissolves.
 * Call after makeFadeable so shared source materials are never modified;
 * model-distance fades and ordinary atmospheric extinction still apply. */
export const keepAerialSubject = (root: THREE.Object3D): void => {
  root.traverse(o => {
    if (!(o as THREE.Mesh).isMesh) return
    const material = (o as THREE.Mesh).material
    for (const m of Array.isArray(material) ? material : [material]) {
      const shader = m as THREE.Material & { defines?: Record<string, unknown> }
      if (shader.defines?.AERIAL_KEEP === 1) continue
      shader.defines = { ...shader.defines, AERIAL_KEEP: 1 }
      shader.needsUpdate = true
    }
  })
}

export const makeFadeable = (root: THREE.Object3D): void => {
  let owner = fadeOwners.get(root)
  if (!owner) {
    owner = { uniform: { value: new Float32Array(4) }, clones: new Map(), owned: new Set(), meshes: new Map(), shadows: new Map() }
    fadeOwners.set(root, owner)
  }
  const state = owner
  const own = (source: THREE.Material): THREE.Material => {
    if (state.owned.has(source)) return source
    const existing = state.clones.get(source)
    if (existing) return existing
    // Material.copy JSON-serializes userData. Do not duplicate textures or
    // sever live shader uniforms; always restore even if clone throws.
    const data = source.userData
    let clone: THREE.Material
    try { source.userData = {}; clone = source.clone() }
    finally { source.userData = data }
    clone.userData = { ...data }
    const compile = source.onBeforeCompile
    clone.onBeforeCompile = function (shader, renderer) {
      compile.call(this, shader, renderer)
      shader.uniforms.uModelFade = state.uniform
      shader.fragmentShader = "uniform vec4 uModelFade;\n" + shader.fragmentShader
      shader.fragmentShader = shader.fragmentShader.replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
float modelDither = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
if (uModelFade.x > modelDither) discard;`)
    }
    clone.customProgramCacheKey = () => `${source.customProgramCacheKey()}-model-fade-v2`
    state.clones.set(source, clone)
    state.owned.add(clone)
    return clone
  }
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || state.meshes.has(mesh)) return
    const material = mesh.material, depth = mesh.customDepthMaterial, distance = mesh.customDistanceMaterial
    const before = mesh.onBeforeRender, shadow = mesh.onBeforeShadow
    mesh.material = Array.isArray(material) ? material.map(own) : own(material)
    // Keep feather bending, alpha cutouts and skinning in the shadow pass.
    const base = (Array.isArray(material) ? material[0] : material) as THREE.MeshStandardMaterial
    if (mesh.castShadow || depth || distance) {
      let defaults = state.shadows.get(base)
      if (!defaults) {
        const params = { map: base.map, alphaMap: base.alphaMap, alphaTest: base.alphaTest, side: base.side }
        defaults = { depth: new THREE.MeshDepthMaterial({ ...params, depthPacking: THREE.RGBADepthPacking }), distance: new THREE.MeshDistanceMaterial(params) }
        state.shadows.set(base, defaults)
      }
      mesh.customDepthMaterial = own(depth ?? defaults.depth)
      mesh.customDistanceMaterial = own(distance ?? defaults.distance)
    }
    const update = (): void => {
      const fade = Number(root.userData.fade ?? 0)
      state.uniform.value[0] = Number.isFinite(fade) ? Math.min(1, Math.max(0, fade)) : 0
    }
    mesh.onBeforeRender = function (...args) { update(); before.apply(this, args) }
    mesh.onBeforeShadow = function (...args) { update(); shadow.apply(this, args) }
    state.meshes.set(mesh, () => {
      mesh.material = material; mesh.customDepthMaterial = depth; mesh.customDistanceMaterial = distance
      mesh.onBeforeRender = before; mesh.onBeforeShadow = shadow
    })
  })
}

/** Idempotent; only releases instance-owned materials, never shared textures. */
export const disposeFadeable = (root: THREE.Object3D): void => {
  const state = fadeOwners.get(root)
  if (!state) return
  for (const restore of state.meshes.values()) restore()
  for (const material of state.owned) material.dispose()
  for (const source of state.shadows.values()) { source.depth.dispose(); source.distance.dispose() }
  fadeOwners.delete(root)
}

/** Temporal appearance, shared by loads and culls; riding stays fully visible. */
export const advanceAppearance = (appearance: number, present: boolean, dt: number): number =>
  Math.min(1, Math.max(0, appearance + (present ? 1 : -1) * Math.max(0, dt) / 0.6))

/** 0 inside `range − band`, 1 at `range`: how far a model has faded out by distance. */
export const fadeByDistance = (distance: number, range: number, band = 18): number => smooth(range - band, range, distance)
