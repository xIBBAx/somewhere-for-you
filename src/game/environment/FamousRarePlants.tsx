import { VirtualLight, VirtualPointLight } from "../lightPool"
import { useHubFrame } from "../hubGate"

import { useRef } from "react"
import * as THREE from "three"
import { groundHeight, WATER_Y } from "../world-layout"
import { POND_LILY_PADS } from "../../world/hubLayout"
import { weatherRT } from "../weather/weatherState"
import { avatarRT, catRT, worldRT } from "../runtime"
import { smoothstep, damp } from "../../utils/math"

/** Rare flora: ghost orchid, giant lily, jade vine, bleeding heart, queen of night. */
export const FamousRarePlants = (): React.ReactElement => {
  return (
    <group>
      <GhostOrchids />
      <GiantWaterLilies />
      <JadeVines />
      <BleedingHearts />
      <QueenOfTheNight />
    </group>
  )
}

// -----------------------------------------------------------------------------
// 1) GHOST ORCHID (Dendrophylax lindenii)
// -----------------------------------------------------------------------------
const GHOST_ORCHID_SPOTS = [
  { x: 8.4, y: 1.45, z: 8.2, rotY: -0.6 },    // Willow trunk near pond
  { x: -15.6, y: 1.55, z: 4.1, rotY: 1.3 },   // Gulmohar trunk near studio
  { x: 13.5, y: 1.5, z: -15.8, rotY: 2.8 },   // Overlook tree
]

const GhostOrchids = (): React.ReactElement => {
  return (
    <group>
      {GHOST_ORCHID_SPOTS.map((spot, i) => (
        <SingleGhostOrchid key={i} spot={spot} />
      ))}
    </group>
  )
}

const SingleGhostOrchid = ({
  spot,
}: {
  spot: { x: number; y: number; z: number; rotY: number }
}): React.ReactElement => {
  const flowerRef = useRef<THREE.Group>(null)
  const lightRef = useRef<VirtualPointLight>(null)
  const fragrance = useRef(0)

  useHubFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const t = state.clock.elapsedTime
    const dPlayer = Math.hypot(spot.x - avatarRT().pos.x, spot.z - avatarRT().pos.z)
    const dCat = Math.hypot(spot.x - catRT.pos.x, spot.z - catRT.pos.z)
    const near = dPlayer < 2.5 || dCat < 2.0
    fragrance.current = damp(fragrance.current, near ? 1 : 0, 4.0, dt)

    if (flowerRef.current) {
      const bob = Math.sin(t * 1.8 + spot.x) * 0.035 + fragrance.current * 0.04
      const sway = Math.cos(t * 1.2 + spot.z) * 0.06
      flowerRef.current.position.y = spot.y + bob
      flowerRef.current.rotation.z = sway
    }
    if (lightRef.current) {
      lightRef.current.intensity = 0.45 + fragrance.current * 0.8
    }
  })

  return (
    <group position={[spot.x, 0, spot.z]} rotation-y={spot.rotY}>
      {/* Epiphytic root tendrils clinging to tree bark */}
      <mesh position={[0, spot.y, 0]} rotation-z={0.2}>
        <torusGeometry args={[0.16, 0.016, 6, 12, Math.PI * 1.4]} />
        <meshStandardMaterial color="#65a30d" roughness={0.9} />
      </mesh>
      <mesh position={[0.04, spot.y - 0.08, 0]} rotation-x={0.4}>
        <cylinderGeometry args={[0.012, 0.018, 0.35, 6]} />
        <meshStandardMaterial color="#4d7c0f" roughness={0.92} />
      </mesh>

      {/* Floating Ghost Blossom with frog-like petals and long nectar spur */}
      <group ref={flowerRef} position={[0.12, spot.y, 0.08]}>
        {/* Slender green stem */}
        <mesh position={[-0.06, 0, 0]} rotation-z={-Math.PI / 3}>
          <cylinderGeometry args={[0.008, 0.01, 0.14, 6]} />
          <meshStandardMaterial color="#86efac" />
        </mesh>

        {/* Pure white dorsal sepal and petals */}
        <mesh position={[0, 0.04, 0]}>
          <coneGeometry args={[0.035, 0.09, 5]} />
          <meshStandardMaterial color="#ffffff" roughness={0.3} emissive="#f8fafc" emissiveIntensity={0.35} />
        </mesh>
        {/* Left lateral petal */}
        <mesh position={[-0.04, 0.01, 0]} rotation-z={0.9}>
          <coneGeometry args={[0.025, 0.08, 4]} />
          <meshStandardMaterial color="#ffffff" roughness={0.3} emissive="#f8fafc" emissiveIntensity={0.35} />
        </mesh>
        {/* Right lateral petal */}
        <mesh position={[0.04, 0.01, 0]} rotation-z={-0.9}>
          <coneGeometry args={[0.025, 0.08, 4]} />
          <meshStandardMaterial color="#ffffff" roughness={0.3} emissive="#f8fafc" emissiveIntensity={0.35} />
        </mesh>

        {/* Iconic two-pronged lower lip resembling frog legs */}
        <mesh position={[-0.035, -0.07, 0.01]} rotation-z={-0.45} rotation-y={0.2}>
          <coneGeometry args={[0.022, 0.12, 4]} />
          <meshStandardMaterial color="#ffffff" roughness={0.25} emissive="#f8fafc" emissiveIntensity={0.4} />
        </mesh>
        <mesh position={[0.035, -0.07, 0.01]} rotation-z={0.45} rotation-y={-0.2}>
          <coneGeometry args={[0.022, 0.12, 4]} />
          <meshStandardMaterial color="#ffffff" roughness={0.25} emissive="#f8fafc" emissiveIntensity={0.4} />
        </mesh>

        {/* Long coiled nectar spur */}
        <mesh position={[0, -0.05, -0.04]} rotation-x={-0.8}>
          <cylinderGeometry args={[0.006, 0.012, 0.16, 5]} />
          <meshStandardMaterial color="#dcfce7" roughness={0.5} />
        </mesh>

        <VirtualLight ref={lightRef} color="#a7f3d0" intensity={0.45} distance={1.8} />
      </group>
    </group>
  )
}

