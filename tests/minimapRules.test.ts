import { describe, expect, it } from "vitest"
import { autoZoomIndex, minimapView, RANGES } from "../src/game/navigation/minimapRules"

describe("corner minimap visibility", () => {
  it("is on throughout play, without a destination, in either HUD mode", () => {
    expect(minimapView({ modal: false, atlasOpen: false, travelPhase: "idle" })).toBe("map")
  })

  it("hides only while a modal surface covers the game", () => {
    expect(minimapView({ modal: true, atlasOpen: false, travelPhase: "idle" })).toBe("hidden")
    expect(minimapView({ modal: true, atlasOpen: true, travelPhase: "corridor" })).toBe("hidden")
  })

  it("gives way to the full atlas while it is open", () => {
    expect(minimapView({ modal: false, atlasOpen: true, travelPhase: "idle" })).toBe("atlas")
  })

  it("swaps the radar for a destination ring during any cosmic journey phase", () => {
    for (const phase of ["gather", "corridor", "emerge", "reentry"]) {
      expect(minimapView({ modal: false, atlasOpen: false, travelPhase: phase })).toBe("journey")
    }
  })
})

describe("automatic minimap zoom", () => {
  const walking = { flying: false, airborne: false, mounted: false, altitude: 0 }
  it("keeps walking close, widens for riding or jumping, and sees the most in flight or at height", () => {
    expect(RANGES[autoZoomIndex(walking)]).toBe(70)
    expect(RANGES[autoZoomIndex({ ...walking, mounted: true })]).toBe(180)
    expect(RANGES[autoZoomIndex({ ...walking, airborne: true })]).toBe(180)
    expect(RANGES[autoZoomIndex({ ...walking, flying: true })]).toBe(500)
    expect(RANGES[autoZoomIndex({ ...walking, altitude: 40 })]).toBe(500)
  })

  it("keeps the zoom ladder strictly increasing", () => {
    expect(RANGES).toEqual([...RANGES].sort((a, b) => a - b))
    expect(new Set(RANGES).size).toBe(RANGES.length)
  })
})
