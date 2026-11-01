import type { GameState } from "./gameStore"
import type { WorldTimeMode } from "../game/timeOfDay"
import { isSkyChoice, type SkyChoice } from "../game/weather/weatherTypes"
import { MEMORIES, TOTAL_STARS } from "../content/memories"
import { SECRETS } from "../content/secrets"

const KEY = "gift-world/save"
const VERSION = 1

export type SaveData = {
  version: number
  started: boolean
  visited: string[]
  stars: number
  secrets: string[]
  audioOn: boolean
  timeMode?: WorldTimeMode
  sky?: SkyChoice
  finale: GameState["finale"]
}

const knownIds = (value: unknown, allowed: readonly { id: string }[]): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && allowed.some(item => item.id === id)))] : []

export const loadSave = (): SaveData | null => {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw || raw.length > 100_000) return null
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== "object" || Array.isArray(data) || !("version" in data) || data.version !== VERSION) return null
    const record = data as Record<string, unknown>
    const visited = knownIds(record.visited, MEMORIES)
    const stars = typeof record.stars === "number" && Number.isFinite(record.stars) ? Math.max(0, Math.min(TOTAL_STARS, Math.trunc(record.stars))) : visited.length
    return {
      version: VERSION,
      started: record.started === true,
      visited,
      stars,
      secrets: knownIds(record.secrets, SECRETS),
      audioOn: typeof record.audioOn === "boolean" ? record.audioOn : true,
      timeMode: record.timeMode === "day" || record.timeMode === "night" ? record.timeMode : "auto",
      sky: isSkyChoice(record.sky) ? record.sky : "live",
      // Choreography depends on live camera/body state that isn't persisted.
      // Keep an interrupted ending available to replay from its garden gate.
      // Older saves could finish with six memories. Preserve their keepsakes,
      // while making the complete nine-star finale available again.
      finale: record.finale === "done" && stars === TOTAL_STARS && visited.length === MEMORIES.length ? "done" : "locked",
    }
  } catch {
    return null
  }
}

export const writeSave = (state: GameState): void => {
  try {
    const data: SaveData = {
      version: VERSION,
      started: state.started,
      visited: state.visitOrder,
      stars: state.stars,
      secrets: state.secrets,
      audioOn: state.audioOn,
      timeMode: state.timeMode,
      sky: state.sky,
      finale: state.finale === "done" ? "done" : "locked",
    }
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // storage unavailable (private mode etc.) — the game still works, progress just won't persist
  }
}

export const clearSave = (): void => {
  try {
    localStorage.removeItem(KEY)
    localStorage.removeItem("gift-world/location")
  } catch {
    // ignore
  }
}
