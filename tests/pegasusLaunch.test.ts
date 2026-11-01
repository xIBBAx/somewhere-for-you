import { describe, expect, it } from "vitest"
import { makeIdentity } from "../src/game/horses/breeds"
import { makeHorseState, type HorseState } from "../src/game/horses/horseState"
import { groundHeight } from "../src/game/world-layout"
import { flightOf, stepFlight, LAUNCH_ANGLE } from "../src/game/pegasus/flight"
import { SKILLS } from "../src/game/pegasus/skills"

const OPEN = { x: -36, z: -24 }

const airborne = (breed: "ivory" | "onyx" | "starborn", alt = 80): HorseState => {
  const h = makeHorseState(makeIdentity(708, breed, { saddled: true, scale: 1 }), OPEN.x, OPEN.z, true)
  h.y = groundHeight(OPEN.x, OPEN.z) + alt
  h.heading = 0
  const f = flightOf(h)!
  f.mode = "air"
  f.alt = alt
  f.spread = 1
  h.speed = f.spec.cruise
  return h
}

type Intent = Partial<NonNullable<HorseState["flight"]>["intent"]>
const fly = (h: HorseState, seconds: number, intent: Intent, each?: (t: number) => void): void => {
  const f = h.flight!
  for (let t = 0; t < seconds; t += 1 / 60) {
    Object.assign(f.intent, { thrust: 0, turn: 0, climb: 0, boost: false, land: false }, intent)
    stepFlight(h, 1 / 60, () => 0.5)
    each?.(t)
  }
}
const pathAngle = (h: HorseState): number => Math.atan2(h.flight!.vy, h.speed)

describe("the launch: Shift with Space swings the dash up into the vertical", () => {
  it("turns a level dash into a near-vertical climb within half a second, keeping the speed", () => {
    for (const breed of ["ivory", "onyx", "starborn"] as const) {
      const h = airborne(breed)
      fly(h, 3, { boost: true })
      const dash = h.speed
      expect(pathAngle(h)).toBeLessThan(0.1)
      fly(h, 0.5, { boost: true, climb: 1 })
      expect(pathAngle(h)).toBeGreaterThan(1.0)
      fly(h, 0.6, { boost: true, climb: 1 })
      const f = h.flight!
      expect(pathAngle(h)).toBeGreaterThan(LAUNCH_ANGLE - 0.08)
      expect(pathAngle(h)).toBeLessThan(1.4)
      // the speed went up the climb rather than being thrown away
      expect(Math.hypot(h.speed, f.vy)).toBeGreaterThan(dash * 0.98)
      expect(f.vy).toBeGreaterThan(SKILLS[breed].dash.speed * 0.9)
      // the body leans into it, the wings drive (no swept-back dash glide)
      expect(f.pitch).toBeGreaterThan(1.1)
      expect(f.glide).toBeLessThan(0.15)
      expect(f.power).toBeGreaterThan(1.2)
      expect(f.stats.launches).toBe(1)
    }
  })

  it("climbs many times faster than an ordinary Space climb", () => {
    const plain = airborne("starborn"), launch = airborne("starborn")
    const y0 = plain.y
    fly(plain, 4, { climb: 1 })
    fly(launch, 1.5, { boost: true })
    const y1 = launch.y
    fly(launch, 4, { boost: true, climb: 1 })
    expect(launch.y - y1).toBeGreaterThan((plain.y - y0) * 3)
  })

  it("never snaps: the path rotates at a bounded rate, frame to frame", () => {
    const h = airborne("starborn")
    fly(h, 2, { boost: true })
    let last = pathAngle(h), worst = 0
    fly(h, 1.5, { boost: true, climb: 1 }, () => {
      const a = pathAngle(h)
      worst = Math.max(worst, Math.abs(a - last))
      last = a
    })
    // under ~4 rad/s at 60 fps
    expect(worst).toBeLessThan(4 / 60)
  })

  it("stays flyable: A/D still turn and slide her in the climb, and letting go of Space levels the dash", () => {
    const h = airborne("starborn")
    fly(h, 2, { boost: true })
    fly(h, 1, { boost: true, climb: 1 })
    const heading = h.heading
    fly(h, 1, { boost: true, climb: 1, turn: 1 })
    expect(h.heading - heading).toBeGreaterThan(0.4)
    fly(h, 1.6, { boost: true })
    expect(Math.abs(pathAngle(h))).toBeLessThan(0.2)
    expect(h.speed).toBeGreaterThan(SKILLS.starborn.dash.speed * 0.95)
    expect(h.flight!.launch).toBeLessThan(0.05)
  })

  it("carries the climb on as a zoom when Shift is let go, rather than cutting it dead", () => {
    // (a winged horse: the star-born's own climb quickens with height anyway)
    const h = airborne("onyx")
    fly(h, 2, { boost: true })
    fly(h, 1.5, { boost: true, climb: 1 })
    const vy = h.flight!.vy
    fly(h, 0.25, { climb: 1 })
    expect(h.flight!.vy).toBeGreaterThan(vy * 0.6)
    fly(h, 3, { climb: 1 })
    expect(h.flight!.vy).toBeLessThan(vy * 0.5)
    expect(h.flight!.mode).toBe("air")
  })

  it("levels a winged horse out under its ceiling; the star-born goes on up to the sails", () => {
    const ivory = airborne("ivory", 300)
    fly(ivory, 1, { boost: true })
    fly(ivory, 30, { boost: true, climb: 1 })
    expect(ivory.y - groundHeight(ivory.x, ivory.z)).toBeLessThan(700)
    const starborn = airborne("starborn", 300)
    fly(starborn, 1, { boost: true })
    let sailed = false
    fly(starborn, 40, { boost: true, climb: 1 }, () => { if (starborn.flight!.mode === "sail") sailed = true })
    expect(sailed).toBe(true)
  })
})

describe("high in the air with no hand on the climb", () => {
  it("the star-born holds her height near the top of the air, rather than climbing back into space", () => {
    const h = airborne("starborn", 880)
    const y0 = h.y
    fly(h, 20, {})
    expect(h.flight!.mode).toBe("air")
    expect(h.y - y0).toBeLessThan(40)
  })
})
