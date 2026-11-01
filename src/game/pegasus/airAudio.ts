import { ambienceOut, audioContext } from "../audio/audio"
import type { AirSound } from "./flightAir"

/**
 * The air rushing past a flying Pegasus, synthesised from white noise with
 * Web Audio (no recorded material). Three looped noise beds: a band-passed
 * rush whose pitch climbs with speed and altitude, a low roar in dense air
 * near the ground, and a hiss when skimming spray. Everything routes through the
 * game's ambience bus, so mute and the browser's autoplay gating apply as they
 * do for every other sound. Nothing is built until the audio context exists.
 */

type Rig = {
  ctx: AudioContext
  rushBand: BiquadFilterNode
  rushGain: GainNode
  rushTone: BiquadFilterNode
  roarTone: BiquadFilterNode
  roarGain: GainNode
  hissBand: BiquadFilterNode
  hissGain: GainNode
}

let rig: Rig | null = null

const noiseLoop = (ctx: AudioContext): AudioBufferSourceNode => {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = true
  src.start()
  return src
}

const build = (): Rig | null => {
  const ctx = audioContext()
  const out = ambienceOut()
  if (!ctx || !out) return null
  // rush: a band of air noise, muffled by cloud through its tone filter
  const rushBand = ctx.createBiquadFilter()
  rushBand.type = "bandpass"
  rushBand.Q.value = 0.7
  const rushGain = ctx.createGain()
  rushGain.gain.value = 0
  const rushTone = ctx.createBiquadFilter()
  rushTone.type = "lowpass"
  rushTone.Q.value = 0.5
  noiseLoop(ctx).connect(rushBand).connect(rushGain).connect(rushTone).connect(out)
  // roar: the low, heavy wash of dense air
  const roarTone = ctx.createBiquadFilter()
  roarTone.type = "lowpass"
  roarTone.frequency.value = 180
  roarTone.Q.value = 0.8
  const roarGain = ctx.createGain()
  roarGain.gain.value = 0
  noiseLoop(ctx).connect(roarTone).connect(roarGain).connect(out)
  // hiss: spray thrown off water
  const hissBand = ctx.createBiquadFilter()
  hissBand.type = "bandpass"
  hissBand.frequency.value = 3600
  hissBand.Q.value = 0.6
  const hissGain = ctx.createGain()
  hissGain.gain.value = 0
  noiseLoop(ctx).connect(hissBand).connect(hissGain).connect(out)
  return { ctx, rushBand, rushGain, rushTone, roarTone, roarGain, hissBand, hissGain }
}

const TAU = 0.25

/** Ease the air-rush beds toward `s`, or to silence when `s` is null (on the ground, in space, or the air is still). */
export const driveAir = (s: AirSound | null): void => {
  // A quiet scene should not allocate three permanent noise loops.
  if (!rig && !s) return
  if (!rig) rig = build()
  if (!rig) return
  const { ctx } = rig
  const t = ctx.currentTime
  const on = s !== null
  rig.rushGain.gain.setTargetAtTime(on ? s.rush : 0, t, TAU)
  rig.roarGain.gain.setTargetAtTime(on ? s.roar : 0, t, TAU)
  rig.hissGain.gain.setTargetAtTime(on ? s.hiss : 0, t, TAU)
  if (s) {
    rig.rushBand.frequency.setTargetAtTime(420 * s.tone, t, 0.2)
    rig.rushTone.frequency.setTargetAtTime(s.cutoff, t, 0.2)
  }
}
