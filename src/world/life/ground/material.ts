import * as THREE from "three"
import { BATCH } from "./roster"

/**
 * Lit, fogged MeshStandardMaterial per batch with all creature animation on
 * the GPU. Per-instance data:
 *   iAnim = (sub-kind, gait/wave phase, a, b)
 *     ants      a: antenna wiggle 0…1   b: carrying food (0/1)
 *     beetles   a: wing cases open 0…1  b: stag-beetle rear/mandible raise
 *     walkers   a: hind-leg kick 0…1    b: song (stridulation) / harvestman bob
 *     crawlers  a: curl / retract 0…1   b: snail foot stretch
 *   iTint = (linear rgb tint, variant)   variant: snail banding 0/1/2
 * Parts of a combined geometry that do not belong to the instance's sub-kind
 * collapse to a point, so one draw call serves several kinds.
 */
export const groundLifeUniforms = {
  uGLTime: { value: 0 },
}

const HEAD = /* glsl */ `
attribute float aKind;
attribute vec4 aRig;
attribute float aTint;
attribute vec4 iAnim;
attribute vec4 iTint;
uniform float uGLTime;
varying vec3 vGLObj;
varying vec4 vGLRig;
varying vec4 vGLAnim;
varying vec4 vGLTint;
mat2 glRot(float a) { float c = cos(a); float s = sin(a); return mat2(c, s, -s, c); }
bool glIs(float part, float id) { return abs(part - id) < 0.1; }
`

const FRAG_HEAD = /* glsl */ `
varying vec3 vGLObj;
varying vec4 vGLRig;
varying vec4 vGLAnim;
varying vec4 vGLTint;
`

/** Six-legged / eight-legged stepping; amplitude grows with the leg's reach. */
const GAIT = /* glsl */ `
if (glIs(aRig.x, 1.0)) {
  float g = iAnim.y + aRig.y;
  float reach = abs(position.x) * aRig.z;
  glP.z += sin(g) * 0.24 * reach;
  glP.y += max(0.0, cos(g)) * 0.12 * reach;
}
`

const antennae = (amp: string): string => /* glsl */ `
if (glIs(aRig.x, 2.0)) {
  float w = aRig.z * aRig.z * (${amp});
  glP.x += sin(uGLTime * 6.0 + aRig.y * 2.1 + iAnim.y * 0.2) * 0.05 * w;
  glP.y += sin(uGLTime * 4.3 + aRig.y * 1.7) * 0.04 * w;
}
`

