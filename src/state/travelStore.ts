import { create } from "zustand"
import type { TravelDestination, TravelPhase } from "../game/celestial/cosmicTravel"

/**
 * Low-frequency UI state for cosmic travel (celestial/cosmicTravel.ts): the
 * "Direct to Planets" picker and the journey readout. The scene consumes
 * `travelCommands` each frame (CelestialController).
 */
type TravelUI = {
  pickerOpen: boolean
  /** Optional, transient body highlighted when an atlas Travel button opens the picker. */
  pickerBodyId: string | null
  setPicker: (open: boolean, bodyId?: string) => void
  /** mirrored at ~4 Hz from travelRT for the HUD */
  phase: TravelPhase
  name: string
  progress: number
  style: "cinematic" | "quick"
  setJourney: (j: { phase: TravelPhase; name: string; progress: number; style: "cinematic" | "quick" }) => void
}

export const useTravel = create<TravelUI>((set, get) => ({
  pickerOpen: false,
  pickerBodyId: null,
  setPicker: (open, bodyId) => {
    const pickerBodyId = open ? bodyId ?? null : null
    if (get().pickerOpen !== open || get().pickerBodyId !== pickerBodyId) set({ pickerOpen: open, pickerBodyId })
  },
  phase: "idle",
  name: "",
  progress: 0,
  style: "cinematic",
  setJourney: (j) => {
    const s = get()
    if (s.phase !== j.phase || s.name !== j.name || Math.abs(s.progress - j.progress) > 0.02 || s.style !== j.style) set(j)
  },
}))

/** Requests from the UI to the scene. */
export const travelCommands = {
  go: null as { dest: TravelDestination; style: "cinematic" | "quick" } | null,
  skip: false,
  drop: false,
}

/** Event boundary: UI requests a trip; the game loop validates and starts it. */
export const requestJourney = (dest: TravelDestination, style: "cinematic" | "quick"): void => {
  travelCommands.go = { dest, style }
}
