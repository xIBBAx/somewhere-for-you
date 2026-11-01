import { gift } from "../personalization"

/** World-level settings. Home and live weather come from the personalization (`world`). */
export const WORLD_CONFIG = {
  weather: {
    /**
     * Where the sky's stars are drawn from and, with live weather on, the
     * place whose weather is fetched when the browser's location is not shared.
     */
    get fallbackLocation(): { label: string; latitude: number; longitude: number } {
      const h = gift().world.home
      return { label: h.label || "Home", latitude: h.latitude, longitude: h.longitude }
    },
    /** Live weather is off unless the gift turns it on (it calls api.open-meteo.com). */
    get live(): boolean {
      return gift().world.liveWeather
    },
    refreshMs: 15 * 60 * 1000,
    geolocationTimeoutMs: 6_000,
    geolocationMaximumAgeMs: 10 * 60 * 1000,
  },
}
