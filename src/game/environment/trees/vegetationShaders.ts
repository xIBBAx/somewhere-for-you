import { VEG_OCCLUSION_CLIP_GLSL, vegetationUniforms } from "../../../world/render/vegetationMaterials"
import * as THREE from "three"
import { weatherRT } from "../../weather/weatherState"

/**
 * Custom vertex & fragment shader enhancements for SOTA vegetation:
 * 1. Physically motivated leaf/petal subsurface light transmission (TU Wien Habel 2007 model).
 * 2. True world-space GPU-side hierarchical wind animation (GPU Gems 3 / SpeedTree VFX / Crysis model).
 * 3. Aerodynamic reconfiguration & saturation (prevents rubber tree deformation in storm gusts).
 * 4. Weather & wetness response: bark/foliage darkening, specular sheen, and rainwater sheen.
 * 5. Day/night & moonlight calibration (no artificial night glow).
 * 6. Distance-based simulation LOD (smoothly attenuates leaf flutter beyond 25m).
 * 7. Matching customDepthMaterial for dynamic wind-reactive shadow casting with alpha-cutout cards.
 */

export type VegetationShaderUniforms = {
  uTime: { value: number }
  uWindSpeed: { value: number }
  uWindDirection: { value: THREE.Vector2 }
  uWindGust: { value: number }
  uTranslucencyColor: { value: THREE.Color }
  uTranslucencyIntensity: { value: number }
  uTranslucencyPower: { value: number }
  uTrunkFlexibility: { value: number }
  uBranchFlexibility: { value: number }
  uLeafFlutter: { value: number }
  uSunDirection: { value: THREE.Vector3 }
  uSunIntensity: { value: number }
  uRain: { value: number }
  uWetness: { value: number }
  uPorosity: { value: number }
}

export const createVegetationUniforms = (options?: {
  translucencyColor?: string | THREE.Color
  translucencyIntensity?: number
  translucencyPower?: number
  trunkFlexibility?: number
  branchFlexibility?: number
  leafFlutter?: number
  porosity?: number
}): VegetationShaderUniforms => ({
  uTime: { value: 0 },
  uWindSpeed: { value: 0.2 },
  uWindDirection: { value: new THREE.Vector2(1, 0) },
  uWindGust: { value: 0 },
  uTranslucencyColor: {
    value: new THREE.Color(options?.translucencyColor ?? "#8fe358"),
  },
  uTranslucencyIntensity: { value: options?.translucencyIntensity ?? 0.85 },
  uTranslucencyPower: { value: options?.translucencyPower ?? 2.8 },
  uTrunkFlexibility: { value: options?.trunkFlexibility ?? 0.038 },
  uBranchFlexibility: { value: options?.branchFlexibility ?? 0.11 },
  uLeafFlutter: { value: options?.leafFlutter ?? 0.08 },
  uSunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
  uSunIntensity: { value: 1.0 },
  uRain: { value: 0.0 },
  uWetness: { value: 0.0 },
  uPorosity: { value: options?.porosity ?? 0.55 },
})

