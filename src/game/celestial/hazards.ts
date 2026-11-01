import { KM } from "./scale"
import type { BodyState } from "./universe"
import { names } from "../../personalization"

/**
 * What each world would do to a rider who tried to land, and how close
 * Starborn will go. Only Earth (home) and the Moon may be landed on; every
 * other world is approached, studied and circled from the saddle, and at its
 * floor Starborn turns aside (starSail.ts slides her along it). Nobody is hurt
 * and nothing is lost: the star-veil (her starlight round the riders) holds,
 * and the readout says why she will go no lower.
 *
 * Every figure is a measured one, with its source; where a value changes
 * with height, latitude, season or method it is given as a range or with
 * the level it was measured at. Sources:
 *   NSSDC  NASA planetary fact sheets, nssdc.gsfc.nasa.gov/planetary/factsheet/
 *   NASA   science.nasa.gov facts pages for each world
 *   SwRI   Curiosity RAD surface dose (Hassler et al. 2014)
 *   CE-4   Chang'e 4 LND lunar surface dose (Zhang et al. 2020, Sci. Adv.)
 *   NASA-Galileo  the Galileo atmospheric probe, 1995
 *   NASA-PSP      Parker Solar Probe, perihelion of 24 Dec 2024
 */

export type HazardEffect = "glare" | "heat" | "acid-haze" | "dust" | "radiation" | "storm" | "cold" | "plume" | "none"

export type Hazard = {
  /** the lowest Starborn will sail: real km over the surface (or the 1-bar level of a giant) */
  floorKm: number
  /** a short line under the world's name */
  summary: string
  /** measured conditions at the surface (or the 1-bar level), shown as the world draws near */
  facts: string[]
  /** why she will go no lower, said when she turns aside */
  refusal: string
  /** what the approach looks like (HazardVeil) */
  effect: HazardEffect
  /** the sources the facts come from */
  source: string
}

