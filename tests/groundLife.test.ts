import { describe, expect, it } from "vitest"
import { GROUND_CLASSES, GROUND_KINDS, GROUND_LIFE, GROUND_LIFE_LIST } from "../src/content/groundLife"
import { B, BIOME_COUNT, dominantBiome } from "../src/world/climate"
import { originRT } from "../src/world/origin"
import { waterDepthAt } from "../src/world/waterSurface"
import { createAntGeometry, createBeetleGeometry, createCrawlerGeometry, createNestGeometry, createWalkerGeometry } from "../src/world/life/ground/geometry"
import {
  groundOk,
  kindActivity,
  makeEnv,
  planColony,
  makeColonyPlan,
  planSlot,
  PLAN_CELL,
  PLAN_SLOTS,
  stepDampness,
  suitability,
  timeBands,
  type GroundEnv,
} from "../src/world/life/ground/habitat"
import { ANT_CAP, BATCH_CAP, BATCH_COUNT, COLONY_MAX, K, KIND_BATCH, KIND_CAP, KIND_COUNT, KIND_SUB, WALKER_CAP } from "../src/world/life/ground/roster"
import {
  AVATAR_FOOT,
  detourOffset,
  GroundLifeSim,
  makeAntPose,
  renderCoord,
  S,
  SEEN_DWELL,
  SEEN_RADIUS,
  TRAIL_N,
  updateSightings,
  type Colony,
  type Disturber,
} from "../src/world/life/ground/sim"

const flat = (): number => 0
const noTrees = (): null => null
const newSim = (): GroundLifeSim => new GroundLifeSim({ ground: flat, trees: noTrees })
const still = (x: number, z: number, speed = 0): Disturber => ({ x, z, speed, active: true })
const away: Disturber = { x: 1e9, z: 1e9, speed: 0, active: false }

const env = (patch: Partial<GroundEnv>): GroundEnv => Object.assign(makeEnv(), patch)
const NOON = env({ tod: 0.05 })
const NIGHT = env({ tod: 1 })
const RAIN = env({ tod: 0.05, rain: 0.85, wet: 0.9, cloud: 0.9 })
const AFTER_RAIN = env({ tod: 0.05, rain: 0, wet: 0.75, cloud: 0.4 })

/** Search outward from home for a place whose dominant biome is `id`. */
const findBiome = (id: string): [number, number] => {
  for (let r = 80; r < 4000; r += 40) {
    for (let a = 0; a < 32; a++) {
      const x = Math.cos((a / 32) * Math.PI * 2) * r
      const z = Math.sin((a / 32) * Math.PI * 2) * r
      if (dominantBiome(x, z) === id && waterDepthAt(x, z) === 0) return [x, z]
    }
  }
  throw new Error(`no ${id}`)
}

const snapshot = (sim: GroundLifeSim): string[] =>
  sim.pools.flat().filter((c) => c.live).map((c) => `${c.key}:${c.kind}:${c.hx.toFixed(4)}:${c.hz.toFixed(4)}`).sort()

