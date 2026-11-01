import { create } from "zustand"

/** Low-frequency UI state for the sky beyond the air (celestial/CelestialController). */
export type SkyReadout = {
  /** riding Starborn above the clouds (the sky panel shows) */
  high: boolean
  /** her wings are sails (space controls) */
  sailing: boolean
  nearest: string
  altitude: string
  speed: string
  target: string | null
  targetDistance: string | null
  eta: string | null
  autopilot: "target" | "home" | "site" | "cats" | "observation" | null
  notice: string | null
  /** the space cats close by: what to do (null when they are not) */
  cats: string | null
  /** they are close enough to gather (the button shows) */
  gather: boolean
}

/** A place on the Moon, found (lunarSites.ts): the card that opens beside it. */
export type SiteCard = { id: string; title: string; mission: string; date: string; lines: string[]; credit: string; historical: boolean }

/** A world's conditions as it draws near (celestial/hazards.ts). */
export type HazardCard = { id: string; name: string; summary: string; facts: string[]; level: "near" | "close" | "floor"; source: string }

type SkyState = SkyReadout & {
  chartOpen: boolean
  setChart: (open: boolean) => void
  setReadout: (r: SkyReadout) => void
  site: SiteCard | null
  setSite: (c: SiteCard | null) => void
  hazard: HazardCard | null
  setHazard: (c: HazardCard | null) => void
  /** on the Moon: a line naming the nearest site and where it lies */
  lunarHint: string | null
  setLunarHint: (h: string | null) => void
}

const EMPTY: SkyReadout = {
  high: false, sailing: false, nearest: "", altitude: "", speed: "", target: null, targetDistance: null, eta: null, autopilot: null, notice: null,
  cats: null, gather: false,
}

export const useSky = create<SkyState>((set, get) => ({
  ...EMPTY,
  chartOpen: false,
  setChart: (open) => { if (get().chartOpen !== open) set({ chartOpen: open }) },
  site: null,
  setSite: (c) => { if (get().site?.id !== c?.id) set({ site: c }) },
  hazard: null,
  setHazard: (c) => {
    const h = get().hazard
    if (h?.id !== c?.id || h?.level !== c?.level) set({ hazard: c })
  },
  lunarHint: null,
  setLunarHint: (h) => { if (get().lunarHint !== h) set({ lunarHint: h }) },
  setReadout: (r) => {
    const s = get()
    let same = true
    for (const k of Object.keys(r) as (keyof SkyReadout)[]) if (s[k] !== r[k]) { same = false; break }
    if (!same) set(r)
  },
}))

/** Requests from the UI to the scene (consumed by CelestialController). */
export const skyCommands = {
  target: null as string | null,
  /** a place on the Moon to sail to (lunarSites.ts) */
  site: null as string | null,
  travel: false,
  /** Explicit UI start buttons are idempotent; N/K remain toggles. */
  ensure: false,
  cancel: false,
  observation: null as { journey: string; stop: number } | null,
  home: false,
}

/** Ask the scene for a destination, travel there, or turn for home. */
export const sendSky = (cmd: { target?: string; travel?: boolean; home?: boolean; ensure?: boolean; site?: string; cancel?: boolean; observation?: { journey: string; stop: number } }): void => {
  if (cmd.ensure && (cmd.travel || cmd.home)) skyCommands.ensure = true
  if (cmd.target !== undefined) skyCommands.target = cmd.target
  if (cmd.site !== undefined) skyCommands.site = cmd.site
  if (cmd.travel) skyCommands.travel = true
  if (cmd.home) skyCommands.home = true
  if (cmd.cancel) skyCommands.cancel = true
  if (cmd.observation) skyCommands.observation = cmd.observation
}
