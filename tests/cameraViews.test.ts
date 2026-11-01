import { describe, expect, it } from "vitest"
import { CAMERA_VIEWS, VIEW_ORDER, framingAt, nearestView, nextView } from "../src/game/camera/cameraViews"
import { CAMERA_CONFIG } from "../src/game/camera/FollowCamera"

describe("the three camera views", () => {
  it("are ordered far to close, every one inside the hand zoom's range", () => {
    expect(CAMERA_VIEWS.far.distance).toBeGreaterThan(CAMERA_VIEWS.medium.distance)
    expect(CAMERA_VIEWS.medium.distance).toBeGreaterThan(CAMERA_VIEWS.close.distance)
    for (const v of VIEW_ORDER) {
      expect(CAMERA_VIEWS[v].distance).toBeGreaterThanOrEqual(CAMERA_CONFIG.minDistance)
      expect(CAMERA_VIEWS[v].distance).toBeLessThanOrEqual(CAMERA_CONFIG.maxDistance)
    }
  })

  it("makes Close genuinely close: the frame at the figure is about hip to head", () => {
    const d = CAMERA_VIEWS.close.distance
    const span = 2 * d * Math.tan((framingAt(d).fov / 2) * Math.PI / 180)
    expect(span).toBeLessThan(1.5)
    expect(span).toBeGreaterThan(1.0)
  })

  it("keeps Far close enough that the figure is not lost (the old 13 m default was)", () => {
    expect(CAMERA_VIEWS.far.distance).toBeLessThan(10)
  })

  it("cycles Far, Medium, Close and round again, from wherever a hand zoom left the boom", () => {
    expect(nextView(CAMERA_VIEWS.far.distance)).toBe("medium")
    expect(nextView(CAMERA_VIEWS.medium.distance)).toBe("close")
    expect(nextView(CAMERA_VIEWS.close.distance)).toBe("far")
    expect(nextView(CAMERA_VIEWS.close.distance, -1)).toBe("medium")
    expect(nextView(CAMERA_VIEWS.far.distance, -1)).toBe("close")
    expect(nearestView(13)).toBe("far")
    expect(nearestView(3.4)).toBe("close")
    expect(nearestView(4.2)).toBe("medium")
  })

  it("frames continuously: nearer means a higher pivot, more shoulder, never a jump", () => {
    let prev = framingAt(CAMERA_CONFIG.minDistance)
    for (let d = CAMERA_CONFIG.minDistance + 0.05; d <= 14; d += 0.05) {
      const f = framingAt(d)
      expect(f.pivot).toBeLessThanOrEqual(prev.pivot + 1e-9)
      expect(f.shoulder).toBeLessThanOrEqual(prev.shoulder + 1e-9)
      expect(Math.abs(f.pivot - prev.pivot)).toBeLessThan(0.02)
      expect(Math.abs(f.fov - prev.fov)).toBeLessThan(0.1)
      prev = f
    }
    expect(framingAt(CAMERA_VIEWS.far.distance).shoulder).toBe(0)
    // a mount's or the wings' extra length: kept whole far out, trimmed close in
    expect(framingAt(CAMERA_VIEWS.far.distance).extra).toBe(1)
    expect(framingAt(CAMERA_VIEWS.close.distance).extra).toBeLessThan(0.7)
  })
})
