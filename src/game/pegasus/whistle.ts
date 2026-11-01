import { avatarRT, characterRT, type CharacterId } from "../runtime"
import { horseRT } from "../horses/horseState"
import { horseSounds } from "../horses/horseAudio"
import { callHorse, riderRT } from "../horses/riding"
import { isAirborne } from "./flight"
import { pegasusRT } from "./pegasi"
import { names } from "../../personalization"

/**
 * Whistle for your own Pegasus (Y, or the whistle button): The explorer's Ivory,
 * The companion's Onyx. The character puts two fingers to the lips and
 * whistles, then raises an arm to the sky. However far away the Pegasus is,
 * it comes: close by it trots over; further off it takes wing and flies in;
 * from very far away it arrives out of the sky behind you. It lands beside
 * you, following you if you keep walking.
 */
export const whistleForPegasus = (id: CharacterId, hint: (text: string) => void): boolean => {
  const body = avatarRT()
  const r = riderRT[id]
  const h = horseRT.horses.get(pegasusRT.own[id])
  if (!h) return false
  if (r.phase !== "none") {
    hint(r.horse === h ? `You're riding ${h.ident.name}.` : "Get down first, then whistle.")
    return false
  }
  // the whistle itself: fingers to the lips, then an arm raised to the sky
  if (body.gesture === "none" && !body.paused) {
    body.gesture = "whistle"
    body.gestureTime = 0
  }
  horseSounds.whistle()
  if (h.rider || h.passenger) {
    const who = h.rider === "explorer" || h.passenger === "explorer" ? `${names.explorer}` : `${names.companion}`
    hint(`${h.ident.name} is carrying ${who} right now.`)
    return false
  }
  const d = Math.hypot(h.x - body.pos.x, h.z - body.pos.z)
  const prev = horseRT.bonded[id]
  callHorse(id, h)
  horseRT.bonded[id] = prev
  const she = h.ident.breed === "ivory" ? "she" : "he"
  hint(d < 25 ? `${h.ident.name} pricks up ${she === "she" ? "her" : "his"} ears and comes over.`
    : isAirborne(h) ? `You whistle for ${h.ident.name} — ${she}'s flying to you.`
      : `You whistle for ${h.ident.name} — ${she}'s on ${she === "she" ? "her" : "his"} way.`)
  return true
}

/** The active character's own Pegasus: name and distance (HUD). */
export const ownPegasusInfo = (): { name: string; distance: number } | null => {
  const id = characterRT.active
  const h = horseRT.horses.get(pegasusRT.own[id])
  if (!h) return null
  const b = avatarRT().pos
  return { name: h.ident.name, distance: Math.hypot(h.x - b.x, h.z - b.z) }
}
