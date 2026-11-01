import { useTravel } from "../state/travelStore"
import { useExplorationUI } from "../state/explorationUIStore"
import { cameraRT, characterRT, clearInputActions, input, pushAction, worldRT, type GameAction } from "./runtime"
import { horseRT } from "./horses/horseState"
import { letterOpen } from "../ui/letterVeil"
import { useGame } from "../state/gameStore"
import { refreshUniverse } from "./travel/cosmicRefresh"
import { changeSkyByKey } from "./weather/skyKey"

const ACTION_KEYS: Record<string, GameAction> = {
  KeyH: "hold", KeyG: "hug", KeyF: "five", KeyV: "dance", KeyT: "follow", KeyP: "photo", KeyL: "journal", KeyR: "race", KeyX: "stars",
  KeyB: "pat", KeyY: "callPegasus", KeyU: "callHorse", KeyI: "callStarborn",
  KeyZ: "putDown",
  Digit1: "callDragon",
  // sailing the stars on Starborn (celestial/CelestialController)
  KeyM: "starChart", KeyN: "travel", KeyK: "homeward",
  // the space cats: bring them along (celestial/spaceCats)
  KeyO: "gather",
  // the controls guide (the ? key)
  Slash: "controlsGuide",
}

/** The controls only need the landing contract, independently of its physics owner. */
export type PegasusControlFlight = {
  mode: string
  landing?: { style?: "stop" | "gallop"; run?: boolean; requested?: boolean }
}
export type PegasusLandingControl = "land" | "keepFlying" | "slow" | null

/** One contextual action shared by the keyboard and the control legend. */
export const pegasusLandingControl = (flight: PegasusControlFlight | null | undefined): PegasusLandingControl => {
  if (!flight || flight.mode === "sail") return null
  if (flight.mode === "ground") return flight.landing?.run ? "slow" : null
  if (!["takeoff", "air", "landing"].includes(flight.mode)) return null
  return flight.landing?.style === "gallop" && flight.landing.requested ? "keepFlying" : "land"
}

export const resolveKeyAction = (code: string, flight?: PegasusControlFlight | null, travelling = false): GameAction | undefined => {
  const landing = travelling ? null : pegasusLandingControl(flight)
  if (code === "KeyR" && landing || code === "KeyS" && landing === "slow") return "landGallop"
  return ACTION_KEYS[code]
}

const occupiedFlight = (): PegasusControlFlight | undefined => {
  for (const horse of horseRT.horses.values()) {
    if (horse.rider === characterRT.active || horse.passenger === characterRT.active) return horse.flight ?? undefined
  }
  return undefined
}

const keyToMove = (code: string, down: boolean, keys: Set<string>): void => {
  if (down) keys.add(code)
  else keys.delete(code)
  let x = 0
  let y = 0
  if (keys.has("KeyW") || keys.has("ArrowUp")) y -= 1
  if (keys.has("KeyS") || keys.has("ArrowDown")) y += 1
  if (keys.has("KeyA") || keys.has("ArrowLeft")) x -= 1
  if (keys.has("KeyD") || keys.has("ArrowRight")) x += 1
  input.move.x = x
  input.move.y = y
  input.sprint = keys.has("ShiftLeft") || keys.has("ShiftRight")
  input.ascend = keys.has("Space") || keys.has("KeyJ")
  input.descend = keys.has("KeyC")
}

