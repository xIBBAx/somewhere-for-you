import { useHubFrame } from "../hubGate"
import { useMemo } from "react"

import * as THREE from "three"
import { smoothstep } from "../../utils/math"
import { worldRT } from "../runtime"
import { weatherRT } from "../weather/weatherState"
import { PALETTE } from "./props"
import {
  plungePoolFragmentShader,
  plungePoolVertexShader,
  waterfallCurtainFragmentShader,
  waterfallCurtainVertexShader,
} from "./water/waterfallShaders"
import { WaterfallSprayAndMist } from "./water/waterfallSprayParticles"
import { keyLightDirection } from "./celestialLighting"

const fallLightDirection = new THREE.Vector3()
const fallSun = new THREE.Color("#fff7ed")
const fallMoon = new THREE.Color("#93c5fd")
const fallDaySky = new THREE.Color("#7dd3fc")
const fallNightSky = new THREE.Color("#0b192e")
const fallLightColor = new THREE.Color()
const fallSkyColor = new THREE.Color()

type TreeBelow = {
  dx: number
  dz: number
  dy: number
  s: number
  variant: "pine" | "gulmohar" | "willow" | "birch"
}

type WaterfallConfig = {
  id: string
  x: number
  topY: number
  bottomY: number
  z: number
  rotY: number
  scale: number
  width: number
  treesBelow: TreeBelow[]
}

const BOTTOM_WATERFALL_CONFIGS: WaterfallConfig[] = [
  {
    id: "deep-canyon-center",
    x: 0,
    topY: -1.4,
    bottomY: -7.0,
    z: -37.2,
    rotY: 0,
    scale: 1.8,
    width: 3.4,
    treesBelow: [
      { dx: -3.6, dz: -3.2, dy: -6.8, s: 0.52, variant: "pine" },
      { dx: -1.8, dz: -4.5, dy: -6.9, s: 0.44, variant: "gulmohar" },
      { dx: 0.8, dz: -4.8, dy: -7.0, s: 0.48, variant: "willow" },
      { dx: 2.8, dz: -3.8, dy: -6.8, s: 0.54, variant: "pine" },
      { dx: 4.8, dz: -3.4, dy: -6.7, s: 0.42, variant: "birch" },
      { dx: -5.4, dz: -2.5, dy: -6.6, s: 0.46, variant: "gulmohar" },
      { dx: 5.8, dz: -2.2, dy: -6.6, s: 0.48, variant: "pine" },
    ],
  },
  {
    id: "deep-canyon-west",
    x: -5.2,
    topY: -1.6,
    bottomY: -6.8,
    z: -36.5,
    rotY: Math.PI * 0.14,
    scale: 1.3,
    width: 2.2,
    treesBelow: [
      { dx: -2.4, dz: -2.2, dy: -6.6, s: 0.42, variant: "pine" },
      { dx: -3.8, dz: -1.2, dy: -6.5, s: 0.4, variant: "gulmohar" },
    ],
  },
  {
    id: "deep-canyon-east",
    x: 5.2,
    topY: -1.6,
    bottomY: -6.8,
    z: -36.5,
    rotY: -Math.PI * 0.14,
    scale: 1.3,
    width: 2.2,
    treesBelow: [
      { dx: 2.4, dz: -2.2, dy: -6.6, s: 0.42, variant: "gulmohar" },
      { dx: 3.8, dz: -1.2, dy: -6.5, s: 0.44, variant: "pine" },
    ],
  },
]

export const Waterfall = (): React.ReactElement => {
  return (
    <group>
      {BOTTOM_WATERFALL_CONFIGS.map((config) => (
        <SingleWaterfall key={config.id} config={config} />
      ))}
      <SunkenValleyFloor />
    </group>
  )
}

