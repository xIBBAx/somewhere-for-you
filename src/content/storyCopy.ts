import type { MemoryStop } from "./memories"

/**
 * A line still marked as an authoring prompt ("[Replace with …]", as in
 * customize/gift.example.json) is never shown to the player.
 */
export const storyText = (text?: string): string | undefined =>
  text && !/^\[Replace\b.*\]$/.test(text.trim()) ? text : undefined

/** The memory card's main paragraph, or a quiet line if the gift left it as a prompt. */
export const memoryStory = (memory: MemoryStop): string =>
  storyText(memory.shortText) ?? "A small moment to keep, and another star for the journey."
