import { useCallback, useEffect, useState } from "react"
import * as THREE from "three"
import { sendSky, useSky } from "../state/skyStore"
import { navigatorPosition } from "../game/navigation/atlasSnapshot"
import { BODY } from "../game/celestial/bodies"
import { spaceRT } from "../game/celestial/spaceState"
import { universe } from "../game/celestial/universe"
import { formatRealDistance } from "../game/celestial/scale"
import { useExplorationUI } from "../state/explorationUIStore"
import { useDialogFocus } from "./useDialogFocus"
import { LUNAR_SITES } from "../game/celestial/realm/lunarSites"
import { voyage } from "../game/celestial/voyageMemory"
import { pushAction } from "../game/runtime"
import { CATS_TARGET, waitingInSpace } from "../game/celestial/spaceCats/journey"
import { spaceCatsRT } from "../game/celestial/spaceCats/catsRuntime"
import { crewNames } from "../game/celestial/spaceCats/crew"
import { names } from "../personalization"

/**
 * The sky panel while Starborn carries you high (where you are, how fast,
 * where you are heading) and the star chart: every world of the Sun's
 * family, how far it is right now, a true line about it, and "set course".
 */

const GROUPS: Array<{ title: string; ids: string[] }> = [
  { title: "Home", ids: ["earth", "moon"] },
  { title: "The inner worlds", ids: ["sun", "mercury", "venus", "mars", "phobos", "deimos"] },
  { title: "Jupiter's family", ids: ["jupiter", "io", "europa", "ganymede", "callisto"] },
  { title: "Saturn's family", ids: ["saturn", "titan", "enceladus", "mimas", "rhea", "iapetus"] },
  { title: "The ice giants", ids: ["uranus", "titania", "miranda", "neptune", "triton"] },
  { title: "Beyond", ids: ["pluto", "charon"] },
]

const what = (id: string): string => {
  const b = BODY[id]
  if (!b) return ""
  if (id === "earth") return "home"
  if (b.kind === "star") return "star · look, never touch"
  if (b.kind === "gas") return "gas giant · no surface · fly over its clouds"
  if (b.kind === "ice") return "ice giant · no surface · fly over its clouds"
  if (b.landable) return "moon · land and walk"
  return b.kind === "moon" ? "moon · circle and study · no landing" : "world · circle and study · no landing"
}

