import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { FIELD_N, K, SCATTER_STRIDE, type ChunkPayload } from "../src/world/chunkGen"
import { WATER_LEVEL, lakeMask } from "../src/world/climate"
import { POND, riverCenterZ } from "../src/world/hubLayout"
import { worldHeight } from "../src/world/terrain"
import { CHUNK_SIZE } from "../src/world/worldConfig"
import { aquaticEvents } from "../src/world/aquatic/events"
import { seatAquaticBank } from "../src/world/aquatic/bankGeometry"
import { writeFishPose } from "../src/world/aquatic/instancePose"
import { aquaticBedHeight, classifyWater, fitsWater, footprintBed, riverFlow, waterZone } from "../src/world/aquatic/habitat"
import { makeFishGeometry, makeSurfaceGeometry } from "../src/world/aquatic/geometry"
import { AquaticPopulation } from "../src/world/aquatic/population"
import { beatFrequency, createFish, fishBudget, fishDrag, fishTier, makePopulation, stepFish, type AquaticContext } from "../src/world/aquatic/simulation"
import { createSurfaceAgent, makeSurfacePopulation, stepSurface, surfaceVisible } from "../src/world/aquatic/surface"

const payload = (cx: number, cz: number): ChunkPayload => {
  const heights = new Float32Array(FIELD_N * FIELD_N)
  let minH = Infinity, maxH = -Infinity
  for (let z = 0; z < FIELD_N; z++) for (let x = 0; x < FIELD_N; x++) {
    const y = worldHeight(cx * CHUNK_SIZE + x, cz * CHUNK_SIZE + z)
    heights[z * FIELD_N + x] = y; minH = Math.min(minH, y); maxH = Math.max(maxH, y)
  }
  return { cx, cz, heights, minH, maxH, hasWater: minH < WATER_LEVEL, normals: new Int8Array(), colors: new Uint8Array(),
    aux: new Uint8Array(), scatter: new Float32Array(), scatterCount: 0, biome: 7, biomeWeights: new Float32Array(8), genMs: 0 }
}
const home = payload(0, 0), river = payload(0, -1)
const lake = (() => {
  for (let i = 0; i < 20000; i++) {
    const x = (i * 37.1) % 4000 - 2000, z = Math.floor(i / 108) * 37 - 2000
    if (lakeMask(x, z) > 0.8 && worldHeight(x, z) < WATER_LEVEL - 1.5) return payload(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE))
  }
  throw new Error("Expected deterministic lake in the terrain field")
})()
const context = (): AquaticContext => ({ px: 10000, pz: 10000, rain: 0, timeOfDay: 0, time: 0 })
const silentRipple = (): void => {}

