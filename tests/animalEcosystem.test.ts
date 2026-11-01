import { afterEach, describe, expect, it } from "vitest"
import {
  animalEcosystemRT,
  createAnimalAgent,
  registerAnimalAgent,
  stepAnimalAgent,
} from "../src/game/animals/ecosystem"
import { weatherRT } from "../src/game/weather/weatherState"
import { createFlightFollower, stepFlightFollower } from "../src/game/animals/flying/adapter"
import { groundHeight } from "../src/game/world-layout"

const cleanups: Array<() => void> = []

const register = (agent: ReturnType<typeof createAnimalAgent>): typeof agent => {
  cleanups.push(registerAnimalAgent(agent))
  return agent
}

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
  weatherRT.condition = "clear"
  weatherRT.rain = 0
})

describe("animal ecosystem", () => {
  it("keeps sky birds airborne and moving through resting decisions and ground-animal encounters", () => {
    const bird = register(createAnimalAgent({ id: "test-sky", species: "sky-bird", mobility: "air", position: { x: 0, y: 18, z: 0 },
      altitude: [14, 24], walkSpeed: 3.2, runSpeed: 6.2, seed: 18000, interests: ["sky-bird"], personality: { sociability: 1, curiosity: 1 } }))
    register(createAnimalAgent({ id: "test-ground-neighbor", species: "rabbit", mobility: "land", position: { x: 1, z: 0 }, seed: 2 }))
    const flight = createFlightFollower(bird.id, "robin", bird.position)
    bird.activity = "rest"; bird.activityDuration = 120; bird.decisionIn = 120
    let previous = { ...flight.position }
    for (let i = 0; i < 7200; i++) {
      stepAnimalAgent(bird, 1 / 60)
      stepFlightFollower(flight, bird.position, 1 / 60, bird.velocity)
      if (i > 120 && i % 60 === 0) {
        expect(Math.hypot(flight.position.x - previous.x, flight.position.z - previous.z)).toBeGreaterThan(0.4)
        expect(flight.position.y - groundHeight(flight.position.x, flight.position.z)).toBeGreaterThan(10)
        expect(bird.targetAnimalId).not.toBe("test-ground-neighbor")
      }
      if (i % 60 === 0) previous = { ...flight.position }
    }
    expect(bird.distanceTravelled).toBeGreaterThan(300)
  })
  it("lets prey flee immediately from a nearby predator", () => {
    const rabbit = register(
      createAnimalAgent({
        id: "test-rabbit",
        species: "rabbit",
        mobility: "land",
        position: { x: -8, z: 12 },
        seed: 1,
        threats: ["garden-cat"],
        fleeDistance: 5,
      }),
    )
    register(
      createAnimalAgent({
        id: "test-predator",
        species: "garden-cat",
        mobility: "land",
        position: { x: -6.7, z: 12 },
        seed: 2,
      }),
    )

    rabbit.decisionIn = 0
    const beforeEvents = animalEcosystemRT.threatEvents
    stepAnimalAgent(rabbit, 1 / 60)

    expect(rabbit.activity).toBe("flee")
    expect(rabbit.lastThreatId).toBe("test-predator")
    expect(rabbit.target.x).toBeLessThan(rabbit.position.x)
    expect(rabbit.config.runSpeed).toBeGreaterThan(rabbit.config.walkSpeed)
    expect(animalEcosystemRT.threatEvents).toBe(beforeEvents + 1)
  })

  it("keeps activities persistent between staggered decisions", () => {
    const deer = register(
      createAnimalAgent({
        id: "test-deer",
        species: "deer",
        mobility: "land",
        position: { x: -16, z: 7 },
        seed: 3,
      }),
    )
    deer.activity = "eat"
    deer.activityTime = 0
    deer.activityDuration = 20
    deer.decisionIn = 0

    stepAnimalAgent(deer, 1 / 30)
    const decisions = deer.decisions
    for (let i = 0; i < 10; i++) stepAnimalAgent(deer, 1 / 60)

    expect(deer.activity).toBe("eat")
    expect(deer.decisions).toBe(decisions)
    expect(deer.moving).toBe(false)
  })

  it("sends land animals toward shelter during threatening weather", () => {
    const horse = register(
      createAnimalAgent({
        id: "test-horse",
        species: "horse",
        mobility: "land",
        position: { x: -14, z: -12 },
        seed: 4,
        radius: 0.5,
      }),
    )
    weatherRT.condition = "thunderstorm"
    horse.activityDuration = 0
    horse.decisionIn = 0

    stepAnimalAgent(horse, 1 / 60)

    expect(horse.activity).toBe("shelter")
    expect(horse.target.distanceToSquared(horse.position)).toBeGreaterThan(1)
  })

  it("uses personal-space steering so animals do not stack", () => {
    const first = register(
      createAnimalAgent({
        id: "test-space-a",
        species: "rabbit",
        mobility: "land",
        position: { x: -10, z: 10 },
        seed: 5,
        personalSpace: 0.8,
      }),
    )
    const second = register(
      createAnimalAgent({
        id: "test-space-b",
        species: "rabbit",
        mobility: "land",
        position: { x: -9.75, z: 10 },
        seed: 6,
        personalSpace: 0.8,
      }),
    )
    for (const agent of [first, second]) {
      agent.activity = "roam"
      agent.activityDuration = 20
      agent.decisionIn = 20
      agent.target.set(-10, 0, 16)
    }

    const before = first.position.distanceTo(second.position)
    for (let i = 0; i < 90; i++) {
      stepAnimalAgent(first, 1 / 60)
      stepAnimalAgent(second, 1 / 60)
    }

    expect(first.position.distanceTo(second.position)).toBeGreaterThan(before)
  })
})
