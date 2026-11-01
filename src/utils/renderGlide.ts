import { damp, dampAngle } from "./math"

/**
 * Where to draw a creature that is simulated in steps (far animals move once
 * every 0.1–0.65 s to save time). Drawn at the stepped position it jumps on
 * each step and dwells between: a visible 2–10 Hz judder. Instead it carries
 * on along its heading at its speed since the last step, which is where the
 * next step will put it, and eases out whatever turning or braking that guess
 * missed. Exactly the simulated position when stepped every frame.
 */
export type Glide = { x: number; z: number; heading: number; ready: boolean }

export const makeGlide = (): Glide => ({ x: 0, z: 0, heading: 0, ready: false })

/** Residual easing rate (1/s): fast enough to hide a step, slow enough not to show one. */
const SETTLE = 14

/**
 * `sinceStep`: seconds since the creature's last simulation step. `exact`:
 * it steps every frame now (near, ridden), so draw it exactly where it is.
 */
export const glideTo = (
  g: Glide, x: number, z: number, heading: number, speed: number, turnRate: number,
  sinceStep: number, exact: boolean, dt: number,
): Glide => {
  const h = heading + turnRate * sinceStep
  const tx = x + Math.sin(heading) * speed * sinceStep
  const tz = z + Math.cos(heading) * speed * sinceStep
  // first sight, every-frame simulation, or a teleport: exactly there
  if (!g.ready || exact || (tx - g.x) ** 2 + (tz - g.z) ** 2 > 9) {
    g.x = tx
    g.z = tz
    g.heading = h
    g.ready = true
    return g
  }
  g.x = damp(g.x, tx, SETTLE, dt)
  g.z = damp(g.z, tz, SETTLE, dt)
  g.heading = dampAngle(g.heading, h, SETTLE, dt)
  return g
}
