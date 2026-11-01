export type { GiftConfig, PhotoRef, MemoryText, CharacterChoice, RelationshipKind, OccasionKind } from "./types"
export { DEFAULT_GIFT, MEMORY_SLOT_IDS, PLACEHOLDERS } from "./defaults"
export { normalizeGift, cleanText, isMediaRef, LIMITS } from "./normalize"
export {
  gift, names, characterName, initPersonalization, resolvePhoto, resolvePhotos, resolveModelUrl, resolveMusic,
  titleHeading, titleSubtitle, endingHeading, fireworksLine, personalizationWarnings, buildGift, hasBuildGift, setGiftForTests,
  type MemoryPhoto,
} from "./resolve"
