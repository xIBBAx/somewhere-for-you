import { describe, expect, it } from "vitest"
import { BREEDS, BREED_IDS, gaitSpeeds, makeIdentity } from "../src/game/horses/breeds"
import { CANTER, GALLOP, TROT, WALK } from "../src/game/horses/HorseAnimator"
import { horseRT, makeHorseState } from "../src/game/horses/horseState"
import { resolveHorseContacts } from "../src/game/horses/horseContact"
import { togetherRT } from "../src/game/together/togetherState"
import { jumpClearance, maxTurnRate, standable, startJump, stepHorseMotion } from "../src/game/horses/horseMotion"
import { herdFor, wildHorsePosition } from "../src/game/horses/herds"
import { requestDismount, riderRT, resetRider, startMount } from "../src/game/horses/riding"
import { buildColliders, groundHeight } from "../src/game/world-layout"
import { chunkColliders } from "../src/world/colliders"
import { playerRT } from "../src/game/runtime"

// an open spot of meadow south-west of home (the home herd's paddock)
const OPEN = { x: -36, z: -24 }

const horse = (breed: Parameters<typeof makeIdentity>[1] = "thoroughbred", saddled = true) => {
  const h = makeHorseState(makeIdentity(4242, breed, { saddled }), OPEN.x, OPEN.z, true)
  h.y = groundHeight(OPEN.x, OPEN.z)
  h.heading = 0
  return h
}