describe("ground life roster", () => {
  it("lists at least seven distinct, accurately classified kinds", () => {
    expect(GROUND_KINDS.length).toBeGreaterThanOrEqual(7)
    expect(new Set(GROUND_LIFE_LIST.map((k) => k.name)).size).toBe(GROUND_KINDS.length)
    const cls = Object.fromEntries(GROUND_KINDS.map((id) => [id, GROUND_LIFE[id].cls]))
    expect(cls).toMatchObject({
      gardenAnt: "insect", woodAnt: "insect", ladybird: "insect", groundBeetle: "insect", stagBeetle: "insect",
      grasshopper: "insect", fieldCricket: "insect",
      harvestman: "arachnid", woodlouse: "crustacean", millipede: "myriapod", snail: "mollusc", earthworm: "annelid",
    })
    // every class used is a known class, and all six appear
    expect(new Set(Object.values(cls))).toEqual(new Set(Object.keys(GROUND_CLASSES)))
    expect(GROUND_CLASSES.mollusc.phylum).toBe("Mollusca")
    expect(GROUND_CLASSES.annelid.phylum).toBe("Annelida")
  })

  it("keeps field-guide copy warm, complete and modest", () => {
    for (const info of GROUND_LIFE_LIST) {
      expect(info.note.length).toBeGreaterThan(40)
      expect(info.hint.length).toBeGreaterThan(20)
      expect(info.toast.length).toBeGreaterThan(15)
      expect(info.scientific.length).toBeGreaterThan(4)
      expect(`${info.note} ${info.hint} ${info.toast}`).not.toMatch(/every species|all species/i)
      // readability enlargement stays within the documented 1.5–2.5×
      expect(info.displayScale).toBeGreaterThanOrEqual(1.5)
      expect(info.displayScale).toBeLessThanOrEqual(2.5)
    }
    // the pill woodlouse really has 14 legs, a harvestman 8, insects 6
    expect(GROUND_LIFE.woodlouse.legs).toBe("14")
    expect(GROUND_LIFE.harvestman.legs).toBe("8")
    expect(GROUND_LIFE.ladybird.legs).toBe("6")
  })

  it("maps kinds to at most six draw calls in content order", () => {
    GROUND_KINDS.forEach((id, i) => expect(K[id]).toBe(i))
    expect(KIND_COUNT).toBe(GROUND_KINDS.length)
    expect(BATCH_COUNT).toBeLessThanOrEqual(6)
    expect(Math.max(...KIND_BATCH)).toBeLessThan(BATCH_COUNT)
    // sub-kinds are unique within a batch
    const seen = new Set(GROUND_KINDS.map((_, k) => `${KIND_BATCH[k]}:${KIND_SUB[k]}`))
    expect(seen.size).toBe(KIND_COUNT)
  })

  it("builds clean geometry with every sub-kind present", () => {
    const batches = [createAntGeometry(), createBeetleGeometry(), createWalkerGeometry(), createCrawlerGeometry(), createNestGeometry()]
    batches.forEach((g, batch) => {
      const pos = g.getAttribute("position")
      for (const name of ["color", "aKind", "aRig", "aTint", "normal"]) expect(g.getAttribute(name)).toBeDefined()
      expect(pos.count).toBeLessThan(2500)
      for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i])).toBe(true)
      const subs = new Set(Array.from(g.getAttribute("aKind").array))
      for (let k = 0; k < KIND_COUNT; k++) {
        if (KIND_BATCH[k] !== batch || batch === 0) continue
        expect(subs.has(KIND_SUB[k])).toBe(true)
      }
    })
    // the snail shell is a true spiral: many rings of the shell part
    const crawlers = createCrawlerGeometry()
    const rig = crawlers.getAttribute("aRig")
    let shell = 0
    for (let i = 0; i < rig.count; i++) if (rig.getX(i) === 7) shell++
    expect(shell).toBeGreaterThan(300)
  })
})

