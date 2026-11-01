import { newMediaId, putMedia, type MediaRecord } from "./localData"

/**
 * Checks and stores files a person adds in the Personalize screen. Everything
 * runs locally: images are decoded and re-encoded on a canvas (which drops
 * EXIF, GPS and any other metadata), audio and models are checked by their
 * first bytes and size before they are kept.
 */

export const MEDIA_LIMITS = {
  imageBytes: 25 * 1024 * 1024,
  imagePixels: 60_000_000,
  imageEdge: 1600,
  thumbEdge: 480,
  audioBytes: 25 * 1024 * 1024,
  modelBytes: 40 * 1024 * 1024,
} as const

export class MediaError extends Error {}

const head = async (file: Blob, n: number): Promise<Uint8Array> => new Uint8Array(await file.slice(0, n).arrayBuffer())
const ascii = (b: Uint8Array, from: number, len: number): string => String.fromCharCode(...b.slice(from, from + len))

/** The real type from the file's first bytes (the name and the browser's guess are not trusted). */
export const sniff = (b: Uint8Array): "jpeg" | "png" | "webp" | "mp3" | "ogg" | "m4a" | "wav" | "glb" | null => {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg"
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return "png"
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp"
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE") return "wav"
  if (ascii(b, 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "mp3"
  if (ascii(b, 0, 4) === "OggS") return "ogg"
  if (ascii(b, 4, 4) === "ftyp") return "m4a"
  if (ascii(b, 0, 4) === "glTF") return "glb"
  return null
}

/** A label safe to show as text: the file name without its extension, shortened. */
// control characters are exactly what this strips
// eslint-disable-next-line no-control-regex
const labelOf = (file: File): string => file.name.replace(/\.[^.]+$/, "").replace(/[\u0000-\u001F\u007F<>]/g, "").slice(0, 48) || "file"

const canvasBlob = (canvas: HTMLCanvasElement | OffscreenCanvas, quality: number): Promise<Blob> =>
  "convertToBlob" in canvas
    ? canvas.convertToBlob({ type: "image/jpeg", quality })
    : new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new MediaError("Could not re-encode the image."))), "image/jpeg", quality))

const scaled = async (bitmap: ImageBitmap, edge: number, quality: number): Promise<{ blob: Blob; w: number; h: number }> => {
  const s = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * s)), h = Math.max(1, Math.round(bitmap.height * s))
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h })
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) throw new MediaError("This browser cannot prepare images.")
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(bitmap, 0, 0, w, h)
  return { blob: await canvasBlob(canvas, quality), w, h }
}

/** A photo: JPEG, PNG or WebP up to 25 MB, stored at 1600 px with a 480 px thumbnail. */
export const importImage = async (file: File): Promise<MediaRecord> => {
  if (file.size > MEDIA_LIMITS.imageBytes) throw new MediaError("That photo is larger than 25 MB.")
  const kind = sniff(await head(file, 16))
  if (kind !== "jpeg" && kind !== "png" && kind !== "webp") throw new MediaError("Photos must be JPEG, PNG or WebP files.")
  let bitmap: ImageBitmap
  try {
    // the camera's own orientation is applied, then the metadata is left behind
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
  } catch {
    throw new MediaError("That photo could not be read.")
  }
  try {
    if (bitmap.width * bitmap.height > MEDIA_LIMITS.imagePixels) throw new MediaError("That photo has too many pixels (60 megapixels at most).")
    const full = await scaled(bitmap, MEDIA_LIMITS.imageEdge, 0.88)
    const thumb = await scaled(bitmap, MEDIA_LIMITS.thumbEdge, 0.82)
    const record: MediaRecord = { id: newMediaId(), kind: "image", type: "image/jpeg", label: labelOf(file), bytes: full.blob, thumb: thumb.blob, w: full.w, h: full.h, added: Date.now() }
    await putMedia(record)
    return record
  } finally {
    bitmap.close()
  }
}

const AUDIO_TYPES: Record<string, string> = { mp3: "audio/mpeg", ogg: "audio/ogg", m4a: "audio/mp4", wav: "audio/wav" }

/** Music: MP3, OGG, M4A or WAV up to 25 MB, checked by playing its first frames in an Audio element. */
export const importAudio = async (file: File): Promise<MediaRecord> => {
  if (file.size > MEDIA_LIMITS.audioBytes) throw new MediaError("That track is larger than 25 MB.")
  const kind = sniff(await head(file, 16))
  const type = kind ? AUDIO_TYPES[kind] : undefined
  if (!type) throw new MediaError("Music must be an MP3, OGG, M4A or WAV file.")
  const blob = new Blob([file], { type })
  const url = URL.createObjectURL(blob)
  try {
    await new Promise<void>((resolve, reject) => {
      const audio = new Audio()
      const timer = window.setTimeout(() => reject(new MediaError("That track could not be read in time.")), 10_000)
      audio.preload = "metadata"
      audio.onloadedmetadata = () => { window.clearTimeout(timer); resolve() }
      audio.onerror = () => { window.clearTimeout(timer); reject(new MediaError("This browser cannot play that track.")) }
      audio.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
  const record: MediaRecord = { id: newMediaId(), kind: "audio", type, label: labelOf(file), bytes: blob, added: Date.now() }
  await putMedia(record)
  return record
}

/** A character model: a binary glTF (.glb) up to 40 MB. The rig is checked separately (characters/modelCheck.ts). */
export const readModelFile = async (file: File): Promise<ArrayBuffer> => {
  if (file.size > MEDIA_LIMITS.modelBytes) throw new MediaError("That model is larger than 40 MB.")
  const b = await head(file, 12)
  if (sniff(b) !== "glb") throw new MediaError("Character models must be binary glTF (.glb) files.")
  const version = b[4] | (b[5] << 8)
  if (version !== 2) throw new MediaError("Only glTF 2.0 models are supported.")
  return file.arrayBuffer()
}

export const storeModel = async (file: File, buffer: ArrayBuffer): Promise<MediaRecord> => {
  const record: MediaRecord = { id: newMediaId(), kind: "model", type: "model/gltf-binary", label: labelOf(file), bytes: new Blob([buffer], { type: "model/gltf-binary" }), added: Date.now() }
  await putMedia(record)
  return record
}
