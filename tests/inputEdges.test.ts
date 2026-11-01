import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { initInput } from "../src/game/input"
import { cameraRT, clearInputActions, input, takeAction, worldRT } from "../src/game/runtime"

let win: EventTarget
let doc: EventTarget & { hidden: boolean; activeElement: null; pointerLockElement: null }
let cleanup: () => void

beforeEach(() => {
  win = new EventTarget()
  doc = Object.assign(new EventTarget(), { hidden: false, activeElement: null, pointerLockElement: null })
  vi.stubGlobal("window", win)
  vi.stubGlobal("document", doc)
  vi.stubGlobal("HTMLElement", class {})
  vi.stubGlobal("HTMLButtonElement", class {})
  vi.stubGlobal("HTMLInputElement", class {})
  vi.stubGlobal("HTMLTextAreaElement", class {})
  vi.stubGlobal("HTMLSelectElement", class {})
  clearInputActions()
  cameraRT.photo = false
  worldRT.introActive = false
  cleanup = initInput()
})
afterEach(() => { cleanup(); cameraRT.photo = false; worldRT.introActive = false; vi.unstubAllGlobals() })

const key = (code: string, type = "keydown", repeat = false, modifiers: Record<string, boolean> = {}): Event => {
  const event = new Event(type, { cancelable: true })
  Object.defineProperties(event, { code: { value: code }, repeat: { value: repeat }, ...Object.fromEntries(Object.entries(modifiers).map(([name, value]) => [name, { value }])) })
  win.dispatchEvent(event)
  return event
}

describe("intentional input edges and focus reset", () => {
  it.each(["ctrlKey", "metaKey", "altKey"])("leaves %s shortcuts to the browser without moving or jumping", modifier => {
    for (const code of ["KeyW", "ArrowRight", "Space", "KeyE", "KeyQ", "KeyP"]) key(code, "keydown", false, { [modifier]: true })
    expect(input.move).toEqual({ x: 0, y: 0 })
    expect([input.jump, input.interact, input.switchCharacter]).toEqual([false, false, false])
    expect(input.actions).toEqual([])
  })

  it("keeps intro keys out of gameplay while preserving native button activation", () => {
    worldRT.introActive = true
    for (const code of ["KeyW", "Space", "Enter", "KeyQ", "KeyP"]) expect(key(code).defaultPrevented).toBe(false)
    expect(input.move).toEqual({ x: 0, y: 0 })
    expect([input.jump, input.interact, input.switchCharacter]).toEqual([false, false, false])
    expect(input.actions).toEqual([])
  })

  it("lets photo mode own movement, Space, Enter and Tab, while P can close it", () => {
    cameraRT.photo = true
    for (const code of ["KeyW", "ArrowUp", "Space", "Enter", "Tab", "KeyQ", "KeyI"]) expect(key(code).defaultPrevented).toBe(false)
    expect(input.move).toEqual({ x: 0, y: 0 })
    expect([input.jump, input.ascend, input.interact, input.switchCharacter]).toEqual([false, false, false, false])
    expect(input.actions).toEqual([])
    key("KeyP")
    expect(takeAction("photo")).toBe(true)
  })

  it("prevents arrow-key page scrolling and releases each movement axis", () => {
    expect(key("ArrowUp").defaultPrevented).toBe(true)
    key("KeyD")
    expect(input.move).toEqual({ x: 1, y: -1 })
    key("ArrowUp", "keyup")
    expect(input.move).toEqual({ x: 1, y: 0 })
    key("KeyD", "keyup")
    expect(input.move).toEqual({ x: 0, y: 0 })
  })

  it("emits one switch while Q is held and another after release", () => {
    key("KeyQ")
    expect(input.switchCharacter).toBe(true)
    input.switchCharacter = false
    key("KeyQ", "keydown", true)
    key("KeyQ")
    expect(input.switchCharacter).toBe(false)
    key("KeyQ", "keyup")
    key("KeyQ")
    expect(input.switchCharacter).toBe(true)
  })

  it("resets all held and queued actions on blur", () => {
    key("KeyW"); key("ShiftLeft"); key("Space"); key("KeyE"); key("KeyC"); key("KeyQ")
    win.dispatchEvent(new Event("blur"))
    expect(input.move).toEqual({ x: 0, y: 0 })
    expect([input.sprint, input.jump, input.interact, input.call, input.switchCharacter]).toEqual([false, false, false, false, false])
    key("KeyQ")
    expect(input.switchCharacter).toBe(true)
  })

  it("clears background-tab input and stops listeners during cleanup", () => {
    key("KeyQ")
    doc.hidden = true
    doc.dispatchEvent(new Event("visibilitychange"))
    expect(input.switchCharacter).toBe(false)
    cleanup()
    key("KeyQ")
    expect(input.switchCharacter).toBe(false)
  })
})
