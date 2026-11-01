import { debugEnabled } from "../dev/debugFlag"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ArrowUp, BookOpen, Check, Crosshair, Feather, Home, Layers, MapPin, Minus, Mountain, Navigation, Plus, Sparkles, Trash2, X } from "lucide-react"
import { HOME, isMark, useNavigation, type Destination } from "../state/navigationStore"
import { companionMarkers, earthMarkers, navigatorActor, type AtlasMarker } from "../game/navigation/atlasSnapshot"
import { bearingOf, drawMap, MAP_LABELS, toScreen, toWorldXZ, type MapView } from "../game/navigation/mapView"
import { onMapTiles } from "../game/navigation/mapTileCache"
import { compassPoint, formatBearing, groundDistance } from "../game/navigation/atlasMath"
import { DATUM_Y } from "../game/celestial/scale"
import { MAP_HOME } from "../game/navigation/mapTiles"
import { HIGHVALE_ARRIVAL } from "../world/highvale/highvaleLayout"
import { SITES } from "../world/sites/siteLayout"
import { BENCH_ID, HIGHVALE_NAME } from "../world/highvale/highvaleNames"
import { drawGlyph } from "./mapGlyphs"
import { groundNote, markName, spotGround } from "../game/navigation/markPlace"
import { wheelPixels } from "../game/controls/mouseControls"
import type { navigationSnapshot } from "../game/navigation/navigationState"
import "./worldMap.css"
import { names } from "../personalization"

/**
 * The World map (M, or Explore → World atlas): the whole of our world on one
 * sheet, north up, from a few metres a pixel at home out to the full span from
 * home to Highvale, drawn from the same terrain, water, paths and buildings the
 * game is built from (game/navigation/mapView.ts). Drag or arrow keys pan;
 * the wheel, a pinch, + and − zoom about the point under them; C comes back
 * to you. A marker opens its card (what it is, whether it is found, how far
 * and which way, set it as the destination, or travel there); a click on open
 * ground (or X, at the cursor) leaves a mark, the explorer's own rose cross, and heads
 * for it; the newest marks are kept to come back to (Places). Generated
 * landmarks show around wherever the map looks, but one not yet found shows
 * only that something is there. The land no one can reach is drawn faded, as
 * uncharted. QA: `worldMapRT` holds the view and the drawn marker positions.
 */

type View = ReturnType<typeof navigationSnapshot>
export const worldMapRT = {
  view: null as MapView | null,
  drawn: [] as { id: string; x: number; y: number }[],
  you: { x: 0, y: 0 },
}

// QA (?debug): the maps' state on window.__worldMap
if (debugEnabled()) {
  const w = window as unknown as { __worldMap?: Record<string, unknown> }
  w.__worldMap = { ...(w.__worldMap ?? {}), world: worldMapRT }
}

/** The page's own type for canvas text (a canvas cannot read CSS variables). */
const fonts = { display: "Georgia, serif", body: "system-ui, sans-serif" }
const readFonts = (): void => {
  const css = getComputedStyle(document.documentElement)
  fonts.display = css.getPropertyValue("--font-display").trim() || fonts.display
  fonts.body = css.getPropertyValue("--font-body").trim() || fonts.body
}

const SITE_IDS = new Set<string>(SITES.map((site) => site.id))
const MPP_MIN = 0.12
const MPP_MAX = 90
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)

const KIND_LABEL: Record<string, string> = { home: "Home", memory: "Memory", place: "Place", star: "Hidden place", find: "Little find", pin: "Marked place", mark: "Your mark", unknown: "Not yet found" }
const MarkCross = (): React.ReactElement => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4L12 12M12 4L4 12" /></svg>
const glyphIcon = (g: string) => g === "home" ? <Home /> : g === "memory" ? <BookOpen /> : g === "star" ? <Sparkles /> : g === "pin" ? <MapPin /> : g === "mark" ? <MarkCross /> : g === "find" ? <span className="wm-dot" /> : g === "unknown" ? <span className="wm-diamond" /> : <Mountain />
/** Which markers win a crowded spot (lower first). */
const rank = (m: AtlasMarker, selected: string | undefined): number =>
  m.destination.id === selected ? -1 : m.glyph === "home" ? 0 : m.destination.id === "highvale" || m.glyph === "mark" ? 1 : m.glyph === "memory" ? 2 : m.glyph === "place" ? 3 : m.glyph === "star" ? 4 : m.glyph === "unknown" ? 5 : 6

const niceScale = (mpp: number): { metres: number; px: number } => {
  const target = mpp * 110
  const p = 10 ** Math.floor(Math.log10(target))
  const metres = [1, 2, 5, 10].map((k) => k * p).filter((m) => m <= target).at(-1) ?? p
  return { metres, px: metres / mpp }
}

