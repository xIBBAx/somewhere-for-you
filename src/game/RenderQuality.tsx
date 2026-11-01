import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useRef } from "react"
import { renderDpr, useQuality, type QualityLevel } from "../state/qualityStore"
import { worldStreamRT } from "../world/worldRuntime"
import { worldRT } from "./runtime"

/** Long, settled samples avoid reacting to shader compilation or chunk loads.
 * Recovery takes a full minute, so automatic quality cannot flicker. */
export const RenderQuality = (): null => {
  const level = useQuality((s) => s.level)
  const { setDpr } = useThree()
  const sample = useRef({ elapsed: 0, frames: 0, warmup: 8, headroom: 0 })
  useEffect(() => {
    const updateResolution = (): void => setDpr(renderDpr(window.devicePixelRatio))
    updateResolution()
    window.addEventListener("resize", updateResolution)
    Object.assign(sample.current, { elapsed: 0, frames: 0, warmup: 8, headroom: 0 })
    return () => window.removeEventListener("resize", updateResolution)
  }, [level, setDpr])
  useFrame((_, dt) => {
    const state = useQuality.getState()
    const s = sample.current
    if (state.mode !== "auto" || document.visibilityState !== "visible" || worldRT.introActive || !worldStreamRT.spawnReady || (worldStreamRT.streamer?.stats.pending ?? 0) > 0 || dt > 0.5) {
      s.elapsed = s.frames = 0
      return
    }
    if (s.warmup > 0) { s.warmup -= dt; return }
    s.elapsed += dt
    s.frames++
    if (s.elapsed < 5) return
    const fps = s.frames / s.elapsed
    const levels: QualityLevel[] = ["low", "medium", "high"]
    const index = levels.indexOf(state.level)
    if (fps < 46 && index > 0) state.adapt(levels[index - 1])
    else if (fps > 59) {
      s.headroom += s.elapsed
      if (s.headroom > 60 && index < 2) state.adapt(levels[index + 1])
    } else s.headroom = 0
    s.elapsed = s.frames = 0
  })
  return null
}