export const initInput = (): (() => void) => {
  const keys = new Set<string>()

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat || keys.has(e.code)) return
    const target = e.target
    if (target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || worldRT.introActive) return
    // the keys scroll the letter while she reads it
    if (letterOpen()) return
    // F5: Refresh the universe, anywhere in the world (menus, photo mode and
    // dialogs included): saved, folded into the stars and back where she
    // stood. Before the world has begun, F5 stays the browser's own reload.
    if (e.code === "F5" && !e.shiftKey) {
      if (!useGame.getState().started) return
      e.preventDefault()
      refreshUniverse()
      return
    }
    if (cameraRT.photo) {
      if (e.code === "KeyP") pushAction("photo")
      return
    }
    if (e.code === "F2" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      e.preventDefault()
      useExplorationUI.getState().toggleMode()
      return
    }
    // 2: change the weather (Live, Sunny, Showers, Rain, Storm, Misty, Snow)
    if (e.code === "Digit2" && !e.shiftKey && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
      e.preventDefault()
      changeSkyByKey()
      return
    }
    if (useExplorationUI.getState().panel) {
      if (e.code === "Escape") {
        e.preventDefault()
        useExplorationUI.getState().open(null)
      }
      return
    }
    // Dialogs own their keyboard, including native Space/Enter activation,
    // Tab focus and their own Escape close handler. No gameplay action leaks
    // through a picker or star chart while it is being read.
    if (document.querySelector?.('[role="dialog"][aria-modal="true"]')) return
    if (e.code === "Space" || e.code === "KeyJ") {
      if (e.code === "Space" && document.activeElement instanceof HTMLButtonElement) return
      e.preventDefault()
      input.jump = true
    }
    if (e.code === "KeyE" || e.code === "Enter") {
      // don't steal Space/Enter from focused buttons
      const el = document.activeElement
      if (e.code === "Enter" && el instanceof HTMLButtonElement) return
      e.preventDefault()
      input.interact = true
    }
    if (e.code === "KeyC") input.call = true
    const action = resolveKeyAction(e.code, (e.code === "KeyR" || e.code === "KeyS") ? occupiedFlight() : undefined, useTravel.getState().phase !== "idle")
    if (action && !e.ctrlKey && !e.metaKey && !e.altKey) pushAction(action)
    // Tab cycles the camera (Far, Medium, Close), as GTA's view button does,
    // Shift+Tab the other way (so it works while running). In play (pointer
    // locked) Tab is the camera's; otherwise only when nothing on the page has
    // the keyboard, so Tab still moves focus through menus and dialogs
    if (e.code === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const el = document.activeElement
      if (document.pointerLockElement || !el || el === document.body || el instanceof HTMLCanvasElement) {
        e.preventDefault()
        pushAction(e.shiftKey ? "cameraViewBack" : "cameraView")
      }
    }
    if (e.code === "KeyQ") {
      e.preventDefault()
      input.switchCharacter = true
    }
    if (e.code === "Escape") {
      input.cancel = true
      if (document.pointerLockElement) document.exitPointerLock()
    }
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault()
    keyToMove(e.code, true, keys)
  }
  const onKeyUp = (e: KeyboardEvent): void => keyToMove(e.code, false, keys)
  const releaseKeys = subscribeInputReset(() => keys.clear())
  const onBlur = (): void => resetInputControls()
  const onVisibility = (): void => { if (document.hidden) onBlur() }

  // Closing a held touch/keyboard control must never leave a flying horse
  // climbing or a character running after its button disappears.
  const unsubscribe = useExplorationUI.subscribe((state, previous) => {
    if (state.mode !== previous.mode || state.panel !== previous.panel) onBlur()
  })
  window.addEventListener("keydown", onKeyDown)
  window.addEventListener("keyup", onKeyUp)
  window.addEventListener("blur", onBlur)
  document.addEventListener("visibilitychange", onVisibility)
  return () => {
    window.removeEventListener("keydown", onKeyDown)
    window.removeEventListener("keyup", onKeyUp)
    window.removeEventListener("blur", onBlur)
    document.removeEventListener("visibilitychange", onVisibility)
    unsubscribe()
    releaseKeys()
    onBlur()
  }
}

const inputResetListeners = new Set<() => void>()
/** Keyboard and pointer surfaces discard their own private held state too. */
export const subscribeInputReset = (listener: () => void): (() => void) => {
  inputResetListeners.add(listener)
  return () => { inputResetListeners.delete(listener) }
}

/** Opening a modal releases every held control, not only one-shot actions. */
export const resetInputControls = (): void => {
  input.move.x = input.move.y = 0
  input.sprint = input.ascend = input.descend = false
  clearInputActions()
  for (const listener of inputResetListeners) listener()
}
