/**
 * Where the planets really are: heliocentric positions from the JPL
 * "Keplerian Elements for Approximate Positions of the Major Planets"
 * (E. M. Standish, JPL/Caltech; Table 1, valid 1800-2050 AD, accurate to a
 * few arcminutes for the inner planets), J2000 ecliptic and equinox.
 *
 * Positions are in astronomical units. Pluto is from the same table.
 */

export type PlanetId = "mercury" | "venus" | "earth" | "mars" | "jupiter" | "saturn" | "uranus" | "neptune" | "pluto"

// a, e, I, L, long.peri, long.node at J2000, then their rates per century
const ELEMENTS: Record<PlanetId, [number[], number[]]> = {
  mercury: [[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  venus: [[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]],
  earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]],
  mars: [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  jupiter: [[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  uranus: [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503], [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
  neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]],
  pluto: [[39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684], [-0.00031596, 0.0000517, 0.00004818, 145.20780515, -0.04062942, -0.01183482]],
}

export const PLANET_IDS = Object.keys(ELEMENTS) as PlanetId[]

const RAD = Math.PI / 180

/** Julian date of a JS date. */
export const julianDate = (date: Date): number => date.getTime() / 86400000 + 2440587.5

/** Obliquity of the ecliptic at J2000 (radians). */
export const OBLIQUITY = 23.43928 * RAD

/** Heliocentric ecliptic J2000 position (AU) of a planet at a Julian date. */
export const heliocentric = (id: PlanetId, jd: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] => {
  const T = (jd - 2451545.0) / 36525
  const [e0, r] = ELEMENTS[id]
  const a = e0[0] + r[0] * T
  const e = e0[1] + r[1] * T
  const I = (e0[2] + r[2] * T) * RAD
  const L = e0[3] + r[3] * T
  const peri = e0[4] + r[4] * T
  const node = e0[5] + r[5] * T
  const w = (peri - node) * RAD
  const O = node * RAD
  let M = ((L - peri) % 360) * RAD
  if (M > Math.PI) M -= 2 * Math.PI
  if (M < -Math.PI) M += 2 * Math.PI
  // Kepler's equation, Newton's method
  let E = M + e * Math.sin(M)
  for (let k = 0; k < 8; k++) {
    const dE = (M - (E - e * Math.sin(E))) / (1 - e * Math.cos(E))
    E += dE
    if (Math.abs(dE) < 1e-12) break
  }
  const xp = a * (Math.cos(E) - e)
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E)
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I)
  out[0] = (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp
  out[1] = (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp
  out[2] = sw * sI * xp + cw * sI * yp
  return out
}

/** Ecliptic J2000 → equatorial J2000 (both unit-free vectors). */
export const eclipticToEquatorial = (v: [number, number, number], out: [number, number, number] = [0, 0, 0]): [number, number, number] => {
  const c = Math.cos(OBLIQUITY), s = Math.sin(OBLIQUITY)
  const x = v[0], y = v[1] * c - v[2] * s, z = v[1] * s + v[2] * c
  out[0] = x; out[1] = y; out[2] = z
  return out
}

/** Equatorial unit vector of a right ascension and declination (degrees). */
export const raDecToVector = (raDeg: number, decDeg: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] => {
  const ra = raDeg * RAD, dec = decDeg * RAD
  out[0] = Math.cos(dec) * Math.cos(ra)
  out[1] = Math.cos(dec) * Math.sin(ra)
  out[2] = Math.sin(dec)
  return out
}
