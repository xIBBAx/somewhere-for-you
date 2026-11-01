import { useFrame } from "@react-three/fiber"
import { input, takeAction, worldRT } from "../runtime"
import { useGame } from "../../state/gameStore"
import { spaceRT } from "../celestial/spaceState"
import { useActivityUI } from "./activityState"
import { makeContext, type ActivityContext } from "./context"
import { cancelStones, startStoneAim, StoneVisual, stonesPrompt, throwStone, updateStones } from "./stones"
import { LanternVisual, lanternPrompt, startLantern, updateLanterns } from "./lanterns"
import { FireflyVisual, fireflyPrompt, startCatch, updateFireflies } from "./fireflies"
import { BouquetVisual, flowerPrompt, startFlower, putDownFlowers, updateFlowers } from "./flowers"
import { cancelRace, RaceVisual, startRace, updateRace } from "./race"
import { benchPrompt, startBench, updateBench } from "./highvaleBench"

type Offer = { prompt: (ctx: ActivityContext) => string | null; start: (ctx: ActivityContext) => void }

/** Offered in priority order; the first available one owns the E prompt. */
const OFFERS: Offer[] = [
  { prompt: benchPrompt, start: startBench },
  { prompt: stonesPrompt, start: startStoneAim },
  { prompt: flowerPrompt, start: startFlower },
  { prompt: fireflyPrompt, start: startCatch },
  { prompt: lanternPrompt, start: startLantern },
]

/**
 * Little things to do anywhere in the world (before and after the
 * finale). Runs after the together director clears pose requests and
 * before the characters read them; yields to memories, secrets,
 * discoveries and animals that want the same key.
 */
export const Activities = (): React.ReactElement => {
  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const ctx = makeContext(dt, state.clock.elapsedTime)
    const ui = useActivityUI.getState()
    updateStones(ctx)
    updateLanterns(ctx)
    updateFireflies(ctx)
    updateFlowers(ctx)
    updateRace(ctx)
    updateBench(ctx)
    if (takeAction("putDown")) putDownFlowers(ctx)

    const mode = ui.mode
    if (mode === "stoneAim") {
      ui.setPrompt(null)
      if (input.interact || input.jump) { input.interact = input.jump = false; throwStone() }
      if (input.cancel) { input.cancel = false; cancelStones() }
      return
    }
    if (mode === "race") {
      ui.setPrompt(null)
      takeAction("race")
      if (input.cancel) { input.cancel = false; cancelRace() }
      return
    }
    if (mode !== "none") { ui.setPrompt(null); return }
    // R and X always answer: they start, or say plainly why not yet
    const onEarth = spaceRT.realm === "earth" && spaceRT.mode === "local"
    const why = (text: string): void => { const game = useGame.getState(); if (onEarth && game.started && !worldRT.introActive) game.showHint(text) }
    if (takeAction("race")) {
      if (ctx.free && ctx.water === "land") { startRace(ctx); return }
      why(ctx.water !== "land" ? "Races start on dry ground." : "Find a quiet stretch of open ground to race.")
    }
    const stars = ctx.night && ctx.free && ctx.water === "land"
    const starsAsked = takeAction("stars")
    if (starsAsked && !stars) why(!ctx.night ? "The stars come out after dusk." : ctx.water !== "land" ? "Stargazing is for dry land." : "Find a quiet spot on open ground to look at the stars.")
    if (starsAsked && stars) {
      // sit down in the grass and look up
      ctx.body.paused = true
      ctx.body.vel.set(0, 0, 0)
      ctx.body.gesture = "sit"
      ctx.body.gestureTime = 0
      const f = worldRT.focus
      f.active = true
      f.x = ctx.body.pos.x + Math.sin(ctx.body.facing) * 2
      f.z = ctx.body.pos.z + Math.cos(ctx.body.facing) * 2
      f.yaw = ctx.body.facing + Math.PI + 0.4
      f.pitch = -0.2
      f.distance = 5
      ui.setMode("stars")
      return
    }

    let offer: Offer | null = null
    let prompt: string | null = null
    if (ctx.free) {
      for (const candidate of OFFERS) {
        prompt = candidate.prompt(ctx)
        if (prompt) { offer = candidate; break }
      }
    }
    // at night the sky itself is an activity
    if (stars && (!prompt || prompt.includes("lantern"))) prompt = prompt ? `${prompt} · X — stargaze` : "X — look at the stars"
    ui.setPrompt(prompt)
    if (offer && input.interact) {
      input.interact = false
      offer.start(ctx)
    }
  }, -35)
  return <>
    <StoneVisual />
    <LanternVisual />
    <FireflyVisual />
    <BouquetVisual />
    <RaceVisual />
  </>
}