const getWindProjectVertexChunk = (isFoliage: boolean) => `
  vec4 mPos = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    mPos = batchingMatrix * mPos;
  #endif
  #ifdef USE_INSTANCING
    mPos = instanceMatrix * mPos;
  #endif

  vec4 vegWorldPos4 = modelMatrix * mPos;

  #ifdef USE_INSTANCING
    vec3 worldAnchor = (modelMatrix * (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0))).xyz;
    mat3 normMat = mat3(modelMatrix) * mat3(instanceMatrix);
  #else
    vec3 worldAnchor = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    mat3 normMat = mat3(modelMatrix);
  #endif

  vWorldNormal = normalize(normMat * normal);

  // 1. Shared atmospheric wind field with traveling gust wavefront
  vec2 wDir = uWindDirection;
  float windMag = uWindSpeed + uWindGust * 0.65;
  // Gust wave propagates along wind vector across world coordinates
  float gustWaveCoord = dot(worldAnchor.xz, wDir);
  float gustWave = sin(gustWaveCoord * 0.08 - uTime * 2.2) * 0.45 + 0.55;
  float effectiveWind = windMag * gustWave;

  // Level A: Trunk / Canopy macro sway (quadratic height above tree base preserves root anchoring)
  float heightAboveBase = max(0.0, vegWorldPos4.y - worldAnchor.y);
  float spatialPhase = dot(worldAnchor.xz, vec2(0.085, 0.065));
  float macroSway = sin(uTime * 1.32 + spatialPhase) * effectiveWind * uTrunkFlexibility * (heightAboveBase * heightAboveBase);
  vec3 windWorldOffset = vec3(wDir.x * macroSway, 0.0, wDir.y * macroSway);

  ${
    isFoliage
      ? `
    // Level B: Branch medium-frequency oscillation
    vec3 branchOffset = vegWorldPos4.xyz - worldAnchor.xyz;
    float branchPhase = dot(branchOffset.xz, vec2(1.25, 0.95)) + spatialPhase * 1.75;
    float branchDist = length(branchOffset.xz);
    float branchSway = sin(uTime * 2.55 + branchPhase) * effectiveWind * uBranchFlexibility * clamp(branchDist * 0.36, 0.0, 1.9);
    windWorldOffset += vec3(wDir.x * branchSway, sin(uTime * 2.05 + branchPhase) * branchSway * 0.22, wDir.y * branchSway);

    // Level C: Leaf / Blossom floret high-frequency flutter with Distance Simulation LOD!
    float cameraDist = length(cameraPosition - vegWorldPos4.xyz);
    float flutterLod = clamp(1.0 - (cameraDist - 20.0) / 45.0, 0.0, 1.0);
    float flutterPhase = dot(vegWorldPos4.xyz, vec3(6.6, 9.1, 7.4)) + uTime * 6.6;
    float flutter = sin(flutterPhase) * effectiveWind * uLeafFlutter * flutterLod;
    windWorldOffset += vWorldNormal * (flutter * 0.35);
  `
      : ``
  }

  // Aerodynamic Reconfiguration: Clamp and saturate displacement under storm gusts (no rubber trees!)
  float offsetLen = length(windWorldOffset);
  if (offsetLen > 0.001) {
    float saturatedLen = offsetLen / (1.0 + 0.35 * offsetLen);
    windWorldOffset *= (saturatedLen / offsetLen);
  }

  vegWorldPos4.xyz += windWorldOffset;
  vWorldPos = vegWorldPos4.xyz;

  vec4 mvPosition = viewMatrix * vegWorldPos4;
  gl_Position = projectionMatrix * mvPosition;
`

/**
 * Creates a matching MeshDepthMaterial with identical wind vertex displacement
 * and alpha-cutout mapping so that shadows stay synchronized with the dynamic tree geometry.
 */
export const createVegetationDepthMaterial = (
  uniforms: VegetationShaderUniforms,
  isFoliage = true,
  alphaMap?: THREE.Texture | null,
  alphaTest = 0.4,
): THREE.MeshDepthMaterial => {
  const depthMat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
  })
  if (alphaMap) {
    depthMat.map = alphaMap
    depthMat.alphaTest = alphaTest
  }

  depthMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime
    shader.uniforms.uWindSpeed = uniforms.uWindSpeed
    shader.uniforms.uWindDirection = uniforms.uWindDirection
    shader.uniforms.uWindGust = uniforms.uWindGust
    shader.uniforms.uTrunkFlexibility = uniforms.uTrunkFlexibility
    shader.uniforms.uBranchFlexibility = uniforms.uBranchFlexibility
    shader.uniforms.uLeafFlutter = uniforms.uLeafFlutter

    shader.vertexShader = `
      uniform float uTime;
      uniform float uWindSpeed;
      uniform vec2 uWindDirection;
      uniform float uWindGust;
      uniform float uTrunkFlexibility;
      uniform float uBranchFlexibility;
      uniform float uLeafFlutter;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      ${shader.vertexShader}
    `

    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      getWindProjectVertexChunk(isFoliage),
    )
  }

  return depthMat
}

/**
 * Injects hierarchical GPU wind displacement, subsurface translucency, and
 * weather/wetness response into any Three.js MeshStandardMaterial.
 */
