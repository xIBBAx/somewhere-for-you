import { makeIdentity, type BreedId } from "./breeds"
import { horseRT, makeHorseState } from "./horseState"
import { standable } from "./horseMotion"
import { groundHeight } from "../world-layout"
import type { CharacterId } from "../runtime"
import { inRealm } from "../../world/realmHook"
import { HUB_CENTER } from "../../world/hubLayout"
import { beyondReach, validRestoredSpot } from "../travel/safety"

/**
 * Horses survive a reload: where each persistent horse was left, which horse
 * is each character's own, and the wild horses that were ridden (adopted),
 * rebuilt from their seed so their coat and temperament are unchanged.
 * Characters always wake on foot; riding resumes with E or a whistle.
 *
 * A saved place is only trusted when it is a real, standable spot on Earth
 * within reach of home: anything else (a horse last seen on the Moon, in deep
 * space, or in a bad save) falls back to the horse's home spot. Riders are
 * never saved, so no horse comes back mounted in mid-air.
 */
const KEY = "gift-world/horses"
const VERSION = 1
const HOME = { x: HUB_CENTER.x, z: HUB_CENTER.z }

type Saved = {
  v: number
  bonded: Record<CharacterId, string>
  horses: Record<string, { x: number; z: number; heading: number; seed: number; breed: BreedId; saddled: boolean; trust: number; adopted: boolean }>
  /** kept for older saves; Starborn is always met now */
  starbornMet?: boolean
}

/** A saved place is one a horse can stand on at home (not on another world, not in the sky). */
const standsOnEarth = (x: number, z: number): boolean => !inRealm(x, z) && standable(x, z, 0.8)

export const loadHorses = (): void => {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw || raw.length > 200_000) return
    const data = JSON.parse(raw) as Saved
    if (!data || data.v !== VERSION || typeof data.horses !== "object") return
    for (const [id, s] of Object.entries(data.horses)) {
      if (![s.x, s.z].every(Number.isFinite)) continue
      let h = horseRT.horses.get(id)
      const saved = { x: s.x, z: s.z }
      // a horse that exists keeps its home spot as the fallback; an adopted one has none
      const at = h
        ? validRestoredSpot(saved, { x: h.homeX, z: h.homeZ }, standsOnEarth, HOME)
        : !beyondReach(s.x, s.z, HOME) && standsOnEarth(s.x, s.z) ? saved : null
      if (!at || !Number.isFinite(s.heading)) continue
      const ground = groundHeight(at.x, at.z)
      if (!Number.isFinite(ground)) continue
      if (!h && s.adopted) {
        const ident = makeIdentity(s.seed, s.breed)
        ident.id = id
        ident.saddled = s.saddled
        h = makeHorseState(ident, at.x, at.z, true)
        horseRT.horses.set(id, h)
      }
      if (!h) continue
      h.x = at.x
      h.z = at.z
      h.y = ground
      h.heading = s.heading
      // Keep the original stable home: a saved stop is not a new home, and
      // must not become the fallback for a later off-world flight.
      h.trust = Math.max(h.trust, Number.isFinite(s.trust) ? s.trust : 0)
    }
    for (const c of ["explorer", "companion"] as const) if (typeof data.bonded?.[c] === "string" && horseRT.horses.has(data.bonded[c])) horseRT.bonded[c] = data.bonded[c]
  } catch {
    // a broken save never stops the horses appearing
  }
}

export const saveHorses = (): void => {
  try {
    const horses: Saved["horses"] = {}
    for (const h of horseRT.horses.values()) {
      if (!h.persistent) continue
      // a reload always wakes at home: a Pegasus left on the Moon, or out
      // under her sails, is remembered at her own place at home instead
      const away = inRealm(h.x, h.z) || h.flight?.mode === "sail"
      const x = away ? h.homeX : h.x, z = away ? h.homeZ : h.z
      horses[h.ident.id] = {
        x: +x.toFixed(2), z: +z.toFixed(2), heading: +h.heading.toFixed(3), seed: h.ident.seed, breed: h.ident.breed,
        saddled: h.ident.saddled, trust: +h.trust.toFixed(2), adopted: h.ident.id.startsWith("wild:"),
      }
    }
    const data: Saved = { v: VERSION, bonded: { ...horseRT.bonded }, horses }
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // storage may be unavailable (private mode): horses simply start fresh
  }
}
