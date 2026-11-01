import { endingHeading, fireworksLine, gift, resolvePhotos, titleHeading, titleSubtitle, type MemoryPhoto } from "../personalization"

/**
 * The story's own words: the title card, the closing scene and a few lines
 * around the world. They come from the personalization (docs/CUSTOMIZATION.md),
 * so these are read when shown.
 */
export const story = {
  get title(): string { return titleHeading() },
  get subtitle(): string { return titleSubtitle() },
  get enterButton(): string { return gift().letter.enter },
  /** an extra line on the studio memory card (empty: none) */
  get studioLine(): string { return gift().places.studioLine },
  /** an extra line on the corner café memory card (empty: none) */
  get cafeLine(): string { return gift().places.cafeLine },
  /** the word painted over the café door */
  get cafeSign(): string { return gift().places.cafeSign },
  finale: {
    get heading(): string { return endingHeading() },
    get photos(): MemoryPhoto[] { return resolvePhotos(gift().ending.photos) },
    get lines(): string[] { return gift().ending.lines },
    get closingLine(): string { return gift().ending.closing },
  },
  /** shown once when the dated evening fireworks begin (game/environment/Fireworks.tsx) */
  get fireworksHint(): string { return fireworksLine() },
  gateLockedHint: "Find all nine stars. The garden is saving a surprise for you.",
}

/** Whether today is the gift's celebration day (month and day set, occasion not "none"). */
export const isCelebrationDay = (now = new Date()): boolean => {
  const o = gift().occasion
  return o.kind !== "none" && o.month > 0 && o.day > 0 && now.getMonth() === o.month - 1 && now.getDate() === o.day
}
