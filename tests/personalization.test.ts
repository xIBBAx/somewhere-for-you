import { describe, expect, it } from "vitest"
import { DEFAULT_GIFT, MEMORY_SLOT_IDS, isMediaRef, normalizeGift, resolvePhoto, setGiftForTests, LIMITS } from "../src/personalization"
import { readZip, safeEntryName, writeZip } from "../src/personalization/zip"
import { sniff } from "../src/personalization/media"
import { safeJsonForHtml } from "../tools/vite/giftLetterPlugin"
import { imageSize } from "../tools/vite/giftMediaPlugin"
import { isCelebrationDay } from "../src/content/story"

describe("normalizeGift", () => {
  it("turns nothing into the complete demo world without warnings", () => {
    const { gift, warnings } = normalizeGift(undefined)
    expect(warnings).toEqual([])
    expect(gift).toEqual(DEFAULT_GIFT)
    expect(gift.memories).toHaveLength(MEMORY_SLOT_IDS.length)
  })

  it("keeps valid values and falls back field by field with a warning", () => {
    const { gift, warnings } = normalizeGift({
      recipient: { name: "Sam" },
      creator: { name: 42 },
      occasion: { kind: "birthday", month: 13, day: 5 },
      theme: { accent: "red" },
      world: { home: { latitude: 120, longitude: 10 }, liveWeather: "yes" },
    })
    expect(gift.recipient.name).toBe("Sam")
    expect(gift.creator.name).toBe(DEFAULT_GIFT.creator.name)
    expect(gift.occasion.kind).toBe("birthday")
    // an invalid month means no date at all, never a half-date
    expect([gift.occasion.month, gift.occasion.day]).toEqual([0, 0])
    expect(gift.theme.accent).toBe(DEFAULT_GIFT.theme.accent)
    expect(gift.world.home.latitude).toBe(DEFAULT_GIFT.world.home.latitude)
    expect(gift.world.liveWeather).toBe(false)
    expect(warnings.join("\n")).toMatch(/creator\.name/)
    expect(warnings.join("\n")).toMatch(/occasion\.month/)
    expect(warnings.join("\n")).toMatch(/theme\.accent/)
    expect(warnings.join("\n")).toMatch(/world\.liveWeather/)
  })

  it("strips control characters, collapses single-line whitespace and caps lengths", () => {
    const { gift, warnings } = normalizeGift({
      recipient: { name: "  A\u0000li\u0007ce \n Smith  " },
      letter: { paragraphs: ["Line one\nline two\u0001", "x".repeat(LIMITS.paragraph + 50)] },
    })
    expect(gift.recipient.name).toBe("Alice Smith")
    expect(gift.letter.paragraphs[0]).toBe("Line one\nline two")
    expect(gift.letter.paragraphs[1]).toHaveLength(LIMITS.paragraph)
    expect(warnings.some((w) => w.startsWith("letter.paragraphs"))).toBe(false)
  })

  it("never treats text as markup: HTML stays literal text", () => {
    const { gift } = normalizeGift({ letter: { greeting: "<img src=x onerror=alert(1)>" } })
    expect(gift.letter.greeting).toBe("<img src=x onerror=alert(1)>")
  })

  it("keeps exactly nine memory places, whatever the input", () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ title: `M${i}` }))
    const { gift, warnings } = normalizeGift({ memories: many })
    expect(gift.memories).toHaveLength(9)
    expect(gift.memories[8].title).toBe("M8")
    expect(warnings.some((w) => w.startsWith("memories"))).toBe(true)
    const few = normalizeGift({ memories: [{ title: "Only one" }] }).gift
    expect(few.memories[0].title).toBe("Only one")
    expect(few.memories[1].title).toBe(DEFAULT_GIFT.memories[1].title)
  })

  it("accepts only safe media references", () => {
    for (const ok of ["placeholder:meadow", "media:photos/us.jpg", "media:a b/c-d_e.png", "local:0123456789abcdef"]) expect(isMediaRef(ok), ok).toBe(true)
    for (const bad of ["placeholder:nope", "media:../secret.jpg", "media:/etc/passwd", "media:photos/../../x.jpg", "https://example.com/a.jpg",
      "javascript:alert(1)", "local:../../x", "media:", "data:image/png;base64,AAAA"]) expect(isMediaRef(bad), bad).toBe(false)
    const { gift } = normalizeGift({ memories: [{ photos: [{ src: "https://tracker.example/p.jpg", alt: "x" }, { src: "media:ok.jpg", alt: "fine" }] }] })
    expect(gift.memories[0].photos.map((p) => p.src)).toEqual(["media:ok.jpg"])
  })

  it("accepts custom models and music only by file type", () => {
    const { gift, warnings } = normalizeGift({
      characters: { explorer: { model: "media:me.glb" }, companion: { model: "media:me.exe" } },
      music: { src: "media:song.mp3" },
    })
    expect(gift.characters.explorer.model).toBe("media:me.glb")
    expect(gift.characters.companion.model).toBe("")
    expect(gift.music.src).toBe("media:song.mp3")
    expect(warnings.join()).toMatch(/characters\.companion\.model/)
    expect(normalizeGift({ music: { src: "none" } }).gift.music.src).toBe("none")
  })
})

