import { travelling } from "../celestial/cosmicTravel"
import { cameraRT, companionRT, playerRT, worldRT, type CharacterId, type GameAction } from "../runtime"
import { horseRT, type HorseState } from "../horses/horseState"
import { setMode } from "../horses/horseBrain"
import { callHorse, requestDismount, restoreRiderSeat, riderRT } from "../horses/riding"
import { groundHeight } from "../world-layout"
import { sameWorld } from "../../world/realmHook"
import { waterDepthAt, waterSurfaceAt } from "../../world/waterSurface"
import { sailRT, wingsAgain } from "../celestial/starSail"
import { groundNow } from "./flight"
import { spaceRT } from "../celestial/spaceState"
import { shimmerAt } from "../travel/StarShimmer"
import { names } from "../../personalization"

/**
 * Starborn, called (I): she belongs to the explorer from the start, so any character
 * may whistle her to them from anywhere. Close by she walks over; further off
 * she takes wing and flies in and lands beside you; from very far away, or
 * from another world, she arrives out of the sky with a starlight shimmer.
 *
 * The decision is pure (planStarbornCall) so each situation is tested on its
 * own; callStarborn carries it out.
 */
export const STARBORN_ID = "pegasus:starborn"
/** the GameAction for I (runtime.ts GameAction is extended with it) */
export const STARBORN_ACTION: GameAction = "callStarborn"

/** Everything the decision needs, read from the live game. */
export type StarbornSituation = {
  /** the character calling */
  caller: CharacterId
  /** the other character's name, for the hints */
  otherName: string
  /** what the caller is riding right now */
  mount: "none" | "starborn" | "other"
  /** who holds Starborn's reins, if anyone; and whether the rear seat is taken */
  starbornFront: CharacterId | null
  starbornBehind: boolean
  /** a sail autopilot or a sail under way: she is on a journey beyond the sky */
  journey: boolean
  /** the caller is in deep water */
  swimming: boolean
  /** unmounted beyond Earth's air, where ordinary mounting has no ground */
  adrift?: boolean
  /** the opening or the finale is playing (nothing can be called now) */
  blocked: boolean
}

export type StarbornPlan = { kind: "call" } | { kind: "dismount" } | { kind: "rescue" } | { kind: "hint"; text: string }

/** The one decision for a call: which hint, whether to get down first, or to come. */
export const planStarbornCall = (s: StarbornSituation): StarbornPlan => {
  if (s.blocked) return { kind: "hint", text: "Not now, the story is still going." }
  if (s.mount === "starborn") return { kind: "hint", text: `You're already riding ${names.starborn}.` }
  if (s.journey) return { kind: "hint", text: "You're between worlds. Arrive now or take the reins before calling her." }
  // riding another horse: get down, then she comes (see tickPendingStarborn)
  if (s.mount === "other") return { kind: "dismount" }
  if (s.starbornFront && s.starbornFront !== s.caller) {
    return s.starbornBehind
      ? { kind: "hint", text: `${names.starborn} is carrying ${s.otherName} and the one behind them. Call her when they're down.` }
      : { kind: "hint", text: `${s.otherName} is riding ${names.starborn}. Walk up beside her and press E to climb on behind.` }
  }
  if (s.starbornBehind) return { kind: "hint", text: `${names.starborn} is carrying two already.` }
  if (s.swimming || s.adrift) return { kind: "rescue" }
  return { kind: "call" }
}

const bodyOf = (id: CharacterId) => (id === "explorer" ? playerRT : companionRT)
const nameOf = (id: CharacterId): string => (id === "explorer" ? `${names.explorer}` : `${names.companion}`)
const SWIM_DEPTH = 1.25

/** Read the live game into a situation for `caller`. */
export const starbornSituation = (caller: CharacterId, h: HorseState): StarbornSituation => {
  const r = riderRT[caller]
  const other: CharacterId = caller === "explorer" ? "companion" : "explorer"
  const body = bodyOf(caller)
  return {
    caller,
    otherName: nameOf(other),
    mount: r.phase === "none" ? "none" : r.horse === h ? "starborn" : "other",
    starbornFront: h.rider,
    starbornBehind: !!h.passenger,
    journey: travelling(),
    swimming: waterDepthAt(body.pos.x, body.pos.z) > SWIM_DEPTH,
    adrift: spaceRT.mode === "deep" || spaceRT.realm !== "earth" && body.pos.y > groundHeight(body.pos.x, body.pos.z) + 15,
    blocked: worldRT.introActive || worldRT.finaleActive,
  }
}

