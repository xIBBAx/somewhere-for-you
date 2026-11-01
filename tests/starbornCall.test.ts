import { beforeEach, describe, expect, it } from "vitest"
import { horseRT, type HorseState } from "../src/game/horses/horseState"
import { resetRider, riderRT } from "../src/game/horses/riding"
import { groundHeight } from "../src/game/world-layout"
import { pegasusRT, spawnPegasi } from "../src/game/pegasus/pegasi"
import { callStarborn, planStarbornCall, STARBORN_ID, type StarbornSituation } from "../src/game/pegasus/starbornCall"
import { characterRT, companionRT, playerRT } from "../src/game/runtime"

/** I: Starborn comes to whoever calls, and every situation gets a kind hint. */

const base: StarbornSituation = {
  caller: "explorer", otherName: "Kabir", mount: "none", starbornFront: null, starbornBehind: false, journey: false, swimming: false, blocked: false,
}
const plan = (over: Partial<StarbornSituation>) => planStarbornCall({ ...base, ...over })

describe("planStarbornCall", () => {
  it("comes when nothing stands in the way", () => {
    expect(plan({})).toEqual({ kind: "call" })
  })

  it("says so when the caller is already riding her", () => {
    expect(plan({ mount: "starborn" })).toEqual({ kind: "hint", text: "You're already riding Ashwini." })
  })

  it("asks the caller to get down first from another mount", () => {
    expect(plan({ mount: "other" })).toEqual({ kind: "dismount" })
  })

  it("ignores a call during a journey beyond the sky", () => {
    expect(plan({ journey: true }).kind).toBe("hint")
  })

  it("ignores a call during the opening or the finale", () => {
    expect(plan({ blocked: true }).kind).toBe("hint")
  })

  it("rescues a swimmer instead of requiring a walk back to shore", () => {
    expect(plan({ swimming: true })).toEqual({ kind: "rescue" })
    expect(plan({ adrift: true })).toEqual({ kind: "rescue" })
  })

  it("offers the tandem seat when the other character is riding her", () => {
    const p = plan({ starbornFront: "companion" })
    expect(p.kind).toBe("hint")
    if (p.kind === "hint") expect(p.text).toContain("press E to climb on behind")
  })

  it("explains when she is already carrying two", () => {
    const p = plan({ starbornFront: "companion", starbornBehind: true })
    expect(p.kind).toBe("hint")
  })
})

describe("callStarborn in the world", () => {
  beforeEach(() => {
    for (const id of ["pegasus:ivory", "pegasus:onyx", "pegasus:starborn"]) horseRT.horses.delete(id)
    spawnPegasi()
    resetRider("explorer")
    resetRider("companion")
    characterRT.active = "explorer"
    playerRT.pos.set(0, groundHeight(0, 22.5), 22.5)
    companionRT.pos.set(1.6, groundHeight(1.6, 24.2), 24.2)
  })

  it("keeps exactly one Starborn, and she is met from the start", () => {
    const all = [...horseRT.horses.values()].filter((h) => h.ident.breed === "starborn")
    expect(all).toHaveLength(1)
    expect(all[0].ident.id).toBe(STARBORN_ID)
    expect(pegasusRT.starbornMet).toBe(true)
  })

  it("sends her to the caller from the Star Hill", () => {
    const hints: string[] = []
    const h = horseRT.horses.get(STARBORN_ID) as HorseState
    expect(callStarborn("explorer", (t) => hints.push(t))).toBe(true)
    expect(h.reservedBy).toBe("explorer")
    expect(hints.length).toBe(1)
    expect(horseRT.horses.get(STARBORN_ID)).toBe(h)
  })

  it("refuses to hand her to someone already riding her", () => {
    const h = horseRT.horses.get(STARBORN_ID) as HorseState
    h.rider = "explorer"
    riderRT.explorer.phase = "riding"
    riderRT.explorer.horse = h
    const hints: string[] = []
    expect(callStarborn("explorer", (t) => hints.push(t))).toBe(false)
    expect(hints[0]).toBe("You're already riding Ashwini.")
    riderRT.explorer.phase = "none"
    riderRT.explorer.horse = null
    h.rider = null
  })
})
