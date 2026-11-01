import { useEffect, useRef } from "react"
import { activityRT, useActivityUI } from "../game/activities/activityState"
import { useAdventures } from "../state/adventureStore"
import { ACHIEVEMENTS } from "../content/adventures"
import { sfx } from "../game/audio/audio"
import { input, pushAction } from "../game/runtime"

/** Throw meter, race clock, activity results and new pages in the book. */
export const ActivityHud = (): React.ReactElement => {
  const mode = useActivityUI((s) => s.mode)
  const carried = useActivityUI((s) => s.carried)
  const result = useActivityUI((s) => s.result)
  const clearResult = useActivityUI((s) => s.clearResult)
  const fresh = useAdventures((s) => s.fresh)
  const clearFresh = useAdventures((s) => s.clearFresh)
  const marker = useRef<HTMLDivElement>(null)
  const clock = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (mode !== "stoneAim") return
    let frame = 0
    const tick = (): void => {
      if (marker.current) marker.current.style.left = `${(activityRT.meter * 100).toFixed(2)}%`
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [mode])

  useEffect(() => {
    if (mode !== "race") return
    let frame = 0
    const tick = (): void => {
      const el = clock.current
      if (el) {
        const c = activityRT.countdown
        el.textContent = c > 0 ? String(Math.ceil(c)) : activityRT.raceTime < 0.8 ? "Go!" : activityRT.raceTime.toFixed(1)
        el.dataset.big = c > 0 || activityRT.raceTime < 0.8 ? "true" : "false"
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [mode])

  useEffect(() => {
    if (!result) return
    const timer = window.setTimeout(() => clearResult(result.id), 3800)
    return () => window.clearTimeout(timer)
  }, [result, clearResult])

  useEffect(() => {
    if (!fresh) return
    sfx.fanfare()
    const timer = window.setTimeout(clearFresh, 5200)
    return () => window.clearTimeout(timer)
  }, [fresh, clearFresh])

  const page = fresh ? ACHIEVEMENTS[fresh.id] : null
  return (
    <>
      {carried && mode === "none" && <button className="carried-release" onClick={() => pushAction("putDown")}>
        <kbd>Z</kbd> {carried}
      </button>}
      {mode === "stoneAim" && (
        <div className="throw-meter" role="status" aria-label="Throw strength">
          <div className="throw-track">
            <div className="throw-sweet" />
            <div ref={marker} className="throw-marker" />
          </div>
          <button className="throw-hint" onClick={() => { input.interact = true }}>
            <kbd>E</kbd> throw · <kbd>Esc</kbd> put it down
          </button>
        </div>
      )}
      {mode === "race" && <div ref={clock} className="race-clock" role="timer" aria-live="off" />}
      {result && (
        <div className="activity-result" key={result.id} role="status">
          <div className="activity-result-title">{result.title}</div>
          <div className="activity-result-line">{result.line}</div>
        </div>
      )}
      {page && fresh && (
        <div className="book-toast" key={fresh.at} role="status">
          <span className="book-toast-kicker">a new page in the journal</span>
          <div className="book-toast-title">{page.title}</div>
          <div className="book-toast-line">{page.line}</div>
        </div>
      )}
    </>
  )
}
