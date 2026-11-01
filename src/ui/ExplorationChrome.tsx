import { usePersonalizeUI } from "./personalize/personalizeStore"
import { story } from "../content/story"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { BookHeart, CircleHelp, CloudSun, Home, LifeBuoy, Orbit, Camera, Compass, Eye, Feather, Flag, Hand, Heart, Moon, RefreshCw, Settings2, Sparkles, SwitchCamera, Volume2, VolumeX, X, Pencil } from "lucide-react"
import { useExplorationUI } from "../state/explorationUIStore"
import { useGame } from "../state/gameStore"
import { useTravel } from "../state/travelStore"
import { useSky } from "../state/skyStore"
import { useObservation } from "../state/observationStore"
import { observationJourney } from "../game/celestial/observations"
import { useAdventures } from "../state/adventureStore"
import { useActivityUI } from "../game/activities/activityState"
import { usePhoto } from "../game/activities/photo"
import { useQuality, type QualityMode } from "../state/qualityStore"
import { useDiscoveries } from "../state/discoveryStore"
import { avatarRT, characterRT, input, pushAction, type GameAction } from "../game/runtime"
import { canSwitchCharacter } from "../game/characters/characterSwitch"
import { companionUnlocked } from "../state/storyProgress"
import { makeContext } from "../game/activities/context"
import { ownPegasusInfo } from "../game/pegasus/whistle"
import { riderRT } from "../game/horses/riding"
import { togetherRT } from "../game/together/togetherState"
import { horseById, horseRT } from "../game/horses/horseState"
import { initAudio } from "../game/audio/audio"
import { useDialogFocus } from "./useDialogFocus"
import { useControlsUI } from "./ControlsGuide"
import { isLive } from "../game/controls/bindings"
import { travelling } from "../game/celestial/cosmicTravel"
import { pegasusLandingControl } from "../game/input"
import { spaceRT } from "../game/celestial/spaceState"
import { SKY_LABEL } from "../game/weather/weatherTypes"
import "./explorationChrome.css"
import { dragonRT } from "../game/dragon/dragonState"
import { refreshUniverse } from "../game/travel/cosmicRefresh"
import { names } from "../personalization"

