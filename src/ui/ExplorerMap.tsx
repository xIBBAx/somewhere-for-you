import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowUp, ArrowUpRight, BookOpen, Check, Compass, Eye, Feather, Home, MapPin, Minus, Plus, X } from "lucide-react"
import { HOME, isMark, useNavigation, type Destination } from "../state/navigationStore"
import { useSky, sendSky } from "../state/skyStore"
import { useObservation } from "../state/observationStore"
import { useTravel } from "../state/travelStore"
import { useAdventures } from "../state/adventureStore"
import { usePhoto } from "../game/activities/photo"
import { type AtlasMarker } from "../game/navigation/atlasSnapshot"
import { navigationSnapshot } from "../game/navigation/navigationState"
import { ArrivalTracker } from "../game/navigation/arrival"
import { autoZoomIndex, minimapView, RANGES } from "../game/navigation/minimapRules"
import { formatBearing, groundDistance, rotateMapPoint } from "../game/navigation/atlasMath"
import { fastTravelTo } from "../game/travel/fastTravel"
import { skyRangeLabel } from "../game/navigation/navigationUnits"
import { CATS_TARGET } from "../game/celestial/spaceCats/journey"
import { ridingCelestial } from "../game/celestial/CelestialController"
import { useGame } from "../state/gameStore"
import { ObservationInvitations } from "./ObservationJourneys"
import { useExplorationUI } from "../state/explorationUIStore"
import { useDialogFocus } from "./useDialogFocus"
import { MiniRadar } from "./MiniRadar"
import { WorldMap } from "./WorldMap"
import { PICKER_BODIES } from "./PlanetTravel"
import "./explorerMap.css"
import { names } from "../personalization"

const PHASE_LABEL: Record<string, string> = { gather: "Gathering", corridor: "Star corridor", emerge: "Emerging", reentry: "Re-entry" }
type View = ReturnType<typeof navigationSnapshot>

/** The nearest place already discovered, for the corner's label when nothing is marked. */
const nearestFound = (v: View): AtlasMarker | null => {
  let best: AtlasMarker | null = null, bestDistance = Infinity
  for (const m of v.earth) {
    if (!m.found) continue
    const d = Math.hypot(m.x - v.x, m.z - v.z)
    if (d < bestDistance) { best = m; bestDistance = d }
  }
  return best
}

/** One coordinate snapshot drives the ink, markers, readout and inverse pins.
 * The corner radar is always on in play; the full chart opens by choice. */
