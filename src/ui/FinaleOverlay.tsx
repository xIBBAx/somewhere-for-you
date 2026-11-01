import { useCallback, useEffect, useRef, useState } from "react"
import { useGame } from "../state/gameStore"
import { MEMORIES } from "../content/memories"
import { story } from "../content/story"
import { useDialogFocus } from "./useDialogFocus"
import { MemoryPhotos } from "./MemoryPhotos"

/**
 * Finale overlays: the closing message card and the closing line.
 * Driven by store flags set by the finale director.
 */
export const FinaleOverlay = (): React.ReactElement | null => {
  const finaleMessage = useGame((s) => s.finaleMessage)
  const setFinaleMessage = useGame((s) => s.setFinaleMessage)
  const finaleDone = useGame((s) => s.finale === "done")
  const [closing, setClosing] = useState(false)
  // A saved ending must not replay its closing overlay after a hard refresh.
  const shown = useRef(finaleDone)
  const closeMessage = useCallback(() => setFinaleMessage(false), [setFinaleMessage])
  const dialog = useDialogFocus(finaleMessage, closeMessage)

  useEffect(() => {
    if (!finaleDone) { shown.current = false; return }
    if (finaleDone && !shown.current) {
      shown.current = true
      const t = window.setTimeout(() => setClosing(true), 2400)
      const hide = window.setTimeout(() => setClosing(false), 10_400)
      return () => { clearTimeout(t); clearTimeout(hide) }
    }
  }, [finaleDone])

  if (finaleMessage) {
    return (
      <div ref={dialog} className="finale-veil" role="dialog" aria-modal="true" aria-label="A message for you">
        <div className="finale-card">
          <div className="stars-row">✦ ✦ ✦</div>
          <MemoryPhotos photos={story.finale.photos} tilt={-1.2} />
          <h2>{story.finale.heading}</h2>
          {story.finale.lines.map((line, i) => <p key={i}>{line}</p>)}
          {/* every print kept along the way, laid out together at the end */}
          <div className="finale-prints" aria-label="The photos from your nine stars">
            {MEMORIES.map((m, i) => m.photos?.[0] && (
              <img key={m.id} src={m.photos[0].thumb} alt={m.photos[0].alt} title={m.title} loading="lazy" decoding="async"
                style={{ rotate: `${((i * 37) % 9) - 4}deg`, animationDelay: `${0.6 + i * 0.12}s` }} />
            ))}
          </div>
          <button onClick={closeMessage}>stay a while</button>
        </div>
      </div>
    )
  }

  if (closing && finaleDone) {
    return <div className="closing-line">{story.finale.closingLine}</div>
  }

  return null
}
