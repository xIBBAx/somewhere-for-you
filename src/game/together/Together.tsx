import { useFrame, useThree } from "@react-three/fiber"
import { sameWorld } from "../../world/realmHook"
import { originRT } from "../../world/origin"
import * as THREE from "three"
import { useGame } from "../../state/gameStore"
import { companionUnlocked } from "../../state/storyProgress"
import { aiIntents } from "../characters/controller/avatarController"
import { isMounted } from "../horses/riding"
import type { LocomotionIntent } from "../characters/controller/locomotion"
import { explorerMotionRT } from "../characters/ExplorerCharacter"
import { companionMotionRT } from "../characters/CompanionCharacter"
import { inviteCompanion } from "../characters/characterSwitch"
import { danceBeat, highFiveClap, hugBloom } from "../vfx/signatures"
import { sfx } from "../audio/audio"
import { setDanceMusic } from "../audio/music"
import { resolveCollisions } from "../movement"
import { buildColliders, groundHeight } from "../world-layout"
import { cameraRT, characterRT, companionRT, input, playerRT, takeAction, worldRT, type AvatarBody, type CharacterId } from "../runtime"
import { TOGETHER_LINES } from "../../content/together"
import { useAdventures } from "../../state/adventureStore"
import { activityRT } from "../activities/activityState"
import { clearPoseRequest, togetherRT, type BodyPoseRequest, type CoupleAction, type WorldArmGoal } from "./togetherState"
import { coupleMoments } from "./actionMoments"
import { bodyMetricsRT } from "../characters/bodyMetrics"
import { gift, names } from "../../personalization"

const colliders = buildColliders()
/** Standing heights used to place hands (m), measured from the loaded rigs. */
const BODY = bodyMetricsRT
const HUG_TIME = 3.6
const FIVE_TIME = 1.5
const DANCE_LIMIT = 75

const bodyOf = (id: CharacterId): AvatarBody => (id === "explorer" ? playerRT : companionRT)
const other = (id: CharacterId): CharacterId => (id === "explorer" ? "companion" : "explorer")
const onLand = (id: CharacterId): boolean => (id === "explorer" ? explorerMotionRT.water : companionMotionRT.water) === "land"
const forwardOf = (facing: number, out: THREE.Vector3): THREE.Vector3 => out.set(Math.sin(facing), 0, Math.cos(facing))
/** The character's own right-hand side in world space. */
const rightOf = (facing: number, out: THREE.Vector3): THREE.Vector3 => out.set(-Math.cos(facing), 0, Math.sin(facing))

const intents: Record<CharacterId, LocomotionIntent> = {
  explorer: { move: { x: 0, y: 0 }, sprint: false, jump: false },
  companion: { move: { x: 0, y: 0 }, sprint: false, jump: false },
}
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _c = new THREE.Vector3()
const _d = new THREE.Vector3()
const _mid = new THREE.Vector3()
const _target = new THREE.Vector3()
const _fingers = new THREE.Vector3()
const _palm = new THREE.Vector3()
const spot = { x: 0, z: 0 }
const _screen = new THREE.Vector3()

const nav = {
  stuck: 0,
  lastDist: Infinity,
  progressTimer: 0,
  sidestep: 0,
  sidestepSign: 1,
  pendingJump: -1,
  leaderPhase: "grounded" as string,
  following: false,
  chatter: 25,
  approachTime: 0,
  pausedLeader: null as AvatarBody | null,
  framing: false,
  framingYaw: 0,
  /** metres walked hand in hand / seconds danced, flushed to the book in steps */
  handMetres: 0,
  danceSeconds: 0,
}

/** A side-on two-shot for hugs, high fives and dances. */
const frameCouple = (leader: AvatarBody, follower: AvatarBody, distance: number): void => {
  if (worldRT.performingMemoryId) return
  if (!nav.framing) {
    // look across the pair from whichever side the camera is already on
    const line = Math.atan2(follower.pos.x - leader.pos.x, follower.pos.z - leader.pos.z)
    const a = line + Math.PI / 2, b = line - Math.PI / 2
    const diff = (x: number): number => Math.abs(Math.atan2(Math.sin(x - cameraRT.yaw), Math.cos(x - cameraRT.yaw)))
    nav.framingYaw = diff(a) < diff(b) ? a : b
    nav.framing = true
  }
  const f = worldRT.focus
  f.active = true
  f.x = follower.pos.x
  f.z = follower.pos.z
  f.yaw = nav.framingYaw
  f.pitch = 0.2
  f.distance = distance
}