export const ExplorerMap = (): React.ReactElement | null => {
  const [zoom, setZoom] = useState(0), [manual, setManual] = useState(false), [expanded, setExpanded] = useState(false)
  const zoomRef = useRef(0), manualRef = useRef(false), zoomAt = useRef(0)
  const range = RANGES[zoom]
  const panel = useExplorationUI(s => s.panel), mode = useExplorationUI(s => s.mode)
  const destination = useNavigation(s => s.destination), choose = useNavigation(s => s.choose)
  const [view, setView] = useState(() => navigationSnapshot(destination, range))
  const open = panel === "atlas"
  const dismiss = useCallback(() => useExplorationUI.getState().open(null), [])
  const chartOpen = useSky(s => s.chartOpen), activeMemory = useGame(s => s.activeMemoryId)
  const covering = useGame(s => !!s.activeSecretId || s.finaleMessage), book = useAdventures(s => s.open), photo = usePhoto(s => s.open)
  const picker = useTravel(s => s.pickerOpen), travelPhase = useTravel(s => s.phase), travelName = useTravel(s => s.name), travelProgress = useTravel(s => s.progress)
  const journey = useObservation(s => s.journey)
  const presentation = minimapView({ modal: chartOpen || !!activeMemory || covering || book || photo || picker, atlasOpen: open, travelPhase })
  // (the focus trap only while the atlas is really on screen: a card over it owns Escape)
  const dialog = useDialogFocus<HTMLElement>(open && presentation === "atlas", dismiss)
  useEffect(() => {
    // One 10 Hz poll: automatic zoom follows movement (with a hold so it never flickers), manual zoom sticks.
    const update = (): void => {
      if (document.hidden) return
      let next = navigationSnapshot(useNavigation.getState().destination, RANGES[zoomRef.current])
      const now = performance.now()
      if (!manualRef.current && now - zoomAt.current > 1500) {
        const want = autoZoomIndex({ flying: !!next.flight, airborne: next.airborne, mounted: next.mounted, altitude: next.altitude }, zoomRef.current)
        if (want !== zoomRef.current) {
          zoomAt.current = now; zoomRef.current = want; setZoom(want)
          next = navigationSnapshot(useNavigation.getState().destination, RANGES[want])
        }
      }
      setView(next)
      arrival(next)
    }
    // Arriving at an Earth destination says so once and ends the guidance (a mark
    // stays in Places to come back to). Only once the player has been away from it: a
    // mark left where the player stands is not "arrived" the moment it is made.
    const arrivals = new ArrivalTracker()
    const arrival = (v: View): void => {
      const d = useNavigation.getState().destination
      if (!d || d.kind !== "earth" || v.flight || v.horizontal === null) { arrivals.update(null, false, false); return }
      if (!arrivals.update(d.id, v.arrived, v.horizontal >= (isMark(d) ? 10 : 4))) return
      useGame.getState().showHint(isMark(d) ? `You made it to your mark. It's kept in Places on the World map.` : `You've reached ${d.name}.`)
      useNavigation.getState().choose(null)
    }
    const timer = window.setInterval(update, 100)
    update()
    return () => clearInterval(timer)
  }, [])
  const setZoomLevel = (level: number, fixed: boolean): void => {
    zoomRef.current = level; manualRef.current = fixed; zoomAt.current = performance.now()
    setZoom(level); setManual(fixed)
  }
  const zoomBy = (step: number): void => setZoomLevel(Math.min(RANGES.length - 1, Math.max(0, zoomRef.current + step)), true)
  const select = (d: Destination): void => {
    choose(d)
    if (d.kind === "body") sendSky({ target: d.id })
    else if (d.kind === "cats") sendSky({ target: CATS_TARGET })
    setExpanded(false)
  }
  const home = (): void => { choose(HOME); if (view.sky) sendSky({ home: true, ensure: true }); setExpanded(false) }
  // an Earth destination from the sky: back to Earth first (Homeward); the mark waits there
  const canTravel = !!ridingCelestial() && !!destination
  const travel = (): void => {
    if (!destination || !canTravel) return
    if (destination.kind === "earth") sendSky({ home: true, ensure: true })
    else if (destination.kind === "site") sendSky({ site: destination.id, travel: true, ensure: true })
    else sendSky({ target: destination.kind === "cats" ? CATS_TARGET : destination.id, travel: true, ensure: true })
  }
  /** Fast travel on Earth: a refusal is shown as a hint; success closes the atlas so the walk-on is visible. */
  const travelTo = (place: Destination): void => {
    if (place.kind !== "earth") return
    const reason = fastTravelTo({ x: place.x, z: place.z, name: place.name })
    if (reason) { useGame.getState().showHint(reason); return }
    setExpanded(false); useExplorationUI.getState().open(null)
  }
  /** Sky destinations are chosen in the planet picker (Direct to Planets). */
  const openPicker = (place: Destination): void => {
    // a moon the picker doesn't list is sailed to directly: never a picker without it
    if (place.kind === "body" && !PICKER_BODIES.has(place.id)) {
      select(place)
      if (ridingCelestial()) { sendSky({ target: place.id, travel: true, ensure: true }); useExplorationUI.getState().open(null) }
      else useGame.getState().showHint(`Ride ${names.starborn} to sail to ${place.name}.`)
      return
    }
    select(place); useExplorationUI.getState().open(null); useTravel.getState().setPicker(true, place.kind === "body" ? place.id : undefined)
  }
  if (presentation === "hidden") return null
  if (presentation === "journey") {
    const fraction = Math.min(1, Math.max(0, travelProgress))
    return <section className={`navigator-mini is-journey${mode === "immersive" ? " is-immersive" : ""}`} aria-label="Cosmic journey">
      <div className="navigator-mini-ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" /><circle className="ring-progress" cx="50" cy="50" r="46" strokeDasharray={`${fraction * 289} 289`} /></svg><span>{Math.round(fraction * 100)}%</span></div>
      <span className="navigator-mini-label"><b>{travelName || "Cosmic journey"}</b>{PHASE_LABEL[travelPhase] && <small>{PHASE_LABEL[travelPhase]}</small>}</span>
    </section>
  }
  const target = view.projection ? rotateMapPoint(view.projection.x, view.projection.y, view.heading) : null
  const readout = <CourseReadout view={view} />
  const radar = (mini: boolean) => !view.sky ? <div className="atlas-disc is-mini"><MiniRadar range={range} /></div> : <div className={`atlas-disc${mini ? " is-mini" : ""}`}>
    <svg className="atlas-rose" viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="87" /><path d="M95 13h10M95 187h10M13 95v10M187 95v10" />
      <circle cx="100" cy="100" r="35" /><circle cx="100" cy="100" r="62" />
      {view.north !== null && ["N", "E", "S", "W"].map((label, i) => { const a = (view.north! + i * 90) * Math.PI / 180, p = rotateMapPoint(100 + Math.sin(a) * 96, 100 - Math.cos(a) * 96, view.heading); return <text key={label} x={p.x} y={p.y + 3}>{label}</text> })}
    </svg>
    {view.stars.filter(m => !m.vertical && !m.coincident).map(m => { const p = rotateMapPoint(m.x, m.y, view.heading); return mini ? <span key={`${m.destination.kind}:${m.destination.id}`} className="atlas-mini-dot" style={{ left: `${p.x / 2}%`, top: `${p.y / 2}%`, color: m.color }} /> : <button key={`${m.destination.kind}:${m.destination.id}`} className={`atlas-star${m.destination.id === destination?.id ? " selected" : ""}`} style={{ left: `${p.x / 2}%`, top: `${p.y / 2}%`, color: m.color }} aria-label={`Select ${m.destination.name}`} title={`${m.destination.name} · ${skyRangeLabel(m)}`} onClick={() => select(m.destination)}><span />{(m.destination.id === "earth" || m.destination.id === "moon" || destination?.id === m.destination.id) && <small>{m.destination.name}</small>}</button> })}
    {target && !view.projection?.vertical && !view.projection?.coincident && <span className="atlas-course-point" style={{ left: `${target.x / 2}%`, top: `${target.y / 2}%` }} aria-hidden="true" />}
    <span className="atlas-you" aria-label={`Facing ${view.facing === null ? "local forward; north undefined" : formatBearing(view.facing)}`}><svg viewBox="0 0 20 24"><path d="M10 2L18 21L10 17L2 21Z" /></svg></span>
  </div>
  if (!open) {
    const near = !view.sky && !destination && !view.flight ? nearestFound(view) : null
    const name = near ? near.destination.name : view.name
    const detail = near ? groundDistance(Math.hypot(near.x - view.x, near.z - view.z)) : view.distance
    return <section className={`navigator-mini${view.sky ? " is-sky" : ""}${mode === "immersive" ? " is-immersive" : ""}`} aria-label="Compact navigator" data-nav-mode={view.sky ? "sky" : "ground"} data-nav-target={destination ? `${destination.kind}:${destination.id}` : undefined} data-nav-reference={view.reference} data-nav-bearing={view.bearing ?? undefined} data-nav-elevation={view.elevation ?? undefined} data-nav-arrived={view.arrived}>
      <button className="navigator-mini-map" onClick={() => useExplorationUI.getState().open("atlas")} aria-label="Open navigator">{radar(true)}</button>
      <button className="navigator-mini-course" onClick={() => useExplorationUI.getState().open(view.sky && journey && view.flight?.kind === "observation" ? "observation" : "atlas")}>
        <span className="navigator-mini-label"><b>{name}</b>{detail && <small>{detail}</small>}{(destination || view.flight) && view.directionText && <small className="navigator-mini-direction">{view.directionText}</small>}</span>
      </button>
    </section>
  }
  if (!view.sky) return <aside id="explore-atlas" ref={dialog} role="dialog" aria-modal="true" className="explorer-world nav-refined" aria-label="World map" data-nav-bearing={view.bearing ?? undefined} data-nav-reference={view.reference}>
    <WorldMap view={view} onClose={dismiss} onTravel={travelTo} />
  </aside>
  const choices = view.sky ? view.stars.map(m => ({ destination: m.destination, detail: skyRangeLabel(m) })) : view.earth.map(m => ({ destination: m.destination, detail: `${groundDistance(Math.hypot(m.x - view.x, m.z - view.z))} horizontal${m.found ? "" : " · discover"}` }))
  choices.sort((a, b) => Number(b.destination.id === "home" || b.destination.id === "earth") - Number(a.destination.id === "home" || a.destination.id === "earth") || a.destination.name.localeCompare(b.destination.name))
  return <aside id="explore-atlas" ref={dialog} role="dialog" aria-modal="true" className={`explorer-atlas nav-refined${view.sky ? " is-sky" : ""}${expanded ? " is-expanded" : ""}`} aria-label={view.sky ? "Celestial navigator" : "World atlas"} data-nav-bearing={view.bearing ?? undefined} data-nav-elevation={view.elevation ?? undefined} data-nav-reference={view.reference}>
    <header className="atlas-heading"><Compass /><span className="atlas-title">{view.sky ? "Beyond the blue" : "This world"}</span><button className="atlas-icon" aria-label="Close navigator" onClick={dismiss}><X /></button></header>
    {!expanded && <div className="atlas-main">{radar(false)}<div className="atlas-information">{readout}
      <p className="atlas-frame">{view.sky ? view.north === null ? "North undefined · local horizon" : `${view.reference} north · local horizon` : "World grid · heading up"}<br />{view.sky ? "Real-equivalent distances · logarithmic radar" : `${groundDistance(range)} radius · 5 m contours`}</p>
      {!view.sky && <p className="atlas-position">E {view.x.toFixed(1)} / N {(-view.z).toFixed(1)}<br />{view.facing === null ? "North undefined at this pole" : `Facing ${formatBearing(view.facing)}`}</p>}
      {view.sky && view.stars.filter(m => m.vertical || m.coincident).map(m => <button key={`vertical:${m.destination.kind}:${m.destination.id}`} className="atlas-vertical" onClick={() => select(m.destination)}>{m.coincident ? "◎" : m.elevation > 0 ? "↑" : "↓"} {m.destination.name} · {m.coincident ? "here" : m.elevation > 0 ? "directly above" : "directly below"}</button>)}
      {view.unavailable && <p className="atlas-note">This destination is not available in the current frame. No direction is shown.</p>}
      {view.flight && destination && <small className="atlas-selection">Selected: {destination.name}<br />Selection does not change the guided course.</small>}
    </div></div>}
    <nav className="atlas-actions" aria-label="Navigation controls"><button onClick={home} aria-label={view.sky ? "Sail home to the meadow" : "Guide me home"}><Home /><span>Home</span></button><button aria-label="Choose a destination" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><MapPin /><span>Places</span></button>{!view.sky && <><button className="atlas-icon" aria-label="Zoom map in" disabled={zoom === 0} onClick={() => zoomBy(-1)}><Plus /></button><button className="atlas-icon" aria-label="Zoom map out" disabled={zoom === RANGES.length - 1} onClick={() => zoomBy(1)}><Minus /></button><button className="atlas-auto" aria-label="Automatic zoom" aria-pressed={!manual} onClick={() => setZoomLevel(zoomRef.current, false)}><span>Auto</span></button></>}{view.sky && <button onClick={() => useSky.getState().setChart(true)} aria-label="Open the star chart"><BookOpen /></button>}</nav>
    {(destination || view.flight) && <div className="atlas-course">{view.sky && destination && <button disabled={!canTravel} onClick={travel}><ArrowUpRight />{destination.kind === "earth" ? destination.id === "home" ? "Return near home" : "Back to Earth, then follow it" : "Set selected course"}</button>}{!view.sky && destination?.kind === "earth" && <button onClick={() => travelTo(destination)}><Feather />Travel there</button>}{view.flight && <button onClick={() => sendSky({ cancel: true })}>Take reins</button>}{destination && <button className="atlas-icon" aria-label="Clear marked destination" onClick={() => choose(null)}><X /></button>}</div>}
    {expanded && <section className="atlas-places" aria-label="Available destinations"><div><b>{view.sky ? "Celestial destinations" : "A place in this world"}</b><button className="atlas-icon" aria-label="Close destinations" onClick={() => setExpanded(false)}><X /></button></div>{choices.map(m => <div className="atlas-place" key={`${m.destination.kind}:${m.destination.id}`}>
      <button onClick={() => select(m.destination)}><span>{m.destination.name}</span><small>{m.detail}</small></button>
      {m.destination.kind === "earth" && <button className="atlas-place-travel" aria-label={`Travel to ${m.destination.name}`} onClick={() => travelTo(m.destination)}><Feather /><span>Travel there</span></button>}
      {m.destination.kind === "body" && <button className="atlas-place-travel" aria-label={`Travel to ${m.destination.name} by planet picker`} onClick={() => openPicker(m.destination)}><ArrowUpRight /><span>Travel</span></button>}
    </div>)}{view.sky && <ObservationInvitations />}</section>}
    <p className="atlas-note">{view.sky ? "Diamonds mark the actual guided waypoint; body dots mark centres. Elevation is above the local horizon. Marker sizes are symbolic." : "Straight bearings and horizontal distances · choose your own safe path. On the World map, click open ground or press X to leave a mark."}</p>
    <span className="sr-only" role="status">{view.arrived && !view.flight ? `At ${view.name}` : ""}</span>
  </aside>
}

const CourseReadout = ({ view }: { view: View }): React.ReactElement => <div className="atlas-guidance">
  <span className="atlas-guidance-kicker">{view.flight ? "GUIDED COURSE" : "MARKED DESTINATION"}</span>
  <strong>{view.name}</strong>
  <span className="atlas-direction">{view.arrived && !view.flight ? <Check /> : view.flight?.holding ? <Eye /> : view.bearing !== null ? <ArrowUp style={{ transform: `rotate(${view.bearing - view.heading}deg)` }} /> : null}<b>{view.bearingText ?? (view.projection?.coincident ? "At the waypoint" : view.projection?.vertical ? view.elevation! > 0 ? "Directly above" : "Directly below" : "")}</b>{view.elevation !== null && !view.projection?.coincident && <small>{view.elevation > 0 ? "+" : ""}{view.elevation.toFixed(1)}° elevation</small>}</span>
  <small>{view.detail}</small>
</div>
