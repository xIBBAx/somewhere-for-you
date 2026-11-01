/**
 * The shape of a personalized world ("gift"). Everything here is optional to
 * the person writing it: missing or invalid values fall back to the defaults
 * in defaults.ts, so the game always starts.
 *
 * Text is plain text. It is never interpreted as HTML anywhere in the game.
 */

/** Who the world is for, relative to the person who made it. */
export type RelationshipKind = "partner" | "friend" | "family" | "other"

/** What the world celebrates. "none" turns the dated fireworks off. */
export type OccasionKind =
  | "birthday" | "anniversary" | "celebration"
  | "diwali" | "holi" | "eid" | "christmas" | "navratri" | "onam" | "pongal" | "baisakhi" | "raksha-bandhan" | "gurpurab"
  | "none"

/**
 * A photo reference. `src` is one of:
 *  - "placeholder:<name>"  built-in artwork shipped with the game
 *  - "media:<path>"        a file in customize/media/ (build-time personalization)
 *  - "local:<id>"          a photo added in the in-game Personalize screen,
 *                          stored only in this browser (IndexedDB)
 */
export type PhotoRef = {
  src: string
  /** describes the picture for screen readers */
  alt: string
  /** a short caption such as "June 2025", shown on the print */
  caption?: string
}

export type MemoryText = {
  title: string
  subtitle: string
  /** the main paragraph on the memory card */
  text: string
  /** a second, optional paragraph */
  more: string
  /** where it happened, shown after the title (optional) */
  place: string
  /** when it happened, shown after the title (optional) */
  date: string
  photos: PhotoRef[]
}

export type CharacterChoice = {
  /** name shown in the HUD and in dialogue (defaults to the person's name) */
  name: string
  /** a built-in appearance preset id, see CHARACTER_PRESETS in content/assets.ts */
  preset: string
  /**
   * An optional custom rigged GLB that replaces the preset:
   * "media:<path>" (customize/media) or "local:<id>" (imported in the browser).
   * See docs/CHARACTER_ASSETS.md for the rig it must have.
   */
  model: string
}

export type GiftConfig = {
  version: 1
  /** the person the world is for: they play as the explorer */
  recipient: { name: string }
  /** the person who made it: they appear as the companion */
  creator: { name: string }
  relationship: { kind: RelationshipKind; label: string }
  occasion: {
    kind: OccasionKind
    /** the date the sky celebrates with fireworks (month 1-12, day 1-31); 0 = no date */
    month: number
    day: number
  }
  /** the letter shown before the world opens */
  letter: {
    heading: string
    greeting: string
    paragraphs: string[]
    signoff: string
    /** label of the button that enters the world */
    enter: string
  }
  /** the title card of the opening journey */
  title: { heading: string; subtitle: string }
  /** the nine memory places, in order */
  memories: MemoryText[]
  /** the two hidden things the cat finds */
  secrets: { title: string; text: string; photo: PhotoRef | null }[]
  /** the closing scene once every star is found */
  ending: { heading: string; lines: string[]; closing: string; photos: PhotoRef[]; fireworksLine: string }
  characters: { explorer: CharacterChoice; companion: CharacterChoice & { follows: boolean; chatter: "often" | "sometimes" | "rarely" } }
  /** the names of the animals that belong to this world */
  creatures: {
    starborn: string
    explorerPegasus: string
    companionPegasus: string
    dragon: string
    cat: string
    /** the five space cats: the captain first */
    spaceCats: [string, string, string, string, string]
  }
  /** names and lines of places in the world (docs/CUSTOMIZATION.md, "The animals and the places") */
  places: {
    /** the word over the corner café's door */
    cafeSign: string
    /** an extra line on the studio's memory card (empty: none) */
    studioLine: string
    /** an extra line on the corner café's memory card (empty: none) */
    cafeLine: string
    /** the high mountain valley's name on maps and in travel */
    valleyName: string
    /** the bench above the valley's river */
    benchName: string
  }
  /** short lines the two characters say to each other */
  chatter: { explorer: string[]; companion: string[] }
  theme: { accent: string }
  /** "default" keeps the bundled track; "none" is silence; otherwise a media/local ref */
  music: { src: string; title: string; credit: string }
  world: {
    /** the place the opening globe turns to; it also sets the night sky's latitude */
    home: { label: string; latitude: number; longitude: number }
    /** fetch the real local weather from Open-Meteo (sends rounded coordinates) */
    liveWeather: boolean
  }
}
