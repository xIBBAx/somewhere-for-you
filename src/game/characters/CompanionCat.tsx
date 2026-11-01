import { debugEnabled } from "../../dev/debugFlag"
import { useFrame } from "@react-three/fiber"
import { catRidePoint, croupPoint, mountQuaternion, riderRT } from "../horses/riding"
import type { HorseState } from "../horses/horseState"
import { spaceRT } from "../celestial/spaceState"
import { WATER_WAYS, creatureWaterSurfaceAt, creatureWaterY, makeWaterContact, pickWaterSpot, shakeOffWater, stepWaterContact, waterInvitation, waterUnwelcoming } from "../../world/creatureWater"
import { emitRipple } from "../../world/render/waterFx"
import { waterBodyRT } from "../../world/render/waterFx"
import { wildlifeRT } from "../../world/wildlife/runtime"
import { findShore } from "../../world/wildlife/rhythm"
import { applyRideMood, makeRideMood, stepRideMood } from "./catLife"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"
import { damp, dampAngle, smoothstep } from "../../utils/math"
import { groundShadowTexture } from "../../utils/groundShadow"
import {
  COATS,
  disposeAnimalModel,
  makeAnimalModel,
  type AnimalModel,
} from "../../world/wildlife/animalAssets"
import { QuadrupedAnimator } from "../../world/wildlife/QuadrupedAnimator"
import { registerDevTool } from "../../dev/devTools"
import {
  animalWeatherIsThreatening,
  chooseCompanionDistraction,
  createAnimalAgent,
  animalAgentsOf,
  getAnimalAgent,
  homeDrinkPoints,
  nearestShelterPoint,
  registerAnimalAgent,
  type AnimalActivity,
} from "../animals/ecosystem"
import { resolveCollisions } from "../movement"
import { weatherRT } from "../weather/weatherState"
import {
  findCatPath,
  findJumpPlan,
  segmentHasClearance,
  setNavigationTerrainBlocker,
} from "../navigation/catNavigation"
import { chunkColliders } from "../../world/colliders"
import { CHUNK_SIZE } from "../../world/worldConfig"
import { WATER_LEVEL, lakeMask } from "../../world/climate"
import { worldHeight } from "../../world/terrain"
import { originRT } from "../../world/origin"
import type { CircleCollider, RectCollider } from "../world-layout"
import { catRaceRT, avatarRT, cameraRT, catRT, characterRT, input, playerRT, worldRT } from "../runtime"
import type { CatNavMode, CatState } from "../runtime"
import { buildColliders, groundHeight } from "../world-layout"
import { callCat, catVoice } from "../audio/audio"
import { discoveryRT } from "../../world/discoveries"
import { ACTION_DURATION, catNextState, isRestingState, pickIdleBehavior } from "./catBrain"
import {
  companionGroundSink,
  composeCompanionPose,
  createCompanionBlend,
  stepCompanionBlend,
  type CompanionPoseInput,
  type CompanionPoseScratch,
} from "./catRigPose"
import { PrimitiveCat } from "./catPrimitives"
import { purrRipple, trailMote } from "../vfx/signatures"

const _purrAt = new THREE.Vector3()

/**
 * Companion cat: trails the explorer along her recent path (never a fixed offset),
 * with a small readable behaviour state machine.
 *
 * She is drawn with the same rigged, skinned cat the wildlife uses and driven
 * by the same `QuadrupedAnimator`, so she belongs to the forest around her
 * rather than to a toy next to it. Everything that decides what she *does*
 * stays here; `catRigPose` only decides how it looks. If the model cannot be
 * loaded, `PrimitiveCat` stands in so the game never breaks.
 */
/** ~36 m of the explorer's path at 0.3 m spacing: room to rejoin her out of sight. */
const TRAIL_MAX = 120
const trail: THREE.Vector3[] = []

const target = new THREE.Vector3()
const toTarget = new THREE.Vector3()
const navigationTarget = new THREE.Vector3()

/** Point on the explorer's recent trail ~`back` units behind her. */
const trailPoint = (back: number, out: THREE.Vector3): THREE.Vector3 => {
  out.copy(playerRT.pos)
  let remaining = back
  for (let i = trail.length - 1; i > 0 && remaining > 0; i--) {
    const a = trail[i]
    const b = trail[i - 1]
    const seg = a.distanceTo(b)
    if (seg >= remaining) {
      out.lerpVectors(a, b, remaining / seg)
      return out
    }
    remaining -= seg
    out.copy(b)
  }
  return out
}

const WALK_SPEED = 3.2
const RUN_SPEED = 8.7
/** a cat's full gallop, only while closing a real gap */
const SPRINT_SPEED = 11.5
/** how quickly she gathers into a run and settles out of one (m/s²) */
const CAT_ACCEL = 9
const CAT_DECEL = 12
const AFFECTION_APPROACH_SPEED = 2.0
const AFFECTION_IDLE_DELAY = 2.4
const AFFECTION_DURATION = 3.4
const CAT_RADIUS = 0.2
/** The explorer can pet her from this far away (she walks the rest of the way). */
const PET_REACH = 1.9
/** seconds of leg-weaving before she settles */
const RUB_DURATION = 6.5
const petSpot = new THREE.Vector3()
const _head = new THREE.Vector3()

/** Jaw envelope of a vocalisation that began `t` seconds ago. */
const voiceEnvelope = (kind: string, t: number): number => {
  const dur = kind === "meow" ? 0.7 : kind === "trill" ? 0.34 : kind === "mew" ? 0.24 : kind === "chirp" ? 0.55 : 0
  if (dur === 0 || t < 0 || t > dur) return 0
  const u = t / dur
  // the mouth opens on the vowel and closes on the "-ow"
  return Math.sin(Math.min(1, u * 1.15) * Math.PI) * (kind === "meow" ? 0.85 : kind === "trill" ? 0.3 : kind === "chirp" ? 0.25 : 0.4)
}

/** Can the explorer start petting her right now? */
export const companionPettable = (): boolean =>
  characterRT.active === catRT.owner &&
  !characterRT.switching &&
  !playerRT.paused &&
  playerRT.gesture === "none" &&
  !worldRT.introActive &&
  !worldRT.finaleActive &&
  worldRT.nearMemoryId === null &&
  worldRT.nearSecretId === null &&
  catRT.navMode !== "jump" &&
  catRT.state !== "scared" &&
  catRT.state !== "chase" &&
  catRT.state !== "catchup" &&
  catRT.pos.distanceTo(playerRT.pos) < PET_REACH
const { circles, rects } = buildColliders()
const catStep = { x: 0, z: 0 }
/** her collision options: she swims, and on a flat roof the parapet keeps her on it */
const catCollide = { feetY: 0, stepUp: 0, canSwim: true }
const collideCat = (feetY: number): typeof catCollide => { catCollide.feetY = feetY; return catCollide }

// The cat is not afraid of water, but like any cat she takes the dry way round
// when there is one; she swims when the explorer is in the water or the water is
// where she means to go (a paddle of her own).
const catNav = { swim: false }
setNavigationTerrainBlocker((x, z) => !catNav.swim && lakeMask(x, z) > 0 && worldHeight(x, z) < WATER_LEVEL + 0.04)
const CAT_WATER = WATER_WAYS["companion-cat"]
const _rideQ = new THREE.Quaternion()

/**
 * Obstacles around the cat wherever she is: the authored home colliders plus
 * the trees and boulders of streamed chunks. Navigation used to see only the
 * home hub, so in the wilds every route led back home.
 */
const navCircles: CircleCollider[] = []
const navRects: RectCollider[] = []
const navGather = { x: Infinity, z: Infinity, age: Infinity, chunks: -1 }
const NAV_GATHER_RADIUS = 42
const gatherNavColliders = (x: number, z: number, dt: number): void => {
  navGather.age += dt
  const moved = Math.hypot(x - navGather.x, z - navGather.z) > 4
  if (!moved && navGather.age < 0.6 && navGather.chunks === chunkColliders.size) return
  navGather.x = x
  navGather.z = z
  navGather.age = 0
  navGather.chunks = chunkColliders.size
  navCircles.length = 0
  navRects.length = 0
  const r = NAV_GATHER_RADIUS
  for (const c of circles) if (Math.abs(c.x - x) < r + c.r && Math.abs(c.z - z) < r + c.r) navCircles.push(c)
  for (const b of rects) if (b.maxX > x - r && b.minX < x + r && b.maxZ > z - r && b.minZ < z + r) navRects.push(b)
  const c0x = Math.floor((x - r) / CHUNK_SIZE), c1x = Math.floor((x + r) / CHUNK_SIZE)
  const c0z = Math.floor((z - r) / CHUNK_SIZE), c1z = Math.floor((z + r) / CHUNK_SIZE)
  for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
    const list = chunkColliders.get(`${cx},${cz}`)
    if (!list) continue
    for (const c of list) if (Math.abs(c.x - x) < r && Math.abs(c.z - z) < r) navCircles.push(c)
  }
}

const _frustum = new THREE.Frustum()
const _viewProj = new THREE.Matrix4()
const _probe = new THREE.Vector3()
const _probeSphere = new THREE.Sphere()
/** Is a logical-space point on screen? (The camera lives in render space.) */
const onScreen = (camera: THREE.Camera, x: number, y: number, z: number, margin = 0.6): boolean => {
  _viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  _frustum.setFromProjectionMatrix(_viewProj)
  _probe.set(x - originRT.x, y + 0.2, z - originRT.z)
  _probeSphere.set(_probe, margin)
  return _frustum.intersectsSphere(_probeSphere)
}

/** The explorer's companion wears her own "cat" coat (silver-grey with dark tabby
 * stripes and a pale muzzle, ruff and inner legs); no wild
 * cat is ever given it. */
const COMPANION_COAT = (() => {
  const cat = Math.max(0, COATS.cat.findIndex((coat) => coat.name === "cat"))
  if (typeof window === "undefined") return cat
  // QA only: try another coat on her rig
  const q = new URLSearchParams(window.location.search)
  const ask = debugEnabled() ? q.get("companionCoat") : null
  if (ask === null) return cat
  const named = COATS.cat.findIndex((coat) => coat.name === ask)
  return named >= 0 ? named : Math.max(0, Math.min(COATS.cat.length - 1, Number(ask) || 0))
})()

/**
 * A thin red collar, parented to the neck bone so it turns with her head.
 * Measured on the cat rig: the neck bone's own +Y runs along the neck axis
 * and the neck is ~0.055 m across, so a torus of that radius sits flush on it
 * and a small tag hangs just under the jaw. The rebuilt rig has a slimmer,
 * truer neck (~0.07 m across at the collar line).
 */
const makeCollar = (): THREE.Group => {
  const collar = new THREE.Group()
  const band = new THREE.Mesh(
    // sized to sit just proud of her long neck ruff so a line of red shows
    new THREE.TorusGeometry(0.046, 0.0048, 6, 24),
    new THREE.MeshStandardMaterial({ color: "#c62828", roughness: 0.55, metalness: 0.05 }),
  )
  // A torus is authored in XY; the neck axis is the bone's +Y.
  band.rotation.x = Math.PI / 2
  collar.add(band)
  const tag = new THREE.Mesh(
    // a small bright bell-brass tag; fully metallic it goes black wherever
    // there is nothing to reflect and reads as a second mouth under her chin
    new THREE.CylinderGeometry(0.0068, 0.0068, 0.0022, 12),
    new THREE.MeshStandardMaterial({ color: "#e8c46a", roughness: 0.38, metalness: 0.3 }),
  )
  tag.rotation.x = Math.PI / 2
  tag.position.set(0, 0.010, 0.051)
  collar.add(tag)
  // Sit the band on the neck, a little way down from the skull.
  collar.position.set(0, 0.014, 0)
  return collar
}