const SingleWaterfall = ({ config }: { config: WaterfallConfig }): React.ReactElement => {
  const { x, topY, bottomY, z, rotY, scale, width, treesBelow } = config
  const height = topY - bottomY
  const centerY = (topY + bottomY) / 2

  // GPU-accelerated subdivided curtain geometry
  const curtainGeo = useMemo(() => {
    const geo = new THREE.PlaneGeometry(width * scale, height, 16, 36)
    return geo
  }, [width, scale, height])

  // Subdivided plunge pool geometry for outward wave propagation
  const poolGeo = useMemo(() => {
    return new THREE.CircleGeometry(2.75 * scale, 32)
  }, [scale])

  // Curtain shader uniforms
  const curtainUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uHeight: { value: height },
      uWind: { value: 0.1 },
      uWindDir: { value: 0 },
      uSunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      uSunColor: { value: new THREE.Color("#fff7ed") },
      uSkyColor: { value: new THREE.Color("#7dd3fc") },
      uNight: { value: 0 },
      uRainIntensity: { value: 0 },
    }),
    [height],
  )

  const curtainMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: waterfallCurtainVertexShader,
        fragmentShader: waterfallCurtainFragmentShader,
        uniforms: curtainUniforms,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    [curtainUniforms],
  )

  // Plunge pool shader uniforms
  const poolUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uTurbulence: { value: 1.0 },
      uSunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      uSunColor: { value: new THREE.Color("#fff7ed") },
      uSkyColor: { value: new THREE.Color("#7dd3fc") },
      uNight: { value: 0 },
    }),
    [],
  )

  const poolMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: plungePoolVertexShader,
        fragmentShader: plungePoolFragmentShader,
        uniforms: poolUniforms,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    [poolUniforms],
  )

  useHubFrame((state) => {
    const t = state.clock.elapsedTime
    const timeOfDay = worldRT.timeOfDay
    const night = smoothstep(0.55, 0.95, timeOfDay)
    const wind = weatherRT.wind
    const windRad = weatherRT.windDirectionRad
    const rain = weatherRT.rain

    // Sun directional vector
    const sunDir = keyLightDirection(timeOfDay, fallLightDirection)
    const sunCol = fallLightColor.copy(fallSun).lerp(fallMoon, night)
    const skyCol = fallSkyColor.copy(fallDaySky).lerp(fallNightSky, night)

    // Update curtain uniforms
    curtainUniforms.uTime.value = t
    curtainUniforms.uWind.value = wind
    curtainUniforms.uWindDir.value = windRad
    curtainUniforms.uSunDirection.value.copy(sunDir)
    curtainUniforms.uSunColor.value.copy(sunCol)
    curtainUniforms.uSkyColor.value.copy(skyCol)
    curtainUniforms.uNight.value = night
    curtainUniforms.uRainIntensity.value = rain

    // Update pool uniforms
    poolUniforms.uTime.value = t
    poolUniforms.uTurbulence.value = 1.0 + rain * 0.4
    poolUniforms.uSunDirection.value.copy(sunDir)
    poolUniforms.uSunColor.value.copy(sunCol)
    poolUniforms.uSkyColor.value.copy(skyCol)
    poolUniforms.uNight.value = night
  })

  return (
    <group position={[x, 0, z]} rotation-y={rotY}>
      {/* SOTA Accelerating Falling Flow with Sheet Breakup */}
      <mesh position={[0, centerY, 0.12]} geometry={curtainGeo} material={curtainMaterial} />

      {/* Upstream Crest Flow Transition */}
      <mesh position={[0, topY + 0.02, 0.08]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[width * scale * 1.05, 0.65 * scale]} />
        <meshStandardMaterial
          color="#dbeafe"
          roughness={0.2}
          transparent
          opacity={0.88}
          depthWrite={false}
        />
      </mesh>

      {/* Violent Plunge Pool with Outward Shockwaves & Churning Foam */}
      <mesh position={[0, bottomY + 0.04, 0.55]} rotation-x={-Math.PI / 2} geometry={poolGeo} material={poolMaterial} receiveShadow />

      {/* Physical Ballistic Spray Droplets & Billowing Mist Volume */}
      <WaterfallSprayAndMist x={0} bottomY={bottomY} z={0.55} scale={scale} />

      {/* Canyon Rocks with Spray Wetness Gradient */}
      <DeepCanyonRocks scale={scale} topY={topY} bottomY={bottomY} width={width} />

      {/* Submerged / Surrounding Valley Foliage */}
      <LittleTreesBelow trees={treesBelow} />
    </group>
  )
}

