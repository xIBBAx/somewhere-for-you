import * as THREE from "three"
import { viewDistance } from "./camera/cameraViews"
import type { PlayerMotion } from "./characters/playerMotion"

/**
 * High-frequency simulation state. Deliberately OUTSIDE React/zustand:
 * per-frame values must never trigger component renders.
 */

export type MoveInput = { x: number; y: number }

export const input = {
  move: { x: 0, y: 0 } as MoveInput,
  interact: false, // edge-triggered, consumed by the interaction manager
  cancel: false, // escape / close
  sprint: false, // held while Shift is down
  jump: false, // edge-triggered; consumed by the character
  ascend: false, // held while Space/J is down: flight climbs
  descend: false, // held while C is down: flight descends
  call: false, // edge-triggered: The explorer calls her cat (C)
  switchCharacter: false, // edge-triggered: swap the controlled character (Q)
  /** edge-triggered named actions (together, activities, photo, journal) */
  actions: [] as GameAction[],
}

export type GameAction = "hold" | "hug" | "five" | "dance" | "follow" | "photo" | "journal" | "race" | "stars" | "pat" | "callHorse" | "callPegasus" | "putDown"
  | "starChart" | "travel" | "homeward" | "gather" | "cameraView" | "cameraViewBack"
  /** Starborn, the star-born, comes to the rider wherever she is (I) */
  | "callStarborn"
  /** The dragon, the golden dragon, comes down out of the sky (1); F breathes light while riding her */
  | "callDragon"
  /** Land a winged Pegasus into a gallop; cancel the approach or stop its ground run. */
  | "landGallop"
  /** cosmic travel (celestial/cosmicTravel): the planet picker (N with no course),
   *  arrive now during a journey (E), the cinematic return to Earth (K) and the quick one */
  | "planets" | "returnEarth" | "quickReturn"
  /** the controls guide (/ or ?) and "take me somewhere safe" */
  | "controlsGuide" | "recover"

/** While a race runs the cat sprints for the finish at a fair, adjusted speed. */
export const catRaceRT = { active: false, speed: 6.4 }

/** Queue a one-shot action (keyboard or HUD). */
export const pushAction = (action: GameAction): void => {
  if (!input.actions.includes(action)) input.actions.push(action)
}

/** Consume one queued action if present. */
export const takeAction = (action: GameAction): boolean => {
  const i = input.actions.indexOf(action)
  if (i < 0) return false
  input.actions.splice(i, 1)
  return true
}

/** Mutable desktop camera state shared with camera-relative movement/debug QA. */
export const cameraRT = {
  // Begin facing the explorer so the expression and the little fair read immediately.
  yaw: Math.PI,
  targetYaw: Math.PI,
  viewYaw: Math.PI,
  pitch: 0.3,
  /** 0 open sky … 1 under dense crowns (camera boom drops below canopy) */
  canopy: 0,
  targetPitch: 0.3,
  distance: viewDistance(),
  targetDistance: viewDistance(),
  collisionDistance: viewDistance(),
  pointerLocked: false,
  hasLooked: false,
  /** photo mode: orbit by dragging with a free cursor, even while posing */
  photo: false,
  /** performance.now() of the last manual look (mouse), for auto-follow behind a horse */
  lastLook: 0,
  /**
   * She has turned the camera herself: the chase views (horse, pegasus, a
   * journey's direction, the balloon's slow turn) leave it where she put it.
   * A new ride starts with the chase view again until she takes it.
   */
  userHold: false,
  /** riding: lift and distance added to the follow boom */
  mountedLift: 0,
  mountedDistance: 0,
  /** flying: extra boom distance and lift for the wingspan (pegasus/flightCamera) */
  flightDistance: 0,
  flightLift: 0,
  /** speed feel while riding: extra FOV (deg), stride-synced vertical bob (m), roll into turns (rad) */
  fovBoost: 0,
  speedBob: 0,
  speedRoll: 0,
}

export const playerRT = {
  /** Only placement/respawn increments this; switching preserves live physics. */
  revision: 0,
  pos: new THREE.Vector3(0, 0, 22.5),
  vel: new THREE.Vector3(),
  facing: Math.PI, // facing up the valley (−z) at start
  speed: 0,
  moving: false,
  idleTime: 0,
  /** set while a memory card / finale controls the player */
  paused: false,
  /** celebration pose timer (interaction reactions) */
  celebrate: 0,
  /** 0–1 procedural response while the companion asks for affection */
  catReaction: 0,
  /** 0–1 fear response triggered during lightning and thunderstorms */
  frightened: 0,
  jumpPhase: "grounded" as PlayerMotion["phase"],
  jumpHeight: 0,
  /** discovery interaction currently performed (blends a pose in the animator) */
  gesture: "none" as PlayerGesture,
  gestureTime: 0,
  /** while riding the balloon, the explorer's feet follow the basket instead of the terrain */
  rideY: null as number | null,
  /** on a flying mount: the body's pitch (nose up +) and bank (left down +), rad */
  ridePitch: 0,
  rideRoll: 0,
}

