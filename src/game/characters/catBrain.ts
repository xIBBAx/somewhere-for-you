/**
 * Cat decision logic — kept pure so it can be unit-tested.
 * The component owns timers and applies the transitions.
 */
import type { CatState } from "../runtime"

export type CatBrainCtx = {
  distToPlayer: number
  playerMoving: boolean
  playerIdleTime: number
  hasPoi: boolean
  finale: boolean
  atPoi: boolean
  affectionReady: boolean
  atAffectionSpot: boolean
  affectionComplete: boolean
  poiMode?: "investigate" | "crouch" | "chase"
  /** a lightning strike or thunderclap just startled her */
  scared?: boolean
  /** the fright has worn off */
  scaredDone?: boolean
  /** The explorer is petting her right now */
  petting?: boolean
  /** The explorer called her ("pspsps") */
  called?: boolean
  /** a timed action (yawn, scratch, shake, meow, …) has played out */
  actionDone?: boolean
  /** she would rather weave round the explorer's legs than sit (rolled by the caller) */
  wantRub?: boolean
}

/** Idle behaviours a resting cat cycles through while the explorer stays put. */
export const IDLE_BEHAVIORS = [
  "sit",
  "lookAround",
  "stretch",
  "sleep",
  "groom",
  "knead",
  "roll",
  "yawn",
  "scratch",
  "loaf",
  "meow",
] as const satisfies readonly CatState[]
export type IdleBehavior = (typeof IDLE_BEHAVIORS)[number]

/** Seconds a timed action lasts before she settles back into a sit. */
export const ACTION_DURATION: Partial<Record<CatState, number>> = {
  yawn: 2.4,
  scratch: 2.3,
  shake: 1.3,
  meow: 2.7,
  scared: 3.2,
}

/** States in which she is settled near the explorer and can be interrupted freely. */
const RESTING = new Set<CatState>([
  "sit",
  "lookAround",
  "stretch",
  "sleep",
  "groom",
  "knead",
  "roll",
  "yawn",
  "scratch",
  "loaf",
  "meow",
  "shake",
])

export const isRestingState = (s: CatState): boolean => RESTING.has(s)

/** Pick the next idle behaviour. `roll` is a uniform random number. */
export const pickIdleBehavior = (idleTime: number, roll: number): IdleBehavior => {
  if (idleTime > 14 && roll < 0.5) return "sleep"
  if (roll < 0.22) return "sit"
  if (roll < 0.36) return "lookAround"
  if (roll < 0.46) return "groom"
  if (roll < 0.55) return "stretch"
  if (roll < 0.63) return "loaf"
  if (roll < 0.7) return "knead"
  if (roll < 0.76) return "roll"
  if (roll < 0.82) return "yawn"
  if (roll < 0.88) return "scratch"
  if (roll < 0.95) return "meow"
  return "sit"
}

export const catNextState = (cur: CatState, ctx: CatBrainCtx): CatState => {
  if (ctx.finale) return cur === "runAhead" ? cur : "runAhead"

  // A fright beats everything but the finale; she bolts to the explorer's feet.
  if (ctx.scared && cur !== "scared") return "scared"
  if (cur === "scared") return ctx.scaredDone ? "follow" : "scared"

  // Being petted holds her for as long as the hand keeps stroking.
  if (ctx.petting) return "petted"
  if (cur === "petted") return "sit"

  if (ctx.hasPoi) {
    const poiMode = ctx.poiMode ?? "investigate"
    if (ctx.atPoi) return "sit"
    return poiMode
  }

  if (ctx.called && cur !== "greet" && cur !== "rub") return "greet"

  // Walking away always interrupts an affectionate idle moment immediately.
  if (ctx.playerMoving && (cur === "affectionApproach" || cur === "affection" || cur === "rub")) return "follow"

  switch (cur) {
    case "investigate":
      return "follow"
    case "runAhead":
      return "follow"
    case "chase":
    case "crouch":
      return "follow"
    case "greet":
      // trotting up, tail high; once at her feet she weaves round her legs
      if (ctx.distToPlayer < 0.95) return ctx.playerMoving ? "follow" : "rub"
      return "greet"
    case "rub":
      return ctx.actionDone ? "sit" : "rub"
    case "affectionApproach":
      if (ctx.distToPlayer > 3.4) return "follow"
      return ctx.atAffectionSpot ? "affection" : "affectionApproach"
    case "affection":
      return ctx.affectionComplete ? "sit" : "affection"
    case "catchup":
      if (ctx.distToPlayer < 4.5) return ctx.wantRub && !ctx.playerMoving ? "greet" : "follow"
      return "catchup"
    case "follow":
      if (ctx.distToPlayer > 6.5) return "catchup"
      if (ctx.affectionReady && ctx.distToPlayer <= 3.2) return "affectionApproach"
      if (ctx.distToPlayer <= 2.1 && !ctx.playerMoving) return ctx.wantRub ? "rub" : "sit"
      return "follow"
    case "arrive":
      return ctx.playerMoving ? "follow" : "sit"
    default:
      if (RESTING.has(cur)) {
        if (ctx.playerMoving || ctx.distToPlayer > 2.6) return "follow"
        if (ctx.affectionReady) return "affectionApproach"
        if (ctx.actionDone && ACTION_DURATION[cur] !== undefined) return "sit"
        return cur
      }
      return "follow"
  }
}
