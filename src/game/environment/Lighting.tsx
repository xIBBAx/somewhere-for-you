import { highvaleClarity } from "../../world/highvale/render/highvaleClarity"
import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { lookAtLogical } from "../../world/render/WorldRoot"
import { damp, smoothstep } from "../../utils/math"
import { avatarRT, worldRT } from "../runtime"
import { weatherRT } from "../weather/weatherState"
import { solarCoronaTexture, solarFlareTexture } from "../../utils/canvasTexture"
import { QUALITY, useQuality } from "../../state/qualityStore"
import { windRT } from "../../world/wind"
import { spaceRT, sunFromEye, universeDirToLocal } from "../celestial/spaceState"
import { universe } from "../celestial/universe"
import { airDensity } from "../celestial/scale"
import { keyLightDirection, nightBlend, solarVisibility, sunDirection, canSwitchMorning, celestialRT, dawnWeight } from "./celestialLighting"
import { AERIAL, HAZE_ANTI, HAZE_BAND, HAZE_GLOW, HAZE_GLSL, HAZE_SUN, updateAerial } from "../../world/render/aerialFog"
import { fireworksRT } from "./Fireworks"


/**
 * Time-of-day emotional arc: soft day → warm afternoon → golden hour →
 * twilight. Pure interpolation, no astronomy.
 */
type SkyKey = {
  at: number
  bg: string
  fog: string
  sun: string
  sunI: number
  hemiSky: string
  hemiGround: string
  hemiI: number
  zenith?: string
}

const KEYS: SkyKey[] = [
  // Clear morning: saturated cyan horizon, green bounce light from the meadow
  { at: 0, bg: "#b8e0f4", fog: "#c4e2ef", sun: "#fff3d8", sunI: 2.15, hemiSky: "#c8e0f6", hemiGround: "#b2c494", hemiI: 1.3 },
  { at: 0.12, bg: "#b0dcf2", fog: "#bfe0ee", sun: "#fff8e8", sunI: 2.35, hemiSky: "#c4dff6", hemiGround: "#aec392", hemiI: 1.36 },
  { at: 0.28, bg: "#aad9f1", fog: "#badded", sun: "#fffbf2", sunI: 2.5, hemiSky: "#c0ddf6", hemiGround: "#acc390", hemiI: 1.4 },
  { at: 0.45, bg: "#b0dbf1", fog: "#bfdfee", sun: "#fff6e4", sunI: 2.4, hemiSky: "#c4def4", hemiGround: "#b0c393", hemiI: 1.36 },
  // Late afternoon: horizon warms toward peach
  { at: 0.6, bg: "#c4d6e0", fog: "#cbd5d6", zenith: "#3f80cc", sun: "#ffd49a", sunI: 2.5, hemiSky: "#b4c9ee", hemiGround: "#a3ab78", hemiI: 1.14 },
  // Golden hour: amber, coral and rose
  { at: 0.72, bg: "#e3ac9e", fog: "#deb2a4", zenith: "#4f6db8", sun: "#ffa152", sunI: 2.7, hemiSky: "#9fade6", hemiGround: "#8f7c56", hemiI: 0.92 },
  // Blue hour: the sky keeps a luminous violet-blue a long while after the sun
  { at: 0.84, bg: "#5d5f8e", fog: "#666c8c", zenith: "#243362", sun: "#c9cdf2", sunI: 0.62, hemiSky: "#aebbe0", hemiGround: "#8c8a98", hemiI: 0.82 },
  // A bright moonlit night: the sky stays a deep, clear blue and the moon
  // silvers the meadow, so faces and paths are easy to read.
  // Never reuse the brighter hemisphere light colour as the sky itself.
  { at: 0.92, bg: "#1d3157", fog: "#2f4264", zenith: "#0b1834", sun: "#c8dbf6", sunI: 0.86, hemiSky: "#aec2e6", hemiGround: "#9e9cab", hemiI: 0.98 },
  { at: 1, bg: "#142650", fog: "#2a3d60", zenith: "#07112a", sun: "#cadcf6", sunI: 0.92, hemiSky: "#aec2e6", hemiGround: "#9e9cab", hemiI: 1.02 },
]

/** Base exposure on a clear day; Lighting opens it a little at night and under storms. */
const EXPOSURE_DAY = 0.98
/** a foggy morning: pearl by day, a soft blue-grey glow by night */
const MIST_DAY = new THREE.Color("#e6ebee")
const MIST_NIGHT = new THREE.Color("#3a4a66")

/** Share of sky light carried by the analytic hemisphere vs the sky PMREM. */
const HEMI_SHARE = 0.55
const ENV_DAY = 0.84
const ENV_NIGHT = 2.1

const NIGHT_OVERCAST = new THREE.Color("#121c30")
const NIGHT_FOG = new THREE.Color("#1e2a3d")
/** under a storm's core: the slate of a cumulonimbus base, and the grey wall of the rain itself */
const STORM_SKY = new THREE.Color("#617487")
const STORM_FOG = new THREE.Color("#788694")
const weatherColor = new THREE.Color()

const C_5DAEE0 = new THREE.Color("#5daee0")
const C_7A93AD = new THREE.Color("#6f97c4")
const C_7B92A8 = new THREE.Color("#7e9fc2")
const C_889CB2 = new THREE.Color("#8eaec9")
const C_8A9AB0 = new THREE.Color("#6f9a78")
const C_8A9FB5 = new THREE.Color("#97b6cf")
const C_C5E8F0 = new THREE.Color("#c5e8f0")
const C_C9D7E8 = new THREE.Color("#c9d7e8")
const C_CBD5E1 = new THREE.Color("#cbd5e1")
const C_D2DEEA = new THREE.Color("#c4dcf2")
const C_DFE7EE = new THREE.Color("#dfe7ee")
const C_E0F2FE = new THREE.Color("#e0f2fe")
const C_FFF4DD = new THREE.Color("#fff4dd")
const cA = new THREE.Color()
const cB = new THREE.Color()

const lerpColor = (out: THREE.Color, a: string, b: string, t: number): void => {
  cA.set(a)
  cB.set(b)
  out.copy(cA).lerp(cB, t)
}

