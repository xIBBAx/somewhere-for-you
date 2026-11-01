import { describe, expect, it } from "vitest"
import { MEMORIES, TOTAL_STARS, getMemory } from "../src/content/memories"
import { SECRETS } from "../src/content/secrets"
import { story } from "../src/content/story"
import { HOME_RADIUS } from "../src/game/world-layout"
import { memoryStory, storyText } from "../src/content/storyCopy"
import { DEFAULT_GIFT, PLACEHOLDERS } from "../src/personalization"
import { existsSync } from "node:fs"
import { join } from "node:path"

const PUBLIC = join(__dirname, "..", "public")

describe("content integrity", () => {
  it("has unique memory ids and sequential orders", () => {
    const ids = new Set(MEMORIES.map((m) => m.id))
    expect(ids.size).toBe(MEMORIES.length)
    const orders = MEMORIES.map((m) => m.order).sort((a, b) => a - b)
    expect(orders).toEqual(Array.from({ length: MEMORIES.length }, (_, i) => i + 1))
  })

  it("keeps every stop inside the walkable home region", () => {
    for (const m of MEMORIES) {
      const r = Math.hypot(m.worldPosition[0], m.worldPosition[2] + 2)
      expect(r, `${m.id} outside home`).toBeLessThan(HOME_RADIUS - 1)
      expect(m.radius).toBeGreaterThan(1)
      expect(m.radius).toBeLessThan(5)
    }
  })

  it("keeps the set pieces each memory place is built around", () => {
    const types = MEMORIES.map((m) => m.sceneType)
    for (const t of ["beginning", "cafe", "walk", "studio", "animals", "training", "rain", "future"] as const) expect(types).toContain(t)
    expect(getMemory("corner-cafe")?.sceneType).toBe("cafe")
  })

  it("has two secrets with valid trails and words", () => {
    expect(SECRETS.length).toBe(2)
    for (const s of SECRETS) {
      const len = Math.hypot(s.trailEnd[0] - s.trailStart[0], s.trailEnd[1] - s.trailStart[1])
      expect(len).toBeGreaterThan(2)
      expect(storyText(s.text), `${s.id} shows an authoring prompt`).toBeDefined()
    }
  })

  it("keeps the star economy consistent", () => {
    expect(TOTAL_STARS).toBe(MEMORIES.length)
  })

  it("keeps the memory ids that saved progress depends on", () => {
    expect(MEMORIES.map((m) => m.id)).toEqual([
      "first-steps", "cafe-table", "long-way", "little-studio", "cat-garden",
      "training-corner", "corner-cafe", "rain-spot", "path-ahead",
    ])
  })

  it("the demo world is complete: every stop has words and a picture, and no prompt reaches the player", () => {
    for (const m of MEMORIES) {
      expect(m.photos?.length, `${m.id} has no picture`).toBeGreaterThan(0)
      expect(memoryStory(m)).not.toMatch(/\[Replace|TODO/)
      expect(m.title.length).toBeGreaterThan(2)
    }
    expect(story.finale.lines.length).toBeGreaterThan(0)
    expect(story.finale.closingLine.length).toBeGreaterThan(5)
    expect(story.title.length).toBeGreaterThan(3)
  })

  it("ships every placeholder picture the demo uses, with its thumbnail", () => {
    for (const name of PLACEHOLDERS) {
      expect(existsSync(join(PUBLIC, "assets", "placeholders", `${name}.jpg`)), name).toBe(true)
      expect(existsSync(join(PUBLIC, "assets", "placeholders", "thumbs", `${name}.jpg`)), `${name} thumb`).toBe(true)
    }
    const used = [...DEFAULT_GIFT.memories.flatMap((m) => m.photos), ...DEFAULT_GIFT.secrets.flatMap((s) => (s.photo ? [s.photo] : [])), ...DEFAULT_GIFT.ending.photos]
    for (const p of used) expect(p.src.startsWith("placeholder:"), p.src).toBe(true)
  })

  it("ships the two default characters and the bundled music", () => {
    for (const f of ["characters/explorer.glb", "characters/companion.glb", "audio/first-snow.mp3"]) expect(existsSync(join(PUBLIC, "assets", f)), f).toBe(true)
  })
})
