import type { PlanetId } from "./ephemeris"
import { names } from "../../personalization"

/**
 * Every world Starborn can reach in the Sun's family, with its real size,
 * spin, tilt and orbit (NASA/JPL planetary fact sheets and the JPL Solar
 * System Dynamics satellite tables).
 *
 * Only two places can be stood on: home (Earth, the world the game began in)
 * and the Moon. Every other world can be approached, circled and studied
 * from the saddle, but its surface or its depths would kill a rider, so
 * Starborn will not set down there (celestial/hazards.ts says why, world by
 * world). `landable` is that rule; LANDABLE_IDS is the same rule as a list,
 * for the code that must never be talked out of it.
 */

export type BodyKind = "star" | "rocky" | "gas" | "ice" | "moon" | "dwarf"

export type RingDef = {
  /** inner and outer radius, real km */
  inner: number
  outer: number
  /** what the rings are made of decides their look */
  style: "saturn" | "uranus" | "neptune" | "jupiter"
}

export type AtmosphereDef = {
  /** colour scattered at the limb (linear rgb) */
  rayleigh: [number, number, number]
  /** how far the visible haze reaches above the surface, as a share of the radius */
  thickness: number
  /** 0 none … 1 a full, opaque haze (Venus, Titan) */
  haze: number
  /** the colour of the haze itself */
  hazeColor: [number, number, number]
}

export type SurfaceSky = {
  /** sky colour by day near the zenith and at the horizon (linear) */
  zenith: [number, number, number]
  horizon: [number, number, number]
  /** sunset glow around the sun (Mars: blue) */
  sunset: [number, number, number]
}

export type BodyDef = {
  id: string
  name: string
  kind: BodyKind
  /** mean radius, real km */
  radius: number
  /** flattening (gas giants bulge at the equator) */
  oblate?: number
  /** sidereal rotation period, hours (negative: retrograde) */
  day: number
  /** obliquity of the axis to its orbit, degrees */
  tilt: number
  /** heliocentric planet (positions from the ephemeris) */
  planet?: PlanetId
  /** a moon: its planet, orbit radius (real km), period (days), inclination */
  parent?: string
  orbitKm?: number
  periodDays?: number
  inclination?: number
  /** surface gravity, m/s² */
  gravity: number
  /** colour map under public/assets/ (equirectangular); greyscale moon maps are tinted by `color` */
  map?: string
  /** a fallback mean colour (linear) used before the map loads or in the far view */
  color: [number, number, number]
  /** geometric albedo: how bright it looks lit by the Sun */
  albedo: number
  atmosphere?: AtmosphereDef
  rings?: RingDef
  /** a surface you can land on and walk (only Earth and the Moon: LANDABLE_IDS) */
  landable: boolean
  sky?: SurfaceSky
  /** a short, true line about the place for the journal */
  fact: string
}

