import { useControlsUI } from "./ControlsGuide"
import { useEffect, useRef, useState } from "react"
import { Feather, Moon, Sun, SunMoon, SwitchCamera, Volume2, VolumeX } from "lucide-react"
import { useGame } from "../state/gameStore"
import { finaleReady, companionUnlocked } from "../state/storyProgress"
import { TOTAL_STARS } from "../content/memories"
import { MEMORIES } from "../content/memories"
import { cameraRT, characterRT, input, pushAction, worldRT, avatarRT } from "../game/runtime"
import { ownPegasusInfo } from "../game/pegasus/whistle"
import { riderRT } from "../game/horses/riding"
import { canSwitchCharacter } from "../game/characters/characterSwitch"
import { useDiscoveries } from "../state/discoveryStore"
import { useQuality, type QualityMode } from "../state/qualityStore"
import { initAudio } from "../game/audio/audio"
import { useActivityUI } from "../game/activities/activityState"
import { DeerHud } from "./DeerHud"
import { CAMERA_VIEWS, viewRT, type CameraView } from "../game/camera/cameraViews"
import { ControlLegend } from "./ControlLegend"
import { useDragonUI } from "../game/dragon/dragonState"
import { names } from "../personalization"

/** Subtle HUD: little stars, contextual hint, mute. */
export const Hud = (): React.ReactElement => {
  const stars = useGame((s) => s.stars)
  const audioOn = useGame((s) => s.audioOn)
  const toggleAudio = useGame((s) => s.toggleAudio)
  const timeMode = useGame((s) => s.timeMode)
  const cycleTimeMode = useGame((s) => s.cycleTimeMode)
  const activeMemoryId = useGame((s) => s.activeMemoryId)
  const hint = useGame((s) => s.hint)
  const finaleMessage = useGame((s) => s.finaleMessage)
  const unlocked = useGame(companionUnlocked)
  const gardenReady = useGame((s) => finaleReady(s) && s.finale === "locked")
  const [nearMemory, setNearMemory] = useState<string | null>(null)
  const [nearSecret, setNearSecret] = useState(false)
  const [hasLooked, setHasLooked] = useState(cameraRT.hasLooked)
  const [activeCharacter, setActiveCharacter] = useState(characterRT.active)
  const [switchable, setSwitchable] = useState(false)
  const shade = useRef<HTMLDivElement>(null)
  const found = useDiscoveries((s) => s.count)
  const discoveryPrompt = useDiscoveries((s) => s.prompt)
  const activityPrompt = useActivityUI((s) => s.prompt)
  const dragonPrompt = useDragonUI((s) => s.prompt)
  const quality = useQuality((s) => s.mode)
  const setQuality = useQuality((s) => s.setMode)

  useEffect(() => {
    const iv = window.setInterval(() => {
      // discrete polling of high-frequency runtime (only when id changes → render)
      setNearMemory((prev) => (prev === worldRT.nearMemoryId ? prev : worldRT.nearMemoryId))
      setNearSecret((prev) => (prev === (worldRT.nearSecretId !== null) ? prev : worldRT.nearSecretId !== null))
      setHasLooked((prev) => (prev === cameraRT.hasLooked ? prev : cameraRT.hasLooked))
      setActiveCharacter(characterRT.active)
      setSwitchable(canSwitchCharacter(useGame.getState()) && (characterRT.active === "companion" || characterRT.companionReady))
    }, 180)
    return () => clearInterval(iv)
  }, [])
  useEffect(() => {
    let frame = 0
    const update = (): void => {
      if (shade.current) shade.current.style.opacity = String(characterRT.switchFade)
      frame = requestAnimationFrame(update)
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [])

  const memory = MEMORIES.find((m) => m.id === (nearMemory ?? activeMemoryId))
  const visited = useGame((s) => (memory ? (s.visited[memory.id] ?? false) : false))

  let hintText: string | null = hint
  if (!hintText && dragonPrompt && !activeMemoryId) hintText = dragonPrompt
  if (!hintText && discoveryPrompt && !activeMemoryId) hintText = discoveryPrompt
  if (!hintText && activityPrompt && !activeMemoryId) hintText = activityPrompt
  if (!hintText && !activeMemoryId && !finaleMessage && !avatarRT().paused) {
    if (nearSecret) hintText = "the cat found something…"
    else if (nearMemory && !visited)
      hintText = "E — look closer"
    else if (gardenReady) hintText = "Nine stars found. Follow the lantern path to the garden."
    else if (avatarRT().idleTime > 4 && avatarRT().idleTime < 9 && riderRT[characterRT.active].phase === "none")
      hintText = "Y — whistle for your Pegasus"
    // while the welcome tips are up they do the teaching: no second voice saying the same
    else if (stars === 0 && avatarRT().idleTime < 60 && useControlsUI.getState().tip === null)
      hintText =
        !hasLooked
          ? "drag to look · click for free look · wheel to zoom · WASD to walk"
          : "WASD to walk · Space to jump · find the little stars"
  }

  return (
    <div className="hud on">
      <div ref={shade} className="character-transition" aria-hidden="true" />
      <div className="hud-stars" aria-label={`${stars} of ${TOTAL_STARS} little stars`}>
        {Array.from({ length: TOTAL_STARS }, (_, i) => (
          <span key={i} className={i < stars ? "" : "empty"}>
            ✦
          </span>
        ))}
      </div>
      <div className="hud-found" aria-label={`${found} surprises found`} title="surprises found in the wide world">
        <span>✿</span> {found}
      </div>
      <DiscoveryToastCard />
      <DeerHud />
      <label className="hud-quality">
        <span className="sr-only">Visual quality</span>
        <select aria-label="Visual quality" value={quality} onChange={(e) => setQuality(e.target.value as QualityMode)}>
          <option value="auto">Auto quality</option>
          <option value="high">High quality</option>
          <option value="medium">Balanced</option>
          <option value="low">Light</option>
        </select>
      </label>
      {unlocked && <button
        className="hud-character"
        onClick={() => { input.switchCharacter = true }}
        disabled={!switchable}
        aria-label={`Switch to ${activeCharacter === "explorer" ? `${names.companion}` : `${names.explorer}`}`}
        title="Q · Switch character"
      >
        <span>{activeCharacter === "explorer" ? `${names.explorer}` : `${names.companion}`}</span>
        <kbd>Q</kbd>
      </button>}
      <CameraViewButton />
      <PegasusWhistle />
      <ControlLegend />
      <button className="hud-mute" onClick={() => { initAudio(); toggleAudio() }} aria-label={audioOn ? "Mute" : "Unmute"}>
        {audioOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
      </button>
      <button
        className="hud-time"
        data-mode={timeMode}
        onClick={cycleTimeMode}
        aria-label={`World time: ${timeMode}. Change world time`}
        title={`World time: ${timeMode}`}
      >
        {timeMode === "day" ? <Sun size={18} /> : timeMode === "night" ? <Moon size={18} /> : <SunMoon size={18} />}
        <span>{timeMode}</span>
      </button>
      {hintText && <div className={`hud-hint${hint || discoveryPrompt || activityPrompt || nearMemory || nearSecret ? " is-contextual" : ""}`} key={hintText}>{!/^E —/.test(hintText) ? hintText : <><kbd>E</kbd>{hintText.slice(4)}</>}</div>}
    </div>
  )
}

/** Little card that floats up when the explorer discovers something. */
const DiscoveryToastCard = (): React.ReactElement | null => {
  const toast = useDiscoveries((s) => s.toast)
  const clear = useDiscoveries((s) => s.clearToast)
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => clear(toast.id), 6500)
    return () => window.clearTimeout(t)
  }, [toast, clear])
  if (!toast) return null
  return (
    <div className="discovery-toast" key={toast.id} role="status">
      <div className="discovery-title">{toast.title}</div>
      <div className="discovery-line">{toast.line}</div>
    </div>
  )
}