// a clear dawn: rose-lavender sky and haze, pale gold sun
const DAWN_SKY = new THREE.Color("#d6b9cf")
const DAWN_HAZE = new THREE.Color("#dcc8d4")
const SPACE_BLACK = new THREE.Color("#000000")
const SPACE_SUNLIGHT = new THREE.Color("#fff8ee")
/** QA (`?debug`): the key light and fills as last set */
export const lightingRT = { sunI: 0, sunDir: [0, 0, 0] as number[], lit: 1, hemiI: 0, env: 0, amb: 0, earthshine: 0, veil: 0 }
const _es = new THREE.Vector3()
const _ss = new THREE.Vector3()
const _se = new THREE.Vector3()
/** the Moon: earthshine overhead, sunlight bounced off grey-brown regolith below */
const EARTHSHINE = new THREE.Color("#3a4250")
const REGOLITH_BOUNCE = new THREE.Color("#8a847a")
const spaceSun = new THREE.Vector3()
const UP_AXIS = new THREE.Vector3(0, 1, 0)
const shadowDir = new THREE.Vector3()
const shadowRight = new THREE.Vector3()
const shadowUp = new THREE.Vector3()
const shadowCentre = new THREE.Vector3()
const DAWN_ZENITH = new THREE.Color("#7d8fc4")
/** the haze's glow (linear): white-gold by day, amber in the golden hour, rose after; rose-gold at dawn */
const HAZE_DAY = new THREE.Color().setRGB(1.0, 0.94, 0.82)
const HAZE_GOLD = new THREE.Color().setRGB(1.0, 0.58, 0.24)
const HAZE_ROSE = new THREE.Color().setRGB(0.95, 0.42, 0.38)
const HAZE_DAWN = new THREE.Color().setRGB(1.0, 0.66, 0.55)
const hazeColor = new THREE.Color()
const hazeSun = new THREE.Vector3()
const DAWN_SUN = new THREE.Color("#ffd9b3")

