import { useSyncExternalStore } from "react"

/**
 * The companion's letter opens the homepage (index.html, #letter-veil) and the
 * world loads behind it: by the time she has read it and pressed Enter, the
 * terrain, both characters and every shader are usually ready, so she steps
 * straight into her universe. The page's inline script owns the paper itself
 * (it works before this bundle has arrived); this module is the game's side.
 */
type LetterWindow = Window & {
  __letterEntered?: boolean
  /** runs inside her click on Enter: the one chance to unlock audio */
  __letterGesture?: () => void
}

const letterWindow = (typeof window === "undefined" ? {} : window) as LetterWindow

/** The letter was on screen when the game started (only the plain homepage). */
export const letterShown = typeof document !== "undefined" && (!!document.getElementById("letter-veil") || !!letterWindow.__letterEntered)

/** She has not yet pressed Enter on the letter. */
export const letterOpen = (): boolean => letterShown && !letterWindow.__letterEntered

const subscribe = (notify: () => void): (() => void) => {
  window.addEventListener("letter-entered", notify)
  return () => window.removeEventListener("letter-entered", notify)
}

export const useLetterOpen = (): boolean => useSyncExternalStore(subscribe, letterOpen, () => false)

export const setLetterGesture = (gesture: () => void): void => {
  letterWindow.__letterGesture = gesture
}
