import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { createBirdGeometry } from "../src/world/life/birdsGeometry"
import {
  createBirdsSimulation,
  forceFlockDebug,
  spawnFlock,
  stepBirdsSimulation,
  MAX_FLOCK_BIRDS,
  MAX_GROUND_BIRDS,
  MAX_LAKE_BIRDS,
  TOTAL_BIRDS,
} from "../src/world/life/birdsSim"
import {
  createInsectsSimulation,
  stepInsectsSimulation,
  BUTTERFLY_COUNT,
  FIREFLY_COUNT,
  MICRO_COUNT,
} from "../src/world/life/insectsSim"
import { calculateCricketState } from "../src/world/life/useCrickets"
import { registerLifeDebug } from "../src/world/life/lifeDebug"

describe("birdsGeometry", () => {
  it("creates bird geometry with body, wings, and custom wing attributes", () => {
    const geom = createBirdGeometry()
    const pos = geom.getAttribute("position")
    const normal = geom.getAttribute("normal")
    const color = geom.getAttribute("color")
    const wingFactor = geom.getAttribute("aWingFactor")
    const wingSpan = geom.getAttribute("aWingSpan")
    const index = geom.getIndex()

    expect(pos).toBeDefined()
    expect(normal).toBeDefined()
    expect(color).toBeDefined()
    expect(wingFactor).toBeDefined()
    expect(wingSpan).toBeDefined()
    expect(index).toBeDefined()

    expect(pos.count).toBeGreaterThan(15)
    expect(index!.count).toBeGreaterThan(30)

    // Check no NaNs
    for (let i = 0; i < pos.count; i++) {
      expect(Number.isNaN(pos.getX(i))).toBe(false)
      expect(Number.isNaN(pos.getY(i))).toBe(false)
      expect(Number.isNaN(pos.getZ(i))).toBe(false)
    }

    // Verify wing factor is 0 on body/tail and > 0 on wings
    let bodyCount = 0
    let wingCount = 0
    for (let i = 0; i < wingFactor.count; i++) {
      if (wingFactor.getX(i) === 0) bodyCount++
      else wingCount++
    }
    expect(bodyCount).toBeGreaterThan(5)
    expect(wingCount).toBeGreaterThan(5)
  })
})

describe("birdsSim", () => {
  it("initializes bird slots and flocks correctly", () => {
    const sim = createBirdsSimulation()
    expect(sim.birds.length).toBe(TOTAL_BIRDS)
    expect(sim.birds.length).toBe(MAX_FLOCK_BIRDS + MAX_GROUND_BIRDS + MAX_LAKE_BIRDS)
    expect(sim.flocks.length).toBe(4)
  })

  it("spawns a distant flock with V or murmuration offsets", () => {
    const sim = createBirdsSimulation()
    const flock = sim.flocks[0]
    spawnFlock(flock, sim, 200, 300)

    expect(flock.active).toBe(true)
    expect(flock.birdCount).toBeGreaterThanOrEqual(7)
    expect(flock.speed).toBeGreaterThan(10)

    // Check flock birds
    const activeBirds = sim.birds.slice(0, 11).filter((b) => b.active)
    expect(activeBirds.length).toBe(flock.birdCount)
    expect(activeBirds[0].state).toBe("flying")
  })

  it("flushes ground birds when player comes within 6m", () => {
    const sim = createBirdsSimulation()
    // Setup a perched ground bird
    const groundBird = sim.birds[MAX_FLOCK_BIRDS]
    groundBird.active = true
    groundBird.state = "perched"
    groundBird.x = 100
    groundBird.z = 100
    groundBird.y = 5

    // Player far away (30m) -> stays perched
    stepBirdsSimulation(sim, 0.1, { x: 70, y: 5, z: 100 }, 0, 0.3, 0)
    expect(groundBird.state === "perched" || groundBird.state === "pecking").toBe(true)

    // Player walks within 5m -> flushes to takeoff!
    stepBirdsSimulation(sim, 0.1, { x: 96, y: 5, z: 100 }, 1.5, 0.3, 0)
    expect(groundBird.state).toBe("takeoff")
    expect(groundBird.vy).toBeGreaterThan(0) // climbing upward
    expect(groundBird.flapAmp).toBeGreaterThan(1.0) // high wingbeat intensity
  })

  it("flushes ground birds from further away when player runs", () => {
    const sim = createBirdsSimulation()
    const groundBird = sim.birds[MAX_FLOCK_BIRDS]
    groundBird.active = true
    groundBird.state = "perched"
    groundBird.x = 100
    groundBird.z = 100
    groundBird.y = 5

    // Player running (speed 4.5) at 9m distance -> triggers takeoff!
    stepBirdsSimulation(sim, 0.1, { x: 91.5, y: 5, z: 100 }, 4.5, 0.3, 0)
    expect(groundBird.state).toBe("takeoff")
  })

  it("suppresses flocks in heavy rain", () => {
    const sim = createBirdsSimulation()
    // In rain = 0.8, active flocks are not spawned and existing flocks deactivate
    for (let frame = 0; frame < 10; frame++) {
      stepBirdsSimulation(sim, 0.5, { x: 500, y: 10, z: 500 }, 0, 0.3, 0.8)
    }
    expect(sim.stats.distantFlocks).toBe(0)
  })

  it("forces birds via debug trigger", () => {
    const sim = createBirdsSimulation()
    forceFlockDebug(sim, 300, 400)
    expect(sim.flocks[0].active).toBe(true)
    const takingOffBirds = sim.birds.filter((b) => b.kind === "ground" && b.state === "takeoff")
    expect(takingOffBirds.length).toBeGreaterThanOrEqual(4)
  })
})

