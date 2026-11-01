import { groundHeight } from "../world-layout"
import { waterSurfaceAt } from "../../world/waterSurface"
import { standable, probeAhead } from "./horseMotion"
import { WATER_WAYS, pickWaterSpot, waterInvitation, waterUnwelcoming } from "../../world/creatureWater"
import { worldRT } from "../runtime"
import type { HorseMode, HorseState } from "./horseState"

/**
 * Daily behaviour of a horse nobody is riding.
 *
 * Grounded in equine time budgets and ethology:
 * grazing dominates, punctuated by a step or two to fresh grass and a look
 * round; resting is done standing on a "cocked" hind leg (alternating legs)
 * with ears relaxed sideways; horses lie down only when calm and unthreatened,
 * on the chest, occasionally flat out for a few minutes of REM sleep, and rise
 * forelegs first. They keep company with a herd mate, drink when water is
 * near, notice fast movement (ears and head swing to it) and settle again
 * rather than panic; a curious horse wanders over to a quiet person.
 * Personalities (calm, curious, energetic, social) shift every probability.
 */

export type BrainContext = {
  time: number
  /** characters on foot (riders are not threats) */
  people: Array<{ id: string; x: number; z: number; speed: number; mounted: boolean }>
  cat: { x: number; z: number; speed: number }
  /** 0..1 lightning flash right now */
  lightning: number
}

const angleTo = (h: HorseState, x: number, z: number): number => Math.atan2(x - h.x, z - h.z)
const rel = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b))

export const setMode = (h: HorseState, mode: HorseMode, timer: number): void => {
  if (mode !== "drink") h.bathe = 0
  h.mode = mode
  h.modeTime = 0
  h.timer = timer
}

const pickSpot = (h: HorseState, range: number): boolean => {
  for (let i = 0; i < 10; i++) {
    let cx = h.homeX
    let cz = h.homeZ
    // social horses graze near their buddy
    if (h.buddy && h.random() < h.ident.traits.sociability * 0.8) {
      cx = h.buddy.x
      cz = h.buddy.z
    }
    const a = h.random() * Math.PI * 2
    const d = 3 + h.random() * range
    const x = cx + Math.sin(a) * d
    const z = cz + Math.cos(a) * d
    if (Math.hypot(x - h.homeX, z - h.homeZ) > h.homeRange) continue
    if (!standable(x, z)) continue
    h.tx = x
    h.tz = z
    return true
  }
  return false
}

const findWater = (h: HorseState): boolean => {
  for (let ring = 6; ring <= 26; ring += 5) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + ring
      const x = h.x + Math.sin(a) * ring
      const z = h.z + Math.cos(a) * ring
      const s = waterSurfaceAt(x, z)
      if (s === null) continue
      const depth = s - groundHeight(x, z)
      if (depth > 0.05 && depth < 0.45) {
        h.tx = x
        h.tz = z
        return true
      }
    }
  }
  return false
}

const startGesture = (h: HorseState, name: keyof HorseState["gestureTimers"]): void => {
  if (h.gestureTimers[name] < 0) h.gestureTimers[name] = 0
}

/** Choose what to do next from the current mood and surroundings. */
const next = (h: HorseState): void => {
  const t = h.ident.traits
  const r = h.random()
  const restful = t.calm * 0.6 + (1 - t.energy) * 0.4
  if (h.mode === "wait") {
    setMode(h, "wait", 6 + h.random() * 10)
    return
  }
  if (r < 0.08 * restful && h.mode !== "lie") {
    setMode(h, "lie", 25 + h.random() * 45)
    return
  }
  if (r < 0.14 && findWater(h)) {
    setMode(h, "drink", 30)
    return
  }
  if (r < 0.4 + 0.15 * t.energy) {
    if (pickSpot(h, h.homeRange * 0.6)) {
      setMode(h, "walk", 25)
      return
    }
  }
  if (r < 0.62) {
    setMode(h, "stand", 8 + h.random() * 22 * restful)
    return
  }
  setMode(h, "graze", 15 + h.random() * 35)
}

