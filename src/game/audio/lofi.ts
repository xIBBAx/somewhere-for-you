import { audioContext, musicOut } from "./audio"

/**
 * Generative lofi for the world, synthesised live (original,
 * nothing licensed): a warm FM electric piano with tremolo and tape wobble
 * playing jazz voicings, a round bass, soft swung drums, vinyl hiss and
 * crackle, and an occasional music-box melody through a small reverb.
 *
 *   day   — 76 bpm, gentle beat
 *   rain  — the same, softer, more crackle
 *   night — 64 bpm, no snare, slower chords, more reverb
 *
 * Everything sits low and warm (lowpassed at ~5 kHz, compressed by the
 * master bus) so it never competes with the world's sounds.
 */
export type LofiMood = "day" | "night" | "rain"

const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12)
const PROGRESSIONS: Record<LofiMood, { root: number; notes: number[] }[]> = {
  day: [
    { root: 41, notes: [57, 60, 64, 67] }, // Fmaj9-ish
    { root: 40, notes: [55, 59, 62, 66] }, // Em7(9)
    { root: 38, notes: [53, 57, 60, 64] }, // Dm9
    { root: 36, notes: [52, 55, 59, 62] }, // Cmaj9
  ],
  rain: [
    { root: 45, notes: [55, 60, 64, 67] }, // Am9
    { root: 41, notes: [57, 60, 64, 67] }, // Fmaj9
    { root: 43, notes: [53, 59, 62, 65] }, // G13
    { root: 40, notes: [55, 59, 62, 66] }, // Em7
  ],
  night: [
    { root: 45, notes: [55, 59, 60, 64] }, // Am(add9)
    { root: 41, notes: [52, 57, 60, 64] }, // Fmaj7
    { root: 36, notes: [52, 55, 59, 64] }, // Cmaj7
    { root: 43, notes: [50, 55, 59, 64] }, // G6
  ],
}
const PENTA = [0, 2, 4, 7, 9]

type Engine = {
  bus: GainNode
  ep: GainNode
  drums: GainNode
  send: GainNode
  wobble: OscillatorNode
  wobbleDepth: GainNode
  hiss: AudioBufferSourceNode
  timer: number
  next: number
  step: number
  bar: number
  mood: LofiMood
  variant: number
}

let engine: Engine | null = null
let wanted = false
let teardown = 0
let mood: LofiMood = "day"
let noiseBuffer: AudioBuffer | null = null

const noise = (ctx: AudioContext): AudioBuffer => {
  if (noiseBuffer) return noiseBuffer
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const d = b.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  noiseBuffer = b
  return b
}

const impulse = (ctx: AudioContext, seconds: number): AudioBuffer => {
  const len = Math.floor(ctx.sampleRate * seconds)
  const b = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2)
  }
  return b
}

const build = (ctx: AudioContext): Engine | null => {
  const out = musicOut()
  if (!out) return null
  const bus = ctx.createGain()
  bus.gain.value = 0
  const tone = ctx.createBiquadFilter()
  tone.type = "lowpass"
  tone.frequency.value = 5200
  tone.Q.value = 0.4
  const lowcut = ctx.createBiquadFilter()
  lowcut.type = "highpass"
  lowcut.frequency.value = 38
  bus.connect(tone).connect(lowcut).connect(out)
  // a small room
  const verb = ctx.createConvolver()
  verb.buffer = impulse(ctx, 2.6)
  const verbGain = ctx.createGain()
  verbGain.gain.value = 0.35
  const send = ctx.createGain()
  send.connect(verb).connect(verbGain).connect(bus)
  // electric piano bus with tremolo
  const ep = ctx.createGain()
  ep.gain.value = 0.9
  const trem = ctx.createOscillator()
  trem.frequency.value = 4.3
  const tremDepth = ctx.createGain()
  tremDepth.gain.value = 0.12
  trem.connect(tremDepth).connect(ep.gain)
  trem.start()
  const epTone = ctx.createBiquadFilter()
  epTone.type = "lowpass"
  epTone.frequency.value = 2400
  ep.connect(epTone)
  epTone.connect(bus)
  epTone.connect(send)
  const drums = ctx.createGain()
  drums.gain.value = 0.85
  drums.connect(bus)
  // tape wobble: shared slow detune
  const wobble = ctx.createOscillator()
  wobble.frequency.value = 0.27
  const wobbleDepth = ctx.createGain()
  wobbleDepth.gain.value = 6
  wobble.connect(wobbleDepth)
  wobble.start()
  // vinyl hiss
  const hiss = ctx.createBufferSource()
  hiss.buffer = noise(ctx)
  hiss.loop = true
  const hissBand = ctx.createBiquadFilter()
  hissBand.type = "bandpass"
  hissBand.frequency.value = 4200
  hissBand.Q.value = 0.6
  const hissGain = ctx.createGain()
  hissGain.gain.value = 0.006
  hiss.connect(hissBand).connect(hissGain).connect(bus)
  hiss.start()
  return { bus, ep, drums, send, wobble, wobbleDepth, hiss, timer: 0, next: ctx.currentTime + 0.1, step: 0, bar: 0, mood, variant: 0 }
}

