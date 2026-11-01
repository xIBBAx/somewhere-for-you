import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { BREEDS, BREED_IDS, PEGASUS_IDS, makeIdentity } from "../src/game/horses/breeds"
import { horseRT, makeHorseState, type HorseState } from "../src/game/horses/horseState"
import { standable } from "../src/game/horses/horseMotion"
import { groundHeight } from "../src/game/world-layout"
import { waterSurfaceAt } from "../src/world/waterSurface"
import { autopilot, flightOf, groundNow, startTakeoff, stepFlight, surfaceAt } from "../src/game/pegasus/flight"
import { WingAnimator, makeWingPose } from "../src/game/pegasus/WingAnimator"
import { findStarHill, PEGASI } from "../src/game/pegasus/pegasi"
import { requestDismount, resetRider, riderRT, restoreRiderSeat, resetFlightControls, startMount, stepRiding } from "../src/game/horses/riding"
import { companionRT, playerRT } from "../src/game/runtime"

const beside = (h: HorseState): void => {
  for (const [b, dx] of [[playerRT, 1.6], [companionRT, -1.6]] as const) b.pos.set(h.x + dx, groundHeight(h.x + dx, h.z), h.z)
}

// open meadow beyond the home herd, where Ivory and Onyx live
const OPEN = { x: -36, z: -24 }

const pegasus = (breed: "ivory" | "onyx" | "starborn" = "ivory"): HorseState => {
  const h = makeHorseState(makeIdentity(707, breed, { saddled: true, scale: 1 }), OPEN.x, OPEN.z, true)
  h.y = groundHeight(OPEN.x, OPEN.z)
  h.heading = 0
  flightOf(h)
  return h
}

/** Advance flight at 60 Hz until `done` or `seconds` pass; ground motion is ignored. */
const fly = (h: HorseState, seconds: number, done?: () => boolean): number => {
  let t = 0
  for (; t < seconds; t += 1 / 60) {
    stepFlight(h, 1 / 60, () => 0.5)
    if (done?.()) break
  }
  return t
}

describe("trusted mounted travel", () => {
  it("restores both occupied seats in flight without a mount transition", () => {
    resetRider("explorer")
    resetRider("companion")
    const h = pegasus("starborn")
    h.flight!.mode = "air"
    h.flight!.alt = 80
    h.flight!.pitch = 0.2
    h.flight!.roll = 0.3
    h.y += 80
    h.speed = h.flight!.spec.cruise
    playerRT.revision++
    companionRT.revision++
    restoreRiderSeat("explorer", h, 0)
    restoreRiderSeat("companion", h, 1)
    expect(h.rider).toBe("explorer")
    expect(h.passenger).toBe("companion")
    expect(h.flight!.mode).toBe("air")
    for (const [id, body, seat] of [["explorer", playerRT, 0], ["companion", companionRT, 1]] as const) {
      const r = riderRT[id]
      expect(r.phase).toBe("riding")
      expect(r.seat).toBe(seat)
      expect(r.rev).toBe(body.revision)
      expect(body.rideY).toBe(r.rootY)
      expect(body.ridePitch).toBe(0.2)
      expect(body.rideRoll).toBe(0.3)
      expect(body.pos.y).toBeGreaterThan(h.y - 2)
      expect(Number.isFinite(r.handL.x) && Number.isFinite(r.footR.y)).toBe(true)
    }
    riderRT.explorer.wantOff = true
    h.flight!.intent.land = true
    h.flight!.intent.roll = 1
    resetFlightControls("explorer")
    expect(riderRT.explorer.wantOff).toBe(false)
    expect(h.flight!.intent.land).toBe(false)
    expect(h.flight!.intent.roll).toBe(0)
    resetRider("companion")
    resetRider("explorer")
  })
})

