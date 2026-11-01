import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"
import { groundShadowTexture } from "../../utils/groundShadow"
import { dampAngle, smoothstep } from "../../utils/math"
import { sfx } from "../audio/audio"
import { footstep } from "../audio/footsteps"
import { heroTrack } from "../vfx/heroRuntime"
import { avatarRT, characterRT, companionRT, input, playerRT, worldRT } from "../runtime"
import { weatherRT } from "../weather/weatherState"
import { buildColliders, groundHeight, TRAINING } from "../world-layout"
import { resolveCollisions } from "../movement"
import { emitSplash, waterBodyRT } from "../../world/render/waterFx"
import { avatarFootGround, createAvatarController, stepAvatarController } from "./controller/avatarController"
import { HUMAN_TUNING } from "./ExplorerCharacter"
import { adoptRigMetrics } from "./bodyMetrics"
import { HumanAnimator, type ArmGoal, type HumanPoseInput } from "./human/HumanAnimator"
import { applyRiderPose, makeRiderPoseCache } from "../horses/riderPose"
import { applyDragonRiderPose } from "../dragon/dragonRider"
import { applyDeerAffection } from "../deer/affection"
import { isMounted, riderMetrics } from "../horses/riding"
import { applyPoseRequest } from "../together/togetherState"
import type { HumanAsset } from "./human/humanAsset"
import { loadCompanion } from "./human/humanAsset"
import { names } from "../../personalization"

const TUNING = { ...HUMAN_TUNING, radius: 0.36, floatDraft: 1.12, swimEnter: 1.35, swimExit: 1.1 }
const colliders = buildColliders()
const nextPosition = { x: 0, z: 0 }
export const companionMotionRT = { water: "land" as "land" | "wade" | "swim", swim: 0, targetSpeed: 0, modelReady: false, modelSettled: false }

