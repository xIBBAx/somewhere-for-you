import * as THREE from "three"
import { describe, expect, it } from "vitest"
import { KM, EARTH_SCALE } from "../src/game/celestial/scale"
import {
  RING_FIELD_HEIGHT,
  ringCoords,
  ringPlaneWeight,
  ringRegion,
  ringSpeedCap,
  RING_SAIL_K,
  ringTau,
  type RingCoords,
} from "../src/game/celestial/rings/ringPhysics"

const pole = new THREE.Vector3(0.3, 1, 0.2).normalize()
const center = new THREE.Vector3(10, -5, 3)

const coords = (rkm: number, y: number): RingCoords => ({ r: rkm * KM, y, s: 0, rkm })

describe("ringTau", () => {
  it("is zero inside the Encke, Keeler, Cassini-notch, Maxwell and Colombo gaps", () => {
    for (const rkm of [133_584, 136_505, 117_820, 87_491, 77_870]) {
      expect(ringTau(rkm)).toBeCloseTo(0, 9)
    }
  })

  it("is dense in the B ring and moderate in the A ring", () => {
    expect(ringTau(112_000)).toBeGreaterThan(1)
    const a = ringTau(128_000)
    expect(a).toBeGreaterThan(0.3)
    expect(a).toBeLessThan(0.9)
  })

  it("is zero beyond the F ring and inside the D ring's inner edge", () => {
    expect(ringTau(142_000)).toBe(0)
    expect(ringTau(150_000)).toBe(0)
    expect(ringTau(60_000)).toBe(0)
  })
})

describe("ringRegion", () => {
  it("labels representative radii", () => {
    expect(ringRegion(70_000)).toBe("D")
    expect(ringRegion(80_000)).toBe("C")
    expect(ringRegion(105_000)).toBe("B")
    expect(ringRegion(120_000)).toBe("Cassini")
    expect(ringRegion(128_000)).toBe("A")
    expect(ringRegion(133_584)).toBe("Encke")
    expect(ringRegion(136_505)).toBe("Keeler")
    expect(ringRegion(140_200)).toBe("F")
  })

  it("returns null outside the ring system", () => {
    expect(ringRegion(50_000)).toBeNull()
    expect(ringRegion(150_000)).toBeNull()
  })
})

describe("ringCoords", () => {
  const R_KM = 128_000
  const R = R_KM * KM
  const H = 4

  it("recovers radius, height and rkm for a point above the ring plane", () => {
    const er = new THREE.Vector3(1, 0, 0).addScaledVector(pole, -pole.x).normalize()
    const p = center.clone().addScaledVector(er, R).addScaledVector(pole, H)
    const out = ringCoords(p, center, pole, { r: 0, y: 0, s: 0, rkm: 0 })
    expect(out.r).toBeCloseTo(R, 4)
    expect(out.y).toBeCloseTo(H, 6)
    expect(out.rkm).toBeCloseTo(R_KM, 4)
    expect(out.rkm).toBeCloseTo((out.r * EARTH_SCALE) / 1000, 9)
  })

  it("arc length grows as R * azimuth, continuous away from the seam", () => {
    // the azimuth reference is the in-plane projection of x; its opposite is the seam at +/-pi
    const ref = new THREE.Vector3(1, 0, 0).addScaledVector(pole, -pole.x).normalize()
    const side = new THREE.Vector3().crossVectors(pole, ref)
    const out = { r: 0, y: 0, s: 0, rkm: 0 }
    let prev: number | null = null
    for (let th = -Math.PI + 0.05; th <= Math.PI - 0.05; th += 0.02) {
      const er = ref.clone().multiplyScalar(Math.cos(th)).addScaledVector(side, Math.sin(th))
      const p = center.clone().addScaledVector(er, R)
      ringCoords(p, center, pole, out)
      expect(out.s).toBeCloseTo(R * th, 0)
      if (prev !== null) {
        // no jump beyond the expected step (a few metres of slack)
        expect(Math.abs(out.s - prev - R * 0.02)).toBeLessThan(3)
      }
      prev = out.s
    }
  })

  it("returns orthonormal axes with en equal to the pole", () => {
    const p = center.clone().add(new THREE.Vector3(R * 0.6, R * 0.3, -R * 0.5))
    const er = new THREE.Vector3()
    const en = new THREE.Vector3()
    const ephi = new THREE.Vector3()
    ringCoords(p, center, pole, { r: 0, y: 0, s: 0, rkm: 0 }, { er, en, ephi })
    expect(er.length()).toBeCloseTo(1, 9)
    expect(en.length()).toBeCloseTo(1, 9)
    expect(ephi.length()).toBeCloseTo(1, 9)
    expect(er.dot(en)).toBeCloseTo(0, 9)
    expect(er.dot(ephi)).toBeCloseTo(0, 9)
    expect(en.dot(ephi)).toBeCloseTo(0, 9)
    expect(en.distanceTo(pole)).toBeLessThan(1e-9)
  })
})

