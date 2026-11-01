import { useFrame } from "@react-three/fiber"
import { useMemo, useRef } from "react"
import * as THREE from "three"
import { moonPosition } from "./celestialLighting"
import { homeSky } from "../celestial/homeSky"
import { lookAtLogical } from "../../world/render/WorldRoot"
import { lunarSurfaceTexture, solarCoronaTexture } from "../../utils/canvasTexture"
import { avatarRT, worldRT } from "../runtime"
import { weatherRT } from "../weather/weatherState"
import { WORLD_CONFIG } from "../../content/worldConfig"
import {
  calculateLimitingMagnitude,
  generateScientificStarfield,
} from "./starCatalogue"

const moonPositionScratch = new THREE.Vector3()

// ============================================================================
// SOTA ASTRONOMICAL STAR SHADER
// Multi-frequency irregular atmospheric scintillation, altitude-dependent
// airmass extinction, horizon chromatic scintillation, and scotopic desaturation.
// ============================================================================
const STAR_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uLimitMag;
  uniform float uExtinctionCoeff;
  uniform float uScintillationScale;

  attribute vec4 aStarData;    // x: magnitude, y: seed, z: baseSize, w: isSteady (1.0 = steady planet, 0.0 = star)
  attribute vec3 aBaseColor;   // Harvard blackbody color

  varying vec3 vColor;
  varying float vAlpha;
  varying float vMag;

  // Rozenberg (1966) astronomical airmass model
  float rozenbergAirmass(float sinAlt) {
    float altDeg = sinAlt * 57.2957795;
    return 1.0 / (max(0.012, sinAlt) + 0.015 * pow(max(0.0, altDeg + 3.885), -1.253));
  }

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;

    float mag = aStarData.x;
    float seed = aStarData.y;
    float baseSize = aStarData.z;
    float isSteady = aStarData.w;
    vMag = mag;

    // 1. Apparent Altitude & Horizon Masking
    float radius = length(position);
    float sinAlt = clamp(position.y / max(1.0, radius), -0.15, 1.0);

    // Below horizon cutoff
    if (sinAlt < -0.015) {
      gl_PointSize = 0.0;
      vAlpha = 0.0;
      return;
    }

    // Smooth horizon boundary fade
    float horizonFade = smoothstep(-0.015, 0.035, sinAlt);

    // 2. Limiting Magnitude / Gradual Dark-Adaptation Threshold
    // Brightest beacons (Venus, Sirius) appear first at dusk, followed by 1st-mag anchors,
    // and finally thousands of faint background stars in pitch darkness.
    float magVis = smoothstep(uLimitMag + 0.6, uLimitMag - 0.2, mag);
    if (magVis <= 0.001) {
      gl_PointSize = 0.0;
      vAlpha = 0.0;
      return;
    }

    // 3. Atmospheric Extinction (Airmass attenuation)
    float airmass = rozenbergAirmass(max(0.015, sinAlt));
    float extinction = exp(-uExtinctionCoeff * (airmass - 1.0));
    extinction = clamp(extinction, 0.04, 1.0);

    // Subtle Rayleigh reddening near horizon
    vec3 starColor = aBaseColor;
    float reddening = (1.0 - extinction) * 0.35;
    starColor.r = clamp(starColor.r + reddening * 0.35, 0.0, 1.0);
    starColor.b = clamp(starColor.b - reddening * 0.45, 0.0, 1.0);

    // 4. Human naked-eye scotopic desaturation (Purkinje rod effect)
    float desatFactor = smoothstep(1.8, 4.2, mag);
    starColor = mix(starColor, vec3(0.92, 0.94, 0.98), desatFactor * 0.85);

    // 5. Atmospheric Scintillation (NASA physical principles)
    // Stars emit steady light; atmospheric turbulence causes apparent fluctuations.
    // Extended planetary discs average out turbulence (isSteady == 1.0).
    float scintMult = 1.0;
    if (isSteady < 0.5) {
      // Non-harmonic multi-frequency turbulence per star
      float hash = fract(sin(seed * 127.1 + 311.7) * 43758.5453);
      float freq1 = 3.6 + hash * 2.6;
      float freq2 = 7.9 + fract(hash * 7.31) * 3.8;
      float freq3 = 15.7 + fract(hash * 19.93) * 6.5;
      float phase1 = hash * 6.2831853;
      float phase2 = fract(hash * 13.7) * 6.2831853;
      float phase3 = fract(hash * 31.3) * 6.2831853;

      float n1 = sin(uTime * freq1 + phase1);
      float n2 = sin(uTime * freq2 + phase2);
      float n3 = sin(uTime * freq3 + phase3);
      float turb = n1 * 0.52 + n2 * 0.33 + n3 * 0.15;

      // Altitude dependence:
      // Zenith stars: calm, restrained scintillation (~0.06 amplitude)
      // Mid sky: moderate scintillation (~0.20 amplitude)
      // Horizon stars: strong twinkling (~0.45 amplitude)
      float altFactor = 1.0 - smoothstep(0.08, 0.82, sinAlt);
      float scintAmp = mix(0.06, 0.45, altFactor) * uScintillationScale;

      // Never blink completely off; steady base light
      scintMult = max(0.25, 1.0 + turb * scintAmp);

      // 6. Horizon Chromatic Scintillation (NASA Cosmicopia)
      // Bright stars near horizon show subtle chromatic phase-shifted refraction
      if (mag < 2.2 && sinAlt < 0.30) {
        float chromaStrength = (1.0 - smoothstep(0.04, 0.30, sinAlt)) * smoothstep(2.2, -1.5, mag) * 0.28 * uScintillationScale;
        float redShift  = sin(uTime * (freq2 * 1.08) + phase2);
        float blueShift = sin(uTime * (freq2 * 0.92) + phase2 + 2.094);
        starColor.r = clamp(starColor.r + redShift * chromaStrength, 0.0, 1.0);
        starColor.b = clamp(starColor.b + blueShift * chromaStrength, 0.0, 1.0);
      }
    }

    // 7. Photometric Apparent Magnitude to Luminance & Point Size
    float magAlpha = clamp(1.0 - (mag - (-1.5)) * 0.08, 0.45, 1.0);
    float finalAlpha = clamp(magAlpha * extinction * scintMult * magVis * horizonFade, 0.0, 1.0);

    float sizeScint = (isSteady < 0.5) ? (1.0 + (scintMult - 1.0) * 0.16) : 1.0;
    float distScale = clamp(78.0 / max(1.0, -mvPosition.z), 0.5, 2.0);
    float pointSize = baseSize * uPixelRatio * sizeScint * distScale;

    gl_PointSize = max(1.8 * uPixelRatio, min(pointSize, 24.0 * uPixelRatio));

    vColor = starColor;
    vAlpha = finalAlpha;
  }
