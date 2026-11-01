import { audioContext, audioOut } from "../audio/audio"
import type { HorseState } from "./horseState"

/**
 * Horse sounds synthesised on the game's WebAudio SFX bus (no recordings,
 * so nothing to license): hoofbeats whose weight and brightness follow the
 * gait and the ground, the fluttering snort of a relaxed horse, breathing in
 * time with the canter, a low nicker of greeting and a soft creak of tack.
 * Distance attenuates everything; nothing loops.
 */
let noiseBuf: AudioBuffer | null = null
const noise = (ctx: AudioContext): AudioBuffer => {
  if (noiseBuf) return noiseBuf
  const len = ctx.sampleRate * 1.5
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = noiseBuf.getChannelData(0)
  let b = 0
  for (let i = 0; i < len; i++) {
    b = 0.97 * b + 0.03 * (Math.random() * 2 - 1)
    d[i] = (Math.random() * 2 - 1) * 0.6 + b * 2
  }
  return noiseBuf
}

const fade = (dist: number): number => Math.max(0, 1 - dist / 40) ** 1.6

const burst = (freq: number, q: number, dur: number, gain: number, delay = 0, type: BiquadFilterType = "bandpass", sweep?: number, am?: number): void => {
  const ctx = audioContext()
  const out = audioOut()
  if (!ctx || !out || gain < 1e-4) return
  const t0 = ctx.currentTime + delay
  const src = ctx.createBufferSource()
  src.buffer = noise(ctx)
  const f = ctx.createBiquadFilter()
  f.type = type
  f.Q.value = q
  f.frequency.setValueAtTime(freq, t0)
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t0 + dur)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.012, dur * 0.2))
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  let node: AudioNode = src.connect(f).connect(g)
  if (am) {
    // lips fluttering: amplitude modulation
    const mod = ctx.createGain()
    const lfo = ctx.createOscillator()
    const depth = ctx.createGain()
    lfo.frequency.value = am
    depth.gain.value = 0.5
    mod.gain.value = 0.5
    lfo.connect(depth).connect(mod.gain)
    node = node.connect(mod)
    lfo.start(t0)
    lfo.stop(t0 + dur + 0.05)
  }
  node.connect(out)
  src.start(t0, Math.random())
  src.stop(t0 + dur + 0.05)
}

const thud = (freq: number, dur: number, gain: number, delay = 0): void => {
  const ctx = audioContext()
  const out = audioOut()
  if (!ctx || !out || gain < 1e-4) return
  const t0 = ctx.currentTime + delay
  const o = ctx.createOscillator()
  o.type = "sine"
  o.frequency.setValueAtTime(freq, t0)
  o.frequency.exponentialRampToValueAtTime(freq * 0.55, t0 + dur)
  const g = ctx.createGain()
  g.gain.setValueAtTime(gain, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g).connect(out)
  o.start(t0)
  o.stop(t0 + dur + 0.02)
}

