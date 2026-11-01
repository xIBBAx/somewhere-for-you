import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import * as THREE from "three"
import { CAT_STAGES, emptyVoyage, readVoyage, type CatJourney } from "../src/game/celestial/voyageMemory"
import {
  GATHER_RANGE, L1_FROM_MOON, MEET_RANGE, cruiseHeight, l1Point, nextStage, rendezvousLimit, slotOffset, waitingInSpace,
} from "../src/game/celestial/spaceCats/journey"
import { CREW, crewCoatIndex } from "../src/game/celestial/spaceCats/crew"
import { HELMET } from "../src/game/celestial/spaceCats/catSuit"
import { COATS, WILD_CAT_COATS } from "../src/world/wildlife/animalAssets"
import { CAT_BREEDS } from "../src/world/wildlife/catBreeds"
import {
  NOOK_DECK, NOOK_RACK, NOOK_SPOTS, NOOK_TELESCOPE, NOOK_TOWER, NOOK_WALL, STAR_NOOK, starNookColliders,
} from "../src/world/starNookLayout"
import { buildColliders, groundHeight } from "../src/game/world-layout"
import { distToPath, POND } from "../src/world/hubLayout"
import { updateUniverse, bodyById } from "../src/game/celestial/universe"
import { canLand } from "../src/game/celestial/realm/realmState"

describe("space cats: the journey's stages and what a reload keeps", () => {
  it("never leaves the crew in a stage a reload cannot place", () => {
    const at = (cats: string) => readVoyage(JSON.stringify({ ...emptyVoyage(), moonLandings: 1, cats })).cats
    // on the way: back to waiting where they were found (the L1 point)
    expect(at("escorting")).toBe("met")
    // already on Earth: they finish their trip to Star Nook
    expect(at("arrived")).toBe("settled")
    expect(at("settled")).toBe("settled")
    expect(at("met")).toBe("met")
    // the old name of the last stage
    expect(at("home")).toBe("settled")
    expect(at("on-mars")).toBe("unseen")
  })

  it("keeps Moon landings as a bounded whole number", () => {
    expect(readVoyage(JSON.stringify({ moonLandings: 3.7 })).moonLandings).toBe(3)
    expect(readVoyage(JSON.stringify({ moonLandings: -5 })).moonLandings).toBe(0)
    expect(readVoyage(JSON.stringify({ moonLandings: "lots" })).moonLandings).toBe(0)
    expect(readVoyage("{not json").cats).toBe("unseen")
  })

  it("waits in space only after a first Moon landing, and never once rescued", () => {
    expect(waitingInSpace({ cats: "unseen", moonLandings: 0 })).toBe(false)
    expect(waitingInSpace({ cats: "unseen", moonLandings: 1 })).toBe(true)
    expect(waitingInSpace({ cats: "met", moonLandings: 1 })).toBe(true)
    for (const c of ["escorting", "arrived", "settled"] as CatJourney[]) expect(waitingInSpace({ cats: c, moonLandings: 9 })).toBe(false)
  })

  it("moves forward one stage at a time; the only way back is an escort given up", () => {
    expect(nextStage("unseen", "approach")).toBe("met")
    expect(nextStage("met", "approach")).toBeNull()
    expect(nextStage("met", "gather")).toBe("escorting")
    expect(nextStage("escorting", "gather")).toBeNull()
    expect(nextStage("escorting", "lost")).toBe("met")
    expect(nextStage("met", "touchdownEarth")).toBeNull()
    expect(nextStage("escorting", "touchdownEarth")).toBe("arrived")
    expect(nextStage("arrived", "reachNook")).toBe("settled")
    // a settled crew can't be gathered again (no duplicates)
    for (const e of ["approach", "gather", "lost", "touchdownEarth", "reachNook"] as const) expect(nextStage("settled", e)).toBeNull()
    expect(CAT_STAGES).toEqual(["unseen", "met", "escorting", "arrived", "settled"])
  })
})

describe("space cats: where they wait", () => {
  it("uses the Earth–Moon L1 point of the circular restricted three-body problem", () => {
    // collinear L1, distance γ from the Moon in units of the Earth–Moon distance
    const mu = 0.012150585
    const f = (g: number): number => g ** 5 - (3 - mu) * g ** 4 + (3 - 2 * mu) * g ** 3 - mu * g ** 2 + 2 * mu * g - mu
    expect(Math.abs(f(L1_FROM_MOON))).toBeLessThan(1e-5)
    // about 58,000 km from the Moon at the mean distance
    expect(L1_FROM_MOON * 384_400).toBeGreaterThan(57_500)
    expect(L1_FROM_MOON * 384_400).toBeLessThan(58_500)
  })

  it("is between the Moon and Earth, fixed by the two worlds alone", () => {
    updateUniverse(0.3, new Date("2026-10-19T12:00:00Z"))
    const p = new THREE.Vector3()
    expect(l1Point(p)).toBe(true)
    const moon = bodyById("moon")!, earth = bodyById("earth")!
    const em = earth.pos.distanceTo(moon.pos)
    expect(p.distanceTo(moon.pos) / em).toBeCloseTo(L1_FROM_MOON, 6)
    expect(p.distanceTo(earth.pos) + p.distanceTo(moon.pos)).toBeCloseTo(em, 0)
    // nobody can land there, and the Moon stays the only other ground
    expect(canLand("moon")).toBe(true)
    for (const id of ["mars", "venus", "jupiter", "saturn", "titan", "earth"]) expect(canLand(id)).toBe(false)
  })

  it("slows Starborn to a rendezvous beside them", () => {
    expect(rendezvousLimit(5)).toBeLessThan(0.5)
    expect(rendezvousLimit(GATHER_RANGE)).toBeLessThan(25)
    expect(rendezvousLimit(MEET_RANGE)).toBeLessThan(100)
    expect(rendezvousLimit(100_000)).toBeGreaterThan(50_000)
    for (let d = 0; d < 5000; d += 37) expect(rendezvousLimit(d + 1)).toBeGreaterThanOrEqual(rendezvousLimit(d))
  })
})

