import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { initInput, resetInputControls, subscribeInputReset, resolveKeyAction, pegasusLandingControl } from "../src/game/input"
import { clearInputActions, input, pushAction, takeAction } from "../src/game/runtime"
import { horseRT, makeHorseState } from "../src/game/horses/horseState"
import { makeIdentity } from "../src/game/horses/breeds"
import { flightOf } from "../src/game/pegasus/flight"
import { characterRT } from "../src/game/runtime"
import { useControlsUI } from "../src/ui/ControlsGuide"
import { useExplorationUI } from "../src/state/explorationUIStore"

class Element extends EventTarget { isContentEditable = false }
class Button extends Element {}
class TextInput extends Element {}
class TextArea extends Element {}
class Select extends Element {}
class Canvas extends Element {}

type KeyOptions = {
  type?: "keydown" | "keyup"
  repeat?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  target?: EventTarget
}

let win: EventTarget
let doc: EventTarget & {
  hidden: boolean
  activeElement: Element | null
  pointerLockElement: Element | null
  body: Element
  querySelector: ReturnType<typeof vi.fn>
  exitPointerLock: ReturnType<typeof vi.fn>
}
let cleanup: () => void
let storage: Map<string, string>

const key = (code: string, options: KeyOptions = {}): Event => {
  const event = new Event(options.type ?? "keydown", { cancelable: true })
  const descriptors: PropertyDescriptorMap = {}
  for (const [name, value] of Object.entries({ code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...options })) {
    if (name !== "type") descriptors[name] = { value }
  }
  Object.defineProperties(event, descriptors)
  win.dispatchEvent(event)
  return event
}

const expectReleased = (): void => {
  expect(input.move).toEqual({ x: 0, y: 0 })
  expect([input.sprint, input.ascend, input.descend, input.jump, input.interact, input.cancel, input.call, input.switchCharacter]).toEqual(Array(8).fill(false))
  expect(input.actions).toEqual([])
}

beforeEach(() => {
  win = new EventTarget()
  doc = Object.assign(new EventTarget(), {
    hidden: false, activeElement: null, pointerLockElement: null, body: new Element(),
    querySelector: vi.fn(() => null), exitPointerLock: vi.fn(),
  })
  storage = new Map()
  vi.stubGlobal("window", win)
  vi.stubGlobal("document", doc)
  vi.stubGlobal("HTMLElement", Element)
  vi.stubGlobal("HTMLButtonElement", Button)
  vi.stubGlobal("HTMLInputElement", TextInput)
  vi.stubGlobal("HTMLTextAreaElement", TextArea)
  vi.stubGlobal("HTMLSelectElement", Select)
  vi.stubGlobal("HTMLCanvasElement", Canvas)
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => storage.get(name) ?? null,
    setItem: (name: string, value: string) => storage.set(name, value),
  })
  useExplorationUI.setState({ mode: "minimal", panel: null })
  clearInputActions()
  cleanup = initInput()
})

afterEach(() => {
  cleanup()
  useExplorationUI.setState({ mode: "minimal", panel: null })
  vi.unstubAllGlobals()
})

describe("exploration presentation and held-control recovery", () => {
  it("releases held movement, run and flight keys when F2 changes mode", () => {
    for (const code of ["KeyW", "KeyD", "ShiftLeft", "Space", "KeyC"]) key(code)
    pushAction("homeward")
    key("KeyQ")

    expect(key("F2").defaultPrevented).toBe(true)
    expect(useExplorationUI.getState().mode).toBe("immersive")
    expectReleased()

    // Releasing an unrelated key cannot revive a control whose UI disappeared.
    key("KeyQ", { type: "keyup" })
    expectReleased()
    key("KeyA")
    expect(input.move).toEqual({ x: -1, y: 0 })
  })

  it("clears keyboard movement, held flight and queued actions when a panel opens", () => {
    for (const code of ["KeyW", "ShiftLeft", "Space", "KeyC", "KeyE", "KeyQ", "KeyP", "KeyM"]) key(code)
    expect(input.move.y).toBe(-1)
    expect(input.ascend && input.descend && input.sprint).toBe(true)
    expect(input.actions).toEqual(expect.arrayContaining(["photo", "starChart"]))

    useExplorationUI.getState().open("atlas")
    expectReleased()
    useExplorationUI.getState().open(null)
    key("KeyA")
    expect(input.move).toEqual({ x: -1, y: 0 })
    expect([input.ascend, input.descend, input.sprint]).toEqual([false, false, false])
    key("KeyQ")
    expect(input.switchCharacter).toBe(true)
  })

  it("opens the controls guide through the shared panel and releases held input", () => {
    for (const code of ["KeyW", "ShiftLeft", "Space"]) key(code)
    key("KeyP")
    useControlsUI.getState().openGuide(true)
    expect(useExplorationUI.getState().panel).toBe("controls")
    expectReleased()
    for (const code of ["KeyW", "Space", "KeyI", "KeyN", "Slash"]) key(code)
    expectReleased()
    expect(key("Escape").defaultPrevented).toBe(true)
    expect(useExplorationUI.getState().panel).toBeNull()
    expectReleased()
    key("KeyW")
    expect(input.move.y).toBe(-1)
  })

  it("releases keyboard and private pointer state when a modal takes focus", () => {
    const pointer = { held: true }
    const unsubscribe = subscribeInputReset(() => { pointer.held = false })
    try {
      for (const code of ["KeyW", "Space", "ShiftLeft", "KeyC", "KeyM"]) key(code)
      // useDialogFocus calls this when picker/chart/book/cards open, so there
      // is no reliance on a later key release hitting a now-hidden button.
      resetInputControls()
      expectReleased()
      expect(pointer.held).toBe(false)
      key("KeyM", { type: "keyup" })
      expectReleased()
      key("KeyW")
      expect(input.move.y).toBe(-1)
      expect(input.ascend || input.descend || input.sprint).toBe(false)
    } finally { unsubscribe() }
  })

  it("persists a mode choice, closes its panel and tolerates unavailable storage", () => {
    useExplorationUI.getState().open("sky")
    useExplorationUI.getState().setMode("immersive")
    expect(storage.get("gift-world.exploration-ui.v1")).toBe("immersive")
    expect(useExplorationUI.getState().panel).toBeNull()
    vi.stubGlobal("localStorage", { setItem: () => { throw new Error("storage blocked") } })
    expect(() => useExplorationUI.getState().toggleMode()).not.toThrow()
    expect(useExplorationUI.getState().mode).toBe("minimal")
  })

  it("restores the chosen presentation after reload without reopening a transient panel", async () => {
    useExplorationUI.getState().setMode("immersive")
    useExplorationUI.getState().open("atlas")
    vi.resetModules()
    const { useExplorationUI: reloaded } = await import("../src/state/explorationUIStore")
    expect(reloaded.getState().mode).toBe("immersive")
    expect(reloaded.getState().panel).toBeNull()
  })
})

