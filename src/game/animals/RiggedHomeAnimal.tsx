import { useEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"
import { useHubFrame } from "../hubGate"
import { avatarRT } from "../runtime"
import { groundHeight, WATER_Y } from "../world-layout"
import { disposeAnimalModel, makeAnimalModel, prepareHomeAnimalLOD, updateHomeAnimalLOD, type AnimalModel, type Species } from "../../world/wildlife/animalAssets"
import { QuadrupedAnimator, type AnimalPose } from "../../world/wildlife/QuadrupedAnimator"
import type { AnimalAgent } from "./ecosystem"

type Props = { agent: AnimalAgent; species: Species; coat: number; scale?: number; local?: boolean;
  tint?: { base: string; light: string; pattern: string } }

/** Appearance only. The existing ecosystem and family controllers still own
 * movement, threats, habitats and interactions. Assets are authored in metres. */
export const RiggedHomeAnimal = ({ agent, species, coat, scale = 1, local = false, tint }: Props): React.ReactElement => {
  const [model, setModel] = useState<AnimalModel | null>(null)
  const animator = useRef<QuadrupedAnimator | null>(null)
  const footOffset = useRef(0)
  const pose = useMemo<AnimalPose>(() => ({ dt: 0, time: 0, speed: 0, turnRate: 0, sit: 0, sleep: 0, graze: 0, happy: 0,
    swim: 0, lookYaw: 0, lookPitch: 0, slope: 0, crossSlope: 0, fullIK: true }), [])
  const lastHeading = useRef(agent.heading)
  // Ground under each paw, in the model's own units (metres / scale), relative
  // to where the body stands: a paw on a hummock or in a hollow finds it.
  const under = useMemo(() => {
    const g = { x: 0, y: 0, z: 0, sin: 0, cos: 1, k: 1 }
    const at = (lx: number, lz: number): number =>
      (groundHeight(g.x + (lx * g.cos + lz * g.sin) * g.k, g.z + (-lx * g.sin + lz * g.cos) * g.k) - g.y) / g.k
    return { g, at }
  }, [])
  const tintBase = tint?.base, tintLight = tint?.light, tintPattern = tint?.pattern

  useEffect(() => {
    let cancelled = false, owned: AnimalModel | null = null, privateMaterial: THREE.MeshStandardMaterial | null = null
    void makeAnimalModel(species, coat).then(loaded => {
      if (!loaded) return
      if (cancelled) { disposeAnimalModel(loaded); return }
      owned = loaded
      loaded.root.userData.dynamic = true
      void prepareHomeAnimalLOD(loaded, species)
      loaded.root.name = `home-animal:${agent.id}`
      loaded.root.updateMatrixWorld(true)
      footOffset.current = -new THREE.Box3().setFromObject(loaded.root).min.y
      animator.current = new QuadrupedAnimator(species, loaded, agent.config.seed)
      animator.current.plantPaws = true
      if (tintBase && tintLight && tintPattern) {
        const source = loaded.material
        privateMaterial = source.clone()
        const base = new THREE.Color(tintBase), light = new THREE.Color(tintLight), pattern = new THREE.Color(tintPattern)
        privateMaterial.onBeforeCompile = (shader, renderer) => {
          source.onBeforeCompile(shader, renderer)
          shader.uniforms.uBase = { value: base }; shader.uniforms.uLight = { value: light }; shader.uniforms.uPattern = { value: pattern }
        }
        privateMaterial.customProgramCacheKey = source.customProgramCacheKey.bind(source)
        for (const mesh of loaded.meshes) mesh.material = privateMaterial
      }
      loaded.root.scale.setScalar(scale)
      setModel(loaded)
    })
    return () => {
      cancelled = true
      animator.current = null
      if (owned) disposeAnimalModel(owned)
      privateMaterial?.dispose()
    }
  }, [agent, coat, scale, species, tintBase, tintLight, tintPattern])

  useHubFrame((state, rawDt) => {
    if (!model || !animator.current) return
    const dt = Math.min(rawDt, 0.1), x = agent.position.x, z = agent.position.z
    const waterDraft = local && species === "duck" && agent.mobility === "water" ? WATER_Y - agent.position.y : 0
    model.root.position.set(local ? 0 : x, (local ? waterDraft : agent.position.y) + footOffset.current * scale + 0.003, local ? 0 : z)
    model.root.rotation.y = local ? 0 : agent.heading
    const p = pose
    const avatar = avatarRT()
    p.fullIK = updateHomeAnimalLOD(model, (avatar.pos.x - x) ** 2 + (avatar.pos.z - z) ** 2)
    p.dt = dt; p.time = state.clock.elapsedTime; p.speed = agent.speed / scale
    p.turnRate = Math.atan2(Math.sin(agent.heading - lastHeading.current), Math.cos(agent.heading - lastHeading.current)) / Math.max(dt, 1e-4)
    lastHeading.current = agent.heading
    p.graze = agent.activity === "eat" || agent.activity === "drink" ? 1 : 0
    p.happy = agent.activity === "play" || agent.activity === "socialize" ? 0.7 : 0
    p.swim = agent.mobility === "water" ? 1 : 0
    p.sit = agent.mobility === "land" && agent.activity === "rest" && species !== "deer" ? 0.85 : 0
    p.sleep = agent.activity === "shelter" ? 0.85 : 0
    p.alert = agent.activity === "flee" ? 1 : 0
    p.rear = species === "rabbit" && agent.activity === "investigate" && agent.speed < 0.1 ? 0.6 : 0
    p.preen = agent.activity === "rest" && species === "duck" ? 0.6 : 0
    p.flap = agent.activity === "flee" && species === "duck" ? 0.45 : 0
    const gx = (groundHeight(x + 0.3, z) - groundHeight(x - 0.3, z)) / 0.6
    const gz = (groundHeight(x, z + 0.3) - groundHeight(x, z - 0.3)) / 0.6
    p.slope = gx * Math.sin(agent.heading) + gz * Math.cos(agent.heading)
    p.crossSlope = gx * Math.cos(agent.heading) - gz * Math.sin(agent.heading)
    // per-paw terrain for land animals near enough to plant their paws by IK
    if (p.fullIK && agent.mobility === "land" && !local) {
      const g = under.g
      g.x = x; g.y = agent.position.y; g.z = z; g.k = scale
      g.sin = Math.sin(agent.heading); g.cos = Math.cos(agent.heading)
      p.groundAt = under.at
    } else p.groundAt = undefined
    const body = avatarRT(), dx = body.pos.x - x, dz = body.pos.z - z
    const yaw = Math.atan2(dx, dz) - agent.heading
    p.lookYaw = Math.hypot(dx, dz) < 7 ? THREE.MathUtils.clamp(Math.atan2(Math.sin(yaw), Math.cos(yaw)), -0.8, 0.8) : 0
    p.lookPitch = 0; p.earSwivel = p.lookYaw
    animator.current.update(p)
  })

  return model ? <primitive object={model.root} /> : <group />
}
