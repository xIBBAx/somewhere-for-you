import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { characterRT, input, pushAction, resetRuntime } from "../src/game/runtime"
import { makeIdentity } from "../src/game/horses/breeds"
import { makeHorseState, type HorseState } from "../src/game/horses/horseState"
import { requestDismount, resetRider, restoreRiderSeat, riderRT, stepRiding, toggleLandGallop } from "../src/game/horses/riding"
import { flightOf } from "../src/game/pegasus/flight"
import { groundHeight } from "../src/game/world-layout"
import { resetTravelState } from "../src/game/celestial/cosmicTravel"

beforeEach(() => {
  resetRider("explorer"); resetRider("companion")
  resetRuntime({ x: -36, z: -24 })
  input.move.x = input.move.y = 0
  input.sprint = input.ascend = input.descend = false
  resetTravelState()
  characterRT.active = "explorer"
})
afterEach(() => { resetRider("companion"); resetRider("explorer") })

const mounted = (tandem = false): HorseState => {
  const h = makeHorseState(makeIdentity(707, tandem ? "starborn" : "ivory", { scale: 1, saddled: true }), -36, -24, true)
  const f = flightOf(h)!
  f.mode = "air"; f.alt = 1.5
  h.y = groundHeight(h.x, h.z) + f.alt
  h.speed = h.pose.speeds[3]; h.heading = Math.PI
  restoreRiderSeat("explorer", h, 0)
  if (tandem) restoreRiderSeat("companion", h, 1)
  return h
}

describe("mounted flight and gallop controls reach movement", () => {
  it("keeps both seats through actual approach, loose-rein gallop and running takeoff", () => {
    const h = mounted(true), f = h.flight!
    // Actual authored meadow corridor; keep the terrain/collision samplers.
    h.heading = 0
    f.alt = 0.55; h.y = groundHeight(h.x, h.z) + f.alt
    pushAction("landGallop")
    for (let n = 0; n < 900 && f.mode !== "ground"; n++) stepRiding(1 / 60, n / 60)
    expect(f.mode).toBe("ground")
    expect(f.landing.run).toBe(true)
    expect(h.speed).toBeGreaterThan(h.pose.speeds[3] * 0.9)
    for (let n = 0; n < 30; n++) stepRiding(1 / 60, 15 + n / 60)
    expect(h.targetSpeed).toBe(h.pose.speeds[3])
    const speed = h.speed
    input.jump = true
    stepRiding(1 / 60, 16)
    expect(f.mode).toBe("takeoff")
    expect(h.speed).toBeGreaterThanOrEqual(speed - 0.1)
    expect(f.landing.run).toBe(false)
    for (const id of ["explorer", "companion"] as const) {
      expect(riderRT[id].phase).toBe("riding")
      expect(riderRT[id].horse).toBe(h)
      expect(riderRT[id].wantOff).toBe(false)
    }
  })

  it("separates R cancellation, S braking, and E's deliberate dismount path", () => {
    const h = mounted(), f = h.flight!
    expect(toggleLandGallop("explorer")).toBe("approach")
    expect(toggleLandGallop("explorer")).toBe("fly")
    expect(riderRT.explorer.wantOff).toBe(false)
    expect(f.landing.requested).toBe(false)
    f.mode = "ground"; f.landing.run = true; f.landing.goAround = false
    h.y = groundHeight(h.x, h.z)
    input.move.y = 1
    stepRiding(1 / 60, 0)
    expect(f.landing.run).toBe(false)
    expect(h.targetSpeed).toBe(0)
    expect(riderRT.explorer.phase).toBe("riding")
    input.move.y = 0
    f.landing.run = true
    expect(requestDismount("explorer")).toBe("slowing")
    expect(f.landing.run).toBe(false)
    expect(riderRT.explorer.wantOff).toBe(true)
  })

  it("lets climb cancel E's pending landing without an automatic later dismount", () => {
    const h = mounted(true), f = h.flight!
    expect(requestDismount("explorer")).toBe("landing")
    f.mode = "landing"
    input.ascend = true
    stepRiding(1 / 60, 0)
    expect(f.mode).toBe("air")
    expect(f.intent.land).toBe(false)
    expect(riderRT.explorer.wantOff).toBe(false)
    expect(riderRT.companion.wantOff).toBe(false)
  })

  it("honors Slow to stop even when forward reins are still held", () => {
    const h = mounted(), f = h.flight!
    f.mode = "ground"; f.landing.run = true
    h.y = groundHeight(h.x, h.z)
    input.move.y = -1
    expect(toggleLandGallop("explorer")).toBe("slow")
    for (let n = 0; n < 180; n++) stepRiding(1 / 60, n / 60)
    expect(h.targetSpeed).toBe(0)
    expect(Math.abs(h.speed)).toBeLessThan(0.3)
    expect(riderRT.explorer.phase).toBe("riding")
    input.move.y = 0
    stepRiding(1 / 60, 3.1)
    input.move.y = -1
    stepRiding(1 / 60, 3.2)
    expect(h.targetSpeed).toBeGreaterThan(0)
  })

  it("seats both riders on the same completed gallop step with the rear rider controlling", () => {
    const h = mounted(true), f = h.flight!
    f.mode = "ground"; f.pitch = f.roll = 0
    h.heading = 0; h.y = groundHeight(h.x, h.z)
    f.landing.run = true
    characterRT.active = "companion"
    const z = h.z
    stepRiding(0.1, 0)
    expect(h.z - z).toBeGreaterThan(0.5)
    // This fixture has no loaded animator: the authored fallback tack is a
    // seat0.1m ahead of root. A stale front seat trails by >1m at this dt.
    expect(riderRT.explorer.rootZ).toBeCloseTo(h.z + 0.1, 6)
    expect(riderRT.companion.rootZ).toBeCloseTo(h.z + 0.1, 6)
    expect(riderRT.companion.handL.z).toBeGreaterThan(riderRT.explorer.rootZ)
  })
})
