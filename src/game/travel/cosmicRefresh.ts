import { flushGameSave, useGame } from "../../state/gameStore"
import { useDiscoveries } from "../../state/discoveryStore"
import { TOTAL_STARS } from "../../content/memories"
import { spaceRT } from "../celestial/spaceState"
import { avatarRT } from "../runtime"
import { LOCATION_KEY, readLocationCheckpoint, saveLocationCheckpoint, type LocationCheckpoint } from "./locationMemory"
import { letterOpen } from "../../ui/letterVeil"
import "../../ui/cosmicRefresh.css"

/**
 * Refresh the universe (Explore menu, or F5). When anything lags or a character
 * is caught in a pose, the page is rebuilt from scratch: everything that should
 * last is written first (progress, and the last safe place on Earth), the
 * world folds into the stars of the loading screen, the page reloads without
 * the letter, and she arrives back where she stood in a burst of light.
 *
 * The effect carries her progress: one golden keepsake star for every little
 * star she has earned, a warmer gold once the finale is complete, and a
 * pink sparkle for each surprise she has found.
 */

/** sessionStorage: this tab has already entered the world (reloads skip the letter) */
export const IN_WORLD_KEY = "gift-world/in-world"
/** sessionStorage: a refresh is under way; read once on arrival */
export const REFRESH_KEY = "gift-world/refresh"
/** an arrival note older than this is stale (a refresh that never finished loading) */
const ARRIVAL_WINDOW_MS = 5 * 60_000

export type RefreshWhere = "here" | "safe" | "earth"
export type RefreshNote = { t: number; where: RefreshWhere }
export type CosmicMood = { stars: number; total: number; surprises: number; finale: boolean }

export const refreshRT = { pending: false }

const session = {
  get: (key: string): string | null => { try { return window.sessionStorage.getItem(key) } catch { return null } },
  set: (key: string, value: string): void => { try { window.sessionStorage.setItem(key, value) } catch { /* private storage: the letter shows again */ } },
  remove: (key: string): void => { try { window.sessionStorage.removeItem(key) } catch { /* ignore */ } },
}

/** Remember that this tab is in the world, so any later reload resumes it. */
export const markInWorld = (): void => { if (session.get(IN_WORLD_KEY) !== "1") session.set(IN_WORLD_KEY, "1") }

export const readRefreshNote = (raw: string | null, now: number): RefreshNote | null => {
  if (!raw || raw.length > 200) return null
  try {
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== "object" || Array.isArray(v)) return null
    const r = v as Record<string, unknown>
    if (typeof r.t !== "number" || !Number.isFinite(r.t) || now - r.t < 0 || now - r.t > ARRIVAL_WINDOW_MS) return null
    const where = r.where === "here" || r.where === "safe" || r.where === "earth" ? r.where : "safe"
    return { t: r.t, where }
  } catch { return null }
}

/** The arrival note, consumed once (a later plain reload is not another arrival). */
export const takeRefreshArrival = (): RefreshNote | null => {
  const note = readRefreshNote(session.get(REFRESH_KEY), Date.now())
  session.remove(REFRESH_KEY)
  return note
}

export const progressMood = (): CosmicMood => {
  const game = useGame.getState()
  return {
    stars: Math.max(0, Math.min(TOTAL_STARS, game.stars)),
    total: TOTAL_STARS,
    surprises: Math.max(0, Math.min(40, useDiscoveries.getState().count)),
    finale: game.finale === "done",
  }
}

export const arrivalLine = (where: RefreshWhere): string =>
  where === "here" ? "Back where you left off." : where === "earth" ? "Back on Earth, where you last stood." : "Back at your last safe spot."

// ---------------------------------------------------------------- close guard

type GuardWindow = Window & { __worldAllowLeave?: boolean; __worldCloseGuard?: boolean }

/** Our own reloads (a refresh, a dev-server reload, a resume) pass the close guard. */
export const allowLeave = (): void => { (window as GuardWindow).__worldAllowLeave = true }

/**
 * Once she is in the world, closing the window by accident (Ctrl+W while
 * walking with W, Alt+F4, a stray click on the tab's x) asks first with the
 * browser's own "Leave site?". Everything is saved either way; this only
 * keeps a play session from vanishing mid-ride. Installed once per page
 * (the flags live on window, so a hot-reloaded copy never stacks listeners).
 */
export const installCloseGuard = (): void => {
  const w = window as GuardWindow
  if (w.__worldCloseGuard) return
  w.__worldCloseGuard = true
  w.__worldAllowLeave = false
  window.addEventListener("beforeunload", (event) => {
    if (w.__worldAllowLeave || refreshRT.pending || !useGame.getState().started || letterOpen()) return
    event.preventDefault()
    event.returnValue = ""
  })
  // the dev server's own full reloads pass (a page edited while she plays)
  if (import.meta.hot) import.meta.hot.on("vite:beforeFullReload", allowLeave)
}

