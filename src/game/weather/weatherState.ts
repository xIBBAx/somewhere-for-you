import { applyWeatherPreset } from "./weatherMapping"
import {
  makeClockFallbackWeather,
  type WeatherCondition,
  type WeatherOverride,
  type WeatherStatus,
  type WorldWeather,
} from "./weatherTypes"

export const weatherRT = {
  data: makeClockFallbackWeather(),
  status: "idle" as WeatherStatus,
  error: null as string | null,
  lastUpdated: 0,
  override: null as WeatherOverride | null,

  /** Smooth presentation values updated by WeatherSystem once per frame. */
  condition: "clear" as WeatherCondition,
  rain: 0,
  snow: 0,
  cloud: 0.05,
  wind: 0.05,
  /** Short-lived ambient gust layered over measured wind, including fair weather. */
  gust: 0,
  windDirectionRad: 0,
  heat: 0,
  /** 0..1 a cloudburst (weatherMapping.ts): rushes in, eases off more slowly */
  burst: 0,
  wetness: 0,
  surfaceWater: 0,
  /** 0..1 snow lying on the open ground: settles while it snows, melts slowly after */
  snowCover: 0,
}

/**
 * How much of the rain reaches a watcher at this height over the datum (game
 * m): all of it under the storm, thinning inside the cloud (a thunderhead's
 * rain starts high, ~8–12 km real, 120–200 m here) and none above it or out
 * of Earth's air. Shared by the rain itself and the drops on the lens.
 */
export const rainReach = (earthAltitude: number, onEarth: boolean): number => {
  if (!onEarth) return 0
  const t = Math.min(1, Math.max(0, (earthAltitude - 120) / 80))
  return 1 - t * t * (3 - 2 * t)
}

export const getEffectiveWeather = (): WorldWeather =>
  weatherRT.override ? applyWeatherPreset(weatherRT.data, weatherRT.override) : weatherRT.data

export const setWeatherData = (weather: WorldWeather): void => {
  weatherRT.data = weather
  weatherRT.status =
    weather.source === "live"
      ? "ready"
      : weather.source === "offline"
        ? "offline"
        : "fallback"
  weatherRT.error = null
  weatherRT.lastUpdated = Date.now()
}

export const setWeatherOverride = (override: WeatherOverride | null): void => {
  weatherRT.override = override
}

export const weatherTimeContext = (nowMs = Date.now()): {
  nowMs: number
  sunrise?: number
  sunset?: number
  isDay: boolean
} => {
  const weather = getEffectiveWeather()
  return {
    nowMs,
    sunrise: weather.sunrise,
    sunset: weather.sunset,
    isDay: weather.isDay,
  }
}
