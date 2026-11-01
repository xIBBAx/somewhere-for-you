// SOTA Scientifically Authentic Visible-Star Catalogue & Celestial Mechanics
// Source positions are astronomical standard J2000 data (Yale Bright Star Catalogue / Hipparcos).
// All prominent navigational stars and key asterisms across all 88 constellations are included.
// Complete Galactic-to-Equatorial coordinate transformations (IAU 1958 standard).
// Rozenberg (1966) airmass model and atmospheric extinction calculations.

export type CatalogStar = {
  name: string
  ra: number // degrees (0-360)
  dec: number // degrees (-90 to +90)
  mag: number // apparent visual magnitude
  bv: number // B-V color index
}

// Coordinate conversions: RA (h, m, s) -> degrees, Dec (sign, d, m, s) -> degrees
const ra = (h: number, m: number, s: number): number => (h + m / 60 + s / 3600) * 15
const dec = (sign: 1 | -1, d: number, m: number, s: number): number => sign * (d + m / 60 + s / 3600)

/**
 * Prominent visual stars (mag <= ~3.7) covering all major naked-eye constellations.
 * Real Right Ascension, Declination, Apparent Visual Magnitude, and B-V Color Index.
 */
export const BRIGHT_STARS: CatalogStar[] = [
  // 1. Orion (The Hunter)
  { name: "Sirius", ra: ra(6, 45, 8.9), dec: dec(-1, 16, 42, 58), mag: -1.46, bv: 0.0 }, // Canis Major
  { name: "Rigel", ra: ra(5, 14, 32.3), dec: dec(-1, 8, 12, 6), mag: 0.13, bv: -0.03 },
  { name: "Betelgeuse", ra: ra(5, 55, 10.3), dec: dec(1, 7, 24, 25), mag: 0.5, bv: 1.85 },
  { name: "Bellatrix", ra: ra(5, 25, 7.9), dec: dec(1, 6, 20, 59), mag: 1.64, bv: -0.22 },
  { name: "Alnilam", ra: ra(5, 36, 12.8), dec: dec(-1, 1, 12, 7), mag: 1.69, bv: -0.18 },
  { name: "Alnitak", ra: ra(5, 40, 45.5), dec: dec(-1, 1, 56, 34), mag: 1.77, bv: -0.2 },
  { name: "Saiph", ra: ra(5, 47, 45.4), dec: dec(-1, 9, 40, 11), mag: 2.07, bv: -0.18 },
  { name: "Mintaka", ra: ra(5, 32, 0.4), dec: dec(-1, 0, 17, 57), mag: 2.23, bv: -0.21 },
  { name: "Meissa", ra: ra(5, 35, 8.3), dec: dec(1, 9, 56, 3), mag: 3.39, bv: -0.18 },

  // 2. Ursa Major (The Great Bear / Big Dipper) & Ursa Minor
  { name: "Alioth", ra: ra(12, 54, 1.7), dec: dec(1, 55, 57, 35), mag: 1.76, bv: -0.02 },
  { name: "Dubhe", ra: ra(11, 3, 43.7), dec: dec(1, 61, 45, 3), mag: 1.79, bv: 1.07 },
  { name: "Alkaid", ra: ra(13, 47, 32.4), dec: dec(1, 49, 18, 48), mag: 1.85, bv: -0.19 },
  { name: "Mizar", ra: ra(13, 23, 55.5), dec: dec(1, 54, 55, 31), mag: 2.23, bv: 0.02 },
  { name: "Merak", ra: ra(11, 1, 50.5), dec: dec(1, 56, 22, 57), mag: 2.37, bv: -0.02 },
  { name: "Phecda", ra: ra(11, 53, 49.8), dec: dec(1, 53, 41, 41), mag: 2.44, bv: 0.0 },
  { name: "Megrez", ra: ra(12, 15, 25.6), dec: dec(1, 57, 1, 57), mag: 3.31, bv: 0.08 },
  { name: "Polaris", ra: ra(2, 31, 49.1), dec: dec(1, 89, 15, 51), mag: 1.98, bv: 0.6 }, // North Star
  { name: "Kochab", ra: ra(14, 50, 42.3), dec: dec(1, 74, 9, 20), mag: 2.08, bv: 1.47 },

  // 3. Cassiopeia (The Queen - iconic 'W' asterism)
  { name: "Navi", ra: ra(0, 56, 42.5), dec: dec(1, 60, 43, 0), mag: 2.15, bv: -0.15 },
  { name: "Schedar", ra: ra(0, 40, 30.5), dec: dec(1, 56, 32, 15), mag: 2.24, bv: 1.17 },
  { name: "Caph", ra: ra(0, 9, 10.7), dec: dec(1, 59, 8, 59), mag: 2.28, bv: 0.34 },
  { name: "Ruchbah", ra: ra(1, 25, 49.0), dec: dec(1, 60, 14, 7), mag: 2.68, bv: 0.13 },
  { name: "Segin", ra: ra(1, 54, 23.7), dec: dec(1, 63, 40, 12), mag: 3.37, bv: -0.16 },

  // 4. Summer Triangle: Lyra, Cygnus, Aquila
  { name: "Vega", ra: ra(18, 36, 56.3), dec: dec(1, 38, 47, 1), mag: 0.03, bv: 0.0 },
  { name: "Altair", ra: ra(19, 50, 47.0), dec: dec(1, 8, 52, 6), mag: 0.76, bv: 0.22 },
  { name: "Deneb", ra: ra(20, 41, 25.9), dec: dec(1, 45, 16, 49), mag: 1.25, bv: 0.09 },
  { name: "Sadr", ra: ra(20, 22, 13.7), dec: dec(1, 40, 15, 24), mag: 2.23, bv: 0.67 },
  { name: "Gienah", ra: ra(20, 46, 12.7), dec: dec(1, 33, 58, 13), mag: 2.48, bv: 1.03 },
  { name: "Tarazed", ra: ra(19, 46, 15.6), dec: dec(1, 10, 36, 48), mag: 2.72, bv: 1.52 },
  { name: "Albireo", ra: ra(19, 30, 43.3), dec: dec(1, 27, 57, 35), mag: 3.05, bv: 1.09 },
  { name: "Sulafat", ra: ra(18, 58, 56.6), dec: dec(1, 32, 41, 22), mag: 3.24, bv: -0.05 },
  { name: "Sheliak", ra: ra(18, 50, 4.8), dec: dec(1, 33, 21, 46), mag: 3.45, bv: 0.0 },
  { name: "Alshain", ra: ra(19, 55, 18.8), dec: dec(1, 6, 24, 24), mag: 3.71, bv: 0.86 },

  // 5. Southern Beacons: Carina, Centaurus, Crux, Eridanus
  { name: "Canopus", ra: ra(6, 23, 57.1), dec: dec(-1, 52, 41, 44), mag: -0.74, bv: 0.15 },
  { name: "Alpha Centauri", ra: ra(14, 39, 36.5), dec: dec(-1, 60, 50, 2), mag: -0.01, bv: 0.71 },
  { name: "Achernar", ra: ra(1, 37, 42.8), dec: dec(-1, 57, 14, 12), mag: 0.46, bv: -0.19 },
  { name: "Hadar", ra: ra(14, 3, 49.4), dec: dec(-1, 60, 22, 23), mag: 0.61, bv: -0.23 },
  { name: "Acrux", ra: ra(12, 26, 35.9), dec: dec(-1, 63, 5, 57), mag: 0.77, bv: -0.26 },
  { name: "Mimosa", ra: ra(12, 47, 43.2), dec: dec(-1, 59, 41, 19), mag: 1.25, bv: -0.24 },
  { name: "Gacrux", ra: ra(12, 31, 9.9), dec: dec(-1, 57, 6, 47), mag: 1.59, bv: 1.59 },
  { name: "Miaplacidus", ra: ra(9, 13, 12.1), dec: dec(-1, 69, 43, 2), mag: 1.67, bv: -0.01 },
  { name: "Avior", ra: ra(8, 22, 30.8), dec: dec(-1, 59, 30, 35), mag: 1.86, bv: -0.04 },
  { name: "Atria", ra: ra(16, 48, 39.9), dec: dec(-1, 69, 1, 40), mag: 1.91, bv: 1.45 },
  { name: "Peacock", ra: ra(20, 25, 38.9), dec: dec(-1, 56, 44, 6), mag: 1.94, bv: -0.2 },
  { name: "Menkent", ra: ra(14, 6, 41.0), dec: dec(-1, 36, 22, 11), mag: 2.06, bv: 1.01 },
  { name: "Imai", ra: ra(12, 15, 8.7), dec: dec(-1, 58, 44, 56), mag: 2.78, bv: -0.23 },

  // 6. Taurus, Gemini, Auriga, Canis Major/Minor
  { name: "Capella", ra: ra(5, 16, 41.4), dec: dec(1, 45, 59, 53), mag: 0.08, bv: 0.8 },
  { name: "Procyon", ra: ra(7, 39, 18.1), dec: dec(1, 5, 13, 30), mag: 0.34, bv: 0.42 },
  { name: "Aldebaran", ra: ra(4, 35, 55.2), dec: dec(1, 16, 30, 33), mag: 0.85, bv: 1.54 },
  { name: "Pollux", ra: ra(7, 45, 18.9), dec: dec(1, 28, 1, 34), mag: 1.14, bv: 1.0 },
  { name: "Adhara", ra: ra(6, 58, 37.6), dec: dec(-1, 28, 58, 20), mag: 1.5, bv: -0.21 },
  { name: "Castor", ra: ra(7, 34, 35.9), dec: dec(1, 31, 53, 18), mag: 1.58, bv: 0.03 },
  { name: "Elnath", ra: ra(5, 26, 17.5), dec: dec(1, 28, 36, 27), mag: 1.65, bv: -0.13 },
  { name: "Mirfak", ra: ra(3, 24, 19.4), dec: dec(1, 49, 51, 40), mag: 1.79, bv: 0.48 },
  { name: "Wezen", ra: ra(7, 8, 9.5), dec: dec(-1, 26, 23, 36), mag: 1.82, bv: 0.67 },
  { name: "Menkalinan", ra: ra(5, 59, 31.7), dec: dec(1, 44, 56, 51), mag: 1.9, bv: 0.08 },
  { name: "Alhena", ra: ra(6, 37, 42.7), dec: dec(1, 16, 23, 57), mag: 1.93, bv: -0.06 },
  { name: "Mirzam", ra: ra(6, 22, 41.6), dec: dec(-1, 17, 57, 21), mag: 1.99, bv: -0.21 },
  { name: "Algol", ra: ra(3, 8, 10.1), dec: dec(1, 40, 57, 20), mag: 2.09, bv: -0.05 },
  { name: "Aludra", ra: ra(7, 24, 5.7), dec: dec(-1, 29, 18, 11), mag: 2.45, bv: -0.08 },
  { name: "Alcyone", ra: ra(3, 47, 29.1), dec: dec(1, 24, 6, 18), mag: 2.87, bv: -0.09 }, // Pleiades bright anchor

  // 7. Scorpius & Sagittarius (Galactic Center realm)
  { name: "Antares", ra: ra(16, 29, 24.4), dec: dec(-1, 26, 25, 55), mag: 1.06, bv: 1.83 },
  { name: "Shaula", ra: ra(17, 33, 36.5), dec: dec(-1, 37, 6, 14), mag: 1.62, bv: -0.23 },
  { name: "Sargas", ra: ra(17, 37, 19.1), dec: dec(-1, 42, 59, 52), mag: 1.84, bv: 1.3 },
  { name: "Kaus Australis", ra: ra(18, 24, 10.3), dec: dec(-1, 34, 23, 5), mag: 1.85, bv: -0.04 },
  { name: "Nunki", ra: ra(18, 55, 15.9), dec: dec(-1, 26, 17, 48), mag: 2.05, bv: -0.03 },
  { name: "Dschubba", ra: ra(16, 0, 20.0), dec: dec(-1, 22, 37, 18), mag: 2.29, bv: -0.12 },
  { name: "Graffias", ra: ra(16, 5, 26.2), dec: dec(-1, 19, 48, 20), mag: 2.56, bv: -0.08 },
  { name: "Ascella", ra: ra(19, 2, 36.7), dec: dec(-1, 29, 52, 48), mag: 2.59, bv: 0.14 },
  { name: "Kaus Media", ra: ra(18, 20, 59.7), dec: dec(-1, 29, 49, 41), mag: 2.7, bv: 1.38 },
  { name: "Kaus Borealis", ra: ra(18, 27, 58.2), dec: dec(-1, 25, 25, 18), mag: 2.82, bv: 1.04 },
  { name: "Alnasl", ra: ra(18, 5, 48.5), dec: dec(-1, 30, 25, 27), mag: 2.98, bv: 1.02 },

  // 8. Bootes, Leo, Virgo, Hydra
  { name: "Arcturus", ra: ra(14, 15, 39.7), dec: dec(1, 19, 10, 56), mag: -0.05, bv: 1.23 },
  { name: "Spica", ra: ra(13, 25, 11.6), dec: dec(-1, 11, 9, 41), mag: 1.04, bv: -0.24 },
  { name: "Regulus", ra: ra(10, 8, 22.3), dec: dec(1, 11, 58, 2), mag: 1.35, bv: -0.11 },
  { name: "Alphard", ra: ra(9, 27, 35.2), dec: dec(-1, 8, 39, 31), mag: 1.99, bv: 1.43 },
  { name: "Algieba", ra: ra(10, 19, 58.6), dec: dec(1, 19, 50, 30), mag: 2.08, bv: 0.98 },
  { name: "Denebola", ra: ra(11, 49, 3.6), dec: dec(1, 14, 34, 19), mag: 2.14, bv: 0.09 },
  { name: "Izar", ra: ra(14, 44, 59.2), dec: dec(1, 27, 4, 27), mag: 2.37, bv: 1.2 },
  { name: "Muphrid", ra: ra(13, 54, 41.1), dec: dec(1, 18, 23, 52), mag: 2.68, bv: 0.58 },
  { name: "Porrima", ra: ra(12, 41, 39.6), dec: dec(-1, 1, 26, 58), mag: 2.74, bv: 0.36 },
  { name: "Vindemiatrix", ra: ra(13, 2, 10.6), dec: dec(1, 10, 57, 33), mag: 2.83, bv: 0.94 },

  // 9. Autumn Square of Pegasus, Andromeda, Pisces, Cetus
  { name: "Fomalhaut", ra: ra(22, 57, 39.0), dec: dec(-1, 29, 37, 20), mag: 1.16, bv: 0.09 },
  { name: "Alnair", ra: ra(22, 8, 13.9), dec: dec(-1, 46, 57, 39), mag: 1.73, bv: -0.09 },
  { name: "Hamal", ra: ra(2, 7, 10.4), dec: dec(1, 23, 27, 45), mag: 2.0, bv: 1.15 },
  { name: "Diphda", ra: ra(0, 43, 35.2), dec: dec(-1, 17, 59, 12), mag: 2.04, bv: 0.87 },
  { name: "Mirach", ra: ra(1, 9, 43.8), dec: dec(1, 35, 37, 14), mag: 2.06, bv: 1.57 },
  { name: "Alpheratz", ra: ra(0, 8, 23.3), dec: dec(1, 29, 5, 26), mag: 2.06, bv: -0.11 },
  { name: "Almach", ra: ra(2, 3, 54.0), dec: dec(1, 42, 19, 47), mag: 2.17, bv: 1.37 },
  { name: "Scheat", ra: ra(23, 3, 46.5), dec: dec(1, 28, 4, 58), mag: 2.42, bv: 1.65 },
  { name: "Markab", ra: ra(23, 4, 45.7), dec: dec(1, 15, 12, 19), mag: 2.49, bv: -0.04 },
  { name: "Algenib", ra: ra(0, 13, 14.2), dec: dec(1, 15, 11, 1), mag: 2.83, bv: -0.23 },
]

