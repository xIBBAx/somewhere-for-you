import { describe, expect, it } from "vitest"
import { airSound, dashTowards, effectScale, feedFor, sprayStrength, wakeRingStrength, washReach, wrapDomain } from "../src/game/pegasus/flightAir"
import { insideCloudDeck } from "../src/game/pegasus/CloudWakeFX"
import { cloudFieldRT } from "../src/game/environment/cloudField"
import { WAKE_SLOTS, emitWaterWake, updateWaterWake, waterWakeUniforms, clearWaterWake } from "../src/world/render/waterWake"
import { flightWaterSurfaceAt, waterSurfaceAt } from "../src/world/waterSurface"
import { POND, WATER_Y, riverCenterZ } from "../src/world/hubLayout"
import { originRT } from "../src/world/origin"


describe("authored water flight interaction", () => {
  it("extends surface disturbances to the home pond and creek without changing swimming", () => {
    expect(flightWaterSurfaceAt(POND.x, POND.z)).toBe(WATER_Y)
    expect(flightWaterSurfaceAt(0, riverCenterZ(0))).toBe(WATER_Y)
    expect(waterSurfaceAt(POND.x, POND.z)).toBeNull()
    expect(waterSurfaceAt(0, riverCenterZ(0))).toBeNull()
    expect(flightWaterSurfaceAt(POND.x + POND.r * 1.5, POND.z)).toBeNull()
  })
})

describe("Pegasus wake strength", () => {
  it("throws spray only low over water, harder in a dash, and nothing above ~25 m", () => {
    const low = sprayStrength(2, 16, 1, 1)
    expect(low).toBeGreaterThan(0.8)
    expect(sprayStrength(2, 16, 1, 1)).toBeGreaterThan(sprayStrength(2, 16, 0, 0.3))
    expect(sprayStrength(12, 16, 1, 1)).toBeLessThan(low)
    expect(sprayStrength(26, 30, 1, 1)).toBe(0)
  })

  it("only ruffles water on a slow glide", () => {
    expect(sprayStrength(3, 5, 0, 0.2)).toBeLessThan(0.05)
    expect(wakeRingStrength(5, 0, 0.2)).toBeLessThan(wakeRingStrength(16, 1, 1))
  })

  it("reaches the surface from about a wing-span up and not beyond ~3.4 spans", () => {
    expect(washReach(1, 3)).toBeGreaterThan(0.95)
    expect(washReach(12, 3)).toBe(0)
  })

  it("picks dust over dry ground, powder over snow, petals and leaves over meadow, nothing over water or mud", () => {
    expect(feedFor("sand", "meadow", false)).toBe("dust")
    expect(feedFor("soil", "forest", false)).toBe("dust")
    expect(feedFor("grass", "meadow", true)).toBe("powder")
    expect(feedFor("grass", "gulmohar", false)).toBe("petal")
    expect(feedFor("grass", "autumn", false)).toBe("leaf")
    expect(feedFor("grass", "pine", false)).toBe("none")
    expect(feedFor("water", "meadow", false)).toBe("none")
    expect(feedFor("mud", "meadow", false)).toBe("none")
  })
})

describe("air rush audio", () => {
  it("roars in dense low air and whispers in thin high air", () => {
    const low = airSound(5, 18, 0, 0, 0)
    const high = airSound(600, 18, 0, 0, 0)
    expect(low.roar).toBeGreaterThan(high.roar * 4)
    expect(high.tone).toBeGreaterThan(low.tone)
    expect(high.cutoff).toBeGreaterThan(low.cutoff)
  })

  it("grows with airspeed and dash, and clouds muffle it", () => {
    expect(airSound(20, 18, 1, 0, 0).rush).toBeGreaterThan(airSound(20, 18, 0, 0, 0).rush)
    expect(airSound(20, 2, 0, 0, 0).rush).toBeLessThan(airSound(20, 18, 0, 0, 0).rush)
    const open = airSound(20, 18, 1, 0, 0)
    const cloudy = airSound(20, 18, 1, 1, 0)
    expect(cloudy.cutoff).toBeLessThan(open.cutoff * 0.5)
    expect(cloudy.roar).toBeLessThan(open.roar)
  })

  it("hisses only with spray", () => {
    expect(airSound(3, 16, 1, 0, 0).hiss).toBe(0)
    expect(airSound(3, 16, 1, 0, 0.8).hiss).toBeGreaterThan(0)
  })

  it("scales the effects down for reduced motion", () => {
    expect(effectScale(1, true)).toBeLessThan(effectScale(1, false))
    expect(effectScale(0.55, false)).toBeCloseTo(0.55)
  })

  it("eases the dash in and out", () => {
    let d = 0
    for (let i = 0; i < 30; i++) d = dashTowards(d, true, 1 / 30)
    expect(d).toBeGreaterThan(0.7)
    for (let i = 0; i < 30; i++) d = dashTowards(d, false, 1 / 30)
    expect(d).toBeLessThan(0.3)
  })
})

