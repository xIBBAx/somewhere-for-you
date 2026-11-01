import { useEffect, useRef } from "react"
import { resetInputControls } from "../game/input"

/** Keep keyboard interaction inside an open card and return focus to the world. */
export const useDialogFocus = <T extends HTMLElement = HTMLDivElement>(open: boolean, close: () => void): React.RefObject<T | null> => {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!open || !ref.current) return
    const dialog = ref.current
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    resetInputControls()
    const buttons = (): HTMLElement[] => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]')).filter(el => el.getClientRects().length > 0)
    buttons()[0]?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        close()
      } else if (event.key === "Tab") {
        const targets = buttons()
        const first = targets[0]
        const last = targets.at(-1)
        if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
          event.preventDefault()
          ;(event.shiftKey ? last : first)?.focus()
        }
      } else if (["KeyW", "KeyA", "KeyS", "KeyD", "KeyE", "KeyC", "KeyQ", "KeyJ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
        event.stopPropagation()
      }
    }
    document.addEventListener("keydown", onKey, true)
    return () => {
      document.removeEventListener("keydown", onKey, true)
      const canvas = document.querySelector("canvas")
      if (canvas) canvas.focus({ preventScroll: true })
      else if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [open, close])
  return ref
}
