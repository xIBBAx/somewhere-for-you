import { beforeEach, describe, expect, it } from "vitest"
import { horseRT, type HorseState } from "../src/game/horses/horseState"
import { groundHeight } from "../src/game/world-layout"
import { isAirborne } from "../src/game/pegasus/flight"
import { pegasusRT, spawnPegasi } from "../src/game/pegasus/pegasi"
import { whistleForPegasus } from "../src/game/pegasus/whistle"
import { resetRider, riderRT, stepFreeFlight } from "../src/game/horses/riding"
import { stepHorseMotion } from "../src/game/horses/horseMotion"
import { cameraRT, characterRT, companionRT, playerRT } from "../src/game/runtime"

/** Y: The explorer whistles for Ivory, the companion for Onyx, from anywhere. */

const ivory = (): HorseState => horseRT.horses.get(pegasusRT.own.explorer)!
const onyx = (): HorseState => horseRT.horses.get(pegasusRT.own.companion)!
const hints: string[] = []
const hint = (t: string): void => { hints.push(t) }

const place = (who: typeof playerRT, x: number, z: number): void => {
  who.pos.set(x, groundHeight(x, z), z)
  who.gesture = "none"
  who.paused = false
}
const dist = (h: HorseState, who: typeof playerRT): number => Math.hypot(h.x - who.pos.x, h.z - who.pos.z)

beforeEach(() => {
  for (const id of ["pegasus:ivory", "pegasus:onyx", "pegasus:starborn"]) horseRT.horses.delete(id)
  spawnPegasi()
  resetRider("explorer")
  resetRider("companion")
  characterRT.active = "explorer"
  hints.length = 0
  cameraRT.viewYaw = Math.PI
})

describe("whistling for your own Pegasus", () => {
  it("each character's whistle calls their own Pegasus, and only theirs", () => {
    const s = ivory(), b = onyx()
    place(playerRT, s.x + 80, s.z)
    const before = { x: b.x, z: b.z, mode: b.mode }
    expect(whistleForPegasus("explorer", hint)).toBe(true)
    expect(s.reservedBy).toBe("explorer")
    expect(b.reservedBy).not.toBe("explorer")
    expect({ x: b.x, z: b.z, mode: b.mode }).toEqual(before)
    // and both characters visibly whistle
    expect(playerRT.gesture).toBe("whistle")
    characterRT.active = "companion"
    place(companionRT, b.x - 40, b.z + 10)
    expect(whistleForPegasus("companion", hint)).toBe(true)
    expect(b.reservedBy).toBe("companion")
    expect(companionRT.gesture).toBe("whistle")
    expect(s.reservedBy).toBe("explorer")
  })

  it("close by, it walks over; further off, it takes wing", () => {
    const s = ivory()
    place(playerRT, s.x + 12, s.z)
    whistleForPegasus("explorer", hint)
    expect(isAirborne(s)).toBe(false)
    expect(s.mode).toBe("come")
    place(playerRT, s.x + 120, s.z)
    whistleForPegasus("explorer", hint)
    expect(s.flight!.mode).toBe("takeoff")
  })

  for (const airborne of [false, true]) {
    it(`from far away${airborne ? ", even mid-flight elsewhere" : ""}, it arrives on the wing out of sight behind the view`, () => {
      const s = ivory()
      place(playerRT, s.x + 4000, s.z - 2500)
      if (airborne) {
        s.flight!.mode = "air"
        s.flight!.spread = 1
        s.y = groundHeight(s.x, s.z) + 60
      }
      cameraRT.viewYaw = 0.7
      whistleForPegasus("explorer", hint)
      expect(isAirborne(s)).toBe(true)
      const d = dist(s, playerRT)
      expect(d).toBeGreaterThan(120)
      expect(d).toBeLessThan(220)
      // the camera sits towards viewYaw from the player: that side is out of view
      const behind = ((s.x - playerRT.pos.x) * Math.sin(0.7) + (s.z - playerRT.pos.z) * Math.cos(0.7)) / d
      expect(behind).toBeGreaterThan(0.6)
      expect(s.y - groundHeight(s.x, s.z)).toBeGreaterThan(20)
    })
  }

  it("whistling again does not teleport it again or make a second one", () => {
    const s = ivory()
    place(playerRT, s.x + 3000, s.z)
    const count = horseRT.horses.size
    whistleForPegasus("explorer", hint)
    const at = { x: s.x, z: s.z }
    for (let i = 0; i < 5; i++) whistleForPegasus("explorer", hint)
    expect(horseRT.horses.size).toBe(count)
    expect({ x: s.x, z: s.z }).toEqual(at)
  })

  it("will not take a Pegasus someone is riding", () => {
    const s = ivory()
    s.rider = "companion"
    place(playerRT, s.x + 500, s.z)
    const at = { x: s.x, z: s.z }
    expect(whistleForPegasus("explorer", hint)).toBe(false)
    expect({ x: s.x, z: s.z }).toEqual(at)
    expect(hints.at(-1)).toMatch(/carrying Kabir/)
    s.rider = null
  })

  it("tells you to get down first when you are already riding", () => {
    riderRT.explorer.phase = "riding"
    riderRT.explorer.horse = onyx()
    expect(whistleForPegasus("explorer", hint)).toBe(false)
    expect(hints.at(-1)).toMatch(/Get down first/)
    resetRider("explorer")
  })

  it("flies in from far away and lands beside the caller within a minute", () => {
    const s = ivory()
    // open meadow away from home
    place(playerRT, -36 + 1500, -24)
    cameraRT.viewYaw = 2.2
    whistleForPegasus("explorer", hint)
    let t = 0
    const dt = 1 / 30
    for (; t < 60; t += dt) {
      if (isAirborne(s)) stepFreeFlight(s, dt)
      else {
        stepHorseMotion(s, dt, null)
        if (dist(s, playerRT) < 8) break
      }
    }
    expect(isAirborne(s)).toBe(false)
    expect(dist(s, playerRT)).toBeLessThan(30)
    expect(t).toBeLessThan(60)
  })
})
