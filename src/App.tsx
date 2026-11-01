import { debugEnabled } from "./dev/debugFlag"
import { useEffect, useState } from "react"
import { GameCanvas } from "./game/GameCanvas"
import { Intro } from "./ui/Intro"
import { Hud } from "./ui/Hud"
import { MemoryCard } from "./ui/MemoryCard"
import { FinaleOverlay } from "./ui/FinaleOverlay"
import { DebugPanel } from "./ui/DebugPanel"
import { TogetherHud } from "./ui/TogetherHud"
import { ActivityHud } from "./ui/ActivityHud"
import { PhotoOverlay } from "./ui/PhotoOverlay"
import { Journal } from "./ui/Journal"
import { Stargazing } from "./ui/Stargazing"
import { ObservationJourneys } from "./ui/ObservationJourneys"
import { ExplorationChrome } from "./ui/ExplorationChrome"
import { ControlsGuide } from "./ui/ControlsGuide"
import { ExplorerMap } from "./ui/ExplorerMap"
import { PlanetTravel } from "./ui/PlanetTravel"
import { SkyHud } from "./ui/SkyHud"
import { PersonalizeScreen } from "./ui/personalize/PersonalizeScreen"
import { usePhoto } from "./game/activities/photo"
import { flushGameSave, useGame } from "./state/gameStore"
import { initInput } from "./game/input"
import { initAudio, setAmbient, setMuted } from "./game/audio/audio"
import { WeatherController } from "./game/weather/WeatherController"
import { ClimateBubble } from "./game/characters/ClimateBubble"
import { companionRT, playerRT } from "./game/runtime"
import { letterOpen, letterShown, setLetterGesture, useLetterOpen } from "./ui/letterVeil"
import { enterWorld, installCloseGuard } from "./game/travel/cosmicRefresh"

export default function App(): React.ReactElement {
  const started = useGame((s) => s.started)
  const audioOn = useGame((s) => s.audioOn)
  const photoOpen = usePhoto((s) => s.open)
  const [introMode] = useState(() => {
    const query = new URLSearchParams(window.location.search)
    const forceCinematic = query.has("cinematic") || query.has("replayIntro")
    return {
      forceCinematic,
      // the letter is her introduction: the world loads quietly behind it
      quick: (debugEnabled() || query.has("skipIntro") || query.has("personalize") || letterShown) && !forceCinematic,
    }
  })
  const [ready, setReady] = useState(false)
  const reading = useLetterOpen()
  const [introHidden, setIntroHidden] = useState(started && !introMode.forceCinematic)
  const cinematicMounted = !introHidden && !introMode.quick
  const gameplayVisible = ready && introHidden && !reading

  useEffect(() => {
    playerRT.paused = companionRT.paused = !gameplayVisible
    // this tab is in the world now: reloads resume it, and a refresh arrives in light
    if (gameplayVisible) enterWorld()
  }, [gameplayVisible])

  useEffect(() => {
    const cover = document.getElementById("boot-screen")
    if (!ready || !cover) return
    cover.dataset.ready = "true"
    // let the loader's planet swell and fade into the journey first
    const timer = window.setTimeout(() => cover.remove(), 1300)
    return () => window.clearTimeout(timer)
  }, [ready])

  useEffect(() => initInput(), [])
  useEffect(() => installCloseGuard(), [])

  useEffect(() => {
    // her click on Enter is the gesture that may start the music
    setLetterGesture(() => {
      initAudio()
      if (useGame.getState().started) setAmbient(useGame.getState().audioOn)
    })
  }, [])

  useEffect(() => {
    const onVisibility = (): void => { if (document.hidden) flushGameSave() }
    window.addEventListener("pagehide", flushGameSave)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.removeEventListener("pagehide", flushGameSave)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])

  useEffect(() => {
    if (!started || !audioOn) return
    // A returning visitor skips Enter, so their first input unlocks audio.
    const activate = (): void => {
      // clicks on the letter (the print link, scrolling) are not the game yet
      if (letterOpen()) return
      initAudio()
      setAmbient(useGame.getState().audioOn)
      document.removeEventListener("pointerdown", activate, true)
      document.removeEventListener("keydown", activate, true)
    }
    document.addEventListener("pointerdown", activate, true)
    document.addEventListener("keydown", activate, true)
    return () => {
      document.removeEventListener("pointerdown", activate, true)
      document.removeEventListener("keydown", activate, true)
    }
  }, [started, audioOn])

  useEffect(() => {
    setMuted(!audioOn)
    if (started) setAmbient(audioOn)
  }, [audioOn, started])

  const beginJourney = (): void => {
    initAudio()
  }

  const enter = (): void => {
    initAudio()
    useGame.getState().start()
    setAmbient(useGame.getState().audioOn)
    setIntroHidden(true)
  }

  return (
    <>
      <GameCanvas cinematic={cinematicMounted} rest={ready && reading} onReady={() => setReady(true)} />
      <ExplorationChrome active={gameplayVisible && !photoOpen}>
      {gameplayVisible && !photoOpen && <Hud />}
      {gameplayVisible && <ControlsGuide />}
      {gameplayVisible && <MemoryCard />}
      {gameplayVisible && <FinaleOverlay />}
      <DebugPanel visible={gameplayVisible} />
      <WeatherController />
      {gameplayVisible && <ClimateBubble />}
      {gameplayVisible && !photoOpen && <TogetherHud />}
      {gameplayVisible && !photoOpen && <ActivityHud />}
      {gameplayVisible && <PhotoOverlay />}
      {gameplayVisible && <Stargazing />}
      {gameplayVisible && !photoOpen && <SkyHud />}
      {gameplayVisible && !photoOpen && <ExplorerMap />}
      {gameplayVisible && !photoOpen && <PlanetTravel />}
      {gameplayVisible && !photoOpen && <ObservationJourneys />}
      {gameplayVisible && !photoOpen && <div className="hud on book-layer"><Journal /></div>}
      </ExplorationChrome>
      <PersonalizeScreen />
      <Intro
        ready={ready}
        hidden={introHidden}
        quick={introMode.quick}
        letter={letterShown}
        reading={reading}
        onBegin={beginJourney}
        onEnter={enter}
      />
    </>
  )
}