export const stepBrain = (h: HorseState, ctx: BrainContext, dt: number): void => {
  const t = h.ident.traits
  const sp = h.pose.speeds
  h.modeTime += dt
  h.timer -= dt
  const p = h.pose
  h.wantHeading = null
  h.targetSpeed = 0

  // ---- perception: who is near, who is moving fast -------------------------
  let threat = 0
  let tx = 0
  let tz = 0
  let quietNear: (typeof ctx.people)[number] | null = null
  for (const person of ctx.people) {
    const d = Math.hypot(person.x - h.x, person.z - h.z)
    // home horses know the explorer and the companion; wild ones keep a little distance
    const tolerance = h.persistent ? 0.25 : 1
    const fast = person.speed > 3.4 && !person.mounted
    const reach = (h.persistent ? 6 : 13) * (1.4 - t.calm)
    if (fast && d < reach) {
      const s = (1 - d / reach) * tolerance + 0.25
      if (s > threat) { threat = s; tx = person.x; tz = person.z }
    }
    if (!fast && d < 7 && person.speed < 0.6) quietNear = person
  }
  const catD = Math.hypot(ctx.cat.x - h.x, ctx.cat.z - h.z)
  if (ctx.cat.speed > 3 && catD < 6 * (1.5 - t.calm)) {
    const s = 0.5 * (1 - catD / 9)
    if (s > threat) { threat = s; tx = ctx.cat.x; tz = ctx.cat.z }
  }
  if (ctx.lightning > 0.6) { threat = Math.max(threat, 0.6 - t.calm * 0.3); tx = h.x + 10; tz = h.z }

  const busy = h.mode === "come" || h.mode === "follow" || h.mode === "ridden"
  if (!busy && threat > 0.35 && h.mode !== "flee") {
    h.watchX = tx
    h.watchZ = tz
    if (h.mode === "lie") {
      // a disturbed horse gets up first
      h.timer = Math.min(h.timer, 2.4)
    } else if (h.mode !== "alert") {
      setMode(h, "alert", 2 + h.random() * 3)
      startGesture(h, "snort")
    }
    // only a sensitive, untrusting horse moves off, and only a few metres
    if (threat > 0.75 && t.calm < 0.5 && h.trust < 0.5 && h.mode === "alert" && h.modeTime > 0.6) {
      const away = angleTo(h, tx, tz) + Math.PI + (h.random() - 0.5) * 0.8
      h.tx = h.x + Math.sin(away) * 12
      h.tz = h.z + Math.cos(away) * 12
      setMode(h, "flee", 5)
    }
  }

  // ---- modes ----------------------------------------------------------------
  let graze = 0
  let alert = 0
  let rest = 0
  let drink = 0
  let lieW = 0
  let look = 0
  let ears = 0.25
  switch (h.mode) {
    case "graze": {
      graze = 1
      ears = -0.25
      // a step or two to fresh grass every few seconds, head down
      const cycle = (h.modeTime + (h.ident.seed % 7)) % 7
      if (cycle > 5.2 && cycle < 6.4) {
        h.targetSpeed = 0.45
        if (probeAhead(h, h.heading, 1.4) > 0.5 || Math.hypot(h.x - h.homeX, h.z - h.homeZ) > h.homeRange) {
          h.wantHeading = angleTo(h, h.homeX, h.homeZ)
        } else h.wantHeading = h.heading + Math.sin(h.modeTime * 0.37 + h.ident.seed) * 0.6
      }
      // look up and round now and then while chewing
      if (cycle > 2.2 && cycle < 3.4) { graze = 0.25; look = 0.5 }
      if (h.timer <= 0) next(h)
      if (quietNear && h.random() < dt * 0.05 * t.curiosity) {
        h.watchX = quietNear.x
        h.watchZ = quietNear.z
        setMode(h, "curious", 8)
      }
      break
    }
    case "stand": {
      rest = h.modeTime > 3 ? 1 : 0
      ears = -0.15
      if (h.timer <= 0) next(h)
      if (quietNear && h.random() < dt * 0.04 * t.curiosity) {
        h.watchX = quietNear.x
        h.watchZ = quietNear.z
        setMode(h, "curious", 8)
      }
      break
    }
    case "walk": {
      const d = Math.hypot(h.tx - h.x, h.tz - h.z)
      h.wantHeading = angleTo(h, h.tx, h.tz)
      // avoid trunks and rocks by bearing off to the clearer side
      if (probeAhead(h, h.heading, 2.2) > 0.5) {
        const left = probeAhead(h, h.heading + 0.7, 2.2)
        const right = probeAhead(h, h.heading - 0.7, 2.2)
        h.wantHeading = h.heading + (left <= right ? 0.9 : -0.9)
      }
      const facing = Math.abs(rel(h.wantHeading, h.heading))
      h.targetSpeed = d > 1 ? sp[0] * (0.75 + 0.25 * t.energy) * (facing > 1.2 ? 0.3 : 1) : 0
      ears = 0.35
      if (d < 1.2 || h.timer <= 0 || h.blocked > 1.2) setMode(h, h.random() < 0.7 ? "graze" : "stand", 10 + h.random() * 20)
      break
    }
    case "drink": {
      const d = Math.hypot(h.tx - h.x, h.tz - h.z)
      if (h.bathe > 0) {
        // the dip: wade (or swim) out, stand cooling and pawing at the
        // surface, then walk back up the bank
        const way = WATER_WAYS.horse
        if (h.bathe === 2) {
          h.targetSpeed = 0
          drink = Math.sin(h.modeTime * 0.6) > 0.6 ? 0.6 : 0
          ears = 0.1
          if (h.swim < 0.3 && h.random() < dt * 0.35) startGesture(h, "paw")
          if (h.modeTime > 9 + 10 * waterInvitation(worldRT.timeOfDay) || waterUnwelcoming()) { h.bathe = 3; h.tx = h.bankX; h.tz = h.bankZ; h.modeTime = 0 }
        } else {
          h.wantHeading = angleTo(h, h.tx, h.tz)
          h.targetSpeed = d > 0.9 ? (h.swim > 0.4 ? way.swimSpeed : sp[0] * 0.75) : 0
          if (d <= 0.9 || h.blocked > 1.6) {
            if (h.bathe === 1) { h.bathe = 2; h.modeTime = 0 } else { h.bathe = 0; setMode(h, "graze", 20) }
          }
        }
        if (h.timer <= 0 && h.bathe !== 3) { h.bathe = 3; h.tx = h.bankX; h.tz = h.bankZ; h.timer = 30 }
        break
      }
      if (d > 1.6) {
        h.wantHeading = angleTo(h, h.tx, h.tz)
        h.targetSpeed = sp[0] * 0.8
        if (h.blocked > 1.5) setMode(h, "graze", 10)
      } else {
        drink = 1
        ears = -0.1
        if (h.modeTime > 12 + (h.ident.seed % 6)) {
          // a warm day and a horse that likes the water: walk on in
          const invite = waterInvitation(worldRT.timeOfDay)
          const deep = t.energy > 0.55 && h.random() < invite * 0.45
          const spot = !h.flight && !waterUnwelcoming() && h.random() < WATER_WAYS.horse.love * (0.15 + invite * 1.1)
            ? pickWaterSpot(h.x, h.z, h.heading, WATER_WAYS.horse, h.ident.scale, deep, h.random) : null
          if (spot) {
            h.bathe = 1; h.bankX = h.x; h.bankZ = h.z; h.tx = spot.x; h.tz = spot.z; h.timer = 60
          } else setMode(h, "graze", 20)
        }
      }
      if (h.timer <= 0) setMode(h, "graze", 15)
      break
    }
    case "lie": {
      // down (~2.5 s) ... lying ... up (~2.5 s); a while flat out for REM sleep
      const down = Math.min(1, h.modeTime / 2.6)
      const total = h.modeTime + Math.max(0, h.timer)
      const remStart = total * 0.45
      const flat = h.ident.traits.calm > 0.55 && h.modeTime > remStart && h.modeTime < remStart + 9 ? 1 : 0
      lieW = down
      p.lieSide = p.lieSide + ((flat ? 1 : 0) - p.lieSide) * (1 - Math.exp(-dt * 0.8))
      ears = -0.6
      if (h.timer <= 0) {
        // rising: forelegs first, then the quarters
        p.rising = Math.min(1, p.rising + dt / 2.4)
        p.lieSide = Math.max(0, p.lieSide - dt * 2)
        if (p.rising >= 1) {
          p.rising = 0
          p.lie = 0
          startGesture(h, "shake")
          setMode(h, "stand", 6)
        }
      }
      break
    }
    case "alert": {
      alert = 1
      look = 1
      ears = 1
      h.wantHeading = Math.abs(rel(angleTo(h, h.watchX, h.watchZ), h.heading)) > 1.3 ? angleTo(h, h.watchX, h.watchZ) : null
      if (h.timer <= 0 && threat < 0.3) setMode(h, h.random() < 0.6 ? "graze" : "stand", 10 + h.random() * 15)
      break
    }
    case "flee": {
      // a few strides of trot away, then turn to look
      alert = 0.6
      ears = 0.8
      h.wantHeading = angleTo(h, h.tx, h.tz)
      h.targetSpeed = sp[1] * (0.8 + 0.4 * t.energy)
      if (h.timer <= 0 || Math.hypot(h.tx - h.x, h.tz - h.z) < 2 || h.blocked > 0.8) setMode(h, "alert", 3)
      break
    }
    case "curious": {
      const d = Math.hypot(h.watchX - h.x, h.watchZ - h.z)
      look = 1
      ears = 0.9
      if (quietNear) { h.watchX = quietNear.x; h.watchZ = quietNear.z }
      if (d > 2.0) {
        h.wantHeading = angleTo(h, h.watchX, h.watchZ)
        h.targetSpeed = sp[0] * 0.6
      } else if (Math.abs(rel(angleTo(h, h.watchX, h.watchZ), h.heading)) > 0.8) h.wantHeading = angleTo(h, h.watchX, h.watchZ)
      if (h.timer <= 0 || !quietNear) setMode(h, "graze", 20)
      break
    }
    case "come": {
      // answer the call: canter in from far, trot closer, walk up to stand
      const d = Math.hypot(h.tx - h.x, h.tz - h.z)
      h.wantHeading = angleTo(h, h.tx, h.tz)
      if (probeAhead(h, h.heading, 3 + h.speed * 0.4) > 0.5) {
        const left = probeAhead(h, h.heading + 0.6, 3)
        const right = probeAhead(h, h.heading - 0.6, 3)
        h.wantHeading = h.heading + (left <= right ? 0.8 : -0.8)
      }
      h.targetSpeed = d > 30 ? sp[2] : d > 10 ? sp[1] : d > 2.4 ? sp[0] : 0
      ears = 1
      look = d < 8 ? 1 : 0
      h.watchX = h.tx
      h.watchZ = h.tz
      if (d < 2.6 && Math.abs(h.speed) < 0.4) { startGesture(h, "snort"); setMode(h, "wait", 10) }
      if (h.timer <= 0) setMode(h, "wait", 10)
      break
    }
    case "follow": {
      const d = Math.hypot(h.tx - h.x, h.tz - h.z)
      h.wantHeading = angleTo(h, h.tx, h.tz)
      h.targetSpeed = d > 9 ? sp[1] : d > 3 ? sp[0] * Math.min(1.3, d / 4) : 0
      ears = 0.6
      break
    }
    case "wait": {
      // ground-tied: stays put, grazes on the spot, rests a leg, paws if bored
      const cycle = (h.modeTime % 24) / 24
      graze = cycle > 0.35 && cycle < 0.75 ? 1 : 0
      rest = cycle > 0.8 ? 1 : 0
      ears = graze ? -0.2 : 0.2
      if (h.ident.traits.energy > 0.7 && h.random() < dt * 0.02) startGesture(h, "paw")
      if (quietNear) { h.watchX = quietNear.x; h.watchZ = quietNear.z; look = graze ? 0 : 0.7 }
      break
    }
    case "ridden":
      break
  }

  // ---- gestures and flies -----------------------------------------------------
  if (h.random() < dt / (4 + 8 * (1 - t.energy))) startGesture(h, "swish")
  if (!busy && h.random() < dt / 45) startGesture(h, "headShake")
  if (h.random() < dt / (h.mode === "ridden" ? 30 : 60)) startGesture(h, "snort")

  // ---- smooth the pose layers (the animator eases these further) -------------
  const k = (rate: number): number => 1 - Math.exp(-rate * dt)
  p.graze += (graze - p.graze) * k(graze > p.graze ? 1.4 : 2.2)
  p.drink += (drink - p.drink) * k(1.5)
  p.alert += (alert - p.alert) * k(alert > p.alert ? 6 : 1.5)
  // horses alternate which hind leg they rest
  const restSide = rest > 0 ? (Math.floor(h.ident.seed / 3 + ctx.time / 45) % 2 === 0 ? 1 : -1) : 0
  p.restLeg += (restSide - p.restLeg) * k(1.2)
  if (h.mode === "lie") p.lie += (lieW - p.lie) * k(3)
  else p.lie += (0 - p.lie) * k(3)
  p.look += (look - p.look) * k(3)
  const ang = rel(angleTo(h, h.watchX, h.watchZ), h.heading)
  p.lookYaw += (ang - p.lookYaw) * k(4)
  p.lookPitch = 0
  p.ears += (ears - p.ears) * k(3)
}
