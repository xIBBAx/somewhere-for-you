import { describe, expect, it } from "vitest"
import { IDLE_BEHAVIORS, catNextState, pickIdleBehavior } from "../src/game/characters/catBrain"

const ctx = (over: Partial<Parameters<typeof catNextState>[1]> = {}) => ({
  distToPlayer: 1.5,
  playerMoving: false,
  playerIdleTime: 0,
  hasPoi: false,
  finale: false,
  atPoi: false,
  affectionReady: false,
  atAffectionSpot: false,
  affectionComplete: false,
  ...over,
})

describe("catNextState", () => {
  it("follows when the explorer walks away", () => {
    expect(catNextState("sit", ctx({ playerMoving: true }))).toBe("follow")
    expect(catNextState("follow", ctx({ playerMoving: true }))).toBe("follow")
  })

  it("catches up when left behind", () => {
    expect(catNextState("follow", ctx({ distToPlayer: 8 }))).toBe("catchup")
    expect(catNextState("catchup", ctx({ distToPlayer: 8 }))).toBe("catchup")
    expect(catNextState("catchup", ctx({ distToPlayer: 3 }))).toBe("follow")
  })

  it("sits when the explorer rests nearby", () => {
    expect(catNextState("follow", ctx({ distToPlayer: 1.2 }))).toBe("sit")
  })

  it("keeps resting until the explorer moves", () => {
    expect(catNextState("sleep", ctx({}))).toBe("sleep")
    expect(catNextState("stretch", ctx({}))).toBe("stretch")
    expect(catNextState("sit", ctx({ playerMoving: true }))).toBe("follow")
  })

  it("initiates a mutual affection moment while the explorer and the cat are idle", () => {
    expect(catNextState("sit", ctx({ playerIdleTime: 3, affectionReady: true }))).toBe(
      "affectionApproach",
    )
    expect(
      catNextState(
        "affectionApproach",
        ctx({ playerIdleTime: 4, affectionReady: true, atAffectionSpot: true }),
      ),
    ).toBe("affection")
    expect(catNextState("affection", ctx({ playerIdleTime: 5 }))).toBe("affection")
    expect(catNextState("affection", ctx({ playerIdleTime: 7, affectionComplete: true }))).toBe(
      "sit",
    )
  })

  it("interrupts affection as soon as the explorer moves", () => {
    expect(catNextState("affectionApproach", ctx({ playerMoving: true }))).toBe("follow")
    expect(catNextState("affection", ctx({ playerMoving: true }))).toBe("follow")
  })

  it("investigates points of interest and resumes following after", () => {
    expect(catNextState("follow", ctx({ hasPoi: true }))).toBe("investigate")
    expect(catNextState("investigate", ctx({ hasPoi: true, atPoi: false }))).toBe("investigate")
    expect(catNextState("investigate", ctx({ hasPoi: true, atPoi: true }))).toBe("sit")
    expect(catNextState("investigate", ctx({}))).toBe("follow")
  })

  it("runs ahead during the finale", () => {
    expect(catNextState("sleep", ctx({ finale: true }))).toBe("runAhead")
    expect(catNextState("runAhead", ctx({ finale: true }))).toBe("runAhead")
  })
})

describe("pickIdleBehavior", () => {
  it("prefers sleep only after a long idle", () => {
    expect(pickIdleBehavior(2, 0.1)).not.toBe("sleep")
    expect(pickIdleBehavior(20, 0.1)).toBe("sleep")
  })

  it("always returns a valid idle state", () => {
    for (const roll of [0, 0.3, 0.5, 0.75, 0.9, 0.99]) {
      expect(IDLE_BEHAVIORS).toContain(pickIdleBehavior(5, roll))
    }
  })
})

describe("companion communication", () => {
  it("bolts to the explorer when thunder startles her, then calms down", () => {
    expect(catNextState("sleep", ctx({ scared: true }))).toBe("scared")
    expect(catNextState("scared", ctx({ hasPoi: true }))).toBe("scared")
    expect(catNextState("scared", ctx({ scaredDone: true }))).toBe("follow")
  })

  it("comes running when called and weaves round the explorer's legs", () => {
    expect(catNextState("sit", ctx({ called: true }))).toBe("greet")
    expect(catNextState("greet", ctx({ distToPlayer: 4 }))).toBe("greet")
    expect(catNextState("greet", ctx({ distToPlayer: 0.6 }))).toBe("rub")
    expect(catNextState("rub", ctx({}))).toBe("rub")
    expect(catNextState("rub", ctx({ actionDone: true }))).toBe("sit")
    expect(catNextState("rub", ctx({ playerMoving: true }))).toBe("follow")
  })

  it("stays to be petted, then settles", () => {
    expect(catNextState("loaf", ctx({ petting: true }))).toBe("petted")
    expect(catNextState("petted", ctx({ petting: true }))).toBe("petted")
    expect(catNextState("petted", ctx({}))).toBe("sit")
  })

  it("finishes timed actions and gets up when the explorer walks on", () => {
    expect(catNextState("yawn", ctx({}))).toBe("yawn")
    expect(catNextState("yawn", ctx({ actionDone: true }))).toBe("sit")
    expect(catNextState("groom", ctx({ actionDone: true }))).toBe("groom")
    expect(catNextState("knead", ctx({ playerMoving: true }))).toBe("follow")
  })

  it("sometimes weaves instead of sitting when the explorer stops", () => {
    expect(catNextState("follow", ctx({ distToPlayer: 1.2, wantRub: true }))).toBe("rub")
  })
})
