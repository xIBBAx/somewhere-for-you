import { createHash } from "node:crypto"
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs"
import path from "node:path"
import type { Plugin, ResolvedConfig } from "vite"

/**
 * Build-time personalization media: every photo, track and model in
 * customize/media/ becomes available to the game as "media:<relative path>".
 *
 *   import { giftMedia } from "virtual:gift-media"
 *   giftMedia["photos/us.jpg"] -> { url, w, h, kind }
 *
 * In development the files are served straight from the folder. In a
 * production build they are copied into dist/assets/gift/ under content-hashed
 * names. Only known file types are included; files over the size caps,
 * links that point outside the folder and hidden files are skipped.
 */

const VIRTUAL = "virtual:gift-media"
const RESOLVED = "\0" + VIRTUAL
const KINDS: Record<string, { kind: "image" | "audio" | "model"; max: number }> = {
  ".jpg": { kind: "image", max: 25e6 }, ".jpeg": { kind: "image", max: 25e6 }, ".png": { kind: "image", max: 25e6 }, ".webp": { kind: "image", max: 25e6 },
  ".mp3": { kind: "audio", max: 25e6 }, ".ogg": { kind: "audio", max: 25e6 }, ".m4a": { kind: "audio", max: 25e6 }, ".wav": { kind: "audio", max: 40e6 },
  ".glb": { kind: "model", max: 40e6 },
}

type Entry = { rel: string; abs: string; kind: "image" | "audio" | "model"; w?: number; h?: number }

/** Width and height from a PNG, JPEG or WebP header (no decoding). */
export const imageSize = (b: Buffer): { w: number; h: number } | null => {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
  if (b.length > 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const chunk = b.toString("ascii", 12, 16)
    if (chunk === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) }
    if (chunk === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff }
    if (chunk === "VP8L") {
      const bits = b.readUInt32LE(21)
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 }
    }
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue }
      const marker = b[o + 1]
      const len = b.readUInt16BE(o + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { w: b.readUInt16BE(o + 7), h: b.readUInt16BE(o + 5) }
      o += 2 + len
    }
  }
  return null
}

const scan = (root: string): Entry[] => {
  const out: Entry[] = []
  let rootReal: string
  try { rootReal = realpathSync(root) } catch { return out }
  const walk = (dir: string, depth: number): void => {
    if (depth > 6) return
    let names: string[]
    try { names = readdirSync(dir) } catch { return }
    for (const name of names.sort()) {
      if (name.startsWith(".")) continue
      const abs = path.join(dir, name)
      let st
      try { st = lstatSync(abs) } catch { continue }
      if (st.isSymbolicLink()) {
        // follow a link only if it stays inside customize/media
        try { if (!realpathSync(abs).startsWith(rootReal + path.sep)) continue } catch { continue }
      }
      if (st.isDirectory()) { walk(abs, depth + 1); continue }
      const spec = KINDS[path.extname(name).toLowerCase()]
      if (!spec || st.size > spec.max || st.size === 0) continue
      const rel = path.relative(root, abs).split(path.sep).join("/")
      const entry: Entry = { rel, abs, kind: spec.kind }
      if (spec.kind === "image") {
        const size = imageSize(readFileSync(abs).subarray(0, 256 * 1024))
        if (!size) continue
        entry.w = size.w
        entry.h = size.h
      }
      out.push(entry)
    }
  }
  walk(root, 0)
  return out
}

export const giftMediaPlugin = (): Plugin => {
  let config: ResolvedConfig
  let mediaDir = ""
  let emitted = new Map<string, string>()
  return {
    name: "gift-media",
    configResolved(c) {
      config = c
      mediaDir = path.join(c.root, "customize", "media")
    },
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : null
    },
    load(id) {
      if (id !== RESOLVED) return null
      const entries = scan(mediaDir)
      emitted = new Map()
      const map: Record<string, { url: string; kind: string; w?: number; h?: number }> = {}
      for (const e of entries) {
        let url: string
        if (config.command === "build") {
          const data = readFileSync(e.abs)
          const name = `assets/gift/${createHash("sha256").update(data).digest("hex").slice(0, 16)}${path.extname(e.rel).toLowerCase()}`
          emitted.set(name, e.abs)
          url = config.base + name
        } else {
          url = `${config.base}customize/media/${e.rel.split("/").map(encodeURIComponent).join("/")}`
        }
        map[e.rel] = { url, kind: e.kind, ...(e.w ? { w: e.w, h: e.h } : {}) }
        this.addWatchFile(e.abs)
      }
      return `export const giftMedia = ${JSON.stringify(map)}`
    },
    generateBundle() {
      for (const [fileName, abs] of emitted) this.emitFile({ type: "asset", fileName, source: readFileSync(abs) })
    },
  }
}
