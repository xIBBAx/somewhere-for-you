import { rng } from "../../world/noise"

/**
 * Real horse types and what makes each one distinct, in gameplay terms.
 *
 * The 3D build of every breed (asset-pipeline/horses/anatomy.py) differs in
 * conformation; this file holds what the runtime needs: the coats that are
 * plausible for the breed, its gait speeds and its temperament. Speeds are
 * real-world figures scaled only slightly for a cozy game (walk ~7 km/h,
 * working trot ~13-15 km/h, canter 16-27 km/h, gallop 40-48 km/h). Each individual then varies within the breed.
 */
export type BreedId = "thoroughbred" | "arabian" | "quarter" | "friesian" | "draft" | "andalusian" | "mustang" | PegasusId
/** Breeds that live and roam as ordinary horses (wild herds pick from these). */
export const BREED_IDS: BreedId[] = ["thoroughbred", "arabian", "quarter", "friesian", "draft", "andalusian", "mustang"]
/** The winged horses: each is one individual with its own build. */
export type PegasusId = "ivory" | "onyx" | "starborn"
export const PEGASUS_IDS: PegasusId[] = ["ivory", "onyx", "starborn"]
export const isPegasusBreed = (b: BreedId): b is PegasusId => (PEGASUS_IDS as BreedId[]).includes(b)

/** Coat in linear-ish sRGB hex: body, points (mane/tail/lower legs), mane, belly/muzzle softening, dapple. */
export type Coat = {
  name: string
  body: string
  /** "points": black lower legs, mane and tail of a bay or buckskin */
  points: string | null
  mane: string
  /** lighter (mealy) muzzle, flanks and belly; 0..1 */
  pale: number
  /** dapples (grey, some bays); 0..1 */
  dapple: number
  /** fine white hairs through the coat (roan, greying); 0..1 */
  roan: number
  /** star-flecked coat (Starborn): bright specks that glow faintly at night; 0..1 */
  stars?: number
}

const C = (name: string, body: string, points: string | null, mane: string, pale = 0.2, dapple = 0, roan = 0): Coat =>
  ({ name, body, points, mane, pale, dapple, roan })

export const COATS = {
  bay: C("bay", "#5e2b14", "#17100c", "#130d0a", 0.35),
  darkBay: C("dark bay", "#3a1d10", "#100b08", "#0e0907", 0.25),
  bloodBay: C("blood bay", "#76301a", "#1a110c", "#140d0a", 0.3),
  chestnut: C("chestnut", "#7f3a17", null, "#733312", 0.15),
  liverChestnut: C("liver chestnut", "#4f2513", null, "#3f1d0f", 0.1),
  sorrel: C("sorrel", "#94491d", null, "#b97a44", 0.15),
  flaxen: C("flaxen chestnut", "#87421b", null, "#e6cf9c", 0.15),
  black: C("black", "#141110", null, "#0d0b0a", 0.05),
  grey: C("dapple grey", "#8d8a86", "#3c3936", "#d9d6d0", 0.05, 0.85),
  fleaGrey: C("white grey", "#d8d4cc", null, "#ece9e3", 0.0, 0.2, 0.15),
  palomino: C("palomino", "#c19445", null, "#efe3c2", 0.35),
  buckskin: C("buckskin", "#c4a066", "#1b1410", "#16110d", 0.3),
  dun: C("dun", "#a98a5a", "#2a1f16", "#241a12", 0.25),
  grullo: C("grullo", "#6d6660", "#211d1a", "#1d1916", 0.2),
  blueRoan: C("blue roan", "#3a3a3d", "#151414", "#141313", 0.1, 0, 0.6),
  bayRoan: C("bay roan", "#6a3a22", "#181110", "#140e0b", 0.2, 0, 0.5),
  // the Pegasi
  pearl: C("pearl white", "#e6e2da", null, "#f3efe6", 0.02, 0.14, 0.05),
  blackBay: C("black bay", "#24140c", "#0b0807", "#0b0807", 0.18),
  midnight: { ...C("midnight", "#161b36", null, "#cfcaf0", 0.04), stars: 1 },
} satisfies Record<string, Coat>
export type CoatId = keyof typeof COATS

