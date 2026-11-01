import { MEMORIES, TOTAL_STARS } from "../content/memories"
import type { GameState } from "./gameStore"

/** All nine keepsakes lead to the finale; completing it unlocks free play. */
export const finaleReady = (game: Pick<GameState, "stars" | "visitOrder">): boolean =>
  game.stars === TOTAL_STARS && MEMORIES.every(memory => game.visitOrder.includes(memory.id))

export const companionUnlocked = (game: Pick<GameState, "stars" | "visitOrder" | "finale">): boolean =>
  finaleReady(game) && game.finale === "done"