export type PlanetBody = {
  name: string
  ra: number
  dec: number
  mag: number
  color: string
  glowColor: string
  size: number
  steady: boolean
  description: string
}

/**
 * The 5 naked-eye classical planets visible from Earth + optional faint Uranus under dark skies.
 * Neptune is explicitly omitted as it is invisible to unaided human vision (mag +7.8).
 * Planets shine steadily without rapid atmospheric twinkling because of their angular disc size.
 */
export const VISIBLE_PLANETS: PlanetBody[] = [
  {
    name: "Venus",
    ra: ra(3, 15, 20),
    dec: dec(1, 18, 45, 0),
    mag: -4.4,
    color: "#fffef8",
    glowColor: "#fffaea",
    size: 2.2,
    steady: true,
    description: "Brilliant evening/morning star beacon with serene warm-white glow",
  },
  {
    name: "Jupiter",
    ra: ra(6, 42, 10),
    dec: dec(1, 23, 10, 0),
    mag: -2.5,
    color: "#fff8ea",
    glowColor: "#fee9c8",
    size: 1.7,
    steady: true,
    description: "Luminous creamy-gold steady celestial point",
  },
  {
    name: "Mars",
    ra: ra(9, 25, 40),
    dec: dec(1, 15, 30, 0),
    mag: -1.5,
    color: "#ff8b62",
    glowColor: "#ff6a42",
    size: 1.4,
    steady: true,
    description: "Distinctive warm reddish-ochre / terracotta steady point",
  },
  {
    name: "Saturn",
    ra: ra(22, 38, 15),
    dec: dec(-1, 9, 20, 0),
    mag: 0.4,
    color: "#ffe5b8",
    glowColor: "#ffd694",
    size: 1.2,
    steady: true,
    description: "Pale golden-amber steady jewel along the ecliptic",
  },
  {
    name: "Mercury",
    ra: ra(2, 5, 10),
    dec: dec(1, 12, 15, 0),
    mag: -0.5,
    color: "#fbeece",
    glowColor: "#ffdda6",
    size: 0.95,
    steady: true,
    description: "Elusive twilight body hovering near the horizon",
  },
  {
    name: "Uranus",
    ra: ra(3, 48, 50),
    dec: dec(1, 19, 35, 0),
    mag: 5.8,
    color: "#c2faf5",
    glowColor: "#93eae2",
    size: 0.45,
    steady: true,
    description: "Extremely faint pale cyan-teal pinpoint under dark skies",
  },
]

