import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FIELD_GUIDE_KEY, FIELD_GUIDE_VERSION, fieldGuideCount, loadFieldGuide, parseFieldGuide, useFieldGuide } from "../src/state/fieldGuideStore"

let storage: Map<string, string>
beforeEach(() => {
  storage = new Map()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
  useFieldGuide.getState().reset()
  storage.clear()
})
afterEach(() => vi.unstubAllGlobals())

describe("field guide persistence", () => {
  it.each([null, "", "{not json", "42", '"ladybird"', "null", "{}", '{"seen":7}', '{"version":1,"seen":null}'])("starts empty from %j", (raw) => {
    expect(parseFieldGuide(raw)).toEqual({})
  })

  it("migrates the earliest plain list of ids, dropping unknown kinds", () => {
    expect(parseFieldGuide(JSON.stringify(["ladybird", "unicorn", 3, "snail", "snail"]))).toEqual({
      ladybird: { first: 0, times: 1 },
      snail: { first: 0, times: 1 },
    })
    expect(parseFieldGuide(JSON.stringify({ seen: ["earthworm"] }))).toEqual({ earthworm: { first: 0, times: 1 } })
  })

  it("keeps trustworthy entries and repairs malformed ones", () => {
    const raw = JSON.stringify({
      version: 1,
      seen: {
        snail: { first: 1700000000000, times: 3 },
        woodlouse: { first: -5, times: "many" },
        millipede: true,
        dragon: { first: 1, times: 1 },
        ladybird: "yes",
        harvestman: { first: Number.MAX_VALUE, times: 1e12 },
      },
    })
    expect(parseFieldGuide(raw)).toEqual({
      snail: { first: 1700000000000, times: 3 },
      woodlouse: { first: 0, times: 1 },
      millipede: { first: 0, times: 1 },
      harvestman: { first: Number.MAX_VALUE, times: 1e6 },
    })
    // a bare map from a future or foreign writer is still readable
    expect(parseFieldGuide(JSON.stringify({ grasshopper: { first: 9, times: 2 } }))).toEqual({ grasshopper: { first: 9, times: 2 } })
    // absurdly large blobs are ignored instead of parsed
    expect(parseFieldGuide(`["ladybird"${", 1".repeat(30000)}]`)).toEqual({})
  })

  it("records first meetings, counts re-meetings, and persists them", () => {
    const guide = useFieldGuide.getState()
    expect(guide.markSeen("ladybird", 1000)).toBe(true)
    expect(useFieldGuide.getState().markSeen("ladybird", 2000)).toBe(false)
    expect(useFieldGuide.getState().seen.ladybird).toEqual({ first: 1000, times: 1 })
    // a separate meeting a few minutes later counts again, but is not "new"
    expect(useFieldGuide.getState().markSeen("ladybird", 1000 + 5 * 60_000)).toBe(false)
    expect(useFieldGuide.getState().seen.ladybird).toEqual({ first: 1000, times: 2 })
    useFieldGuide.getState().markSeen("earthworm", 3000)
    const stored = JSON.parse(storage.get(FIELD_GUIDE_KEY)!)
    expect(stored.version).toBe(FIELD_GUIDE_VERSION)
    expect(stored.seen).toEqual({ ladybird: { first: 1000, times: 2 }, earthworm: { first: 3000, times: 1 } })
    expect(loadFieldGuide()).toEqual(stored.seen)
    expect(fieldGuideCount(useFieldGuide.getState().seen)).toBe(2)
  })

  it("recovers from corrupt storage and keeps working without storage at all", () => {
    storage.set(FIELD_GUIDE_KEY, "}{")
    useFieldGuide.getState().hydrate()
    expect(useFieldGuide.getState().seen).toEqual({})
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied")
      },
      setItem: () => {
        throw new Error("quota")
      },
      removeItem: () => undefined,
    })
    expect(loadFieldGuide()).toEqual({})
    expect(useFieldGuide.getState().markSeen("snail", 10)).toBe(true)
    expect(useFieldGuide.getState().seen.snail).toEqual({ first: 10, times: 1 })
  })
})
