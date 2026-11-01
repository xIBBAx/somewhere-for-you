import { beforeEach, describe, expect, it } from "vitest"
import { useGame } from "../src/state/gameStore"
import { MEMORIES, TOTAL_STARS } from "../src/content/memories"
import { discoveryRT, markFound } from "../src/world/discoveries"
import { generateChunk } from "../src/world/chunkGen"
import { waterDepthAt, waterSurfaceAt } from "../src/world/waterSurface"
import { nearbyWorldColliders } from "../src/world/colliders"
import { avatarRT, catRT, characterRT, companionRT, input, playerRT, resetCharactersForJourney, resetRuntime, selectAvatar, worldRT } from "../src/game/runtime"
import { canSwitchCharacter, inviteCompanion } from "../src/game/characters/characterSwitch"
import { avatarFootGround, createAvatarController, stepAvatarController } from "../src/game/characters/controller/avatarController"
import type { LocomotionTuning } from "../src/game/characters/controller/locomotion"

const tuning: LocomotionTuning = { radius: 0.34, walkSpeed: 1.88, runSpeed: 5.6, accel: 42, decel: 26, turnRate: 12,
  swimSpeed: 1.45, swimSprint: 2.3, floatDraft: 1.12, swimEnter: 1.25, swimExit: 1.02 }

beforeEach(() => {
  resetCharactersForJourney()
  resetRuntime({ x: 0, z: 22.5 })
  worldRT.introActive = worldRT.finaleActive = false
  worldRT.performingMemoryId = null
  input.move.x = input.move.y = 0
  input.sprint = false
  nearbyWorldColliders.length = 0
  characterRT.companionReady = true
  useGame.setState({ started: true, stars: TOTAL_STARS, visitOrder: MEMORIES.map(m => m.id), activeMemoryId: null, activeSecretId: null, finale: "done", finaleMessage: false })
})

