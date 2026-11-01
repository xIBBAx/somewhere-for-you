import { create } from "zustand"

export type HudMode = "minimal" | "immersive"
export type ExplorationPanel = "menu" | "controls" | "atlas" | "observation" | "sky" | "together"
const KEY = "gift-world.exploration-ui.v1"
const readMode = (): HudMode => {
  try { return localStorage.getItem(KEY) === "immersive" ? "immersive" : "minimal" }
  catch { return "minimal" }
}

type ExplorationUI = {
  mode: HudMode
  /** One deliberately opened surface at a time. Never persisted across reloads. */
  panel: ExplorationPanel | null
  setMode: (mode: HudMode) => void
  toggleMode: () => void
  open: (panel: ExplorationPanel | null) => void
}
export const useExplorationUI = create<ExplorationUI>((set, get) => ({
  mode: readMode(), panel: null,
  setMode: mode => {
    if (mode !== "minimal" && mode !== "immersive") return
    try { localStorage.setItem(KEY, mode) } catch { /* presentation is optional */ }
    set({ mode, panel: null })
  },
  toggleMode: () => get().setMode(get().mode === "minimal" ? "immersive" : "minimal"),
  open: panel => set({ panel }),
}))
