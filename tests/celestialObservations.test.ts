import * as THREE from "three"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OBSERVATION_JOURNEYS, observationJourney, observationPoint, observationReading, observationSpeedLimit } from "../src/game/celestial/observations"
import { KM } from "../src/game/celestial/scale"
import { bodyById, universe, updateUniverse } from "../src/game/celestial/universe"
import { emptyVoyage, readVoyage, resetVoyage, voyage } from "../src/game/celestial/voyageMemory"
import { nextObservationStop, rememberObservation, useObservation } from "../src/state/observationStore"

const EPOCHS: Array<[string, number]> = [
  ["2026-10-19T12:00:00Z", 0.08],
  ["2027-03-20T12:00:00Z", 0.42],
  ["2030-06-21T12:00:00Z", 0.9],
]
const KEY = "gift-world/voyage"

describe("celestial observation geometry", () => {
  it.each(EPOCHS)("places the Moon's three views at their physical phase angles on %s", (date, time) => {
    updateUniverse(time, new Date(date))
    const journey = observationJourney("moonlight")!, moon = bodyById("moon")!, sun = bodyById("sun")!
    const moonBefore = moon.pos.clone(), sunBefore = sun.pos.clone(), poleBefore = moon.pole.clone()
    const light = sun.pos.clone().sub(moon.pos).normalize()
    const expectedAngles = [20, 90, 150], expectedIllumination = [96.984631, 50, 6.698730]
    for (let i = 0; i < expectedAngles.length; i++) {
      const out = new THREE.Vector3()
      expect(observationPoint(journey, i, moon, sun, out)).toBe(out)
      const observer = out.clone().sub(moon.pos)
      expect(observer.length() / moon.radius).toBeCloseTo(3, 8)
      expect(THREE.MathUtils.radToDeg(observer.angleTo(light))).toBeCloseTo(expectedAngles[i], 6)
      expect(observationReading(journey, moon, sun, out).value).toBeCloseTo(expectedIllumination[i], 5)
    }
    expect(moon.pos.equals(moonBefore)).toBe(true)
    expect(sun.pos.equals(sunBefore)).toBe(true)
    expect(moon.pole.equals(poleBefore)).toBe(true)
  })

  it.each(EPOCHS)("places Saturn's views above, beside and below its actual ring plane on %s", (date, time) => {
    updateUniverse(time, new Date(date))
    const journey = observationJourney("ring-song")!, saturn = bodyById("saturn")!, sun = bodyById("sun")!
    const outerRing = saturn.def.rings!.outer * KM
    for (const [i, expectedAngle] of [25, 2, -25].entries()) {
      const position = observationPoint(journey, i, saturn, sun, new THREE.Vector3())
      const relative = position.clone().sub(saturn.pos)
      const height = relative.dot(saturn.pole)
      const planeRadius = relative.clone().addScaledVector(saturn.pole, -height).length()
      expect(relative.length() / saturn.radius).toBeCloseTo(4.5, 7)
      expect(THREE.MathUtils.radToDeg(Math.atan2(height, planeRadius))).toBeCloseTo(expectedAngle, 6)
      expect(observationReading(journey, saturn, sun, position).value).toBeCloseTo(expectedAngle, 6)
      // Even the below-plane viewpoint stays outside the visible ring disc.
      expect(planeRadius).toBeGreaterThan(outerRing)
    }
  })

  it.each(EPOCHS)("keeps straight legs between every pair of viewpoints clear of represented surfaces and rings on %s", (date, time) => {
    updateUniverse(time, new Date(date))
    const sun = bodyById("sun")!, closest = new THREE.Vector3()
    for (const journey of OBSERVATION_JOURNEYS) {
      const body = bodyById(journey.body)!
      const stops = journey.stops.map((_, i) => observationPoint(journey, i, body, sun, new THREE.Vector3()))
      for (let a = 0; a < stops.length; a++) for (let b = a + 1; b < stops.length; b++) {
        const leg = new THREE.Line3(stops[a], stops[b])
        for (const obstacle of universe.bodies) {
          leg.closestPointToPoint(obstacle.pos, true, closest)
          expect(closest.distanceTo(obstacle.pos), `${journey.id} ${a}→${b}, ${obstacle.def.id}`).toBeGreaterThan(obstacle.radius)
        }
        if (body.def.rings) {
          // Remaining outside the entire bounding sphere also guarantees
          // clearance where the leg crosses Saturn's thin ring plane.
          leg.closestPointToPoint(body.pos, true, closest)
          expect(closest.distanceTo(body.pos)).toBeGreaterThan(body.def.rings.outer * KM)
        }
      }
    }
  })

  it("keeps valid viewpoints when the illumination direction aligns with a body's pole", () => {
    updateUniverse(0.3, new Date(EPOCHS[0][0]))
    const sun = bodyById("sun")!
    for (const journey of OBSERVATION_JOURNEYS) {
      const original = bodyById(journey.body)!
      const aligned = { ...original, pole: sun.pos.clone().sub(original.pos).normalize() }
      for (let i = 0; i < journey.stops.length; i++) {
        const point = observationPoint(journey, i, aligned, sun, new THREE.Vector3())
        expect(point.toArray().every(Number.isFinite)).toBe(true)
        const reading = observationReading(journey, aligned, sun, point).value
        expect(Number.isFinite(reading)).toBe(true)
        if (journey.kind === "rings") expect(reading).toBeCloseTo(journey.stops[i].angle, 6)
        else expect(THREE.MathUtils.radToDeg(point.sub(aligned.pos).angleTo(aligned.pole))).toBeCloseTo(journey.stops[i].angle, 6)
      }
    }
  })

  it("allows a complete stop at arrival and approaches without a forced minimum speed", () => {
    const arrive = 30
    for (const distance of [0, arrive / 2, arrive]) expect(observationSpeedLimit(distance, arrive)).toBe(0)
    expect(observationSpeedLimit(arrive + 0.001, arrive)).toBeLessThan(0.001)
    let previous = 0
    for (const remaining of [0.01, 1, 20, 1000, 1_000_000]) {
      const speed = observationSpeedLimit(arrive + remaining, arrive)
      expect(Number.isFinite(speed)).toBe(true)
      expect(speed).toBeGreaterThan(previous)
      // At the game's capped 0.1 s step, the requested motion cannot pass
      // through the stopping boundary even before braking reduces speed.
      expect(speed * 0.1).toBeLessThan(remaining)
      previous = speed
    }
  })
})