const StarChart = (): React.ReactElement => {
  const setChart = useSky((s) => s.setChart)
  const close = (): void => setChart(false)
  const dialog = useDialogFocus(true, close)
  const [picked, setPicked] = useState<string>(spaceRT.target ?? "moon")
  const [distances, setDistances] = useState<Map<string, string>>(() => new Map())
  useEffect(() => {
    const position = new THREE.Vector3()
    const update = (): void => {
      navigatorPosition(position)
      const distances = new Map(universe.bodies.map(b => [b.def.id, formatRealDistance(Math.max(0, position.distanceTo(b.pos) - b.radius))]))
      if (spaceCatsRT.podReady) distances.set(CATS_TARGET, formatRealDistance(position.distanceTo(spaceCatsRT.pod)))
      setDistances(distances)
    }
    update()
    const timer = window.setInterval(update, 500)
    return () => clearInterval(timer)
  }, [])
  const go = (id: string): void => {
    sendSky({ target: id, travel: true, ensure: true })
    close()
  }
  const body = BODY[picked]
  const site = LUNAR_SITES.find((x) => x.id === picked)
  // the space cats, once there is something to find (after a first Moon landing)
  const cats = waitingInSpace(voyage)
  const catsDistance = distances.get(CATS_TARGET) ?? ""
  const goSite = (id: string): void => {
    sendSky({ site: id, travel: true })
    close()
  }
  return (
    <div className="sky-chart" role="dialog" aria-modal="true" aria-label="Star chart" ref={dialog}>
      <div className="sky-chart-panel">
        <header>
          <h2>Star chart</h2>
          <button onClick={() => { sendSky({ home: true }); close() }}>Homeward</button>
          <button onClick={close} aria-label="Close the star chart">Close</button>
        </header>
        <div className="sky-chart-body">
          <div className="sky-chart-list">
            {GROUPS.map((g) => (
              <section key={g.title}>
                <h3>{g.title}</h3>
                {g.ids.filter((id) => BODY[id]).map((id) => (
                  <button key={id} className={picked === id ? "on" : ""} onClick={() => setPicked(id)} onDoubleClick={() => go(id)}>
                    <span className="sky-chart-name">{BODY[id].name}</span>
                    <span className="sky-chart-dist">{distances.get(id)}</span>
                  </button>
                ))}
              </section>
            ))}
            {cats && (
              <section>
                <h3>Something out there</h3>
                <button className={picked === CATS_TARGET ? "on" : ""} onClick={() => setPicked(CATS_TARGET)} onDoubleClick={() => go(CATS_TARGET)}>
                  <span className="sky-chart-name">{voyage.cats === "unseen" ? "Five little lights" : "The space cats"}</span>
                  <span className="sky-chart-dist">{catsDistance}</span>
                </button>
              </section>
            )}
            <section>
              <h3>Places on the Moon</h3>
              {LUNAR_SITES.map((x) => (
                <button key={x.id} className={picked === x.id ? "on" : ""} onClick={() => setPicked(x.id)} onDoubleClick={() => goSite(x.id)}>
                  <span className="sky-chart-name">{x.title}</span>
                  <span className="sky-chart-dist">{voyage.sites.includes(x.id) ? "found" : x.date.slice(-4)}</span>
                </button>
              ))}
            </section>
          </div>
          {site && (
            <aside className="sky-chart-card">
              <h3>{site.name}</h3>
              <p className="sky-chart-kind">{site.mission}{site.date && ` · ${site.date}`}</p>
              <p>{site.lines[0]}</p>
              {!site.historical && <p className="sky-chart-kind">An in-game tribute — not a historical artifact.</p>}
              <button className="sky-go" onClick={() => goSite(site.id)}>Set course for {site.name}</button>
            </aside>
          )}
          {picked === CATS_TARGET && cats && (
            <aside className="sky-chart-card">
              <h3>{voyage.cats === "unseen" ? "Five little lights" : "The space cats"}</h3>
              <p className="sky-chart-kind">near the Earth–Moon L1 point · about 58,000 km from the Moon, toward Earth</p>
              <p>{voyage.cats === "unseen"
                ? "Five tiny lights blinking in a row, where the pulls of Earth and the Moon nearly cancel. They are not stars."
                : `${crewNames()}: five cats in little spacesuits, paddling for home. Come alongside and bring them with you.`}</p>
              <p className="sky-chart-kind">An in-game surprise — not a real mission.</p>
              <button className="sky-go" onClick={() => go(CATS_TARGET)}>Set course</button>
            </aside>
          )}
          {body && !site && (
            <aside className="sky-chart-card">
              <h3>{body.name}</h3>
              <p className="sky-chart-kind">{what(body.id)} · {Math.round(body.radius * 2).toLocaleString()} km across · gravity {body.gravity < 1 ? body.gravity.toFixed(2) : body.gravity.toFixed(1)} m/s²</p>
              <p>{body.fact}</p>
              <button className="sky-go" onClick={() => go(body.id)}>Set course for {body.name}</button>
            </aside>
          )}
        </div>
        <p className="sky-chart-note">Sizes and distances are the real ones, shrunk 64 times. {names.starborn} sails faster the further she is from every world, so even Neptune is a few minutes away.</p>
      </div>
    </div>
  )
}