const epNote = (ctx: AudioContext, e: Engine, note: number, t: number, dur: number, vel: number): void => {
  const f = midi(note)
  const car = ctx.createOscillator()
  car.frequency.value = f
  const mod = ctx.createOscillator()
  mod.frequency.value = f
  const index = ctx.createGain()
  index.gain.setValueAtTime(f * 1.1 * vel, t)
  index.gain.exponentialRampToValueAtTime(f * 0.08 + 1, t + 0.6)
  mod.connect(index).connect(car.frequency)
  e.wobbleDepth.connect(car.detune)
  const amp = ctx.createGain()
  amp.gain.setValueAtTime(0, t)
  amp.gain.linearRampToValueAtTime(0.05 * vel, t + 0.012)
  amp.gain.exponentialRampToValueAtTime(0.018 * vel, t + 0.9)
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  car.connect(amp).connect(e.ep)
  car.start(t); mod.start(t)
  car.stop(t + dur + 0.05); mod.stop(t + dur + 0.05)
  car.onended = () => { car.disconnect(); mod.disconnect(); index.disconnect(); amp.disconnect(); try { e.wobbleDepth.disconnect(car.detune) } catch { /* already gone */ } }
}

const bass = (ctx: AudioContext, e: Engine, note: number, t: number, dur: number): void => {
  const o = ctx.createOscillator()
  o.type = "sine"
  o.frequency.value = midi(note)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(0.11, t + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(e.bus)
  o.start(t); o.stop(t + dur + 0.05)
  o.onended = () => { o.disconnect(); g.disconnect() }
}

const kick = (ctx: AudioContext, e: Engine, t: number, vel: number): void => {
  const o = ctx.createOscillator()
  o.frequency.setValueAtTime(105, t)
  o.frequency.exponentialRampToValueAtTime(44, t + 0.13)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.16 * vel, t + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38)
  o.connect(g).connect(e.drums)
  o.start(t); o.stop(t + 0.42)
  o.onended = () => { o.disconnect(); g.disconnect() }
}

