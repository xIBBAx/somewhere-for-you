import { debugEnabled } from "../../dev/debugFlag"
import { Howl, Howler } from "howler"
import { assets } from "../../content/assets"
import { playSprite } from "./soundscape"

/**
 * Music only. By design the world has no sound effects and no
 * ambience: one calm lofi track ("First Snow" by Holizna, CC0) loops quietly
 * through Howler once she enters the world. The WebAudio engine below (SFX,
 * ambience and the synthesised music buses) is never created, so every
 * effect, loop and generated score in the game stays silent at its guard.
 */
const SOUND_EFFECTS = false as boolean

let ctx: AudioContext | null = null
/** synthesised interaction sounds (historically "master"; now the SFX bus) */
let master: GainNode | null = null
let mix: GainNode | null = null
let ambienceBus: GainNode | null = null
let musicBus: GainNode | null = null
let ambient: Howl | null = null
let ambientWanted = false
let userActivated = false
let ambientFailed = false
let ambientInstancesCreated = 0
let visibilityBound = false
let muted = false
const AMBIENT_VOLUME = 0.34

export const initAudio = (): void => {
  userActivated = true
  if (!SOUND_EFFECTS) {
    // the music track only (Howler, its own HTML5 audio)
    bindVisibility()
    if (ambientWanted) playAmbient()
    return
  }
  if (ctx) {
    void ctx.resume().catch(() => undefined)
    bindVisibility()
    return
  }
  try {
    ctx = new AudioContext({ latencyHint: "interactive" })
    // Mix console: SFX, ambience and music buses → mute/mix gain → a gentle
    // glue compressor → a fast limiter. Nothing can arrive sharp or loud.
    mix = ctx.createGain()
    mix.gain.value = muted ? 0 : 1
    const glue = ctx.createDynamicsCompressor()
    glue.threshold.value = -20
    glue.knee.value = 12
    glue.ratio.value = 2.5
    glue.attack.value = 0.02
    glue.release.value = 0.35
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -6
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.002
    limiter.release.value = 0.12
    // makeup gain after the limiter keeps peaks near -8 dBFS: calm headroom
    const output = ctx.createGain()
    output.gain.value = 0.72
    mix.connect(glue).connect(limiter).connect(output).connect(ctx.destination)
    if (debugEnabled()) {
      // QA meter on the final output: peak and RMS in dBFS
      const meter = ctx.createAnalyser()
      meter.fftSize = 8192
      output.connect(meter)
      const data = new Float32Array(meter.fftSize)
      ;(window as unknown as { __worldAudioClock?: () => number }).__worldAudioClock = () => ctx?.currentTime ?? 0
      ;(window as unknown as { __worldAudioMeter?: () => { state: string; peakDb: number; rmsDb: number } }).__worldAudioMeter = () => {
        meter.getFloatTimeDomainData(data)
        let peak = 0, sum = 0
        for (const v of data) { peak = Math.max(peak, Math.abs(v)); sum += v * v }
        const db = (x: number): number => Math.round(20 * Math.log10(Math.max(x, 1e-9)) * 10) / 10
        return { state: ctx?.state ?? "none", peakDb: db(peak), rmsDb: db(Math.sqrt(sum / data.length)) }
      }
    }
    // synthesised blips lose their edge above ~9 kHz
    const soften = ctx.createBiquadFilter()
    soften.type = "lowpass"
    soften.frequency.value = 9500
    soften.Q.value = 0.5
    master = ctx.createGain()
    master.gain.value = 0.85
    master.connect(soften).connect(mix)
    ambienceBus = ctx.createGain()
    ambienceBus.gain.value = 1
    ambienceBus.connect(mix)
    musicBus = ctx.createGain()
    musicBus.gain.value = 1
    musicBus.connect(mix)
  } catch {
    ctx = null
  }
  bindVisibility()
  if (ambientWanted) playAmbient()
}

/** Shared WebAudio clock and master bus for other synthesis (music.ts). */
export const audioContext = (): AudioContext | null => ctx
export const audioOut = (): AudioNode | null => master
export const ambienceOut = (): GainNode | null => ambienceBus
export const musicOut = (): GainNode | null => musicBus
/** true once the user has unlocked audio and it is not muted */
export const audioLive = (): boolean => !!ctx && !muted && ctx.state === "running"

export const setMuted = (m: boolean): void => {
  muted = m
  if (mix && ctx) mix.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.05)
  Howler.mute(m)
}

