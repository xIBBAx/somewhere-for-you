export type MouseMode = "play" | "photo" | "intro" | "blocked"

/** Wheel deltas are pixels, lines or pages depending on the browser/device. */
export const wheelPixels = (event: Pick<WheelEvent, "deltaY" | "deltaMode">, pageHeight: number): number => {
  const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageHeight : 1)
  return Number.isFinite(pixels) ? Math.max(-240, Math.min(240, pixels)) : 0
}

type MouseControls = {
  mode: () => MouseMode
  look: (dx: number, dy: number, mode: MouseMode) => void
  zoom: (pixels: number, mode: MouseMode) => void
  locked: (locked: boolean) => void
}

/** Free dragging always works; a stationary gameplay click also offers pointer lock. */
export const bindMouseControls = (canvas: HTMLCanvasElement, controls: MouseControls): { reset: () => void; dispose: () => void } => {
  const doc = canvas.ownerDocument
  const win = doc.defaultView!
  let drag: { id: number; x: number; y: number; startX: number; startY: number; moved: boolean; mode: MouseMode } | null = null
  let lockPending = false
  let lockCancelled = false

  const reset = (): void => {
    if (lockPending) lockCancelled = true
    const id = drag?.id
    drag = null
    if (id !== undefined && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id)
  }
  const down = (event: PointerEvent): void => {
    // Touch continues to use its existing joystick/orbit surface.
    if (event.pointerType !== "mouse" || event.button !== 0 || drag) return
    const mode = controls.mode()
    if (mode === "blocked" || doc.pointerLockElement === canvas) return
    event.preventDefault()
    canvas.focus({ preventScroll: true })
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false, mode }
    canvas.setPointerCapture(event.pointerId)
  }
  const move = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.id || doc.pointerLockElement === canvas) return
    if (!(event.buttons & 1) || controls.mode() !== drag.mode) { reset(); return }
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return
    drag.moved = true
    controls.look(event.clientX - drag.x, event.clientY - drag.y, drag.mode)
    drag.x = event.clientX
    drag.y = event.clientY
  }
  const up = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.id) return
    const click = event.button === 0 && !drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4 && drag.mode === "play" && controls.mode() === "play"
    reset()
    if (!click || lockPending || !canvas.requestPointerLock) return
    // Older implementations return void; denied/unavailable lock must never break drag.
    lockPending = true
    lockCancelled = false
    try {
      const request = canvas.requestPointerLock()
      if (request) void request.catch(() => { lockPending = false })
    } catch { lockPending = false }
  }
  const cancel = (event: PointerEvent): void => { if (event.pointerId === drag?.id) reset() }
  const lockChange = (): void => {
    lockPending = false
    reset()
    const locked = doc.pointerLockElement === canvas
    const allowed = !lockCancelled && !doc.hidden && doc.hasFocus() && controls.mode() === "play"
    if (locked && !allowed) doc.exitPointerLock()
    controls.locked(locked && allowed)
  }
  const lockError = (): void => { lockPending = false }
  const lockedMove = (event: MouseEvent): void => {
    if (doc.pointerLockElement === canvas && controls.mode() === "play") controls.look(event.movementX, event.movementY, "play")
  }
  const wheel = (event: WheelEvent): void => {
    const mode = controls.mode()
    // Browser zoom and horizontal scrolling retain their native behavior.
    if (mode === "blocked" || event.ctrlKey || event.metaKey || event.altKey || event.deltaY === 0) return
    event.preventDefault()
    if (drag) drag.moved = true
    controls.zoom(wheelPixels(event, canvas.clientHeight || win.innerHeight), mode)
  }
  const blur = (): void => {
    reset()
    if (doc.pointerLockElement === canvas) doc.exitPointerLock()
  }
  const visibility = (): void => { if (doc.hidden) blur() }
  const escape = (event: KeyboardEvent): void => { if (event.code === "Escape") blur() }
  const context = (event: MouseEvent): void => event.preventDefault()

  canvas.addEventListener("pointerdown", down)
  canvas.addEventListener("pointermove", move)
  canvas.addEventListener("pointerup", up)
  canvas.addEventListener("pointercancel", cancel)
  canvas.addEventListener("lostpointercapture", cancel)
  canvas.addEventListener("wheel", wheel, { passive: false })
  canvas.addEventListener("contextmenu", context)
  doc.addEventListener("pointerlockchange", lockChange)
  doc.addEventListener("pointerlockerror", lockError)
  doc.addEventListener("mousemove", lockedMove)
  doc.addEventListener("visibilitychange", visibility)
  win.addEventListener("blur", blur)
  win.addEventListener("keydown", escape)
  return { reset, dispose: () => {
    blur()
    canvas.removeEventListener("pointerdown", down)
    canvas.removeEventListener("pointermove", move)
    canvas.removeEventListener("pointerup", up)
    canvas.removeEventListener("pointercancel", cancel)
    canvas.removeEventListener("lostpointercapture", cancel)
    canvas.removeEventListener("wheel", wheel)
    canvas.removeEventListener("contextmenu", context)
    doc.removeEventListener("pointerlockchange", lockChange)
    doc.removeEventListener("pointerlockerror", lockError)
    doc.removeEventListener("mousemove", lockedMove)
    doc.removeEventListener("visibilitychange", visibility)
    win.removeEventListener("blur", blur)
    win.removeEventListener("keydown", escape)
    controls.locked(false)
  } }
}