describe("aquatic habitats and populations", () => {
  it("measures the home pond, flowing creek and a deep procedural lake", () => {
    expect(classifyWater({ ...home, hasWater: false }).areas.some(a => a.kind === "pond" && a.area < 140)).toBe(true)
    expect(classifyWater(river).areas.some(a => a.kind === "river")).toBe(true)
    expect(classifyWater(lake).areas.some(a => a.kind === "lake" && a.maxDepth > 1.35)).toBe(true)
    expect(waterZone(0.7)).toBe("shallow"); expect(waterZone(2)).toBe("deep")
    const flow = { x: 0, z: 0 }, x = 5, epsilon = 0.001
    riverFlow(x, flow)
    expect(flow.z / flow.x).toBeCloseTo((riverCenterZ(x + epsilon) - riverCenterZ(x - epsilon)) / (2 * epsilon), 5)
    expect(Math.hypot(flow.x, flow.z)).toBeCloseTo(1)
  })

  it("spawns reproducibly in safe volumes and uses existing plants as cover", () => {
    const p = { ...lake, scatter: new Float32Array(SCATTER_STRIDE), scatterCount: 1 }
    const wet = classifyWater(lake).areas.find(a => a.kind === "lake")!.cells[0]
    p.scatter.set([wet.x - p.cx * CHUNK_SIZE, WATER_LEVEL, wet.z - p.cz * CHUNK_SIZE, 1, 0, K.lily, 0, 0])
    const a = classifyWater(p), b = classifyWater(p)
    expect(a.areas.some(a => a.plants.length > 0)).toBe(true)
    const first = makePopulation(a), second = makePopulation(b)
    expect(first.map(s => [s.id, s.x, s.y, s.z, s.size])).toEqual(second.map(s => [s.id, s.x, s.y, s.z, s.size]))
    expect(new Set(first.map(s => s.species))).toEqual(new Set([0, 1, 2]))
    for (const s of first) expect(fitsWater(a, s.area, s.x, s.y, s.z, s.size * 0.72, s.size * 0.25)).toBe(true)
    expect(makePopulation(classifyWater(river)).some(s => s.species === 3)).toBe(true)
  })

  it("scales quality, bounds near populations and releases unloaded chunk residents", () => {
    expect(fishTier(39)).toBe("full"); expect(fishTier(41)).toBe("reduced"); expect(fishTier(91)).toBe("off")
    expect(fishBudget(0.55, 18)).toBeLessThan(fishBudget(1, 28))
    const p = new AquaticPopulation()
    p.add({ ...home, hasWater: false }); p.add({ ...river, hasWater: false }); p.refresh(POND.x, POND.z, 1, 28)
    const high = p.fish.length
    expect(high).toBeGreaterThan(0); expect(high).toBeLessThanOrEqual(16)
    const frog = p.surface.find(a => a.kind === 0)!
    frog.submerged = 12
    expect(p.force(POND.x, POND.z)).toBe("ready")
    p.refresh(POND.x, POND.z, 1, 28)
    expect(p.surface.filter(a => a.kind === 0).every(a => a.submerged === 0)).toBe(true)
    p.refresh(POND.x, POND.z, 0.55, 18)
    expect(p.fish.length).toBeLessThanOrEqual(high)
    p.remove("0,0")
    expect(p.fish.some(a => a.habitat.key === "0,0")).toBe(false)
    expect(p.surface.some(a => a.habitat.key === "0,0")).toBe(false)
    p.refresh(3000, 3000, 1, 28)
    expect(p.fish).toHaveLength(0); expect(p.surface).toHaveLength(0)
    p.clear(); expect(p.chunks.size).toBe(0)
  })

  it("seats authored banks below fish instead of occluding them at the water surface", () => {
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.Float32BufferAttribute([9.2, WATER_LEVEL - 0.05, 7, 10.2, WATER_LEVEL - 0.05, 7, 9.2, WATER_LEVEL - 0.05, 8], 3))
    seatAquaticBank(g)
    for (let i = 0; i < g.attributes.position.count; i++) {
      const p = g.attributes.position
      expect(p.getY(i)).toBeCloseTo(worldHeight(p.getX(i), p.getZ(i)) + 0.012, 6)
      expect(p.getY(i)).toBeLessThan(WATER_LEVEL - 0.3)
    }
    g.dispose()
  })

  it("matches analytic worldHeight with cached landmarks throughout a chunk", () => {
    for (const p of [home, river, lake, payload(10, -6), payload(30, 31), payload(0, 1)]) {
      const h = classifyWater(p)
      for (let i = 0; i < 180; i++) {
        const x = p.cx * CHUNK_SIZE + (i * 9.317) % CHUNK_SIZE, z = p.cz * CHUNK_SIZE + (i * 7.273) % CHUNK_SIZE
        expect(aquaticBedHeight(h, x, z)).toBeCloseTo(worldHeight(x, z), 10)
      }
    }
  })
})