export const horseSounds = {
  /** a rider's two-note whistle for their Pegasus: a short rising "fweet",
   * then a long call that rises and falls, with a little vibrato. It starts
   * as the hand reaches the lips (the whistle gesture, ~0.35 s in) */
  whistle(): void {
    const ctx = audioContext()
    const out = audioOut()
    if (!ctx || !out) return
    const t0 = ctx.currentTime + 0.35
    // no two whistles quite alike: up to ±3 % in pitch
    const k = 1 + (Math.random() - 0.5) * 0.06
    const notes: Array<[number, number, number, number]> = [[0, 0.16, 1500 * k, 2350 * k], [0.24, 0.62, 1900 * k, 2650 * k]]
    for (const [at, dur, f0, f1] of notes) {
      const o = ctx.createOscillator()
      o.type = "sine"
      o.frequency.setValueAtTime(f0, t0 + at)
      o.frequency.exponentialRampToValueAtTime(f1, t0 + at + dur * 0.45)
      o.frequency.exponentialRampToValueAtTime(f1 * 0.86, t0 + at + dur)
      // the breath through the lips: a narrow band of air riding the note's
      // pitch, which is what makes a whistle sound blown rather than beeped
      const air = ctx.createBufferSource()
      air.buffer = noise(ctx)
      const bp = ctx.createBiquadFilter()
      bp.type = "bandpass"
      bp.Q.value = 14
      bp.frequency.setValueAtTime(f0, t0 + at)
      bp.frequency.exponentialRampToValueAtTime(f1, t0 + at + dur * 0.45)
      bp.frequency.exponentialRampToValueAtTime(f1 * 0.86, t0 + at + dur)
      const ag = ctx.createGain()
      ag.gain.setValueAtTime(0, t0 + at)
      ag.gain.linearRampToValueAtTime(0.1, t0 + at + 0.03)
      ag.gain.linearRampToValueAtTime(0, t0 + at + dur)
      air.connect(bp).connect(ag).connect(out)
      air.start(t0 + at, Math.random())
      air.stop(t0 + at + dur + 0.02)
      const vib = ctx.createOscillator()
      vib.frequency.value = 6.5
      const vg = ctx.createGain()
      vg.gain.value = 22
      vib.connect(vg).connect(o.frequency)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t0 + at)
      g.gain.linearRampToValueAtTime(0.08, t0 + at + 0.03)
      g.gain.setValueAtTime(0.072, t0 + at + dur - 0.06)
      g.gain.linearRampToValueAtTime(0, t0 + at + dur)
      o.connect(g).connect(out)
      o.start(t0 + at)
      vib.start(t0 + at)
      o.stop(t0 + at + dur + 0.02)
      vib.stop(t0 + at + dur + 0.02)
    }
    // breath around the note
    burst(2600, 1.2, 0.8, 0.01, 0.35)
  },
  /** one hoof striking: heavier and duller on turf, a click on hard ground, a splash in water */
  hoof(h: HorseState, strength: number, dist: number): void {
    const k = fade(dist) * (0.5 + 0.5 * strength) * (h.ident.breed === "draft" ? 1.25 : 1)
    if (k < 0.01) return
    if (h.wade > 0.1) {
      burst(900, 0.8, 0.28, 0.05 * k, 0, "bandpass", 300)
      return
    }
    thud(70 + Math.random() * 18, 0.12, 0.09 * k)
    burst(1700 + Math.random() * 600, 1.4, 0.05, 0.035 * k)
    burst(420, 0.9, 0.09, 0.03 * k, 0.005, "lowpass")
  },
  /** a relaxed horse blowing through its nose */
  snort(h: HorseState, dist: number): void {
    const k = fade(dist) * (h.exertion > 0.4 ? 1.2 : 1)
    burst(800, 0.7, 0.55, 0.05 * k, 0, "bandpass", 380, 28)
  },
  /** hard breathing at speed, in time with the stride */
  breath(h: HorseState, dist: number): void {
    burst(650, 0.6, 0.22, 0.02 * fade(dist) * h.exertion, 0, "bandpass", 420)
  },
  /** low greeting nicker */
  nicker(h: HorseState, dist: number): void {
    const ctx = audioContext()
    const out = audioOut()
    if (!ctx || !out) return
    const k = fade(dist)
    const t0 = ctx.currentTime
    const base = h.ident.breed === "draft" ? 92 : h.ident.breed === "arabian" ? 128 : 110
    for (let i = 0; i < 4; i++) {
      const o = ctx.createOscillator()
      o.type = "sawtooth"
      o.frequency.setValueAtTime(base * (1 + i * 0.02), t0 + i * 0.09)
      const lp = ctx.createBiquadFilter()
      lp.type = "lowpass"
      lp.frequency.value = 520
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t0 + i * 0.09)
      g.gain.linearRampToValueAtTime(0.025 * k * (1 - i * 0.15), t0 + i * 0.09 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.09 + 0.08)
      o.connect(lp).connect(g).connect(out)
      o.start(t0 + i * 0.09)
      o.stop(t0 + i * 0.09 + 0.1)
    }
  },
  /** leather creaking as a rider settles */
  creak(): void {
    burst(1200, 9, 0.18, 0.012, 0, "bandpass", 900)
  },
}
