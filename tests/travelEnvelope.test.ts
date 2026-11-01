import { describe, expect, it } from "vitest"
import {
  corridorFovBoost, dustAlpha, dustStreak, dustVisibility, warpBloom, warpPhaseRate, warpSpeed, warpStretch, wispVisibility, windVisibility,
} from "../src/game/celestial/travelEnvelope"

describe("travel envelopes", () => {
  it("runs the streams flat out in the corridor and draws them in at the gather", () => {
    expect(warpSpeed("corridor", 0.5)).toBe(1)
    expect(warpSpeed("idle", 0.5)).toBe(0)
    expect(warpSpeed("gather", 1)).toBeGreaterThan(warpSpeed("gather", 0))
  })

  it("slows the light out of the corridor and lets it fall away", () => {
    expect(warpSpeed("emerge", 0)).toBe(1)
    expect(warpSpeed("emerge", 1)).toBe(0)
    expect(warpSpeed("emerge", 0.5)).toBeGreaterThan(warpSpeed("emerge", 0.9))
  })

  it("makes streaks longer with strength and speed, and none when shut", () => {
    expect(warpStretch(0, 1)).toBe(0)
    expect(warpStretch(1, 1)).toBeGreaterThan(warpStretch(0.5, 1))
    expect(warpStretch(1, 1)).toBeGreaterThan(warpStretch(1, 0.2))
  })

  it("keeps the bloom comfortable, and calmer under reduced motion", () => {
    for (const f of [0, 0.5, 1, 3]) expect(warpBloom(f, false)).toBeLessThanOrEqual(0.35)
    expect(warpBloom(1, true)).toBeLessThan(warpBloom(1, false))
    expect(warpBloom(0, false)).toBe(0)
  })

  it("slows the phase rate under reduced motion", () => {
    expect(warpPhaseRate(1, true)).toBeLessThan(warpPhaseRate(1, false))
    expect(warpPhaseRate(0, false)).toBe(0)
  })

  it("suggests a modest field-of-view boost", () => {
    expect(corridorFovBoost(0)).toBe(0)
    expect(corridorFovBoost(1)).toBeLessThanOrEqual(6)
  })

  it("shows the cloud wisps only near the ground, the wind with the pull", () => {
    expect(wispVisibility(30000)).toBe(0)
    expect(wispVisibility(5000)).toBe(1)
    expect(windVisibility(0)).toBe(0)
    expect(windVisibility(1.5)).toBe(1)
  })

  it("keeps the dust hidden in home's sky and a point when still", () => {
    expect(dustVisibility(0)).toBe(0)
    expect(dustVisibility(1)).toBe(1)
    expect(dustStreak(0)).toBe(0)
    expect(dustStreak(1000)).toBe(4)
    expect(dustAlpha(0, 0)).toBe(0)
    expect(dustAlpha(60, 1)).toBeGreaterThan(dustAlpha(0, 1))
  })
})
