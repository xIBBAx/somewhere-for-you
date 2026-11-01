import { audioContext, audioOut } from "../audio/audio"
import { dashGain, type DashSignature } from "./dashSignature"

/**
 * The Pegasi's dashes, synthesised on the SFX bus (no recordings, nothing to
 * license). Each one has its own voice, and the horses' dash stays silent here:
 *   swift     Ivory: a breathy slipstream whoosh, and a soft pearly chime on onset
 *   thunder   Onyx: a deep whoomph on onset, then a thump and a pressure puff per downstroke
 *   starfall  Starborn: a shimmer of bell tones and a rushing airy sweep on onset;
 *             a high rip of air when the light tears open in thin air
 * Sound falls off with distance and nothing loops. Mute works through the master
 * chain in audio.ts, so nothing here checks the mute flag itself.
 */

const RANGE = 140
let noiseBuf: AudioBuffer | null = null
const noise = (ctx: AudioContext): AudioBuffer => {
  if (noiseBuf) return noiseBuf
  const len = Math.round(ctx.sampleRate * 1.5)
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = noiseBuf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  return noiseBuf
}

/** Filtered noise swept from f0 to f1 over dur seconds: the air moving past. */
const whoosh = (ctx: AudioContext, out: AudioNode, t0: number, dur: number, f0: number, f1: number, q: number, gain: number, type: BiquadFilterType = "bandpass"): void => {
  const src = ctx.createBufferSource()
  src.buffer = noise(ctx)
  const f = ctx.createBiquadFilter()
  f.type = type
  f.Q.value = q
  f.frequency.setValueAtTime(f0, t0)
  f.frequency.exponentialRampToValueAtTime(f1, t0 + dur)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.25)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(f).connect(g).connect(out)
  src.start(t0, Math.random() * 0.4)
  src.stop(t0 + dur + 0.05)
}

/** A bell-like sine: a quick swell and a long, soft decay. */
const bell = (ctx: AudioContext, out: AudioNode, t0: number, freq: number, dur: number, gain: number, slide = 1): void => {
  const o = ctx.createOscillator()
  o.type = "sine"
  o.frequency.setValueAtTime(freq, t0)
  if (slide !== 1) o.frequency.exponentialRampToValueAtTime(freq * slide, t0 + dur)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.03)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g).connect(out)
  o.start(t0)
  o.stop(t0 + dur + 0.05)
}

/** A low body thump whose pitch drops as it dies away. */
const thump = (ctx: AudioContext, out: AudioNode, t0: number, freq: number, dur: number, gain: number): void => {
  bell(ctx, out, t0, freq, dur, gain, 0.45)
}

/** Plays `fn` on the SFX bus at this distance, if audio is running and the source is near enough to hear. */
const onBus = (dist: number, fn: (ctx: AudioContext, out: AudioNode, g: number) => void): void => {
  const ctx = audioContext()
  const out = audioOut()
  if (!ctx || !out || ctx.state !== "running") return
  const g = dashGain(dist, RANGE)
  if (g < 1e-3) return
  fn(ctx, out, g)
}

export const dashSound = {
  /** the first frame of a dash: each Pegasus's own voice */
  onset(kind: DashSignature, dist: number): void {
    onBus(dist, (ctx, out, g) => {
      const t = ctx.currentTime
      if (kind === "swift") {
        // a slipstream: air hissing past, then a pearly chime for the lightness of her
        whoosh(ctx, out, t, 0.9, 900, 3200, 1.4, g * 0.2)
        bell(ctx, out, t + 0.02, 2093, 1.4, g * 0.045)
        bell(ctx, out, t + 0.1, 2637, 1.2, g * 0.03)
        bell(ctx, out, t + 0.18, 3136, 1.1, g * 0.02)
      } else if (kind === "thunder") {
        // a deep whoomph and a rush of air: the first stroke of raw power
        thump(ctx, out, t, 96, 1, g * 0.4)
        whoosh(ctx, out, t, 0.8, 700, 120, 0.7, g * 0.22, "lowpass")
      } else {
        // starlight: a bell-chord shimmer, and a bright airy rush tearing past
        bell(ctx, out, t, 1046, 1.6, g * 0.045)
        bell(ctx, out, t + 0.06, 1568, 1.5, g * 0.035)
        bell(ctx, out, t + 0.12, 2093, 1.4, g * 0.03)
        bell(ctx, out, t + 0.2, 2637, 1.3, g * 0.022)
        whoosh(ctx, out, t, 0.9, 5000, 1600, 1.2, g * 0.14)
      }
    })
  },
  /** a ground surge (groundDash.ts): a horse's gale, a deer's rush through the trees */
  ground(kind: "gale" | "grove"): void {
    onBus(0, (ctx, out, g) => {
      const t = ctx.currentTime
      if (kind === "gale") {
        // a drum of hooves gathering and the air tearing past
        thump(ctx, out, t, 70, 0.5, g * 0.25)
        whoosh(ctx, out, t, 1.1, 300, 2400, 1, g * 0.18)
      } else {
        // a rush of leaves, and a soft wooden chime of the forest
        whoosh(ctx, out, t, 1.3, 1800, 5200, 0.9, g * 0.12, "highpass")
        bell(ctx, out, t + 0.05, 784, 1.2, g * 0.03)
        bell(ctx, out, t + 0.16, 1175, 1.1, g * 0.022)
      }
    })
  },
  /** one of Onyx's driving downstrokes, in the dash */
  stroke(dist: number): void {
    onBus(dist, (ctx, out, g) => {
      const t = ctx.currentTime
      thump(ctx, out, t, 58, 0.38, g * 0.3)
      whoosh(ctx, out, t, 0.22, 420, 150, 0.8, g * 0.12, "lowpass")
    })
  },
  /** a rip of light opening in thin air (Starborn) */
  rip(dist: number): void {
    onBus(dist, (ctx, out, g) => {
      const t = ctx.currentTime
      whoosh(ctx, out, t, 0.3, 9000, 3000, 0.9, g * 0.08, "highpass")
      bell(ctx, out, t + 0.02, 3520, 0.5, g * 0.018)
    })
  },
}
