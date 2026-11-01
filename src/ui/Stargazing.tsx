import { useMemo, useState } from "react"
import { BRIGHT_STARS } from "../game/environment/starCatalogue"
import { useAdventures } from "../state/adventureStore"
import { useActivityUI } from "../game/activities/activityState"
import { avatarRT, cameraRT, worldRT } from "../game/runtime"
import { sfx } from "../game/audio/audio"
import { useDialogFocus } from "./useDialogFocus"

/**
 * Stargazing: real star positions (J2000, starCatalogue.ts) projected onto a
 * small chart over the night sky. Connect the stars of a constellation in any
 * order — each correct pair draws a line — and the figure reveals itself.
 */
type Figure = { name: string; story: string; edges: [string, string][] }
export const CONSTELLATIONS: Figure[] = [
  {
    name: "Orion",
    story: "The hunter with the three-star belt. Easy to find, impossible to forget.",
    edges: [["Betelgeuse", "Bellatrix"], ["Bellatrix", "Mintaka"], ["Mintaka", "Alnilam"], ["Alnilam", "Alnitak"], ["Alnitak", "Betelgeuse"], ["Alnitak", "Saiph"], ["Mintaka", "Rigel"], ["Meissa", "Betelgeuse"], ["Meissa", "Bellatrix"]],
  },
  {
    name: "Big Dipper",
    story: "Follow the two stars at the end of the cup and they point to the North Star.",
    edges: [["Dubhe", "Merak"], ["Merak", "Phecda"], ["Phecda", "Megrez"], ["Megrez", "Dubhe"], ["Megrez", "Alioth"], ["Alioth", "Mizar"], ["Mizar", "Alkaid"]],
  },
  {
    name: "Cassiopeia",
    story: "A queen's crown shaped like a W, circling the pole all year.",
    edges: [["Caph", "Schedar"], ["Schedar", "Navi"], ["Navi", "Ruchbah"], ["Ruchbah", "Segin"]],
  },
  {
    name: "Cygnus",
    story: "The swan flying down the Milky Way. Some call it the Northern Cross.",
    edges: [["Deneb", "Sadr"], ["Sadr", "Albireo"], ["Gienah", "Sadr"]],
  },
  {
    name: "Scorpius",
    story: "A long curving tail with red Antares as its heart.",
    edges: [["Graffias", "Dschubba"], ["Dschubba", "Antares"], ["Antares", "Sargas"], ["Sargas", "Shaula"]],
  },
]

const D2R = Math.PI / 180
type Pt = { name: string; x: number; y: number; mag: number; member: boolean }

/** Gnomonic projection around the figure's centre, fitted to the chart. */
const chart = (figure: Figure): Pt[] => {
  const names = new Set(figure.edges.flat())
  const members = BRIGHT_STARS.filter((s) => names.has(s.name))
  const cx = Math.atan2(members.reduce((a, s) => a + Math.sin(s.ra * D2R), 0), members.reduce((a, s) => a + Math.cos(s.ra * D2R), 0))
  const cy = members.reduce((a, s) => a + s.dec, 0) / members.length * D2R
  const project = (ra: number, dec: number): [number, number, number] => {
    const a = ra * D2R, d = dec * D2R
    const cosc = Math.sin(cy) * Math.sin(d) + Math.cos(cy) * Math.cos(d) * Math.cos(a - cx)
    // sky charts are drawn as seen from below: east to the left
    const x = -(Math.cos(d) * Math.sin(a - cx)) / cosc
    const y = -(Math.cos(cy) * Math.sin(d) - Math.sin(cy) * Math.cos(d) * Math.cos(a - cx)) / cosc
    return [x, y, cosc]
  }
  const pts: Pt[] = []
  for (const s of BRIGHT_STARS) {
    const [x, y, c] = project(s.ra, s.dec)
    if (c < 0.85) continue
    pts.push({ name: s.name, x, y, mag: s.mag, member: names.has(s.name) })
  }
  const memberPts = pts.filter((p) => p.member)
  const minX = Math.min(...memberPts.map((p) => p.x)), maxX = Math.max(...memberPts.map((p) => p.x))
  const minY = Math.min(...memberPts.map((p) => p.y)), maxY = Math.max(...memberPts.map((p) => p.y))
  const scale = 0.7 / Math.max(maxX - minX, maxY - minY, 1e-3)
  const mx = (minX + maxX) / 2, my = (minY + maxY) / 2
  return pts.map((p) => ({ ...p, x: 0.5 + (p.x - mx) * scale, y: 0.5 + (p.y - my) * scale })).filter((p) => p.x > 0.02 && p.x < 0.98 && p.y > 0.02 && p.y < 0.98)
}

