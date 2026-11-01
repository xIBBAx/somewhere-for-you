import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MEMORIES, TOTAL_STARS } from "../src/content/memories"
import { loadSave, writeSave } from "../src/state/persistence"
import { useGame } from "../src/state/gameStore"

const KEY = "gift-world/save"
let storage: Map<string, string>
beforeEach(() => {
  storage = new Map()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
})
afterEach(() => vi.unstubAllGlobals())
const save = (value: unknown): void => { storage.set(KEY, JSON.stringify(value)) }

describe("save recovery", () => {
  it.each([null, [], "broken", { version: 2 }])("rejects unsupported save roots: %j", value => {
    save(value)
    expect(loadSave()).toBeNull()
  })

  it("recovers usable fields without trusting malformed collections or settings", () => {
    save({ version: 1, started: true, visited: "broken", secrets: {}, stars: "nine", audioOn: "false", timeMode: "broken", finale: "broken" })
    expect(loadSave()).toMatchObject({ started: true, visited: [], secrets: [], stars: 0, audioOn: true, timeMode: "auto", finale: "locked" })
  })

  it("keeps known IDs once in visit order and bounds the star count", () => {
    save({ version: 1, visited: ["first-steps", "missing", "first-steps", "corner-cafe"], secrets: ["hidden-note", null, "missing", "hidden-note"], stars: 1e12 })
    expect(loadSave()).toMatchObject({ visited: ["first-steps", "corner-cafe"], secrets: ["hidden-note"], stars: TOTAL_STARS })
  })

  it("leaves interrupted choreography replayable while preserving earned progress", () => {
    save({ version: 1, started: true, visited: MEMORIES.map(m => m.id), stars: TOTAL_STARS, finale: "playing" })
    expect(loadSave()).toMatchObject({ started: true, stars: TOTAL_STARS, finale: "locked" })
    writeSave({ ...useGame.getState(), finale: "playing" })
    expect(JSON.parse(storage.get(KEY)!)).toHaveProperty("finale", "locked")
  })

  it("preserves a completed finale and explicit preferences", () => {
    save({ version: 1, started: true, visited: MEMORIES.map(m => m.id), stars: TOTAL_STARS, audioOn: false, timeMode: "night", finale: "done" })
    expect(loadSave()).toMatchObject({ started: true, stars: TOTAL_STARS, audioOn: false, timeMode: "night", finale: "done" })
  })

  it("preserves an older six-star journey without prematurely unlocking the companion", () => {
    const visited = MEMORIES.slice(0, 6).map(m => m.id)
    save({ version: 1, started: true, visited, stars: 6, finale: "done" })
    expect(loadSave()).toMatchObject({ started: true, visited, stars: 6, finale: "locked" })
  })

  it("continues without storage access", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("denied") }, setItem: () => { throw new Error("denied") } })
    expect(loadSave()).toBeNull()
    expect(() => writeSave(useGame.getState())).not.toThrow()
  })
})
