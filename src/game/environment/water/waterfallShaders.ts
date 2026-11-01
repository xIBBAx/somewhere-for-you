
/**
 * Physically motivated Waterfall & Plunge Pool Shaders.
 *
 * Implements:
 * - Gravity-driven vertical acceleration (velocity increases with fall distance)
 * - Sheet breakup: laminar crest -> stretching rivulets -> aerated whitewater -> droplet breakup
 * - Aeration & whitewater scattering: air entrainment brightness responding to sun & ambient light
 * - Translucent voids revealing background canyon rock
 * - Plunge pool turbulence: churning impact epicenter, outward radiating surge ripples, advecting foam
 */

export const waterfallCurtainVertexShader = /* glsl */ `
  varying vec3 vWorldPosition;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  uniform float uTime;
  uniform float uHeight;
  uniform float uWind;
  uniform float uWindDir;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);

    // uv.y = 1 at top (crest), 0 at bottom (plunge)
    float fallProgress = 1.0 - uv.y; // 0 at crest, 1 at bottom

    // Natural acceleration-driven stretch: y displacement accelerates downward
    float t = uTime;
    float accel = fallProgress * fallProgress;

    // Organic billow and spray turbulence
    float turbulentBillow = sin(worldPos.x * 2.5 + fallProgress * 8.0 - t * 6.0) * 0.08 * fallProgress;
    float sideBreather = sin(worldPos.y * 3.0 + t * 4.0) * 0.04 * fallProgress;

    // Wind sway
    float windOffset = sin(t * 1.5 + worldPos.y * 0.4) * uWind * 0.12 * fallProgress;

    worldPos.z += turbulentBillow;
    worldPos.x += windOffset + sideBreather;
    vWorldPosition = worldPos.xyz;

    vec4 mvPosition = viewMatrix * worldPos;
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`

export const waterfallCurtainFragmentShader = /* glsl */ `
  precision highp float;

  varying vec3 vWorldPosition;
  varying vec2 vUv;
  varying vec3 vViewPosition;

  uniform float uTime;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform float uNight;
  uniform float uRainIntensity;

  // Simple procedural turbulence noise
  float hash(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    float fallProgress = 1.0 - vUv.y; // 0 at crest, 1 at impact
    float t = uTime;

    // Flow speed accelerates with fall distance:
    // Near top: speed is moderate; near bottom: speed is very fast
    float flowSpeed = 3.5 + fallProgress * 5.2;
    float flowCoordY = vUv.y * 3.5 + t * flowSpeed;

    // High frequency streamlet pattern
    float streamlets = noise(vec2(vUv.x * 14.0, flowCoordY * 2.2));
    float macroFlow = noise(vec2(vUv.x * 4.5, flowCoordY * 0.8));

    // Sheet breakup: sheet thins and develops holes as it accelerates downward
    float breakup = smoothstep(0.25, 0.75, streamlets * 0.6 + macroFlow * 0.4);
    // Holes increase with fall distance (more breakup downhill -> lower alpha in thin spots)
    float holes = smoothstep(0.2, 0.85, macroFlow + fallProgress * 0.35);
    // Combine streamlet breakup with downhill holes so thin regions tear open
    float sheetIntegrity = mix(holes, breakup, 0.5);

    // Whitewater / aeration: increases strongly with fall progress and turbulence
    float aeration = smoothstep(0.35, 0.8, streamlets + fallProgress * 0.6);

    // Water base colors (cyan water to foaming brilliant whitewater)
    vec3 clearWaterColor = mix(vec3(0.35, 0.68, 0.88), vec3(0.55, 0.82, 0.95), fallProgress * 0.5);
    vec3 whitewaterColor = vec3(0.96, 0.98, 1.0);

    // Environmental lighting: responds naturally to sun direction and sky light
    vec3 L = normalize(uSunDirection);
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    vec3 N = normalize(vec3((streamlets - 0.5) * 0.6, 0.4, 0.8));

    float NdotL = max(dot(N, L), 0.0);
    vec3 sunLight = uSunColor * (0.4 + 0.6 * NdotL);
    vec3 ambientLight = uSkyColor * 0.55;
    vec3 totalLight = (sunLight + ambientLight) * (1.0 - uNight * 0.8);

    // Specular highlight catching the sun on falling rivulets
    vec3 H = normalize(L + viewDir);
    float spec = pow(max(dot(N, H), 0.0), 32.0) * (1.0 - uNight * 0.9);

    vec3 waterDiffuse = mix(clearWaterColor, whitewaterColor, aeration);
    vec3 finalColor = waterDiffuse * totalLight + uSunColor * spec * 0.6;

    // Alpha transparency: edges tear, thin regions are translucent, aerated regions are dense
    float edgeFade = smoothstep(0.0, 0.12, vUv.x) * (1.0 - smoothstep(0.88, 1.0, vUv.x));
    float alpha = mix(0.45, 0.95, aeration) * sheetIntegrity * edgeFade;

    // Crest transition: smooth entry from rock lip
    float crestBlend = 1.0 - smoothstep(0.92, 1.0, vUv.y);
    alpha *= mix(0.7, 1.0, crestBlend);

    gl_FragColor = vec4(finalColor, clamp(alpha, 0.0, 0.98));
  }
`

