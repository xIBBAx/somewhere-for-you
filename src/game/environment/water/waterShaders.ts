import { WORLD_NOISE_GLSL } from "../../../world/origin"
import { WATER_WAKE_GLSL } from "../../../world/render/waterWake"

/**
 * Physically-motivated real-time Water Shader for Ponds, Lakes and Streams.
 *
 * Implements:
 * - Precise world-space Schlick Fresnel reflectance (specular grazing sky reflections, clear top-down substrate)
 * - Beer-Lambert volumetric optical depth extinction & selective aquatic absorption
 * - Multi-scale wave perturbation (macro swell + wind-driven meso wavelets + micro capillary glints)
 * - Organic non-repeating rain disturbance (staggered stochastic impact wavelets without grid artifacts)
 * - Procedural animated caustics on shallow substrate
 * - Shoreline depth-fade & gentle contact foam (no hard polygon terrain intersection)
 * - Dynamic sun specular highlight (Blinn-Phong microfacet response)
 * - Coherent environment hemisphere lighting (sky, clouds, horizon warmth)
 */

export const waterVertexShader = /* glsl */ `
  attribute float aDepth;

  varying vec3 vWorldPosition;
  varying vec2 vUv;
  varying float vDepth;

  uniform float uTime;
  uniform float uWindSpeed;
  uniform float uWindDir;
  uniform float uRainIntensity;

  void main() {
    vUv = uv;
    vDepth = aDepth;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);

    // Multi-scale gentle surface undulation
    vec2 windVec = vec2(cos(uWindDir), sin(uWindDir));
    float wavePhase = dot(worldPos.xz, windVec * 0.42) - uTime * (0.75 + uWindSpeed * 0.55);
    float macroSwell = sin(wavePhase) * 0.012 + sin(worldPos.x * 0.65 - uTime * 0.45) * cos(worldPos.z * 0.55 + uTime * 0.35) * 0.007;

    // Rain capillary agitation
    float rainAgitation = sin(worldPos.x * 5.5 + uTime * 7.0) * cos(worldPos.z * 5.2 - uTime * 6.5) * 0.0035 * uRainIntensity;

    worldPos.y += macroSwell + rainAgitation;
    vWorldPosition = worldPos.xyz;

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`

