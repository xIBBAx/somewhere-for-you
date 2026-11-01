/**
 * GLSL for the memory wisps. Everything is evaluated on the GPU from a few
 * uniforms, so a wisp costs no per-frame CPU work beyond setting them.
 *
 * Space: the wisp group sits on the ground under its memory stop; y is up and
 * the core floats at uCoreH. Sizes are game metres converted to pixels with
 * the same convention as the wonders (projectionMatrix[1][1] · halfHeight / z).
 *
 * Every normalize/pow is guarded: one non-finite pixel blacks out the whole
 * half-float composer frame once bloom spreads it.
 */

/** Shared state every wisp program reads. */
const COMMON = /* glsl */ `
uniform float uTime;
uniform float uHalfH;
uniform float uCoreH;
uniform float uNear;     // 0 far .. 1 the explorer inside the stop's radius
uniform float uWake;     // 1 waiting to be found, 0 visited and resting
uniform float uPerform;  // 0..1 while the memory performs
uniform float uAbsorb;   // 0..1 energy flowing into the explorer after the card
uniform vec3 uTarget;    // the explorer's chest, in wisp space
uniform vec3 uHot;
uniform vec3 uCool;
uniform float uGain;

vec3 safeNormalize(vec3 v, vec3 fallback) {
  float l = length(v);
  return l > 1e-5 ? v / l : fallback;
}

// Quadratic arc from p to the target: lifts over the midpoint and swings
// sideways by a per-particle amount, so streams braid instead of stacking.
vec3 absorbPath(vec3 p, float k, float seed) {
  vec3 to = uTarget - p;
  vec3 side = safeNormalize(cross(to, vec3(0.0, 1.0, 0.0)), vec3(1.0, 0.0, 0.0));
  vec3 mid = p + to * 0.5 + vec3(0.0, 0.9 + seed * 0.8, 0.0) + side * (seed - 0.5) * 1.6;
  float a = 1.0 - k;
  return a * a * p + 2.0 * a * k * mid + k * k * uTarget;
}
`

/**
 * Motes: a flow field with six characters.
 * uM0 = r0, r1, rise, height     uM1 = turns, swirl, jitter, cycle
 * uM2 = size, mode, lean, dart   uDir = stream direction (xz) for mode 4
 * modes: 0 rising helix · 1 vortex ring · 2 rain · 3 darting · 4 stream · 5 steam
 */
