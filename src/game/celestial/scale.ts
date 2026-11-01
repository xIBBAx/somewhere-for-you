import { WATER_Y } from "../../world/hubLayout"

/**
 * The explorer scale: the sky and everything beyond it are the real universe shrunk
 * by one factor, while people, animals, trees and hills stay life-size.
 *
 * The world's sky was already built this way (fair-weather cumulus ~36 m,
 * cirrus ~66 m: real cloud heights over ~60), so 1:63.71 makes Earth exactly
 * 100 km in radius and keeps every body's size and every distance in true
 * proportion to each other: the Moon is 27.3 km across 6,034 km of space,
 * Saturn 914 km wide 9.5 the explorer-AU away. Only the shrink is a choice; no
 * distance is compressed further, and travel stays playable because the
 * celestial mount's speed grows with its distance from the nearest world.
 */
export const EARTH_SCALE = 63.71

/** Game metres per real kilometre. */
export const KM = 1000 / EARTH_SCALE
export const AU = 149_597_870.7 * KM
export const LY = 9.4607304725808e12 * KM
export const PC = 3.0856775814914e13 * KM

export const EARTH_R = 6371 * KM
/** Earth's surface (sea level) under home, in game y. */
export const DATUM_Y = WATER_Y
/** Earth's centre in the game frame: straight below home. */
export const EARTH_CENTER = { x: 0, y: DATUM_Y - EARTH_R, z: 0 } as const

/**
 * The air thins with height (Rayleigh scale height ~8.5 km, ~133 m here).
 * A little longer is used for the sky's look so the climb through the blue
 * reads over Starborn's first minute rather than in a few seconds.
 */
export const AIR_SCALE_HEIGHT = 210
/** Where wings stop finding air and Starborn spreads them as sails (~60 km real). */
export const SAIL_ALTITUDE = 950
/** The Kármán line, 100 km real: the edge of space. */
export const KARMAN = 100 * KM

/**
 * Air density relative to the ground at a height over the datum. The first
 * 40 m (home's hills and the lowest clouds) count as ground level, so the
 * sky everyone knows from the meadow is unchanged.
 */
export const AIR_FLOOR = 40
export const airDensity = (altitude: number): number => Math.exp(-Math.max(0, altitude - AIR_FLOOR) / AIR_SCALE_HEIGHT)

/** Distance to the horizon from a height over a sphere of radius r. */
export const horizonDistance = (altitude: number, r = EARTH_R): number => Math.sqrt(Math.max(0, altitude) * (2 * r + altitude))

/** Real-world kilometres for a game distance, for the HUD. */
export const realKm = (metres: number): number => (metres * EARTH_SCALE) / 1000

export const formatRealDistance = (metres: number): string => {
  const km = realKm(metres)
  const au = km / 149_597_870.7
  const ly = km / 9.4607304725808e12
  if (ly > 0.05) return `${ly < 10 ? ly.toFixed(2) : ly < 1000 ? ly.toFixed(1) : Math.round(ly).toLocaleString()} light-years`
  if (au > 0.2) return `${au < 10 ? au.toFixed(2) : au.toFixed(1)} AU`
  if (km > 1e6) return `${(km / 1e6).toFixed(2)} million km`
  if (km >= 10) return `${Math.round(km).toLocaleString()} km`
  return `${km.toFixed(1)} km`
}

/**
 * The real atmosphere's density relative to sea level (US Standard Atmosphere
 * 1976), by height in real kilometres, interpolated log-linearly. Used where
 * physics, not the sky's look, is the question: heating, and how fast the
 * sail may go while there is still air to push through.
 */
const ATMOSPHERE: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [10, 0.3376], [20, 0.07255], [30, 0.01503], [40, 0.003267], [50, 0.0008368], [60, 0.0002511],
  [70, 6.746e-5], [80, 1.53e-5], [90, 2.778e-6], [100, 4.575e-7], [110, 7.77e-8], [120, 1.814e-8],
  [150, 1.692e-9], [200, 2.07e-10], [300, 1.6e-11], [500, 4.7e-13], [1000, 2.5e-15],
]
export const realAirDensity = (realKmUp: number): number => {
  if (realKmUp <= 0) return 1
  const top = ATMOSPHERE[ATMOSPHERE.length - 1]
  if (realKmUp >= top[0]) return top[1] * Math.exp(-(realKmUp - top[0]) / 60)
  let i = 1
  while (ATMOSPHERE[i][0] < realKmUp) i++
  const [h0, r0] = ATMOSPHERE[i - 1], [h1, r1] = ATMOSPHERE[i]
  return r0 * Math.pow(r1 / r0, (realKmUp - h0) / (h1 - h0))
}
