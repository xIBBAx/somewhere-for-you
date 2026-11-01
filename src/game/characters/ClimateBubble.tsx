import { useEffect, useRef, useState } from "react"
import { CLIMATE_LINES } from "../../content/climate"
import { characterRT, playerRT, worldRT } from "../runtime"
import { spaceRT } from "../celestial/spaceState"
import { weatherRT } from "../weather/weatherState"
import { togetherRT } from "../together/togetherState"
import { useAdventures } from "../../state/adventureStore"
import { usePhoto } from "../activities/photo"

const COOLDOWN_HOT = 38
const COOLDOWN_RAIN = 45
const COOLDOWN_WIND = 52
const COOLDOWN_SNOW = 48
const COOLDOWN_FOG = 50
const COOLDOWN_CLOUDY = 42
const DURATION = 4.2

/**
 * Infrequent, subtle character reaction to real weather.
 * Appears as a small speech/thought bubble above the explorer; long cooldowns
 * and idle gating prevent spam. All lines editable in content/climate.ts.
 */
export const ClimateBubble = (): React.ReactElement | null => {
  const [text, setText] = useState<string | null>(null)
  const cooldown = useRef(12)
  const visibleTimer = useRef(0)

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number): void => {
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      cooldown.current = Math.max(0, cooldown.current - dt)
      // beyond the sky there is no weather to remark on
      if (characterRT.active !== "explorer" || spaceRT.realm !== "earth" || spaceRT.thin > 0.6) {
        if (visibleTimer.current > 0) { visibleTimer.current = 0; setText(null) }
        raf = requestAnimationFrame(tick)
        return
      }
      if (visibleTimer.current > 0) {
        visibleTimer.current -= dt
        if (visibleTimer.current <= 0) setText(null)
      } else if (cooldown.current <= 0 && !playerRT.moving && playerRT.idleTime > 4 && togetherRT.speech.time <= 0 && togetherRT.action === "none") {
        let pool: readonly string[] | null = null
        let cd = COOLDOWN_HOT
        if (weatherRT.snow > 0.3) {
          pool = CLIMATE_LINES.snow
          cd = COOLDOWN_SNOW
        } else if (weatherRT.heat > 0.62) {
          pool = CLIMATE_LINES.hot
          cd = COOLDOWN_HOT
        } else if (weatherRT.rain > 0.5) {
          pool = CLIMATE_LINES.rain
          cd = COOLDOWN_RAIN
        } else if (weatherRT.condition === "fog") {
          pool = CLIMATE_LINES.fog
          cd = COOLDOWN_FOG
        } else if (weatherRT.wind > 0.72) {
          pool = CLIMATE_LINES.windy
          cd = COOLDOWN_WIND
        } else if (weatherRT.condition === "cloudy" && weatherRT.cloud > 0.72) {
          pool = CLIMATE_LINES.cloudy
          cd = COOLDOWN_CLOUDY
        } else if (weatherRT.condition === "clear" && weatherRT.cloud < 0.22) {
          pool = worldRT.timeOfDay >= 0.84 ? CLIMATE_LINES.night : CLIMATE_LINES.clear
          cd = COOLDOWN_CLOUDY
        }
        if (pool && Math.random() < 0.18) {
          const line = pool[Math.floor(Math.random() * pool.length)]
          setText(line)
          visibleTimer.current = DURATION
          cooldown.current = cd + Math.random() * 10
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const bookOpen = useAdventures((s) => s.open)
  const photoOpen = usePhoto((s) => s.open)
  if (!text || bookOpen || photoOpen) return null
  return (
    <div className="climate-bubble"
      style={{
        position: "fixed",
        left: "50%",
        top: "28%",
        transform: "translateX(-50%)",
        background: "rgba(247,239,226,0.96)",
        border: "1px solid #d8cbb8",
        borderRadius: 14,
        padding: "8px 14px",
        fontFamily: "var(--font-display)",
        fontStyle: "italic",
        fontSize: 13,
        color: "#4a352e",
        boxShadow: "0 4px 18px rgba(60,40,30,0.18)",
        pointerEvents: "none",
        zIndex: 40,
        maxWidth: 320,
        textAlign: "center",
      }}
    >
      {text}
    </div>
  )
}