describe("cloud placement", () => {
  it("wraps into the domain the way the shader's mod does", () => {
    const r = 270
    expect(wrapDomain(10, r)).toBeCloseTo(10)
    expect(wrapDomain(r + 5, r)).toBeCloseTo(-r + 5)
    expect(wrapDomain(-r - 5, r)).toBeCloseTo(r - 5)
  })

  it("finds a Pegasus inside a puff of the drawn deck and not in clear air", () => {
    cloudFieldRT.wind.set(0, 0)
    cloudFieldRT.domain.set(0, 0)
    cloudFieldRT.altitude = 0
    cloudFieldRT.formations = [{
      id: 1, archetype: "cumulus_puff", x: 0, y: 40, z: 0, scale: 2,
      puffs: [{ dx: 0, dy: 0, dz: 0, sx: 4, sy: 4, sz: 4, atlasIndex: 0, density: 1, heightRel: 0, rotation: 0 }],
    }]
    expect(insideCloudDeck(0, 40, 0)).toBe(true)
    expect(insideCloudDeck(0, 10, 0)).toBe(false)
    expect(insideCloudDeck(500, 40, 500)).toBe(false)
    cloudFieldRT.formations[0].puffs[0].sy = 0.5
    expect(insideCloudDeck(0, 40.2, 0)).toBe(true)
    expect(insideCloudDeck(0, 41, 0)).toBe(false)
    cloudFieldRT.formations = []
  })
})

describe("water wake ring buffer", () => {
  it("writes rings in render space and retires them once faded", () => {
    clearWaterWake()
    originRT.x = 1000
    originRT.z = -200
    emitWaterWake(1003, -190, 0.8, 5)
    updateWaterWake(5.5, null)
    const live = waterWakeUniforms.uWake.value.find((v) => v.w > 0)!
    expect(live.x).toBeCloseTo(3)
    expect(live.y).toBeCloseTo(10)
    expect(live.z).toBeCloseTo(0.5)
    expect(waterWakeUniforms.uWakeCount.value).toBe(1)
    const bounds = waterWakeUniforms.uWakeBounds.value
    expect(bounds.x).toBeLessThan(live.x)
    expect(bounds.z).toBeGreaterThan(live.x)
    updateWaterWake(5 + 10, null)
    expect(waterWakeUniforms.uWake.value.every((v) => v.w === 0)).toBe(true)
    expect(waterWakeUniforms.uWakeCount.value).toBe(0)
    expect(waterWakeUniforms.uWake.value.length).toBe(WAKE_SLOTS)
    originRT.x = 0
    originRT.z = 0
  })
})

describe("bounded water wake uploads", () => {
  it("packs mixed-age rings and rotor bounds through an origin rebase", () => {
    clearWaterWake()
    emitWaterWake(10, 20, 1, 0)
    emitWaterWake(30, 40, 0.7, 4)
    originRT.x = 20; originRT.z = 30
    updateWaterWake(4.5, { x: 60, z: 70, radius: 6, strength: 1 })
    expect(waterWakeUniforms.uWakeCount.value).toBe(1)
    expect(waterWakeUniforms.uWake.value[0].toArray()).toEqual([10, 10, 0.5, expect.closeTo(0.7)])
    expect(waterWakeUniforms.uWakeBounds.value.z).toBe(46)
    expect(waterWakeUniforms.uWakeBounds.value.w).toBe(46)
    clearWaterWake()
    expect(waterWakeUniforms.uWakeCount.value).toBe(0)
    expect(waterWakeUniforms.uRotor.value.w).toBe(0)
    originRT.x = 0; originRT.z = 0
  })
})