/** Always-visible whistle for your own Pegasus, with its key. */
const PegasusWhistle = (): React.ReactElement | null => {
  const [info, setInfo] = useState<{ name: string; far: boolean } | null>(null)
  useEffect(() => {
    const iv = window.setInterval(() => {
      const p = ownPegasusInfo()
      const riding = riderRT[characterRT.active].phase !== "none"
      const next = p && !riding && !worldRT.introActive && !worldRT.finaleActive ? { name: p.name, far: p.distance > 6 } : null
      setInfo((prev) => (prev?.name === next?.name && prev?.far === next?.far ? prev : next))
    }, 300)
    return () => clearInterval(iv)
  }, [])
  if (!info) return null
  return (
    <button
      className="hud-whistle"
      onClick={() => pushAction("callPegasus")}
      aria-label={`Whistle for ${info.name}, your Pegasus (Y)`}
      title={`Whistle for ${info.name} — ${info.far ? "comes from wherever they are" : "right beside you"}`}
    >
      <Feather size={16} />
      <span>Whistle for {info.name}</span>
      <kbd>Y</kbd>
    </button>
  )
}

/** The camera view (Far, Medium, Close); Tab cycles it too. */
const CameraViewButton = (): React.ReactElement => {
  const [view, setView] = useState<CameraView>(viewRT.view)
  useEffect(() => {
    const id = window.setInterval(() => setView((v) => (v === viewRT.view ? v : viewRT.view)), 250)
    return () => window.clearInterval(id)
  }, [])
  return (
    <button
      className="hud-camera"
      onClick={(e) => { pushAction("cameraView"); e.currentTarget.blur() }}
      aria-label={`Camera view: ${CAMERA_VIEWS[view].label}. Change view (Tab)`}
      title="Tab · Camera view"
    >
      <SwitchCamera size={16} />
      <span>{CAMERA_VIEWS[view].label}</span>
    </button>
  )
}
