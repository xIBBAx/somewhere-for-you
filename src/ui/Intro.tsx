import { gift, names } from "../personalization"
import { useCallback, useEffect, useRef, useState } from "react"
import { story } from "../content/story"
import { sfx, stopCinematicAudio } from "../game/audio/audio"
import {
  beginIntroRuntime,
  finishIntroRuntime,
  playerRT,
  worldRT,
} from "../game/runtime"
import { isThunderstormCondition } from "../game/weather/weatherMapping"
import { getEffectiveWeather } from "../game/weather/weatherState"

type JourneyPhase =
  | "space"
  | "earth"
  | "atmosphere"
  | "clouds"
  | "sky"
  | "world"
  | "cat"
  | "explorer"
  | "arrival"

const phaseAt = (progress: number): JourneyPhase => {
  if (progress < 0.12) return "space"
  if (progress < 0.34) return "earth"
  if (progress < 0.43) return "atmosphere"
  if (progress < 0.59) return "clouds"
  if (progress < 0.68) return "sky"
  if (progress < 0.82) return "world"
  if (progress < 0.895) return "cat"
  if (progress < 0.96) return "explorer"
  return "arrival"
}

/** UI/story layer for the WebGL journey. Camera and temporary sets live in the real renderer. */
export const Intro = ({
  ready,
  hidden,
  quick,
  letter = false,
  reading = false,
  onBegin,
  onEnter,
}: {
  ready: boolean
  hidden: boolean
  quick: boolean
  /** the homepage letter introduced her: no title card after it */
  letter?: boolean
  /** the letter is still open */
  reading?: boolean
  onBegin: () => void
  onEnter: () => void
}): React.ReactElement => {
  const [reducedMotion, setReducedMotion] = useState(() =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  )
  const [journeyStarted, setJourneyStarted] = useState(false)
  const [displayProgress, setDisplayProgress] = useState(0)
  const raf = useRef<number | null>(null)
  const startedAt = useRef(0)
  const lastUiUpdate = useRef(0)
  const finished = useRef(false)

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = (): void => {
      const reduced = query.matches
      setReducedMotion(reduced)
      worldRT.introReducedMotion = reduced
    }
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  useEffect(() => {
    if (hidden) return
    finished.current = false
    if (quick) {
      playerRT.paused = true
      worldRT.introActive = false
      worldRT.introProgress = 1
      return
    }
    beginIntroRuntime(reducedMotion)
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current)
      raf.current = null
      if (!finished.current) {
        worldRT.introActive = false
        worldRT.introStarted = false
        worldRT.introLightning = 0
        playerRT.paused = false
      }
    }
    // The media-query listener updates the runtime flag without restarting a journey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden, quick])

  const complete = useCallback(() => {
    if (finished.current) return
    finished.current = true
    if (raf.current !== null) cancelAnimationFrame(raf.current)
    raf.current = null
    setDisplayProgress(1)
    stopCinematicAudio()
    const storm = isThunderstormCondition(getEffectiveWeather().condition)
    finishIntroRuntime(storm ? 0.55 : 0)
    onEnter()
  }, [onEnter])

  // Enter on the letter is her Enter: straight in once the world is warm (the
  // loader shows what is left when she reads faster than it loads)
  useEffect(() => {
    if (!quick || !letter || hidden || reading || !ready) return
    onBegin()
    complete()
  }, [complete, hidden, letter, onBegin, quick, ready, reading])

  const begin = useCallback(() => {
    if (!ready || journeyStarted) return
    onBegin()
    sfx.fairyIntro()
    setJourneyStarted(true)
    worldRT.introStarted = true
    startedAt.current = performance.now()
    lastUiUpdate.current = 0
    const duration = reducedMotion ? 6_800 : 12_800

    const tick = (now: number): void => {
      const progress = Math.min(1, (now - startedAt.current) / duration)
      worldRT.introProgress = progress
      if (now - lastUiUpdate.current > 45 || progress >= 1) {
        lastUiUpdate.current = now
        setDisplayProgress(progress)
      }
      if (progress >= 1) {
        complete()
        return
      }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }, [complete, journeyStarted, onBegin, ready, reducedMotion])

  if (hidden) return <div className="intro hidden" aria-hidden />

  if (quick && letter) return <div className="intro hidden" aria-hidden />

  if (quick) {
    return (
      <div className="intro intro-quick">
        <div className="intro-quick-card">
          <span className="intro-quick-kicker">namaste</span>
          <h1>{story.title}</h1>
          <p>{story.subtitle}</p>
          <button
            aria-label="Enter the world"
            onClick={() => {
              onBegin()
              complete()
            }}
            disabled={!ready}
          >
            {ready ? story.enterButton : "warming up the world…"}
          </button>
        </div>
      </div>
    )
  }

  const phase = phaseAt(displayProgress)
  const storyOne = !journeyStarted || displayProgress < 0.105
  const storyTwo = journeyStarted && displayProgress >= 0.105 && displayProgress < 0.215
  const storyThree = journeyStarted && displayProgress >= 0.215 && displayProgress < 0.335
  const showTitle = displayProgress >= 0.905

  return (
    <div
      className={`intro cinematic-ui phase-${phase}${journeyStarted ? " journey-started" : ""}`}
      data-cinematic-phase={phase}
      data-cinematic-progress={displayProgress.toFixed(3)}
    >
      <div className="cinematic-vignette" aria-hidden />

      <div className="cinematic-story" aria-live="polite">
        <p className={storyOne ? "story-line visible" : "story-line"}>
          The world is wonderfully vast.
        </p>
        <p className={storyTwo ? "story-line visible" : "story-line"}>
          Across oceans, continents and clouds…
        </p>
        <p className={storyThree ? "story-line visible" : "story-line"}>
          {gift().world.home.label ? `to ${gift().world.home.label}, and home.` : "to one small place called home."}
        </p>
      </div>

      {!journeyStarted && (
        <div className="cinematic-begin">
          <span>Somewhere down there, {names.recipient}, a world is waiting for you.</span>
          <button aria-label="Enter the world" onClick={begin} disabled={!ready}>
            {ready ? "Travel to your world" : "finding Earth…"}
          </button>
          <small>{reducedMotion ? "Gentle journey enabled" : "A short cinematic journey"}</small>
          <small className="intro-mouse-hint">Drag to look around · wheel to zoom in or out</small>
        </div>
      )}

      {journeyStarted && (
        <>
          <button className="cinematic-skip" onClick={complete} aria-label="Skip cinematic journey">
            Skip
          </button>
          <div className="cinematic-progress" aria-hidden>
            <span style={{ transform: `scaleX(${displayProgress})` }} />
          </div>
        </>
      )}

      <div className={showTitle ? "cinematic-title visible" : "cinematic-title"}>
        <span>there you are</span>
        <h1>{story.title}</h1>
        <p>Welcome, {names.recipient}. This corner of the world is yours.</p>
      </div>
    </div>
  )
}