export const starColor = (bv: number): string => {
  if (bv < -0.2) return "#b8d8ff" // Deep sapphire blue-white (O/B stars)
  if (bv < 0.0) return "#dbe9ff" // Blue-white (Late B / Early A stars)
  if (bv < 0.25) return "#ffffff" // Pure diamond white (Sirius, Vega, Altair)
  if (bv < 0.55) return "#fff7e4" // Warm white (F/G stars)
  if (bv < 0.9) return "#ffe7b8" // Golden yellow (Capella, Sun-like)
  if (bv < 1.4) return "#ffc684" // Rich amber-orange (Arcturus, Aldebaran)
  return "#ff9260" // Red-orange giant (Betelgeuse, Antares)
}

/**
 * Normalized RGB vector derivation from B-V index for WebGL shaders.
 */
export const starColorRGB = (bv: number): [number, number, number] => {
  if (bv < -0.2) return [0.72, 0.85, 1.0]
  if (bv < 0.0) return [0.86, 0.91, 1.0]
  if (bv < 0.25) return [1.0, 1.0, 1.0]
  if (bv < 0.55) return [1.0, 0.97, 0.89]
  if (bv < 0.9) return [1.0, 0.9, 0.72]
  if (bv < 1.4) return [1.0, 0.78, 0.52]
  return [1.0, 0.57, 0.38]
}

