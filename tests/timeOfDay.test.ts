import { describe, expect, it } from "vitest"
import {
  automaticTimeTarget,
  explorationTimeTarget,
  nextTimeMode,
} from "../src/game/timeOfDay"

describe("world time mode", () => {
  it("maps automatic time to the real clock when sunrise/sunset unavailable", () => {
    // 10:00 local with no sunrise/sunset → day segment of localClockTimeTarget
    expect(automaticTimeTarget({ nowMs: new Date(2026, 0, 1, 10, 0, 0).getTime() })).toBeCloseTo(
      0.05,
      2,
    )
    // 22:00 → night
    expect(automaticTimeTarget({ nowMs: new Date(2026, 0, 1, 22, 0, 0).getTime() })).toBe(1)
  })

  it("lets day and night override exploration without changing clock", () => {
    const ctx = { nowMs: new Date(2026, 0, 1, 10, 0, 0).getTime() }
    expect(explorationTimeTarget("day", ctx)).toBe(0)
    expect(explorationTimeTarget("night", ctx)).toBe(1)
    // auto follows the clock/context
    expect(explorationTimeTarget("auto", ctx)).toBeCloseTo(0.05, 2)
  })

  it("cycles auto → day → night → auto", () => {
    expect(nextTimeMode("auto")).toBe("day")
    expect(nextTimeMode("day")).toBe("night")
    expect(nextTimeMode("night")).toBe("auto")
  })
})