// -----------------------------------------------------------------------------
// 2) GIANT AMAZONIAN WATER LILY (Victoria amazonica)
// -----------------------------------------------------------------------------
// Three pads crowd the pond (centre 9.2, 7.0, radius 2.8) edge to edge without
// overlapping, each wholly over water, notches turned different ways.
const LILY_LOOKS = [
  { notch: 0.4, flower: true, flowerColor: "#ffffff" },
  { notch: 2.6, flower: false, flowerColor: "#ffffff" },
  { notch: 4.4, flower: true, flowerColor: "#f472b6" },
]
const LILY_PADS = POND_LILY_PADS.map((pad, i) => ({ x: pad.x, z: pad.z, radius: pad.r, ...LILY_LOOKS[i % LILY_LOOKS.length] }))

/**
 * The upper face of a Victoria leaf: a ribbed green with radial veins from the
 * centre, rings of cross-veins and a faintly quilted surface between them.
 * Drawn once into a small canvas and shared by every pad.
 */
let lilyLeaf: THREE.CanvasTexture | null = null
const lilyLeafTexture = (): THREE.CanvasTexture => {
  if (lilyLeaf) return lilyLeaf
  const size = 256, c = size / 2
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = size
  const g = canvas.getContext("2d")!
  const base = g.createRadialGradient(c, c, 0, c, c, c)
  base.addColorStop(0, "#2f8f3a")
  base.addColorStop(0.75, "#1f7a30")
  base.addColorStop(1, "#16632a")
  g.fillStyle = base
  g.fillRect(0, 0, size, size)
  // quilted cells: lighter bulges between the veins
  for (let ring = 1; ring < 9; ring++) {
    const r = (ring + 0.5) * c / 9
    const cells = 22 + ring * 3
    for (let i = 0; i < cells; i++) {
      const a = (i + 0.5) / cells * Math.PI * 2
      g.fillStyle = `rgba(150, 210, 110, ${0.08 + ((i * 7 + ring * 3) % 5) * 0.02})`
      g.beginPath()
      g.ellipse(c + Math.cos(a) * r, c + Math.sin(a) * r, c / 22, c / 30, a, 0, Math.PI * 2)
      g.fill()
    }
  }
  // main veins from the centre, each forking twice on the way to the rim
  const vein = (a: number, r0: number, r1: number, alpha: number, width: number): void => {
    g.strokeStyle = `rgba(190, 222, 140, ${alpha})`
    g.lineWidth = width
    g.beginPath()
    g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0)
    g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1)
    g.stroke()
  }
  for (let i = 0; i < 18; i++) {
    const a = (i + ((i * 37) % 7) * 0.04) / 18 * Math.PI * 2
    const fork = Math.PI / 36
    vein(a, 0, c * 0.45, 0.34, 1.5)
    vein(a - fork, c * 0.45, c * 0.75, 0.24, 1.1)
    vein(a + fork, c * 0.45, c * 0.75, 0.24, 1.1)
    for (const f of [-1.5, -0.5, 0.5, 1.5]) vein(a + f * fork, c * 0.75, c, 0.16, 0.8)
  }
  // faint rings of cross-veins
  g.lineWidth = 0.7
  g.strokeStyle = "rgba(190, 222, 140, 0.14)"
  for (let ring = 2; ring < 9; ring++) {
    g.beginPath()
    g.arc(c, c, ring * c / 9, 0, Math.PI * 2)
    g.stroke()
  }
  // a hint of yellow-green where the leaf turns up into the rim
  const edge = g.createRadialGradient(c, c, c * 0.82, c, c, c)
  edge.addColorStop(0, "rgba(160, 190, 70, 0)")
  edge.addColorStop(1, "rgba(160, 190, 70, 0.22)")
  g.fillStyle = edge
  g.fillRect(0, 0, size, size)
  lilyLeaf = new THREE.CanvasTexture(canvas)
  lilyLeaf.colorSpace = THREE.SRGBColorSpace
  lilyLeaf.anisotropy = 4
  return lilyLeaf
}
/** where a leaf rests: clear of the surface even at its tilted edge */
const PAD_Y = WATER_Y + 0.05
/** the leaf's notch, a narrow cleft from rim to centre */
const NOTCH = 0.09

