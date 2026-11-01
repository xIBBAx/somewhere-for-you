import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { createAnimalAgent, stepAnimalAgent } from "../src/game/animals/ecosystem"
import { branchFootPoint, monkeySpawnBranch, nearbyBranches, MONKEY_BRANCHES } from "../src/game/animals/monkeyHabitat"
import { getMonkeyMotion, MONKEY_GRAVITY, sampleMonkeyJump, solveMonkeyJump } from "../src/game/animals/monkeyMotion"
import { groundHeight } from "../src/game/world-layout"

describe("monkey locomotion", () => {
  it("solves gravity-driven leaps between nearby branches at different elevations", () => {
    let checked = 0
    for (const branch of MONKEY_BRANCHES) {
      for (const other of nearbyBranches(branch)) {
        const start = branchFootPoint(branch, 0.98, new THREE.Vector3())
        const end = branchFootPoint(other, 0.98, new THREE.Vector3())
        const velocity = new THREE.Vector3()
        const duration = solveMonkeyJump(start, end, velocity)
        const result = new THREE.Vector3()
        sampleMonkeyJump(start, velocity, duration, result)
        expect(result.distanceTo(end)).toBeLessThan(1e-10)
        const apexTime = velocity.y / MONKEY_GRAVITY
        sampleMonkeyJump(start, velocity, apexTime, result)
        expect(result.y).toBeGreaterThan(Math.max(start.y, end.y) + 0.3)
        expect(duration).toBeGreaterThan(0.4)
        expect(duration).toBeLessThan(1.1)
        expect(Math.hypot(velocity.x, velocity.z)).toBeLessThan(5.5)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(12)
  })

  it("completes branch jumps and connected tree-ground-tree cycles without position snaps", () => {
    const branch = monkeySpawnBranch(0)
    const agent = createAnimalAgent({ id: "test-monkey", species: "monkey", mobility: "arboreal", seed: 10,
      position: branchFootPoint(branch, 0.85, new THREE.Vector3()), radius: 0.16 })
    // Deterministic decisions, while testing the same gameplay controller.
    let seed = 24
    agent.rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    const phases = new Set<string>()
    const m = getMonkeyMotion(agent)
    let last = agent.position.clone()
    for (let frame = 0; frame < 60 * 240; frame++) {
      stepAnimalAgent(agent, 1 / 60)
      phases.add(m.phase)
      expect(agent.position.distanceTo(last)).toBeLessThan(0.13)
      if (m.phase === "ground-idle" || m.phase === "ground-walk" || m.phase === "ground-run") {
        expect(agent.position.y).toBeCloseTo(groundHeight(agent.position.x, agent.position.z), 4)
      }
      if (m.phase === "climb-down" || (m.phase === "climb-up" && m.end.y > m.branch.base.y)) {
        expect(Math.hypot(agent.position.x - m.branch.trunk.x, agent.position.z - m.branch.trunk.z)).toBeLessThan(0.3)
      }
      last = agent.position.clone()
    }
    for (const phase of ["branch-idle", "branch-walk", "prepare", "takeoff", "airborne", "landing", "recovery", "climb-down", "ground-idle", "ground-walk", "approach-tree", "climb-up"]) {
      expect(phases.has(phase), `missing ${phase}`).toBe(true)
    }
    expect(m.jumps).toBeGreaterThan(1)
    expect(m.groundVisits).toBeGreaterThan(1)
  })
})
