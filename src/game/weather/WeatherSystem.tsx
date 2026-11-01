import { useEffect, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import { damp } from "../../utils/math"
import { companionRT, playerRT, worldRT } from "../runtime"
import { getEffectiveWeather } from "./weatherState"
import { weatherPresentation } from "./weatherMapping"
import { weatherRT } from "./weatherState"
import { stepSurfaceWater } from "./surfaceWater"

/**
 * Damps raw weather into smooth presentation controls shared by every
 * renderer. Rain, snow and breezes stay gentle throughout exploration.
 */
export const WeatherSystem = (): null => {
  const gustTimer = useRef(18)
  const gustDuration = useRef(0)
  const gustStrength = useRef(0)

  useEffect(() => {
    gustTimer.current = 4 + Math.random() * 6
  }, [])

  useFrame((_, rawDt) => {
    const dt = Math.min(Math.max(rawDt, 1e-4), 0.25)
    const effective = getEffectiveWeather()
    const target = weatherPresentation(effective)
    // Cloud / rain / heat move moderately quickly; wetness lags a bit
    weatherRT.condition = effective.condition
    weatherRT.rain = damp(weatherRT.rain, target.rain, 0.28, dt)
    weatherRT.snow = damp(weatherRT.snow, target.snow, 0.28, dt)
    weatherRT.cloud = damp(weatherRT.cloud, target.cloud, 0.42, dt)
    weatherRT.wind = damp(weatherRT.wind, target.wind, 0.36, dt)
    weatherRT.heat = damp(weatherRT.heat, target.heat, 0.18, dt)
    // a cloudburst arrives as a wall of rain and drains away more slowly
    weatherRT.burst = damp(weatherRT.burst, target.burst, target.burst > weatherRT.burst ? 0.55 : 0.12, dt)

    // A living landscape gets frequent pleasant breezes on calm clear days and
    // nights. These bounded gusts augment (never replace) measured wind.
    if (gustDuration.current > 0) {
      gustDuration.current -= dt
      const envelope = Math.min(1, gustDuration.current * 0.65)
      weatherRT.gust = damp(weatherRT.gust, gustStrength.current * envelope, 2.2, dt)
    } else {
      weatherRT.gust = damp(weatherRT.gust, 0, 1.35, dt)
      gustTimer.current -= dt
      if (gustTimer.current <= 0) {
        gustDuration.current = 4 + Math.random() * 5
        // a storm's cold outflow gusts harder and more often
        gustStrength.current = (0.32 + Math.random() * 0.38) * (1 + weatherRT.burst * 0.9)
        gustTimer.current = (7 + Math.random() * 11) * (1 - weatherRT.burst * 0.6)
      }
    }

    const targetRad = (effective.windDirection * Math.PI) / 180
    // shortest angular distance
    let diff = targetRad - weatherRT.windDirectionRad
    diff = Math.atan2(Math.sin(diff), Math.cos(diff))
    weatherRT.windDirectionRad = weatherRT.windDirectionRad + diff * (1 - Math.exp(-0.6 * dt))

    // Wetness lifecycle: rain accumulates moisture film; fair weather dries gradually
    if (weatherRT.rain > 0.05) {
      const targetWetness = Math.min(1.0, weatherRT.rain * 1.25)
      weatherRT.wetness = damp(weatherRT.wetness, targetWetness, 0.22, dt)
    } else {
      // Moisture decays gradually after rainfall rather than switching off.
      weatherRT.wetness = damp(weatherRT.wetness, 0, 0.045, dt)
    }
    // a first snow settles over a minute or so, and lies a while once it stops
    weatherRT.snowCover = damp(weatherRT.snowCover, weatherRT.snow > 0.05 ? Math.min(1, 0.45 + weatherRT.snow * 0.6) : 0, weatherRT.snow > 0.05 ? 0.06 : 0.012, dt)
    weatherRT.surfaceWater = stepSurfaceWater(weatherRT.surfaceWater, weatherRT.rain, weatherRT.wetness, weatherRT.heat, weatherRT.wind, dt, weatherRT.burst)

    worldRT.lightning = damp(worldRT.lightning, 0, 16, dt)

    // Decay player fear response smoothly
    if (playerRT.frightened > 0 && !worldRT.introActive) {
      playerRT.frightened = Math.max(0, playerRT.frightened - dt * 3.2)
    }
    if (companionRT.frightened > 0 && !worldRT.introActive) {
      companionRT.frightened = Math.max(0, companionRT.frightened - dt * 3.2)
    }
  })
  return null
}
