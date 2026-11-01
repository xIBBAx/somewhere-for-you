import { beforeEach, describe, expect, it } from "vitest"
import { ActionMoments, coupleMoments } from "../src/game/together/actionMoments"
import { coupleChoreography } from "../src/game/together/Together"
import { togetherRT } from "../src/game/together/togetherState"
import { useAdventures } from "../src/state/adventureStore"
import { companionRT, playerRT } from "../src/game/runtime"

/** Frame clocks: steady rates, a stuttering one and long hitches. */
const clocks: Record<string, (i: number) => number> = {
  "15 fps": () => 1 / 15,
  "30 fps": () => 1 / 30,
  "60 fps": () => 1 / 60,
  "120 fps": () => 1 / 120,
  "240 fps": () => 1 / 240,
  "variable": (i) => [1 / 144, 1 / 30, 1 / 90, 0.1, 1 / 60, 1 / 240][i % 6],
  "hitch": (i) => (i % 7 === 3 ? 0.1 : 1 / 75),
}

describe("ActionMoments", () => {
  it.each(Object.keys(clocks))("fires exactly once per action at %s", (name) => {
    const m = new ActionMoments()
    let t = 0, fired = 0
    for (let i = 0; t < 3; i++) {
      t += Math.min(clocks[name](i), 0.1) // Together clamps dt to 0.1 s
      if (m.once("clap", t, 0.55)) fired++
    }
    expect(fired).toBe(1)
  })

  it("does not fire when the action ends before the moment, and fires again for the next action", () => {
    const m = new ActionMoments()
    expect(m.once("clap", 0.3, 0.55)).toBe(false)
    m.reset()
    expect(m.once("clap", 0.6, 0.55)).toBe(true)
    expect(m.once("clap", 0.7, 0.55)).toBe(false)
    m.reset()
    expect(m.once("clap", 0.56, 0.55)).toBe(true)
  })

  it("survives the action clock being held at zero while the partner walks in", () => {
    const m = new ActionMoments()
    let fired = 0
    const times = [0, 0, 0, 0.2, 0.4, 0, 0.3, 0.6, 0.9] // reset to 0 on a late approach
    for (const t of times) if (m.once("hug", t, 0.75)) fired++
    expect(fired).toBe(1)
  })
})

describe("hug and high-five choreography", () => {
  const pr = togetherRT.pose
  beforeEach(() => {
    playerRT.pos.set(0, 0, 0)
    companionRT.pos.set(0, 0, 0.95)
    playerRT.facing = 0
    companionRT.facing = Math.PI
    useAdventures.setState({ records: { ...useAdventures.getState().records, highFives: 0, hugs: 0 } })
    togetherRT.stats.highFives = togetherRT.stats.hugs = 0
  })

  it.each(Object.keys(clocks))("one clap, one saved high five at %s", (name) => {
    coupleMoments.reset()
    togetherRT.action = "highFive"
    let t = 0
    for (let i = 0; t < 1.45; i++) {
      t += Math.min(clocks[name](i), 0.1)
      coupleChoreography.highFive(Math.min(t, 1.45), pr)
    }
    expect(togetherRT.stats.highFives).toBe(1)
    expect(useAdventures.getState().records.highFives).toBe(1)
  })

  it.each(Object.keys(clocks))("one squeeze, one saved hug at %s", (name) => {
    coupleMoments.reset()
    togetherRT.action = "hug"
    let t = 0
    for (let i = 0; t < 3.5; i++) {
      t += Math.min(clocks[name](i), 0.1)
      coupleChoreography.hug(Math.min(t, 3.5), pr)
    }
    expect(togetherRT.stats.hugs).toBe(1)
    expect(useAdventures.getState().records.hugs).toBe(1)
  })

  it("unlocks the Perfect High Five page through ordinary play", () => {
    useAdventures.setState({ unlocked: useAdventures.getState().unlocked.filter((id) => id !== "perfectFive") })
    coupleMoments.reset()
    for (let t = 0; t < 1.4; t += 1 / 60) coupleChoreography.highFive(t, pr)
    expect(useAdventures.getState().unlocked).toContain("perfectFive")
  })
})
