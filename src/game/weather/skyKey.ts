import { useGame } from "../../state/gameStore"
import { SKY_LABEL, type SkyChoice } from "./weatherTypes"

/** Key 2: the next weather, named in a short label. The sky itself is the effect. */
export const changeSkyByKey = (): SkyChoice | null => {
  const game = useGame.getState()
  if (!game.started) return null
  game.cycleSky()
  const sky = useGame.getState().sky
  game.showHint(sky === "live" ? "Weather: live (your real sky)" : `Weather: ${SKY_LABEL[sky]}`)
  return sky
}