describe("intentional F2 and panel keyboard handling", () => {
  it.each(["ctrlKey", "metaKey", "altKey", "shiftKey"] as const)("leaves %s+F2 available without changing presentation", modifier => {
    expect(key("F2", { [modifier]: true }).defaultPrevented).toBe(false)
    expect(useExplorationUI.getState().mode).toBe("minimal")
  })

  it("does not toggle again on a repeated F2 event", () => {
    key("F2")
    key("F2", { repeat: true })
    expect(useExplorationUI.getState().mode).toBe("immersive")
    key("F2", { type: "keyup" })
    key("F2")
    expect(useExplorationUI.getState().mode).toBe("minimal")
  })

  it.each([
    ["text input", () => new TextInput()],
    ["text area", () => new TextArea()],
    ["select", () => new Select()],
    ["content editor", () => Object.assign(new Element(), { isContentEditable: true })],
  ] as const)("does not steal F2 from a %s", (_name, create) => {
    expect(key("F2", { target: create() }).defaultPrevented).toBe(false)
    expect(useExplorationUI.getState().mode).toBe("minimal")
  })

  it("keeps F2 inside a modal dialog from changing the scene presentation", () => {
    doc.querySelector.mockReturnValue(new Element())
    expect(key("F2").defaultPrevented).toBe(false)
    expect(useExplorationUI.getState().mode).toBe("minimal")
    expect(doc.querySelector).toHaveBeenCalledWith('[role="dialog"][aria-modal="true"]')
  })

  it("ignores gameplay keys while a panel is open, then Escape closes it without cancellation", () => {
    useExplorationUI.getState().open("together")
    doc.pointerLockElement = new Canvas()
    for (const code of ["KeyW", "Space", "KeyC", "ShiftLeft", "KeyE", "KeyQ", "KeyP", "KeyM", "KeyN", "KeyK", "Tab"]) key(code)
    expectReleased()
    expect(key("Escape").defaultPrevented).toBe(true)
    expect(useExplorationUI.getState().panel).toBeNull()
    expect(input.cancel).toBe(false)
    expect(doc.exitPointerLock).not.toHaveBeenCalled()
    key("KeyW")
    expect(input.move.y).toBe(-1)
    expect(input.ascend).toBe(false)
  })

  it("keeps gameplay actions out of modal dialogs while preserving native button and close keys", () => {
    const horse = makeHorseState(makeIdentity(1704, "ivory"), 0, 0, true)
    flightOf(horse)!.mode = "air"
    horse.rider = characterRT.active
    horseRT.horses.set(horse.ident.id, horse)
    doc.querySelector.mockReturnValue(new Element())
    doc.activeElement = new Button()
    try {
      for (const code of ["KeyR", "KeyH", "KeyG", "KeyF", "KeyV", "KeyT", "KeyP", "KeyL", "KeyX", "KeyB", "KeyY", "KeyU", "KeyI", "KeyZ", "KeyM", "KeyN", "KeyK", "KeyO", "Slash", "KeyW", "KeyC", "KeyQ"]) key(code)
      expectReleased()
      // The dialog's focused button can still receive browser-native activation
      // and its close/focus handlers can handle Escape and Tab themselves.
      for (const code of ["Space", "Enter", "Escape", "Tab"]) expect(key(code).defaultPrevented, code).toBe(false)
      expectReleased()
      doc.querySelector.mockReturnValue(null)
      doc.activeElement = null
      key("KeyR")
      expect(takeAction("landGallop")).toBe(true)
      expect(takeAction("race")).toBe(false)
    } finally { horseRT.horses.delete(horse.ident.id) }
  })

  it("retains normal movement, camera cycling and action controls without a panel", () => {
    key("KeyW")
    key("ShiftLeft")
    expect(input.move.y).toBe(-1)
    expect(input.sprint).toBe(true)
    key("ShiftLeft", { type: "keyup" })
    expect(input.sprint).toBe(false)
    key("KeyP")
    expect(takeAction("photo")).toBe(true)
    expect(key("Tab").defaultPrevented).toBe(true)
    expect(takeAction("cameraView")).toBe(true)
    key("Tab", { type: "keyup" })
    key("Tab", { shiftKey: true })
    expect(takeAction("cameraViewBack")).toBe(true)
    key("KeyE")
    expect(input.interact).toBe(true)
    key("KeyQ")
    expect(input.switchCharacter).toBe(true)
    doc.pointerLockElement = new Canvas()
    key("Escape")
    expect(input.cancel).toBe(true)
    expect(doc.exitPointerLock).toHaveBeenCalledOnce()
  })
})

