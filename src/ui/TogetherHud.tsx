import { useCallback, useEffect, useRef, useState } from "react"
import { pushAction, type GameAction, characterRT } from "../game/runtime"
import { togetherRT } from "../game/together/togetherState"
import { useExplorationUI } from "../state/explorationUIStore"
import { useDialogFocus } from "./useDialogFocus"
import { bubbleBottom } from "./bubblePlacement"
import { names } from "../personalization"

const ACTIONS: { action: GameAction; key: string; label: string; state?: "holdHands" | "dance" }[] = [
  { action: "hold", key: "H", label: "Hold hands", state: "holdHands" },
  { action: "hug", key: "G", label: "Hug" },
  { action: "five", key: "F", label: "High five" },
  { action: "dance", key: "V", label: "Dance", state: "dance" },
]

/**
 * Speech bubbles above whoever is talking, and a small row of things to do
 * together that appears only while the two of them are close.
 */
export const TogetherHud = (): React.ReactElement | null => {
  const panel = useExplorationUI(s => s.panel)
  const dismiss = useCallback(() => useExplorationUI.getState().open(null), [])
  const dialog = useDialogFocus(panel === "together", dismiss)
  const bubble = useRef<HTMLDivElement>(null)
  const [, setVersion] = useState(0)

  useEffect(() => {
    let frame = 0
    let seen = -1
    const tick = (): void => {
      if (togetherRT.version !== seen) {
        seen = togetherRT.version
        setVersion(seen)
      }
      const el = bubble.current
      const sp = togetherRT.speech
      if (el) {
        const show = sp.time > 0 && sp.onScreen
        el.style.opacity = show ? String(Math.min(1, sp.time * 2.5)) : "0"
        if (show) {
          const bar = document.querySelector<HTMLElement>(".together-bar")?.getBoundingClientRect() ?? null
          // the tail adds ~6px below the box
          const y = bubbleBottom(sp.screenX, sp.screenY, el.offsetWidth, el.offsetHeight + 6, bar)
          el.style.transform = `translate(${sp.screenX.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  const sp = togetherRT.speech
  const partner = characterRT.active === "explorer" ? `${names.companion}` : `${names.explorer}`
  const near = togetherRT.partnerNear
  return (
    <>
      <div ref={bubble} className="speech-bubble" aria-live="polite" style={{ opacity: 0 }}>
        {sp.time > 0 ? sp.text : ""}
      </div>
      {panel === "together" && characterRT.companionPresent && (near || togetherRT.action !== "none") && (
        <div id="explore-together" ref={dialog} className="together-bar" role="dialog" aria-modal="true" aria-label={`Do something with ${partner}`}>
          {ACTIONS.map(({ action, key, label, state }) => (
            <button
              key={action}
              className={state && togetherRT.action === state ? "on" : ""}
              aria-pressed={state ? togetherRT.action === state : undefined}
              onClick={() => pushAction(action)}
            >
              <kbd>{key}</kbd>
              {state && togetherRT.action === state ? state === "holdHands" ? "Let go" : "Stop dancing" : label}
            </button>
          ))}
          <button onClick={() => pushAction("follow")} aria-pressed={!togetherRT.follow}>
            <kbd>T</kbd>
            {togetherRT.follow ? "Wait here" : "Come along"}
          </button>
        </div>
      )}
    </>
  )
}
