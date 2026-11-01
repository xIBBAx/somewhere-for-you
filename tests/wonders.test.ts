import { beforeEach, describe, expect, it } from "vitest"
import * as THREE from "three"
import { emptyVoyage, readVoyage, resetVoyage, voyage } from "../src/game/celestial/voyageMemory"
import { createStarMantas } from "../src/game/celestial/wonders/starMantas"
import { createWishingLights } from "../src/game/celestial/wonders/wishingLights"
import { createWorldMoments } from "../src/game/celestial/wonders/worldMoments"
import { passedThrough, gatherWish, gatheredCount, constellationDone, wishDone } from "../src/game/celestial/wonders/wishes"
import {
  MAX_LIGHTS, WONDER_WORLDS, approachRadii, lightOffsets, makeSite, sitePoint, toneOf, wonderFor, rng,
  type WonderBody, type WonderSite, type WonderTick,
} from "../src/game/celestial/wonders/wonderWorlds"

/** A stand-in body: a sphere of radius R at the origin with the given kind. */
const body = (id: string, kind: "star" | "gas" | "rocky", radius: number, rings = false): WonderBody => ({
  pos: new THREE.Vector3(0, 0, 0),
  radius,
  pole: new THREE.Vector3(0, 1, 0),
  def: { kind, name: id, rings: rings ? { inner: 1, outer: 2, style: "saturn" } : undefined },
})