/** Start a refresh. Returns false when one is already under way or the world has not begun. */
export const refreshUniverse = (): boolean => {
  if (refreshRT.pending || !useGame.getState().started) return false
  refreshRT.pending = true
  const away = spaceRT.realm !== "earth" || spaceRT.mode !== "local"
  // refused while flying, swimming, mid-scene or in space: the last safe stop (saved every few seconds) is kept
  const kept = saveLocationCheckpoint()
  flushGameSave()
  const note: RefreshNote = { t: Date.now(), where: away ? "earth" : kept ? "here" : "safe" }
  session.set(IN_WORLD_KEY, "1")
  session.set(REFRESH_KEY, JSON.stringify(note))
  warpOut(progressMood(), () => { allowLeave(); window.location.reload() })
  return true
}

// ---------------------------------------------------------------- the effect

const reducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
const easeIn = (t: number): number => t * t * t
const easeOut = (t: number): number => 1 - (1 - t) ** 3
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t))

type Overlay = { root: HTMLDivElement; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null; w: number; h: number; dpr: number }

const makeOverlay = (className: string, caption?: string, sub?: string): Overlay => {
  const root = document.createElement("div")
  root.className = `cosmic-refresh ${className}`
  root.setAttribute("aria-hidden", "true")
  const canvas = document.createElement("canvas")
  root.appendChild(canvas)
  if (caption) {
    const text = document.createElement("div")
    text.className = "cosmic-refresh-caption"
    const p = document.createElement("p")
    p.textContent = caption
    text.appendChild(p)
    if (sub) {
      const s = document.createElement("small")
      s.textContent = sub
      text.appendChild(s)
    }
    root.appendChild(text)
  }
  document.body.appendChild(root)
  const dpr = Math.min(1.5, window.devicePixelRatio || 1)
  const w = Math.max(1, Math.round(window.innerWidth * dpr)), h = Math.max(1, Math.round(window.innerHeight * dpr))
  canvas.width = w
  canvas.height = h
  return { root, canvas, ctx: canvas.getContext("2d"), w, h, dpr }
}

/** a four-pointed star, the game's keepsake glyph */
const drawStar = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number): void => {
  if (alpha <= 0.01 || r <= 0.2) return
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(x, y)
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 3)
  glow.addColorStop(0, color)
  glow.addColorStop(1, "rgba(0,0,0,0)")
  ctx.fillStyle = glow
  ctx.beginPath(); ctx.arc(0, 0, r * 3, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = "#fffaf0"
  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2, rr = i % 2 === 0 ? r : r * 0.28
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
  }
  ctx.closePath(); ctx.fill()
  ctx.restore()
}

type Streak = { a: number; r: number; speed: number; hue: string; width: number }
const STREAK_HUES = ["#ffffff", "#cfe0ff", "#dfe8ff", "#ffe9c8", "#bcd4ff"]

const makeStreaks = (n: number, reach: number): Streak[] =>
  Array.from({ length: n }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random() * reach * 0.5 + 6, speed: 0.6 + Math.random() * 1.4, hue: STREAK_HUES[Math.floor(Math.random() * STREAK_HUES.length)], width: 0.6 + Math.random() * 1.3 }))

/** The world folds into the stars of the loading screen; `done` runs once it is fully night-blue. */
export const warpOut = (mood: CosmicMood, done: () => void): void => {
  const sub = mood.stars > 0 ? `${mood.stars} of ${mood.total} stars${mood.surprises ? ` · ${mood.surprises} surprises` : ""} · all progress kept` : "all progress kept"
  const o = makeOverlay("is-out", "Refreshing the universe", sub)
  const { ctx, w, h, dpr } = o
  const cx = w / 2, cy = h / 2, reach = Math.hypot(w, h) / 2
  const reduce = reducedMotion()
  const duration = reduce ? 700 : 1500
  const streaks = makeStreaks(reduce ? 0 : 260, reach)
  const gold = mood.finale ? "rgba(255,206,120,0.95)" : "rgba(255,226,170,0.9)"
  const start = performance.now()
  let finished = false
  const finish = (): void => { if (!finished) { finished = true; done() } }
  // a reload must happen even if animation frames stop (hidden tab)
  const fallback = window.setTimeout(finish, duration + 900)
  const frame = (now: number): void => {
    const t = clamp01((now - start) / duration)
    o.root.style.setProperty("--t", t.toFixed(3))
    if (ctx) {
      ctx.clearRect(0, 0, w, h)
      // the night of the loading screen gathers from the edges inward
      const veil = easeIn(t)
      const bg = ctx.createRadialGradient(cx, cy * 1.1, 0, cx, cy, reach)
      bg.addColorStop(0, `rgba(11,21,48,${veil.toFixed(3)})`)
      bg.addColorStop(0.45, `rgba(5,10,26,${Math.min(1, veil * 1.3).toFixed(3)})`)
      bg.addColorStop(1, `rgba(2,4,12,${Math.min(1, 0.25 + veil * 1.2).toFixed(3)})`)
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)
      // hyperspace: starlight stretches outward from the centre
      ctx.lineCap = "round"
      for (const s of streaks) {
        const r = s.r + reach * s.speed * easeIn(t) * 1.6
        const len = (8 + 160 * easeIn(t)) * s.speed * dpr
        const a = Math.min(1, 0.15 + t * 1.4) * (1 - Math.max(0, t - 0.88) * 6)
        if (a <= 0) continue
        ctx.strokeStyle = s.hue
        ctx.globalAlpha = a
        ctx.lineWidth = s.width * dpr
        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(s.a) * r, cy + Math.sin(s.a) * r)
        ctx.lineTo(cx + Math.cos(s.a) * (r + len), cy + Math.sin(s.a) * (r + len))
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      // her keepsake stars circle in and gather at the heart of it
      const ring = Math.min(w, h) * 0.24 * (1 - easeOut(t) * 0.82)
      for (let i = 0; i < mood.stars; i++) {
        const a = (i / Math.max(1, mood.stars)) * Math.PI * 2 + t * 5.2
        drawStar(ctx, cx + Math.cos(a) * ring, cy + Math.sin(a) * ring, (5 + 4 * t) * dpr, gold, Math.min(1, t * 3))
      }
      // surprises found: a fine pink dust riding the same spiral
      for (let i = 0; i < mood.surprises; i++) {
        const a = (i / Math.max(1, mood.surprises)) * Math.PI * 2 - t * 3.4
        const r = ring * 1.35 + Math.sin(i * 7.3) * 14 * dpr
        drawStar(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2.2 * dpr, "rgba(255,170,205,0.85)", Math.min(0.9, t * 2.5))
      }
      // the gathered light: one bright point, warmer once the finale is done
      const core = easeIn(clamp01((t - 0.35) / 0.65))
      if (core > 0) drawStar(ctx, cx, cy, (6 + 22 * core) * dpr, gold, core)
    }
    if (t < 1) requestAnimationFrame(frame)
    else { window.clearTimeout(fallback); finish() }
  }
  requestAnimationFrame(frame)
}

