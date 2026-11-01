import { highvaleMaps } from "../../world/highvale/highvaleData"
import { HIGHVALE_ARRIVAL, highvaleWeight } from "../../world/highvale/highvaleLayout"
import { startHighvale } from "../../world/highvale/render/HighvaleRoot"
import { characterRT, avatarRT, resetRuntime, worldRT, playerRT, companionRT, input, selectAvatar, type CharacterId } from "../runtime"
import { useGame } from "../../state/gameStore"
import { skyCommands } from "../../state/skyStore"
import { raceRT } from "../activities/race"
import { riderRT, resetRider, restoreRiderSeat } from "../horses/riding"
import type { HorseState } from "../horses/horseState"
import { groundHeight } from "../world-layout"
import { standable } from "../horses/horseMotion"
import { waterDepthAt } from "../../world/waterSurface"
import { HIGHVALE_NAME } from "../../world/highvale/highvaleNames"
import { HUB_CENTER } from "../../world/hubLayout"
import { sailRT, sailHome, wingsAgain } from "../celestial/starSail"
import { resetTravelState, skipJourney, travelling } from "../celestial/cosmicTravel"
import { travelCommands } from "../../state/travelStore"
import type { GameAction } from "../runtime"
import { spaceRT } from "../celestial/spaceState"
import { isAirborne } from "../pegasus/flight"
import { pegasusRT } from "../pegasus/pegasi"
import { clearPendingStarborn } from "../pegasus/starbornCall"
import { earthFrame } from "../celestial/frames"
import { leaveRealm } from "../celestial/realm/realmState"
import { groundNow } from "../pegasus/flight"
import { nearestSafeSpot, type RecoveryPlan, type Spot, recoveryPlan, beyondReach, fellThrough, isFinitePos } from "./safety"
import { names } from "../../personalization"

/** The horse a character is riding, if it is a horse (not a balloon or another mount). */
const mountOf = (id: CharacterId): HorseState | null => {
  const r = riderRT[id]
  const h = r.phase === "none" ? null : r.horse
  return h && (h as HorseState).kind === "horse" ? h as HorseState : null
}

/**
 * Getting about Earth without walking, and getting out of trouble.
 *
 *   fastTravelTo(place)  carries the active character (and their mount) to an
 *                        Earth place, landing on the nearest standable ground,
 *                        behind a short fade. Refused during a sky journey, in
 *                        space or on the Moon, during the opening, the finale
 *                        and a race.
 *   recoverToSafety()    "Take me somewhere safe": cancels a sky journey, sends
 *                        anyone off Earth home by sky, and sets a body that is
 *                        lost, stuck or broken down on the nearest safe ground
 *                        (or at home).
 *
 * The fade and the relocation run in stepFastTravel, once per frame, from
 * SafetyNet, so the cut to black always lands between two frames.
 */

export type FastPlace = { id: string; name: string; x: number; z: number }

/**
 * Earth places a character can be taken to. A function, because the Star Hill
 * is only known once the Pegasi have been placed (pegasi.ts spawnPegasi).
 */
export const fastPlaces = (): FastPlace[] => {
  return [
    { id: "home", name: "Home", x: HOME_SPOT.x, z: HOME_SPOT.z },
    { id: "hub", name: "Home", x: HUB_CENTER.x, z: HUB_CENTER.z },
    { id: "star-hill", name: "The Star Hill", x: pegasusRT.starHill.x, z: pegasusRT.starHill.z },
    { id: "highvale", name: HIGHVALE_NAME, ...HIGHVALE_ARRIVAL },
  ]
}

/** Where a body goes when nothing safe is near (the start, at home). */
export const HOME_SPOT: Spot = { x: 0, z: 22.5 }

/** The fade to black and back (s each way). */
export const FADE_TIME = 0.35

/** Shown as the screen goes dark: the fade element reads this level each frame. */
export const fadeRT = { level: 0 }

type Seat = { id: CharacterId; horse: HorseState; seat: 0 | 1; airborne: boolean }
type Pending = { name: string; spot: Spot; t: number; moved: boolean; caller: CharacterId; seats: Seat[]; rescue: boolean }
export const fastTravelRT = { pending: null as Pending | null }

const say = (text: string): void => useGame.getState().showHint(text)

const reducedMotion = (): boolean => {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  } catch {
    return false
  }
}

/** Standing room for a body on Earth: solid, dry, not in a building's footprint. */
const standsHere = (x: number, z: number): boolean => standable(x, z, 1.2) && waterDepthAt(x, z) <= 0.25

