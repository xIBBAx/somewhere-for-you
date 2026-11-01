import { beforeEach, describe, expect, it, vi } from "vitest"
import { bindMouseControls, wheelPixels, type MouseMode } from "../src/game/controls/mouseControls"

const dispatch = (target: EventTarget, type: string, values: Record<string, unknown> = {}): Event => {
  const event = new Event(type, { cancelable: true })
  Object.defineProperties(event, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])))
  target.dispatchEvent(event)
  return event
}

const pointer = (target: EventTarget, type: string, values: Record<string, unknown> = {}): Event => dispatch(target, type, {
  pointerId: 1, pointerType: "mouse", button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: 100, clientY: 100, movementX: 0, movementY: 0, ...values,
})

const fixture = () => {
  const win = Object.assign(new EventTarget(), { innerHeight: 680 })
  const doc = Object.assign(new EventTarget(), { defaultView: win, pointerLockElement: null as unknown, hidden: false, hasFocus: vi.fn(() => true), exitPointerLock: vi.fn() })
  const captured = new Set<number>()
  const canvas = Object.assign(new EventTarget(), {
    ownerDocument: doc, clientHeight: 680, focus: vi.fn(),
    hasPointerCapture: (id: number) => captured.has(id),
    setPointerCapture: (id: number) => { captured.add(id) },
    releasePointerCapture: (id: number) => { captured.delete(id) },
    requestPointerLock: vi.fn<() => Promise<void> | void>(() => Promise.resolve()),
  })
  let mode: MouseMode = "play"
  const controls = { mode: () => mode, look: vi.fn(), zoom: vi.fn(), locked: vi.fn() }
  const binding = bindMouseControls(canvas as unknown as HTMLCanvasElement, controls)
  return { win, doc, canvas, controls, binding, captured, mode: (next: MouseMode) => { mode = next } }
}
let f: ReturnType<typeof fixture>
beforeEach(() => { f = fixture() })