export const Lighting = (): React.ReactElement => {
  const quality = QUALITY[useQuality((s) => s.level)]
  const { scene, gl } = useThree()
  const sun = useRef<THREE.DirectionalLight>(null)
  const sunTarget = useMemo(() => new THREE.Object3D(), [])
  const hemi = useRef<THREE.HemisphereLight>(null)
  const amb = useRef<THREE.AmbientLight>(null)
  const rim = useRef<THREE.PointLight>(null)
  const earthshine = useRef<THREE.DirectionalLight>(null)

  const sunGroup = useRef<THREE.Group>(null)
  const sunCoreMesh = useRef<THREE.Mesh>(null)
  const sunCoronaMesh = useRef<THREE.Mesh>(null)
  const sunHaloMesh = useRef<THREE.Mesh>(null)
  const sunFlareMesh = useRef<THREE.Mesh>(null)

  const coronaTexture = useMemo(() => solarCoronaTexture(), [])
  const flareTexture = useMemo(() => solarFlareTexture(), [])

  const bg = useMemo(() => new THREE.Color("#c5e8f0"), [])
  const fog = useMemo(() => new THREE.Fog("#c4e5ec", 55, 160), [])
  const tmpColor = useMemo(() => new THREE.Color(), [])
  const skyTop = useMemo(() => new THREE.Color(), [])
  const skyBottom = useMemo(() => new THREE.Color(), [])
  const sunGlow = useMemo(() => new THREE.Color(), [])
  const sunPosVec = useMemo(() => new THREE.Vector3(), [])
  const sunIntensityRef = useRef(1.0)
  // 0..1 how much of a foggy morning is in the air (damped, so it rolls in and lifts)
  const mist = useRef(0)
  const skyMaterial = useMemo(() => createSkyMaterial(), [])
  const envGround = useMemo(() => new THREE.Color("#4a5a35"), [])

  useEffect(() => {
    gl.toneMapping = THREE.CustomToneMapping
    gl.toneMappingExposure = EXPOSURE_DAY
  }, [gl])

  useEffect(() => {
    if (!sun.current) return
    const shadow = sun.current.shadow
    shadow.map?.dispose()
    shadow.map = null
    shadow.camera.updateProjectionMatrix()
    shadow.needsUpdate = true
  }, [quality])

  useFrame((_, rawDt) => {
    const player = avatarRT().pos
    // Lighting is presentation time, not physics time. A tight physics clamp
    // made manual NIGHT take nearly a minute under low-FPS/software WebGL.
    const visualDt = Math.min(Math.max(rawDt, 1e-4), 0.25)
    worldRT.timeOfDay = damp(worldRT.timeOfDay, worldRT.timeOverride ?? worldRT.timeOfDayTarget, 0.85, visualDt)
    const t = worldRT.timeOfDay
    const night = nightBlend(t)
    const cloud = weatherRT.cloud
    const rain = weatherRT.rain
    // Under a thunderstorm's base the light falls to a fraction of an
    // ordinary overcast day (a cumulonimbus is kilometres thick), and a
    // cloudburst's rain is a grey wall the eye cannot see far into. 0 on an
    // ordinary rainy day, ~0.85 in heavy rain from a full overcast, up to ~1.4
    // in a cloudburst.
    // Only under the cloud: climb out above the deck (or leave the Earth) and the light is back.
    const underDeck = spaceRT.realm === "earth" ? 1 - smoothstep(70, 180, spaceRT.weatherAltitude) : 0
    const storm = Math.min(1.4, smoothstep(0.5, 1, rain) * smoothstep(0.75, 1, cloud) + weatherRT.burst * 0.55) * underDeck
    const stormDim = 1 - Math.min(1, storm) * 0.3 - Math.max(0, storm - 1) * 0.3
    // morning or evening: switched only where it cannot be seen
    if (canSwitchMorning(t)) celestialRT.morning = worldRT.morningOverride ?? worldRT.morningTarget
    // dawn light is cooler and softer than dusk: rose and lavender with pale
    // gold, rather than deep orange and crimson
    const dawn = dawnWeight(t) * (1 - smoothstep(0.4, 0.9, cloud))

    let i = 0
    while (i < KEYS.length - 2 && t > KEYS[i + 1].at) i++
    const a = KEYS[i]
    const b = KEYS[i + 1]
    const k = smoothstep(a.at, b.at, t)

    lerpColor(bg, a.bg, b.bg, k)
    // Overcast/rain cools and slightly darkens the sky – much less aggressive at clear
    if (cloud > 0.35 || rain > 0.18) {
      const overcast = Math.max(cloud * 0.32, rain * 0.42)
      weatherColor.copy(C_7B92A8).lerp(NIGHT_OVERCAST, night)
      bg.lerp(weatherColor, overcast * 0.34)
    }
    if (storm > 0) bg.lerp(weatherColor.copy(STORM_SKY).lerp(NIGHT_OVERCAST, night), Math.min(1, storm * 0.55))
    if (dawn > 0) bg.lerp(DAWN_SKY, dawn * 0.4)
    scene.background = bg
    lerpColor(tmpColor, a.fog, b.fog, k)
    if (cloud > 0.4) tmpColor.lerp(weatherColor.copy(C_889CB2).lerp(NIGHT_FOG, night), cloud * 0.28)
    if (storm > 0) tmpColor.lerp(weatherColor.copy(STORM_FOG).lerp(NIGHT_FOG, night), Math.min(1, storm * 0.5))
    fog.color.copy(tmpColor)
    if (dawn > 0) fog.color.lerp(DAWN_HAZE, dawn * 0.45)
    // fog is a bright, pearly veil lit from inside by the sun it hides, never a grey wall
    mist.current = damp(mist.current, weatherRT.condition === "fog" ? 1 : 0, 0.35, visualDt)
    const misty = mist.current * underDeck
    if (misty > 0.001) {
      weatherColor.copy(MIST_DAY).lerp(MIST_NIGHT, night)
      fog.color.lerp(weatherColor, misty * 0.85)
      bg.lerp(weatherColor, misty * 0.7)
    }
    // Clear air carries the eye out to the far hills (world/farTerrain.ts);
    // cloud and rain close the horizon in. Clear-day haze is ~40 % at the
    // edge of the streamed chunks, so their trees fade into the far woods.
    const murk = cloud * 0.65 + rain * 0.55
    fog.near = THREE.MathUtils.lerp(85, 30, cloud * 0.72 + rain * 0.45)
    fog.far = THREE.MathUtils.lerp(720, 120, Math.min(1, murk * 1.15))
    // Highvale's mountain air is clear: on a fine day the eye carries across the
    // valley to the snow (the peaks beyond the far plane: world/highvale/render/HighvaleRange.tsx)
    const clear = highvaleClarity(player.x, player.z, visualDt) * (1 - Math.min(1, murk * 0.9))
    // how much weather stands between the eye and the far mountains, for the
    // layers drawn without three's fog (Highvale's range): fog, rain and cloud alike
    lightingRT.veil = Math.max(misty, Math.min(1, murk * 0.9), Math.min(1, weatherRT.burst))
    if (clear > 0) {
      fog.near = THREE.MathUtils.lerp(fog.near, 420, clear)
      fog.far = THREE.MathUtils.lerp(fog.far, 5200, clear)
    }
    // a cloudburst: the rain itself is a veil a few tens of metres deep
    if (misty > 0.001) {
      fog.near = THREE.MathUtils.lerp(fog.near, 6, misty)
      fog.far = THREE.MathUtils.lerp(fog.far, 115, misty)
    }
    fog.near *= 1 - weatherRT.burst * 0.65
    fog.far *= 1 - weatherRT.burst * 0.5
    // high in the thin air the haze is the air below you, seen through very
    // little: it recedes as you climb, and the sky behind it turns to space
    const altitude = spaceRT.realm === "earth" ? spaceRT.skyAltitude : 1e6
    const density = airDensity(altitude)
    const thin = 1 - density
    skyMaterial.uniforms.uDensity.value = density
    // the deck's tops are ~10 km up (160 m the explorer); by ~20 km it is all below
    skyMaterial.uniforms.uAboveDeck.value = smoothstep(160, 320, altitude)
    // as celestial/render/CelestialSky.tsx sets Earth's uSkyWeight
    skyMaterial.uniforms.uSkyHandover.value = smoothstep(0.55, 0.97, thin)
    // the same haze over every layer of land seen from the air (aerialFog.ts)
    updateAerial(spaceRT.realm === "earth" ? Math.max(0.001, spaceRT.skyAltitude) : -1)
    // The aerial haze is tuned to the shrunken sky, where a kilometre of
    // sight line from 200 m up stands for tens of real kilometres. Highvale's
    // mountains are life-size, so over the massif the air between them is
    // as thin as the range's own (HighvaleRange.tsx: ~2.4 km per e-fold of
    // blue) until Starborn climbs toward the sail and the planet takes over.
    const keepClear = clear * (1 - smoothstep(650, 1000, altitude))
    if (keepClear > 0) {
      for (let i = 0; i < 3; i++) AERIAL[i] *= 1 - keepClear * 0.86
      AERIAL[3] *= 1 - keepClear * 0.6
    }
    const recede = 1 + Math.max(0, altitude - 60) / 25
    fog.near *= recede
    fog.far *= recede
    if (thin > 0) bg.lerp(SPACE_BLACK, thin)
    scene.fog = fog

    // Sky gradient top (zenith) vs bottom (horizon) – vibrant azure depth
    lerpColor(skyTop, a.zenith ?? (a.at < 0.6 ? "#3b93dc" : a.hemiSky), b.zenith ?? (b.at < 0.6 ? "#3b93dc" : b.hemiSky), k)
    lerpColor(skyBottom, a.bg, b.bg, k)
    if (cloud > 0.4) {
      skyTop.lerp(weatherColor.copy(C_7A93AD).lerp(NIGHT_OVERCAST, night), cloud * 0.35)
      skyBottom.lerp(weatherColor.copy(C_8A9FB5).lerp(NIGHT_FOG, night), cloud * 0.35)
    }

    if (storm > 0) {
      skyTop.lerp(weatherColor.copy(STORM_SKY).lerp(NIGHT_OVERCAST, night), Math.min(1, storm * 0.6))
      skyBottom.lerp(weatherColor.copy(STORM_FOG).lerp(NIGHT_FOG, night), Math.min(1, storm * 0.5))
    }
    if (dawn > 0) { skyTop.lerp(DAWN_ZENITH, dawn * 0.4); skyBottom.lerp(DAWN_SKY, dawn * 0.4) }
    if (misty > 0.001) {
      weatherColor.copy(MIST_DAY).lerp(MIST_NIGHT, night)
      skyTop.lerp(weatherColor, misty * 0.6)
      skyBottom.lerp(weatherColor, misty * 0.85)
    }

    // Solar atmospheric forward-scattering glow
    const golden = Math.max(0, 1 - Math.abs(t - 0.72) * 3.2)
    const dusk = Math.max(0, (t - 0.78) * 4)
    const day = Math.max(0, 1 - dusk * 1.5 - golden * 0.5)

    sunGlow.setRGB(
      1.0,
      0.92 - golden * 0.28 - dusk * 0.45,
      0.75 - golden * 0.55 - dusk * 0.35,
    )
    sunIntensityRef.current = (day * 0.68 + golden * 0.92) * (1 - cloud * 0.6) * solarVisibility(t)

    // Directional Sunlight positioning & color
    if (sun.current) {
      lerpColor(tmpColor, a.sun, b.sun, k)
      // Cloud diffuses sunlight; rain cools it further
      if (cloud > 0.5) tmpColor.lerp(C_DFE7EE, cloud * 0.45)
      if (rain > 0.3) tmpColor.lerp(C_C9D7E8, rain * 0.35)
      if (dawn > 0) tmpColor.lerp(DAWN_SUN, dawn * 0.5)
      sun.current.color.copy(tmpColor)
      // overcast light is diffuse: direct sun (and its hard shadows) fades out
      // while the sky fill below takes over
      const cloudDim = 1 - smoothstep(0.3, 0.95, cloud) * 0.74 - rain * 0.1
      sun.current.intensity = THREE.MathUtils.lerp(a.sunI, b.sunI, k) * Math.max(0.14, cloudDim) * (1 - Math.min(1, storm) * 0.5)
      // Sun swings low and west as the day ages
      keyLightDirection(t, sun.current.position)
      // out of the air the light comes from the real Sun, wherever the
      // riders have turned, and goes out in a world's shadow
      const space = smoothstep(0.35, 0.9, thin)
      if (space > 0) {
        const lit = sunFromEye(spaceSun)
        lightingRT.lit = lit
        lightingRT.sunDir = spaceSun.toArray().map((v) => +v.toFixed(3))
        sun.current.position.lerp(spaceSun, space).normalize()
        sun.current.intensity = THREE.MathUtils.lerp(sun.current.intensity, 2.6 * lit, space)
        sun.current.color.lerp(SPACE_SUNLIGHT, space)
      }
      // light and shadow frustum travel with the explorer, including over hills, in
      // whole shadow-map texels across the light's own view (the basis three's
      // lookAt gives the shadow camera): shadow edges stay put on the ground
      // as she moves instead of crawling and shimmering
      shadowDir.copy(sun.current.position).normalize()
      shadowRight.crossVectors(UP_AXIS, shadowDir)
      if (shadowRight.lengthSq() < 1e-8) shadowRight.set(1, 0, 0)
      shadowRight.normalize()
      shadowUp.crossVectors(shadowDir, shadowRight)
      const texel = (2 * quality.shadowRange) / quality.shadow
      const across = player.dot(shadowRight), up = player.dot(shadowUp)
      shadowCentre.copy(player)
        .addScaledVector(shadowRight, Math.round(across / texel) * texel - across)
        .addScaledVector(shadowUp, Math.round(up / texel) * texel - up)
      sun.current.position.copy(shadowDir).multiplyScalar(26).add(shadowCentre)
      sun.current.target.position.copy(shadowCentre)
      sun.current.target.updateMatrixWorld()

      // Direction vector to sun for Mie scattering
      sunDirection(t, sunPosVec)

      // Realistic Multi-Layer Atmospheric Sun Rig
      if (sunGroup.current) {
        const dist = 72
        sunGroup.current.position.copy(sunPosVec).multiplyScalar(dist).add(player)

        const sunVisible = t < 0.88 && cloud < 0.68 // hide when heavily overcast or deep night
        // out of the air the real Sun (celestial/render) takes over
        const targetScale = sunVisible ? 1.0 - smoothstep(0.3, 0.75, thin) : 0.0
        sunGroup.current.scale.setScalar(
          THREE.MathUtils.damp(sunGroup.current.scale.x, targetScale, 1.2, visualDt),
        )

        // Make billboard look at player
        lookAtLogical(sunGroup.current, player.x, player.y + 1.5, player.z)

        // Sun Color Calibration
        const noon = Math.max(0, 1 - Math.abs(t - 0.29) * 2.2)
        const warm = Math.max(0, 1 - Math.abs(t - 0.71) * 3.8)
        const sunsetCrimson = Math.max(0, (t - 0.73) * 5.5)

        const coreR = 1.0
        const coreG = 0.97 - warm * 0.18 - sunsetCrimson * 0.28 + noon * 0.03
        const coreB = 0.86 - warm * 0.38 - sunsetCrimson * 0.45 + noon * 0.14

        // 1. Core Disc Material
        if (sunCoreMesh.current) {
          const mat = sunCoreMesh.current.material as THREE.MeshBasicMaterial
          mat.color.setRGB(coreR, coreG, coreB)
          mat.opacity = THREE.MathUtils.damp(
            mat.opacity,
            sunVisible ? (1 - cloud * 0.5) * 0.98 : 0,
            1.5,
            visualDt,
          )
        }

        // 2. Coronal Radiance Material
        if (sunCoronaMesh.current) {
          const mat = sunCoronaMesh.current.material as THREE.MeshBasicMaterial
          mat.color.setRGB(1.0, 0.92 - warm * 0.12, 0.72 - warm * 0.32)
          mat.opacity = THREE.MathUtils.damp(
            mat.opacity,
            sunVisible ? (1 - cloud * 0.55) * 0.72 : 0,
            1.5,
            visualDt,
          )
          const coronaScale = 1.0 + warm * 0.45
          sunCoronaMesh.current.scale.setScalar(coronaScale)
        }

        // 3. Wide Atmospheric Halo Material
        if (sunHaloMesh.current) {
          const mat = sunHaloMesh.current.material as THREE.MeshBasicMaterial
          mat.color.setRGB(1.0, 0.88 - warm * 0.18, 0.65 - warm * 0.4)
          mat.opacity = THREE.MathUtils.damp(
            mat.opacity,
            sunVisible ? (1 - cloud * 0.6) * (0.35 + warm * 0.3) : 0,
            1.5,
            visualDt,
          )
          const haloScale = 1.0 + warm * 0.65
          sunHaloMesh.current.scale.setScalar(haloScale)
        }

        // 4. Anamorphic Glare & Diffraction Flare
        if (sunFlareMesh.current) {
          const mat = sunFlareMesh.current.material as THREE.MeshBasicMaterial
          mat.color.setRGB(1.0, 0.92 - warm * 0.15, 0.78 - warm * 0.35)
          mat.opacity = THREE.MathUtils.damp(
            mat.opacity,
            sunVisible ? (1 - cloud * 0.65) * (0.28 + noon * 0.15 + warm * 0.22) : 0,
            1.5,
            visualDt,
          )
        }
      }
    }

    // ---- The sunlit haze (aerialFog.ts), shared by every fogged material and
    // the sky dome: a glow round the sun, a warm band along the horizon under
    // it from late afternoon, and at twilight the Earth's shadow opposite.
    {
      const vis = solarVisibility(t) * (1 - smoothstep(0.35, 0.9, thin))
      const clearAir = Math.max(0, 1 - smoothstep(0.3, 0.95, cloud) * 0.8 - Math.min(1, storm) * 0.2)
      const warm = smoothstep(0.5, 0.7, t)
      const rose = smoothstep(0.72, 0.84, t)
      sunDirection(t, hazeSun)
      HAZE_SUN[0] = hazeSun.x; HAZE_SUN[1] = hazeSun.y; HAZE_SUN[2] = hazeSun.z
      // in fog the hidden sun is a bright patch in the veil, whatever the hour
      HAZE_SUN[3] = (0.15 + 0.3 * warm) * vis * clearAir * (1 - misty * 0.5) + misty * 0.32 * (1 - night)
      hazeColor.copy(HAZE_DAY).lerp(HAZE_GOLD, warm).lerp(HAZE_ROSE, rose * 0.7)
      if (dawn > 0) hazeColor.lerp(HAZE_DAWN, dawn * 0.75)
      if (misty > 0.001) hazeColor.lerp(HAZE_DAY, misty)
      HAZE_GLOW[0] = hazeColor.r; HAZE_GLOW[1] = hazeColor.g; HAZE_GLOW[2] = hazeColor.b
      HAZE_GLOW[3] = THREE.MathUtils.lerp(9, 4.2, Math.max(warm, misty))
      const band = smoothstep(0.55, 0.7, t) * (1 - smoothstep(0.82, 0.9, t)) * clearAir * (1 - misty) * (1 - smoothstep(0.35, 0.9, thin))
      HAZE_BAND[0] = hazeColor.r * 0.42 * band; HAZE_BAND[1] = hazeColor.g * 0.36 * band; HAZE_BAND[2] = hazeColor.b * 0.3 * band
      HAZE_BAND[3] = 7
      const twilight = smoothstep(0.71, 0.78, t) * (1 - smoothstep(0.87, 0.94, t)) * clearAir * (1 - misty) * (1 - smoothstep(0.35, 0.9, thin))
      HAZE_ANTI[0] = -0.05 * twilight; HAZE_ANTI[1] = -0.045 * twilight; HAZE_ANTI[2] = -0.012 * twilight
      skyMaterial.uniforms.uTwilight.value.set(twilight, 0.012 + 0.2 * smoothstep(0.72, 0.9, t), 0, 0)
    }

    // the eye opens up in the dark and under a heavy sky: the world stays bright
    // and readable in every weather, while its colour still tells the hour
    const exposureTarget = EXPOSURE_DAY + night * 0.2 + Math.min(1, storm) * 0.1 + smoothstep(0.55, 1, cloud) * 0.05 * (1 - night) + misty * 0.04
    gl.toneMappingExposure = damp(gl.toneMappingExposure, spaceRT.realm === "earth" ? exposureTarget : EXPOSURE_DAY + 0.04, 1.4, visualDt)
    // a single non-finite frame (a degenerate camera, say) must not leave the eye black for good
    if (!Number.isFinite(gl.toneMappingExposure)) gl.toneMappingExposure = EXPOSURE_DAY
    const lightning = worldRT.lightning
    if (hemi.current) {
      lerpColor(tmpColor, a.hemiSky, b.hemiSky, k)
      if (cloud > 0.45) tmpColor.lerp(C_D2DEEA, cloud * 0.26 * (1 - night))
      if (lightning > 0.05) tmpColor.lerp(C_E0F2FE, lightning * 0.9)
      hemi.current.color.copy(tmpColor)
      lerpColor(tmpColor, a.hemiGround, b.hemiGround, k)
      if (rain > 0.25) tmpColor.lerp(C_8A9AB0, rain * 0.18 * (1 - night))
      if (lightning > 0.05) tmpColor.lerp(C_CBD5E1, lightning * 0.8)
      hemi.current.groundColor.copy(tmpColor)
      envGround.copy(tmpColor).multiplyScalar(0.42)
      // an overcast sky is a large soft light: fill stays strong so rainy
      // days read as fresh and colourful rather than grey and dim
      // (but not under a storm: a thunderhead is a dark lid, not a softbox)
      const cloudHemi = (1 + smoothstep(0.3, 0.95, cloud) * THREE.MathUtils.lerp(0.45, -0.3, night) * (1 - Math.min(1, storm)) - rain * 0.12) * stormDim
      // the sky environment (SkyEnvironment) now carries most of the diffuse
      // sky light, so the analytic hemisphere is only a soft remainder
      hemi.current.intensity =
        (THREE.MathUtils.lerp(a.hemiI, b.hemiI, k) * Math.max(0.5 * stormDim, cloudHemi)) * HEMI_SHARE + lightning * 3.2
      scene.environmentIntensity = THREE.MathUtils.lerp(ENV_DAY, ENV_NIGHT, night) * (stormDim + lightning * 2) * (0.3 + 0.7 * density)
      // no sky overhead in space: the fill is the planet below, much dimmer
      hemi.current.intensity *= 0.3 + 0.7 * density
      // a firework's burst washes the meadow in its colour for a moment
      const flash = fireworksRT.flash
      if (flash > 0.01) {
        hemi.current.color.lerp(fireworksRT.flashColor, flash * 0.45)
        hemi.current.intensity += flash * 0.5 * night
      }
    }
    if (amb.current) {
      const baseAmb = THREE.MathUtils.lerp(0.1, 0.075, night)
      const diffuseBoost = cloud * 0.08
      amb.current.intensity =
        (baseAmb * (1 + diffuseBoost) * Math.max(0.88, 1 - rain * 0.12) * stormDim) + lightning * 2.5
    }
    // on another world there is no sky to light anything: the sky is black,
    // and the only fill is sunlight thrown back up by the grey regolith and
    // a little earthshine from above
    if (sun.current) lightingRT.sunI = sun.current.intensity
    if (spaceRT.realm !== "earth" && hemi.current && amb.current) {
      const lit = sun.current ? Math.min(1, sun.current.intensity / 2.6) : 1
      hemi.current.color.copy(EARTHSHINE)
      hemi.current.groundColor.copy(REGOLITH_BOUNCE)
      // a little more of that bounce than the bare physics, so the shadowed
      // side of a crater or a rider still reads instead of falling to black
      hemi.current.intensity = 0.11 + 0.62 * lit
      amb.current.intensity = 0.028
      scene.environmentIntensity = 0.05
    }
    // earthshine: on the Moon, Earth in the sky lights the ground by the
    // sunlight it reflects, strongest at "full Earth" (the lunar night of the
    // near side). Physically it is thousands of times fainter than sunlight;
    // shown here as a bright moonlit night is at home, so the night is seen
    if (earthshine.current) {
      const e = earthshine.current
      let k = 0
      if (spaceRT.realm !== "earth") {
        const earth = universe.byId.get("earth"), sunB = universe.byId.get("sun")
        if (earth && sunB) {
          _es.copy(earth.pos).sub(spaceRT.eye)
          const toSun = _ss.copy(sunB.pos).sub(earth.pos).normalize()
          const toEye = _se.copy(spaceRT.eye).sub(earth.pos).normalize()
          const fullness = (1 + toSun.dot(toEye)) / 2
          universeDirToLocal(_es.normalize(), _es)
          k = fullness * smoothstep(-0.02, 0.08, _es.y)
          e.position.copy(_es).multiplyScalar(26).add(player)
        }
      }
      e.intensity = 0.42 * k
      e.visible = k > 0.002
      lightingRT.earthshine = +k.toFixed(3)
    }
    lightingRT.hemiI = hemi.current?.intensity ?? 0
    lightingRT.env = scene.environmentIntensity
    lightingRT.amb = amb.current?.intensity ?? 0
    if (rim.current) {
      // Rain intensifies warm local light importance vs sun
      const rainyBoost = rain > 0.3 ? rain * 0.35 : 0
      rim.current.intensity = (night * 0.2 + rainyBoost * (1 - night)) + lightning * 1.5
      rim.current.position.set(player.x + 3.5, player.y + 5.5, player.z + 4)
    }
  })

  return (
    <>
      <hemisphereLight name="sky-fill" ref={hemi} args={["#69b8e1", "#a8cf8b", 1.1]} />
      <ambientLight name="ambient-fill" ref={amb} intensity={0.2} />
      <pointLight ref={rim} color="#f2daca" intensity={0} distance={13} decay={2} />
      <directionalLight
        ref={sun}
        name="celestial-key"
        target={sunTarget}
        castShadow
        intensity={2.2}
        shadow-mapSize-width={quality.shadow}
        shadow-mapSize-height={quality.shadow}
        shadow-camera-near={1}
        shadow-camera-far={90}
        shadow-camera-left={-quality.shadowRange}
        shadow-camera-right={quality.shadowRange}
        shadow-camera-top={quality.shadowRange}
        shadow-camera-bottom={-quality.shadowRange}
        shadow-bias={-0.0002}
        shadow-normalBias={0.03}
      />
      <primitive object={sunTarget} />
      {/* on the Moon: Earth's reflected sunlight, from where Earth hangs in the sky */}
      <directionalLight ref={earthshine} name="earthshine" color="#c9d6ec" intensity={0} target={sunTarget} />

      {/* Atmospheric 3D Sun Celestial Body */}
      <group ref={sunGroup} renderOrder={-5}>
        {/* 1. Core Solar Disc (3D Sphere) */}
        <mesh ref={sunCoreMesh} frustumCulled={false}>
          <sphereGeometry args={[2.2, 32, 24]} />
          <meshBasicMaterial color="#fffcf0" transparent opacity={0} fog={false} depthWrite={false} />
        </mesh>

        {/* 2. Solar Inner Corona */}
        <mesh ref={sunCoronaMesh} position={[0, 0, -0.05]} frustumCulled={false}>
          <planeGeometry args={[7.2, 7.2]} />
          <meshBasicMaterial
            map={coronaTexture}
            color="#fff0cc"
            transparent
            opacity={0}
            fog={false}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* 3. Wide Atmospheric Dispersion Halo */}
        <mesh ref={sunHaloMesh} position={[0, 0, -0.1]} frustumCulled={false}>
          <planeGeometry args={[14.5, 14.5]} />
          <meshBasicMaterial
            map={coronaTexture}
            color="#ffdd99"
            transparent
            opacity={0}
            fog={false}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* 4. Anamorphic Solar Glare Streak */}
        <mesh ref={sunFlareMesh} position={[0, 0, 0.05]} frustumCulled={false}>
          <planeGeometry args={[18.0, 7.5]} />
          <meshBasicMaterial
            map={flareTexture}
            color="#fff5e0"
            transparent
            opacity={0}
            fog={false}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>

      <SkyEnvironment material={skyMaterial} ground={envGround} />
      <SkyDome
        skyMaterial={skyMaterial}
        topColor={skyTop}
        bottomColor={skyBottom}
        sunPosition={sunPosVec}
        sunGlowColor={sunGlow}
        sunIntensity={sunIntensityRef}
      />
    </>
  )
}

