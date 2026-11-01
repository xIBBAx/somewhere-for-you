import * as THREE from "three"
import { ALL_SITES, siteDirection } from "./lunarSites"
import { CALM_BY_BODY } from "./realmState"

/**
 * How the hardware lies at each site, life-size, in metres east and north
 * of the site's anchor (the Lunar Module, or Vikram). Hardware positions are
 * the Lunar Reconnaissance Orbiter Camera's measured offsets from the LM
 * (LROC 2016 coordinates of human features, Wagner et al. 2017) where those
 * exist; footpaths follow the walks recorded in the Apollo Lunar Surface
 * Journal in outline. Only the sites' own places on the Moon are on the explorer's
 * shrunken scale; everything people built or walked is its real size.
 */

export type HardwareKind = "lm" | "flag" | "lrrr" | "psep" | "alsep" | "lrv" | "vikram" | "pragyan" | "debris"

export type LayoutItem = {
  kind: HardwareKind
  e: number
  n: number
  /** turn about the vertical (rad, from the item's own +x toward north…) */
  yaw?: number
  /** flags: standing, or knocked flat */
  standing?: boolean
  /** flags: lean of the pole (rad) */
  lean?: number
  /** the LM: the plaque on its ladder strut */
  plaque?: boolean
  /** collision radius (m), 0 for none */
  r?: number
}

export type SiteLayout = {
  items: LayoutItem[]
  /** footpaths: polylines of [e, n] points */
  walks?: Array<Array<[number, number]>>
  /** wheel tracks (rovers): polylines */
  tracks?: Array<Array<[number, number]>>
  /** ground marks: bright blast zones under landers, dark trampled ground, impact scars */
  patches?: Array<{ e: number; n: number; r: number; tone: "bright" | "dark" }>
}

/** A point `d` metres away on a compass bearing (degrees clockwise from north). */
const at = (bearing: number, d: number): [number, number] => {
  const b = THREE.MathUtils.degToRad(bearing)
  return [Math.sin(b) * d, Math.cos(b) * d]
}
const item = (kind: HardwareKind, p: [number, number], extra: Partial<LayoutItem> = {}): LayoutItem => ({ kind, e: p[0], n: p[1], ...extra })

/** The descent stage's ladder faced west at the Apollo sites (the LMs came down heading west, into the morning Sun). */
const WEST = Math.PI
const LM: Partial<LayoutItem> = { yaw: WEST, r: 3.2 }