type ToneOpts = {
  freq: number
  dur?: number
  type?: OscillatorType
  gain?: number
  delay?: number
  slideTo?: number
  cinematic?: boolean
}

const cinematicOscillators = new Set<OscillatorNode>()

const tone = ({
  freq,
  dur = 0.4,
  type = "sine",
  gain = 0.08,
  delay = 0,
  slideTo,
  cinematic = false,
}: ToneOpts): void => {
  if (!ctx || !master || muted) return
  const t0 = ctx.currentTime + delay
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur)
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(master)
  if (cinematic) {
    cinematicOscillators.add(osc)
  }
  osc.addEventListener("ended", () => {
    cinematicOscillators.delete(osc)
    osc.disconnect()
    g.disconnect()
  }, { once: true })
  osc.start(t0)
  osc.stop(t0 + dur + 0.05)
}

// ---- the companion cat's voice ---------------------------------------------
// Synthesised rather than sampled: a glottal pulse train through moving vowel
// formants gives a believable "mi-aow", and a breath-cycled 25 Hz pulse makes
// the purr. Every call takes a loudness so the caller can fade her with
// distance.

let noiseBuf: AudioBuffer | null = null
const noise = (): AudioBuffer | null => {
  if (!ctx) return null
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  return noiseBuf
}

const disconnectLater = (nodes: AudioNode[], at: number): void => {
  window.setTimeout(() => nodes.forEach((n) => { try { n.disconnect() } catch { /* already gone */ } }), Math.max(0, at) * 1000 + 200)
}

type VoiceShape = {
  dur: number
  /** [time 0..1, Hz] pitch contour */
  pitch: Array<[number, number]>
  /** [time 0..1, F1 Hz, F2 Hz] vowel contour */
  vowel: Array<[number, number, number]>
  gain: number
  vibrato?: number
  /** amplitude roll (Hz) for trills */
  roll?: number
  breath?: number
}

const voice = (v: VoiceShape, loud: number, delay = 0): void => {
  if (!ctx || !master || muted || loud <= 0.01) return
  const t0 = ctx.currentTime + delay
  const src = ctx.createOscillator()
  src.type = "sawtooth"
  src.frequency.setValueAtTime(v.pitch[0][1], t0)
  for (const [u, hz] of v.pitch) src.frequency.linearRampToValueAtTime(hz, t0 + u * v.dur)
  const vib = ctx.createOscillator()
  const vibGain = ctx.createGain()
  vib.frequency.value = 6.5
  vibGain.gain.value = v.vibrato ?? 9
  vib.connect(vibGain).connect(src.frequency)
  const f1 = ctx.createBiquadFilter()
  const f2 = ctx.createBiquadFilter()
  f1.type = f2.type = "bandpass"
  f1.Q.value = 5
  f2.Q.value = 7
  f1.frequency.setValueAtTime(v.vowel[0][1], t0)
  f2.frequency.setValueAtTime(v.vowel[0][2], t0)
  for (const [u, a, b] of v.vowel) {
    f1.frequency.linearRampToValueAtTime(a, t0 + u * v.dur)
    f2.frequency.linearRampToValueAtTime(b, t0 + u * v.dur)
  }
  const env = ctx.createGain()
  const peak = v.gain * Math.min(1, loud)
  env.gain.setValueAtTime(0, t0)
  env.gain.linearRampToValueAtTime(peak, t0 + Math.min(0.06, v.dur * 0.15))
  env.gain.setValueAtTime(peak, t0 + v.dur * 0.7)
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + v.dur)
  const mix = ctx.createGain()
  mix.gain.value = 1
  src.connect(f1).connect(mix)
  src.connect(f2).connect(mix)
  let rollOsc: OscillatorNode | null = null
  const rollGain = ctx.createGain()
  if (v.roll) {
    // a trill is the voice gated by the tongue: amplitude rolled at ~25 Hz
    rollOsc = ctx.createOscillator()
    rollOsc.frequency.value = v.roll
    const depth = ctx.createGain()
    depth.gain.value = 0.5
    rollGain.gain.value = 0.5
    rollOsc.connect(depth).connect(rollGain.gain)
    mix.connect(rollGain).connect(env)
  } else {
    mix.connect(env)
  }
  env.connect(master)
  // a breathy edge on the attack
  const nb = noise()
  if (nb && v.breath) {
    const air = ctx.createBufferSource()
    air.buffer = nb
    const hp = ctx.createBiquadFilter()
    hp.type = "highpass"
    hp.frequency.value = 3000
    const ag = ctx.createGain()
    ag.gain.setValueAtTime(0, t0)
    ag.gain.linearRampToValueAtTime(v.breath * peak, t0 + 0.03)
    ag.gain.exponentialRampToValueAtTime(0.0001, t0 + v.dur * 0.6)
    air.connect(hp).connect(ag).connect(master)
    air.start(t0)
    air.stop(t0 + v.dur)
  }
  src.start(t0)
  vib.start(t0)
  rollOsc?.start(t0)
  src.stop(t0 + v.dur + 0.05)
  vib.stop(t0 + v.dur + 0.05)
  rollOsc?.stop(t0 + v.dur + 0.05)
  disconnectLater([src, vib, vibGain, f1, f2, mix, rollGain, env], delay + v.dur)
}

