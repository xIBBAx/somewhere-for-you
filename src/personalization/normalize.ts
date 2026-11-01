import { DEFAULT_GIFT, MEMORY_SLOT_IDS, PLACEHOLDERS } from "./defaults"
import type { CharacterChoice, GiftConfig, MemoryText, OccasionKind, PhotoRef, RelationshipKind } from "./types"

/**
 * Turns anything (a hand-written gift.json, an imported bundle, the
 * Personalize form) into a complete, valid GiftConfig. Unknown keys are
 * ignored; a wrong type or an over-long value falls back to the default for
 * that field and adds a warning. Never throws. Pure: runs in Node and the browser.
 */

export const LIMITS = {
  name: 40,
  short: 90,
  line: 240,
  paragraph: 900,
  paragraphs: 8,
  lines: 8,
  photosPerMemory: 6,
  endingPhotos: 4,
  chatter: 24,
} as const

type Warn = (path: string, problem: string) => void

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** Plain text: no control characters except newlines, trimmed, length-capped. */
export const cleanText = (v: string, max: number, multiline = false): string => {
  // control characters are exactly what this strips
  // eslint-disable-next-line no-control-regex
  const noControls = v.replace(multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, "")
  const collapsed = multiline ? noControls.replace(/\r\n?/g, "\n") : noControls.replace(/\s+/g, " ")
  return collapsed.trim().slice(0, max)
}

const text = (v: unknown, fallback: string, max: number, path: string, warn: Warn, multiline = false): string => {
  if (v === undefined) return fallback
  if (typeof v !== "string") {
    warn(path, "should be text")
    return fallback
  }
  const out = cleanText(v, max, multiline)
  if (v.trim().length > max) warn(path, `was longer than ${max} characters and was shortened`)
  return out
}

const textList = (v: unknown, fallback: string[], maxItems: number, maxLen: number, path: string, warn: Warn): string[] => {
  if (v === undefined) return [...fallback]
  if (!Array.isArray(v)) {
    warn(path, "should be a list of text")
    return [...fallback]
  }
  if (v.length > maxItems) warn(path, `has more than ${maxItems} entries; the rest were left out`)
  return v.slice(0, maxItems).filter((x): x is string => typeof x === "string").map((x) => cleanText(x, maxLen, true)).filter(Boolean)
}

const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T, path: string, warn: Warn): T => {
  if (v === undefined) return fallback
  if (typeof v === "string" && (options as readonly string[]).includes(v)) return v as T
  warn(path, `should be one of: ${options.join(", ")}`)
  return fallback
}

const num = (v: unknown, fallback: number, min: number, max: number, path: string, warn: Warn, integer = false): number => {
  if (v === undefined) return fallback
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
    warn(path, `should be a ${integer ? "whole " : ""}number from ${min} to ${max}`)
    return fallback
  }
  return v
}

const bool = (v: unknown, fallback: boolean, path: string, warn: Warn): boolean => {
  if (v === undefined) return fallback
  if (typeof v !== "boolean") {
    warn(path, "should be true or false")
    return fallback
  }
  return v
}

/** media:<path> — a relative path inside customize/media, no "..", no absolute or URL forms. */
const MEDIA_PATH = /^media:(?!\/)(?!(?:.*\/)?\.\.?(?:\/|$))[A-Za-z0-9 _.\-/]{1,180}$/
const LOCAL_ID = /^local:[a-z0-9-]{8,64}$/

/** Whether a media reference is well-formed (it may still be missing at runtime). */
export const isMediaRef = (src: string, kinds: ("placeholder" | "media" | "local")[] = ["placeholder", "media", "local"]): boolean =>
  (kinds.includes("placeholder") && src.startsWith("placeholder:") && (PLACEHOLDERS as readonly string[]).includes(src.slice(12))) ||
  (kinds.includes("media") && MEDIA_PATH.test(src)) ||
  (kinds.includes("local") && LOCAL_ID.test(src))