describe("the Pegasi", () => {
  it("are their own breeds, kept out of the wild herds, each able to fly", () => {
    for (const id of PEGASUS_IDS) {
      expect(BREED_IDS).not.toContain(id)
      const f = BREEDS[id].flight!
      expect(f.cruise).toBeGreaterThan(f.minSpeed)
      expect(f.boost).toBeGreaterThan(f.cruise)
      expect(f.bank).toBeLessThanOrEqual(0.8) // ~45 degrees: comfortable banks
    }
    for (const id of BREED_IDS) expect(BREEDS[id].flight).toBeUndefined()
    // only the star-born one can carry two, and leave the sky
    expect(BREEDS.starborn.flight!.seats).toBe(2)
    expect(BREEDS.starborn.flight!.ceiling).toBe(Infinity)
    expect(BREEDS.ivory.flight!.ceiling).toBeLessThan(1000)
    expect(PEGASI.map((p) => p.owner)).toEqual(["explorer", "companion", null])
  })

  it("Ivory and Onyx differ in more than colour", () => {
    const a = BREEDS.ivory.flight!
    const b = BREEDS.onyx.flight!
    expect(b.cruise).toBeGreaterThan(a.cruise) // the stallion is faster
    expect(a.turn).toBeGreaterThan(b.turn) // the mare is nimbler
    expect(a.flapHz).toBeGreaterThan(b.flapHz) // lighter, quicker wingbeats
  })

  it("finds the Star Hill on open, high ground away from home", () => {
    const hill = findStarHill()
    expect(Math.hypot(hill.x, hill.z + 2)).toBeGreaterThan(200)
    expect(standable(hill.x, hill.z, 1.5)).toBe(true)
  })
})

