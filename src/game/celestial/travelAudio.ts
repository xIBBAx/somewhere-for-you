import { audioContext, audioLive, audioOut } from "../audio/audio"
import { travelRT, type TravelPhase } from "./cosmicTravel"
import { nebulaCount, nebulaMoment } from "./travelEnvelope"
import { qualityRT } from "../../state/qualityStore"

/**
 * Sound for Starborn's journeys, synthesised with Web Audio (nothing sampled,
 * nothing downloaded). It runs on the game's own audio context and master
 * bus, so mute and the autoplay gate in audio.ts apply to it unchanged.
 *
 * Real: nothing here is a recording of anything in space. The noise beds
 * stand for air and for starlight rushing past, sounds the explorer knows from wind.
 * Magic: the breath she draws as she gathers, the low thump of the launch,
 * the open-fifth chord of the run (brightening as the sky crowds forward,
 * breathing slowly), the rush of each nebula, and the chord and falling
 * sparkle of the arrival are Starborn's voice, tuned to be bright and calm.
 * Space itself is silent: nothing here pretends to be the sound of vacuum.
 */

type Bed = {
  /** every source and node, so the bed can be released when the journeys are over */
  nodes: AudioNode[]
  out: GainNode
  hum: GainNode
  humFilter: BiquadFilterNode
  air: GainNode
  airFilter: BiquadFilterNode
  roar: GainNode
  roarFilter: BiquadFilterNode
  wind: GainNode
  /** the run's chord: open fifths, its brightness following the speed */
  pad: GainNode
  padFilter: BiquadFilterNode
  shimmer: GainNode
}

let bed: Bed | null = null
let noise: AudioBuffer | null = null
let last: TravelPhase = "idle"

const noiseBuffer = (ctx: AudioContext): AudioBuffer => {
  if (noise) return noise
  noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const d = noise.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return noise
}

const noiseSource = (ctx: AudioContext): AudioBufferSourceNode => {
  const s = ctx.createBufferSource()
  s.buffer = noiseBuffer(ctx)
  s.loop = true
  s.start()
  return s
}

/** the always-on beds: the corridor's hum, its air, the re-entry roar and the wind of the pull-out */
const build = (ctx: AudioContext, master: AudioNode): Bed => {
  const nodes: AudioNode[] = []
  const keep = <T extends AudioNode>(n: T): T => { nodes.push(n); return n }
  const out = keep(ctx.createGain())
  out.gain.value = 1
  out.connect(master)
  const hum = ctx.createGain()
  hum.gain.value = 0
  const humFilter = ctx.createBiquadFilter()
  humFilter.type = "lowpass"
  humFilter.frequency.value = 360
  humFilter.connect(hum).connect(out)
  for (const [f, g] of [[55, 0.5], [82.41, 0.28], [110.2, 0.14]] as const) {
    const o = keep(ctx.createOscillator())
    o.type = "sine"
    o.frequency.value = f
    const og = ctx.createGain()
    og.gain.value = g
    o.connect(og).connect(humFilter)
    o.start()
  }
  const air = ctx.createGain()
  air.gain.value = 0
  const airFilter = ctx.createBiquadFilter()
  airFilter.type = "bandpass"
  airFilter.frequency.value = 500
  airFilter.Q.value = 0.9
  keep(noiseSource(ctx)).connect(airFilter).connect(air).connect(out)
  const roar = ctx.createGain()
  roar.gain.value = 0
  const roarFilter = ctx.createBiquadFilter()
  roarFilter.type = "lowpass"
  roarFilter.frequency.value = 300
  keep(noiseSource(ctx)).connect(roarFilter).connect(roar).connect(out)
  const wind = ctx.createGain()
  wind.gain.value = 0
  const windFilter = ctx.createBiquadFilter()
  windFilter.type = "highpass"
  windFilter.frequency.value = 1400
  keep(noiseSource(ctx)).connect(windFilter).connect(wind).connect(out)
  const pad = ctx.createGain()
  pad.gain.value = 0
  const padFilter = ctx.createBiquadFilter()
  padFilter.type = "lowpass"
  padFilter.frequency.value = 400
  padFilter.Q.value = 0.6
  padFilter.connect(pad).connect(out)
  // A, E, A, E, B: wide and open; each voice a slightly detuned pair, so it moves
  for (const [f, g] of [[110, 0.32], [164.81, 0.26], [220, 0.2], [329.63, 0.14], [493.88, 0.08]] as const) {
    for (const det of [-3, 3]) {
      const o = keep(ctx.createOscillator())
      o.type = "triangle"
      o.frequency.value = f
      o.detune.value = det
      const og = ctx.createGain()
      og.gain.value = g * 0.5
      o.connect(og).connect(padFilter)
      o.start()
    }
  }
  // starlight: a fine, high air, very quiet
  const shimmer = ctx.createGain()
  shimmer.gain.value = 0
  const shimmerFilter = ctx.createBiquadFilter()
  shimmerFilter.type = "bandpass"
  shimmerFilter.frequency.value = 6200
  shimmerFilter.Q.value = 2.2
  keep(noiseSource(ctx)).connect(shimmerFilter).connect(shimmer).connect(out)
  return { nodes, out, hum, humFilter, air, airFilter, roar, roarFilter, wind, pad, padFilter, shimmer }
}