const DeepCanyonRocks = ({
  scale,
  topY,
  bottomY,
  width,
}: {
  scale: number
  topY: number
  bottomY: number
  width: number
}): React.ReactElement => {
  const rockMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: PALETTE.stone,
        roughness: 0.92,
        flatShading: true,
      }),
    [],
  )

  const mossyMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#2f6b2f",
        roughness: 0.88,
        flatShading: true,
      }),
    [],
  )

  // Spray-wetted cliff rock material: slick, dark, specular
  const wetRockMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#283548",
        roughness: 0.22,
        metalness: 0.04,
        flatShading: true,
      }),
    [],
  )

  // Dynamic spray wetness modulation
  useHubFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const rain = weatherRT.rain
    // Rain additionally wets the upper canyon rocks
    const targetRough = THREE.MathUtils.lerp(0.92, 0.35, rain)
    rockMat.roughness = THREE.MathUtils.damp(rockMat.roughness, targetRough, 2, dt)
    mossyMat.roughness = THREE.MathUtils.damp(mossyMat.roughness, targetRough, 2, dt)
  })

  const height = topY - bottomY
  const halfW = (width * 0.62) * scale

  return (
    <group>
      <group position={[-halfW - 0.45, topY - height * 0.45, -0.28]}>
        <mesh rotation={[0.2, 0.4, -0.28]} material={rockMat} castShadow receiveShadow>
          <dodecahedronGeometry args={[1.55 * scale, 1]} />
        </mesh>
        <mesh position={[0.35, height * 0.28, 0.28]} rotation={[-0.2, -0.32, 0.12]} material={mossyMat} castShadow>
          <dodecahedronGeometry args={[1.15 * scale, 0]} />
        </mesh>
        {/* Deeply spray-wetted shelf rocks right beside the plunge pool */}
        <mesh position={[0.05, -height * 0.32, 0.35]} rotation={[0.3, 0.2, 0.1]} material={wetRockMat} castShadow receiveShadow>
          <boxGeometry args={[1.1 * scale, 0.24 * scale, 0.85 * scale]} />
        </mesh>
      </group>

      <group position={[halfW + 0.45, topY - height * 0.45, -0.28]}>
        <mesh rotation={[-0.28, -0.5, 0.22]} material={rockMat} castShadow receiveShadow>
          <dodecahedronGeometry args={[1.55 * scale, 1]} />
        </mesh>
        <mesh position={[-0.35, height * 0.28, 0.28]} rotation={[0.28, 0.22, -0.18]} material={mossyMat} castShadow>
          <dodecahedronGeometry args={[1.15 * scale, 0]} />
        </mesh>
        {/* Deeply spray-wetted shelf rocks */}
        <mesh position={[-0.05, -height * 0.32, 0.35]} rotation={[-0.2, -0.1, -0.12]} material={wetRockMat} castShadow receiveShadow>
          <boxGeometry args={[1.1 * scale, 0.24 * scale, 0.85 * scale]} />
        </mesh>
      </group>

      <mesh position={[0, topY - 0.28, -0.22]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[width * scale * 0.68, 0.42 * scale]} />
        <meshStandardMaterial color="#828994" roughness={0.35} />
      </mesh>
    </group>
  )
}

