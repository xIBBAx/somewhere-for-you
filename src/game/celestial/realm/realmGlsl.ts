import { CALM_MAX, CRATER_CELLS } from "./realmTerrain"

/**
 * The GPU twin of realmTerrain.ts: the same hash (integer arithmetic), the
 * same crater field and the same elevation sampling, so the drawn ground is
 * the ground the feet stand on.
 */
export const REALM_GLSL = /* glsl */ `
uniform mat3 uLocalToBody;
uniform float uRealmR;
uniform vec2 uRealmO;        // the frame origin in render space
uniform sampler2D uElev;
uniform float uHasElev;
uniform float uCraters;
uniform float uCraterDepth;
uniform float uHills;
uniform float uDatum;
uniform vec4 uCalm[${CALM_MAX}];   // historic sites kept clear of craters: body direction, radius (m)
uniform int uCalmN;

uint realmHash(int x, int y, int z) {
  uint h = uint(x ^ 0x27d4eb2d) * 0x165667b1u;
  h = (h ^ (h >> 15u) ^ uint(y)) * 0x27d4eb2du;
  h = (h ^ (h >> 13u) ^ uint(z)) * 0x165667b1u;
  h ^= h >> 16u;
  return h;
}
float realmUnit(uint h, uint shift) { return float((h >> shift) & 1023u) / 1023.0; }

float realmValueNoise(vec3 p) {
  vec3 i = floor(p), f = p - i;
  vec3 s = f * f * (3.0 - 2.0 * f);
  ivec3 c = ivec3(i);
  float n000 = float(realmHash(c.x, c.y, c.z) & 65535u) / 65535.0;
  float n100 = float(realmHash(c.x + 1, c.y, c.z) & 65535u) / 65535.0;
  float n010 = float(realmHash(c.x, c.y + 1, c.z) & 65535u) / 65535.0;
  float n110 = float(realmHash(c.x + 1, c.y + 1, c.z) & 65535u) / 65535.0;
  float n001 = float(realmHash(c.x, c.y, c.z + 1) & 65535u) / 65535.0;
  float n101 = float(realmHash(c.x + 1, c.y, c.z + 1) & 65535u) / 65535.0;
  float n011 = float(realmHash(c.x, c.y + 1, c.z + 1) & 65535u) / 65535.0;
  float n111 = float(realmHash(c.x + 1, c.y + 1, c.z + 1) & 65535u) / 65535.0;
  float x00 = mix(n000, n100, s.x), x10 = mix(n010, n110, s.x), x01 = mix(n001, n101, s.x), x11 = mix(n011, n111, s.x);
  return mix(mix(x00, x10, s.y), mix(x01, x11, s.y), s.z);
}

float craterProfile(float x, float depth, float rim) {
  if (x < 1.0) return -depth + (depth + rim) * x * x;
  if (x < 2.6) { float t = (x - 1.0) / 1.6; return rim * (1.0 - t) * (1.0 - t) * (1.0 - t) * exp(-t); }
  return 0.0;
}

float realmCraters(vec3 d) {
  if (uCraters <= 0.0) return 0.0;
  vec3 a = abs(d);
  int face; vec2 uv;
  if (a.x >= a.y && a.x >= a.z) { face = d.x > 0.0 ? 0 : 1; uv = vec2(d.y, d.z) / a.x; }
  else if (a.y >= a.z) { face = d.y > 0.0 ? 2 : 3; uv = vec2(d.x, d.z) / a.y; }
  else { face = d.z > 0.0 ? 4 : 5; uv = vec2(d.x, d.y) / a.z; }
  uv *= uRealmR;
  float h = 0.0;
  float cells[${CRATER_CELLS.length}] = float[](${CRATER_CELLS.map((c) => c.toFixed(3)).join(", ")});
  for (int k = 0; k < ${CRATER_CELLS.length}; k++) {
    float s = cells[k];
    ivec2 c = ivec2(floor(uv / s));
    int reach = k < 2 ? 1 : 0;
    for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++) {
      if (abs(ox) > reach || abs(oy) > reach) continue;
      uint hh = realmHash(c.x + ox + face * 7919, c.y + oy, k * 131 + 17);
      if (realmUnit(hh, 0u) > uCraters * 0.62) continue;
      float r = s * (0.12 + 0.26 * realmUnit(hh, 10u));
      vec2 p = (vec2(float(c.x + ox), float(c.y + oy)) + vec2(0.3 + 0.4 * realmUnit(hh, 20u), 0.3 + 0.4 * realmUnit(hh, 5u))) * s;
      float dist = length(uv - p);
      if (dist > r * 2.6) continue;
      float fresh = 0.45 + 0.55 * realmUnit(hh, 15u);
      h += craterProfile(dist / r, 2.0 * r * uCraterDepth * fresh, 2.0 * r * 0.045 * fresh);
    }
  }
  return h;
}

// body-fixed unit direction of a render-space point on the ground
vec3 realmDir(vec2 xz) {
  vec2 d = xz - uRealmO;
  float L = length(d);
  float th = L / uRealmR;
  vec2 n = L > 1e-6 ? d / L : vec2(0.0);
  return normalize(uLocalToBody * vec3(sin(th) * n.x, cos(th), sin(th) * n.y));
}

float realmCalm(vec3 dir) {
  float f = 1.0;
  for (int i = 0; i < ${CALM_MAX}; i++) {
    if (i >= uCalmN) break;
    float arc = acos(clamp(dot(dir, uCalm[i].xyz), -1.0, 1.0)) * uRealmR;
    float t = clamp((arc - uCalm[i].w) / (uCalm[i].w * 1.2), 0.0, 1.0);
    f = min(f, t * t * (3.0 - 2.0 * t));
  }
  return f;
}

float realmHeightDir(vec3 dir) {
  float h = 0.0;
  if (uHasElev > 0.5) {
    float lon = atan(dir.y, dir.x), lat = asin(clamp(dir.z, -1.0, 1.0));
    h += texture2D(uElev, vec2(lon / 6.2831853 + 0.5, lat / 3.14159265 + 0.5)).r;
  }
  if (uHills > 0.0) {
    vec3 p = dir * (uRealmR / 900.0);
    h += (realmValueNoise(p) - 0.5) * uHills * 2.0 + (realmValueNoise(p * 3.1) - 0.5) * uHills * 0.5;
  }
  if (uCraters > 0.0) h += realmCraters(dir) * (uCalmN > 0 ? realmCalm(dir) : 1.0);
  h += (realmValueNoise(dir * (uRealmR / 3.5)) - 0.5) * 0.16;
  return uDatum + h;
}
`