/** One rig serves free exploration and the finale choreography. */
export const CompanionCharacter = (): React.ReactElement => {
  const root = useRef<THREE.Group>(null)
  const shadow = useRef<THREE.Mesh>(null)
  const [asset, setAsset] = useState<HumanAsset | null>(null)
  const animator = useRef<HumanAnimator | null>(null)
  const reachCache = useMemo<{ L: ArmGoal | null; R: ArmGoal | null }>(() => ({ L: null, R: null }), [])
  const rideCache = useMemo(() => makeRiderPoseCache(), [])
  const controller = useMemo(() => createAvatarController(companionRT), [])
  const blends = useRef({ sit: 0, paint: 0, wish: 0, greeting: 0, pet: 0 })
  const shadowMaterial = useMemo(() => new THREE.MeshBasicMaterial({ map: groundShadowTexture(), transparent: true, depthWrite: false }), [])
  const pose = useMemo<HumanPoseInput>(() => ({
    dt: 0, time: 0, speed: 0, turnRate: 0, forwardAccel: 0, groundLeft: 0, groundRight: 0, slope: 0,
    airborne: false, jumpPhase: "grounded", jumpTime: 0, idleTime: 0, petting: 0, petSide: 1, celebrate: 0,
    training: { stance: 0, jab: 0, cross: 0 }, fear: 0, greeting: 0, lookYaw: 0, lookPitch: 0, wind: 0,
    sit: 0, paint: 0, wish: 0, swim: 0, wade: 0, swimSpeed: 0,
  }), [])

  useEffect(() => {
    let alive = true
    loadCompanion().then(model => {
      if (!alive) return
      adoptRigMetrics("companion", model, TUNING)
      animator.current = new HumanAnimator(model)
      riderMetrics.companion.hips = animator.current.hipsHeight
      companionMotionRT.modelReady = companionMotionRT.modelSettled = true
      characterRT.companionReady = true
      setAsset(model)
    }).catch(error => {
      if (!alive) return
      companionMotionRT.modelSettled = true
      characterRT.companionReady = false
      console.error(`${names.companion}'s character could not load`, error)
    })
    return () => { alive = false; shadowMaterial.dispose() }
  }, [shadowMaterial])

  useFrame((state, rawDt) => {
    if (!asset) return
    const dt = Math.min(Math.max(rawDt, 1e-4), 1 / 20)
    const body = companionRT
    const selected = characterRT.active === "companion"
    const training = selected && worldRT.performingMemoryId === "training-corner"
    const trainingTime = worldRT.performanceTime - 1.25
    if (body.gesture !== "none") {
      body.gestureTime += dt
      const moving = selected && Math.hypot(input.move.x, input.move.y) > 0.1
      const timedOut = (body.gesture === "train" && body.gestureTime > 2.4) ||
        (body.gesture === "cheer" && body.gestureTime > 1.4) || (body.gesture === "wish" && body.gestureTime > 3.5) ||
        (body.gesture === "pet" && body.gestureTime > 3.2) || (body.gesture === "call" && body.gestureTime > 1.5) || (body.gesture === "whistle" && body.gestureTime > 2.3)
      if (body.gesture !== "ride" && (timedOut || (moving && body.gestureTime > 0.35))) {
        body.gesture = "none"
        body.paused = false
        body.rideY = null
      }
    }
    if (training && trainingTime < 0) {
      const dx = TRAINING.bagX - body.pos.x, dz = TRAINING.bagZ - body.pos.z
      const distance = Math.hypot(dx, dz), step = Math.min(Math.max(0, distance - 0.8), dt * 2.6)
      nextPosition.x = body.pos.x + dx / Math.max(distance, 0.001) * step
      nextPosition.z = body.pos.z + dz / Math.max(distance, 0.001) * step
      resolveCollisions(nextPosition, TUNING.radius, colliders.circles, colliders.rects)
      body.vel.set((nextPosition.x - body.pos.x) / dt, 0, (nextPosition.z - body.pos.z) / dt)
      body.pos.x = nextPosition.x; body.pos.z = nextPosition.z
    }
    stepAvatarController(body, "companion", controller, TUNING, dt, worldRT.finaleActive || (training && trainingTime < 0) || body.rideY !== null)
    if (training) body.facing = dampAngle(body.facing, Math.atan2(TRAINING.bagX - body.pos.x, TRAINING.bagZ - body.pos.z), 10, dt)
    const loco = controller.loco, motion = loco.motion
    if (body.rideY !== null) body.pos.y = body.rideY
    companionMotionRT.water = loco.water; companionMotionRT.swim = loco.swim; companionMotionRT.targetSpeed = controller.targetSpeed
    if (selected) {
      // in the saddle the rider is above the water, not in it (the mount splashes)
      const riding = body.rideY !== null
      waterBodyRT.surface = riding ? null : loco.waterSurface; waterBodyRT.swim = riding ? 0 : loco.swim; waterBodyRT.wade = riding ? 0 : loco.wade
      if (loco.landed && loco.water === "land" && !riding) sfx.thump()
      if (!riding && (loco.enteredWater || loco.startedSwimming || (loco.landed && loco.water !== "land"))) emitSplash(body.pos.x, body.pos.z, 0.8)
    }
    const visible = characterRT.companionPresent && !worldRT.introActive && body.pos.distanceToSquared(avatarRT().pos) < 180 * 180
    if (root.current) {
      root.current.visible = visible
      root.current.position.set(body.pos.x, body.pos.y + loco.stepSmooth, body.pos.z)
      // on a flying mount the body pitches and banks with it
      root.current.rotation.set(-body.ridePitch, body.facing, -body.rideRoll, "YXZ")
      root.current.scale.setScalar(characterRT.companionScale)
    }
    if (shadow.current) {
      shadow.current.visible = visible && loco.water === "land"
      shadow.current.position.set(body.pos.x, loco.support + 0.02, body.pos.z)
      shadow.current.scale.setScalar(characterRT.companionScale * (1 - Math.min(0.5, motion.lift * 0.45)))
      shadowMaterial.opacity = 0.78 - Math.min(0.5, motion.lift * 0.35)
    }
    if (!visible) return
    body.celebrate = Math.max(0, body.celebrate - dt)
    const g = body.gesture, gt = body.gestureTime, blend = blends.current
    blend.sit = THREE.MathUtils.damp(blend.sit, g === "sit" || g === "ride" ? 1 : 0, 5, dt)
    blend.paint = THREE.MathUtils.damp(blend.paint, g === "paint" ? 1 : 0, 6, dt)
    blend.wish = THREE.MathUtils.damp(blend.wish, g === "wish" ? 1 : 0, 6, dt)
    blend.greeting = THREE.MathUtils.damp(blend.greeting, characterRT.finaleWave, 6, dt)
    blend.pet = THREE.MathUtils.damp(blend.pet, g === "pet" ? 1 : 0, 6, dt)
    const sin = Math.sin(body.facing), cos = Math.cos(body.facing), lateral = 0.108
    const trainClock = training ? trainingTime : g === "train" ? gt - 0.1 : -10
    const stance = training || g === "train" ? smoothstep(0, 0.22, trainClock) * (1 - smoothstep(1.55, 2.05, trainClock)) : 0
    if (g === "cheer" && gt < 0.05) body.celebrate = 1.2
    pose.dt = dt; pose.time = state.clock.elapsedTime; pose.speed = body.speed
    pose.turnRate = controller.turnRate; pose.forwardAccel = controller.forwardAccel
    pose.groundLeft = avatarFootGround(body, controller, body.pos.x + cos * lateral, body.pos.z - sin * lateral)
    pose.groundRight = avatarFootGround(body, controller, body.pos.x - cos * lateral, body.pos.z + sin * lateral)
    pose.slope = THREE.MathUtils.clamp((groundHeight(body.pos.x + sin * 0.35, body.pos.z + cos * 0.35) - groundHeight(body.pos.x - sin * 0.35, body.pos.z - cos * 0.35)) / 0.7, -0.8, 0.8)
    pose.airborne = loco.water !== "swim" && (motion.phase === "rising" || motion.phase === "falling")
    pose.jumpPhase = motion.phase; pose.jumpTime = motion.time; pose.idleTime = body.idleTime
    pose.swim = loco.swim; pose.wade = loco.water === "land" ? 0 : loco.wade; pose.swimSpeed = loco.water === "swim" ? body.speed : 0
    pose.celebrate = body.celebrate; pose.training.stance = stance
    pose.petting = blend.pet
    pose.whistle = g === "whistle" && gt < 2.1 ? 1 : 0
    pose.whistleT = g === "whistle" ? gt : 0
    pose.training.jab = Math.exp(-(((trainClock - 0.5) / 0.12) ** 2)) * stance
    pose.training.cross = Math.exp(-(((trainClock - 0.93) / 0.13) ** 2)) * stance
    pose.sit = blend.sit; pose.paint = blend.paint; pose.wish = blend.wish; pose.greeting = blend.greeting
    pose.fear = body.frightened; pose.wind = weatherRT.wind + weatherRT.gust
    const dx = playerRT.pos.x - body.pos.x, dz = playerRT.pos.z - body.pos.z
    pose.lookYaw = !body.moving && dx * dx + dz * dz < 36 ? THREE.MathUtils.clamp(Math.atan2(Math.sin(Math.atan2(dx, dz) - body.facing), Math.cos(Math.atan2(dx, dz) - body.facing)), -0.55, 0.55) : 0
    pose.lookPitch = 0
    // The companion has no kneel: start every frame upright, so a kneel
    // requested by an activity (laying flowers down) ends when the request
    // does instead of being held by applyPoseRequest's max() forever.
    pose.kneel = 0
    const anim = animator.current
    if (anim) {
      applyPoseRequest("companion", asset.root, pose, reachCache)
      applyRiderPose("companion", asset.root, pose, rideCache, state.clock.elapsedTime)
      applyDragonRiderPose("companion", asset.root, pose)
      if (!isMounted("companion")) applyDeerAffection("companion", asset.root, pose, dt)
      anim.update(pose)
      if (selected && anim.stepped && !pose.airborne && !isMounted("companion")) footstep(companionRT, companionMotionRT.water !== "land")
      heroTrack("companion", asset?.bones ?? null, companionRT, companionMotionRT.water, anim.stepped && !pose.airborne, isMounted("companion"))
    }
  }, -20)

  return <>
    <group ref={root} name="companion-character" visible={false}>
      {asset && <primitive object={asset.root} dispose={null} />}
    </group>
    <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]} material={shadowMaterial} visible={false}>
      <planeGeometry args={[0.82, 0.62]} />
    </mesh>
  </>
}
