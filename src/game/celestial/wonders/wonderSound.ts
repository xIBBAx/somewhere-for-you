import { audioContext, audioLive, audioOut } from "../../audio/audio"
import { toneOf, type WonderWorld } from "./wonderWorlds"

/**
 * Starborn's wonder sounds, synthesised here (nothing downloaded): soft bells
 * for the lights, glints for the ice, a rising run when a constellation is
 * whole. They play through the SFX bus, so mute and the mix apply, and they
 * stay silent until audio has been unlocked.
 */

const PARTIALS: ReadonlyArray<readonly [number, number]> = [[1, 1], [2.005, 0.2], [3.99, 0.05]]

/** A soft bell: a sine with two quiet overtones, a slow fade, panned a little. `when` is seconds from now. */
export const chime = (freq: number, pan = 0, gain = 0.05, dur = 1.9, when = 0): void => {
  const ctx = audioContext(), out = audioOut()
  if (!ctx || !out || !audioLive()) return
  try {
    const t = ctx.currentTime + when
    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, t)
    env.gain.exponentialRampToValueAtTime(gain, t + 0.012)
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    const panner = ctx.createStereoPanner()
    panner.pan.value = Math.max(-0.9, Math.min(0.9, pan))
    env.connect(panner).connect(out)
    for (const [m, a] of PARTIALS) {
      const osc = ctx.createOscillator(), g = ctx.createGain()
      osc.frequency.value = freq * m
      g.gain.value = a
      osc.connect(g).connect(env)
      osc.start(t)
      osc.stop(t + dur + 0.05)
    }
  } catch {
    // audio refused the node: the wonder still plays without its sound
  }
}

/** A finished constellation: the world's scale run up, one bell at a time. */
export const fanfare = (w: WonderWorld): void => {
  for (let k = 0; k < 8; k++) chime(toneOf(w, k), 0, 0.045, 2.6, k * 0.12)
}