const releaseFraming = (): void => {
  if (!nav.framing) return
  nav.framing = false
  if (!worldRT.performingMemoryId) {
    worldRT.focus.active = false
    worldRT.focus.yaw = worldRT.focus.pitch = worldRT.focus.distance = null
    cameraRT.targetYaw = cameraRT.yaw
  }
}

export const say = (who: CharacterId, text: string, seconds = 3.6): void => {
  togetherRT.speech.who = who
  togetherRT.speech.text = text
  togetherRT.speech.time = seconds
  togetherRT.version++
}

const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]

/** Walk the partner towards a point with the shared locomotion; true on arrival. */
const steer = (follower: AvatarBody, id: CharacterId, x: number, z: number, arrive: number, sprint: boolean, dt: number, smooth = false): boolean => {
  const dx = x - follower.pos.x
  const dz = z - follower.pos.z
  const dist = Math.hypot(dx, dz)
  const intent = intents[id]
  intent.jump = false
  if (dist < arrive) {
    nav.stuck = 0
    nav.progressTimer = 0
    nav.lastDist = Infinity
    return true
  }
  // progress watchdog: side-step around a trunk or rock, then give up
  nav.progressTimer += dt
  if (nav.progressTimer > 1.2) {
    if (nav.lastDist - dist < 0.35 && dist > 1.2) {
      nav.stuck += nav.progressTimer
      nav.sidestep = 0.8
      nav.sidestepSign = -nav.sidestepSign
    } else nav.stuck = 0
    nav.lastDist = dist
    nav.progressTimer = 0
  }
  let mx = dx / dist
  let mz = dz / dist
  if (nav.sidestep > 0) {
    nav.sidestep -= dt
    const angle = nav.sidestepSign * 1.2
    const c = Math.cos(angle), s = Math.sin(angle)
    ;[mx, mz] = [mx * c - mz * s, mx * s + mz * c]
  }
  const magnitude = smooth ? THREE.MathUtils.clamp(dist / 0.7, 0, 1) : THREE.MathUtils.clamp(dist / 1.4, 0.35, 1)
  intent.move.x = mx * magnitude
  intent.move.y = mz * magnitude
  intent.sprint = sprint
  aiIntents[id] = intent
  return false
}

/** Put the partner back beside the player when they fall far behind or get stuck. */
const regroup = (leader: AvatarBody, follower: AvatarBody, followerId: CharacterId): void => {
  if (followerId === "companion") {
    characterRT.companionPresent = false
    inviteCompanion()
  } else {
    for (let i = 0; i < 16; i++) {
      const angle = leader.facing + Math.PI * 0.75 + (i % 8) * Math.PI / 4
      const r = 1.6 + Math.floor(i / 8) * 0.8
      spot.x = leader.pos.x + Math.sin(angle) * r
      spot.z = leader.pos.z + Math.cos(angle) * r
      const sx = spot.x, sz = spot.z
      resolveCollisions(spot, 0.36, colliders.circles, colliders.rects, { feetY: groundHeight(sx, sz) })
      if (Math.hypot(spot.x - sx, spot.z - sz) > 0.2) continue
      follower.pos.set(spot.x, groundHeight(spot.x, spot.z), spot.z)
      follower.vel.set(0, 0, 0)
      follower.facing = leader.facing
      follower.revision++
      break
    }
  }
  nav.stuck = 0
  nav.lastDist = Infinity
  togetherRT.stats.teleports++
  say(followerId, pick(TOGETHER_LINES.regroup[followerId]))
}

const faceTowards = (body: AvatarBody, x: number, z: number, dt: number, rate = 8): void => {
  const want = Math.atan2(x - body.pos.x, z - body.pos.z)
  const delta = Math.atan2(Math.sin(want - body.facing), Math.cos(want - body.facing))
  body.facing += delta * (1 - Math.exp(-rate * dt))
}

