import { smoothstep } from "../../utils/math"
import type { WeatherCondition, WeatherOverride, WorldWeather } from "./weatherTypes"

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const finite = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback

const nullableFinite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null

export const isRainCondition = (condition: WeatherCondition): boolean =>
  condition === "drizzle" ||
  condition === "rain" ||
  condition === "heavy-rain" ||
  condition === "thunderstorm"

export const isThunderstormCondition = (condition: WeatherCondition): boolean =>
  condition === "thunderstorm"

export const mapWmoWeatherCode = (
  code: number,
  precipitation = 0,
  cloudCover = 0,
): WeatherCondition => {
  if ([95, 96, 99].includes(code)) return "thunderstorm"
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow"
  if ([65, 67, 82].includes(code) || precipitation >= 1.5) return "heavy-rain"
  if ([61, 63, 66, 80, 81].includes(code) || precipitation >= 0.25) return "rain"
  if ([51, 53, 55, 56, 57].includes(code) || precipitation > 0) return "drizzle"
  if ([45, 48].includes(code)) return "fog"
  if (code === 3 || cloudCover >= 82) return "cloudy"
  if (code === 1 || code === 2 || cloudCover >= 30) return "partly-cloudy"
  return "clear"
}

export type WeatherPresentation = {
  rain: number
  snow: number
  cloud: number
  wind: number
  heat: number
  /** 0..1 a cloudburst: torrential rain out of a storm's core, far beyond ordinary heavy rain */
  burst: number
}

/** Converts provider units into stable 0–1 controls shared by every renderer. */
export const weatherPresentation = (weather: WorldWeather): WeatherPresentation => {
  let rain = 0
  if (weather.condition === "drizzle") rain = 0.24
  if (weather.condition === "rain") rain = 0.58
  if (weather.condition === "heavy-rain") rain = 0.92
  if (weather.condition === "thunderstorm") rain = 1
  // Provider fields can occasionally lag behind the condition code. Never let
  // a stale numeric rain value turn a clear/cloudy fallback into visible rain.
  rain = isRainCondition(weather.condition)
    ? clamp(Math.max(rain, weather.rain / 2.2), 0, 1)
    : 0

  const snow = weather.condition === "snow" ? clamp(0.4 + weather.snowfall / 2, 0, 1) : 0
  const conditionCloudFloor: Record<WeatherCondition, number> = {
    clear: 0.05,
    "partly-cloudy": 0.38,
    cloudy: 0.75,
    fog: 0.88,
    drizzle: 0.78,
    rain: 0.86,
    "heavy-rain": 0.96,
    thunderstorm: 1,
    snow: 0.9,
  }
  // a sun shower falls from a broken sky: the sun keeps shining through it
  const cloud = weather.sunShower
    ? clamp(weather.cloudCover / 100, 0.25, 0.6)
    : clamp(
      Math.max(conditionCloudFloor[weather.condition], weather.cloudCover / 100),
      0,
      1,
    )
  const feelsLike = weather.apparentTemperatureC ?? weather.temperatureC
  // Torrential rain (tens of mm an hour, as under a storm's core) is a
  // cloudburst; ordinary heavy rain is a few mm an hour.
  const torrent = Math.max(weather.precipitation, weather.rain)
  const burst = weather.condition === "heavy-rain" || weather.condition === "thunderstorm" ? smoothstep(12, 45, torrent) : 0
  // wet, shaded ground under cloud and rain can't shimmer, however warm the air
  const dry = 1 - smoothstep(0.04, 0.35, rain)
  return {
    rain,
    snow,
    cloud,
    wind: clamp(weather.windSpeed / 42, 0.05, 1),
    heat: feelsLike === null ? 0 : smoothstep(30, 38, feelsLike) * dry,
    burst,
  }
}

export type OpenMeteoForecast = {
  timezone?: unknown
  current?: {
    time?: unknown
    temperature_2m?: unknown
    apparent_temperature?: unknown
    precipitation?: unknown
    rain?: unknown
    snowfall?: unknown
    weather_code?: unknown
    cloud_cover?: unknown
    wind_speed_10m?: unknown
    wind_direction_10m?: unknown
    is_day?: unknown
  }
  daily?: {
    sunrise?: unknown
    sunset?: unknown
  }
}

