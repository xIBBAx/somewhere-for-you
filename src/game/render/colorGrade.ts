import * as THREE from "three"

/**
 * Hue-preserving grade applied inside every built-in material's tone mapping
 * step, so it costs nothing extra per frame (no post-processing pass).
 *
 *  1. vibrance: lifts muted colours more than already-rich ones, so grass,
 *     sky, blossom and water read as real colour instead of grey-olive.
 *     Saturation is judged perceptually (on a gamma-2 encoding): in linear
 *     light almost every lit colour measures as highly saturated, which left
 *     the lift near zero on foliage. Skin, bark and soil hues (r > g > b with
 *     green part-way between) are guarded so faces never turn orange.
 *  2. gentle mid-tone contrast around 0.18 grey.
 *  3. Khronos PBR Neutral highlight roll-off: keeps base colours faithful
 *     (ACES Filmic desaturated and hue-shifted the whole world).
 */
export const GRADE = {
  // photographic but sweet: a clear lift for muted colour (meadow, sky,
  // blossom, water), skin guarded
  vibrance: 0.52,
  contrast: 1.08,
}

export const CUSTOM_TONE_MAPPING = /* glsl */ `
vec3 CustomToneMapping( vec3 color ) {
  color *= toneMappingExposure;
  float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 p = sqrt( max( color, 0.0 ) );
  float hi = max( max( p.r, p.g ), p.b );
  float lo = min( min( p.r, p.g ), p.b );
  float sat = ( hi - lo ) / max( hi, 1e-5 );
  float warm = step( p.b, p.g ) * step( p.g, p.r );
  float mid = ( p.g - p.b ) / max( p.r - p.b, 1e-5 );
  float skin = warm * smoothstep( 0.12, 0.25, mid ) * ( 1.0 - smoothstep( 0.68, 0.8, mid ) );
  // shadows keep their natural chroma: boosting dark, sky-lit greys turned
  // bark and soil blue
  float vib = ${GRADE.vibrance.toFixed(3)} * ( 1.0 - sat ) * smoothstep( 0.015, 0.16, luma ) * ( 1.0 - 0.85 * skin );
  color = max( mix( vec3( luma ), color, 1.0 + vib ), 0.0 );
  color = 0.18 * pow( max( color / 0.18, 0.0 ), vec3( ${GRADE.contrast.toFixed(3)} ) );
  const float startCompression = 0.76;
  const float desaturation = 0.15;
  float x = min( color.r, min( color.g, color.b ) );
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max( color.r, max( color.g, color.b ) );
  if ( peak < startCompression ) return color;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / ( peak + d - startCompression );
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / ( desaturation * ( peak - newPeak ) + 1.0 );
  return mix( color, vec3( newPeak ), g );
}`

let installed = false

/** Must run before the first material compiles. */
export const installColorGrade = (): void => {
  if (installed) return
  installed = true
  THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
    /vec3 CustomToneMapping\( vec3 color \) \{[^}]*\}/,
    CUSTOM_TONE_MAPPING,
  )
}

installColorGrade()