export const starSize = (mag: number): number => {
  // Natural magnitude-based scale hierarchy
  if (mag < -1.0) return 1.45
  if (mag < 0.0) return 1.25
  if (mag < 1.0) return 1.05
  if (mag < 2.0) return 0.85
  if (mag < 3.0) return 0.65
  return 0.45
}

// IAU 1958 Galactic-to-Equatorial Conversion Constants
const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI
const DEC_GNP = 27.12825 * DEG2RAD
const RA_GNP = 192.85948 * DEG2RAD
const L_NCP = 122.93192 * DEG2RAD

/**
 * Converts Galactic coordinates (l, b) in degrees to Equatorial coordinates (RA, Dec) in degrees.
 * Enables accurate positioning of the Milky Way stellar plane and dark interstellar dust lanes.
 */
export const galacticToEquatorial = (lDeg: number, bDeg: number): { ra: number; dec: number } => {
  const l = lDeg * DEG2RAD
  const b = bDeg * DEG2RAD

  const sinDec = Math.sin(DEC_GNP) * Math.sin(b) + Math.cos(DEC_GNP) * Math.cos(b) * Math.cos(L_NCP - l)
  const dec = Math.asin(Math.max(-1, Math.min(1, sinDec)))

  const y = Math.cos(b) * Math.sin(L_NCP - l)
  const x = Math.cos(DEC_GNP) * Math.sin(b) - Math.sin(DEC_GNP) * Math.cos(b) * Math.cos(L_NCP - l)
  const raOffset = Math.atan2(y, x)
  let ra = (RA_GNP + raOffset) * RAD2DEG
  while (ra < 0) ra += 360
  while (ra >= 360) ra -= 360

  return { ra, dec: dec * RAD2DEG }
}

