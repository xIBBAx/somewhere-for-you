import { create } from "zustand"

/** Whether the Personalize screen is open (Explore menu, the letter's link, or ?personalize). */
export const usePersonalizeUI = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: typeof window !== "undefined" && new URLSearchParams(window.location.search).has("personalize"),
  setOpen: (open) => set({ open }),
}))
