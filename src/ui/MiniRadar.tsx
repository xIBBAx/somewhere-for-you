import { debugEnabled } from "../dev/debugFlag"
import { useEffect, useRef } from "react"
import { cameraRT } from "../game/runtime"
import { isMark, useNavigation } from "../state/navigationStore"
import { companionMarkers, earthMarkers, navigatorActor, type AtlasMarker, type CompanionMarker } from "../game/navigation/atlasSnapshot"
import { bearingOf, drawMap, toScreen, type MapView } from "../game/navigation/mapView"
import { onMapTiles } from "../game/navigation/mapTileCache"
import { drawGlyph } from "./mapGlyphs"

/**
 * The corner minimap: the same terrain tiles and paths as the World map,
 * drawn every frame (not stepped at 10 Hz), turned so that up is where the
 * camera looks (what is ahead on screen is ahead on the map, whichever way
 * The explorer faces or strafes or the view is turned), centred on whoever is moving:
 * The explorer, or the mount underneath. The arrow shows the explorer's facing within it.
 * The zoom eases between rungs; a destination beyond the rim sits on the rim
 * in its true direction. QA reads `miniRadarRT` (what was drawn, and where).
 */

export const miniRadarRT = {
  view: null as MapView | null,
  /** screen positions (CSS px within the disc) of the markers drawn last frame */
  drawn: [] as { id: string; x: number; y: number; rim: boolean }[],
  /** the arrow's angle on screen (radians clockwise from up) */
  arrow: 0,
}

// QA (?debug): the maps' state on window.__worldMap
if (debugEnabled()) {
  const w = window as unknown as { __worldMap?: Record<string, unknown> }
  w.__worldMap = { ...(w.__worldMap ?? {}), mini: miniRadarRT }
}

/** The camera's horizontal look direction as a compass bearing (radians). The boom sits at +(sin yaw, cos yaw) from what it looks at. */
export const viewBearing = (): number => bearingOf(-Math.sin(cameraRT.yaw), -Math.cos(cameraRT.yaw))

export const MiniRadar = ({ range }: { range: number }): React.ReactElement => {
  const canvas = useRef<HTMLCanvasElement>(null)
  const rangeRef = useRef(range)
  useEffect(() => { rangeRef.current = range }, [range])
  useEffect(() => {
    let raf = 0, alive = true, markers: AtlasMarker[] = [], companions: CompanionMarker[] = [], markersAt = -1e9
    let mpp = 0, last = performance.now(), dirty = true
    const off = onMapTiles(() => { dirty = true })
    let lastKey = ""
    const frame = (now: number): void => {
      if (!alive) return
      raf = requestAnimationFrame(frame)
      const el = canvas.current
      if (!el || document.hidden) return
      const size = el.clientWidth
      if (size < 8) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const px = Math.round(size * dpr)
      if (el.width !== px) { el.width = el.height = px; dirty = true }
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const actor = navigatorActor()
      const R = size / 2 - 3
      const want = rangeRef.current / R
      mpp = mpp === 0 ? want : mpp + (want - mpp) * (1 - Math.exp(-dt * 5))
      const up = viewBearing()
      const destination = useNavigation.getState().destination
      // the marker list changes slowly: refreshed four times a second
      if (now - markersAt > 250) {
        markersAt = now
        markers = earthMarkers(actor.x, actor.z, rangeRef.current)
        companions = companionMarkers()
        dirty = true
      }
      const key = `${actor.x.toFixed(2)},${actor.z.toFixed(2)},${actor.heading.toFixed(3)},${up.toFixed(4)},${mpp.toFixed(4)},${destination?.id ?? ""}`
      if (!dirty && key === lastKey) return
      dirty = false
      lastKey = key
      const ctx = el.getContext("2d")
      if (!ctx) return
      const v: MapView = { cx: actor.x, cz: actor.z, mpp, up, w: size, h: size }
      miniRadarRT.view = v
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, size, size)
      ctx.save()
      ctx.beginPath(); ctx.arc(size / 2, size / 2, R, 0, Math.PI * 2); ctx.clip()
      ctx.fillStyle = "#0b1f22"
      ctx.fillRect(0, 0, size, size)
      ctx.globalAlpha = 0.86
      drawMap(ctx, v, { detail: dpr })
      ctx.globalAlpha = 1
      // a soft vignette toward the rim keeps the disc light on the world behind it
      const g = ctx.createRadialGradient(size / 2, size / 2, R * 0.55, size / 2, size / 2, R)
      g.addColorStop(0, "#06171a00"); g.addColorStop(1, "#06171a8c")
      ctx.fillStyle = g
      ctx.fillRect(0, 0, size, size)
      ctx.restore()
      // markers: the destination first, so nothing hides it; the rest only inside the rim
      const drawn: typeof miniRadarRT.drawn = []
      const p = { x: 0, y: 0 }
      const cx = size / 2, cy = size / 2
      const list = [...markers]
      if (destination?.kind === "earth" && !list.some((m) => m.destination.id === destination.id)) list.push({ destination, x: destination.x, z: destination.z, found: false, glyph: isMark(destination) ? "mark" : "pin" })
      // the one she is heading for first, so nothing near it is drawn over it
      list.sort((a, b) => Number(b.destination.id === destination?.id) - Number(a.destination.id === destination?.id))
      for (const m of list) {
        const selected = destination?.id === m.destination.id
        toScreen(v, m.x, m.z, p)
        const d = Math.hypot(p.x - cx, p.y - cy)
        let rim = false
        if (d > R - 7) {
          if (!selected) continue
          rim = true
          p.x = cx + (p.x - cx) / d * (R - 7); p.y = cy + (p.y - cy) / d * (R - 7)
        }
        if (!selected && drawn.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 9)) continue
        drawGlyph(ctx, selected && m.glyph !== "mark" ? "pin" : m.glyph, p.x, p.y, size < 100 ? 0.8 : 1, { found: m.found, selected })
        drawn.push({ id: m.destination.id, x: p.x, y: p.y, rim })
      }
      for (const c of companions) {
        toScreen(v, c.x, c.z, p)
        if (Math.hypot(p.x - cx, p.y - cy) > R - 6) continue
        drawGlyph(ctx, c.kind === "starborn" ? "starborn" : "pegasus", p.x, p.y, 0.85, { found: true, selected: false })
      }
      miniRadarRT.drawn = drawn
      // the rim, and north on it
      ctx.strokeStyle = "#e8f2e299"; ctx.lineWidth = 1
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke()
      const nx = cx - Math.sin(up) * (R - 1), ny = cy - Math.cos(up) * (R - 1)
      ctx.font = "600 9px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"
      ctx.fillStyle = "#0b1a1d"; ctx.beginPath(); ctx.arc(nx, ny, 6.5, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = "#fff4d6"; ctx.fillText("N", nx, ny + 0.5)
      // you: facing within the turned map
      const arrow = bearingOf(Math.sin(actor.heading), Math.cos(actor.heading)) - up
      miniRadarRT.arrow = arrow
      drawGlyph(ctx, "you", cx, cy, size < 100 ? 0.85 : 1, { found: true, selected: false, angle: arrow, mounted: actor.mounted })
    }
    raf = requestAnimationFrame(frame)
    return () => { alive = false; cancelAnimationFrame(raf); off() }
  }, [])
  return <canvas ref={canvas} className="mini-radar" aria-hidden="true" />
}