export type Breed = {
  id: BreedId
  name: string
  /** short line used when the horse introduces itself */
  blurb: string
  /** coats seen in the breed and their relative frequency */
  coats: Array<[CoatId, number]>
  /** probabilities of white face markings and socks (draft: high, Friesian: none) */
  white: number
  /** walk, trot, canter and gallop speeds (m/s) for an average individual */
  speeds: [number, number, number, number]
  /** acceleration (m/s²) and braking, and the turn rate at a walk (rad/s) */
  accel: number
  agility: number
  /** seconds of gallop on a full tank, and how quickly it refills */
  stamina: number
  /** temperament averages, 0..1 */
  calm: number
  curiosity: number
  energy: number
  /** feather and long hair need the higher-detail hair on Light presets */
  longHair: boolean
  /** winged breeds only: how it flies */
  flight?: FlightSpec
}

/**
 * Flight for a winged breed. Speeds are an arcade reading of large soaring
 * birds: cruise ~16-18 m/s, a boosted dash, a stall
 * floor held up by the Pegasus's own magic (a 500 kg animal could not stay
 * up on feathers alone), banks to 45 degrees and a turn rate capped as real
 * bird turns are (turn rate = g tan(bank) / v).
 */
export type FlightSpec = {
  cruise: number
  boost: number
  /** slowest controlled flight (m/s); slower than this it lands or settles */
  minSpeed: number
  /** sustained climb and dive rates (m/s) */
  climb: number
  dive: number
  /** highest yaw rate (rad/s) and bank (rad) */
  turn: number
  bank: number
  /** wingbeat frequency in cruise (Hz) */
  flapHz: number
  /** soft ceiling above the ground (m); Infinity for the star-born */
  ceiling: number
  /** riders it can carry */
  seats: 1 | 2
  /** can leave the atmosphere (star-born) */
  celestial: boolean
}