const lin = (hex: number): [number, number, number] => [
  ((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255,
].map((c) => Math.pow(c, 2.2)) as [number, number, number]

/** The only worlds that may ever be landed on. Anything else stays sky. */
export const LANDABLE_IDS: readonly string[] = ["earth", "moon"]

export const BODIES: BodyDef[] = [
  {
    id: "sun", name: "The Sun", kind: "star", radius: 695_700, day: 609.1, tilt: 7.25, gravity: 274, color: [1, 0.95, 0.88], albedo: 1, landable: false,
    fact: "A middle-aged yellow dwarf: 99.86% of all the mass in the solar system, its light eight minutes old when it reaches Earth.",
  },
  {
    id: "mercury", name: "Mercury", kind: "rocky", radius: 2439.7, day: 1407.6, tilt: 0.03, planet: "mercury", gravity: 3.7, map: "celestial/mercury_2k.jpg", color: lin(0x8c8784), albedo: 0.142, landable: false,
    sky: { zenith: [0, 0, 0], horizon: [0, 0, 0], sunset: [0, 0, 0] },
    fact: "The Sun looks three times bigger here, and one solar day lasts two of Mercury's years.",
  },
  {
    id: "venus", name: "Venus", kind: "rocky", radius: 6051.8, day: -5832.5, tilt: 177.4, planet: "venus", gravity: 8.87, map: "celestial/venus_atmosphere_2k.jpg", color: lin(0xe3c78f), albedo: 0.689, landable: false,
    atmosphere: { rayleigh: [1.0, 0.86, 0.6], thickness: 0.035, haze: 1, hazeColor: lin(0xe8d2a0) },
    fact: `Sulphuric-acid clouds wrap the whole planet; beneath them the ground is hot enough to melt lead. ${names.starborn} will only sail its cloud tops.`,
  },
  {
    id: "earth", name: "Earth", kind: "rocky", radius: 6371, day: 23.934, tilt: 23.44, planet: "earth", gravity: 9.81, color: lin(0x2f5c8c), albedo: 0.367, landable: true,
    atmosphere: { rayleigh: [0.33, 0.56, 1.0], thickness: 0.025, haze: 0, hazeColor: [1, 1, 1] },
    fact: "Home. The only place we know of where it rains water, where flowers grow and where two people can meet.",
  },
  {
    id: "moon", name: "The Moon", kind: "moon", radius: 1737.4, day: 655.7, tilt: 6.68, parent: "earth", orbitKm: 384_400, periodDays: 27.32, inclination: 5.14, gravity: 1.62, map: "cinematic/earth/moon_2k.jpg", color: lin(0x9a958d), albedo: 0.12, landable: true,
    sky: { zenith: [0, 0, 0], horizon: [0, 0, 0], sunset: [0, 0, 0] },
    fact: "Twelve people have walked here. Footprints in the grey dust last for millions of years because there is no wind to fill them in.",
  },
  {
    id: "mars", name: "Mars", kind: "rocky", radius: 3389.5, day: 24.623, tilt: 25.19, planet: "mars", gravity: 3.71, map: "celestial/mars_2k.jpg", color: lin(0xb8653a), albedo: 0.17, landable: false,
    atmosphere: { rayleigh: [0.85, 0.6, 0.42], thickness: 0.02, haze: 0.1, hazeColor: lin(0xc89a6c) },
    sky: { zenith: lin(0x9c7a5c), horizon: lin(0xd4ab83), sunset: lin(0x6d8fc4) },
    fact: "Fine red dust hangs in the thin air, so the sky is butterscotch by day and the sunsets are blue.",
  },
  {
    id: "phobos", name: "Phobos", kind: "moon", radius: 11.27, day: 7.65, tilt: 0, parent: "mars", orbitKm: 9376, periodDays: 0.3189, inclination: 1.08, gravity: 0.0057, color: lin(0x5c544c), albedo: 0.071, landable: false,
    fact: "A lumpy moon spiralling slowly inward; one day Mars will tear it into a ring.",
  },
  {
    id: "deimos", name: "Deimos", kind: "moon", radius: 6.2, day: 30.3, tilt: 0, parent: "mars", orbitKm: 23_463, periodDays: 1.263, inclination: 1.79, gravity: 0.003, color: lin(0x6b6157), albedo: 0.068, landable: false,
    fact: "So small that a good jump would carry you off it for ever.",
  },
  {
    id: "jupiter", name: "Jupiter", kind: "gas", radius: 69_911, oblate: 0.0649, day: 9.925, tilt: 3.13, planet: "jupiter", gravity: 24.79, map: "celestial/jupiter_4k.jpg", color: lin(0xc8a37a), albedo: 0.538, landable: false,
    atmosphere: { rayleigh: [0.9, 0.85, 0.75], thickness: 0.012, haze: 0.15, hazeColor: lin(0xd8c8a8) },
    rings: { inner: 92_000, outer: 129_000, style: "jupiter" },
    fact: "Its Great Red Spot is a storm wider than Earth that has blown for centuries. There is no ground: the clouds simply thicken into a hot, crushing sea.",
  },
  {
    id: "io", name: "Io", kind: "moon", radius: 1821.6, day: 42.46, tilt: 0, parent: "jupiter", orbitKm: 421_700, periodDays: 1.769, inclination: 0.05, gravity: 1.8, map: "celestial/io_2k.jpg", color: lin(0xd9c35a), albedo: 0.63, landable: false,
    sky: { zenith: [0, 0, 0], horizon: [0, 0, 0], sunset: [0, 0, 0] },
    fact: "The most volcanic place in the solar system: hundreds of volcanoes, some throwing sulphur plumes 400 km high.",
  },
  {
    id: "europa", name: "Europa", kind: "moon", radius: 1560.8, day: 85.2, tilt: 0.1, parent: "jupiter", orbitKm: 671_034, periodDays: 3.551, inclination: 0.47, gravity: 1.31, map: "celestial/europa_2k.jpg", color: lin(0xc9b79a), albedo: 0.67, landable: false,
    sky: { zenith: [0, 0, 0], horizon: [0, 0, 0], sunset: [0, 0, 0] },
    fact: "Under a cracked shell of ice lies a salty ocean holding more water than all of Earth's seas.",
  },
  {
    id: "ganymede", name: "Ganymede", kind: "moon", radius: 2634.1, day: 171.7, tilt: 0.33, parent: "jupiter", orbitKm: 1_070_412, periodDays: 7.155, inclination: 0.2, gravity: 1.43, color: lin(0x8f8576), albedo: 0.43, landable: false,
    sky: { zenith: [0, 0, 0], horizon: [0, 0, 0], sunset: [0, 0, 0] },
    fact: "The largest moon of all, bigger than Mercury, and the only one with its own magnetic field and auroras.",
  },
  {
    id: "callisto", name: "Callisto", kind: "moon", radius: 2410.3, day: 400.5, tilt: 0, parent: "jupiter", orbitKm: 1_882_709, periodDays: 16.69, inclination: 0.28, gravity: 1.24, map: "celestial/callisto_2k.jpg", color: lin(0x5f574c), albedo: 0.22, landable: false,
    sky: { zenith: [0, 0, 0], horizon: [0, 0, 0], sunset: [0, 0, 0] },
    fact: "The most cratered surface we know: a face that has kept every impact for four billion years.",
  },
  {
    id: "saturn", name: "Saturn", kind: "gas", radius: 58_232, oblate: 0.098, day: 10.656, tilt: 26.73, planet: "saturn", gravity: 10.44, map: "celestial/saturn_4k.jpg", color: lin(0xd8c08e), albedo: 0.499, landable: false,
    atmosphere: { rayleigh: [0.95, 0.88, 0.7], thickness: 0.012, haze: 0.2, hazeColor: lin(0xe0cfa2) },
    rings: { inner: 66_900, outer: 140_220, style: "saturn" },
    fact: "Its rings are 270,000 km across yet mostly only ten metres thick: billions of pieces of water ice, from grains to houses.",
  },
  {
    id: "titan", name: "Titan", kind: "moon", radius: 2574.7, day: 382.7, tilt: 0.3, parent: "saturn", orbitKm: 1_221_870, periodDays: 15.95, inclination: 0.35, gravity: 1.35, map: "celestial/titan_2k.jpg", color: lin(0xc48a3f), albedo: 0.22, landable: false,
    atmosphere: { rayleigh: [0.95, 0.65, 0.3], thickness: 0.12, haze: 0.95, hazeColor: lin(0xc9903f) },
    sky: { zenith: lin(0x8a5a26), horizon: lin(0xc08a48), sunset: lin(0x7a4a1e) },
    fact: "The only moon with thick air and the only other world with lakes and rain — of liquid methane, under an orange sky.",
  },
  {
    id: "enceladus", name: "Enceladus", kind: "moon", radius: 252.1, day: 32.9, tilt: 0, parent: "saturn", orbitKm: 237_948, periodDays: 1.37, inclination: 0.02, gravity: 0.113, map: "celestial/enceladus_2k.jpg", color: lin(0xe8eef0), albedo: 1.375, landable: false,
    sky: { zenith: [0, 0, 0], horizon: [0, 0, 0], sunset: [0, 0, 0] },
    fact: "The whitest thing in the solar system. Geysers at its south pole spray an ocean's water into space, feeding Saturn's E ring.",
  },
  {
    id: "mimas", name: "Mimas", kind: "moon", radius: 198.2, day: 22.6, tilt: 0, parent: "saturn", orbitKm: 185_539, periodDays: 0.942, inclination: 1.57, gravity: 0.064, color: lin(0xb4b2ae), albedo: 0.96, landable: false,
    fact: "One crater, Herschel, is a third as wide as the whole moon.",
  },
  {
    id: "rhea", name: "Rhea", kind: "moon", radius: 763.8, day: 108.4, tilt: 0, parent: "saturn", orbitKm: 527_108, periodDays: 4.518, inclination: 0.35, gravity: 0.264, color: lin(0xb9b5ae), albedo: 0.949, landable: false,
    fact: "Saturn's second-largest moon: ice as hard as rock, scarred with bright wispy cliffs.",
  },
  {
    id: "iapetus", name: "Iapetus", kind: "moon", radius: 734.5, day: 1903.9, tilt: 0, parent: "saturn", orbitKm: 3_560_820, periodDays: 79.32, inclination: 15.47, gravity: 0.223, color: lin(0x7d7466), albedo: 0.6, landable: false,
    fact: "Two-faced: one hemisphere as dark as coal, the other as bright as snow, and a ridge of mountains around its equator.",
  },
  {
    id: "uranus", name: "Uranus", kind: "ice", radius: 25_362, oblate: 0.0229, day: -17.24, tilt: 97.77, planet: "uranus", gravity: 8.87, map: "celestial/uranus_2k.jpg", color: lin(0x9fd1db), albedo: 0.488, landable: false,
    atmosphere: { rayleigh: [0.55, 0.85, 0.95], thickness: 0.02, haze: 0.4, hazeColor: lin(0xa9dbe3) },
    rings: { inner: 41_837, outer: 51_149, style: "uranus" },
    fact: "Knocked on its side long ago, it rolls round the Sun: each pole has 42 years of daylight, then 42 of night.",
  },
  {
    id: "titania", name: "Titania", kind: "moon", radius: 788.4, day: 208.9, tilt: 0, parent: "uranus", orbitKm: 435_910, periodDays: 8.706, inclination: 0.34, gravity: 0.38, color: lin(0x9e958a), albedo: 0.35, landable: false,
    fact: "Uranus's largest moon, cut by canyons 1,500 km long.",
  },
  {
    id: "miranda", name: "Miranda", kind: "moon", radius: 235.8, day: 33.9, tilt: 0, parent: "uranus", orbitKm: 129_390, periodDays: 1.413, inclination: 4.34, gravity: 0.079, color: lin(0xa29d95), albedo: 0.32, landable: false,
    fact: "Verona Rupes on Miranda is the tallest cliff we know: about 20 km of sheer ice.",
  },
  {
    id: "neptune", name: "Neptune", kind: "ice", radius: 24_622, oblate: 0.0171, day: 16.11, tilt: 28.32, planet: "neptune", gravity: 11.15, map: "celestial/neptune_2k.jpg", color: lin(0x3f66c8), albedo: 0.442, landable: false,
    atmosphere: { rayleigh: [0.35, 0.55, 1.0], thickness: 0.02, haze: 0.3, hazeColor: lin(0x5f86d8) },
    rings: { inner: 41_900, outer: 62_940, style: "neptune" },
    fact: "The windiest planet: its storms blow at 2,100 km/h, though it gets a thousandth of the sunlight Earth does.",
  },
  {
    id: "triton", name: "Triton", kind: "moon", radius: 1353.4, day: -141.0, tilt: 0, parent: "neptune", orbitKm: 354_759, periodDays: -5.877, inclination: 156.9, gravity: 0.779, color: lin(0xc4b7ae), albedo: 0.76, landable: false,
    sky: { zenith: [0, 0, 0], horizon: [0, 0, 0], sunset: [0, 0, 0] },
    fact: "Orbits backwards, so it was probably captured from beyond Neptune. Nitrogen geysers streak its pink ice.",
  },
  {
    id: "pluto", name: "Pluto", kind: "dwarf", radius: 1188.3, day: -153.3, tilt: 122.5, planet: "pluto", gravity: 0.62, color: lin(0xc9ad94), albedo: 0.52, landable: false,
    atmosphere: { rayleigh: [0.4, 0.6, 1.0], thickness: 0.05, haze: 0.08, hazeColor: lin(0x8ab0e8) },
    sky: { zenith: [0, 0, 0], horizon: lin(0x0b1426), sunset: lin(0x1a3a7a) },
    fact: "A heart-shaped plain of nitrogen ice, mountains of water ice, and a thin blue haze. New Horizons flew past in 2015.",
  },
  {
    id: "charon", name: "Charon", kind: "moon", radius: 606, day: 153.3, tilt: 0, parent: "pluto", orbitKm: 19_591, periodDays: 6.387, inclination: 0.0, gravity: 0.288, color: lin(0x8f8a85), albedo: 0.38, landable: false,
    fact: "So large beside Pluto that the two swing round a point in the space between them.",
  },
]

export const BODY: Record<string, BodyDef> = Object.fromEntries(BODIES.map((b) => [b.id, b]))