// faint background stars, fixed per session
const DUST = Array.from({ length: 160 }, (_, i) => ({ x: (Math.sin(i * 91.7) * 0.5 + 0.5), y: (Math.sin(i * 47.3 + 2) * 0.5 + 0.5), r: 0.4 + (i % 5) * 0.18, o: 0.15 + (i % 7) * 0.05 }))

export const Stargazing = (): React.ReactElement | null => {
  const mode = useActivityUI((s) => s.mode)
  const found = useAdventures((s) => s.records.constellations)
  const addConstellation = useAdventures((s) => s.addConstellation)
  const [index, setIndex] = useState(() => Math.max(0, CONSTELLATIONS.findIndex((c) => !found.includes(c.name))))
  const [drawn, setDrawn] = useState<string[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const [miss, setMiss] = useState(0)
  const open = mode === "stars"
  const close = (): void => {
    const body = avatarRT()
    body.paused = false
    if (body.gesture === "sit") body.gesture = "none"
    worldRT.focus.active = false
    worldRT.focus.yaw = worldRT.focus.pitch = worldRT.focus.distance = null
    cameraRT.targetYaw = cameraRT.yaw
    useActivityUI.getState().setMode("none")
  }
  const dialog = useDialogFocus(open, close)
  const figure = CONSTELLATIONS[index]
  const points = useMemo(() => chart(figure), [figure])
  const done = drawn.length === figure.edges.length
  const known = found.includes(figure.name)


  if (!open) return null
  const key = (a: string, b: string): string => [a, b].sort().join("|")
  const choose = (name: string): void => {
    if (done) return
    if (!picked) { setPicked(name); sfx.pop(); return }
    if (picked === name) { setPicked(null); return }
    const k = key(picked, name)
    if (figure.edges.some(([a, b]) => key(a, b) === k) && !drawn.includes(k)) {
      const next = [...drawn, k]
      setDrawn(next)
      sfx.twinkle()
      if (next.length === figure.edges.length) {
        sfx.fanfare()
        addConstellation(figure.name)
      }
    } else {
      setMiss((m) => m + 1)
    }
    setPicked(name)
  }
  const byName = new Map(points.map((p) => [p.name, p]))
  return (
    <div className="stargazing" role="dialog" aria-modal="true" aria-label="Stargazing" ref={dialog}>
      <div className="stargazing-panel">
        <header>
          <h2>{done || known ? figure.name : "Connect the stars"}</h2>
          <button onClick={close} aria-label="Stop stargazing">Done</button>
        </header>
        <svg key={`chart-${index}-${miss}`} viewBox="0 0 100 100" className={miss ? "miss" : ""} aria-label={`Star chart for ${figure.name}`}>
          {DUST.map((d, i) => <circle key={i} cx={d.x * 100} cy={d.y * 100} r={d.r * 0.25} fill="#fff" opacity={d.o} />)}
          {figure.edges.map(([a, b]) => {
            const pa = byName.get(a), pb = byName.get(b)
            if (!pa || !pb) return null
            const on = drawn.includes(key(a, b))
            return <line key={a + b} x1={pa.x * 100} y1={pa.y * 100} x2={pb.x * 100} y2={pb.y * 100} className={on ? "edge on" : known && !done ? "edge hint" : "edge"} />
          })}
          {points.map((p) => {
            const r = Math.max(0.7, 2.3 - p.mag * 0.55)
            return (
              <g key={p.name} className={`star${picked === p.name ? " picked" : ""}`} onClick={() => choose(p.name)} role="button" aria-label={p.name} tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") choose(p.name) }}>
                <circle cx={p.x * 100} cy={p.y * 100} r={r * 3.2} fill="transparent" />
                <circle cx={p.x * 100} cy={p.y * 100} r={r * 1.9} className="glow" />
                <circle cx={p.x * 100} cy={p.y * 100} r={r * 0.55} className="core" />
                {(done || picked === p.name) && p.member && <text x={p.x * 100 + 2.4} y={p.y * 100 - 1.6}>{p.name}</text>}
              </g>
            )
          })}
        </svg>
        <p className="stargazing-line">{done ? figure.story : picked ? "Now the next star of the shape." : "Pick a bright star, then another that belongs with it."}</p>
        <nav>
          {CONSTELLATIONS.map((c, i) => (
            <button key={c.name} className={i === index ? "on" : ""} onClick={() => { setIndex(i); setDrawn([]); setPicked(null); setMiss(0) }} aria-pressed={i === index}>
              {found.includes(c.name) ? `✦ ${c.name}` : `? ${i + 1}`}
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}
