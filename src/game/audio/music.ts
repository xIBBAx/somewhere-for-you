import { audioContext, musicOut } from "./audio"

/**
 * Small generative music for moments that deserve it: a gentle 3/4 music box
 * waltz for slow dances (original melody, synthesised, no files). Notes are
 * scheduled a little ahead on the WebAudio clock, so timing never drifts.
 */
const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12)

// F major waltz: melody over a bass + two-note chord on beats 2 and 3.
const BARS: { chord: number[]; bass: number; melody: (number | null)[] }[] = [
  { bass: 41, chord: [57, 60, 65], melody: [72, null, 69] },
  { bass: 46, chord: [58, 62, 65], melody: [70, 69, 67] },
  { bass: 48, chord: [55, 60, 64], melody: [67, null, 64] },
  { bass: 41, chord: [57, 60, 65], melody: [65, null, null] },
  { bass: 38, chord: [57, 62, 65], melody: [69, null, 72] },
  { bass: 46, chord: [58, 62, 65], melody: [74, 72, 70] },
  { bass: 48, chord: [55, 60, 64], melody: [69, 67, 64] },
  { bass: 41, chord: [57, 60, 65], melody: [65, null, null] },
]
const BEAT = 0.62

let timer: number | null = null
let nextTime = 0
let step = 0
let bus: GainNode | null = null

const note = (ctx: AudioContext, out: AudioNode, freq: number, start: number, dur: number, gain: number, type: OscillatorType): void => {
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.value = freq
  g.gain.setValueAtTime(0, start)
  g.gain.linearRampToValueAtTime(gain, start + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(g).connect(out)
  osc.start(start)
  osc.stop(start + dur + 0.05)
  osc.onended = () => { osc.disconnect(); g.disconnect() }
}

const schedule = (): void => {
  const ctx = audioContext()
  if (!ctx || !bus) return
  while (nextTime < ctx.currentTime + 0.4) {
    const bar = BARS[Math.floor(step / 3) % BARS.length]
    const beat = step % 3
    if (beat === 0) note(ctx, bus, midi(bar.bass), nextTime, BEAT * 2.6, 0.05, "sine")
    else for (const n of bar.chord) note(ctx, bus, midi(n), nextTime, BEAT * 0.9, 0.012, "triangle")
    const m = bar.melody[beat]
    if (m !== null) {
      note(ctx, bus, midi(m), nextTime, BEAT * 1.8, 0.04, "sine")
      note(ctx, bus, midi(m + 12), nextTime, BEAT * 0.7, 0.008, "sine")
    }
    nextTime += BEAT
    step++
  }
}

export const setDanceMusic = (on: boolean): void => {
  const ctx = audioContext()
  const out = musicOut()
  if (on) {
    if (!ctx || !out || timer !== null) return
    bus = ctx.createGain()
    bus.gain.value = 0
    bus.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.2)
    bus.connect(out)
    nextTime = ctx.currentTime + 0.1
    step = 0
    schedule()
    timer = window.setInterval(schedule, 120)
    return
  }
  if (timer !== null) window.clearInterval(timer)
  timer = null
  if (ctx && bus) {
    const fading = bus
    fading.gain.setTargetAtTime(0, ctx.currentTime, 0.35)
    window.setTimeout(() => fading.disconnect(), 2000)
  }
  bus = null
}
