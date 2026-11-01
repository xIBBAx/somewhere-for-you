import { create } from "zustand"

/**
 * Low-frequency UI state for activities (prompt, results). Per-frame values
 * such as the throw meter live in `activityRT` and are read by the HUD in its
 * own animation frame, so they never re-render React.
 */
export type ActivityMode = "none" | "stoneAim" | "stoneThrow" | "lantern" | "photo" | "stars" | "race" | "pick" | "place" | "catch" | "highvale"

export const activityRT = {
  mode: "none" as ActivityMode,
  /** 0..1 oscillating throw marker while aiming a stone */
  meter: 0,
  /** race clock (s) and countdown (s, > 0 before the start) */
  raceTime: 0,
  countdown: 0,
  /** fireflies in the jar tonight */
  jar: 0,
  /** flowers in hand */
  bouquet: 0,
}

type ActivityUI = {
  carried: string | null
  setCarried: (label: string | null) => void
  prompt: string | null
  mode: ActivityMode
  result: { title: string; line: string; id: number } | null
  setPrompt: (prompt: string | null) => void
  setMode: (mode: ActivityMode) => void
  showResult: (title: string, line: string) => void
  clearResult: (id: number) => void
}

let resultId = 0

export const useActivityUI = create<ActivityUI>((set, get) => ({
  carried: null,
  setCarried: (carried) => { if (get().carried !== carried) set({ carried }) },
  prompt: null,
  mode: "none",
  result: null,
  setPrompt: (prompt) => { if (get().prompt !== prompt) set({ prompt }) },
  setMode: (mode) => { activityRT.mode = mode; if (get().mode !== mode) set({ mode }) },
  showResult: (title, line) => set({ result: { title, line, id: ++resultId } }),
  clearResult: (id) => { if (get().result?.id === id) set({ result: null }) },
}))
