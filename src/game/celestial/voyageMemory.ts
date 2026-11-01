/**
 * What the riders have done beyond the sky, kept across visits in its own
 * localStorage entry (like the world's discoveries): the lunar sites found,
 * how many times they have landed on the Moon, and how far the space cats'
 * journey home has got.
 *
 * Where the riders are is never saved: a reload always begins at home, so a
 * game closed on the Moon opens safely in the meadow, with everything found
 * up there remembered.
 *
 * The space cats' journey (spaceCats/) moves through five stages:
 *
 *   unseen → met → escorting → arrived → settled
 *
 * and a reload never leaves them anywhere they cannot be: a journey
 * interrupted on the way goes back to "met" (they wait at the L1 point where
 * they were found, a place fixed by the Earth and the Moon, not by any frame
 * the riders were in), and cats that had already reached Earth finish the
 * trip to Star Nook ("settled"). There is only ever one crew, in one stage.
 */

export type CatJourney = "unseen" | "met" | "escorting" | "arrived" | "settled"

export type VoyageMemory = {
  sites: string[]
  moonLandings: number
  cats: CatJourney
  /** planets studied up close (the hazard readout was seen) */
  studied: string[]
  /** Completed guided viewpoints, optional for backward-compatible saves. */
  observations?: string[]
  /** Wishing lights flown through, "world:index", and the constellations made whole (optional: older saves have none). */
  wishes?: string[]
  constellations?: string[]
}

const KEY = "gift-world/voyage"
export const CAT_STAGES: readonly CatJourney[] = ["unseen", "met", "escorting", "arrived", "settled"]
/** a wishing light's id: "world:index" (WonderWorlds, wonders/wishes.ts) */
const WISH_ID = /^[a-z]{2,12}:\d{1,2}$/

export const emptyVoyage = (): VoyageMemory => ({ sites: [], moonLandings: 0, cats: "unseen", studied: [] })

const ids = (v: unknown, max = 40): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length < 40))].slice(0, max) : []

/** Parse a stored record; anything malformed becomes an empty voyage. */
export const readVoyage = (raw: string | null): VoyageMemory => {
  if (!raw || raw.length > 20_000) return emptyVoyage()
  try {
    const d = JSON.parse(raw) as Record<string, unknown>
    if (!d || typeof d !== "object") return emptyVoyage()
    // "home" was the last stage's name before Star Nook
    const stored = d.cats === "home" ? "settled" : d.cats
    const cats = CAT_STAGES.includes(stored as CatJourney) ? (stored as CatJourney) : "unseen"
    return {
      sites: ids(d.sites),
      moonLandings: typeof d.moonLandings === "number" && Number.isFinite(d.moonLandings) ? Math.max(0, Math.min(1e6, Math.trunc(d.moonLandings))) : 0,
      // an escort interrupted by a reload resumes from where the cats were found;
      // cats already on Earth have finished their walk to Star Nook
      cats: cats === "escorting" ? "met" : cats === "arrived" ? "settled" : cats,
      studied: ids(d.studied),
      ...(Array.isArray(d.observations) ? { observations: ids(d.observations, 128) } : {}),
      ...(Array.isArray(d.wishes) ? { wishes: ids(d.wishes, 200).filter((w) => WISH_ID.test(w)) } : {}),
      ...(Array.isArray(d.constellations) ? { constellations: ids(d.constellations, 16).filter((w) => /^[a-z]{2,12}$/.test(w)) } : {}),
    }
  } catch {
    return emptyVoyage()
  }
}

export const voyage: VoyageMemory = (() => {
  try {
    return readVoyage(localStorage.getItem(KEY))
  } catch {
    return emptyVoyage()
  }
})()

export const saveVoyage = (): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(voyage))
  } catch {
    // storage unavailable: the voyage still plays, it just isn't remembered
  }
}

/** Remember a lunar site; true the first time. */
export const rememberSite = (id: string): boolean => {
  if (voyage.sites.includes(id)) return false
  voyage.sites.push(id)
  saveVoyage()
  return true
}

/** Remember a world studied up close; true the first time. */
export const rememberStudied = (id: string): boolean => {
  if (voyage.studied.includes(id)) return false
  voyage.studied.push(id)
  saveVoyage()
  return true
}

/** Count a touchdown on the Moon. */
export const rememberMoonLanding = (): void => {
  voyage.moonLandings = Math.min(1e6, voyage.moonLandings + 1)
  saveVoyage()
}

/** Move the cats' journey on (never backwards, except an escort given up). Returns whether it moved. */
export const advanceCats = (to: CatJourney): boolean => {
  // the one step back: an escort given up, the cats waiting where they were found
  const abandon = to === "met" && voyage.cats === "escorting"
  if (CAT_STAGES.indexOf(to) <= CAT_STAGES.indexOf(voyage.cats) && !abandon) return false
  voyage.cats = to
  saveVoyage()
  return true
}

export const resetVoyage = (): void => {
  Object.assign(voyage, emptyVoyage())
  delete voyage.observations
  delete voyage.wishes
  delete voyage.constellations
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
