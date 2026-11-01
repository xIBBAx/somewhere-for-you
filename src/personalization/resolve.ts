import { giftMedia } from "virtual:gift-media"
import { DEFAULT_GIFT, MEMORY_SLOT_IDS } from "./defaults"
import { getMedia, readPersonalText, type MediaRecord } from "./localData"
import { normalizeGift } from "./normalize"
import type { OccasionKind, GiftConfig, PhotoRef } from "./types"

/**
 * The world's personalization, resolved once at start-up (main.tsx awaits
 * initPersonalization() before the game is imported):
 *
 *   built-in demo (defaults.ts)
 *     <- customize/gift.json and customize/media/   (a developer's own build)
 *     <- what the Personalize screen saved in this browser
 *
 * After that every read is synchronous. Saving in the Personalize screen
 * reloads the page so the whole world picks the change up.
 */

/** A photo ready for the memory cards: `w`/`h` are its pixel size, so frames keep its shape before it arrives. */
export type MemoryPhoto = { src: string; thumb: string; w: number; h: number; alt: string; taken?: string }

const buildConfigs = import.meta.glob("/customize/gift.json", { eager: true, import: "default" }) as Record<string, unknown>
const buildConfig = buildConfigs["/customize/gift.json"]

const fromBuild = normalizeGift(buildConfig)
/** Problems found in customize/gift.json (shown in the Personalize screen and the dev console). */
export const buildWarnings: readonly string[] = buildConfig === undefined ? [] : fromBuild.warnings
/** The world as the build defines it, before anything saved in this browser. */
export const buildGift: GiftConfig = fromBuild.gift
/** Whether customize/gift.json exists in this build. */
export const hasBuildGift = buildConfig !== undefined

let current: GiftConfig = buildGift
let localWarnings: string[] = []
const localUrls = new Map<string, { url: string; thumb?: string; record: MediaRecord }>()

/** The resolved personalization (complete and valid). */
export const gift = (): GiftConfig => current
export const personalizationWarnings = (): readonly string[] => [...buildWarnings, ...localWarnings]

const referencedLocal = (g: GiftConfig): string[] => {
  const refs = new Set<string>()
  const add = (src?: string): void => { if (src?.startsWith("local:")) refs.add(src) }
  for (const m of g.memories) m.photos.forEach((p) => add(p.src))
  for (const s of g.secrets) add(s.photo?.src)
  g.ending.photos.forEach((p) => add(p.src))
  add(g.music.src)
  add(g.characters.explorer.model)
  add(g.characters.companion.model)
  return [...refs]
}

/** Read this browser's saved personalization and open its media. Never throws. */
export const initPersonalization = async (): Promise<void> => {
  const saved = readPersonalText()
  if (saved !== undefined) {
    const local = normalizeGift(saved, buildGift)
    current = local.gift
    localWarnings = local.warnings
  }
  if (import.meta.env.DEV && buildWarnings.length) console.warn("[personalize] customize/gift.json:", buildWarnings)
  await Promise.all(referencedLocal(current).map(async (id) => {
    try {
      const record = await getMedia(id)
      if (!record) return
      localUrls.set(id, {
        url: URL.createObjectURL(record.bytes),
        thumb: record.thumb ? URL.createObjectURL(record.thumb) : undefined,
        record,
      })
    } catch { /* missing storage: the reference falls back below */ }
  }))
  applyTheme(current)
}

/** Replace the resolved config (tests, previews). */
export const setGiftForTests = (g: GiftConfig): void => { current = g }

const applyTheme = (g: GiftConfig): void => {
  if (typeof document === "undefined") return
  document.documentElement.style.setProperty("--gift-accent", g.theme.accent)
}

const PLACEHOLDER_SIZE = { w: 1280, h: 800 }

