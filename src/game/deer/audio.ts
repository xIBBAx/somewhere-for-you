import { audioContext, audioLive, audioOut } from "../audio/audio"
import { avatarRT, cameraRT } from "../runtime"
import type { DeerState } from "./state"

const voices = new WeakMap<DeerState, { lastCall: number; mode: string; beat: number }>()
/** Original quiet synthesized calls; no downloaded wildlife recordings. */
export const updateDeerAudio = (d: DeerState, time: number): void => {
  let v = voices.get(d)
  if (!v) {
    v = { lastCall: -100, mode: d.mode, beat: 0 }
    voices.set(d, v)
  }
  const beat = Math.floor((d.animator?.stride ?? 0) * 4),
    alarm = ["protect", "flee"].includes(d.mode)
  const call = alarm && v.mode !== d.mode && time - v.lastCall > 12
  const step = Math.abs(d.speed) > 0.4 && beat !== v.beat
  v.mode = d.mode
  v.beat = beat
  const body = avatarRT(),
    dx = d.x - body.pos.x,
    dz = d.z - body.pos.z,
    dist = Math.hypot(dx, dz)
  if ((!call && !step) || dist > 30 || !audioLive()) return
  const ctx = audioContext(),
    out = audioOut()
  if (!ctx || !out) return
  if (call) v.lastCall = time
  const small = d.ident.age === "fawn",
    yak = d.ident.species === "yak",
    bark = d.ident.species === "muntjac"
  const duration = call ? (bark ? 0.26 : small ? 0.35 : 0.4) : 0.085
  const freq = call ? (yak ? 85 : small ? 510 : bark ? 240 : d.ident.species === "elk" ? 440 : 145) : yak ? 65 : 105
  const gain = (call ? 0.035 : 0.026) * Math.max(0, 1 - dist / 30) ** 2
  const osc = ctx.createOscillator(),
    filter = ctx.createBiquadFilter(),
    env = ctx.createGain(),
    pan = ctx.createStereoPanner()
  osc.type = call ? "sawtooth" : "sine"
  osc.frequency.setValueAtTime(freq, ctx.currentTime)
  osc.frequency.exponentialRampToValueAtTime(freq * (bark ? 0.65 : 0.78), ctx.currentTime + duration)
  filter.type = "lowpass"
  filter.frequency.value = call ? (bark ? 800 : 550) : 200
  pan.pan.value = Math.max(
    -0.85,
    Math.min(0.85, (Math.cos(cameraRT.yaw) * dx - Math.sin(cameraRT.yaw) * dz) / Math.max(1, dist)),
  )
  env.gain.setValueAtTime(0.0001, ctx.currentTime)
  env.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.012)
  env.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration)
  osc.connect(filter).connect(env).connect(pan).connect(out)
  osc.start()
  osc.stop(ctx.currentTime + duration + 0.02)
  osc.onended = () => {
    osc.disconnect()
    filter.disconnect()
    env.disconnect()
    pan.disconnect()
  }
}
