import { describe, expect, it } from "vitest"
import { bubbleBottom } from "../src/ui/bubblePlacement"

// landscape phone: the shared-actions row across the top centre
const bar = { left: 230, right: 610, top: 112, bottom: 150 }

describe("speech bubble placement", () => {
  it("stays above the speaker when clear of the action row", () => {
    expect(bubbleBottom(420, 300, 120, 40, bar)).toBe(300)
    expect(bubbleBottom(420, 140, 120, 40, null)).toBe(140)
    // beside the row horizontally
    expect(bubbleBottom(700, 140, 120, 40, bar)).toBe(140)
  })

  it("drops below the action row instead of covering it", () => {
    const y = bubbleBottom(470, 140, 120, 40, bar)
    expect(y - 40).toBeGreaterThanOrEqual(bar.bottom)
    // a bubble whose top would just touch the row also moves
    expect(bubbleBottom(470, 190, 120, 40, bar) - 40).toBeGreaterThanOrEqual(bar.bottom)
  })
})
