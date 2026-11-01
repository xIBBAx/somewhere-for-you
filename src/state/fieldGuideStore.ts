import { create } from "zustand"
import { GROUND_KINDS, isGroundKind, type GroundKindId } from "../content/groundLife"

/**
 * The field guide: which little ground creatures the explorer has met up close.
 * Persisted on its own key (like the journal) so a story reset never
 * forgets a ladybird. Loading is defensive: empty, corrupt, foreign or older
 * data degrades to whatever can be trusted, never to an exception.
 */
export const FIELD_GUIDE_KEY = "gift-world/field-guide"
export const FIELD_GUIDE_VERSION = 1

export type FieldGuideEntry = {
  /** epoch ms of the first meeting (0 when migrated without a date) */
  first: number
  /** how many separate meetings */
  times: number
}

export type FieldGuideSeen = Partial<Record<GroundKindId, FieldGuideEntry>>

type FieldGuideState = {
  seen: FieldGuideSeen
  /** Record a meeting. Returns true the first time a kind is met. */
  markSeen: (id: GroundKindId, at?: number) => boolean
  /** Re-read storage (tests, other tabs). */
  hydrate: () => void
  reset: () => void
}

const validEntry = (value: unknown): FieldGuideEntry | null => {
  if (value === true) return { first: 0, times: 1 }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const first = typeof record.first === "number" && Number.isFinite(record.first) && record.first >= 0 ? record.first : 0
  const times = typeof record.times === "number" && Number.isFinite(record.times) && record.times >= 1 ? Math.min(1e6, Math.floor(record.times)) : 1
  return { first, times }
}

/**
 * Parse stored data. Accepts the current `{ version, seen: { id: entry } }`
 * shape, a bare `{ id: entry }` map, and the earliest draft's plain array of
 * ids; unknown kinds and malformed entries are dropped.
 */
export const parseFieldGuide = (raw: string | null): FieldGuideSeen => {
  const out: FieldGuideSeen = {}
  if (!raw || raw.length > 50_000) return out
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return out
  }
  if (Array.isArray(data)) {
    for (const id of data) if (isGroundKind(id)) out[id] = { first: 0, times: 1 }
    return out
  }
  if (!data || typeof data !== "object") return out
  const record = data as Record<string, unknown>
  const seen = "seen" in record ? record.seen : record
  if (Array.isArray(seen)) {
    for (const id of seen) if (isGroundKind(id)) out[id] = { first: 0, times: 1 }
    return out
  }
  if (!seen || typeof seen !== "object") return out
  for (const [id, value] of Object.entries(seen as Record<string, unknown>)) {
    if (!isGroundKind(id)) continue
    const entry = validEntry(value)
    if (entry) out[id] = entry
  }
  return out
}

export const loadFieldGuide = (): FieldGuideSeen => {
  try {
    return parseFieldGuide(localStorage.getItem(FIELD_GUIDE_KEY))
  } catch {
    return {}
  }
}

const save = (seen: FieldGuideSeen): void => {
  try {
    localStorage.setItem(FIELD_GUIDE_KEY, JSON.stringify({ version: FIELD_GUIDE_VERSION, seen }))
  } catch {
    // storage unavailable (private mode, quota): the guide still works this session
  }
}

/** Meetings closer together than this count as one. */
const REMEET_MS = 60_000
const lastMet: Partial<Record<GroundKindId, number>> = {}

export const useFieldGuide = create<FieldGuideState>((set, get) => ({
  seen: loadFieldGuide(),
  markSeen: (id, at = Date.now()) => {
    const current = get().seen[id]
    if (current && at - (lastMet[id] ?? -Infinity) < REMEET_MS) return false
    lastMet[id] = at
    const seen = { ...get().seen, [id]: current ? { first: current.first, times: current.times + 1 } : { first: at, times: 1 } }
    set({ seen })
    save(seen)
    return !current
  },
  hydrate: () => set({ seen: loadFieldGuide() }),
  reset: () => {
    for (const id of GROUND_KINDS) delete lastMet[id]
    set({ seen: {} })
    save({})
  },
}))

export const fieldGuideCount = (seen: FieldGuideSeen): number => GROUND_KINDS.filter((id) => !!seen[id]).length
