import { useCallback, useEffect } from "react"
import { ArrowRight, Check, Eye, Sparkles, X } from "lucide-react"
import { useObservation, nextObservationStop } from "../state/observationStore"
import { OBSERVATION_JOURNEYS, observationJourney } from "../game/celestial/observations"
import { sailRT } from "../game/celestial/starSail"
import { sendSky } from "../state/skyStore"
import { useGame } from "../state/gameStore"
import { ridingCelestial } from "../game/celestial/CelestialController"
import { useDialogFocus } from "./useDialogFocus"
import { useExplorationUI } from "../state/explorationUIStore"
import { useNavigation } from "../state/navigationStore"
import { names } from "../personalization"

export const ObservationInvitations = (): React.ReactElement => {
  const start = (id: string): void => {
    if (!ridingCelestial()) { useGame.getState().showHint(`${names.starborn} carries these journeys. Press I to call her, then climb on.`); return }
    useObservation.getState().start(id)
    const journey = observationJourney(id)!
    useNavigation.getState().choose({ kind: "body", id: journey.body, name: journey.body === "moon" ? "The Moon" : "Saturn" })
    sendSky({ observation: { journey: id, stop: useObservation.getState().stop } })
  }
  return <section className="atlas-journeys" aria-label="Celestial adventures"><h3><Sparkles /> A little wonder awaits</h3>{OBSERVATION_JOURNEYS.map(j => <button key={j.id} onClick={() => start(j.id)}><span>{j.title}</span><small>{nextObservationStop(j.id) < 0 ? "Visit again" : "Three viewpoints · guided journey"}</small><ArrowRight /></button>)}</section>
}

export const ObservationJourneys = (): React.ReactElement | null => {
  const s = useObservation(), journey = s.journey ? observationJourney(s.journey) : undefined
  const panel = useExplorationUI(s => s.panel)
  const dismiss = useCallback(() => useExplorationUI.getState().open(null), [])
  const dialog = useDialogFocus<HTMLElement>(!!journey && panel === "observation", dismiss)
  useEffect(() => {
    const release = (): void => useObservation.getState().hold(false)
    window.addEventListener("blur", release)
    document.addEventListener("visibilitychange", release)
    return () => { window.removeEventListener("blur", release); document.removeEventListener("visibilitychange", release) }
  }, [])
  if (!journey || panel !== "observation") return null
  const stop = journey.stops[s.stop], last = s.stop === journey.stops.length - 1
  const close = (): void => { s.close(); sendSky({ cancel: true }); dismiss() }
  const next = (): void => { s.next(); sendSky({ observation: { journey: journey.id, stop: useObservation.getState().stop } }) }
  return <aside id="explore-observation" ref={dialog} role="dialog" aria-modal="true" className="observation-card" aria-label="Celestial observation journey">
    <header><span><Sparkles /> {journey.title}</span><button aria-label="Fold observation details" onClick={dismiss}><X /></button></header>
    <small className="observation-step">VIEW {s.stop + 1} OF {journey.stops.length}</small>
    <h3>{stop.title}</h3>
    <p>{s.completed ? stop.line : journey.invitation}</p>
    <p className="observation-reading">{s.reading || `${names.starborn} is finding our viewpoint.`}</p>
    {s.completed ? <button className="observation-watch" onClick={last ? close : next}>{last ? <Check /> : <ArrowRight />}{last ? "A memory to keep · finish" : "On to the next view"}</button> : <button className="observation-watch" disabled={!s.ready} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); s.hold(true) }} onPointerUp={() => s.hold(false)} onPointerCancel={() => s.hold(false)} onKeyDown={e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); s.hold(true) } }} onKeyUp={e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); s.hold(false) } }} onBlur={() => s.hold(false)}><Eye />{s.ready ? "Hold to watch together" : "Sailing to our viewpoint…"}</button>}
    {!s.completed && !s.ready && sailRT.autopilot?.kind !== "observation" && <button className="observation-resume" onClick={() => sendSky({ observation: { journey: journey.id, stop: s.stop } })}>Resume our viewpoint <ArrowRight /></button>}
    {!s.completed && <progress max={1} value={s.progress} aria-label="Observation progress" />}
    <button className="observation-resume" onClick={close}>End this journey</button>
    <footer>{s.completed ? `${journey.source} · remembered in your voyage` : "Steer to take the reins. No landing on other planets."}</footer>
  </aside>
}
