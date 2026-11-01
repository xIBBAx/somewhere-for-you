import { create } from "zustand"
import { ACHIEVEMENTS, type AchievementId } from "../content/adventures"

/**
 * the journal: records, unlocked pages and the photo album for all the
 * activities in the world. Persisted locally, separately from story progress
 * so a story reset never deletes photographs.
 */
export type Records = {
  stonesThrown: number
  bestSkips: number
  fireflies: number
  bestJar: number
  lanterns: number
  flowers: number
  bouquets: number
  photos: number
  races: number
  raceWins: number
  bestRace: number
  constellations: string[]
  handInHand: number
  hugs: number
  highFives: number
  danceSeconds: number
  wishes: number
}

export type Photo = { id: string; time: number; data: string; who: string }

type AdventureState = {
  records: Records
  unlocked: AchievementId[]
  album: Photo[]
  /** unlock being shown as a toast; later unlocks wait in `queue` */
  fresh: { id: AchievementId; at: number } | null
  queue: AchievementId[]
  open: boolean
  bump: <K extends keyof Records>(key: K, value: Records[K] extends number ? number : never, mode?: "add" | "max") => void
  setRecord: <K extends keyof Records>(key: K, value: Records[K]) => void
  addConstellation: (name: string) => void
  unlock: (id: AchievementId) => void
  addPhoto: (photo: Photo) => void
  removePhoto: (id: string) => void
  setOpen: (open: boolean) => void
  clearFresh: () => void
}

const KEY = "gift-world/adventures"
const ALBUM_KEY = "gift-world/album"
const MAX_PHOTOS = 24

const emptyRecords = (): Records => ({
  stonesThrown: 0, bestSkips: 0, fireflies: 0, bestJar: 0, lanterns: 0, flowers: 0, bouquets: 0, photos: 0,
  races: 0, raceWins: 0, bestRace: 0, constellations: [], handInHand: 0, hugs: 0, highFives: 0, danceSeconds: 0, wishes: 0,
})

const load = (): { records: Records; unlocked: AchievementId[]; album: Photo[] } => {
  const out = { records: emptyRecords(), unlocked: [] as AchievementId[], album: [] as Photo[] }
  try {
    const raw = localStorage.getItem(KEY)
    if (raw && raw.length < 200_000) {
      const data = JSON.parse(raw) as { records?: Partial<Records>; unlocked?: unknown }
      const base = emptyRecords()
      for (const key of Object.keys(base) as (keyof Records)[]) {
        const value = data.records?.[key]
        if (key === "constellations") base.constellations = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, 32) : []
        else if (typeof value === "number" && Number.isFinite(value) && value >= 0) (base[key] as number) = value
      }
      out.records = base
      if (Array.isArray(data.unlocked)) out.unlocked = data.unlocked.filter((id): id is AchievementId => typeof id === "string" && id in ACHIEVEMENTS)
    }
    const album = localStorage.getItem(ALBUM_KEY)
    if (album) {
      const list = JSON.parse(album) as unknown
      if (Array.isArray(list)) out.album = list.filter((p): p is Photo => !!p && typeof p === "object" && typeof (p as Photo).data === "string" && (p as Photo).data.startsWith("data:image/")).slice(-MAX_PHOTOS)
    }
  } catch { /* a fresh book */ }
  return out
}

const saved = load()

export const useAdventures = create<AdventureState>((set, get) => ({
  records: saved.records,
  unlocked: saved.unlocked,
  album: saved.album,
  fresh: null,
  queue: [],
  open: false,
  bump: (key, value, mode = "add") => {
    const records = { ...get().records }
    const current = records[key] as unknown as number
    ;(records[key] as unknown as number) = mode === "max" ? Math.max(current, value) : current + value
    set({ records })
    checkAchievements()
  },
  setRecord: (key, value) => {
    set({ records: { ...get().records, [key]: value } })
    checkAchievements()
  },
  addConstellation: (name) => {
    const records = get().records
    if (records.constellations.includes(name)) return
    set({ records: { ...records, constellations: [...records.constellations, name] } })
    checkAchievements()
  },
  unlock: (id) => {
    if (get().unlocked.includes(id)) return
    const showing = get().fresh !== null
    set({ unlocked: [...get().unlocked, id], ...(showing ? { queue: [...get().queue, id] } : { fresh: { id, at: Date.now() } }) })
  },
  addPhoto: (photo) => {
    const album = [...get().album, photo].slice(-MAX_PHOTOS)
    set({ album })
    saveAlbum(album)
    get().bump("photos", 1)
  },
  removePhoto: (id) => {
    const album = get().album.filter((p) => p.id !== id)
    set({ album })
    saveAlbum(album)
  },
  setOpen: (open) => set({ open }),
  clearFresh: () => {
    const [next, ...rest] = get().queue
    set({ fresh: next ? { id: next, at: Date.now() } : null, queue: rest })
  },
}))

const saveAlbum = (album: Photo[]): void => {
  // a full storage quota drops the oldest photographs rather than failing
  for (let keep = album.length; keep >= 0; keep--) {
    try {
      localStorage.setItem(ALBUM_KEY, JSON.stringify(album.slice(album.length - keep)))
      return
    } catch { /* try with fewer photos */ }
  }
}

/** Unlock every page whose condition the records now satisfy. */
export const checkAchievements = (): void => {
  const state = useAdventures.getState()
  for (const [id, page] of Object.entries(ACHIEVEMENTS) as [AchievementId, (typeof ACHIEVEMENTS)[AchievementId]][]) {
    if (!state.unlocked.includes(id) && page.done(state.records)) state.unlock(id)
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
useAdventures.subscribe((state, prev) => {
  if (state.records === prev.records && state.unlocked === prev.unlocked) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ records: state.records, unlocked: state.unlocked })) } catch { /* optional */ }
  }, 300)
})
