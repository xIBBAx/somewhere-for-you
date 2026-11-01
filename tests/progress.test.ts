import { beforeEach, describe, expect, it } from "vitest"

// minimal localStorage shim for the node environment
const store = new Map<string, string>()
const localStorageMock = {
  getItem: (k: string): string | null => store.get(k) ?? null,
  setItem: (k: string, v: string): void => void store.set(k, v),
  removeItem: (k: string): void => void store.delete(k),
  clear: (): void => void store.clear(),
}
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock })

import { useGame } from "../src/state/gameStore"
import { loadSave } from "../src/state/persistence"
import { MEMORIES, TOTAL_STARS } from "../src/content/memories"

const reset = (): void => {
  localStorageMock.clear()
  useGame.setState({
    started: false,
    visited: {},
    visitOrder: [],
    stars: 0,
    secrets: [],
    timeMode: "auto",
    activeMemoryId: null,
    activeSecretId: null,
    finale: "locked",
    finaleMessage: false,
    hint: null,
  })
}

describe("memory progression", () => {
  beforeEach(reset)

  it("closing a memory marks it visited and grants one star", () => {
    useGame.getState().openMemory("first-steps")
    useGame.getState().closeMemory()
    const s = useGame.getState()
    expect(s.visited["first-steps"]).toBe(true)
    expect(s.stars).toBe(1)
  })

  it("never double-counts a memory", () => {
    useGame.getState().markVisited("long-way")
    useGame.getState().markVisited("long-way")
    useGame.getState().addStar()
    useGame.getState().addStar()
    expect(useGame.getState().stars).toBe(2)
    expect(useGame.getState().visitOrder.filter((id) => id === "long-way")).toHaveLength(1)
  })

  it("closing with no open memory grants nothing", () => {
    useGame.getState().closeMemory()
    expect(useGame.getState().stars).toBe(0)
  })

  it("unknown memory and secret IDs cannot pause the UI or award progress", () => {
    useGame.getState().openMemory("missing")
    useGame.getState().markVisited("missing")
    useGame.getState().closeMemory()
    useGame.getState().openSecret("missing")
    expect(useGame.getState()).toMatchObject({ activeMemoryId: null, activeSecretId: null, visitOrder: [], stars: 0 })
  })

  it("reset removes transient ending and hint overlays", () => {
    useGame.getState().setFinaleMessage(true)
    useGame.getState().showHint("old hint")
    useGame.getState().resetProgress()
    expect(useGame.getState()).toMatchObject({ finale: "locked", finaleMessage: false, hint: null })
  })

  it("secrets are recorded once", () => {
    useGame.getState().openSecret("hidden-note")
    useGame.getState().closeSecret()
    useGame.getState().openSecret("hidden-note")
    useGame.getState().closeSecret()
    expect(useGame.getState().secrets).toEqual(["hidden-note"])
  })

  it("unlockAll visits every memory exactly once", () => {
    useGame.getState().unlockAll()
    const s = useGame.getState()
    expect(s.stars).toBe(TOTAL_STARS)
    expect(new Set(s.visitOrder).size).toBe(MEMORIES.length)
  })

  it("progress persists across a store recreation", async () => {
    useGame.getState().openMemory("corner-cafe")
    useGame.getState().closeMemory()
    await new Promise((r) => setTimeout(r, 400)) // save is debounced ~250ms
    const saved = loadSave()
    expect(saved?.visited).toContain("corner-cafe")
    expect(saved?.stars).toBe(1)
    expect(saved?.version).toBe(1)
  })

  it("audio preference flips", () => {
    const before = useGame.getState().audioOn
    useGame.getState().toggleAudio()
    expect(useGame.getState().audioOn).toBe(!before)
  })

  it("persists the manual world-time preference", async () => {
    useGame.getState().setTimeMode("night")
    await new Promise((r) => setTimeout(r, 400))
    expect(loadSave()?.timeMode).toBe("night")
  })
})
