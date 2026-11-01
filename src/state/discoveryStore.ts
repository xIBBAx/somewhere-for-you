import { create } from "zustand"
import { discoveryRT } from "../world/discoveries"

/** Low-frequency UI state for discoveries (counter, prompt, toast). */
export type DiscoveryToast = { id: number; title: string; line: string; kind: string }

type DiscoveryState = {
  count: number
  prompt: string | null
  toast: DiscoveryToast | null
  setPrompt: (p: string | null) => void
  showToast: (t: Omit<DiscoveryToast, "id">) => void
  clearToast: (id: number) => void
  refreshCount: () => void
}

let toastId = 0

export const useDiscoveries = create<DiscoveryState>((set, get) => ({
  count: discoveryRT.total,
  prompt: null,
  toast: null,
  setPrompt: (p) => {
    if (get().prompt !== p) set({ prompt: p })
  },
  showToast: (t) => set({ toast: { ...t, id: ++toastId } }),
  clearToast: (id) => {
    if (get().toast?.id === id) set({ toast: null })
  },
  refreshCount: () => set({ count: discoveryRT.total }),
}))