describe("observation memories and journey progression", () => {
  let saved: Map<string, string>
  beforeEach(() => {
    delete voyage.observations
    Object.assign(voyage, emptyVoyage())
    useObservation.setState({ journey: null, stop: 0, ready: false, holding: false, progress: 0, completed: false, reading: "" })
    saved = new Map()
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => { saved.set(key, value) },
      removeItem: (key: string) => { saved.delete(key) },
    })
  })
  afterEach(() => {
    delete voyage.observations
    Object.assign(voyage, emptyVoyage())
    useObservation.getState().close()
    vi.unstubAllGlobals()
  })

  it("saves each valid viewpoint once and ignores unknown journeys or invalid stops", () => {
    expect(nextObservationStop("moonlight")).toBe(0)
    for (const stop of [-1, 3, 0.5, NaN]) expect(rememberObservation("moonlight", stop)).toBe(false)
    expect(rememberObservation("unknown", 0)).toBe(false)
    expect(saved.has(KEY)).toBe(false)
    expect(rememberObservation("moonlight", 0)).toBe(true)
    const firstSave = saved.get(KEY)
    expect(rememberObservation("moonlight", 0)).toBe(false)
    expect(saved.get(KEY)).toBe(firstSave)
    expect(rememberObservation("ring-song", 0)).toBe(true)
    expect(voyage.observations).toEqual(["moonlight:0", "ring-song:0"])
    expect(readVoyage(saved.get(KEY)!).observations).toEqual(voyage.observations)
    expect(nextObservationStop("moonlight")).toBe(1)
    expect(nextObservationStop("ring-song")).toBe(1)
  })

  it("gates advancement on completion, resumes the first unfinished view, and permits a completed journey to be revisited", () => {
    useObservation.getState().start("moonlight")
    useObservation.getState().next()
    expect(useObservation.getState().stop).toBe(0)
    rememberObservation("moonlight", 0)
    useObservation.getState().hold(true)
    useObservation.setState({ ready: true, progress: 1, completed: true, reading: "97% illuminated" })
    useObservation.getState().next()
    expect(useObservation.getState()).toMatchObject({ stop: 1, ready: false, holding: false, progress: 0, completed: false, reading: "" })
    useObservation.getState().close()
    useObservation.getState().start("moonlight")
    expect(useObservation.getState().stop).toBe(1)
    rememberObservation("moonlight", 1)
    rememberObservation("moonlight", 2)
    expect(nextObservationStop("moonlight")).toBe(-1)
    useObservation.getState().start("moonlight")
    expect(useObservation.getState()).toMatchObject({ journey: "moonlight", stop: 0, completed: false, progress: 0 })
    useObservation.getState().start("not-a-journey")
    expect(useObservation.getState().journey).toBe("moonlight")
    expect(voyage.observations).toHaveLength(3)
  })

  it("reads older voyages without observation data and deduplicates new saved memories", () => {
    const older = { sites: ["apollo-11"], moonLandings: 2, cats: "settled", studied: ["saturn"] }
    const restored = readVoyage(JSON.stringify(older))
    expect(restored).toMatchObject(older)
    expect(restored.observations ?? []).toEqual([])
    Object.assign(voyage, restored)
    expect(nextObservationStop("ring-song")).toBe(0)
    expect(rememberObservation("ring-song", 0)).toBe(true)
    expect(readVoyage(saved.get(KEY)!)).toMatchObject({ ...older, observations: ["ring-song:0"] })
    expect(readVoyage(JSON.stringify({ ...older, observations: ["moonlight:0", "moonlight:0", null, 7, "ring-song:2"] })).observations)
      .toEqual(["moonlight:0", "ring-song:2"])
  })

  it("clears observation memories and persisted progress when the voyage is reset", () => {
    rememberObservation("moonlight", 0)
    rememberObservation("ring-song", 0)
    expect(saved.has(KEY)).toBe(true)
    resetVoyage()
    expect(saved.has(KEY)).toBe(false)
    expect(voyage.observations ?? []).toEqual([])
    expect(nextObservationStop("moonlight")).toBe(0)
    expect(nextObservationStop("ring-song")).toBe(0)
    useObservation.getState().start("moonlight")
    expect(useObservation.getState().stop).toBe(0)
    expect(rememberObservation("moonlight", 0)).toBe(true)
  })
})