describe("wishing lights: placement relative to the arrival point", () => {
  it("every world has 7 to 12 lights, all ahead of the arrival point and at a fair distance", () => {
    for (const w of WONDER_WORLDS) {
      expect(w.lights).toBeGreaterThanOrEqual(7)
      expect(w.lights).toBeLessThanOrEqual(MAX_LIGHTS)
      const offs = lightOffsets(w)
      expect(offs).toHaveLength(w.lights)
      for (const [, , z] of offs) {
        expect(z).toBeGreaterThan(150)
        expect(z).toBeLessThan(500)
      }
    }
  })

  it("places the lights in the frame of the arrival: ahead is toward the world", () => {
    const at = new THREE.Vector3(3e10, 1e8, -2e10)
    const centre = new THREE.Vector3(3e10 + 1e6, 1e8, -2e10 + 1e6)
    const b = body("jupiter", "gas", 1000)
    b.pos.copy(centre)
    const w = wonderFor("jupiter")!
    const s = makeSite(w, b, at, () => false)
    // the frame is orthonormal, and ahead points at the world
    expect(s.fwd.length()).toBeCloseTo(1, 9)
    expect(s.right.length()).toBeCloseTo(1, 9)
    expect(s.up.length()).toBeCloseTo(1, 9)
    expect(s.right.dot(s.fwd)).toBeCloseTo(0, 9)
    expect(s.up.dot(s.fwd)).toBeCloseTo(0, 9)
    expect(s.right.dot(s.up)).toBeCloseTo(0, 9)
    // every light sits ahead of her, within a few hundred metres, measured in float64 from the arrival
    const p = new THREE.Vector3()
    for (const o of s.offsets) {
      sitePoint(s, o[0], o[1], o[2], p)
      const d = p.clone().sub(at)
      expect(d.dot(s.fwd)).toBeGreaterThan(100)
      expect(d.length()).toBeGreaterThan(150)
      expect(d.length()).toBeLessThan(600)
    }
  })

  it("keeps the lights off the world: the approach stands off 1.9 radii, 2.6 for rings, 3.5 for a star", () => {
    expect(approachRadii({ kind: "rocky", rings: undefined })).toBe(1.9)
    expect(approachRadii({ kind: "gas", rings: { inner: 1, outer: 2, style: "saturn" } })).toBe(2.6)
    expect(approachRadii({ kind: "star", rings: undefined })).toBe(3.5)
    const b = body("neptune", "gas", 500, true)
    const s = makeSite(wonderFor("neptune")!, b, new THREE.Vector3(0, 0, -1300), () => false)
    expect(s.stand).toBeCloseTo(500 * 2.6, 6)
  })

  it("lays the Pluto constellation out as a heart", () => {
    const w = wonderFor("pluto")!
    expect(w.shape).toBe("heart")
    const offs = lightOffsets(w)
    // the heart spans both sides of its middle line
    const xs = offs.map((o) => o[0])
    expect(Math.max(...xs)).toBeGreaterThan(80)
    expect(Math.min(...xs)).toBeLessThan(-80)
  })

  it("the layout is the same every time (deterministic per world)", () => {
    for (const w of WONDER_WORLDS) expect(lightOffsets(w)).toEqual(lightOffsets(w))
  })

  it("chimes climb a scale that is different for each world", () => {
    for (const w of WONDER_WORLDS) {
      const f = [0, 1, 2, 3].map((i) => toneOf(w, i))
      expect(f[0]).toBeCloseTo(w.root, 6)
      expect(f[1]).toBeGreaterThan(f[0])
      expect(f.every((x) => x > 20 && x < 4000)).toBe(true)
    }
    expect(toneOf(wonderFor("saturn")!, 0)).not.toBeCloseTo(toneOf(wonderFor("venus")!, 0), 1)
  })

  it("only the worlds with a wonder are known", () => {
    expect(wonderFor("jupiter")).not.toBeNull()
    expect(wonderFor("earth")).toBeNull()
    expect(wonderFor("moon")).toBeNull()
    expect(wonderFor("constructor")).toBeNull()
  })

  it("the rng is repeatable from its seed", () => {
    const a = rng("ice:saturn"), b = rng("ice:saturn")
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
})

describe("gathering the wishing lights", () => {
  beforeEach(() => resetVoyage())

  it("gathers each light once, and completes the constellation on the last", () => {
    expect(gatherWish("pluto", 0, 3)).toEqual({ fresh: true, complete: false })
    expect(gatherWish("pluto", 0, 3)).toEqual({ fresh: false, complete: false })
    expect(gatherWish("pluto", 2, 3)).toEqual({ fresh: true, complete: false })
    expect(gatheredCount("pluto")).toBe(2)
    expect(constellationDone("pluto")).toBe(false)
    expect(gatherWish("pluto", 1, 3)).toEqual({ fresh: true, complete: true })
    expect(constellationDone("pluto")).toBe(true)
    // once whole, it stays whole and is not completed again
    expect(gatherWish("pluto", 1, 3)).toEqual({ fresh: false, complete: true })
    expect(wishDone("pluto", 1)).toBe(true)
  })

  it("keeps each world's lights apart", () => {
    gatherWish("venus", 0, 8)
    expect(gatheredCount("venus")).toBe(1)
    expect(gatheredCount("saturn")).toBe(0)
    expect(gatheredCount("ven")).toBe(0)
  })

  it("ignores lights that are not in the constellation", () => {
    expect(gatherWish("mars", 7, 7)).toEqual({ fresh: false, complete: false })
    expect(gatherWish("mars", -1, 7)).toEqual({ fresh: false, complete: false })
    expect(gatheredCount("mars")).toBe(0)
  })
})

describe("flying through a light (the path, not just the position)", () => {
  it("catches a light she passes straight through between two steps", () => {
    const a = new THREE.Vector3(1e11, 0, 0)
    const b = new THREE.Vector3(1e11 + 400, 0, 0)
    const p = new THREE.Vector3(1e11 + 200, 10, 0)
    expect(passedThrough(a, b, p, 34)).toBe(true)
  })

  it("misses a light that is well to one side", () => {
    const a = new THREE.Vector3(0, 0, 0)
    const b = new THREE.Vector3(400, 0, 0)
    expect(passedThrough(a, b, new THREE.Vector3(200, 60, 0), 34)).toBe(false)
  })

  it("does not count a light beyond where she stopped", () => {
    const a = new THREE.Vector3(0, 0, 0)
    const b = new THREE.Vector3(100, 0, 0)
    expect(passedThrough(a, b, new THREE.Vector3(160, 0, 0), 34)).toBe(false)
  })

  it("a stationary mount touches only a light it is inside", () => {
    const a = new THREE.Vector3(5, 5, 5)
    expect(passedThrough(a, a, new THREE.Vector3(10, 5, 5), 34)).toBe(true)
    expect(passedThrough(a, a, new THREE.Vector3(500, 5, 5), 34)).toBe(false)
  })
})

describe("voyage memory keeps the wishes, and reads older saves", () => {
  beforeEach(() => resetVoyage())

  it("reads an old save with no wishes as none gathered", () => {
    const old = readVoyage(JSON.stringify({ sites: [], moonLandings: 1, cats: "met", studied: ["jupiter"] }))
    expect(old.wishes).toBeUndefined()
    expect(old.constellations).toBeUndefined()
    expect(old.cats).toBe("met")
    expect(old.studied).toEqual(["jupiter"])
    expect(readVoyage(null)).toEqual(emptyVoyage())
  })

  it("keeps the wishes and constellations it has, and drops anything malformed", () => {
    const v = readVoyage(JSON.stringify({
      ...emptyVoyage(),
      wishes: ["jupiter:3", "saturn:9", "../evil", "x", 4, "pluto:12:extra", "venus:0"],
      constellations: ["pluto", "Pluto2", "neptune"],
    }))
    expect(v.wishes).toEqual(["jupiter:3", "saturn:9", "venus:0"])
    expect(v.constellations).toEqual(["pluto", "neptune"])
  })

  it("survives a reload: gathered lights are read back from what was saved", () => {
    gatherWish("neptune", 0, 8)
    gatherWish("neptune", 1, 8)
    const saved = JSON.stringify(voyage)
    const back = readVoyage(saved)
    expect(back.wishes).toEqual(["neptune:0", "neptune:1"])
    expect(back.constellations).toBeUndefined()
  })

  it("a reset clears the wishes with the rest of the voyage", () => {
    gatherWish("sun", 0, 9)
    expect(voyage.wishes).toEqual(["sun:0"])
    resetVoyage()
    expect(voyage.wishes).toBeUndefined()
    expect(gatheredCount("sun")).toBe(0)
  })
})

describe("the wonder site", () => {
  it("marks already-gathered lights from the save", () => {
    const b = body("saturn", "gas", 900)
    const s = makeSite(wonderFor("saturn")!, b, new THREE.Vector3(0, 0, -5000), (i) => i === 2)
    expect(s.got[2]).toBe(1)
    expect(s.got[3]).toBe(0)
    expect(s.live).toHaveLength(MAX_LIGHTS)
    expect(s.offsets).toHaveLength(10)
  })
})

describe("the systems, driven frame by frame (no renderer needed)", () => {
  // the view is the universe itself here (no eye offset, identity axes), so the numbers stay small
  const tick = (mount: THREE.Vector3, prev: THREE.Vector3, speed = 0): WonderTick => ({
    dt: 1 / 60, time: 0, calm: false, halfH: 540, mount, prev, speed,
  })
  const siteFor = (b: WonderBody, id: string): WonderSite => makeSite(wonderFor(id)!, b, new THREE.Vector3(0, 0, 0), () => false)
  /** the matrix of one instance (its translation is the view position) */
  const matrixOf = (mesh: THREE.InstancedMesh, i: number): THREE.Matrix4 => new THREE.Matrix4().fromArray(mesh.instanceMatrix.array, i * 16)

  it("gathers the light she flies straight through, once", () => {
    const got: number[] = []
    const lights = createWishingLights((_s, i) => got.push(i))
    const b = body("venus", "rocky", 6000)
    b.pos.set(0, 0, -9000)
    const s = siteFor(b, "venus")
    lights.bind(s)
    const still = new THREE.Vector3()
    lights.update(tick(still, still))
    expect(got).toEqual([])
    const target = s.live[0].clone()
    // her path crosses light 0 between two frames, though neither frame is within it
    const prev = target.clone().addScaledVector(s.fwd, -120)
    const now = target.clone().addScaledVector(s.fwd, 120)
    lights.update(tick(now, prev, 40))
    expect(got).toEqual([0])
    // gathered lights stay gathered: a second pass does nothing
    lights.update(tick(now, prev, 40))
    expect(got).toEqual([0])
  })

  it("star mantas notice a gentle approach and swim alongside her; a surge scatters them", () => {
    const mantas = createStarMantas()
    const b = body("jupiter", "gas", 1000, true)
    b.pos.set(0, 0, -2600)
    const s = siteFor(b, "jupiter")
    mantas.bind(s)
    const mesh = mantas.root.children[0] as THREE.InstancedMesh
    expect(mesh.count).toBeGreaterThan(0)
    const mount = new THREE.Vector3().copy(s.at)
    let prev = mount.clone()
    // a slow, gentle flight for a few seconds, forward toward the world
    for (let f = 0; f < 240; f++) {
      mount.addScaledVector(s.fwd, 0.4)
      mantas.update(tick(mount.clone(), prev.clone(), 12))
      prev = mount.clone()
    }
    const d0 = new THREE.Vector3().setFromMatrixPosition(matrixOf(mesh, 0)).distanceTo(mount)
    expect(d0).toBeLessThan(400)
    // a surge: they scatter outward, away from her
    mantas.update(tick(mount.clone(), mount.clone(), 80))
    const before = new THREE.Vector3().setFromMatrixPosition(matrixOf(mesh, 0)).distanceTo(mount)
    for (let f = 0; f < 30; f++) mantas.update(tick(mount.clone(), mount.clone(), 80))
    const after = new THREE.Vector3().setFromMatrixPosition(matrixOf(mesh, 0)).distanceTo(mount)
    expect(after).toBeGreaterThan(before)
  })

  it("an ice mote flares when she skims it, and settles again", () => {
    const flares: number[] = []
    const moments = createWorldMoments((freq) => flares.push(freq))
    const b = body("saturn", "gas", 900, true)
    b.pos.set(0, 0, -2300)
    const s = siteFor(b, "saturn")
    moments.bind(s)
    const still = new THREE.Vector3()
    moments.update(tick(still, still))
    const points = moments.root.children[0] as THREE.Points
    const burst = points.geometry.getAttribute("aBurst") as THREE.BufferAttribute
    const ipos = points.geometry.getAttribute("position") as THREE.BufferAttribute
    expect(burst.getX(0)).toBe(0)
    const m = new THREE.Vector3(ipos.getX(0), ipos.getY(0), ipos.getZ(0))
    const prev = m.clone().addScaledVector(s.fwd, -60)
    const mount = m.clone().addScaledVector(s.fwd, 60)
    moments.update(tick(mount, prev, 40))
    expect(burst.getX(0)).toBe(1)
    expect(flares.length).toBeGreaterThan(0)
    // a few seconds later it has settled
    for (let f = 0; f < 240; f++) moments.update(tick(still, still))
    expect(burst.getX(0)).toBeLessThan(0.05)
  })
})
