import { create } from "zustand"

export type QualityLevel = "low" | "medium" | "high"
export type QualityMode = "auto" | QualityLevel
export const QUALITY = {
  low: { shadow: 512, shadowRange: 18, grass: 0.55, grassRange: 30, animals: 18, cats: 8, animalRange: 95, particles: 0.55 },
  medium: { shadow: 1024, shadowRange: 22, grass: 0.78, grassRange: 34, animals: 24, cats: 11, animalRange: 110, particles: 0.8 },
  high: { shadow: 2048, shadowRange: 24, grass: 1, grassRange: 36, animals: 28, cats: 14, animalRange: 120, particles: 1 },
} as const

const KEY = "gift-world/quality"
const initial = (): QualityMode => {
  try {
    const mode = localStorage.getItem(KEY)
    if (mode === "auto" || mode === "low" || mode === "medium" || mode === "high") return mode
  } catch { /* Session settings still work without storage. */ }
  return "high"
}
/** Every preset renders the 3D view at renderDpr (at most one pixel per CSS pixel); adaptation changes detail. */
/**
 * The 3D view renders at most one pixel per CSS pixel. On a scaled laptop
 * screen (1.35–1.5) native density nearly doubled the pixels the GPU shades
 * (4× MSAA, AO and bloom on every one) and held the game near 25 FPS; at 1
 * the frame rate rises by about half again while the page, its text and the
 * HUD stay at full sharpness (they are not drawn by WebGL).
 */
export const RENDER_DPR_MAX = 1
export const renderDpr = (pixelRatio: number): number => Number.isFinite(pixelRatio) && pixelRatio > 0 ? Math.min(pixelRatio, RENDER_DPR_MAX) : 1
const defaultLevel = (): QualityLevel => typeof navigator !== "undefined" && navigator.hardwareConcurrency <= 4 ? "medium" : "high"
const mode = initial()

type QualityState = { mode: QualityMode; level: QualityLevel; setMode: (mode: QualityMode) => void; adapt: (level: QualityLevel) => void }
export const useQuality = create<QualityState>((set, get) => ({
  mode,
  level: mode === "auto" ? defaultLevel() : mode,
  setMode: (mode) => {
    set({ mode, level: mode === "auto" ? defaultLevel() : mode })
    try { localStorage.setItem(KEY, mode) } catch { /* Optional persistence. */ }
  },
  adapt: (level) => { if (get().mode === "auto") set({ level }) },
}))

/** Render loops read this shared profile without React state updates. */
export const qualityRT: { level: QualityLevel; profile: (typeof QUALITY)[QualityLevel] } = {
  level: useQuality.getState().level, profile: QUALITY[useQuality.getState().level],
}
useQuality.subscribe((s) => { qualityRT.level = s.level; qualityRT.profile = QUALITY[s.level] })