export const HAZARDS: Record<string, Hazard> = {
  sun: {
    floorKm: 1_400_000,
    summary: "A star — no surface at all",
    facts: [
      "Visible surface (photosphere): about 5,500 °C (5,772 K)",
      "Corona: over a million degrees — NASA gives up to about 2 million °C",
      "Gravity at the photosphere: 274 m/s², 28 × Earth's",
      "Parker Solar Probe, the closest any craft has come: about 6.2 million km (24 Dec 2024)",
    ],
    refusal: `Too close to the Sun — even the star-veil cannot hold back this light. ${names.starborn} turns from the glare.`,
    effect: "glare",
    source: "NSSDC Sun fact sheet; NASA Sun facts; NASA Parker Solar Probe",
  },
  mercury: {
    floorKm: 15,
    summary: "Airless, scorched by day and frozen by night",
    facts: [
      "Day: up to about 430 °C · night: down to about −180 °C",
      "No real atmosphere — a thin exosphere of oxygen, sodium, hydrogen, helium, potassium",
      "Sunlight up to 7 × as intense as on Earth, with no air to filter it",
      "Gravity 3.7 m/s² (0.38 g)",
    ],
    refusal: `Mercury's ground swings about 600 °C between day and night, with nothing to breathe and nothing to shade you. ${names.starborn} will not set down.`,
    effect: "heat",
    source: "NASA Mercury facts; NSSDC Mercury fact sheet",
  },
  venus: {
    floorKm: 75,
    summary: "The hottest planet, under clouds of sulfuric acid",
    facts: [
      "Surface: about 464 °C — hotter than Mercury, hot enough to melt lead",
      "Pressure: 92 bar, like being 900 m under the sea",
      "Air: 96.5 % carbon dioxide, 3.5 % nitrogen — a runaway greenhouse",
      "Sulfuric-acid clouds about 45–70 km up; their tops race round in about 4 days at up to ~360 km/h",
      "The longest any lander survived: Venera 13, about 2 hours (1982)",
    ],
    refusal: `Below these clouds Venus is 464 °C at 92 times Earth's air pressure. ${names.starborn} skims the cloud tops and will go no lower.`,
    effect: "acid-haze",
    source: "NSSDC Venus fact sheet; NASA Venus facts; ESA Venus Express; Venera 13 (1982)",
  },
  mars: {
    floorKm: 25,
    summary: "Cold, dusty, and almost airless",
    facts: [
      "Air pressure about 0.6 % of Earth's (4–9 mbar with the seasons) — mostly carbon dioxide (95 %)",
      "Average about −60 °C; from about +20 °C down to −153 °C",
      "Dust storms can wrap the whole planet for months",
      "Surface radiation about 0.67 mSv a day (Curiosity RAD), over 200 × a day at sea level on Earth",
      "Gravity 3.7 m/s² (0.38 g)",
    ],
    refusal: `No air to breathe, cold that would freeze you and radiation day after day. Mars is for watching from the saddle — ${names.starborn} will not land.`,
    effect: "dust",
    source: "NSSDC Mars fact sheet; NASA Mars facts; Curiosity RAD (Hassler et al. 2014)",
  },
  jupiter: {
    floorKm: 1000,
    summary: "A giant of gas — there is no ground to land on",
    facts: [
      "No solid surface: hydrogen (90 %) and helium, denser and hotter all the way down",
      "At the 1-bar level: about −108 °C; jet streams up to about 540 km/h",
      "The Great Red Spot is wider than Earth (about 1.3 Earths)",
      "Radiation belts strong enough to wreck spacecraft electronics; Juno hides its own in a titanium vault",
      "The Galileo probe fell for about an hour and reached ~23 bar before it was lost (1995)",
    ],
    refusal: `Jupiter has no surface — only cloud, then crushing, scalding depths. ${names.starborn} rides high above the storms.`,
    effect: "radiation",
    source: "NSSDC Jupiter fact sheet; NASA Jupiter facts; NASA Juno; NASA Galileo probe",
  },
  saturn: {
    floorKm: 1000,
    summary: "A giant of gas, ringed with ice — no ground",
    facts: [
      "No solid surface: hydrogen (96 %) and helium",
      "At the 1-bar level: about −139 °C",
      "Equatorial winds near 1,000 km/h (Cassini, 2004–2008)",
      "The rings are ice and rock, from dust to house-sized, mostly only tens of metres thick",
    ],
    refusal: `Saturn has no surface to stand on. ${names.starborn} keeps above the cloud tops and the rings.`,
    effect: "storm",
    source: "NSSDC Saturn fact sheet; NASA Saturn facts; Cassini (NASA technical report)",
  },
  uranus: {
    floorKm: 1000,
    summary: "An ice giant tipped on its side",
    facts: [
      "No solid surface: hydrogen, helium and methane (the methane makes it blue-green)",
      "At the 1-bar level: about −197 °C",
      "Its axis is tilted 98°: each pole has 42 years of sun, then 42 of night",
      "Winds of several hundred km/h",
    ],
    refusal: `Uranus is gas and ice with no ground beneath. ${names.starborn} will go no deeper.`,
    effect: "cold",
    source: "NSSDC Uranus fact sheet; NASA Uranus facts",
  },
  neptune: {
    floorKm: 1000,
    summary: "The windiest planet — no surface",
    facts: [
      "No solid surface: hydrogen, helium and methane",
      "At the 1-bar level: about −201 °C",
      "The fastest winds measured in the solar system: over 2,000 km/h",
      "Its sunlight is 900 times fainter than Earth's",
    ],
    refusal: `Neptune has no ground, and winds that outrun sound. ${names.starborn} holds high.`,
    effect: "storm",
    source: "NSSDC Neptune fact sheet; NASA Neptune facts",
  },
  io: {
    floorKm: 40,
    summary: "The most volcanic world known",
    facts: ["Hundreds of active volcanoes", "About −155 °C away from the lava", "Deep inside Jupiter's radiation belts"],
    refusal: `Io sits inside Jupiter's fiercest radiation, among fountains of lava. ${names.starborn} will not land here.`,
    effect: "radiation",
    source: "NSSDC Galilean satellite table; NASA Io facts",
  },
  europa: {
    floorKm: 25,
    summary: "An ice shell over a hidden ocean",
    facts: ["Surface about −170 °C", "Radiation at the surface would harm a person within hours (ESA)", "A salty ocean is thought to lie beneath the ice"],
    refusal: `Europa's ice is bathed in Jupiter's radiation. ${names.starborn} circles but will not land.`,
    effect: "radiation",
    source: "NSSDC Galilean satellite table; ESA JUICE radiation",
  },
  titan: {
    floorKm: 60,
    summary: "A moon with thick orange air and methane lakes",
    facts: ["Surface about −180 °C", "Air pressure about 1.5 × Earth's, mostly nitrogen", "Lakes and rain of liquid methane and ethane"],
    refusal: `Titan's air can't be breathed and its cold would freeze you in moments. ${names.starborn} stays above the haze.`,
    effect: "cold",
    source: "NSSDC Saturnian satellite table; NASA Titan facts",
  },
  enceladus: {
    floorKm: 10,
    summary: "Ice fountains from an ocean below",
    facts: ["Surface about −200 °C", "Geysers of water ice from cracks at its south pole"],
    refusal: `Enceladus is ice at −200 °C. ${names.starborn} will not land.`,
    effect: "plume",
    source: "NASA Enceladus facts",
  },
}

/** A world with no particular entry: the general rule. */
const GENERIC: Hazard = {
  floorKm: 12,
  summary: "Not a place to land",
  facts: ["No air to breathe, and nothing between you and the cold and the radiation"],
  refusal: `${names.starborn} will not set down here — only home and the Moon are safe to stand on.`,
  effect: "none",
  source: "NASA",
}

export const hazardOf = (id: string): Hazard => HAZARDS[id] ?? GENERIC

/** The lowest Starborn will sail over a world, in game metres over its mean radius. */
export const approachFloor = (b: BodyState): number => {
  // home's own air is flown by wing, and the Moon is landed on
  if (b.def.id === "earth" || b.def.id === "moon") return b.radius * 0.004
  return Math.max(hazardOf(b.def.id).floorKm * KM, b.radius * 0.002)
}

/** What she says at the floor. */
export const hazardNotice = (b: BodyState): string =>
  b.def.id === "moon" || b.def.id === "earth" ? `${b.def.name}'s ground is close below.` : hazardOf(b.def.id).refusal

/**
 * How near the world is, for the readout and the veil: 0 far (beyond ten
 * floors), rising to 1 at the floor.
 */
export const hazardNearness = (b: BodyState, altitude: number): number => {
  if (b.def.id === "earth" || b.def.id === "moon") return 0
  const floor = approachFloor(b)
  const x = Math.log(Math.max(altitude, floor) / floor) / Math.log(10)
  return Math.max(0, Math.min(1, 1 - x))
}