describe("living freshwater simulation", () => {
  it("keeps complete fish footprints submerged above terrain through turns, rain and disturbance", () => {
    for (const source of [home, river, lake]) {
      const habitat = classifyWater(source), fish = makePopulation(habitat).map(createFish), c = context()
      expect(fish.length).toBeGreaterThan(0)
      for (let frame = 0; frame < 1000; frame++) {
        c.time = frame / 30; c.rain = frame > 300 && frame < 650 ? 1 : 0
        if (frame > 650) { c.px = fish[0].x + 0.2; c.pz = fish[0].z + 0.2 }
        for (const a of fish) {
          stepFish(a, fish, c, 1 / 30, silentRipple)
          expect(fitsWater(habitat, a.area, a.x, a.y, a.z, a.size * 0.72, a.size * 0.25)).toBe(true)
          // Nose, tail and lateral fins also clear the analytic terrain, not
          // just the cached centre height used by the water surface renderer.
          for (const offset of [-0.68, 0.49]) {
            const x = a.x + Math.sin(a.heading) * offset * a.size, z = a.z + Math.cos(a.heading) * offset * a.size
            expect(a.y - a.size * 0.25).toBeGreaterThan(worldHeight(x, z) + 0.03)
          }
        }
      }
    }
  }, 15000)

  it("scatters from the explorer, swims deeper in rain and does not synchronize school phases", () => {
    const h = classifyWater(lake), s = makePopulation(h).find(s => s.species === 0)!
    const dry = createFish(s), wet = createFish(s), dc = context(), wc = { ...context(), rain: 1 }
    for (let i = 0; i < 180; i++) { stepFish(dry, [dry], dc, 1 / 60, silentRipple); stepFish(wet, [wet], wc, 1 / 60, silentRipple) }
    expect(wet.y).toBeLessThan(dry.y - 0.05)
    const scared = createFish(s), startX = scared.x, startZ = scared.z
    const c = { ...context(), px: startX - 0.9, pz: startZ }
    for (let i = 0; i < 60; i++) stepFish(scared, [scared], c, 1 / 60, silentRipple)
    expect(scared.scatter).toBeGreaterThan(0.5)
    expect(scared.speed).toBeGreaterThan(dry.speed)
    const phases = new Set(makePopulation(h).filter(s => s.species === 0).map(s => createFish(s).phase))
    expect(phases.size).toBeGreaterThan(4)
  })

  it("holds river fish facing upstream between short, independently timed darts", () => {
    const h = classifyWater(river), fish = makePopulation(h).filter(s => s.species === 3).map(createFish), c = context()
    expect(fish.length).toBeGreaterThan(0)
    for (const a of fish) {
      a.burstTimer = 100
      const startX = a.x, startZ = a.z
      for (let i = 0; i < 120; i++) stepFish(a, fish, c, 1 / 60, silentRipple)
      const flow = { x: 0, z: 0 }; riverFlow(a.x, flow)
      expect(Math.sin(a.heading) * flow.x + Math.cos(a.heading) * flow.z).toBeLessThan(-0.9)
      expect(Math.hypot(a.x - startX, a.z - startZ)).toBeLessThan(0.08)
    }
  })

  it("gates dragonflies/skaters by weather, and completes frog approach, splash and return", () => {
    const h = classifyWater(home), agents = makeSurfacePopulation(h).map(createSurfaceAgent), c = context()
    const dragon = agents.find(a => a.kind === 2)!, skater = agents.find(a => a.kind === 1)!, frog = agents.find(a => a.kind === 0)!
    expect(dragon).toBeDefined(); expect(skater).toBeDefined(); expect(frog).toBeDefined()
    for (const a of agents) if (a.kind !== 0) expect(footprintBed(h, a.x, a.z, 0.18)).toBeLessThan(WATER_LEVEL - 0.06)
    expect(surfaceVisible(dragon, { ...c, rain: 0.31 }, 0)).toBe(false)
    expect(surfaceVisible(dragon, { ...c, timeOfDay: 0.98 }, 0)).toBe(false)
    expect(surfaceVisible(skater, c, 0.7)).toBe(false)
    const events: string[] = [], off = aquaticEvents.subscribe(e => events.push(e.kind))
    c.px = frog.homeX + 1; c.pz = frog.homeZ
    for (let i = 0; i < 60; i++) stepSurface(frog, c, 1 / 60, silentRipple)
    expect(frog.submerged).toBeGreaterThan(0); expect(events).toContain("frog-hop"); expect(events).toContain("splash")
    c.px = 10000; c.pz = 10000
    for (let i = 0; i < 2400; i++) stepSurface(frog, c, 1 / 60, silentRipple)
    expect(frog.hop).toBe(0); expect(frog.submerged).toBe(0)
    expect(frog.x).toBeCloseTo(frog.homeX); expect(frog.y).toBeCloseTo(frog.homeY)
    frog.timer = 0; stepSurface(frog, { ...c, timeOfDay: 0.98 }, 1 / 60, silentRipple)
    expect(events).toContain("croak"); off()
  })

  it("repeats behavior from identical seeds and only raises jumps in twilight/dawn", () => {
    const h = classifyWater(lake), spawns = makePopulation(h), one = spawns.map(createFish), two = spawns.map(createFish), c = context()
    for (let i = 0; i < 90; i++) {
      c.time = i / 30
      for (const a of one) stepFish(a, one, c, 1 / 30, silentRipple)
      for (const a of two) stepFish(a, two, c, 1 / 30, silentRipple)
    }
    expect(one.map(a => [a.x, a.y, a.z, a.heading, a.speed])).toEqual(two.map(a => [a.x, a.y, a.z, a.heading, a.speed]))
    const eventKinds: string[] = [], off = aquaticEvents.subscribe(e => eventKinds.push(e.kind))
    for (const a of one) a.surfaceTimer = 0
    for (const a of one) stepFish(a, one, c, 1 / 60, silentRipple)
    expect(eventKinds).not.toContain("jump")
    c.timeOfDay = 0.72
    for (let i = 0; i < 100; i++) for (const a of one) { a.surfaceTimer = 0; stepFish(a, one, c, 1 / 60, silentRipple) }
    expect(eventKinds).toContain("jump")
    off()
  })

  it("builds bounded fish silhouettes with dark backs and light bellies", () => {
    for (let species = 0; species < 4; species++) {
      const g = makeFishGeometry(species)
      g.computeBoundingBox()
      expect(g.boundingBox!.max.z).toBeCloseTo(0.5); expect(g.boundingBox!.min.z).toBeCloseTo(-0.68)
      expect(g.attributes.color.count).toBe(g.attributes.position.count)
      expect(g.attributes.position.count).toBeLessThan(1600)
      g.dispose()
    }
    const g = makeSurfaceGeometry()
    expect(new Set(g.attributes.part.array)).toEqual(new Set([0, 1, 2])); g.dispose()
  })

  it("preserves headings and float32 precision through origin rebases, including jumping poses", () => {
    const a = createFish(makePopulation(classifyWater(home))[0]), pose = new THREE.Matrix4(), expected = new THREE.Object3D()
    a.x += 10000000; a.z += 10000000
    for (const jumping of [0, 0.2, 0.6]) {
      a.jumping = jumping
      writeFishPose(pose, a, 10000000, 10000000)
      expected.position.set(a.x - 10000000, pose.elements[13], a.z - 10000000)
      expected.rotation.set(jumping > 0 ? -Math.cos(jumping / a.jumpDuration * Math.PI) * 0.55 : 0, a.heading, 0, "YXZ")
      expected.scale.setScalar(a.size); expected.updateMatrix()
      for (let i = 0; i < 16; i++) expect(pose.elements[i]).toBeCloseTo(expected.matrix.elements[i], 8)
      const packed = new Float32Array(pose.elements)
      expect(packed[12]).toBeCloseTo(a.x - 10000000, 5); expect(packed[14]).toBeCloseTo(a.z - 10000000, 5)
    }
  })
})

