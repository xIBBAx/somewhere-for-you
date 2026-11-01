import type { Records } from "../state/adventureStore"
import { names } from "../personalization"

/**
 * Pages of the journal — little goals all over the world. The companion:
 * titles, lines and hints are safe to edit. `done` reads the saved records.
 */
type Page = { title: string; line: string; hint: string; group: "Lakes" | "Night" | "Meadows" | "Together" | "Moments"; done: (r: Records) => boolean }

export const ACHIEVEMENTS = {
  firstSkip: { group: "Lakes", title: "First Skip", line: "Plink, plink… gone. The lake will remember that one.", hint: "At a lake shore, press E to skip a stone.", done: (r) => r.bestSkips >= 1 },
  stoneWhisperer: { group: "Lakes", title: "Stone Whisperer", line: "Six skips. The ducks are genuinely impressed.", hint: "Release the throw when the marker is in the bright middle.", done: (r) => r.bestSkips >= 6 },
  lakeLegend: { group: "Lakes", title: "Legend of the Lake", line: "Ten skips. Somewhere, a stone is telling this story to its grandchildren.", hint: "A perfect release skips ten times or more.", done: (r) => r.bestSkips >= 10 },
  firstLantern: { group: "Night", title: "An Akash Deep", line: "One small light, carrying one big wish.", hint: "At night, press E in an open spot to release a sky lantern.", done: (r) => r.lanterns >= 1 },
  skyOfWishes: { group: "Night", title: "A Sky Full of Wishes", line: "Ten lanterns drifting over the world.", hint: "Release ten lanterns, on any nights.", done: (r) => r.lanterns >= 10 },
  jarOfStars: { group: "Night", title: "A Jar of Stars", line: "Twelve fireflies, glowing in a jar, then free again.", hint: "At night, walk up to fireflies and press E to catch them.", done: (r) => r.bestJar >= 12 },
  stargazer: { group: "Night", title: "Stargazer", line: "Connect the dots and the sky tells you a story.", hint: "At night, sit on a bench or at the Star Stones and look up (E).", done: (r) => r.constellations.length >= 1 },
  skyMap: { group: "Night", title: "The Whole Sky Map", line: "Every constellation in the journal, found.", hint: "Find all five constellations.", done: (r) => r.constellations.length >= 5 },
  littleFlorist: { group: "Meadows", title: "Little Florist", line: "Ten flowers picked, each one carefully.", hint: "Walk up to meadow flowers and press E.", done: (r) => r.flowers >= 10 },
  bouquet: { group: "Meadows", title: "A Gajra for You", line: "Strung together and handed over with both hands.", hint: "Pick five flowers, then press E next to the other one of you.", done: (r) => r.bouquets >= 1 },
  fasterThanCat: { group: "Meadows", title: `Faster Than ${names.cat}`, line: `${names.cat} says she let you win. ${names.cat} is lying.`, hint: "Press R to race to the glowing marker.", done: (r) => r.raceWins >= 1 },
  champion: { group: "Meadows", title: "Little Champion", line: "Five races won. Undefeated legend of the meadow.", hint: "Win five races.", done: (r) => r.raceWins >= 5 },
  handInHand: { group: "Together", title: "Hand in Hand", line: "A hundred metres of not letting go.", hint: "Once you are together, hold hands (H) and walk together.", done: (r) => r.handInHand >= 100 },
  warmHug: { group: "Together", title: "A Warm Hug", line: "The best kind of hello.", hint: "Hug (G) when you are close together.", done: (r) => r.hugs >= 1 },
  perfectFive: { group: "Together", title: "Perfect High Five", line: "Loud, on time, and slightly too enthusiastic.", hint: "High five (F) when you are close together.", done: (r) => r.highFives >= 1 },
  firstDance: { group: "Together", title: "First Dance", line: "Twenty seconds of the slowest, sweetest waltz.", hint: "Dance (V) for at least twenty seconds.", done: (r) => r.danceSeconds >= 20 },
  photographer: { group: "Moments", title: "Photographer", line: "Some moments deserve to be kept.", hint: "Press P for the camera, then take a photo.", done: (r) => r.photos >= 1 },
  albumDay: { group: "Moments", title: "An Album Day", line: "Five pictures for the little album.", hint: "Take five photos.", done: (r) => r.photos >= 5 },
} satisfies Record<string, Page>

export type AchievementId = keyof typeof ACHIEVEMENTS

/** Shown when every page is complete. */
export const BOOK_COMPLETE = {
  title: "The journal is full",
  lines: [
    "Every page in the journal is filled in.",
    "The world keeps going, and so can you.",
  ],
}