const noiseBurst = (dur: number, gain: number, hp: number, lp: number, delay = 0): void => {
  if (!ctx || !master || muted || gain <= 0.001) return
  const nb = noise()
  if (!nb) return
  const t0 = ctx.currentTime + delay
  const s = ctx.createBufferSource()
  s.buffer = nb
  s.loop = true
  const h = ctx.createBiquadFilter()
  h.type = "highpass"
  h.frequency.value = hp
  const l = ctx.createBiquadFilter()
  l.type = "lowpass"
  l.frequency.value = lp
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.08, dur * 0.25))
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  s.connect(h).connect(l).connect(g).connect(master)
  s.start(t0, Math.random() * 1.5)
  s.stop(t0 + dur + 0.05)
  disconnectLater([s, h, l, g], delay + dur)
}

let purrNodes: { gain: GainNode; lfo: OscillatorNode; breath: OscillatorNode } | null = null

export const catVoice = {
  /** "mi-aow": rising then falling pitch while the mouth opens ee → aa → oo */
  meow(loud = 1, plaintive = 0): void {
    if (playSprite("meow", 0.3 * loud, { pitch: 1 + plaintive * 0.08, jitter: 0.05 })) return
    const base = 560 + Math.random() * 160 + plaintive * 120
    voice({
      dur: 0.55 + Math.random() * 0.25 + plaintive * 0.2,
      pitch: [[0, base * 0.85], [0.3, base * 1.18], [0.75, base * 0.95], [1, base * 0.7]],
      vowel: [[0, 700, 2300], [0.35, 1300, 1900], [0.8, 900, 1200], [1, 600, 1000]],
      gain: 0.06,
      vibrato: 10,
      breath: 0.15,
    }, loud)
  },
  /** short questioning chirrup a friendly cat greets with */
  trill(loud = 1): void {
    const base = 480 + Math.random() * 80
    voice({ dur: 0.34, pitch: [[0, base], [0.6, base * 1.35], [1, base * 1.5]], vowel: [[0, 600, 1500], [1, 900, 1800]], gain: 0.05, roll: 26, vibrato: 4 }, loud)
  },
  /** tiny "mew" while kneading or stretching */
  mew(loud = 1): void {
    const base = 800 + Math.random() * 150
    voice({ dur: 0.22, pitch: [[0, base], [0.5, base * 1.1], [1, base * 0.85]], vowel: [[0, 900, 2400], [1, 800, 1600]], gain: 0.035 }, loud)
  },
  /** chattering at a bird she can't reach: rapid "ek-ek-ek" */
  chatter(loud = 1): void {
    for (let i = 0; i < 6; i++) {
      voice({ dur: 0.07, pitch: [[0, 1100], [1, 900]], vowel: [[0, 1200, 2600], [1, 1000, 2200]], gain: 0.03, vibrato: 0 }, loud, i * 0.085)
    }
  },
  hiss(loud = 1): void {
    noiseBurst(0.85, 0.07 * Math.min(1, loud), 2400, 9000)
    noiseBurst(0.25, 0.03 * Math.min(1, loud), 600, 2200)
  },
  /** continuous purr; call every frame with the current level (0 stops it) */
  purr(level: number): void {
    if (!ctx || !master) return
    // the recorded purr (soundscape "cat_purr") carries it now; the synthesised
    // one only fades out if it was ever started
    const target = 0 * level
    if (!purrNodes) {
      if (target <= 0.0005) return
      const nb = noise()
      if (!nb) return
      const s = ctx.createBufferSource()
      s.buffer = nb
      s.loop = true
      const lp = ctx.createBiquadFilter()
      lp.type = "lowpass"
      lp.frequency.value = 340
      // 25 Hz laryngeal pulses
      const pulse = ctx.createGain()
      pulse.gain.value = 0.5
      const lfo = ctx.createOscillator()
      lfo.type = "square"
      lfo.frequency.value = 25
      const lfoDepth = ctx.createGain()
      lfoDepth.gain.value = 0.5
      lfo.connect(lfoDepth).connect(pulse.gain)
      // the purr swells on the out-breath and softens on the in-breath
      const breathGain = ctx.createGain()
      breathGain.gain.value = 0.7
      const breath = ctx.createOscillator()
      breath.frequency.value = 0.55
      const breathDepth = ctx.createGain()
      breathDepth.gain.value = 0.3
      breath.connect(breathDepth).connect(breathGain.gain)
      const gain = ctx.createGain()
      gain.gain.value = 0
      s.connect(lp).connect(pulse).connect(breathGain).connect(gain).connect(master)
      s.start()
      lfo.start()
      breath.start()
      purrNodes = { gain, lfo, breath }
    }
    purrNodes.gain.gain.setTargetAtTime(target, ctx.currentTime, 0.25)
    // the purr frequency drifts a little with the breath
    purrNodes.lfo.frequency.setTargetAtTime(23 + level * 4, ctx.currentTime, 0.5)
  },
}

