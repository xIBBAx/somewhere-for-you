import { useCallback, useEffect, useState } from "react"
import { Home, Orbit, Sparkles, X, Zap } from "lucide-react"
import { useTravel, requestJourney } from "../state/travelStore"
import { ridingCelestial } from "../game/celestial/CelestialController"
import { spaceRT } from "../game/celestial/spaceState"
import { voyage } from "../game/celestial/voyageMemory"
import { waitingInSpace } from "../game/celestial/spaceCats/journey"
import { pushAction } from "../game/runtime"
import type { TravelDestination } from "../game/celestial/cosmicTravel"
import { canLand } from "../game/celestial/realm/realmState"
import { useDialogFocus } from "./useDialogFocus"
import "./planetTravel.css"
import { names } from "../personalization"

/**
 * Direct to Planets: every world Starborn can reach, one tap away. "Journey"
 * runs the star corridor (skippable at any moment); "Arrive now" is a
 * heartbeat's flash. Opened with N (or the travel button), closed with Esc.
 */

type Row = { dest: TravelDestination; name: string; line: string }

/** What the explorer can do there, said plainly: only the Moon can be walked on; everywhere else is a fly-by with something waiting */
const visitKind = (d: TravelDestination): string | null =>
  d.kind === "rings" ? "Fly through" : d.kind !== "body" ? null : canLand(d.id) ? "Land and walk" : d.id === "sun" ? "Fly near" : "Fly around"

const WORLDS: Row[] = [
  { dest: { kind: "body", id: "moon" }, name: "The Moon", line: "Land in the grey dust and walk where astronauts walked" },
  { dest: { kind: "body", id: "mars" }, name: "Mars", line: "See its red deserts and the tallest volcano from above; dust dancers wait nearby" },
  { dest: { kind: "body", id: "jupiter" }, name: "Jupiter", line: "Fly beside the Great Red Spot; star mantas swim in its aurora" },
  { dest: { kind: "body", id: "saturn" }, name: "Saturn", line: "The ringed giant from beside its rings" },
  { dest: { kind: "rings" }, name: "Saturn's rings", line: "Fly among the ice itself: boulders and glittering grains, the gaps, the dense B ring" },
  { dest: { kind: "body", id: "venus" }, name: "Venus", line: "The brightest planet, wrapped in golden cloud" },
  { dest: { kind: "body", id: "mercury" }, name: "Mercury", line: "Small, scorched and close to the Sun" },
  { dest: { kind: "body", id: "uranus" }, name: "Uranus", line: "A pale teal world rolling on its side" },
  { dest: { kind: "body", id: "neptune" }, name: "Neptune", line: "Deep blue, windy and far" },
  { dest: { kind: "body", id: "pluto" }, name: "Pluto", line: "A little world with a heart of ice" },
  { dest: { kind: "body", id: "sun" }, name: "The Sun", line: "Our star, seen from a safe distance" },
]
const MOONS: Row[] = [
  { dest: { kind: "body", id: "titan" }, name: "Titan", line: "Saturn's moon in an orange haze" },
  { dest: { kind: "body", id: "europa" }, name: "Europa", line: "An ocean hidden under ice" },
  { dest: { kind: "body", id: "io" }, name: "Io", line: "Volcanoes everywhere, yellow as sulphur" },
  { dest: { kind: "body", id: "ganymede" }, name: "Ganymede", line: "The largest moon of all" },
  { dest: { kind: "body", id: "enceladus" }, name: "Enceladus", line: "Fountains of ice into space" },
]

/** The worlds the picker offers (others are sailed to straight from the navigator). */
export const PICKER_BODIES: ReadonlySet<string> = new Set([...WORLDS, ...MOONS].flatMap(r => r.dest.kind === "body" ? [r.dest.id] : []))

export const PlanetTravel = (): React.ReactElement | null => {
  const open = useTravel(s => s.pickerOpen)
  // Mount a fresh snapshot with the dialog: the first tap must not depend on
  // an old mount/realm snapshot waiting for the next polling interval.
  return open ? <PlanetPicker /> : null
}