const createSkyMaterial = (): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        uniforms: {
          topColor: { value: C_5DAEE0 },
          bottomColor: { value: C_C5E8F0 },
          sunPosition: { value: new THREE.Vector3(0, 1, 0) },
          sunGlowColor: { value: C_FFF4DD },
          sunIntensity: { value: 1.0 },
          exponent: { value: 0.72 },
          fogColor: { value: new THREE.Color("#c4e5ec") },
          uCloud: { value: 0 },
          uRain: { value: 0 },
          uNight: { value: 0 },
          uDrift: { value: new THREE.Vector2() },
          uEnvPass: { value: 0 },
          uGround: { value: new THREE.Color("#4a5a35") },
          uDensity: { value: 1 },
          uAboveDeck: { value: 0 },
          uSkyHandover: { value: 0 },
          // the sunlit haze shared with every fogged material (aerialFog.ts)
          uHazeSun: { value: HAZE_SUN },
          uHazeGlow: { value: HAZE_GLOW },
          uHazeBand: { value: HAZE_BAND },
          uHazeAnti: { value: HAZE_ANTI },
          // x: twilight (Belt of Venus above the Earth's shadow), y: the shadow's top (sine of elevation)
          uTwilight: { value: new THREE.Vector4() },
        },
        vertexShader: `
          varying vec3 vSkyDirection;
          void main() {
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vSkyDirection = position;
            gl_Position = projectionMatrix * viewMatrix * worldPos;
          }
        `,
        fragmentShader: `
          uniform vec3 topColor;
          uniform vec3 bottomColor;
          uniform vec3 sunPosition;
          uniform vec3 sunGlowColor;
          uniform float sunIntensity;
          uniform float exponent;
          uniform vec3 fogColor;
          uniform float uCloud;
          uniform float uRain;
          uniform float uNight;
          uniform vec2 uDrift;
          uniform float uEnvPass;
          uniform vec3 uGround;
          uniform float uDensity;
          // 0..1 how far above the weather's cloud deck the eye is
          uniform float uAboveDeck;
          // 0..1 how far Earth's globe (celestial/render) has taken over the air above the horizon
          uniform float uSkyHandover;
          uniform vec4 uHazeSun;
          uniform vec4 uHazeGlow;
          uniform vec4 uHazeBand;
          uniform vec4 uHazeAnti;
          uniform vec4 uTwilight;
          varying vec3 vSkyDirection;
          ${HAZE_GLSL}
          float h21(vec2 p) {
            vec3 p3 = fract(vec3(p.xyx) * 0.1031);
            p3 += dot(p3, p3.yzx + 33.33);
            return fract((p3.x + p3.y) * p3.z);
          }
          float vnoise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
          }
          float fbm(vec2 p) {
            float v = 0.0, a = 0.5;
            for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
            return v;
          }
          void main() {
            vec3 viewDir = normalize(vSkyDirection);
            vec3 sunDir = normalize(sunPosition);

            // Altitude gradient: 0.0 at horizon, 1.0 at zenith
            float h = clamp(viewDir.y, 0.0, 1.0);
            float rayleigh = pow(h, exponent);
            vec3 sky = mix(bottomColor, topColor, rayleigh);

            // Solar Mie forward scattering: the tight corona round the disc here,
            // the broad glow from the haze below (shared with the fog)
            float cosTheta = max(0.0, dot(viewDir, sunDir));
            float mieCorona = pow(cosTheta, 6.0) * 0.12 + pow(cosTheta, 32.0) * 0.68;
            sky += sunGlowColor * mieCorona * sunIntensity * (1.0 - rayleigh * 0.25);
            // the directional haze is the air near the horizon: it thins overhead
            vec3 haze = hazeTint(viewDir);
            sky += haze * (1.0 - 0.6 * rayleigh);

            // Twilight opposite the sun: the Earth's shadow, a dusky blue band
            // rising off the horizon, and above it the Belt of Venus, the rose
            // of the low sun backscattered by the air (it hugs the shadow's edge)
            if (uTwilight.x > 0.001 && viewDir.y > -0.05) {
              vec2 hd = viewDir.xz;
              vec2 ad = -sunDir.xz;
              float hl = length(hd), al = length(ad);
              float facing = (hl > 1e-4 && al > 1e-4) ? dot(hd / hl, ad / al) : 0.0;
              facing = smoothstep(-0.45, 0.9, facing);
              float top = uTwilight.y;
              float shadow = 1.0 - smoothstep(top - 0.03, top + 0.025, viewDir.y);
              float belt = smoothstep(top - 0.015, top + 0.05, viewDir.y) * (1.0 - smoothstep(top + 0.07, top + 0.26, viewDir.y));
              float k = uTwilight.x * facing;
              sky = mix(sky, sky * vec3(0.7, 0.76, 0.96), shadow * k * 0.75);
              sky += vec3(0.6, 0.3, 0.4) * belt * k * 0.42 * (1.0 - uCloud * 0.8);
            }

            // Weather-driven cloud deck projected onto a flat layer overhead:
            // a few fair-weather clouds at low cover, broken sky, then a full
            // soft overcast. Tops catch the sun, bases darken with rain.
            float overcast = smoothstep(0.35, 0.95, uCloud);
            vec3 greySky = mix(mix(vec3(0.66, 0.75, 0.86), vec3(0.52, 0.6, 0.7), uRain), fogColor * 0.75, uNight);
            sky = mix(sky, greySky, overcast * 0.75);
            if (viewDir.y > 0.0) {
              vec2 deck = viewDir.xz / (viewDir.y + 0.12) * 1.6 + uDrift;
              float n = fbm(deck) * 0.75 + fbm(deck * 3.1 + 4.0) * 0.25;
              float cover = mix(0.72, 0.18, clamp(uCloud, 0.0, 1.0));
              float density = smoothstep(cover, cover + 0.22, n);
              float thick = smoothstep(cover, cover + 0.5, n);
              float sunSide = pow(cosTheta, 3.0);
              vec3 lit = mix(vec3(0.97, 0.98, 1.0), vec3(0.78, 0.82, 0.88), uRain);
              vec3 base = mix(vec3(0.72, 0.77, 0.85), vec3(0.5, 0.55, 0.62), uRain);
              vec3 cloudCol = mix(lit, base, thick * (0.55 + uCloud * 0.35));
              cloudCol += sunGlowColor * sunSide * (1.0 - thick) * 0.35 * sunIntensity;
              cloudCol = mix(cloudCol, fogColor * 1.25, uNight);
              float fadeHorizon = smoothstep(0.0, 0.22, viewDir.y);
              // above the deck the clouds are below you, never overhead
              sky = mix(sky, cloudCol, density * fadeHorizon * 0.96 * (1.0 - uAboveDeck));
            }

            // the lowest sky band is exactly the fog colour, so far terrain
            // dissolves into the horizon with no visible edge
            float horizon = smoothstep(-0.02, 0.16, viewDir.y);
            sky = mix(max(fogColor + haze, 0.0), sky, horizon);
            // image-based lighting sees the sunlit meadow below the horizon
            if (uEnvPass > 0.5) sky = mix(sky, uGround, smoothstep(0.0, -0.3, viewDir.y));
            // climbing out of the air (celestial/scale.ts): the sky is only as
            // bright as the air left above you along each line of sight, so
            // the zenith deepens to indigo and black and the stars show
            // through while a bright band still hugs the horizon
            float alpha = 1.0;
            if (uEnvPass < 0.5 && uDensity < 0.999) {
              float path = 1.0 / max(viewDir.y + 0.045, 0.04);
              alpha = 1.0 - exp(-5.5 * uDensity * path);
              float thin = 1.0 - uDensity;
              sky = mix(sky, sky * vec3(0.42, 0.6, 1.0), thin * smoothstep(-0.05, 0.4, viewDir.y));
            }
            // high up this dome would hang its bright band at eye level, while
            // the real horizon has dipped below it (9° at 75 km): the globe
            // draws the limb there instead, so the dome hands the sky over
            if (uEnvPass < 0.5) alpha *= 1.0 - uSkyHandover;
            gl_FragColor = vec4(sky, alpha);
            #include <colorspace_fragment>
          }
        `,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        // blended over the stars behind it, yet still drawn in the opaque
        // queue so it stays behind the world (CelestialSky)
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      })

