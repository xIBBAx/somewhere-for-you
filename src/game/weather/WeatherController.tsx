import { useEffect } from "react"
import { WORLD_CONFIG } from "../../content/worldConfig"
import { useGame } from "../../state/gameStore"
import { worldRT } from "../runtime"
import { explorationTimeTarget, isMorning } from "../timeOfDay"
import { loadLocalWeather, readWeatherCache, sessionWeatherStorage, writeWeatherCache } from "./weatherService"
import { setWeatherData, setWeatherOverride, weatherRT, weatherTimeContext } from "./weatherState"
import { makeClockFallbackWeather, SKY_PRESET, type WorldWeather } from "./weatherTypes"

export const syncWorldTimeToClimate = (nowMs = Date.now()): void => {
  if (worldRT.finaleActive) return
  const mode = useGame.getState().timeMode
  const context = weatherTimeContext(nowMs)
  worldRT.timeOfDayTarget = explorationTimeTarget(mode, context)
  worldRT.morningTarget = isMorning(mode, context) ? 1 : 0
}

/** Fetch/cache lifecycle stays outside the renderer; only normalized state crosses in. */
export const WeatherController = (): null => {
  const timeMode = useGame((state) => state.timeMode)
  const sky = useGame((state) => state.sky)

  // the chosen sky; "live" hands the weather back to the real sky (or the world's own, without live weather)
  useEffect(() => {
    setWeatherOverride(SKY_PRESET[sky])
  }, [sky])

  useEffect(() => {
    // Live weather is opt-in (personalization `world.liveWeather`): without it
    // nothing asks for the browser's location and nothing is fetched; the
    // world keeps its own clock-driven sky.
    if (!WORLD_CONFIG.weather.live) {
      setWeatherData(makeClockFallbackWeather())
      syncWorldTimeToClimate()
      return
    }
    const abort = new AbortController()
    const storage = sessionWeatherStorage()
    let stopped = false

    const accept = (weather: WorldWeather): void => {
      if (stopped) return
      setWeatherData(weather)
      writeWeatherCache(storage, weather)
      syncWorldTimeToClimate()
    }

    const refresh = async (): Promise<void> => {
      weatherRT.status = weatherRT.lastUpdated > 0 ? weatherRT.status : "loading"
      try {
        accept(await loadLocalWeather({ signal: abort.signal }))
      } catch (error) {
        if (abort.signal.aborted || stopped) return
        setWeatherData(makeClockFallbackWeather())
        weatherRT.error = error instanceof Error ? error.message : "Weather unavailable"
        syncWorldTimeToClimate()
      }
    }

    const refreshTimer = window.setInterval(() => void refresh(), WORLD_CONFIG.weather.refreshMs)

    const cached = readWeatherCache(storage)
    if (cached) {
      setWeatherData(cached)
      syncWorldTimeToClimate()
    } else {
      void refresh()
    }

    const onVisibility = (): void => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - weatherRT.lastUpdated >= WORLD_CONFIG.weather.refreshMs
      ) {
        void refresh()
      }
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      stopped = true
      abort.abort()
      if (refreshTimer !== undefined) window.clearInterval(refreshTimer)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])

  useEffect(() => {
    syncWorldTimeToClimate()
    const timer = window.setInterval(() => syncWorldTimeToClimate(), 60_000)
    return () => window.clearInterval(timer)
  }, [timeMode])

  return null
}
