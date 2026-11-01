import { describe, expect, it } from "vitest"
import { makeIdentity } from "../src/game/horses/breeds"
import { makeHorseState, type HorseState } from "../src/game/horses/horseState"
import { stepHorseMotion } from "../src/game/horses/horseMotion"
import { groundHeight } from "../src/game/world-layout"
import { flightOf, stepFlight } from "../src/game/pegasus/flight"
import { mountQuaternion } from "../src/game/horses/riding"
import { ROLL_TAP, SKILLS, makeRollTap, rollTap, soarGain, thermalLift } from "../src/game/pegasus/skills"
import * as THREE from "three"

const OPEN = { x: -36, z: -24 }

const airborne = (breed: "ivory" | "onyx" | "starborn", alt = 120): HorseState => {
  const h = makeHorseState(makeIdentity(707, breed, { saddled: true, scale: 1 }), OPEN.x, OPEN.z, true)
  h.y = groundHeight(OPEN.x, OPEN.z) + alt
  h.heading = 0
  const f = flightOf(h)!
  f.mode = "air"
  f.alt = alt
  f.spread = 1
  h.speed = f.spec.cruise
  return h
}

const fly = (h: HorseState, seconds: number, intent: Partial<NonNullable<HorseState["flight"]>["intent"]>): void => {
  const f = h.flight!
  for (let t = 0; t < seconds; t += 1 / 60) {
    Object.assign(f.intent, { thrust: 0, turn: 0, climb: 0, boost: false, land: false }, intent)
    stepFlight(h, 1 / 60, () => 0.5)
  }
}