`

const STAR_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vMag;

  uniform float uHomeSky;
  void main() {
    if (vAlpha <= 0.004) discard;

    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord) * 2.0;
    if (dist > 1.0) discard;

    // Smooth antialiased circular profile
    float core = exp(-dist * 2.2) * (1.0 - smoothstep(0.72, 1.0, dist));

    // Subtle Airy disc halo for prominent bright stars (mag < 1.5)
    float halo = 0.0;
    if (vMag < 1.5) {
      float haloStrength = smoothstep(1.5, -1.5, vMag) * 0.42;
      halo = exp(-dist * 1.6) * haloStrength * (1.0 - dist);
    }

    float intensity = core + halo;
    float alpha = clamp(intensity * vAlpha, 0.0, 1.0);

    gl_FragColor = vec4(vColor, alpha * uHomeSky);
  }
`

export const SkyStars = (): React.ReactElement => {
  const groupRef = useRef<THREE.Group>(null)
  const celestialTiltRef = useRef<THREE.Group>(null)
  const celestialRotateRef = useRef<THREE.Group>(null)

  const starsRef = useRef<THREE.Points>(null)
  const planetsRef = useRef<THREE.Points>(null)
  const meteorRef = useRef<THREE.LineSegments>(null)

  const moon = useRef<THREE.Group>(null)
  const moonSphere = useRef<THREE.Mesh>(null)
  const moonInnerHalo = useRef<THREE.Mesh>(null)
  const moonOuterCorona = useRef<THREE.Mesh>(null)

  const moonTexture = useMemo(() => lunarSurfaceTexture(), [])
  const coronaTexture = useMemo(() => solarCoronaTexture(), [])

  // Dynamic meteor state: rare, brief, directionally coherent atmospheric streaks
  const meteorState = useRef({
    active: false,
    timer: 24.0, // Rare natural interval
    progress: 0,
    start: new THREE.Vector3(),
    end: new THREE.Vector3(),
  })

  // SOTA Starfield Geometries: generated deterministically once
  const { starsGeo, planetsGeo, meteorGeo } = useMemo(() => {
    // Keep the crisp star/planet field without the camera-following haze puffs.
    const data = generateScientificStarfield(20260906, 2400, 0, 78.0)

    // 1) All Stars Geometry (Bright Catalogue + Faint Background)
    const sG = new THREE.BufferGeometry()
    sG.setAttribute("position", new THREE.BufferAttribute(data.starsPos, 3))
    sG.setAttribute("aBaseColor", new THREE.BufferAttribute(data.starsCol, 3))
    sG.setAttribute("aStarData", new THREE.BufferAttribute(data.starsData, 4))

    // 2) Visible Classical Planets Geometry
    const pG = new THREE.BufferGeometry()
    pG.setAttribute("position", new THREE.BufferAttribute(data.planetsPos, 3))
    pG.setAttribute("aBaseColor", new THREE.BufferAttribute(data.planetsCol, 3))
    pG.setAttribute("aStarData", new THREE.BufferAttribute(data.planetsData, 4))

    // 3) Dynamic Meteor / Shooting Star Geometry
    const mGeo = new THREE.BufferGeometry()
    const mPos = new Float32Array(6)
    mGeo.setAttribute("position", new THREE.BufferAttribute(mPos, 3))

    return { starsGeo: sG, planetsGeo: pG, meteorGeo: mGeo }
  }, [])

  // SOTA Custom Shader Materials
  const starMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: 1.0 },
          uLimitMag: { value: -5.0 },
          uExtinctionCoeff: { value: 0.18 },
          uScintillationScale: { value: 1.0 },
          uHomeSky: homeSky.stars,
        },
        vertexShader: STAR_VERTEX_SHADER,
        fragmentShader: STAR_FRAGMENT_SHADER,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  )

  useFrame((state, dt) => {
    // 1) Eliminate terrestrial parallax: celestial sphere tracks player position
    if (groupRef.current) {
      groupRef.current.position.copy(avatarRT().pos)
    }

    const tod = worldRT.timeOfDay
    const cloud = weatherRT.cloud
    const rain = weatherRT.rain
    const weatherDim = Math.max(0, 1 - cloud * 0.85 - rain * 0.62)
    const t = state.clock.elapsedTime
    const pr = state.gl.getPixelRatio()

    // 2) Coherent Celestial Orientation & Sidereal Rotation (Gates 17, 18, 19)
    // Tilted by world latitude (home/home ~19.28°N): Polaris sits at celestial north pole
    const lat = WORLD_CONFIG.weather.fallbackLocation.latitude * (Math.PI / 180)
    if (celestialTiltRef.current) {
      celestialTiltRef.current.rotation.x = -(Math.PI * 0.5 - lat)
    }

    // Rotates as ONE rigid celestial sphere around the polar axis
    const siderealOffset = tod * Math.PI * 2
    if (celestialRotateRef.current) {
      celestialRotateRef.current.rotation.y = -siderealOffset
    }

    // 3) 3D Moon Position & Moonlit Sky-Brightness Response (Gates 13 & 16)
    const isNight = tod >= 0.65 || tod <= 0.20
    const dist = 65.0
    const moonPos = moonPosition(tod, moonPositionScratch)
    const { x: mx, y: my, z: mz } = moonPos

    const moonElevation = isNight ? Math.max(0, my / dist) : 0
    const limitMag = calculateLimitingMagnitude(tod, cloud, rain, moonElevation)

    // 4) Update GPU Shader Uniforms (Gates 2, 5, 6, 7, 8, 9, 14, 27)
    starMaterial.uniforms.uTime.value = t
    starMaterial.uniforms.uPixelRatio.value = pr
    starMaterial.uniforms.uLimitMag.value = limitMag
    starMaterial.uniforms.uExtinctionCoeff.value = 0.18 + cloud * 0.08
    starMaterial.uniforms.uScintillationScale.value = 1.0 + Math.min(0.35, rain * 0.4)

    // 5) Dynamic Shooting Stars / Meteors: Rare, Atmospheric Transients (Gate 26)
    const m = meteorState.current
    if (limitMag > 2.5) {
      m.timer -= dt
      if (m.timer <= 0 && !m.active) {
        m.active = true
        m.progress = 0
        // Rare natural interval (30-75s)
        m.timer = 30.0 + Math.random() * 45.0

        const az = Math.random() * Math.PI * 2
        const alt = 0.45 + Math.random() * 0.40
        const r = 73.0
        m.start.set(
          Math.cos(az) * Math.cos(alt) * r,
          Math.sin(alt) * r,
          Math.sin(az) * Math.cos(alt) * r,
        )
        const streakDir = new THREE.Vector3(
          (Math.random() - 0.5) * 22,
          -8 - Math.random() * 12,
          (Math.random() - 0.5) * 22,
        ).normalize()
        m.end.copy(m.start).addScaledVector(streakDir, 14 + Math.random() * 8)
      }

      if (m.active && meteorRef.current) {
        m.progress += dt * 2.2 // Fast atmospheric transit (~0.45s)
        if (m.progress >= 1) {
          m.active = false
          meteorRef.current.visible = false
        } else {
          meteorRef.current.visible = true
          const geo = meteorRef.current.geometry as THREE.BufferGeometry
          const pos = geo.getAttribute("position") as THREE.BufferAttribute
          const arr = pos.array as Float32Array

          const headT = Math.min(1, m.progress * 1.25)
          const tailT = Math.max(0, m.progress * 1.25 - 0.35)

          const headPos = new THREE.Vector3().lerpVectors(m.start, m.end, headT)
          const tailPos = new THREE.Vector3().lerpVectors(m.start, m.end, tailT)

          arr[0] = headPos.x
          arr[1] = headPos.y
          arr[2] = headPos.z
          arr[3] = tailPos.x
          arr[4] = tailPos.y
          arr[5] = tailPos.z
          pos.needsUpdate = true

          const mat = meteorRef.current.material as THREE.LineBasicMaterial
          const alpha = Math.sin(m.progress * Math.PI) * Math.max(0, 1 - cloud * 0.7) * 0.95
          mat.opacity = alpha
        }
      }
    } else if (meteorRef.current) {
      meteorRef.current.visible = false
    }

    // 6) 3D Lunar Body & Corona Lighting
    if (moon.current) {
      const moonVisible = isNight && weatherDim > 0.08
      moon.current.visible = moonVisible
      if (moonVisible) {
        moon.current.position.set(mx, my, mz)
        lookAtLogical(moon.current, 0, 1.5, 0)

        const moonAlpha = Math.min(1, (tod >= 0.65 ? (tod - 0.65) * 8.0 : 1.0)) * weatherDim * homeSky.stars.value

        if (moonSphere.current) {
          const mat = moonSphere.current.material as THREE.MeshBasicMaterial
          mat.opacity = moonAlpha * 0.98
        }
        if (moonInnerHalo.current) {
          const mat = moonInnerHalo.current.material as THREE.MeshBasicMaterial
          mat.opacity = moonAlpha * 0.45
        }
        if (moonOuterCorona.current) {
          const mat = moonOuterCorona.current.material as THREE.MeshBasicMaterial
          mat.opacity = moonAlpha * 0.28
        }
      }
    }
  })

  return (
    <group ref={groupRef}>
      {/* 1) Coherent Celestial Sphere with Latitude Tilt (home/home ~19.28°N) */}
      <group ref={celestialTiltRef}>
        {/* Sidereal Diurnal Axis: constellations rotate as ONE rigid coordinate system */}
        <group ref={celestialRotateRef}>
          {/* A) All Stars: Bright Catalogue + Faint Background (Scintillation, Extinction & Desaturation) */}
          <points
            ref={starsRef}
            geometry={starsGeo}
            material={starMaterial}
            renderOrder={-7}
            frustumCulled={false}
          />

          {/* B) Naked-Eye Classical Planets (Venus, Jupiter, Mars, Saturn, Mercury, Uranus) with Steady Radiance */}
          <points
            ref={planetsRef}
            geometry={planetsGeo}
            material={starMaterial}
            renderOrder={-7}
            frustumCulled={false}
          />
        </group>
      </group>

      {/* 2) Dynamic Shooting Star / Meteor Streak in Earth's Atmosphere */}
      <lineSegments ref={meteorRef} geometry={meteorGeo} visible={false} renderOrder={-6}>
        <lineBasicMaterial
          color="#ffffff"
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          fog={false}
          linewidth={2}
        />
      </lineSegments>

      {/* 3) Authentic 3D Textured Moon with Volumetric Corona */}
      <group ref={moon} visible={false} renderOrder={-5}>
        {/* 3D Lunar Body with Authentic Maria & Highland Features */}
        <mesh ref={moonSphere} frustumCulled={false}>
          <sphereGeometry args={[3.2, 32, 24]} />
          <meshBasicMaterial
            map={moonTexture}
            color="#fffcf2"
            transparent
            opacity={0}
            fog={false}
            depthWrite={false}
          />
        </mesh>

        {/* Inner Soft Lunar Halo */}
        <mesh ref={moonInnerHalo} position={[0, 0, -0.05]} frustumCulled={false}>
          <planeGeometry args={[10.5, 10.5]} />
          <meshBasicMaterial
            map={coronaTexture}
            color="#e2eeff"
            transparent
            opacity={0}
            fog={false}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* Outer Celestial Corona */}
        <mesh ref={moonOuterCorona} position={[0, 0, -0.1]} frustumCulled={false}>
          <planeGeometry args={[20.0, 20.0]} />
          <meshBasicMaterial
            map={coronaTexture}
            color="#99bcee"
            transparent
            opacity={0}
            fog={false}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
    </group>
  )
}
