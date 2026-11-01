import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import type { Plugin } from "vite"
import { normalizeGift } from "../../src/personalization/normalize"

/**
 * Puts the letter's words into index.html as inert JSON
 * (<script type="application/json" id="gift-letter">), so public/boot/letter.js
 * can show the letter before the game's bundle has loaded. The words come from
 * customize/gift.json if it exists, else the built-in demo.
 *
 * JSON in HTML is escaped so no value can close the element or open another.
 */
export const safeJsonForHtml = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(new RegExp(String.fromCharCode(0x2028), "g"), "\\u2028")
    .replace(new RegExp(String.fromCharCode(0x2029), "g"), "\\u2029")

export const giftLetterPlugin = (): Plugin => {
  let root = process.cwd()
  return {
    name: "gift-letter",
    configResolved(c) {
      root = c.root
    },
    configureServer(server) {
      // a saved gift.json changes the letter on the next page load
      const file = path.join(root, "customize", "gift.json")
      server.watcher.add(file)
    },
    transformIndexHtml(html) {
      const file = path.join(root, "customize", "gift.json")
      let input: unknown
      let personalized = false
      if (existsSync(file)) {
        try {
          input = JSON.parse(readFileSync(file, "utf8"))
          personalized = true
        } catch (error) {
          this.warn?.(`customize/gift.json is not valid JSON and was ignored: ${(error as Error).message}`)
        }
      }
      const { gift, warnings } = normalizeGift(input)
      for (const w of warnings.slice(0, 20)) console.warn(`[personalize] customize/gift.json: ${w}`)
      const letter = {
        personalized,
        recipient: gift.recipient,
        creator: gift.creator,
        title: gift.title,
        letter: gift.letter,
        theme: gift.theme,
      }
      return html.replace("<!--gift-letter-->", `<script type="application/json" id="gift-letter">${safeJsonForHtml(letter)}</script>`)
    },
  }
}
