import { avatarRT, characterRT, input, playerRT, companionRT } from "../runtime"
import { useGame } from "../../state/gameStore"
import { mountDrivers, mountInteractions } from "../mounts/mount"
import { riderRT, startMount, requestDismount } from "../horses/riding"
import { SPECIES, canCarryRider } from "./species"
import { acceptsRider, frighten, gentleTouch, trustStage } from "./relationships"
import { deerRT, type DeerState } from "./state"
import { deerJump, deerProbe, stepDeerMotion } from "./motion"
import { deerMode } from "./brain"
import { beginDeerAffection } from "./affection"
import { showDeerOffer } from "./interactionUI"

export const registerDeerMount = (d: DeerState): void => {
  mountDrivers.set(d, {
    permission: (id) => (!canCarryRider(d.ident) ? "small" : acceptsRider(d.relationships[id]) ? "accept" : "reject"),
    motion: (dt, turn) => stepDeerMotion(d, dt, turn),
    probe: (heading, distance) => deerProbe(d, heading, distance),
    jump: () => deerJump(d),
    rest: () => {
      deerMode(d, d.alarm > 0.3 ? "retreat" : "alert")
      d.reservedBy = null
    },
    attempt: (id, accepted) => {
      deerMode(d, "ridden")
      if (accepted) {
        d.relationships[id].accepted = true
        deerRT.stats.accepted++
      }
    },
    reject: (id) => {
      frighten(d.relationships[id], 0.65, deerRT.time)
      d.alarm = 0.8
      d.react = 1.25
      const body = id === "explorer" ? playerRT : companionRT
      d.watchX = body.pos.x
      d.watchZ = body.pos.z
      deerRT.stats.rejections++
      useGame.getState().showHint(`${d.ident.name} isn't ready. A soft tumble, then some space.`)
    },
    pat: (id) => {
      gentleTouch(d.relationships[id], deerRT.time)
      d.affection = 3
    },
  })
}
export const deerInteraction = (pat: boolean): string | null => {
  const id = characterRT.active,
    r = riderRT[id],
    body = avatarRT()
  if (r.horse?.kind === "deer") {
    showDeerOffer(null)
    if (r.phase !== "riding")
      return r.phase === "rejecting"
        ? "Finding your feet…"
        : r.phase === "mounting"
          ? "Easy… let them decide."
          : "Stepping gently down…"
    if (pat) {
      mountDrivers.get(r.horse)?.pat(id)
      r.pat = 1.8
    }
    if (input.interact) {
      input.interact = false
      requestDismount(id)
    }
    return `E — step down · B — gentle pat · Shift — quicken · Space — bound`
  }
  if (r.phase !== "none") {
    showDeerOffer(null)
    return null
  }
  if (body.paused || body.gesture !== "none") {
    showDeerOffer(null)
    return null
  }
  let best: DeerState | null = null,
    dist = 4.2
  for (const d of deerRT.animals.values()) {
    if (!d.model || d.rider) continue
    const n = Math.hypot(d.x - body.pos.x, d.z - body.pos.z)
    if (n < dist) {
      best = d
      dist = n
    }
  }
  deerRT.near = best
  if (!best) {
    showDeerOffer(null)
    return null
  }
  const d = best,
    rel = d.relationships[id],
    p = SPECIES[d.ident.species]
  const eligible = canCarryRider(d.ident),
    ready = acceptsRider(rel)
  const resting = d.pose.lie > 0.1
  showDeerOffer({
    id: d.ident.id,
    name: d.ident.name,
    species: `${p.name}${d.ident.age === "fawn" ? (d.ident.species === "yak" ? " calf" : " fawn") : ""}`,
    stage: ready && eligible ? "Ready to welcome a rider" : trustStage(rel),
    advice: !eligible
      ? d.ident.age === "fawn"
        ? "Little ones are never mounts. You can earn the family's friendship."
        : "Too small to carry a rider. A friend to walk beside."
      : rel.fear > 0.25
        ? "They need space. Step back slowly, then wait quietly nearby."
        : ready
          ? resting
            ? "Resting. A quiet hello will invite them to stand."
            : "Come alongside. They know and trust you."
          : rel.trust < 0.3
            ? "Wait a few steps away. Move slowly; let them get to know you. An early riding attempt may be refused."
            : "Use gentle hellos, with quiet pauses between them. Riding comes after several kind meetings.",
    ride: eligible ? (resting ? "Invite to stand" : ready ? "Climb on" : "Try riding") : null,
    hello: rel.trust >= 0.3 ? (dist > 1.5 ? "Offer your hand" : "Gentle hello") : "Quiet hello",
  })
  if (pat) {
    const invited = dist > 1.5 && rel.trust >= 0.3 && rel.fear < 0.25
    const result = invited ? "approach" : gentleTouch(rel, deerRT.time)
    if (invited) {
      d.affection = 8
      useGame.getState().showHint("Hold still. They are coming to greet your open hand.")
    }
    if (result === "accepted") {
      d.affection = 3.2
      deerMode(d, "affection")
      d.targetSpeed = 0
      deerRT.stats.pets++
      body.facing = Math.atan2(d.x - body.pos.x, d.z - body.pos.z)
      beginDeerAffection(id, d)
      useGame.getState().showHint(`${d.ident.name} leans into your gentle hello. ${trustStage(rel)}.`)
    } else if (!invited)
      useGame
        .getState()
        .showHint(
          result === "wait"
            ? "Let this quiet moment last a little longer."
            : `${d.ident.name} is watching. Pause a few steps away and let them come closer.`,
        )
  }
  if (input.interact) {
    input.interact = false
    if (!canCarryRider(d.ident))
      useGame
        .getState()
        .showHint(
          d.ident.age === "fawn"
            ? "A little one. Give the family space; young animals are never mounts."
            : `${p.name} are too small to carry a rider. You can earn their friendship.`,
        )
    else if (resting) {
      d.affection = Math.max(d.affection, 4)
      deerMode(d, "alert")
      useGame.getState().showHint(`${d.ident.name} is getting to their feet. Wait a moment, then press E.`)
    } else {
      const result = startMount(id, d)
      if (result === "blocked") useGame.getState().showHint("Wait for a little clear ground beside them.")
      if (result === "busy") useGame.getState().showHint("Let them finish resting first.")
    }
  }
  const age =
    d.ident.age === "fawn"
      ? d.ident.species === "yak"
        ? "calf"
        : "fawn"
      : d.ident.sex === "female"
        ? "female"
        : "male"
  return `${d.ident.name} · ${p.name} ${age} · ${trustStage(rel)}${d.alarm > 0.35 ? " · needs space" : ""}${eligible ? (ready ? " · E — climb on" : " · B — befriend · E — try riding") : " · too small to ride · B — befriend"}`
}
export const installDeerInteraction = (): (() => void) => {
  mountInteractions.wildlife = deerInteraction
  return () => {
    showDeerOffer(null)
    if (mountInteractions.wildlife === deerInteraction) mountInteractions.wildlife = null
  }
}
