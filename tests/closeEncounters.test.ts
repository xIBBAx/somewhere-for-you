import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { createCloseEncounters } from "../src/game/celestial/wonders/closeEncounters"
import { makeSite, sitePoint, wonderFor, type WonderTick } from "../src/game/celestial/wonders/wonderWorlds"

describe("reachable world encounters", () => {
  it("keeps all three Sun arches reachable within 450 metres ahead", () => {
    const touches: number[] = []
    const system = createCloseEncounters((_world, index) => touches.push(index))
    const at = new THREE.Vector3()
    const site = makeSite(wonderFor("sun")!, {
      pos: new THREE.Vector3(0, 0, 1e6), radius: 1e5,
      pole: new THREE.Vector3(0, 1, 0), def: { name: "Sun", kind: "star" },
    }, at, () => false)
    system.bind(site)
    for (let i = 0; i < 3; i++) {
      const mount = sitePoint(site, (i - 1) * 150, i === 1 ? 25 : 0, 260 + i * 90, new THREE.Vector3())
      expect(mount.clone().sub(at).dot(site.fwd)).toBeLessThanOrEqual(450)
      system.update({ dt: 0.1, time: i * 6, calm: true, halfH: 360, mount, prev: mount, speed: 0 })
    }
    expect(touches).toEqual([0, 1, 2])
    system.dispose()
  })

  for (const id of ["venus", "mars", "sun"]) {
    it(`${id} reacts to a flight through its local encounter, with a cooldown`, () => {
      const touches: string[] = []
      const system = createCloseEncounters((world, index) => touches.push(`${world}:${index}`))
      const at = new THREE.Vector3(3e10, 1e8, -2e10)
      const site = makeSite(wonderFor(id)!, {
        pos: at.clone().add(new THREE.Vector3(0, 0, 1e6)), radius: 1e5,
        pole: new THREE.Vector3(0, 1, 0), def: { name: id, kind: id === "sun" ? "star" : "rocky" },
      }, at, () => false)
      system.bind(site)
      const mount = sitePoint(site, -150, 0, 260, new THREE.Vector3())
      const tick: WonderTick = { dt: 0.1, time: 0, calm: false, halfH: 360, mount, prev: at, speed: 20 }
      system.update(tick)
      expect(touches).toEqual([`${id}:0`])
      tick.prev.copy(mount)
      tick.time = 0.1
      system.update(tick)
      expect(touches).toHaveLength(1)
      tick.time = 6
      system.update(tick)
      expect(touches).toHaveLength(2)
      system.bind(null)
      tick.time = 12
      system.update(tick)
      expect(touches).toHaveLength(2)
      expect(system.root.visible).toBe(false)
      system.dispose()
    })
  }
})
