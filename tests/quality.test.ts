import { afterEach, describe, expect, it, vi } from "vitest"
import { renderDpr } from "../src/state/qualityStore"

afterEach(() => vi.unstubAllGlobals())
describe("render resolution", () => {
  it.each([0.75, 1])("keeps a display scale of %s", scale => {
    expect(renderDpr(scale)).toBe(scale)
  })
  it.each([1.25, 1.35, 1.5, 2, 3])("renders the 3D view at one pixel per CSS pixel on a %s screen", scale => {
    expect(renderDpr(scale)).toBe(1)
  })
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("handles invalid display scales %s", scale => {
    expect(renderDpr(scale)).toBe(1)
  })
  it("defaults to high detail without an automatic downgrade", async () => {
    vi.resetModules()
    vi.stubGlobal("localStorage", { getItem: () => null })
    const { useQuality } = await import("../src/state/qualityStore")
    expect(useQuality.getState()).toMatchObject({ mode: "high", level: "high" })
  })
})
