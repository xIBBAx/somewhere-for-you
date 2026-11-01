import { WORLD_CONFIG } from "../../content/worldConfig"
import { normalizeOpenMeteoWeather, type OpenMeteoForecast } from "./weatherMapping"
import type { WorldWeather } from "./weatherTypes"

const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast"
const CACHE_KEY = "gift-world/weather-v1"
const CURRENT_FIELDS = [
  "temperature_2m",
  "apparent_temperature",
  "precipitation",
  "rain",
  "snowfall",
  "weather_code",
  "cloud_cover",
  "wind_speed_10m",
  "wind_direction_10m",
  "is_day",
].join(",")

export type WeatherCoordinates = {
  latitude: number
  longitude: number
}

export type WeatherLocation = WeatherCoordinates & {
  label: string
}

export const buildWeatherUrl = ({ latitude, longitude }: WeatherCoordinates): string => {
  const url = new URL(FORECAST_ENDPOINT)
  // Weather models do not benefit from house-level precision. Two decimals
  // keeps the transient request at approximately neighbourhood granularity.
  url.searchParams.set("latitude", latitude.toFixed(2))
  url.searchParams.set("longitude", longitude.toFixed(2))
  url.searchParams.set("current", CURRENT_FIELDS)
  url.searchParams.set("daily", "sunrise,sunset")
  url.searchParams.set("timezone", "auto")
  url.searchParams.set("timeformat", "unixtime")
  url.searchParams.set("forecast_days", "1")
  return url.toString()
}

export const fetchWeatherAt = async (
  location: WeatherLocation,
  source: "live" | "fallback",
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<WorldWeather> => {
  const response = await fetchFn(buildWeatherUrl(location), {
    headers: { Accept: "application/json" },
    signal,
  })
  if (!response.ok) throw new Error(`Weather request failed (${response.status})`)
  const payload = (await response.json()) as OpenMeteoForecast
  return normalizeOpenMeteoWeather(payload, source, location.label)
}

export const requestBrowserCoordinates = (
  geolocation: Geolocation,
  timeoutMs = WORLD_CONFIG.weather.geolocationTimeoutMs,
  maximumAgeMs = WORLD_CONFIG.weather.geolocationMaximumAgeMs,
): Promise<WeatherCoordinates> =>
  new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      (error) => reject(new Error(error.message || "Location permission unavailable")),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: maximumAgeMs },
    )
  })

export type LoadWeatherOptions = {
  geolocation?: Geolocation | null
  fallbackLocation?: WeatherLocation
  fetchFn?: typeof fetch
  signal?: AbortSignal
}

/** Geolocation is attempted once; a configured coarse fallback keeps failures graceful. */
export const loadLocalWeather = async ({
  geolocation = typeof navigator === "undefined" ? null : navigator.geolocation,
  fallbackLocation = WORLD_CONFIG.weather.fallbackLocation,
  fetchFn = fetch,
  signal,
}: LoadWeatherOptions = {}): Promise<WorldWeather> => {
  if (geolocation) {
    try {
      const coordinates = await requestBrowserCoordinates(geolocation)
      try {
        return await fetchWeatherAt(
          { ...coordinates, label: "Your area" },
          "live",
          fetchFn,
          signal,
        )
      } catch (error) {
        if (signal?.aborted) throw error
        // A provider/network failure at the precise location may be transient;
        // the configured location is a second, non-identifying attempt.
      }
    } catch (error) {
      if (signal?.aborted) throw error
      // Denial, timeout and unsupported geolocation all use the same fallback.
    }
  }

  return fetchWeatherAt(fallbackLocation, "fallback", fetchFn, signal)
}

type CachedWeather = {
  version: 1
  savedAt: number
  weather: WorldWeather
}

export const sessionWeatherStorage = (): Storage | null => {
  try { return window.sessionStorage } catch { return null }
}

const validWeather = (value: unknown): value is WorldWeather => {
  if (!value || typeof value !== "object") return false
  const w = value as Record<string, unknown>
  const finite = (key: string): boolean => typeof w[key] === "number" && Number.isFinite(w[key])
  return ["clear", "partly-cloudy", "cloudy", "fog", "drizzle", "rain", "heavy-rain", "thunderstorm", "snow"].includes(w.condition as string) &&
    ["live", "fallback", "offline", "debug"].includes(w.source as string) &&
    ["precipitation", "rain", "snowfall", "cloudCover", "windSpeed", "windDirection", "observedAt"].every(finite) &&
    ["temperatureC", "apparentTemperatureC"].every(key => w[key] === null || finite(key)) &&
    ["sunrise", "sunset"].every(key => w[key] === undefined || finite(key)) &&
    typeof w.isDay === "boolean" && typeof w.locationLabel === "string" &&
    (w.timezone === undefined || typeof w.timezone === "string") &&
    (w.cloudCover as number) >= 0 && (w.cloudCover as number) <= 100 &&
    ["precipitation", "rain", "snowfall", "windSpeed", "observedAt"].every(key => (w[key] as number) >= 0) &&
    (w.windDirection as number) >= 0 && (w.windDirection as number) < 360
}

export const readWeatherCache = (
  storage: Storage | null,
  now = Date.now(),
  maxAgeMs = WORLD_CONFIG.weather.refreshMs,
): WorldWeather | null => {
  try {
    const raw = storage?.getItem(CACHE_KEY)
    if (!raw || raw.length > 10_000) return null
    const cached = JSON.parse(raw) as CachedWeather
    if (
      cached.version !== 1 ||
      !validWeather(cached.weather) ||
      !Number.isFinite(cached.savedAt) ||
      cached.savedAt > now ||
      now - cached.savedAt > maxAgeMs
    ) {
      return null
    }
    return cached.weather
  } catch {
    return null
  }
}

export const writeWeatherCache = (
  storage: Storage | null,
  weather: WorldWeather,
  now = Date.now(),
): void => {
  try {
    // WorldWeather contains no latitude or longitude by design.
    const cached: CachedWeather = { version: 1, savedAt: now, weather }
    storage?.setItem(CACHE_KEY, JSON.stringify(cached))
  } catch {
    // Storage can be unavailable in privacy modes; live weather still works.
  }
}
