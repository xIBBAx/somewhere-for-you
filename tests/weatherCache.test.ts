import { afterEach, describe, expect, it, vi } from "vitest"
import { readWeatherCache, sessionWeatherStorage, writeWeatherCache } from "../src/game/weather/weatherService"
import { makeClockFallbackWeather } from "../src/game/weather/weatherTypes"

const now = Date.now()
const weather = makeClockFallbackWeather(new Date(now))
const storage = (data: unknown): Storage => ({ getItem: () => JSON.stringify(data) }) as unknown as Storage
afterEach(() => vi.unstubAllGlobals())

describe("optional weather cache", () => {
  it("recovers valid recent weather", () => {
    expect(readWeatherCache(storage({ version: 1, savedAt: now, weather }), now)).toEqual(weather)
  })

  it.each([
    null,
    { version: 1, savedAt: now, weather: { condition: "rain" } },
    { version: 1, savedAt: now, weather: { ...weather, windSpeed: "fast" } },
    { version: 1, savedAt: now, weather: { ...weather, cloudCover: 200 } },
    { version: 1, savedAt: now + 1000, weather },
    { version: 1, savedAt: now - 86_400_000, weather },
  ])("rejects invalid cache data: %j", data => {
    expect(readWeatherCache(storage(data), now)).toBeNull()
  })

  it("handles a storage getter that throws before a cache helper is called", () => {
    vi.stubGlobal("window", Object.defineProperty({}, "sessionStorage", { get: () => { throw new Error("denied") } }))
    expect(sessionWeatherStorage()).toBeNull()
    expect(readWeatherCache(null)).toBeNull()
    expect(() => writeWeatherCache(null, weather)).not.toThrow()
  })
})
