import { afterEach, describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { PlanetTravel } from "../src/ui/PlanetTravel"
import { travelCommands, useTravel } from "../src/state/travelStore"

// SSR normally reads Zustand's initial snapshot; render the deliberate live
// picker state here so the row handoff can be verified without a DOM emulator.
vi.mock("../src/state/travelStore", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/state/travelStore")>()
  return { ...actual, useTravel: Object.assign((selector: (state: ReturnType<typeof actual.useTravel.getState>) => unknown) => selector(actual.useTravel.getState()), actual.useTravel) }
})

const original = useTravel.getState()
afterEach(() => { useTravel.setState(original); travelCommands.go = null })

describe("atlas destination picker handoff", () => {
  it("highlights the body requested by the atlas without starting a journey", () => {
    useTravel.getState().setPicker(true, "sun")
    expect(useTravel.getState().pickerBodyId).toBe("sun")
    expect(travelCommands.go).toBeNull()
    const markup = renderToStaticMarkup(createElement(PlanetTravel))
    expect(markup).toMatch(/<li[^>]*data-travel-body="sun"[^>]*aria-current="true"[^>]*class="[^"]*is-selected/)
    expect(markup).toContain("Selected destination")
    expect(markup).toContain('aria-label="Journey to The Sun"')
    expect(travelCommands.go).toBeNull()
  })
  it("allows a new atlas body to replace the focus while the picker is already open", () => {
    useTravel.getState().setPicker(true, "mars")
    useTravel.getState().setPicker(true, "saturn")
    expect(useTravel.getState()).toMatchObject({ pickerOpen: true, pickerBodyId: "saturn" })
    expect(travelCommands.go).toBeNull()
  })
  it("forgets the transient focus on close and on ordinary N/menu opening", () => {
    useTravel.getState().setPicker(true, "sun")
    useTravel.getState().setPicker(false)
    expect(useTravel.getState()).toMatchObject({ pickerOpen: false, pickerBodyId: null })
    useTravel.getState().setPicker(true, "saturn")
    useTravel.getState().setPicker(true)
    expect(useTravel.getState()).toMatchObject({ pickerOpen: true, pickerBodyId: null })
  })
})