const GiantWaterLilies = (): React.ReactElement => {
  return (
    <group>
      {LILY_PADS.map((pad, idx) => (
        <SingleWaterLily key={idx} pad={pad} />
      ))}
    </group>
  )
}

const SingleWaterLily = ({
  pad,
}: {
  pad: { x: number; z: number; radius: number; notch: number; flower: boolean; flowerColor: string }
}): React.ReactElement => {
  const padRef = useRef<THREE.Group>(null)

  useHubFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const t = state.clock.elapsedTime
    if (!padRef.current) return

    // Water surface buoyancy bobbing
    const dPlayer = Math.hypot(pad.x - avatarRT().pos.x, pad.z - avatarRT().pos.z)
    const dCat = Math.hypot(pad.x - catRT.pos.x, pad.z - catRT.pos.z)
    const stepWeight = (dPlayer < pad.radius ? 0.055 : 0) + (dCat < pad.radius ? 0.035 : 0)

    // A Victoria leaf floats on the water: it rides the ripples and dips a
    // little under a weight, but its tilt (over a metre of leaf) never takes
    // an edge under the surface.
    const rippleY = Math.sin(t * 2.2 + pad.x * 2) * 0.008 - stepWeight * 0.4
    const tiltX = Math.sin(t * 1.5 + pad.z) * 0.012
    const tiltZ = Math.cos(t * 1.7 + pad.x) * 0.012

    padRef.current.position.y = damp(padRef.current.position.y, PAD_Y + rippleY, 12, dt)
    padRef.current.rotation.x = tiltX
    padRef.current.rotation.z = tiltZ
  })

  return (
    <group ref={padRef} position={[pad.x, PAD_Y, pad.z]}>
      {/* Giant circular leaf flat base */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[pad.radius, 40, pad.notch + NOTCH, Math.PI * 2 - NOTCH * 2]} />
        <meshStandardMaterial map={lilyLeafTexture()} roughness={0.55} />
      </mesh>

      {/* Upturned rim, showing the leaf's crimson underside */}
      {/* a cylinder's angle runs a quarter turn ahead of the flat circle's */}
      <mesh position={[0, 0.045, 0]}>
        <cylinderGeometry args={[pad.radius, pad.radius, 0.09, 40, 1, true, pad.notch + NOTCH + Math.PI / 2, Math.PI * 2 - NOTCH * 2]} />
        <meshStandardMaterial color="#881337" roughness={0.7} side={THREE.DoubleSide} />
      </mesh>

      {/* Radial underside support ribs */}
      <mesh position={[0, -0.02, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.2, pad.radius * 0.95, 24, 1, pad.notch + NOTCH, Math.PI * 2 - NOTCH * 2]} />
        <meshStandardMaterial color="#7f1d1d" roughness={0.9} />
      </mesh>

      {/* Nocturnal Blooming Giant Lotus Flower */}
      {pad.flower && (
        <group position={[pad.radius * 0.25, 0.08, pad.radius * 0.2]}>
          {/* Flower core / Golden receptacle */}
          <mesh position={[0, 0.06, 0]}>
            <cylinderGeometry args={[0.07, 0.05, 0.08, 12]} />
            <meshStandardMaterial color="#fde047" emissive="#facc15" emissiveIntensity={0.6} />
          </mesh>

          {/* Layered white & rose lotus petals */}
          {Array.from({ length: 12 }, (_, i) => {
            const angle = (i / 12) * Math.PI * 2
            return (
              <mesh
                key={i}
                position={[Math.cos(angle) * 0.08, 0.06, Math.sin(angle) * 0.08]}
                rotation-y={angle}
                rotation-x={0.55}
              >
                <coneGeometry args={[0.045, 0.18, 5]} />
                <meshStandardMaterial
                  color={pad.flowerColor}
                  roughness={0.4}
                  emissive={pad.flowerColor}
                  emissiveIntensity={0.25}
                />
              </mesh>
            )
          })}
        </group>
      )}
    </group>
  )
}

