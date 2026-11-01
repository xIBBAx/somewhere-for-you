import { names } from "../../../personalization"
import { CAT_BREEDS } from "../../../world/wildlife/catBreeds"
import type { CatBuild } from "../../../world/wildlife/animalAssets"

/**
 * The five space cats (named by personalization `creatures.spaceCats`; by
 * default Captain, Marmalade, Comet, Cloud and Orbit).
 *
 * Five cats in little suits and helmets, drifting together between the Moon
 * and Earth, trying to get home. Each is their own cat — a coat of a real
 * breed (never the cat's: hers is the last in `COATS.cat` and is not here), a
 * build, a suit with their own colour, and a temperament that shows in how
 * they float, follow and settle.
 *
 * They are the one deliberately whimsical thing in an otherwise real sky,
 * and they are never shown surviving vacuum unprotected: each wears a sealed
 * suit, booties, a pressure helmet and a little life-support pack.
 */

export type CrewId = "captain" | "marmalade" | "comet" | "cloud" | "orbit"

export type Temperament = {
  /** how much they fidget, turn and look about (0 calm … 1 restless) */
  fidget: number
  /** how often they somersault or tumble in the float */
  tumble: number
  /** how often they doze */
  doze: number
  /** how quickly they react and move */
  quick: number
}

export type CrewMember = {
  id: CrewId
  name: string
  /** the breed's coat name in `CAT_BREEDS` */
  breed: string
  build: CatBuild
  /** the suit's accent: stripes, cuffs, the helmet ring and their cushion at Star Nook */
  accent: string
  /** the mission patch's field colour */
  patch: string
  /** the gold sun visor lowered (0 up … 1 down) */
  visor: number
  temperament: Temperament
  /** formation slot round Starborn, in her own axes: right, up, ahead (metres; negative is behind) */
  slot: readonly [number, number, number]
  /** a line about them on the way home, in their suits */
  space: string
  /** what they're like at home, said when you say hello at Star Nook */
  lines: string[]
}

export const CREW: readonly CrewMember[] = [
  {
    id: "captain", name: names.spaceCat(0), breed: "tuxedo",
    build: { size: 1.08, head: 1.02 },
    // the commander's red stripes, as Apollo commanders wore from Apollo 13 on
    accent: "#c8322b", patch: "#24345f", visor: 0.55,
    temperament: { fidget: 0.15, tumble: 0, doze: 0.05, quick: 0.6 },
    slot: [2.3, 1.0, 1.3],
    space: `${names.spaceCat(0)} keeps the crew together. Steady paws, very serious whiskers.`,
    lines: [
      `${names.spaceCat(0)} watches the meadow from the deck's edge, as if keeping a log.`,
      `${names.spaceCat(0)} gives you a slow blink. Mission accomplished.`,
      `${names.spaceCat(0)} counts the crew. All five present.`,
    ],
  },
  {
    id: "marmalade", name: names.spaceCat(1), breed: "ginger tabby",
    build: { size: 1.12, head: 1.04 },
    accent: "#e2832e", patch: "#6b3a1c", visor: 0,
    temperament: { fidget: 0.3, tumble: 0.1, doze: 0.35, quick: 0.35 },
    slot: [-2.4, 0.7, 0.5],
    space: `${names.spaceCat(1)} kneads the empty air — making biscuits, even in a spacesuit.`,
    lines: [
      `${names.spaceCat(1)} has found the food bowl. ${names.spaceCat(1)} approves of Earth.`,
      `${names.spaceCat(1)} is making biscuits on the orange cushion. Real ones would be better.`,
      `${names.spaceCat(1)} purrs like a little engine.`,
    ],
  },
  {
    id: "comet", name: names.spaceCat(2), breed: "Siamese",
    build: { size: 0.92, head: 0.95, ears: 1.04 },
    accent: "#2fb3c9", patch: "#163a4a", visor: 0.15,
    temperament: { fidget: 0.9, tumble: 0.2, doze: 0.05, quick: 1 },
    slot: [3.6, 0.35, -0.7],
    space: `${names.spaceCat(2)}'s antenna blinks twice as fast as anyone's. ${names.spaceCat(2)} is very curious about everything.`,
    lines: [
      `${names.spaceCat(2)} sits by the telescope, watching the Moon they came from.`,
      `${names.spaceCat(2)} chirps at you and tilts their head: what's that? and that?`,
      `${names.spaceCat(2)} has opinions about the telescope's focus.`,
    ],
  },
  {
    id: "cloud", name: names.spaceCat(3), breed: "Persian",
    build: { size: 1.0, head: 1.05 },
    accent: "#e79bb4", patch: "#5a3047", visor: 0,
    temperament: { fidget: 0.08, tumble: 0.05, doze: 1, quick: 0.2 },
    slot: [0.1, 3.55, -1.1],
    space: `${names.spaceCat(3)} is fast asleep, curled up and turning slowly in the dark.`,
    lines: [
      `${names.spaceCat(3)} has claimed the softest cushion and is not getting up.`,
      `${names.spaceCat(3)} opens one eye, mews, and goes back to sleep.`,
      `${names.spaceCat(3)} was asleep for the whole journey home and does not remember space at all.`,
    ],
  },
  {
    id: "orbit", name: names.spaceCat(4), breed: "Bengal",
    build: { size: 1.02 },
    accent: "#f2b630", patch: "#7a2b12", visor: 0.25,
    temperament: { fidget: 0.7, tumble: 1, doze: 0.05, quick: 0.9 },
    slot: [-3.5, 0.95, -0.9],
    space: `${names.spaceCat(4)} turns somersaults just because space lets her.`,
    lines: [
      `${names.spaceCat(4)} is stalking something in the grass. ${names.spaceCat(4)} is losing.`,
      `${names.spaceCat(4)} misses somersaults. Gravity is very strict.`,
      `${names.spaceCat(4)} trills and bats at the star on the cat tower.`,
    ],
  },
]

export const CREW_BY_ID: ReadonlyMap<CrewId, CrewMember> = new Map(CREW.map((c) => [c.id, c]))

/** The coat index of a crew member's breed (`COATS.cat` begins with `CAT_BREEDS`). */
export const crewCoatIndex = (c: CrewMember): number => {
  const i = CAT_BREEDS.findIndex((b) => b.name === c.breed)
  if (i < 0) throw new Error(`[space cats] unknown breed ${c.breed}`)
  return i
}

/** "Marmalade, Comet, Cloud, Orbit and Captain" */
export const crewNames = (): string => {
  const n = [1, 2, 3, 4, 0].map((i) => names.spaceCat(i))
  return `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`
}
