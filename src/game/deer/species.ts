import { rng } from "../../world/noise"
import { RUN_SPEED } from "../characters/human/humanLocomotion"

/** Ecology and playable limits are deliberately separate from the art rig.
 * These speeds are fantasy riding balance, not claims about wild top speeds. */
export const SPECIES_IDS = [
  "chital",
  "sambar",
  "barasingha",
  "muntjac",
  "hog",
  "red",
  "fallow",
  "sika",
  "roe",
  "whitetail",
  "mule",
  "elk",
  "moose",
  "reindeer",
  "yak",
] as const
export type DeerSpecies = (typeof SPECIES_IDS)[number]
export type Sex = "female" | "male"
export type Age = "adult" | "fawn"
export type Habitat = "warmEdge" | "warmForest" | "marsh" | "temperate" | "boreal" | "tundra" | "alpine"
export type SpeciesProfile = {
  name: string
  scientific: string
  family: "Cervidae" | "Bovidae"
  habitat: Habitat
  height: number
  group: readonly [number, number]
  separation: number
  range: number
  shy: number
  social: number
  browser: number
  hidesYoung: boolean
  rideable: boolean
  speed: number
  agility: number
  coat: string
  winter: string
  spots: boolean
  antlers: "three" | "many" | "palm" | "short" | "fork" | "beam" | "moose" | "reindeer" | "horns"
}
export const SPECIES: Record<DeerSpecies, SpeciesProfile> = {
  chital: {
    name: "Chital",
    scientific: "Axis axis",
    family: "Cervidae",
    habitat: "warmEdge",
    height: 0.96,
    group: [4, 8],
    separation: 3.5,
    range: 42,
    shy: 0.5,
    social: 0.9,
    browser: 0.2,
    hidesYoung: true,
    rideable: false,
    speed: 1.03,
    agility: 1.15,
    coat: "#985c32",
    winter: "#91613e",
    spots: true,
    antlers: "three",
  },
  sambar: {
    name: "Sambar",
    scientific: "Rusa unicolor",
    family: "Cervidae",
    habitat: "warmForest",
    height: 1.48,
    group: [1, 3],
    separation: 7,
    range: 35,
    shy: 0.72,
    social: 0.25,
    browser: 0.75,
    hidesYoung: true,
    rideable: true,
    speed: 0.95,
    agility: 0.92,
    coat: "#73604e",
    winter: "#49413a",
    spots: false,
    antlers: "three",
  },
  barasingha: {
    name: "Barasingha",
    scientific: "Rucervus duvaucelii",
    family: "Cervidae",
    habitat: "marsh",
    height: 1.25,
    group: [4, 7],
    separation: 4,
    range: 45,
    shy: 0.55,
    social: 0.85,
    browser: 0.15,
    hidesYoung: true,
    rideable: true,
    speed: 0.93,
    agility: 0.95,
    coat: "#9c7547",
    winter: "#786247",
    spots: false,
    antlers: "many",
  },
  muntjac: {
    name: "Indian muntjac",
    scientific: "Muntiacus muntjak",
    family: "Cervidae",
    habitat: "warmForest",
    height: 0.55,
    group: [1, 2],
    separation: 10,
    range: 24,
    shy: 0.8,
    social: 0.1,
    browser: 0.8,
    hidesYoung: true,
    rideable: false,
    speed: 0.75,
    agility: 1.25,
    coat: "#99512a",
    winter: "#875630",
    spots: false,
    antlers: "short",
  },
  hog: {
    name: "Hog deer",
    scientific: "Axis porcinus",
    family: "Cervidae",
    habitat: "marsh",
    height: 0.67,
    group: [1, 3],
    separation: 7,
    range: 28,
    shy: 0.8,
    social: 0.2,
    browser: 0.2,
    hidesYoung: true,
    rideable: false,
    speed: 0.84,
    agility: 1.1,
    coat: "#846245",
    winter: "#71583f",
    spots: false,
    antlers: "three",
  },
  red: {
    name: "Red deer",
    scientific: "Cervus elaphus",
    family: "Cervidae",
    habitat: "temperate",
    height: 1.35,
    group: [3, 6],
    separation: 5,
    range: 50,
    shy: 0.5,
    social: 0.7,
    browser: 0.4,
    hidesYoung: true,
    rideable: true,
    speed: 1.03,
    agility: 1,
    coat: "#885438",
    winter: "#716154",
    spots: false,
    antlers: "many",
  },
  fallow: {
    name: "Fallow deer",
    scientific: "Dama dama",
    family: "Cervidae",
    habitat: "temperate",
    height: 0.98,
    group: [3, 6],
    separation: 4,
    range: 38,
    shy: 0.45,
    social: 0.75,
    browser: 0.25,
    hidesYoung: true,
    rideable: false,
    speed: 0.96,
    agility: 1.15,
    coat: "#a87a4f",
    winter: "#766758",
    spots: true,
    antlers: "palm",
  },
  sika: {
    name: "Sika deer",
    scientific: "Cervus nippon",
    family: "Cervidae",
    habitat: "temperate",
    height: 0.95,
    group: [2, 4],
    separation: 5,
    range: 36,
    shy: 0.6,
    social: 0.5,
    browser: 0.45,
    hidesYoung: true,
    rideable: false,
    speed: 0.94,
    agility: 1.15,
    coat: "#795038",
    winter: "#493f38",
    spots: true,
    antlers: "beam",
  },
  roe: {
    name: "Roe deer",
    scientific: "Capreolus capreolus",
    family: "Cervidae",
    habitat: "temperate",
    height: 0.69,
    group: [1, 3],
    separation: 8,
    range: 30,
    shy: 0.85,
    social: 0.2,
    browser: 0.7,
    hidesYoung: true,
    rideable: false,
    speed: 0.88,
    agility: 1.3,
    coat: "#9b5830",
    winter: "#706452",
    spots: false,
    antlers: "short",
  },
  whitetail: {
    name: "White-tailed deer",
    scientific: "Odocoileus virginianus",
    family: "Cervidae",
    habitat: "temperate",
    height: 1.03,
    group: [2, 4],
    separation: 6,
    range: 43,
    shy: 0.7,
    social: 0.5,
    browser: 0.65,
    hidesYoung: true,
    rideable: false,
    speed: 1.01,
    agility: 1.2,
    coat: "#987052",
    winter: "#7e7565",
    spots: false,
    antlers: "beam",
  },
  mule: {
    name: "Mule deer",
    scientific: "Odocoileus hemionus",
    family: "Cervidae",
    habitat: "boreal",
    height: 1.07,
    group: [2, 4],
    separation: 6,
    range: 48,
    shy: 0.65,
    social: 0.5,
    browser: 0.7,
    hidesYoung: true,
    rideable: false,
    speed: 0.98,
    agility: 1.2,
    coat: "#867460",
    winter: "#776e62",
    spots: false,
    antlers: "fork",
  },
  elk: {
    name: "Elk / wapiti",
    scientific: "Cervus canadensis",
    family: "Cervidae",
    habitat: "boreal",
    height: 1.58,
    group: [5, 9],
    separation: 4.5,
    range: 65,
    shy: 0.42,
    social: 0.85,
    browser: 0.3,
    hidesYoung: true,
    rideable: true,
    speed: 1.1,
    agility: 0.94,
    coat: "#ae9062",
    winter: "#9a815e",
    spots: false,
    antlers: "many",
  },
  moose: {
    name: "Moose",
    scientific: "Alces alces",
    family: "Cervidae",
    habitat: "boreal",
    height: 1.93,
    group: [1, 2],
    separation: 13,
    range: 55,
    shy: 0.36,
    social: 0.1,
    browser: 0.95,
    hidesYoung: false,
    rideable: true,
    speed: 0.94,
    agility: 0.75,
    coat: "#645041",
    winter: "#453a32",
    spots: false,
    antlers: "moose",
  },
  reindeer: {
    name: "Reindeer / caribou",
    scientific: "Rangifer tarandus",
    family: "Cervidae",
    habitat: "tundra",
    height: 1.2,
    group: [6, 10],
    separation: 3.7,
    range: 72,
    shy: 0.4,
    social: 0.95,
    browser: 0.3,
    hidesYoung: false,
    rideable: true,
    speed: 1.04,
    agility: 1.02,
    coat: "#8c7764",
    winter: "#b2a18b",
    spots: false,
    antlers: "reindeer",
  },
  yak: {
    name: "Yak",
    scientific: "Bos grunniens",
    family: "Bovidae",
    habitat: "alpine",
    height: 1.55,
    group: [3, 6],
    separation: 5,
    range: 42,
    shy: 0.3,
    social: 0.7,
    browser: 0.1,
    hidesYoung: false,
    rideable: true,
    speed: 0.6,
    agility: 0.58,
    coat: "#4c4037",
    winter: "#302b27",
    spots: false,
    antlers: "horns",
  },
}