const VERTEX: Record<number, string> = {
  [BATCH.ants]: GAIT + antennae("0.35 + iAnim.z * 1.4") + /* glsl */ `
if (glIs(aRig.x, 11.0) && iAnim.w < 0.5) glShow = false;
`,
  [BATCH.beetles]: GAIT + antennae("0.5") + /* glsl */ `
float wingOpen = iAnim.z;
// wing cases hinge at the front of the back: roll outward and tip up
if (glIs(aRig.x, 3.0) && wingOpen > 0.001) {
  vec3 H = iAnim.x < 0.5 ? vec3(0.0, 0.38, 0.2) : vec3(0.0, 0.17, 0.06);
  vec3 q = glP - H;
  q.xy = glRot(aRig.w * wingOpen * 0.95) * q.xy;
  q.zy = glRot(-wingOpen * 0.55) * q.zy;
  glP = H + q;
  glN.xy = glRot(aRig.w * wingOpen * 0.95) * glN.xy;
}
// membranous hind wings unfold from under the case and beat when flying
if (glIs(aRig.x, 4.0)) {
  float vis = smoothstep(0.25, 0.9, wingOpen);
  vec3 H = iAnim.x < 0.5 ? vec3(aRig.w * 0.04, 0.33, 0.0) : vec3(aRig.w * 0.03, 0.17, -0.05);
  vec3 q = (glP - H) * vis;
  if (wingOpen > 0.85) q.xy = glRot(aRig.w * sin(uGLTime * 58.0) * 0.75 * aRig.z) * q.xy;
  glP = H + q;
  if (vis < 0.01) glShow = false;
}
// stag beetle raises its antlers when it rears
if (glIs(aRig.x, 5.0) && iAnim.x > 1.5) {
  vec3 M = vec3(sign(position.x) * 0.08, 0.075, 0.25);
  vec3 q = glP - M;
  q.zy = glRot(iAnim.w * 0.4) * q.zy;
  glP = M + q;
}
`,
  [BATCH.walkers]: GAIT + antennae("0.6") + /* glsl */ `
// grasshopper/cricket hind legs: femur pivots at the hip, tibia unfolds to kick
if (glIs(aRig.x, 6.0)) {
  float side = aRig.w;
  bool cricket = iAnim.x > 0.5;
  vec3 Hp = cricket ? vec3(side * 0.06, 0.1, 0.02) : vec3(side * 0.055, 0.12, 0.1);
  vec3 K = cricket ? vec3(side * 0.14, 0.2, -0.28) : vec3(side * 0.1, 0.3, -0.25);
  float ext = iAnim.z;
  float rub = cricket ? 0.0 : sin(uGLTime * 26.0) * 0.09 * iAnim.w;
  float a = rub + ext * 0.25;
  vec3 q = glP - Hp; q.zy = glRot(a) * q.zy; glP = Hp + q;
  vec3 k = K - Hp; k.zy = glRot(a) * k.zy; K = Hp + k;
  if (aRig.y > 0.5) { vec3 r = glP - K; r.zy = glRot(-ext * 1.85) * r.zy; glP = K + r; }
}
// a singing cricket lifts its forewings and scissors them together
if (glIs(aRig.x, 4.0) && iAnim.x > 0.5 && iAnim.x < 1.5) {
  vec3 H = vec3(0.0, 0.2, 0.17);
  vec3 q = glP - H;
  q.zy = glRot(-iAnim.w * 0.55) * q.zy;
  q.x *= 1.0 + sin(uGLTime * 62.0) * 0.12 * iAnim.w;
  glP = H + q;
}
// a harvestman bobs its body between planted feet when alarmed
if (iAnim.x > 1.5) {
  float bob = iAnim.w * sin(uGLTime * 13.0) * 0.16;
  glP.y += bob * (glIs(aRig.x, 1.0) ? (1.0 - aRig.z) : 1.0);
}
`,
  [BATCH.crawlers]: GAIT + antennae("0.7") + /* glsl */ `
float sub = iAnim.x;
float curl = iAnim.z;
if (sub < 0.5) {
  // snail: foot stretches as it glides; withdraws into the shell
  float stretch = iAnim.w;
  if (glIs(aRig.x, 8.0) || glIs(aRig.x, 9.0)) {
    glP.z += max(0.0, glP.z + 0.1) * stretch * 0.16 - max(0.0, -glP.z - 0.1) * stretch * 0.05;
  }
  if (glIs(aRig.x, 9.0)) {
    glP.x += sin(uGLTime * 1.7 + aRig.w * 1.3) * 0.02 * aRig.z;
    glP.y += sin(uGLTime * 1.1 + aRig.w) * 0.012 * aRig.z;
    glP = mix(glP, vec3(0.0, 0.07, 0.4), smoothstep(0.0, 0.45, curl));
  }
  if (glIs(aRig.x, 8.0) || glIs(aRig.x, 9.0)) {
    vec3 A = vec3(0.11, 0.15, -0.06);
    glP = mix(glP, A + (glP - A) * 0.12, smoothstep(0.15, 1.0, curl));
  }
} else if (sub < 1.5) {
  // earthworm: peristaltic waves, a gentle meander, and a retreat down its burrow
  float s = aRig.y;
  float ph = iAnim.y;
  vec2 rc = vec2(glP.x, glP.y - 0.024);
  rc *= 1.0 + 0.17 * sin(s * 22.0 - ph * 2.0);
  glP.x = rc.x + sin(s * 4.5 + ph * 0.35) * 0.03 * (0.3 + s);
  glP.y = rc.y + 0.024;
  glP.z += cos(s * 22.0 - ph * 2.0) * 0.008;
  float zz = glP.z - curl * 1.04;
  if (zz < -0.5) { glP.y -= (-0.5 - zz); glP.z = -0.5; } else glP.z = zz;
} else if (sub < 2.5) {
  // pill woodlouse rolls into a ball, back outward (bend about x, centre below)
  float k = max(curl * 5.7, 0.001);
  if (curl > 0.001) {
    float a = glP.z * k;
    float r = glP.y + 1.0 / k;
    glP.z = r * sin(a);
    glP.y = r * cos(a) - 1.0 / k + (1.0 - cos(min(3.14159, 0.5 * k))) / k;
    glN.zy = glRot(-a) * glN.zy;
  }
} else {
  // millipede: body sways as leg waves ripple along; coils into a flat spiral
  float s = clamp(glP.z + 0.5, 0.0, 1.0);
  float ph = iAnim.y;
  if (glIs(aRig.x, 1.0)) {
    float g = aRig.y * 48.0 - ph * 3.0 + aRig.w * 0.6;
    glP.z += sin(g) * 0.012 * aRig.z;
    glP.y += max(0.0, cos(g)) * 0.008 * aRig.z;
  }
  glP.x += sin(s * 5.0 - ph * 0.4) * 0.012;
  if (curl > 0.001) {
    float Rout = 0.23; float Rin = 0.06; float Th = 6.9;
    float aa = (Rout - Rin) / (2.0 * Th);
    float u = clamp(glP.z + 0.5, 0.0, 1.0);
    float th = (Rout - sqrt(max(0.0, Rout * Rout - 4.0 * aa * u))) / (2.0 * aa);
    float R = Rout - (Rout - Rin) * th / Th;
    float dR = -(Rout - Rin) / Th;
    vec2 t = normalize(vec2(dR * cos(th) - R * sin(th), dR * sin(th) + R * cos(th)));
    vec2 n = vec2(t.y, -t.x);
    vec3 coiled = vec3(R * cos(th) + n.x * glP.x, glP.y, R * sin(th) + n.y * glP.x);
    float e = smoothstep(0.0, 1.0, curl);
    glP = mix(glP, coiled, e);
    float psi = atan(t.x, t.y);
    vec2 nn = vec2(glN.x * cos(psi) + glN.z * sin(psi), -glN.x * sin(psi) + glN.z * cos(psi));
    glN.xz = mix(glN.xz, nn, e);
  }
}
`,
  [BATCH.nests]: "",
}