/** a one-shot: starlight rushing in, a noise band sweeping up in pitch and fading */
const whoosh = (ctx: AudioContext, master: AudioNode, dur: number, from: number, to: number, gain: number): void => {
  const t0 = ctx.currentTime
  const s = noiseSource(ctx)
  const f = ctx.createBiquadFilter()
  f.type = "bandpass"
  f.Q.value = 1.1
  f.frequency.setValueAtTime(from, t0)
  f.frequency.exponentialRampToValueAtTime(to, t0 + dur)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + dur * 0.45)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  s.connect(f).connect(g).connect(master)
  s.stop(t0 + dur + 0.1)
  window.setTimeout(() => { s.disconnect(); f.disconnect(); g.disconnect() }, (dur + 0.3) * 1000)
}

/** the burst: a soft, open chord that blooms and rings out for a few seconds */
const burst = (ctx: AudioContext, master: AudioNode): void => {
  const t0 = ctx.currentTime
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(0.05, t0 + 0.18)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.2)
  g.connect(master)
  const nodes: AudioNode[] = [g]
  // a major chord, one octave of air on top: bright, never harsh
  for (const [f, k] of [[392, 1], [493.88, 0.7], [587.33, 0.6], [783.99, 0.45], [987.77, 0.2]] as const) {
    const o = ctx.createOscillator()
    o.type = "sine"
    o.frequency.setValueAtTime(f, t0)
    o.frequency.linearRampToValueAtTime(f * 1.002, t0 + 3)
    const og = ctx.createGain()
    og.gain.value = k
    o.connect(og).connect(g)
    o.start(t0)
    o.stop(t0 + 3.4)
    nodes.push(o, og)
  }
  window.setTimeout(() => nodes.forEach((n) => { try { n.disconnect() } catch { /* already gone */ } }), 3800)
}

/** the launch: a soft, deep thump felt more than heard, gone in under a second */
const thump = (ctx: AudioContext, master: AudioNode): void => {
  const t0 = ctx.currentTime
  const o = ctx.createOscillator()
  o.type = "sine"
  o.frequency.setValueAtTime(72, t0)
  o.frequency.exponentialRampToValueAtTime(34, t0 + 0.7)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(0.2, t0 + 0.03)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9)
  o.connect(g).connect(master)
  o.start(t0)
  o.stop(t0 + 1)
  window.setTimeout(() => { o.disconnect(); g.disconnect() }, 1300)
}

/** the arrival: a few bright notes falling, as the sky unfolds */
const sparkle = (ctx: AudioContext, master: AudioNode): void => {
  const t0 = ctx.currentTime
  const nodes: AudioNode[] = []
  ;[1975.5, 1661.2, 1318.5, 987.77, 830.61].forEach((f, k) => {
    const at = t0 + k * 0.11
    const o = ctx.createOscillator()
    o.type = "sine"
    o.frequency.value = f
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(0.022, at + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 1.4)
    o.connect(g).connect(master)
    o.start(at)
    o.stop(at + 1.5)
    nodes.push(o, g)
  })
  window.setTimeout(() => nodes.forEach((n) => { try { n.disconnect() } catch { /* already gone */ } }), 2400)
}