export type DeerIdentity = {
  saddled: false
  id: string
  seed: number
  species: DeerSpecies
  sex: Sex
  age: Age
  name: string
  scale: number
  build: number
  ears: number
  muzzle: number
  coat: number
  markingSeed: number
  antlerScale: number
  antlerStage: "bare" | "velvet" | "hard"
  asymmetry: number
  rare: boolean
  herd: string
  mother: string | null
  traits: {
    shy: number
    curious: number
    calm: number
    protective: number
    social: number
    patience: number
    playful: number
  }
}
const NAMES = [
  "Hiran",
  "Chital",
  "Sona",
  "Moti",
  "Rimjhim",
  "Chanda",
  "Kusum",
  "Bela",
  "Juhi",
  "Lata",
  "Gauri",
  "Neela",
  "Pari",
  "Mohini",
  "Tara",
  "Nandini",
]
export const deerIdentity = (
  id: string,
  seed: number,
  species: DeerSpecies,
  herd: string,
  sex: Sex,
  age: Age = "adult",
  mother: string | null = null,
): DeerIdentity => {
  const r = rng(seed),
    p = SPECIES[species]
  const vary = (v: number, spread = 0.35): number => Math.max(0.05, Math.min(0.98, v + (r() - 0.5) * spread))
  const rare = age === "adult" && p.rideable && r() < 0.012
  return {
    id,
    seed,
    species,
    herd,
    sex,
    age,
    mother,
    rare,
    saddled: false,
    name: `${NAMES[seed % NAMES.length]}${rare ? " of the wild wind" : ""}`,
    scale: (0.94 + r() * 0.12) * (age === "fawn" ? 0.49 + r() * 0.1 : sex === "female" ? 0.91 : 1),
    build: 0.9 + r() * 0.2,
    ears: 0.92 + r() * 0.16,
    muzzle: 0.94 + r() * 0.12,
    coat: r(),
    markingSeed: Math.floor(r() * 65535),
    antlerScale: (0.78 + r() * 0.4) * (sex === "female" ? 0.57 : 1) * (rare ? 1.12 : 1),
    antlerStage: r() < 0.1 ? "bare" : r() < 0.25 ? "velvet" : "hard",
    asymmetry: (r() - 0.5) * 0.08,
    traits: {
      shy: vary(p.shy),
      curious: vary(0.5),
      calm: vary(0.55),
      protective: vary(0.72),
      social: vary(p.social, 0.2),
      patience: vary(0.5),
      playful: vary(age === "fawn" ? 0.8 : 0.25),
    },
  }
}
export const hasAntlers = (i: DeerIdentity): boolean =>
  i.age === "adult" &&
  (i.species === "yak" || (i.antlerStage !== "bare" && (i.sex === "male" || i.species === "reindeer")))
export const canCarryRider = (i: DeerIdentity): boolean =>
  i.age === "adult" && SPECIES[i.species].rideable && SPECIES[i.species].height * i.scale >= 1.03
export const deerSpeeds = (i: DeerIdentity): [number, number, number, number] => {
  const s = SPECIES[i.species].speed * (0.96 + i.build * 0.04)
  return [1.15 * s, 2.7 * s, RUN_SPEED * 0.73 * s, (i.rare ? 11.5 : RUN_SPEED) * s]
}
