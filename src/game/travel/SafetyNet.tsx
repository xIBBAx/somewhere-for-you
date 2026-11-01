import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import { avatarRT, characterRT, input, takeAction, worldRT } from "../runtime"
import { useGame } from "../../state/gameStore"
import { useExplorationUI } from "../../state/explorationUIStore"
import { riderRT } from "../horses/riding"
import type { HorseState } from "../horses/horseState"
import { groundHeight } from "../world-layout"
import { StarShimmer } from "./StarShimmer"
import { fadeRT, RECOVER_ACTION, recoverToSafety, stepFastTravel, fastTravelRT, fastPlaces, fastTravelTo } from "./fastTravel"
import { fellThrough, HoldTimer, isFinitePos, StuckTimer } from "./safety"
import { restoreLocationCheckpoint, saveLocationCheckpoint } from "./locationMemory"
import { registerDevTool } from "../../dev/devTools"

/**
 * The safety net, one per-frame system: it runs the fade of fast travel,
 * carries out "Take me somewhere safe" (the recover action), and watches for
 * the two ways a character gets lost on Earth: falling through the ground
 * (or a broken position) is put right at once with a gentle hint, and a
 * movement key that makes no progress for a few seconds gets a hint that
 * names the way out. It also hosts the starlight shimmer of Starborn's arrival
 * and the screen fade, which is a full-screen element driven by fadeRT.
 */

const FALL_TIME = 0.5
const STUCK_TIME = 4
const say = (text: string): void => useGame.getState().showHint(text)

/** the one body and mount whose position the safety checks read */
const subject = () => {
  const id = characterRT.active
  const r = riderRT[id]
  const mount = r.phase === "none" ? null : (r.horse as HorseState | null)
  const horse = mount && (mount as HorseState).kind === "horse" ? mount : null
  const body = avatarRT()
  return { id, body, horse, onFoot: r.phase === "none" && body.rideY === null, riding: r.phase === "riding" && !!horse }
}

/** the screen fade element (created once, set each frame from fadeRT) */
let veil: HTMLDivElement | null = null

export const SafetyNet = (): React.ReactElement => {
  const fall = useMemo(() => new HoldTimer(FALL_TIME), [])
  const stuck = useMemo(() => new StuckTimer(STUCK_TIME, 1), [])
  const saveTime = useRef(0)
  useEffect(() => {
    const save = (): void => { saveLocationCheckpoint() }
    const onHidden = (): void => { if (document.hidden) save() }
    window.addEventListener("pagehide", save)
    document.addEventListener("visibilitychange", onHidden)
    registerDevTool("recover", (() => recoverToSafety(true)) as never)
    registerDevTool("fastTravel", ((id: string) => {
      const place = fastPlaces().find(p => p.id === id)
      return place ? fastTravelTo(place) : "Unknown place."
    }) as never)
    registerDevTool("saveLocation", () => saveLocationCheckpoint())
    return () => {
      window.removeEventListener("pagehide", save)
      document.removeEventListener("visibilitychange", onHidden)
      save()
    }
  }, [])
  useEffect(() => {
    // one full-screen element, transparent until fastTravel fades it to black
    const el = document.createElement("div")
    el.setAttribute("aria-hidden", "true")
    Object.assign(el.style, { position: "fixed", inset: "0", background: "#05060d", opacity: "0", pointerEvents: "none", zIndex: "60" })
    document.body.appendChild(el)
    veil = el
    return () => {
      veil = null
      el.remove()
    }
  }, [])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    stepFastTravel(dt)
    if (veil) veil.style.opacity = fadeRT.level.toFixed(3)
    const game = useGame.getState()
    const free = game.started && !worldRT.introActive && !worldRT.finaleActive && !game.activeMemoryId && !game.activeSecretId && !characterRT.switching && useExplorationUI.getState().panel !== "controls"
    const recover = takeAction(RECOVER_ACTION) && !fastTravelRT.pending
    if (!free) {
      // asked for during a cutscene or a switch: say so, rather than dropping it silently
      if (recover && game.started) game.showHint("In a moment — once this scene has finished, Take me somewhere safe will work.")
      fall.reset()
      stuck.reset()
      return
    }
    if (!avatarRT().paused) {
      restoreLocationCheckpoint()
      saveTime.current += dt
      if (saveTime.current >= 4) { saveTime.current = 0; saveLocationCheckpoint() }
    }
    if (recover) {
      recoverToSafety(true, say)
      return
    }
    // a fade or a relocation is under way: nothing to check yet
    if (fastTravelRT.pending) return

    const s = subject()
    const x = s.horse ? s.horse.x : s.body.pos.x
    const z = s.horse ? s.horse.z : s.body.pos.z
    const y = s.horse ? s.horse.y : s.body.pos.y

    // falling through the world, or a position that is no longer a number: put right now
    const broken = !isFinitePos(s.body.pos.x, s.body.pos.y, s.body.pos.z) || (!!s.horse && !isFinitePos(s.horse.x, s.horse.y, s.horse.z))
    const flying = !!s.horse?.flight && s.horse.flight.mode !== "ground"
    const below = !flying && isFinitePos(x, y, z) && fellThrough(y, groundHeight(x, z), 8)
    if (broken) {
      recoverToSafety(false, say)
      return
    }
    if (fall.update(dt, below)) {
      recoverToSafety(false, say)
      return
    }

    // stuck: a movement key held, on foot or on the ground, with no progress
    const pushing = Math.hypot(input.move.x, input.move.y) > 0.3
    const onGround = s.onFoot || (s.riding && (!s.horse?.flight || s.horse.flight.mode === "ground"))
    if (stuck.update(dt, x, z, pushing && onGround)) say("Stuck? Explore → Take me somewhere safe")
  })

  return <StarShimmer />
}