describe("independent bodies and active control", () => {
  it("keeps the companion unavailable until all nine memories and the finale are complete", () => {
    const game = useGame.getState()
    expect(canSwitchCharacter({ ...game, stars: 0, visitOrder: [], finale: "locked" })).toBe(false)
    expect(canSwitchCharacter({ ...game, stars: 8, visitOrder: game.visitOrder.slice(0, 8) })).toBe(false)
    expect(canSwitchCharacter({ ...game, finale: "locked" })).toBe(false)
    expect(canSwitchCharacter({ ...game, finale: "playing" })).toBe(false)
    expect(canSwitchCharacter({ ...game, visitOrder: [] })).toBe(false)
    expect(canSwitchCharacter(game)).toBe(true)
  })
  it("changes the canonical accessor without moving bodies or changing the cat's owner", () => {
    const explorer = playerRT.pos.clone(), companion = companionRT.pos.clone()
    playerRT.vel.set(3, 2, 4)
    playerRT.jumpPhase = "rising"
    playerRT.jumpHeight = 0.6
    input.jump = input.call = input.interact = true
    selectAvatar("companion")
    expect(avatarRT()).toBe(companionRT)
    expect(playerRT.pos).toEqual(explorer)
    expect(companionRT.pos).toEqual(companion)
    expect(playerRT.vel.toArray()).toEqual([0, 2, 0])
    expect([playerRT.jumpPhase, playerRT.jumpHeight]).toEqual(["rising", 0.6])
    expect(catRT.owner).toBe("explorer")
    expect([input.jump, input.call, input.interact]).toEqual([false, false, false])
    selectAvatar("explorer")
    expect(avatarRT()).toBe(playerRT)
  })

  it("invites the companion safely once and preserves his location on later switches", () => {
    expect(inviteCompanion()).toBe(true)
    expect(companionRT.pos.distanceTo(playerRT.pos)).toBeGreaterThan(0.9)
    companionRT.pos.set(240, 0, -400)
    expect(inviteCompanion()).toBe(true)
    expect(companionRT.pos.toArray()).toEqual([240, 0, -400])
  })

  it("only drives the selected body, including held sprint and jump edges", () => {
    const a = createAvatarController(playerRT), b = createAvatarController(companionRT)
    stepAvatarController(playerRT, "explorer", a, tuning, 1 / 60)
    stepAvatarController(companionRT, "companion", b, tuning, 1 / 60)
    selectAvatar("companion")
    input.move.y = -1
    input.sprint = input.jump = true
    const previous = playerRT.pos.clone(), start = companionRT.pos.clone()
    for (let i = 0; i < 30; i++) {
      stepAvatarController(playerRT, "explorer", a, tuning, 1 / 60)
      stepAvatarController(companionRT, "companion", b, tuning, 1 / 60)
    }
    expect(playerRT.pos.distanceTo(previous)).toBeLessThan(0.001)
    expect(companionRT.pos.distanceTo(start)).toBeGreaterThan(0.5)
    expect(input.jump).toBe(false)
    expect(b.targetSpeed).toBe(tuning.runSpeed)
    input.move.y = 0
    input.sprint = false
    for (let i = 0; i < 60; i++) stepAvatarController(companionRT, "companion", b, tuning, 1 / 60)
    expect(companionRT.speed).toBeLessThan(0.01)
  })

  it("keeps a suspended jump's own physics through a handoff", () => {
    const state = createAvatarController(playerRT)
    // pressed and held (a tap would cut the rise short before the handoff)
    input.jump = input.ascend = true
    for (let i = 0; i < 15; i++) stepAvatarController(playerRT, "explorer", state, tuning, 1 / 60)
    input.ascend = false
    expect(playerRT.jumpPhase).toBe("rising")
    const height = playerRT.pos.y, revision = playerRT.revision
    selectAvatar("companion")
    stepAvatarController(playerRT, "explorer", state, tuning, 1 / 60)
    expect(playerRT.revision).toBe(revision)
    expect(playerRT.pos.y).toBeGreaterThan(height)
    for (let i = 0; i < 120; i++) stepAvatarController(playerRT, "explorer", state, tuning, 1 / 60)
    expect(playerRT.jumpPhase).toBe("grounded")
    expect(playerRT.jumpHeight).toBe(0)
  })

  it("retains swimming when a different body receives control", () => {
    let deep: { x: number; z: number } | null = null
    // any deep lake will do
    for (let r = 120; r <= 1200 && !deep; r += 24) for (let a = 0; a < Math.PI * 2 && !deep; a += 0.05) {
      const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r)
      if (waterDepthAt(x, z) > 2) deep = { x, z }
    }
    expect(deep).not.toBeNull()
    resetRuntime(deep!)
    const state = createAvatarController(playerRT)
    stepAvatarController(playerRT, "explorer", state, tuning, 1 / 60)
    const waterline = waterSurfaceAt(deep!.x, deep!.z)! - tuning.floatDraft
    expect(state.loco.water).toBe("swim")
    expect(playerRT.pos.y).toBeCloseTo(waterline, 4)
    selectAvatar("companion")
    for (let i = 0; i < 60; i++) stepAvatarController(playerRT, "explorer", state, tuning, 1 / 60)
    expect(state.loco.water).toBe("swim")
    expect(playerRT.pos.y).toBeCloseTo(waterline, 4)
  })

  it("retains an inactive body's standable support when its streamed chunk unloads", () => {
    nearbyWorldColliders.push({ x: 0, z: 22.5, r: 1, height: 1, top: 1, standable: true })
    playerRT.pos.y = 1
    const state = createAvatarController(playerRT)
    stepAvatarController(playerRT, "explorer", state, tuning, 1 / 60)
    expect(state.loco.support).toBe(1)
    expect(avatarFootGround(playerRT, state, 0.1, 22.5)).toBeCloseTo(0, 5)
    selectAvatar("companion")
    nearbyWorldColliders.length = 0
    for (let i = 0; i < 180; i++) stepAvatarController(playerRT, "explorer", state, tuning, 1 / 60)
    expect(playerRT.pos.y).toBeCloseTo(1, 5)
    expect(playerRT.jumpPhase).toBe("grounded")
    expect(state.streamed.length).toBe(1)
    expect(avatarFootGround(playerRT, state, -0.1, 22.5)).toBeCloseTo(0, 5)
  })

  it("blocks switches through intro, cards, performances, rides and finale", () => {
    const game = useGame.getState()
    expect(canSwitchCharacter(game)).toBe(true)
    worldRT.introActive = true
    expect(canSwitchCharacter(game)).toBe(false)
    worldRT.introActive = false
    expect(canSwitchCharacter({ ...game, activeMemoryId: "first-steps" })).toBe(false)
    expect(canSwitchCharacter({ ...game, activeSecretId: "secret" })).toBe(false)
    worldRT.performingMemoryId = "training-corner"
    expect(canSwitchCharacter(game)).toBe(false)
    worldRT.performingMemoryId = null
    playerRT.gesture = "ride"
    playerRT.rideY = 10
    expect(canSwitchCharacter(game)).toBe(false)
    playerRT.gesture = "none"
    playerRT.rideY = null
    worldRT.finaleActive = true
    expect(canSwitchCharacter(game)).toBe(false)
  })

  it("leaves discoveries, saved progress and deterministic generation intact", () => {
    const id = "find:avatar-switch-regression"
    markFound(id)
    useGame.setState({ visited: { "first-steps": true }, visitOrder: ["first-steps"], stars: 1 })
    const before = generateChunk(28, -15)
    for (let i = 0; i < 50; i++) selectAvatar(i % 2 ? "explorer" : "companion")
    const after = generateChunk(28, -15)
    expect(discoveryRT.found.has(id)).toBe(true)
    expect(useGame.getState().visitOrder).toEqual(["first-steps"])
    expect(useGame.getState().stars).toBe(1)
    expect(after.heights).toEqual(before.heights)
    expect(after.scatter).toEqual(before.scatter)
    discoveryRT.found.delete(id)
  })

  it("teleports the party while maintaining ownership and resets a new journey to the explorer", () => {
    characterRT.companionPresent = true
    selectAvatar("companion")
    companionRT.paused = true
    companionRT.gesture = "ride"
    resetRuntime({ x: 2200, z: -1400 })
    expect(avatarRT().pos.toArray()).toEqual([2200, 0, -1400])
    expect(companionRT.paused).toBe(false)
    expect(companionRT.gesture).toBe("none")
    expect(catRT.pos.distanceTo(playerRT.pos)).toBeLessThan(2)
    resetCharactersForJourney()
    expect(avatarRT()).toBe(playerRT)
    expect(characterRT.companionPresent).toBe(false)
  })
})
