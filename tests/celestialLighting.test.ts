import { describe, expect, it } from "vitest"
import { Vector3 } from "three"
import { keyLightDirection, moonPosition, nightBlend, skyLightLevel, solarVisibility, sunDirection } from "../src/game/environment/celestialLighting"

describe("coherent day and night illumination", () => {
  it("removes solar glow at night and dims overcast moonlight", () => {
    expect(solarVisibility(1)).toBe(0)
    expect(solarVisibility(0.92)).toBe(0)
    expect(solarVisibility(0.28)).toBe(1)
    const clearNight = skyLightLevel(1, 0.05, 0)
    expect(clearNight).toBeGreaterThan(0)
    expect(clearNight).toBeLessThan(skyLightLevel(0.28, 0.05, 0) * 0.05)
    expect(skyLightLevel(1, 1, 0.8)).toBeLessThan(clearNight * 0.5)
  })

  it("casts light and reflections from the visible moon, not the departed sun", () => {
    const key = keyLightDirection(1, new Vector3())
    const moon = moonPosition(1, new Vector3()).normalize()
    expect(key.distanceTo(moon)).toBeLessThan(1e-6)
    const daylight = keyLightDirection(0.28, new Vector3())
    expect(daylight.distanceTo(sunDirection(0.28, new Vector3()))).toBeLessThan(1e-6)
  })

  it("crosses twilight smoothly without a zero or downward light direction", () => {
    let previous = keyLightDirection(0, new Vector3())
    for (let step = 1; step <= 1000; step++) {
      const time = step / 1000
      const direction = keyLightDirection(time, new Vector3())
      expect(direction.length()).toBeCloseTo(1, 6)
      expect(direction.y).toBeGreaterThan(0)
      expect(direction.distanceTo(previous)).toBeLessThan(0.08)
      expect(nightBlend(time)).toBeGreaterThanOrEqual(nightBlend(time - 0.001))
      previous = direction
    }
  })
})
