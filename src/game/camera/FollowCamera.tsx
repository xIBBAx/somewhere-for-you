import { debugEnabled } from "../../dev/debugFlag"
import { mountContactRT } from "../horses/horseMotion"
import { flightContactRT } from "../pegasus/flight"
import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useRef } from "react"
import * as THREE from "three"
import { clamp, damp, dampAngle, smoothstep } from "../../utils/math"
import { avatarRT, cameraRT, characterRT, takeAction, worldRT } from "../runtime"
import { CAMERA_VIEWS, framingAt, nextView, saveView, viewRT } from "./cameraViews"
import { useGame } from "../../state/gameStore"
import { buildColliders, groundHeight } from "../world-layout"
import { MOVE_SPEED } from "../characters/human/humanLocomotion"
import { lookAtLogical } from "../../world/render/WorldRoot"
import { SITE_POLYGONS } from "../../world/sites/sites"
import { findCameraPitch, limitCameraDistance } from "./cameraCollision"
import { waterSurfaceAt } from "../../world/waterSurface"
import { nearbyWorldColliders } from "../../world/colliders"
import type { CircleCollider } from "../world-layout"
import { bindMouseControls } from "../controls/mouseControls"
import { subscribeInputReset } from "../input"
import { useExplorationUI } from "../../state/explorationUIStore"
import { dragonRT } from "../dragon/dragonState"

const dragonView = new THREE.Vector3()
const dragonRight = new THREE.Vector3()

/** How far (rad) the view may tilt up on its own to see over a low roof. */
const MAX_OBSTRUCTION_LIFT = 0.4

export const CAMERA_CONFIG = {
  mouseSensitivity: 0.0024,
  minPitch: -1.15,
  maxPitch: 1.25,
  // the views (cameraViews.ts) run 1.9 to 8.4 m; by hand a little nearer, or out to a wide 14 m
  minDistance: 1.6,
  maxDistance: 14,
  // Medium, the everyday view
  defaultDistance: 5.6,
  zoomSensitivity: 0.006,
  collisionRadius: 0.32,
} as const

type CinematicKey = {
  at: number
  position: [number, number, number]
  target: [number, number, number]
  fov: number
}

const CINEMATIC_KEYS: CinematicKey[] = [
  { at: 0, position: [0, 58.5, 137], target: [0, 58, 92], fov: 39 },
  { at: 0.1, position: [0.8, 59, 134.5], target: [0, 58, 92], fov: 39 },
  { at: 0.22, position: [2.7, 59.8, 123], target: [0.2, 58, 92], fov: 40 },
  // the globe has turned home to face the lens (0, 58, 101): dive on it
  { at: 0.35, position: [1.2, 59.4, 110.5], target: [0, 58.1, 101], fov: 42 },
  { at: 0.43, position: [0.3, 58.5, 104.4], target: [0, 57.8, 100.4], fov: 46 },
  // The cloud wall is fully opaque across this deliberate scale bridge.
  { at: 0.49, position: [0, 58.15, 101.9], target: [0, 57.6, 98.5], fov: 50 },
  { at: 0.515, position: [12, 45, 2], target: [0, 29, 20], fov: 50 },
  { at: 0.59, position: [12, 33, 4], target: [0, 22, 24], fov: 47 },
  { at: 0.68, position: [8.5, 22, 7], target: [-1, 5, 25], fov: 44 },
  { at: 0.76, position: [-5.5, 13.5, 10], target: [-1.2, 3.1, 25], fov: 42 },
  { at: 0.83, position: [3.8, 6.8, 15.5], target: [0.8, 2.3, 24], fov: 40 },
  { at: 0.88, position: [2.8, 1.45, 20.2], target: [1.25, 0.3, 22.9], fov: 38 },
  { at: 0.915, position: [0.65, 0.78, 20.45], target: [0, 0.22, 22.5], fov: 36 },
  { at: 0.95, position: [0.55, 1.72, 20.18], target: [0, 1.05, 22.5], fov: 36 },
  { at: 1, position: [0, 8.54, 11.78], target: [0, 1.03, 22.5], fov: 40 },
]

