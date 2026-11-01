/// <reference types="node" />
import { describe, expect, it } from "vitest"
import { COATS, SPECIES, WILD_CAT_COATS } from "../src/world/wildlife/animalAssets"

/** The olive iris baked into cat.glb (alpha 0.75 literal vertices). */
const BAKED_IRIS = [0.218, 0.223, 0.037]

describe("cat coats", () => {
  it("keeps the cat's coat out of the wild cat roll", () => {
    const cat = COATS.cat.findIndex((c) => c.name === "cat")
    expect(cat).toBeGreaterThanOrEqual(0)
    expect(WILD_CAT_COATS).toBe(cat)
    // a wild cat rolls [0, WILD_CAT_COATS) and can never land on the cat
    for (let roll = 0; roll < 40; roll++) {
      expect(Math.floor(roll / 40 * WILD_CAT_COATS)).toBeLessThan(cat)
    }
  })

  it("leaves every other species' coat list untouched", () => {
    for (const species of SPECIES) {
      if (species === "cat") continue
      expect(COATS[species].length).toBeGreaterThan(0)
      expect(COATS[species].every((c) => c.base && c.light && c.pattern)).toBe(true)
    }
    // the everyday palette still leads the wild cats; real breeds follow
    const wild = COATS.cat.filter((c) => c.name !== "cat").map((c) => c.name)
    expect(wild.slice(0, 7)).toEqual([
      "ginger tabby", "grey tabby", "tuxedo", "cream", "black", "calico", "brown tabby",
    ])
    expect(wild).toEqual(expect.arrayContaining(["Siamese", "Maine Coon", "British Shorthair", "Bengal", "Persian"]))
  })

  it("gives the cat coats eye tints but never leaves the cat without one", () => {
    // a coat without `eye` falls back to the baked olive iris, which is what
    // The cat's unset tint is deliberate
    const cat = COATS.cat.find((c) => c.name === "cat")!
    expect(cat.eye).toBeUndefined()
    for (const coat of COATS.cat.filter((c) => c.name !== "cat")) {
      if (coat.eye) {
        // the tint multiplies the baked olive iris; the result must stay a real colour
        coat.eye.forEach((v, i) => {
          expect(v).toBeGreaterThan(0)
          expect(v * BAKED_IRIS[i]).toBeLessThanOrEqual(1)
        })
      }
    }
  })
})

describe("duck bills", () => {
  it("give every duck coat a bill colour of its own, never the head's", () => {
    for (const coat of COATS.duck) {
      expect(coat.bill).toMatch(/^#[0-9a-f]{6}$/)
      expect(coat.bill).not.toBe(coat.pattern)
    }
    // a white (Pekin) duck's bill is orange: red well above blue
    const white = COATS.duck.find((c) => c.name === "white duck")!
    const [r, , b] = [1, 3, 5].map((i) => parseInt(white.bill!.slice(i, i + 2), 16))
    expect(r - b).toBeGreaterThan(120)
  })
})

