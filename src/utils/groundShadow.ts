import * as THREE from "three"
import { textTexture } from "./canvasTexture"

let shadowTex: THREE.CanvasTexture | null = null

/** Soft radial-gradient blob used as a cheap grounded shadow. */
export const groundShadowTexture = (): THREE.CanvasTexture => {
  if (shadowTex) return shadowTex
  shadowTex = textTexture("groundShadow", (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2)
    g.addColorStop(0, "rgba(40,30,50,0.55)")
    g.addColorStop(0.7, "rgba(40,30,50,0.28)")
    g.addColorStop(1, "rgba(40,30,50,0)")
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }, 128, 128)
  return shadowTex
}