describe("horse identity", () => {
  it("advances an unloaded herd's circuit without moving its home or identity", () => {
    const spawn={id:"wild:0:0:0",seed:42,breed:"mustang" as const,x:-36,z:-24,chunk:"0,0"}
    const a=wildHorsePosition(spawn,100),b=wildHorsePosition(spawn,300)
    expect(wildHorsePosition(spawn,100)).toEqual(a)
    expect(Math.hypot(a.x-b.x,a.z-b.z)).toBeGreaterThan(1)
    expect(Math.hypot(b.x-spawn.x,b.z-spawn.z)).toBeLessThan(9)
    expect(spawn.x).toBe(-36)
  })
  it("is stable for a seed and plausible for the breed", () => {
    for (const breed of BREED_IDS) {
      const a = makeIdentity(77, breed)
      expect(makeIdentity(77, breed)).toEqual(a)
      expect(BREEDS[breed].coats.map(([c]) => c)).toContain(a.coatId)
      expect(a.scale).toBeGreaterThan(0.95)
      expect(a.scale).toBeLessThan(1.05)
      for (const v of [a.traits.calm, a.traits.curiosity, a.traits.energy, a.traits.sensitivity]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
    // a Friesian is always black, and never carries more than a whisper of white
    for (let s = 0; s < 40; s++) expect(makeIdentity(s, "friesian").coatId).toBe("black")
  })

  it("orders gait speeds walk < trot < canter < gallop at real-world magnitudes", () => {
    for (const breed of BREED_IDS) {
      const sp = gaitSpeeds(makeIdentity(9, breed))
      expect(sp[0]).toBeLessThan(sp[1])
      expect(sp[1]).toBeLessThan(sp[2])
      expect(sp[2]).toBeLessThan(sp[3])
      expect(sp[0]).toBeGreaterThan(1.3) // ~5-7 km/h walk
      expect(sp[0]).toBeLessThan(2.1)
      expect(sp[3]).toBeGreaterThan(9) // 35-55 km/h gallop
      expect(sp[3]).toBeLessThan(16)
    }
    // a racing Thoroughbred is faster flat out than a draft horse
    expect(gaitSpeeds(makeIdentity(1, "thoroughbred"))[3]).toBeGreaterThan(gaitSpeeds(makeIdentity(1, "draft"))[3])
  })
})

describe("gait footfalls follow the measured sequences", () => {
  // legs are indexed FL, FR, HL, HR; offsets are when each hoof strikes
  const order = (off: number[]): string[] => ["LF", "RF", "LH", "RH"].map((n, i) => [n, off[i]] as const)
    .sort((a, b) => (a[1] as number) - (b[1] as number)).map(([n]) => n)

  it("walk is a 4-beat lateral sequence LH, LF, RH, RF", () => {
    expect(order(WALK.off)).toEqual(["LH", "LF", "RH", "RF"])
    expect(WALK.duty).toBeGreaterThan(0.55)
  })
  it("trot moves diagonal pairs together with a suspension", () => {
    expect(TROT.off[0]).toBe(TROT.off[3]) // LF with RH
    expect(TROT.off[1]).toBe(TROT.off[2]) // RF with LH
    expect(TROT.duty).toBeLessThan(0.5)
  })
  it("canter is 3-beat: outside hind, then the diagonal pair, then the leading fore", () => {
    // left lead: RH, then LH + RF together, then LF
    expect(CANTER.off[3]).toBe(0)
    expect(Math.abs(CANTER.off[2] - CANTER.off[1])).toBeLessThan(0.05)
    expect(CANTER.off[0]).toBeGreaterThan(CANTER.off[1])
  })
  it("gallop splits the canter's diagonal into a 4-beat transverse sequence", () => {
    expect(order(GALLOP.off)).toEqual(["RH", "LH", "RF", "LF"])
    expect(GALLOP.duty).toBeLessThan(CANTER.duty)
  })
})

describe("horse movement", () => {
  it("has momentum: speed and heading change gradually", () => {
    const h = horse()
    h.targetSpeed = h.pose.speeds[3]
    stepHorseMotion(h, 1 / 60, 0)
    expect(h.speed).toBeLessThan(0.2)
    for (let i = 0; i < 60 * 6; i++) stepHorseMotion(h, 1 / 60, 0)
    expect(h.speed).toBeGreaterThan(h.pose.speeds[2])
    // a full turn request cannot spin it: the yaw rate is limited at speed
    const before = h.heading
    stepHorseMotion(h, 1 / 60, 1)
    expect(Math.abs(h.heading - before)).toBeLessThan(maxTurnRate(h, h.speed) / 60 + 1e-6)
    expect(maxTurnRate(h, 14)).toBeLessThan(maxTurnRate(h, 1.5))
  })

  it("holds a gallop for as long as the rider asks, breathing harder as it goes", () => {
    const h = horse()
    h.stamina = 0.05
    h.targetSpeed = h.pose.speeds[3]
    for (let i = 0; i < 60 * 12; i++) stepHorseMotion(h, 1 / 60, 0)
    expect(h.speed).toBeGreaterThan(h.pose.speeds[3] * 0.97)
    expect(h.exertion).toBeGreaterThan(0.5)
  })
})

describe("jumping", () => {
  it("jumps at once from a canter or a standstill, and refuses a tree", () => {
    const h = horse()
    h.speed = h.pose.speeds[2]
    expect(startJump(h)).toBe("ok")
    expect(h.jumpT).toBe(0)
    // the arc lifts within a few frames of the button
    for (let i = 0; i < 6; i++) stepHorseMotion(h, 1 / 60, 0)
    expect(h.jumpY).toBeGreaterThan(0)
    for (let i = 0; i < 90; i++) stepHorseMotion(h, 1 / 60, 0)
    expect(h.jumpT).toBe(-1)

    const still = horse("quarter")
    still.speed = 0
    expect(startJump(still)).toBe("ok")

    // a tall trunk straight ahead: no horse can clear 4 m
    const tree = horse()
    tree.speed = tree.pose.speeds[2]
    const key = `${Math.floor(tree.x / 64)},${Math.floor((tree.z + 2) / 64)}`
    const list = chunkColliders.get(key) ?? []
    list.push({ x: tree.x, z: tree.z + 2, r: 0.4, height: 4.4 })
    chunkColliders.set(key, list)
    expect(startJump(tree)).toBe("refuse")
    list.pop()
    expect(jumpClearance(horse("draft"))).toBeLessThan(jumpClearance(horse("thoroughbred")))
  })
})

describe("mounting and dismounting", () => {
  it("one rider per horse, the near side first, and a halt before getting off", () => {
    expect(standable(OPEN.x, OPEN.z)).toBe(true)
    const h = horse()
    playerRT.pos.set(h.x + 1.5, h.y, h.z)
    expect(startMount("explorer", h)).toBe("ok")
    expect(h.rider).toBe("explorer")
    expect(riderRT.explorer.side).toBe(1)
    // The companion cannot climb onto the same horse
    expect(startMount("companion", h)).toBe("busy")
    riderRT.explorer.phase = "riding"
    h.speed = 6
    expect(requestDismount("explorer")).toBe("slowing")
    h.speed = 0
    expect(requestDismount("explorer")).toBe("ok")
    resetRider("explorer")
    expect(h.rider).toBe(null)
    // every horse can be ridden: an unsaddled one bareback
    const wild = horse("mustang", false)
    wild.x += 6
    playerRT.pos.set(wild.x - 1.4, wild.y, wild.z)
    expect(startMount("explorer", wild)).toBe("ok")
    expect(riderRT.explorer.side).toBe(-1)
    resetRider("explorer")
  })

  it("refuses to get off where neither side has room", () => {
    const h = horse()
    playerRT.pos.set(h.x + 1.5, h.y, h.z)
    startMount("explorer", h)
    riderRT.explorer.phase = "riding"
    const colliders = buildColliders()
    const n = colliders.circles.length
    void n
    const key = `${Math.floor(h.x / 64)},${Math.floor(h.z / 64)}`
    const list = chunkColliders.get(key) ?? []
    for (const side of [1, -1]) list.push({ x: h.x + side * 0.75, z: h.z + 0.1, r: 0.45, height: 4 })
    chunkColliders.set(key, list)
    expect(requestDismount("explorer")).toBe("blocked")
    list.length -= 2
    resetRider("explorer")
  })
})

describe("wild herds", () => {
  it("are the same band in the same place every visit, on standable meadow", () => {
    let found = 0
    for (let x = -30; x <= 30 && found < 3; x += 2) for (let z = -30; z <= 30 && found < 3; z += 2) {
      const a = herdFor(x, z)
      expect(herdFor(x, z)).toEqual(a)
      if (a.length) {
        found++
        expect(a.length).toBeGreaterThanOrEqual(1)
        expect(a.length).toBeLessThanOrEqual(6)
      }
    }
    expect(found).toBeGreaterThan(0)
    expect(herdFor(0, 0)).toEqual([]) // never at home
  })
})


describe("horse contact", () => {
  it("keeps horses apart and makes a ridden bump count", () => {
    horseRT.horses.clear()
    const a = horse("thoroughbred")
    const b = makeHorseState(makeIdentity(99, "draft", { saddled: true }), OPEN.x + 1.05, OPEN.z, true)
    b.y = a.y
    b.heading = 0
    a.visible = b.visible = true
    a.rider = "companion"
    b.rider = "explorer"
    // The companion's horse runs sideways into the explorer's draft horse
    a.heading = Math.PI / 2
    a.speed = 5
    horseRT.horses.set(a.ident.id, a)
    horseRT.horses.set(b.ident.id, b)
    const gap0 = Math.hypot(a.x - b.x, a.z - b.z)
    resolveHorseContacts(1 / 60, 10)
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(gap0)
    // the lighter Thoroughbred is pushed further than the Clydesdale
    expect(Math.abs(a.x - OPEN.x)).toBeGreaterThan(Math.abs(b.x - (OPEN.x + 1.05)))
    expect(a.irritated).toBeGreaterThan(0)
    expect(b.irritated).toBeGreaterThan(0)
    expect(togetherRT.speech.who).toBe("explorer")
    expect(togetherRT.speech.text.length).toBeGreaterThan(5)
    horseRT.horses.clear()
  })
})