export const MOTE_VS = /* glsl */ `
${COMMON}
attribute vec4 aSeed;
uniform vec4 uM0;
uniform vec4 uM1;
uniform vec4 uM2;
uniform vec2 uDir;
varying float vAlpha;
varying float vHeat;

void main() {
  float r0 = uM0.x, r1 = uM0.y, rise = uM0.z, span = uM0.w;
  float turns = uM1.x, swirl = uM1.y, jitter = uM1.z, cycle = uM1.w;
  float mode = uM2.y;
  // Resting wisps keep a quarter of their motes, slowed to a drift.
  float rest = 1.0 - uWake;
  float pace = mix(1.0, 0.35, rest) * (1.0 + uNear * 0.35 + uPerform * 1.4);
  float t = uTime * pace;
  float life = fract(t / cycle + aSeed.y);
  float ang = aSeed.x * 6.2832 + life * turns * 6.2832 + t * swirl;
  float rad = mix(r0, r1, aSeed.z);
  vec3 p;

  if (mode < 0.5) {
    // rising helix that narrows as it climbs, like breath leaving a body
    float r = rad * (1.0 - 0.55 * life);
    p = vec3(cos(ang) * r, uCoreH + (life - 0.5) * rise + (aSeed.z - 0.5) * span, sin(ang) * r);
  } else if (mode < 1.5) {
    // vortex ring: up the middle, out over the top, down the outside
    float th = life * 6.2832;
    float tube = 0.18 + aSeed.z * span;
    float ringR = rad;
    vec2 dir = vec2(cos(aSeed.x * 6.2832 + t * swirl), sin(aSeed.x * 6.2832 + t * swirl));
    float rr = ringR + tube * cos(th);
    p = vec3(dir.x * rr, uCoreH + tube * sin(th) * 1.25, dir.y * rr);
  } else if (mode < 2.5) {
    // rain: falls through a wide column, then lifts back up as a faint mist
    float fall = smoothstep(0.0, 0.82, life);
    float y = uCoreH + rise * (0.5 - fall);
    float r = rad * (0.6 + 0.4 * aSeed.w);
    p = vec3(cos(ang) * r, y, sin(ang) * r);
  } else if (mode < 3.5) {
    // darting: rests, then flicks to a new spot, like a cat's attention
    float tt = t * uM2.w + aSeed.y * 13.0;
    float step0 = floor(tt);
    float f = fract(tt);
    float e = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float s = step0 + e;
    float a2 = aSeed.x * 6.2832 + s * 2.399;
    float r = rad * (0.55 + 0.45 * sin(s * 1.7 + aSeed.z * 9.0));
    p = vec3(cos(a2) * r, uCoreH + sin(s * 2.3 + aSeed.w * 6.0) * span * 0.5, sin(a2) * r);
  } else if (mode < 4.5) {
    // stream: light running along the path ahead, arcing up and on
    vec3 fwd = vec3(uDir.x, 0.0, uDir.y);
    vec3 side = vec3(-uDir.y, 0.0, uDir.x);
    float along = (life - 0.25) * rise;
    float lane = (aSeed.z - 0.5) * r1 * 2.0;
    float arc = sin(life * 3.1416) * span;
    p = fwd * along + side * (lane + sin(ang) * r0) + vec3(0.0, uCoreH - 0.2 + arc + cos(ang) * r0 * 0.6, 0.0);
  } else {
    // steam: rises from the core and curls wider the higher it gets
    float h = life * rise;
    float curl = rad * (0.25 + 1.1 * life);
    p = vec3(cos(ang) * curl, uCoreH - 0.15 + h, sin(ang) * curl);
    p.xz += vec2(sin(h * 3.0 + aSeed.w * 6.0), cos(h * 2.6 + aSeed.x * 6.0)) * 0.12 * life;
  }

  // Turbulence: three crossed sine fields, divergence-light enough to read as drift.
  p += jitter * vec3(
    sin(t * 0.71 + aSeed.y * 31.0 + p.y * 2.1),
    sin(t * 0.93 + aSeed.x * 17.0 + p.x * 1.7) * 0.6,
    cos(t * 0.82 + aSeed.z * 23.0 + p.z * 1.9));

  // Rest: pull the field in close to the core.
  p = mix(p, vec3(p.x * 0.45, mix(uCoreH, p.y, 0.4), p.z * 0.45), rest);

  // Noticing the explorer: the field leans gently toward them.
  vec3 toward = safeNormalize(uTarget - p, vec3(0.0));
  p += toward * uNear * uM2.z * (0.35 + 0.65 * aSeed.w) * uWake;

  // Performing: everything gathers into a rising column above the core.
  vec3 column = vec3(p.x * 0.28, uCoreH + 0.2 + life * 2.6, p.z * 0.28);
  p = mix(p, column, uPerform * 0.85);

  // Absorbing: staggered streams arc into the explorer.
  float k = smoothstep(aSeed.y * 0.45, aSeed.y * 0.45 + 0.55, uAbsorb);
  p = absorbPath(p, k, aSeed.w);

  // envelope: born and gone softly, fewer motes while resting
  float keep = mix(1.0, step(aSeed.w, 0.25), rest);
  float env = sin(3.1416 * life);
  env = mode > 1.5 && mode < 2.5 ? env * (1.0 - smoothstep(0.82, 1.0, life) * 0.75) : env;
  env = mode > 0.5 && mode < 1.5 ? 0.55 + 0.45 * env : env;
  float twinkle = 0.7 + 0.3 * sin(uTime * (5.0 + aSeed.w * 7.0) + aSeed.x * 40.0);
  float arrive = (1.0 - smoothstep(0.86, 1.0, k)) * (1.0 + 1.8 * sin(3.1416 * k));
  vAlpha = env * twinkle * keep * arrive * mix(1.0, 0.55, rest) * (1.0 + uNear * 0.6 + uPerform * 0.8) * uGain;
  vHeat = clamp(1.0 - life * 0.7 + uPerform * 0.5 + k * 0.6, 0.0, 1.0);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float diameter = uM2.x * (0.55 + 0.9 * aSeed.w) * mix(1.0, 0.7, rest) * (1.0 + 1.6 * sin(3.1416 * k));
  float px = diameter * projectionMatrix[1][1] * uHalfH / max(-mv.z, 0.3);
  // Below ~2 px a mote stops shrinking and fades instead, so distant fields
  // never shimmer as subpixel noise.
  vAlpha *= clamp(px / 2.0, 0.0, 1.0);
  gl_PointSize = clamp(px, 2.0, 48.0);
  gl_Position = projectionMatrix * mv;
}
`