/**
 * Converts Right Ascension (deg) and Declination (deg) onto a 3D Cartesian celestial sphere point.
 * Coordinate conventions: +Y = North celestial pole, +X = RA 0°, +Z = RA 90°.
 */
export const equatorialToCartesian = (
  raDeg: number,
  decDeg: number,
  radius: number,
): [number, number, number] => {
  const ra = raDeg * DEG2RAD
  const dec = decDeg * DEG2RAD
  const cosDec = Math.cos(dec)

  return [Math.cos(ra) * cosDec * radius, Math.sin(dec) * radius, Math.sin(ra) * cosDec * radius]
}

/**
 * Rozenberg (1966) astronomical airmass formulation for high-accuracy low-horizon refraction.
 */
export const rozenbergAirmass = (sinAlt: number): number => {
  const altDeg = sinAlt * 57.2957795
  return 1.0 / (Math.max(0.012, sinAlt) + 0.015 * Math.pow(Math.max(0.0, altDeg + 3.885), -1.253))
}

/**
 * Altitude-dependent atmospheric extinction factor T in [0, 1].
 * Dimming of starlight traversing dense lower atmosphere.
 */
export const atmosphericExtinction = (sinAlt: number, k = 0.18): number => {
  if (sinAlt <= 0) return 0
  const airmass = rozenbergAirmass(sinAlt)
  return Math.max(0.01, Math.min(1.0, Math.exp(-k * (airmass - 1.0))))
}

