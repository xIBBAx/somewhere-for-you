import { story } from "../content/story"
import { useCallback, useEffect } from "react"
import { CircleHelp, X } from "lucide-react"
import { create } from "zustand"
import { useExplorationUI } from "../state/explorationUIStore"
import { useGame } from "../state/gameStore"
import { takeAction } from "../game/runtime"
import { GROUPS, liveBindings, signatureLabel, type Binding } from "../game/controls/bindings"
import { useDialogFocus } from "./useDialogFocus"
import "./controls.css"
import { names } from "../personalization"

const WELCOME_KEY = "gift-world.controls.welcome.v1"
/** a remembered "seen" stops the tips; without storage they stay quiet rather than nag every visit */
const tipsSeen = (): boolean => {
  try { return localStorage.getItem(WELCOME_KEY) === "seen" } catch { return true }
}
const rememberTipsSeen = (): void => {
  try { localStorage.setItem(WELCOME_KEY, "seen") } catch { /* the tips are optional */ }
}
const forgetTipsSeen = (): void => {
  try { localStorage.removeItem(WELCOME_KEY) } catch { /* nothing to forget */ }
}

/** The guide's open state and the welcome tip shown (null: none). Set from the Explore menu, "/" and the ? button. */
export const useControlsUI = create<{ tip: number | null; openGuide: (open: boolean) => void; setTip: (tip: number | null) => void }>(set => ({
  tip: null,
  openGuide: guide => useExplorationUI.getState().open(guide ? "controls" : null),
  setTip: tip => set({ tip }),
}))

/** Keys as chips: the explicit label, or each distinct key once. */
const chipsOf = (b: Binding): string[] => {
  if (b.label) return [b.label]
  return [...new Set(b.keys.map(signatureLabel))]
}

const BindingRow = ({ b }: { b: Binding }): React.ReactElement => (
  <li className="cg-row">
    <div className="cg-name">
      <b>{b.name}</b>
      <span>{b.desc}</span>
    </div>
    <div className="cg-keys" aria-label={`Keyboard: ${chipsOf(b).join(", ")}`}>
      {b.keys.length === 0 && !b.label ? <span className="cg-none">—</span> : chipsOf(b).map(c => <kbd key={c}>{c}</kbd>)}
    </div>
  </li>
)

const ControlsDialog = (): React.ReactElement => {
  const close = useCallback(() => useControlsUI.getState().openGuide(false), [])
  const dialog = useDialogFocus(true, close)
  const showTips = (): void => {
    forgetTipsSeen()
    useControlsUI.getState().openGuide(false)
    useControlsUI.getState().setTip(0)
  }
  return <div className="controls-scrim" onPointerDown={e => { if (e.target === e.currentTarget) close() }}>
    <section id="explore-controls" className="controls-card" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="controls-title">
      <header className="controls-head">
        <div>
          <small>{story.title}</small>
          <h2 id="controls-title">Everything you can do</h2>
          <p>Keyboard and mouse, grouped by what you are doing. Click Explore for more actions. Press / to reopen.</p>
        </div>
        <button className="controls-close" onClick={close} aria-label="Close the controls guide"><X /></button>
      </header>
      <div className="cg-colhead" aria-hidden="true"><span>What it does</span><span>Keyboard</span></div>
      <div className="controls-body" tabIndex={0} role="region" aria-label="All controls">
        {GROUPS.map(g => {
          const rows = liveBindings().filter(b => b.group === g.id)
          if (rows.length === 0) return null
          return <section key={g.id} className="cg-group" aria-labelledby={`cg-${g.id}`}>
            <h3 id={`cg-${g.id}`}>{g.title}</h3>
            <ul>{rows.map(b => <BindingRow key={b.id} b={b} />)}</ul>
          </section>
        })}
      </div>
      <footer className="controls-foot">
        <button className="controls-tips" onClick={showTips}>Show the welcome tips again</button>
        <span>Esc closes this</span>
      </footer>
      <p className="controls-credits">Planet textures by Solar System Scope, CC BY 4.0. Star data from the HYG Database (astronexus), CC BY-SA 4.0. Earth, Moon and sky imagery: NASA, USGS, GEBCO. Music: “First Snow” by Holizna, CC0. Full list in ASSET_LICENSES.md.</p>
    </section>
  </div>
}

const WELCOME_TIPS: string[] = [
    "Walk with W A S D, drag the world to look around, and use the wheel to zoom. Click without dragging for free look; Esc releases the mouse.",
    "Walk up to a horse, a cat or anything that sparkles, and press E to ride, pet or pick it up.",
    `Press I to summon ${names.starborn}, your star Pegasus. Space takes off, and Explore → Direct to the planets flies you to other worlds.`,
    "Press / any time for every control, grouped by what you are doing.",
]

/** A few short, skippable tips for a new player. Non-blocking: only the card takes clicks. */
const WelcomeTips = (): React.ReactElement | null => {
  const tip = useControlsUI(s => s.tip)
  // never over an open panel or dialog
  const panelOpen = useExplorationUI(s => s.panel !== null)
  useEffect(() => {
    if (tipsSeen()) return
    const t = window.setTimeout(() => {
      if (!tipsSeen() && useControlsUI.getState().tip === null) useControlsUI.getState().setTip(0)
    }, 2500)
    return () => clearTimeout(t)
  }, [])
  if (tip === null || panelOpen) return null
  const tips = WELCOME_TIPS
  const last = tip >= tips.length - 1
  const finish = (): void => {
    rememberTipsSeen()
    useControlsUI.getState().setTip(null)
  }
  return <aside className="welcome-tip" role="status" aria-label="Welcome tips">
    <small>A little welcome · {tip + 1} of {tips.length}</small>
    <p>{tips[tip]}</p>
    <div>
      <button onClick={finish}>Skip the tips</button>
      <button className="primary" onClick={last ? finish : () => useControlsUI.getState().setTip(tip + 1)}>{last ? "Thank you" : "Next"}</button>
    </div>
  </aside>
}

/**
 * Mounts the controls guide: "/" (via the ControlsGuide action), the Explore menu
 * and the ? button all open it; the welcome tips follow the first start.
 */
export const ControlsGuide = (): React.ReactElement => {
  const guide = useExplorationUI(s => s.panel === "controls")
  const started = useGame(s => s.started)
  useEffect(() => {
    // "/" and the Explore menu push the action; the guide is the one place that consumes it
    const iv = window.setInterval(() => {
      if (takeAction("controlsGuide") && !document.querySelector('[role="dialog"]')) useControlsUI.getState().openGuide(true)
    }, 120)
    return () => clearInterval(iv)
  }, [])
  return <>
    <button className="controls-help" onClick={() => useControlsUI.getState().openGuide(true)} aria-label="Controls guide (/)" title="Controls · /">
      <CircleHelp size={18} />
    </button>
    {guide && <ControlsDialog />}
    {started && <WelcomeTips />}
  </>
}