const SunkenValleyFloor = (): React.ReactElement => {
  const valleyFloorMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#2e523b",
        roughness: 0.88,
      }),
    [],
  )

  const lagoonMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#083344",
        roughness: 0.14,
        metalness: 0.02,
        transparent: true,
        opacity: 0.92,
      }),
    [],
  )

  useHubFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const rain = weatherRT.rain
    const wet = weatherRT.wetness
    // Valley floor becomes darker and glossier from mist and rain
    valleyFloorMat.roughness = THREE.MathUtils.damp(valleyFloorMat.roughness, 0.88 - (rain + wet) * 0.4, 2, dt)
    lagoonMat.roughness = THREE.MathUtils.damp(lagoonMat.roughness, 0.14 - (rain + wet) * 0.06, 2, dt)
  })

  return (
    <group position={[0, -7.05, -40]}>
      <mesh rotation-x={-Math.PI / 2} receiveShadow material={valleyFloorMat}>
        <planeGeometry args={[32, 20, 10, 10]} />
      </mesh>
      <mesh position={[0, 0.06, 0]} rotation-x={-Math.PI / 2} material={lagoonMat}>
        <planeGeometry args={[24, 14]} />
      </mesh>
    </group>
  )
}

const LittleTreesBelow = ({
  trees,
}: {
  trees: ReadonlyArray<TreeBelow>
}): React.ReactElement => {
  const pineMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#16a34a",
        roughness: 0.82,
        flatShading: true,
      }),
    [],
  )

  const pineDarkMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#14532d",
        roughness: 0.85,
        flatShading: true,
      }),
    [],
  )

  const gulmoharMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#f4602e",
        roughness: 0.78,
        flatShading: true,
      }),
    [],
  )

  const birchMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#facc15",
        roughness: 0.8,
        flatShading: true,
      }),
    [],
  )

  const willowMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#84cc16",
        roughness: 0.82,
        flatShading: true,
      }),
    [],
  )

  const trunkMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: PALETTE.trunk,
        roughness: 0.95,
      }),
    [],
  )

  return (
    <group>
      {trees.map((t, idx) => {
        const leafMat =
          t.variant === "gulmohar"
            ? gulmoharMat
            : t.variant === "birch"
              ? birchMat
              : t.variant === "willow"
                ? willowMat
                : idx % 2 === 0
                  ? pineMat
                  : pineDarkMat

        return (
          <group key={`little-tree:${idx}`} position={[t.dx, t.dy, t.dz]} scale={t.s}>
            <mesh position={[0, 0.4, 0]} material={trunkMat} castShadow>
              <cylinderGeometry args={[0.06, 0.1, 0.8, 5]} />
            </mesh>
            {t.variant === "gulmohar" || t.variant === "birch" ? (
              <mesh position={[0, 1.2, 0]} material={leafMat} castShadow>
                <sphereGeometry args={[0.65, 8, 6]} />
              </mesh>
            ) : t.variant === "willow" ? (
              <group position={[0, 1.1, 0]}>
                <mesh material={leafMat} castShadow>
                  <sphereGeometry args={[0.55, 8, 6]} />
                </mesh>
                <mesh position={[0, -0.3, 0]} scale={[1.2, 0.5, 1.2]} material={leafMat}>
                  <cylinderGeometry args={[0.6, 0.4, 0.6, 7]} />
                </mesh>
              </group>
            ) : (
              <group>
                <mesh position={[0, 0.9, 0]} material={leafMat} castShadow>
                  <coneGeometry args={[0.55, 0.9, 6]} />
                </mesh>
                <mesh position={[0, 1.4, 0]} material={leafMat} castShadow>
                  <coneGeometry args={[0.42, 0.75, 6]} />
                </mesh>
                <mesh position={[0, 1.85, 0]} material={leafMat} castShadow>
                  <coneGeometry args={[0.28, 0.6, 5]} />
                </mesh>
              </group>
            )}
          </group>
        )
      })}
    </group>
  )
}
