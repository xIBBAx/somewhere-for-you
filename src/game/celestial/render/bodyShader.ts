import { SOLAR_SURFACE_GLSL } from "./solarSurface"

/**
 * One shader for every world: the sphere (or spheroid) is ray-traced inside
 * a proxy shell, so its limb is exact from low orbit to a dot across the
 * system and never shows facets. Work is done in units of the body's radius,
 * so the numbers stay well conditioned at any distance.
 *
 *   kind 0  airless rock and ice: Lommel-Seeliger with a Lambert share (the
 *           Moon's flat full face and soft terminator), earthshine-dim night
 *   kind 1  Earth: Blue Marble day, Black Marble city lights, real clouds
 *           with their shadows, ocean glint, relief from GEBCO
 *   kind 2  gas and ice giants: banded cloud tops with limb darkening
 *   kind 3  the Sun: limb-darkened photosphere (u = 0.6) with granulation
 *   kind 4  wholly hazy worlds (Venus, Titan): only the haze is seen
 *
 * Bodies with air get single scattering through an exponential atmosphere
 * (Rayleigh + Mie): the view ray is sampled densely near its lowest point,
 * where the air is thickest, and sunlight's optical depth at each sample
 * uses Schüler's approximation to the Chapman grazing-incidence function
 * (GPU Pro 3, 2012), so the blue limb, the haze over the ground and the
 * orange terminator come out of the same physics.
 */

export const BODY_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vCenter;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

