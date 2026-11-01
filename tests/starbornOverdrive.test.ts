import { describe, expect, it } from "vitest"
import { makeIdentity } from "../src/game/horses/breeds"
import { makeHorseState, type HorseState } from "../src/game/horses/horseState"
import { groundHeight } from "../src/game/world-layout"
import { cancelLanding, flightOf, requestGallopLanding, startTakeoff, stepFlight, touchDown } from "../src/game/pegasus/flight"
import { SKILLS } from "../src/game/pegasus/skills"

const airborne = (breed: "ivory" | "onyx" | "starborn", alt: number, x = -36, z = -24): HorseState => {
  const h = makeHorseState(makeIdentity(708, breed, { saddled: true, scale: 1 }), x, z, true)
  h.y = groundHeight(x, z) + alt
  h.heading = 0
  const f = flightOf(h)!
  f.mode = "air"; f.alt = alt; f.spread = 1
  h.speed = f.spec.cruise
  return h
}
type Intent = Partial<NonNullable<HorseState["flight"]>["intent"]>
const fly = (h: HorseState, seconds: number, intent: Intent, each?: () => void): void => {
  for (let t = 0; t < seconds; t += 1 / 60) {
    Object.assign(h.flight!.intent, { thrust: 0, turn: 0, climb: 0, boost: false, land: false }, intent)
    stepFlight(h, 1 / 60, () => 0.5)
    each?.()
  }
}

describe("Starborn's overdrive: the dash held opens into her own speed", () => {
  it("is hers alone, and far beyond any other Pegasus's dash", () => {
    const starborn = airborne("starborn", 60), ivory = airborne("ivory", 60), onyx = airborne("onyx", 60)
    for (const h of [starborn, ivory, onyx]) fly(h, 4, { boost: true })
    expect(starborn.flight!.overdrive).toBeGreaterThan(0.9)
    expect(starborn.speed).toBeGreaterThan(80)
    expect(ivory.flight!.overdrive).toBe(0)
    expect(ivory.speed).toBeLessThan(SKILLS.ivory.dash.speed * 1.26)
    expect(onyx.speed).toBeLessThan(SKILLS.onyx.dash.speed * 1.26)
  })

  it("comes on as a shove and then a rush, not a jump: no frame gains more than ~4.5 g", () => {
    const h = airborne("starborn", 60)
    let last = h.speed, worst = 0
    fly(h, 4, { boost: true }, () => { worst = Math.max(worst, (h.speed - last) * 60); last = h.speed })
    expect(worst).toBeLessThan(45)
    expect(worst).toBeGreaterThan(15)
  })

  it("is faster still high up the sky than skimming the land", () => {
    const low = airborne("starborn", 40), high = airborne("starborn", 600)
    fly(low, 5, { boost: true }); fly(high, 5, { boost: true })
    expect(high.speed).toBeGreaterThan(low.speed + 40)
    expect(high.speed).toBeGreaterThan(150)
  })

  it("letting go is a coast back to the dash, never a brake", () => {
    const h = airborne("starborn", 300)
    fly(h, 5, { boost: true })
    const top = h.speed
    let last = h.speed, worst = 0
    fly(h, 0.5, {}, () => { worst = Math.max(worst, (last - h.speed) * 60); last = h.speed })
    expect(worst).toBeLessThan(140)
    expect(h.speed).toBeGreaterThan(top * 0.55)
    fly(h, 6, {})
    expect(h.speed).toBeLessThan(SKILLS.starborn.dash.speed * 1.3)
    expect(h.flight!.overdrive).toBeLessThan(0.01)
  })

  it("still answers the reins: a full turn swings her heading quickly, banked into the carve", () => {
    const h = airborne("starborn", 200)
    fly(h, 4, { boost: true })
    const heading = h.heading
    fly(h, 1, { boost: true, turn: 1 })
    expect(h.heading - heading).toBeGreaterThan(0.9)
    expect(Math.abs(h.flight!.roll)).toBeGreaterThan(0.8)
  })

  it("never meets the land at full speed: low over the endless world in every direction", () => {
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.8]) {
      const h = airborne("starborn", 12, 400, -900)
      h.heading = heading
      let lowest = Infinity
      fly(h, 25, { boost: true }, () => { lowest = Math.min(lowest, h.y - groundHeight(h.x, h.z)) })
      expect(lowest).toBeGreaterThan(0.5)
      expect(h.flight!.mode).toBe("air")
    }
  }, 10_000) // Five 25-second terrain simulations need room under full-suite CPU contention.

  it("sweeps the wings back half-shut at full stretch, still wide enough to carry her light", () => {
    const h = airborne("starborn", 200)
    fly(h, 4, { boost: true })
    expect(h.flight!.tuck).toBeGreaterThan(0.5)
    expect(h.flight!.tuck).toBeLessThan(0.75)
  })

  it("coasts out of overdrive during an approach, including when the rider keeps flying", () => {
    const h = airborne("starborn", 60)
    fly(h, 4, { boost: true })
    const full = h.flight!.overdrive
    requestGallopLanding(h)
    fly(h, 1, {})
    expect(h.flight!.mode).toBe("landing")
    expect(h.flight!.overdrive).toBeGreaterThan(0)
    expect(h.flight!.overdrive).toBeLessThan(full * 0.3)
    expect(h.flight!.odT).toBe(0)
    cancelLanding(h)
    fly(h, 3, {})
    expect(h.flight!.mode).toBe("air")
    expect(h.flight!.overdrive).toBeLessThan(0.01)
    fly(h, 4, { boost: true })
    expect(h.flight!.overdrive).toBeGreaterThan(0.9)
  })

  it("leaves no overdrive at touchdown or on the next unboosted takeoff", () => {
    const h = airborne("starborn", 60)
    fly(h, 4, { boost: true })
    // A short final approach can still have residual energy at contact.
    requestGallopLanding(h)
    touchDown(h)
    expect(h.flight!.overdrive).toBe(0)
    expect(h.flight!.odT).toBe(0)
    expect(h.flight!.landing.run).toBe(true)
    expect(startTakeoff(h)).toBe("ok")
    fly(h, 0.2, {})
    expect(h.flight!.mode).toBe("takeoff")
    expect(h.flight!.overdrive).toBe(0)
  })
})