const REDUCED_CINEMATIC_KEYS: CinematicKey[] = [
  { at: 0, position: [0, 58.5, 137], target: [0, 58, 92], fov: 39 },
  { at: 0.31, position: [1.5, 59, 122], target: [0, 58, 92], fov: 40 },
  { at: 0.48, position: [0, 58.3, 103.5], target: [0, 57.8, 99], fov: 44 },
  { at: 0.52, position: [10, 29, 4], target: [0, 20, 24], fov: 43 },
  { at: 0.73, position: [4, 15, 9], target: [0, 3.4, 24], fov: 41 },
  { at: 0.88, position: [1.1, 3.4, 18], target: [0, 0.9, 22.5], fov: 39 },
  { at: 1, position: [0, 8.54, 11.78], target: [0, 1.03, 22.5], fov: 40 },
]

const { circles, rects } = buildColliders()
const desired = new THREE.Vector3()
const lookTarget = new THREE.Vector3()
const cinematicPositionB = new THREE.Vector3()
const cinematicTargetB = new THREE.Vector3()

const normalizeAngle = (angle: number): number =>
  THREE.MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI

/**
 * Desktop third-person camera: drag or pointer-lock orbit, wheel zoom, predictive
 * follow and a collision-limited boom that recovers smoothly after obstacles.
 */
const sampleCinematic = (
  keys: CinematicKey[],
  progress: number,
  outPosition: THREE.Vector3,
  outTarget: THREE.Vector3,
): number => {
  let index = 0
  while (index < keys.length - 2 && progress > keys[index + 1].at) index++
  const a = keys[index]
  const b = keys[index + 1]
  const t = smoothstep(a.at, b.at, progress)
  outPosition.set(...a.position).lerp(cinematicPositionB.set(...b.position), t)
  outTarget.set(...a.target).lerp(cinematicTargetB.set(...b.target), t)
  return THREE.MathUtils.lerp(a.fov, b.fov, t)
}