describe("fish propulsion: thrust from the tail, drag from the water", () => {
  it("beats its tail at Bainbridge's frequency for its speed and length", () => {
    // f = (4U/L + 4)/3: a 24 cm fish at 0.26 m/s beats ~2.8 Hz, faster when it hurries
    expect(beatFrequency(0.26, 0.24)).toBeCloseTo(2.78, 1)
    expect(beatFrequency(0.8, 0.24)).toBeGreaterThan(beatFrequency(0.26, 0.24) * 1.8)
    // a big fish beats slower at the same speed
    expect(beatFrequency(0.26, 0.6)).toBeLessThan(beatFrequency(0.26, 0.24))
    // drag falls with size: a big fish coasts further
    expect(fishDrag(0.6)).toBeLessThan(fishDrag(0.24))
  })

  it("swims a minnow kick-and-glide: bouts of beats, coasts with a straight tail, speed surging with each stroke", () => {
    const h = classifyWater(lake), s = makePopulation(h).find(s => s.species === 0)!
    const fish = createFish(s), c = context()
    let coastTime = 0, beatTime = 0, switches = 0, wasKicking = fish.kicking
    let minAmp = Infinity, maxAmp = 0, sum = 0, n = 0, rises = 0, falls = 0, last = fish.speed
    let coastDrop = 0
    for (let i = 0; i < 60 * 30; i++) {
      const before = fish.speed
      stepFish(fish, [fish], c, 1 / 60, silentRipple)
      if (fish.kicking) beatTime += 1 / 60; else { coastTime += 1 / 60; if (fish.beat < 0.3) coastDrop = Math.max(coastDrop, before - fish.speed) }
      if (fish.kicking !== wasKicking) switches++
      wasKicking = fish.kicking
      minAmp = Math.min(minAmp, fish.waveAmp); maxAmp = Math.max(maxAmp, fish.waveAmp)
      if (fish.kicking) { if (fish.speed > last) rises++; else falls++ }
      last = fish.speed
      if (i > 120) { sum += fish.speed; n++ }
    }
    expect(switches, "it alternates between beating and gliding").toBeGreaterThan(6)
    expect(coastTime).toBeGreaterThan(2)
    expect(beatTime).toBeGreaterThan(2)
    expect(minAmp, "gliding, the tail nearly straight").toBeLessThan(maxAmp * 0.35)
    expect(coastDrop, "drag slows it while it coasts").toBeGreaterThan(0)
    // within a bout the speed surges and eases with each stroke
    expect(rises).toBeGreaterThan(20)
    expect(falls).toBeGreaterThan(20)
    // and on average it still cruises near its usual pace
    expect(sum / n).toBeGreaterThan(0.1)
    expect(sum / n).toBeLessThan(0.45)
  })

  it("beats without pause when startled, and bends its body into the turn", () => {
    const h = classifyWater(lake), s = makePopulation(h).find(s => s.species === 0)!
    const fish = createFish(s)
    const c = { ...context(), px: fish.x - 0.6, pz: fish.z }
    let alwaysKicking = true, maxTurn = 0
    for (let i = 0; i < 60; i++) {
      stepFish(fish, [fish], c, 1 / 60, silentRipple)
      if (i > 5 && !fish.kicking) alwaysKicking = false
      maxTurn = Math.max(maxTurn, Math.abs(fish.turnRate))
    }
    expect(alwaysKicking).toBe(true)
    expect(fish.speed).toBeGreaterThan(0.4)
    expect(maxTurn).toBeGreaterThan(0.5)
  })
})
