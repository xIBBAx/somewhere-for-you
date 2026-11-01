import { expect, it } from "vitest"
import * as THREE from "three"
import type { HumanPoseInput } from "../src/game/characters/human/HumanAnimator"
import { makeIdentity } from "../src/game/horses/breeds"
import { makeHorseState } from "../src/game/horses/horseState"
import { applyRiderPose, makeRiderPoseCache } from "../src/game/horses/riderPose"
import { resetRider, restoreRiderSeat } from "../src/game/horses/riding"
import { flightOf } from "../src/game/pegasus/flight"
import { tryTrick } from "../src/game/pegasus/aerobatics"

const pose = (): HumanPoseInput => ({
  dt: 1 / 60, time: 0, speed: 0, turnRate: 0, forwardAccel: 0, groundLeft: 0, groundRight: 0, slope: 0, airborne: false,
  jumpPhase: "grounded", jumpTime: 0, idleTime: 0, petting: 0, petSide: 1, celebrate: 0, training: { stance: 0, jab: 0, cross: 0 },
  fear: 0, greeting: 0, lookYaw: 0, lookPitch: 0, wind: 0, sit: 0, paint: 0, wish: 0,
})

it("reacts to each rider's own mount while a tandem passenger shares the pull", () => {
  resetRider("explorer")
  resetRider("companion")
  const h = makeHorseState(makeIdentity(707, "starborn"), -36, -24, true)
  const other = makeHorseState(makeIdentity(708, "ivory"), -40, -24, true)
  const f = flightOf(h)!
  f.mode = "air"
  f.alt = 80
  h.y += 80
  h.speed = f.spec.cruise
  restoreRiderSeat("explorer", h, 0)
  restoreRiderSeat("companion", other, 0)
  expect(tryTrick(h, "loop", 1)).toBe("ok")
  const root = new THREE.Group()
  const m = pose(), i = pose()
  const mc = makeRiderPoseCache(), ic = makeRiderPoseCache()
  for (let n = 0; n < 60; n++) {
    applyRiderPose("explorer", root, m, mc, n / 60)
    applyRiderPose("companion", root, i, ic, n / 60)
  }
  expect(m.rideGrip).toBeGreaterThan(0.3)
  expect(i.rideGrip).toBe(0)
  expect(i.rideBrace).toBe(0)
  restoreRiderSeat("companion", h, 1)
  for (let n = 0; n < 60; n++) applyRiderPose("companion", root, i, ic, n / 60)
  expect(i.rideGrip).toBeCloseTo(m.rideGrip!, 5)
  resetRider("companion")
  resetRider("explorer")
  applyRiderPose("explorer", root, m, mc, 2)
  expect(m.rideGrip).toBe(0)
  expect(m.rideBrace).toBe(0)
})
