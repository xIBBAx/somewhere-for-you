/**
 * What the in-game Personalize screen saves, and where. Nothing here ever
 * leaves the browser: there is no upload, no account and no server.
 *
 *  - The text (names, letter, memories, settings) is one small JSON value in
 *    localStorage, so the letter can be filled in before the game has loaded.
 *  - Photos, music and character models are Blobs in an IndexedDB database.
 *
 * clearPersonalData() removes both. Browsers may also clear them when site
 * data is cleared; a "private" window forgets them when it closes.
 */

export const PERSONAL_KEY = "gift-world/personal/v1"
const DB_NAME = "gift-world-personal"
const DB_VERSION = 1
const STORE = "media"

export type MediaKind = "image" | "audio" | "model"

export type MediaRecord = {
  /** "local:<id>" refers to this */
  id: string
  kind: MediaKind
  type: string
  /** a short label for the Personalize screen (never used as HTML) */
  label: string
  bytes: Blob
  thumb?: Blob
  w?: number
  h?: number
  added: number
}

export const readPersonalText = (): unknown => {
  try {
    const raw = window.localStorage.getItem(PERSONAL_KEY)
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}

export const writePersonalText = (value: unknown): boolean => {
  try {
    window.localStorage.setItem(PERSONAL_KEY, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

let dbPromise: Promise<IDBDatabase> | null = null

const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error("IndexedDB failed to open"))
    req.onblocked = () => reject(new Error("IndexedDB is blocked by another tab"))
  })
  dbPromise.catch(() => { dbPromise = null })
  return dbPromise
}

const tx = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = run(t.objectStore(STORE))
    t.oncomplete = () => resolve(req.result)
    t.onerror = () => reject(t.error ?? req.error ?? new Error("IndexedDB request failed"))
    t.onabort = () => reject(t.error ?? new Error("IndexedDB request aborted"))
  })
}

export const putMedia = (record: MediaRecord): Promise<IDBValidKey> => tx("readwrite", (s) => s.put(record))
export const getMedia = (id: string): Promise<MediaRecord | undefined> => tx("readonly", (s) => s.get(id) as IDBRequest<MediaRecord | undefined>)
export const deleteMedia = (id: string): Promise<undefined> => tx("readwrite", (s) => s.delete(id) as IDBRequest<undefined>)
export const listMedia = (): Promise<MediaRecord[]> => tx("readonly", (s) => s.getAll() as IDBRequest<MediaRecord[]>)

/** A new random id for a stored file ("local:<id>"). */
export const newMediaId = (): string => {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return `local:${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`
}

/** Remove every personalized text, photo, track and model from this browser. */
export const clearPersonalData = async (): Promise<void> => {
  try { window.localStorage.removeItem(PERSONAL_KEY) } catch { /* storage unavailable */ }
  const db = await dbPromise?.catch(() => null)
  db?.close()
  dbPromise = null
  if (typeof indexedDB === "undefined") return
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
}

/**
 * Start the journey over: forget progress (stars, journal, album, map marks,
 * animals' memories, saved place) but keep the personalization and settings
 * such as quality.
 */
export const clearProgress = (): void => {
  const keep = new Set([PERSONAL_KEY, "gift-world/quality", "gift-world.exploration-ui.v1"])
  try {
    const doomed: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k && (k.startsWith("gift-world/") || k.startsWith("gift-world.")) && !keep.has(k)) doomed.push(k)
    }
    for (const k of doomed) window.localStorage.removeItem(k)
    window.sessionStorage.removeItem("gift-world/in-world")
  } catch { /* storage unavailable */ }
}

/** Whether anything personal is stored in this browser. */
export const hasPersonalData = async (): Promise<boolean> => {
  if (readPersonalText() !== undefined) return true
  try { return (await listMedia()).length > 0 } catch { return false }
}
