import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"
import { groundShadowTexture } from "../../utils/groundShadow"
import { dampAngle, smoothstep } from "../../utils/math"
import { sfx } from "../audio/audio"
import { footstep } from "../audio/footsteps"
import { heroTrack } from "../vfx/heroRuntime"
import { emitSplash, waterBodyRT } from "../../world/render/waterFx"
import { resolveCollisions } from "../movement"
import { avatarRT, cameraRT, catRT, characterRT, input, playerRT, worldRT } from "../runtime"
import { weatherRT } from "../weather/weatherState"
import { buildColliders, groundHeight, TRAINING } from "../world-layout"
import { type LocomotionTuning } from "./controller/locomotion"
import { avatarFootGround, createAvatarController, stepAvatarController } from "./controller/avatarController"
import { loadExplorer, type HumanAsset } from "./human/humanAsset"
import { HumanAnimator, type ArmGoal, type HumanPoseInput } from "./human/HumanAnimator"
import { applyRiderPose, makeRiderPoseCache } from "../horses/riderPose"
import { applyDragonRiderPose } from "../dragon/dragonRider"
import { applyDeerAffection } from "../deer/affection"
import { isMounted, riderMetrics } from "../horses/riding"
import { applyPoseRequest, togetherRT } from "../together/togetherState"
import { adoptRigMetrics } from "./bodyMetrics"
import { ACCEL_RATE, DECEL_RATE, MOVE_SPEED, RUN_SPEED, TURN_RATE } from "./human/humanLocomotion"

const PLAYER_RADIUS = 0.34
export const HUMAN_TUNING: LocomotionTuning = {
  radius: PLAYER_RADIUS,
  walkSpeed: MOVE_SPEED,
  runSpeed: RUN_SPEED,
  accel: ACCEL_RATE,
  decel: DECEL_RATE,
  turnRate: TURN_RATE,
  // a strong swimmer: a quick crawl, and with Shift a surge through the water
  swimSpeed: 3.4,
  swimSprint: 6.8,
  floatDraft: 1.12,
  swimEnter: 1.25,
  swimExit: 1.02,
}
const { circles, rects } = buildColliders()
const nextPosition = { x: 0, z: 0 }
const handWorld = new THREE.Vector3()
const handLocal = new THREE.Vector3()
const strokeLocal = new THREE.Vector3()
const tailBase = new THREE.Vector3()
const _probe = new THREE.Vector3()

/** Live movement diagnostics for QA and the debug overlay. */
export const explorerMotionRT = { water: "land" as "land" | "wade" | "swim", swim: 0, targetSpeed: 0, forwardAccel: 0, turnRate: 0, modelReady: false, modelSettled: false, kneel: 0, reach: 0, hand: [0, 0, 0], handWorld: [0, 0, 0] }

/**
 * The explorer: the heart of the world.
 *
 * Movement is camera-relative and immediate: a brisk jog by default and a
 * real run with Shift. Velocity eases in/out exponentially (≈0.25 s to full
 * speed, ≈0.2 s to stop) so starts feel snappy but never robotic. The
 * Blender-built rig is animated procedurally by HumanAnimator, whose gait is
 * driven by distance travelled, so stride and speed always match.
 */
