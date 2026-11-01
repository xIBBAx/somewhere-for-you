import { describe, expect, it } from "vitest"
import { groundHeight } from "../src/game/world-layout"
import { stepHorseMotion } from "../src/game/horses/horseMotion"
import { makeIdentity } from "../src/game/horses/breeds"
import { makeHorseState } from "../src/game/horses/horseState"
import { cancelLanding, flightOf, groundNow, requestGallopLanding, startTakeoff, stepFlight, touchDown } from "../src/game/pegasus/flight"
import { landingHazard, stepLanding, type LandingProbe } from "../src/game/pegasus/landing"
import { tryTrick } from "../src/game/pegasus/aerobatics"

const horse = (breed: "ivory" | "onyx" | "starborn" = "ivory") => {
  const h = makeHorseState(makeIdentity(707, breed, { scale: 1, saddled: true }), -36, -24, true)
  const f = flightOf(h)!
  f.mode = "air"; f.alt = 6; h.y = 6; h.speed = f.spec.boost; h.heading = 0
  h.rider = "explorer"
  return h
}
const flat: LandingProbe = { height: () => 0, water: () => null, clear: () => true, ready: () => true }

describe("mounted Pegasus approach physics", () => {
  it.each(["ivory", "onyx", "starborn"] as const)("eases %s's dash in the air and carries its momentum to the ground", breed => {
    const h = horse(breed), f = h.flight!
    if (breed === "starborn") h.passenger = "companion"
    h.speed = Math.max(f.spec.boost, f.skills?.dash.speed ?? 0, f.skills?.stoop.speed ?? 0)
    expect(requestGallopLanding(h)).toBe(true)
    const entry = h.speed
    expect(requestGallopLanding(h)).toBe(true)
    expect(f.landing.entrySpeed).toBe(entry)
    f.mode = "landing"
    let touched = false
    let beforeContact = 0
    for (let n = 0; n < 2400; n++) {
      const x = h.x, y = h.y, z = h.z, v = h.speed
      touched = stepLanding(h, f, 1 / 120, flat)
      expect(Math.abs(h.speed - v)).toBeLessThanOrEqual(6 / 120 + 1e-8)
      expect(Math.hypot(h.x - x, h.z - z)).toBeLessThanOrEqual(v / 120 + 0.001)
      expect(Math.abs(h.y - y)).toBeLessThan(0.06)
      if (touched) { beforeContact = h.speed; break }
    }
    expect(touched).toBe(true)
    expect(h.z + 24).toBeGreaterThan(20) // surplus speed was spent along a real approach
    // momentum kept: she comes down at up to ~1.7 gallops and the ground run sheds the rest
    expect(beforeContact).toBeGreaterThan(h.pose.speeds[3] * 0.9)
    expect(beforeContact).toBeLessThanOrEqual(h.pose.speeds[3] * 1.7 + 0.01)
    expect(Math.abs(f.vy)).toBeLessThan(1.1)
    const pitch = f.pitch, bank = f.roll
    touchDown(h)
    expect(h.speed).toBe(beforeContact)
    expect(f.pitch).toBe(pitch)
    expect(f.roll).toBe(bank)
    expect(f.landing.contact).toBeGreaterThan(0)
    expect(f.landing.run).toBe(true)
    expect(h.rider).toBe("explorer")
    if (breed === "starborn") expect(h.passenger).toBe("companion")
    // Ground posture settles instead of snapping, and takeoff carries the run's momentum.
    stepFlight(h, 1 / 60)
    expect(Math.abs(f.pitch)).toBeLessThan(Math.abs(pitch))
    const runSpeed = h.speed
    expect(startTakeoff(h)).toBe("ok")
    stepFlight(h, 0.1)
    expect(h.speed).toBeGreaterThanOrEqual(runSpeed - 0.02)
    expect(f.landing.run).toBe(false)
  })

  it.each(["water", "slope", "obstacle", "terrain"] as const)("never refuses or goes round for %s ahead: she keeps coming down", hazard => {
    const h = horse(), f = h.flight!
    h.speed = 14
    requestGallopLanding(h); f.mode = "landing"
    const boundary = h.z + 4
    const probe: LandingProbe = {
      ...flat,
      height: (_x, z) => hazard === "slope" && z > boundary ? 3 : 0,
      water: (_x, z) => hazard === "water" && z > boundary ? 1 : null,
      clear: (_x, z) => !(hazard === "obstacle" && z > boundary),
      ready: (_x, z) => !(hazard === "terrain" && z > boundary),
    }
    for (let n = 0; n < 240; n++) {
      stepLanding(h, f, 1 / 60, probe)
      expect(f.landing.goAround).toBe(false)
      expect(f.refused).toBeNull()
      expect(f.mode).toBe("landing")
      expect(h.rider).toBe("explorer")
    }
  })

  it("lands on deep water and touches down on its surface", () => {
    const h = horse(), f = h.flight!
    h.speed = 14
    requestGallopLanding(h); f.mode = "landing"
    const lake: LandingProbe = { ...flat, height: () => -4, water: () => 0 }
    let touched = false
    for (let n = 0; n < 1200 && !touched; n++) touched = stepLanding(h, f, 1 / 60, lake)
    expect(touched).toBe(true)
    expect(Math.abs(h.y - 0)).toBeLessThan(0.01)
    expect(h.speed).toBeGreaterThan(h.pose.speeds[3] * 0.9)
  })

  it("steers toward a clear bearing when the patch straight ahead is blocked", () => {
    const h = horse(), f = h.flight!
    h.y = 3; f.alt = 3; h.speed = 12
    requestGallopLanding(h); f.mode = "landing"
    // a wall of trunks across the right half ahead: the left is clear
    const probe: LandingProbe = { ...flat, clear: (x, z) => !(z > h.z + 2 && x < -36) }
    let touched = false
    for (let n = 0; n < 1200 && !touched; n++) touched = stepLanding(h, f, 1 / 60, probe)
    expect(touched).toBe(true)
    expect(h.x).toBeGreaterThan(-36)
  })

  it("allows shallow water while refusing chest-deep water", () => {
    const h = horse()
    expect(landingHazard(h, h.x, h.z, { ...flat, water: () => 0.25 })).toBeNull()
    expect(landingHazard(h, h.x, h.z, { ...flat, water: () => 0.6 })).toBe("water")
  })

  it("rises over a trunk at her chest rather than flying through it, and never touches down beside it", () => {
    const h = horse(), f = h.flight!
    h.y = 1.5; h.speed = 14
    requestGallopLanding(h); f.mode = "landing"
    const edge = h.z + 2
    const probe: LandingProbe = { ...flat, clear: (_x, z) => z < edge, airClear: (_x, y, z) => z < edge || y > 12 }
    for (let n = 0; n < 600 && h.y < 5; n++) {
      const x = h.x, z = h.z, y = h.y
      expect(stepLanding(h, f, 1 / 120, probe)).toBe(false)
      expect(Math.hypot(h.x - x, h.z - z)).toBeLessThan(0.13)
      expect(Math.abs(h.y - y)).toBeLessThan(0.04)
      expect(h.z + 0.9).toBeLessThan(edge + 0.2)
    }
    expect(h.y).toBeGreaterThanOrEqual(5)
    expect(f.stats.landings).toBe(0)
  })

  it("lands, runs and takes off along an actual clear authored meadow corridor", () => {
    const h = horse(), f = h.flight!
    let found = false
    for (const [x, z] of [[-36, -24], [-30, 30], [-26, -28], [34, 0], [20, 22], [-20, 20], [-44, -24], [-56, 28], [38, 32], [-40, -50], [60, 30], [72, -10]]) {
      for (let a = 0; a < 32 && !found; a++) {
        h.x = x; h.z = z; h.heading = a * Math.PI / 16
        const base = groundHeight(x, z)
        found = true
        for (let d = 0; d < 30; d += 0.75) {
          const px = x + Math.sin(h.heading) * d, pz = z + Math.cos(h.heading) * d
          if (landingHazard(h, px, pz) || Math.abs(groundHeight(px, pz) - base) > 0.5) { found = false; break }
        }
      }
      if (found) break
    }
    expect(found).toBe(true)
    h.y = groundHeight(h.x, h.z) + 0.55; f.alt = 0.55; h.speed = h.pose.speeds[3]
    requestGallopLanding(h)
    for (let n = 0; n < 600 && f.mode !== "ground"; n++) {
      const x = h.x, y = h.y, z = h.z, speed = h.speed
      stepFlight(h, 1 / 60)
      expect(Math.hypot(h.x - x, h.z - z)).toBeLessThanOrEqual(speed / 60 + 0.01)
      expect(Math.abs(h.y - y)).toBeLessThan(0.05)
    }
    expect(f.mode).toBe("ground")
    expect(f.landing.run).toBe(true)
    expect(f.stats.aborted).toBe(0)
    const v = h.speed
    stepHorseMotion(h, 0.25, 0)
    expect(h.speed).toBeGreaterThanOrEqual(v - 0.01)
    expect(startTakeoff(h)).toBe("ok")
    stepFlight(h, 0.1)
    expect(h.speed).toBeGreaterThanOrEqual(v - 0.01)
    expect(f.mode).toBe("takeoff")
  })

  it("levels a banked, turning approach before accepting hoof contact", () => {
    const h = horse(), f = h.flight!
    h.y = 1; h.speed = h.pose.speeds[3]
    f.roll = 0.6; f.pitch = 0.5; h.turnRate = 0.4; f.intent.turn = 1
    requestGallopLanding(h); f.mode = "landing"
    let touched = false
    for (let n = 0; n < 1800 && !touched; n++) touched = stepLanding(h, f, 1 / 120, flat)
    expect(touched).toBe(true)
    expect(Math.abs(f.roll)).toBeLessThan(0.14)
    expect(Math.abs(f.pitch)).toBeLessThan(0.25)
    expect(Math.abs(h.turnRate)).toBeLessThan(0.18)
  })

  it("checks both ends and sides, including an obstruction missed by a centre-only probe", () => {
    const h = horse()
    expect(landingHazard(h, h.x, h.z, { ...flat, clear: (x, z) => Math.abs(x - h.x) < 0.4 || z < h.z + 0.8 })).toBe("obstacle")
  })

  it("cancels without position, speed or attitude replacement and resets explicitly", () => {
    const h = horse(), f = h.flight!
    requestGallopLanding(h); f.mode = "landing"
    f.pitch = 0.12; f.roll = 0.08; f.vy = -1
    const state = [h.x, h.y, h.z, h.speed, f.pitch, f.roll, f.vy]
    cancelLanding(h)
    expect([h.x, h.y, h.z, h.speed, f.pitch, f.roll, f.vy]).toEqual(state)
    expect(f.mode).toBe("air")
    expect(f.landing.requested).toBe(false)
    // no forced climb-out: she flies on as the explorer steers
    expect(f.landing.goAround).toBe(false)
    groundNow(h)
    expect(f.landing.run).toBe(false)
    expect(f.landing.contact).toBe(0)
    expect(f.landing.goAround).toBe(false)
  })

  it("releases the brake pose after the approach returns to ordinary flight", () => {
    const h = horse(), f = h.flight!
    h.y = 80; f.alt = 80; f.landing.brake = 0.8
    for (let n = 0; n < 120; n++) stepFlight(h, 1 / 60)
    expect(f.landing.brake).toBeLessThan(0.01)
    expect(f.mode).toBe("air")
  })

  it.each(["roll", "loop", "split", "corkscrew", "pirouette"] as const)("queues landing until a %s recovers naturally", kind => {
    const h = horse(), f = h.flight!
    h.y = 80; f.alt = 80; h.speed = f.spec.cruise
    expect(tryTrick(h, kind, 1)).toBe("ok")
    stepFlight(h, 0.12)
    const pitch = f.pitch, spin = f.spin
    requestGallopLanding(h)
    expect(f.trick.kind).toBe(kind)
    expect(f.pitch).toBe(pitch)
    expect(f.spin).toBe(spin)
    expect(f.trick.recover).toBe(true)
    let t = 0
    while (f.trick.kind && t < 4) { stepFlight(h, 1 / 120); t += 1 / 120 }
    expect(f.trick.kind).toBeNull()
    expect(t).toBeLessThan(2)
    expect(h.rider).toBe("explorer")
  })
})
