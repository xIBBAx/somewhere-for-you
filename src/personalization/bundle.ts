import { getMedia, type MediaRecord } from "./localData"
import { importAudio, importImage, readModelFile, storeModel, MediaError } from "./media"
import { normalizeGift } from "./normalize"
import { DEFAULT_GIFT } from "./defaults"
import type { GiftConfig } from "./types"
import { readZip, writeZip, type ZipEntry } from "./zip"

/**
 * One file that carries a whole personalized world: gift.json plus a media/
 * folder. Its layout is exactly a customize/ folder, so a developer can unzip
 * an export into customize/ and build it (docs/CUSTOMIZATION.md); the
 * Personalize screen reads it back into this browser.
 */

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/wav": "wav", "model/gltf-binary": "glb" }

/** Every "local:" reference in a config, with a setter to replace it. */
const localRefs = (g: GiftConfig): { get: () => string; set: (v: string) => void }[] => {
  const refs: { get: () => string; set: (v: string) => void }[] = []
  const photos = [...g.memories.flatMap((m) => m.photos), ...g.ending.photos, ...g.secrets.flatMap((s) => (s.photo ? [s.photo] : []))]
  for (const p of photos) refs.push({ get: () => p.src, set: (v) => { p.src = v } })
  refs.push({ get: () => g.music.src, set: (v) => { g.music.src = v } })
  refs.push({ get: () => g.characters.explorer.model, set: (v) => { g.characters.explorer.model = v } })
  refs.push({ get: () => g.characters.companion.model, set: (v) => { g.characters.companion.model = v } })
  return refs.filter((r) => r.get().startsWith("local:"))
}

/** The personalized world as a .zip (gift.json + media/). */
export const exportBundle = async (gift: GiftConfig): Promise<Blob> => {
  const g = structuredClone(gift)
  const entries: ZipEntry[] = []
  const written = new Map<string, string>()
  for (const ref of localRefs(g)) {
    const id = ref.get()
    let path = written.get(id)
    if (!path) {
      const record = await getMedia(id)
      if (!record) { ref.set(""); continue }
      path = `${record.kind === "image" ? "photos" : record.kind === "audio" ? "music" : "characters"}/${id.slice(6, 18)}.${EXT[record.type] ?? "bin"}`
      entries.push({ name: `media/${path}`, data: new Uint8Array(await record.bytes.arrayBuffer()) })
      written.set(id, path)
    }
    ref.set(`media:${path}`)
  }
  for (const p of g.memories) p.photos = p.photos.filter((x) => x.src)
  g.ending.photos = g.ending.photos.filter((x) => x.src)
  const json = JSON.stringify(g, null, 2) + "\n"
  entries.unshift({ name: "gift.json", data: new TextEncoder().encode(json) })
  return writeZip(entries)
}

const asFile = (entry: ZipEntry): File => new File([entry.data as BlobPart], entry.name.split("/").pop() ?? "file")

/**
 * Read an exported world. Its photos, music and models are checked and stored
 * in this browser exactly as if they had been added one by one; returns the
 * config (with "local:" references) for the Personalize screen to save.
 */
export const importBundle = async (file: File): Promise<{ gift: GiftConfig; warnings: string[]; stored: MediaRecord[] }> => {
  if (file.size > 400 * 1024 * 1024) throw new MediaError("That file is too large to be a world.")
  const entries = await readZip(await file.arrayBuffer())
  const json = entries.find((e) => e.name === "gift.json" || e.name.endsWith("/gift.json"))
  if (!json) throw new MediaError("That file has no gift.json inside.")
  const prefix = json.name.slice(0, json.name.length - "gift.json".length)
  let raw: unknown
  try { raw = JSON.parse(new TextDecoder().decode(json.data)) } catch { throw new MediaError("gift.json inside that file is not valid JSON.") }
  // media: references are resolved against the archive's own media/ folder
  const media = new Map(entries.filter((e) => e.name.startsWith(`${prefix}media/`)).map((e) => [e.name.slice(prefix.length + 6), e]))
  const { gift, warnings } = normalizeGift(raw, DEFAULT_GIFT)
  const stored: MediaRecord[] = []
  const mapped = new Map<string, string>()
  const refs: { get: () => string; set: (v: string) => void }[] = []
  const photos = [...gift.memories.flatMap((m) => m.photos), ...gift.ending.photos, ...gift.secrets.flatMap((s) => (s.photo ? [s.photo] : []))]
  for (const p of photos) refs.push({ get: () => p.src, set: (v) => { p.src = v } })
  refs.push({ get: () => gift.music.src, set: (v) => { gift.music.src = v } })
  refs.push({ get: () => gift.characters.explorer.model, set: (v) => { gift.characters.explorer.model = v } })
  refs.push({ get: () => gift.characters.companion.model, set: (v) => { gift.characters.companion.model = v } })
  for (const ref of refs) {
    const src = ref.get()
    if (!src.startsWith("media:")) continue
    const known = mapped.get(src)
    if (known !== undefined) { ref.set(known); continue }
    const entry = media.get(src.slice(6))
    let id = ""
    if (entry) {
      try {
        const f = asFile(entry)
        const ext = (entry.name.split(".").pop() ?? "").toLowerCase()
        let record: MediaRecord
        if (["jpg", "jpeg", "png", "webp"].includes(ext)) record = await importImage(f)
        else if (["mp3", "ogg", "m4a", "wav"].includes(ext)) record = await importAudio(f)
        else if (ext === "glb") record = await storeModel(f, await readModelFile(f))
        else throw new MediaError(`${entry.name} is not a photo, track or model.`)
        stored.push(record)
        id = record.id
      } catch (error) {
        warnings.push(`${src} could not be used: ${error instanceof Error ? error.message : String(error)}`)
      }
    } else {
      warnings.push(`${src} is not inside the file`)
    }
    mapped.set(src, id)
    ref.set(id)
  }
  for (const m of gift.memories) m.photos = m.photos.filter((p) => p.src)
  gift.ending.photos = gift.ending.photos.filter((p) => p.src)
  for (const s of gift.secrets) if (s.photo && !s.photo.src) s.photo = null
  if (!gift.music.src) gift.music.src = "default"
  return { gift, warnings, stored }
}
