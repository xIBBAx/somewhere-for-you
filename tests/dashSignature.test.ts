import { describe, expect, it } from "vitest"
import { SKILLS } from "../src/game/pegasus/skills"
import { densityScale, motionScale, nearCameraFade, onsetPunch, ringFade, ringGrowth, strokeCrossed, dashGain, DOWNSTROKE_AT } from "../src/game/pegasus/dashSignature"

describe("dash signature timing", () => {
  it("gives every Pegasus its own, distinct dash signature", () => {
    expect(SKILLS.ivory.signature).toBe("swift")
    expect(SKILLS.onyx.signature).toBe("thunder")
    expect(SKILLS.starborn.signature).toBe("starfall")
    expect(new Set(Object.values(SKILLS).map((s) => s.signature)).size).toBe(3)
  })

  it("catches the downstroke when the phase passes its mark going forward", () => {
    expect(strokeCrossed(0.5, 0.6)).toBe(true)
    expect(strokeCrossed(0.6, 0.7)).toBe(false)
    expect(strokeCrossed(DOWNSTROKE_AT - 0.01, DOWNSTROKE_AT + 0.01)).toBe(true)
  })

  it("catches the mark across the 0..1 wrap and never on a still wing", () => {
    expect(strokeCrossed(0.5, 0.05)).toBe(true)
    expect(strokeCrossed(0.9, 0.1)).toBe(false)
    expect(strokeCrossed(0.54, 0.54)).toBe(false)
    expect(strokeCrossed(0.95, 0.05)).toBe(false)
  })

  it("decays the onset impulse to a twentieth by 0.6 s", () => {
    expect(onsetPunch(0)).toBe(1)
    expect(onsetPunch(0.6)).toBeLessThan(0.06)
    expect(onsetPunch(0.3)).toBeGreaterThan(onsetPunch(0.6))
  })

  it("grows rings fast then slowly, and fades them in without a pop", () => {
    expect(ringGrowth(0)).toBe(0)
    expect(ringGrowth(1)).toBe(1)
    expect(ringGrowth(0.5) - ringGrowth(0)).toBeGreaterThan(ringGrowth(1) - ringGrowth(0.5))
    expect(ringFade(0)).toBe(0)
    expect(ringFade(1)).toBe(0)
    expect(ringFade(0.2)).toBeGreaterThan(0.5)
  })

  it("falls off with distance to silence and keeps the near sound", () => {
    expect(dashGain(0, 140)).toBe(1)
    expect(dashGain(140, 140)).toBe(0)
    expect(dashGain(60, 140)).toBeGreaterThan(0)
  })

  it("scales effects down by quality and reduced motion, and never to nothing on high", () => {
    expect(densityScale("high", false)).toBe(1)
    expect(densityScale("low", false)).toBeLessThan(densityScale("medium", false))
    expect(densityScale("high", true)).toBe(0.5)
    expect(motionScale(true)).toBeLessThan(motionScale(false))
    expect(densityScale("low", true)).toBeGreaterThan(0)
  })

  it("fades sparks as they near the chase camera", () => {
    expect(nearCameraFade(1)).toBe(0)
    expect(nearCameraFade(10)).toBe(1)
    expect(nearCameraFade(4.5)).toBeGreaterThan(0)
    expect(nearCameraFade(4.5)).toBeLessThan(1)
  })
})