/** On arrival: a ring of light opens over the world and her keepsake stars scatter back into it. */
export const warpIn = (mood: CosmicMood, where: RefreshWhere): void => {
  const o = makeOverlay("is-in", arrivalLine(where))
  const { ctx, w, h, dpr } = o
  const cx = w / 2, cy = h / 2, reach = Math.hypot(w, h) / 2
  const reduce = reducedMotion()
  const duration = reduce ? 600 : 1900
  const gold = mood.finale ? "rgba(255,206,120,0.95)" : "rgba(255,226,170,0.9)"
  const start = performance.now()
  const remove = (): void => { o.root.remove() }
  const fallback = window.setTimeout(remove, duration + 1500)
  const frame = (now: number): void => {
    const t = clamp01((now - start) / duration)
    o.root.style.setProperty("--t", t.toFixed(3))
    if (ctx) {
      ctx.clearRect(0, 0, w, h)
      // the night lifts from the middle outward
      const open = easeOut(t)
      const hole = reach * open * 1.15
      const bg = ctx.createRadialGradient(cx, cy, Math.max(0, hole * 0.6), cx, cy, Math.max(1, hole + reach * 0.35))
      bg.addColorStop(0, "rgba(5,10,26,0)")
      bg.addColorStop(1, `rgba(3,6,17,${(1 - open).toFixed(3)})`)
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)
      // the bright ring at the edge of the opening
      if (!reduce) {
        ctx.globalAlpha = (1 - t) * 0.85
        ctx.strokeStyle = gold
        ctx.lineWidth = (2 + 10 * (1 - t)) * dpr
        ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, hole), 0, Math.PI * 2); ctx.stroke()
        ctx.globalAlpha = 1
      }
      for (let i = 0; i < mood.stars; i++) {
        const a = (i / Math.max(1, mood.stars)) * Math.PI * 2 - Math.PI / 2
        const r = Math.min(w, h) * 0.05 + reach * 0.55 * easeOut(t)
        drawStar(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, (8 - 4 * t) * dpr, gold, 1 - easeIn(t))
      }
    }
    if (t < 1) requestAnimationFrame(frame)
    else {
      window.clearTimeout(fallback)
      o.root.classList.add("is-done")
      window.setTimeout(remove, 1400)
    }
  }
  requestAnimationFrame(frame)
}

let arrivalStarted = false
/**
 * Called whenever the world becomes playable: remembers this tab is in the
 * world and, after a refresh, plays the arrival once. Module-level and not
 * tied to an effect cleanup, so React's double mount cannot drop it.
 */
export const enterWorld = (): void => {
  markInWorld()
  if (arrivalStarted) return
  arrivalStarted = true
  const note = takeRefreshArrival()
  refreshRT.pending = false
  if (!note) return
  warpIn(progressMood(), note.where)
  // the checkpoint is restored on the first free frame; light her up just after
  window.setTimeout(() => {
    let line = arrivalLine(note.where)
    if (note.where !== "earth") {
      const saved = ((): LocationCheckpoint | null => {
        try { return readLocationCheckpoint(window.localStorage.getItem(LOCATION_KEY)) } catch { return null }
      })()
      const b = avatarRT().pos
      if (!saved || Math.hypot(saved.x - b.x, saved.z - b.z) > 8) line = "Refreshed."
    }
    useGame.getState().showHint(line)
  }, 700)
}