/** Nearest standing room to a point, or home if nothing near is safe. */
export const safeSpotNear = (x: number, z: number): Spot => {
  if (!isFinitePos(x, 0, z)) return HOME_SPOT
  return nearestSafeSpot(x, z, standsHere, 60, 2) ?? HOME_SPOT
}

/** Why travel is not possible right now, or null when it is. */
export const travelRefusal = (): string | null => {
  if (worldRT.introActive || worldRT.finaleActive) return "Not yet, the story is still going."
  if (raceRT.phase !== "idle") return "Finish the race first."
  if (fastTravelRT.pending) return "Already on the way."
  if (characterRT.switching) return "Just a moment while the view changes."
  if (travelling()) return `${names.starborn} is between worlds. Arrive first (E), then travel.`
  if (spaceRT.realm !== "earth" || spaceRT.mode === "deep") return "You're beyond the sky. Return to Earth first."
  if (sailRT.autopilot) return `${names.starborn} is on her way somewhere. Take the reins first, or let her finish.`
  for (const id of ["explorer", "companion"] as const) {
    const r = riderRT[id]
    if (r.phase !== "none" && r.phase !== "riding") return "Finish getting on or off first."
    if (r.phase !== "none" && !mountOf(id)) return "Step out of the balloon first, then travel."
  }
  return null
}

/** Capture ownership now, before the fade can change the selected body. */
const schedule = (name: string, spot: Spot, rescue = false): void => {
  const seats: Seat[] = []
  for (const id of ["explorer", "companion"] as const) {
    const horse = mountOf(id), r = riderRT[id]
    if (horse && r.phase === "riding") seats.push({ id, horse, seat: r.seat, airborne: isAirborne(horse) })
  }
  fastTravelRT.pending = { name, spot, caller: characterRT.active, seats, rescue, t: 0, moved: false }
  worldRT.relocating = true
  input.move.x = input.move.y = 0
  input.sprint = input.ascend = input.descend = false
  clearPendingStarborn()
}

/** Carry the whole party and keep every occupied saddle, including the rear seat. */
const relocate = (p: Pending): void => {
  const { spot } = p
  // An emergency can originate in a realm or a broken deep-space frame.
  if (p.rescue) {
    resetTravelState()
    sailRT.autopilot = null
    sailRT.descending = false
    sailRT.blocked = 0
    travelCommands.go = null
    skyCommands.cancel = false
    leaveRealm()
    spaceRT.frame = earthFrame()
    spaceRT.mode = "local"
    spaceRT.realm = "earth"
    spaceRT.target = null
    spaceRT.vel.set(0, 0, 0)
    sailHome()
  }
  for (const id of ["explorer", "companion"] as const) if (riderRT[id].phase !== "none") resetRider(id)
  selectAvatar(p.caller)
  resetRuntime(spot)
  const placed = new Set<HorseState>()
  const ordered = [...p.seats].sort((a, b) => a.seat - b.seat)
  for (const s of ordered) {
    const h = s.horse
    if (!placed.has(h)) {
      const at = safeSpotNear(spot.x + placed.size * 4, spot.z)
      h.x = at.x; h.z = at.z
      h.y = groundHeight(at.x, at.z)
      if (!Number.isFinite(h.heading)) h.heading = Math.PI
      h.speed = h.targetSpeed = 0
      h.tx = h.x; h.tz = h.z
      if (h.flight) {
        groundNow(h)
        // Fast travel preserves the freedom to stay airborne; a safety rescue
        // also repairs an invalid pose before handing the creature back.
        if (s.airborne) {
          h.y += 65
          wingsAgain(h, h.flight.spec.cruise)
        }
      }
      placed.add(h)
    }
    restoreRiderSeat(s.id, h, s.seat)
  }
  for (const body of [playerRT, companionRT]) if (body.rideY === null) body.pos.y = groundHeight(body.pos.x, body.pos.z)
}

/** One frame of the fade and the relocation (SafetyNet calls this every frame). */
export const stepFastTravel = (dt: number): void => {
  const p = fastTravelRT.pending
  if (!p) return
  p.t += dt
  if (reducedMotion()) {
    // no fade: a plain cut, once
    fadeRT.level = 0
    if (!p.moved) { p.moved = true; relocate(p) }
    fastTravelRT.pending = null
    worldRT.relocating = false
    return
  }
  if (!p.moved) {
    fadeRT.level = Math.min(1, p.t / FADE_TIME)
    if (p.t >= FADE_TIME) {
      p.moved = true
      relocate(p)
    }
    return
  }
  const back = p.t - FADE_TIME
  fadeRT.level = Math.max(0, 1 - back / FADE_TIME)
  if (back >= FADE_TIME) {
    fadeRT.level = 0
    fastTravelRT.pending = null
    worldRT.relocating = false
  }
}