describe("insectsSim", () => {
  it("initializes butterfly, micro, and firefly slots", () => {
    const sim = createInsectsSimulation()
    expect(sim.butterflies.length).toBe(BUTTERFLY_COUNT)
    expect(sim.micros.length).toBe(MICRO_COUNT)
    expect(sim.fireflies.length).toBe(FIREFLY_COUNT)
  })

  it("spawns fireflies at night and suppresses them during day", () => {
    const sim = createInsectsSimulation()

    // Day (tod = 0.2): fireflies inactive
    stepInsectsSimulation(sim, 0.1, 10, 50, 50, 0.2, 0)
    expect(sim.stats.fireflies).toBe(0)

    // Night (tod = 0.85): fireflies activate
    for (let frame = 0; frame < 5; frame++) {
      stepInsectsSimulation(sim, 0.2, 10 + frame, 50, 50, 0.85, 0)
    }
    expect(sim.stats.fireflies).toBeGreaterThan(0)

    // Heavy rain at night: fireflies suppressed
    stepInsectsSimulation(sim, 0.2, 20, 50, 50, 0.85, 0.5)
    expect(sim.stats.fireflies).toBe(0)
  })

  it("suppresses flying insects during rain", () => {
    const sim = createInsectsSimulation()
    stepInsectsSimulation(sim, 0.1, 10, 50, 50, 0.3, 0.6)
    expect(sim.stats.butterflies).toBe(0)
    expect(sim.stats.bees).toBe(0)
    expect(sim.stats.fireflies).toBe(0)
  })
})

describe("useCrickets", () => {
  it("calculates cricket intensity based on time and weather", () => {
    // Daytime -> no crickets
    const day = calculateCricketState(100, 100, 0.3, 0)
    expect(day.active).toBe(false)
    expect(day.intensity).toBe(0)

    // Rain -> no crickets
    const rain = calculateCricketState(100, 100, 0.85, 0.5)
    expect(rain.active).toBe(false)

    // Clear night in meadow -> crickets active
    const night = calculateCricketState(100, 100, 0.85, 0)
    expect(night.intensity).toBeGreaterThan(0)
    expect(night.chirpRate).toBeGreaterThan(0)
  })
})

describe("lifeDebug", () => {
  const origWindow = globalThis.window

  beforeEach(() => {
    globalThis.window = {
      location: { search: "?debug=1" },
    } as unknown as Window & typeof globalThis
  })

  afterEach(() => {
    globalThis.window = origWindow
  })

  it("registers window.__worldDev when ?debug is present", () => {
    const birdsSim = createBirdsSimulation()
    const insectsSim = createInsectsSimulation()

    const cleanup = registerLifeDebug(
      () => birdsSim,
      () => insectsSim,
    )

    expect(window.__worldDev).toBeDefined()
    expect(typeof window.__worldDev?.forceBirds).toBe("function")
    expect(typeof window.__worldDev?.lifeStats).toBe("function")

    const stats = window.__worldDev!.lifeStats!()
    expect(stats.birds.drawCalls).toBe(1)
    expect(stats.insects.drawCalls).toBe(3)
    expect(stats.drawCallsTotal).toBe(4)

    cleanup()
    expect(window.__worldDev?.forceBirds).toBeUndefined()
    expect(window.__worldDev?.lifeStats).toBeUndefined()
  })
})