/** The explorer calling her cat: a soft "pspsps". */
export const callCat = (): void => {
  for (let i = 0; i < 4; i++) noiseBurst(0.09, 0.035, 3800, 9000, i * 0.13)
}

// optional Howler file overrides (absent in the repo by default)
const optionalFiles: Record<string, Howl | null> = {}
const tryFile = (key: "memoryChime" | "bell", src: string | undefined, volume: number): Howl | null => {
  if (!src) return null
  if (!(key in optionalFiles)) {
    try {
      const h = new Howl({ src: [src], volume, onloaderror: () => (optionalFiles[key] = null) })
      optionalFiles[key] = h
    } catch {
      optionalFiles[key] = null
    }
  }
  const f = optionalFiles[key]
  return f && f.state() === "loaded" ? f : null
}

/** Band-passed noise burst: splashes, strokes, wading swishes. */
const waterBurst = (freq: number, q: number, dur: number, gain: number, delay = 0, sweepTo?: number): void => {
  const buf = noise()
  if (!ctx || !master || muted || !buf) return
  const t0 = ctx.currentTime + delay
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = 0.8 + Math.random() * 0.4
  const filter = ctx.createBiquadFilter()
  filter.type = "bandpass"
  filter.Q.value = q
  filter.frequency.setValueAtTime(freq, t0)
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.03, dur * 0.2))
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(filter).connect(g).connect(master)
  src.start(t0, Math.random() * 1.5)
  src.stop(t0 + dur + 0.05)
  disconnectLater([src, filter, g], delay + dur)
}

