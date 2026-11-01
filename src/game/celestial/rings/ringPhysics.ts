import * as THREE from "three"
import { KM, EARTH_SCALE } from "../scale"

/**
 * Saturn's rings as Cassini measured them, for flying among the ice.
 *
 * Real (NASA/JPL Cassini, Voyager occultations; radii from Saturn's centre):
 *   D ring   66,900 – 74,510 km   faint dust
 *   C ring   74,658 – 92,000 km   optical depth ~0.05–0.2, plateaus; the Colombo
 *                                  (77,870) and Maxwell (87,491) gaps
 *   B ring   92,000 – 117,580 km  the densest: optical depth 1–5, opaque in places
 *   Cassini Division 117,580 – 122,170 km  thin (~0.1), Huygens gap at its inner edge
 *   A ring   122,170 – 136,775 km optical depth ~0.4–0.9; spiral density waves in
 *                                  its outer part; the Encke gap (133,590, 325 km wide,
 *                                  kept open by the moon Pan) and the Keeler gap
 *                                  (136,505, 42 km, Daphnis)
 *   F ring   ~140,220 km          a narrow braided core shepherded by Prometheus
 *                                  and Pandora
 * The particles are water ice (over 90 %), from grains to house-sized boulders
 * in a steep power law (many small, few large; number ∝ size^-3), in a layer
 * mostly about ten metres thick, slightly reddened (tan in the B ring) by a
 * little dust and organics. In the dense rings they clump into "self-gravity
 * wakes": elongated aggregates tens of metres long, canted about 20° to the
 * orbit. Every piece orbits Saturn (inner faster than outer, so neighbours
 * shear slowly past each other).
 *
 * The explorer scale: the rings' extent is shrunk with the rest of the sky (1:63.71),
 * but, as with people, animals and trees, the pieces of ice themselves are
 * life-size — so up close the explorer flies through real-sized ice, while a game
 * metre across the rings is 63.7 real metres of ring structure.
 */

export type RingRegion = "D" | "C" | "B" | "Cassini" | "A" | "Encke" | "Keeler" | "F" | "gap" | null

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
/** a smooth bump between a and b with soft edges of width e */
const band = (r: number, a: number, b: number, e: number): number => smooth(a - e, a + e, r) * (1 - smooth(b - e, b + e, r))
const notch = (r: number, c: number, w: number): number => 1 - band(r, c - w / 2, c + w / 2, Math.max(2, w * 0.08))

/** normal optical depth at a radius (real km); 0 in the gaps */
export const ringTau = (rkm: number): number => {
  let t = 0
  t += band(rkm, 66_900, 74_510, 400) * 0.002
  t += band(rkm, 74_658, 92_000, 150) * (0.06 + 0.08 * band(rkm, 84_600, 90_200, 300))
  t += band(rkm, 92_000, 117_580, 120) * (1.2 + 1.6 * band(rkm, 99_000, 104_000, 900) + 2.0 * band(rkm, 110_000, 116_400, 600))
  t += band(rkm, 117_580, 122_170, 60) * 0.1
  // the outer A ring's spiral density waves: ripples of density a few km apart
  t += band(rkm, 122_170, 136_775, 40) * (0.5 + 0.12 * Math.sin(rkm * 2.1) * band(rkm, 127_000, 136_000, 500))
  t += band(rkm, 140_150, 140_290, 20) * 0.4
  t *= notch(rkm, 77_870, 150) * notch(rkm, 87_491, 270) * notch(rkm, 117_820, 285) * notch(rkm, 133_584, 322) * notch(rkm, 136_505, 42)
  return t
}

export const ringRegion = (rkm: number): RingRegion => {
  if (rkm < 66_900 || rkm > 140_400) return null
  if (Math.abs(rkm - 133_584) < 161) return "Encke"
  if (Math.abs(rkm - 136_505) < 21) return "Keeler"
  if (rkm < 74_658) return "D"
  if (rkm < 92_000) return "C"
  if (rkm < 117_580) return "B"
  if (rkm < 122_170) return "Cassini"
  if (rkm < 136_775) return "A"
  if (rkm > 140_100) return "F"
  return "gap"
}