export const FollowCamera = ({ cinematic }: { cinematic: boolean }): React.ReactElement => {
  const { camera, gl } = useThree()
  const inspectionAllowed = debugEnabled()
  const look = useRef(new THREE.Vector3(0, 1.15, 22.5))
  const joltT = useRef(0)
  const smoothAnchor = useRef(new THREE.Vector3(0, 1.15, 22.5))
  const smoothLead = useRef(new THREE.Vector2(0, 0))
  /** where the body was last frame, for its true speed (riding or flying, body.speed is the walk's) */
  const lastBody = useRef(new THREE.Vector3(Number.NaN, 0, 0))
  const obstructionLift = useRef(0)
  const obstructionTurn = useRef(0)
  const localColliders = useRef<CircleCollider[]>([])
  const colliderTime = useRef(0)
  const canopy = useRef(0)
  const characterVersion = useRef(characterRT.version)
  const mouseControls = useRef<ReturnType<typeof bindMouseControls> | null>(null)
  const inputContext = useRef("")
  const introOrbit = useRef({ yaw: 0, pitch: 0, zoom: 1, targetYaw: 0, targetPitch: 0, targetZoom: 1 })
  const introOffset = useRef(new THREE.Spherical())

  useEffect(() => {
    const canvas = gl.domElement

    let dragging = false
    const onPointerDown = (event: PointerEvent): void => {
      if (event.pointerType !== "mouse" && cameraRT.photo) {
        dragging = true
        canvas.setPointerCapture?.(event.pointerId)
        return
      }
    }
    const onPointerUp = (): void => { dragging = false }
    const onPointerMove = (event: PointerEvent): void => {
      if (event.pointerType === "mouse" || !cameraRT.photo || !dragging) return
      cameraRT.targetYaw = normalizeAngle(cameraRT.targetYaw - event.movementX * CAMERA_CONFIG.mouseSensitivity * 1.6)
      cameraRT.lastLook = performance.now()
      cameraRT.userHold = true
      cameraRT.targetPitch = clamp(cameraRT.targetPitch + event.movementY * CAMERA_CONFIG.mouseSensitivity * 1.6, -0.35, CAMERA_CONFIG.maxPitch)
    }
    const mouse = bindMouseControls(canvas, {
      mode: () => {
        if (worldRT.finaleActive || useExplorationUI.getState().panel || document.querySelector('[role="dialog"][aria-modal="true"]')) return "blocked"
        if (worldRT.introActive) return "intro"
        if (cameraRT.photo) return "photo"
        return avatarRT().paused ? "blocked" : "play"
      },
      look: (dx, dy, mode) => {
        if (mode === "intro") {
          const orbit = introOrbit.current
          orbit.targetYaw = clamp(orbit.targetYaw - dx * CAMERA_CONFIG.mouseSensitivity, -0.65, 0.65)
          orbit.targetPitch = clamp(orbit.targetPitch + dy * CAMERA_CONFIG.mouseSensitivity, -0.3, 0.3)
          return
        }
        const sensitivity = CAMERA_CONFIG.mouseSensitivity * (mode === "photo" ? 1.6 : 1)
        cameraRT.lastLook = performance.now()
        cameraRT.targetYaw = normalizeAngle(cameraRT.targetYaw - dx * sensitivity)
        cameraRT.targetPitch = clamp(cameraRT.targetPitch + dy * sensitivity, mode === "photo" ? -0.35 : CAMERA_CONFIG.minPitch, CAMERA_CONFIG.maxPitch)
        if (Math.abs(dx) + Math.abs(dy) > 0) { cameraRT.hasLooked = true; cameraRT.userHold = true }
      },
      zoom: (pixels, mode) => {
        if (mode === "intro") {
          const orbit = introOrbit.current
          orbit.targetZoom = clamp(orbit.targetZoom * Math.exp(pixels * 0.0016), 0.85, 1.4)
        } else cameraRT.targetDistance = clamp(cameraRT.targetDistance + pixels * CAMERA_CONFIG.zoomSensitivity, CAMERA_CONFIG.minDistance, CAMERA_CONFIG.maxDistance)
      },
      locked: (locked) => { cameraRT.pointerLocked = locked },
    })
    mouseControls.current = mouse
    const unsubscribe = subscribeInputReset(mouse.reset)

    canvas.addEventListener("pointerdown", onPointerDown)
    canvas.addEventListener("pointermove", onPointerMove)
    canvas.addEventListener("pointerup", onPointerUp)
    canvas.addEventListener("pointercancel", onPointerUp)
    return () => {
      unsubscribe()
      mouse.dispose()
      mouseControls.current = null
      canvas.removeEventListener("pointerdown", onPointerDown)
      canvas.removeEventListener("pointermove", onPointerMove)
      canvas.removeEventListener("pointerup", onPointerUp)
      canvas.removeEventListener("pointercancel", onPointerUp)
    }
  }, [gl])

  useFrame((_, rawDt) => {
    // same step clamp as the characters, so the boom never lags them on hitches
    const dt = Math.min(Math.max(rawDt, 1e-4), 1 / 20)
    // the camera follows whoever is being controlled
    const body = avatarRT()
    const context = `${cinematic}:${body.paused}:${cameraRT.photo}:${worldRT.finaleActive}`
    if (inputContext.current !== context) {
      mouseControls.current?.reset()
      inputContext.current = context
    }
    const snapping = worldRT.snapCamera
    if (characterVersion.current !== characterRT.version) {
      characterVersion.current = characterRT.version
      colliderTime.current = 0
    }
    const p = body.pos
    const inspection = worldRT.inspectionCamera
    if (inspectionAllowed && inspection.active) {
      if (inspection.follow) {
        // offsets in the explorer's local frame (x = left, z = forward), for motion QA
        const s = Math.sin(body.facing)
        const c = Math.cos(body.facing)
        const ground = p.y - body.jumpHeight
        camera.position.set(p.x + inspection.px * c + inspection.pz * s, ground + inspection.py, p.z - inspection.px * s + inspection.pz * c)
        lookAtLogical(camera, p.x + inspection.tx * c + inspection.tz * s, ground + inspection.ty, p.z - inspection.tx * s + inspection.tz * c)
        return
      }
      camera.position.set(inspection.px, inspection.py, inspection.pz)
      lookAtLogical(camera, inspection.tx, inspection.ty, inspection.tz)
      return
    }

    if (
      (body.paused || worldRT.finaleActive || cinematic) &&
      document.pointerLockElement === gl.domElement
    ) {
      document.exitPointerLock()
    }

    if (cinematic) {
      const perspective = camera as THREE.PerspectiveCamera
      const keys = worldRT.introReducedMotion ? REDUCED_CINEMATIC_KEYS : CINEMATIC_KEYS
      const wantedFov = sampleCinematic(
        keys,
        clamp(worldRT.introProgress, 0, 1),
        desired,
        lookTarget,
      )
      // A bounded orbit around the film's subject, easing home for its final handoff.
      const orbit = introOrbit.current
      orbit.yaw = damp(orbit.yaw, orbit.targetYaw, 14, dt)
      orbit.pitch = damp(orbit.pitch, orbit.targetPitch, 14, dt)
      orbit.zoom = damp(orbit.zoom, orbit.targetZoom, 14, dt)
      const weight = 1 - smoothstep(0.9, 1, worldRT.introProgress)
      const offset = introOffset.current.setFromVector3(desired.sub(lookTarget))
      offset.theta += orbit.yaw * weight
      offset.phi = clamp(offset.phi - orbit.pitch * weight, 0.08, Math.PI - 0.08)
      offset.radius *= 1 + (orbit.zoom - 1) * weight
      desired.setFromSpherical(offset).add(lookTarget)
      camera.position.copy(desired)
      look.current.copy(lookTarget)
      camera.up.set(0, 1, 0)
      lookAtLogical(camera, look.current.x, look.current.y, look.current.z)
      if (Math.abs(perspective.fov - wantedFov) > 0.01) {
        perspective.fov = wantedFov
        perspective.updateProjectionMatrix()
      }
      return
    }

    // on the dragon's neck: her chase camera (game/dragon/Dragon.tsx)
    const dragonCam = dragonRT.camera
    if (dragonCam.active && !cameraRT.photo) {
      const perspective = camera as THREE.PerspectiveCamera
      camera.position.set(dragonCam.px, dragonCam.py, dragonCam.pz)
      look.current.set(dragonCam.tx, dragonCam.ty, dragonCam.tz)
      // a touch of her bank in the horizon: up turned about the line of sight
      dragonView.copy(look.current).sub(camera.position).normalize()
      dragonRight.crossVectors(dragonView, camera.up.set(0, 1, 0)).normalize()
      camera.up.crossVectors(dragonRight, dragonView).multiplyScalar(Math.cos(dragonCam.roll)).addScaledVector(dragonRight, Math.sin(dragonCam.roll)).normalize()
      lookAtLogical(camera, look.current.x, look.current.y, look.current.z)
      camera.up.set(0, 1, 0)
      if (Math.abs(perspective.fov - dragonCam.fov) > 0.02) {
        perspective.fov = damp(perspective.fov, dragonCam.fov, 4, dt)
        perspective.updateProjectionMatrix()
      }
      cameraRT.distance = cameraRT.collisionDistance = cameraRT.targetDistance
      return
    }

    if (worldRT.finaleActive) {
      const fc = worldRT.finaleCam
      const visualDt = Math.min(Math.max(rawDt, 1e-4), 0.25)
      camera.position.lerp(desired.set(fc.px, fc.py, fc.pz), 1 - Math.exp(-2.2 * visualDt))
      look.current.lerp(lookTarget.set(fc.tx, fc.ty, fc.tz), 1 - Math.exp(-2.5 * visualDt))
      camera.up.set(0, 1, 0)
      lookAtLogical(camera, look.current.x, look.current.y, look.current.z)
      return
    }

    // ---- the view (Far, Medium, Close): Tab, or the camera button on touch screens
    const step = takeAction("cameraView") ? 1 : takeAction("cameraViewBack") ? -1 : 0
    if (step !== 0 && !cameraRT.photo) {
      const v = nextView(cameraRT.targetDistance, step)
      viewRT.view = v
      cameraRT.targetDistance = CAMERA_VIEWS[v].distance
      saveView(v)
      useGame.getState().showHint(`Camera: ${CAMERA_VIEWS[v].label}`)
    }
    // the framing follows the boom's chosen length (not one a wall has cut short)
    viewRT.framing = damp(viewRT.framing, cameraRT.targetDistance, 5, dt)
    const framing = framingAt(viewRT.framing)
    // on a mount or on the wing the riders and the span stay centred
    const centred = clamp(Math.max(cameraRT.mountedDistance / 2.4, cameraRT.flightDistance / 3), 0, 1)

    // Dynamic traversal speed ratio (0 at rest, 1 at full traversal pace)
    const speedRatio = clamp(body.speed / MOVE_SPEED, 0, 1.6)

    // Dynamic FOV (subtle expansion while in motion)
    const perspective = camera as THREE.PerspectiveCamera
    // a wider view sells speed (strongest single cue): riding adds up to ~7°
    const wantedFov = framing.fov + speedRatio * 1.5 + cameraRT.fovBoost
    if (Math.abs(perspective.fov - wantedFov) > 0.02) {
      perspective.fov = damp(perspective.fov, wantedFov, 6.0, dt)
      perspective.updateProjectionMatrix()
    }

    // 1) Smooth Anchor Tracking (Decoupled vertical damping filters terrain roughness)
    let rigid = 0
    const targetAnchorY = p.y - body.jumpHeight * 0.65 + 1.15 + framing.pivot * (1 - centred * 0.6) + cameraRT.mountedLift + cameraRT.flightLift + cameraRT.fovBoost * 0.05
    if (snapping) {
      smoothAnchor.current.set(p.x, targetAnchorY, p.z)
      smoothLead.current.set(0, 0)
      colliderTime.current = 0
    } else {
      // a damped anchor trails by speed / rate: right on foot and in the
      // saddle, but under Starborn's sail (a kilometre a second) it left the view
      // a hundred metres below her and she flew out of the frame. Past 25 m/s
      // the rate rises with speed, so the lag stays under ~0.5 m however fast
      // (a chase camera at speed is held to what it chases).
      const moved = Number.isFinite(lastBody.current.x) ? lastBody.current.distanceTo(p) / dt : 0
      rigid = Math.max(0, moved - 25) / 0.4
      smoothAnchor.current.x = damp(smoothAnchor.current.x, p.x, Math.max(15, rigid), dt)
      smoothAnchor.current.y = damp(smoothAnchor.current.y, targetAnchorY, Math.max(8.5, rigid), dt)
      smoothAnchor.current.z = damp(smoothAnchor.current.z, p.z, Math.max(15, rigid), dt)
    }
    lastBody.current.copy(p)

    // 2) Velocity Lead (Predictive look-ahead that smoothly glides to rest on stops)
    const targetLeadX = clamp(body.vel.x * 0.22, -1.2, 1.2)
    const targetLeadZ = clamp(body.vel.z * 0.22, -1.2, 1.2)
    smoothLead.current.x = damp(smoothLead.current.x, targetLeadX, 4.5, dt)
    smoothLead.current.y = damp(smoothLead.current.y, targetLeadZ, 4.5, dt)

    // Dynamic follow distance (slightly expanded during sprint)
    // (in proportion: a close view stays close at a run)
    const sprintPull = speedRatio * 0.55 * Math.min(1, viewRT.framing / CAMERA_VIEWS.medium.distance)
    const preferredDistance = (worldRT.focus.active ? worldRT.focus.distance : null) ?? (cameraRT.targetDistance + sprintPull + (cameraRT.mountedDistance + cameraRT.flightDistance) * framing.extra)

    // Orbit Angles
    const focusYaw = worldRT.focus.active ? worldRT.focus.yaw : null
    const focusPitch = worldRT.focus.active ? worldRT.focus.pitch : null
    cameraRT.yaw = dampAngle(cameraRT.yaw, focusYaw ?? cameraRT.targetYaw, focusYaw === null ? 18 : 3.5, dt)
    cameraRT.pitch = damp(cameraRT.pitch, focusPitch ?? cameraRT.targetPitch, focusPitch === null ? 18 : 3.5, dt)

    if (worldRT.focus.active) {
      const mx = (p.x + worldRT.focus.x) * 0.5
      const mz = (p.z + worldRT.focus.z) * 0.5
      lookTarget.set(mx, p.y + 1.05, mz)
    } else {
      lookTarget.set(
        smoothAnchor.current.x + smoothLead.current.x,
        smoothAnchor.current.y,
        smoothAnchor.current.z + smoothLead.current.y,
      )
      const pitchLift = Math.max(0, -cameraRT.pitch) * 0.55
      lookTarget.y += pitchLift
    }

    if (snapping) {
      look.current.copy(lookTarget)
      // a teleport starts with a full boom, not one collapsed by the old spot
      cameraRT.distance = cameraRT.targetDistance
      obstructionLift.current = 0
      obstructionTurn.current = 0
      canopy.current = 0
    } else {
      look.current.x = damp(look.current.x, lookTarget.x, Math.max(14, rigid), dt)
      look.current.y = damp(look.current.y, lookTarget.y, Math.max(14, rigid), dt)
      look.current.z = damp(look.current.z, lookTarget.z, Math.max(14, rigid), dt)
    }

    colliderTime.current -= dt
    if (colliderTime.current <= 0 || snapping) {
      colliderTime.current = 0.15
      const list = localColliders.current
      list.length = 0
      for (const c of circles) if (Math.abs(c.x - p.x) < 28 && Math.abs(c.z - p.z) < 28) list.push(c)
      for (const c of nearbyWorldColliders) list.push(c)
    }
    const cameraCircles = localColliders.current

    // Under a canopy the boom drops below the crowns and shortens, so forests
    // are seen from inside rather than through a wall of leaves.
    // Crowns overhead are measured around the boom's ideal position, so a
    // single tree beside the explorer does not pin the camera low in open ground.
    let canopyNow = 0
    // high in the air (flying) there is no canopy over the boom
    const aloft = p.y - groundHeight(p.x, p.z) > 6
    const idealX = look.current.x + Math.sin(cameraRT.yaw) * Math.cos(cameraRT.pitch) * preferredDistance
    const idealZ = look.current.z + Math.cos(cameraRT.yaw) * Math.cos(cameraRT.pitch) * preferredDistance
    if (!aloft) for (const c of cameraCircles) {
      if ((c.height ?? 0) < 2.5) continue
      canopyNow += (1 - smoothstep(2.4, 6.5, Math.hypot(c.x - idealX, c.z - idealZ))) * 0.55
    }
    canopy.current = damp(canopy.current, clamp(canopyNow, 0, 1), canopyNow > canopy.current ? 2.5 : 1.6, dt)
    cameraRT.canopy = canopy.current
    const underCanopy = worldRT.focus.active ? 0 : canopy.current * 0.9
    const basePitch = THREE.MathUtils.lerp(cameraRT.pitch, Math.min(cameraRT.pitch, 0.2), underCanopy)
    const boomDistance = THREE.MathUtils.lerp(preferredDistance, Math.min(preferredDistance, 6.6), underCanopy)

    // The player owns the orbit: the camera never swings sideways on its own
    // (that read as "wrong panning"). Obstructions are handled by a modest,
    // bounded lift over low roofs plus the distance solver below.
    const clearPitch = findCameraPitch(
      look.current, cameraRT.yaw, basePitch, boomDistance, 5.2,
      CAMERA_CONFIG.collisionRadius, cameraCircles, rects, groundHeight, SITE_POLYGONS,
    )
    obstructionTurn.current = 0
    cameraRT.viewYaw = cameraRT.yaw
    const liftTarget = clamp(clearPitch - basePitch, 0, MAX_OBSTRUCTION_LIFT)
    obstructionLift.current = damp(
      obstructionLift.current, liftTarget,
      liftTarget > obstructionLift.current ? 6 : 4, dt,
    )
    const viewPitch = Math.min(CAMERA_CONFIG.maxPitch, basePitch + obstructionLift.current)
    const horizontal = Math.cos(viewPitch)
    const vertical = Math.sin(viewPitch)

    // Desired ideal camera point
    desired.set(
      look.current.x + Math.sin(cameraRT.viewYaw) * horizontal * boomDistance,
      look.current.y + vertical * boomDistance,
      look.current.z + Math.cos(cameraRT.viewYaw) * horizontal * boomDistance,
    )

    // 3) Smooth Obstruction / Collision Detection with Hysteresis
    const safeDistance = limitCameraDistance(
      look.current,
      desired,
      CAMERA_CONFIG.collisionRadius,
      cameraCircles,
      rects,
      groundHeight,
      SITE_POLYGONS,
    )
    cameraRT.collisionDistance = safeDistance

    // Fast push-in when avoiding obstacle, smooth relaxed recovery outward
    const recoveryRate = safeDistance < cameraRT.distance ? 26 : 4.8
    cameraRT.distance = snapping ? safeDistance : damp(cameraRT.distance, safeDistance, recoveryRate, dt)

    // Final camera positioning with terrain floor clearance
    const finalX = look.current.x + Math.sin(cameraRT.viewYaw) * horizontal * cameraRT.distance
    let finalY = look.current.y + vertical * cameraRT.distance
    const finalZ = look.current.z + Math.cos(cameraRT.viewYaw) * horizontal * cameraRT.distance

    // never below the ground, and never under a lake's surface
    const minGroundY = Math.max(groundHeight(finalX, finalZ), waterSurfaceAt(finalX, finalZ) ?? -Infinity) + 0.42
    if (finalY < minGroundY) {
      finalY = minGroundY
    }

    // over the shoulder: camera and aim both a little to the right, so the
    // figure stands just left of centre with the way ahead open beside it;
    // none on a mount or the wing, under trees, or when a wall has pulled the boom in
    const room = clamp(cameraRT.distance / Math.max(0.1, boomDistance), 0, 1)
    const shoulder = framing.shoulder * (1 - centred) * (1 - underCanopy) * room * room
    const sx = Math.cos(cameraRT.viewYaw) * shoulder
    const sz = -Math.sin(cameraRT.viewYaw) * shoulder

    // riding: a gentle stride-synced lift of the whole view, never a shake;
    // a knock (the mount into something solid, a wing brushing a crown) is one
    // damped dip and recovery, felt rather than seen
    const jolt = Math.max(mountContactRT.jolt, flightContactRT.jolt)
    if (jolt > 0) {
      joltT.current += dt
      mountContactRT.jolt = Math.max(0, mountContactRT.jolt - dt * 2.2)
      flightContactRT.jolt = Math.max(0, flightContactRT.jolt - dt * 2.2)
    } else joltT.current = 0
    const dip = jolt * 0.22 * Math.sin(Math.min(Math.PI, joltT.current * 9))
    camera.position.set(finalX + sx, finalY + cameraRT.speedBob - dip, finalZ + sz)
    camera.up.set(0, 1, 0)
    // a tall mount (a horse, a Pegasus) is framed whole: the aim, not the camera,
    // drops a little toward the animal under the riders (less once airborne)
    const aimDrop = clamp(cameraRT.mountedDistance / 2.4, 0, 1) * (1.1 - 0.6 * clamp(cameraRT.flightDistance / 3, 0, 1))
    lookAtLogical(camera, look.current.x + sx, look.current.y + cameraRT.speedBob * 0.6 - aimDrop, look.current.z + sz)
    if (cameraRT.speedRoll !== 0) camera.rotateZ(cameraRT.speedRoll)
    worldRT.snapCamera = false
  })

  return <></>
}