export const MOTE_FS = /* glsl */ `
uniform vec3 uHot;
uniform vec3 uCool;
varying float vAlpha;
varying float vHeat;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(q, q);
  if (d2 > 1.0 || vAlpha <= 0.002) discard;
  float core = exp(-d2 * 14.0);
  float halo = exp(-d2 * 4.5) * 0.18;
  vec3 col = mix(uCool, uHot, vHeat) * (core * 1.6 + halo) + vec3(core) * 0.35 * vHeat;
  gl_FragColor = vec4(col * vAlpha, 0.0);
}
`

/**
 * Filaments: thin ribbons of chi riding a torus knot around the core. Each
 * strand is a strip whose vertices sample the same curve a little further
 * back in time, so the ribbon is its own motion trail.
 * uF0 = p, q, radius, tube     uF1 = speed, trail, width, tilt
 * uF2 = yScale, yOffset, flicker, unused
 */
export const FILAMENT_VS = /* glsl */ `
${COMMON}
attribute float aStrand;
attribute float aSeg;
attribute float aSide;
uniform vec4 uF0;
uniform vec4 uF1;
uniform vec4 uF2;
varying float vSide;
varying float vSeg;
varying float vAlpha;
varying float vStrand;

vec3 knot(float s, float seed) {
  float P = uF0.x, Q = uF0.y, R = uF0.z, tube = uF0.w;
  float rr = R + tube * cos(Q * s);
  vec3 c = vec3(rr * cos(P * s), tube * sin(Q * s) * uF2.x + uF2.y, rr * sin(P * s));
  // each strand spins about y and tilts, so no two share a plane
  float a = seed * 6.2832;
  float ca = cos(a), sa = sin(a);
  c = vec3(ca * c.x - sa * c.z, c.y, sa * c.x + ca * c.z);
  float tl = (seed - 0.5) * uF1.w;
  float ct = cos(tl), st = sin(tl);
  c = vec3(c.x, ct * c.y - st * c.z, st * c.y + ct * c.z);
  return c;
}

void main() {
  float rest = 1.0 - uWake;
  float pace = mix(1.0, 0.3, rest) * (1.0 + uNear * 0.5 + uPerform * 1.8);
  float speed = uF1.x * pace;
  float s = uTime * speed + aStrand * 37.0 - aSeg * uF1.y;
  float breathe = 1.0 + 0.06 * sin(uTime * 1.3 + aStrand * 6.0);
  float scale = breathe * mix(1.0, 0.55, rest) * mix(1.0, 0.82, uNear) * (1.0 + uPerform * 0.35);
  vec3 P = knot(s, aStrand) * scale;
  vec3 P2 = knot(s + 0.02, aStrand) * scale;
  P.y += uCoreH + uPerform * aSeg * 0.9;
  P2.y += uCoreH + uPerform * aSeg * 0.9;

  // Absorb: the head leaves first and the tail follows it along the arc.
  float k = clamp(uAbsorb * 1.7 - aSeg * 0.55 - aStrand * 0.15, 0.0, 1.0);
  k = k * k * (3.0 - 2.0 * k);
  P = absorbPath(P, k, aStrand);
  P2 = absorbPath(P2, clamp(k + 0.01, 0.0, 1.0), aStrand);

  vec4 mv = modelViewMatrix * vec4(P, 1.0);
  vec3 tv = (modelViewMatrix * vec4(P2 - P, 0.0)).xyz;
  vec3 side = safeNormalize(cross(safeNormalize(tv, vec3(0.0, 1.0, 0.0)), safeNormalize(-mv.xyz, vec3(0.0, 0.0, 1.0))), vec3(1.0, 0.0, 0.0));

  float head = smoothstep(0.0, 0.05, aSeg);
  float taper = pow(max(1.0 - aSeg, 0.0), 0.7) * head;
  float w = uF1.z * taper * (1.0 + uPerform * 0.6 + sin(3.1416 * k) * 2.4);
  float pxPerM = projectionMatrix[1][1] * uHalfH / max(-mv.z, 0.3);
  // a ribbon thinner than a pixel aliases into dashes: hold 1 px and fade
  float fade = clamp(w * 2.0 * pxPerM, 0.0, 1.0);
  w = max(w, 0.5 / pxPerM);
  mv.xyz += side * aSide * w;

  float keep = mix(1.0, step(aStrand, 0.34), rest);
  vAlpha = fade * keep * (1.0 - smoothstep(0.88, 1.0, k)) * (1.0 + 1.8 * sin(3.1416 * k)) * mix(1.0, 0.4, rest) * (0.7 + uNear * 0.45 + uPerform * 0.45) * uGain;
  vSide = aSide;
  vSeg = aSeg;
  vStrand = aStrand;
  gl_Position = projectionMatrix * mv;
}
`