const setGoal = (goal: WorldArmGoal, target: THREE.Vector3, fingers: THREE.Vector3, palm: THREE.Vector3, weight: number, grip: number): void => {
  goal.target.copy(target)
  goal.fingers.copy(fingers).normalize()
  goal.palm.copy(palm).normalize()
  goal.weight = weight
  goal.grip = grip
}

/** Which of a body's hands is on the partner's side. */
const nearHand = (id: CharacterId, request: BodyPoseRequest): WorldArmGoal => (id === "explorer" ? request.reachR : request.reachL)

const startAction = (action: CoupleAction, leaderId: CharacterId): void => {
  togetherRT.action = action
  togetherRT.actionTime = 0
  coupleMoments.reset()
  togetherRT.version++
  nav.approachTime = 0
  const leader = bodyOf(leaderId)
  if (action === "hug" || action === "highFive" || action === "dance") {
    leader.paused = true
    leader.vel.set(0, 0, 0)
    nav.pausedLeader = leader
  }
  if (action === "hug") say(other(leaderId), pick(TOGETHER_LINES.hug[other(leaderId)]))
  if (action === "dance") {
    say(other(leaderId), pick(TOGETHER_LINES.dance[other(leaderId)]), 4)
    setDanceMusic(true)
    togetherRT.stats.dances++
  }
  if (action === "holdHands") togetherRT.stats.handHolds++
}

export const endCoupleAction = (): void => {
  if (togetherRT.action === "dance") setDanceMusic(false)
  releaseFraming()
  if (nav.pausedLeader) {
    nav.pausedLeader.paused = false
    nav.pausedLeader = null
  }
  togetherRT.action = "none"
  togetherRT.actionTime = 0
  coupleMoments.reset()
  togetherRT.version++
}

/**
 * After the finale the companion joins the explorer for good: whoever is not being
 * played follows, holds hands, hugs, high-fives, dances and sits down beside
 * the other. Runs before both characters so they read this frame's intent.
 */
