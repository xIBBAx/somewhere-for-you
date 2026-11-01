import { describe, expect, it } from "vitest"
import { MEMORIES } from "../src/content/memories"
import { memoryStory, storyText } from "../src/content/storyCopy"

describe("playable story copy", () => {
  it("keeps drafting prompts and unknown dates out of the game", () => {
    expect(storyText("[Replace with the date]")).toBeUndefined()
    expect(storyText(undefined)).toBeUndefined()
    for (const memory of MEMORIES) expect(memoryStory(memory)).not.toContain("[Replace")
  })
  it("preserves supplied personal wording verbatim when it is present", () => {
    const supplied = "A real memory supplied by the author."
    expect(memoryStory({ ...MEMORIES[0], shortText: supplied })).toBe(supplied)
    expect(storyText("27 August")).toBe("27 August")
  })
})
