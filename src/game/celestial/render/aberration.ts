import * as THREE from "three"

/**
 * The look of extraordinary speed: relativistic aberration and Doppler shift
 * of the real sky, applied while Starborn runs between worlds.
 *
 * Real: an observer moving at a fraction β of light's speed sees every star
 * pulled toward the direction of motion — cos θ' = (cos θ + β) / (1 + β cos θ)
 * — brighter and bluer ahead (Doppler factor D = γ (1 + β cos θ) > 1) and
 * dimmer and redder behind. That is how the sky would really look (the
 * "starbow" of 1970s interstellar-flight papers): the whole forward
 * hemisphere crowds into a bright cone ahead, banded by colour as D falls
 * from violet-blue at the centre, through white, to red at the edge.
 * Magic: Starborn reaches that speed at all. β here is presentation only; the
 * journey's true motion is in cosmicTravel.ts.
 *
 * One uniform object is shared by every sky material, so writing `beta` and
 * `dir` here moves the stars, the Milky Way, the unresolved planets and (on
 * the CPU, `aberrate`) the resolved bodies together.
 */

export const aberrationRT = {
  /** v / c, 0 (at rest) … ~0.9 (the height of a journey) */
  beta: 0,
  /** the direction of motion in the local (camera-side) frame, unit */
  dir: new THREE.Vector3(0, 0, 1),
}

/** xyz: direction of motion (local), w: β. Shared by the sky's shaders. */
export const aberrationUniform = { value: new THREE.Vector4(0, 0, 1, 0) }

export const syncAberrationUniform = (): void => {
  const d = aberrationRT.dir
  aberrationUniform.value.set(d.x, d.y, d.z, Math.min(0.97, Math.max(0, aberrationRT.beta)))
}

/**
 * GLSL: `aberrate` (rest-frame direction → seen direction, for points drawn
 * per vertex) and `deaberrate` (seen direction → rest-frame direction, for a
 * map sampled per pixel); both return the Doppler factor D in `dop`.
 * `dopplerTint` turns D into the starbow's colour shift and brightness.
 */
export const ABERRATION_GLSL = /* glsl */ `
  uniform vec4 uAberr;
  vec3 aberrate(vec3 d, out float dop) {
    float b = uAberr.w;
    dop = 1.0;
    if (b < 1e-4) return d;
    vec3 n = uAberr.xyz;
    float c = clamp(dot(d, n), -1.0, 1.0);
    float c2 = (c + b) / (1.0 + b * c);
    vec3 p = d - n * c;
    float pl = length(p);
    p = pl > 1e-6 ? p / pl : vec3(0.0);
    dop = (1.0 + b * c) * inversesqrt(1.0 - b * b);
    return n * c2 + p * sqrt(max(0.0, 1.0 - c2 * c2));
  }
  vec3 deaberrate(vec3 o, out float dop) {
    float b = uAberr.w;
    dop = 1.0;
    if (b < 1e-4) return o;
    vec3 n = uAberr.xyz;
    float c2 = clamp(dot(o, n), -1.0, 1.0);
    float c = (c2 - b) / (1.0 - b * c2);
    vec3 p = o - n * c2;
    float pl = length(p);
    p = pl > 1e-6 ? p / pl : vec3(0.0);
    dop = inversesqrt(1.0 - b * b) / (1.0 - b * c2);
    return n * c + p * sqrt(max(0.0, 1.0 - c * c));
  }
  // the colour a Doppler factor gives starlight: violet-blue ahead, through
  // white where D ~ 1, to amber and deep red behind (a blackbody's light
  // shifted by D: its peak slides, so the hue walks along that path)
  vec3 dopplerTint(vec3 col, float dop) {
    float up = smoothstep(1.0, 3.2, dop);
    float down = smoothstep(1.0, 0.35, dop);
    vec3 blue = mix(vec3(0.72, 0.86, 1.0), vec3(0.62, 0.62, 1.0), smoothstep(2.0, 3.6, dop));
    vec3 red = mix(vec3(1.0, 0.74, 0.42), vec3(1.0, 0.32, 0.22), smoothstep(0.75, 0.38, dop));
    vec3 c = mix(col, col * blue * 1.25, up);
    return mix(c, col * red, down);
  }
  // how much brighter: a point source goes as D^3 to D^4; tempered so the
  // forward cone is a blaze of distinct stars rather than a white disc
  float dopplerGain(float dop) {
    return clamp(pow(dop, 2.2), 0.0, 6.0) * smoothstep(0.22, 0.5, dop);
  }
`

const _p = new THREE.Vector3()

/**
 * CPU twin of `aberrate` for the resolved bodies: turns `d` (unit, local) in
 * place to where it is seen. Returns the Doppler factor.
 */
export const aberrate = (d: THREE.Vector3): number => {
  const b = Math.min(0.97, Math.max(0, aberrationRT.beta))
  if (b < 1e-4) return 1
  const n = aberrationRT.dir
  const c = Math.max(-1, Math.min(1, d.dot(n)))
  const c2 = (c + b) / (1 + b * c)
  _p.copy(d).addScaledVector(n, -c)
  const pl = _p.length()
  if (pl > 1e-6) _p.divideScalar(pl)
  else _p.set(0, 0, 0)
  d.copy(n).multiplyScalar(c2).addScaledVector(_p, Math.sqrt(Math.max(0, 1 - c2 * c2)))
  return (1 + b * c) / Math.sqrt(1 - b * b)
}
