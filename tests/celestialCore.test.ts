import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { heliocentric, julianDate } from "../src/game/celestial/ephemeris"
import { earthFrame, localToUniverse, universeToLocal } from "../src/game/celestial/frames"
import { AU, DATUM_Y, EARTH_R, KM, EARTH_SCALE, formatRealDistance } from "../src/game/celestial/scale"
import { bodyById, dominantBody, nearestBody, universe, updateUniverse } from "../src/game/celestial/universe"
import { sunDirection } from "../src/game/environment/celestialLighting"

describe("The explorer scale", () => {
  it("makes Earth 100 km in radius and keeps real proportions", () => {
    expect(EARTH_R).toBeCloseTo(100_000, 0)
    expect(AU / EARTH_R).toBeCloseTo(149_597_870.7 / 6371, 3)
    expect(KM * EARTH_SCALE).toBeCloseTo(1000, 6)
  })
  it("reports distances in real units", () => {
    expect(formatRealDistance(384_400 * KM)).toBe("384,400 km")
    expect(formatRealDistance(5.2 * AU)).toBe("5.20 AU")
  })
})

describe("JPL approximate ephemeris", () => {
  it("puts Earth where it is at J2000", () => {
    // JPL Horizons: Earth-Moon barycentre 2000-01-01.5 ≈ (-0.1771, 0.9672, 0.0000) AU
    const p = heliocentric("earth", 2451545.0)
    expect(p[0]).toBeCloseTo(-0.1771, 2)
    expect(p[1]).toBeCloseTo(0.9672, 2)
    expect(Math.abs(p[2])).toBeLessThan(1e-3)
  })
  it("keeps every orbit near its real size", () => {
    const jd = julianDate(new Date("2026-10-18T12:00:00Z"))
    const r = (id: Parameters<typeof heliocentric>[0]) => Math.hypot(...heliocentric(id, jd))
    expect(r("mercury")).toBeGreaterThan(0.3)
    expect(r("mercury")).toBeLessThan(0.47)
    expect(r("mars")).toBeGreaterThan(1.38)
    expect(r("mars")).toBeLessThan(1.67)
    expect(r("jupiter")).toBeGreaterThan(4.9)
    expect(r("neptune")).toBeGreaterThan(29.7)
  })
})

describe("local ↔ universe frames", () => {
  const f = earthFrame()
  it("agrees with the flat world near home", () => {
    const u = localToUniverse(f, 120, 40, -300, new THREE.Vector3())
    expect(u.x).toBeCloseTo(120, 0)
    expect(u.z).toBeCloseTo(-300, 0)
    // the ground falls away by d²/2R: half a metre at 323 m
    const d = Math.hypot(120, 300)
    expect(40 - u.y).toBeCloseTo((d * d) / (2 * EARTH_R), 2)
  })
  it("round-trips anywhere on the globe", () => {
    for (const [x, y, z] of [[0, DATUM_Y + 10, 0], [5000, 300, 2000], [-80_000, 4000, 120_000], [250_000, 20_000, -30_000]]) {
      const u = localToUniverse(f, x, y, z, new THREE.Vector3())
      const back = universeToLocal(f, u, new THREE.Vector3())
      expect(back.x).toBeCloseTo(x, 3)
      expect(back.y).toBeCloseTo(y, 3)
      expect(back.z).toBeCloseTo(z, 3)
    }
  })
  it("curves away: 20 km out the ground is ~2 km below the flat plane", () => {
    const u = localToUniverse(f, 20_000, DATUM_Y, 0, new THREE.Vector3())
    expect(DATUM_Y - u.y).toBeGreaterThan(1900)
    expect(DATUM_Y - u.y).toBeLessThan(2100)
  })
})

describe("the universe around home", () => {
  updateUniverse(0.2, new Date("2026-10-18T12:00:00Z"))
  it("puts the Sun exactly where the game's sun shines", () => {
    const sun = bodyById("sun")!
    const earth = bodyById("earth")!
    const dir = sun.pos.clone().sub(earth.pos).normalize()
    expect(dir.dot(sunDirection(0.2, new THREE.Vector3()))).toBeGreaterThan(0.99999)
    expect(sun.pos.distanceTo(earth.pos) / AU).toBeGreaterThan(0.98)
  })
  it("places the Moon at its real distance and planets at theirs", () => {
    const earth = bodyById("earth")!
    expect(bodyById("moon")!.pos.distanceTo(earth.pos) / KM).toBeGreaterThan(380_000)
    expect(bodyById("saturn")!.pos.distanceTo(earth.pos) / AU).toBeGreaterThan(8)
    expect(universe.bodies.every((b) => Number.isFinite(b.pos.x + b.pos.y + b.pos.z))).toBe(true)
  })
  it("knows which world is near", () => {
    const home = new THREE.Vector3(0, 500, 0)
    expect(nearestBody(home).body.def.id).toBe("earth")
    expect(nearestBody(home).altitude).toBeCloseTo(500 - DATUM_Y, 0)
    const moon = bodyById("moon")!
    const nearMoon = moon.pos.clone().add(new THREE.Vector3(0, moon.radius + 2000, 0))
    expect(dominantBody(nearMoon).def.id).toBe("moon")
    expect(dominantBody(new THREE.Vector3(0, 1000, 0)).def.id).toBe("earth")
  })
  it("puts the moons round their planets", () => {
    const io = bodyById("io")!, jupiter = bodyById("jupiter")!
    expect(io.pos.distanceTo(jupiter.pos) / KM).toBeCloseTo(421_700, -2)
  })
})
