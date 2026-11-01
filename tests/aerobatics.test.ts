import { describe, expect, it } from "vitest"
import { makeIdentity } from "../src/game/horses/breeds"
import { makeHorseState, type HorseState } from "../src/game/horses/horseState"
import { groundHeight } from "../src/game/world-layout"
import { flightOf, stepFlight, surfaceAt } from "../src/game/pegasus/flight"
import { aeroRT, keyTrick, makeTap, makeTrickTaps, riderGrip, stepTrick, tapTwice, tickAero, tryTrick, type TrickKind } from "../src/game/pegasus/aerobatics"

// open meadow beyond the home herd, as in pegasus.test.ts
const OPEN = { x: -36, z: -24 }

const pegasus = (breed: "ivory" | "onyx" | "starborn" = "ivory", alt = 60): HorseState => {
  const h = makeHorseState(makeIdentity(707, breed, { saddled: true, scale: 1 }), OPEN.x, OPEN.z, true)
  h.y = groundHeight(OPEN.x, OPEN.z)
  h.heading = 0
  const f = flightOf(h)!
  // already flying level at cruise, the air clear below
  f.mode = "air"
  f.t = 0
  f.boutFlap = true
  f.bout = 9
  h.speed = f.spec.cruise
  h.y = surfaceAt(h.x, h.z) + alt
  f.alt = alt
  f.intent.thrust = 0
  f.intent.turn = 0
  f.intent.climb = 0
  return h
}

/** Advance the flight at 60 Hz until the trick ends (or `seconds` pass), checking the body stays sound. */
const runTrick = (h: HorseState, seconds = 6): { t: number; lowest: number; highest: number } => {
  const f = h.flight!
  let lowest = Infinity
  let highest = -Infinity
  let t = 0
  for (; t < seconds && f.trick.kind !== null; t += 1 / 60) {
    stepFlight(h, 1 / 60, () => 0.5)
    expect(Number.isFinite(h.x) && Number.isFinite(h.y) && Number.isFinite(h.z) && Number.isFinite(h.heading)).toBe(true)
    expect(Number.isFinite(f.pitch) && Number.isFinite(f.roll) && Number.isFinite(f.vy)).toBe(true)
    expect(Number.isFinite(h.speed) && h.speed > 0).toBe(true)
    lowest = Math.min(lowest, f.alt)
    highest = Math.max(highest, f.alt)
  }
  return { t, lowest, highest }
}

/** The smallest difference between two headings (rad). */
const turned = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))