export const Together = (): null => {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  // speech bubbles follow the speaker's head on screen
  useFrame(() => {
    const sp = togetherRT.speech
    if (sp.time <= 0) return
    const body = bodyOf(sp.who)
    _screen.set(body.pos.x - originRT.x, body.pos.y + BODY[sp.who].top + 0.28, body.pos.z - originRT.z).project(camera)
    sp.onScreen = _screen.z < 1 && Math.abs(_screen.x) < 1.1 && Math.abs(_screen.y) < 1.1
    sp.screenX = (_screen.x * 0.5 + 0.5) * size.width
    sp.screenY = (-_screen.y * 0.5 + 0.5) * size.height
  })
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    clearPoseRequest(togetherRT.pose.explorer)
    clearPoseRequest(togetherRT.pose.companion)
    aiIntents.explorer = aiIntents.companion = null
    if (togetherRT.speech.time > 0) {
      togetherRT.speech.time -= dt
      if (togetherRT.speech.time <= 0) togetherRT.version++
    }
    const game = useGame.getState()
    const active = companionUnlocked(game) && characterRT.companionPresent && characterRT.companionReady &&
      !worldRT.introActive && !worldRT.finaleActive && !characterRT.switching && !game.activeMemoryId && !game.activeSecretId
    if (!active) {
      if (togetherRT.action !== "none") endCoupleAction()
      togetherRT.partnerNear = false
      // keep queued together-keys from firing later
      for (const a of ["hold", "hug", "five", "dance", "follow"] as const) takeAction(a)
      return
    }
    const leaderId = characterRT.active
    const followerId = other(leaderId)
    const leader = bodyOf(leaderId)
    const follower = bodyOf(followerId)
    const dist = Math.hypot(leader.pos.x - follower.pos.x, leader.pos.z - follower.pos.z)
    togetherRT.distance = dist
    const free = onLand("explorer") && onLand("companion") && leader.rideY === null && follower.rideY === null &&
      (leader.gesture === "none" || togetherRT.action !== "none") && follower.gesture === "none"
    const near = free && dist < 3.4
    if (near !== togetherRT.partnerNear) { togetherRT.partnerNear = near; togetherRT.version++ }

    // ---- requests --------------------------------------------------------
    if (takeAction("follow")) {
      togetherRT.follow = !togetherRT.follow
      togetherRT.version++
      say(followerId, pick(togetherRT.follow ? TOGETHER_LINES.follow[followerId] : TOGETHER_LINES.wait[followerId]))
    }
    const want: CoupleAction | null = takeAction("hold") ? "holdHands" : takeAction("hug") ? "hug" : takeAction("five") ? "highFive" : takeAction("dance") ? "dance" : null
    if (want) {
      if (togetherRT.action === want && (want === "holdHands" || want === "dance")) endCoupleAction()
      else if (isMounted(leaderId) || isMounted(followerId)) game.showHint(isMounted(leaderId) ? "Get off your horse first (E)." : followerId === "companion" ? `${names.companion} is on horseback — wait for them to get off.` : `${names.explorer} is on horseback — wait for them to get off.`)
      else if (!near && dist >= 3.4) game.showHint(followerId === "companion" ? `Get a little closer to ${names.companion} first.` : `Get a little closer to ${names.explorer} first.`)
      else if (free) {
        if (togetherRT.action !== "none") endCoupleAction()
        togetherRT.follow = true
        startAction(want, leaderId)
      }
    }
    const moveInput = Math.hypot(input.move.x, input.move.y) > 0.2
    togetherRT.actionTime += dt
    const t = togetherRT.actionTime
    const action = togetherRT.action
    if (action !== "none" && action !== "holdHands" && action !== "sitTogether" && (moveInput && t > 0.6 || !free && action !== "dance")) endCoupleAction()

    const lf = forwardOf(leader.facing, _a)
    const pr = togetherRT.pose
    const side = followerId === "companion" ? rightOf(leader.facing, _b) : rightOf(leader.facing, _b).multiplyScalar(-1)

    // ---- choreography ------------------------------------------------------
    if (togetherRT.action === "holdHands") {
      if (dist > 6 || !free) { endCoupleAction(); return }
      // partner keeps pace at your side, a hand's width apart. When you turn
      // sharply they walk around you (never through you) to your side again.
      const lead = Math.min(leader.speed, 6) * 0.12
      const relAngle = Math.atan2(follower.pos.x - leader.pos.x, follower.pos.z - leader.pos.z)
      const sideAngle = Math.atan2(side.x, side.z)
      const swing = Math.atan2(Math.sin(sideAngle - relAngle), Math.cos(sideAngle - relAngle))
      const orbit = relAngle + Math.sign(swing) * Math.min(Math.abs(swing), 1.1)
      const radius = Math.max(0.6, Math.min(dist, 1.2))
      _target.set(leader.pos.x + Math.sin(orbit) * radius, 0, leader.pos.z + Math.cos(orbit) * radius).addScaledVector(lf, lead)
      const arrived = steer(follower, followerId, _target.x, _target.z, 0.06, leader.speed > 3.2 || dist > 1.4, dt, true)
      if (arrived && !leader.moving) follower.facing += Math.atan2(Math.sin(leader.facing - follower.facing), Math.cos(leader.facing - follower.facing)) * (1 - Math.exp(-6 * dt))
      const reach = 1 - THREE.MathUtils.smoothstep(dist, 1.05, 1.5)
      if (reach > 0.7 && leader.moving) {
        nav.handMetres += leader.speed * dt
        if (nav.handMetres >= 10) { useAdventures.getState().bump("handInHand", nav.handMetres); nav.handMetres = 0 }
      }
      if (reach > 0) {
        _mid.copy(leader.pos).add(follower.pos).multiplyScalar(0.5).addScaledVector(lf, 0.05)
        _mid.y = (leader.pos.y + follower.pos.y) * 0.5 + (BODY.explorer.hand + BODY.companion.hand) * 0.5
        const down = _c.set(0, -1, 0).addScaledVector(lf, 0.35)
        for (const id of ["explorer", "companion"] as const) {
          const self = bodyOf(id), mate = bodyOf(other(id))
          const towards = _d.set(mate.pos.x - self.pos.x, 0, mate.pos.z - self.pos.z).normalize()
          setGoal(nearHand(id, pr[id]), _mid, down, towards, reach, 0.8)
        }
      }
      if (leader.jumpPhase === "rising" && nav.leaderPhase !== "rising") nav.pendingJump = 0.05
    } else if (togetherRT.action === "hug" || togetherRT.action === "highFive" || togetherRT.action === "dance") {
      const gap = togetherRT.action === "hug" ? 0.44 : togetherRT.action === "dance" ? 0.5 : 0.95
      _target.copy(leader.pos).addScaledVector(lf, gap)
      nav.approachTime += dt
      const arrived = steer(follower, followerId, _target.x, _target.z, 0.12, false, dt, true) || nav.approachTime > 2.6
      if (!arrived) {
        togetherRT.actionTime = 0
      } else {
        aiIntents[followerId] = null
        follower.vel.set(0, 0, 0)
        if (nav.approachTime > 2.6 && Math.hypot(_target.x - follower.pos.x, _target.z - follower.pos.z) > 0.2) {
          follower.pos.x = THREE.MathUtils.damp(follower.pos.x, _target.x, 6, dt)
          follower.pos.z = THREE.MathUtils.damp(follower.pos.z, _target.z, 6, dt)
        }
        faceTowards(follower, leader.pos.x, leader.pos.z, dt, 10)
        faceTowards(leader, follower.pos.x, follower.pos.z, dt, 10)
        frameCouple(leader, follower, togetherRT.action === "dance" ? 5.4 : 4.4)
        if (togetherRT.action === "hug") hug(t, pr)
        else if (togetherRT.action === "highFive") highFive(t, pr)
        else dance(t, dt, pr)
      }
    } else {
      // ---- following -------------------------------------------------------
      if (leader.gesture === "sit" && dist < 9 && follower.gesture === "none" && togetherRT.follow) {
        _target.copy(leader.pos).addScaledVector(side, 0.72)
        if (steer(follower, followerId, _target.x, _target.z, 0.18, false, dt)) {
          follower.gesture = "sit"
          follower.gestureTime = 0
          follower.paused = true
          follower.facing = leader.facing
          togetherRT.action = "sitTogether"
          togetherRT.version++
        }
      } else if (togetherRT.action === "sitTogether") {
        if (leader.gesture !== "sit") {
          follower.gesture = "none"
          follower.paused = false
          togetherRT.action = "none"
          togetherRT.version++
        } else pr[followerId].love = 0.6
      } else if (togetherRT.follow && activityRT.mode !== "race" && sameWorld(leader.pos, follower.pos)) {
        // (never across worlds: someone left at home waits there while the other is on the Moon)
        // never teleport someone beside a rider: on horseback the partner
        // fetches their own horse instead (src/game/horses/riding.ts)
        const horseback = isMounted(leaderId) || isMounted(followerId)
        if (!horseback && (dist > 48 || nav.stuck > 5)) regroup(leader, follower, followerId)
        // start following when left behind; settle beside you
        if (!nav.following && dist > 3.4) nav.following = true
        if (nav.following) {
          const back = leader.moving ? 0.9 : 0.4
          _target.copy(leader.pos).addScaledVector(side, 1.25).addScaledVector(lf, -back)
          const runFast = dist > 4.5 || leader.speed > 3.4
          if (steer(follower, followerId, _target.x, _target.z, leader.moving ? 0.6 : 0.9, runFast, dt)) {
            if (!leader.moving) nav.following = false
          }
        } else if (!follower.moving && dist < 6) {
          faceTowards(follower, leader.pos.x, leader.pos.z, dt, 1.5)
        }
        // copy a jump a beat later, like someone joining in
        if (leader.jumpPhase === "rising" && nav.leaderPhase !== "rising" && dist < 7) nav.pendingJump = 0.18
      }
      chatter(dt, leader, follower, followerId, dist)
    }
    // two bodies never occupy the same spot
    const sepDist = Math.hypot(follower.pos.x - leader.pos.x, follower.pos.z - leader.pos.z)
    const minGap = togetherRT.action === "hug" ? 0.36 : togetherRT.action === "dance" ? 0.42 : 0.5
    if (sepDist < minGap && sepDist > 1e-4) {
      const push = (minGap - sepDist) / sepDist
      follower.pos.x += (follower.pos.x - leader.pos.x) * push
      follower.pos.z += (follower.pos.z - leader.pos.z) * push
    }
    nav.leaderPhase = leader.jumpPhase
    if (nav.pendingJump >= 0) {
      nav.pendingJump -= dt
      if (nav.pendingJump < 0) {
        const intent = intents[followerId]
        if (!aiIntents[followerId]) { intent.move.x = intent.move.y = 0; intent.sprint = false }
        intent.jump = true
        aiIntents[followerId] = intent
      }
    }
  }, -40)
  return null
}

