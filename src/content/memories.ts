import { gift, resolvePhotos, type MemoryPhoto } from "../personalization"

/**
 * The nine memory places around home. Where each one is, and the little
 * scene the world plays there, is fixed here (the set pieces are built around
 * these spots). What each one says and shows comes from the personalization
 * (customize/gift.json or the Personalize screen; docs/CUSTOMIZATION.md).
 */
export type SceneType =
  | "beginning"
  | "cafe"
  | "walk"
  | "studio"
  | "animals"
  | "training"
  | "rain"
  | "future"
  | "finale"

export type MemoryStop = {
  id: string
  order: number
  title: string
  subtitle?: string
  locationName?: string
  dateLabel?: string
  shortText: string
  longText?: string
  worldPosition: [number, number, number]
  /** interaction radius in world units */
  radius: number
  sceneType: SceneType
  showExplorer?: boolean
  showCompanion?: boolean
  catReaction?: "investigate" | "excited" | "sit"
  /** seconds the world performs before the card appears */
  performDelay?: number
  reward?: "star"
  /** photos for this stop; the first is the one that develops on the card */
  photos?: MemoryPhoto[]
}

type Layout = Pick<MemoryStop, "id" | "order" | "worldPosition" | "radius" | "sceneType" | "showExplorer" | "showCompanion" | "catReaction" | "performDelay" | "reward">

const LAYOUT: Layout[] = [
  { id: "first-steps", order: 1, worldPosition: [0.6, 0, 21.5], radius: 2.4, sceneType: "beginning", showExplorer: true, catReaction: "sit", performDelay: 0.9, reward: "star" },
  { id: "cafe-table", order: 2, worldPosition: [-7.6, 0, 13.2], radius: 2.4, sceneType: "cafe", showExplorer: true, showCompanion: true, catReaction: "investigate", performDelay: 1.2, reward: "star" },
  { id: "long-way", order: 3, worldPosition: [6.4, 0, 10.6], radius: 2.4, sceneType: "walk", showExplorer: true, showCompanion: true, catReaction: "investigate", performDelay: 1.2, reward: "star" },
  { id: "little-studio", order: 4, worldPosition: [-12.2, 0, 3.4], radius: 2.6, sceneType: "studio", showExplorer: true, catReaction: "sit", performDelay: 1.6, reward: "star" },
  { id: "cat-garden", order: 5, worldPosition: [12, 0, 0.6], radius: 2.8, sceneType: "animals", showExplorer: true, catReaction: "excited", performDelay: 1.4, reward: "star" },
  { id: "training-corner", order: 6, worldPosition: [-10.6, 0, -7.4], radius: 2.6, sceneType: "training", showExplorer: true, catReaction: "excited", performDelay: 4.2, reward: "star" },
  { id: "corner-cafe", order: 7, worldPosition: [2.6, 0, -10.4], radius: 2.8, sceneType: "cafe", showExplorer: true, catReaction: "excited", performDelay: 2.0, reward: "star" },
  { id: "rain-spot", order: 8, worldPosition: [10.6, 0, -15.4], radius: 2.4, sceneType: "rain", showExplorer: true, showCompanion: true, catReaction: "sit", performDelay: 1.4, reward: "star" },
  { id: "path-ahead", order: 9, worldPosition: [-4.2, 0, -17.6], radius: 2.4, sceneType: "future", showExplorer: true, showCompanion: true, catReaction: "investigate", performDelay: 1.4, reward: "star" },
]

export const MEMORIES: MemoryStop[] = LAYOUT.map((layout, i) => {
  const text = gift().memories[i]
  return {
    ...layout,
    title: text.title,
    subtitle: text.subtitle || undefined,
    locationName: text.place || undefined,
    dateLabel: text.date || undefined,
    shortText: text.text,
    longText: text.more || undefined,
    photos: resolvePhotos(text.photos),
  }
})

/** The finale is choreographed separately; it is listed for progress counting. */
export const FINALE_STOP = {
  id: "finale-garden",
  order: 10,
  title: "The Garden",
  worldPosition: [0, 0, -29.5],
} as const

export const TOTAL_STARS = MEMORIES.length

export const getMemory = (id: string): MemoryStop | undefined =>
  MEMORIES.find((m) => m.id === id)