describe("Pegasus flying skills", () => {
  it("hold a dash for as long as it is held: no cool-down, no running out", () => {
    for (const breed of ["ivory", "onyx", "starborn"] as const) {
      const h = airborne(breed)
      fly(h, 40, { boost: true })
      // still dashing at full dash speed after 40 s (the old dash ended after 3.2 s)
      expect(h.flight!.boostT).toBeGreaterThan(39)
      expect(h.speed).toBeGreaterThan(SKILLS[breed].dash.speed * 0.9)
      fly(h, 1, { boost: false })
      expect(h.flight!.boostT).toBe(0)
    }
  })

  it("give Ivory the glider's gifts and Onyx the eagle's", () => {
    const a = SKILLS.ivory, b = SKILLS.onyx
    expect(a.glide).toBeGreaterThan(b.glide)
    expect(a.soar).toBeGreaterThan(b.soar)
    expect(a.thermal).toBeGreaterThan(b.thermal)
    expect(a.roll).toBeLessThan(b.roll) // she rolls faster
    expect(b.stoop.speed).toBeGreaterThan(a.stoop.speed)
    expect(b.dash.speed).toBeGreaterThan(a.dash.speed)
    expect(b.steady).toBeGreaterThan(a.steady)
    expect(b.downwash).toBeGreaterThan(a.downwash)
    // their light is their own
    expect(new Set(Object.values(SKILLS).map((s) => s.trail.edge)).size).toBe(3)
  })

  it("let Onyx stoop (Shift with C) faster than Ivory, and pull out into a zoom climb", () => {
    const top: Record<string, number> = {}
    for (const breed of ["ivory", "onyx"] as const) {
      const h = airborne(breed, 600)
      fly(h, 9, { climb: -1, boost: true })
      top[breed] = h.speed
      expect(h.flight!.stoop).toBeGreaterThan(0.9)
      // a stoop is not a dash
      expect(h.flight!.boostT).toBe(0)
    }
    expect(top.onyx).toBeGreaterThan(top.ivory)
    expect(top.onyx).toBeGreaterThan(40)
    // out of the dive: the speed buys height
    const h = airborne("onyx", 600)
    fly(h, 8, { climb: -1, boost: true })
    const y0 = h.y, v0 = h.speed
    fly(h, 2.5, { climb: 1 })
    expect(h.y).toBeGreaterThan(y0 + 15)
    expect(h.speed).toBeLessThan(v0)
  })

  it("descend on C alone without stooping, so an ordinary way down stays gentle", () => {
    const h = airborne("onyx", 600)
    fly(h, 9, { climb: -1 })
    expect(h.flight!.stoop).toBeLessThan(0.05)
    expect(h.speed).toBeLessThan(SKILLS.onyx.stoop.speed * 0.6)
  })

  it("hold their height through a dash with no hand on the climb", () => {
    for (const breed of ["ivory", "onyx"] as const) {
      const h = airborne(breed, 200)
      const y0 = h.y
      fly(h, 12, { boost: true })
      expect(Math.abs(h.y - y0)).toBeLessThan(6)
    }
  })

  it("give Onyx the stronger climb", () => {
    const gain: Record<string, number> = {}
    for (const breed of ["ivory", "onyx"] as const) {
      const h = airborne(breed, 100)
      const y0 = h.y
      fly(h, 6, { climb: 1 })
      gain[breed] = h.y - y0
    }
    expect(gain.onyx).toBeGreaterThan(gain.ivory * 1.15)
  })

  it("roll only on a second tap of the same side, quickly", () => {
    const st = makeRollTap()
    const feed = (turn: number, s: number): number => { let fired = 0; for (let t = 0; t < s; t += 1 / 60) fired ||= rollTap(st, turn, 1 / 60); return fired }
    expect(feed(1, 0.1)).toBe(0)
    expect(feed(0, 0.1)).toBe(0)
    expect(feed(1, 0.05)).toBe(1)
    // a held turn never rolls, nor does a slow second press, nor the other side
    feed(0, 0.5)
    expect(feed(-1, 0.1) || feed(0, ROLL_TAP + 0.05) || feed(-1, 0.1)).toBe(0)
    feed(0, 0.5)
    expect(feed(1, 0.1) || feed(0, 0.1) || feed(-1, 0.1)).toBe(0)
  })

  it("never roll close to the ground", () => {
    const h = airborne("ivory", 6)
    fly(h, 0.05, { roll: 1 })
    expect(h.flight!.rollT).toBe(0)
  })

  it("barrel-roll when asked, the whole body turning once and coming back level", () => {
    const h = airborne("ivory")
    const f = h.flight!
    fly(h, 1 / 60, { roll: 1 })
    expect(f.rollT).toBeGreaterThan(0)
    let maxSpin = 0
    const up = new THREE.Vector3(), q = new THREE.Quaternion()
    let wasInverted = false
    for (let t = 0; t < SKILLS.ivory.roll + 0.2; t += 1 / 60) {
      fly(h, 1 / 60, {})
      maxSpin = Math.max(maxSpin, Math.abs(f.spin))
      up.set(0, 1, 0).applyQuaternion(mountQuaternion(h, q))
      if (up.y < -0.5) wasInverted = true
    }
    expect(maxSpin).toBeGreaterThan(Math.PI * 1.5)
    expect(wasInverted).toBe(true)
    expect(f.spin).toBe(0)
    expect(f.rollT).toBe(0)
  })

  it("never let a Pegasus tire, on the ground or in the air", () => {
    const gallop = (x: HorseState): void => {
      for (let t = 0; t < 120; t += 1 / 30) {
        x.speed = x.targetSpeed = x.pose.speeds[3]
        stepHorseMotion(x, 1 / 30, null)
      }
    }
    const h = makeHorseState(makeIdentity(9, "ivory", { saddled: true, scale: 1 }), OPEN.x, OPEN.z, true)
    gallop(h)
    expect(h.stamina).toBe(1)
    expect(h.exertion).toBeLessThan(0.4)
    // no animal in the explorer's universe tires: an ordinary horse breathes harder after
    // two minutes' gallop, but keeps every bit of its stamina
    const nag = makeHorseState(makeIdentity(9, "thoroughbred", { saddled: true, scale: 1 }), OPEN.x, OPEN.z, false)
    gallop(nag)
    expect(nag.stamina).toBe(1)
    expect(nag.exertion).toBeGreaterThan(h.exertion)
  })
})

describe("the air the wings ride", () => {
  it("has thermals only by day: rising cores of 1–4 m/s, a ring of sink, and none at night", () => {
    let best = 0, worst = 0
    for (let x = -1000; x < 1000; x += 7) for (let z = -1000; z < 1000; z += 7) {
      const l = thermalLift(x, z, 1000, 1)
      best = Math.max(best, l)
      worst = Math.min(worst, l)
      expect(thermalLift(x, z, 1000, 0)).toBe(0)
    }
    expect(best).toBeGreaterThan(1)
    expect(best).toBeLessThan(4.5)
    expect(worst).toBeLessThan(0)
    // overlapping rings of sink stay gentle
    expect(worst).toBeGreaterThan(-1.5)
  })

  it("gives dynamic soaring only across the wind, never along it", () => {
    expect(soarGain(0, 0, 8, 0.3)).toBeCloseTo(0)
    expect(soarGain(Math.PI, 0, 8, 0.3)).toBeCloseTo(0)
    expect(soarGain(Math.PI / 2, 0, 8, 0.3)).toBeCloseTo(2.4)
  })
})
