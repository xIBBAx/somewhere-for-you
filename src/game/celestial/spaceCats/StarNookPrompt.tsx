import { useFrame } from "@react-three/fiber"
import { useRef } from "react"
import { avatarRT, input } from "../../runtime"
import { discoveryRT } from "../../../world/discoveries"
import { useGame } from "../../../state/gameStore"
import { STAR_NOOK } from "../../../world/starNookLayout"
import { spaceCatsRT } from "./catsRuntime"
import { crewNames } from "./crew"

/**
 * E by a space cat at Star Nook: say hello. Mounted right after Wildlife,
 * which writes the shared animal prompt every frame, and before the
 * discovery system that shows it (and only takes E when no animal has).
 */
export const StarNookPrompt = (): null => {
  const told = useRef(false)
  const shown = useRef<string | null>(null)
  useFrame(() => {
    // take back our own prompt from last frame (Wildlife may not have rewritten it)
    if (shown.current && discoveryRT.animalPrompt === shown.current) discoveryRT.animalPrompt = null
    shown.current = null
    if (spaceCatsRT.phase !== "nook" || discoveryRT.animalPrompt || discoveryRT.horsePrompt) return
    const p = avatarRT().pos
    if (Math.hypot(p.x - STAR_NOOK.x, p.z - STAR_NOOK.z) > 9) return
    if (!told.current) {
      told.current = true
      useGame.getState().showHint(`Star Nook — ${crewNames()} live here now.`)
    }
    let best: (typeof spaceCatsRT.cats)[number] | null = null
    let bestD = 1.7
    for (const c of spaceCatsRT.cats) {
      if (!c.visible) continue
      const d = Math.hypot(c.x - p.x, c.z - p.z)
      if (d < bestD) { bestD = d; best = c }
    }
    if (!best) return
    discoveryRT.animalPrompt = shown.current = `E — say hello to ${best.name}`
    if (input.interact && !avatarRT().paused) {
      input.interact = false
      spaceCatsRT.greet = best.id
    }
  })
  return null
}
