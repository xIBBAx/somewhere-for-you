import { describe, expect, it } from "vitest"
import { applyWeatherPreset, weatherPresentation } from "../src/game/weather/weatherMapping"
import { isSkyChoice, makeClockFallbackWeather, nextSkyChoice, SKY_CHOICES, SKY_LABEL, SKY_PRESET } from "../src/game/weather/weatherTypes"

const base = makeClockFallbackWeather(new Date(2026, 6, 15, 12))

describe("the sky she chooses", () => {
  it("cycles through every choice and back to her real sky", () => {
    let choice = SKY_CHOICES[0]
    const seen = [choice]
    for (let i = 1; i < SKY_CHOICES.length; i++) seen.push((choice = nextSkyChoice(choice)))
    expect(seen).toEqual([...SKY_CHOICES])
    expect(nextSkyChoice(choice)).toBe("live")
    for (const c of SKY_CHOICES) expect(SKY_LABEL[c].length).toBeGreaterThan(0)
  })

  it("follows the real weather only on the live choice", () => {
    expect(SKY_PRESET.live).toBeNull()
    for (const c of SKY_CHOICES.filter((c) => c !== "live")) expect(SKY_PRESET[c]).not.toBeNull()
  })

  it("rains through sunshine in a sun shower, never as a storm", () => {
    const p = weatherPresentation(applyWeatherPreset(base, "showers"))
    expect(p.rain).toBeGreaterThan(0.3)
    expect(p.cloud).toBeLessThanOrEqual(0.6)
    expect(p.burst).toBe(0)
  })

  it("an ordinary rain preset is not a sun shower", () => {
    const shower = applyWeatherPreset(base, "showers")
    const rain = applyWeatherPreset(shower, "rain")
    expect(rain.sunShower).toBe(false)
    expect(weatherPresentation(rain).cloud).toBeGreaterThan(0.8)
  })

  it("snows on the snow choice", () => {
    const p = weatherPresentation(applyWeatherPreset(base, "snow"))
    expect(p.snow).toBeGreaterThan(0.5)
    expect(p.rain).toBe(0)
  })

  it("accepts only known choices from a save", () => {
    expect(isSkyChoice("snow")).toBe(true)
    expect(isSkyChoice("hail")).toBe(false)
    expect(isSkyChoice(3)).toBe(false)
  })
})