/**
 * The companion's body. Same shape as the explorer's (`playerRT`) so the shared locomotion,
 * camera and world systems can follow either of them.
 */
export const companionRT: typeof playerRT = {
  revision: 0,
  pos: new THREE.Vector3(1.6, 0, 24.2),
  vel: new THREE.Vector3(),
  facing: Math.PI,
  speed: 0,
  moving: false,
  idleTime: 0,
  paused: false,
  celebrate: 0,
  catReaction: 0,
  frightened: 0,
  jumpPhase: "grounded",
  jumpHeight: 0,
  gesture: "none",
  gestureTime: 0,
  rideY: null,
  ridePitch: 0,
  rideRoll: 0,
}

export type CharacterId = "explorer" | "companion"

/**
 * Who the player controls. `playerRT` is always the explorer's own body — which is
 * why the cat, who follows `playerRT`, belongs to the explorer and never to the companion.
 */
export const characterRT = {
  active: "explorer" as CharacterId,
  /** The companion walks in the world only once invited (first switch) */
  companionPresent: false,
  companionReady: false,
  /** Discrete selection version, for camera/proximity caches and HUD polling. */
  version: 0,
  switching: false,
  switchFade: 0,
  /** Finale choreography uses the same companion body as exploration. */
  companionScale: 1,
  finaleWave: 0,
}

/** The body the camera, world streaming and interactions follow right now. */
export const avatarRT = (): typeof playerRT => (characterRT.active === "companion" ? companionRT : playerRT)

export type AvatarBody = typeof playerRT

/** Clear one-shot actions without dropping held movement during a handoff. */
export const clearInputActions = (): void => {
  input.actions.length = 0
  input.interact = false
  input.cancel = false
  input.jump = false
  input.call = false
  input.switchCharacter = false
}

/** Atomic selection only: no world reset, discovery mutation or body teleport. */
export const selectAvatar = (id: CharacterId): void => {
  if (id === characterRT.active) return
  const outgoing = avatarRT()
  outgoing.vel.x = outgoing.vel.z = 0
  outgoing.speed = 0
  outgoing.moving = false
  characterRT.active = id
  characterRT.version++
  clearInputActions()
}

export type PlayerGesture = "none" | "sit" | "paint" | "train" | "pet" | "wish" | "cheer" | "ride" | "call" | "whistle"

export type CatAffection = "nuzzle" | "paw"
export type CatNavMode = "direct" | "path" | "jumpApproach" | "jump"

export const catRT = {
  /** The cat belongs to this body, independently of the controlled avatar. */
  owner: "explorer" as const,
  pos: new THREE.Vector3(1.4, 0, 22.8),
  vel: new THREE.Vector3(),
  facing: Math.PI,
  speed: 0,
  state: "follow" as CatState,
  stateTime: 0,
  behaviorTimer: 0,
  /** affectionate idle moments use a fixed, collision-safe spot beside the explorer */
  affectionTarget: new THREE.Vector3(),
  affectionKind: "nuzzle" as CatAffection,
  affectionCooldown: 1.8,
  affectionCount: 0,
  affectionSide: 1,
  navMode: "direct" as CatNavMode,
  navPath: [] as THREE.Vector3[],
  navIndex: 0,
  navTarget: new THREE.Vector3(),
  navRepathTime: 0,
  navStuckTime: 0,
  navVersion: 0,
  jumpStart: new THREE.Vector3(),
  jumpEnd: new THREE.Vector3(),
  jumpTime: 0,
  jumpDuration: 0.65,
  jumpHeight: 0.62,
  /** s since the last touchdown (large when she has not just landed) */
  landTime: 9,
  /** 0..~1.3 how hard that landing was (her falling speed / 3.2 m/s) */
  landImpact: 0,
  detectedObstacle: "" as string,
  tailPhase: 0,
  walkPhase: 0,
  /** point the cat is currently investigating (memory anchor, secret, …) */
  poi: null as THREE.Vector3 | null,
  poiKind: "" as string,
  hidden: false,
  /** riding on the croup of the explorer's horse (no paw prints, no navigation) */
  aboard: false,
  /** 0–1 how loudly she is purring right now (audio + throat) */
  purr: 0,
  /** last vocalisation and when it started (for the explorer's reaction and QA) */
  vocal: "" as "" | "meow" | "trill" | "chirp" | "hiss" | "mew",
  vocalTime: 0,
  /** she has been called and has not answered yet */
  called: false,
  /** The explorer is stroking her: 0–1 along her back, head → tail */
  stroke: 0,
  /** world positions of her head and mid-back, so the explorer's hand can find them */
  headWorld: new THREE.Vector3(),
  backWorld: new THREE.Vector3(),
  /** debug only: force pose layers (`?debug`), e.g. { yawn: 1 } */
  poseOverride: null as Record<string, number> | null,
  /** debug only: pin her in this state where she stands */
  debugHold: "" as "" | CatState,
  /** on Starborn: how frightened / how full of wonder she is (0..1), for QA and the camera */
  rideFear: 0,
  rideWonder: 0,
  /** 0..1 swimming; 0..1 how wet her coat is */
  swim: 0,
  wet: 0,
  /** what she is doing on her own ("water:paddle", "friend:together", …) */
  own: "" as string,
}