// -----------------------------------------------------------------------------
// 3) CASCADING JADE VINE (Strongylodon macrobotrys)
// -----------------------------------------------------------------------------
const JADE_VINE_SPOTS = [
  { x: -4.2, y: 2.3, z: -4.5, count: 9 },  // Bridge pergola arch
  { x: -4.8, y: 2.2, z: -5.2, count: 8 },  // Creek side trellis
  { x: -14.2, y: 2.4, z: 1.8, count: 10 }, // studio pergola
  { x: 9.8, y: 2.1, z: 8.8, count: 7 },    // Pond willow branch
]

const JadeVines = (): React.ReactElement => {
  return (
    <group>
      {JADE_VINE_SPOTS.map((vine, i) => (
        <SingleJadeVine key={i} vine={vine} />
      ))}
    </group>
  )
}

const SingleJadeVine = ({
  vine,
}: {
  vine: { x: number; y: number; z: number; count: number }
}): React.ReactElement => {
  const vineRef = useRef<THREE.Group>(null)

  useHubFrame((state) => {
    const t = state.clock.elapsedTime
    if (!vineRef.current) return
    const wind = Math.min(1, weatherRT.wind + weatherRT.gust * 0.8)
    const sway = Math.sin(t * 1.6 + vine.x) * (0.08 + wind * 0.18)
    vineRef.current.rotation.z = sway
    vineRef.current.rotation.x = Math.cos(t * 1.3 + vine.z) * (0.06 + wind * 0.12)
  })

  return (
    <group position={[vine.x, vine.y, vine.z]}>
      {/* Hanging vine cord */}
      <mesh position={[0, -0.6, 0]}>
        <cylinderGeometry args={[0.012, 0.015, 1.2, 5]} />
        <meshStandardMaterial color="#166534" roughness={0.9} />
      </mesh>

      {/* Cascading hanging claws of luminous turquoise jade flowers */}
      <group ref={vineRef}>
        {Array.from({ length: vine.count }, (_, i) => {
          const t = i / vine.count
          const y = -0.15 - t * 1.05
          const angle = i * 1.9
          const r = 0.08 + (1 - t) * 0.04
          const scale = (1 - t * 0.45) * 0.95
          return (
            <group
              key={i}
              position={[Math.cos(angle) * r, y, Math.sin(angle) * r]}
              rotation-y={angle}
              rotation-x={0.65}
              scale={scale}
            >
              {/* Curved upward-pointing claw flower */}
              <mesh>
                <coneGeometry args={[0.038, 0.14, 5]} />
                <meshStandardMaterial
                  color="#2dd4bf"
                  emissive="#06b6d4"
                  emissiveIntensity={0.65}
                  roughness={0.35}
                />
              </mesh>
              {/* Petal tip beak */}
              <mesh position={[0, 0.07, 0.02]} rotation-x={-0.45} scale={0.6}>
                <coneGeometry args={[0.025, 0.08, 4]} />
                <meshStandardMaterial
                  color="#38bdf8"
                  emissive="#0ea5e9"
                  emissiveIntensity={0.8}
                  roughness={0.3}
                />
              </mesh>
            </group>
          )
        })}
      </group>

      {/* Nighttime ethereal turquoise ambient glow */}
      <VirtualLight color="#2dd4bf" intensity={0.4} distance={2.2} position={[0, -0.6, 0]} />
    </group>
  )
}