describe("Pegasus aerobatics", () => {
  it("a loop goes up and over and comes back level on the same heading", () => {
    const h = pegasus("ivory", 60)
    const y0 = h.y
    const hd0 = h.heading
    expect(tryTrick(h, "loop", 1)).toBe("ok")
    const { lowest, highest } = runTrick(h)
    const f = h.flight!
    expect(f.trick.kind).toBeNull()
    expect(f.pitch).toBe(0)
    expect(f.roll).toBe(0)
    expect(turned(h.heading, hd0)).toBeLessThan(0.05)
    expect(Math.abs(h.y - y0)).toBeLessThan(4) // back at the height it began
    expect(highest).toBeGreaterThan(5) // it went up over the top
    expect(lowest).toBeGreaterThan(3) // and never near the meadow
  })

  it("a dive flip (split-S) ends level, heading reversed and lower", () => {
    const h = pegasus("onyx", 60)
    const y0 = h.y
    const hd0 = h.heading
    expect(tryTrick(h, "split", 1)).toBe("ok")
    runTrick(h)
    const f = h.flight!
    expect(f.trick.kind).toBeNull()
    expect(f.pitch).toBe(0)
    expect(f.roll).toBe(0)
    expect(turned(h.heading, hd0 + Math.PI)).toBeLessThan(0.1)
    expect(y0 - h.y).toBeGreaterThan(4) // lower by about two radii
    expect(f.alt).toBeGreaterThan(3)
  })

  it("a corkscrew climbs through one full banked turn and ends level", () => {
    const h = pegasus("ivory", 40)
    const y0 = h.y
    const hd0 = h.heading
    expect(tryTrick(h, "corkscrew", 1)).toBe("ok")
    runTrick(h)
    expect(h.flight!.pitch).toBe(0)
    expect(h.flight!.roll).toBe(0)
    expect(turned(h.heading, hd0 + 2 * Math.PI)).toBeLessThan(0.15)
    expect(h.y - y0).toBeGreaterThan(2)
  })

  it("a pirouette turns a full circle on the spot and ends level", () => {
    const h = pegasus("ivory", 30)
    const hd0 = h.heading
    const x0 = h.x
    const z0 = h.z
    expect(tryTrick(h, "pirouette", 1)).toBe("ok")
    runTrick(h)
    expect(turned(h.heading, hd0)).toBeLessThan(0.1)
    expect(h.flight!.roll).toBe(0)
    expect(Math.hypot(h.x - x0, h.z - z0)).toBeLessThan(40)
  })

  it("a star-born's pirouette turns twice and lets starlight fall", () => {
    const h = pegasus("starborn", 60)
    const hd0 = h.heading
    expect(tryTrick(h, "pirouette", 1)).toBe("ok")
    expect(aeroRT.star).toBe(1)
    runTrick(h)
    expect(turned(h.heading, hd0)).toBeLessThan(0.1)
    tickAero(1)
    expect(aeroRT.star).toBeLessThan(1)
  })

  it("a barrel roll turns the body a whole turn about its nose and ends clean", () => {
    const h = pegasus("ivory", 60)
    const hd0 = h.heading
    expect(tryTrick(h, "roll", 1)).toBe("ok")
    let peak = 0
    const f = h.flight!
    for (let n = 0; n < 600 && f.trick.kind !== null; n++) {
      stepFlight(h, 1 / 60, () => 0.5)
      peak = Math.max(peak, Math.abs(f.spin))
    }
    expect(peak).toBeGreaterThan(Math.PI * 1.9)
    expect(f.spin).toBe(0)
    expect(turned(h.heading, hd0)).toBeLessThan(0.1)
  })

  it("is refused when too low, and never starts from the ground or in a trick", () => {
    const h = pegasus("ivory", 6)
    expect(tryTrick(h, "loop", 1)).toBe("low")
    expect(tryTrick(pegasus("ivory", 9), "split", 1)).toBe("low")
    expect(h.flight!.trick.kind).toBeNull()
    const g = pegasus("ivory", 60)
    g.flight!.mode = "ground"
    expect(tryTrick(g, "loop", 1)).toBe("ground")
    const busy = pegasus("ivory", 60)
    tryTrick(busy, "split", 1)
    expect(tryTrick(busy, "loop", 1)).toBe("busy")
  })

  it("every trick clears the ground from a safe height, with the body never stuck", () => {
    const kinds: TrickKind[] = ["loop", "split", "corkscrew", "pirouette", "roll"]
    for (const breed of ["ivory", "onyx", "starborn"] as const) {
      for (const kind of kinds) {
        const h = pegasus(breed, 45)
        expect(tryTrick(h, kind, -1), `${breed} ${kind}`).toBe("ok")
        const { lowest } = runTrick(h)
        expect(lowest, `${breed} ${kind}`).toBeGreaterThan(0)
        if (kind !== "roll") {
          expect(h.flight!.pitch).toBe(0)
          expect(h.flight!.roll).toBe(0)
        }
      }
    }
  })

  it("a dash makes the loop bigger and it still flies", () => {
    const plain = pegasus("ivory", 80)
    tryTrick(plain, "loop", 1)
    const a = runTrick(plain).highest
    const dash = pegasus("ivory", 80)
    dash.flight!.boostT = 2
    dash.speed = dash.flight!.spec.boost
    expect(tryTrick(dash, "loop", 1)).toBe("ok")
    const b = runTrick(dash).highest
    expect(b).toBeGreaterThan(a)
  })

  it("an opposite input hurries the rest of the trick, still ending level", () => {
    const h = pegasus("ivory", 60)
    tryTrick(h, "loop", 1)
    const ref = pegasus("ivory", 60) // a reference, unhurried
    tryTrick(ref, "loop", 1)
    const full = runTrick(ref)
    const f = h.flight!
    const start = f.trick.T
    let t = 0
    for (; f.trick.kind !== null && t < 6; t += 1 / 60) {
      f.intent.climb = t > 0.5 ? -1 : 0
      stepFlight(h, 1 / 60, () => 0.5)
    }
    expect(t).toBeLessThan(start * 0.8)
    expect(full.t).toBeGreaterThan(t)
    expect(f.pitch).toBe(0)
  })

  it("the rider's grip rises in a loop, eases after, and combines with an outside grip by the larger value", () => {
    const h = pegasus("ivory", 60)
    tryTrick(h, "loop", 1)
    for (let n = 0; n < 40; n++) {
      stepFlight(h, 1 / 60, () => 0.5)
      tickAero(1 / 60, h)
    }
    expect(aeroRT.grip).toBeGreaterThan(0.3)
    expect(aeroRT.g).toBeGreaterThan(1.5)
    expect(riderGrip(0.95)).toBeGreaterThanOrEqual(0.95)
    expect(riderGrip(0)).toBeCloseTo(aeroRT.grip, 6)
    runTrick(h)
    for (let n = 0; n < 300; n++) tickAero(1 / 60)
    expect(aeroRT.grip).toBeLessThan(0.05)
  })

  it("double taps make the tricks from the keys", () => {
    const st = makeTrickTaps()
    const none = { x: 0, y: 0 }
    const s = { x: 0, y: 1 }
    const press = (m: { x: number; y: number }, dt: number) => keyTrick(st, m, false, false, false, 0, dt)
    expect(press(s, 0.016)).toBeNull()
    expect(press(none, 0.05)).toBeNull()
    expect(press(s, 0.1)?.kind).toBe("loop")
    // two presses too far apart are two single taps
    const slow = makeTrickTaps()
    keyTrick(slow, s, false, false, false, 0, 0.016)
    keyTrick(slow, none, false, false, false, 0, 0.5)
    expect(keyTrick(slow, s, false, false, false, 0, 0.016)).toBeNull()
    // Shift with C is the stoop, not a flip
    const dive = makeTrickTaps()
    const c = (boost: boolean, dt: number) => keyTrick(dive, none, false, true, boost, 0, dt)
    c(false, 0.016)
    c(false, 0.05)
    expect(c(true, 0.05)).toBeNull()
    // Shift changes the dive's style, not the physical C key's edge.
    const heldDive = makeTrickTaps()
    keyTrick(heldDive, none, false, true, false, 0, 0.01)
    keyTrick(heldDive, none, false, true, true, 0, 0.05)
    expect(keyTrick(heldDive, none, false, true, false, 0, 0.05)).toBeNull()
    expect(keyTrick(makeTrickTaps(), none, true, false, false, 0, 0.016)).toBeNull()
    expect(tapTwice(makeTap(), false, 0.016)).toBe(false)
  })

  it("samples simultaneous taps without leaving another key stale", () => {
    const st = makeTrickTaps()
    keyTrick(st, { x: 0, y: 1 }, true, false, false, 0, 0.01)
    keyTrick(st, { x: 0, y: 0 }, false, false, false, 0, 0.05)
    expect(keyTrick(st, { x: 0, y: 1 }, true, false, false, 0, 0.05)?.kind).toBe("loop")
    expect(st.space.down).toBe(true)
    expect(st.space.since).toBe(9)
  })

  it("herd simulation cannot consume the active rider's reaction or starburst", () => {
    const h = pegasus("starborn", 60)
    tryTrick(h, "pirouette", 1)
    const herd = pegasus("ivory", 10)
    herd.flight!.mode = "ground"
    for (let n = 0; n < 20; n++) stepFlight(herd, 0.1)
    expect(aeroRT.star).toBe(1)
    stepFlight(h, 0.1)
    tickAero(0.1, h)
    expect(aeroRT.active).toBe(true)
    expect(aeroRT.kind).toBe("pirouette")
    expect(aeroRT.star).toBeCloseTo(1 - 0.1 / 1.8)
    const grip = aeroRT.grip
    for (let n = 0; n < 20; n++) stepFlight(herd, 0.1)
    expect(aeroRT.grip).toBe(grip)
    tickAero(0.1, null)
    expect(aeroRT.active).toBe(false)
  })


  it("stepTrick is inert without a trick", () => {
    const h = pegasus("ivory", 60)
    expect(stepTrick(h, h.flight!, 1 / 60)).toBe(false)
  })
})