export type CatState =
  | "follow"
  | "catchup"
  | "arrive"
  | "sit"
  | "lookAround"
  | "stretch"
  | "sleep"
  | "investigate"
  | "runAhead"
  | "chase"
  | "crouch"
  | "affectionApproach"
  | "affection"
  /** trotting up with her tail high after being called or missing the explorer */
  | "greet"
  /** weaving round the explorer's legs, rubbing her cheek and flank on them */
  | "rub"
  /** The explorer is petting her */
  | "petted"
  /** sitting up and meowing at the explorer for attention */
  | "meow"
  /** startled by thunder: arched, fluffed, hissing, then hiding at the explorer's feet */
  | "scared"
  | "groom"
  | "knead"
  | "roll"
  | "yawn"
  | "scratch"
  | "loaf"
  | "shake"

export const worldRT = {
  /** A short, atomic fast-travel handoff owns placement and input. */
  relocating: false,
  /** Camera inspection only honored with ?debug; ordinary gameplay never enters it. */
  inspectionCamera: { active: false, follow: false, px: 0, py: 2, pz: 5, tx: 0, ty: 1, tz: 0 },
  timeOfDay: 0, // 0 soft day → 1 twilight (damped toward target)
  timeOfDayTarget: 0,
  /** 1 while the automatic clock is before solar noon (see celestialRT) */
  morningTarget: 0,
  /** dev/QA: force a dawn (1) or a dusk (0); null follows the clock */
  morningOverride: null as number | null,
  /** dev/QA: pin the time of day (0 day … 1 night); null follows the clock */
  timeOverride: null as number | null,
  nearMemoryId: null as string | null,
  /** Landmark animation begins before its postcard is shown. */
  performingMemoryId: null as string | null,
  performanceTime: 0,
  nearSecretId: null as string | null,
  /** camera focus override while a memory performs */
  focus: { active: false, x: 0, z: 0, yaw: null as number | null, pitch: null as number | null, distance: null as number | null },
  finaleActive: false,
  /** finale camera keyframe the director is currently blending toward */
  finaleCam: { px: 0, py: 7.2, pz: -20.5, tx: 0, ty: 2.4, tz: -30.2 },
  finalePhase: 0,
  finaleTime: 0,
  /** set by debug teleport so the camera snaps instead of flying */
  snapCamera: false,
  /** 0–1 lightning flash illumination in sky and environment */
  lightning: 0,
  /** one-shot debug/QA request consumed by SkyLife */
  airplaneRequested: false,
  aircraftRequestedType: null as string | null,
  /** First-launch Earth-to-the explorer journey. React owns lifecycle; R3F reads these per frame. */
  introActive: false,
  introProgress: 1,
  introStarted: false,
  introReducedMotion: false,
  /** Volumetric lightning local to the cloud-wall shot (never ordinary rain). */
  introLightning: 0,
}

/** Prepare the real world and shared camera for the first-launch journey. */
export const beginIntroRuntime = (reducedMotion: boolean): void => {
  resetCharactersForJourney()
  worldRT.introActive = true
  worldRT.introProgress = 0
  worldRT.introStarted = false
  worldRT.introReducedMotion = reducedMotion
  worldRT.introLightning = 0
  worldRT.lightning = 0
  playerRT.paused = true
  playerRT.frightened = 0
  playerRT.catReaction = 0
  playerRT.celebrate = 0
  playerRT.pos.set(0, groundlessSpawnY, 22.5)
  playerRT.vel.set(0, 0, 0)
  playerRT.facing = Math.PI
  cameraRT.yaw = Math.PI
  cameraRT.targetYaw = Math.PI
  cameraRT.pitch = 0.61
  cameraRT.targetPitch = 0.3
  // the opening film ends on a 13.1 m shot; the boom then glides in to the chosen view
  cameraRT.distance = 13.1
  cameraRT.targetDistance = viewDistance()
  catRT.pos.set(2.65, 0, 23.05)
  catRT.vel.set(0, 0, 0)
  catRT.facing = -Math.PI / 2
  catRT.state = "follow"
  catRT.stateTime = 0
  catRT.navPath.length = 0
  catRT.navMode = "direct"
}