/**
 * Take the active character to an Earth place, with a short fade. Returns
 * null once on the way, or the reason it cannot go (the caller shows it).
 */
export const fastTravelTo = (place: { x: number; z: number; name: string; id?: string }, hint: (text: string) => void = say): string | null => {
  const refusal = travelRefusal()
  if (refusal) return refusal
  // Highvale's ground arrives on demand (world/highvale): fetch it, then go,
  // so nobody is set down on the wilds it replaces
  if (highvaleWeight(place.x, place.z) > 0 && !highvaleMaps.data) {
    if (highvaleMaps.failed) return `The way to ${HIGHVALE_NAME} isn't loading right now. Try again in a little while.`
    hint(`Finding the way to ${place.name}…`)
    void startHighvale().then((ok) => {
      if (!ok) { hint(`The way to ${HIGHVALE_NAME} isn't loading right now. Try again in a little while.`); return }
      const reason = fastTravelTo(place, hint)
      if (reason) hint(reason)
    })
    return null
  }
  // a spot no one can reach is for finding on the way, not for skipping to
  if (beyondReach(place.x, place.z, HOME_SPOT)) return "That's out in the uncharted wilds. The way there is yours to find: ride or fly."
  // never a silent detour home: somewhere with no ground to stand on says so
  const spot = isFinitePos(place.x, 0, place.z) ? nearestSafeSpot(place.x, place.z, standsHere, 60, 2) : null
  if (!spot) return `There's no solid ground to stand on near ${place.name}. Fly there with ${names.starborn} instead.`
  schedule(place.name, spot)
  hint(`Taking you to ${place.name}.`)
  return null
}

/** The rest of the state a recovery needs, read from the live game. */
const recoveryState = (stuck: boolean) => {
  const body = avatarRT()
  const mount = mountOf(characterRT.active)
  const x = mount ? mount.x : body.pos.x
  const z = mount ? mount.z : body.pos.z
  const y = mount ? mount.y : body.pos.y
  const broken = !isFinitePos(body.pos.x, body.pos.y, body.pos.z) || (!!mount && !isFinitePos(mount.x, mount.y, mount.z))
  return {
    journey: travelling() || sailRT.autopilot !== null,
    off: spaceRT.realm !== "earth" || spaceRT.mode === "deep",
    broken,
    lost: !broken && (fellThrough(y, groundHeight(x, z), 8) || beyondReach(x, z, HOME_SPOT) || (!mount && waterDepthAt(x, z) > 6)),
    stuck,
  }
}


/**
 * "Take me somewhere safe". Returns the plan carried out (for tests and the
 * caller). `stuck` is true when a movement key has made no progress.
 */
export const recoverToSafety = (stuck = false, hint: (text: string) => void = say): RecoveryPlan => {
  if (fastTravelRT.pending) return "none"
  const plan = recoveryPlan(recoveryState(stuck))
  if (plan === "journey") {
    // a journey between worlds: arrive now; an autopilot: take the reins back
    if (travelling()) { skipJourney(); hint("Arriving now.") }
    else { skyCommands.cancel = true; hint("You take the reins. You're in control again.") }
  } else if (plan === "space") {
    // Rescue is deliberately unconditional: normal travel can wait for a
    // companion to board, but help must also work with someone stranded on
    // foot or a broken saddle on another world. The captured party comes too.
    schedule("home", HOME_SPOT, true)
    hint("A thread of starlight carries you safely home.")
  } else if (plan === "home") {
    schedule("home", HOME_SPOT, true)
    hint("Something went wrong with the way. Taking you home.")
  } else if (plan === "nearby") {
    const body = avatarRT()
    const mount = mountOf(characterRT.active)
    const x = mount ? mount.x : body.pos.x, z = mount ? mount.z : body.pos.z
    const spot = stuck
      ? nearestSafeSpot(x, z, (px, pz) => Math.hypot(px - x, pz - z) >= 4 && standsHere(px, pz), 60, 2) ?? HOME_SPOT
      : safeSpotNear(x, z)
    schedule("safe ground", spot, true)
    hint("Set back on solid ground. Carry on.")
  } else {
    hint("You're already somewhere safe.")
  }
  return plan
}

export const RECOVER_ACTION: GameAction = "recover"