// -----------------------------------------------------------------------------
// 4) BLEEDING HEART (Lamprocapnos spectabilis)
// -----------------------------------------------------------------------------
const BLEEDING_HEART_SPOTS = [
  { x: 6.2, z: 10.8, rotY: 0.4 },
  { x: 1.2, z: 19.5, rotY: -0.8 },
  { x: -11.2, z: -6.8, rotY: 1.1 },
  { x: 1.8, z: -26.2, rotY: -1.6 },
  { x: 13.8, z: -3.8, rotY: 2.2 },
]

const BleedingHearts = (): React.ReactElement => {
  return (
    <group>
      {BLEEDING_HEART_SPOTS.map((spot, i) => (
        <SingleBleedingHeart key={i} spot={spot} />
      ))}
    </group>
  )
}

const SingleBleedingHeart = ({
  spot,
}: {
  spot: { x: number; z: number; rotY: number }
}): React.ReactElement => {
  const stemRef = useRef<THREE.Group>(null)
  const y = groundHeight(spot.x, spot.z)

  useHubFrame((state) => {
    const t = state.clock.elapsedTime
    if (!stemRef.current) return
    const dPlayer = Math.hypot(spot.x - avatarRT().pos.x, spot.z - avatarRT().pos.z)
    const breeze = Math.sin(t * 2.4 + spot.x) * 0.08
    const touch = dPlayer < 1.8 ? Math.sin(t * 8) * 0.18 : 0
    stemRef.current.rotation.z = breeze + touch
  })

  return (
    <group position={[spot.x, y, spot.z]} rotation-y={spot.rotY}>
      {/* Arching green stem */}
      <group ref={stemRef}>
        <mesh position={[0.22, 0.35, 0]} rotation-z={-0.75}>
          <cylinderGeometry args={[0.012, 0.018, 0.75, 6]} />
          <meshStandardMaterial color="#4d7c0f" roughness={0.85} />
        </mesh>

        {/* 5 dangling heart-shaped pendant blossoms */}
        {Array.from({ length: 5 }, (_, i) => {
          const t = i / 4
          const hx = 0.08 + t * 0.42
          const hy = 0.52 - t * 0.28
          return (
            <group key={i} position={[hx, hy, 0]}>
              {/* Slender hanging filament */}
              <mesh position={[0, -0.04, 0]}>
                <cylinderGeometry args={[0.004, 0.004, 0.08, 4]} />
                <meshStandardMaterial color="#65a30d" />
              </mesh>

              {/* Pink outer heart pouch */}
              <mesh position={[0, -0.1, 0]}>
                <sphereGeometry args={[0.038, 8, 6]} />
                <meshStandardMaterial color="#f43f5e" roughness={0.4} emissive="#fda4af" emissiveIntensity={0.25} />
              </mesh>

              {/* White inner drop protruding from heart base */}
              <mesh position={[0, -0.15, 0]}>
                <coneGeometry args={[0.016, 0.065, 5]} />
                <meshStandardMaterial color="#ffffff" roughness={0.3} emissive="#ffffff" emissiveIntensity={0.4} />
              </mesh>
            </group>
          )
        })}
      </group>
    </group>
  )
}