/** Finish or skip into exactly the same playable state without a reload. */
export const finishIntroRuntime = (weatherFear = 0): void => {
  selectAvatar("explorer")
  worldRT.introProgress = 1
  worldRT.introStarted = false
  worldRT.introReducedMotion = false
  worldRT.introLightning = 0
  worldRT.lightning = 0
  worldRT.introActive = false
  playerRT.paused = false
  playerRT.frightened = weatherFear
  playerRT.catReaction = 0
  playerRT.celebrate = 0
  playerRT.pos.set(0, groundlessSpawnY, 22.5)
  playerRT.vel.set(0, 0, 0)
  playerRT.facing = Math.PI
  playerRT.revision++
  cameraRT.yaw = Math.PI
  cameraRT.targetYaw = Math.PI
  cameraRT.pitch = 0.61
  cameraRT.targetPitch = 0.3
  // the opening film ends on a 13.1 m shot; the boom then glides in to the chosen view
  cameraRT.distance = 13.1
  cameraRT.targetDistance = viewDistance()
  catRT.pos.set(0.9, 0, 22.9)
  catRT.vel.set(0, 0, 0)
  catRT.facing = -Math.PI / 2
  catRT.state = "follow"
  catRT.stateTime = 0
  catRT.behaviorTimer = 0
  catRT.navMode = "direct"
  catRT.navPath.length = 0
  catRT.navIndex = 0
  catRT.navVersion++
  catRT.poi = null
  worldRT.snapCamera = true
}

// Terrain is resolved by the character rigs on their next frame. Keeping this
// local avoids importing the layout module into the high-frequency state file.
const groundlessSpawnY = 0

const resetBody = (body: AvatarBody, x: number, z: number): void => {
  body.pos.set(x, 0, z)
  body.vel.set(0, 0, 0)
  body.facing = Math.PI
  body.speed = 0
  body.moving = false
  body.idleTime = 0
  body.paused = false
  body.celebrate = 0
  body.catReaction = 0
  body.frightened = 0
  body.jumpPhase = "grounded"
  body.jumpHeight = 0
  body.gesture = "none"
  body.gestureTime = 0
  body.rideY = null
  body.ridePitch = 0
  body.rideRoll = 0
  body.revision++
}

/** Starting or replaying the story always restores the explorer's story body. */
export const resetCharactersForJourney = (): void => {
  selectAvatar("explorer")
  characterRT.companionPresent = false
  characterRT.companionScale = 1
  characterRT.finaleWave = 0
  characterRT.switching = false
  characterRT.switchFade = 0
  resetBody(playerRT, 0, 22.5)
  resetBody(companionRT, 1.6, 24.2)
  clearInputActions()
}

export const resetRuntime = (spawn: { x: number; z: number }): void => {
  resetBody(playerRT, spawn.x, spawn.z)
  resetBody(companionRT, spawn.x + 1.6, spawn.z + 1.7)
  clearInputActions()
  characterRT.switching = false
  characterRT.switchFade = 0
  worldRT.performingMemoryId = null
  worldRT.performanceTime = 0
  catRT.pos.set(spawn.x + 1.2, 0, spawn.z + 0.6)
  catRT.vel.set(0, 0, 0)
  catRT.state = "follow"
  catRT.stateTime = 0
  catRT.behaviorTimer = 0
  catRT.affectionCooldown = 1.8
  catRT.affectionCount = 0
  catRT.navMode = "direct"
  catRT.navPath.length = 0
  catRT.navIndex = 0
  catRT.navRepathTime = 0
  catRT.navStuckTime = 0
  catRT.navVersion++
  catRT.jumpTime = 0
  catRT.detectedObstacle = ""
  catRT.poi = null
  // the party travels together: the companion arrives beside the explorer, and if they are the
  // one being controlled, the spawn is his
  if (characterRT.active === "companion") {
    companionRT.pos.set(spawn.x, 0, spawn.z)
    playerRT.pos.set(spawn.x - 1.4, 0, spawn.z + 1.1)
    catRT.pos.set(spawn.x - 0.4, 0, spawn.z + 1.8)
  } else {
    companionRT.pos.set(spawn.x + 1.6, 0, spawn.z + 1.7)
  }
  worldRT.focus.active = false
  worldRT.snapCamera = true
}

/** Auto-framing may steer the camera only until she has turned it herself (cameraRT.userHold). */
export const cameraAutoAllowed = (graceMs: number): boolean => !cameraRT.userHold && performance.now() - cameraRT.lastLook > graceMs