export const BREEDS: Record<BreedId, Breed> = {
  ivory: {
    id: "ivory", name: "Pegasus", blurb: "a pearl-white mare with long gliding wings",
    coats: [["pearl", 1]], white: 0, speeds: [1.75, 3.9, 7.0, 14.0], accel: 3.3, agility: 1.12, stamina: 40, calm: 0.7, curiosity: 0.85, energy: 0.7,
    longHair: true,
    flight: { cruise: 17, boost: 30, minSpeed: 7, climb: 4.6, dive: 13, turn: 0.75, bank: 0.78, flapHz: 1.7, ceiling: 650, seats: 1, celestial: false },
  },
  onyx: {
    id: "onyx", name: "Pegasus", blurb: "a dark stallion with broad, fingered eagle wings",
    coats: [["blackBay", 1]], white: 0, speeds: [1.75, 3.9, 7.2, 14.8], accel: 3.6, agility: 1.04, stamina: 44, calm: 0.62, curiosity: 0.6, energy: 0.85,
    longHair: true,
    flight: { cruise: 18.5, boost: 33, minSpeed: 8, climb: 4.3, dive: 15, turn: 0.66, bank: 0.8, flapHz: 1.5, ceiling: 650, seats: 1, celestial: false },
  },
  starborn: {
    id: "starborn", name: "Star Pegasus", blurb: "a star-born mare who can carry two beyond the sky",
    coats: [["midnight", 1]], white: 0, speeds: [1.7, 3.8, 6.6, 12.6], accel: 2.8, agility: 0.95, stamina: 60, calm: 0.9, curiosity: 0.7, energy: 0.6,
    longHair: true,
    flight: { cruise: 16, boost: 28, minSpeed: 7, climb: 3.8, dive: 12, turn: 0.55, bank: 0.7, flapHz: 1.25, ceiling: Infinity, seats: 2, celestial: true },
  },
  thoroughbred: {
    id: "thoroughbred", name: "Thoroughbred", blurb: "a racehorse's long, ground-eating stride",
    coats: [["bay", 4], ["darkBay", 3], ["chestnut", 3], ["black", 1], ["grey", 1]], white: 0.45,
    speeds: [1.75, 3.9, 7.2, 14.5], accel: 3.4, agility: 1.0, stamina: 26, calm: 0.42, curiosity: 0.55, energy: 0.85, longHair: false,
  },
  arabian: {
    id: "arabian", name: "Arabian", blurb: "a dished face, a flagged tail and endless stamina",
    coats: [["grey", 4], ["fleaGrey", 2], ["bay", 3], ["chestnut", 3], ["black", 1]], white: 0.4,
    speeds: [1.7, 3.8, 6.9, 13.2], accel: 3.1, agility: 1.12, stamina: 40, calm: 0.45, curiosity: 0.8, energy: 0.8, longHair: false,
  },
  quarter: {
    id: "quarter", name: "Quarter Horse", blurb: "quick off the mark and steady as a rock",
    coats: [["sorrel", 5], ["chestnut", 2], ["bay", 3], ["buckskin", 2], ["palomino", 2], ["grullo", 1], ["blueRoan", 1], ["bayRoan", 1]], white: 0.5,
    speeds: [1.65, 3.6, 6.8, 13.6], accel: 4.1, agility: 1.18, stamina: 22, calm: 0.82, curiosity: 0.6, energy: 0.55, longHair: false,
  },
  friesian: {
    id: "friesian", name: "Friesian", blurb: "a flowing mane, feathered legs and a proud, high trot",
    coats: [["black", 1]], white: 0.02,
    speeds: [1.65, 3.7, 6.4, 11.6], accel: 2.6, agility: 0.92, stamina: 24, calm: 0.7, curiosity: 0.6, energy: 0.6, longHair: true,
  },
  draft: {
    id: "draft", name: "Clydesdale", blurb: "gentle, enormous and tremendously strong",
    coats: [["bay", 5], ["darkBay", 2], ["black", 2], ["bayRoan", 2], ["chestnut", 1]], white: 0.95,
    speeds: [1.6, 3.4, 5.8, 10.2], accel: 2.0, agility: 0.78, stamina: 30, calm: 0.92, curiosity: 0.5, energy: 0.35, longHair: true,
  },
  andalusian: {
    id: "andalusian", name: "Andalusian", blurb: "elegant, collected and wonderfully willing",
    coats: [["grey", 5], ["fleaGrey", 2], ["bay", 2], ["black", 1]], white: 0.15,
    speeds: [1.65, 3.7, 6.7, 12.4], accel: 3.0, agility: 1.12, stamina: 26, calm: 0.66, curiosity: 0.6, energy: 0.65, longHair: true,
  },
  mustang: {
    id: "mustang", name: "Mustang", blurb: "hardy, sure-footed and a little wild at heart",
    coats: [["bay", 3], ["dun", 3], ["grullo", 2], ["buckskin", 2], ["chestnut", 2], ["blueRoan", 1], ["black", 1], ["palomino", 1]], white: 0.35,
    speeds: [1.7, 3.7, 6.8, 12.8], accel: 3.3, agility: 1.08, stamina: 34, calm: 0.38, curiosity: 0.45, energy: 0.72, longHair: true,
  },
}

/** Face markings, by how much white runs down the face. */
export type FaceMark = "none" | "star" | "strip" | "snip" | "starStrip" | "blaze" | "bald"
/** White on each leg (front left, front right, hind left, hind right): 0 none … 1 to the knee/hock. */
export type Legs = [number, number, number, number]

export type Traits = {
  /** multipliers on the breed's gait speeds, acceleration and turn rate */
  speed: number
  accel: number
  agility: number
  /** seconds of gallop on a full tank */
  stamina: number
  /** 0 flighty … 1 unflappable */
  calm: number
  /** 0 aloof … 1 always comes over to see you */
  curiosity: number
  /** 0 placid … 1 forward-going and playful */
  energy: number
  /** 0 dull … 1 reacts to the lightest aid (turns and stops quicker) */
  sensitivity: number
  /** 0 loner … 1 always with the herd */
  sociability: number
}

export type HorseIdentity = {
  id: string
  name: string
  breed: BreedId
  coatId: CoatId
  coat: Coat
  face: FaceMark
  legs: Legs
  /** small individual differences in size within the breed */
  scale: number
  /** the mane is trained to fall on the off (right) side; a few fall left */
  maneLeft: boolean
  traits: Traits
  /** a home horse wears tack and can be ridden */
  saddled: boolean
  seed: number
}

