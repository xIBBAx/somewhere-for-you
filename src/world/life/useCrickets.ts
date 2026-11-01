import { useEffect, useState } from "react"
import { avatarRT, worldRT } from "../../game/runtime"
import { weatherRT } from "../../game/weather/weatherState"
import { B, BIOME_COUNT, biomeWeights } from "../climate"

export type CricketState = {
  active: boolean
  intensity: number
  chirpRate: number
}

const _weightsScratch = new Float32Array(BIOME_COUNT)

/**
 * Calculates environmental cricket activity (dusk/night, warm dry weather, open meadows).
 * Crickets are audio-only in the endless world.
 */
export const calculateCricketState = (
  x: number,
  z: number,
  timeOfDay: number,
  rain: number,
): CricketState => {
  // Silenced by rain
  if (rain > 0.22) {
    return { active: false, intensity: 0, chirpRate: 0 }
  }

  // Active in evening and night: tod 0.60 to 1.0, peak at 0.8
  if (timeOfDay < 0.6) {
    return { active: false, intensity: 0, chirpRate: 0 }
  }

  const todFactor = Math.min(1.0, (timeOfDay - 0.6) / 0.2)

  biomeWeights(x, z, _weightsScratch)
  const meadow = _weightsScratch[B.meadow]
  const flower = _weightsScratch[B.flowerMeadow]
  const glade = _weightsScratch[B.glade]
  const autumn = _weightsScratch[B.autumn]

  const habitat = meadow * 1.0 + flower * 0.9 + glade * 0.8 + autumn * 0.6

  if (habitat < 0.15) {
    return { active: false, intensity: 0, chirpRate: 0 }
  }

  const intensity = Math.min(1.0, habitat * todFactor * (1.0 - rain * 3.0))
  const chirpRate = 0.8 + intensity * 1.6 // chirps per second

  return {
    active: intensity > 0.05,
    intensity,
    chirpRate,
  }
}

/**
 * React hook exposing endless world cricket ambient state.
 */
export const useCrickets = (): CricketState => {
  const [state, setState] = useState<CricketState>({ active: false, intensity: 0, chirpRate: 0 })

  useEffect(() => {
    const interval = setInterval(() => {
      const px = avatarRT().pos.x
      const pz = avatarRT().pos.z
      const tod = worldRT.timeOfDay
      const rain = weatherRT.rain

      const next = calculateCricketState(px, pz, tod, rain)
      setState((prev) => {
        if (
          prev.active !== next.active ||
          Math.abs(prev.intensity - next.intensity) > 0.05 ||
          Math.abs(prev.chirpRate - next.chirpRate) > 0.1
        ) {
          return next
        }
        return prev
      })
    }, 500)

    return () => clearInterval(interval)
  }, [])

  return state
}