const firstEpochMs = (value: unknown): number | undefined => {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const seconds = finite(value[0], Number.NaN)
  return Number.isFinite(seconds) ? seconds * 1000 : undefined
}

export const normalizeOpenMeteoWeather = (
  payload: OpenMeteoForecast,
  source: "live" | "fallback",
  locationLabel: string,
): WorldWeather => {
  if (!payload.current || typeof payload.current !== "object") {
    throw new Error("Weather response did not include current conditions")
  }
  const current = payload.current
  const temperatureC = nullableFinite(current.temperature_2m)
  const apparentTemperatureC = nullableFinite(current.apparent_temperature)
  const precipitation = Math.max(0, finite(current.precipitation))
  const rain = Math.max(0, finite(current.rain))
  const snowfall = Math.max(0, finite(current.snowfall))
  const cloudCover = clamp(finite(current.cloud_cover), 0, 100)
  const weatherCode = Math.round(finite(current.weather_code))
  const observedSeconds = finite(current.time, Date.now() / 1000)

  return {
    condition: mapWmoWeatherCode(weatherCode, precipitation, cloudCover),
    temperatureC,
    apparentTemperatureC,
    precipitation,
    rain,
    snowfall,
    cloudCover,
    windSpeed: Math.max(0, finite(current.wind_speed_10m)),
    windDirection: ((finite(current.wind_direction_10m) % 360) + 360) % 360,
    isDay: finite(current.is_day, 1) >= 0.5,
    sunrise: firstEpochMs(payload.daily?.sunrise),
    sunset: firstEpochMs(payload.daily?.sunset),
    observedAt: observedSeconds * 1000,
    timezone: typeof payload.timezone === "string" ? payload.timezone : undefined,
    locationLabel,
    source,
  }
}

export const applyWeatherPreset = (
  base: WorldWeather,
  preset: WeatherOverride,
): WorldWeather => {
  const common = { ...base, source: "debug" as const, observedAt: Date.now(), sunShower: false }
  switch (preset) {
    case "hot":
      return {
        ...common,
        condition: "clear",
        temperatureC: 36,
        apparentTemperatureC: 41,
        precipitation: 0,
        rain: 0,
        snowfall: 0,
        cloudCover: 8,
        windSpeed: 7,
      }
    case "cloudy":
      return { ...common, condition: "cloudy", precipitation: 0, rain: 0, snowfall: 0, cloudCover: 92 }
    case "rain":
      return { ...common, condition: "rain", precipitation: 0.8, rain: 0.8, snowfall: 0, cloudCover: 94, windSpeed: 18 }
    case "heavy-rain":
      return { ...common, condition: "heavy-rain", precipitation: 3.5, rain: 3.5, snowfall: 0, cloudCover: 100, windSpeed: 31 }
    case "thunderstorm":
      return { ...common, condition: "thunderstorm", precipitation: 4.2, rain: 4.2, snowfall: 0, cloudCover: 100, windSpeed: 36 }
    case "cloudburst":
      // the core of a monsoon storm: ~60 mm in an hour, a gusting outflow
      return { ...common, condition: "thunderstorm", precipitation: 60, rain: 60, snowfall: 0, cloudCover: 100, windSpeed: 46 }
    case "wind":
      return { ...common, condition: "partly-cloudy", precipitation: 0, rain: 0, snowfall: 0, cloudCover: 42, windSpeed: 48, windDirection: 255 }
    case "fog":
      return { ...common, condition: "fog", precipitation: 0, rain: 0, snowfall: 0, cloudCover: 86, windSpeed: 3 }
    case "drizzle":
      return { ...common, condition: "drizzle", precipitation: 0.3, rain: 0.3, snowfall: 0, cloudCover: 88, windSpeed: 9 }
    case "showers":
      // rain out of a bright, broken sky: the weather rainbows are made of
      return { ...common, condition: "rain", precipitation: 0.9, rain: 0.9, snowfall: 0, cloudCover: 45, windSpeed: 9, sunShower: true }
    case "snow":
      return { ...common, condition: "snow", temperatureC: -1, apparentTemperatureC: -4, precipitation: 1, rain: 0, snowfall: 1.1, cloudCover: 84, windSpeed: 7 }
    case "clear":
    default:
      return { ...common, condition: "clear", precipitation: 0, rain: 0, snowfall: 0, cloudCover: 5, windSpeed: 5 }
  }
}
