import { describe, expect, it } from "vitest"
import { ArrivalTracker } from "../src/game/navigation/arrival"
import { navigationSnapshot } from "../src/game/navigation/navigationState"
import { characterRT, playerRT } from "../src/game/runtime"
import { groundHeight } from "../src/game/world-layout"
import type { Mark } from "../src/state/navigationStore"

const mark: Mark = { kind: "earth", id: "mark:1", name: "Nearby mark", x: 117, z: 0 }
const at = (x: number) => {
  characterRT.active = "explorer"
  playerRT.pos.set(x, groundHeight(x, 0), 0)
  playerRT.jumpHeight = 0
  return navigationSnapshot(mark, 70)
}

describe("ground arrival feedback", () => {
  it("finishes a mark selected just 17 metres away, using the same arrival range as guidance", () => {
    const tracker = new ArrivalTracker()
    expect(tracker.update(mark.id, at(100).arrived, true)).toBe(false)
    const close = at(109)
    expect(close.arrived).toBe(true)
    expect(close.detail).toBe("Within 10 m · on the ground")
    expect(tracker.update(mark.id, close.arrived, false)).toBe(true)
    expect(tracker.update(mark.id, close.arrived, false)).toBe(false)
  })

  it("keeps a mark made underfoot until she leaves and walks back", () => {
    const tracker = new ArrivalTracker()
    expect(tracker.update(mark.id, at(117).arrived, false)).toBe(false)
    expect(tracker.update(mark.id, at(100).arrived, true)).toBe(false)
    expect(tracker.update(mark.id, at(117).arrived, false)).toBe(true)
  })

  it("does not carry an earlier approach through changing or clearing the destination", () => {
    const tracker = new ArrivalTracker()
    tracker.update("mark:1", false, true)
    expect(tracker.update("mark:2", true, false)).toBe(false)
    expect(tracker.update("mark:1", true, false)).toBe(false)
    tracker.update("mark:1", false, true)
    tracker.update(null, false, false)
    expect(tracker.update("mark:1", true, false)).toBe(false)
    tracker.update("mark:1", false, true)
    expect(tracker.update("mark:1", true, false)).toBe(true)
  })

  it("does not count jumping over an underfoot mark as leaving its arrival range", () => {
    const tracker = new ArrivalTracker()
    at(117)
    expect(tracker.update(mark.id, true, false)).toBe(false)
    playerRT.jumpHeight = 1
    const jumping = navigationSnapshot(mark, 70)
    expect(jumping.arrived).toBe(false)
    expect(jumping.horizontal).toBe(0)
    expect(tracker.update(mark.id, jumping.arrived, jumping.horizontal! >= 10)).toBe(false)
    expect(tracker.update(mark.id, at(117).arrived, false)).toBe(false)
  })
})