export const BODY_FRAGMENT = /* glsl */ `
  uniform int uKind;
  uniform float uTrueRadius;  // uncompressed game units, for solid surface depth
  uniform mat4 projectionMatrix;
  uniform float uSolarTime;
  uniform float uSolarDetail;
  uniform float uRadius;      // render units
  uniform float uOblate;      // flattening
  uniform float uShell;       // atmosphere top / radius (1 = no air)
  uniform mat3 uToBody;       // local axes → body-fixed axes (z = pole)
  uniform vec3 uSun;          // local axes, from the body toward the Sun
  uniform float uLight;       // sunlight on this body (exposure-scaled)
  uniform vec3 uTint;
  uniform float uAlbedo;
  uniform sampler2D uMap;
  uniform float uHasMap;
  uniform float uGrey;        // greyscale map tinted by uTint
  uniform float uFade;
  uniform float uTime;
  // air
  uniform vec3 uBetaR;        // per radius unit
  uniform float uHR;          // scale heights, radius units
  uniform float uBetaM;
  uniform float uHM;
  uniform vec3 uHazeColor;
  uniform float uHaze;
  uniform float uSkyWeight;   // above-horizon air (0 while the home sky dome still draws it)
  // Earth
  uniform sampler2D uNight;
  uniform sampler2D uClouds;
  uniform sampler2D uNormal;
  uniform sampler2D uWater;
  uniform float uCloudShift;
  uniform float uHomeCloud;   // the weather at home under the camera
  uniform vec3 uAirglow;      // emission layer: radius, gaussian sigma (radius units), strength (0 = none)
  // rings (shadows on the planet)
  uniform sampler2D uRingMap;
  uniform vec2 uRing;         // inner, outer in radius units (0 = none)
  varying vec3 vWorld;
  varying vec3 vCenter;

  const float PI = 3.14159265;

  vec2 sphere(vec3 ro, vec3 rd, float r) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - r * r;
    float h = b * b - c;
    if (h < 0.0) return vec2(1e9, -1e9);
    h = sqrt(h);
    // stable roots. Not sign(b): it is 0 for a ray at exactly right angles to
    // the radius (a level ray), and from inside the shell c / q was then
    // c / -0.0 = +Inf, which the scattering march turned into NaN: a row of
    // NaN pixels that bloom smeared over the whole frame (the ~110-150 km
    // blackout on the way up).
    float q = b >= 0.0 ? -b - h : -b + h;
    if (q == 0.0) return vec2(0.0);
    float t0 = q, t1 = c / q;
    if (b > 0.0) { t0 = c / q; t1 = q; }
    return vec2(min(t0, t1), max(t0, t1));
  }

  // NaN or ±Inf, by the bits: compilers may fold isnan() away under fast math
  bool nonFinite(float x) { return (floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u; }

  vec2 equirect(vec3 n) {
    float lon = atan(n.y, n.x);
    float lat = asin(clamp(n.z, -1.0, 1.0));
    return vec2(lon / (2.0 * PI) + 0.5, lat / PI + 0.5);
  }

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float noise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n = i.x + i.y * 57.0 + i.z * 113.0;
    vec4 a = fract(sin(vec4(n, n + 1.0, n + 57.0, n + 58.0)) * 43758.5453);
    vec4 b = fract(sin(vec4(n + 113.0, n + 114.0, n + 170.0, n + 171.0)) * 43758.5453);
    vec4 m = mix(a, b, f.z);
    return mix(mix(m.x, m.y, f.x), mix(m.z, m.w, f.x), f.y);
  }

  ${SOLAR_SURFACE_GLSL}

  // Schüler's Chapman function: relative optical depth along a ray from
  // height h (scale heights) at zenith cosine cz, for planet radius X (scale heights)
  float chapman(float X, float h, float cz) {
    float c = sqrt(X + h);
    if (cz >= 0.0) return c / (c * cz + 1.0) * exp(-h);
    float x0 = sqrt(max(1.0 - cz * cz, 0.0)) * (X + h);
    float c0 = sqrt(x0);
    return 2.0 * c0 * exp(min(X - x0, 60.0)) - c / (1.0 - c * cz) * exp(-h);
  }

  // height over the surface; on a flattened giant, over its spheroid
  float gK = 1.0;
  float heightOf(vec3 p) {
    vec3 b = uToBody * p;
    return length(vec3(b.xy, b.z * gK)) - 1.0;
  }

  vec3 sunTransmit(vec3 p) {
    float r = length(p);
    float cz = dot(p / r, uSun);
    float h = max(heightOf(p), 0.0);
    float tauR = uHR * chapman(1.0 / uHR, h / uHR, cz);
    float tauM = uHM * chapman(1.0 / uHM, h / uHM, cz);
    return exp(-(uBetaR * tauR + uBetaM * 1.1 * tauM));
  }

  float ringAlpha(float r) {
    if (uRing.y <= 0.0 || r < uRing.x || r > uRing.y) return 0.0;
    float u = (r - uRing.x) / (uRing.y - uRing.x);
    return texture2D(uRingMap, vec2(u, 0.5)).a;
  }

  // scattering along [t0, t1] of the ray, sampled densely near its lowest
  // point (tca) where the air is thickest: first the stretch from tca back
  // toward the eye, then from tca onward. Light scattered at a sample is
  // dimmed by the air between it and the eye.
  void scatter(vec3 ro, vec3 rd, float t0, float t1, out vec3 inscat, out vec3 trans) {
    inscat = vec3(0.0);
    trans = vec3(1.0);
    if (t1 <= t0) return;
    float tca = clamp(-dot(ro, rd), t0, t1);
    float mu = dot(rd, uSun);
    float phaseR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
    float g = 0.76;
    float phaseM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
    vec3 betaM = vec3(uBetaM * 1.1);
    // eye side: optical depth measured from tca; the eye→sample depth is the
    // stretch's total minus that, applied once the total is known
    vec3 od = vec3(0.0);
    vec3 nearR = vec3(0.0), nearM = vec3(0.0);
    float prev = tca;
    for (int i = 1; i <= 12; i++) {
      float x = float(i) / 12.0;
      float t = mix(tca, t0, x * x);
      float ds = prev - t;
      float tm = 0.5 * (t + prev);
      prev = t;
      vec3 p = ro + rd * tm;
      float h = max(heightOf(p), 0.0);
      float dR = exp(-h / uHR) * ds, dM = exp(-h / uHM) * ds;
      od += uBetaR * dR + betaM * dM;
      vec3 w = sunTransmit(p) * exp(min(od, vec3(60.0)));
      nearR += dR * w;
      nearM += dM * w;
    }
    vec3 eyeToTca = exp(-od);
    vec3 sumR = nearR * eyeToTca, sumM = nearM * eyeToTca;
    // far side: straight accumulation outward
    vec3 od2 = od;
    prev = tca;
    for (int i = 1; i <= 12; i++) {
      float x = float(i) / 12.0;
      float t = mix(tca, t1, x * x);
      float ds = t - prev;
      float tm = 0.5 * (t + prev);
      prev = t;
      vec3 p = ro + rd * tm;
      float h = max(heightOf(p), 0.0);
      float dR = exp(-h / uHR) * ds, dM = exp(-h / uHM) * ds;
      od2 += uBetaR * dR + betaM * dM;
      vec3 w = sunTransmit(p) * exp(-od2);
      sumR += dR * w;
      sumM += dM * w;
    }
    trans = exp(-od2);
    inscat = (sumR * uBetaR * phaseR + sumM * betaM * phaseM) * 13.0;
  }

  /**
   * Airglow: light emitted by the upper atmosphere itself (chiefly atomic
   * oxygen's green 557.7 nm line, in a layer near 95 km). Integrated exactly
   * along the ray in the chord parameter u = sqrt(r^2 - b^2) (b the ray's
   * closest approach to the centre), so the grazing limb, where the column
   * is ~50x the vertical one, is as smooth as the view straight down.
   * Returns the column density through the layer (radius units) before t1,
   * counting only the stretches of it in darkness: on the day side scattered
   * sunlight is hundreds of times brighter, so there the glow is not seen.
   */
  float airglowColumn(vec3 ro, vec3 rd, float t1) {
    float s0 = -dot(ro, rd);
    vec3 pc = ro + rd * s0;
    float b2 = dot(pc, pc);
    float b = sqrt(b2);
    float r0 = uAirglow.x, sig = uAirglow.y;
    float rHi = r0 + 4.0 * sig;
    if (b > rHi) return 0.0;
    float rLo = max(b, r0 - 4.0 * sig);
    float uLo = sqrt(max(rLo * rLo - b2, 0.0));
    // a ray grazing the layer's top: b <= rHi can still round to b2 > rHi^2,
    // and the sqrt of that tiny negative was NaN (a few pixels on the limb)
    float uHi = sqrt(max(rHi * rHi - b2, 0.0));
    float col = 0.0;
    float du = (uHi - uLo) / 14.0;
    for (int i = 0; i < 14; i++) {
      float u = uLo + (float(i) + 0.5) * du;
      float r = sqrt(b2 + u * u);
      float g = exp(-0.5 * (r - r0) * (r - r0) / (sig * sig)) * du;
      // both crossings of the layer, each only where the ray actually is (in front, above the ground)
      float tn = s0 - u, tf = s0 + u;
      // darkness at each crossing: the Sun below that point's horizon (twilight fading in)
      float dn = smoothstep(0.1, -0.12, dot(normalize(ro + rd * tn), uSun));
      float df = smoothstep(0.1, -0.12, dot(normalize(ro + rd * tf), uSun));
      col += g * (step(0.0, tn) * step(tn, t1) * dn + step(0.0, tf) * step(tf, t1) * df);
    }
    return col;
  }

  void main() {
    vec3 rd = normalize(vWorld - cameraPosition);
    vec3 ro = (cameraPosition - vCenter) / uRadius;
    // spheroids: squash the polar axis into a sphere
    vec3 roB = uToBody * ro;
    vec3 rdB = uToBody * rd;
    float k = 1.0 / (1.0 - uOblate);
    gK = k;
    vec3 roS = vec3(roB.xy, roB.z * k);
    vec3 rdSraw = vec3(rdB.xy, rdB.z * k);
    float lenS = length(rdSraw);
    vec3 rdS = rdSraw / lenS;
    vec2 hit = sphere(roS, rdS, 1.0);
    bool ground = hit.x < 1e8 && hit.y > 0.0;
    float tHit = max(hit.x, 0.0) / lenS; // back in the unsquashed ray's parameter
    vec2 shell = sphere(ro, rd, uShell);
    bool air = uShell > 1.0001 && shell.y > 0.0;
    if (!ground && !air) discard;

    // Only the Sun writes solid depth. Project the real ray intersection,
    // not the compressed proxy shell, so foreground riders/field echoes stay
    // in front and an object behind the photosphere cannot shine through it.
    gl_FragDepth = gl_FragCoord.z;
    if (uKind == 3) {
      gl_FragDepth = 1.0;
      if (ground) {
        vec3 eyePoint = mat3(viewMatrix) * rd * (tHit * uTrueRadius);
        vec4 clip = projectionMatrix * vec4(eyePoint, 1.0);
        gl_FragDepth = clamp(0.5 + 0.5 * clip.z / max(clip.w, 1e-6), 0.0, 1.0);
      }
    }

    vec3 sunB = uToBody * uSun;
    vec3 color = vec3(0.0);
    float alpha = 1.0;

    if (ground) {
      vec3 p = ro + rd * tHit;                // local axes, radius units
      vec3 pB = uToBody * p;
      vec3 nB = normalize(vec3(pB.xy, pB.z * k * k));  // spheroid normal
      vec3 sB = normalize(vec3(pB.xy, pB.z * k));       // for the map
      vec2 uv = equirect(sB);
      float sunN = dot(nB, sunB);
      vec3 v = -rdB;
      if (uKind == 3) {
        float mu = max(dot(nB, v), 0.0);
        color = solarPhotosphere(sB, mu);
      } else if (uKind == 1) {
        // ---- Earth (the intro's maps and look)
        vec3 east = normalize(cross(vec3(0.0, 0.0, 1.0), nB) + vec3(1e-5, 0.0, 0.0));
        vec3 north = cross(nB, east);
        vec3 tn = texture2D(uNormal, uv).xyz * 2.0 - 1.0;
        vec3 surfN = normalize(nB + (east * tn.x + north * tn.y) * 0.55);
        float lambert = max(dot(surfN, sunB), 0.0);
        float daylight = smoothstep(-0.08, 0.22, sunN);
        vec3 day = pow(texture2D(uMap, uv).rgb, vec3(2.2));
        float water = texture2D(uWater, uv).r;
        // near home the clouds follow the weather there
        float cloud = texture2D(uClouds, uv + vec2(uCloudShift, 0.0)).r;
        float shade = texture2D(uClouds, uv + vec2(uCloudShift - 0.0015, 0.0008)).r;
        vec3 sTerm = sunTransmit(p);
        color = day * (lambert * 1.25 + 0.012) * (1.0 - shade * 0.45 * daylight) * sTerm;
        vec3 h = normalize(sunB + v);
        float glint = pow(max(dot(nB, h), 0.0), 120.0) * 2.4 + pow(max(dot(nB, h), 0.0), 18.0) * 0.12;
        color += vec3(1.0, 0.93, 0.8) * glint * water * daylight * sTerm;
        vec3 night = texture2D(uNight, uv).rgb;
        float glow = max(dot(night, vec3(0.62, 0.38, 0.0)) - 0.13, 0.0);
        color += vec3(1.0, 0.72, 0.38) * pow(glow * 1.6, 1.6) * (1.0 - smoothstep(-0.2, 0.08, sunN)) * 1.6 * (1.0 - cloud * 0.7);
        float c = smoothstep(0.08, 0.9, cloud);
        vec3 cloudLit = vec3(1.0, 0.99, 0.97) * 1.1 * (max(sunN, 0.0) * 0.95 + 0.03) * sTerm;
        color = mix(color, cloudLit, c * 0.95);
        color *= uLight;
      } else {
        vec3 albedo = uHasMap > 0.5 ? pow(texture2D(uMap, uv).rgb, vec3(2.2)) : uTint;
        // greyscale mosaics (the USGS moon maps) take the world's own colour,
        // kept partly neutral so bright ices stay white
        if (uGrey > 0.5) {
          float g = dot(albedo, vec3(0.333));
          albedo = mix(vec3(g), g * uTint / max(dot(uTint, vec3(0.333)), 1e-3), 0.55);
        }
        float mu0 = max(sunN, 0.0);
        float mu = max(dot(nB, v), 0.0);
        if (uKind == 2) {
          // banded giants: gentle limb darkening and a slow drift of the belts
          float lambert = smoothstep(-0.02, 0.6, sunN) * 0.55 + mu0 * 0.6;
          float limb = pow(max(mu, 0.0), 0.25);
          color = albedo * lambert * limb * 1.15;
        } else {
          // Lommel-Seeliger plus a little Lambert, and the faintest night
          float ls = mu0 / max(mu0 + mu, 1e-3);
          color = albedo * (ls * 1.35 + mu0 * 0.45) * uAlbedo * 4.0;
          color += albedo * 0.0025;
        }
        // ring shadows across the planet
        if (uRing.y > 0.0 && abs(sunB.z) > 1e-4) {
          float tr = -pB.z / sunB.z;
          if (tr > 0.0) color *= 1.0 - ringAlpha(length((pB + sunB * tr).xy)) * 0.85;
        }
        if (uShell > 1.0001) color *= sunTransmit(p);
        color *= uLight;
      }
    }

    if (uKind == 3 && !ground) color = solarCorona(ro, rd);

    if (air && uKind != 3) {
      float t0 = max(shell.x, 0.0);
      float t1 = ground ? tHit : shell.y;
      vec3 inscat, trans;
      scatter(ro, rd, t0, t1, inscat, trans);
      // above the horizon the home sky dome already draws the air near the ground
      float w = ground ? 1.0 : uSkyWeight;
      if (uKind == 4 && ground) {
        // a world wrapped in haze shows only its sunlit haze, darkening to the limb
        vec3 n = normalize(ro + rd * tHit);
        float mu0 = max(dot(n, uSun), 0.0);
        float muv = max(dot(n, -rd), 0.0);
        color = uHazeColor * (smoothstep(-0.05, 0.5, dot(n, uSun)) * 0.75 + mu0 * 0.35) * pow(muv, 0.3) * uLight;
      }
      if (ground) color = color * trans + inscat * uLight;
      else color = inscat * uLight * w;
      if (uAirglow.z > 0.0) {
        // a faint green emission of its own (oxygen, 557.7 nm): a thin thread
        // along the night limb about as bright as the Milky Way, never a band
        float colm = airglowColumn(ro, rd, t1);
        // looking straight down the column is ~sigma·2.5 (radius units); seen
        // that way it tinted the whole night disc green over the corridor's
        // galaxy ring, so only the slant columns of the limb keep their glow
        colm = max(colm - uAirglow.y * 4.0, 0.0);
        color += vec3(0.32, 1.0, 0.45) * colm * 1.0 * uAirglow.z;
      }
    }
    // premultiplied: the solid ball covers what is behind it, the air only adds
    alpha = ground ? uFade : 0.0;
    // never hand the frame a non-finite value: in the HDR chain one such pixel
    // spreads through the bloom over the whole picture
    if (nonFinite(color.r) || nonFinite(color.g) || nonFinite(color.b)) color = vec3(0.0);
    gl_FragColor = vec4(color * uFade, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`