describe("ground life habitat and activity", () => {
  it("splits the day into smooth bands", () => {
    for (let t = 0; t <= 1; t += 0.05) {
      const b = timeBands(t)
      expect(b.day + b.twilight + b.night).toBeCloseTo(1, 6)
    }
    expect(timeBands(0.05).day).toBe(1)
    expect(timeBands(1).night).toBe(1)
  })

  it("gates kinds by time of day", () => {
    expect(kindActivity(K.ladybird, NOON)).toBeGreaterThan(0.9)
    expect(kindActivity(K.ladybird, NIGHT)).toBe(0)
    expect(kindActivity(K.grasshopper, NIGHT)).toBe(0)
    expect(kindActivity(K.groundBeetle, NIGHT)).toBeGreaterThan(kindActivity(K.groundBeetle, NOON) * 4)
    expect(kindActivity(K.harvestman, NIGHT)).toBeGreaterThan(0.9)
    expect(kindActivity(K.woodlouse, NIGHT)).toBeGreaterThan(0.9)
    expect(kindActivity(K.woodlouse, NOON)).toBeLessThan(0.1)
    expect(kindActivity(K.gardenAnt, NOON)).toBeGreaterThan(0.9)
    expect(kindActivity(K.stagBeetle, env({ tod: 0.72 }))).toBeGreaterThan(0.9)
  })

  it("brings snails and worms out with rain, sends sun-lovers to shelter", () => {
    expect(kindActivity(K.earthworm, NOON)).toBe(0)
    expect(kindActivity(K.earthworm, RAIN)).toBeGreaterThan(0.5)
    expect(kindActivity(K.snail, NOON)).toBeLessThan(0.1)
    expect(kindActivity(K.snail, AFTER_RAIN)).toBeGreaterThan(0.8)
    expect(kindActivity(K.woodlouse, AFTER_RAIN)).toBeGreaterThan(kindActivity(K.woodlouse, NOON) * 4)
    expect(kindActivity(K.gardenAnt, RAIN)).toBe(0)
    expect(kindActivity(K.ladybird, RAIN)).toBe(0)
    expect(kindActivity(K.grasshopper, RAIN)).toBe(0)
    // snow sends everyone under cover
    for (let k = 0; k < KIND_COUNT; k++) expect(kindActivity(k, env({ tod: 0.05, snow: 0.8 }))).toBe(0)
  })

  it("remembers damp ground for minutes after the rain stops", () => {
    let wet = 0
    for (let t = 0; t < 60; t++) wet = stepDampness(wet, 0.8, 0.9, 1)
    expect(wet).toBeGreaterThan(0.85)
    for (let t = 0; t < 120; t++) wet = stepDampness(wet, 0, 0, 1)
    expect(wet).toBeGreaterThan(0.4)
    expect(kindActivity(K.snail, env({ tod: 0.05, wet }))).toBeGreaterThan(0.6)
    for (let t = 0; t < 1200; t++) wet = stepDampness(wet, 0, 0, 1)
    expect(wet).toBeLessThan(0.01)
  })

  it("prefers the right biomes", () => {
    const w = new Float32Array(BIOME_COUNT)
    w[B.pine] = 1
    const pine = suitability(K.woodAnt, w)
    w.fill(0)
    w[B.meadow] = 1
    expect(suitability(K.grasshopper, w)).toBeGreaterThan(0.9)
    expect(suitability(K.woodAnt, w)).toBe(0)
    expect(pine).toBe(1)
    w.fill(0)
    w[B.forest] = 1
    expect(suitability(K.woodlouse, w)).toBeGreaterThan(suitability(K.grasshopper, w))
  })

  it("never plans creatures in lakes or on home paths", () => {
    const out = { kind: -1, x: 0, z: 0 }
    expect(groundOk(0, 22)).toBe(false) // the home path at the start
    // a lake and its shores
    const [lx, lz] = findBiome("lakeside")
    let planned = 0
    for (let dz = -8; dz <= 8; dz++) {
      for (let dx = -8; dx <= 8; dx++) {
        for (let s = 0; s < PLAN_SLOTS; s++) {
          const p = planSlot(Math.floor(lx / PLAN_CELL) + dx, Math.floor(lz / PLAN_CELL) + dz, s, out)
          if (p.kind < 0) continue
          planned++
          expect(waterDepthAt(p.x, p.z)).toBe(0)
        }
      }
    }
    expect(planned).toBeGreaterThan(10)
  })
})

