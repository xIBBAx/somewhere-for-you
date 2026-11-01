import { describe, expect, it } from "vitest"
import {
  COMPANION_REVEAL_END,
  COMPANION_REVEAL_START,
  getCompanionVisibility,
} from "../src/game/interactions/companionVisibility"

describe("The companion's finale-only visibility gate", () => {
  it("does not mount him during ordinary exploration, even after arbitrary time", () => {
    expect(getCompanionVisibility("locked", 0)).toEqual({
      mounted: false,
      visible: false,
      scale: 0,
    })
    expect(getCompanionVisibility("locked", 10_000).mounted).toBe(false)
  })

  it("preloads him invisibly after finale activation", () => {
    expect(getCompanionVisibility("playing", COMPANION_REVEAL_START - 0.1)).toEqual({
      mounted: true,
      visible: false,
      scale: 1,
    })
  })

  it("reveals him only during the finale choreography", () => {
    const midway = getCompanionVisibility(
      "playing",
      (COMPANION_REVEAL_START + COMPANION_REVEAL_END) / 2,
    )
    expect(midway.mounted).toBe(true)
    expect(midway.visible).toBe(true)
    expect(midway.scale).toBe(1)
    expect(getCompanionVisibility("playing", COMPANION_REVEAL_END).scale).toBe(1)
  })

  it("keeps him present after the completed reveal", () => {
    expect(getCompanionVisibility("done", 0)).toEqual({
      mounted: true,
      visible: true,
      scale: 1,
    })
  })
})