describe("flight", () => {
  it("takes off from a stand: the forehand rises first, then it climbs into the air", () => {
    const h = pegasus()
    expect(startTakeoff(h)).toBe("ok")
    expect(startTakeoff(h)).toBe("busy")
    // a moment in, the hooves have barely left the ground
    fly(h, 0.3)
    expect(h.flight!.alt).toBeLessThan(0.5)
    const t = fly(h, 6, () => h.flight!.mode === "air")
    expect(h.flight!.mode).toBe("air")
    expect(t).toBeLessThan(4)
    expect(h.flight!.alt).toBeGreaterThan(3)
    expect(h.flight!.spread).toBeGreaterThan(0.9)
  })

  it("holds its height in level flight, climbs on Space and comes down on C", () => {
    const h = pegasus()
    startTakeoff(h)
    fly(h, 6, () => h.flight!.mode === "air")
    const i = h.flight!.intent
    i.climb = 1
    fly(h, 6)
    const high = h.y
    expect(high - groundHeight(h.x, h.z)).toBeGreaterThan(18)
    i.climb = 0
    fly(h, 3)
    const y0 = h.y
    fly(h, 4)
    expect(Math.abs(h.y - y0)).toBeLessThan(4)
    i.climb = -1
    fly(h, 2)
    expect(h.y).toBeLessThan(y0 - 4)
    // diving trades height for speed
    expect(h.speed).toBeGreaterThan(BREEDS.ivory.flight!.cruise - 0.5)
  })

  it("turns in a banked, coordinated turn, never faster than the breed allows", () => {
    const h = pegasus()
    startTakeoff(h)
    fly(h, 6, () => h.flight!.mode === "air")
    h.flight!.intent.climb = 1
    fly(h, 4)
    h.flight!.intent.climb = 0
    const heading0 = h.heading
    h.flight!.intent.turn = 1
    let maxRate = 0
    for (let k = 0; k < 180; k++) {
      stepFlight(h, 1 / 60)
      maxRate = Math.max(maxRate, Math.abs(h.turnRate))
    }
    expect(h.heading).toBeGreaterThan(heading0 + 0.5) // + turns left
    expect(h.flight!.roll).toBeGreaterThan(0.4) // banked into it
    // agile, but bounded: the breed figure × 2.6, sharper only when slow (×1.6 at most)
    expect(maxRate).toBeLessThanOrEqual(BREEDS.ivory.flight!.turn * 2.6 * 1.6 + 1e-6)
    expect(maxRate).toBeGreaterThan(BREEDS.ivory.flight!.turn * 1.5)
  })

  it("flies a dash for as long as it is held, with no cool-down (a Pegasus never tires)", () => {
    const h = pegasus("onyx")
    startTakeoff(h)
    fly(h, 6, () => h.flight!.mode === "air")
    h.flight!.intent.boost = true
    fly(h, 2.5)
    expect(h.speed).toBeGreaterThan(BREEDS.onyx.flight!.cruise + 5)
    fly(h, 8)
    expect(h.flight!.boostT).toBeGreaterThan(10)
    expect(h.flight!.boostCool).toBe(0)
  })

  it("lands with a flare onto ground it can stand on, then runs out at a canter at most", () => {
    const h = pegasus()
    startTakeoff(h)
    fly(h, 6, () => h.flight!.mode === "air")
    h.flight!.intent.land = true
    let flared = 0
    const t = fly(h, 30, () => {
      flared = Math.max(flared, h.flight!.flare)
      return h.flight!.mode === "ground"
    })
    expect(h.flight!.mode).toBe("ground")
    expect(t).toBeLessThan(25)
    expect(flared).toBeGreaterThan(0.6)
    expect(h.speed).toBeLessThanOrEqual(h.pose.speeds[2] + 1e-6)
    expect(h.y).toBeCloseTo(groundHeight(h.x, h.z), 3)
    expect(h.flight!.stats.landings).toBe(1)
  })

  it("sets down on deep water and runs on its surface (a Pegasus is a strider)", () => {
    // find a lake near home
    let lake: { x: number; z: number } | null = null
    for (let r = 20; r < 900 && !lake; r += 10) {
      for (let a = 0; a < 32 && !lake; a++) {
        const x = Math.cos(a) * r
        const z = Math.sin(a) * r
        const w = waterSurfaceAt(x, z)
        if (w !== null && w - groundHeight(x, z) > 1.5 && waterSurfaceAt(x + 30, z) !== null && waterSurfaceAt(x - 30, z) !== null) lake = { x, z }
      }
    }
    expect(lake).not.toBeNull()
    const h = pegasus()
    h.x = lake!.x
    h.z = lake!.z
    h.flight!.mode = "landing"
    h.y = surfaceAt(h.x, h.z) + 2
    h.speed = 4
    h.flight!.intent.land = true
    fly(h, 8, () => h.flight!.mode === "ground")
    expect(h.flight!.stats.aborted).toBe(0)
    expect(h.flight!.mode).toBe("ground")
    // she stands on the water, not on the lake bed
    expect(h.y).toBeGreaterThan(groundHeight(h.x, h.z) + 1)
  })

  it("stops climbing at the ceiling unless it is star-born", () => {
    for (const breed of ["ivory", "starborn"] as const) {
      const h = pegasus(breed)
      startTakeoff(h)
      fly(h, 6, () => h.flight!.mode === "air")
      h.flight!.intent.climb = 1
      fly(h, 260)
      const above = h.y - groundHeight(h.x, h.z)
      if (breed === "ivory") expect(above).toBeLessThan(BREEDS.ivory.flight!.ceiling + 40)
      else expect(above).toBeGreaterThan(BREEDS.ivory.flight!.ceiling + 100)
    }
  })

  it("never scrapes the ground in level flight, climbing over rising terrain", () => {
    const h = pegasus()
    startTakeoff(h)
    fly(h, 6, () => h.flight!.mode === "air")
    h.flight!.intent.climb = -1
    let minAlt = Infinity
    for (let k = 0; k < 60 * 40; k++) {
      stepFlight(h, 1 / 60)
      if (h.flight!.mode === "air") minAlt = Math.min(minAlt, h.y - surfaceAt(h.x, h.z))
    }
    expect(minAlt).toBeGreaterThan(0.5)
  })

  it("an autopilot brings a called Pegasus in to land near its caller", () => {
    const h = pegasus()
    h.flight!.mode = "air"
    h.flight!.spread = 1
    h.y = groundHeight(h.x, h.z) + 40
    h.speed = 16
    const goal = { x: OPEN.x + 160, z: OPEN.z + 40, y: null, speed: null, land: true, heading: null }
    let t = 0
    for (; t < 90 && (h.flight!.mode as string) !== "ground"; t += 1 / 30) {
      autopilot(h, goal, h.flight!.intent)
      if (Math.hypot(goal.x - h.x, goal.z - h.z) < 22 && h.flight!.mode === "air") h.flight!.intent.land = true
      stepFlight(h, 1 / 30)
    }
    if ((h.flight!.mode as string) === "ground") expect(Math.hypot(goal.x - h.x, goal.z - h.z)).toBeLessThan(45)
    else expect(h.flight!.stats.aborted).toBeGreaterThan(0) // somewhere unlandable: it is still trying
  })

  it("groundNow puts a flying Pegasus straight back on its feet", () => {
    const h = pegasus()
    startTakeoff(h)
    fly(h, 6, () => h.flight!.mode === "air")
    groundNow(h)
    expect(h.flight!.mode).toBe("ground")
    expect(h.y).toBeCloseTo(groundHeight(h.x, h.z), 5)
  })
})