export const ExplorerCharacter = (): React.ReactElement => {
  const root = useRef<THREE.Group>(null)
  const shadow = useRef<THREE.Mesh>(null)
  const [asset, setAsset] = useState<HumanAsset | null>(null)
  const [failed, setFailed] = useState(false)
  const animator = useRef<HumanAnimator | null>(null)
  const reachCache = useMemo<{ L: ArmGoal | null; R: ArmGoal | null }>(() => ({ L: null, R: null }), [])
  const rideCache = useMemo(() => makeRiderPoseCache(), [])
  const controller = useMemo(() => createAvatarController(playerRT), [])
  const loco = controller.loco
  const motion = loco.motion
  const greeting = useRef(0)
  const gestureBlend = useRef({ sit: 0, paint: 0, wish: 0, train: 0, pet: 0, kneel: 0, call: 0, whistle: 0, smile: 0, reach: 0 })
  const happyTimer = useRef(7)
  const shadowMat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: groundShadowTexture(), transparent: true, depthWrite: false }),
    [],
  )
  const pose = useMemo<HumanPoseInput>(
    () => ({
      dt: 0, time: 0, speed: 0, turnRate: 0, forwardAccel: 0, groundLeft: 0, groundRight: 0, slope: 0,
      airborne: false, jumpPhase: "grounded", jumpTime: 0, idleTime: 0, petting: 0, petSide: 1, celebrate: 0,
      training: { stance: 0, jab: 0, cross: 0 }, fear: 0, greeting: 0, lookYaw: 0, lookPitch: 0, wind: 0,
      sit: 0, paint: 0, wish: 0, kneel: 0, handTarget: null, handReach: 0, handStrokeDir: null, call: 0, smile: 0,
    }),
    [],
  )

  useEffect(() => {
    let alive = true
    loadExplorer()
      .then((a) => {
        if (!alive) return
        adoptRigMetrics("explorer", a, HUMAN_TUNING)
        animator.current = new HumanAnimator(a)
        riderMetrics.explorer.hips = animator.current.hipsHeight
        explorerMotionRT.modelReady = true
        explorerMotionRT.modelSettled = true
        setAsset(a)
      })
      .catch((error) => {
        console.error("[explorer] character model failed to load; using fallback figure", error)
        if (alive) { explorerMotionRT.modelSettled = true; setFailed(true) }
      })
    return () => {
      alive = false
    }
  }, [])

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const time = state.clock.elapsedTime
    const selected = characterRT.active === "explorer"
    const training = selected && worldRT.performingMemoryId === "training-corner"
    const trainingTime = worldRT.performanceTime - 1.25

    // any discovery gesture ends as soon as the explorer wants to walk again
    if (playerRT.gesture !== "none") {
      playerRT.gestureTime += dt
      const wantsMove = selected && Math.hypot(input.move.x, input.move.y) > 0.1
      const timedOut = (playerRT.gesture === "train" && playerRT.gestureTime > 2.4) || (playerRT.gesture === "cheer" && playerRT.gestureTime > 1.4) ||
        (playerRT.gesture === "pet" && playerRT.gestureTime > (catRT.state === "petted" ? 6.4 : 3.2)) || (playerRT.gesture === "wish" && playerRT.gestureTime > 3.5) ||
        (playerRT.gesture === "call" && playerRT.gestureTime > 1.5) || (playerRT.gesture === "whistle" && playerRT.gestureTime > 2.3)
      if (playerRT.gesture !== "ride" && (timedOut || (wantsMove && playerRT.gestureTime > 0.35))) {
        playerRT.gesture = "none"
        playerRT.paused = false
        playerRT.rideY = null
      }
    }

    if (training && trainingTime < 0) {
      const dx = TRAINING.bagX - playerRT.pos.x
      const dz = TRAINING.bagZ - playerRT.pos.z
      const distance = Math.hypot(dx, dz)
      const step = Math.min(Math.max(0, distance - 0.76), dt * 2.6)
      nextPosition.x = playerRT.pos.x + (dx / Math.max(distance, 0.001)) * step
      nextPosition.z = playerRT.pos.z + (dz / Math.max(distance, 0.001)) * step
      resolveCollisions(nextPosition, PLAYER_RADIUS, circles, rects)
      playerRT.vel.set((nextPosition.x - playerRT.pos.x) / dt, 0, (nextPosition.z - playerRT.pos.z) / dt)
      playerRT.pos.x = nextPosition.x
      playerRT.pos.z = nextPosition.z
      playerRT.speed = playerRT.vel.length()
      playerRT.moving = playerRT.speed > 0.08
    }
    stepAvatarController(playerRT, "explorer", controller, HUMAN_TUNING, dt, worldRT.finaleActive || (training && trainingTime < 0) || playerRT.rideY !== null)
    explorerMotionRT.targetSpeed = controller.targetSpeed
    if (training) {
      playerRT.facing = dampAngle(playerRT.facing, Math.atan2(TRAINING.bagX - playerRT.pos.x, TRAINING.bagZ - playerRT.pos.z), 10, dt)
    }

    // turn rate + forward acceleration feed posture (banking, leaning)
    explorerMotionRT.turnRate = controller.turnRate
    explorerMotionRT.forwardAccel = controller.forwardAccel

    // ground, jump, water
    // in the saddle the rider is above the water, not in it: the mount makes its own
    // splashes, and a rider's swimming wake under it read as drawn white rings
    const riding = playerRT.rideY !== null
    if (selected && loco.landed && !riding) {
      if (loco.water === "land") sfx.thump()
      else emitSplash(playerRT.pos.x, playerRT.pos.z, 1)
    }
    if (selected && !riding && (loco.enteredWater || loco.startedSwimming)) emitSplash(playerRT.pos.x, playerRT.pos.z, loco.startedSwimming ? 0.8 : 0.45)
    if (playerRT.rideY !== null) playerRT.pos.y = playerRT.rideY
    const groundY = loco.support
    playerRT.jumpPhase = motion.phase
    playerRT.jumpHeight = motion.lift
    explorerMotionRT.water = loco.water
    explorerMotionRT.swim = loco.swim
    if (selected) {
      waterBodyRT.surface = riding ? null : loco.waterSurface
      waterBodyRT.swim = riding ? 0 : loco.swim
      waterBodyRT.wade = riding ? 0 : loco.wade
    }

    if (root.current) {
      root.current.visible = (!worldRT.introActive || worldRT.introProgress >= 0.872) && playerRT.pos.distanceToSquared(avatarRT().pos) < 180 * 180
      root.current.position.set(playerRT.pos.x, playerRT.pos.y + loco.stepSmooth, playerRT.pos.z)
      // on a flying mount the body pitches and banks with it
      root.current.rotation.set(-playerRT.ridePitch, playerRT.facing, -playerRT.rideRoll, "YXZ")
    }
    if (!selected && playerRT.pos.distanceToSquared(avatarRT().pos) >= 180 * 180) {
      if (shadow.current) shadow.current.visible = false
      return
    }

    // little idle celebrations
    happyTimer.current -= dt
    if (happyTimer.current <= 0) {
      happyTimer.current = 8 + ((time * 9.7) % 1) * 9
      if (!playerRT.moving && playerRT.idleTime > 3 && playerRT.catReaction < 0.1) playerRT.celebrate = 0.9
    }
    playerRT.celebrate = Math.max(0, playerRT.celebrate - dt)

    // terrain under each foot (lateral) and slope along facing
    const sinF = Math.sin(playerRT.facing)
    const cosF = Math.cos(playerRT.facing)
    const lateral = 0.1
    // the body's left (+x in model space) maps to world (cosF, -sinF)
    const gl = avatarFootGround(playerRT, controller, playerRT.pos.x + cosF * lateral, playerRT.pos.z - sinF * lateral)
    const gr = avatarFootGround(playerRT, controller, playerRT.pos.x - cosF * lateral, playerRT.pos.z + sinF * lateral)
    const ahead = groundHeight(playerRT.pos.x + sinF * 0.35, playerRT.pos.z + cosF * 0.35)
    const behind = groundHeight(playerRT.pos.x - sinF * 0.35, playerRT.pos.z - cosF * 0.35)
    const slope = (ahead - behind) / 0.7

    // gaze: glance at the cat when it's close and the explorer is idle, and turn to
    // her whenever she speaks up, weaves round the explorer's legs or is being petted
    let lookYaw = 0
    let lookPitch = 0
    const cdx = catRT.pos.x - playerRT.pos.x
    const cdz = catRT.pos.z - playerRT.pos.z
    const catDist = Math.hypot(cdx, cdz)
    const heardHer = time - catRT.vocalTime < 2.2 && catRT.vocal !== "" && catDist < 14
    const withHer = catDist < 2.2 && (catRT.state === "rub" || catRT.state === "greet" || catRT.state === "petted" || catRT.state === "affection")
    const attend = heardHer || withHer
    if ((catDist < 4 && !playerRT.moving) || attend) {
      let rel = Math.atan2(cdx, cdz) - playerRT.facing
      rel = Math.atan2(Math.sin(rel), Math.cos(rel))
      if (Math.abs(rel) < (attend ? 2.2 : 1.6)) lookYaw = THREE.MathUtils.clamp(rel * (attend ? 0.8 : 0.6), -1, 1)
      // eyes down to where she is (head height ≈ 1.25 m above the ground)
      if (attend) lookPitch = THREE.MathUtils.clamp(Math.atan2(1.2 - (catRT.headWorld.y - groundY), Math.max(0.3, catDist)) * 0.7, 0, 0.75)
    }

    const introGreeting = worldRT.introActive
      ? smoothstep(0.928, 0.958, worldRT.introProgress) * (1 - smoothstep(0.978, 1, worldRT.introProgress))
      : 0
    greeting.current = THREE.MathUtils.damp(greeting.current, introGreeting, 6, dt)
    const g = playerRT.gesture
    const gt = playerRT.gestureTime
    const gb = gestureBlend.current
    gb.sit = THREE.MathUtils.damp(gb.sit, g === "sit" || g === "ride" ? 1 : 0, 5, dt)
    gb.paint = THREE.MathUtils.damp(gb.paint, g === "paint" ? 1 : 0, 6, dt)
    gb.wish = THREE.MathUtils.damp(gb.wish, g === "wish" ? 1 : 0, 6, dt)
    gb.pet = THREE.MathUtils.damp(gb.pet, g === "pet" ? 1 : 0, 6, dt)
    // kneel beside her to stroke her, or when she comes asking for affection
    // a hug, high five or dance the player asked for comes first; the cat's
    // own request for affection waits until it is over
    const catAffection = togetherRT.action === "none" ? playerRT.catReaction : 0
    const kneelWanted = (g === "pet" && catRT.state === "petted") || (catAffection > 0.05 && catDist < 1.4)
    gb.kneel = THREE.MathUtils.damp(gb.kneel, kneelWanted ? 1 : 0, kneelWanted ? 4 : 5, dt)
    gb.call = THREE.MathUtils.damp(gb.call, g === "call" && gt < 1.25 ? 1 : 0, 9, dt)
    gb.whistle = g === "whistle" && gt < 2.1 ? 1 : 0
    gb.smile = THREE.MathUtils.damp(gb.smile, attend ? 1 : 0, 3, dt)
    // free training at a discovered post reuses the training corner choreography
    const freeTrain = g === "train" ? gt - 0.1 : -10
    const trainClock = training ? trainingTime : freeTrain
    const trainingOn = training || g === "train"
    const stance = trainingOn ? smoothstep(0, 0.22, trainClock) * (1 - smoothstep(1.55, 2.05, trainClock)) : 0
    if (g === "cheer" && gt < 0.05) playerRT.celebrate = 1.2

    pose.dt = Math.min(rawDt, 1 / 20) // the animator is tuned and tested down to 20 Hz
    pose.time = time
    pose.speed = playerRT.speed
    pose.turnRate = explorerMotionRT.turnRate
    pose.forwardAccel = controller.forwardAccel
    pose.groundLeft = gl
    pose.groundRight = gr
    pose.slope = THREE.MathUtils.clamp(slope, -0.8, 0.8)
    pose.airborne = loco.water !== "swim" && (motion.phase === "rising" || motion.phase === "falling")
    pose.swim = loco.swim
    pose.wade = loco.water === "land" ? 0 : loco.wade
    pose.swimSpeed = loco.water === "swim" ? playerRT.speed : 0
    pose.jumpPhase = motion.phase
    pose.jumpTime = motion.time
    pose.idleTime = playerRT.idleTime
    pose.petting = Math.max(catAffection, gb.pet)
    pose.petSide = catRT.affectionSide || 1
    pose.celebrate = playerRT.celebrate
    pose.training.stance = stance
    pose.training.jab = Math.exp(-(((trainClock - 0.5) / 0.12) ** 2)) * stance
    pose.training.cross = Math.exp(-(((trainClock - 0.93) / 0.13) ** 2)) * stance
    pose.sit = gb.sit
    pose.paint = gb.paint
    pose.wish = gb.wish
    pose.fear = playerRT.frightened
    pose.greeting = greeting.current
    pose.lookYaw = lookYaw
    pose.lookPitch = lookPitch * (1 - gb.kneel * 0.5)
    pose.kneel = gb.kneel
    pose.call = gb.call
    pose.whistle = gb.whistle
    pose.whistleT = g === "whistle" ? gt : 0
    pose.smile = gb.smile
    // the stroking hand: head → base of the tail on her back, lifting back
    // through the air between strokes
    const reachWanted = gb.kneel > 0.55 && catDist < 1.3 && asset !== null
    gb.reach = THREE.MathUtils.damp(gb.reach, reachWanted ? 1 : 0, 6, dt)
    pose.handReach = gb.reach
    explorerMotionRT.kneel = gb.kneel
    explorerMotionRT.reach = gb.reach
    if (gb.reach > 0.01 && asset) {
      tailBase.copy(catRT.backWorld).sub(catRT.headWorld).multiplyScalar(0.9).add(catRT.backWorld)
      if (catRT.state === "petted") {
        const u = catRT.stroke
        const p = u < 0.75 ? u / 0.75 : 1 - (u - 0.75) / 0.25
        const lift = u < 0.75 ? 0 : Math.sin(((u - 0.75) / 0.25) * Math.PI) * 0.07
        handWorld.lerpVectors(catRT.headWorld, tailBase, p)
        handWorld.y += THREE.MathUtils.lerp(0.045, 0.062, p) + lift
      } else {
        // she nuzzles into a still hand: a gentle scratch behind the ears
        handWorld.copy(catRT.headWorld)
        handWorld.y += 0.05
        handWorld.addScaledVector(_probe.copy(tailBase).sub(catRT.headWorld).normalize(), Math.sin(time * 4) * 0.012)
      }
      asset.root.updateWorldMatrix(true, false)
      handLocal.copy(handWorld)
      asset.root.worldToLocal(handLocal)
      strokeLocal.copy(tailBase).sub(catRT.headWorld).add(handWorld)
      asset.root.worldToLocal(strokeLocal)
      strokeLocal.sub(handLocal)
      pose.handTarget = handLocal
      explorerMotionRT.hand = handLocal.toArray()
      explorerMotionRT.handWorld = handWorld.toArray()
      pose.handStrokeDir = strokeLocal
    } else {
      pose.handTarget = null
      pose.handStrokeDir = null
    }
    pose.wind = weatherRT.wind + weatherRT.gust
    const anim = animator.current
    if (anim) {
      if (asset) applyPoseRequest("explorer", asset.root, pose, reachCache)
      if (asset) applyRiderPose("explorer", asset.root, pose, rideCache, time)
      if (asset) applyDragonRiderPose("explorer", asset.root, pose)
      if (asset && !isMounted("explorer")) applyDeerAffection("explorer", asset.root, pose, dt)
      anim.update(pose)
      if (selected && anim.stepped && !pose.airborne && !isMounted("explorer")) footstep(playerRT, explorerMotionRT.water !== "land")
      // what steps, jumps, rain and breath do to the world around the explorer (vfx/HeroFX.tsx)
      heroTrack("explorer", asset?.bones ?? null, playerRT, explorerMotionRT.water, anim.stepped && !pose.airborne, isMounted("explorer"))
    }

    if (shadow.current) {
      shadow.current.visible = cameraRT.distance > 1.65 && (!worldRT.introActive || worldRT.introProgress >= 0.872) && loco.water === "land"
      shadow.current.position.set(playerRT.pos.x, groundY + 0.02, playerRT.pos.z)
      const lift = Math.min(0.5, motion.lift * 0.45)
      shadow.current.scale.setScalar(1 - lift)
      shadowMat.opacity = 0.7 - lift
    }
  }, -20)

  return (
    <>
      <mesh ref={shadow} rotation-x={-Math.PI / 2} material={shadowMat} renderOrder={1}>
        <planeGeometry args={[0.8, 0.62]} />
      </mesh>
      <group ref={root} name="explorer">
        {asset && <primitive object={asset.root} />}
        {failed && <FallbackFigure />}
      </group>
    </>
  )
}

/** Shown only if the rig cannot load: a soft, recognisable stand-in in the character's colours. */
const FallbackFigure = (): React.ReactElement => (
  <group>
    <mesh position={[0, 0.42, 0]} castShadow>
      <capsuleGeometry args={[0.13, 0.42, 6, 14]} />
      <meshStandardMaterial color="#4f6688" />
    </mesh>
    <mesh position={[0, 0.88, 0]} castShadow>
      <capsuleGeometry args={[0.18, 0.28, 6, 14]} />
      <meshStandardMaterial color="#b49ad0" />
    </mesh>
    <mesh position={[0, 1.27, 0]} castShadow>
      <sphereGeometry args={[0.16, 24, 18]} />
      <meshStandardMaterial color="#9b5d55" />
    </mesh>
  </group>
)
