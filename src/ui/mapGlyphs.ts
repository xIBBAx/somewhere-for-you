import { MARK_COLOUR } from "../game/navigation/markPlace"

/**
 * The map's own symbols, drawn on a canvas so the minimap can move them every
 * frame: one family of small, dark-cased shapes (legible over grass, snow or
 * water alike), warm for what is ours, cool for what is still to be found.
 */

export type GlyphKind = "you" | "home" | "memory" | "place" | "star" | "find" | "pin" | "mark" | "unknown" | "pegasus" | "starborn"
type Opts = { found: boolean; selected: boolean; angle?: number; mounted?: boolean }

const CASE = "#0b1a1d"
const WARM = "#ffe2a0"
const COOL = "#a9e2d6"
const MARK = MARK_COLOUR

export const drawGlyph = (ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, scale: number, o: Opts): void => {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(scale, scale)
  ctx.lineJoin = "round"
  ctx.lineWidth = 2
  ctx.strokeStyle = CASE
  const fill = (c: string): void => { ctx.fillStyle = c; ctx.fill(); ctx.stroke() }
  switch (kind as GlyphKind) {
    case "you": {
      ctx.rotate(o.angle ?? 0)
      ctx.beginPath()
      ctx.moveTo(0, -7.5); ctx.lineTo(5.5, 6); ctx.lineTo(0, 3.2); ctx.lineTo(-5.5, 6); ctx.closePath()
      ctx.lineWidth = 2.4
      fill("#fbfaf0")
      if (o.mounted) { ctx.beginPath(); ctx.arc(0, 0, 9.5, 0, Math.PI * 2); ctx.lineWidth = 1.3; ctx.strokeStyle = "#fbfaf0bb"; ctx.stroke() }
      break
    }
    case "home": {
      ctx.beginPath()
      ctx.moveTo(0, -6); ctx.lineTo(5.5, -0.8); ctx.lineTo(4, -0.8); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.lineTo(-4, -0.8); ctx.lineTo(-5.5, -0.8); ctx.closePath()
      fill(WARM)
      break
    }
    case "memory": {
      // a little open book: warm once remembered, an outline still to find
      ctx.beginPath()
      ctx.moveTo(0, -2.8); ctx.quadraticCurveTo(-3, -4.6, -5.6, -3.6); ctx.lineTo(-5.6, 3.6); ctx.quadraticCurveTo(-3, 2.6, 0, 4.2)
      ctx.quadraticCurveTo(3, 2.6, 5.6, 3.6); ctx.lineTo(5.6, -3.6); ctx.quadraticCurveTo(3, -4.6, 0, -2.8); ctx.closePath()
      fill(o.found ? WARM : "#22403f")
      if (!o.found) { ctx.strokeStyle = COOL; ctx.lineWidth = 1.1; ctx.stroke() }
      ctx.beginPath(); ctx.moveTo(0, -2.6); ctx.lineTo(0, 4); ctx.strokeStyle = o.found ? "#8a6a2c" : COOL; ctx.lineWidth = 0.9; ctx.stroke()
      break
    }
    case "place": {
      ctx.beginPath(); ctx.moveTo(0, -5.5); ctx.lineTo(5, 0); ctx.lineTo(0, 5.5); ctx.lineTo(-5, 0); ctx.closePath()
      fill(o.found ? "#f1e6cf" : COOL)
      break
    }
    case "star": {
      ctx.beginPath()
      for (let i = 0; i < 8; i++) { const r = i % 2 ? 2.3 : 6, a = i * Math.PI / 4; ctx.lineTo(Math.sin(a) * r, -Math.cos(a) * r) }
      ctx.closePath()
      fill(o.found ? WARM : COOL)
      break
    }
    case "find": {
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2)
      fill(o.found ? "#f1e6cf" : COOL)
      break
    }
    case "pin": {
      // the point of the pin is on the place itself
      ctx.translate(0, -7)
      ctx.beginPath()
      ctx.moveTo(0, 7); ctx.bezierCurveTo(-2, 3, -6, 0, -6, -3.5); ctx.arc(0, -3.5, 6, Math.PI, 0); ctx.bezierCurveTo(6, 0, 2, 3, 0, 7); ctx.closePath()
      fill("#ffd36e")
      ctx.beginPath(); ctx.arc(0, -3.5, 2.1, 0, Math.PI * 2); ctx.fillStyle = CASE; ctx.fill()
      break
    }
    case "mark": {
      // X marks the spot: a cased cross, ringed while it is the one she is heading for
      if (o.selected) { ctx.beginPath(); ctx.arc(0, 0, 8.6, 0, Math.PI * 2); ctx.lineWidth = 3.4; ctx.stroke(); ctx.strokeStyle = MARK; ctx.lineWidth = 1.6; ctx.stroke() }
      ctx.lineCap = "round"
      const k = o.selected ? 4.6 : 3.8
      ctx.beginPath(); ctx.moveTo(-k, -k); ctx.lineTo(k, k); ctx.moveTo(k, -k); ctx.lineTo(-k, k)
      ctx.strokeStyle = CASE; ctx.lineWidth = o.selected ? 5.2 : 4.4; ctx.stroke()
      ctx.strokeStyle = o.found ? "#e9b3c1" : MARK; ctx.lineWidth = o.selected ? 2.6 : 2.1; ctx.stroke()
      break
    }
    case "unknown": {
      // somewhere not yet found: a faint diamond with nothing told about it
      ctx.beginPath(); ctx.moveTo(0, -4.6); ctx.lineTo(4.2, 0); ctx.lineTo(0, 4.6); ctx.lineTo(-4.2, 0); ctx.closePath()
      ctx.fillStyle = "#22403fcc"; ctx.fill(); ctx.strokeStyle = COOL; ctx.lineWidth = 1.1; ctx.stroke()
      break
    }
    case "pegasus":
    case "starborn": {
      ctx.beginPath(); ctx.arc(0, 0, 4.6, 0, Math.PI * 2)
      fill(kind === "starborn" ? "#d9ccff" : "#fbeccb")
      ctx.beginPath(); ctx.moveTo(-3, 0.6); ctx.quadraticCurveTo(0, -3.4, 3, 0.6); ctx.strokeStyle = CASE; ctx.lineWidth = 1.2; ctx.stroke()
      break
    }
    default: {
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2)
      fill("#f1e6cf")
    }
  }
  ctx.restore()
}