type CompanionAutonomy = {
  cooldown: number
  duration: number
  mode: "observe" | "investigate" | "chase" | "shelter" | null
  targetId: string | null
  recentId: string | null
  crouchTime: number
}

type FollowStyle = {
  mode: "behind" | "beside" | "ahead"
  side: -1 | 1
  timer: number
}

const CAT_ENVIRONMENT_INTERESTS = [
  new THREE.Vector3(6.4, 0, 9.3), // pond reeds
  new THREE.Vector3(-7.2, 0, 16.2), // shady gulmohar tree
  new THREE.Vector3(14.1, 0, -5.2), // eastern meadow tree
  new THREE.Vector3(-4.6, 0, -4.5), // grass near the old bridge
  new THREE.Vector3(7.3, 0, -18.2), // southern flowers
  new THREE.Vector3(-5.4, 0, -17.1), // path-ahead grass
]

const syncCompanionAgent = (
  agent: ReturnType<typeof createAnimalAgent>,
): void => {
  const oldX = agent.position.x
  const oldZ = agent.position.z
  agent.position.copy(catRT.pos)
  agent.velocity.copy(catRT.vel)
  agent.heading = catRT.facing
  agent.speed = catRT.speed
  agent.moving = catRT.speed > 0.08
  agent.distanceTravelled += Math.hypot(catRT.pos.x - oldX, catRT.pos.z - oldZ)
  const activity: AnimalActivity =
    catRT.state === "chase" || catRT.state === "crouch"
      ? "play"
      : catRT.state === "investigate"
        ? "investigate"
        : catRT.state === "sleep"
          ? "rest"
          : catRT.state === "lookAround"
            ? "observe"
            : catRT.state === "affection"
              ? "socialize"
              : catRT.speed > 0.08
                ? "roam"
                : "rest"
  if (agent.activity !== activity) {
    agent.previousActivity = agent.activity
    agent.activity = activity
    agent.activityTime = 0
    agent.transitions++
  }
}

const clearNavigation = (): void => {
  if (catRT.navMode !== "direct" || catRT.navPath.length > 0) catRT.navVersion++
  catRT.navMode = "direct"
  catRT.navPath.length = 0
  catRT.navIndex = 0
  catRT.detectedObstacle = ""
}

const planNavigation = (goal: THREE.Vector3): CatNavMode => {
  catRT.navTarget.copy(goal)
  catRT.navRepathTime = 0.55
  const start = { x: catRT.pos.x, z: catRT.pos.z }
  const end = { x: goal.x, z: goal.z }
  const jump = findJumpPlan(start, end, CAT_RADIUS, navCircles, navRects, groundHeight)
  catRT.navPath.length = 0
  catRT.navIndex = 0

  if (jump) {
    catRT.navMode = "jumpApproach"
    catRT.jumpStart.set(jump.takeoff.x, groundHeight(jump.takeoff.x, jump.takeoff.z), jump.takeoff.z)
    catRT.jumpEnd.set(jump.landing.x, groundHeight(jump.landing.x, jump.landing.z), jump.landing.z)
    catRT.jumpHeight = Math.max(0.5, jump.obstacleHeight + 0.24)
    catRT.detectedObstacle = "low obstacle · preparing jump"
    catRT.navVersion++
    return catRT.navMode
  }

  const path = findCatPath(start, end, CAT_RADIUS, navCircles, navRects)
  for (const waypoint of path) {
    catRT.navPath.push(
      new THREE.Vector3(waypoint.x, groundHeight(waypoint.x, waypoint.z), waypoint.z),
    )
  }
  catRT.navMode = "path"
  catRT.detectedObstacle = path.length > 0 ? "solid obstacle · routing around" : "route blocked"
  catRT.navVersion++
  return catRT.navMode
}

/** Ground under a paw at model (x, z), relative to her body origin. */
const pawGround = { x: 0, y: 0, z: 0, sin: 0, cos: 1 }
const pawGroundAt = (x: number, z: number): number => {
  const g = pawGround
  return groundHeight(g.x + x * g.cos + z * g.sin, g.z - x * g.sin + z * g.cos) - g.y
}

/** s of crouch before the spring */
const CAT_JUMP_GATHER = 0.16

/**
 * The landing: paws touch (forepaws first), the legs give and the body sinks
 * over them, then rises back. Fast in (~70 ms), slower out (~0.3 s), scaled
 * by how hard she came down.
 */
export const catTouchdown = (landTime: number, impact: number): number => {
  if (landTime < 0 || landTime > 0.8) return 0
  const env = landTime < 0.07 ? landTime / 0.07 : Math.exp(-(landTime - 0.07) / 0.13)
  return Math.min(1, impact) * env
}

const beginJump = (): void => {
  const horizontalDistance = Math.hypot(
    catRT.jumpEnd.x - catRT.pos.x,
    catRT.jumpEnd.z - catRT.pos.z,
  )
  catRT.jumpStart.set(
    catRT.pos.x,
    groundHeight(catRT.pos.x, catRT.pos.z),
    catRT.pos.z,
  )
  // a brief gather first: she sinks onto her haunches, then springs
  catRT.jumpTime = -CAT_JUMP_GATHER
  catRT.jumpDuration = Math.min(0.88, Math.max(0.46, horizontalDistance / 2.25))
  catRT.navMode = "jump"
  catRT.detectedObstacle = "low obstacle · airborne"
  catRT.navVersion++
}

const selectPathTarget = (): void => {
  while (
    catRT.navIndex < catRT.navPath.length &&
    catRT.pos.distanceToSquared(catRT.navPath[catRT.navIndex]) < 0.24 * 0.24
  ) {
    catRT.navIndex++
  }
  if (catRT.navIndex < catRT.navPath.length) {
    navigationTarget.copy(catRT.navPath[catRT.navIndex])
  } else {
    navigationTarget.copy(catRT.pos)
  }
}

/** Pick the least obstructed side of the explorer for a close, readable interaction. */
const placeAffectionTarget = (preferredSide: number): void => {
  const forwardX = Math.sin(playerRT.facing)
  const forwardZ = Math.cos(playerRT.facing)
  const rightX = forwardZ
  const rightZ = -forwardX
  let bestDisplacement = Infinity

  for (const side of [preferredSide, -preferredSide, 0]) {
    const sideOffset = side === 0 ? 0 : 0.53 * side
    const forwardOffset = side === 0 ? 0.55 : 0.05
    const wantedX = playerRT.pos.x + rightX * sideOffset + forwardX * forwardOffset
    const wantedZ = playerRT.pos.z + rightZ * sideOffset + forwardZ * forwardOffset
    catStep.x = wantedX
    catStep.z = wantedZ
    resolveCollisions(catStep, CAT_RADIUS, navCircles, navRects, collideCat(catRT.pos.y))
    const displacement = Math.hypot(catStep.x - wantedX, catStep.z - wantedZ)
    if (displacement < bestDisplacement) {
      bestDisplacement = displacement
      catRT.affectionTarget.set(catStep.x, 0, catStep.z)
      catRT.affectionSide = side || preferredSide
    }
  }
}

/**
 * QA (debug only): `__worldDev.catJump(distance, height)` — The cat gathers and
 * leaps straight ahead now (to see the arc, the landing and the paws).
 */
/** ?debug: hold the cat in a state, e.g. catHold("affection") or catHold("petted"); catHold("") releases */
const installCatHoldDev = (): void => registerDevTool("catHold", ((state: "" | CatState) => { catRT.debugHold = state; return state }) as never)
const installCatJumpDev = (): void => registerDevTool("catJump", ((distance = 1.4, height = 0.55) => {
  catRT.jumpEnd.set(catRT.pos.x + Math.sin(catRT.facing) * distance, 0, catRT.pos.z + Math.cos(catRT.facing) * distance)
  catRT.jumpEnd.y = groundHeight(catRT.jumpEnd.x, catRT.jumpEnd.z)
  catRT.jumpHeight = height
  beginJump()
  return { duration: catRT.jumpDuration }
}) as never)

