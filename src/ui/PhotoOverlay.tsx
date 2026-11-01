import { useEffect } from "react"
import { FILTERS, POSES, usePhoto, type FilterId, type PoseId } from "../game/activities/photo"
import { characterRT } from "../game/runtime"
import { togetherRT } from "../game/together/togetherState"
import { resetInputControls } from "../game/input"

/** Camera controls shown while photo mode is open. */
export const PhotoOverlay = (): React.ReactElement | null => {
  const open = usePhoto((s) => s.open)
  const filter = usePhoto((s) => s.filter)
  const pose = usePhoto((s) => s.pose)
  const flash = usePhoto((s) => s.flash)
  const last = usePhoto((s) => s.last)

  useEffect(() => {
    if (!open) return
    resetInputControls()
    const onKey = (e: KeyboardEvent): void => {
      if (e.repeat || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"))) return
      if ((e.code === "Space" || e.code === "Enter") && target instanceof HTMLButtonElement) return
      if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); usePhoto.getState().request() }
      if (e.code === "Escape") usePhoto.getState().close()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      resetInputControls()
      document.querySelector("canvas")?.focus({ preventScroll: true })
    }
  }, [open])

  if (!open) return null
  const together = characterRT.companionPresent && togetherRT.distance < 4
  return (
    <div className="photo-mode" role="dialog" aria-label="Photo mode">
      <div className="photo-thirds" aria-hidden />
      {flash > 0 && <div className="photo-flash" key={flash} aria-hidden />}
      <div className="photo-top">
        <span>drag to frame · wheel to zoom · Space to take · Esc to close</span>
        <button onClick={() => usePhoto.getState().close()} aria-label="Close photo mode">Done</button>
      </div>
      <div className="photo-bottom">
        <div className="photo-row" role="radiogroup" aria-label="Pose">
          {(Object.keys(POSES) as PoseId[]).filter((p) => p !== "hug" || together).map((p) => (
            <button key={p} role="radio" aria-checked={pose === p} className={pose === p ? "on" : ""} onClick={() => usePhoto.getState().setPose(p)}>{POSES[p]}</button>
          ))}
        </div>
        <div className="photo-row" role="radiogroup" aria-label="Film">
          {(Object.keys(FILTERS) as FilterId[]).map((f) => (
            <button key={f} role="radio" aria-checked={filter === f} className={filter === f ? "on" : ""} onClick={() => usePhoto.getState().setFilter(f)}>{FILTERS[f].label}</button>
          ))}
        </div>
        <button className="photo-shutter" onClick={() => usePhoto.getState().request()} aria-label="Take photo" />
      </div>
      {last && flash > 0 && <img className="photo-proof" key={`proof-${flash}`} src={last} alt="The photo you just took" />}
    </div>
  )
}
