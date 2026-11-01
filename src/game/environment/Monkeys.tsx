import { debugEnabled } from "../../dev/debugFlag"
import { useHubFrame } from "../hubGate"

import { useEffect, useLayoutEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { createAnimalAgent, registerAnimalAgent, stepAnimalAgent } from "../animals/ecosystem"
import { branchFootPoint, MONKEY_BRANCHES, monkeySpawnBranch, stepBranches } from "../animals/monkeyHabitat"
import { forceGroomBout, forceMonkeyLeap, getMonkeyMotion } from "../animals/monkeyMotion"
import { getAnimalAgent } from "../animals/ecosystem"
import { registerDevTool } from "../../dev/devTools"
import { worldRT } from "../runtime"
import { BRANCH_SPRINGS } from "../animals/monkeyHabitat"
import { bendBoughMesh, buildBoughMesh } from "./monkeyBoughs"
import { birchBarkTexture, deciduousBarkTexture } from "./trees/treeTextures"
import { TREES } from "../world-layout"
import { weatherRT } from "../weather/weatherState"
import { avatarRT } from "../runtime"
import { groundHeight } from "../world-layout"
import { groundShadowTexture } from "../../utils/groundShadow"
import { disposeAnimalModel, makeAnimalModel, prepareHomeAnimalLOD, updateHomeAnimalLOD, type AnimalModel } from "../../world/wildlife/animalAssets"
import { PrimateAnimator, type PrimatePose } from "../../world/wildlife/PrimateAnimator"

/**
 * Five little inhabitants in the monkey groves.
 *
 * The visual is the rigged, skinned macaque from
 * asset-pipeline/blender/build_wildlife_v2.py — real arms and hands, a long balancing
 * tail that curls when perched, a pale face, and a light/dark coat mask — driven
 * by PrimateAnimator, which knows the knuckle walk, the full sit and the climb.
 * Simulation is unchanged: the same agents, the same branch habitat, the same
 * `getMonkeyMotion` phases (branch idle/walk, prepare, takeoff, airborne,
 * landing, climb up/down, ground idle/walk/run), the same ground shadow and the
 * same fruit-while-eating prop.
 */
export const monkeyPlayback = { paused: false }

/** Five little inhabitants, including the quiet western groves.
 *  `coat` indexes COATS.monkey; each grove gets a different macaque colour. */
/**
 * QA (debug only):
 *   __worldDev.monkeys()             each monkey's phase, partner, bough and its sag
 *   __worldDev.monkeyGroom(1, 2)     seat monkey 2 on the ground before 1's tree; 1 grooms it
 *   __worldDev.monkeyLeap(1)         monkey 1 walks out and leaps to the next bough
 *   __worldDev.monkeyLook(1, d, az, h)  inspection camera on monkey 1 (distance, azimuth deg, height)
 */
const installMonkeyDev = (): void => {
  const agent = (i: number) => getAnimalAgent(`monkey-${i}`)
  registerDevTool("monkeys", () => [1, 2, 3, 4, 5].map((i) => {
    const a = agent(i)
    if (!a) return null
    const m = getMonkeyMotion(a)
    return { id: a.id, phase: m.phase, role: m.groomRole, partner: m.partner?.id ?? null, grooms: m.grooms,
      branch: m.branch.id, t: +m.branchT.toFixed(2), sag: +BRANCH_SPRINGS[m.branch.id].q.toFixed(3),
      pos: a.position.toArray().map((v) => +v.toFixed(2)) }
  }))
  registerDevTool("monkeyGroom", ((g: number, e: number) => {
    const groomer = agent(g), groomee = agent(e)
    if (!groomer || !groomee) return false
    const spot = getMonkeyMotion(groomer).branch.approach.clone()
    forceGroomBout(groomer, groomee, spot)
    return true
  }) as never)
  registerDevTool("monkeyLeap", ((i: number) => { const a = agent(i); return a ? forceMonkeyLeap(a) : false }) as never)
  registerDevTool("monkeyLook", ((i: number, d = 1.6, az = 30, h = 0.5) => {
    const a = agent(i)
    if (!a) return false
    const yaw = a.heading + (az * Math.PI) / 180
    Object.assign(worldRT.inspectionCamera, { active: true, follow: false,
      px: a.position.x + Math.sin(yaw) * d, py: a.position.y + h, pz: a.position.z + Math.cos(yaw) * d,
      tx: a.position.x, ty: a.position.y + 0.25, tz: a.position.z })
    return true
  }) as never)
}

export const Monkeys = (): React.ReactElement => {
  useEffect(() => { if (debugEnabled()) installMonkeyDev() }, [])
  return <MonkeyGroves />
}

const MonkeyGroves = (): React.ReactElement => (
  <group name="monkey-groves">
    <MonkeyBranches />
    {[0, 1, 2, 1, 0].map((coat, index) => <Monkey key={index} index={index} coat={coat} />)}
  </group>
)

/**
 * The groves' boughs, in the trees' own bark, bending under whoever sits on
 * them (monkeyHabitat BRANCH_SPRINGS). Birch trees (variant 0) carry birch
 * bark, the rest oak, as DeciduousTreeSystem draws their other boughs.
 */
const MonkeyBranches = (): React.ReactElement => {
  const meshes = useMemo(() => {
    const birch = buildBoughMesh(MONKEY_BRANCHES.filter((b) => b.tree !== 53 && TREES[b.tree].variant === 0))
    const oak = buildBoughMesh(MONKEY_BRANCHES.filter((b) => b.tree === 53 || TREES[b.tree].variant !== 0))
    return [birch, oak]
  }, [])
  const materials = useMemo(() => {
    const oakTex = deciduousBarkTexture()
    const birchTex = birchBarkTexture()
    return [
      new THREE.MeshStandardMaterial({ map: birchTex, bumpMap: birchTex, bumpScale: 0.025, roughness: 0.78, metalness: 0.02 }),
      new THREE.MeshStandardMaterial({ map: oakTex, bumpMap: oakTex, bumpScale: 0.045, roughness: 0.92, metalness: 0.04 }),
    ]
  }, [])
  useEffect(() => () => {
    for (const m of meshes) m?.geometry.dispose()
    for (const m of materials) m.dispose()
  }, [meshes, materials])
  useHubFrame((state, rawDt) => {
    // one step for every bough, after this frame's monkeys have loaded them
    if (!monkeyPlayback.paused) stepBranches(Math.min(rawDt, 0.05), weatherRT.wind + weatherRT.gust, state.clock.elapsedTime)
    for (const m of meshes) if (m && bendBoughMesh(m)) m.geometry.computeBoundingSphere()
  })
  return <>
    {meshes.map((m, i) => m && <mesh key={i} geometry={m.geometry} material={materials[i]} castShadow receiveShadow />)}
  </>
}

/** Scratch pose so the per-frame path never allocates. */
const pose: PrimatePose = {
  dt: 1 / 60, time: 0, speed: 0, turnRate: 0, sit: 1, sleep: 0, climb: 0, air: 0,
  crouch: 0, lookYaw: 0, lookPitch: 0, eat: 0, groom: 0, happy: 0, alert: 0, fullIK: true,
  allogroom: 0, groomed: 0, social: 0, curious: 0,
}

const Monkey = ({ index, coat }: { index: number; coat: number }): React.ReactElement => {
  const root = useRef<THREE.Group>(null)
  const shadow = useRef<THREE.Mesh>(null)
  const fruit = useRef<THREE.Group>(null)
  const animatorRef = useRef<PrimateAnimator | null>(null)
  const modelRef = useRef<AnimalModel | null>(null)
  const blend = useRef({ sit: 1, climb: 0, air: 0, crouch: 0, allogroom: 0, groomed: 0, social: 0 })
  const prevHeading = useRef(0)
  const turnRate = useRef(0)
  const agent = useMemo(() => {
    const branch = monkeySpawnBranch(index)
    return createAnimalAgent({
      id: `monkey-${index + 1}`, species: "monkey", mobility: "arboreal",
      position: branchFootPoint(branch, 0.85, new THREE.Vector3()),
      seed: 6800 + index, radius: 0.16, walkSpeed: 0.65, runSpeed: 1.7,
      interests: ["monkey", "ground-bird", "garden-cat"],
    })
  }, [index])
  const shadowMaterial = useMemo(() => new THREE.MeshBasicMaterial({ map: groundShadowTexture(), transparent: true, opacity: 0.3, depthWrite: false }), [])
  useEffect(() => () => shadowMaterial.dispose(), [shadowMaterial])
  useLayoutEffect(() => registerAnimalAgent(agent), [agent])

  // Mount the rigged macaque. makeAnimalModel shares the GLB template and the
  // coat material across all five, so each grove adds only its own skeleton.
  useEffect(() => {
    let live = true
    let model: AnimalModel | null = null
    makeAnimalModel("monkey", coat).then((m) => {
      if (!m) return
      if (!live) { disposeAnimalModel(m); return }
      model = m
      modelRef.current = m
      void prepareHomeAnimalLOD(m, "monkey")
      root.current?.add(m.root)
      animatorRef.current = new PrimateAnimator("monkey", m, 6800 + index)
    })
    return () => {
      live = false
      if (model) disposeAnimalModel(model)
      animatorRef.current = null
      modelRef.current = null
    }
  }, [coat, index])

  useHubFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    if (!monkeyPlayback.paused) stepAnimalAgent(agent, dt)
    const m = getMonkeyMotion(agent)
    const t = state.clock.elapsedTime + index * 2.4
    const climbing = m.phase === "climb-down" || m.phase === "climb-up"
    const airborne = m.phase === "airborne" || m.phase === "takeoff"
    const grooming = m.phase === "grooming"
    const idle = m.phase === "ground-idle" || m.phase === "branch-idle" || grooming
    const crouching = m.phase === "prepare" || m.phase === "landing" || m.phase === "recovery"
    const _blend = blend.current
    // Same damped blend the primitive rig used, so the transition into and out
    // of a sit, a climb or a leap is unchanged.
    _blend.sit = THREE.MathUtils.damp(_blend.sit, idle ? 1 : 0, 10, dt)
    _blend.climb = THREE.MathUtils.damp(_blend.climb, climbing ? 1 : 0, 12, dt)
    _blend.air = THREE.MathUtils.damp(_blend.air, airborne ? 1 : 0, 18, dt)
    _blend.crouch = THREE.MathUtils.damp(_blend.crouch, crouching ? 1 : 0, 20, dt)
    // a groomer's hands go to work once both are settled; the groomee relaxes into it
    const partnerSettled = m.partner ? getMonkeyMotion(m.partner).phase === "grooming" : false
    _blend.allogroom = THREE.MathUtils.damp(_blend.allogroom, grooming && m.groomRole === "groomer" && partnerSettled ? 1 : 0, 3, dt)
    _blend.groomed = THREE.MathUtils.damp(_blend.groomed, grooming && m.groomRole === "groomee" && m.partner && m.partner.position.distanceTo(agent.position) < 0.45 ? 1 : 0, 2, dt)
    _blend.social = THREE.MathUtils.damp(_blend.social, m.partner && m.partner.position.distanceTo(agent.position) < 0.7 ? 1 : 0, 4, dt)

    if (root.current) {
      root.current.position.copy(agent.position)
      root.current.rotation.y = agent.heading
    }

    // Head tracking, preserved: an idle monkey within four metres of the avatar
    // turns to look at it, otherwise it glances about while perched.
    const near = avatarRT().pos.distanceTo(agent.position) < 4
    const relative = Math.atan2(avatarRT().pos.x - agent.position.x, avatarRT().pos.z - agent.position.z) - agent.heading
    const look = THREE.MathUtils.euclideanModulo(relative + Math.PI, Math.PI * 2) - Math.PI
    const lookYaw = idle && near ? THREE.MathUtils.clamp(look, -0.7, 0.7) : Math.sin(t * 0.6) * 0.12 * _blend.sit
    const lookPitch = agent.activity === "eat" ? 0.2 : climbing ? -0.25 : -_blend.air * 0.15

    const animator = animatorRef.current
    if (animator) {
      if (modelRef.current) pose.fullIK = updateHomeAnimalLOD(modelRef.current, avatarRT().pos.distanceToSquared(agent.position))
      pose.dt = dt
      pose.time = t
      pose.speed = agent.speed
      // her turns, from the heading as it actually changes (a lean, a look ahead into them)
      const dh = Math.atan2(Math.sin(agent.heading - prevHeading.current), Math.cos(agent.heading - prevHeading.current))
      prevHeading.current = agent.heading
      turnRate.current = THREE.MathUtils.damp(turnRate.current, dh / Math.max(dt, 1e-3), 8, dt)
      pose.turnRate = THREE.MathUtils.clamp(turnRate.current, -4, 4)
      pose.climbRate = climbing ? (m.end.y - m.start.y) / Math.max(0.2, m.duration) : 0
      pose.sit = _blend.sit
      pose.climb = _blend.climb
      pose.air = _blend.air
      pose.crouch = _blend.crouch
      pose.lookYaw = lookYaw
      pose.lookPitch = lookPitch
      pose.eat = agent.activity === "eat" ? 1 : 0
      pose.groom = agent.activity === "rest" && idle && !grooming ? Math.max(0, Math.sin(t * 0.4)) * 0.35 : 0
      pose.allogroom = _blend.allogroom
      pose.groomed = _blend.groomed
      pose.social = _blend.social
      pose.curious = idle && near && !grooming ? 1 : 0
      pose.happy = idle ? 0.4 : 0
      pose.alert = near && !idle ? 0.4 : 0
      animator.update(pose)
    }

    if (fruit.current) fruit.current.visible = agent.activity === "eat" && idle
    if (shadow.current) {
      const ground = groundHeight(agent.position.x, agent.position.z)
      const height = Math.max(0, agent.position.y - ground)
      shadow.current.position.set(agent.position.x, ground + 0.02, agent.position.z)
      shadowMaterial.opacity = 0.27 / (1 + height * 1.8)
      shadow.current.scale.setScalar(1 + height * 0.12)
    }
  })

  return <>
    <mesh ref={shadow} material={shadowMaterial} rotation-x={-Math.PI / 2}><planeGeometry args={[0.55, 0.5]} /></mesh>
    <group ref={root} name={`monkey-${index + 1}-rig`}>
      {/* The skinned macaque is mounted imperatively; this group carries only
          the agent transform. The fruit follows the same rule. */}
      <group ref={fruit} name="fruit" visible={false}>
        <mesh position={[0.06, 0.34, 0.10]} castShadow>
          <sphereGeometry args={[0.026, 10, 8]} />
          <meshStandardMaterial color="#d77543" roughness={0.65} />
        </mesh>
      </group>
    </group>
  </>
}