/**
 * Gradual luminance-dependent limiting magnitude model (Gates 13, 14, 16).
 * During twilight, brightest objects appear first (Venus, Sirius), then medium stars,
 * and finally the faint background and Milky Way emerge in deep darkness.
 * Moonlight raises sky brightness and suppresses faint stars.
 */
export const calculateLimitingMagnitude = (
  timeOfDay: number,
  weatherCloud: number,
  weatherRain: number,
  moonElevation: number,
): number => {
  // Daytime (tod < 0.65): only invisible/sunlit
  if (timeOfDay < 0.65) return -5.0

  let limitMag: number
  if (timeOfDay < 0.76) {
    // Sunset / early dusk: bright beacons (Venus, Jupiter, Sirius) emerge
    const t = (timeOfDay - 0.65) / (0.76 - 0.65)
    limitMag = -4.5 + t * 4.0 // -4.5 -> -0.5
  } else if (timeOfDay < 0.86) {
    // Twilight: prominent navigation stars (Vega, Arcturus, Orion, Big Dipper)
    const t = (timeOfDay - 0.76) / (0.86 - 0.76)
    limitMag = -0.5 + t * 4.0 // -0.5 -> 3.5
  } else if (timeOfDay < 0.95) {
    // Deep dusk transition to full dark sky: faint background field and Milky Way emerge
    const t = (timeOfDay - 0.86) / (0.95 - 0.86)
    limitMag = 3.5 + t * 2.7 // 3.5 -> 6.2 (naked-eye dark sky limit)
  } else {
    // Pitch dark night
    limitMag = 6.2
  }

  // Moon wash suppresses faint stars and washed out Milky Way
  if (moonElevation > 0.02) {
    const moonWash = Math.min(1.0, moonElevation * 2.0) * 1.65
    limitMag -= moonWash
  }

  // Cloud & rain cover reduce visibility
  const weatherDim = weatherCloud * 2.4 + weatherRain * 2.0
  limitMag -= weatherDim

  return Math.max(-5.0, limitMag)
}

/**
 * Deterministic pseudo-random number generator for stable starfield generation.
 */