export const plungePoolVertexShader = /* glsl */ `
  varying vec3 vWorldPosition;
  varying vec2 vUv;
  varying vec3 vViewPosition;

  uniform float uTime;
  uniform float uTurbulence;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);

    // Outward propagating shock waves from the impact center
    vec2 center = vec2(0.0, 0.0); // local pool center
    float dist = length(position.xy);
    float wave = sin(dist * 12.0 - uTime * 6.5) * exp(-dist * 0.9) * 0.045 * uTurbulence;
    
    worldPos.y += wave;
    vWorldPosition = worldPos.xyz;

    vec4 mvPosition = viewMatrix * worldPos;
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`

export const plungePoolFragmentShader = /* glsl */ `
  precision highp float;

  varying vec3 vWorldPosition;
  varying vec2 vUv;
  varying vec3 vViewPosition;

  uniform float uTime;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform float uNight;
  uniform float uTurbulence;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float poolNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    float dist = length(vUv - 0.5) * 2.0; // 0 at center, 1 at edge
    float t = uTime;
    vec2 p = (vUv - 0.5) * 2.0;

    // Uniform Cartesian multi-scale flow noise (zero singularity, zero aliasing streaks)
    float n1 = poolNoise(p * 3.2 + vec2(t * 0.75, -t * 0.55));
    float n2 = poolNoise(p * 6.8 - vec2(t * 1.25, t * 0.95));
    float n3 = poolNoise(p * 13.5 + vec2(sin(t * 1.8) * 0.6, cos(t * 1.8) * 0.6));
    float flowNoise = n1 * 0.52 + n2 * 0.33 + n3 * 0.15;

    // Outward propagating hydraulic surge shockwaves modulated by turbulence
    float surge = sin(dist * 14.0 - t * 5.5 + flowNoise * 2.4);

    // Violent impact epicenter: dense churning boiling foam directly under the plunge
    float foamMask = 1.0 - smoothstep(0.0, 0.52, dist);
    float boil = smoothstep(0.32, 0.62, flowNoise + foamMask * 0.6 + surge * 0.18);

    // Lacy foam streamers riding the surge waves outward
    float midFade = (1.0 - smoothstep(0.5, 0.95, dist));
    float outerStreams = smoothstep(0.46, 0.72, flowNoise + surge * 0.28) * midFade;

    float patchyFoam = clamp(boil * foamMask * 1.35 + outerStreams * 0.85, 0.0, 1.0);

    // Pool water colors (deep turquoise lagoon to brilliant aerated whitewater)
    vec3 deepLagoon = vec3(0.08, 0.38, 0.55);
    vec3 churningFoam = vec3(0.96, 0.98, 1.0);

    // Fresnel specular in consistent world space
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    vec3 N = normalize(vec3(cos(dist * 12.0 - t * 5.5) * 0.22, 1.0, sin(dist * 12.0 - t * 5.5) * 0.22));
    float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(N, viewDir), 0.0), 4.0);

    vec3 L = normalize(uSunDirection);
    vec3 reflectedSky = mix(uSkyColor * 0.7, vec3(0.9, 0.95, 1.0), fresnel);
    reflectedSky += uSunColor * pow(max(dot(reflect(-viewDir, N), L), 0.0), 32.0) * 1.2 * (1.0 - uNight * 0.85);

    vec3 waterColor = mix(deepLagoon, reflectedSky, fresnel);
    vec3 finalColor = mix(waterColor, churningFoam, patchyFoam * 0.92);

    // Edge fade into surrounding sunken valley lagoon
    float edgeFade = 1.0 - smoothstep(0.85, 1.0, dist);
    float alpha = mix(0.85, 0.98, patchyFoam) * edgeFade;

    gl_FragColor = vec4(finalColor, clamp(alpha, 0.0, 0.98));
  }
`
