import { describe, expect, it } from "vitest"
import { ACHIEVEMENTS, BOOK_COMPLETE } from "../src/content/adventures"
import { TOGETHER_LINES } from "../src/content/together"
import { LANDMARK_TEXT } from "../src/content/discoveries"
import { storyText } from "../src/content/storyCopy"

/** Authoring prompts look like "[Replace with …]"; players must never see one. */
const PROMPT = /\[Replace\b/

describe("player-visible copy", () => {
  it("has no authoring prompts in the book, its pages or the together lines", () => {
    const texts = [
      BOOK_COMPLETE.title, ...BOOK_COMPLETE.lines,
      ...Object.values(ACHIEVEMENTS).flatMap((p) => [p.title, p.line, p.hint]),
      ...Object.values(TOGETHER_LINES).flatMap((l) => [...l.explorer, ...l.companion]),
      ...Object.values(LANDMARK_TEXT).flatMap((t) => [t.title, t.verb, ...t.lines]),
    ]
    expect(texts.filter((t) => PROMPT.test(t))).toEqual([])
  })

  it("filters authoring prompts wherever story text may still carry them", () => {
    expect(storyText("[Replace with your own closing message.]")).toBeUndefined()
    expect(storyText("A real line.")).toBe("A real line.")
  })
})
