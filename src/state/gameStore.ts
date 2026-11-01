import { create } from "zustand"
import { MEMORIES, TOTAL_STARS } from "../content/memories"
import { nextTimeMode, type WorldTimeMode } from "../game/timeOfDay"
import { nextSkyChoice, type SkyChoice } from "../game/weather/weatherTypes"
import { clearSave, loadSave, writeSave } from "./persistence"
import { getSecret } from "../content/secrets"

export type FinaleStatus = "locked" | "playing" | "done"

export type GameState = {
  started: boolean
  visited: Record<string, boolean>
  visitOrder: string[]
  stars: number
  secrets: string[]
  audioOn: boolean
  timeMode: WorldTimeMode
  /** the weather she chose (Explore menu); "live" follows her real sky */
  sky: SkyChoice
  activeMemoryId: string | null
  activeSecretId: string | null
  finale: FinaleStatus
  finaleMessage: boolean
  hint: string | null

  start: () => void
  openMemory: (id: string) => void
  closeMemory: () => void
  openSecret: (id: string) => void
  closeSecret: () => void
  markVisited: (id: string) => void
  addStar: () => void
  toggleAudio: () => void
  cycleTimeMode: () => void
  setTimeMode: (mode: WorldTimeMode) => void
  cycleSky: () => void
  setFinale: (status: FinaleStatus) => void
  setFinaleMessage: (v: boolean) => void
  showHint: (text: string) => void
  unlockAll: () => void
  resetProgress: () => void
}

const saved = loadSave()

export const useGame = create<GameState>((set, get) => ({
  started: saved?.started ?? false,
  visited: Object.fromEntries((saved?.visited ?? []).map((id) => [id, true])),
  visitOrder: saved?.visited ?? [],
  stars: saved?.stars ?? 0,
  secrets: saved?.secrets ?? [],
  audioOn: saved?.audioOn ?? true,
  timeMode: saved?.timeMode ?? "auto",
  sky: saved?.sky ?? "live",
  activeMemoryId: null,
  activeSecretId: null,
  finale: saved?.finale ?? "locked",
  finaleMessage: false,
  hint: null,

  start: () => set({ started: true }),

  openMemory: (id) => { if (MEMORIES.some(memory => memory.id === id)) set({ activeMemoryId: id }) },

  closeMemory: () => {
    const id = get().activeMemoryId
    set({ activeMemoryId: null })
    if (id && !get().visited[id]) {
      get().markVisited(id)
      get().addStar()
    }
  },

  openSecret: (id) => { if (getSecret(id)) set({ activeSecretId: id }) },

  closeSecret: () => {
    const id = get().activeSecretId
    set({ activeSecretId: null })
    if (id && !get().secrets.includes(id)) set({ secrets: [...get().secrets, id] })
  },

  markVisited: (id) => {
    if (get().visited[id] || !MEMORIES.some(memory => memory.id === id)) return
    set({
      visited: { ...get().visited, [id]: true },
      visitOrder: [...get().visitOrder, id],
    })
  },

  addStar: () => set({ stars: Math.min(get().stars + 1, TOTAL_STARS) }),

  toggleAudio: () => set({ audioOn: !get().audioOn }),

  cycleTimeMode: () => set({ timeMode: nextTimeMode(get().timeMode) }),

  setTimeMode: (mode) => set({ timeMode: mode }),

  cycleSky: () => set({ sky: nextSkyChoice(get().sky) }),

  setFinale: (status) => set({ finale: status }),

  setFinaleMessage: (v) => set({ finaleMessage: v }),

  showHint: (text) => {
    set({ hint: text })
    clearTimeout(hintTimer)
    // long enough to read: a little longer for a longer line
    hintTimer = setTimeout(() => set({ hint: null }), hintDuration(text))
  },

  unlockAll: () =>
    set({
      visited: Object.fromEntries(MEMORIES.map((m) => [m.id, true])),
      visitOrder: MEMORIES.map((m) => m.id),
      stars: TOTAL_STARS,
    }),

  resetProgress: () => {
    clearTimeout(hintTimer)
    clearSave()
    set({
      started: false,
      visited: {},
      visitOrder: [],
      stars: 0,
      secrets: [],
      activeMemoryId: null,
      activeSecretId: null,
      finale: "locked",
      finaleMessage: false,
      hint: null,
    })
  },
}))

// Persist coarse progress whenever it changes (cheap; writes are tiny).
let saveTimer: ReturnType<typeof setTimeout> | undefined
/** How long a hint stays up (ms): 3.8 s, plus reading time past ~50 characters, at most 8 s. */
export const hintDuration = (text: string): number => Math.min(8000, 3800 + Math.max(0, text.length - 50) * 45)

let hintTimer: ReturnType<typeof setTimeout> | undefined
useGame.subscribe((state) => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => writeSave(state), 250)
})

/** A page can close before the debounce fires; flush the latest earned star. */
export const flushGameSave = (): void => {
  clearTimeout(saveTimer)
  writeSave(useGame.getState())
}

export const visitedCount = (state: GameState): number => state.visitOrder.length
