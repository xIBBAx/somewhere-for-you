import { describe, expect, it } from "vitest"
import { stepSurfaceWater } from "../src/game/weather/surfaceWater"

describe("rainwater retention", () => {
  it("wets the soil before accumulating, then drains gradually after rain", () => {
    expect(stepSurfaceWater(0, 1, 0, 0, 0, 1)).toBe(0)
    let level = 0
    for (let i = 0; i < 1800; i++) level = stepSurfaceWater(level, 0.9, 1, 0, 0.2, 1 / 60)
    expect(level).toBeGreaterThan(0.8)
    const afterRain = stepSurfaceWater(level, 0, 1, 0, 0.2, 1)
    expect(afterRain).toBeGreaterThan(level * 0.95)
    expect(afterRain).toBeLessThan(level)
    let hot = level, cool = level
    for (let i = 0; i < 3600; i++) {
      hot = stepSurfaceWater(hot, 0, 0, 1, 1, 1 / 60)
      cool = stepSurfaceWater(cool, 0, 0, 0, 0, 1 / 60)
    }
    expect(hot).toBeLessThan(cool)
    expect(hot).toBeGreaterThanOrEqual(0)
  })

  it("remains stable across ordinary browser frame rates and pause/resume", () => {
    const simulate = (dt: number) => {
      let level = 0
      for (let t = 0; t < 30 - dt / 2; t += dt) level = stepSurfaceWater(level, 1, 1, 0, 0, dt)
      return level
    }
    expect(simulate(1 / 30)).toBeCloseTo(simulate(1 / 144), 8)
    expect(stepSurfaceWater(0.5, 1, 1, 0, 0, 0)).toBe(0.5)
  })
})