/** the ring layer's half-thickness at a radius, in life-size metres (B thicker, F thin) */
export const ringThickness = (rkm: number): number =>
  rkm > 140_000 ? 3 : rkm > 122_170 ? 10 : rkm > 117_580 ? 6 : rkm > 92_000 ? 9 : 5

/**
 * The GLSL twin of ringTau (kept identical when fw = 0). ringTauF(r, fw)
 * also takes the footprint of one pixel in real km (fwidth): structure finer
 * than a pixel (the density waves, the narrow Keeler gap) is averaged away
 * instead of aliasing into crawling moire on the far ring.
 */
export const RING_TAU_GLSL = /* glsl */ `
  float rSmooth(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
  float rBand(float r, float a, float b, float e) { return rSmooth(a - e, a + e, r) * (1.0 - rSmooth(b - e, b + e, r)); }
  float rNotchF(float r, float c, float w, float fw) {
    float e = max(max(2.0, w * 0.08), fw);
    return 1.0 - rBand(r, c - w * 0.5, c + w * 0.5, e) * min(1.0, w / max(fw, 1e-3));
  }
  float ringTauF(float r, float fw) {
    float t = 0.0;
    t += rBand(r, 66900.0, 74510.0, max(400.0, fw)) * 0.002;
    t += rBand(r, 74658.0, 92000.0, max(150.0, fw)) * (0.06 + 0.08 * rBand(r, 84600.0, 90200.0, max(300.0, fw)));
    t += rBand(r, 92000.0, 117580.0, max(120.0, fw)) * (1.2 + 1.6 * rBand(r, 99000.0, 104000.0, max(900.0, fw)) + 2.0 * rBand(r, 110000.0, 116400.0, max(600.0, fw)));
    t += rBand(r, 117580.0, 122170.0, max(60.0, fw)) * 0.1;
    // density waves (period ~3 km): fade out once a pixel spans a good part of one
    float waves = 1.0 - rSmooth(0.12, 0.45, fw * 2.1 / 6.2832);
    t += rBand(r, 122170.0, 136775.0, max(40.0, fw)) * (0.5 + 0.12 * waves * sin(r * 2.1) * rBand(r, 127000.0, 136000.0, max(500.0, fw)));
    t += rBand(r, 140150.0, 140290.0, max(20.0, fw)) * 0.4 * min(1.0, 140.0 / max(fw, 1e-3));
    t *= rNotchF(r, 77870.0, 150.0, fw) * rNotchF(r, 87491.0, 270.0, fw) * rNotchF(r, 117820.0, 285.0, fw) * rNotchF(r, 133584.0, 322.0, fw) * rNotchF(r, 136505.0, 42.0, fw);
    return t;
  }
  float ringTau(float r) { return ringTauF(r, 0.0); }
  // Cassini saw every ring grooved like a record: ringlets of slightly
  // different brightness at every scale from ~1 km to hundreds. Brightness
  // only (0.72..1.12 about 0.92), each scale fading once a pixel spans it.
  float ringGrooves(float r, float fw) {
    float g = 0.0;
    g += sin(r * 0.0419 + 1.3) * 0.35 * (1.0 - rSmooth(10.0, 40.0, fw));
    g += sin(r * 0.2170 + sin(r * 0.031) * 2.0) * 0.3 * (1.0 - rSmooth(2.0, 8.0, fw));
    g += sin(r * 0.9100 + sin(r * 0.11) * 3.0) * 0.22 * (1.0 - rSmooth(0.5, 2.0, fw));
    g += sin(r * 4.3000 + sin(r * 0.57) * 4.0) * 0.13 * (1.0 - rSmooth(0.1, 0.45, fw));
    return 0.92 + 0.2 * g;
  }
`

/** Where a point is in Saturn's ring frame: radius (game m), height over the plane (game m), arc length (game m). */
export type RingCoords = { r: number; y: number; s: number; rkm: number }