/**
 * Image-based lighting from the live sky: the same sky shader is rendered
 * into an off-screen cube and prefiltered (PMREM), so every standard
 * material receives sky-coloured ambient light and glossy reflections that
 * follow the time of day and weather. Re-filtered only when the sky changes.
 */
const SkyEnvironment = ({ material, ground }: { material: THREE.ShaderMaterial; ground: THREE.Color }): null => {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const envScene = useMemo(() => {
    const envScene = new THREE.Scene()
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), material))
    return envScene
  }, [material])
  const pmrem = useMemo(() => new THREE.PMREMGenerator(gl), [gl])
  const state = useRef({ timer: 0, key: "", target: null as THREE.WebGLRenderTarget | null })
  useFrame((_, dt) => {
    const st = state.current
    st.timer -= dt
    if (st.timer > 0) return
    st.timer = 1.2
    const u = material.uniforms
    const sun = u.sunPosition.value as THREE.Vector3
    const key = [
      (u.topColor.value as THREE.Color).getHexString(), (u.bottomColor.value as THREE.Color).getHexString(),
      (u.fogColor.value as THREE.Color).getHexString(), ground.getHexString(), (u.sunIntensity.value as number).toFixed(2),
      (u.uCloud.value as number).toFixed(2), sun.x.toFixed(2), sun.y.toFixed(2), sun.z.toFixed(2),
      (u.uHazeSun.value as Float32Array)[3].toFixed(2), (u.uTwilight.value as THREE.Vector4).x.toFixed(2),
    ].join()
    if (key === st.key) return
    st.key = key
    u.uEnvPass.value = 1
    ;(u.uGround.value as THREE.Color).copy(ground)
    const target = pmrem.fromScene(envScene, 0, 0.1, 100)
    u.uEnvPass.value = 0
    st.target?.dispose()
    st.target = target
    scene.environment = target.texture
  })
  useEffect(() => () => {
    state.current.target?.dispose()
    pmrem.dispose()
    envScene.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose() })
    scene.environment = null
  }, [pmrem, envScene, scene])
  return null
}

