import { RING_TAU_GLSL } from "../rings/ringPhysics"
import { ABERRATION_GLSL } from "./aberration"

/**
 * The deep sky: the real Milky Way (NASA SVS Deep Star Maps 2020, its
 * starless background map) and ~22,000 catalogued stars (HYG v4.1) drawn as
 * points at their true positions in space, so their brightness and place
 * follow the observer when Starborn leaves the Sun behind. Both are drawn at
 * infinity (w = 0), behind everything.
 *
 * And the rings: a radial profile across the ring plane, lit from the side
 * the Sun is on, glowing by forward scattering when seen against the light,
 * shadowed by the planet and hidden behind it.
 */

export const MILKY_WAY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 0.0);
    clip.z = clip.w * 0.99999;
    gl_Position = clip;
  }
`

export const MILKY_WAY_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform mat3 uLocalToEq;
  uniform float uBright;
  varying vec3 vDir;
  ${ABERRATION_GLSL}
  void main() {
    // at Starborn's journey speed the sky is seen aberrated (aberration.ts)
    float dop;
    vec3 seen = deaberrate(normalize(vDir), dop);
    vec3 d = normalize(uLocalToEq * seen);
    float ra = atan(d.y, d.x);
    float dec = asin(clamp(d.z, -1.0, 1.0));
    vec2 uv = vec2(fract(0.5 - ra / 6.2831853), 0.5 + dec / 3.14159265);
    vec3 c = pow(texture2D(uMap, uv).rgb, vec3(2.2));
    // the map's diffuse floor (unresolved stars, scattered light; median
    // luminance ~0.01) read as a brown fog over all of space: a soft black
    // point, as a long exposure of the Milky Way is processed, leaves the
    // band, its dust lanes and the core, and black sky between
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c *= smoothstep(0.0045, 0.022, l);
    // a diffuse map's surface brightness goes as D^4; tempered like the stars'
    c = dopplerTint(c, dop) * dopplerGain(dop);
    gl_FragColor = vec4(c * uBright, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export const STAR_VERTEX = /* glsl */ `
  attribute float aAbs;
  attribute float aCI;
  uniform vec3 uObs;          // observer, parsecs, equatorial
  uniform mat3 uEqToLocal;
  uniform float uPx;          // device pixel ratio
  uniform float uBright;
  uniform float uMinI;
  varying vec3 vColor;
  varying float vI;
  varying float vSig;
  varying float vSize;
  ${ABERRATION_GLSL}
  vec3 bvColor(float bv) {
    // naked-eye star colours along the B-V index, blue-white to deep orange
    vec3 c = mix(vec3(0.63, 0.73, 1.0), vec3(0.82, 0.87, 1.0), smoothstep(-0.35, 0.0, bv));
    c = mix(c, vec3(1.0, 0.97, 0.92), smoothstep(0.0, 0.6, bv));
    c = mix(c, vec3(1.0, 0.86, 0.68), smoothstep(0.6, 1.1, bv));
    c = mix(c, vec3(1.0, 0.72, 0.46), smoothstep(1.1, 1.7, bv));
    return c;
  }
  void main() {
    vec3 rel = position - uObs;
    float d = max(length(rel), 1e-5);
    float m = aAbs + 5.0 * log(d) / log(10.0) - 5.0;
    float I = pow(10.0, -0.4 * m);
    float dop;
    vec3 dir = aberrate(uEqToLocal * (rel / d), dop);
    I *= dopplerGain(dop);
    vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * dir, 0.0);
    clip.z = clip.w * 0.99998;
    gl_Position = clip;
    // the brightest (Sirius, Canopus, Vega) only just over the bloom's
    // threshold: a glint, never a glowing orb
    vI = min(pow(I, 0.42) * 0.85 * uBright, 1.5 + 0.8 * uAberr.w);
    // the eye's (or a camera's) limit for faint stars, set by the brightest
    // thing in view: fainter ones fade out just above it
    vI *= smoothstep(uMinI, uMinI * 3.0, I);
    // a pixel-true point: faint stars a crisp ~1 px gaussian, bright ones
    // carrying a little halo, as a lens records them (sigma in pixels)
    float bright = clamp(pow(I, 0.25), 0.0, 1.25);
    vSig = (0.55 + 0.7 * bright * bright) * uPx;
    gl_PointSize = 6.0 * vSig + 1.0;
    vSize = gl_PointSize;
    vColor = dopplerTint(bvColor(aCI), dop);
    if (vI < 0.012) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`

export const STAR_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vI;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(q, q);
    float a = exp(-r2 * 4.5);
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * vI * a, 0.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** The catalogue's stars: each one's light laid on the pixels by a true gaussian. */
export const CATALOGUE_STAR_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vI;
  varying float vSig;
  varying float vSize;
  void main() {
    float rp = length(gl_PointCoord * 2.0 - 1.0) * vSize * 0.5;
    float a = exp(-rp * rp / (2.0 * vSig * vSig));
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * vI * a, 0.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** Bodies too small to resolve: a star-like point with the body's brightness. */
export const DOT_VERTEX = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  varying vec3 vColor;
  ${ABERRATION_GLSL}
  void main() {
    // placed already aberrated (CelestialSky.tsx): only the light shifts here
    float dop;
    deaberrate(normalize(position), dop);
    vColor = dopplerTint(aColor, dop) * min(dopplerGain(dop), 2.5);
    vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 0.0);
    clip.z = clip.w * 0.99997;
    gl_Position = clip;
    gl_PointSize = aSize;
    if (dot(aColor, vec3(1.0)) < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`