export const CompanionCat = (): React.ReactElement => {
  useEffect(() => {
    if (!debugEnabled()) return
    installCatJumpDev()
    installCatHoldDev()
    // QA: what the cat is doing (`__worldDev.cat()`), and asking her to go and do something of her own
    registerDevTool("cat", ((ask?: "water" | "friend") => {
      if (ask) { own.current.cooldown = 0; own.current.lastFriend = ""; ownAsk.current = ask }
      const d = catRT.pos.distanceTo(playerRT.pos)
      return { x: +catRT.pos.x.toFixed(2), y: +catRT.pos.y.toFixed(2), z: +catRT.pos.z.toFixed(2), state: catRT.state, own: catRT.own, swim: +catRT.swim.toFixed(2), wet: +catRT.wet.toFixed(2),
        aboard: catRT.aboard, ride: catRideRef.current.phase, boarding: catRideRef.current.boarding, fear: +catRT.rideFear.toFixed(2), wonder: +catRT.rideWonder.toFixed(2), dist: +d.toFixed(1), called: catRT.called, nav: catRT.navMode }
    }) as never)
  }, [])
  const group = useRef<THREE.Group>(null)
  const shadow = useRef<THREE.Mesh>(null)
  const purrLight = useRef(0)
  const autonomy = useRef<CompanionAutonomy>({
    cooldown: 3.5,
    duration: 0,
    mode: null,
    targetId: null,
    recentId: null,
    crouchTime: 0,
  })
  const followStyle = useRef<FollowStyle>({ mode: "behind", side: 1, timer: 4 })
  /**
   * A life of her own: a trip to the water (a drink, sometimes a paddle out
   * and back, a shake and a wash), or a visit to a cat friend (a nose-touch
   * hello, then sitting or napping together). Ordinary autonomy above is a
   * few seconds of distraction at the explorer's feet; this is the cat choosing to be
   * somewhere else for a while, within sight. Calling her always ends it.
   */
  const own = useRef({
    kind: null as null | "water" | "friend",
    phase: "" as "" | "go" | "drink" | "paddle" | "float" | "back" | "greet" | "together",
    t: 0, total: 0, cooldown: 24,
    bank: new THREE.Vector3(), spot: new THREE.Vector3(), face: 0,
    friendId: "" as string, friendSleeping: false, lastFriend: "" as string,
    /** she would rather stay with her friend than leave on this journey */
    stay: false,
    linger: 0,
    /** QA: this trip ends in a paddle */
    paddle: false,
  })
  const ownHold = useRef<CatState | null>(null)
  /** QA only: the next errand she picks (`__worldDev.cat("water")`) */
  const ownAsk = useRef<"" | "water" | "friend">("")
  const water = useMemo(() => makeWaterContact(), [])
  const endOwn = (): void => {
    const o = own.current
    if (!o.kind) return
    if (o.kind === "friend") o.lastFriend = o.friendId
    o.kind = null; o.phase = ""; o.stay = false; o.linger = 0
    o.cooldown = 22 + Math.random() * 30
    ownHold.current = null
    if (catRT.poiKind.startsWith("own-")) { catRT.poi = null; catRT.poiKind = "" }
    catNav.swim = false
  }
  const companionAgent = useMemo(
    () =>
      createAnimalAgent({
        id: "companion-cat",
        species: "companion-cat",
        mobility: "land",
        position: { x: catRT.pos.x, z: catRT.pos.z },
        seed: 15001,
        radius: CAT_RADIUS,
        walkSpeed: WALK_SPEED,
        runSpeed: RUN_SPEED,
        perception: 10,
        personalSpace: 0.7,
        playerSpace: 0.9,
        passive: true,
        interests: ["garden-cat", "rabbit", "ground-bird", "butterfly", "duck", "monkey"],
        personality: { curiosity: 0.88, caution: 0.42, sociability: 0.82, energy: 0.78, playfulness: 0.92 },
      }),
    [],
  )
  const showNavigation = useMemo(
    () => debugEnabled(),
    [],
  )
  const navDebugLine = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(64 * 3), 3))
    geometry.setDrawRange(0, 0)
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color: "#4a9f94",
        depthTest: false,
        transparent: true,
        opacity: 0.9,
      }),
    )
    line.visible = false
    line.frustumCulled = false
    line.renderOrder = 20
    return line
  }, [])

  const shadowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: groundShadowTexture(),
        transparent: true,
        depthWrite: false,
      }),
    [],
  )

  // --- the realistic rig ----------------------------------------------------
  const [model, setModel] = useState<AnimalModel | null>(null)
  const modelRef = useRef<AnimalModel | null>(null)
  const animatorRef = useRef<QuadrupedAnimator | null>(null)
  const collar = useMemo(() => makeCollar(), [])
  const blend = useMemo(() => createCompanionBlend(), [])
  const catRideRef = useRef({ phase: "off" as "off" | "hop" | "on" | "down", t: 0, clutch: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), land: new THREE.Vector3(), celestial: false, boarding: false, onTime: 0 })
  const rideMood = useMemo(() => makeRideMood(), [])
  const pose = useMemo<CompanionPoseScratch>(
    () => ({
      dt: 0,
      time: 0,
      speed: 0,
      turnRate: 0,
      sit: 0,
      sleep: 0,
      graze: 0,
      happy: 0,
      swim: 0,
      lookYaw: 0,
      lookPitch: 0,
      slope: 0,
      crossSlope: 0,
      fullIK: true,
      crouch: 0,
      stretch: 0,
      leap: 0,
      reach: 0,
    }),
    [],
  )
  const poseInput = useMemo<CompanionPoseInput>(
    () => ({
      state: "follow",
      speed: 0,
      turnRate: 0,
      explorerBearing: 0,
      navMode: "direct",
      affectionKind: "nuzzle",
      affectionPose: 0,
      slope: 0,
      crossSlope: 0,
    }),
    [],
  )
  const prevFacing = useRef(catRT.facing)
  const turnRate = useRef(0)
  /** her inner life between frames: moods, timers, the side she favours */
  const life = useRef({
    prevLightning: 0,
    prevFrightened: 0,
    wantRub: false,
    explorerWasMoving: false,
    rubAngle: 0,
    actSide: 1,
    tailSide: 1,
    slowBlinkTimer: 5,
    slowBlink: 0,
    wet: 0,
    voiced: 0,
    chatterCooldown: 0,
    petting: false,
    scaredUntil: 0,
    pounce: 0,
    /** commanded ground speed after acceleration limits (m/s) */
    cmdSpeed: 0,
    /** a wash follows the shake after a swim */
    postShakeGroom: false,
  })

  useLayoutEffect(() => registerAnimalAgent(companionAgent), [companionAgent])

  /** how loud she sounds to the listener (the camera), 0–1 */
  const loudness = useRef(1)
  const clock = useRef(0)
  const vocal = (kind: typeof catRT.vocal, plaintive = 0): void => {
    catRT.vocal = kind
    catRT.vocalTime = clock.current
    const loud = loudness.current
    if (kind === "meow") catVoice.meow(loud, plaintive)
    else if (kind === "trill") catVoice.trill(loud)
    else if (kind === "mew") catVoice.mew(loud)
    else if (kind === "chirp") catVoice.chatter(loud)
    else if (kind === "hiss") catVoice.hiss(loud)
  }

  /** One-off reactions on entering a state: voice, favoured side, placement. */
  const enterState = (next: CatState, prev: CatState): void => {
    const L = life.current
    const flip = (): 1 | -1 => (Math.random() < 0.5 ? -1 : 1)
    switch (next) {
      case "greet":
        catRT.called = false
        vocal("trill")
        break
      case "rub":
        L.rubAngle = Math.random() * Math.PI * 2
        if (prev !== "greet") vocal(Math.random() < 0.5 ? "trill" : "mew")
        break
      case "petted": {
        // a spot just in front of the explorer, facing her: the hand runs from the
        // top of her head down her back to the base of her tail
        const fx = Math.sin(playerRT.facing)
        const fz = Math.cos(playerRT.facing)
        petSpot.set(playerRT.pos.x + fx * 0.36, 0, playerRT.pos.z + fz * 0.36)
        catStep.x = petSpot.x
        catStep.z = petSpot.z
        resolveCollisions(catStep, CAT_RADIUS, navCircles, navRects, collideCat(catRT.pos.y))
        petSpot.set(catStep.x, 0, catStep.z)
        if (Math.random() < 0.5) vocal("mew")
        break
      }
      case "scared":
        vocal("hiss")
        break
      case "affectionApproach":
        if (Math.random() < 0.5) vocal("trill")
        break
      case "roll":
        L.actSide = flip()
        vocal("trill")
        break
      case "crouch":
        if (L.chatterCooldown <= 0 && Math.random() < 0.6) {
          vocal("chirp")
          L.chatterCooldown = 12
        }
        break
      case "groom":
      case "scratch":
        L.actSide = flip()
        break
      case "knead":
        if (Math.random() < 0.4) vocal("mew")
        break
      default:
        break
    }
    if (next === "sit" || next === "loaf" || next === "meow" || next === "petted") L.tailSide = flip()
  }

  useEffect(() => {
    let alive = true
    void makeAnimalModel("cat", COMPANION_COAT, 0).then((m) => {
      // A missing model is not fatal: the primitive cat stands in for her.
      if (!m) {
        console.warn("[companion] cat model unavailable; using the primitive cat")
        return
      }
      if (!alive) {
        disposeAnimalModel(m)
        return
      }
      // The animator captures the rig's rest transforms at identity, so it is
      // built before the root is scaled or parented — as the wildlife does it.
      animatorRef.current = new QuadrupedAnimator("cat", m, 15001)
      const neck = m.bones.get("neck")
      if (neck) neck.add(collar)
      modelRef.current = m
      setModel(m)
    })
    return () => {
      alive = false
      const current = modelRef.current
      if (current) {
        collar.removeFromParent()
        disposeAnimalModel(current)
      }
      modelRef.current = null
      animatorRef.current = null
    }
  }, [collar])

  useFrame((state, rawDt) => {
    const dt = Math.min(Math.max(rawDt, 1e-4), 1 / 20)
    const g = group.current
    if (!g) return
    // (aboard a mount she is carried wherever it goes, even a world away in one frame)
    if (!worldRT.introActive && !worldRT.finaleActive && catRideRef.current.phase === "off" && catRT.pos.distanceToSquared(avatarRT().pos) > 180 * 180) {
      g.visible = false
      if (shadow.current) shadow.current.visible = false
      navDebugLine.visible = false
      catVoice.purr(0)
      return
    }

    if (worldRT.introActive) {
      const progress = worldRT.introProgress
      const walkIn = smoothstep(0.792, 0.89, progress)
      const moving = progress >= 0.792 && progress < 0.89
      g.visible = progress >= 0.785
      catRT.pos.set(
        THREE.MathUtils.lerp(2.65, 0.88, walkIn),
        0,
        THREE.MathUtils.lerp(23.05, 22.9, walkIn),
      )
      catRT.pos.y = groundHeight(catRT.pos.x, catRT.pos.z)
      catRT.facing = THREE.MathUtils.lerp(-Math.PI * 0.56, -Math.PI * 0.47, walkIn)
      catRT.speed = moving ? 1.75 : 0
      catRT.state = moving ? "follow" : "sit"
      catRT.stateTime += dt
      catRT.walkPhase += dt * (moving ? 8.2 : 0.8)
      catRT.tailPhase += dt * 2.8
      catRT.vel.set(0, 0, 0)
      playerRT.catReaction = 0
      g.position.copy(catRT.pos)
      g.rotation.y = catRT.facing
      // The walk-in reads as her trotting up and settling, so it drives the
      // rig through exactly the same pose path as any other approach.
      poseInput.state = moving ? "follow" : "sit"
      poseInput.speed = catRT.speed
      poseInput.turnRate = 0
      poseInput.explorerBearing =
        Math.atan2(playerRT.pos.x - catRT.pos.x, playerRT.pos.z - catRT.pos.z) - catRT.facing
      poseInput.navMode = "direct"
      poseInput.affectionPose = 0
      poseInput.affectionKind = catRT.affectionKind
      poseInput.slope = 0
      poseInput.crossSlope = 0
      stepCompanionBlend(blend, poseInput, dt)
      composeCompanionPose(blend, poseInput, dt, state.clock.elapsedTime, pose)
      const introModel = modelRef.current
      if (introModel) {
        // the root lives inside the group, which already carries position/facing
        introModel.root.position.set(0, 0, 0)
        introModel.root.rotation.y = 0
        animatorRef.current?.update(pose)
      }
      if (shadow.current) {
        shadow.current.visible = g.visible
        shadow.current.position.set(
          catRT.pos.x,
          groundHeight(catRT.pos.x, catRT.pos.z) + 0.02,
          catRT.pos.z,
        )
      }
      navDebugLine.visible = false
      syncCompanionAgent(companionAgent)
      return
    }
    // ---- riding behind the explorer ------------------------------------------------
    // When the explorer rides, the cat hops up onto the croup behind the saddle: curled
    // into a relaxed loaf at the walk, crouched low and clutching (claws in,
    // ears back, tail wrapped round) once the horse quickens; she hops down
    // when the explorer gets off.
    {
      const r = riderRT.explorer
      const h = r.horse
      const ride = catRideRef.current
      // Starborn, the star-born, carries the cat too: her starlight veils a cat as
      // it veils her riders (StarVeil.tsx). The cat sees the departure coming
      // (The explorer climbing on), comes to Starborn's side and leaps up behind the
      // riders. A cat busy with a friend of her own may let her go, unless
      // she is called.
      const celestial = !!(h as { flight?: { spec: { celestial: boolean } } | null } | null)?.flight?.spec.celestial
      const flightMode = (h as HorseState | null)?.flight?.mode ?? "ground"
      const lowEnough = flightMode === "ground" || ((flightMode === "takeoff" || flightMode === "landing") && ((h as HorseState).flight!.alt ?? 0) < 1.2)
      const aboardWanted = (r.phase === "riding" || (h?.kind === "deer" || celestial) && r.phase === "mounting" && r.t > r.approach + 0.6) && !!h && !catRaceRT.active &&
        !(celestial && ride.phase === "off" && (own.current.stay && !catRT.called))
      catRT.aboard = ride.phase !== "off"
      const reach = celestial ? 2.4 : 12
      const toMount = h ? Math.hypot(catRT.pos.x - h.x, catRT.pos.z - h.z) : Infinity
      // coming to Starborn's side at a run before the leap
      ride.boarding = aboardWanted && ride.phase === "off" && celestial && lowEnough && toMount >= reach && toMount < 45
      if (aboardWanted && ride.phase === "off" && (celestial ? toMount < reach && lowEnough : catRT.pos.distanceTo(playerRT.pos) < 12)) {
        ride.phase = "hop"
        ride.t = 0
        ride.from.copy(catRT.pos)
        ride.celestial = celestial
        endOwn()
        catRT.called = false
      }
      if (ride.phase !== "off" && h) {
        ride.t += dt
        if (ride.celestial) catRidePoint(h, ride.to)
        else croupPoint(h, ride.to)
        if (!aboardWanted && ride.phase !== "down") {
          ride.phase = "down"
          ride.t = 0
          ride.from.copy(catRT.pos)
          // land beside the explorer's getting-off side
          ride.land.set(h.x + Math.cos(h.heading) * 1.0 * r.side, 0, h.z - Math.sin(h.heading) * 1.0 * r.side)
          ride.land.y = groundHeight(ride.land.x, ride.land.z)
        }
        if (ride.phase === "hop" || ride.phase === "down") {
          // up onto Starborn's tall back is a real leap: a gather, then ~1.6 m
          const hopDur = ride.celestial ? 0.78 : 0.55
          const u = Math.min(1, ride.t / hopDur)
          catRT.pos.lerpVectors(ride.from, ride.phase === "hop" ? ride.to : ride.land, u)
          const rise = Math.abs((ride.phase === "hop" ? ride.to.y : ride.land.y) - ride.from.y)
          catRT.pos.y += Math.sin(Math.PI * u) * (ride.celestial ? Math.max(0.55, rise * 0.35 + 0.35) : 0.55)
          if (ride.phase === "hop") catRT.facing = dampAngle(catRT.facing, Math.atan2(ride.to.x - ride.from.x, ride.to.z - ride.from.z), 10, dt)
          if (u >= 1) {
            if (ride.phase === "hop") { ride.phase = "on"; ride.onTime = 0 }
            else {
              ride.phase = "off"
              catRT.state = "sit"
              catRT.stateTime = 0
              catRT.navPath.length = 0
              catRT.navVersion++
            }
          }
          poseInput.state = "follow"
          poseInput.speed = 1.5
        } else {
          catRT.pos.copy(ride.to)
          const v = Math.abs(h.speed)
          const clutch = smoothstep(h.pose.speeds[0] * 1.15, h.pose.speeds[2], v) + (h.jumpT >= 0 ? 1 : 0)
          ride.clutch = THREE.MathUtils.damp(ride.clutch, Math.min(1, clutch), 5, dt)
          poseInput.state = ride.clutch > 0.5 ? "crouch" : "loaf"
          poseInput.speed = 0
        }
        if (ride.phase !== "off") {
          if (ride.phase !== "hop") catRT.facing = h.heading
          ride.onTime += dt
          catRT.speed = 0
          catRT.vel.set(0, 0, 0)
          catRT.state = "loaf"
          catRT.stateTime += dt
          catRT.purr = Math.max(0, 0.6 - ride.clutch)
          g.visible = cameraRT.distance > 1.65
          g.position.copy(catRT.pos)
          // she rides the mount's whole attitude: pitched into a climb, banked in a turn
          if (ride.phase === "on" && (h as HorseState).flight && (h as HorseState).flight!.mode !== "ground") g.quaternion.copy(mountQuaternion(h, _rideQ))
          else g.rotation.set(0, catRT.facing, 0)
          poseInput.turnRate = 0
          poseInput.explorerBearing = 0
          poseInput.navMode = "direct"
          poseInput.affectionPose = 0
          poseInput.slope = 0
          poseInput.crossSlope = 0
          stepCompanionBlend(blend, poseInput, dt)
          composeCompanionPose(blend, poseInput, dt, state.clock.elapsedTime, pose)
          // clutching: flatter, ears back, tail wrapped tight, claws hooked in
          const c = ride.clutch
          pose.crouch = Math.max(pose.crouch ?? 0, c * 0.85)
          pose.loaf = (pose.loaf ?? 0) * (1 - c)
          pose.earFlat = Math.max(pose.earFlat ?? 0, c * 0.55)
          pose.tailWrap = Math.max(pose.tailWrap ?? 0, 0.4 + c * 0.6)
          if(ride.phase==="hop"||ride.phase==="down"){
            const arc=Math.sin(Math.min(1,ride.t/.55)*Math.PI)
            pose.leap=arc*.85
            pose.loaf=0
            pose.tailWrap=0
            pose.earFlat=.18
          }
          pose.knead = c * 0.25
          pose.pupil = 0.35 + c * 0.5
          if (ride.celestial && ride.phase === "on") {
            // her own feelings about all this: fear, wonder, ease (catLife.ts)
            const hs = h as HorseState
            stepRideMood(rideMood, hs, dt, spaceRT.thin, Math.max(0, catRT.pos.y - groundHeight(catRT.pos.x, catRT.pos.z)), Math.random)
            applyRideMood(pose, rideMood, !!hs.flight && hs.flight.mode !== "ground")
            catRT.rideFear = rideMood.fear
            catRT.rideWonder = rideMood.wonder
          }
          pose.speed = 0
          const rideModel = modelRef.current
          if (rideModel) {
            rideModel.root.position.set(0, 0, 0)
            rideModel.root.rotation.y = 0
            animatorRef.current?.update(pose)
          }
          if (shadow.current) shadow.current.visible = false
              navDebugLine.visible = false
          playerRT.catReaction = 0
          catVoice.purr(catRT.purr * loudness.current)
          // where her head is: the star-veil closes round it out of the air
          const rm = modelRef.current
          const rhead = rm?.bones.get("head")
          if (rhead) { g.updateMatrixWorld(); rhead.getWorldPosition(catRT.headWorld) }
          else catRT.headWorld.set(catRT.pos.x - originRT.x, catRT.pos.y + 0.28, catRT.pos.z - originRT.z)
          syncCompanionAgent(companionAgent)
          return
        }
      }
    }
    g.visible = cameraRT.distance > 1.65
    g.rotation.set(0, g.rotation.y, 0)
    catRT.rideFear = 0
    catRT.rideWonder = 0
    if (catRideRef.current.phase === "off") rideMood.wasAirborne = false

    gatherNavColliders(catRT.pos.x, catRT.pos.z, dt)

    // --- trail record ---------------------------------------------------------
    if (!trail.length || trail[trail.length - 1].distanceToSquared(playerRT.pos) > 0.09) {
      trail.push(playerRT.pos.clone())
      if (trail.length > TRAIL_MAX) trail.shift()
    }

    // --- independent life -----------------------------------------------------
    // Scripted memory/finale POIs always win. Ordinary autonomy is temporary,
    // stays within a comfortable range of the explorer, and remembers its last target.
    const catAutonomy = autonomy.current
    catAutonomy.cooldown = Math.max(0, catAutonomy.cooldown - dt)
    const autonomyPoiActive = catRT.poiKind.startsWith("autonomy-")
    if (catAutonomy.mode && !autonomyPoiActive) {
      catAutonomy.mode = null
      catAutonomy.targetId = null
      catAutonomy.duration = 0
      catAutonomy.cooldown = Math.max(catAutonomy.cooldown, 5)
    }

    if (catAutonomy.mode && autonomyPoiActive) {
      catAutonomy.duration -= dt
      catAutonomy.crouchTime += dt
      const targetAgent = catAutonomy.targetId
        ? getAnimalAgent(catAutonomy.targetId)
        : undefined
      if (targetAgent && catRT.poi) catRT.poi.copy(targetAgent.position)

      const separation = catRT.pos.distanceTo(playerRT.pos)
      const targetMissing = catAutonomy.targetId !== null && !targetAgent
      const excursionFinished =
        catAutonomy.duration <= 0 ||
        targetMissing ||
        !catRT.poi ||
        separation > 8.8 ||
        worldRT.finaleActive
      if (excursionFinished) {
        if (catRT.poiKind.startsWith("autonomy-")) {
          catRT.poi = null
          catRT.poiKind = ""
        }
        catAutonomy.recentId = catAutonomy.targetId ?? catAutonomy.recentId
        catAutonomy.mode = null
        catAutonomy.targetId = null
        catAutonomy.cooldown = 7 + Math.random() * 8
        if (catRT.state === "chase" || catRT.state === "crouch" || catRT.state === "investigate") {
          catRT.state = separation > 4.5 ? "catchup" : "follow"
          catRT.stateTime = 0
        }
      } else if (catAutonomy.mode === "chase") {
        catRT.poiKind = catAutonomy.crouchTime < 0.72 ? "autonomy-crouch" : "autonomy-chase"
      }
    }

    const separationBeforeDecision = catRT.pos.distanceTo(playerRT.pos)
    const calmState =
      catRT.state === "follow" ||
      catRT.state === "sit" ||
      catRT.state === "lookAround" ||
      catRT.state === "stretch"
    if (
      !catAutonomy.mode &&
      !own.current.kind &&
      catAutonomy.cooldown <= 0 &&
      catRT.poi === null &&
      calmState &&
      separationBeforeDecision < 6.4 &&
      !worldRT.finaleActive &&
      playerRT.frightened < 0.35
    ) {
      if (animalWeatherIsThreatening()) {
        const shelter = nearestShelterPoint(catRT.pos)
        if (shelter.distanceTo(playerRT.pos) < 9.5) {
          catRT.poi = shelter
          catRT.poiKind = "autonomy-shelter"
          catAutonomy.mode = "shelter"
          catAutonomy.duration = 7 + Math.random() * 5
          catAutonomy.crouchTime = 0
        } else {
          catAutonomy.cooldown = 3
        }
      } else {
        const distraction = chooseCompanionDistraction(
          7.8,
          catAutonomy.recentId,
          Math.random(),
        )
        if (distraction) {
          catRT.poi = distraction.target.clone()
          catRT.poiKind = `autonomy-${distraction.kind}`
          catAutonomy.mode = distraction.kind
          catAutonomy.targetId = distraction.id
          catAutonomy.duration = 3.8 + Math.random() * (distraction.kind === "chase" ? 3.2 : 4.5)
          catAutonomy.crouchTime = 0
        } else {
          const nearbyInterests = CAT_ENVIRONMENT_INTERESTS.filter(
            (point) => point.distanceTo(catRT.pos) < 7.5 && point.distanceTo(playerRT.pos) < 9.5,
          )
          if (nearbyInterests.length > 0) {
            const interest = nearbyInterests[Math.floor(Math.random() * nearbyInterests.length)]
            catRT.poi = interest.clone()
            catRT.poiKind = "autonomy-investigate"
            catAutonomy.mode = "investigate"
            catAutonomy.targetId = null
            catAutonomy.duration = 4 + Math.random() * 4
            catAutonomy.crouchTime = 0
          } else {
            catAutonomy.cooldown = 2.5
          }
        }
      }
    }

    // --- a life of her own -------------------------------------------------------
    {
      const o = own.current
      catRT.own = o.kind ? `${o.kind}:${o.phase}` : ""
      // she swims after the explorer, and through water she is already in
      const explorerInWater = waterBodyRT.swim > 0.5 || waterBodyRT.wade > 0.35
      o.cooldown -= dt
      o.t += dt
      const sep = catRT.pos.distanceTo(playerRT.pos)
      ownHold.current = null
      const riding = riderRT.explorer.phase !== "none"
      // the leash is long while the explorer lingers, shorter when she walks on;
      // a cat finishing what she started catches up a moment later
      const leash = playerRT.moving ? (o.kind === "friend" ? 17 : 14) : 28
      if (o.kind && (catRT.called || worldRT.finaleActive || catRaceRT.active || catRT.state === "scared" || life.current.petting ||
        (riding && !o.stay) || (o.kind === "water" && waterUnwelcoming() && o.phase !== "back"))) {
        if (o.kind === "water" && water.inWater) { o.phase = "back"; o.t = 0; catRT.poi = o.bank.clone(); catRT.poiKind = "own-water" }
        if (!(o.kind === "water" && o.phase === "back" && !catRT.called)) endOwn()
      }
      if (o.kind && sep > leash) {
        o.linger += dt
        if (o.linger > 3 + (o.kind === "friend" ? 3 : 0)) endOwn()
      } else o.linger = 0
      if (o.kind && o.total > 0 && o.t > o.total + 40) endOwn()

      // choosing: only from calm, near the explorer, nothing scripted going on
      const calmNow = catRT.state === "follow" || catRT.state === "sit" || catRT.state === "lookAround" || catRT.state === "loaf" || catRT.state === "groom"
      if (!o.kind && o.cooldown <= 0 && calmNow && !riding && catRT.poi === null && sep < 7 && !worldRT.finaleActive && !worldRT.introActive && playerRT.frightened < 0.3) {
        o.cooldown = 6 + Math.random() * 8
        const idle = playerRT.idleTime > 6 ? 1 : 0
        const roll = Math.random()
        // a friend: the wild cats about the world, or the garden cats at home
        let friend: { id: string; x: number; z: number; sleeping: boolean } | null = null
        let best = 22
        for (const a of wildlifeRT.walkers.values()) {
          if (a.species !== "cat" || a.id === o.lastFriend || a.state === "flee") continue
          const d = Math.hypot(a.x - catRT.pos.x, a.z - catRT.pos.z)
          if (d < best && Math.hypot(a.x - playerRT.pos.x, a.z - playerRT.pos.z) < 24) { best = d; friend = { id: `w:${a.id}`, x: a.x, z: a.z, sleeping: a.state === "sleep" } }
        }
        if (!friend) for (const ga of animalAgentsOf("garden-cat")) {
          if (ga.id === o.lastFriend || ga.activity === "flee") continue
          const d = Math.hypot(ga.position.x - catRT.pos.x, ga.position.z - catRT.pos.z)
          if (d < best && d < 16) { best = d; friend = { id: ga.id, x: ga.position.x, z: ga.position.z, sleeping: ga.activity === "rest" } }
        }
        const asked = ownAsk.current
        ownAsk.current = ""
        if (friend && asked !== "water" && (asked === "friend" || roll < 0.5 + idle * 0.25)) {
          o.kind = "friend"; o.phase = "go"; o.t = 0; o.total = 14 + Math.random() * 22 + idle * 12
          o.friendId = friend.id; o.friendSleeping = friend.sleeping
          catRT.poi = new THREE.Vector3(friend.x, 0, friend.z); catRT.poiKind = "own-friend"
          // now and then she would rather stay with her friend than go flying
          o.stay = Math.random() < 0.3
        } else if (!waterUnwelcoming() && (asked === "water" || roll < 0.8)) {
          // water within a short walk: a lake shore, the river, or home's pond and creek
          let bank: { x: number; z: number; face: number } | null = null
          const shore = findShore(catRT.pos.x, catRT.pos.z, (x, z) => creatureWaterSurfaceAt(x, z) === null && Math.hypot(x - playerRT.pos.x, z - playerRT.pos.z) < 20)
          if (shore) bank = shore
          else {
            let bd = 18
            for (const pnt of homeDrinkPoints()) {
              const d = Math.hypot(pnt.x - catRT.pos.x, pnt.z - catRT.pos.z)
              if (d < bd && Math.hypot(pnt.x - playerRT.pos.x, pnt.z - playerRT.pos.z) < 20) { bd = d; bank = pnt }
            }
          }
          if (bank && (asked === "water" || Math.random() < 0.35 + waterInvitation(worldRT.timeOfDay) * 0.6)) {
            o.kind = "water"; o.phase = "go"; o.t = 0; o.total = 30; o.paddle = asked === "water"
            o.bank.set(bank.x, 0, bank.z); o.face = bank.face
            catRT.poi = o.bank.clone(); catRT.poiKind = "own-water"
          }
        }
      }

      if (o.kind === "friend") {
        const wild = o.friendId.startsWith("w:") ? wildlifeRT.walkers.get(o.friendId.slice(2)) : undefined
        const garden = wild ? undefined : getAnimalAgent(o.friendId)
        const fx = wild ? wild.x : garden?.position.x, fz = wild ? wild.z : garden?.position.z
        if (fx === undefined || fz === undefined) endOwn()
        else {
          const fd = Math.hypot(fx - catRT.pos.x, fz - catRT.pos.z)
          const fh = wild ? wild.heading : garden!.heading
          if (o.phase === "go" && !catRT.poi) {
            // something else called her away (the finale, a call home): the visit is over
            endOwn()
          } else if (o.phase === "go" && catRT.poi) {
            // up to her friend's face for the nose-touch
            catRT.poi.set(fx + Math.sin(fh) * 0.5, 0, fz + Math.cos(fh) * 0.5)
            if (fd < 0.75 || catRT.pos.distanceTo(catRT.poi) < 0.3) { o.phase = "greet"; o.t = 0; catRT.poi = null }
            // the friend notices her coming and waits
            if (wild && fd < 6 && wild.state !== "sleep") { wild.state = "sit"; wild.timer = Math.max(wild.timer, 6); wild.targetSpeed = 0 }
          } else {
            const toF = Math.atan2(fx - catRT.pos.x, fz - catRT.pos.z)
            catRT.facing = dampAngle(catRT.facing, o.phase === "greet" ? toF : toF + 0.9, 4, dt)
            if (wild) {
              // the friend answers: turns to her, settles, purrs at her (happy)
              if (wild.state !== "sleep") { wild.state = "sit"; wild.timer = Math.max(wild.timer, 4); wild.targetSpeed = 0 }
              wild.heading += Math.atan2(Math.sin(toF + Math.PI - wild.heading), Math.cos(toF + Math.PI - wild.heading)) * Math.min(1, dt * 2)
              wild.happy = Math.max(wild.happy, 0.6)
            }
            if (o.phase === "greet") {
              ownHold.current = "lookAround"
              if (o.t > 1.8) { o.phase = "together"; o.t = 0 }
            } else {
              // side by side: a loaf, a wash, a nap beside a sleeping friend
              const cycle = Math.floor(o.t / 7) % 3
              ownHold.current = o.friendSleeping ? (o.t > 3 ? "sleep" : "loaf") : cycle === 0 ? "loaf" : cycle === 1 ? "groom" : "sit"
              if (o.t > o.total) endOwn()
            }
          }
        }
      }
      catNav.swim = explorerInWater || water.inWater || (o.kind === "water" && (o.phase === "paddle" || o.phase === "float" || o.phase === "back"))
      if (o.kind === "water") {
        if (o.phase === "go") {
          if (catRT.pos.distanceTo(o.bank) < 0.45) { o.phase = "drink"; o.t = 0; catRT.poi = null }
        } else if (o.phase === "drink") {
          // lapping at the edge, head low over the water
          catRT.facing = dampAngle(catRT.facing, o.face, 4, dt)
          ownHold.current = "investigate"
          if (Math.floor(o.t * 2.6) !== Math.floor((o.t - dt) * 2.6)) {
            emitRipple(catRT.pos.x + Math.sin(catRT.facing) * 0.42, catRT.pos.z + Math.cos(catRT.facing) * 0.42, 0.08, 1)
          }
          if (o.t > 4 + Math.random() * 0.02) {
            // and sometimes in she goes, for the joy of it
            const spot = o.paddle || Math.random() < CAT_WATER.love * (0.4 + waterInvitation(worldRT.timeOfDay) * 0.9)
              ? pickWaterSpot(o.bank.x, o.bank.z, o.face, CAT_WATER, 1, Math.random() < 0.55, Math.random) : null
            if (spot) { o.phase = "paddle"; o.t = 0; o.spot.set(spot.x, 0, spot.z); catRT.poi = o.spot.clone(); catRT.poiKind = "own-water" }
            else endOwn()
          }
        } else if (o.phase === "paddle") {
          if (catRT.pos.distanceTo(o.spot) < 0.4 || o.t > 14) { o.phase = "float"; o.t = 0; catRT.poi = null }
        } else if (o.phase === "float") {
          // treading water, looking about, then turning for the bank
          ownHold.current = "lookAround"
          if (o.t > 2.5 + Math.random() * 0.02) { o.phase = "back"; o.t = 0; catRT.poi = o.bank.clone(); catRT.poiKind = "own-water" }
        } else if (o.phase === "back") {
          if (!water.inWater && (catRT.pos.distanceTo(o.bank) < 0.6 || o.t > 16)) {
            endOwn()
            // on the bank: the shake, then a careful wash
            if (water.wet > 0.3) {
              catRT.state = "shake"; catRT.stateTime = 0; life.current.postShakeGroom = true
              shakeOffWater(water, CAT_WATER, 1, catRT.pos.x, catRT.pos.z, groundHeight(catRT.pos.x, catRT.pos.z))
              life.current.wet = 0
            }
          }
        }
      }
    }

    // --- state ----------------------------------------------------------------
    catRT.stateTime += dt
    catRT.affectionCooldown = Math.max(0, catRT.affectionCooldown - dt)
    const dist = catRT.pos.distanceTo(playerRT.pos)
    const atPoi = catRT.poi ? catRT.pos.distanceTo(catRT.poi) < 0.5 : false
    // her own errands decide for themselves when she has arrived
    const ownPoi = catRT.poiKind.startsWith("own-")
    const atAffectionSpot = catRT.pos.distanceTo(catRT.affectionTarget) < 0.14
    const affectionReady =
      (playerRT.idleTime >= AFFECTION_IDLE_DELAY || playerRT.frightened > 0.35) &&
      catRT.affectionCooldown <= 0 &&
      catRT.swim < 0.2 &&
      dist <= 3.2
    const poiMode =
      catRT.poiKind === "autonomy-crouch"
        ? "crouch"
        : catRT.poiKind === "autonomy-chase"
          ? "chase"
          : "investigate"
    const previousState = catRT.state
    const L = life.current
    const now = state.clock.elapsedTime

    // The explorer stopping is the moment a cat decides whether to sit or weave round
    // her legs; roll that once per stop rather than every frame.
    if (L.explorerWasMoving && !playerRT.moving) L.wantRub = Math.random() < 0.38
    L.explorerWasMoving = playerRT.moving

    // thunder: the flash and the explorer's own startle both reach her
    const flash = worldRT.lightning > 0.5 && L.prevLightning <= 0.5
    const startle = playerRT.frightened > 0.9 && L.prevFrightened <= 0.9
    L.prevLightning = worldRT.lightning
    L.prevFrightened = playerRT.frightened
    const scaredNow = (flash || startle) && catRT.state !== "scared" && !worldRT.introActive
    if (scaredNow) L.scaredUntil = now + (ACTION_DURATION.scared ?? 3)

    // petting: E beside her starts it; it lasts as long as the explorer's pet gesture
    if (input.interact && companionPettable() && !discoveryRT.animalPrompt && !discoveryRT.horsePrompt) {
      input.interact = false
      L.petting = true
      playerRT.gesture = "pet"
      playerRT.gestureTime = 0
      playerRT.paused = true
      playerRT.vel.set(0, 0, 0)
      playerRT.facing = Math.atan2(catRT.pos.x - playerRT.pos.x, catRT.pos.z - playerRT.pos.z)
    }
    if (L.petting && playerRT.gesture !== "pet") L.petting = false

    // calling her: "pspsps" with a beckoning hand
    if (input.call) {
      input.call = false
      const mount = riderRT.explorer.horse as HorseState | null
      // in the air C is the descent; mounted on the ground it calls her up
      const mountedGround = riderRT.explorer.phase === "riding" && (!mount?.flight || mount.flight.mode === "ground")
      if (characterRT.active === catRT.owner && !characterRT.switching && !worldRT.introActive && !worldRT.finaleActive) {
        if (!playerRT.paused && playerRT.gesture === "none") {
          playerRT.gesture = "call"
          playerRT.gestureTime = 0
          callCat()
          catRT.called = true
        } else if (mountedGround) catRT.called = true
      }
      if (catRT.called) {
        // whatever held her attention, the explorer comes first
        endOwn()
        if (catRT.poiKind.startsWith("autonomy-")) { catRT.poi = null; catRT.poiKind = "" }
      }
    }

    const actionTime = ACTION_DURATION[catRT.state]
    const hold = showNavigation && catRT.debugHold !== "" ? catRT.debugHold : ownHold.current
    if (hold && catRT.state !== hold) {
      catRT.state = hold
      catRT.stateTime = 0
      enterState(hold, "follow")
    }
    const next = hold ?? catNextState(catRT.state, {
      distToPlayer: dist,
      playerMoving: playerRT.moving,
      playerIdleTime: playerRT.idleTime,
      hasPoi: catRT.poi !== null,
      finale: worldRT.finaleActive || catRaceRT.active,
      atPoi: atPoi && !ownPoi,
      affectionReady,
      atAffectionSpot,
      affectionComplete: catRT.stateTime >= AFFECTION_DURATION,
      poiMode,
      scared: scaredNow,
      scaredDone: now > L.scaredUntil,
      petting: L.petting,
      called: catRT.called,
      actionDone:
        catRT.state === "rub"
          ? catRT.stateTime > RUB_DURATION
          : actionTime !== undefined && catRT.stateTime > actionTime,
      wantRub: L.wantRub,
    })
    if (next !== catRT.state) {
      catRT.state = next
      catRT.stateTime = 0
      if (next === "sit" && atPoi && poiMode === "investigate") {
        catRT.poi = null
      }
      if (next === "affectionApproach") {
        const preferredSide = Math.random() < 0.5 ? -1 : 1
        placeAffectionTarget(preferredSide)
        catRT.affectionKind =
          catRT.affectionCount === 0
            ? Math.random() < 0.5
              ? "nuzzle"
              : "paw"
            : catRT.affectionKind === "nuzzle"
              ? "paw"
              : "nuzzle"
      }
      if (previousState === "affection" && next === "sit") {
        catRT.affectionCount++
        catRT.affectionCooldown = 8 + Math.random() * 5
      } else if (
        (previousState === "affection" || previousState === "affectionApproach") &&
        next === "follow"
      ) {
        catRT.affectionCooldown = Math.max(catRT.affectionCooldown, 3)
      }
      if (next === "sit" || next === "sleep" || next === "lookAround" || next === "stretch") {
        catRT.behaviorTimer = 2 + Math.random() * 3.5
      }
      if (next === "groom") catRT.behaviorTimer = 5 + Math.random() * 3
      if (next === "knead") catRT.behaviorTimer = 4 + Math.random() * 2.5
      if (next === "roll") catRT.behaviorTimer = 4 + Math.random() * 2.5
      if (next === "loaf") catRT.behaviorTimer = 6 + Math.random() * 6
      enterState(next, previousState)
    }
    // after a swim: the shake, then a careful wash
    if (previousState === "shake" && catRT.state !== "shake" && L.postShakeGroom) {
      L.postShakeGroom = false
      catRT.state = "groom"; catRT.stateTime = 0; catRT.behaviorTimer = 6 + Math.random() * 3
      enterState("groom", "shake")
    }
    // afloat she treads water and looks about; nobody sits or naps on a lake
    if (catRT.swim > 0.5 && isRestingState(catRT.state) && catRT.state !== "lookAround") {
      catRT.state = "lookAround"; catRT.stateTime = 0
    }
    // a call is always answered: she comes as soon as she can (a fright or a
    // hand on her back first); only the finale's own run takes precedence
    if (catRT.called && (worldRT.finaleActive || catRaceRT.active)) catRT.called = false

    // idle behaviour rotation while the explorer rests — weather nudges toward shade/sleep when hot or rainy
    // rain soaks her; once it stops she shakes it off
    if (weatherRT.rain > 0.35) L.wet = Math.min(1, L.wet + dt * 0.15)
    else L.wet = Math.max(0, L.wet - dt * 0.01)
    L.wet = Math.max(L.wet, water.wet)
    if (!hold && L.wet > 0.5 && weatherRT.rain < 0.08 && !water.inWater && isRestingState(catRT.state) && catRT.state !== "shake") {
      L.wet = 0
      if (water.wet > 0.3) { shakeOffWater(water, CAT_WATER, 1, catRT.pos.x, catRT.pos.z, groundHeight(catRT.pos.x, catRT.pos.z)); L.postShakeGroom = true }
      catRT.state = "shake"
      catRT.stateTime = 0
    }
    L.chatterCooldown = Math.max(0, L.chatterCooldown - dt)

    const rotating =
      catRT.state === "sit" || catRT.state === "lookAround" || catRT.state === "stretch" ||
      catRT.state === "groom" || catRT.state === "knead" || catRT.state === "roll" || catRT.state === "loaf"
    if (!hold && rotating && catRT.stateTime > catRT.behaviorTimer) {
      const heatBias = weatherRT.heat * 0.32
      const rainBias = weatherRT.rain > 0.45 ? 0.22 : 0
      const roll = Math.random() - heatBias - rainBias
      const sleepThreshold = playerRT.idleTime > 13 ? 0.5 + heatBias * 0.5 : 0
      // a cat about to nap yawns first
      const picked: CatState = roll < sleepThreshold ? "sleep" : pickIdleBehavior(playerRT.idleTime, Math.max(0, roll))
      const prevIdle = catRT.state
      catRT.state = picked === "sleep" && prevIdle !== "loaf" ? "yawn" : picked
      catRT.stateTime = 0
      enterState(catRT.state, prevIdle)
      // Hot/rainy weather makes idle stretches longer and lazier
      const lazy = 1 + weatherRT.heat * 0.6 + weatherRT.rain * 0.4
      catRT.behaviorTimer = (2.5 + Math.random() * 3) * lazy
    }

    const style = followStyle.current
    style.timer -= dt
    if (style.timer <= 0 && !catAutonomy.mode) {
      const roll = Math.random()
      style.mode = roll < 0.48 ? "behind" : roll < 0.82 ? "beside" : "ahead"
      style.side = Math.random() < 0.5 ? -1 : 1
      style.timer = 5 + Math.random() * 8
    }

    // coming to Starborn for the journey: a run to her side, then the leap
    const boardingMount = catRideRef.current.boarding ? riderRT.explorer.horse : null
    if (boardingMount && catRT.state !== "scared") {
      if (catRT.state !== "catchup") { catRT.state = "catchup"; catRT.stateTime = 0 }
    }

    // --- desired target ---------------------------------------------------------
    let speed: number
    let arrive = false
    switch (catRT.state) {
      case "follow":
        if (style.mode === "behind") {
          trailPoint(1.55 + (style.side > 0 ? 0.35 : 0), target)
        } else {
          const forwardX = Math.sin(playerRT.facing)
          const forwardZ = Math.cos(playerRT.facing)
          const rightX = forwardZ
          const rightZ = -forwardX
          const sideOffset = style.side * (style.mode === "ahead" ? 0.72 : 0.92)
          const forwardOffset = style.mode === "ahead" ? 1.05 : -0.18
          target.set(
            playerRT.pos.x + forwardX * forwardOffset + rightX * sideOffset,
            0,
            playerRT.pos.z + forwardZ * forwardOffset + rightZ * sideOffset,
          )
        }
        // Match the explorer's pace and make up any lag, so following never turns
        // into a walk–sprint–walk cycle.
        speed = THREE.MathUtils.clamp(
          Math.max(WALK_SPEED * 0.75, playerRT.speed * 1.06) + Math.max(0, dist - 2.2) * 0.9,
          0,
          RUN_SPEED,
        )
        break
      case "catchup":
        trailPoint(1.0, target)
        speed = THREE.MathUtils.clamp(playerRT.speed + 2.2 + dist * 0.22, WALK_SPEED, SPRINT_SPEED)
        break
      case "affectionApproach":
        target.copy(catRT.affectionTarget)
        speed = AFFECTION_APPROACH_SPEED
        break
      case "affection":
        target.copy(catRT.affectionTarget)
        speed = 0
        arrive = true
        break
      case "investigate":
      case "runAhead":
        if (catRT.poi) target.copy(catRT.poi)
        speed = catRT.state === "runAhead" ? (catRaceRT.active ? catRaceRT.speed : RUN_SPEED) : WALK_SPEED
        if (atPoi) {
          speed = 0
          if (catRT.state === "investigate" && !ownPoi) {
            catRT.poi = null // sniffed it; linger a moment then resume
            catRT.state = "sit"
            catRT.stateTime = 0
            catRT.behaviorTimer = 1.6
          } else {
            arrive = true
          }
        }
        break
      case "chase":
      case "crouch":
        if (catRT.poi) target.copy(catRT.poi)
        speed = catRT.state === "crouch" ? 0.45 : RUN_SPEED
        break
      case "greet": {
        // trot up to her feet, on the side she is coming from; from far off
        // she runs, and from very far she gallops
        const dx = catRT.pos.x - playerRT.pos.x
        const dz = catRT.pos.z - playerRT.pos.z
        const d = Math.max(1e-3, Math.hypot(dx, dz))
        target.set(playerRT.pos.x + (dx / d) * 0.55, 0, playerRT.pos.z + (dz / d) * 0.55)
        speed = dist > 22 ? SPRINT_SPEED : dist > 9 ? RUN_SPEED : dist > 3 ? RUN_SPEED * 0.55 : WALK_SPEED * 0.8
        break
      }
      case "rub": {
        // a figure-eight through and around the explorer's legs
        L.rubAngle += dt * 0.95
        const a = L.rubAngle
        const lx = Math.sin(a) * 0.46
        const lz = Math.sin(a) * Math.cos(a) * 0.42 + 0.06
        const fx = Math.sin(playerRT.facing)
        const fz = Math.cos(playerRT.facing)
        target.set(playerRT.pos.x + fz * lx + fx * lz, 0, playerRT.pos.z - fx * lx + fz * lz)
        speed = 0.7
        break
      }
      case "petted":
        target.copy(petSpot)
        speed = catRT.pos.distanceTo(petSpot) > 0.14 ? 1.2 : 0
        arrive = speed === 0
        break
      case "scared": {
        // bolt for the shelter of the explorer's legs, then stand arched facing out
        trailPoint(0.42, target)
        speed = catRT.pos.distanceTo(target) > 0.3 ? RUN_SPEED * 0.75 : 0
        break
      }
      default:
        // sitting / sleeping / stretching — hold position
        target.copy(catRT.pos)
        speed = 0
        arrive = true
    }

    if (hold) {
      target.copy(catRT.pos)
      speed = 0
    }
    if (boardingMount && catRT.state === "catchup") {
      const bx = catRT.pos.x - boardingMount.x, bz = catRT.pos.z - boardingMount.z
      const bl = Math.max(1e-3, Math.hypot(bx, bz))
      target.set(boardingMount.x + bx / bl * 1.3, 0, boardingMount.z + bz / bl * 1.3)
      speed = bl > 8 ? RUN_SPEED : RUN_SPEED * 0.6
    }
    // swimming is a steady, strong paddle (head high, chin clear)
    if (catRT.swim > 0.4) speed = Math.min(speed, 1.65)
    // Speed changes are physical: she gathers into a run and settles out of it.
    {
      const L2 = life.current
      const rate = speed > L2.cmdSpeed ? CAT_ACCEL : CAT_DECEL
      L2.cmdSpeed = speed > L2.cmdSpeed
        ? Math.min(speed, L2.cmdSpeed + rate * dt)
        : Math.max(speed, L2.cmdSpeed - rate * dt)
      // arrive softly instead of stopping dead on the target
      const remaining = Math.hypot(target.x - catRT.pos.x, target.z - catRT.pos.z)
      const brake = Math.sqrt(2 * CAT_DECEL * Math.max(0, remaining - 0.1))
      speed = speed > 0 ? Math.max(Math.min(L2.cmdSpeed, brake), Math.min(speed, 0.5)) : 0
      if (speed === 0) L2.cmdSpeed = Math.min(L2.cmdSpeed, 0.5)
    }

    // Separation recovery. Ordinary separation is handled by running; she only
    // rejoins along the explorer's trail when she is far behind AND nobody can see it.
    // A race takes her out of sight on purpose, so she is not called back.
    const lost = !catRaceRT.active && dist > 30 && (dist > 90 || !onScreen(state.camera, catRT.pos.x, catRT.pos.y, catRT.pos.z))
    if (lost || !Number.isFinite(catRT.pos.x + catRT.pos.y + catRT.pos.z)) {
      // the furthest trail point (up to ~30 m back) that is out of view
      let placed = false
      for (const back of [26, 20, 15, 11]) {
        trailPoint(back, target)
        const y = groundHeight(target.x, target.z)
        if (!onScreen(state.camera, target.x, y, target.z, 0.8)) { placed = true; break }
      }
      if (!placed) trailPoint(8, target)
      catStep.x = target.x
      catStep.z = target.z
      resolveCollisions(catStep, CAT_RADIUS, navCircles, navRects, collideCat(groundHeight(target.x, target.z)))
      target.x = catStep.x
      target.z = catStep.z
      target.y = groundHeight(target.x, target.z)
      catRT.pos.copy(target)
      clearNavigation()
      // she arrives already running, facing the explorer
      catRT.facing = Math.atan2(playerRT.pos.x - catRT.pos.x, playerRT.pos.z - catRT.pos.z)
      life.current.cmdSpeed = RUN_SPEED * 0.8
      if (catRT.state !== "catchup") {
        catRT.state = "catchup"
        catRT.stateTime = 0
      }
    }

    if (catRT.navMode === "jump") {
      const oldX = catRT.pos.x
      const oldZ = catRT.pos.z
      catRT.jumpTime += dt
      // Once off the ground she is ballistic: constant speed across, a true
      // gravity parabola up and down (no easing that would float her).
      const jumpT = Math.min(1, Math.max(0, catRT.jumpTime) / catRT.jumpDuration)
      catRT.pos.x = THREE.MathUtils.lerp(catRT.jumpStart.x, catRT.jumpEnd.x, jumpT)
      catRT.pos.z = THREE.MathUtils.lerp(catRT.jumpStart.z, catRT.jumpEnd.z, jumpT)
      catRT.pos.y =
        THREE.MathUtils.lerp(catRT.jumpStart.y, catRT.jumpEnd.y, jumpT) +
        4 * catRT.jumpHeight * jumpT * (1 - jumpT)
      catRT.vel.x = (catRT.pos.x - oldX) / dt
      catRT.vel.z = (catRT.pos.z - oldZ) / dt
      catRT.speed = Math.hypot(catRT.vel.x, catRT.vel.z)
      if (catRT.speed > 0.02) {
        catRT.facing = dampAngle(
          catRT.facing,
          Math.atan2(catRT.vel.x, catRT.vel.z),
          14,
          dt,
        )
      }
      if (jumpT >= 1) {
        // her falling speed at touchdown sets how deep the legs give
        const fall = 4 * catRT.jumpHeight / catRT.jumpDuration - (catRT.jumpEnd.y - catRT.jumpStart.y) / catRT.jumpDuration
        catRT.landTime = 0
        catRT.landImpact = Math.min(1.3, Math.max(0, fall) / 3.2)
        catRT.navMode = "direct"
        catRT.navRepathTime = 0
        catRT.detectedObstacle = ""
        catRT.navVersion++
      }
    } else if (speed > 0) {
      catRT.navRepathTime -= dt
      const directClear = segmentHasClearance(catRT.pos, target, CAT_RADIUS, navCircles, navRects)
      // a sprinting cat's goal moves every frame; only re-plan for real changes
      const replanDistance = 0.85 + speed * 0.12
      const goalMoved = catRT.navTarget.distanceToSquared(target) > replanDistance * replanDistance

      if (catRT.navMode === "jumpApproach") {
        let activeNavMode: CatNavMode = catRT.navMode
        if (goalMoved && catRT.navRepathTime <= 0) activeNavMode = planNavigation(target)
        if (activeNavMode === "jumpApproach") {
          navigationTarget.copy(catRT.jumpStart)
          if (catRT.pos.distanceToSquared(catRT.jumpStart) < 0.14 * 0.14) beginJump()
        } else if (activeNavMode === "path") {
          selectPathTarget()
        }
      } else if (directClear) {
        clearNavigation()
        catRT.navTarget.copy(target)
        navigationTarget.copy(target)
      } else {
        let activeNavMode: CatNavMode = catRT.navMode
        if (
          catRT.navMode !== "path" ||
          (goalMoved && catRT.navRepathTime <= 0) ||
          (catRT.navIndex >= catRT.navPath.length && catRT.navRepathTime <= 0)
        ) {
          activeNavMode = planNavigation(target)
        }

        if (activeNavMode === "jumpApproach") {
          navigationTarget.copy(catRT.jumpStart)
          if (catRT.pos.distanceToSquared(catRT.jumpStart) < 0.14 * 0.14) beginJump()
        } else if (activeNavMode === "path") {
          selectPathTarget()
        }
      }

      if ((catRT.navMode as CatNavMode) !== "jump") {
        toTarget.subVectors(navigationTarget, catRT.pos)
        toTarget.y = 0
        const d = toTarget.length()
        if (d > 0.12) {
          toTarget.divideScalar(d)
          const step = Math.min(speed * dt, d)
          const oldX = catRT.pos.x
          const oldZ = catRT.pos.z
          catStep.x = oldX + toTarget.x * step
          catStep.z = oldZ + toTarget.z * step
          resolveCollisions(catStep, CAT_RADIUS, navCircles, navRects, collideCat(catRT.pos.y))
          catRT.pos.x = catStep.x
          catRT.pos.z = catStep.z
          catRT.vel.x = (catRT.pos.x - oldX) / dt
          catRT.vel.z = (catRT.pos.z - oldZ) / dt
          catRT.speed = Math.hypot(catRT.vel.x, catRT.vel.z)
          if (catRT.speed < speed * 0.12 && d > 0.3) {
            catRT.navStuckTime += dt
            if (catRT.navStuckTime > 0.32) {
              catRT.navMode = "direct"
              catRT.navPath.length = 0
              catRT.navRepathTime = 0
              catRT.navStuckTime = 0
              catRT.detectedObstacle = "stuck · replanning"
              catRT.navVersion++
            }
          } else {
            catRT.navStuckTime = Math.max(0, catRT.navStuckTime - dt * 2)
          }
          if (catRT.speed > 0.02) {
            catRT.facing = dampAngle(
              catRT.facing,
              Math.atan2(catRT.vel.x, catRT.vel.z),
              10,
              dt,
            )
          }
        } else {
          catRT.speed = 0
        }
      }
    } else {
      clearNavigation()
      catRT.speed = 0
      const st = catRT.state
      if (st === "scared") {
        // backed against the explorer's legs, facing whatever frightened her
        catRT.facing = dampAngle(catRT.facing, playerRT.facing, 6, dt)
      } else if (
        !own.current.kind && (
          st === "sit" || st === "sleep" || st === "affection" || st === "meow" || st === "petted" ||
          st === "loaf" || st === "knead" || st === "yawn" || st === "greet")
      ) {
        // Face the explorer while resting or asking for pets.
        const dx = playerRT.pos.x - catRT.pos.x
        const dz = playerRT.pos.z - catRT.pos.z
        if (dx * dx + dz * dz > 0.04) {
          catRT.facing = dampAngle(catRT.facing, Math.atan2(dx, dz), 3, dt)
        }
      }
    }

    {
      // water against her: wading on the bed, afloat out of her depth
      const bed = groundHeight(catRT.pos.x, catRT.pos.z)
      stepWaterContact(water, CAT_WATER, 1, catRT.pos.x, catRT.pos.z, bed, catRT.facing, catRT.speed, dt, true)
      const wy = creatureWaterY(catRT.pos.x, catRT.pos.z, CAT_WATER, 1, bed)
      catRT.swim = damp(catRT.swim, wy.swim, 4, dt)
      catRT.wet = water.wet
      if (catRT.navMode !== "jump") {
        const bob = wy.swim > 0 ? Math.sin(now * Math.PI * 2 * CAT_WATER.stroke * 0.5) * 0.008 : 0
        catRT.pos.y = damp(catRT.pos.y, wy.y + bob, wy.swim > 0 ? 6 : 14, dt)
      }
    }
    catRT.walkPhase += catRT.speed * dt * 3.2
    catRT.landTime += dt
    catRT.tailPhase += dt * (catRT.state === "sleep" ? 1.2 : 3)

    // --- presentation -----------------------------------------------------------
    g.position.copy(catRT.pos)
    g.rotation.y = catRT.facing

    const s = catRT.state
    const affectionPose =
      s === "affection"
        ? smoothstep(0.12, 0.55, catRT.stateTime) *
          (1 - smoothstep(AFFECTION_DURATION - 0.55, AFFECTION_DURATION, catRT.stateTime))
        : 0

    // Drive the explorer's mutual pet reaction — readable for tests & 3D rig
    playerRT.catReaction = affectionPose

    // --- terrain under the paws -------------------------------------------------
    // The same height function she walks on, sampled ahead of and beside her so
    // the IK keeps the paws planted on the actual slope rather than flat.
    const sinF = Math.sin(catRT.facing)
    const cosF = Math.cos(catRT.facing)
    poseInput.slope =
      (groundHeight(catRT.pos.x + sinF * 0.3, catRT.pos.z + cosF * 0.3) -
        groundHeight(catRT.pos.x - sinF * 0.3, catRT.pos.z - cosF * 0.3)) /
      0.6
    poseInput.crossSlope =
      (groundHeight(catRT.pos.x + cosF * 0.3, catRT.pos.z - sinF * 0.3) -
        groundHeight(catRT.pos.x - cosF * 0.3, catRT.pos.z + sinF * 0.3)) /
      0.6
    // and under each paw, so a foot on a bump or in a dip finds it
    pawGround.x = catRT.pos.x
    pawGround.y = catRT.pos.y
    pawGround.z = catRT.pos.z
    pawGround.sin = sinF
    pawGround.cos = cosF
    poseInput.groundAt = pawGroundAt
    // where she is in a jump: the gather (<0), the arc (0..1), or neither
    poseInput.jumpT = catRT.navMode === "jump" ? Math.max(-1, catRT.jumpTime / (catRT.jumpTime < 0 ? CAT_JUMP_GATHER : catRT.jumpDuration)) : undefined
    poseInput.touchdown = catTouchdown(catRT.landTime, catRT.landImpact)

    // Turning rate and the explorer's bearing feed the rig's posture.
    let dFacing = catRT.facing - prevFacing.current
    dFacing = Math.atan2(Math.sin(dFacing), Math.cos(dFacing))
    prevFacing.current = catRT.facing
    turnRate.current = damp(turnRate.current, dFacing / Math.max(dt, 1e-3), 10, dt)

    poseInput.state = s
    poseInput.speed = catRT.speed
    poseInput.turnRate = turnRate.current
    poseInput.explorerBearing =
      Math.atan2(playerRT.pos.x - catRT.pos.x, playerRT.pos.z - catRT.pos.z) - catRT.facing
    poseInput.navMode = catRT.navMode
    poseInput.affectionKind = catRT.affectionKind
    poseInput.affectionPose = affectionPose
    poseInput.stateTime = catRT.stateTime

    // ---- voice, eyes and mood ------------------------------------------------
    clock.current = now
    const camD = state.camera.position.distanceTo(catRT.pos)
    loudness.current = Math.min(1, 2.4 / (camD + 0.4))
    if (s === "meow") {
      // two meows: a question, then a longer, plaintive one
      if (L.voiced === 0 && catRT.stateTime > 0.35) { vocal("meow"); L.voiced = 1 }
      if (L.voiced === 1 && catRT.stateTime > 1.55) { vocal("meow", 1); L.voiced = 2 }
    } else {
      L.voiced = 0
    }
    if (s === "greet" && catRT.stateTime > 0.6 && catRT.stateTime - dt <= 0.6 && dist > 5) vocal("meow")
    if (s === "yawn" && catRT.stateTime > 1.1 && catRT.stateTime - dt <= 1.1) vocal("mew")
    poseInput.voice = voiceEnvelope(catRT.vocal, now - catRT.vocalTime)
    // pupils open in the dark and when she is excited or afraid
    poseInput.dark = Math.min(1, smoothstep(0.55, 0.92, worldRT.timeOfDay) + weatherRT.cloud * 0.18)
    // the slow blink: an unhurried close-and-open while she watches the explorer
    const watching = (s === "sit" || s === "loaf" || s === "petted" || s === "knead") && Math.abs(poseInput.explorerBearing) < 0.7
    L.slowBlinkTimer -= dt
    if (L.slowBlinkTimer <= 0 && watching) {
      L.slowBlinkTimer = 5 + Math.random() * 6
      L.slowBlink = 1.4
    }
    L.slowBlink = Math.max(0, L.slowBlink - dt)
    const sb = L.slowBlink > 0 ? 1.4 - L.slowBlink : -1
    poseInput.slowBlink = sb < 0 ? 0 : sb < 0.4 ? sb / 0.4 : sb < 0.85 ? 1 : Math.max(0, 1 - (sb - 0.85) / 0.55)
    // which way the explorer's legs are while she weaves: rub the near flank on them
    poseInput.rubSide = Math.sin(poseInput.explorerBearing) >= 0 ? 1 : -1
    poseInput.actSide = L.actSide
    poseInput.tailSide = L.tailSide
    // The explorer's hand travels head → tail in slow strokes while she pets
    catRT.stroke = s === "petted" ? Math.max(0, ((playerRT.gestureTime - 0.9) * 0.62) % 1) : 0
    poseInput.stroke = catRT.stroke
    L.pounce = s === "crouch" ? smoothstep(0.3, 0.55, autonomy.current.crouchTime) : 0
    poseInput.pounce = L.pounce
    poseInput.wet = L.wet
    poseInput.swim = catRT.swim
    const purr =
      s === "petted" ? 1 :
      s === "rub" ? 0.65 :
      s === "knead" ? 0.85 :
      s === "affection" ? 0.7 :
      s === "loaf" && dist < 2.2 ? 0.35 :
      s === "sleep" && dist < 2.2 ? 0.25 : 0
    catRT.purr = damp(catRT.purr, purr, 2.5, dt)
    catVoice.purr(catRT.purr * loudness.current)

    stepCompanionBlend(blend, poseInput, dt)
    composeCompanionPose(blend, poseInput, dt, state.clock.elapsedTime, pose)
    if (catRT.poseOverride && showNavigation) Object.assign(pose, catRT.poseOverride)

    const model = modelRef.current
    if (model) {
      // `sit`, `sleep` and `crouch` lower the hips without moving the paws,
      // which would sink her whole body through the terrain; lift the root by
      // exactly the measured amount so the paws stay on the ground.
      // The root is parented to the group, which already carries her
      // position and facing; only the ground-sink lift is local.
      model.root.position.set(0, companionGroundSink(blend) * (1 - catRT.swim), 0)
      model.root.rotation.y = 0
      animatorRef.current?.update(pose)
      // wet fur: darker, clumped, a soft sheen (rain or a swim)
      const coat = model.material.userData.coat as { uWet?: { value: number } } | undefined
      if (coat?.uWet) coat.uWet.value = Math.min(1, Math.max(L.wet * 0.55, water.wet * 0.9))
      // where her head and back are, for the explorer's hand
      const head = model.bones.get("head")
      const back = model.bones.get("spine")
      if (head && back) {
        g.updateMatrixWorld()
        head.getWorldPosition(_head)
        catRT.headWorld.copy(_head)
        back.getWorldPosition(catRT.backWorld)
      }
    } else {
      catRT.headWorld.set(catRT.pos.x, catRT.pos.y + 0.28, catRT.pos.z)
      catRT.backWorld.set(catRT.pos.x, catRT.pos.y + 0.24, catRT.pos.z)
    }

    // her purr, as light: rose-gold motes drifting up between the cat and the explorer
    // when she nuzzles or is stroked, and now and then a soft ripple round her
    // (no cartoon hearts)
    const purring = Math.max(affectionPose, catRT.state === "petted" ? smoothstep(0.5, 1.3, catRT.stateTime) : 0)
    if (purring > 0.01) {
      purrLight.current += dt * (5 + purring * 9)
      while (purrLight.current > 1) {
        purrLight.current -= 1
        _purrAt.lerpVectors(catRT.pos, playerRT.pos, 0.35 + Math.random() * 0.3)
        _purrAt.y = catRT.pos.y + 0.35 + Math.random() * 0.25
        trailMote(_purrAt, Math.random() < 0.6 ? "#ffc3d6" : "#ffe3a8", 1.3 + purring * 1.0, 0.045)
      }
      if (Math.floor(catRT.stateTime / 1.6) !== Math.floor((catRT.stateTime - dt) / 1.6)) {
        _purrAt.set(catRT.pos.x, catRT.pos.y + 0.04, catRT.pos.z)
        purrRipple(_purrAt)
      }
    }

    if (shadow.current) {
      shadow.current.visible = cameraRT.distance > 1.65 && !water.inWater
      const shadowGround = groundHeight(catRT.pos.x, catRT.pos.z)
      const lift = Math.max(0, catRT.pos.y - shadowGround)
      shadow.current.position.set(catRT.pos.x, shadowGround + 0.02, catRT.pos.z)
      shadow.current.scale.setScalar(Math.max(0.58, 1 - lift * 0.34))
      shadowMat.opacity = Math.max(0.35, 0.9 - lift * 0.32)
    }

    if (showNavigation) {
      const needed = catRT.navMode.startsWith("jump") ? 3 : 1 + catRT.navPath.length - catRT.navIndex
      let positions = navDebugLine.geometry.getAttribute("position") as THREE.BufferAttribute
      if (needed > positions.count) {
        navDebugLine.geometry.dispose()
        navDebugLine.geometry = new THREE.BufferGeometry()
        positions = new THREE.Float32BufferAttribute(new Float32Array(needed * 2 * 3), 3)
        navDebugLine.geometry.setAttribute("position", positions)
      }
      let count = 1
      positions.setXYZ(0, catRT.pos.x, groundHeight(catRT.pos.x, catRT.pos.z) + 0.08, catRT.pos.z)
      if (catRT.navMode === "jump" || catRT.navMode === "jumpApproach") {
        positions.setXYZ(count++, catRT.jumpStart.x, catRT.jumpStart.y + 0.08, catRT.jumpStart.z)
        positions.setXYZ(count++, catRT.jumpEnd.x, catRT.jumpEnd.y + 0.08, catRT.jumpEnd.z)
      } else {
        for (let i = catRT.navIndex; i < catRT.navPath.length; i++) {
          const point = catRT.navPath[i]
          positions.setXYZ(count++, point.x, point.y + 0.08, point.z)
        }
      }
      navDebugLine.visible = count > 1
      navDebugLine.geometry.setDrawRange(0, count)
      positions.needsUpdate = true
      navDebugLine.material.color.set(
        catRT.navMode.startsWith("jump") ? "#ef8b59" : "#4a9f94",
      )
    }

    // arrive: settle into sit automatically after running ahead (finale)
    if (arrive && s === "runAhead" && catRT.stateTime > 1.2) {
      catRT.state = "sit"
      catRT.stateTime = 0
    }
    syncCompanionAgent(companionAgent)
  })

  return (
    <>
      <mesh ref={shadow} rotation-x={-Math.PI / 2} material={shadowMat} renderOrder={1}>
        <planeGeometry args={[0.62, 0.62]} />
      </mesh>
      <group ref={group} name="cat-companion">
        {/* The rigged cat is mounted imperatively; the primitives stand in
            only until it arrives, or for good if it never does. */}
        {model && <primitive object={model.root} />}
        {!model && <PrimitiveCat />}
      </group>
      {showNavigation && <primitive object={navDebugLine} />}
    </>
  )
}