/** Callers whose "get down first" is still waiting to finish. */
const pending: Record<CharacterId, boolean> = { explorer: false, companion: false }

/** Starborn out of the sky to a caller on the same world, or on another world entirely. */
const arriveFromSky = (id: CharacterId, h: HorseState): void => {
  const body = bodyOf(id)
  const fl = h.flight
  if (!fl) return
  groundNow(h)
  // out of the sky, behind and to one side of the view, high up (as callHorse's far case)
  const a = cameraRT.viewYaw + (Math.random() < 0.5 ? -0.55 : 0.55)
  h.x = body.pos.x + Math.sin(a) * 170
  h.z = body.pos.z + Math.cos(a) * 170
  h.y = Math.max(groundHeight(h.x, h.z), groundHeight(body.pos.x, body.pos.z)) + 45
  h.heading = Math.atan2(body.pos.x - h.x, body.pos.z - h.z)
  h.speed = fl.spec.cruise
  fl.mode = "air"
  fl.spread = 1
  fl.t = 0
  h.tx = body.pos.x
  h.tz = body.pos.z
  h.reservedBy = id
  setMode(h, "come", 40)
  shimmerAt(h.x, h.y, h.z)
}

/** Bring Starborn to `id`: by callHorse on the same world, else out of the sky. */
const summon = (id: CharacterId, h: HorseState): "walk" | "fly" | "sky" => {
  const body = bodyOf(id)
  if (!sameWorld(h, body.pos) || h.flight?.mode === "sail" || h.y - body.pos.y > 150) {
    arriveFromSky(id, h)
    horseRT.stats.calls++
    return "sky"
  }
  const d = Math.hypot(h.x - body.pos.x, h.z - body.pos.z)
  callHorse(id, h)
  if (d > 220) shimmerAt(h.x, h.y, h.z)
  return d > 60 ? "fly" : "walk"
}

/**
 * I: call Starborn for the active character. Returns true when she is coming
 * (or the caller is getting down first). Hints are said through `hint`.
 */
export const callStarborn = (id: CharacterId, hint: (text: string) => void): boolean => {
  const h = horseRT.horses.get(STARBORN_ID)
  if (!h || !h.flight) {
    hint(`${names.starborn} isn't here.`)
    return false
  }
  const plan = planStarbornCall(starbornSituation(id, h))
  if (plan.kind === "hint") {
    hint(plan.text)
    return false
  }
  if (plan.kind === "dismount") {
    const r = requestDismount(id)
    if (r === "blocked") {
      hint("You can't get down just here. Try a clearer spot, then call her.")
      return false
    }
    pending[id] = true
    hint(`Getting down so ${names.starborn} can come to you.`)
    return true
  }
  if (plan.kind === "rescue") {
    const body = bodyOf(id), fl = h.flight
    groundNow(h)
    h.x = body.pos.x; h.z = body.pos.z
    h.y = spaceRT.mode === "deep" ? body.pos.y : Math.max(body.pos.y + 6, (waterSurfaceAt(h.x, h.z) ?? groundHeight(h.x, h.z)) + 10)
    h.heading = body.facing
    fl.spread = 1
    if (spaceRT.mode === "deep") {
      fl.mode = "sail"
      fl.pitch = fl.roll = 0
      fl.throttle = 0.12
      h.speed = h.targetSpeed = 0
      sailRT.autopilot = null
      sailRT.pilot = h
    } else wingsAgain(h, fl.spec.cruise)
    restoreRiderSeat(id, h, 0)
    shimmerAt(h.x, h.y, h.z)
    hint(`${names.starborn} sweeps beneath you and catches you in her starlit saddle. You're in control.`)
    return true
  }
  const how = summon(id, h)
  hint(how === "sky" ? `${names.starborn} comes out of the sky, shimmering with starlight.`
    : how === "fly" ? `You call ${names.starborn} — she comes flying in on starlit wings.`
      : `You call ${names.starborn} — she comes trotting over.`)
  return true
}

/**
 * Each frame: a call waiting on the caller to get down is carried out once
 * they are on their feet (the riding logic finishes the dismount itself).
 */
export const tickPendingStarborn = (hint: (text: string) => void): void => {
  for (const id of ["explorer", "companion"] as const) {
    if (!pending[id]) continue
    if (riderRT[id].phase !== "none") continue
    pending[id] = false
    callStarborn(id, hint)
  }
}

/** Forget a waiting call (a rescue or a reload). */
export const clearPendingStarborn = (): void => {
  pending.explorer = false
  pending.companion = false
}
