import { beforeAll, describe, expect, it } from "vitest"
import * as THREE from "three"
import { bodyById, updateUniverse } from "../src/game/celestial/universe"
import { BODIES, LANDABLE_IDS } from "../src/game/celestial/bodies"
import { canLand, enterRealm, leaveRealm, realmDirection, realmHeight, realmLocalOf, realmRT } from "../src/game/celestial/realm/realmState"
import { ALL_SITES, LUNAR_SITES, siteDirection, siteUniverse } from "../src/game/celestial/realm/lunarSites"
import { LAYOUTS, siteReach } from "../src/game/celestial/realm/lunarLayout"
import { REALM_LOOKS, calmFactor, surfaceHeight } from "../src/game/celestial/realm/realmTerrain"
import { gravityAt, inRealm, realmGround, realmHeightAt, sameWorld } from "../src/world/realmHook"
import { spaceRT } from "../src/game/celestial/spaceState"
import { worldHeight } from "../src/world/terrain"
import { waterSurfaceAt } from "../src/world/waterSurface"

beforeAll(() => {
  updateUniverse(0.3, new Date("2026-10-18T12:00:00Z"))
})

describe("only home and the Moon can be landed on", () => {
  it("flags exactly Earth and the Moon as landable", () => {
    expect([...LANDABLE_IDS].sort()).toEqual(["earth", "moon"])
    expect(BODIES.filter((b) => b.landable).map((b) => b.id).sort()).toEqual(["earth", "moon"])
  })
  it("refuses a realm on every other world, whatever its terrain data", () => {
    for (const id of ["mars", "venus", "mercury", "jupiter", "saturn", "uranus", "neptune", "sun", "io", "europa", "titan", "pluto", "earth"]) {
      expect(canLand(id)).toBe(false)
      const b = bodyById(id)
      if (b) expect(enterRealm(b, b.pos.clone().add(new THREE.Vector3(0, b.radius * 1.01, 0)))).toBeNull()
    }
    expect(spaceRT.realm).toBe("earth")
    expect(canLand("moon")).toBe(true)
    // Mars's elevation data is still there for the view from orbit; it just can't be stood on
    expect(REALM_LOOKS.mars.elevation).toBe("mars")
  })
})

describe("the Moon's ground", () => {
  const moon = (): NonNullable<ReturnType<typeof bodyById>> => bodyById("moon")!
  const fakeGrid = { data: new Float32Array(1440 * 720), w: 1440, h: 720 }

  it("lays the frame under the descent point, with a site straight below at the origin", () => {
    const p = new THREE.Vector3()
    expect(siteUniverse("apollo11", moon(), 30, p)).toBe(true)
    const frame = enterRealm(moon(), p)!
    expect(frame).not.toBeNull()
    expect(spaceRT.realm).toBe("moon")
    const d = siteDirection(LUNAR_SITES[0], new THREE.Vector3())
    const local = realmLocalOf(d, new THREE.Vector3())!
    expect(local).not.toBeNull()
    expect(Math.hypot(local.x - frame.ox, local.z - frame.oz)).toBeLessThan(0.5)
    // and the round trip: the frame's own direction at that point is the site's
    const back = realmDirection(local.x, local.z, new THREE.Vector3())
    expect(back.angleTo(d)).toBeLessThan(1e-6)
    leaveRealm()
  })

  it("places sites at their true distances apart (Apollo 11 → 17 ≈ 630 km real, shrunk 63.71×)", () => {
    const p = new THREE.Vector3()
    siteUniverse("apollo11", moon(), 30, p)
    enterRealm(moon(), p)
    const a = realmLocalOf(siteDirection(LUNAR_SITES.find((s) => s.id === "apollo11")!, new THREE.Vector3()), new THREE.Vector3())!
    const b = realmLocalOf(siteDirection(LUNAR_SITES.find((s) => s.id === "apollo17")!, new THREE.Vector3()), new THREE.Vector3())!
    const realKm = (Math.hypot(a.x - b.x, a.z - b.z) * 63.71) / 1000
    // great circle on a 1737.4 km sphere between the two LROC positions: ≈ 630 km
    expect(realKm).toBeGreaterThan(610)
    expect(realKm).toBeLessThan(650)
    leaveRealm()
  })

  it("answers with the Moon's heights only in its own corner of the plane; home keeps home's", () => {
    const p = new THREE.Vector3()
    siteUniverse("apollo11", moon(), 30, p)
    const frame = enterRealm(moon(), p)!
    realmRT.grid = fakeGrid
    expect(realmGround.fn).not.toBeNull()
    expect(inRealm(frame.ox, frame.oz)).toBe(true)
    expect(inRealm(0, 0)).toBe(false)
    expect(realmHeightAt(0, 0)).toBeNull()
    expect(worldHeight(frame.ox + 3, frame.oz - 2)).toBeCloseTo(realmHeight(frame.ox + 3, frame.oz - 2), 9)
    expect(waterSurfaceAt(frame.ox, frame.oz)).toBeNull()
    expect(gravityAt(frame.ox, frame.oz)).toBeCloseTo(1.62 / 9.81, 4)
    expect(gravityAt(0, 20)).toBe(1)
    expect(sameWorld({ x: 0, z: 0 }, { x: frame.ox, z: frame.oz })).toBe(false)
    leaveRealm()
    expect(realmGround.fn).toBeNull()
  })

  it("keeps every site's ground clear of craters (CPU), with the same mask the GPU uses", () => {
    const p = new THREE.Vector3()
    siteUniverse("apollo11", moon(), 30, p)
    enterRealm(moon(), p)
    expect(realmRT.calm.length).toBe(ALL_SITES.length)
    for (const s of ALL_SITES) {
      const d = siteDirection(s, new THREE.Vector3())
      expect(calmFactor(d, moon().radius, realmRT.calm)).toBe(0)
      // and craters are not suppressed far from every site
    }
    const away = siteDirection({ lat: 40, lon: -120 }, new THREE.Vector3())
    expect(calmFactor(away, moon().radius, realmRT.calm)).toBe(1)
    const flat = surfaceHeight(siteDirection(LUNAR_SITES[0], new THREE.Vector3()), moon().radius, REALM_LOOKS.moon, null, realmRT.calm)
    expect(Math.abs(flat)).toBeLessThan(0.1)
    leaveRealm()
  })

  it("lays out every site's hardware within reach of its anchor", () => {
    for (const s of ALL_SITES) {
      expect(LAYOUTS[s.id]).toBeDefined()
      expect(siteReach(s.id)).toBeLessThan(260)
    }
    // the record, not wishful thinking: Apollo 11's flag lies on the dust; 14 and 15 are unknown
    expect(LAYOUTS.apollo11.items.find((i) => i.kind === "flag")?.standing).toBe(false)
    expect(LAYOUTS.apollo14.items.some((i) => i.kind === "flag")).toBe(false)
    expect(LAYOUTS.apollo15.items.some((i) => i.kind === "flag")).toBe(false)
    expect(ALL_SITES.filter((s) => !s.historical).map((s) => s.id)).toEqual([])
  })
})
