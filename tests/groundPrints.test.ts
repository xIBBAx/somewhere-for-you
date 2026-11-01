import { describe, expect, it } from "vitest"
import { hoovesOffGround } from "../src/game/environment/ground/GroundSystem"

const horse = (over: Partial<Parameters<typeof hoovesOffGround>[0]> = {}): Parameters<typeof hoovesOffGround>[0] => ({
  jumpY: 0, pose: { lie: 0 } as never, flight: null, x: 0, y: 0, z: 0, ...over,
})
const flat = (): number => 0

describe("hoofprints", () => {
  it("are left by a horse standing or walking on the ground", () => {
    expect(hoovesOffGround(horse(), flat)).toBe(false)
    expect(hoovesOffGround(horse({ flight: { mode: "ground" } as never }), flat)).toBe(false)
  })
  it("are never left under a Pegasus on the wing, at any height", () => {
    for (const mode of ["takeoff", "air", "landing", "sail"]) {
      expect(hoovesOffGround(horse({ flight: { mode } as never }), flat)).toBe(true)
    }
    // skimming the grass in the air still prints nothing
    expect(hoovesOffGround(horse({ flight: { mode: "air" } as never, y: 0.1 }), flat)).toBe(true)
  })
  it("are not left while jumping, lying down, or high over the ground", () => {
    expect(hoovesOffGround(horse({ jumpY: 0.3 }), flat)).toBe(true)
    expect(hoovesOffGround(horse({ pose: { lie: 1 } as never }), flat)).toBe(true)
    expect(hoovesOffGround(horse({ y: 3 }), flat)).toBe(true)
  })
})