export const sfx = {
  /** a soft warm chord for a hug */
  hug(): void {
    ;[523.25, 659.25, 783.99].forEach((freq, i) => tone({ freq, dur: 1.4, gain: 0.03, delay: i * 0.06 }))
    tone({ freq: 261.63, dur: 1.6, gain: 0.03, type: "triangle" })
  },
  /** two palms meeting */
  clap(): void {
    waterBurst(2400, 0.9, 0.09, 0.12, 0, 900)
    waterBurst(1300, 1.2, 0.06, 0.06, 0.01, 600)
    tone({ freq: 1046.5, dur: 0.35, gain: 0.03, delay: 0.04 })
    tone({ freq: 1567.98, dur: 0.45, gain: 0.025, delay: 0.1 })
  },
  /** camera shutter */
  shutter(): void {
    waterBurst(3200, 1.5, 0.05, 0.08, 0, 1800)
    waterBurst(2000, 1.2, 0.06, 0.06, 0.07, 1200)
  },
  /** a pebble skipping on water: one plink per touch */
  plink(index = 0): void {
    tone({ freq: 900 + index * 70, slideTo: 1400 + index * 60, dur: 0.12, gain: 0.04, type: "sine" })
    waterBurst(1800 + index * 120, 2, 0.08, 0.03, 0, 900)
  },
  /** stone sinking with a soft plop */
  plop(): void {
    tone({ freq: 420, slideTo: 140, dur: 0.18, gain: 0.05 })
    waterBurst(700, 1.1, 0.25, 0.04, 0.02, 300)
  },
  /** a firefly caught in the jar */
  twinkle(): void {
    for (let i = 0; i < 3; i++) tone({ freq: 1760 + i * 440 + Math.random() * 60, dur: 0.3, gain: 0.02, delay: i * 0.07 })
  },
  /** lantern flame catching and lifting off */
  whoosh(): void {
    waterBurst(500, 0.7, 0.9, 0.05, 0, 1600)
    tone({ freq: 392, slideTo: 784, dur: 1.4, gain: 0.02, delay: 0.2 })
  },
  /** a small win */
  fanfare(): void {
    ;[523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => tone({ freq, dur: 0.5, gain: 0.04, delay: i * 0.11, type: "triangle" }))
  },
  /** a flower picked */
  pluck(): void {
    tone({ freq: 660 + Math.random() * 80, slideTo: 990, dur: 0.12, gain: 0.03, type: "triangle" })
  },
  /** A quiet nearby pond call. */
  croak(loudness: number): void {
    const gain = Math.max(0, Math.min(1, loudness)) * 0.016
    if (gain < 0.0005) return
    tone({ freq: 270, slideTo: 210, dur: 0.11, type: "triangle", gain })
    tone({ freq: 250, slideTo: 195, dur: 0.13, type: "triangle", gain: gain * 0.8, delay: 0.14 })
  },
  waterLife(loudness: number): void {
    if (loudness < 0.02) return
    waterBurst(1100, 1.2, 0.2, Math.min(1, loudness) * 0.025, 0, 500)
  },
  /** body entering water; strength 0..1 */
  splash(strength = 1): void {
    const s = Math.max(0.15, Math.min(1, strength))
    waterBurst(900, 0.8, 0.5 + s * 0.4, 0.09 * s, 0, 260)
    waterBurst(2600, 1.4, 0.35, 0.045 * s, 0.03, 1200)
    for (let i = 0; i < 3; i++) waterBurst(1800 + Math.random() * 1600, 6, 0.07, 0.02 * s, 0.18 + i * 0.09 + Math.random() * 0.05)
  },
  /** one swimming stroke or a wading step through water */
  stroke(gain = 0.5): void {
    waterBurst(700 + Math.random() * 250, 1.1, 0.42, 0.035 * gain, 0, 380)
  },

  chime(): void {
    const f = tryFile("memoryChime", assets.audio.memoryChime, 0.5)
    if (f) return void f.play()
    tone({ freq: 783.99, dur: 0.5, gain: 0.05 })
    tone({ freq: 1046.5, dur: 0.6, gain: 0.045, delay: 0.09 })
    tone({ freq: 1318.5, dur: 0.9, gain: 0.035, delay: 0.18 })
  },
  sparkle(): void {
    for (let i = 0; i < 4; i++) {
      tone({ freq: 1400 + Math.random() * 900, dur: 0.22, gain: 0.025, delay: i * 0.05 })
    }
  },
  bell(): void {
    const f = tryFile("bell", assets.audio.bell, 0.5)
    if (f) return void f.play()
    tone({ freq: 1567.98, dur: 1.2, gain: 0.06 })
    tone({ freq: 2093, dur: 0.8, gain: 0.03, delay: 0.01 })
  },
  pop(): void {
    tone({ freq: 320, dur: 0.09, type: "triangle", gain: 0.06, slideTo: 150 })
  },
  thump(): void {
    tone({ freq: 110, dur: 0.14, type: "sine", gain: 0.09, slideTo: 60 })
  },
  step(): void {
    tone({ freq: 180 + Math.random() * 40, dur: 0.05, type: "triangle", gain: 0.012 })
  },
  quack(): void {
    if (playSprite("duck", 0.32, { jitter: 0.08 })) return
    tone({ freq: 540, dur: 0.1, type: "square", gain: 0.018, slideTo: 310 })
    tone({ freq: 420, dur: 0.12, type: "triangle", gain: 0.014, delay: 0.08, slideTo: 250 })
  },
  thunder(cinematic = false): void {
    // a real, distant roll; softened so a storm never startles
    if (!cinematic && playSprite("thunder", 0.55, { jitter: 0.04, bus: "ambience" })) return
    tone({ freq: 65, dur: 1.8, type: "sawtooth", gain: 0.07, slideTo: 28, cinematic })
    tone({ freq: 88, dur: 1.4, type: "triangle", gain: 0.05, delay: 0.08, slideTo: 36, cinematic })
    tone({ freq: 110, dur: 0.9, type: "sawtooth", gain: 0.035, delay: 0.18, slideTo: 45, cinematic })
  },
  fairyIntro(): void {
    [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98, 2093.0].forEach((freq, i) => {
      tone({ freq, dur: 0.7, gain: 0.038, delay: i * 0.14, cinematic: true })
    })
  },
  distantJet(gain = 0.02): void {
    if (gain <= 0.001) return
    tone({ freq: 58, dur: 1.2, type: "sine", gain: Math.min(0.035, gain) })
    tone({ freq: 82, dur: 0.9, type: "triangle", gain: Math.min(0.02, gain * 0.6), delay: 0.1 })
  },
  turbopropHum(gain = 0.025): void {
    if (gain <= 0.001) return
    tone({ freq: 118, dur: 0.8, type: "sawtooth", gain: Math.min(0.04, gain) })
    tone({ freq: 124, dur: 0.8, type: "triangle", gain: Math.min(0.03, gain * 0.75) })
  },
  cargoRumble(gain = 0.03): void {
    if (gain <= 0.001) return
    tone({ freq: 48, dur: 1.4, type: "triangle", gain: Math.min(0.045, gain) })
    tone({ freq: 72, dur: 1.0, type: "sine", gain: Math.min(0.03, gain * 0.7), delay: 0.08 })
  },
  lightProp(gain = 0.025): void {
    if (gain <= 0.001) return
    tone({ freq: 145, dur: 0.65, type: "sawtooth", gain: Math.min(0.035, gain) })
    tone({ freq: 95, dur: 0.65, type: "sine", gain: Math.min(0.025, gain * 0.7) })
  },
  rotorRhythm(gain = 0.03): void {
    if (gain <= 0.001) return
    tone({ freq: 78, dur: 0.22, type: "triangle", gain: Math.min(0.045, gain) })
    tone({ freq: 74, dur: 0.22, type: "triangle", gain: Math.min(0.045, gain), delay: 0.28 })
  },
}