describe("space cats: the crew", () => {
  it("is five distinct cats, none of them the cat", () => {
    expect(CREW.map((c) => c.name)).toEqual(["Surya", "Chanda", "Mangal", "Badal", "Jyoti"])
    expect(new Set(CREW.map((c) => c.breed)).size).toBe(5)
    expect(new Set(CREW.map((c) => c.accent)).size).toBe(5)
    for (const c of CREW) {
      const i = crewCoatIndex(c)
      expect(i).toBeLessThan(WILD_CAT_COATS)
      expect(COATS.cat[i].name).not.toBe("cat")
      expect(CAT_BREEDS[i].name).toBe(c.breed)
    }
  })

  it("flies in a formation round Starborn, apart from each other and clear of her and her riders", () => {
    const pts = CREW.map((c) => new THREE.Vector3(...c.slot))
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) expect(pts[i].distanceTo(pts[j])).toBeGreaterThan(1.1)
      const p = pts[i]
      // her body (withers ~1.6 m, 2.4 m long) and the riders' heads (~2.7 m)
      const inBody = Math.abs(p.x) < 0.6 && p.y < 2.0 && Math.abs(p.z) < 1.4
      const inRiders = Math.abs(p.x) < 0.6 && p.y < 3.1 && Math.abs(p.z) < 0.8
      expect(inBody || inRiders).toBe(false)
    }
  })

  it("turns slot offsets with the mount's heading (forward is (sin h, cos h))", () => {
    const v = new THREE.Vector3()
    slotOffset([0, 0, 1], 0, v)
    expect(v.z).toBeCloseTo(1)
    slotOffset([0, 0, 1], Math.PI / 2, v)
    expect(v.x).toBeCloseTo(1)
    // right of a mount facing +z is −x (three.js, y up)
    slotOffset([1, 0, 0], 0, v)
    expect(v.x).toBeCloseTo(-1)
    for (const h of [0.3, 1.7, -2.2]) expect(slotOffset([1.3, 0.4, -2.1], h, v).length()).toBeCloseTo(Math.hypot(1.3, 0.4, 2.1))
  })
})

/** Rest-space head vertices of the rigged cat (weights mostly on the head's bones). */
const headVertices = (): THREE.Vector3[] => {
  const b = readFileSync("public/assets/animals/cat.glb")
  const jl = b.readUInt32LE(12)
  const j = JSON.parse(b.subarray(20, 20 + jl).toString()) as {
    nodes: Array<{ name: string }>; skins: Array<{ joints: number[] }>
    meshes: Array<{ primitives: Array<{ attributes: Record<string, number> }> }>
    accessors: Array<{ bufferView: number; byteOffset?: number; count: number; componentType: number; type: string }>
    bufferViews: Array<{ byteOffset?: number; byteStride?: number }>
  }
  const bin = b.subarray(20 + jl + 8)
  const read = (i: number): number[][] => {
    const a = j.accessors[i], bv = j.bufferViews[a.bufferView]
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type as "VEC3"]
    const size = a.componentType === 5126 ? 4 : a.componentType === 5123 ? 2 : 1
    const out: number[][] = []
    for (let k = 0; k < a.count; k++) {
      const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0) + (bv.byteStride ? k * bv.byteStride : k * n * size)
      const v: number[] = []
      for (let c = 0; c < n; c++) {
        const o = base + c * size
        v.push(size === 4 ? bin.readFloatLE(o) : size === 2 ? bin.readUInt16LE(o) : bin.readUInt8(o))
      }
      out.push(v)
    }
    return out
  }
  const names = j.skins[0].joints.map((i) => j.nodes[i].name)
  const head = new Set(["head", "earL", "earR", "eyeL", "eyeR", "pupilL", "pupilR", "jaw", "tongue", "whiskerL", "whiskerR"])
  const prim = j.meshes[0].primitives[0]
  const P = read(prim.attributes.POSITION), J = read(prim.attributes.JOINTS_0), W = read(prim.attributes.WEIGHTS_0)
  const out: THREE.Vector3[] = []
  for (let i = 0; i < P.length; i++) {
    let w = 0
    for (let c = 0; c < 4; c++) if (head.has(names[J[i][c]])) w += W[i][c]
    if (w > 0.5) out.push(new THREE.Vector3(...P[i]))
  }
  return out
}

