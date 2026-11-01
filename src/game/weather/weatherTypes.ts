export type WeatherCondition =
  | "clear"
  | "partly-cloudy"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "heavy-rain"
  | "thunderstorm"
  | "snow"

export type WeatherSource = "live" | "fallback" | "offline" | "debug"

export type WorldWeather = {
  condition: WeatherCondition
  temperatureC: number | null
  apparentTemperatureC: number | null
  precipitation: number
  rain: number
  snowfall: number
  cloudCover: number
  windSpeed: number
  windDirection: number
  isDay: boolean
  sunrise?: number
  sunset?: number
  observedAt: number
  timezone?: string
  locationLabel: string
  source: WeatherSource
  /** rain falling through sunshine (the Sky choice "Sun showers"): the sun stays out */
  sunShower?: boolean
}

export type WeatherOverride =
  | "clear"
  | "hot"
  | "cloudy"
  | "rain"
  | "heavy-rain"
  | "thunderstorm"
  | "cloudburst"
  | "wind"
  | "fog"
  | "drizzle"
  | "showers"
  | "snow"

export type WeatherStatus = "idle" | "loading" | "ready" | "fallback" | "offline"

export const makeClockFallbackWeather = (now = new Date()): WorldWeather => {
  const hour = now.getHours() + now.getMinutes() / 60
  return {
    condition: "clear",
    temperatureC: null,
    apparentTemperatureC: null,
    precipitation: 0,
    rain: 0,
    snowfall: 0,
    cloudCover: 10,
    windSpeed: 5,
    windDirection: 240,
    isDay: hour >= 6 && hour < 19,
    observedAt: now.getTime(),
    locationLabel: "Local clock",
    source: "offline",
  }
}

/** The sky the explorer chooses in the Explore menu: real local weather, or any climate you likes. */
export type SkyChoice = "live" | "sunny" | "showers" | "rain" | "storm" | "misty" | "snow"

export const SKY_CHOICES: readonly SkyChoice[] = ["live", "sunny", "showers", "rain", "storm", "misty", "snow"]

export const SKY_LABEL: Record<SkyChoice, string> = {
  live: "your real sky",
  sunny: "sunny",
  showers: "sun showers",
  rain: "rain",
  storm: "thunderstorm",
  misty: "misty",
  snow: "snow",
}

export const SKY_PRESET: Record<SkyChoice, WeatherOverride | null> = {
  live: null,
  sunny: "clear",
  showers: "showers",
  rain: "rain",
  storm: "thunderstorm",
  misty: "fog",
  snow: "snow",
}

export const nextSkyChoice = (choice: SkyChoice): SkyChoice =>
  SKY_CHOICES[(SKY_CHOICES.indexOf(choice) + 1) % SKY_CHOICES.length]

export const isSkyChoice = (value: unknown): value is SkyChoice =>
  typeof value === "string" && (SKY_CHOICES as readonly string[]).includes(value)
