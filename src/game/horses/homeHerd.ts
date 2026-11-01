import type { BreedId, CoatId, FaceMark, Legs } from "./breeds"

export type HomeHorse = { seed: number; breed: BreedId; coat: CoatId; name: string; face: FaceMark; legs: Legs; x: number; z: number }

/** The home herd grazes together in the open meadow south-west of home:
 * six real breeds, every one tacked up and ready to ride. */
export const HOME_HERD: HomeHorse[] = [
  { seed: 8142, breed: "thoroughbred", coat: "chestnut", name: "Chetak", face: "blaze", legs: [0, 0, 0.35, 0.2], x: -33, z: -20 },
  { seed: 9153, breed: "quarter", coat: "palomino", name: "Tejas", face: "star", legs: [0.25, 0, 0, 0], x: -37, z: -23 },
  { seed: 7310, breed: "friesian", coat: "black", name: "Kaali", face: "none", legs: [0, 0, 0, 0], x: -35, z: -28 },
  { seed: 6621, breed: "andalusian", coat: "grey", name: "Chandra", face: "none", legs: [0, 0, 0, 0], x: -40, z: -19 },
  { seed: 5517, breed: "draft", coat: "bay", name: "Bhola", face: "bald", legs: [0.9, 0.85, 1, 0.95], x: -41, z: -26 },
  { seed: 4409, breed: "arabian", coat: "fleaGrey", name: "Kesar", face: "snip", legs: [0, 0.3, 0, 0], x: -31, z: -25 },
]