describe("space cats: the pressure helmet fits the real head", () => {
  const verts = headVertices()
  it("holds every head vertex, ear tips and whiskers included, with room to spare", () => {
    expect(verts.length).toBeGreaterThan(1000)
    let worst = 0
    for (const v of verts) {
      const q = v.clone().sub(HELMET.centre).divide(HELMET.radii)
      worst = Math.max(worst, q.length())
    }
    // inside the ellipsoid with ≥5% clearance (the crew's ears are no bigger than 1.04×)
    expect(worst).toBeLessThan(0.95)
  })

  it("opens toward the neck, below and behind the head", () => {
    // the cut plane of the dome: points beyond it along the opening are not covered
    const cut = -Math.cos(Math.PI * HELMET.keep)
    let exposed = 0
    for (const v of verts) {
      const q = v.clone().sub(HELMET.centre).divide(HELMET.radii)
      if (q.dot(HELMET.opening) / q.length() > cut && q.length() > 0.55) exposed++
    }
    // only the very base of the skull meets the neck ring
    expect(exposed / verts.length).toBeLessThan(0.03)
    expect(HELMET.opening.y).toBeLessThan(0)
    expect(HELMET.opening.z).toBeLessThan(0)
  })
})

describe("Star Nook", () => {
  it("stands on open, level, dry ground clear of home's paths and everything already there", () => {
    const { circles, rects } = buildColliders()
    const own = new Set(starNookColliders().map((c) => `${c.x},${c.z}`))
    const reach = NOOK_WALL.r + 0.6
    for (const c of circles) {
      if (own.has(`${c.x},${c.z}`)) continue
      expect(Math.hypot(c.x - STAR_NOOK.x, c.z - STAR_NOOK.z) - c.r).toBeGreaterThan(reach)
    }
    for (const r of rects) {
      const dx = Math.max(r.minX - STAR_NOOK.x, 0, STAR_NOOK.x - r.maxX), dz = Math.max(r.minZ - STAR_NOOK.z, 0, STAR_NOOK.z - r.maxZ)
      expect(Math.hypot(dx, dz)).toBeGreaterThan(reach)
    }
    expect(distToPath(STAR_NOOK.x, STAR_NOOK.z)).toBeGreaterThan(reach + 3)
    expect(Math.hypot(POND.x - STAR_NOOK.x, POND.z - STAR_NOOK.z)).toBeGreaterThan(POND.r + reach)
    // the Cat Garden and its residents keep their own place
    expect(Math.hypot(12.4 - STAR_NOOK.x, 0.4 - STAR_NOOK.z)).toBeGreaterThan(3.8 + reach + 5)
    let lo = Infinity, hi = -Infinity
    for (let a = 0; a < 24; a++) for (const r of [0.5, 1.5, 2.5, 3.2]) {
      const y = groundHeight(STAR_NOOK.x + Math.cos(a) * r, STAR_NOOK.z + Math.sin(a) * r)
      lo = Math.min(lo, y); hi = Math.max(hi, y)
    }
    expect(hi - lo).toBeLessThan(0.4)
  })

  it("gives every cat's spot room, inside the shelter and off the props", () => {
    const props = [NOOK_TELESCOPE, NOOK_TOWER, NOOK_RACK]
    for (const s of NOOK_SPOTS) {
      const r = Math.hypot(s.x, s.z)
      // inside the deck (or out on the lawn), never inside the wall's crescent
      const deg = (Math.atan2(s.z, s.x) * 180) / Math.PI
      const onWall = Math.abs(r - NOOK_WALL.r) < 0.5 && deg > NOOK_WALL.from && deg < NOOK_WALL.to
      expect(onWall).toBe(false)
      for (const p of props) if (s.kind !== "tower") expect(Math.hypot(s.x - p.x, s.z - p.z)).toBeGreaterThan(0.4)
    }
    for (let i = 0; i < NOOK_SPOTS.length; i++) for (let k = i + 1; k < NOOK_SPOTS.length; k++) {
      expect(Math.hypot(NOOK_SPOTS[i].x - NOOK_SPOTS[k].x, NOOK_SPOTS[i].z - NOOK_SPOTS[k].z)).toBeGreaterThan(0.8)
    }
    expect(NOOK_SPOTS.filter((s) => s.kind === "cushion").length).toBe(3)
    expect(NOOK_DECK.h).toBeLessThan(0.25)
  })

  it("flies the crew home over the trees", () => {
    const flat = (): number => 0
    expect(cruiseHeight(0, 0, 50, 0, flat)).toBe(9)
    const hill = (x: number): number => (Math.abs(x - 25) < 3 ? 12 : 0)
    expect(cruiseHeight(0, 0, 50, 0, hill)).toBeGreaterThanOrEqual(21)
  })
})