export const FILAMENT_FS = /* glsl */ `
uniform vec3 uHot;
uniform vec3 uCool;
uniform float uTime;
uniform vec4 uF2;
varying float vSide;
varying float vSeg;
varying float vAlpha;
varying float vStrand;
void main() {
  float across = exp(-vSide * vSide * 3.5);
  float hot = exp(-vSide * vSide * 18.0);
  float along = pow(max(1.0 - vSeg, 0.0), 1.6);
  // energy travelling down the strand, never a static gradient
  float pulse = 0.72 + 0.28 * sin(vSeg * 38.0 - uTime * 7.0 + vStrand * 21.0) * uF2.z
              + 0.18 * sin(vSeg * 11.0 - uTime * 2.3 + vStrand * 9.0);
  vec3 col = mix(uCool, uHot, along) * across + uHot * hot * 0.8 * along;
  float a = along * pulse * vAlpha;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(col * a, 0.0);
}
`

/**
 * Volumetric glow: the closed-form integral of a gaussian density along the
 * view ray, drawn on the back faces of a small sphere so it is correct from
 * outside and inside. Real depth, no sprite plane to catch at grazing angles.
 */
export const GLOW_VS = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

export const GLOW_FS = /* glsl */ `
uniform vec3 uCenter;
uniform float uSigma;
uniform float uDensity;
uniform vec3 uHot;
uniform vec3 uCool;
uniform float uTime;
varying vec3 vWorld;
void main() {
  vec3 rd = vWorld - cameraPosition;
  float len = length(rd);
  if (len < 1e-4) discard;
  rd /= len;
  vec3 oc = uCenter - cameraPosition;
  float along = max(dot(oc, rd), 0.0);
  vec3 closest = cameraPosition + rd * along;
  float d = length(closest - uCenter);
  float g = exp(-(d * d) / (uSigma * uSigma));
  // slow breathing lobes so the glow is never a perfect disc
  vec3 n = closest - uCenter;
  float lobes = 1.0 + 0.22 * sin(atan(n.z, n.x) * 3.0 + uTime * 0.6) * sin(n.y * 9.0 - uTime * 1.1);
  float a = g * uDensity * lobes;
  if (a <= 0.002) discard;
  vec3 col = mix(uCool, uHot, smoothstep(0.0, 1.0, g));
  gl_FragColor = vec4(col * a, 0.0);
}
`

/** The gem: faceted crystal lit from inside, with a heartbeat and facet glints. */
export const GEM_VS = /* glsl */ `
varying vec3 vView;
varying vec3 vObj;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  vObj = position;
  gl_Position = projectionMatrix * mv;
}
`

export const GEM_FS = /* glsl */ `
uniform vec3 uHot;
uniform vec3 uCool;
uniform float uTime;
uniform float uBeat;
uniform float uLit;
varying vec3 vView;
varying vec3 vObj;
void main() {
  vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
  vec3 v = normalize(-vView);
  float nv = clamp(abs(dot(n, v)), 0.0, 1.0);
  float fres = pow(1.0 - nv, 3.0);
  vec3 l = normalize(vec3(0.4, 0.8, 0.45));
  vec3 h = normalize(l + v);
  float glint = pow(max(dot(n, h), 0.0), 60.0);
  float inner = 0.55 + 0.45 * nv;
  vec3 col = mix(uCool, uHot, inner) * (0.9 + 1.1 * uBeat) * uLit + uCool * fres * 0.9 + vec3(glint) * 1.4;
  gl_FragColor = vec4(col, 1.0);
}
`