describe("desktop mouse controls", () => {
  it.each(["play", "photo", "intro"] as const)("drags using client coordinates in %s without locking the pointer", mode => {
    f.mode(mode)
    pointer(f.canvas, "pointerdown")
    pointer(f.canvas, "pointermove", { clientX: 150, clientY: 125, movementX: 0, movementY: 0 })
    pointer(f.canvas, "pointerup", { clientX: 150, clientY: 125 })
    expect(f.controls.look).toHaveBeenCalledWith(50, 25, mode)
    expect(f.canvas.requestPointerLock).not.toHaveBeenCalled()
    expect(f.captured.size).toBe(0)
    pointer(f.canvas, "pointermove", { clientX: 180 })
    expect(f.controls.look).toHaveBeenCalledTimes(1)
  })

  it("tolerates click jitter and focuses the canvas before offering free look", () => {
    pointer(f.canvas, "pointerdown")
    pointer(f.canvas, "pointermove", { clientX: 102 })
    pointer(f.canvas, "pointerup", { clientX: 102 })
    expect(f.canvas.focus).toHaveBeenCalled()
    expect(f.canvas.requestPointerLock).toHaveBeenCalledTimes(1)
    expect(f.controls.look).not.toHaveBeenCalled()
  })

  it.each(["photo", "intro", "blocked"] as const)("never captures the mouse on a %s click", mode => {
    f.mode(mode)
    pointer(f.canvas, "pointerdown"); pointer(f.canvas, "pointerup")
    expect(f.canvas.requestPointerLock).not.toHaveBeenCalled()
  })

  it.each(["pointercancel", "lostpointercapture"])("discards %s without converting it to a click", type => {
    pointer(f.canvas, "pointerdown")
    pointer(f.canvas, type)
    pointer(f.canvas, "pointermove", { clientX: 160 })
    pointer(f.canvas, "pointerup")
    expect(f.controls.look).not.toHaveBeenCalled()
    expect(f.canvas.requestPointerLock).not.toHaveBeenCalled()
  })

  it("ignores unrelated pointers and clears missed mouse-up or changed modes", () => {
    pointer(f.canvas, "pointerdown")
    pointer(f.canvas, "pointermove", { pointerId: 2, clientX: 160 })
    pointer(f.canvas, "pointermove", { buttons: 0, clientX: 160 })
    pointer(f.canvas, "pointermove", { clientX: 160 })
    expect(f.controls.look).not.toHaveBeenCalled()
    pointer(f.canvas, "pointerdown")
    f.mode("photo")
    pointer(f.canvas, "pointermove", { clientX: 160 })
    expect(f.captured.size).toBe(0)
    expect(f.controls.look).not.toHaveBeenCalled()
  })

  it.each(["blur", "hidden", "escape", "reset"])("ends a held drag on %s", reason => {
    pointer(f.canvas, "pointerdown")
    if (reason === "blur") dispatch(f.win, "blur")
    if (reason === "hidden") { f.doc.hidden = true; dispatch(f.doc, "visibilitychange") }
    if (reason === "escape") dispatch(f.win, "keydown", { code: "Escape" })
    if (reason === "reset") f.binding.reset()
    pointer(f.canvas, "pointermove", { clientX: 170 })
    pointer(f.canvas, "pointerup")
    expect(f.controls.look).not.toHaveBeenCalled()
    expect(f.canvas.requestPointerLock).not.toHaveBeenCalled()
  })

  it("ignores non-primary mouse buttons", () => {
    for (const button of [1, 2]) {
      pointer(f.canvas, "pointerdown", { button })
      pointer(f.canvas, "pointermove", { clientX: 170 })
      pointer(f.canvas, "pointerup", { button })
    }
    expect(f.controls.look).not.toHaveBeenCalled()
    expect(f.canvas.requestPointerLock).not.toHaveBeenCalled()
  })

  it("uses relative movement exactly once while locked, then supports dragging after release", () => {
    f.doc.pointerLockElement = f.canvas
    dispatch(f.doc, "pointerlockchange")
    pointer(f.canvas, "pointerdown")
    pointer(f.canvas, "pointermove", { clientX: 170, movementX: 70 })
    dispatch(f.doc, "mousemove", { movementX: 70, movementY: 10 })
    expect(f.controls.look).toHaveBeenCalledExactlyOnceWith(70, 10, "play")
    f.doc.pointerLockElement = null
    dispatch(f.doc, "pointerlockchange")
    pointer(f.canvas, "pointerdown")
    pointer(f.canvas, "pointermove", { clientX: 120 })
    expect(f.controls.look).toHaveBeenLastCalledWith(20, 0, "play")
  })

  it.each(["void", "reject", "throw", "missing"])("keeps dragging usable when pointer lock is %s", async kind => {
    f.canvas.requestPointerLock.mockImplementation(() => {
      if (kind === "reject") return Promise.reject(new Error("denied"))
      if (kind === "throw") throw new Error("unavailable")
    })
    if (kind === "missing") Object.assign(f.canvas, { requestPointerLock: undefined })
    pointer(f.canvas, "pointerdown"); pointer(f.canvas, "pointerup")
    await Promise.resolve()
    pointer(f.canvas, "pointerdown")
    pointer(f.canvas, "pointermove", { clientX: 140 })
    expect(f.controls.look).toHaveBeenCalledWith(40, 0, "play")
  })

  it("releases a late lock after an overlay reset even when play has resumed", () => {
    pointer(f.canvas, "pointerdown"); pointer(f.canvas, "pointerup")
    f.binding.reset()
    f.doc.pointerLockElement = f.canvas
    dispatch(f.doc, "pointerlockchange")
    expect(f.doc.exitPointerLock).toHaveBeenCalled()
    expect(f.controls.locked).toHaveBeenLastCalledWith(false)
  })

  it.each(["play", "photo", "intro"] as const)("zooms both ways in %s and normalizes line and page units", mode => {
    f.mode(mode)
    for (const [deltaY, deltaMode, pixels] of [[120, 0, 120], [-3, 1, -48], [1, 2, 240], [-1, 2, -240]]) {
      const event = dispatch(f.canvas, "wheel", { deltaY, deltaMode })
      expect(event.defaultPrevented).toBe(true)
      expect(f.controls.zoom).toHaveBeenLastCalledWith(pixels, mode)
    }
  })

  it("leaves modifier-wheel zoom to the browser and blocks paused camera input", () => {
    for (const modifier of ["ctrlKey", "metaKey", "altKey"]) {
      expect(dispatch(f.canvas, "wheel", { deltaY: 120, deltaMode: 0, [modifier]: true }).defaultPrevented).toBe(false)
    }
    f.mode("blocked")
    pointer(f.canvas, "pointerdown"); pointer(f.canvas, "pointermove", { clientX: 170 })
    expect(dispatch(f.canvas, "wheel", { deltaY: 120, deltaMode: 0 }).defaultPrevented).toBe(false)
    expect(f.controls.zoom).not.toHaveBeenCalled()
    expect(f.controls.look).not.toHaveBeenCalled()
  })

  it("does not turn a held-button wheel zoom into a pointer-lock click", () => {
    pointer(f.canvas, "pointerdown")
    dispatch(f.canvas, "wheel", { deltaY: 120, deltaMode: 0 })
    pointer(f.canvas, "pointerup")
    expect(f.controls.zoom).toHaveBeenCalledWith(120, "play")
    expect(f.canvas.requestPointerLock).not.toHaveBeenCalled()
  })

  it("removes every listener and held drag on unmount", () => {
    pointer(f.canvas, "pointerdown")
    f.binding.dispose()
    pointer(f.canvas, "pointermove", { clientX: 170 })
    dispatch(f.canvas, "wheel", { deltaY: 120, deltaMode: 0 })
    expect(f.controls.look).not.toHaveBeenCalled()
    expect(f.controls.zoom).not.toHaveBeenCalled()
    expect(f.captured.size).toBe(0)
  })

  it("does not propagate invalid wheel numbers into camera state", () => {
    expect(wheelPixels({ deltaY: NaN, deltaMode: 0 }, 680)).toBe(0)
    expect(wheelPixels({ deltaY: Infinity, deltaMode: 1 }, 680)).toBe(0)
  })
})
