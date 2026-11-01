import { debugEnabled } from "../../dev/debugFlag"
import { ambienceOut, audioContext, audioOut } from "./audio"

/**
 * Field-recorded soundscape (CC0 recordings, built offline; not included in this repository):
 * seamless ambience loops on the ambience bus whose levels follow the world,
 * plus a sprite of one-shots (footsteps by surface, ducks, meows, thunder).
 *
 * Loops stream in lazily the first time they are wanted, so the opening never
 * waits on audio. Levels glide (≈1 s) so nothing ever starts abruptly.
 */
export type LoopId =
  | "amb_day" | "amb_meadow" | "amb_birds" | "amb_night" | "amb_night2" | "amb_leaves" | "amb_wind"
  | "amb_lake" | "amb_stream" | "amb_waterfall" | "amb_rain_light" | "amb_rain_heavy" | "amb_frogs"
  | "amb_city" | "cat_purr"

type Layer = { gain: GainNode; pan: StereoPannerNode; source: AudioBufferSourceNode | null; loading: boolean; target: number; panTarget: number; level: number; panLevel: number }
const layers = new Map<LoopId, Layer>()
const buffers = new Map<string, Promise<AudioBuffer | null>>()

const load = (url: string): Promise<AudioBuffer | null> => {
  let pending = buffers.get(url)
  if (!pending) {
    const ctx = audioContext()
    pending = ctx
      ? fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status))))).then((data) => ctx.decodeAudioData(data)).catch((error) => {
          console.warn("[audio] could not load", url, error)
          return null
        })
      : Promise.resolve(null)
    buffers.set(url, pending)
  }
  return pending
}

const layer = (id: LoopId): Layer | null => {
  const ctx = audioContext()
  const bus = ambienceOut()
  if (!ctx || !bus) return null
  let l = layers.get(id)
  if (!l) {
    const gain = ctx.createGain()
    gain.gain.value = 0
    const pan = ctx.createStereoPanner()
    gain.connect(pan).connect(bus)
    l = { gain, pan, source: null, loading: false, target: 0, panTarget: 0, level: 0, panLevel: 0 }
    layers.set(id, l)
  }
  return l
}

const start = (id: LoopId, l: Layer): void => {
  if (l.source || l.loading) return
  l.loading = true
  void load(`/assets/audio/ambience/${id}.mp3`).then((buffer) => {
    l.loading = false
    const ctx = audioContext()
    if (!buffer || !ctx || l.source) return
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true
    // skip MP3 encoder padding at both ends so the seam stays silent-free
    source.loopStart = Math.min(0.06, buffer.duration * 0.01)
    source.loopEnd = Math.max(source.loopStart + 0.5, buffer.duration - 0.06)
    source.connect(l.gain)
    // each loop begins at a random point: layers never phase-lock audibly
    source.start(ctx.currentTime + 0.02, source.loopStart + Math.random() * (source.loopEnd - source.loopStart))
    l.source = source
  })
}

/** Set a loop's wanted level (0..1, already mixed) and stereo position. */
export const setLoop = (id: LoopId, level: number, pan = 0): void => {
  const l = layer(id)
  if (!l) return
  l.target = Math.max(0, Math.min(1, level))
  l.panTarget = Math.max(-1, Math.min(1, pan))
  if (l.target > 0.002) start(id, l)
}

if (debugEnabled()) {
  ;(window as unknown as { __worldAudioLayers?: () => Record<string, string> }).__worldAudioLayers = () =>
    Object.fromEntries([...layers.entries()].filter(([, l]) => l.target > 0.005).map(([id, l]) => [id, `${Math.round(l.level * 100) / 100}/${Math.round(l.target * 100) / 100}${l.source ? "" : " (loading)"}`]))
}

let lastUpdate = 0
/**
 * Glide every loop toward its target (time constant ≈1 s); call a few times
 * per second. Smoothing happens here and each step is handed to the audio
 * thread as a short linear ramp, so the automation list never grows.
 */
export const updateLoops = (): void => {
  const ctx = audioContext()
  if (!ctx) return
  const now = ctx.currentTime
  const dt = lastUpdate ? Math.min(0.5, Math.max(0.01, now - lastUpdate)) : 0.125
  lastUpdate = now
  const k = 1 - Math.exp(-dt / 1.0)
  for (const l of layers.values()) {
    // a loop that is still loading waits silently at zero
    l.level = l.source ? l.level + (l.target - l.level) * k : 0
    l.panLevel += (l.panTarget - l.panLevel) * Math.min(1, k * 1.5)
    l.gain.gain.cancelScheduledValues(now)
    l.gain.gain.setValueAtTime(l.gain.gain.value, now)
    l.gain.gain.linearRampToValueAtTime(l.level, now + dt)
    l.pan.pan.cancelScheduledValues(now)
    l.pan.pan.setValueAtTime(l.pan.pan.value, now)
    l.pan.pan.linearRampToValueAtTime(l.panLevel, now + dt)
  }
}

// ------------------------------------------------------------------ sprite
type SpriteMap = Record<string, [number, number][]>
let sprite: { buffer: AudioBuffer; map: SpriteMap } | null = null
let spriteLoading = false
const lastPick = new Map<string, number>()

export const loadSprite = (): void => {
  if (sprite || spriteLoading || !audioContext()) return
  spriteLoading = true
  void Promise.all([
    fetch("/assets/audio/sprites/sprites.json").then((r) => r.json() as Promise<{ sprite: SpriteMap }>),
    load("/assets/audio/sprites/sfx.mp3"),
  ]).then(([meta, buffer]) => {
    if (buffer) sprite = { buffer, map: meta.sprite }
  }).catch((error) => console.warn("[audio] sound sprite unavailable", error))
}

/**
 * Play a one-shot from the sprite with natural variation: a different take
 * each time, ±pitch and level jitter, optional stereo position.
 */
export const playSprite = (key: string, volume = 1, opts: { pitch?: number; pan?: number; jitter?: number; bus?: "sfx" | "ambience" } = {}): boolean => {
  const ctx = audioContext()
  if (!ctx || !sprite) {
    loadSprite()
    return false
  }
  const takes = sprite.map[key]
  if (!takes?.length) return false
  let i = Math.floor(Math.random() * takes.length)
  if (takes.length > 1 && i === lastPick.get(key)) i = (i + 1) % takes.length
  lastPick.set(key, i)
  const [offset, duration] = takes[i]
  const jitter = opts.jitter ?? 0.06
  const source = ctx.createBufferSource()
  source.buffer = sprite.buffer
  source.playbackRate.value = (opts.pitch ?? 1) * (1 + (Math.random() - 0.5) * 2 * jitter)
  const gain = ctx.createGain()
  gain.gain.value = volume * (1 - Math.random() * 0.18)
  const pan = ctx.createStereoPanner()
  pan.pan.value = opts.pan ?? 0
  const out = opts.bus === "ambience" ? ambienceOut() : audioOut()
  if (!out) return false
  source.connect(gain).connect(pan).connect(out)
  source.start(ctx.currentTime + 0.005, offset, duration)
  source.onended = () => { source.disconnect(); gain.disconnect(); pan.disconnect() }
  return true
}