const SkyDome = ({
  skyMaterial,
  topColor,
  bottomColor,
  sunPosition,
  sunGlowColor,
  sunIntensity,
}: {
  skyMaterial?: THREE.ShaderMaterial
  topColor: THREE.Color
  bottomColor: THREE.Color
  sunPosition: THREE.Vector3
  sunGlowColor: THREE.Color
  sunIntensity: React.MutableRefObject<number>
}): React.ReactElement => {
  const mesh = useRef<THREE.Mesh>(null)
  const material = useMemo(() => skyMaterial ?? createSkyMaterial(), [skyMaterial])

  useFrame(({ camera, scene }, delta) => {
    if (!mesh.current) return
    mesh.current.position.copy(camera.position)
    if (scene.fog) (mesh.current.material as THREE.ShaderMaterial).uniforms.fogColor.value.copy((scene.fog as THREE.Fog).color)
    const mat = mesh.current.material as THREE.ShaderMaterial
    mat.uniforms.topColor.value.copy(topColor)
    mat.uniforms.bottomColor.value.copy(bottomColor)
    mat.uniforms.sunPosition.value.copy(sunPosition)
    mat.uniforms.sunGlowColor.value.copy(sunGlowColor)
    mat.uniforms.sunIntensity.value = sunIntensity.current
    mat.uniforms.uCloud.value = weatherRT.cloud
    mat.uniforms.uRain.value = weatherRT.rain
    mat.uniforms.uNight.value = nightBlend(worldRT.timeOfDay)
    // the deck drifts with the shared wind; wrap keeps float precision bounded
    const drift = mat.uniforms.uDrift.value as THREE.Vector2
    const step = (0.004 + windRT.strength * 0.01) * Math.min(delta, 0.1)
    drift.set((drift.x + windRT.dirX * step) % 512, (drift.y + windRT.dirZ * step) % 512)
  })

  return (
    <mesh ref={mesh} material={material} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[470, 40, 24]} />
    </mesh>
  )
}
