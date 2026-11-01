import { useHubFrame } from "../hubGate"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"
import { useGame } from "../../state/gameStore"
import { damp } from "../../utils/math"
import {
  createAnimalAgent,
  registerAnimalAgent,
  stepAnimalAgent,
} from "../animals/ecosystem"
import { avatarRT } from "../runtime"
import { groundHeight } from "../world-layout"
import { affectionDrift } from "../vfx/signatures"
import { PALETTE } from "./props"
import { makeAnimalModel, disposeAnimalModel, prepareHomeAnimalLOD, updateHomeAnimalLOD, type AnimalModel } from "../../world/wildlife/animalAssets"
import { QuadrupedAnimator, type AnimalPose } from "../../world/wildlife/QuadrupedAnimator"

const GARDEN = { x: 12.4, z: 0.4, r: 3.8 }

/**
 * Cat Garden — five residents with five temperaments, a low fence,
 * and a heart-stone where the explorer can kneel and pet.
 */
export const CatGarden = (): React.ReactElement => {
  const visited = useGame((s) => s.visited["cat-garden"] ?? false)
  const sparkleTimer = useRef(0)
  const y = groundHeight(GARDEN.x, GARDEN.z)

  useHubFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    // while celebrating (petting), curious cat approach + floating sparkles
    if (visited && avatarRT().celebrate > 0) {
      sparkleTimer.current -= dt
      if (sparkleTimer.current <= 0) {
        sparkleTimer.current = 0.7
        affectionDrift(
          new THREE.Vector3(
            GARDEN.x + (Math.random() - 0.5) * 1.6,
            y + 0.8 + Math.random() * 0.5,
            GARDEN.z + (Math.random() - 0.5) * 1.6,
          ),
          "#f2c6d0",
        )
      }
    }
    void state
  })

  // Low circular fence with a deliberate entrance gap facing the path (west).
  const fencePosts = useMemo(() => {
    const posts: Array<[number, number]> = []
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2
      const fromEntrance = Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI))
      if (Math.abs(fromEntrance) < 0.34) continue
      posts.push([GARDEN.x + Math.cos(a) * GARDEN.r, GARDEN.z + Math.sin(a) * GARDEN.r])
    }
    return posts
  }, [])

  return (
    <group>
      {/* heart stone */}
      <group position={[GARDEN.x, y, GARDEN.z]}>
        <mesh position={[0, 0.25, 0]} castShadow>
          <dodecahedronGeometry args={[0.42, 0]} />
          <meshStandardMaterial color={PALETTE.stone} roughness={1} flatShading />
        </mesh>
        <mesh position={[0, 0.52, 0.3]} rotation-z={Math.PI / 4} scale={[1, 1.25, 0.5]}>
          <capsuleGeometry args={[0.075, 0.05, 4, 8]} />
          <meshStandardMaterial
            color="#e8636f"
            emissive="#e8636f"
            emissiveIntensity={visited ? 0.7 : 0.15}
            roughness={0.6}
          />
        </mesh>
      </group>

      {/* fence: connected rails replace the old crossed-stick silhouette */}
      {fencePosts.map(([px, pz], i) => (
        <group key={i} position={[px, groundHeight(px, pz), pz]}>
          <mesh position={[0, 0.3, 0]}>
            <cylinderGeometry args={[0.045, 0.055, 0.6, 6]} />
            <meshStandardMaterial color={PALETTE.wood} roughness={0.9} />
          </mesh>
        </group>
      ))}
      {fencePosts.map(([px, pz], i) => {
        const next = fencePosts[(i + 1) % fencePosts.length]
        const dx = next[0] - px
        const dz = next[1] - pz
        const length = Math.hypot(dx, dz)
        if (length > 1.25) return null
        const mx = (px + next[0]) / 2
        const mz = (pz + next[1]) / 2
        return (
          <mesh
            key={`rail:${i}`}
            position={[mx, groundHeight(mx, mz) + 0.42, mz]}
            rotation-y={Math.atan2(dx, dz)}
          >
            <boxGeometry args={[0.055, 0.065, length + 0.08]} />
            <meshStandardMaterial color={PALETTE.woodDark} roughness={0.92} />
          </mesh>
        )
      })}

      {/* welcoming cat-ear arch at the path entrance */}
      <group position={[GARDEN.x - GARDEN.r + 0.05, groundHeight(GARDEN.x - GARDEN.r, GARDEN.z), GARDEN.z]}>
        {[-0.78, 0.78].map((z) => (
          <mesh key={z} position={[0, 0.88, z]} castShadow>
            <cylinderGeometry args={[0.065, 0.08, 1.76, 7]} />
            <meshStandardMaterial color={PALETTE.woodDark} roughness={0.92} />
          </mesh>
        ))}
        <mesh position={[0, 1.72, 0]} castShadow>
          <boxGeometry args={[0.13, 0.16, 1.78]} />
          <meshStandardMaterial color={PALETTE.wood} roughness={0.9} />
        </mesh>
        {[-0.34, 0.34].map((z) => (
          <mesh key={`ear:${z}`} position={[0, 1.94, z]} rotation-x={z < 0 ? -0.2 : 0.2}>
            <coneGeometry args={[0.13, 0.26, 5]} />
            <meshStandardMaterial color="#d99883" roughness={0.9} />
          </mesh>
        ))}
        <mesh position={[-0.08, 1.7, 0]} rotation-y={Math.PI / 2} rotation-z={Math.PI / 4} scale={[1, 1.2, 0.6]}>
          <capsuleGeometry args={[0.08, 0.05, 4, 8]} />
          <meshStandardMaterial color="#e56f79" emissive="#e56f79" emissiveIntensity={visited ? 0.55 : 0.1} />
        </mesh>
      </group>

      {/* designed flower pockets, cushions and a tiny cat house */}
      {Array.from({ length: 14 }, (_, i) => {
        const a = -1.15 + (i / 13) * 2.3
        const r = 3.1 + (i % 2) * 0.28
        const x = GARDEN.x + Math.cos(a) * r
        const z = GARDEN.z + Math.sin(a) * r
        const colors = ["#f2a2b8", "#f6c76b", "#cfa9e8"]
        return (
          <group key={`garden-flower:${i}`} position={[x, groundHeight(x, z), z]}>
            <mesh position={[0, 0.13, 0]}>
              <cylinderGeometry args={[0.012, 0.016, 0.26, 5]} />
              <meshStandardMaterial color={PALETTE.leafDeep} roughness={1} />
            </mesh>
            <mesh position={[0, 0.29, 0]}>
              <icosahedronGeometry args={[0.07, 0]} />
              <meshStandardMaterial color={colors[i % colors.length]} roughness={0.85} />
            </mesh>
          </group>
        )
      })}
      {[
        [10.6, 0.0, "#d7b4c8"],
        [13.6, 2.05, "#b8c8df"],
      ].map(([x, z, color]) => (
        <mesh key={`${x}:${z}`} position={[Number(x), groundHeight(Number(x), Number(z)) + 0.06, Number(z)]} scale={[1.2, 0.25, 1]}>
          <cylinderGeometry args={[0.45, 0.48, 0.16, 14]} />
          <meshStandardMaterial color={String(color)} roughness={1} />
        </mesh>
      ))}
      <group position={[14.45, groundHeight(14.45, 2.1), 2.1]} rotation-y={-0.45}>
        <mesh position={[0, 0.42, 0]} castShadow>
          <boxGeometry args={[1.0, 0.82, 0.85]} />
          <meshStandardMaterial color="#d8a17f" roughness={0.95} />
        </mesh>
        <mesh position={[0, 0.47, 0.45]}>
          <circleGeometry args={[0.25, 16]} />
          <meshStandardMaterial color="#5c4438" roughness={1} />
        </mesh>
        <mesh position={[0, 0.94, 0]} rotation-y={Math.PI / 4}>
          <coneGeometry args={[0.82, 0.45, 4]} />
          <meshStandardMaterial color="#a86b68" roughness={0.95} />
        </mesh>
      </group>

      {/* 5 Distinct Breed Residents */}
      {CAT_RESIDENTS.map((cat, i) => (
        <MiniCat key={i} {...cat} />
      ))}
    </group>
  )
}