describe("resolving photos", () => {
  it("serves built-in artwork with its size and a thumbnail", () => {
    setGiftForTests(DEFAULT_GIFT)
    const p = resolvePhoto({ src: "placeholder:meadow", alt: "A meadow" })
    expect(p).toMatchObject({ src: "/assets/placeholders/meadow.jpg", thumb: "/assets/placeholders/thumbs/meadow.jpg", w: 1280, h: 800, alt: "A meadow" })
  })

  it("leaves out a photo that is missing instead of showing a broken frame", () => {
    expect(resolvePhoto({ src: "media:not-there.jpg", alt: "x" })).toBeNull()
    expect(resolvePhoto({ src: "local:0123456789abcdef", alt: "x" })).toBeNull()
    expect(resolvePhoto(null)).toBeNull()
  })
})

describe("the letter's data in the page", () => {
  it("cannot close its script element or open another", () => {
    const out = safeJsonForHtml({ greeting: "</script><script>alert(1)</script><!--", line: "a\u2028b" })
    expect(out).not.toMatch(/<\/script|<script|<!--/i)
    expect(out).toContain("\\u003c/script\\u003e")
    expect(out).toContain("\\u2028")
    expect(JSON.parse(out)).toEqual({ greeting: "</script><script>alert(1)</script><!--", line: "a\u2028b" })
  })
})

describe("world export archives", () => {
  it("round-trips files through a ZIP", async () => {
    const enc = new TextEncoder()
    const blob = writeZip([{ name: "gift.json", data: enc.encode("{\"a\":1}") }, { name: "media/photos/p.jpg", data: new Uint8Array([1, 2, 3, 255]) }])
    const entries = await readZip(await blob.arrayBuffer())
    expect(entries.map((e) => e.name)).toEqual(["gift.json", "media/photos/p.jpg"])
    expect(new TextDecoder().decode(entries[0].data)).toBe("{\"a\":1}")
    expect([...entries[1].data]).toEqual([1, 2, 3, 255])
  })

  it("refuses unsafe paths and non-ZIP files", async () => {
    for (const bad of ["../x", "/etc/passwd", "a/../../b", "a\\b", "a/./b", ""]) expect(safeEntryName(bad), bad).toBe(false)
    expect(safeEntryName("media/photos/us.jpg")).toBe(true)
    const evil = writeZip([{ name: "../escape.txt", data: new Uint8Array([1]) }])
    await expect(readZip(await evil.arrayBuffer())).rejects.toThrow(/unsafe/)
    await expect(readZip(new Uint8Array([1, 2, 3, 4]).buffer)).rejects.toThrow(/not a ZIP/)
  })
})

describe("file checks", () => {
  it("recognizes files by their first bytes, not their names", () => {
    expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg")
    expect(sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe("png")
    expect(sniff(new TextEncoder().encode("glTF\u0002\u0000\u0000\u0000"))).toBe("glb")
    expect(sniff(new TextEncoder().encode("<html><script>"))).toBeNull()
  })

  it("reads image sizes from headers for build-time photos", () => {
    const png = Buffer.alloc(33)
    png.writeUInt32BE(0x89504e47, 0)
    png.writeUInt32BE(640, 16)
    png.writeUInt32BE(480, 20)
    expect(imageSize(png)).toEqual({ w: 640, h: 480 })
    expect(imageSize(Buffer.from("not an image at all, sorry"))).toBeNull()
  })
})

describe("the celebration day", () => {
  it("is only the configured day, and never without a date", () => {
    setGiftForTests({ ...DEFAULT_GIFT, occasion: { kind: "birthday", month: 6, day: 14 } })
    expect(isCelebrationDay(new Date(2027, 5, 14))).toBe(true)
    expect(isCelebrationDay(new Date(2027, 5, 15))).toBe(false)
    setGiftForTests({ ...DEFAULT_GIFT, occasion: { kind: "none", month: 6, day: 14 } })
    expect(isCelebrationDay(new Date(2027, 5, 14))).toBe(false)
    setGiftForTests(DEFAULT_GIFT)
    expect(isCelebrationDay(new Date(2027, 5, 14))).toBe(false)
  })
})

describe("customize/gift.example.json", () => {
  it("is a valid gift with no warnings", async () => {
    const { readFileSync } = await import("node:fs")
    const example = JSON.parse(readFileSync("customize/gift.example.json", "utf8"))
    const { warnings, gift } = normalizeGift(example)
    expect(warnings).toEqual([])
    expect(gift.recipient.name).toBe("Anaya")
  })
})