describe("riding a Pegasus", () => {
  it("lets two ride Starborn: the second rider takes the rear seat; others are one-seat", () => {
    const starborn = pegasus("starborn")
    // her real saddle: the tandem seats and stirrups from the shipped model
    const glb = readFileSync("public/assets/horses/starborn.glb")
    const gj = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString()) as { nodes: Array<{ extras?: { horse?: string } }> }
    starborn.model = { meta: JSON.parse(gj.nodes.find((n) => n.extras?.horse)!.extras!.horse!) } as unknown as HorseState["model"]
    horseRT.horses.set(starborn.ident.id, starborn)
    resetRider("explorer")
    resetRider("companion")
    beside(starborn)
    expect(startMount("explorer", starborn)).toBe("ok")
    expect(starborn.rider).toBe("explorer")
    riderRT.explorer.phase = "riding"
    expect(startMount("companion", starborn)).toBe("ok")
    expect(starborn.passenger).toBe("companion")
    expect(riderRT.companion.seat).toBe(1)
    expect(riderRT.explorer.seat).toBe(0)
    // both climb up and settle, one behind the other along her back
    for (let t = 0; t < 6; t += 1 / 30) stepRiding(1 / 30, t)
    expect(riderRT.explorer.phase).toBe("riding")
    expect(riderRT.companion.phase).toBe("riding")
    const fwdX = Math.sin(starborn.heading), fwdZ = Math.cos(starborn.heading)
    const along = (r: typeof riderRT.explorer) => (r.rootX - starborn.x) * fwdX + (r.rootZ - starborn.z) * fwdZ
    const gap = along(riderRT.explorer) - along(riderRT.companion)
    expect(gap).toBeGreaterThan(0.38) // The explorer in front with the reins, the companion behind
    expect(gap).toBeLessThan(0.75)
    const side = (r: typeof riderRT.explorer) => (r.rootX - starborn.x) * fwdZ - (r.rootZ - starborn.z) * fwdX
    expect(Math.abs(side(riderRT.explorer))).toBeLessThan(0.12)
    expect(Math.abs(side(riderRT.companion))).toBeLessThan(0.12)
    // a third can't squeeze on, and the front rider getting off leaves the companion aboard
    expect(startMount("explorer", starborn)).not.toBe("ok")
    resetRider("explorer")
    expect(starborn.rider ?? starborn.passenger).toBe("companion")
    resetRider("companion")
    resetRider("companion")
    expect(starborn.rider).toBeNull()
    expect(starborn.passenger).toBeNull()
    const ivory = pegasus("ivory")
    beside(ivory)
    expect(startMount("explorer", ivory)).toBe("ok")
    riderRT.explorer.phase = "riding"
    expect(startMount("companion", ivory)).toBe("busy")
    resetRider("explorer")
    horseRT.horses.delete(starborn.ident.id)
  })

  it("riding a Pegasus leaves your own horse yours (U still calls it)", () => {
    const ivory = pegasus("ivory")
    resetRider("explorer")
    horseRT.bonded.explorer = "herd:some-horse"
    beside(ivory)
    expect(startMount("explorer", ivory)).toBe("ok")
    expect(horseRT.bonded.explorer).toBe("herd:some-horse")
    resetRider("explorer")
  })

  it("asks to land before getting off in the air", () => {
    const ivory = pegasus("ivory")
    resetRider("explorer")
    beside(ivory)
    expect(startMount("explorer", ivory)).toBe("ok")
    riderRT.explorer.phase = "riding"
    startTakeoff(ivory)
    fly(ivory, 6, () => ivory.flight!.mode === "air")
    expect(requestDismount("explorer")).toBe("landing")
    expect(riderRT.explorer.wantOff).toBe(true)
    resetRider("explorer")
    expect(ivory.flight!.mode).toBe("ground")
  })
})