type MiniCatConfig = {
  position: [number, number, number]
  breed: "calico" | "siamese" | "silver_tabby" | "ginger" | "tuxedo"
  behavior: "sleepy" | "curious" | "shy" | "playful" | "ridiculous"
  name: string
}

const CAT_RESIDENTS: MiniCatConfig[] = [
  { position: [13.4, 0, 1.4], breed: "calico", behavior: "sleepy", name: "Patches (Calico)" },
  { position: [11.6, 0, -0.6], breed: "siamese", behavior: "curious", name: "Miso (Siamese)" },
  { position: [14.2, 0, -1.2], breed: "silver_tabby", behavior: "shy", name: "Shadow (Silver Tabby)" },
  { position: [11.2, 0, 1.6], breed: "ginger", behavior: "playful", name: "Simba (Ginger)" },
  { position: [8.7, 0, 0.3], breed: "tuxedo", behavior: "ridiculous", name: "Oreo (Tuxedo)" },
]

const GARDEN_COATS = { calico: 5, siamese: 3, silver_tabby: 1, ginger: 0, tuxedo: 2 } as const

/** Garden residents share the organic rig but retain their own coats and temperaments. */
const MiniCat = ({ position, breed, behavior, name }: MiniCatConfig): React.ReactElement => {
  const ref = useRef<THREE.Group>(null)
  const base = useMemo(() => new THREE.Vector3(...position), [position])
  const [model, setModel] = useState<AnimalModel | null>(null)
  const animator = useRef<QuadrupedAnimator | null>(null)
  const blends = useRef({ sit: 0, sleep: 0, graze: 0 })
  const pose = useMemo<AnimalPose>(() => ({ dt: 0, time: 0, speed: 0, turnRate: 0, sit: 0, sleep: 0, graze: 0,
    happy: 0, swim: 0, lookYaw: 0, lookPitch: 0, slope: 0, crossSlope: 0, fullIK: true }), [])
  const agent = useMemo(() => {
    const personality =
      behavior === "sleepy"
        ? { curiosity: 0.42, caution: 0.48, sociability: 0.68, energy: 0.2, playfulness: 0.28 }
        : behavior === "curious"
          ? { curiosity: 0.94, caution: 0.34, sociability: 0.82, energy: 0.62, playfulness: 0.64 }
          : behavior === "shy"
            ? { curiosity: 0.34, caution: 0.96, sociability: 0.3, energy: 0.58, playfulness: 0.26 }
            : behavior === "playful"
              ? { curiosity: 0.82, caution: 0.46, sociability: 0.76, energy: 0.94, playfulness: 1 }
              : { curiosity: 0.72, caution: 0.52, sociability: 0.58, energy: 0.7, playfulness: 0.84 }
    return createAnimalAgent({
      id: `garden-cat-${name.split(" ")[0].toLowerCase()}`,
      species: "garden-cat",
      mobility: "land",
      position: { x: base.x, z: base.z },
      seed: 5300 + name.length * 31,
      radius: 0.2,
      walkSpeed: 1.15,
      runSpeed: 3.6,
      perception: 9,
      personalSpace: 0.68,
      playerSpace: 1.15,
      interests: ["garden-cat", "rabbit", "ground-bird", "butterfly", "duck"],
      preferredPoints: [
        { x: GARDEN.x, z: GARDEN.z },
        { x: 9.5, z: 9.2 },
        { x: 14.2, z: -5.5 },
        { x: 7.5, z: -15 },
        { x: -5, z: 13 },
      ],
      personality,
    })
  }, [base.x, base.z, behavior, name])

  useLayoutEffect(() => registerAnimalAgent(agent), [agent])
  useEffect(() => {
    let alive = true
    let loaded: AnimalModel | null = null
    let ownMaterial: THREE.MeshStandardMaterial | null = null
    void makeAnimalModel("cat", GARDEN_COATS[breed]).then(asset => {
      if (!asset) return
      if (!alive) { disposeAnimalModel(asset); return }
      loaded = asset
      void prepareHomeAnimalLOD(asset, "cat")
      asset.root.name = `garden-${breed}-${name.split(" ")[0].toLowerCase()}`
      // Seal points and calico patches are authored in rest space so markings
      // stay on the face, paws and flank throughout animation.
      if (breed === "siamese" || breed === "calico") {
        const source = asset.material
        const material = source.clone()
        material.onBeforeCompile = (shader, renderer) => {
          source.onBeforeCompile(shader, renderer)
          if (breed === "siamese") shader.uniforms.uEye = { value: new THREE.Vector3(0.15, 0.65, 4.5) }
          shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vGardenRest;")
            .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGardenRest = position;")
          shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vGardenRest;")
          const pattern = breed === "siamese" ? `
            float points = max(1.0 - smoothstep(0.05, 0.115, vGardenRest.y), smoothstep(0.12, 0.20, vGardenRest.z));
            points = max(points, smoothstep(0.11, 0.20, abs(vGardenRest.x)) * smoothstep(0.15, 0.25, vGardenRest.y));
            if (mask.a < 0.5) diffuseColor.rgb = mix(vec3(0.78,0.66,0.46), vec3(0.11,0.055,0.028), points * 0.88) * mask.r;
          ` : `
            float patches = sin(vGardenRest.z * 28.0 + vGardenRest.y * 15.0) + sin(vGardenRest.x * 53.0 - vGardenRest.z * 11.0);
            vec3 calico = mix(vec3(0.82,0.40,0.12), vec3(0.075,0.052,0.035), smoothstep(-0.2, 0.2, patches));
            if (mask.a < 0.5) diffuseColor.rgb = mix(calico, vec3(0.88,0.82,0.72), mask.g) * mask.r;
          `
          // Apply the breed pattern after the shared literal eye/nose colours.
          shader.fragmentShader = shader.fragmentShader.replace("diffuseColor.rgb = mask.a > 0.5 ? mask.rgb * mix(vec3(1.0), uEye, eyeTint) : coat;",
            `diffuseColor.rgb = mask.a > 0.5 ? mask.rgb * mix(vec3(1.0), uEye, eyeTint) : coat;\n${pattern}`)
        }
        material.customProgramCacheKey = () => `garden-coat-${breed}-v1`
        ownMaterial = material
        for (const mesh of asset.meshes) mesh.material = material
      }
      animator.current = new QuadrupedAnimator("cat", asset, agent.config.seed)
      animator.current.plantPaws = true
      setModel(asset)
    })
    return () => { alive = false; animator.current = null; if (loaded) disposeAnimalModel(loaded); ownMaterial?.dispose() }
  }, [agent, breed, name])

  useHubFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    stepAnimalAgent(agent, dt)
    const root = ref.current
    if (!root) return
    root.position.copy(agent.position)
    root.rotation.y = agent.heading
    const resting = agent.activity === "rest"
    const sleeping = resting && behavior === "sleepy"
    const blend = blends.current
    blend.sit = damp(blend.sit, resting && !sleeping ? 1 : 0, 5, dt)
    blend.sleep = damp(blend.sleep, sleeping ? 1 : 0, 5, dt)
    blend.graze = damp(blend.graze, agent.activity === "eat" || (agent.activity === "drink" && !agent.moving) ? 1 : 0, 5, dt)
    pose.dt = dt; pose.time = state.clock.elapsedTime; pose.speed = agent.speed; pose.turnRate = 0
    pose.sit = blend.sit; pose.sleep = blend.sleep; pose.graze = blend.graze
    pose.happy = resting || agent.activity === "play" ? 0.55 : 0.1
    pose.lookYaw = Math.sin(pose.time * 0.7 + agent.config.seed) * (behavior === "curious" ? 0.25 : 0.1)
    pose.tailUp = agent.moving && agent.activity !== "flee" ? 0.65 : 0
    pose.tailWrap = blend.sit; pose.groom = resting && !sleeping ? Math.max(0, Math.sin(pose.time * 0.17) - 0.7) * 2 : 0
    const heading = agent.heading, x = agent.position.x, z = agent.position.z
    const avatar = avatarRT()
    if (model) pose.fullIK = updateHomeAnimalLOD(model, (avatar.pos.x - x) ** 2 + (avatar.pos.z - z) ** 2)
    const dx = (groundHeight(x + 0.2, z) - groundHeight(x - 0.2, z)) / 0.4
    const dz = (groundHeight(x, z + 0.2) - groundHeight(x, z - 0.2)) / 0.4
    pose.slope = dx * Math.sin(heading) + dz * Math.cos(heading)
    pose.crossSlope = dx * Math.cos(heading) - dz * Math.sin(heading)
    animator.current?.update(pose)
  })

  return <group ref={ref} userData={{ dynamic: true }} position={[base.x, groundHeight(base.x, base.z), base.z]}>
    {model && <primitive object={model.root} dispose={null} />}
  </group>
}
