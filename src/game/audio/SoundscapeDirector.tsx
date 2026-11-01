import { useFrame } from "@react-three/fiber"
import { useRef } from "react"
import { useGame } from "../../state/gameStore"
import { nearbyWorldColliders } from "../../world/colliders"
import { waterDepthAt } from "../../world/waterSurface"
import { RIVER_MAX_X, RIVER_MIN_X, riverCenterZ } from "../../world/hubLayout"
import { nightBlend, dawnWeight } from "../environment/celestialLighting"
import { weatherRT } from "../weather/weatherState"
import { avatarRT, cameraRT, catRT, characterRT, worldRT } from "../runtime"
import { buildColliders } from "../world-layout"
import { audioLive } from "./audio"
import { setLofi } from "./lofi"
import { loadSprite, setLoop, updateLoops } from "./soundscape"
import { togetherRT } from "../together/togetherState"
import { assets } from "../../content/assets"
import { spaceRT } from "../celestial/spaceState"

const hubTrees = buildColliders().circles.filter((c) => (c.height ?? 0) >= 2.5)
const WATERFALL = { x: 0, z: -37.2 }
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Mixes the living soundscape from what is around you: birdsong by day
 * (meadow or woodland by tree cover), crickets and frogs by night, leaves in
 * the wind, rain, lakes panned toward the shore, the home stream and
 * waterfall and the cat purring.
 * Updated 8× a second; every level glides.
 */
export const SoundscapeDirector = (): null => {
  const timer = useRef(0)
  const water = useRef({ d: 99, angle: 0, timer: 0 })
  useFrame((_, rawDt) => {
    timer.current -= rawDt
    if (timer.current > 0) return
    timer.current = 0.125
    if (!audioLive() || !useGame.getState().started || worldRT.introActive) {
      setLofi(false)
      return
    }
    loadSprite()
    const body = avatarRT()
    const p = body.pos
    const n = nightBlend(worldRT.timeOfDay)
    const rain = weatherRT.rain
    const wind = Math.min(1.5, weatherRT.wind + weatherRT.gust * 0.6)

    // tree cover around you (streamed wilds and the home trees)
    let trees = 0
    for (const c of nearbyWorldColliders) if ((c.height ?? 0) >= 2.5 && Math.abs(c.x - p.x) < 18 && Math.abs(c.z - p.z) < 18) trees++
    for (const c of hubTrees) if (Math.abs(c.x - p.x) < 18 && Math.abs(c.z - p.z) < 18) trees++
    const woods = Math.max(smooth(2, 14, trees), cameraRT.canopy)

    // nearest open water: a slow radial probe, re-run every second
    const w = water.current
    w.timer -= 0.125
    if (w.timer <= 0) {
      w.timer = 1
      w.d = 99
      for (let r = 1.5; r <= 30 && w.d === 99; r += 2.5) {
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2
          if (waterDepthAt(p.x + Math.sin(a) * r, p.z + Math.cos(a) * r) > 0.05) { w.d = r; w.angle = a; break }
        }
      }
    }
    const near = (d: number, far: number, close: number): number => smooth(far, close, d)
    // pan sources relative to the camera's view direction
    const panTo = (angle: number): number => Math.sin(angle - (cameraRT.viewYaw + Math.PI)) * 0.7

    const nature = 1
    const dry = 1 - smooth(0.1, 0.7, rain)
    const day = 1 - n
    // sound needs air: beyond the sky and on the Moon the world falls silent
    // (only the music, which is not a sound of the place, plays on)
    const air = spaceRT.realm !== "earth" ? 0 : 1 - smooth(0.25, 0.85, spaceRT.thin)

    setLoop("amb_meadow", (day * dry * nature * (1 - woods) * 0.42) * air)
    setLoop("amb_day", (day * (0.4 + dry * 0.6) * nature * woods * 0.5) * air)
    // the dawn chorus: birds sing hardest in the half-light before sunrise
    const chorus = dawnWeight(worldRT.timeOfDay) * dry * nature
    setLoop("amb_birds", (day * dry * nature * 0.2 * (0.6 + 0.4 * Math.sin(worldRT.timeOfDay * 40 + 1)) + chorus * 0.34) * air)
    setLoop("amb_night", (n * (1 - rain * 0.8) * nature * 0.42) * air)
    setLoop("amb_night2", (n * (1 - rain * 0.8) * nature * woods * 0.25) * air)
    const lake = near(w.d, 26, 4)
    setLoop("amb_lake", (lake * 0.55) * air, panTo(w.angle))
    setLoop("amb_frogs", (n * lake * nature * 0.4) * air, panTo(w.angle))
    setLoop("amb_leaves", smooth(0.15, 1, wind) * (0.25 + woods * 0.75) * 0.5 * air)
    setLoop("amb_wind", smooth(0.75, 1.35, wind) * 0.45 * air)
    setLoop("amb_rain_light", smooth(0.05, 0.45, rain) * (1 - smooth(0.55, 0.9, rain)) * 0.6 * air)
    // a cloudburst roars: the heavy loop pushed past its usual level
    setLoop("amb_rain_heavy", smooth(0.5, 0.9, rain) * (0.6 + weatherRT.burst * 0.3) * air)
    // the stream beneath the home bridge and the canyon waterfall
    const rx = Math.max(RIVER_MIN_X, Math.min(RIVER_MAX_X, p.x))
    const river = Math.hypot(p.x - rx, p.z - riverCenterZ(rx))
    setLoop("amb_stream", near(river, 22, 2) * 0.45 * air, panTo(Math.atan2(rx - p.x, riverCenterZ(rx) - p.z)))
    const fall = Math.hypot(p.x - WATERFALL.x, p.z - WATERFALL.z)
    setLoop("amb_waterfall", near(fall, 34, 5) * 0.55 * air, panTo(Math.atan2(WATERFALL.x - p.x, WATERFALL.z - p.z)))
    const catNear = characterRT.active === "explorer" ? smooth(6, 1, catRT.pos.distanceTo(p)) : smooth(6, 1, catRT.pos.distanceTo(p)) * 0.6
    setLoop("cat_purr", catRT.purr * catNear * 0.75 * air)
    updateLoops()

    // soft lofi music underneath everything, out of the way of the waltz
    // (a user-supplied soundtrack, if present, replaces it)
    const busy = togetherRT.action === "dance" || !!assets.audio.ambient
    setLofi(!busy, n > 0.6 || air < 0.5 ? "night" : rain > 0.4 ? "rain" : "day")
  })
  return null
}
