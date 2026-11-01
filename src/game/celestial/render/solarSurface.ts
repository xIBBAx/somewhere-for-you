/** The tiny daylight Sun keeps its glare. A resolved disc is exposed like a
 * solar-observatory camera: bright enough to glow, with room for dark lanes
 * and hot faculae before the shared Neutral highlight roll-off. Pixel radius
 * makes the adaptation continuous across camera FOV, screen size and travel. */
export const solarExposure = (pixelRadius: number): number => {
  const x = Math.max(0, Math.min(1, (pixelRadius - 5) / 55))
  const resolved = x * x * (3 - 2 * x)
  return 6 + (1.2 - 6) * resolved
}

/** No temporal surface advection when reduced motion is requested. */
export const solarTime = (seconds: number, reducedMotion: boolean): number => reducedMotion ? 0 : seconds

/** Bounded, three-dimensional detail on the actual ray-traced surface. A
 * golden observatory-like close exposure borrows the connected heat patterns
 * of SDO's EUV images; it is an artistic viewing treatment, not a claim that
 * their false colours are solar albedo. Coordinates rotate with the star. */
export const SOLAR_SURFACE_GLSL = /* glsl */ `
  // Dedicated, sin-free 3D hash: the old scalar index i.x+57*i.y+113*i.z
  // correlated adjacent solar samples into long woven strings at disc scale.
  float solarHash(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float solarNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(mix(mix(solarHash(i), solarHash(i + vec3(1,0,0)), f.x),
                   mix(solarHash(i + vec3(0,1,0)), solarHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(solarHash(i + vec3(0,0,1)), solarHash(i + vec3(1,0,1)), f.x),
                   mix(solarHash(i + vec3(0,1,1)), solarHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  const mat3 SOLAR_ROT = mat3(0.0, 0.8, 0.6, -0.8, 0.36, -0.48, -0.6, -0.48, 0.64);

  vec3 solarPhotosphere(vec3 n, float mu) {
    float time = uSolarTime;
    vec3 drift = vec3(time * 0.004, -time * 0.003, time * 0.002);
    vec3 q = SOLAR_ROT * n;
    vec3 flow = vec3(solarNoise(q * 7.0 + drift),
                     solarNoise(q * 7.0 + vec3(31.7, 9.2, 4.0) - drift),
                     solarNoise(q * 7.0 + vec3(-19.2, 4.8, 14.0) + drift)) - 0.5;
    vec3 p = q * 88.0 + flow * 5.0;
    float cells = solarNoise(p + drift);
    // Modest contrast: individual cells emerge on approach rather than
    // turning the distant disc into white stipple. Rotated fine structure
    // breaks up the lattice without any screen-aligned or directional stripes.
    float footprint = max(length(dFdx(p)), length(dFdy(p)));
    float detail = 1.0 - smoothstep(0.45, 1.5, footprint);
    float granules = smoothstep(0.23, 0.78, cells);
    float convection = solarNoise(q * 11.0 + flow * 3.0 + vec3(7.1, -3.0, 11.8));
    float turbulent = solarNoise(SOLAR_ROT * q * 27.0 + flow * 4.0 - drift);
    float thermal = convection * 0.65 + turbulent * 0.35;
    float grain = 0.94 + (granules - 0.5) * 0.12 * detail;
    if (uSolarDetail > 0.5) {
      vec3 fineP = SOLAR_ROT * p * 2.17 + vec3(12.4, -9.7, 6.3);
      float aa = 1.0 - smoothstep(0.5, 1.5, max(length(dFdx(fineP)), length(dFdy(fineP))));
      grain += (solarNoise(fineP - drift) - 0.5) * 0.035 * aa;
    }
    // Broad activity modulates heat, rather than carving grey crater-like
    // holes into a luminous star. Fine bright lanes flow through the cells.
    float field = solarNoise(q * 7.0 + flow * 1.4 + vec3(14.0, -8.0, 3.0));
    float activity = smoothstep(0.56, 0.8, field);
    vec3 magneticP = SOLAR_ROT * (q * 29.0 + flow * 5.0);
    float folds = 1.0 - smoothstep(0.015, 0.1, abs(solarNoise(magneticP) - 0.5));
    float foldAA = 1.0 - smoothstep(0.4, 1.2, max(length(dFdx(magneticP)), length(dFdy(magneticP))));
    float faculae = folds * foldAA * (0.04 + activity * 0.17);
    float heat = smoothstep(0.12, 0.9, thermal);
    // An observatory-like golden exposure. The disc is a luminous star, not a
    // mottled ball: the heat pattern is a gentle swell over a bright golden
    // floor (the old dark-red troughs read as orange peel from Starborn's
    // arrival point), and the limb darkens and reddens as the real one does
    // (we see cooler, higher gas at the edge).
    vec3 warm = mix(vec3(1.2, 0.56, 0.12), vec3(1.55, 0.95, 0.42), heat);
    warm += vec3(0.5, 0.31, 0.1) * faculae;
    float m = max(mu, 0.0);
    float limb = 0.28 + 0.72 * pow(m, 0.6);
    warm *= mix(vec3(1.0, 0.5, 0.26), vec3(1.0), pow(m, 0.35));
    return warm * grain * limb * uLight;
  }

  // An optically thin chromosphere and low corona outside the real limb.
  // Analytic closest approach gives its depth/scale without a volume march.
  vec3 solarCorona(vec3 ro, vec3 rd) {
    float t = max(0.0, -dot(ro, rd));
    vec3 p = ro + rd * t;
    float h = max(length(p) - 1.0, 0.0);
    vec3 n = uToBody * normalize(p);
    vec3 q = SOLAR_ROT * n;
    vec3 drift = vec3(uSolarTime * 0.004, -uSolarTime * 0.003, uSolarTime * 0.002);
    vec3 flow = vec3(solarNoise(q * 7.0 + drift),
                     solarNoise(q * 7.0 + vec3(31.7, 9.2, 4.0) - drift),
                     solarNoise(q * 7.0 + vec3(-19.2, 4.8, 14.0) + drift)) - 0.5;
    // The same body-fixed field as the photosphere roots sparse fans in
    // active regions. Their angular spread and fray vary with height, so the
    // corona never becomes a uniform hairy outline or an attached tube.
    float field = solarNoise(q * 7.0 + flow * (1.4 + h * 5.0) + vec3(14.0, -8.0, 3.0));
    float fan = smoothstep(0.55, 0.82, field);
    float fray = solarNoise(q * 62.0 + flow * 5.0 + vec3(h * 35.0, -h * 18.0, 0.0));
    // Exponential thinning, rather than a height cut, avoids rectangular
    // brush marks at the tip of each plume. All light dies before the shell.
    float plume = fan * exp(-h * (55.0 - fan * 15.0)) * (0.5 + fray * 0.5);
    float fine = solarNoise(n * 90.0 - uSolarTime * 0.008);
    float rim = exp(-h * 240.0) * (0.13 + fine * 0.06);
    float quietCorona = exp(-h * 65.0) * 0.014;
    float edge = 1.0 - smoothstep(0.02, 0.14, h);
    return (vec3(1.0, 0.22, 0.025) * (rim + plume * 0.18)
          + vec3(1.0, 0.66, 0.26) * (quietCorona + plume * plume * 0.06)) * edge * uLight;
  }
`