const NAMES = [
  "Tejas", "Chetak", "Bijli", "Toofan", "Pawan", "Moti", "Heera", "Panna", "Sona", "Chandi", "Rani", "Raja", "Veer", "Shera", "Badal", "Gulab", "Kesar", "Champa", "Chameli", "Mogra", "Bela", "Neelam", "Malhar", "Sawan", "Basant", "Hemant", "Sharad", "Kajal", "Laali", "Anmol", "Mehndi", "Kasturi", "Roshan", "Ujala", "Nanhi", "Munna", "Chhotu", "Babli", "Laddu", "Jalebi", "Barfi", "Peda", "Imli", "Amla", "Tulsi", "Neem", "Jamun", "Aam"]

const pick = <T,>(r: () => number, list: Array<[T, number]>): T => {
  const total = list.reduce((s, [, w]) => s + w, 0)
  let x = r() * total
  for (const [v, w] of list) {
    x -= w
    if (x <= 0) return v
  }
  return list[list.length - 1][0]
}

/** A Gaussian-ish spread from three uniform draws (stays inside ±1). */
const spread = (r: () => number): number => (r() + r() + r()) / 1.5 - 1

/**
 * Stable identity from a seed. The same seed always yields the same horse:
 * coat, markings, temperament and ability survive streaming and reloads.
 */
export const makeIdentity = (seed: number, breedId?: BreedId, overrides: Partial<HorseIdentity> = {}): HorseIdentity => {
  const r = rng(seed >>> 0)
  const breed = BREEDS[breedId ?? pick(r, BREED_IDS.map((b) => [b, 1] as [BreedId, number]))]
  const coatId = pick(r, breed.coats)
  const white = breed.white
  const faceRoll = r()
  const face: FaceMark = faceRoll > white ? "none"
    : pick(r, [["star", 3], ["strip", 1], ["starStrip", 2], ["snip", 1], ["blaze", 3 * white], ["bald", white > 0.8 ? 3 : 0.2]])
  const legs: Legs = [0, 0, 0, 0]
  // Hind legs carry white more often than forelegs; a draft is often white to the knee.
  for (let i = 0; i < 4; i++) {
    const p = white * (i >= 2 ? 0.75 : 0.5)
    if (r() < p) legs[i] = white > 0.8 ? 0.55 + r() * 0.45 : 0.15 + r() * 0.5
  }
  const traits: Traits = {
    speed: 1 + spread(r) * 0.05,
    accel: 1 + spread(r) * 0.1,
    agility: 1 + spread(r) * 0.08,
    stamina: breed.stamina * (1 + spread(r) * 0.15),
    calm: Math.min(1, Math.max(0, breed.calm + spread(r) * 0.2)),
    curiosity: Math.min(1, Math.max(0, breed.curiosity + spread(r) * 0.25)),
    energy: Math.min(1, Math.max(0, breed.energy + spread(r) * 0.2)),
    sensitivity: Math.min(1, Math.max(0, 0.55 + (1 - breed.calm) * 0.3 + spread(r) * 0.2)),
    sociability: Math.min(1, Math.max(0, 0.65 + spread(r) * 0.3)),
  }
  return {
    id: `horse:${seed >>> 0}`,
    name: NAMES[Math.floor(r() * NAMES.length)],
    breed: breed.id,
    coatId,
    coat: COATS[coatId],
    face,
    legs,
    scale: 1 + spread(r) * 0.035,
    maneLeft: r() < 0.12,
    traits,
    saddled: false,
    seed: seed >>> 0,
    ...overrides,
  }
}

/** Gait speeds for an individual (m/s): walk, trot, canter, gallop. */
export const gaitSpeeds = (h: HorseIdentity): [number, number, number, number] => {
  const s = BREEDS[h.breed].speeds
  const k = h.traits.speed
  return [s[0] * (1 + (k - 1) * 0.5), s[1] * k, s[2] * k, s[3] * k]
}