/** Presentation only: world simulation, save owners and action consumers stay mounted. */
export const ExplorationChrome = ({ children, active }: { children: ReactNode; active: boolean }): React.ReactElement => {
  const mode = useExplorationUI(s => s.mode), panel = useExplorationUI(s => s.panel)
  const gameDialog = useGame(s => !!s.activeMemoryId || !!s.activeSecretId || s.finaleMessage)
  const book = useAdventures(s => s.open), photo = usePhoto(s => s.open)
  const activity = useActivityUI(s => s.mode), result = useActivityUI(s => s.result)
  const fresh = useAdventures(s => s.fresh), toast = useDiscoveries(s => s.toast)
  const skyChart = useSky(s => s.chartOpen), high = useSky(s => s.high), site = useSky(s => s.site)
  const journey = useObservation(s => s.journey), ready = useObservation(s => s.ready), completed = useObservation(s => s.completed)
  const nearest = useSky(s => s.nearest), altitude = useSky(s => s.altitude)
  const picker = useTravel(s => s.pickerOpen)
  // Modal surfaces cover the game and hide the corner minimap; stargazing keeps it.
  const modal = !!gameDialog || book || photo || skyChart || picker
  const blocked = !active || modal || activity === "stars"
  const activeJourney = high ? journey : null
  const priority = activeJourney ? "journey" : activity !== "none" ? "activity" : "explore"
  const notification = result ? "result" : fresh ? "book" : toast ? "discovery" : "none"
  const [announced, setAnnounced] = useState("")
  const previousMode = useRef(mode)
  useEffect(() => {
    if (previousMode.current === mode) return
    previousMode.current = mode
    const timer = window.setTimeout(() => setAnnounced(mode === "immersive" ? "Immersive mode. F2 or Reveal controls brings back exploration tools." : "Minimal HUD. Exploration tools are available in Explore."), 0)
    return () => clearTimeout(timer)
  }, [mode])
  useEffect(() => {
    if (blocked && useExplorationUI.getState().panel) useExplorationUI.getState().open(null)
  }, [blocked])
  useEffect(() => {
    if (panel && document.pointerLockElement) document.exitPointerLock()
    // A hidden watch button cannot continue recording an intentional hold.
    if (panel !== "observation" || mode === "immersive") useObservation.getState().hold(false)
  }, [panel, mode])
  return <div className="exploration-ui" data-ui-mode={mode} data-ui-panel={panel ?? "none"} data-ui-priority={priority} data-ui-notification={notification} data-ui-blocked={blocked || panel === "controls"} data-ui-modal={modal || panel === "controls"} data-ui-sky={high} data-ui-photo={photo}>
    {children}
    {!blocked && <>
      <button className={`explore-reveal${mode === "immersive" ? " is-immersive" : ""}`} aria-label={panel ? "Close exploration tools" : mode === "immersive" ? "Reveal controls" : "Explore: controls and settings"} aria-expanded={!!panel} aria-controls={panel ? `explore-${panel}` : undefined} title="Exploration tools · F2 toggles Immersive Mode" onClick={e => { e.stopPropagation(); useExplorationUI.getState().open(panel ? null : "menu") }}>
        {panel ? <X /> : <Compass />}<span>{panel ? "Back to the world" : mode === "immersive" ? "Reveal" : "Explore"}</span>
      </button>
      {panel && panel !== "menu" && <div className="explore-panel-shield" aria-hidden="true" onPointerDown={e => { e.preventDefault(); e.stopPropagation(); useExplorationUI.getState().open(null) }} />}
      {mode === "minimal" && !panel && (activeJourney || high || site) && <button className="explore-context" onClick={() => useExplorationUI.getState().open(activeJourney ? "observation" : "sky")}>
        {activeJourney ? <Sparkles /> : <Moon />}<span>{activeJourney ? observationJourney(activeJourney)?.title : site?.title ?? nearest}<small>{activeJourney ? completed ? "A memory to keep" : ready ? "Our viewpoint is ready" : "Sailing to our viewpoint" : site ? "Read this place" : altitude}</small></span>
      </button>}
      {panel === "menu" && <ExplorationMenu />}
    </>}
    <span className="sr-only" role="status">{announced}</span>
  </div>
}