const hug = (t: number, pr: Record<CharacterId, BodyPoseRequest>): void => {
  const wrap = THREE.MathUtils.smoothstep(t, 0.05, 0.7) * (1 - THREE.MathUtils.smoothstep(t, HUG_TIME - 0.6, HUG_TIME))
  for (const id of ["explorer", "companion"] as const) {
    const mate = bodyOf(other(id))
    const mf = forwardOf(mate.facing, _c)
    const mr = rightOf(mate.facing, _d)
    // arms go around the partner: one pair around the back, the other around the shoulders
    const height = mate.pos.y + (id === "explorer" ? BODY.companion.waist + 0.12 : BODY.explorer.chest + 0.06)
    for (const hand of ["L", "R"] as const) {
      // facing each other, my left hand meets the partner's right side
      const sideSign = hand === "L" ? 1 : -1
      _target.copy(mate.pos).addScaledVector(mr, 0.15 * sideSign).addScaledVector(mf, -0.1)
      _target.y = height + (hand === "L" ? 0.04 : -0.04)
      _fingers.copy(mr).multiplyScalar(-sideSign).addScaledVector(mf, -0.3)
      setGoal(hand === "L" ? pr[id].reachL : pr[id].reachR, _target, _fingers, mf, wrap, 0.35)
    }
    pr[id].bow = 0.14 * wrap
    pr[id].love = wrap
  }
  if (coupleMoments.once("hug", t, 0.75)) {
    const m = playerRT.pos, i = companionRT.pos
    _target.set((m.x + i.x) / 2, (m.y + i.y) / 2 + (BODY.explorer.top + BODY.companion.top) / 2 + 0.12, (m.z + i.z) / 2)
    hugBloom(_target, (m.y + i.y) / 2)
    sfx.hug()
    togetherRT.stats.hugs++
    useAdventures.getState().bump("hugs", 1)
  }
  if (t > HUG_TIME) endCoupleAction()
}

