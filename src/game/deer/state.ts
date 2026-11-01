import { makeWaterContact, type WaterContact } from "../../world/creatureWater"
import type { CharacterId } from "../runtime"
import { makeHorsePose, type HorsePose } from "../horses/HorseAnimator"
import type { DeerHome } from "./population"
import { routineAt, type Routine } from "./population"
import { deerSpeeds, type DeerIdentity } from "./species"
import { deerMemories, restoreRelationship } from "./persistence"
import type { RelationshipPair } from "./relationships"
import type { DeerModel } from "./assets"
import type { DeerAnimator } from "./DeerAnimator"
import { makeGlide, type Glide } from "../../utils/renderGlide"

export type DeerMode =
  Routine | "alert" | "retreat" | "flee" | "curious" | "hide" | "protect" | "play" | "affection" | "ridden"
export type DeerState = {
  kind: "deer"
  ident: DeerIdentity
  home: DeerHome
  relationships: RelationshipPair
  x: number
  y: number
  z: number
  heading: number
  speed: number
  targetSpeed: number
  steer: number
  turnRate: number
  accel: number
  stamina: number
  jumpT: number
  jumpDur: number
  jumpY: number
  jumpCool: number
  jumpH: number
  wade: number
  /** 0..1 out of its depth and swimming */
  swim: number
  /** a dip after drinking: 0 none, 1 wading in, 2 standing in it, 3 walking out */
  bathe: 0 | 1 | 2 | 3
  bankX: number
  bankZ: number
  water: WaterContact
  lead: number
  rider: CharacterId | null
  reservedBy: CharacterId | null
  pose: HorsePose
  model: DeerModel | null
  animator: DeerAnimator | null
  loading: boolean
  failed: boolean
  mode: DeerMode
  modeTime: number
  tx: number
  tz: number
  alarm: number
  socialAlarm: number
  watchX: number
  watchZ: number
  react: number
  affection: number
  protect: number
  simTime: number
  animTime: number
  routeTime: number
  blocked: number
  lastUpdate: number
  lastSave: number
  visible: boolean
  /** where it is drawn between its (far, infrequent) motion steps */
  glide: Glide
  debugMode: DeerMode | null
  debugSpeed: number | null
}
export const makeDeer = (home: DeerHome, time: number): DeerState => {
  const coarse = routineAt(home, time),
    pose = makeHorsePose()
  const memory = deerMemories.get(home.ident.id)
  // Resume a recent encounter exactly, then converge to the daily circuit
  // at a physically plausible walking speed while the area is unloaded.
  if (memory) {
    const elapsed = Math.max(0, time - memory.updated),
      distance = Math.hypot(coarse.x - memory.x, coarse.z - memory.z)
    const blend = Math.min(1, (elapsed * 0.8) / Math.max(1, distance))
    coarse.x = memory.x + (coarse.x - memory.x) * blend
    coarse.z = memory.z + (coarse.z - memory.z) * blend
  }
  pose.speeds = deerSpeeds(home.ident)
  return {
    kind: "deer",
    ident: home.ident,
    home,
    relationships: restoreRelationship(home.ident.id),
    x: coarse.x,
    y: 0,
    z: coarse.z,
    heading: (home.ident.seed % 628) / 100,
    speed: 0,
    targetSpeed: 0,
    steer: 0,
    turnRate: 0,
    accel: 0,
    stamina: 1,
    jumpT: -1,
    jumpDur: 0.8,
    jumpY: 0,
    jumpCool: 0,
    jumpH: 0.65,
    wade: 0,
    swim: 0,
    bathe: 0,
    bankX: 0,
    bankZ: 0,
    water: makeWaterContact(),
    lead: 1,
    rider: null,
    reservedBy: null,
    pose,
    model: null,
    animator: null,
    loading: false,
    failed: false,
    mode: coarse.mode,
    modeTime: 0,
    tx: coarse.x,
    tz: coarse.z,
    alarm: 0,
    socialAlarm: 0,
    watchX: home.x,
    watchZ: home.z,
    react: 0,
    affection: 0,
    protect: 0,
    simTime: 0,
    animTime: 1,
    routeTime: 0,
    blocked: 0,
    lastUpdate: time,
    lastSave: 0,
    visible: false,
    glide: makeGlide(),
    debugMode: null,
    debugSpeed: null,
  }
}
export const deerRT = {
  animals: new Map<string, DeerState>(),
  near: null as DeerState | null,
  time: 0,
  stats: { territories: 0, simulated: 0, rendered: 0, ms: 0, rejections: 0, accepted: 0, pets: 0, familiesAlerted: 0 },
}
