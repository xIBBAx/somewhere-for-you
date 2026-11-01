/**
 * Existing fauna only. Scientific names are reference choices for the look and
 * behaviour, not exact identifications of the stylised meshes.
 * ALL flight, timing, risk and display-scale values below are game tuning.
 */
export type FlyingSpecies = "robin" | "bluebird" | "goldfinch" | "sparrow" |
  "monarch" | "swallowtail" | "morpho" | "rose-butterfly" | "violet-butterfly" |
  "green-butterfly" | "honeybee" | "dragonfly" | "firefly"
export type FlightFamily = "bird" | "butterfly" | "bee" | "dragonfly" | "firefly"
export type FoodKind = "nectar" | "pollen" | "fruit" | "seed" | "ground-invertebrate"
export type FlightStyle = "direct" | "bounding" | "flutter-glide" | "direct-hover" | "agile-hover" | "low-patrol"

export type FlyingSpeciesProfile = {
  id: FlyingSpecies
  family: FlightFamily
  reference: string | null
  bodyLength: number
  wingSpan: number
  displayScale: number
  colors: readonly [body: string, breast: string, wing: string, accent: string]
  food: readonly FoodKind[]
  flight: {
    style: FlightStyle
    cruise: number
    burst: number
    acceleration: number
    braking: number
    climb: number
    wingHz: number
    turnRate: number
    clearance: number
    altitude: readonly [number, number]
  }
  perception: number
  personalSpace: number
  caution: number
  flocking: number
  territorial: number
  activity: "diurnal" | "dusk"
  courtship: "wing-tail-display" | "nest-site" | "feeding" | "hopping-display" | "pursuit" | "flash-dialogue" | "none"
  nest: "cup" | "cavity" | "none"
}

const bird = (id: FlyingSpecies, reference: string, length: number, span: number,
  colors: FlyingSpeciesProfile["colors"], food: readonly FoodKind[],
  overrides: Partial<FlyingSpeciesProfile> = {}): FlyingSpeciesProfile => ({
  id, family: "bird", reference, bodyLength: length, wingSpan: span, displayScale: 1.5, colors, food,
  flight: { style: "direct", cruise: 4.4, burst: 7.2, acceleration: 8, braking: 9, climb: 3.1, wingHz: 10.5, turnRate: 2.4, clearance: span * 0.8, altitude: [0.5, 12] },
  perception: 12, personalSpace: 0.7, caution: 0.65, flocking: 0.3, territorial: 0.5,
  activity: "diurnal", courtship: "wing-tail-display", nest: "cup", ...overrides,
})
const butterfly = (id: FlyingSpecies, reference: string | null, span: number,
  colors: FlyingSpeciesProfile["colors"], food: readonly FoodKind[] = ["nectar"]): FlyingSpeciesProfile => ({
  id, family: "butterfly", reference, bodyLength: span * 0.26, wingSpan: span, displayScale: 2.1, colors, food,
  flight: { style: "flutter-glide", cruise: 1.15, burst: 2.2, acceleration: 3, braking: 4, climb: 1.1, wingHz: 7, turnRate: 3.3, clearance: span * 1.2, altitude: [0.15, 4.5] },
  perception: 4, personalSpace: 0.2, caution: id === "monarch" ? 0.34 : 0.55,
  flocking: 0, territorial: 0, activity: "diurnal", courtship: "pursuit", nest: "none",
})