const photo = (v: unknown, path: string, warn: Warn): PhotoRef | null => {
  if (!isObject(v) || typeof v.src !== "string") {
    warn(path, "should be { src, alt }")
    return null
  }
  const src = v.src.trim()
  if (!isMediaRef(src)) {
    warn(`${path}.src`, "should be placeholder:<name>, media:<file in customize/media> or a photo added in the game")
    return null
  }
  return {
    src,
    alt: text(v.alt, "A photo", LIMITS.short, `${path}.alt`, warn),
    caption: text(v.caption, "", LIMITS.short, `${path}.caption`, warn) || undefined,
  }
}

const photoList = (v: unknown, fallback: PhotoRef[], max: number, path: string, warn: Warn): PhotoRef[] => {
  if (v === undefined) return fallback.map((p) => ({ ...p }))
  if (!Array.isArray(v)) {
    warn(path, "should be a list of photos")
    return fallback.map((p) => ({ ...p }))
  }
  if (v.length > max) warn(path, `has more than ${max} photos; the rest were left out`)
  return v.slice(0, max).map((p, i) => photo(p, `${path}[${i}]`, warn)).filter((p): p is PhotoRef => p !== null)
}

const modelRef = (v: unknown, path: string, warn: Warn): string => {
  if (v === undefined || v === "") return ""
  const s = typeof v === "string" ? v.trim() : ""
  if ((MEDIA_PATH.test(s) && /\.glb$/i.test(s)) || LOCAL_ID.test(s)) return s
  warn(path, "should be media:<file>.glb or a model imported in the game")
  return ""
}

const musicRef = (v: unknown, fallback: string, path: string, warn: Warn): string => {
  if (v === undefined) return fallback
  if (v === "default" || v === "none") return v
  if (typeof v === "string" && (MEDIA_PATH.test(v.trim()) && /\.(mp3|ogg|m4a|wav)$/i.test(v.trim()) || LOCAL_ID.test(v.trim()))) return v.trim()
  warn(path, "should be \"default\", \"none\", media:<file>.mp3 or a track added in the game")
  return fallback
}

const memoryText = (v: unknown, base: MemoryText, path: string, warn: Warn): MemoryText => {
  if (v === undefined) return { ...base, photos: base.photos.map((p) => ({ ...p })) }
  if (!isObject(v)) {
    warn(path, "should be an object")
    return { ...base, photos: base.photos.map((p) => ({ ...p })) }
  }
  return {
    title: text(v.title, base.title, LIMITS.short, `${path}.title`, warn) || base.title,
    subtitle: text(v.subtitle, base.subtitle, LIMITS.short, `${path}.subtitle`, warn),
    text: text(v.text, base.text, LIMITS.paragraph, `${path}.text`, warn, true) || base.text,
    more: text(v.more, base.more, LIMITS.paragraph, `${path}.more`, warn, true),
    place: text(v.place, base.place, LIMITS.short, `${path}.place`, warn),
    date: text(v.date, base.date, LIMITS.short, `${path}.date`, warn),
    photos: photoList(v.photos, base.photos, LIMITS.photosPerMemory, `${path}.photos`, warn),
  }
}

const character = (v: unknown, base: CharacterChoice, path: string, warn: Warn): CharacterChoice => {
  const o = isObject(v) ? v : {}
  if (v !== undefined && !isObject(v)) warn(path, "should be an object")
  return {
    name: text(o.name, base.name, LIMITS.name, `${path}.name`, warn),
    preset: text(o.preset, base.preset, LIMITS.name, `${path}.preset`, warn) || base.preset,
    model: modelRef(o.model, `${path}.model`, warn),
  }
}

const RELATIONSHIPS: readonly RelationshipKind[] = ["partner", "friend", "family", "other"]
const OCCASIONS: readonly OccasionKind[] = ["birthday", "anniversary", "celebration", "diwali", "holi", "eid", "christmas", "navratri", "onam", "pongal", "baisakhi", "raksha-bandhan", "gurpurab", "none"]