let nebulaHeard = -1
/** frames since the last journey sound was needed */
let idleFor = 0

const onPhase = (ctx: AudioContext, master: AudioNode, from: TravelPhase, to: TravelPhase): void => {
  // the breath she draws as she gathers her light
  if (to === "gather") whoosh(ctx, master, travelRT.style === "quick" ? 0.5 : 1.5, 160, 900, 0.05)
  // the launch: the thump, and starlight rushing into her
  if (to === "corridor" && from === "gather") {
    thump(ctx, master)
    whoosh(ctx, master, 1.6, 280, 2600, 0.12)
  }
  if (to === "corridor") nebulaHeard = -1
  if (to === "emerge") sparkle(ctx, master)
  // bursting out beside the world (or at re-entry's end: the chord is her voice)
  if (to === "emerge") burst(ctx, master)
  // the pull-out: wind in the wings as she levels off above home
  if (to === "idle" && from === "reentry") whoosh(ctx, master, 2.2, 700, 1600, 0.12)
}

/** Per frame, from the VFX that owns the journey (reads travelRT only). */
export const updateTravelSound = (): void => {
  const ph = travelRT.phase
  const ctx = audioContext()
  if (ph !== last) {
    const from = last
    last = ph
    const master = audioOut()
    if (ctx && master && audioLive()) onPhase(ctx, master, from, ph)
  }
  if (!ctx || !audioLive()) return
  const master = audioOut()
  if (!master) return
  // the beds exist only around journeys: built when one begins, released
  // (every oscillator stopped) after a few quiet seconds, so a long session
  // of walking and riding carries no silent synthesis running underneath
  const busy = ph !== "idle" || travelRT.heat > 0.001 || travelRT.pull > 0.001
  if (!bed) {
    if (!busy) return
    bed = build(ctx, master)
  }
  idleFor = busy ? 0 : idleFor + 1
  if (idleFor > 600) {
    const old = bed
    bed = null
    idleFor = 0
    old.out.gain.setTargetAtTime(0, ctx.currentTime, 0.05)
    window.setTimeout(() => old.nodes.forEach((n) => {
      try { (n as AudioScheduledSourceNode).stop?.() } catch { /* already stopped */ }
      try { n.disconnect() } catch { /* already gone */ }
    }), 400)
    return
  }
  const t = ctx.currentTime
  const k = 0.12
  const i = travelRT.intensity
  const heat = travelRT.heat
  const pull = travelRT.pull
  // the corridor's hum swells as it opens, and a rushing air bed follows the strength
  bed.hum.gain.setTargetAtTime(i * 0.035, t, k)
  bed.humFilter.frequency.setTargetAtTime(260 + 260 * i, t, 0.4)
  bed.air.gain.setTargetAtTime(i * 0.06, t, k)
  bed.airFilter.frequency.setTargetAtTime(420 + 1400 * i, t, 0.25)
  // the run's chord: in with the speed, brighter the more the sky crowds forward, breathing slowly
  const beta = travelRT.beta
  const breathe = 0.85 + 0.15 * Math.sin(t * 0.7)
  bed.pad.gain.setTargetAtTime(Math.min(1, beta / 0.5) * 0.045 * breathe, t, 0.35)
  bed.padFilter.frequency.setTargetAtTime(320 + 2200 * beta * beta, t, 0.5)
  bed.shimmer.gain.setTargetAtTime(beta * beta * 0.018, t, 0.4)
  // each nebula she runs through: a soft rush of its own
  if (ph === "corridor" && travelRT.style !== "quick") {
    const n = nebulaCount(travelRT.duration, qualityRT.level === "low" ? 2 : 3)
    for (let k = nebulaHeard + 1; k < n; k++) {
      if (travelRT.t < nebulaMoment(travelRT.duration, k, n) - 0.5) break
      nebulaHeard = k
      whoosh(ctx, master, 1.4, 500, 1400, 0.05)
    }
  }
  // re-entry: the roar rises with the heat of the sheath, then the wind comes in on the pull
  bed.roar.gain.setTargetAtTime(heat * 0.22, t, 0.3)
  bed.roarFilter.frequency.setTargetAtTime(260 + 900 * heat, t, 0.4)
  bed.wind.gain.setTargetAtTime(pull * pull * 0.09, t, 0.5)
}
