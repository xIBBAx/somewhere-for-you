import { MEMORIES } from "../content/memories"
import { SITES } from "../world/sites/siteLayout"
import { STAR_NOOK } from "../world/starNookLayout"
import { create } from "zustand"
import { BODY } from "../game/celestial/bodies"
import { SITE_BY_ID } from "../game/celestial/realm/lunarSites"
import { HIGHVALE_ARRIVAL } from "../world/highvale/highvaleLayout"
import { BENCH_WORLD } from "../world/highvale/highvaleStructures"
import { BENCH_ID, BENCH_NAME, HIGHVALE_NAME } from "../world/highvale/highvaleNames"

export type Destination = { kind: "earth"; id: string; name: string; x: number; z: number }
  | { kind: "body" | "site"; id: string; name: string }
  | { kind: "cats"; id: "space-cats"; name: string }
export const HOME: Destination & { kind: "earth" } = { kind: "earth", id: "home", name: "Home meadow", x: 0, z: 22.5 }
const KEY = "gift-world/navigation"
export const readDestination = (raw: string | null): Destination | null => {
  if (!raw || raw.length > 1200) return null
  try {
    const d = JSON.parse(raw) as Record<string, unknown>
    if (typeof d.id !== "string" || typeof d.name !== "string" || !d.name.length || d.name.length > 100 || d.id.length > 100) return null
    if (d.kind === "earth" && typeof d.x === "number" && typeof d.z === "number" && Number.isFinite(d.x) && Number.isFinite(d.z) && Math.abs(d.x) < 1e8 && Math.abs(d.z) < 1e8) {
      if (d.id === "home") return HOME
      const memory = MEMORIES.find(m => m.id === d.id)
      if (memory) return { kind: "earth", id: memory.id, name: memory.title, x: memory.worldPosition[0], z: memory.worldPosition[2] }
      const site = SITES.find(site => site.id === d.id)
      if (site) return { kind: "earth", id: site.id, name: site.id, x: site.x, z: site.z }
      if (d.id === "star-nook") return { kind: "earth", id: "star-nook", name: "Star Nook", ...STAR_NOOK }
      // Highvale's places are where the layout puts them now, not where a save remembers them
      if (d.id === "highvale") return { kind: "earth", id: "highvale", name: HIGHVALE_NAME, ...HIGHVALE_ARRIVAL }
      if (d.id === BENCH_ID) return { kind: "earth", id: BENCH_ID, name: BENCH_NAME, ...BENCH_WORLD }
      return { kind: "earth", id: d.id, name: d.name, x: d.x, z: d.z }
    }
    if (d.kind === "body" && Object.hasOwn(BODY, d.id)) return { kind: "body", id: d.id, name: BODY[d.id].name }
    if (d.kind === "site" && SITE_BY_ID.has(d.id)) return { kind: "site", id: d.id, name: SITE_BY_ID.get(d.id)!.title }
    if (d.kind === "cats" && d.id === "space-cats") return { kind: "cats", id: "space-cats", name: "The space cats" }
  } catch { /* Storage can be malformed or disabled. */ }
  return null
}
const load = (): Destination | null => { try { return readDestination(localStorage.getItem(KEY)) } catch { return null } }

/**
 * Marks: spots the explorer chooses herself on the World map, anywhere on Earth, named
 * or not. The newest few are kept (and saved) so she can come back to one;
 * the one she is heading for is the destination. Ids are "mark:<n>".
 */
export type Mark = Destination & { kind: "earth" }
export const MARK_LIMIT = 8
const MARKS_KEY = "gift-world/marks"
export const isMark = (d: { kind: string; id: string } | null | undefined): boolean => !!d && d.kind === "earth" && (d.id.startsWith("mark:") || d.id === "pin")
export const readMarks = (raw: string | null): Mark[] => {
  if (!raw || raw.length > 4000) return []
  try {
    const list = JSON.parse(raw) as unknown
    if (!Array.isArray(list)) return []
    const out: Mark[] = []
    for (const item of list.slice(0, MARK_LIMIT)) {
      const d = readDestination(JSON.stringify(item))
      if (d?.kind === "earth" && d.id.startsWith("mark:") && !out.some(m => m.id === d.id)) out.push(d)
    }
    return out
  } catch { return [] }
}
const loadMarks = (): Mark[] => {
  let marks: Mark[] = []
  try { marks = readMarks(localStorage.getItem(MARKS_KEY)) } catch { /* none */ }
  return marks
}
const saveMarks = (marks: Mark[]): void => { try { localStorage.setItem(MARKS_KEY, JSON.stringify(marks)) } catch { /* Session marks remain available. */ } }
const nextMarkId = (marks: Mark[]): string => `mark:${Math.max(0, ...marks.map(m => Number(m.id.slice(5)) || 0)) + 1}`
/** Keep the newest marks; the one being followed is never the one dropped. */
export const withMark = (marks: Mark[], mark: Mark, keep?: string): Mark[] => {
  const list = [mark, ...marks.filter(m => m.id !== mark.id)]
  while (list.length > MARK_LIMIT) {
    let drop = list.length - 1
    while (drop > 0 && (list[drop].id === keep || list[drop].id === mark.id)) drop--
    list.splice(drop, 1)
  }
  return list
}

type NavigationStore = {
  destination: Destination | null
  marks: Mark[]
  choose: (destination: Destination | null) => void
  /** Leave a mark at (x, z) and head for it. */
  mark: (x: number, z: number, name: string) => Mark
  /** Remove a mark (and stop heading for it). */
  forget: (id: string) => void
}
const persist = (destination: Destination | null): void => {
  try { if (destination) localStorage.setItem(KEY, JSON.stringify(destination)); else localStorage.removeItem(KEY) } catch { /* Session navigation remains available. */ }
}
export const useNavigation = create<NavigationStore>((set, get) => {
  let destination = load(), marks = loadMarks()
  // a pin from before marks existed becomes the first mark
  if (destination?.kind === "earth" && destination.id === "pin") {
    const mark: Mark = { ...destination, id: nextMarkId(marks), name: destination.name === "Marked place" || destination.name === "Our marked place" ? "Marked spot" : destination.name }
    marks = withMark(marks, mark); destination = mark
    saveMarks(marks); persist(destination)
  }
  return {
    destination,
    marks,
    choose: selected => {
      const destination = selected ? readDestination(JSON.stringify(selected)) : null
      set({ destination })
      persist(destination)
    },
    mark: (x, z, name) => {
      const marks = get().marks
      const mark: Mark = { kind: "earth", id: nextMarkId(marks), name: name.slice(0, 100) || "Marked spot", x, z }
      const next = withMark(marks, mark, get().destination?.id)
      set({ marks: next, destination: mark })
      saveMarks(next); persist(mark)
      return mark
    },
    forget: id => {
      const next = get().marks.filter(m => m.id !== id)
      const following = get().destination?.id === id
      set(following ? { marks: next, destination: null } : { marks: next })
      saveMarks(next)
      if (following) persist(null)
    },
  }
})
