import type { CharacterId } from "../runtime"
import type { DeerIdentity } from "./species"

export type Relationship = {
  trust: number
  fear: number
  encounters: number
  kindness: number
  scares: number
  accepted: boolean
  lastSeen: number
  lastKind: number
  calm: number
  space: number
}
export type RelationshipPair = Record<CharacterId, Relationship>
export const relationship = (): Relationship => ({
  trust: 0.04,
  fear: 0,
  encounters: 0,
  kindness: 0,
  scares: 0,
  accepted: false,
  lastSeen: 0,
  lastKind: -1000,
  calm: 0,
  space: 0,
})
export const relationships = (): RelationshipPair => ({ explorer: relationship(), companion: relationship() })
export const trustStage = (r: Relationship): string =>
  r.accepted && r.trust >= 0.76
    ? "Accepts a rider"
    : r.trust >= 0.76
      ? "Trusting"
      : r.trust >= 0.56
        ? "Comfortable"
        : r.trust >= 0.34
          ? "Familiar"
          : r.trust >= 0.13
            ? "Cautious"
            : "Stranger"
export const acceptsRider = (r: Relationship): boolean =>
  r.trust >= 0.76 && r.fear < 0.18 && r.kindness >= 4 && r.encounters >= 2
export const frighten = (r: Relationship, amount: number, time: number): void => {
  r.fear = Math.min(1, r.fear + amount)
  r.trust = Math.max(0, r.trust - amount * 0.22)
  r.scares++
  r.calm = 0
  r.space = 0
  r.lastSeen = time
}

/** Calm observation is bounded. Affection and giving space are separate
 * positive events; waiting at a distance alone cannot unlock riding. */
export const observePerson = (
  r: Relationship,
  i: DeerIdentity,
  distance: number,
  speed: number,
  approach: number,
  dt: number,
  time: number,
): "calm" | "threat" | "neutral" => {
  if (distance > 30) {
    r.fear = Math.max(0, r.fear - dt * 0.025)
    return "neutral"
  }
  if (time - r.lastSeen > 45) r.encounters++
  r.lastSeen = time
  const danger = speed > 4.2 && approach > 1.2 && distance < (i.age === "fawn" ? 10 : 8)
  const crowding = distance < 1.25 && r.trust < 0.45 && speed > 0.9
  if (danger || crowding) {
    r.fear = Math.min(1, r.fear + dt * (danger ? 0.45 : 0.22))
    r.trust = Math.max(0, r.trust - dt * 0.035)
    r.calm = 0
    return "threat"
  }
  // A deliberate retreat after concern is rewarded once, then re-arms only
  // after a genuinely new calm encounter. Running circles cannot farm trust.
  if (distance > 5 && distance < 15 && approach < -0.2 && speed < 4.2 && r.fear > 0.16) {
    r.space += dt
    if (r.space >= 2 && time - r.lastKind > 10) {
      r.kindness++
      r.trust = Math.min(0.9, r.trust + 0.075)
      r.lastKind = time
      r.space = -20
    }
  }
  r.fear = Math.max(0, r.fear - dt * (distance > 4 ? 0.065 : 0.025))
  if (speed < 0.6 && distance >= 2.6 && distance <= 12 && r.fear < 0.4) {
    r.calm += dt
    const cap = r.kindness >= 3 ? 0.83 : r.kindness >= 1 ? 0.56 : 0.37
    if (r.trust < cap) r.trust = Math.min(cap, r.trust + dt * 0.0055 * (1.25 - i.traits.patience * 0.5))
    if (r.calm > 7 && time - r.lastKind > 16 && r.kindness === 0) {
      r.kindness++
      r.lastKind = time
    }
    return "calm"
  }
  r.calm = Math.max(0, r.calm - dt * 0.4)
  return "neutral"
}

export const gentleTouch = (r: Relationship, time: number): "tooSoon" | "wait" | "accepted" => {
  if (r.trust < 0.3 || r.fear > 0.25) return "tooSoon"
  if (time - r.lastKind < 12) return "wait"
  r.kindness++
  r.trust = Math.min(1, r.trust + 0.105)
  r.fear = Math.max(0, r.fear - 0.12)
  r.lastKind = time
  // Greeting and patient contact count as different meetings only with a
  // sustained calm interval. Rapid repeated key presses do not count.
  if (r.calm > 8) {
    r.encounters++
    r.calm = 0
  }
  return "accepted"
}
