import { afterEach, describe, expect, it, vi } from "vitest"
import { standable } from "../src/game/horses/horseMotion"
import { horseRT } from "../src/game/horses/horseState"
import { loadHorses } from "../src/game/horses/horsePersistence"
import { pegasusRT, spawnPegasi } from "../src/game/pegasus/pegasi"
import { fastPlaces, HOME_SPOT, safeSpotNear, travelRefusal } from "../src/game/travel/fastTravel"
import { beyondReach, fellThrough, HoldTimer, nearestSafeSpot, PLAYABLE_REACH, recoveryPlan, StuckTimer, validRestoredSpot } from "../src/game/travel/safety"

/** Safety rules for falling, stuck bodies, recovery and reload. */

describe("nearestSafeSpot", () => {
  it("keeps a spot that is already safe", () => {
    expect(nearestSafeSpot(3, 4, () => true)).toEqual({ x: 3, z: 4 })
  })

  it("searches outward and finds the nearest safe ring", () => {
    // only the ground east of x=10 is safe
    const spot = nearestSafeSpot(0, 0, (x) => x >= 10, 60, 2)!
    expect(spot).not.toBeNull()
    expect(spot.x).toBeGreaterThanOrEqual(10)
    expect(Math.hypot(spot.x, spot.z)).toBeLessThan(14)
  })

  it("returns null when nothing within reach is safe", () => {
    expect(nearestSafeSpot(0, 0, () => false, 20, 2)).toBeNull()
  })

  it("refuses a broken starting point", () => {
    expect(nearestSafeSpot(NaN, 0, () => true)).toBeNull()
  })
})

describe("fellThrough", () => {
  it("is false on the ground and above it", () => {
    expect(fellThrough(2, 2)).toBe(false)
    expect(fellThrough(10, 2)).toBe(false)
  })

  it("is true well below the ground", () => {
    expect(fellThrough(-20, 2)).toBe(true)
  })

  it("is true for a position that is not a number", () => {
    expect(fellThrough(NaN, 2)).toBe(true)
  })
})

describe("HoldTimer", () => {
  it("fires once the state has held for the time, and resets on a break", () => {
    const t = new HoldTimer(0.5)
    expect(t.update(0.3, true)).toBe(false)
    expect(t.update(0.3, false)).toBe(false)
    expect(t.update(0.3, true)).toBe(false)
    expect(t.update(0.3, true)).toBe(true)
  })
})

describe("StuckTimer", () => {
  it("fires after the time with no progress while pushing", () => {
    const s = new StuckTimer(4, 1)
    let fired = false
    for (let i = 0; i < 50 && !fired; i++) fired = s.update(0.1, 5, 5, true)
    expect(fired).toBe(true)
  })

  it("does not fire while the body is making progress", () => {
    const s = new StuckTimer(4, 1)
    let fired = false
    for (let i = 0; i < 100; i++) fired = fired || s.update(0.1, i * 0.5, 0, true)
    expect(fired).toBe(false)
  })

  it("does not fire when no movement is held", () => {
    const s = new StuckTimer(4, 1)
    let fired = false
    for (let i = 0; i < 100; i++) fired = fired || s.update(0.1, 0, 0, false)
    expect(fired).toBe(false)
  })
})

describe("recoveryPlan", () => {
  const calm = { journey: false, off: false, broken: false, lost: false, stuck: false }

  it("does nothing for a body that is fine", () => {
    expect(recoveryPlan(calm)).toBe("none")
  })

  it("cancels a journey first", () => {
    expect(recoveryPlan({ ...calm, journey: true, off: true, lost: true })).toBe("journey")
  })

  it("sends anything off Earth home by sky", () => {
    expect(recoveryPlan({ ...calm, off: true })).toBe("space")
  })

  it("puts a broken position straight home", () => {
    expect(recoveryPlan({ ...calm, broken: true, lost: true })).toBe("home")
  })

  it("sets a lost or stuck body down on the nearest safe ground", () => {
    expect(recoveryPlan({ ...calm, lost: true })).toBe("nearby")
    expect(recoveryPlan({ ...calm, stuck: true })).toBe("nearby")
  })
})

describe("beyondReach and validRestoredSpot", () => {
  const home = { x: 0, z: 0 }
  const everywhere = () => true

  it("measures reach from home", () => {
    expect(beyondReach(PLAYABLE_REACH - 1, 0, home)).toBe(false)
    expect(beyondReach(PLAYABLE_REACH + 1, 0, home)).toBe(true)
  })

  it("keeps a saved spot that is finite, standable and within reach", () => {
    expect(validRestoredSpot({ x: 10, z: 10 }, { x: 1, z: 1 }, everywhere, home)).toEqual({ x: 10, z: 10 })
  })

  it("falls back for NaN, far-away (deep space, the Moon) and unstandable spots", () => {
    const fb = { x: 1, z: 1 }
    expect(validRestoredSpot({ x: NaN, z: 0 }, fb, everywhere, home)).toBe(fb)
    expect(validRestoredSpot({ x: 6_000_000, z: 6_000_000 }, fb, everywhere, home)).toBe(fb)
    expect(validRestoredSpot({ x: 10, z: 10 }, fb, () => false, home)).toBe(fb)
  })
})

describe("fast travel places", () => {
  it("has finite places and a home that is standable", () => {
    for (const p of fastPlaces()) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true)
    }
    const s = safeSpotNear(HOME_SPOT.x, HOME_SPOT.z)
    expect(standable(s.x, s.z, 1.2)).toBe(true)
  })

  it("lands on the nearest safe spot for the Star Hill", () => {
    spawnPegasi()
    const hill = fastPlaces().find((p) => p.id === "star-hill")!
    const s = safeSpotNear(hill.x, hill.z)
    expect(Math.hypot(s.x - hill.x, s.z - hill.z)).toBeLessThan(60)
  })

  it("is free to travel on Earth", () => {
    expect(travelRefusal()).toBeNull()
  })
})

describe("reload of horse positions", () => {
  const store = new Map<string, string>()
  afterEach(() => {
    vi.unstubAllGlobals()
    store.clear()
  })

  it("keeps a good saved place, and puts a bad one back at home", () => {
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } })
    for (const id of ["pegasus:ivory", "pegasus:onyx", "pegasus:starborn"]) horseRT.horses.delete(id)
    spawnPegasi()
    const starborn = horseRT.horses.get("pegasus:starborn")!
    const homeX = starborn.homeX
    const homeZ = starborn.homeZ
    store.set("gift-world/horses", JSON.stringify({
      v: 1, bonded: {}, starbornMet: false,
      horses: {
        "pegasus:starborn": { x: 6_000_000, z: 6_000_000, heading: 0, seed: 70303, breed: "starborn", saddled: true, trust: 1, adopted: false },
      },
    }))
    loadHorses()
    expect(starborn.x).toBeCloseTo(homeX)
    expect(starborn.z).toBeCloseTo(homeZ)
    expect(Number.isFinite(starborn.y)).toBe(true)
    expect(pegasusRT.starbornMet).toBe(true)
  })

  it("restores nothing from a broken save", () => {
    vi.stubGlobal("localStorage", { getItem: () => "{not json", setItem: () => {} })
    for (const id of ["pegasus:ivory", "pegasus:onyx", "pegasus:starborn"]) horseRT.horses.delete(id)
    spawnPegasi()
    const before = horseRT.horses.get("pegasus:starborn")!.x
    expect(() => loadHorses()).not.toThrow()
    expect(horseRT.horses.get("pegasus:starborn")!.x).toBe(before)
  })
})
