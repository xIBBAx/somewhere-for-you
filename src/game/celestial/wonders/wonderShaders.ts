/**
 * GLSL for the wonders. Every point and curtain is sized in game metres and
 * converted to pixels here, so a light keeps its size at any distance. All
 * positions reach the GPU already in view coordinates (small numbers).
 */

/** Wishing lights: soft glowing motes that pulse until gathered, then rest dimmer. */
export const LIGHT_VS = /* glsl */ `
attribute float aSeed;
attribute float aGot;
uniform float uTime;
uniform float uCalm;
uniform float uHalfH;
varying float vGot;
varying float vSeed;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float pulse = 1.0 + 0.2 * sin(uTime * 2.1 + aSeed * 6.2832) * (1.0 - uCalm);
  float diameter = 14.0 * mix(pulse, 0.55, aGot);
  gl_PointSize = clamp(diameter * projectionMatrix[1][1] * uHalfH / max(-mv.z, 0.5), 0.0, 240.0);
  gl_Position = projectionMatrix * mv;
  vGot = aGot;
  vSeed = aSeed;
}
`

export const LIGHT_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
varying float vGot;
varying float vSeed;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = length(p);
  if (d > 1.0) discard;
  float core = smoothstep(0.32, 0.0, d);
  float halo = pow(1.0 - d, 2.4);
  float twinkle = 0.85 + 0.15 * sin(uTime * 3.1 + vSeed * 40.0);
  float k = mix(1.0, 0.42, vGot) * twinkle;
  vec3 col = uColor * (halo * 0.9 + core * 1.3) + vec3(core) * 0.6;
  gl_FragColor = vec4(col * k, min(1.0, (halo + core) * k));
}
`

/** Ripples of light where a wishing light was gathered: a ring that grows and fades. aAge < 0 is unused. */
export const RIPPLE_VS = /* glsl */ `
attribute float aAge;
uniform float uHalfH;
varying float vAge;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float diameter = mix(3.0, 46.0, max(aAge, 0.0));
  gl_PointSize = aAge < 0.0 ? 0.0 : clamp(diameter * projectionMatrix[1][1] * uHalfH / max(-mv.z, 0.5), 0.0, 320.0);
  gl_Position = projectionMatrix * mv;
  vAge = aAge;
}
`

export const RIPPLE_FS = /* glsl */ `
uniform vec3 uColor;
varying float vAge;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = length(p);
  if (d > 1.0 || vAge < 0.0) discard;
  float ring = smoothstep(0.14, 0.0, abs(d - 0.72));
  float a = ring * pow(1.0 - vAge, 2.0) * 0.9;
  gl_FragColor = vec4(uColor * a, a);
}
`

/** Saturn's ice motes: small glints that flare (and throw a cross of light) when skimmed. */
export const ICE_VS = /* glsl */ `
attribute float aSize;
attribute float aBurst;
attribute float aSeed;
uniform float uHalfH;
varying float vBurst;
varying float vSeed;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float diameter = aSize * (1.0 + 2.2 * aBurst);
  gl_PointSize = clamp(diameter * projectionMatrix[1][1] * uHalfH / max(-mv.z, 0.5), 0.0, 96.0);
  gl_Position = projectionMatrix * mv;
  vBurst = aBurst;
  vSeed = aSeed;
}
`

export const ICE_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
varying float vBurst;
varying float vSeed;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = length(p);
  if (d > 1.0) discard;
  float soft = smoothstep(0.5, 0.0, d);
  float spike = max(0.0, 1.0 - abs(p.x) * 12.0) * max(0.0, 1.0 - abs(p.y) * 1.5)
    + max(0.0, 1.0 - abs(p.y) * 12.0) * max(0.0, 1.0 - abs(p.x) * 1.5);
  float tw = 0.5 + 0.5 * sin(uTime * (2.0 + vSeed * 3.0) + vSeed * 31.0);
  float a = clamp((soft * 0.45 + spike * (0.25 + vBurst) * 1.4 + vBurst * 0.4) * (0.45 + 0.55 * tw), 0.0, 1.0);
  vec3 col = mix(uColor, vec3(1.0), 0.55 + 0.45 * vBurst);
  gl_FragColor = vec4(col * a * 1.3, a);
}
`

/** Jupiter's aurora: a faint curtain of streaks, green at the foot, violet above. */
export const AURORA_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const AURORA_FS = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uStrength;
uniform vec3 uLow;
uniform vec3 uHigh;
varying vec2 vUv;
void main() {
  float x = vUv.x + uSeed;
  float curtain = sin(x * 34.0 + 1.3 * sin(x * 5.1 + uTime * 0.11) + uTime * 0.23);
  float rays = smoothstep(0.35, 1.0, 0.5 + 0.5 * curtain);
  float fade = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.62, 1.0, vUv.y));
  float edge = smoothstep(0.0, 0.2, vUv.x) * (1.0 - smoothstep(0.8, 1.0, vUv.x));
  float breathe = 0.7 + 0.3 * sin(uTime * 0.4 + uSeed * 6.0);
  vec3 col = mix(uLow, uHigh, smoothstep(0.1, 0.8, vUv.y));
  float a = rays * fade * edge * breathe * uStrength;
  gl_FragColor = vec4(col * a, 1.0);
}
`

/** Star mantas: a flattened glowing body whose wing tips undulate. aWing is 0 at the middle, 1 at the tips. */
export const MANTA_VS = /* glsl */ `
attribute float aWing;
uniform float uTime;
varying float vW;
varying float vPh;
void main() {
  float ph = float(gl_InstanceID) * 1.93;
  vec3 p = position;
  p.y += sin(uTime * 1.7 + ph + abs(p.x) * 2.2) * aWing * 0.2;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vW = aWing;
  vPh = ph;
}
`

export const MANTA_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
varying float vW;
varying float vPh;
void main() {
  float pulse = 0.8 + 0.2 * sin(uTime * 2.0 + vPh + vW * 2.5);
  vec3 col = uColor * (0.3 + 0.7 * vW) * pulse;
  gl_FragColor = vec4(col, 0.35 + 0.5 * vW);
}
`