describe("ground life population", () => {
  it("spawns deterministically from world position", () => {
    const [x, z] = findBiome("forest")
    const a = newSim()
    const b = newSim()
    a.refresh(x, z)
    b.refresh(x, z)
    expect(snapshot(a)).toEqual(snapshot(b))
    expect(snapshot(a).length).toBeGreaterThan(20)
    const out1 = { kind: -1, x: 0, z: 0 }
    const out2 = { kind: -1, x: 0, z: 0 }
    for (let i = 0; i < 50; i++) {
      planSlot(i * 3 - 70, 11 - i, i % 2, out1)
      planSlot(i * 3 - 70, 11 - i, i % 2, out2)
      expect(out1).toEqual(out2)
    }
    const c1 = planColony(4, -9, makeColonyPlan(), noTrees)
    const c2 = planColony(4, -9, makeColonyPlan(), noTrees)
    expect(c1).toEqual(c2)
  })

  it("hosts the same creatures on revisit", () => {
    const [x, z] = findBiome("meadow")
    const sim = newSim()
    sim.refresh(x, z)
    const first = snapshot(sim)
    const colonies = sim.colonies.filter((c) => c.live).map((c) => `${c.key}:${c.species}:${c.nx}:${c.nz}`).sort()
    sim.refresh(x + 900, z - 400)
    expect(snapshot(sim)).not.toEqual(first)
    sim.refresh(x, z)
    expect(snapshot(sim)).toEqual(first)
    expect(sim.colonies.filter((c) => c.live).map((c) => `${c.key}:${c.species}:${c.nx}:${c.nz}`).sort()).toEqual(colonies)
  })

  it("stays within its pools wherever the player goes", () => {
    const sim = newSim()
    let seed = 7
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 40; i++) {
      const x = (rnd() - 0.5) * 6000
      const z = (rnd() - 0.5) * 6000
      sim.refresh(x, z)
      for (let t = 0; t < 3; t++) sim.step(0.1, i + t * 0.1, still(x, z, 1), away)
      let total = 0
      for (let k = 0; k < KIND_COUNT; k++) {
        const live = sim.pools[k].filter((c) => c.live).length
        expect(live).toBeLessThanOrEqual(KIND_CAP[k])
        total += live
      }
      expect(total).toBeLessThanOrEqual(WALKER_CAP)
      expect(sim.live.size).toBe(total)
      const cols = sim.colonies.filter((c) => c.live)
      expect(cols.length).toBeLessThanOrEqual(COLONY_MAX)
      expect(cols.reduce((n, c) => n + c.ants, 0)).toBeLessThanOrEqual(ANT_CAP)
      for (const c of sim.pools.flat()) if (c.live) expect(Math.hypot(c.hx - x, c.hz - z)).toBeLessThanOrEqual(30)
    }
    // instance capacities cover every pool
    expect(BATCH_CAP.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(WALKER_CAP + ANT_CAP)
  })

  it("thins the population on low quality", () => {
    const [x, z] = findBiome("forest")
    const full = newSim()
    full.refresh(x, z)
    const low = newSim()
    low.capScale = 0.6
    low.refresh(x, z)
    expect(low.live.size).toBeLessThanOrEqual(full.live.size)
    for (let k = 0; k < KIND_COUNT; k++) expect(low.pools[k].filter((c) => c.live).length).toBeLessThanOrEqual(Math.max(1, Math.floor(KIND_CAP[k] * 0.6)))
  })

  it("works millions of metres from home", () => {
    const sim = newSim()
    const x = 3_000_017.5
    const z = -2_000_003.25
    sim.refresh(x, z)
    sim.forceActive = true
    for (let i = 0; i < 30; i++) sim.step(0.05, i * 0.05, still(x, z, 0), away)
    for (const c of sim.pools.flat()) {
      if (!c.live) continue
      expect(Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z)).toBe(true)
      expect(Math.hypot(c.x - c.hx, c.z - c.hz)).toBeLessThan(3)
    }
  })
})

describe("ground life behaviour", () => {
  const run = (sim: GroundLifeSim, seconds: number, avatar: Disturber, t0 = 0): void => {
    for (let t = 0; t < seconds; t += 1 / 30) sim.step(1 / 30, t0 + t, avatar, away)
  }

  it("hops, flies, dashes and wanders away from approaching feet", () => {
    for (const kind of [K.grasshopper, K.ladybird, K.groundBeetle, K.harvestman]) {
      const sim = newSim()
      sim.forceActive = true
      const c = sim.spawnAt(kind, 20, 10)!
      run(sim, 2, away)
      const start = Math.hypot(c.x - 20, c.z - 9.4)
      // The explorer walks up to 0.6 m away
      run(sim, 4, still(20, 9.4, 1.2), 2)
      const end = Math.hypot(c.x - 20, c.z - 9.4)
      // the stilt-walking harvestman bobs first, then strides off more slowly
      expect(end).toBeGreaterThan(kind === K.harvestman ? start + 0.25 : Math.max(start, 0.9))
    }
  })

  it("rolls up, coils, retracts and retreats instead of running", () => {
    const sim = newSim()
    sim.forceActive = true
    const louse = sim.spawnAt(K.woodlouse, 5, 5)!
    const milli = sim.spawnAt(K.millipede, 9, 5)!
    const snail = sim.spawnAt(K.snail, 13, 5)!
    const worm = sim.spawnAt(K.earthworm, 17, 5)!
    const cricket = sim.spawnAt(K.fieldCricket, 21, 5)!
    run(sim, 3, away)
    for (const c of [louse, milli, snail]) {
      run(sim, 2, still(c.x + 0.3, c.z, 0.8), 3)
      expect(c.curl).toBeGreaterThan(0.9)
      expect(c.state).toBe(S.curl)
    }
    run(sim, 2, still(worm.x + 0.4, worm.z, 1), 10)
    expect(worm.hidden).toBe(true)
    run(sim, 2, still(cricket.x + 0.8, cricket.z, 1.2), 12)
    expect(cricket.hidden).toBe(true)
    expect(Math.hypot(cricket.x - cricket.hx, cricket.z - cricket.hz)).toBeLessThan(0.05)
    // once the explorer leaves, everyone comes back out
    run(sim, 20, away, 14)
    expect(louse.curl).toBeLessThan(0.1)
    expect(snail.curl).toBeLessThan(0.1)
    expect(worm.hidden).toBe(false)
    expect(cricket.hidden).toBe(false)
  })

  it("lets a quiet, still player watch from close by", () => {
    const sim = newSim()
    sim.forceActive = true
    const hopper = sim.spawnAt(K.grasshopper, 30, 30)!
    const louse = sim.spawnAt(K.woodlouse, 34, 30)!
    run(sim, 1, away)
    run(sim, 3, still(30, 28.9, 0), 1)
    run(sim, 3, still(34, 29.3, 0), 4)
    expect(Math.hypot(hopper.hx - 30, hopper.hz - 30)).toBe(0)
    expect(louse.curl).toBeLessThan(0.05)
  })

  it("keeps sheltering creatures out of sight and dormant snails sealed", () => {
    const sim = newSim()
    sim.env.tod = 0.05
    const worm = sim.spawnAt(K.earthworm, 0, 40)!
    const snail = sim.spawnAt(K.snail, 2, 40)!
    snail.shell = 0.2
    run(sim, 3, away)
    expect(worm.hidden).toBe(true)
    expect(worm.presence).toBe(0)
    expect(snail.state).toBe(S.dormant)
    expect(snail.curl).toBe(1)
    expect(snail.presence).toBeGreaterThan(0.9)
    sim.env.wet = 0.9
    sim.env.rain = 0.7
    run(sim, 14, away, 3)
    expect(worm.hidden).toBe(false)
    expect(worm.presence).toBeGreaterThan(0.9)
    expect(snail.curl).toBeLessThan(0.2)
  })
})