const highFive = (t: number, pr: Record<CharacterId, BodyPoseRequest>): void => {
  const m = playerRT.pos, i = companionRT.pos
  _mid.set((m.x + i.x) / 2, 0, (m.z + i.z) / 2)
  const raise = THREE.MathUtils.smoothstep(t, 0.0, 0.45) * (1 - THREE.MathUtils.smoothstep(t, 0.85, 1.25))
  const meet = THREE.MathUtils.smoothstep(t, 0.4, 0.56)
  for (const id of ["explorer", "companion"] as const) {
    const self = bodyOf(id), mate = bodyOf(other(id))
    const towards = _d.set(mate.pos.x - self.pos.x, 0, mate.pos.z - self.pos.z).normalize()
    _target.copy(self.pos).lerp(_mid, 0.45 + meet * 0.5)
    _target.y = (m.y + i.y) / 2 + BODY.explorer.shoulder + 0.32 + meet * 0.02
    setGoal(nearHand(id, pr[id]), _target, _c.set(0, 1, 0).addScaledVector(towards, 0.2), towards, raise, 0)
    pr[id].love = THREE.MathUtils.smoothstep(t, 0.5, 0.7) * 0.8
  }
  if (coupleMoments.once("highFive", t, 0.55)) {
    _target.copy(_mid)
    _target.y = (m.y + i.y) / 2 + BODY.explorer.shoulder + 0.34
    highFiveClap(_target, (m.y + i.y) / 2)
    sfx.clap()
    playerRT.celebrate = companionRT.celebrate = 1.1
    togetherRT.stats.highFives++
    // the book's "Perfect High Five" page reads the saved record
    useAdventures.getState().bump("highFives", 1)
  }
  if (t > FIVE_TIME) endCoupleAction()
}