export const RING_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  varying vec2 vPlane;
  void main() {
    vPlane = position.xy;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

export const RING_FRAGMENT = /* glsl */ `
  uniform sampler2D uRingMap;
  uniform float uHasMap;
  uniform vec2 uRing;         // inner, outer (radius units)
  uniform vec3 uPlanet;       // planet centre (render)
  uniform float uRadius;      // planet radius (render)
  uniform float uOblate;
  uniform vec3 uSun;          // local axes
  uniform vec3 uNormal;       // ring plane normal (local axes)
  uniform float uLight;
  uniform float uFade;
  uniform int uStyle;
  uniform vec2 uCamPlane;     // the view's place over the ring plane (radius units)
  uniform float uNear;        // the radius (radius units) round it where the 3D ice takes over; 0: none
  varying vec3 vWorld;
  varying vec2 vPlane;
  ${RING_TAU_GLSL}

  float hit(vec3 ro, vec3 rd) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - 1.0;
    float h = b * b - c;
    if (h < 0.0) return -1.0;
    return -b - sqrt(h);
  }

  vec4 profile(float r) {
    float u = (r - uRing.x) / (uRing.y - uRing.x);
    if (u < 0.0 || u > 1.0) return vec4(0.0);
    if (uHasMap > 0.5) {
      vec4 t = texture2D(uRingMap, vec2(u, 0.5));
      return vec4(pow(t.rgb, vec3(2.2)), t.a);
    }
    // narrow, dark rings of the ice giants and Jupiter's faint dusty halo
    float a = 0.0;
    if (uStyle == 1) {
      // Uranus: nine narrow rings and the broad epsilon at the outer edge
      for (int i = 0; i < 9; i++) a += exp(-pow((u - float(i) / 10.5) * 140.0, 2.0)) * 0.35;
      a += exp(-pow((u - 0.97) * 45.0, 2.0)) * 0.7;
      return vec4(vec3(0.05, 0.05, 0.055), clamp(a, 0.0, 0.8));
    }
    if (uStyle == 2) {
      // Neptune: Galle, Le Verrier, Lassell and Adams with its clumpy arcs
      a = exp(-pow((u - 0.0) * 30.0, 2.0)) * 0.08 + exp(-pow((u - 0.43) * 120.0, 2.0)) * 0.25
        + smoothstep(0.43, 0.5, u) * (1.0 - smoothstep(0.5, 0.86, u)) * 0.03 + exp(-pow((u - 0.98) * 120.0, 2.0)) * 0.3;
      return vec4(vec3(0.07, 0.065, 0.06), a);
    }
    a = smoothstep(0.0, 0.3, u) * (1.0 - smoothstep(0.75, 1.0, u)) * 0.06;
    return vec4(vec3(0.35, 0.28, 0.22), a);
  }

  void main() {
    // the ring geometry is built in units of the planet's radius
    float r = length(vPlane);
    vec4 ring = profile(r);
    // among the ice the disc dissolves round her: the life-size pieces (RingField) are the ring there
    if (uNear > 0.0) ring.a *= smoothstep(uNear * 0.55, uNear, length(vPlane - uCamPlane));
    if (ring.a < 0.004) discard;
    vec3 rd = normalize(vWorld - cameraPosition);
    vec3 ro = (cameraPosition - uPlanet) / uRadius;
    float tRing = length(vWorld - cameraPosition) / uRadius;
    // behind the planet
    float th = hit(ro, rd);
    if (th > 0.0 && th < tRing) discard;
    // in the planet's shadow
    vec3 p = (vWorld - uPlanet) / uRadius;
    float ts = hit(p, uSun);
    float shadow = ts > 0.0 ? 0.04 : 1.0;
    // lit face vs the face away from the Sun: light diffuses through thin ring
    float sunSide = dot(uNormal, uSun);
    float viewSide = dot(uNormal, -rd);
    float same = sunSide * viewSide > 0.0 ? 1.0 : 0.0;
    float through = (1.0 - ring.a) * 0.6 + 0.08;
    float lit = mix(through, 1.0, same) * (0.35 + 0.65 * abs(sunSide)) * 1.4;
    // forward scattering toward a viewer looking at the Sun through the ring
    float fwd = pow(max(dot(rd, uSun), 0.0), 8.0) * 2.5;
    // Saturn's ringlets (km scale), the same grooves the near sheet draws
    float groove = 1.0;
    if (uStyle == 0 && uHasMap > 0.5) { float rk = r * 60268.0; groove = ringGrooves(rk, fwidth(rk)); }
    vec3 color = ring.rgb * groove * (lit + fwd) * shadow * uLight;
    // the slant path: seen low across the plane the line of sight crosses
    // more ice (tau / mu), so a ring near edge-on looks solid, as it does
    float mu = max(abs(viewSide), 0.015);
    float alpha = (1.0 - pow(max(1.0 - ring.a, 1e-4), 1.0 / mu)) * uFade;
    gl_FragColor = vec4(color * alpha, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`
