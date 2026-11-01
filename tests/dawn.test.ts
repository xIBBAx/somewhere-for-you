import { describe, expect, it } from "vitest"
import { Vector3 } from "three"
import { canSwitchMorning, dawnWeight, sunDirection } from "../src/game/environment/celestialLighting"
import { isMorning } from "../src/game/timeOfDay"

const at = (h: number): number => new Date(2026, 9, 17, h, 0, 0).getTime()

describe("dawn is not dusk", () => {
  it("knows the morning half of the clock, only in automatic mode", () => {
    const sunrise = at(6), sunset = at(18)
    expect(isMorning("auto", { nowMs: at(7), sunrise, sunset })).toBe(true)
    expect(isMorning("auto", { nowMs: at(3), sunrise, sunset })).toBe(true)
    expect(isMorning("auto", { nowMs: at(16), sunrise, sunset })).toBe(false)
    expect(isMorning("auto", { nowMs: at(22), sunrise, sunset })).toBe(false)
    expect(isMorning("day", { nowMs: at(7), sunrise, sunset })).toBe(false)
    expect(isMorning("auto", { nowMs: at(9) })).toBe(true)
  })

  it("mirrors the sun's bearing but agrees at midday, where the flag may switch", () => {
    const a = sunDirection(0.05, new Vector3(), 0), b = sunDirection(0.05, new Vector3(), 1)
    expect(a.distanceTo(b)).toBeLessThan(1e-9)
    const dusk = sunDirection(0.8, new Vector3(), 0), dawn = sunDirection(0.8, new Vector3(), 1)
    expect(dusk.y).toBeCloseTo(dawn.y, 9)
    expect(Math.hypot(dusk.x - dawn.x, dusk.z - dawn.z)).toBeGreaterThan(0.5)
    expect(canSwitchMorning(0.05)).toBe(true)
    expect(canSwitchMorning(0.5)).toBe(false)
    expect(canSwitchMorning(0.98)).toBe(true)
    expect(dawnWeight(0.78, 1)).toBeGreaterThan(0.9)
    expect(dawnWeight(0.78, 0)).toBe(0)
  })
})