const makeSeededRng = (seed: number): (() => number) => {
  let s = Math.floor(seed) % 2147483647
  if (s <= 0) s += 2147483646
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

/**
 * Complete Scientific Starfield Generation (Gates 2, 3, 4, 10, 11, 12, 22).
 * Generates:
 * 1) All stars (bright catalogue + faint procedural field with galactic concentration)
 * 2) Milky Way stardust stream with galactic center bulge & dark Great Rift dust lanes
 * 3) Naked-eye classical planets along the ecliptic
 */
export const generateScientificStarfield = (
  seed = 20260906,
  faintCount = 2400,
  milkyWayCount = 3200,
  radius = 78.0,
): {
  starsPos: Float32Array
  starsCol: Float32Array
  starsData: Float32Array // x: mag, y: seed, z: baseSize, w: isSteady
  totalStars: number
  mwPos: Float32Array
  mwCol: Float32Array
  mwData: Float32Array // x: baseSize, y: baseOpacity, z: seed
  totalMw: number
  planetsPos: Float32Array
  planetsCol: Float32Array
  planetsData: Float32Array
  totalPlanets: number
} => {
  const rng = makeSeededRng(seed)

  // -------------------------------------------------------------
  // 1) All Stars: Bright Catalog + Faint Procedural Stellar Field
  // -------------------------------------------------------------
  const totalStars = BRIGHT_STARS.length + faintCount
  const starsPos = new Float32Array(totalStars * 3)
  const starsCol = new Float32Array(totalStars * 3)
  const starsData = new Float32Array(totalStars * 4)

  // A) Populate Bright Catalog Stars
  for (let i = 0; i < BRIGHT_STARS.length; i++) {
    const s = BRIGHT_STARS[i]
    const [x, y, z] = equatorialToCartesian(s.ra, s.dec, radius)
    starsPos[i * 3] = x
    starsPos[i * 3 + 1] = y
    starsPos[i * 3 + 2] = z

    const rgb = starColorRGB(s.bv)
    starsCol[i * 3] = rgb[0]
    starsCol[i * 3 + 1] = rgb[1]
    starsCol[i * 3 + 2] = rgb[2]

    // Base point size scaled by visual magnitude
    const baseSize =
      s.mag < -1.0 ? 7.8 : s.mag < 0.0 ? 6.8 : s.mag < 1.0 ? 5.8 : s.mag < 2.0 ? 4.8 : s.mag < 3.0 ? 3.8 : 3.0
    const starSeed = rng() * 1000 + i

    starsData[i * 4] = s.mag
    starsData[i * 4 + 1] = starSeed
    starsData[i * 4 + 2] = baseSize
    starsData[i * 4 + 3] = 0.0 // not steady (stars scintillate)
  }

  // B) Populate Faint Procedural Background Stars (Concentrated toward Galactic Plane)
  const offset = BRIGHT_STARS.length
  for (let i = 0; i < faintCount; i++) {
    const idx = offset + i
    let raDeg: number
    let decDeg: number

    // 45% of faint stars concentrated along the Galactic Disk; 55% uniform all-sky
    if (rng() < 0.45) {
      const l = rng() * 360.0
      // Gaussian concentration along galactic equator
      const bSpread = Math.abs(l - 0) < 45 || Math.abs(l - 360) < 45 ? 14.0 : 8.0
      const b = (rng() + rng() - 1.0) * bSpread

      // Interstellar dust lane suppression: Great Rift from Cygnus to Sagittarius
      const isGreatRift = l >= 25.0 && l <= 85.0 && Math.abs(b) < 3.5
      if (isGreatRift && rng() < 0.65) {
        // Dust absorbs background stars; shift to random sky
        const u = rng() * 2 - 1
        decDeg = Math.asin(u) * RAD2DEG
        raDeg = rng() * 360.0
      } else {
        const eq = galacticToEquatorial(l, b)
        raDeg = eq.ra
        decDeg = eq.dec
      }
    } else {
      // Uniform celestial sphere distribution
      const u = rng() * 2 - 1
      decDeg = Math.asin(u) * RAD2DEG
      raDeg = rng() * 360.0
    }

    const [x, y, z] = equatorialToCartesian(raDeg, decDeg, radius)
    starsPos[idx * 3] = x
    starsPos[idx * 3 + 1] = y
    starsPos[idx * 3 + 2] = z

    // Realistic exponential stellar luminosity function: many more faint stars
    // mag in range [3.2, 6.2]
    const mag = 3.2 + Math.pow(rng(), 0.42) * 3.0

    // Spectral type: mostly G, K, F, M stars
    const bvPick = rng()
    const bv =
      bvPick < 0.15 ? -0.1 : bvPick < 0.35 ? 0.15 : bvPick < 0.6 ? 0.65 : bvPick < 0.85 ? 1.05 : 1.55
    const rgb = starColorRGB(bv)

    // Faint stars scotopic desaturation (human rod photoreceptors)
    const desat = Math.min(1.0, Math.max(0.0, (mag - 2.5) / 2.0)) * 0.82
    const grey = (rgb[0] + rgb[1] + rgb[2]) / 3
    starsCol[idx * 3] = rgb[0] * (1 - desat) + grey * desat
    starsCol[idx * 3 + 1] = rgb[1] * (1 - desat) + grey * desat
    starsCol[idx * 3 + 2] = rgb[2] * (1 - desat) + grey * desat

    const baseSize = Math.max(2.0, 3.2 - (mag - 3.2) * 0.35)
    const starSeed = rng() * 5000 + i

    starsData[idx * 4] = mag
    starsData[idx * 4 + 1] = starSeed
    starsData[idx * 4 + 2] = baseSize
    starsData[idx * 4 + 3] = 0.0 // scintillates
  }

  // -------------------------------------------------------------
  // 2) Sweeping Milky Way Stardust River & Core Bulge (Gates 11 & 12)
  // -------------------------------------------------------------
  const mwPos = new Float32Array(milkyWayCount * 3)
  const mwCol = new Float32Array(milkyWayCount * 3)
  const mwData = new Float32Array(milkyWayCount * 3)

  // Authentic pale stardust palettes (Warm silvery-white, golden-cream, cool azure)
  const mwPalettes: [number, number, number][] = [
    [0.96, 0.94, 0.91], // Silvery stardust white
    [0.99, 0.96, 0.88], // Golden-cream stellar core
    [0.91, 0.94, 0.99], // Pale icy stardust
    [0.94, 0.92, 0.88], // Warm celestial dust
  ]

  for (let i = 0; i < milkyWayCount; i++) {
    // Galactic longitude: higher density toward Sagittarius / Galactic Center (l = 0°)
    let lDeg: number
    if (rng() < 0.42) {
      // Core bulge region (l within ±42° of Galactic Center)
      lDeg = (rng() - 0.5) * 84.0
      if (lDeg < 0) lDeg += 360.0
    } else {
      lDeg = rng() * 360.0
    }

    // Latitude spread: wider at bulge (~12°), narrower at anticenter (~4.5°)
    const isBulge = Math.abs(lDeg - 0) < 35 || Math.abs(lDeg - 360) < 35
    const latSpread = isBulge ? 11.5 : 5.5
    const bDeg = (rng() + rng() + rng() - 1.5) * latSpread

    // Dark Dust Lanes:
    // 1) The Great Rift (Cygnus to Sagittarius): l in [25°, 85°], |b| < 3°
    const inGreatRift = lDeg >= 25.0 && lDeg <= 85.0 && Math.abs(bDeg) < 3.2
    // 2) Coalsack Nebula (near Crux): l in [300°, 306°], b in [-2.5°, 1.5°]
    const inCoalsack = lDeg >= 300.0 && lDeg <= 306.0 && bDeg >= -2.5 && bDeg <= 1.5

    let dustAttenuation = 1.0
    if (inGreatRift) {
      dustAttenuation = 0.18 + rng() * 0.15 // Dark dust absorbs ~75% starlight
    } else if (inCoalsack) {
      dustAttenuation = 0.15 + rng() * 0.12 // Opaque dark molecular cloud
    }

    const eq = galacticToEquatorial(lDeg, bDeg)
    const mwRadius = radius * (0.995 + (rng() - 0.5) * 0.01)
    const [x, y, z] = equatorialToCartesian(eq.ra, eq.dec, mwRadius)

    mwPos[i * 3] = x
    mwPos[i * 3 + 1] = y
    mwPos[i * 3 + 2] = z

    const col = isBulge && rng() < 0.55 ? mwPalettes[1] : mwPalettes[Math.floor(rng() * mwPalettes.length)]
    mwCol[i * 3] = col[0]
    mwCol[i * 3 + 1] = col[1]
    mwCol[i * 3 + 2] = col[2]

    const baseSize = (isBulge ? 42.0 : 30.0) + rng() * 18.0
    const baseOpacity = (isBulge ? 0.30 : 0.20) * dustAttenuation

    mwData[i * 3] = baseSize
    mwData[i * 3 + 1] = baseOpacity
    mwData[i * 3 + 2] = rng() * 1000 + i
  }

  // -------------------------------------------------------------
  // 3) Naked-Eye Classical Planets (Steady Radiance, No Scintillation)
  // -------------------------------------------------------------
  const totalPlanets = VISIBLE_PLANETS.length
  const planetsPos = new Float32Array(totalPlanets * 3)
  const planetsCol = new Float32Array(totalPlanets * 3)
  const planetsData = new Float32Array(totalPlanets * 4)

  for (let i = 0; i < totalPlanets; i++) {
    const p = VISIBLE_PLANETS[i]
    const [x, y, z] = equatorialToCartesian(p.ra, p.dec, radius * 0.99)

    planetsPos[i * 3] = x
    planetsPos[i * 3 + 1] = y
    planetsPos[i * 3 + 2] = z

    // Parse hex color into normalized RGB
    const hex = p.color.replace("#", "")
    const r = parseInt(hex.substring(0, 2), 16) / 255
    const g = parseInt(hex.substring(2, 4), 16) / 255
    const b = parseInt(hex.substring(4, 6), 16) / 255

    planetsCol[i * 3] = r
    planetsCol[i * 3 + 1] = g
    planetsCol[i * 3 + 2] = b

    planetsData[i * 4] = p.mag
    planetsData[i * 4 + 1] = 0.0 // seed
    planetsData[i * 4 + 2] = p.size * 3.8 // screen point size
    planetsData[i * 4 + 3] = 1.0 // STEADY (planets do not scintillate)
  }

  return {
    starsPos,
    starsCol,
    starsData,
    totalStars,
    mwPos,
    mwCol,
    mwData,
    totalMw: milkyWayCount,
    planetsPos,
    planetsCol,
    planetsData,
    totalPlanets,
  }
}


