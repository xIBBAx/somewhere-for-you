import { describe, expect, it } from "vitest"
import { applyWeatherPreset, weatherPresentation } from "../src/game/weather/weatherMapping"
import { makeClockFallbackWeather } from "../src/game/weather/weatherTypes"
import { stepSurfaceWater } from "../src/game/weather/surfaceWater"
import { rainReach } from "../src/game/weather/weatherState"

const base = { ...makeClockFallbackWeather(new Date(2026, 9, 19, 12)), temperatureC: 36, apparentTemperatureC: 41 }

describe("cloudbursts", () => {
  it("are torrential rain out of a storm, not ordinary heavy rain", () => {
    expect(weatherPresentation(applyWeatherPreset(base, "heavy-rain")).burst).toBe(0)
    expect(weatherPresentation(applyWeatherPreset(base, "thunderstorm")).burst).toBe(0)
    const burst = weatherPresentation(applyWeatherPreset(base, "cloudburst"))
    expect(burst.burst).toBeGreaterThan(0.95)
    expect(burst.rain).toBe(1)
    expect(burst.cloud).toBe(1)
    // a heavy fall of snow or a dry day is never a cloudburst
    expect(weatherPresentation({ ...base, condition: "snow", precipitation: 60, snowfall: 6 }).burst).toBe(0)
    expect(weatherPresentation({ ...base, condition: "cloudy", precipitation: 60 }).burst).toBe(0)
  })

  it("leave no heat shimmer while it rains, however warm the air", () => {
    expect(weatherPresentation(applyWeatherPreset(base, "hot")).heat).toBeGreaterThan(0.9)
    expect(weatherPresentation({ ...applyWeatherPreset(base, "heavy-rain"), apparentTemperatureC: 41 }).heat).toBe(0)
  })

  it("flood the ground several times faster than heavy rain, and both drain once it stops", () => {
    // seconds until the ground is half covered
    const halfFull = (burst: number): number => {
      let w = 0, t = 0
      while (w < 0.5 && t < 600) { w = stepSurfaceWater(w, 1, 1, 0, 0.5, 0.1, burst); t += 0.1 }
      return t
    }
    expect(halfFull(1) * 3).toBeLessThan(halfFull(0))
    let w = 0
    for (let t = 0; t < 60; t += 0.1) w = stepSurfaceWater(w, 1, 1, 0, 0.5, 0.1, 1)
    for (let t = 0; t < 120; t += 0.1) w = stepSurfaceWater(w, 0, 0.5, 0.3, 0.3, 0.1, 0)
    expect(w).toBeLessThan(0.2)
  })
})

describe("where the rain reaches", () => {
  it("falls everywhere under the storm, thins inside the cloud, and is gone above it or off Earth", () => {
    expect(rainReach(0, true)).toBe(1)
    expect(rainReach(100, true)).toBe(1)
    expect(rainReach(160, true)).toBeGreaterThan(0)
    expect(rainReach(160, true)).toBeLessThan(1)
    expect(rainReach(220, true)).toBe(0)
    expect(rainReach(0, false)).toBe(0)
  })
})