const ExplorationMenu = (): React.ReactElement => {
  const close = useCallback(() => useExplorationUI.getState().open(null), [])
  const dialog = useDialogFocus(true, close)
  const mode = useExplorationUI(s => s.mode)
  const quality = useQuality(s => s.mode), setQuality = useQuality(s => s.setMode)
  const audio = useGame(s => s.audioOn), time = useGame(s => s.timeMode), sky = useGame(s => s.sky), stars = useGame(s => s.stars)
  const found = useDiscoveries(s => s.count), unlocked = useGame(companionUnlocked)
  const high = useSky(s => s.high), site = useSky(s => s.site), journey = useObservation(s => s.journey)
  const [context, setContext] = useState(() => menuContext())
  useEffect(() => {
    const timer = window.setInterval(() => setContext(menuContext()), 300)
    return () => clearInterval(timer)
  }, [])
  const action = (a: GameAction): void => { close(); pushAction(a) }
  const pegasusAction = (kind: "landing" | "takeoff" | "dismount"): void => {
    const current = menuContext().landingControls
    if (!current || kind === "takeoff" && !current.ground || kind === "landing" && !current.action) return
    close()
    if (kind === "landing") pushAction("landGallop")
    else if (kind === "takeoff") input.jump = true
    else input.interact = true
  }
  return <div className="explore-menu-scrim" onPointerDown={e => { if (e.target === e.currentTarget) close() }}>
    <div id="explore-menu" className="explore-menu" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="explore-menu-title">
      <header><div><small>{story.title}</small><h2 id="explore-menu-title">A moment, then onward.</h2></div><button onClick={close} aria-label="Return to exploration"><X /></button></header>
      <div className="explore-modes" role="group" aria-label="Exploration interface">
        <button aria-pressed={mode === "minimal"} onClick={() => useExplorationUI.getState().setMode("minimal")}><Compass /><span>Minimal<small>A little guidance</small></span></button>
        <button aria-pressed={mode === "immersive"} onClick={() => useExplorationUI.getState().setMode("immersive")}><Eye /><span>Immersive<small>Only the world</small></span></button>
      </div>
      {context.landingControls && <nav className="explore-tools" aria-label="Pegasus controls">
        {context.landingControls.action && <button onClick={() => pegasusAction("landing")}><Feather /><span>{context.landingControls.action === "land" ? "Land & Gallop" : context.landingControls.action === "keepFlying" ? "Keep Flying" : "Slow to stop"}</span><kbd>R</kbd></button>}
        {context.landingControls.ground && <button onClick={() => pegasusAction("takeoff")}><Feather /><span>Take Off</span><kbd>Space</kbd></button>}
        <button onClick={() => pegasusAction("dismount")}><Hand /><span>{context.landingControls.ground ? "Dismount" : "Land & Dismount"}</span><kbd>E</kbd></button>
      </nav>}
      <nav className="explore-tools" aria-label="Exploration tools">
        <button onClick={() => useControlsUI.getState().openGuide(true)}><CircleHelp /><span>Controls guide</span><kbd>/</kbd></button>
        {isLive("callStarborn") && <button onClick={() => action("callStarborn")}><Sparkles /><span>Summon {names.starborn}</span><kbd>I</kbd></button>}
        {isLive("callDragon") && !context.away && !dragonRT.riding && <button onClick={() => action("callDragon")}><Sparkles /><span>Call {names.dragon}, the golden dragon</span><kbd>1</kbd></button>}
        {isLive("planets") && <button onClick={() => action("planets")}><Orbit /><span>Direct to the planets</span></button>}
        {context.away && <button onClick={() => action("returnEarth")}><Home /><span>Scenic journey to Earth</span></button>}
        {context.away && <button onClick={() => action("quickReturn")}><Home /><span>Home now</span></button>}
        {isLive("recover") && <button onClick={() => action("recover")}><LifeBuoy /><span>Take me somewhere safe</span></button>}
        {isLive("refresh") && <button className="explore-refresh" onClick={() => { close(); refreshUniverse() }} title="If anything lags or someone is stuck: everything is kept and you come back where you stood"><RefreshCw /><span>Refresh the universe<small>Lagging or stuck? Back where you stood, all progress kept</small></span><kbd>F5</kbd></button>}
        <button onClick={() => useExplorationUI.getState().open("atlas")}><Compass /><span>{high ? "Celestial navigator" : "World atlas"}</span></button>
        <button onClick={() => { close(); useAdventures.getState().setOpen(true) }}><BookHeart /><span>The journal</span><kbd>L</kbd></button>
        <button onClick={() => { close(); usePersonalizeUI.getState().setOpen(true) }}><Pencil /><span>Personalize this world</span></button>
        <button disabled={!context.free} onClick={() => action("photo")}><Camera /><span>Make a photograph</span><kbd>P</kbd></button>
        <button onClick={() => action("cameraView")}><SwitchCamera /><span>Far · Medium · Close</span><kbd>Tab</kbd></button>
        {context.pegasus && <button onClick={() => action("callPegasus")}><Feather /><span>Whistle for {context.pegasus}</span><kbd>Y</kbd></button>}
        {context.horse && <button onClick={() => action("callHorse")}><Feather /><span>Call {context.horse}, your horse</span><kbd>U</kbd></button>}
        {context.cancel && <button onClick={() => { close(); input.cancel = true }}><X /><span>Stop this activity</span><kbd>Esc</kbd></button>}
        {context.carried && !context.cancel && <button onClick={() => action("putDown")}><Hand /><span>Put down {context.carried}</span><kbd>Z</kbd></button>}
        {context.pat && <button onClick={() => action("pat")}><Hand /><span>Pat your companion</span><kbd>B</kbd></button>}
        {unlocked && <button disabled={!context.switchable} onClick={() => { close(); input.switchCharacter = true }}><Heart /><span>Explore as {context.active === "explorer" ? `${names.companion}` : `${names.explorer}`}</span><kbd>Q</kbd></button>}
        {context.together && <button onClick={() => useExplorationUI.getState().open("together")}><Heart /><span>A moment together</span></button>}
        {context.free && context.onLand && <button onClick={() => action("race")}><Flag /><span>Race to a light</span><kbd>R</kbd></button>}
        {context.free && context.onLand && context.night && <button onClick={() => action("stars")}><Moon /><span>Read the constellations</span><kbd>X</kbd></button>}
        {journey && <button onClick={() => useExplorationUI.getState().open("observation")}><Sparkles /><span>The observation journey</span></button>}
        {(high || site) && <button onClick={() => useExplorationUI.getState().open("sky")}><Moon /><span>Sky, places & conditions</span></button>}
        {high && <button onClick={() => { close(); useSky.getState().setChart(true) }}><Sparkles /><span>Open the star chart</span><kbd>M</kbd></button>}
      </nav>
      <div className="explore-settings">
        <button onClick={() => { initAudio(); useGame.getState().toggleAudio() }} aria-label={audio ? "Mute sound" : "Enable sound"}>{audio ? <Volume2 /> : <VolumeX />}<span>Sound {audio ? "on" : "off"}</span></button>
        <button onClick={() => useGame.getState().cycleTimeMode()}><Moon /><span>World time: {time}</span></button>
        <button onClick={() => useGame.getState().cycleSky()} title="Choose the weather, or follow your real sky"><CloudSun /><span>Sky: {SKY_LABEL[sky]}</span><kbd>2</kbd></button>
        <label><Settings2 /><span className="sr-only">Visual quality</span><select aria-label="Visual quality" value={quality} onChange={e => setQuality(e.target.value as QualityMode)}><option value="auto">Auto quality</option><option value="high">High quality</option><option value="medium">Balanced</option><option value="low">Light</option></select></label>
      </div>
      <footer><span>✦ {stars} little stars · ✿ {found} surprises</span><p>F2 · hide or restore the HUD. Reveal always brings your tools back.</p></footer>
    </div>
  </div>
}
const menuContext = () => {
  const ctx = makeContext(0, 0), id = characterRT.active, activity = useActivityUI.getState()
  const bonded = horseById(horseRT.bonded[id]), me = avatarRT().pos
  const ridden = riderRT[id].phase === "riding" ? riderRT[id].horse : null
  const flight = ridden?.kind === "horse" ? horseById(ridden.ident.id)?.flight : null
  const landingControls = flight && flight.mode !== "sail" && !travelling()
    ? { action: pegasusLandingControl(flight), ground: flight.mode === "ground" } : null
  return { landingControls, away: spaceRT.realm !== "earth" || spaceRT.mode === "deep", free: ctx.free && activity.mode === "none", night: ctx.night, onLand: ctx.water === "land", active: id,
    switchable: canSwitchCharacter(useGame.getState()) && (id === "companion" || characterRT.companionReady),
    cancel: activity.mode === "race" || activity.mode === "stoneAim", carried: activity.carried,
    horse: riderRT[id].phase === "none" && bonded && Math.hypot(bonded.x - me.x, bonded.z - me.z) > 20 ? bonded.ident.name : null,
    pegasus: riderRT[id].phase === "none" ? ownPegasusInfo()?.name : undefined,
    pat: horseRT.near !== null || riderRT[id].phase === "riding",
    together: characterRT.companionPresent && (togetherRT.partnerNear || togetherRT.action !== "none") }
}