export const normalizeGift = (input: unknown, base: GiftConfig = DEFAULT_GIFT): { gift: GiftConfig; warnings: string[] } => {
  const warnings: string[] = []
  const warn: Warn = (path, problem) => { if (warnings.length < 100) warnings.push(`${path} ${problem}`) }
  const g = isObject(input) ? input : {}
  if (input !== undefined && input !== null && !isObject(input)) warn("(root)", "should be an object")
  const o = (k: string): Record<string, unknown> => (isObject(g[k]) ? (g[k] as Record<string, unknown>) : {})

  const memories = Array.isArray(g.memories) ? g.memories : []
  if (g.memories !== undefined && !Array.isArray(g.memories)) warn("memories", "should be a list")
  if (memories.length > MEMORY_SLOT_IDS.length) warn("memories", `has more than ${MEMORY_SLOT_IDS.length} entries; the world has ${MEMORY_SLOT_IDS.length} memory places`)
  const secrets = Array.isArray(g.secrets) ? g.secrets : []
  const ending = o("ending"), letter = o("letter"), title = o("title"), occasion = o("occasion"), rel = o("relationship")
  const chars = o("characters"), creatures = o("creatures"), places = o("places"), chatter = o("chatter")
  const theme = o("theme"), music = o("music"), world = o("world")
  const home = isObject(world.home) ? (world.home as Record<string, unknown>) : {}
  const companionIn = isObject(chars.companion) ? (chars.companion as Record<string, unknown>) : {}
  const spaceCatsIn = Array.isArray(creatures.spaceCats) ? creatures.spaceCats : []

  const gift: GiftConfig = {
    version: 1,
    recipient: { name: text(o("recipient").name, base.recipient.name, LIMITS.name, "recipient.name", warn) || base.recipient.name },
    creator: { name: text(o("creator").name, base.creator.name, LIMITS.name, "creator.name", warn) || base.creator.name },
    relationship: {
      kind: oneOf(rel.kind, RELATIONSHIPS, base.relationship.kind, "relationship.kind", warn),
      label: text(rel.label, base.relationship.label, LIMITS.name, "relationship.label", warn),
    },
    occasion: {
      kind: oneOf(occasion.kind, OCCASIONS, base.occasion.kind, "occasion.kind", warn),
      month: num(occasion.month, base.occasion.month, 0, 12, "occasion.month", warn, true),
      day: num(occasion.day, base.occasion.day, 0, 31, "occasion.day", warn, true),
    },
    letter: {
      heading: text(letter.heading, base.letter.heading, LIMITS.short, "letter.heading", warn),
      greeting: text(letter.greeting, base.letter.greeting, LIMITS.short, "letter.greeting", warn),
      paragraphs: textList(letter.paragraphs, base.letter.paragraphs, LIMITS.paragraphs, LIMITS.paragraph, "letter.paragraphs", warn),
      signoff: text(letter.signoff, base.letter.signoff, LIMITS.short, "letter.signoff", warn),
      enter: text(letter.enter, base.letter.enter, LIMITS.name, "letter.enter", warn) || base.letter.enter,
    },
    title: {
      heading: text(title.heading, base.title.heading, LIMITS.short, "title.heading", warn),
      subtitle: text(title.subtitle, base.title.subtitle, LIMITS.short, "title.subtitle", warn),
    },
    memories: MEMORY_SLOT_IDS.map((_, i) => memoryText(memories[i], base.memories[i], `memories[${i}]`, warn)),
    secrets: base.secrets.map((b, i) => {
      const s = isObject(secrets[i]) ? (secrets[i] as Record<string, unknown>) : {}
      return {
        title: text(s.title, b.title, LIMITS.short, `secrets[${i}].title`, warn) || b.title,
        text: text(s.text, b.text, LIMITS.line, `secrets[${i}].text`, warn),
        photo: s.photo === null ? null : s.photo === undefined ? (b.photo && { ...b.photo }) : photo(s.photo, `secrets[${i}].photo`, warn),
      }
    }),
    ending: {
      heading: text(ending.heading, base.ending.heading, LIMITS.short, "ending.heading", warn),
      lines: textList(ending.lines, base.ending.lines, LIMITS.lines, LIMITS.line, "ending.lines", warn),
      closing: text(ending.closing, base.ending.closing, LIMITS.line, "ending.closing", warn),
      photos: photoList(ending.photos, base.ending.photos, LIMITS.endingPhotos, "ending.photos", warn),
      fireworksLine: text(ending.fireworksLine, base.ending.fireworksLine, LIMITS.line, "ending.fireworksLine", warn),
    },
    characters: {
      explorer: character(chars.explorer, base.characters.explorer, "characters.explorer", warn),
      companion: {
        ...character(chars.companion, base.characters.companion, "characters.companion", warn),
        follows: bool(companionIn.follows, base.characters.companion.follows, "characters.companion.follows", warn),
        chatter: oneOf(companionIn.chatter, ["often", "sometimes", "rarely"] as const, base.characters.companion.chatter, "characters.companion.chatter", warn),
      },
    },
    creatures: {
      starborn: text(creatures.starborn, base.creatures.starborn, LIMITS.name, "creatures.starborn", warn) || base.creatures.starborn,
      explorerPegasus: text(creatures.explorerPegasus, base.creatures.explorerPegasus, LIMITS.name, "creatures.explorerPegasus", warn) || base.creatures.explorerPegasus,
      companionPegasus: text(creatures.companionPegasus, base.creatures.companionPegasus, LIMITS.name, "creatures.companionPegasus", warn) || base.creatures.companionPegasus,
      dragon: text(creatures.dragon, base.creatures.dragon, LIMITS.name, "creatures.dragon", warn) || base.creatures.dragon,
      cat: text(creatures.cat, base.creatures.cat, LIMITS.name, "creatures.cat", warn) || base.creatures.cat,
      spaceCats: base.creatures.spaceCats.map((b, i) =>
        text(spaceCatsIn[i], b, LIMITS.name, `creatures.spaceCats[${i}]`, warn) || b) as GiftConfig["creatures"]["spaceCats"],
    },
    places: {
      cafeSign: text(places.cafeSign, base.places.cafeSign, 16, "places.cafeSign", warn),
      studioLine: text(places.studioLine, base.places.studioLine, LIMITS.line, "places.studioLine", warn),
      cafeLine: text(places.cafeLine, base.places.cafeLine, LIMITS.line, "places.cafeLine", warn),
      valleyName: text(places.valleyName, base.places.valleyName, LIMITS.name, "places.valleyName", warn) || base.places.valleyName,
      benchName: text(places.benchName, base.places.benchName, LIMITS.name, "places.benchName", warn) || base.places.benchName,
    },
    chatter: {
      explorer: textList(chatter.explorer, base.chatter.explorer, LIMITS.chatter, LIMITS.short, "chatter.explorer", warn),
      companion: textList(chatter.companion, base.chatter.companion, LIMITS.chatter, LIMITS.short, "chatter.companion", warn),
    },
    theme: {
      accent: typeof theme.accent === "string" && /^#[0-9a-f]{6}$/i.test(theme.accent.trim())
        ? theme.accent.trim().toLowerCase()
        : (theme.accent !== undefined && warn("theme.accent", "should be a colour like #f2c46d"), base.theme.accent),
    },
    music: {
      src: musicRef(music.src, base.music.src, "music.src", warn),
      title: text(music.title, base.music.title, LIMITS.short, "music.title", warn),
      credit: text(music.credit, base.music.credit, LIMITS.short, "music.credit", warn),
    },
    world: {
      home: {
        label: text(home.label, base.world.home.label, LIMITS.name, "world.home.label", warn),
        latitude: num(home.latitude, base.world.home.latitude, -85, 85, "world.home.latitude", warn),
        longitude: num(home.longitude, base.world.home.longitude, -180, 180, "world.home.longitude", warn),
      },
      liveWeather: bool(world.liveWeather, base.world.liveWeather, "world.liveWeather", warn),
    },
  }
  if (gift.occasion.month === 0 || gift.occasion.day === 0) gift.occasion.month = gift.occasion.day = 0
  return { gift, warnings }
}