describe("wing animation", () => {
  const groups = { "0": [-38, -6], "1": [-4, 2.5], "2": [3.5, 10], "3": [16, 44], "4": [50, 72] } as Record<string, [number, number]>
  const fakePoser = () => {
    const deltas = new Map<string, unknown>()
    return { has: () => true, setDelta: (n: string, q: unknown) => deltas.set(n, q), deltas } as never as import("../src/game/rig/RigPoser").RigPoser & { deltas: Map<string, unknown> }
  }

  it("folds the flight feathers back along the arm and leaves them in place when spread", () => {
    const P = fakePoser()
    const w = new WingAnimator(P, groups, "soar", () => 0.5)
    const pose = makeWingPose()
    pose.spread = 0
    w.update(P, pose, 1 / 60)
    // folded: the secondaries (on the forearm, which points forward) swing
    // back by about a right angle; mirrored on the right wing
    expect(w.featherA[1]).toBeGreaterThan(1.2)
    expect(Math.abs(w.featherA[1] - w.featherA[6])).toBeLessThan(1e-6)
    pose.spread = 1
    pose.glide = 1
    // Living wings unfold continuously; verify the final shader fold agrees
    // with the spread arm after its short response, rather than demanding a snap.
    for (let n = 0; n < 60; n++) w.update(P, pose, 1 / 60)
    for (let g = 0; g < 3; g++) expect(Math.abs(w.featherA[g])).toBeLessThan(0.05)
  })

  it("fans the eagle's outer primaries wider than the swan's", () => {
    const P = fakePoser()
    const eagle = new WingAnimator(P, groups, "slot", () => 0.5)
    const swan = new WingAnimator(P, groups, "soar", () => 0.5)
    const pose = makeWingPose()
    pose.spread = 1
    pose.power = 1
    pose.flap = 0.25 // mid-downstroke
    eagle.update(P, pose, 1 / 60)
    swan.update(P, pose, 1 / 60)
    expect(Math.abs(eagle.featherFan[4])).toBeGreaterThan(Math.abs(swan.featherFan[4]))
  })

  it("loads the feather tips on the downstroke, not the upstroke", () => {
    const P = fakePoser()
    const w = new WingAnimator(P, groups, "swan", () => 0.5)
    const pose = makeWingPose()
    pose.spread = 1
    pose.power = 1
    pose.flap = 0.27
    w.update(P, pose, 1 / 60)
    const down = w.flex[0]
    pose.flap = 0.8
    w.update(P, pose, 1 / 60)
    expect(down).toBeGreaterThan(w.flex[0])
  })
})
