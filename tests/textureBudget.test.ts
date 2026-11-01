import { describe, expect, it } from "vitest"
import { cappedSize, characterTextureMax } from "../src/game/characters/textureBudget"

describe("character texture budget", () => {
  it("keeps full skin detail on High and Medium, halves it on Low", () => {
    expect(characterTextureMax("high")).toBe(2048)
    expect(characterTextureMax("medium")).toBe(2048)
    expect(characterTextureMax("low")).toBe(1024)
  })

  it("scales down to the cap and never up", () => {
    expect(cappedSize(2048, 2048, 1024)).toEqual([1024, 1024])
    expect(cappedSize(2048, 1024, 1024)).toEqual([1024, 512])
    expect(cappedSize(512, 512, 1024)).toEqual([512, 512])
  })
})