export const LAYOUTS: Record<string, SiteLayout> = {
  apollo11: {
    items: [
      item("lm", [0, 0], { ...LM, plaque: true }),
      // the flag, ~8 m from Eagle between the equipment bay and the TV camera, blown flat at lift-off
      item("flag", at(300, 8.2), { standing: false, yaw: 0.6 }),
      item("lrrr", at(186, 21.6), { r: 0.4 }),
      item("psep", at(188, 25), { r: 0.6 }),
    ],
    walks: [
      [[-2.5, 0], at(250, 5), at(300, 8.2)],
      [[-2.5, -0.5], at(200, 10), at(186, 21.6), at(188, 25)],
      // Armstrong's late walk east to the rim of Little West crater
      [[1, 2], at(80, 20), at(88, 40), at(90, 58)],
      [[-2, 1], at(330, 6), at(20, 9), at(80, 5)],
    ],
    patches: [
      { e: 0, n: 0, r: 16, tone: "bright" },
      { e: 0, n: 0, r: 6, tone: "dark" },
      { e: at(188, 25)[0], n: at(188, 25)[1], r: 3.5, tone: "dark" },
    ],
  },
  apollo12: {
    items: [
      item("lm", [0, 0], LM),
      item("flag", at(250, 9), { standing: true, yaw: 0.3 }),
      item("alsep", at(315, 129), { r: 0.6 }),
    ],
    walks: [[[-2.5, 0], at(250, 9)], [[-2.5, 0.5], at(300, 40), at(310, 90), at(315, 129)]],
    patches: [{ e: 0, n: 0, r: 15, tone: "bright" }, { e: 0, n: 0, r: 6, tone: "dark" }],
  },
  apollo14: {
    items: [
      item("lm", [0, 0], LM),
      item("lrrr", at(285, 210), { r: 0.4 }),
      item("alsep", at(287, 181), { r: 0.6 }),
    ],
    walks: [[[-2.5, 0], at(280, 60), at(287, 181), at(285, 210)]],
    tracks: [[[-3, -1], at(270, 50), at(285, 120), at(287, 175)]],
    patches: [{ e: 0, n: 0, r: 15, tone: "bright" }, { e: 0, n: 0, r: 6, tone: "dark" }],
  },
  apollo15: {
    items: [
      item("lm", [0, 0], LM),
      item("lrv", at(90, 90), { yaw: 0.3, r: 1.6 }),
      item("lrrr", at(283, 134), { r: 0.4 }),
      item("alsep", at(299, 105), { r: 0.6 }),
    ],
    walks: [[[-2.5, 0], at(295, 60), at(299, 105), at(283, 134)], [[2, 0], at(90, 88)]],
    tracks: [[at(90, 90), at(70, 60), at(40, 30), at(330, 25), at(290, 70), at(299, 100)]],
    patches: [{ e: 0, n: 0, r: 15, tone: "bright" }, { e: 0, n: 0, r: 6, tone: "dark" }],
  },
  apollo16: {
    items: [
      item("lm", [0, 0], LM),
      // the pole leans about 30° in the shadow LRO photographed
      item("flag", at(315, 10), { standing: true, lean: 0.5, yaw: 0.2 }),
      item("lrv", at(90, 85), { yaw: -0.2, r: 1.6 }),
      item("alsep", at(225, 107), { r: 0.6 }),
    ],
    walks: [[[-2.5, 0], at(315, 10)], [[-2, -1], at(230, 50), at(225, 107)], [[2, 0], at(90, 83)]],
    tracks: [[at(90, 85), at(120, 50), at(180, 25), at(220, 60), at(225, 100)]],
    patches: [{ e: 0, n: 0, r: 15, tone: "bright" }, { e: 0, n: 0, r: 6, tone: "dark" }],
  },
  apollo17: {
    items: [
      item("lm", [0, 0], LM),
      item("flag", at(330, 11), { standing: true, yaw: -0.4 }),
      item("lrv", at(85, 128), { yaw: 0.5, r: 1.6 }),
      item("alsep", at(281, 197), { r: 0.6 }),
    ],
    walks: [[[-2.5, 0], at(330, 11)], [[-2.5, -0.5], at(275, 80), at(281, 197)], [[2, 0], at(85, 126)]],
    tracks: [[at(85, 128), at(60, 80), at(20, 40), at(300, 40), at(281, 150)]],
    patches: [{ e: 0, n: 0, r: 15, tone: "bright" }, { e: 0, n: 0, r: 6, tone: "dark" }],
  },
  chandrayaan3: {
    items: [
      item("vikram", [0, 0], { r: 1.4 }),
      item("pragyan", at(205, 19), { yaw: 0.8, r: 0.6 }),
    ],
    // Pragyan's ~101 m wander, outlined: down the ramp, round a crater it was turned back from, and on
    tracks: [[[0, -2.6], [0, -6], [2.5, -9], [6, -10], [8, -14], [5, -18], [0, -20], [-4, -17], [-8, -15], at(205, 19)]],
    patches: [{ e: 0, n: 0, r: 9, tone: "bright" }],
  },
  chandrayaan2: {
    items: [item("debris", [0, 0])],
    patches: [{ e: 0, n: 0, r: 22, tone: "dark" }, { e: 0, n: 0, r: 40, tone: "bright" }],
  },
  mip: {
    items: [],
    patches: [{ e: 0, n: 0, r: 5, tone: "dark" }, { e: 0, n: 0, r: 11, tone: "bright" }],
  },
}

/** How far a site's hardware and paths reach from its anchor (m). */
export const siteReach = (id: string): number => {
  const l = LAYOUTS[id]
  if (!l) return 20
  let r = 12
  for (const it of l.items) r = Math.max(r, Math.hypot(it.e, it.n) + 6)
  for (const line of [...(l.walks ?? []), ...(l.tracks ?? [])]) for (const [e, n] of line) r = Math.max(r, Math.hypot(e, n) + 4)
  for (const p of l.patches ?? []) r = Math.max(r, Math.hypot(p.e, p.n) + p.r)
  return r
}

// the sites' ground is kept clear of the procedural craters (both on the CPU and the GPU)
CALM_BY_BODY.moon = ALL_SITES.map((s) => ({ dir: siteDirection(s, new THREE.Vector3()), r: siteReach(s.id) + 15 }))