const FRAGMENT: Record<number, string> = {
  [BATCH.beetles]: /* glsl */ `
// seven-spot ladybird: three spots per wing case plus one shared at the front
if (vGLAnim.x < 0.5 && abs(vGLRig.x - 3.0) < 0.1) {
  vec2 q = vec2(abs(vGLObj.x), vGLObj.z);
  float spot = 1.0 - smoothstep(0.065, 0.085, length(vec2(vGLObj.x, vGLObj.z - 0.2)));
  spot = max(spot, 1.0 - smoothstep(0.08, 0.1, length(q - vec2(0.2, 0.06))));
  spot = max(spot, 1.0 - smoothstep(0.095, 0.115, length(q - vec2(0.25, -0.14))));
  spot = max(spot, 1.0 - smoothstep(0.07, 0.09, length(q - vec2(0.13, -0.34))));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012), spot);
}
`,
  [BATCH.crawlers]: /* glsl */ `
// brown-lipped snail: spiral bands (none, one or five) and the dark lip
if (vGLAnim.x < 0.5 && abs(vGLRig.x - 7.0) < 0.1) {
  float phi = vGLRig.y;
  float t = vGLRig.z;
  float v = vGLTint.w;
  float w = 0.04;
  float band = 0.0;
  if (v > 0.5) band = max(band, 1.0 - smoothstep(w * 0.55, w, abs(phi - 0.04)));
  if (v > 1.5) {
    band = max(band, 1.0 - smoothstep(w * 0.55, w, abs(phi - 0.27)));
    band = max(band, 1.0 - smoothstep(w * 0.55, w, abs(phi - 0.16)));
    band = max(band, 1.0 - smoothstep(w * 0.55, w, abs(phi + 0.1)));
    band = max(band, 1.0 - smoothstep(w * 0.55, w, abs(phi + 0.22)));
  }
  band *= smoothstep(0.12, 0.45, t);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.028, 0.016), band * 0.92);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.03, 0.018), smoothstep(0.972, 0.99, t));
  diffuseColor.rgb *= 0.92 + 0.08 * sin(t * 240.0);
}
`,
}

/** View-dependent sheen (after normals exist, before lighting). */
const SHEEN: Record<number, string> = {
  [BATCH.beetles]: /* glsl */ `
if (vGLAnim.x > 0.5 && vGLAnim.x < 1.5) {
  float fres = pow(max(1.0 - abs(dot(normalize(vViewPosition), normal)), 0.0), 2.0);
  diffuseColor.rgb += vec3(0.16, 0.05, 0.34) * fres * 0.9;
}
`,
}

const ROUGHNESS: Record<number, number> = {
  [BATCH.ants]: 0.42,
  [BATCH.beetles]: 0.32,
  [BATCH.walkers]: 0.55,
  [BATCH.crawlers]: 0.4,
  [BATCH.nests]: 0.97,
}

export const createGroundLifeMaterial = (batch: number): THREE.MeshStandardMaterial => {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: ROUGHNESS[batch] ?? 0.5,
    metalness: 0,
    side: THREE.DoubleSide,
  })
  const vertex = VERTEX[batch] ?? ""
  const fragment = FRAGMENT[batch] ?? ""
  const sheen = SHEEN[batch] ?? ""
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGLTime = groundLifeUniforms.uGLTime
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${HEAD}`)
      .replace(
        "#include <beginnormal_vertex>",
        /* glsl */ `
vec3 glP = position;
vec3 glN = normal;
bool glShow = aKind < -0.5 || abs(aKind - iAnim.x) < 0.1;
vGLObj = position;
vGLRig = aRig;
vGLAnim = iAnim;
vGLTint = iTint;
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
  vColor.rgb = mix(vColor.rgb, iTint.rgb, aTint);
#endif
${vertex}
if (!glShow) glP = vec3(0.0);
vec3 objectNormal = glN;
#ifdef USE_TANGENT
  vec3 objectTangent = vec3( tangent.xyz );
#endif
`,
      )
      .replace("#include <begin_vertex>", "vec3 transformed = glP;")
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAG_HEAD}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${fragment}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${sheen}`)
  }
  material.customProgramCacheKey = () => `ground-life-${batch}-v2`
  return material
}