describe("ant trails", () => {
  const showcaseColonies = (): { sim: GroundLifeSim; cols: Colony[] } => {
    const sim = newSim()
    sim.showcase = { x: 40, z: 40, heading: 0.4 }
    sim.forceActive = true
    sim.refresh(40, 40)
    sim.step(0, 0, away, away)
    return { sim, cols: sim.colonies.filter((c) => c.live) }
  }

  const distanceToTrail = (col: Colony, x: number, z: number): number => {
    let best = Infinity
    for (let i = 0; i < TRAIL_N; i++) {
      const ax = col.px[i]
      const az = col.pz[i]
      const bx = col.px[i + 1]
      const bz = col.pz[i + 1]
      const vx = bx - ax
      const vz = bz - az
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)))
      best = Math.min(best, Math.hypot(x - (ax + vx * t), z - (az + vz * t)))
    }
    return best
  }

  it("lays a trail from nest to food and keeps the runners on it", () => {
    const { sim, cols } = showcaseColonies()
    expect(cols.length).toBe(2)
    const pose = makeAntPose()
    for (const col of cols) {
      expect(col.groundLen).toBeGreaterThan(2.5)
      expect(Math.hypot(col.px[0] - col.nx, col.pz[0] - col.nz)).toBeLessThan(col.size * 0.5)
      for (let t = 0; t < 40; t += 1.7) {
        for (let i = col.moundAnts; i < col.ants; i++) {
          const p = sim.evalAnt(col, i, t, pose)
          expect(distanceToTrail(col, p.x, p.z)).toBeLessThan(0.03)
        }
      }
    }
  })

  it("moves ants steadily along the trail with pauses but never backwards", () => {
    const { sim, cols } = showcaseColonies()
    const col = cols[0]
    const i = col.moundAnts + 2
    const pose = makeAntPose()
    // project onto the trail: progress along it
    const progress = (x: number, z: number): number => {
      let best = Infinity
      let at = 0
      for (let k = 0; k <= TRAIL_N; k++) {
        const d = Math.hypot(x - col.px[k], z - col.pz[k])
        if (d < best) {
          best = d
          at = k
        }
      }
      return at
    }
    let prev = -1
    let dir = 0
    let turns = 0
    let speeds: number[] = []
    let lastX = 0
    let lastZ = 0
    for (let t = 0; t < 400; t += 0.25) {
      const p = sim.evalAnt(col, i, t, pose)
      const at = progress(p.x, p.z)
      if (prev >= 0 && at !== prev) {
        const d = Math.sign(at - prev)
        if (dir !== 0 && d !== dir) turns++
        dir = d
      }
      if (t > 0) speeds.push(Math.hypot(p.x - lastX, p.z - lastZ) / 0.25)
      lastX = p.x
      lastZ = p.z
      prev = at
    }
    // it shuttles there and back a few times, turning only at the ends
    expect(turns).toBeGreaterThan(2)
    expect(turns).toBeLessThan(30)
    speeds = speeds.sort((a, b) => a - b)
    // pauses: some quarter-seconds are nearly still, others brisk
    expect(speeds[Math.floor(speeds.length * 0.1)]).toBeLessThan(speeds[Math.floor(speeds.length * 0.9)] * 0.5)
  })

  it("detours around feet standing on the trail", () => {
    const { sim, cols } = showcaseColonies()
    const pose = makeAntPose()
    for (const col of cols) {
      const mid = TRAIL_N >> 1
      const fx = col.px[mid]
      const fz = col.pz[mid]
      sim.step(0, 0, still(fx, fz, 0), away)
      let near = 0
      for (let t = 0; t < 80; t += 0.5) {
        for (let i = col.moundAnts; i < col.ants; i++) {
          const p = sim.evalAnt(col, i, t, pose)
          const d = Math.hypot(p.x - fx, p.z - fz)
          expect(d).toBeGreaterThan(AVATAR_FOOT * 0.55)
          if (d < AVATAR_FOOT * 1.2) near++
        }
      }
      // they walk round the foot rather than vanishing
      expect(near).toBeGreaterThan(5)
    }
    expect(detourOffset(0, 0, 1, 0, 0, 0, 0.5)).toBeCloseTo(0.5)
    expect(detourOffset(0, 0, 1, 0, 0.1, 0, 0.5)).toBeLessThan(0)
    expect(detourOffset(0, 0, 1, 0, 2, 0, 0.5)).toBe(0)
  })
})