const _rel = new THREE.Vector3()
const _er = new THREE.Vector3()
const _ref = new THREE.Vector3()
const _ephi = new THREE.Vector3()

/**
 * Ring coordinates of a universe point about a ringed body (pos, pole).
 * The azimuth is measured from a fixed reference axis in the ring plane, so
 * the arc length is continuous as she flies round (float64 throughout).
 */
export const ringCoords = (p: THREE.Vector3, center: THREE.Vector3, pole: THREE.Vector3, out: RingCoords, axes?: { er: THREE.Vector3; en: THREE.Vector3; ephi: THREE.Vector3 }): RingCoords => {
  _rel.copy(p).sub(center)
  const y = _rel.dot(pole)
  _er.copy(_rel).addScaledVector(pole, -y)
  const r = _er.length()
  if (r > 1e-6) _er.divideScalar(r)
  else _er.set(1, 0, 0)
  // a fixed reference direction in the plane for the azimuth
  _ref.set(1, 0, 0).addScaledVector(pole, -pole.x)
  if (_ref.lengthSq() < 1e-8) _ref.set(0, 1, 0).addScaledVector(pole, -pole.y)
  _ref.normalize()
  _ephi.crossVectors(pole, _er)
  const phi = Math.atan2(_er.dot(_ephi.crossVectors(pole, _ref)), _er.dot(_ref))
  _ephi.crossVectors(pole, _er).normalize()
  out.r = r
  out.y = y
  out.s = r * phi
  out.rkm = (r * EARTH_SCALE) / 1000
  if (axes) {
    axes.er.copy(_er)
    axes.en.copy(pole)
    axes.ephi.copy(_ephi)
  }
  return out
}

/** Is a point among the rings: within the ring radii and near enough the plane that the ice is drawn (game m). */
export const RING_FIELD_HEIGHT = 140

/**
 * Sailing among the ice: the ring plane counts as a surface for the sail's
 * own law (speed in proportion to height over the nearest surface, see
 * starSail), so however fast she comes at the rings she slows smoothly as
 * the plane nears, the way she slows for a world — and at the ice itself
 * rides at a pace the eye can follow, piece by piece (game m/s). It is a
 * limit, never a hold: she can always fly on along or away.
 */
export const RING_SAIL_K = 0.85
export const ringSpeedCap = (c: RingCoords, surging: boolean): number => {
  const across = smooth(64_000, 66_900, c.rkm) * (1 - smooth(140_600, 142_500, c.rkm))
  if (across <= 0) return Infinity
  const cap = (surging ? 90 : 34) + RING_SAIL_K * Math.max(0, Math.abs(c.y) - RING_FIELD_HEIGHT * 0.5)
  // eases out past the rings' edges instead of stopping at a line
  return across >= 1 ? cap : cap / across
}

/**
 * How much the ring plane, rather than Saturn's round horizon, is the level
 * a rider's eye should settle to (0..1). Among the rings and near their
 * plane the ice is the floor of the world; well above or below it, or out
 * past the rings, the planet's own horizon takes over again.
 */
export const ringPlaneWeight = (c: RingCoords): number => {
  const across = smooth(60_000, 66_000, c.rkm) * (1 - smooth(141_000, 150_000, c.rkm))
  // game metres over the plane: the rings span ~2,000 km of game space, so
  // even tens of km up they still fill the view below her
  return across * (1 - smooth(12_000, 60_000, Math.abs(c.y)))
}

/** a radius in real km for a game distance from the centre */
export const ringRadiusGame = (rkm: number): number => rkm * KM

/** Shared state for the HUD, sound and QA. */
export const ringRT = {
  /** 0..1 how present the near-field ice is */
  vis: 0,
  /** 0..1 how present the true-scale ring sheet under her is, and its radius (game m) */
  sheet: 0,
  sheetR: 24_000,
  region: null as RingRegion,
  rkm: 0,
  /** height over the ring plane (game m) */
  y: 0,
  tau: 0,
  /** QA: the ring axes in local view axes */
  qa: null as null | Record<string, number[]>,
}
