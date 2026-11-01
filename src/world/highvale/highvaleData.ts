import { COARSE_N, CORE_N, LOOK_N } from "./highvaleLayout"

/**
 * The baked Highvale maps (baked offline), fetched lazily by
 * whichever thread first needs them: the main thread for collision and
 * placement, each terrain worker for its chunks. ~4 MB on the wire, so it
 * is never part of the first load: the game asks for it in the background
 * once it is running, and anything that must stand on Highvale's ground
 * (a chunk there, a fast-travel arrival) waits for `highvaleReady()`.
 *
 * Each file is gzip(rows of little-endian deltas), wrapped as uint16
 * (heights) or plain bytes (look: forest density, gully wetness).
 */
export type HighvaleMaps = {
  coarse: Uint16Array
  core: Uint16Array
  /** LOOK_N² × 2: forest density, wetness */
  look: Uint8Array
}

export const highvaleMaps: { data: HighvaleMaps | null; failed: boolean } = { data: null, failed: false }

let pending: Promise<HighvaleMaps | null> | null = null

const gunzip = async (buffer: ArrayBuffer): Promise<ArrayBuffer> => {
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"))
  return new Response(stream).arrayBuffer()
}

const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  const raw = await res.arrayBuffer()
  const head = new Uint8Array(raw, 0, 2)
  // a server may already have undone the gzip in transit
  return head[0] === 0x1f && head[1] === 0x8b ? gunzip(raw) : raw
}

/** Undo the per-row delta coding in place. */
const undelta16 = (v: Uint16Array, n: number): Uint16Array => {
  for (let r = 0; r < n; r++) {
    let acc = 0
    const o = r * n
    for (let c = 0; c < n; c++) {
      acc = (acc + v[o + c]) & 0xffff
      v[o + c] = acc
    }
  }
  return v
}

const base = (): string => {
  const scope = globalThis as { location?: { origin?: string } }
  return `${scope.location?.origin ?? ""}/assets/highvale/`
}

/** Start (or join) the download; resolves to null if Highvale cannot load. */
export const loadHighvaleMaps = (): Promise<HighvaleMaps | null> => {
  if (pending) return pending
  pending = (async () => {
    try {
      const root = base()
      const [coarseB, coreB, lookB] = await Promise.all([
        fetchBytes(`${root}coarse.dat`), fetchBytes(`${root}core.dat`), fetchBytes(`${root}look.dat`),
      ])
      const coarse = undelta16(new Uint16Array(coarseB), COARSE_N)
      const core = undelta16(new Uint16Array(coreB), CORE_N)
      const look = new Uint8Array(lookB)
      if (coarse.length !== COARSE_N * COARSE_N || core.length !== CORE_N * CORE_N || look.length !== LOOK_N * LOOK_N * 2) {
        throw new Error("unexpected map size")
      }
      highvaleMaps.data = { coarse, core, look }
      return highvaleMaps.data
    } catch (error) {
      highvaleMaps.failed = true
      console.warn("[highvale] the valley's maps failed to load; the land there stays wild", error)
      return null
    }
  })()
  return pending
}

export const highvaleReady = (): boolean => highvaleMaps.data !== null