// -----------------------------------------------------------------------------
// 5) QUEEN OF THE NIGHT (Selenicereus grandiflorus)
// -----------------------------------------------------------------------------
const QUEEN_SPOTS = [
  { x: 1.2, z: -11.2, rotY: 0.8 },  // wall of the corner café
  { x: 11.2, z: 5.8, rotY: -1.2 },  // Rockery near reflection pond
]

const QueenOfTheNight = (): React.ReactElement => {
  return (
    <group>
      {QUEEN_SPOTS.map((spot, i) => (
        <SingleQueenOfTheNight key={i} spot={spot} />
      ))}
    </group>
  )
}

const SingleQueenOfTheNight = ({
  spot,
}: {
  spot: { x: number; z: number; rotY: number }
}): React.ReactElement => {
  const petalsRef = useRef<THREE.Group>(null)
  const y = groundHeight(spot.x, spot.z)

  useHubFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    if (!petalsRef.current) return

    // Night bloom opening mechanics (blooms as dusk turns into night)
    const night = smoothstep(0.55, 0.85, worldRT.timeOfDay)
    const bloomScale = THREE.MathUtils.lerp(0.25, 1.0, night)
    petalsRef.current.scale.setScalar(damp(petalsRef.current.scale.x, bloomScale, 4.0, dt))
    petalsRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.8) * 0.04
  })

  return (
    <group position={[spot.x, y, spot.z]} rotation-y={spot.rotY}>
      {/* Ribbed succulent climbing vine stem */}
      <mesh position={[0, 0.45, 0]} rotation-z={0.15}>
        <cylinderGeometry args={[0.035, 0.045, 0.9, 6]} />
        <meshStandardMaterial color="#15803d" roughness={0.8} />
      </mesh>

      {/* Spectacular Giant Starburst Flower */}
      <group ref={petalsRef} position={[0.08, 0.75, 0.05]} rotation-x={0.4}>
        {/* Golden central stamen halo */}
        <mesh position={[0, 0.05, 0]}>
          <cylinderGeometry args={[0.055, 0.03, 0.07, 10]} />
          <meshStandardMaterial color="#fde047" emissive="#facc15" emissiveIntensity={0.8} />
        </mesh>

        {/* 16 radiating pure-white starburst petals */}
        {Array.from({ length: 16 }, (_, i) => {
          const angle = (i / 16) * Math.PI * 2
          return (
            <mesh
              key={i}
              position={[Math.cos(angle) * 0.08, 0.04, Math.sin(angle) * 0.08]}
              rotation-y={angle}
              rotation-x={0.7}
            >
              <coneGeometry args={[0.032, 0.22, 4]} />
              <meshStandardMaterial
                color="#ffffff"
                emissive="#f8fafc"
                emissiveIntensity={0.5}
                roughness={0.25}
              />
            </mesh>
          )
        })}

        {/* Golden bronze outer sepals */}
        {Array.from({ length: 8 }, (_, i) => {
          const angle = (i / 8) * Math.PI * 2 + 0.2
          return (
            <mesh
              key={i}
              position={[Math.cos(angle) * 0.06, 0.01, Math.sin(angle) * 0.06]}
              rotation-y={angle}
              rotation-x={0.9}
            >
              <coneGeometry args={[0.024, 0.18, 4]} />
              <meshStandardMaterial color="#d97706" roughness={0.7} />
            </mesh>
          )
        })}

        {/* Nighttime radiant starlight point light */}
        <VirtualLight color="#fef08a" intensity={0.65} distance={2.4} />
      </group>
    </group>
  )
}