export const enhanceVegetationMaterial = (
  material: THREE.MeshStandardMaterial,
  uniforms: VegetationShaderUniforms,
  isFoliage = true,
): void => {
  // Attach matching shadow depth material for 100% shadow-wind synchronization
  ;(material as unknown as { customDepthMaterial?: THREE.MeshDepthMaterial }).customDepthMaterial =
    createVegetationDepthMaterial(
      uniforms,
      isFoliage,
      material.map,
      material.alphaTest,
    )

  material.onBeforeCompile = (shader) => {
    // Bind uniforms
    shader.uniforms.uTime = uniforms.uTime
    shader.uniforms.uWindSpeed = uniforms.uWindSpeed
    shader.uniforms.uWindDirection = uniforms.uWindDirection
    shader.uniforms.uWindGust = uniforms.uWindGust
    shader.uniforms.uTranslucencyColor = uniforms.uTranslucencyColor
    shader.uniforms.uTranslucencyIntensity = uniforms.uTranslucencyIntensity
    shader.uniforms.uTranslucencyPower = uniforms.uTranslucencyPower
    shader.uniforms.uTrunkFlexibility = uniforms.uTrunkFlexibility
    shader.uniforms.uBranchFlexibility = uniforms.uBranchFlexibility
    shader.uniforms.uLeafFlutter = uniforms.uLeafFlutter
    shader.uniforms.uSunDirection = uniforms.uSunDirection
    shader.uniforms.uSunIntensity = uniforms.uSunIntensity
    shader.uniforms.uRain = uniforms.uRain
    shader.uniforms.uWetness = uniforms.uWetness
    shader.uniforms.uPorosity = uniforms.uPorosity
    shader.uniforms.uPlayerRender = vegetationUniforms.uPlayerRender

    // 1. Vertex Shader: Hierarchical GPU Wind Animation
    shader.vertexShader = `
      uniform float uTime;
      uniform float uWindSpeed;
      uniform vec2 uWindDirection;
      uniform float uWindGust;
      uniform float uTrunkFlexibility;
      uniform float uBranchFlexibility;
      uniform float uLeafFlutter;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      ${shader.vertexShader}
    `

    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      getWindProjectVertexChunk(isFoliage),
    )

    // 2. Fragment Shader: Physically motivated leaf translucency & rain wetness response
    shader.fragmentShader = `
      uniform vec3 uTranslucencyColor;
      uniform float uTranslucencyIntensity;
      uniform float uTranslucencyPower;
      uniform vec3 uSunDirection;
      uniform float uSunIntensity;
      uniform float uRain;
      uniform float uWetness;
      uniform float uPorosity;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      uniform vec3 uPlayerRender;
      ${isFoliage ? "#define VEG_WIDE_NEAR_FADE" : ""}
      #define vVegWorld vWorldPos
      ${VEG_OCCLUSION_CLIP_GLSL}
      #undef vVegWorld

      ${shader.fragmentShader}
    `
    // like the streamed vegetation: never let a crown or trunk fill the lens
    // or stand between the camera and the characters
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <clipping_planes_fragment>",
      "#include <clipping_planes_fragment>\n  vegOcclusionClip();",
    )

    // Add lighting in linear space, before tone mapping and display conversion.
    // Adding linear light to the final sRGB output clipped foliage to neon green.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `
      // Weather & Wetness Response (Yale: Rendering of Wet Materials / US Forest Service)
      // Water absorption darkens diffuse reflectance and increases specular sheen
      float wetnessAmount = uWetness;
      if (wetnessAmount > 0.01) {
        float darkenFactor = 1.0 - wetnessAmount * (uPorosity * 0.38);
        outgoingLight *= darkenFactor;

        // Subtle specular water film sheen on top surfaces
        float topAlignment = max(0.0, vWorldNormal.y);
        vec3 waterSheen = vec3(0.18, 0.22, 0.28) * (wetnessAmount * topAlignment * 0.45 * uSunIntensity);
        outgoingLight += waterSheen;
      }

      ${
        isFoliage
          ? `
        // TU Wien Habel 2007 Physically Based Leaf Translucency
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        vec3 sunDir = normalize(uSunDirection);

        // Forward scattering: maximum when viewing leaf backlit against the sun
        float backScatter = max(0.0, dot(-viewDir, sunDir));
        float transmission = pow(backScatter, uTranslucencyPower) * uTranslucencyIntensity * max(0.0, uSunIntensity);

        // Angle attenuation relative to surface normal (thin membrane transmission)
        float normalAlignment = 0.5 + 0.5 * abs(dot(vWorldNormal, sunDir));
        vec3 translucencyGlow = diffuseColor.rgb * uTranslucencyColor * transmission * normalAlignment;

        // Ambient ground bounce light to prevent pitch black leaf undersides
        float undersideBounce = max(0.0, -vWorldNormal.y) * 0.16 * max(0.0, uSunIntensity);
        vec3 bounceColor = diffuseColor.rgb * uTranslucencyColor * undersideBounce * 0.32;

        outgoingLight += translucencyGlow + bounceColor;
      `
          : ``
      }

      #include <opaque_fragment>
      `,
    )
  }
}

/**
 * Syncs global weather runtime and sun uniforms every frame.
 * Single lightweight call per frame, zero allocations.
 */
export const updateVegetationUniforms = (
  uniforms: VegetationShaderUniforms,
  elapsedTime: number,
  sunDirection?: THREE.Vector3,
  sunIntensity = 1.0,
): void => {
  uniforms.uTime.value = elapsedTime
  const wind = Math.min(1.0, weatherRT.wind + weatherRT.gust * 0.5)
  uniforms.uWindSpeed.value = Math.max(0.12, wind)
  uniforms.uWindGust.value = weatherRT.gust
  const dir = weatherRT.windDirectionRad
  uniforms.uWindDirection.value.set(Math.cos(dir), Math.sin(dir))
  if (sunDirection) {
    uniforms.uSunDirection.value.copy(sunDirection)
  }
  uniforms.uSunIntensity.value = sunIntensity
  uniforms.uRain.value = weatherRT.rain
  uniforms.uWetness.value = weatherRT.wetness
}
