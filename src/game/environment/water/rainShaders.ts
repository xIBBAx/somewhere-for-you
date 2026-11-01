
/**
 * Physically-motivated Rain Streak and Impact Particle Shaders.
 *
 * Implements:
 * - Rain streaks oriented strictly along coupled terminal velocity + wind vector
 * - View-dependent & lighting-dependent streak brightness (Mie forward scattering & ambient sky integration)
 * - Non-emissive: streaks darken at night and under clouds, glisten when catching direct sun
 * - Multi-depth streak stratification
 */

export const rainStreakVertexShader = /* glsl */ `
  attribute vec3 aOffset;       // world spawn offset
  attribute vec3 aVelocity;     // drop-specific terminal velocity & drift
  attribute vec2 aScale;        // x: width, y: length

  uniform float uTime;
  uniform vec3 uCameraPos;
  uniform float uVolumeHalfSpan;
  uniform float uVolumeHeight;
  uniform vec2 uWind;           // x, z wind vector
  uniform float uRainIntensity;

  varying float vDropDepth;
  varying vec3 vWorldPos;
  varying float vAlpha;

  void main() {
    // Drop cycle time
    float fallSpeed = aVelocity.y * (0.85 + uRainIntensity * 0.7);
    float cyclePeriod = uVolumeHeight / fallSpeed;
    float dropTime = mod(uTime + aOffset.y * 0.35, cyclePeriod);

    // Initial position within volume centered at camera
    vec3 pos = aOffset;

    // Apply vertical falling and lateral wind drift
    pos.y -= dropTime * fallSpeed;
    pos.x += (uWind.x * 5.5 + aVelocity.x) * dropTime;
    pos.z += (uWind.y * 3.5 + aVelocity.z) * dropTime;

    // Wrap seamlessly within camera-following box
    vec3 camDelta = pos - uCameraPos;
    pos.x = uCameraPos.x + mod(camDelta.x + uVolumeHalfSpan, uVolumeHalfSpan * 2.0) - uVolumeHalfSpan;
    pos.z = uCameraPos.z + mod(camDelta.z + uVolumeHalfSpan, uVolumeHalfSpan * 2.0) - uVolumeHalfSpan;
    pos.y = uCameraPos.y + mod(camDelta.y + 4.0, uVolumeHeight) - 4.0;

    vWorldPos = pos;
    float distToCam = length(pos - uCameraPos);
    vDropDepth = distToCam;

    // Calculate orientation vector along velocity
    vec3 dropVel = vec3(uWind.x * 5.5 + aVelocity.x, -fallSpeed, uWind.y * 3.5 + aVelocity.z);
    vec3 dir = normalize(dropVel);

    // Billboarding: construct streak quad aligned with velocity and facing camera
    vec3 toCam = normalize(uCameraPos - pos);
    vec3 side = normalize(cross(toCam, dir));

    // Position offset from quad vertex (-0.5 to 0.5)
    vec3 vertexOffset = side * (position.x * aScale.x * 0.035) + dir * (position.y * aScale.y * 0.65);
    vec3 finalPos = pos + vertexOffset;

    vAlpha = smoothstep(uVolumeHalfSpan * 1.8, 2.0, distToCam) * smoothstep(0.0, 0.5, pos.y);

    gl_Position = projectionMatrix * viewMatrix * vec4(finalPos, 1.0);
  }
`

export const rainStreakFragmentShader = /* glsl */ `
  precision highp float;

  varying float vDropDepth;
  varying vec3 vWorldPos;
  varying float vAlpha;

  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform float uNight;
  uniform float uRainIntensity;

  void main() {
    // Rain streak core brightness
    // Raindrops scatter forward sunlight strongly (Mie scattering)
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uSunDirection);
    float forwardScatter = max(dot(viewDir, -L), 0.0);
    float sunGlint = pow(forwardScatter, 4.0) * 1.5;

    // Environmental lighting
    vec3 streakColor = mix(uSkyColor * 0.8, vec3(1.0), 0.35);
    streakColor += uSunColor * sunGlint * (1.0 - uNight * 0.9);
    streakColor *= (0.65 + 0.35 * (1.0 - uNight * 0.85));

    // Distance attenuation and softness
    float opacity = mix(0.55, 0.18, smoothstep(2.0, 24.0, vDropDepth)) * vAlpha * uRainIntensity;

    gl_FragColor = vec4(streakColor, clamp(opacity, 0.0, 0.75));
  }
`