const REGIONS = [
  { id: "you", label: "You" },
  { id: "home", label: "Home", x: MAP_HOME.x, z: MAP_HOME.z, mpp: 0.9 },
  { id: "highvale", label: HIGHVALE_NAME, x: HIGHVALE_ARRIVAL.x, z: HIGHVALE_ARRIVAL.z - 40, mpp: 2.2 },
  { id: "all", label: "Whole world", x: (MAP_HOME.x + HIGHVALE_ARRIVAL.x) / 2, z: (MAP_HOME.z + HIGHVALE_ARRIVAL.z) / 2, mpp: 0 },
] as const

export const WorldMap = ({ view, onClose, onTravel }: { view: View; onClose: () => void; onTravel: (d: Destination) => void }): React.ReactElement => {
  const destination = useNavigation((s) => s.destination), choose = useNavigation((s) => s.choose)
  const marks = useNavigation((s) => s.marks), leaveMark = useNavigation((s) => s.mark), forget = useNavigation((s) => s.forget)
  const canvas = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const markerEls = useRef(new Map<string, HTMLButtonElement>())
  const youEl = useRef<HTMLDivElement>(null)
  // the view: where it is, and where it is easing to (a jump to a region, a recentre, a zoom step)
  const cam = useRef({ cx: view.x, cz: view.z, mpp: 1.1, follow: true })
  const goal = useRef<{ cx: number; cz: number; mpp: number } | null>(null)
  const [markers, setMarkers] = useState<AtlasMarker[]>(() => earthMarkers(view.x, view.z, 1400))
  const [selectedId, setSelectedId] = useState<string | null>(destination?.kind === "earth" ? destination.id : null)
  const [legend, setLegend] = useState(false)
  const [places, setPlaces] = useState(false)
  const [cursor, setCursor] = useState<{ x: number; z: number } | null>(null)
  const [hud, setHud] = useState({ mpp: 1.1, follow: true })
  const allMarkers = useMemo(() => {
    // (the marks straight from the store: a new one shows at once, not at the next refresh)
    const list = [...markers.filter((m) => m.glyph !== "mark"), ...marks.map((mark): AtlasMarker => ({ destination: mark, x: mark.x, z: mark.z, found: false, glyph: "mark" }))]
    if (destination?.kind === "earth" && !list.some((m) => m.destination.id === destination.id)) list.push({ destination, x: destination.x, z: destination.z, found: isMark(destination) ? false : true, glyph: isMark(destination) ? "mark" : "pin" })
    return list
  }, [markers, marks, destination])
  const selected = allMarkers.find((m) => m.destination.id === selectedId) ?? null
  const markersRef = useRef(allMarkers)
  const selectedRef = useRef<string | undefined>(undefined)
  const destRef = useRef<string | undefined>(undefined)
  // the frame loop reads the latest of these
  useLayoutEffect(() => { markersRef.current = allMarkers; selectedRef.current = selectedId ?? undefined; destRef.current = destination?.id })
  const hudRef = useRef(hud)
  const cursorAt = useRef(0)
  /** where the mouse is over the sheet (null when it is not), for X */
  const pointerAt = useRef<{ x: number; y: number } | null>(null)
  /** the last press became a drag (a marker's click after it is not a choice) */
  const dragged = useRef(false)

  // the mouse is the map's while it is open: a pointer lock that lands late (asked for just
  // before the map opened) would send every click to the world behind it
  useEffect(() => {
    const release = (): void => { if (document.pointerLockElement) document.exitPointerLock() }
    release()
    document.addEventListener("pointerlockchange", release)
    return () => document.removeEventListener("pointerlockchange", release)
  }, [])


  const size = (): { w: number; h: number } => ({ w: box.current?.clientWidth ?? 800, h: box.current?.clientHeight ?? 600 })
  // the marker list changes slowly: the landmarks around wherever the map looks
  // (none at the regional zooms, where they would only crowd), the finds near you
  useEffect(() => {
    // (at most 2.4 km about the view: the landmark cache holds that many cells, so this stays cheap)
    const refresh = (): void => {
      const a = navigatorActor(), c = cam.current, { w, h } = size()
      const r = c.mpp < 6 ? clamp(Math.hypot(w, h) / 2 * c.mpp, 400, 2400) : 0
      setMarkers(earthMarkers(c.cx, c.cz, r, a))
    }
    refresh()
    const t = setInterval(refresh, 500)
    return () => clearInterval(t)
  }, [])
  const fitAll = useCallback((): { cx: number; cz: number; mpp: number } => {
    const { w, h } = size()
    const dx = Math.abs(HIGHVALE_ARRIVAL.x - MAP_HOME.x) + 12000, dz = Math.abs(HIGHVALE_ARRIVAL.z - MAP_HOME.z) + 12000
    return { cx: (MAP_HOME.x + HIGHVALE_ARRIVAL.x) / 2, cz: (MAP_HOME.z + HIGHVALE_ARRIVAL.z) / 2, mpp: clamp(Math.max(dx / w, dz / h), MPP_MIN, MPP_MAX) }
  }, [])
  const flyTo = useCallback((cx: number, cz: number, mpp?: number, follow = false): void => {
    cam.current.follow = follow
    goal.current = { cx, cz, mpp: clamp(mpp ?? cam.current.mpp, MPP_MIN, MPP_MAX) }
  }, [])
  const recentre = useCallback((): void => {
    const a = navigatorActor()
    flyTo(a.x, a.z, Math.min(cam.current.mpp, 2.5), true)
  }, [flyTo])
  const zoomAbout = useCallback((factor: number, sx?: number, sy?: number): void => {
    const c = cam.current, { w, h } = size()
    const next = clamp(c.mpp * factor, MPP_MIN, MPP_MAX)
    if (sx === undefined || sy === undefined || c.follow) { goal.current = { cx: goal.current?.cx ?? c.cx, cz: goal.current?.cz ?? c.cz, mpp: next }; return }
    // the point under the cursor stays under it
    const wx = c.cx + (sx - w / 2) * c.mpp, wz = c.cz + (sy - h / 2) * c.mpp
    goal.current = null
    c.cx = wx - (sx - w / 2) * next; c.cz = wz - (sy - h / 2) * next; c.mpp = next
  }, [])

  // ---- drawing: every frame while open, only when something changed
  useEffect(() => {
    let raf = 0, alive = true, dirty = true, last = performance.now(), lastKey = ""
    const off = onMapTiles(() => { dirty = true })
    readFonts()
    const frame = (now: number): void => {
      if (!alive) return
      raf = requestAnimationFrame(frame)
      const el = canvas.current, holder = box.current
      if (!el || !holder || document.hidden) return
      const w = holder.clientWidth, h = holder.clientHeight
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) { el.width = Math.round(w * dpr); el.height = Math.round(h * dpr); dirty = true }
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const c = cam.current, actor = navigatorActor()
      if (goal.current) {
        const g = goal.current, k = 1 - Math.exp(-dt * 7)
        // zoom in log space, so a long jump reads as a smooth pull out and in
        c.cx += (g.cx - c.cx) * k; c.cz += (g.cz - c.cz) * k
        c.mpp = Math.exp(Math.log(c.mpp) + (Math.log(g.mpp) - Math.log(c.mpp)) * k)
        if (Math.hypot(g.cx - c.cx, g.cz - c.cz) < c.mpp * 0.3 && Math.abs(Math.log(g.mpp / c.mpp)) < 0.004) { c.cx = g.cx; c.cz = g.cz; c.mpp = g.mpp; goal.current = null }
      } else if (c.follow) { c.cx = actor.x; c.cz = actor.z }
      if (c.follow && goal.current) { goal.current.cx = actor.x; goal.current.cz = actor.z }
      const key = `${c.cx.toFixed(2)},${c.cz.toFixed(2)},${c.mpp.toFixed(5)},${actor.x.toFixed(2)},${actor.z.toFixed(2)},${actor.heading.toFixed(3)},${w},${h},${selectedRef.current},${destRef.current}`
      if (!dirty && key === lastKey) return
      dirty = false
      lastKey = key
      const ctx = el.getContext("2d")
      if (!ctx) return
      const v: MapView = { cx: c.cx, cz: c.cz, mpp: c.mpp, up: 0, w, h }
      worldMapRT.view = v
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = "#1b2a2a"
      ctx.fillRect(0, 0, w, h)
      drawMap(ctx, v, { detail: dpr })
      // region and river names, haloed, never on top of each other
      const taken: { x0: number; y0: number; x1: number; y1: number }[] = []
      ctx.textAlign = "center"; ctx.textBaseline = "middle"
      const p = { x: 0, y: 0 }
      for (const l of MAP_LABELS) {
        if (c.mpp < l.minMpp || c.mpp > l.maxMpp) continue
        toScreen(v, l.x, l.z, p)
        if (p.x < -80 || p.y < -20 || p.x > w + 80 || p.y > h + 20) continue
        ctx.font = l.tier === "region" ? `600 15px ${fonts.display}` : `italic 500 13px ${fonts.body}`
        const tw = ctx.measureText(l.text).width
        const r = { x0: p.x - tw / 2 - 4, y0: p.y - 10, x1: p.x + tw / 2 + 4, y1: p.y + 10 }
        if (taken.some((q) => q.x0 < r.x1 && q.x1 > r.x0 && q.y0 < r.y1 && q.y1 > r.y0)) continue
        taken.push(r)
        ctx.lineWidth = 3.2; ctx.strokeStyle = l.tier === "river" ? "#0d2a30cc" : "#10191acc"; ctx.lineJoin = "round"
        ctx.strokeText(l.text, p.x, p.y)
        ctx.fillStyle = l.tier === "river" ? "#bfe9f0" : "#fff3d8"
        ctx.fillText(l.text, p.x, p.y)
      }
      for (const comp of companionMarkers()) {
        toScreen(v, comp.x, comp.z, p)
        if (p.x > -10 && p.y > -10 && p.x < w + 10 && p.y < h + 10) drawGlyph(ctx, comp.kind === "starborn" ? "starborn" : "pegasus", p.x, p.y, 1.15, { found: true, selected: false })
      }
      // you, above every marker: your facing; off the sheet, an arrow on its edge points the way back to you
      toScreen(v, actor.x, actor.z, p)
      worldMapRT.you = { x: p.x, y: p.y }
      const inside = p.x > 8 && p.y > 8 && p.x < w - 8 && p.y < h - 8
      const you = youEl.current
      if (you) {
        const ax = inside ? p.x : clamp(p.x, 22, w - 22), ay = inside ? p.y : clamp(p.y, 70, h - 22)
        const angle = inside ? bearingOf(Math.sin(actor.heading), Math.cos(actor.heading)) : Math.atan2(p.x - w / 2, -(p.y - h / 2))
        you.style.transform = `translate(${ax.toFixed(1)}px, ${ay.toFixed(1)}px) rotate(${angle.toFixed(4)}rad)`
        you.classList.toggle("is-edge", !inside)
        you.classList.toggle("is-mounted", actor.mounted && inside)
      }
      // markers are buttons (focusable, labelled); they move with the view here, and labels give way when crowded
      const drawn: typeof worldMapRT.drawn = []
      const boxes: { x0: number; y0: number; x1: number; y1: number }[] = []
      const order = [...markersRef.current].sort((a, b) => rank(a, selectedRef.current) - rank(b, selectedRef.current))
      const shown: { m: AtlasMarker; b: HTMLButtonElement; x: number; y: number }[] = []
      // first the marks themselves (a crowded spot keeps its most important one) ...
      for (const m of order) {
        const b = markerEls.current.get(m.destination.id)
        if (!b) continue
        toScreen(v, m.x, m.z, p)
        const on = p.x > -20 && p.y > -20 && p.x < w + 20 && p.y < h + 20
        const near = drawn.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 14)
        const key = m.destination.id === selectedRef.current || m.destination.id === destRef.current
        // zoomed out to the regions, only the regions' own marks (the rest would all sit on home)
        const regional = m.glyph === "home" || m.glyph === "mark" || m.destination.id === "highvale" || m.destination.id === BENCH_ID || m.glyph === "place" && SITE_IDS.has(m.destination.id)
        const tiny = (m.glyph === "find" && c.mpp > 4) || (c.mpp > 9 && !regional && !key)
        const show = on && !tiny && (!near || key)
        b.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`
        b.hidden = !show
        if (!show) continue
        drawn.push({ id: m.destination.id, x: p.x, y: p.y })
        shown.push({ m, b, x: p.x, y: p.y })
        boxes.push({ x0: p.x - 13, y0: p.y - 13, x1: p.x + 13, y1: p.y + 13 })
      }
      // ... then their names, where they clear every mark, name and river label, and the map's own tools
      const sheet = holder.getBoundingClientRect()
      for (const el of holder.parentElement?.querySelectorAll(".wm-controls, .wm-card, .wm-foot, .wm-legend, .wm-top button") ?? []) {
        const r = el.getBoundingClientRect()
        taken.push({ x0: r.left - sheet.left, y0: r.top - sheet.top, x1: r.right - sheet.left, y1: r.bottom - sheet.top })
      }
      const hit = (r: { x0: number; y0: number; x1: number; y1: number }, own: number): boolean =>
        boxes.some((q, k) => k !== own && q.x0 < r.x1 && q.x1 > r.x0 && q.y0 < r.y1 && q.y1 > r.y0) || taken.some((q) => q.x0 < r.x1 && q.x1 > r.x0 && q.y0 < r.y1 && q.y1 > r.y0)
      shown.forEach(({ m, b, x, y }, own) => {
        const label = b.querySelector<HTMLElement>(".wm-label")
        if (!label) return
        const tw = (label.textContent?.length ?? 0) * 6.2 + 8
        const key = m.destination.id === selectedRef.current || m.destination.id === destRef.current
        // (a place not yet found is named only when chosen: the mark says enough)
        const wants = key || (c.mpp < 12 && m.glyph !== "find" && m.glyph !== "unknown" && m.glyph !== "mark") || m.glyph === "home" || m.destination.id === "highvale"
        const right = { x0: x + 13, y0: y - 8, x1: x + 15 + tw, y1: y + 8 }, left = { x0: x - 15 - tw, y0: y - 8, x1: x - 13, y1: y + 8 }
        // the right side first; the left where the right is taken or runs off the sheet
        const rightOk = right.x1 < w - 4 && !hit(right, own), leftOk = left.x0 > 4 && !hit(left, own)
        const flip = !rightOk && (leftOk || right.x1 >= w - 4)
        // crowded on both sides, only the selected place's name insists on showing
        const fits = wants && (rightOk || leftOk || m.destination.id === selectedRef.current)
        b.classList.toggle("flip", flip)
        // flipped, the button's right end (its mark) sits on the point
        b.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)${flip && fits ? " translateX(-100%)" : ""}`
        label.hidden = !fits
        if (fits) boxes.push(flip ? left : right)
      })
      worldMapRT.drawn = drawn
      if (Math.abs(hudRef.current.mpp - c.mpp) > c.mpp * 0.01 || hudRef.current.follow !== c.follow) {
        hudRef.current = { mpp: c.mpp, follow: c.follow }
        setHud(hudRef.current)
      }
    }
    raf = requestAnimationFrame(frame)
    return () => { alive = false; cancelAnimationFrame(raf); off() }
  }, [])
  // ---- pointer: drag to pan, pinch or wheel to zoom, a click selects or pins
  // (on the whole sheet, so a drag or the wheel works over a marker too)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const pts = new Map<number, { x: number; y: number }>()
    let start: { x: number; y: number; cx: number; cz: number; mpp: number; d: number; mx: number; my: number } | null = null
    let moved = 0
    let mousePointer: number | null = null
    let pressedMarker: string | null = null
    const cancelMouse = (): void => {
      if (mousePointer === null) return
      const id = mousePointer
      mousePointer = null
      pts.delete(id)
      start = null
      pressedMarker = null
      dragged.current = true
      if (el.hasPointerCapture(id)) el.releasePointerCapture(id)
    }
    const lost = (e: PointerEvent): void => { if (e.pointerId === mousePointer) cancelMouse() }
    const visibility = (): void => { if (document.hidden) cancelMouse() }
    const local = (e: PointerEvent | WheelEvent): { x: number; y: number } => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
    const begin = (): void => {
      const c = cam.current, list = [...pts.values()]
      const mx = list.reduce((s, q) => s + q.x, 0) / list.length, my = list.reduce((s, q) => s + q.y, 0) / list.length
      const d = list.length > 1 ? Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y) : 0
      start = { x: mx, y: my, cx: c.cx, cz: c.cz, mpp: c.mpp, d, mx, my }
    }
    const down = (e: PointerEvent): void => {
      if (e.button !== 0 && e.pointerType === "mouse") return
      if (e.pointerType === "mouse") {
        e.preventDefault()
        canvas.current?.focus({ preventScroll: true })
        mousePointer = e.pointerId
        pressedMarker = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-map-marker]")?.dataset.mapMarker ?? null : null
        dragged.current = false
        goal.current = null
      }
      el.setPointerCapture(e.pointerId)
      pts.set(e.pointerId, local(e))
      if (pts.size === 1) moved = 0
      begin()
    }
    const move = (e: PointerEvent): void => {
      if (e.pointerId === mousePointer && !(e.buttons & 1)) { cancelMouse(); return }
      const here = local(e)
      pointerAt.current = here
      if (!pts.has(e.pointerId)) {
        // the readout under the cursor, ten times a second
        if (e.timeStamp - cursorAt.current > 100) { cursorAt.current = e.timeStamp; setCursor(toWorldXZ({ ...cam.current, up: 0, ...size() }, here.x, here.y)) }
        return
      }
      pts.set(e.pointerId, here)
      if (!start) return
      const c = cam.current, { w, h } = size(), list = [...pts.values()]
      const mx = list.reduce((s, q) => s + q.x, 0) / list.length, my = list.reduce((s, q) => s + q.y, 0) / list.length
      moved = Math.max(moved, Math.hypot(mx - start.mx, my - start.my))
      dragged.current = moved >= 4
      if (moved < 4 && list.length === 1) return
      c.follow = false
      goal.current = null
      let mpp = start.mpp
      if (list.length > 1 && start.d > 0) mpp = clamp(start.mpp * start.d / Math.max(1, Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y)), MPP_MIN, MPP_MAX)
      // the world point first under the fingers stays under them
      const wx = start.cx + (start.x - w / 2) * start.mpp, wz = start.cz + (start.y - h / 2) * start.mpp
      c.mpp = mpp; c.cx = wx - (mx - w / 2) * mpp; c.cz = wz - (my - h / 2) * mpp
    }
    const up = (e: PointerEvent): void => {
      // a click is a press and release of the primary button, here: never a cancelled
      // press (capture lost, the page hidden or reloaded) or one that began elsewhere
      const released = local(e)
      const mouseClick = e.pointerType !== "mouse" || (e.button === 0 && start !== null && Math.hypot(released.x - start.mx, released.y - start.my) < 4)
      const wasClick = e.type === "pointerup" && pts.has(e.pointerId) && pts.size === 1 && moved < 4 && mouseClick
      const marker = pressedMarker
      if (e.pointerId === mousePointer) {
        mousePointer = null
        pressedMarker = null
        if (!wasClick) dragged.current = true
      }
      pts.delete(e.pointerId)
      if (pts.size) { begin(); return }
      start = null
      if (!wasClick) return
      if (marker && markersRef.current.some(m => m.destination.id === marker)) { setSelectedId(marker); return }
      const here = local(e), v: MapView = { ...cam.current, up: 0, ...size() }
      // the nearest marker within a fingertip, else a pin on that spot
      let best: AtlasMarker | null = null, bestD = 22
      for (const m of markersRef.current) {
        const s = toScreen(v, m.x, m.z)
        const d = Math.hypot(s.x - here.x, s.y - here.y)
        if (d < bestD && !markerEls.current.get(m.destination.id)?.hidden) { best = m; bestD = d }
      }
      if (best) { setSelectedId(best.destination.id); return }
      const at = toWorldXZ(v, here.x, here.y)
      setSelectedId(leaveMark(at.x, at.z, markName(at.x, at.z)).id)
    }
    const wheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.deltaY === 0) return
      e.preventDefault()
      const here = local(e)
      cam.current.follow = false
      zoomAbout(Math.exp(wheelPixels(e, size().h) * 0.0016), here.x, here.y)
      // A wheel turn during a mouse drag starts the next pan at the new scale.
      if (mousePointer !== null && pts.size) { moved = Math.max(4, moved); dragged.current = true; begin() }
    }
    const leave = (): void => { setCursor(null); pointerAt.current = null }
    el.addEventListener("pointerdown", down)
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerup", up)
    el.addEventListener("pointercancel", up)
    el.addEventListener("lostpointercapture", lost)
    el.addEventListener("pointerleave", leave)
    el.addEventListener("wheel", wheel, { passive: false })
    window.addEventListener("blur", cancelMouse)
    document.addEventListener("visibilitychange", visibility)
    return () => {
      cancelMouse()
      el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up)
      el.removeEventListener("pointercancel", up); el.removeEventListener("pointerleave", leave); el.removeEventListener("wheel", wheel)
      el.removeEventListener("lostpointercapture", lost)
      window.removeEventListener("blur", cancelMouse)
      document.removeEventListener("visibilitychange", visibility)
    }
  }, [leaveMark, zoomAbout])

  // ---- keys: arrows / WASD pan, + − zoom, C back to you, M closes (Esc is the dialog's)
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.target instanceof HTMLElement && (e.target.isContentEditable || e.target.matches("input, textarea, select"))) return
      const c = cam.current, { w, h } = size(), step = Math.min(w, h) * 0.18 * c.mpp
      const pan = (dx: number, dz: number): void => { c.follow = false; flyTo((goal.current?.cx ?? c.cx) + dx, (goal.current?.cz ?? c.cz) + dz) }
      const code = e.code
      if (code === "ArrowLeft" || code === "KeyA") pan(-step, 0)
      else if (code === "ArrowRight" || code === "KeyD") pan(step, 0)
      else if (code === "ArrowUp" || code === "KeyW") pan(0, -step)
      else if (code === "ArrowDown" || code === "KeyS") pan(0, step)
      else if (code === "Equal" || code === "NumpadAdd") zoomAbout(1 / 1.6)
      else if (code === "Minus" || code === "NumpadSubtract") zoomAbout(1.6)
      else if (code === "KeyC") recentre()
      else if (code === "KeyX") {
        if (e.repeat) { e.preventDefault(); return }
        // a mark at the cursor, or at the middle of the sheet when the mouse is elsewhere
        const v: MapView = { ...c, up: 0, w, h }, at = pointerAt.current ? toWorldXZ(v, pointerAt.current.x, pointerAt.current.y) : { x: c.cx, z: c.cz }
        setSelectedId(leaveMark(at.x, at.z, markName(at.x, at.z)).id)
      }
      else if ((code === "Delete" || code === "Backspace") && selectedRef.current?.startsWith("mark:")) { forget(selectedRef.current); setSelectedId(null) }
      else if (code === "KeyM") { e.preventDefault(); e.stopPropagation(); if (!e.repeat) onClose(); return }
      else return
      e.preventDefault()
    }
    document.addEventListener("keydown", key, true)
    return () => document.removeEventListener("keydown", key, true)
  }, [flyTo, zoomAbout, recentre, onClose, leaveMark, forget])

  const actor = navigatorActor()
  const info = (m: AtlasMarker): { distance: string; direction: string } => {
    const dx = m.x - actor.x, dz = m.z - actor.z, d = Math.hypot(dx, dz)
    const b = (bearingOf(dx, dz) * 180 / Math.PI + 360) % 360
    return { distance: groundDistance(d), direction: d < 1 ? "here" : `${compassPoint(b)} ${formatBearing(b)}` }
  }
  const scale = niceScale(hud.mpp)
  const cursorText = cursor ? `E ${cursor.x.toFixed(0)} · N ${(-cursor.z).toFixed(0)} · ${groundNote(spotGround(cursor.x, cursor.z))} · click or X to mark` : `E ${actor.x.toFixed(0)} · N ${(-actor.z).toFixed(0)} · you`
  const isDestination = (m: AtlasMarker): boolean => destination?.id === m.destination.id
  const course = view.flight

  return <div className="world-map">
    <div className="wm-sheet" ref={box}>
      <canvas ref={canvas} className="wm-canvas" tabIndex={0} aria-label="World map. Drag or use the arrow keys to move, plus and minus to zoom, C to come back to you. Click open ground, or press X, to leave a mark and head for it; Delete removes the chosen mark." />
      <div className="wm-markers">
        <div className="wm-you" ref={youEl} aria-hidden="true"><svg viewBox="0 0 20 24"><path d="M10 1.5L18.5 21.5L10 17.2L1.5 21.5Z" /></svg></div>
        {allMarkers.map((m) => <button key={m.destination.id} ref={(el) => { if (el) markerEls.current.set(m.destination.id, el); else markerEls.current.delete(m.destination.id) }}
          data-map-marker={m.destination.id} className={`wm-marker g-${m.glyph}${m.found ? " found" : ""}${m.destination.id === selectedId ? " selected" : ""}${isDestination(m) ? " is-destination" : ""}`}
          aria-label={`${m.destination.name}${m.found ? "" : ", not yet found"}`} onClick={(e) => { if (e.detail === 0 || !dragged.current) setSelectedId(m.destination.id) }}>
          <span className="wm-icon">{glyphIcon(isDestination(m) && m.glyph !== "home" && m.glyph !== "mark" ? "pin" : m.glyph)}</span><span className="wm-label">{m.destination.name}</span>
        </button>)}
      </div>
    </div>
    <header className="wm-top">
      <span className="wm-title"><Navigation /> This world</span>
      <nav className="wm-regions" aria-label="Go to a region">
        {REGIONS.map((r) => <button key={r.id} onClick={() => r.id === "you" ? recentre() : r.id === "all" ? (() => { const f = fitAll(); flyTo(f.cx, f.cz, f.mpp) })() : flyTo(r.x, r.z, r.mpp)} className={r.id === "you" && hud.follow ? "on" : undefined}>{r.label}</button>)}
      </nav>
      <button className={`wm-places-toggle${places ? " on" : ""}`} aria-pressed={places} onClick={() => setPlaces(!places)}><MapPin /><span>Places</span></button>
      <button className="wm-close" aria-label="Close the map" onClick={onClose}><X /></button>
    </header>
    <div className="wm-controls" role="group" aria-label="Map zoom">
      <button aria-label="Zoom in" onClick={() => zoomAbout(1 / 1.6)} disabled={hud.mpp <= MPP_MIN * 1.01}><Plus /></button>
      <button aria-label="Zoom out" onClick={() => zoomAbout(1.6)} disabled={hud.mpp >= MPP_MAX * 0.99}><Minus /></button>
      <button aria-label="Back to you" className={hud.follow ? "on" : undefined} onClick={recentre}><Crosshair /></button>
      <button aria-label="Legend" aria-pressed={legend} onClick={() => setLegend(!legend)}><Layers /></button>
    </div>
    <div className="wm-foot">
      <span className="wm-scale"><i style={{ width: `${scale.px}px` }} />{groundDistance(scale.metres)}</span>
      <span className="wm-coords">{cursorText}</span>
    </div>
    {legend && <aside className="wm-legend" aria-label="Map legend">
      <b>Legend</b>
      <ul>
        <li><i className="k-you" />You (your facing)</li>
        <li><i className="k-memory found" />A memory found · <i className="k-memory" />still to find</li>
        <li><i className="k-place" />A place · <i className="k-unknown" />Not yet found · <i className="k-pin" />Destination</li>
        <li><i className="k-mark" />Your mark (click open ground or press X)</li>
        <li><i className="k-peg" />Your Pegasus · <i className="k-starborn" />{names.starborn}</li>
        <li><i className="k-line path" />Path · <i className="k-line trail" />Trail · <i className="k-line road" />Road</li>
        <li><i className="k-area building" />Building · <i className="k-area water" />Water</li>
        <li><i className="k-area uncharted" />Uncharted: beyond anyone&apos;s reach</li>
      </ul>
      <small>Terrain, water, paths and buildings are the game&apos;s own. Contours every {hud.mpp < 2 ? 5 : hud.mpp < 8 ? 20 : 100} m{hud.mpp >= 8 ? " or so" : ""}.</small>
    </aside>}
    <section className="wm-panel" aria-live="polite">
      {places && <div className="wm-card wm-list">
        <div className="wm-card-head"><div><small>Every place on the map</small><strong>Places</strong></div><button className="wm-x" aria-label="Close places" onClick={() => setPlaces(false)}><X /></button></div>
        {marks.length > 0 && <><small className="wm-list-head">Your marks</small><ul>{marks.map((mark) => {
          const m = allMarkers.find((q) => q.destination.id === mark.id) ?? { destination: mark, x: mark.x, z: mark.z, found: false, glyph: "mark" }
          return <li key={mark.id}>
            <button className="wm-row" onClick={() => { setSelectedId(mark.id); setPlaces(false); flyTo(mark.x, mark.z, Math.min(cam.current.mpp, 1.4)) }}>
              <span className={`wm-row-icon g-mark${isDestination(m) ? " is-destination" : ""}`}><MarkCross /></span><span className="wm-row-name">{mark.name}{isDestination(m) && <small> · heading here</small>}</span><small>{info(m).distance}</small>
            </button>
            <button className="wm-row-go" aria-label={`Remove ${mark.name}`} onClick={() => forget(mark.id)}><Trash2 /></button>
          </li>
        })}</ul><small className="wm-list-head">Places</small></>}
        <ul>{[...allMarkers].filter((m) => m.glyph !== "find" && m.glyph !== "mark" && m.glyph !== "unknown").sort((a, b) => rank(a, undefined) - rank(b, undefined) || a.destination.name.localeCompare(b.destination.name)).map((m) => {
          const i = info(m)
          return <li key={m.destination.id}>
            <button className="wm-row" onClick={() => { setSelectedId(m.destination.id); setPlaces(false); flyTo(m.x, m.z, m.destination.id === "highvale" ? 2.2 : Math.min(cam.current.mpp, 1.4)) }}>
              <span className={`wm-row-icon g-${m.glyph}${m.found ? " found" : ""}`}>{glyphIcon(m.glyph)}</span><span className="wm-row-name">{m.destination.name}{m.glyph === "memory" && !m.found && <small> · not yet found</small>}</span><small>{i.distance}</small>
            </button>
            {m.destination.kind === "earth" && <button className="wm-row-go" aria-label={`Travel to ${m.destination.name}`} onClick={() => onTravel(m.destination)}><Feather /></button>}
          </li>
        })}</ul>
      </div>}
      {places ? null : selected ? <div className="wm-card">
        <div className="wm-card-head"><span className={`wm-card-icon g-${selected.glyph}`}>{glyphIcon(selected.glyph)}</span><div><small>{KIND_LABEL[selected.glyph] ?? "Place"}{selected.glyph === "memory" ? selected.found ? " · remembered" : " · not yet found" : ""}</small><strong>{selected.destination.name}</strong></div><button className="wm-x" aria-label="Close the card" onClick={() => setSelectedId(null)}><X /></button></div>
        {(() => { const i = info(selected); return <p className="wm-where"><ArrowUp style={{ transform: `rotate(${(bearingOf(selected.x - actor.x, selected.z - actor.z) * 180 / Math.PI)}deg)` }} />{i.distance} · {i.direction}{selected.destination.id === "highvale" ? " · far beyond the walk from home" : ""}</p> })()}
        {(selected.glyph === "mark" || selected.glyph === "unknown") && (() => { const g = spotGround(selected.x, selected.z); return <p className="wm-note">{selected.glyph === "unknown" ? "Something is there. Go and see what. · " : ""}{groundNote(g)}{g.uncharted ? " · fast travel can't go there: ride or fly" : g.water ? ` · ${names.starborn} can take you over it` : ""}</p> })()}
        <div className="wm-actions">
          {isDestination(selected) ? <button onClick={() => choose(null)}><Check />Heading here · stop</button> : <button onClick={() => choose(selected.destination)}><MapPin />Head here</button>}
          {selected.destination.kind === "earth" && !spotGround(selected.x, selected.z).uncharted && <button onClick={() => onTravel(selected.destination)}><Feather />Travel there</button>}
          <button onClick={() => flyTo(selected.x, selected.z, Math.min(cam.current.mpp, 1.4))}><Crosshair />Show</button>
          {selected.glyph === "mark" && <button onClick={() => { forget(selected.destination.id); setSelectedId(null) }}><Trash2 />Remove mark</button>}
        </div>
      </div> : <div className="wm-card is-here">
        <small>{course ? "Guided course" : destination ? "Destination" : "You are here"}</small>
        <strong>{course ? view.name : destination ? destination.name : view.name}</strong>
        <p className="wm-where">{course || destination ? <>{view.bearing !== null && <ArrowUp style={{ transform: `rotate(${view.bearing}deg)` }} />}{view.directionText ?? ""} {view.distance ? `· ${view.distance}` : ""}</> : `E ${actor.x.toFixed(0)} · N ${(-actor.z).toFixed(0)} · ${Math.round(actor.y - DATUM_Y)} m${actor.mounted ? " · riding" : ""}`}</p>
        <div className="wm-actions">
          <button onClick={() => { choose(HOME); setSelectedId("home") }}><Home />Guide me home</button>
          {destination && <button onClick={() => choose(null)}><X />Clear destination</button>}
        </div>
      </div>}
    </section>
  </div>
}