const dance = (t: number, dt: number, pr: Record<CharacterId, BodyPoseRequest>): void => {
  const m = playerRT, i = companionRT
  _mid.set((m.pos.x + i.pos.x) / 2, 0, (m.pos.z + i.pos.z) / 2)
  // slowly turn together around the shared centre
  const spin = 0.42 * dt * THREE.MathUtils.smoothstep(t, 0.6, 2)
  if (spin > 0) {
    for (const body of [m, i]) {
      const dx = body.pos.x - _mid.x, dz = body.pos.z - _mid.z
      const c = Math.cos(spin), s = Math.sin(spin)
      body.pos.x = _mid.x + dx * c - dz * s
      body.pos.z = _mid.z + dx * s + dz * c
      body.vel.set(0, 0, 0)
    }
  }
  const hold = THREE.MathUtils.smoothstep(t, 0.1, 0.8)
  // one pair of hands rests on the shoulders, the other at the waist
  const iF = forwardOf(i.facing, _c), iR = rightOf(i.facing, _d)
  for (const hand of ["L", "R"] as const) {
    const s = hand === "L" ? 1 : -1
    _target.copy(i.pos).addScaledVector(iR, 0.17 * s).addScaledVector(iF, 0.05)
    _target.y = i.pos.y + BODY.companion.shoulder
    const towards = _a.set(i.pos.x - m.pos.x, 0, i.pos.z - m.pos.z).normalize()
    setGoal(hand === "L" ? pr.explorer.reachL : pr.explorer.reachR, _target, _fingers.set(0, 0.7, 0).add(towards), _palm.set(0, -0.6, 0).add(towards), hold, 0.25)
  }
  const mF = forwardOf(m.facing, _c), mR = rightOf(m.facing, _d)
  for (const hand of ["L", "R"] as const) {
    const s = hand === "L" ? 1 : -1
    _target.copy(m.pos).addScaledVector(mR, 0.16 * s).addScaledVector(mF, -0.02)
    _target.y = m.pos.y + BODY.explorer.waist
    const towards = _a.set(m.pos.x - i.pos.x, 0, m.pos.z - i.pos.z).normalize()
    setGoal(hand === "L" ? pr.companion.reachL : pr.companion.reachR, _target, _fingers.copy(mR).multiplyScalar(-s).add(towards), towards, hold, 0.3)
  }
  if (hold > 0.9) {
    nav.danceSeconds += dt
    if (nav.danceSeconds >= 5) { useAdventures.getState().bump("danceSeconds", nav.danceSeconds); nav.danceSeconds = 0 }
  }
  pr.explorer.dance = pr.companion.dance = hold * 0.75
  pr.explorer.love = pr.companion.love = hold * 0.7
  pr.explorer.bow = pr.companion.bow = -0.04 * hold
  if (Math.floor(t / 2.4) !== Math.floor((t - dt) / 2.4) && t > 2) {
    _target.copy(_mid)
    _target.y = m.pos.y + Math.max(BODY.explorer.top, BODY.companion.top) + 0.17
    danceBeat(_mid, m.pos.y)
  }
  if (t > DANCE_LIMIT) endCoupleAction()
}

const chatter = (dt: number, leader: AvatarBody, follower: AvatarBody, followerId: CharacterId, dist: number): void => {
  nav.chatter -= dt
  if (nav.chatter > 0 || togetherRT.speech.time > 0) return
  // how often the follower speaks up (personalization `characters.companion.chatter`)
  const rate = gift().characters.companion.chatter
  nav.chatter = (rate === "often" ? 22 + Math.random() * 25 : rate === "rarely" ? 110 + Math.random() * 90 : 40 + Math.random() * 45)
  if (dist > 8 || leader.speed > 3) return
  const lines = worldRT.timeOfDay > 0.84 ? TOGETHER_LINES.night[followerId] : TOGETHER_LINES.idle[followerId]
  say(followerId, pick(lines), 4.2)
  void follower
}

/** The choreography steps, exported for frame-rate regression tests. */
export const coupleChoreography = { hug, highFive }
