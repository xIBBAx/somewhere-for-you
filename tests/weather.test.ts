import { describe, expect, it } from "vitest"
import {
  applyWeatherPreset,
  isRainCondition,
  isThunderstormCondition,
  mapWmoWeatherCode,
  normalizeOpenMeteoWeather,
  weatherPresentation,
} from "../src/game/weather/weatherMapping"
import { makeClockFallbackWeather, type WorldWeather } from "../src/game/weather/weatherTypes"

const weather = (overrides: Partial<WorldWeather> = {}): WorldWeather => ({
  condition: "clear",
  temperatureC: 25,
  apparentTemperatureC: 25,
  precipitation: 0,
  rain: 0,
  snowfall: 0,
  cloudCover: 8,
  windSpeed: 5,
  windDirection: 210,
  isDay: true,
  observedAt: 1_780_000_000_000,
  locationLabel: "Test",
  source: "live",
  ...overrides,
})

describe("location weather mapping", () => {
  it.each([
    [0, 0, 4, "clear"],
    [1, 0, 25, "partly-cloudy"],
    [3, 0, 92, "cloudy"],
    [45, 0, 80, "fog"],
    [51, 0.1, 80, "drizzle"],
    [61, 0.5, 90, "rain"],
    [65, 2.1, 100, "heavy-rain"],
    [95, 1.1, 100, "thunderstorm"],
    [71, 0.4, 95, "snow"],
  ])("maps WMO %i to %s", (code, precipitation, cloudCover, expected) => {
    expect(mapWmoWeatherCode(code, precipitation, cloudCover)).toBe(expected)
  })

  it("uses precipitation as rain evidence without ever inferring thunder", () => {
    expect(mapWmoWeatherCode(0, 0.4, 10)).toBe("rain")
    expect(mapWmoWeatherCode(0, 2.5, 10)).toBe("heavy-rain")
    expect(isThunderstormCondition(mapWmoWeatherCode(0, 8, 100))).toBe(false)
  })

  it("normalizes provider units and preserves the provider day flag", () => {
    const normalized = normalizeOpenMeteoWeather(
      {
        timezone: "Europe/Zurich",
        current: {
          time: 1_780_000_000,
          temperature_2m: 28,
          apparent_temperature: 31,
          precipitation: 0,
          rain: 0,
          snowfall: 0,
          weather_code: 2,
          cloud_cover: 48,
          wind_speed_10m: 17,
          wind_direction_10m: -30,
          is_day: 0,
        },
        daily: { sunrise: [1_779_980_000], sunset: [1_780_025_000] },
      },
      "live",
      "Your area",
    )

    expect(normalized.condition).toBe("partly-cloudy")
    expect(normalized.isDay).toBe(false)
    expect(normalized.windDirection).toBe(330)
    expect(normalized.sunrise).toBe(1_779_980_000_000)
    expect(normalized.source).toBe("live")
  })
})

describe("coordinated weather presentation", () => {
  it("shows rain only for precipitation-compatible conditions", () => {
    expect(weatherPresentation(weather({ condition: "clear", rain: 4, precipitation: 4 })).rain).toBe(0)
    expect(weatherPresentation(weather({ condition: "cloudy", rain: 2, precipitation: 2 })).rain).toBe(0)
    expect(weatherPresentation(weather({ condition: "drizzle", rain: 0.1 })).rain).toBeGreaterThan(0)
    expect(weatherPresentation(weather({ condition: "rain", rain: 0.8 })).rain).toBeGreaterThan(0.5)
    expect(weatherPresentation(weather({ condition: "heavy-rain", rain: 3 })).rain).toBeGreaterThan(0.9)
  })

  it("permits thunder effects for thunderstorm and no other weather state", () => {
    const conditions: WorldWeather["condition"][] = [
      "clear",
      "partly-cloudy",
      "cloudy",
      "fog",
      "drizzle",
      "rain",
      "heavy-rain",
      "snow",
    ]
    conditions.forEach((condition) => expect(isThunderstormCondition(condition)).toBe(false))
    expect(isThunderstormCondition("thunderstorm")).toBe(true)
    expect(isRainCondition("thunderstorm")).toBe(true)
  })

  it("uses a neutral, rainless fallback when live and fallback requests fail", () => {
    const fallback = makeClockFallbackWeather(new Date("2026-08-30T12:00:00Z"))
    expect(fallback.condition).toBe("clear")
    expect(fallback.rain).toBe(0)
    expect(fallback.precipitation).toBe(0)
    expect(weatherPresentation(fallback).rain).toBe(0)
    expect(isThunderstormCondition(fallback.condition)).toBe(false)
  })

  it("offers deterministic rain and thunderstorm states only through debug presets", () => {
    const rain = applyWeatherPreset(weather(), "rain")
    const storm = applyWeatherPreset(weather(), "thunderstorm")
    expect(rain.condition).toBe("rain")
    expect(isThunderstormCondition(rain.condition)).toBe(false)
    expect(storm.condition).toBe("thunderstorm")
    expect(weatherPresentation(storm).rain).toBe(1)
  })
})
