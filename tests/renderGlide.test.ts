import { describe, expect, it } from "vitest"
import { glideTo, makeGlide } from "../src/utils/renderGlide"

/** Far animals step their simulation every 0.1–0.65 s; they must not be drawn jumping. */
describe("drawing a creature between its simulation steps", () => {
  it("moves every frame between steps and meets the next step without a jump", () => {
    const g = makeGlide()
    const speed = 1.4, heading = 0.6, period = 0.65, dt = 1 / 60
    let x = 0, z = 0, since = 0, maxJump = 0, prevX = 0, prevZ = 0
    glideTo(g, x, z, heading, speed, 0, 0, true, dt)
    for (let f = 0; f < 240; f++) {
      since += dt
      if (since >= period) {
        x += Math.sin(heading) * speed * since
        z += Math.cos(heading) * speed * since
        since = 0
      }
      glideTo(g, x, z, heading, speed, 0, since, false, dt)
      if (f > 0) maxJump = Math.max(maxJump, Math.hypot(g.x - prevX, g.z - prevZ))
      prevX = g.x
      prevZ = g.z
    }
    // a steady walk: the same small stride every frame, never a 0.9 m step
    expect(maxJump).toBeLessThan(speed * dt * 1.6)
  })

  it("is exactly where the creature is when simulated every frame", () => {
    const g = makeGlide()
    glideTo(g, 3, 4, 0, 0, 0, 0, true, 1 / 60)
    glideTo(g, 5, 4, 1, 2, 0, 0, true, 1 / 60)
    expect([g.x, g.z, g.heading]).toEqual([5, 4, 1])
  })
})