export const FLYING_SPECIES: Readonly<Record<FlyingSpecies, FlyingSpeciesProfile>> = {
  robin: bird("robin", "Turdus migratorius", 0.24, 0.35, ["#53514b", "#c46535", "#484b49", "#dbb34c"], ["ground-invertebrate", "fruit"]),
  bluebird: bird("bluebird", "Sialia sialis", 0.18, 0.29, ["#347cb7", "#b9653c", "#28649a", "#e4dcc7"], ["ground-invertebrate", "fruit"], { courtship: "nest-site", nest: "cavity", territorial: 0.8 }),
  goldfinch: bird("goldfinch", "Spinus tristis", 0.12, 0.205, ["#e8c735", "#eed559", "#252a2a", "#ece5c7"], ["seed"], {
    flight: { style: "bounding", cruise: 3.8, burst: 6.4, acceleration: 7.5, braking: 8, climb: 2.8, wingHz: 13, turnRate: 2.7, clearance: 0.19, altitude: [0.4, 10] },
    courtship: "feeding", flocking: 0.85, territorial: 0.15,
  }),
  sparrow: bird("sparrow", "Passer domesticus", 0.16, 0.235, ["#8c7153", "#b8ab94", "#624d3a", "#3f3630"], ["seed", "ground-invertebrate"], { courtship: "hopping-display", nest: "cavity", flocking: 0.9, territorial: 0.25, caution: 0.5 }),
  monarch: butterfly("monarch", "Danaus plexippus", 0.10, ["#352e25", "#ea8d28", "#dd7027", "#f4e6bc"]),
  swallowtail: butterfly("swallowtail", "Papilio glaucus", 0.115, ["#34342a", "#e5c957", "#ecd365", "#466e94"]),
  morpho: butterfly("morpho", "Morpho peleides", 0.17, ["#423930", "#856a48", "#379cb8", "#cfb07b"], ["fruit"]),
  "rose-butterfly": butterfly("rose-butterfly", null, 0.09, ["#48363b", "#b46b83", "#d884a1", "#eee0c7"]),
  "violet-butterfly": butterfly("violet-butterfly", null, 0.095, ["#433e4b", "#867496", "#a08bbb", "#e1d8c9"]),
  "green-butterfly": butterfly("green-butterfly", null, 0.09, ["#39432f", "#779665", "#a1bc77", "#e1d7a9"]),
  honeybee: {
    id: "honeybee", family: "bee", reference: "Apis mellifera worker", bodyLength: 0.014, wingSpan: 0.024, displayScale: 4,
    colors: ["#6a4929", "#c49b45", "#c9d3ce", "#dcb854"], food: ["nectar", "pollen"],
    flight: { style: "direct-hover", cruise: 1.8, burst: 3.2, acceleration: 5, braking: 7, climb: 1.4, wingHz: 180, turnRate: 4.5, clearance: 0.065, altitude: [0.08, 3.5] },
    perception: 3.5, personalSpace: 0.11, caution: 0.25, flocking: 0, territorial: 0, activity: "diurnal", courtship: "none", nest: "none",
  },
  dragonfly: {
    id: "dragonfly", family: "dragonfly", reference: "Anisoptera archetype; exact species unresolved", bodyLength: 0.055, wingSpan: 0.085, displayScale: 2.5,
    colors: ["#407780", "#609590", "#cbd4c8", "#33594c"], food: [],
    flight: { style: "agile-hover", cruise: 2.3, burst: 5.8, acceleration: 12, braking: 14, climb: 2.8, wingHz: 32, turnRate: 6.5, clearance: 0.13, altitude: [0.2, 5] },
    perception: 7, personalSpace: 0.35, caution: 0.6, flocking: 0, territorial: 0.75, activity: "diurnal", courtship: "pursuit", nest: "none",
  },
  firefly: {
    id: "firefly", family: "firefly", reference: "Photinus pyralis signal reference", bodyLength: 0.012, wingSpan: 0.022, displayScale: 3,
    colors: ["#4c4332", "#a38153", "#a9b6a5", "#d4e38b"], food: [],
    flight: { style: "low-patrol", cruise: 0.55, burst: 1.1, acceleration: 1.8, braking: 2.5, climb: 0.5, wingHz: 50, turnRate: 2.2, clearance: 0.045, altitude: [0.08, 2.4] },
    perception: 4, personalSpace: 0.1, caution: 0.3, flocking: 0, territorial: 0, activity: "dusk", courtship: "flash-dialogue", nest: "none",
  },
}