const noiseHit = (ctx: AudioContext, e: Engine, t: number, type: BiquadFilterType, freq: number, q: number, dur: number, level: number): void => {
  const s = ctx.createBufferSource()
  s.buffer = noise(ctx)
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(level, t + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  s.connect(f).connect(g).connect(e.drums)
  s.start(t, Math.random() * 1.5, dur + 0.05)
  s.onended = () => { s.disconnect(); f.disconnect(); g.disconnect() }
}

const musicBox = (ctx: AudioContext, e: Engine, note: number, t: number): void => {
  const o = ctx.createOscillator()
  o.type = "triangle"
  o.frequency.value = midi(note)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(0.022, t + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2)
  o.connect(g)
  g.connect(e.send)
  g.connect(e.bus)
  o.start(t); o.stop(t + 2.3)
  o.onended = () => { o.disconnect(); g.disconnect() }
}

const schedule = (): void => {
  const ctx = audioContext()
  const e = engine
  if (!ctx || !e) return
  const bpm = e.mood === "night" ? 64 : 76
  const sixteenth = 60 / bpm / 4
  while (e.next < ctx.currentTime + 0.3) {
    const s = e.step % 16
    // swing: delay the off-beat sixteenths
    const swing = s % 2 === 1 ? sixteenth * 0.18 : 0
    const t = e.next + swing
    const prog = PROGRESSIONS[e.mood]
    const barsPerChord = e.mood === "night" ? 2 : 1
    const chord = prog[Math.floor(e.bar / barsPerChord) % prog.length]
    if (s === 0) {
      if (e.bar % 8 === 0) e.variant = Math.floor(Math.random() * 3)
      if (e.bar % barsPerChord === 0) {
        // voicing drifts an octave now and then; notes are lightly strummed
        const lift = e.variant === 2 ? 12 : 0
        chord.notes.forEach((n, i) => epNote(ctx, e, n + (i === 3 ? lift : 0), t + i * 0.018, sixteenth * 16 * barsPerChord * 0.95, 0.75 + Math.random() * 0.2))
      }
      bass(ctx, e, chord.root, t, sixteenth * 6)
    }
    if (s === 10 && e.mood !== "night") bass(ctx, e, chord.root + (e.variant === 1 ? 7 : 0), t, sixteenth * 4)
    // re-strike a soft chord fragment on the "and" of two
    if (s === 6 && e.variant !== 0) epNote(ctx, e, chord.notes[1] + 12, t, sixteenth * 6, 0.45)
    const drumsOn = e.mood !== "night" || e.bar % 4 === 3
    const soft = e.mood === "rain" ? 0.7 : e.mood === "night" ? 0.5 : 1
    if (drumsOn) {
      if (s === 0 || s === 7 || (s === 10 && e.variant === 1)) kick(ctx, e, t, soft)
      if ((s === 4 || s === 12) && e.mood !== "night") noiseHit(ctx, e, t, "bandpass", 1900, 0.9, 0.16, 0.05 * soft)
      if (s % 2 === 0) noiseHit(ctx, e, t, "highpass", 7600, 0.7, 0.04, (s % 4 === 0 ? 0.012 : 0.008) * soft)
    }
    // music-box melody every other bar, notes from the chord's pentatonic
    if (e.bar % 2 === 1 && (s === 2 || s === 8 || (s === 12 && Math.random() < 0.5)) && Math.random() < 0.7) {
      const base = chord.root + 36
      musicBox(ctx, e, base + PENTA[Math.floor(Math.random() * PENTA.length)], t)
    }
    // vinyl crackle
    if (Math.random() < (e.mood === "rain" ? 0.3 : 0.16)) noiseHit(ctx, e, t + Math.random() * sixteenth, "highpass", 2500, 0.5, 0.008, 0.01 + Math.random() * 0.012)
    e.next += sixteenth
    e.step++
    if (e.step % 16 === 0) e.bar++
  }
}

/** Turn the background lofi on/off (fades) and pick its mood. */
export const setLofi = (on: boolean, nextMood: LofiMood = mood): void => {
  wanted = on
  mood = nextMood
  const ctx = audioContext()
  if (!ctx) return
  if (on && !engine) {
    engine = build(ctx)
    if (!engine) return
    engine.timer = window.setInterval(schedule, 90)
  }
  if (!engine) return
  if (on) {
    engine.mood = mood
    window.clearTimeout(teardown)
    teardown = 0
  }
  engine.bus.gain.setTargetAtTime(on ? 0.85 : 0, ctx.currentTime, on ? 1.6 : 0.8)
  if (!on && !teardown) {
    const e = engine
    teardown = window.setTimeout(() => {
      teardown = 0
      if (wanted || engine !== e) return
      window.clearInterval(e.timer)
      e.hiss.stop()
      e.wobble.stop()
      e.bus.disconnect()
      engine = null
    }, 4000)
  }
}