/** Standing by a historic place on the Moon: what it is, and what is known to be there now. */
const SiteCardView = ({ card }: { card: NonNullable<ReturnType<typeof useSky.getState>["site"]> }): React.ReactElement => {
  const [open, setOpen] = useState(true)
  if (!open) return <button className="site-card-reopen" onClick={() => setOpen(true)}>{card.title}</button>
  return (
    <aside className={`site-card${card.historical ? "" : " tribute"}`} aria-live="polite">
      <header>
        <h3>{card.title}</h3>
        <button onClick={() => setOpen(false)} aria-label="Close">×</button>
      </header>
      <p className="site-card-mission">{card.mission}{card.date && <> · {card.date}</>}</p>
      {card.lines.map((l, i) => <p key={i}>{l}</p>)}
      <p className="site-card-credit">{card.historical ? `Sources: ${card.credit}` : "An in-game tribute, not a historical artifact."}</p>
    </aside>
  )
}

/** A world drawing near: its measured conditions, and why Starborn will not land. */
const HazardCardView = ({ card }: { card: NonNullable<ReturnType<typeof useSky.getState>["hazard"]> }): React.ReactElement => (
  <aside className={`hazard-card ${card.level}`} aria-live="polite">
    <h3>{card.name}</h3>
    <p className="hazard-summary">{card.summary}</p>
    <ul>{card.facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
    <p className="hazard-rule">{card.level === "floor" ? `${names.starborn} will go no lower — only home and the Moon are safe to land on.` : `Landing: not possible here. ${names.starborn} keeps you safely above it.`}</p>
    <p className="site-card-credit">Measured values · {card.source}</p>
  </aside>
)


export const SkyHud = (): React.ReactElement | null => {
  const s = useSky()
  const panel = useExplorationUI(s => s.panel)
  const dismiss = useCallback(() => useExplorationUI.getState().open(null), [])
  const dialog = useDialogFocus(panel === "sky", dismiss)
  if (!s.high && !s.chartOpen && !s.site && !s.lunarHint) return null
  return (
    <>
      {panel === "sky" && <div id="explore-sky" className="sky-context" ref={dialog} role="dialog" aria-modal="true" aria-label="Sky, places and conditions">
      {s.site && <SiteCardView key={s.site.id} card={s.site} />}
      {s.hazard && s.high && <HazardCardView card={s.hazard} />}
      {!s.high && s.lunarHint && !s.site && <div className="lunar-hint">{s.lunarHint}</div>}
      {s.high && (
        <div className="sky-panel" aria-live="off">
          <div className="sky-where">{s.sailing ? "Sailing" : "Climbing"} over <b>{s.nearest}</b> · {s.altitude} up</div>
          <div className="sky-speed">{s.speed}</div>
          {s.target && (
            <div className="sky-target">
              {s.autopilot ? `${names.starborn} is taking you to` : "Destination:"} <b>{s.target}</b>
              {s.targetDistance && ` · ${s.targetDistance}`}{s.eta && ` · about ${s.eta}`}
            </div>
          )}
          {s.autopilot === "home" && <div className="sky-target">Homeward — {names.starborn} is taking you home</div>}
          {s.lunarHint && <div className="sky-target">{s.lunarHint}</div>}
          {s.cats && <div className="sky-target sky-cats">{s.cats}</div>}
          {s.notice && <div className="sky-notice" role="status">{s.notice}</div>}
          <div className="sky-buttons">
            <button onClick={() => s.setChart(true)}>Star chart <kbd>M</kbd></button>
            {s.target && <button onClick={() => sendSky(s.autopilot ? { cancel: true } : { travel: true })}>{s.autopilot ? "Take the reins" : "Travel"} <kbd>N</kbd></button>}
            <button onClick={() => sendSky({ home: true })}>{s.autopilot === "home" ? "Take the reins" : "Homeward"} <kbd>K</kbd></button>
            {s.gather && <button className="sky-gather" onClick={() => pushAction("gather")}>Bring them home <kbd>O</kbd></button>}
          </div>
        </div>
      )}
      </div>}
      {s.chartOpen && <StarChart />}
    </>
  )
}