describe("floating origin", () => {
  it("never moves a creature when the origin rebases", () => {
    const run = (rebase: boolean): string[] => {
      originRT.x = 0
      originRT.z = 0
      const sim = newSim()
      sim.forceActive = true
      sim.refresh(1500, -800)
      for (let i = 0; i < 90; i++) {
        if (rebase && i % 10 === 0) {
          originRT.x += 1024
          originRT.z -= 1024
          originRT.version++
        }
        sim.step(1 / 30, i / 30, still(1500 + i * 0.05, -800, 1.4), away)
      }
      return sim.pools.flat().filter((c) => c.live).map((c) => `${c.x.toFixed(9)},${c.y.toFixed(9)},${c.z.toFixed(9)},${c.state}`)
    }
    const plain = run(false)
    const rebased = run(true)
    expect(rebased).toEqual(plain)
    expect(plain.length).toBeGreaterThan(10)
    originRT.x = 0
    originRT.z = 0
  })

  it("writes small, float32-exact render coordinates far from home", () => {
    const logical = 5_000_000.123
    const origin = Math.round(logical / 1024) * 1024
    const render = renderCoord(logical, origin)
    expect(Math.abs(render)).toBeLessThan(1024)
    expect(Math.abs(Math.fround(render) - render)).toBeLessThan(1e-4)
    // float32 alone could not even hold the centimetres
    expect(Math.abs(Math.fround(logical) - logical)).toBeGreaterThan(0.05)
  })
})

describe("field-guide sightings", () => {
  it("counts a kind as met after about a second within 2.5 m", () => {
    const dwell = new Float32Array(KIND_COUNT)
    const nearest = new Float32Array(KIND_COUNT).fill(Infinity)
    const never = (): boolean => false
    nearest[K.snail] = SEEN_RADIUS - 0.4
    let met = -1
    for (let i = 0; i < SEEN_DWELL * 8; i++) met = updateSightings(dwell, nearest, 0.1, never)
    expect(met).toBe(-1)
    for (let i = 0; i < 3 && met < 0; i++) met = updateSightings(dwell, nearest, 0.1, never)
    expect(met).toBe(K.snail)
    // stepping away forgets the half-finished look
    nearest[K.snail] = SEEN_RADIUS + 1
    nearest[K.ladybird] = 3
    for (let t = 0; t < 1; t += 0.1) updateSightings(dwell, nearest, 0.1, never)
    expect(dwell[K.snail]).toBe(0)
    expect(dwell[K.ladybird]).toBe(0)
    // already-met kinds are not reported again
    nearest[K.snail] = 1
    for (let t = 0; t < 2; t += 0.1) expect(updateSightings(dwell, nearest, 0.1, (k) => k === K.snail)).toBe(-1)
  })
})
