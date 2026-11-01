import { useEffect, useRef, useState } from "react"
import { useTravel } from "../state/travelStore"
import { pegasusLandingControl } from "../game/input"
import { characterRT } from "../game/runtime"
import { riderRT } from "../game/horses/riding"
import { horseById, horseRT } from "../game/horses/horseState"
import { legendItems, FADE_AFTER, keyLabel, type Binding, type LegendContext } from "../game/controls/bindings"

const USED_KEY = "gift-world.controls.used.v1"
/** How often each legend item has been used on the keyboard (drives the fade). Storage may be blocked. */
const readUsed = (): Record<string, number> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(USED_KEY) ?? "{}")
    return parsed && typeof parsed === "object" ? Object.fromEntries(Object.entries(parsed).filter(([, count]) => typeof count === "number" && Number.isFinite(count) && count >= 0)) : {}
  } catch {
    return {}
  }
}
const writeUsed = (used: Record<string, number>): void => {
  try { localStorage.setItem(USED_KEY, JSON.stringify(used)) } catch { /* the legend just stops fading */ }
}

/** Which legend the player is in now, or null for none (on foot the hint line is enough). */
const contextNow = (): LegendContext | null => {
  if (useTravel.getState().phase !== "idle") return "journey"
  const id = characterRT.active
  const r = riderRT[id]
  if (r.phase === "riding" && r.horse) {
    if (r.horse.kind !== "horse") return null
    const h = horseById(r.horse.ident.id)
    if (!h) return null
    if (h.flight?.mode === "sail") return "sail"
    const landing = pegasusLandingControl(h.flight)
    if (landing === "keepFlying") return "landing"
    if (landing === "slow") return "landingRun"
    if (h.flight?.mode === "ground") return "pegasusGround"
    if (h.flight) return "flight"
    return "horse"
  }
  if (r.phase !== "none") return null
  return horseRT.near !== null ? "footHorse" : null
}

/** Whether a single keyboard code is one of this item's keys (chords and taps never count). */
const isSingleKey = (b: Binding, code: string): boolean => b.keys.some(sig => sig === code)

/**
 * The few keys that matter right now: in the air, on a horse, sailing, on a
 * journey, or near a horse on foot. It shows at most four items, and an item
 * drops away once the player has used it a few times.
 */
export const ControlLegend = (): React.ReactElement => {
  const [ctx, setCtx] = useState<LegendContext | null>(null)
  const [items, setItems] = useState<Binding[]>([])
  const used = useRef<Record<string, number>>(readUsed())
  const ctxRef = useRef<LegendContext | null>(null)

  useEffect(() => {
    const refresh = (): void => {
      const next = contextNow()
      if (next !== ctxRef.current) {
        ctxRef.current = next
        setCtx(next)
      }
      const shown = next ? legendItems(next, used.current) : []
      setItems(prev => (prev.map(b => b.id).join() === shown.map(b => b.id).join() ? prev : shown))
    }
    refresh()
    const iv = window.setInterval(refresh, 250)
    return () => clearInterval(iv)
  }, [])

  // count keyboard uses of what the legend shows, so it fades once the player knows it
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.repeat || document.querySelector('[role="dialog"]')) return
      const hit = ctxRef.current ? legendItems(ctxRef.current, used.current).filter(b => isSingleKey(b, e.code)) : []
      if (hit.length === 0) return
      for (const b of hit) used.current[b.id] = (used.current[b.id] ?? 0) + 1
      writeUsed(used.current)
      setItems(prev => prev.filter(b => (used.current[b.id] ?? 0) < FADE_AFTER))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  if (!ctx || items.length === 0) return <div className="control-legend" aria-hidden="true" />
  return <div className="control-legend" role="note" aria-label="Controls for what you are doing now">
    {items.map(b => <span key={b.id}>
      <kbd>{b.label ?? keyLabel(b.keys[0]?.split(/[ +]/)[0] ?? "")}</kbd>
      {b.short ?? b.name.toLowerCase()}
    </span>)}
  </div>
}