describe("R retains racing and gains a Pegasus landing action", () => {
  it.each([undefined, null, { mode: "ground" }, { mode: "sail" }])("retains race outside airborne Pegasus or its landing run (%j)", flight => {
    expect(resolveKeyAction("KeyR", flight)).toBe("race")
  })
  it.each(["takeoff", "air", "landing"] as const)("routes a real keyboard press to the active Pegasus in %s", mode => {
    const horse = makeHorseState(makeIdentity(1701, "ivory"), 0, 0, true)
    const flight = flightOf(horse)!
    flight.mode = mode
    horse.rider = characterRT.active
    horseRT.horses.set(horse.ident.id, horse)
    try {
      key("KeyR")
      expect(takeAction("landGallop")).toBe(true)
      expect(takeAction("race")).toBe(false)
      key("KeyR", { repeat: true })
      expect(takeAction("landGallop")).toBe(false)
    } finally { horseRT.horses.delete(horse.ident.id) }
  })
  it("maps the active tandem passenger and continuing ground gallop, then restores ordinary R", () => {
    const horse = makeHorseState(makeIdentity(1702, "starborn"), 0, 0, true)
    const flight = flightOf(horse)!
    Object.assign(flight, { landing: { style: "gallop", run: true } })
    horse.passenger = characterRT.active
    horseRT.horses.set(horse.ident.id, horse)
    try {
      key("KeyR")
      expect(takeAction("landGallop")).toBe(true)
      key("KeyR", { type: "keyup" })
      horse.passenger = null
      key("KeyR")
      expect(takeAction("race")).toBe(true)
    } finally { horseRT.horses.delete(horse.ident.id) }
  })
  it("keeps race on an ordinary horse and does not steal modified R or menu keys", () => {
    const horse = makeHorseState(makeIdentity(1703, "arabian"), 0, 0, true)
    horse.rider = characterRT.active
    horseRT.horses.set(horse.ident.id, horse)
    try {
      key("KeyR", { ctrlKey: true })
      expect(input.actions).toEqual([])
      key("KeyR", { type: "keyup" })
      key("KeyR")
      expect(takeAction("race")).toBe(true)
      key("KeyR", { type: "keyup" })
      useExplorationUI.getState().open("controls")
      key("KeyR")
      expect(input.actions).toEqual([])
    } finally { horseRT.horses.delete(horse.ident.id) }
  })
  it("uses the physical S press to stop landing autorun even while W is held", () => {
    const horse = makeHorseState(makeIdentity(1705, "ivory"), 0, 0, true)
    const flight = flightOf(horse)!
    Object.assign(flight, { landing: { style: "gallop", run: true } })
    horse.rider = characterRT.active
    horseRT.horses.set(horse.ident.id, horse)
    try {
      key("KeyW")
      key("KeyS")
      expect(input.move.y).toBe(0)
      expect(takeAction("landGallop")).toBe(true)
      expect(takeAction("race")).toBe(false)
      key("KeyS", { type: "keyup" })
      flight.landing.run = false
      key("KeyS")
      expect(input.actions).toEqual([])
      expect(resolveKeyAction("KeyS", { mode: "air" })).toBeUndefined()
      expect(resolveKeyAction("KeyS", null)).toBeUndefined()
    } finally { horseRT.horses.delete(horse.ident.id) }
  })

  it("distinguishes the cancelable approach, slow latch, and journey exclusion", () => {
    const flight = { mode: "landing", landing: { style: "gallop" as const, requested: true } }
    expect(pegasusLandingControl(flight)).toBe("keepFlying")
    expect(resolveKeyAction("KeyR", flight)).toBe("landGallop")
    expect(resolveKeyAction("KeyR", flight, true)).toBe("race")
    expect(pegasusLandingControl({ mode: "ground", landing: { run: true } })).toBe("slow")
  })
})