const PlanetPicker = (): React.ReactElement => {
  const close = useCallback(() => useTravel.getState().setPicker(false), [])
  const dialog = useDialogFocus(true, close)
  const focusBody = useTravel(s => s.pickerBodyId)
  const [state, setState] = useState(() => snapshot())
  useEffect(() => {
    const timer = window.setInterval(() => setState(snapshot()), 400)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!focusBody || !dialog.current) return
    const row = Array.from(dialog.current.querySelectorAll<HTMLElement>("[data-travel-body]")).find(el => el.dataset.travelBody === focusBody)
    row?.scrollIntoView({ block: "nearest" })
    const button = row?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?? dialog.current.querySelector<HTMLButtonElement>(".pt-call button, button:not(:disabled)")
    button?.focus({ preventScroll: true })
  }, [focusBody, dialog])
  const go = (dest: TravelDestination, style: "cinematic" | "quick"): void => {
    requestJourney(dest, style)
    close()
  }
  const row = (r: Row): React.ReactElement => <li key={`${r.dest.kind}:${"id" in r.dest ? r.dest.id : ""}`} data-travel-body={r.dest.kind === "body" ? r.dest.id : undefined} tabIndex={r.dest.kind === "body" && focusBody === r.dest.id ? -1 : undefined} aria-current={r.dest.kind === "body" && focusBody === r.dest.id ? "true" : undefined} className={`${r.dest.kind === "body" && state.here === r.dest.id ? "is-here" : ""}${r.dest.kind === "body" && focusBody === r.dest.id ? " is-selected" : ""}`}>
    <span className="pt-name"><b>{r.name}{visitKind(r.dest) && <em className={`pt-kind${visitKind(r.dest) === "Land and walk" ? " is-land" : ""}`}>{visitKind(r.dest)}</em>}</b><small>{r.line}</small>{r.dest.kind === "body" && focusBody === r.dest.id && <small>Selected destination</small>}</span>
    <span className="pt-go">
      <button data-short="Journey" disabled={!state.starborn} onClick={() => go(r.dest, "cinematic")} aria-label={`Journey to ${r.name}`}><Sparkles /><span>Journey</span></button>
      <button data-short="Now" disabled={!state.starborn} onClick={() => go(r.dest, "quick")} aria-label={`Arrive at ${r.name} now`}><Zap /><span>Arrive now</span></button>
    </span>
  </li>
  return <div className="pt-scrim" onPointerDown={e => { if (e.target === e.currentTarget) close() }}>
    <div className="pt-card" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="pt-title">
      <header><Orbit /><div><small>DIRECT TO THE WORLDS</small><h2 id="pt-title">Where shall {names.starborn} take us?</h2></div><button className="pt-close" onClick={close} aria-label="Close"><X /></button></header>
      {!state.starborn && <div className="pt-call">
        <p>Only {names.starborn}, the star-born, can carry you between worlds.</p>
        <button onClick={() => { pushAction("callStarborn"); close() }}><Sparkles /><span>Call {names.starborn}</span><kbd>I</kbd></button>
      </div>}
      {state.away && <div className={`pt-home${focusBody === "earth" ? " is-selected" : ""}`} data-travel-body="earth" tabIndex={focusBody === "earth" ? -1 : undefined} aria-current={focusBody === "earth" ? "true" : undefined}>
        <span className="pt-name"><b>Earth · home</b><small>Fall home through the glowing air, then fly wherever you like</small></span>
        <span className="pt-go">
          <button data-short="Journey" disabled={!state.starborn} onClick={() => go({ kind: "earth" }, "cinematic")}><Home /><span>Return journey</span><kbd>K</kbd></button>
          <button data-short="Now" disabled={!state.starborn} onClick={() => go({ kind: "earth" }, "quick")}><Zap /><span>Home now</span></button>
        </span>
      </div>}
      <div className="pt-lists">
        {state.cats && <section><h3>Waiting out there</h3><ul>{row({ dest: { kind: "cats" }, name: voyage.cats === "unseen" ? "Five little lights" : "The space cats", line: "Something small and warm is floating at the Earth–Moon L1 point" })}</ul></section>}
        <section><h3>Worlds</h3><ul>{WORLDS.map(row)}</ul></section>
        <section><h3>Moons</h3><ul>{MOONS.map(row)}</ul></section>
      </div>
      <footer>On a journey, E arrives at once and Esc stops in open space. Every journey ends with {names.starborn} in your hands.</footer>
    </div>
  </div>
}


const snapshot = () => ({
  starborn: !!ridingCelestial(),
  away: spaceRT.mode === "deep" || spaceRT.realm !== "earth" || spaceRT.earthAltitude > 2000,
  here: spaceRT.mode === "deep" || spaceRT.realm !== "earth" ? spaceRT.nearest?.def.id ?? null : "earth",
  cats: waitingInSpace(voyage),
})
