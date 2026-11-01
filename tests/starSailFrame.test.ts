import { beforeEach, describe, expect, it } from "vitest"
import * as THREE from "three"
import { makeIdentity } from "../src/game/horses/breeds"
import { makeHorseState, type HorseState } from "../src/game/horses/horseState"
import { flightOf } from "../src/game/pegasus/flight"
import { resetTravelState, skipJourney, startJourney, stepTravel, travelRT } from "../src/game/celestial/cosmicTravel"
import { spaceRT } from "../src/game/celestial/spaceState"
import { bodyById, nearestBody, updateUniverse } from "../src/game/celestial/universe"
import { earthFrame } from "../src/game/celestial/frames"
import { DATUM_Y } from "../src/game/celestial/scale"
import { mountUniverse, parkInDeep, sailRT, stepSail } from "../src/game/celestial/starSail"

let horse: HorseState
beforeEach(() => {
  updateUniverse(0.2, new Date("2026-10-20T12:00:00Z"))
  resetTravelState()
  horse = makeHorseState(makeIdentity(70304, "starborn", { saddled: true }), 0, 0, true)
  flightOf(horse)
  horse.y = DATUM_Y + 600
  horse.flight!.mode = "air"
  spaceRT.mode = "local"
  spaceRT.realm = "earth"
  spaceRT.frame = earthFrame()
  spaceRT.frozenTime = null
  sailRT.autopilot = null
  sailRT.pilot = horse
})

describe("the star-sail's arrival frame", () => {
  it("keeps the real Sun arrival facing the Sun during released, controllable flight", () => {
    expect(startJourney(horse, { kind: "body", id: "sun" }, "quick")).toBeNull()
    skipJourney()
    stepTravel(horse, 1 / 60)
    expect(travelRT.phase).toBe("idle")
    const sun = bodyById("sun")!
    expect(nearestBody(spaceRT.pos).body.def.id).toBe("sun")
    const arrivalFrame = spaceRT.park.clone()
    const arrivalPosition = spaceRT.pos.clone()
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(arrivalFrame)
    const toSun = sun.pos.clone().sub(spaceRT.pos).normalize()
    expect(forward.dot(toSun)).toBeGreaterThan(0.999999)
    for (let n = 0; n < 600; n++) stepSail(horse, 1 / 60)
    expect(spaceRT.mode).toBe("deep")
    expect(spaceRT.park.angleTo(arrivalFrame)).toBeLessThan(1e-7)
    expect(horse.heading).toBe(0)
    expect(horse.flight!.pitch).toBe(0)
    expect(new THREE.Vector3(0, 0, 1).applyQuaternion(spaceRT.park).dot(sun.pos.clone().sub(spaceRT.pos).normalize())).toBeGreaterThan(0.999999)
    // The rider still moves naturally; keeping the frame is not a freeze,
    // teleport, or a substituted velocity. Each step retains forward momentum.
    expect(spaceRT.pos.distanceTo(arrivalPosition)).toBeGreaterThan(1)
    expect(spaceRT.vel.clone().normalize().dot(forward)).toBeGreaterThan(0.999999)
    expect(spaceRT.vel.length()).toBeCloseTo(horse.speed, 8)
    horse.flight!.intent.turn = 0.6
    for (let n = 0; n < 60; n++) stepSail(horse, 1 / 60)
    expect(Math.abs(horse.heading)).toBeGreaterThan(0.1)
    expect(spaceRT.park.angleTo(arrivalFrame)).toBeLessThan(1e-7)
  })

  it.each(["earth", "sun", "venus"])("faces the Sun on arrival from %s, including a repeat visit", origin => {
    const arrive = (id: string): void => {
      expect(startJourney(horse, { kind: "body", id }, "quick")).toBeNull()
      skipJourney(); stepTravel(horse, 1 / 60)
      expect(travelRT.phase).toBe("idle")
    }
    if (origin !== "earth") {
      arrive(origin)
      // Move a little on the first visit, as real post-arrival play does.
      for (let n = 0; n < 180; n++) stepSail(horse, 1 / 60)
    }
    const sun = bodyById("sun")!
    const expectedPosition = mountUniverse(horse, new THREE.Vector3()).sub(sun.pos).normalize().multiplyScalar(sun.radius * 3.5).add(sun.pos)
    arrive("sun")
    expect(spaceRT.pos.distanceTo(expectedPosition)).toBeLessThan(1e-5)
    expect(spaceRT.pos.distanceTo(sun.pos)).toBeCloseTo(sun.radius * 3.5, 5)
    const frame = spaceRT.park.clone()
    const facing = () => new THREE.Vector3(0, 0, 1).applyQuaternion(spaceRT.park)
    const towards = () => sun.pos.clone().sub(spaceRT.pos).normalize()
    expect(facing().dot(towards())).toBeGreaterThan(0.999999)
    expect(horse.heading).toBe(0)
    for (let n = 0; n < 600; n++) stepSail(horse, 1 / 60)
    expect(facing().dot(towards())).toBeGreaterThan(0.999999)
    expect(spaceRT.park.angleTo(frame)).toBeLessThan(1e-7)
    horse.flight!.intent.turn = 0.5
    for (let n = 0; n < 60; n++) stepSail(horse, 1 / 60)
    expect(Math.abs(horse.heading)).toBeGreaterThan(0.1)
  })

  it.each(["jupiter", "moon"])("still levels the horizon near %s", id => {
    const body = bodyById(id)!
    const position = body.pos.clone().addScaledVector(body.pole, body.radius * 3.5)
    parkInDeep(horse, position, body.pole.clone().negate(), new THREE.Vector3(1, 0, 0))
    horse.speed = 6
    horse.flight!.throttle = 0.04
    expect(nearestBody(spaceRT.pos).body.def.id).toBe(id)
    const before = spaceRT.park.clone()
    const alignmentBefore = new THREE.Vector3(0, 1, 0).applyQuaternion(before).dot(body.pole)
    for (let n = 0; n < 60; n++) stepSail(horse, 1 / 60)
    const radial = spaceRT.pos.clone().sub(body.pos).normalize()
    const alignmentAfter = new THREE.Vector3(0, 1, 0).applyQuaternion(spaceRT.park).dot(radial)
    expect(spaceRT.park.angleTo(before)).toBeGreaterThan(0.05)
    expect(alignmentAfter).toBeGreaterThan(alignmentBefore + 0.05)
    expect(horse.heading).toBe(0)
  })
})
