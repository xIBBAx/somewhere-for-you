import { companionRT, playerRT, characterRT, type AvatarBody, type CharacterId } from "../runtime"
import { say } from "../together/Together"
import { fwdX, fwdZ, horseRT, type HorseState } from "./horseState"
import { riderRT } from "./riding"
import { names } from "../../personalization"

/**
 * Horses are solid to each other and to people on foot. Each horse is two
 * circles (forehand and quarters); overlaps are pushed apart by weight (a
 * Clydesdale shoves a Thoroughbred, not the other way round). A real bump
 * between two ridden horses gets a reaction: both horses snort, pin their ears
 * and toss their heads, the one that was hit is shoved sideways a step, and
 * the other rider says something — The explorer and the companion tease each other.
 */
const LINES: Record<CharacterId, Array<(horse: string) => string>> = {
  explorer: [
    () => `${names.companion}! Keep your horse on your side!`,
    () => "Oh, so it's a race you want?",
    (n) => `Hey! ${n} says that was rude.`,
    () => "Very funny. Do that again and I'm pushing back!",
    () => "Is this jousting now? I didn't bring a lance!",
  ],
  companion: [
    () => "Whoa! Easy there, champion!",
    () => "Was that on purpose? I think that was on purpose.",
    () => "Okay, okay — you win the jousting tournament.",
    (n) => `Careful, ${n} was just starting to like you.`,
    () => "Rematch. Right now. Race you to that tree!",
  ],
}

const mass = (h: HorseState): number => (h.ident.breed === "draft" ? 1.6 : h.ident.breed === "friesian" ? 1.2 : 1) * h.ident.scale ** 3
const cooldown = new Map<string, number>()
const circ = (h: HorseState, k: number, out: { x: number; z: number }): { x: number; z: number } => {
  const off = 0.55 * h.ident.scale
  out.x = h.x + fwdX(h.heading) * off * k
  out.z = h.z + fwdZ(h.heading) * off * k
  return out
}
const a = { x: 0, z: 0 }
const b = { x: 0, z: 0 }

export const resolveHorseContacts = (dt: number, time: number): void => {
  const list = [...horseRT.horses.values()].filter((h) => h.visible || h.rider)
  for (const [k, t] of cooldown) if (t < time) cooldown.delete(k)
  for (let i = 0; i < list.length; i++) {
    const h1 = list[i]
    h1.irritated = Math.max(0, h1.irritated - dt)
    for (let j = i + 1; j < list.length; j++) {
      const h2 = list[j]
      if (Math.abs(h1.x - h2.x) > 4 || Math.abs(h1.z - h2.z) > 4) continue
      // deepest overlap among the forehand/quarters circles
      let best = 0
      let nx = 0
      let nz = 0
      for (const k1 of [1, -1]) for (const k2 of [1, -1]) {
        circ(h1, k1, a)
        circ(h2, k2, b)
        const dx = a.x - b.x
        const dz = a.z - b.z
        const d = Math.hypot(dx, dz)
        const min = 0.5 * (h1.ident.scale + h2.ident.scale)
        if (d < min && min - d > best) {
          best = min - d
          nx = d > 1e-4 ? dx / d : 1
          nz = d > 1e-4 ? dz / d : 0
        }
      }
      if (best <= 0) continue
      const m1 = mass(h1)
      const m2 = mass(h2)
      const w1 = m2 / (m1 + m2)
      const w2 = m1 / (m1 + m2)
      h1.x += nx * best * w1
      h1.z += nz * best * w1
      h2.x -= nx * best * w2
      h2.z -= nz * best * w2
      // closing speed along the contact normal
      const v1x = fwdX(h1.heading) * h1.speed
      const v1z = fwdZ(h1.heading) * h1.speed
      const v2x = fwdX(h2.heading) * h2.speed
      const v2z = fwdZ(h2.heading) * h2.speed
      // judged along the line between the two horses: at a gallop a horse can
      // be well into the other before the frame sees it, so the circles'
      // contact normal alone can point sideways and hide a head-on bump
      const cdx = h1.x - h2.x
      const cdz = h1.z - h2.z
      const cd = Math.hypot(cdx, cdz) || 1
      const closing = Math.max(-((v1x - v2x) * nx + (v1z - v2z) * nz), -((v1x - v2x) * cdx + (v1z - v2z) * cdz) / cd)
      const key = `${h1.ident.id}|${h2.ident.id}`
      if (closing > 1.1 && !cooldown.has(key) && (h1.rider || h2.rider)) {
        cooldown.set(key, time + 2.5)
        bump(h1, h2, nx, nz, closing, w1)
        bump(h2, h1, -nx, -nz, closing, w2)
        // the rider who was bumped reacts to the one who did it
        const hitter = h1.speed * (v1x * -nx + v1z * -nz) >= h2.speed * (v2x * nx + v2z * nz) ? h1 : h2
        const victim = hitter === h1 ? h2 : h1
        if (victim.rider && hitter.rider && victim.rider !== hitter.rider) {
          const lines = LINES[victim.rider]
          say(victim.rider, lines[Math.floor(Math.random() * lines.length)](victim.ident.name), 3.2)
          riderRT[victim.rider].bank += 0.18 * Math.sign(nx || 1)
        }
      }
    }
  }
  // people on foot step aside rather than walking through a horse
  for (const id of ["explorer", "companion"] as const) {
    if (riderRT[id].phase !== "none") continue
    if (id === "companion" && !characterRT.companionPresent) continue
    const body: AvatarBody = id === "explorer" ? playerRT : companionRT
    for (const h of list) {
      if (Math.abs(h.x - body.pos.x) > 3 || Math.abs(h.z - body.pos.z) > 3) continue
      for (const k of [1, 0, -1]) {
        circ(h, k, a)
        const dx = body.pos.x - a.x
        const dz = body.pos.z - a.z
        const d = Math.hypot(dx, dz)
        const min = 0.5 * h.ident.scale + 0.32
        if (d < min && d > 1e-4) {
          body.pos.x = a.x + (dx / d) * min
          body.pos.z = a.z + (dz / d) * min
        }
      }
    }
  }
}

const bump = (h: HorseState, other: HorseState, nx: number, nz: number, closing: number, share: number): void => {
  h.irritated = 1.6
  h.gestureTimers.snort = 0
  h.gestureTimers.headShake = 0
  // a sideways shove, eased out over a few frames
  h.shoveX += nx * Math.min(1.2, closing * 0.35) * share
  h.shoveZ += nz * Math.min(1.2, closing * 0.35) * share
  h.speed *= 0.85
  h.watchX = other.x
  h.watchZ = other.z
}