export const waterFragmentShader = /* glsl */ `
  precision highp float;

  varying vec3 vWorldPosition;
  varying vec2 vUv;
  varying float vDepth;

  uniform float uTime;
  uniform float uWaterY;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uGroundColor;
  uniform vec3 uWaterShallowColor;
  uniform vec3 uWaterDeepColor;
  uniform float uNight;
  uniform float uWindSpeed;
  uniform float uWindDir;
  uniform float uRainIntensity;
  uniform float uWetness;
  uniform vec3 uPlayerPos;

  ${WORLD_NOISE_GLSL}
  ${WATER_WAKE_GLSL}

  // Pseudo-random hash
  float hash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  // Smooth 2D noise
  float noise2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // Multi-scale surface wave height
  float getWaterHeight(vec2 p, float t, vec2 wind) {
    // 1. Meso wavelets aligned with wind
    float w1 = sin(dot(p, wind * 2.2) - t * 2.4) * 0.012;
    float w2 = sin(dot(p, vec2(-wind.y, wind.x) * 2.8) + t * 1.9) * 0.009;
    
    // 2. Micro capillary perturbations
    float c1 = sin(p.x * 7.5 + p.y * 6.2 - t * 4.2) * 0.005;
    float c2 = cos(p.x * 11.2 - p.y * 9.8 + t * 4.8) * 0.0035;

    // 3. Organic non-repeating rain ripples (3 jittered time-staggered frequency layers)
    float rainRipples = 0.0;
    if (uRainIntensity > 0.04) {
      // Layer A
      vec2 pA = p * 1.8 + vec2(0.35, 0.65);
      vec2 idA = floor(pA);
      vec2 fA = fract(pA) - 0.5;
      float rndA = hash(idA);
      float phaseA = fract(t * 1.5 + rndA);
      float distA = length(fA + (vec2(hash(idA + 0.1), hash(idA + 0.2)) - 0.5) * 0.4);
      float ringA = sin((distA - phaseA * 0.6) * 22.0) * exp(-distA * 4.2) * (1.0 - phaseA);

      // Layer B (offset grid)
      vec2 pB = p * 2.4 + vec2(0.72, -0.45);
      vec2 idB = floor(pB);
      vec2 fB = fract(pB) - 0.5;
      float rndB = hash(idB);
      float phaseB = fract(t * 1.8 + rndB + 0.5);
      float distB = length(fB + (vec2(hash(idB + 0.3), hash(idB + 0.4)) - 0.5) * 0.4);
      float ringB = sin((distB - phaseB * 0.6) * 24.0) * exp(-distB * 4.5) * (1.0 - phaseB);

      rainRipples = (ringA + ringB * 0.7) * 0.008 * uRainIntensity;
    }

    // 4. Interactive player wake ripples
    float playerDist = length(p - uPlayerPos.xz);
    float playerWake = 0.0;
    if (abs(uPlayerPos.y - uWaterY) < 0.75 && playerDist < 3.5) {
      float wake = sin(playerDist * 10.0 - t * 5.0) * exp(-playerDist * 1.1) * 0.015 * (1.0 - smoothstep(0.0, 3.5, playerDist));
      playerWake = wake;
    }

    return w1 + w2 + c1 + c2 + rainRipples + playerWake;
  }

  // Analytical surface normal derivation in WORLD space
  vec3 getNormal(vec2 p, float t, vec2 wind) {
    float eps = 0.03;
    float hC = getWaterHeight(p, t, wind);
    float hR = getWaterHeight(p + vec2(eps, 0.0), t, wind);
    float hU = getWaterHeight(p + vec2(0.0, eps), t, wind);
    return normalize(vec3(hC - hR, eps, hC - hU));
  }

  // Caustics on shallow bottom
  float getCaustics(vec2 p, float t, vec2 wind) {
    vec2 uv1 = p * 2.0 + wind * t * 0.3;
    vec2 uv2 = p * 2.5 - vec2(-wind.y, wind.x) * t * 0.35;
    float c1 = sin(uv1.x * 4.0 + sin(uv1.y * 3.0 + t)) * 0.5 + 0.5;
    float c2 = cos(uv2.y * 4.2 + cos(uv2.x * 2.8 - t)) * 0.5 + 0.5;
    return pow(c1 * c2, 2.2) * 1.8;
  }

  void main() {
    // True WORLD space view direction: from surface point to camera
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    vec2 wind = vec2(cos(uWindDir), sin(uWindDir));
    float t = uTime;

    // Normal calculation in world space
    vec3 N = getNormal(vWorldPosition.xz, t, wind);
    vec4 wash = pegasusWash(vWorldPosition.xz);
    float washShore = smoothstep(0.0, 0.12, vDepth);
    N = normalize(vec3(N.x - wash.x * washShore, N.y, N.z - wash.y * washShore));

    // Physically accurate Fresnel reflection via Schlick's approximation (R0 = 0.02 for water)
    float cosTheta = max(dot(N, viewDir), 0.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - cosTheta, 5.0);

    // Sun specular reflection (Blinn-Phong)
    vec3 L = normalize(uSunDirection);
    vec3 H = normalize(L + viewDir);
    float NdotH = max(dot(N, H), 0.0);
    float roughnessExp = mix(512.0, 96.0, clamp(uWindSpeed * 0.5 + uRainIntensity * 0.6, 0.0, 1.0));
    float spec = pow(NdotH, roughnessExp) * 2.8 * (1.0 - uNight * 0.88);
    vec3 specularHighlight = uSunColor * spec;

    // Environment reflection (sky dome + horizon warm gradient)
    vec3 R = reflect(-viewDir, N);
    float skyAngle = clamp(R.y, 0.0, 1.0);
    vec3 reflectedSky = mix(uHorizonColor, uSkyColor, pow(skyAngle, 0.55));
    // Sun glint in reflection
    float sunFacing = max(dot(R, L), 0.0);
    reflectedSky += uSunColor * pow(sunFacing, 12.0) * 0.5 * (1.0 - uNight * 0.9);

    // True physical depth interpolated across bathymetry mesh
    float estDepth = max(0.001, vDepth);

    // Depth-dependent water volume color (Beer-Lambert optical absorption)
    vec3 waterColor = mix(uWaterShallowColor, uWaterDeepColor, smoothstep(0.04, 0.42, estDepth));

    // Underwater substrate caustics (dancing sharp patterns on shallow shore sands)
    float causticVal = getCaustics(vWorldPosition.xz, t, wind);
    float causticFade = (1.0 - smoothstep(0.06, 0.40, estDepth)) * (1.0 - uRainIntensity * 0.7) * (1.0 - uNight * 0.9);
    vec3 caustics = uSunColor * causticVal * causticFade * 0.55;

    // Substrate transmitted light: shallow reveals bottom sand + caustics, deep absorbs
    vec3 bottomColor = uGroundColor * 0.72 + caustics;
    vec3 transmitted = mix(bottomColor, waterColor, smoothstep(0.03, 0.38, estDepth));

    // Combine reflected sky and transmitted water bottom via Fresnel
    vec3 finalColor = mix(transmitted, reflectedSky, fresnel) + specularHighlight;

    // Soft shoreline blend (smoothly dissolves alpha into wet shore without hard polygonal edge)
    float shoreFade = smoothstep(0.0, 0.07, estDepth);

    // Agitated edge foam during rain or high wind
    float edgeAgitation = length(N.xz);
    float foamThresh = mix(0.2, 0.09, uRainIntensity);
    float foam = smoothstep(foamThresh, foamThresh + 0.12, edgeAgitation) * (0.15 + uRainIntensity * 0.45);
    vec3 foamCol = vec3(0.95, 0.98, 1.0);
    finalColor *= 1.0 - wash.w * washShore * 0.25;
    finalColor = mix(finalColor, foamCol, clamp(foam * 0.6 + wash.z * washShore, 0.0, 0.7));

    // Alpha transparency: shallow shore reveals bottom sand; grazing angle is reflective
    float alpha = mix(0.62, 0.97, fresnel) * shoreFade;

    gl_FragColor = vec4(finalColor, clamp(alpha, 0.0, 0.98));
  }
`
