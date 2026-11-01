import { create } from "zustand"
import type { DragonMode } from "./dragonFlight"

/** What the rest of the game reads about the dragon (camera, HUD, menus). */
export const dragonRT = {
  loaded: false,
  mode: "soar" as DragonMode,
  /** she is being carried (boarding, flying, coming down) */
  riding: false,
  x: 0,
  y: 0,
  z: 0,
  /** set by QA (or a menu) to board on the next frame the dragon is circling */
  wantBoard: false,
  /** the chase camera while she rides (FollowCamera follows it when active) */
  camera: { active: false, px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0, fov: 50, roll: 0 },
}

type DragonUI = { prompt: string | null; setPrompt: (prompt: string | null) => void }

export const useDragonUI = create<DragonUI>((set) => ({
  prompt: null,
  setPrompt: (prompt) => set({ prompt }),
}))