/** Turn a photo reference into something the cards can show, or null if it is unavailable. */
export const resolvePhoto = (ref: PhotoRef | null | undefined): MemoryPhoto | null => {
  if (!ref) return null
  if (ref.src.startsWith("placeholder:")) {
    const name = ref.src.slice(12)
    return { src: `/assets/placeholders/${name}.jpg`, thumb: `/assets/placeholders/thumbs/${name}.jpg`, ...PLACEHOLDER_SIZE, alt: ref.alt, taken: ref.caption }
  }
  if (ref.src.startsWith("media:")) {
    const m = giftMedia[ref.src.slice(6)]
    if (!m || m.kind !== "image" || !m.w || !m.h) return null
    return { src: m.url, thumb: m.url, w: m.w, h: m.h, alt: ref.alt, taken: ref.caption }
  }
  const local = localUrls.get(ref.src)
  if (!local || local.record.kind !== "image") return null
  return { src: local.url, thumb: local.thumb ?? local.url, w: local.record.w ?? 1200, h: local.record.h ?? 900, alt: ref.alt, taken: ref.caption }
}

export const resolvePhotos = (refs: PhotoRef[]): MemoryPhoto[] => refs.map(resolvePhoto).filter((p): p is MemoryPhoto => p !== null)

/** URL of a custom character model, or null to use the preset. */
export const resolveModelUrl = (ref: string): string | null => {
  if (!ref) return null
  if (ref.startsWith("media:")) {
    const m = giftMedia[ref.slice(6)]
    return m?.kind === "model" ? m.url : null
  }
  const local = localUrls.get(ref)
  return local?.record.kind === "model" ? local.url : null
}

/** The music track: undefined for silence; `format` helps Howler with blob URLs. */
export const resolveMusic = (bundled: string | undefined): { src: string; format?: string } | undefined => {
  const src = current.music.src
  if (src === "none") return undefined
  if (src === "default") return bundled ? { src: bundled } : undefined
  if (src.startsWith("media:")) {
    const m = giftMedia[src.slice(6)]
    return m?.kind === "audio" ? { src: m.url, format: src.split(".").pop()?.toLowerCase() } : bundled ? { src: bundled } : undefined
  }
  const local = localUrls.get(src)
  if (local?.record.kind !== "audio") return bundled ? { src: bundled } : undefined
  const format = ({ "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/wav": "wav" } as Record<string, string>)[local.record.type]
  return { src: local.url, format }
}

const nameOr = (a: string, b: string): string => a || b

/**
 * Names the game shows. Read them when a line is shown (they are getters), so
 * the same code serves every personalized world.
 */
export const names = {
  /** the recipient, who plays as the explorer */
  get explorer(): string { return nameOr(current.characters.explorer.name, current.recipient.name) },
  /** the maker, who appears as the companion */
  get companion(): string { return nameOr(current.characters.companion.name, current.creator.name) },
  get recipient(): string { return current.recipient.name },
  get creator(): string { return current.creator.name },
  get starborn(): string { return current.creatures.starborn },
  get explorerPegasus(): string { return current.creatures.explorerPegasus },
  get companionPegasus(): string { return current.creatures.companionPegasus },
  get dragon(): string { return current.creatures.dragon },
  get cat(): string { return current.creatures.cat },
  spaceCat(i: number): string { return current.creatures.spaceCats[i % 5] },
}

/** A character's display name by role. */
export const characterName = (id: "explorer" | "companion"): string => (id === "explorer" ? names.explorer : names.companion)

/** The title card's heading: the configured one, or "A world for <name>". */
export const titleHeading = (): string => current.title.heading || `A world for ${names.recipient}`
export const titleSubtitle = (): string => current.title.subtitle || `Made by ${names.creator}.`
export const endingHeading = (): string => current.ending.heading || `For ${names.recipient}`

/** The line shown when the dated fireworks begin. */
export const fireworksLine = (): string => {
  if (current.ending.fireworksLine) return current.ending.fireworksLine
  const greeting: Partial<Record<OccasionKind, string>> = {
    birthday: "Happy birthday", anniversary: "Happy anniversary", diwali: "Shubh Deepavali", holi: "Happy Holi", eid: "Eid Mubarak",
    christmas: "Merry Christmas", navratri: "Shubh Navratri", onam: "Happy Onam", pongal: "Happy Pongal", baisakhi: "Happy Baisakhi",
    "raksha-bandhan": "Happy Raksha Bandhan", gurpurab: "Happy Gurpurab",
  }
  const words = greeting[current.occasion.kind]
  return words ? `${words}, ${names.recipient}. Look up.` : "Look up."
}

export { DEFAULT_GIFT, MEMORY_SLOT_IDS }
