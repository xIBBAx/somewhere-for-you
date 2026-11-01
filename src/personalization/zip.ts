/**
 * A small ZIP writer (stored, no compression) and a careful reader (stored
 * or deflate, via the browser's DecompressionStream). Enough to export a
 * personalized world as one file and to read it back; no dependency.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export const crc32 = (data: Uint8Array): number => {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export type ZipEntry = { name: string; data: Uint8Array }

/** Build a ZIP archive (all entries stored). */
export const writeZip = (entries: ZipEntry[]): Blob => {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const e of entries) {
    const name = enc.encode(e.name)
    const crc = crc32(e.data)
    const local = new Uint8Array(30 + name.length)
    const v = new DataView(local.buffer)
    v.setUint32(0, 0x04034b50, true)
    v.setUint16(4, 20, true)
    v.setUint16(6, 0x0800, true) // UTF-8 names
    v.setUint16(8, 0, true) // stored
    v.setUint32(14, crc, true)
    v.setUint32(18, e.data.length, true)
    v.setUint32(22, e.data.length, true)
    v.setUint16(26, name.length, true)
    local.set(name, 30)
    parts.push(local, e.data)
    const c = new Uint8Array(46 + name.length)
    const cv = new DataView(c.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, e.data.length, true)
    cv.setUint32(24, e.data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    c.set(name, 46)
    central.push(c)
    offset += local.length + e.data.length
  }
  const centralSize = central.reduce((s, c) => s + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  return new Blob([...parts, ...central, end] as BlobPart[], { type: "application/zip" })
}

export const ZIP_LIMITS = { entries: 300, entryBytes: 45 * 1024 * 1024, totalBytes: 400 * 1024 * 1024 } as const

/** A safe relative name: no absolute path, no "..", no backslashes or control characters. */
export const safeEntryName = (name: string): boolean =>
  // eslint-disable-next-line no-control-regex
  name.length > 0 && name.length < 240 && !name.startsWith("/") && !/\\|[\u0000-\u001f]/.test(name) &&
  name.split("/").every((part) => part !== ".." && part !== ".")

const inflate = async (data: Uint8Array): Promise<Uint8Array> => {
  if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot open compressed archives.")
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Read a ZIP archive's files (directories skipped). Throws on anything unsafe or oversized. */
export const readZip = async (buffer: ArrayBuffer): Promise<ZipEntry[]> => {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error("This is not a ZIP file.")
  const count = view.getUint16(eocd + 10, true)
  if (count > ZIP_LIMITS.entries) throw new Error("This archive has too many files.")
  let p = view.getUint32(eocd + 16, true)
  const dec = new TextDecoder()
  const out: ZipEntry[] = []
  let total = 0
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) throw new Error("The archive is damaged.")
    const method = view.getUint16(p + 10, true)
    const compressed = view.getUint32(p + 20, true)
    const size = view.getUint32(p + 24, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const localAt = view.getUint32(p + 42, true)
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen
    if (name.endsWith("/")) continue
    if (!safeEntryName(name)) throw new Error("The archive contains an unsafe file name.")
    if (size > ZIP_LIMITS.entryBytes || compressed > ZIP_LIMITS.entryBytes) throw new Error(`${name} is too large.`)
    total += size
    if (total > ZIP_LIMITS.totalBytes) throw new Error("The archive is too large.")
    if (localAt + 30 > bytes.length || view.getUint32(localAt, true) !== 0x04034b50) throw new Error("The archive is damaged.")
    const start = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true)
    const raw = bytes.subarray(start, start + compressed)
    let data: Uint8Array
    if (method === 0) data = raw.slice()
    else if (method === 8) data = await inflate(raw)
    else throw new Error("The archive uses an unsupported compression method.")
    if (data.length !== size) throw new Error(`${name} is damaged.`)
    out.push({ name, data })
  }
  return out
}