describe("ringPlaneWeight", () => {
  it("is 1 in the plane among the rings", () => {
    expect(ringPlaneWeight(coords(128_000, 0))).toBeCloseTo(1, 9)
  })

  it("is 0 at 60,000 game m height or more", () => {
    expect(ringPlaneWeight(coords(128_000, 60_000))).toBe(0)
    expect(ringPlaneWeight(coords(128_000, -60_000))).toBe(0)
    expect(ringPlaneWeight(coords(128_000, 90_000))).toBe(0)
  })

  it("is 0 outside the ring radii at 50,000 and 160,000 km", () => {
    expect(ringPlaneWeight(coords(50_000, 0))).toBe(0)
    expect(ringPlaneWeight(coords(160_000, 0))).toBe(0)
  })

  it("is symmetric in the sign of y", () => {
    for (const y of [500, 5_000, 20_000, 45_000]) {
      expect(ringPlaneWeight(coords(128_000, y))).toBeCloseTo(ringPlaneWeight(coords(128_000, -y)), 12)
    }
  })

  it("is monotone non-increasing in |y|", () => {
    let prev = Infinity
    for (let y = 0; y <= 70_000; y += 500) {
      const w = ringPlaneWeight(coords(128_000, y))
      expect(w).toBeLessThanOrEqual(prev + 1e-12)
      prev = w
    }
  })
})

describe("ringSpeedCap", () => {
  it("is unlimited outside the ring radii", () => {
    expect(ringSpeedCap(coords(50_000, 0), false)).toBe(Infinity)
    expect(ringSpeedCap(coords(150_000, 0), true)).toBe(Infinity)
  })

  it("follows the sail's own height law far above the plane", () => {
    // far above the plane the ring limit is the sail's own law: 0.85 × height, so it never binds before a planet's would
    const y = 50_000
    expect(ringSpeedCap(coords(128_000, y), false)).toBeCloseTo(34 + RING_SAIL_K * (y - RING_FIELD_HEIGHT * 0.5), 6)
    expect(ringSpeedCap(coords(128_000, -y), true)).toBeCloseTo(90 + RING_SAIL_K * (y - RING_FIELD_HEIGHT * 0.5), 6)
  })

  it("caps at 34 at the plane and 90 when surging", () => {
    expect(ringSpeedCap(coords(128_000, 0), false)).toBe(34)
    expect(ringSpeedCap(coords(128_000, 0), true)).toBe(90)
  })

  it("increases with |y| before the field ends", () => {
    let prev = -Infinity
    for (let y = 0; y < RING_FIELD_HEIGHT * 4; y += 10) {
      const cap = ringSpeedCap(coords(128_000, y), false)
      expect(cap).toBeGreaterThanOrEqual(prev)
      prev = cap
    }
    expect(ringSpeedCap(coords(128_000, 200), false)).toBeGreaterThan(34)
  })
})