/** Stop scheduled/current intro tones when the camera journey is skipped. */
export const stopCinematicAudio = (): void => {
  cinematicOscillators.forEach((oscillator) => {
    try {
      oscillator.stop()
    } catch {
      // It may have naturally ended between iteration and stop.
    }
  })
  cinematicOscillators.clear()
}

const ensureAmbient = (): Howl | null => {
  const track = assets.audio.ambient
  if (!track) return null
  if (ambient || ambientFailed) return ambient
  ambientInstancesCreated++
  ambient = new Howl({
    src: [track.src],
    // a personalized track is a blob: URL with no extension to guess from
    ...(track.format ? { format: [track.format] } : {}),
    html5: true,
    loop: true,
    preload: true,
    volume: 0,
    onload: () => {
      if (ambientWanted) playAmbient()
    },
    onloaderror: () => {
      ambientFailed = true
      ambient?.unload()
      ambient = null
    },
  })
  return ambient
}

const playAmbient = (): void => {
  // HTML5 audio created before a user gesture is locked and exhausts
  // Howler's unlock pool; wait for initAudio (Enter / first click).
  if (!userActivated) return
  const track = ensureAmbient()
  if (!track || track.state() !== "loaded" || muted) return
  if (!track.playing()) track.play()
  track.fade(track.volume(), AMBIENT_VOLUME, 1800)
}

export const setAmbient = (on: boolean): void => {
  ambientWanted = on
  if (on) {
    playAmbient()
    return
  }
  if (!ambient) return
  ambient.fade(ambient.volume(), 0, 450)
  window.setTimeout(() => {
    if (!ambientWanted) ambient?.pause()
  }, 480)
}

const bindVisibility = (): void => {
  if (visibilityBound || typeof document === "undefined") return
  visibilityBound = true
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      ambient?.pause()
    } else if (ambientWanted && !muted) {
      playAmbient()
    }
  })
}

export const getAudioDiagnostics = (): {
  ambientInstancesCreated: number
  cinematicOscillators: number
} => ({
  ambientInstancesCreated,
  cinematicOscillators: cinematicOscillators.size,
})
