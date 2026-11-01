import { debugEnabled } from "../../dev/debugFlag"
import { mountInteractions } from "../mounts/mount"
import { useFrame } from "@react-three/fiber"
import { useExplorationUI } from "../../state/explorationUIStore"
import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { avatarRT, cameraAutoAllowed, cameraRT, catRT, characterRT, companionRT, playerRT, takeAction, worldRT } from "../runtime"
import { useGame } from "../../state/gameStore"
import { discoveryRT } from "../../world/discoveries"
import { groundHeight } from "../world-layout"
import { qualityRT } from "../../state/qualityStore"
import { glideTo } from "../../utils/renderGlide"
import { advanceAppearance, fadeByDistance, keepAerialSubject, makeFadeable } from "../../world/render/aerialFog"
import { originRT } from "../../world/origin"
import { weatherRT } from "../weather/weatherState"
import { makeIdentity, COATS } from "./breeds"
import { HOME_HERD } from "./homeHerd"
import { disposeHorseModel, makeHorseModel, setHorseLod, setTackVisible } from "./horseAssets"
import { HorseAnimator } from "./HorseAnimator"
import { advanceWingbeat } from "../pegasus/WingAnimator"
import { stepBrain, type BrainContext } from "./horseBrain"
import { stepHorseMotion } from "./horseMotion"
import { horseRT, makeHorseState, type HorseState } from "./horseState"
import { callHorse, horseInteraction, mountQuaternion, resetRider, riderRT, stepFreeFlight, stepRiding, ridingAnchors, tiltPivot } from "./riding"
import { spawnPegasi } from "../pegasus/pegasi"
import { flightQA, isAirborne, stepFlight } from "../pegasus/flight"
import { installPegasusDev } from "../pegasus/pegasusDev"
import { StarHillBeacon } from "../pegasus/StarHillBeacon"
import { whistleForPegasus } from "../pegasus/whistle"
import { callStarborn, clearPendingStarborn, STARBORN_ACTION, tickPendingStarborn } from "../pegasus/starbornCall"
import { tickAero } from "../pegasus/aerobatics"
import { flightCamera, flightReducedMotion } from "../pegasus/flightCamera"
import { installCelestialDev } from "../celestial/celestialDev"
import { spaceRT } from "../celestial/spaceState"
import { horseSounds } from "./horseAudio"
import { spawnWildHerds, wildHorsesTick } from "./herds"
import { Reins } from "./Reins"
import { RainLens } from "./RainLens"
import { installHorseDev } from "./horseDev"
import { resolveHorseContacts } from "./horseContact"
import { WATER_WAYS, makeWaterContact, shakeOffWater, stepWaterContact, type WaterContact } from "../../world/creatureWater"
import { loadHorses, saveHorses } from "./horsePersistence"
import { hoofTurf, jumpLanding } from "../vfx/signatures"

/**
 * The world's horses: the home herd near home (saddled,
 * persistent and rideable by the explorer and the companion) and wild herds that stream
 * with the endless world's chunks. One system simulates, animates and renders
 * them all; React owns only the group.
 */


const _m = new THREE.Matrix4()
const _cam = new THREE.Vector3()
const _s = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _yaw = new THREE.Quaternion()
const _p = new THREE.Vector3()

const horseWater = new WeakMap<object, WaterContact>()

export const HorseSystem = (): React.ReactElement => {
  const root = useMemo(() => {
    const g = new THREE.Group()
    g.name = "horses"
    return g
  }, [])
  const ctx = useMemo<BrainContext>(() => ({ time: 0, people: [], cat: { x: 0, z: 0, speed: 0 }, lightning: 0 }), [])

  useEffect(() => {
    for (const h of HOME_HERD) {
      const ident = makeIdentity(h.seed, h.breed, { name: h.name, coatId: h.coat, coat: COATS[h.coat], face: h.face, legs: h.legs, saddled: true })
      const state = makeHorseState(ident, h.x, h.z, true)
      state.y = groundHeight(h.x, h.z)
      horseRT.horses.set(ident.id, state)
    }
    // herd mates: each home horse keeps company with the next one
    const list = [...horseRT.horses.values()].filter((h) => h.persistent)
    for (let i = 0; i < list.length; i++) list[i].buddy = list[(i + 2) % list.length]
    if (!horseRT.bonded.explorer) horseRT.bonded.explorer = list[0].ident.id
    if (!horseRT.bonded.companion) horseRT.bonded.companion = list[1].ident.id
    // the winged horses: Ivory, Onyx and Starborn on the Star Hill
    spawnPegasi()
    loadHorses()
    const stopHerds = spawnWildHerds()
    const save = (): void => saveHorses()
    const onHidden = (): void => { if (document.hidden) saveHorses() }
    const timer = window.setInterval(save, 5000)
    window.addEventListener("pagehide", save)
    document.addEventListener("visibilitychange", onHidden)
    if (debugEnabled()) {
      installHorseDev()
      installPegasusDev()
      installCelestialDev()
    }
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("pagehide", save)
      document.removeEventListener("visibilitychange", onHidden)
      saveHorses()
      stopHerds()
      for (const h of horseRT.horses.values()) if (h.model) disposeHorseModel(h.model)
      horseRT.horses.clear()
      root.clear()
    }
  }, [root])

  useFrame((state, rawDt) => {
    if (worldRT.relocating || useExplorationUI.getState().panel === "controls") return
    const started = performance.now()
    const dt = Math.min(rawDt, 0.1)
    const time = state.clock.elapsedTime
    const me = avatarRT()
    // detail follows what the camera sees; simulation priority follows the player
    state.camera.getWorldPosition(_cam)
    const camX = _cam.x + originRT.x
    const camZ = _cam.z + originRT.z
    ctx.time = time
    ctx.people.length = 0
    ctx.people.push({ id: "explorer", x: playerRT.pos.x, z: playerRT.pos.z, speed: playerRT.speed, mounted: playerRT.rideY !== null })
    if (characterRT.companionPresent) ctx.people.push({ id: "companion", x: companionRT.pos.x, z: companionRT.pos.z, speed: companionRT.speed, mounted: companionRT.rideY !== null })
    ctx.cat.x = catRT.pos.x
    ctx.cat.z = catRT.pos.z
    ctx.cat.speed = catRT.speed
    ctx.lightning = worldRT.lightning

    wildHorsesTick(dt, me.pos.x, me.pos.z)
    // the finale and the opening journey need everyone on their feet
    if (worldRT.finaleActive || worldRT.introActive) {
      if (riderRT.explorer.phase !== "none") resetRider("explorer")
      if (riderRT.companion.phase !== "none") resetRider("companion")
    }
    // riders first: controls and horse motion, so the rider sits on this frame's saddle
    stepRiding(dt, time)
    resolveHorseContacts(dt, time)
    const activeMount = riderRT[characterRT.active].horse
    tickAero(dt, activeMount?.kind === "horse" ? activeMount as HorseState : null)
    let rendered = 0
    let simulated = 0
    for (const h of horseRT.horses.values()) {
      const dist = Math.hypot(h.x - me.pos.x, h.z - me.pos.z)
      const near = dist < 45 || Math.hypot(h.x - camX, h.z - camZ) < 30
      // simulation: riders and near horses every frame, far ones at a lower rate
      h.animClock += dt
      const period = h.rider || near || isAirborne(h) ? 0 : dist < 120 ? 0.1 : 0.4
      const stepping = h.animClock >= period
      const step = stepping ? h.animClock : 0
      if (stepping) {
        h.animClock = 0
        simulated++
        if (h.animator?.debug) {
          // frozen for gait QA: animated at its gait speed without moving
          h.speed = h.pose.speeds[h.animator.debug.gait]
        } else if (h.debugSpeed !== null) {
          h.targetSpeed = h.debugSpeed
          stepHorseMotion(h, step, h.debugSpeed > 0.2 ? 0.25 : 0)
        } else if (!h.rider && !h.passenger) {
          // a whistled Pegasus on the ground keeps coming to wherever its rider is now
          if (h.flight && h.reservedBy && h.mode === "come") {
            const caller = h.reservedBy === "explorer" ? playerRT : companionRT
            h.tx = caller.pos.x
            h.tz = caller.pos.z
          }
          if (isAirborne(h)) stepFreeFlight(h, step)
          else {
            stepBrain(h, ctx, step)
            if (!h.flight || !stepFlight(h, step)) stepHorseMotion(h, step, null)
          }
        }
      }
      // ---- presentation ----------------------------------------------------
      const range = qualityRT.profile.animalRange + 40
      const wantVisible = dist < range && !horseRT.hidden && !h.soloHidden
      if (wantVisible && !h.model && !h.loading && !h.failed) {
        h.loading = true
        void makeHorseModel(h.ident).then((m) => {
          h.loading = false
          if (!m) { h.failed = true; return }
          if (horseRT.horses.get(h.ident.id) !== h) { disposeHorseModel(m); return }
          m.root.userData.appearance = 0
          m.root.userData.fade = 1
          m.root.visible = false
          makeFadeable(m.root)
          if (h.flight) keepAerialSubject(m.root)
          h.model = m
          m.root.scale.setScalar(h.ident.scale)
          root.add(m.root)
          h.animator = new HorseAnimator(m, h.ident.seed)
          setTackVisible(m, h.ident.saddled)
        })
      }
      const m = h.model
      if (!m || !h.animator) continue
      const appearance = h.rider || h.passenger ? 1 : advanceAppearance(Number(m.root.userData.appearance ?? 0), wantVisible, dt)
      m.root.userData.appearance = appearance
      m.root.visible = appearance > 0
      // (its far meshes arrive after the model: they dissolve too)
      if (m.lod[1].length && !m.root.userData.fadeFar) { makeFadeable(m.root); if (h.flight) keepAerialSubject(m.root); m.root.userData.fadeFar = true }
      // dissolves at the edge of its range rather than popping (aerialFog.ts)
      m.root.userData.fade = h.rider || h.passenger ? 0 : 1 - appearance * (1 - fadeByDistance(dist, range))
      h.visible = m.root.visible
      if (!m.root.visible) continue
      rendered++
      const camDist = Math.min(dist, Math.hypot(h.x - camX, h.z - camZ))
      const level = setHorseLod(m, camDist)
      if (!stepping) {
        const g = glideTo(h.glide, h.x, h.z, h.heading, h.speed, h.turnRate, h.animClock, false, dt)
        m.root.position.set(g.x + h.rootOffset.x, groundHeight(g.x, g.z) + h.rootOffset.y, g.z + h.rootOffset.z)
        m.root.quaternion.copy(h.rootQuat).premultiply(_yaw.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, g.heading - h.rootHeading))
        m.root.updateMatrixWorld()
        continue
      }
      for (const g of Object.keys(h.gestureTimers) as Array<keyof typeof h.gestureTimers>) {
        const dur = g === "swish" ? 1.1 : g === "headShake" ? 1.0 : g === "snort" ? 0.7 : g === "paw" ? 2.0 : 1.4
        if (h.gestureTimers[g] >= 0) {
          h.gestureTimers[g] += step / dur
          if (h.gestureTimers[g] >= 1) {
            h.gestureTimers[g] = -1
          }
        }
        h.pose[g] = h.gestureTimers[g]
      }
      if (h.gestureTimers.snort > 0 && h.gestureTimers.snort < step / 0.7 + 1e-3 && near) horseSounds.snort(h, dist)
      const p = h.pose
      p.dt = step
      p.time = time
      p.speed = h.speed
      p.turnRate = h.turnRate
      p.accel = h.accel
      p.detail = level === 0
      p.exertion = h.exertion
      p.wade = h.wade
      p.swim = h.swim
      p.lead = h.lead
      p.ridden = h.rider || h.passenger ? 1 : 0
      // ---- wings and flight posture
      const fl = h.flight
      if (fl) {
        const fly = fl.mode === "ground" ? 0 : fl.mode === "takeoff" ? Math.min(1, fl.t / 0.5) * (0.4 + 0.6 * Math.min(1, Math.max(fl.alt / 0.3, (fl.t - 0.3) / 0.3, 0))) : fl.mode === "landing" ? 1 - Math.max(0, 1 - fl.alt / 0.6) * 0.8 : 1
        p.fly += (fly - p.fly) * (1 - Math.exp(-step * 6))
        p.legReach = fl.mode === "landing" ? Math.max(fl.flare, Math.min(1, 1 - fl.alt / 8)) : fl.mode === "takeoff" ? Math.max(0, 1 - fl.t / 0.6) * 0.6 : fl.mode === "ground" ? fl.landing.settle : 0
        p.flyPitch = fl.pitch
        p.contact = fl.landing.contact
        p.landingBrake = fl.landing.brake
        const w = p.wing
        w.spread = fl.spread
        w.power = fl.power
        w.glide = fl.glide
        w.tuck = fl.tuck
        // Starborn's overdrive sweeps her wings back into a scythe rather than shutting them
        w.sweep = Math.max(fl.sweep, h.ident.breed === "starborn" ? fl.overdrive * 0.45 * (1 - fl.launch) : 0)
        // and a dash begins with her wings drawn up to gather it (the first ~0.3 s)
        w.gather = fl.boostT > 0 && fl.boostT < 0.32 && fl.mode === "air" ? Math.sin(Math.PI * Math.min(1, fl.boostT / 0.3)) : 0
        w.flare = fl.flare
        w.roll = fl.roll
        w.bank = fl.spec.bank
        w.ridden = h.rider || h.passenger ? 1 : 0
        w.idle = !h.rider && !h.passenger && fl.mode === "ground" && Math.abs(h.speed) < 0.2 && h.mode !== "come"
        w.mode = fl.mode
        w.speed = h.speed
        w.accel = h.accel
        w.time = time
        w.personality = h.ident.breed
        w.brake = fl.landing.brake
        w.contact = fl.landing.contact
        w.stride = h.animator.stride
        w.reducedMotion = flightReducedMotion()
        w.wind = weatherRT.wind + weatherRT.gust
        w.clearance = Math.max(0, fl.alt)
        w.span = (m.meta.wing?.semi ?? 3.2) * h.ident.scale
        // One authoritative phase drives the joints, feather shader, body and
        // both riders. Cadence changes continuously with load and breed.
        fl.flap = advanceWingbeat(fl.flap, step, fl.flapHz, w)
        w.flap = fl.flap
        const qa = flightQA.wing.get(h.ident.id)
        if (qa) {
          Object.assign(w, qa)
          if (qa.fly !== undefined) p.fly = qa.fly
          if (qa.legReach !== undefined) p.legReach = qa.legReach
        }
      }
      if (h.irritated > 0) p.ears = -1
      // water against the body: entry splash, wake rings, a coat that stays dark
      // and slick for a while after a swim and sheds drips as it dries
      let contact = horseWater.get(h)
      if (!contact) { contact = makeWaterContact(); horseWater.set(h, contact) }
      if (!h.flight && h.jumpT < 0) {
        stepWaterContact(contact, WATER_WAYS.horse, h.ident.scale, h.x, h.z, groundHeight(h.x, h.z), h.heading, Math.abs(h.speed), dt, near)
        // out and standing still, a soaked horse soon shakes itself from the head back
        if (contact.wet > 0.55 && !contact.inWater && Math.abs(h.speed) < 0.3 && h.gestureTimers.shake < 0 && !h.rider && !h.passenger && Math.random() < dt * 0.6) {
          h.gestureTimers.shake = 0
          if (near) shakeOffWater(contact, WATER_WAYS.horse, h.ident.scale, h.x, h.z, groundHeight(h.x, h.z))
        }
      }
      // wet weather darkens and slicks the coat
      ;(m.coat.userData.coat as { uWet: { value: number } }).uWet.value = Math.min(1, Math.max(weatherRT.wetness * 0.9 + h.wade * 0.6, contact.wet * 0.85))
      const sinH = Math.sin(h.heading)
      const cosH = Math.cos(h.heading)
      const s = h.ident.scale
      p.ground = (x, z) => groundHeight(h.x + (cosH * x + sinH * z) * s, h.z + (-sinH * x + cosH * z) * s) / s - (h.y + h.jumpY) / s
      p.jump = h.jumpT
      p.air = h.jumpY / s
      h.animator.update(p, ridingAnchors(h))
      // a flying Pegasus pitches and banks about its centre of mass
      const pv = tiltPivot(h)
      mountQuaternion(h, _q)
      _p.set(0, -pv, 0).applyQuaternion(_q)
      // stepped every frame now, or this is a far step: glide onto it
      const g = glideTo(h.glide, h.x, h.z, h.heading, h.speed, h.turnRate, 0, period === 0, dt)
      h.rootOffset.set(_p.x, h.jumpY + pv + _p.y, _p.z)
      m.root.position.set(g.x + _p.x, (g.x === h.x && g.z === h.z ? h.y : groundHeight(g.x, g.z)) + h.rootOffset.y, g.z + _p.z)
      h.rootQuat.copy(_q)
      h.rootHeading = h.heading
      m.root.quaternion.copy(_q).premultiply(_yaw.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, g.heading - h.heading))
      m.root.updateMatrixWorld()
      if (m.featherUniforms && h.animator.wings && !flightQA.noFeatherFold) {
        const fu = m.featherUniforms
        fu.uFeatherA.value.set(h.animator.wings.featherA)
        fu.uFeatherFan.value.set(h.animator.wings.featherFan)
        fu.uFlex.value.set(h.animator.wings.flex)
        // Starborn's light in her feathers (horseAssets STARBORN_FEATHER_FRAGMENT):
        // her dash wakes it (brightest in its first moment), a launch and the
        // sails hold it, and each downstroke sends a pulse out along the shafts
        const sf = h.flight
        if (sf && h.ident.breed === "starborn") {
          const L = fu.uLight.value
          const up = sf.mode !== "ground"
          const power = up ? Math.min(1, (sf.boostT > 0 ? 0.65 + 0.35 * Math.exp(-sf.boostT * 2.5) : 0) + sf.launch * 0.6 + (sf.mode === "sail" ? 0.25 + 0.6 * sf.surge : 0)) : 0
          L.x += (power - L.x) * (1 - Math.exp(-dt * (power > L.x ? 12 : 2)))
          L.y = up ? ((sf.flap - 0.55 + 1) % 1) * 3.4 : 9
          L.z = sf.overdrive
          L.w = up ? 0.5 : 0.3
        }
      }
      // hair streams with motion; shader works in model space
      const hu = m.hair.userData.hair as { uFlow: { value: THREE.Vector3 }; uTime: { value: number }; uWind: { value: number } }
      // Hair is streamed out flat by about a gallop's airflow; faster changes
      // nothing more (under Starborn's sail the raw speed dragged the tail a
      // couple of hundred metres back). And it needs air: as the air thins
      // toward space (and on the Moon) it stops streaming and just drifts.
      const air = Math.min(1, (1 - spaceRT.thin) * 20)
      const stream = h.speed < 16 ? h.speed : 16 + 6 * Math.tanh((h.speed - 16) / 6)
      hu.uFlow.value.set(-Math.max(-4, Math.min(4, h.turnRate)) * 0.6 * air, -Math.min(Math.abs(h.accel), 30) * 0.04 * air, -stream * air)
      hu.uTime.value = time
      hu.uWind.value = weatherRT.wind + weatherRT.gust
      // hoofbeats
      if (near) for (const f of h.animator.footfalls) { horseSounds.hoof(h, f.strength, dist); horseRT.stats.footfalls++ }
      // turf, petals, snow or spray thrown back from each hoof at a canter or faster
      if (near && dist < 30 && h.speed > 6.5 && h.wade < 0.05 && (!h.flight || h.flight.mode === "ground") && spaceRT.realm === "earth") {
        const fx = Math.sin(h.heading), fz = Math.cos(h.heading)
        for (const f of h.animator.footfalls) {
          const front = f.leg < 2 ? 0.95 : -0.85
          const side = f.leg % 2 ? -0.22 : 0.22
          const x = h.x + (fx * front + fz * side) * h.ident.scale
          const z = h.z + (fz * front - fx * side) * h.ident.scale
          hoofTurf(x, groundHeight(x, z), z, h.heading, f.strength * Math.min(1, h.speed / 12), weatherRT.snowCover, weatherRT.wetness)
        }
      }
      if (h.landed) {
        if (near && h.wade < 0.05 && !h.flight && spaceRT.realm === "earth") jumpLanding(h.x, groundHeight(h.x, h.z), h.z, h.heading, weatherRT.snowCover, weatherRT.wetness)
        h.landed = false
        if (near) { horseSounds.hoof(h, 1, dist); horseSounds.hoof(h, 1, dist); horseSounds.snort(h, dist) }
      }
      // posed anchors to world for the rider and reins
      _m.compose(m.root.position, _q, _s.set(s, s, s))
      h.seatWorld.copy(h.animator.seat).applyMatrix4(_m)
      h.bitL.copy(h.animator.bitL).applyMatrix4(_m)
      h.bitR.copy(h.animator.bitR).applyMatrix4(_m)
      h.reinRest.copy(h.animator.reinRest).applyMatrix4(_m)
    }
    // ---- the active character's prompt, E, B and Y --------------------------
    const game = useGame.getState()
    const free = game.started && !worldRT.introActive && !worldRT.finaleActive && !game.activeMemoryId && !game.activeSecretId && !characterRT.switching
    const pat = takeAction("pat")
    if (takeAction("callHorse") && free) {
      const called = callHorse(characterRT.active)
      game.showHint(called ? `You whistle for ${called.ident.name}.` : "Your horse is right here.")
    }
    // Y: whistle for your own Pegasus, from anywhere in the world
    if (takeAction("callPegasus") && free) whistleForPegasus(characterRT.active, (t) => game.showHint(t))
    // I: Starborn comes to whoever calls, wherever she is (pegasus/starbornCall.ts)
    if (takeAction(STARBORN_ACTION) && free) callStarborn(characterRT.active, (t) => game.showHint(t))
    if (free) tickPendingStarborn((t) => game.showHint(t))
    else clearPendingStarborn()
    horseRT.prompt = free ? mountInteractions.wildlife?.(pat) ?? horseInteraction(pat) : null
    discoveryRT.horsePrompt = horseRT.prompt
    // ---- riding camera: a little higher and further back, settling in behind
    const rider = riderRT[characterRT.active]
    const mounted = rider.phase !== "none" ? 1 : 0
    cameraRT.mountedLift += (mounted * 0.75 - cameraRT.mountedLift) * (1 - Math.exp(-dt * 3))
    cameraRT.mountedDistance += (mounted * 2.4 - cameraRT.mountedDistance) * (1 - Math.exp(-dt * 2))
    // speed feel: wider FOV and a slightly higher view as the gait quickens,
    // a soft bob in time with the stride and a lean into turns (no blur)
    const rh = rider.phase === "riding" ? rider.horse : null
    const airborne = rh?.kind === "horse" && isAirborne(rh as HorseState)
    const comfort = flightReducedMotion()
    const fast = rh && !airborne ? Math.max(0, Math.min(1, (Math.abs(rh.speed) - rh.pose.speeds[1]) / (rh.pose.speeds[3] - rh.pose.speeds[1]))) : 0
    if (!airborne) cameraRT.fovBoost += ((comfort ? 0 : fast * 7) - cameraRT.fovBoost) * (1 - Math.exp(-dt * 2.2))
    const stride = rh?.animator ? rh.animator.stride : 0
    cameraRT.speedBob += ((rh && !airborne && !comfort ? Math.sin(stride * Math.PI * 2) * 0.035 * fast : 0) - cameraRT.speedBob) * (1 - Math.exp(-dt * 12))
    if (!airborne) cameraRT.speedRoll += ((rh && !comfort ? Math.max(-0.05, Math.min(0.05, -rh.turnRate * fast * 0.06)) : 0) - cameraRT.speedRoll) * (1 - Math.exp(-dt * 3))
    // (no screen-space speed lines: the feel of speed is the view widening and
    // bobbing above, and each mount's surge drawn in the world, GroundDashFX)
    if (!airborne && rider.phase === "riding" && rider.horse && rider.horse.speed > 1.2 && cameraAutoAllowed(1600)) {
      const behind = rider.horse.heading + Math.PI
      const d = Math.atan2(Math.sin(behind - cameraRT.targetYaw), Math.cos(behind - cameraRT.targetYaw))
      cameraRT.targetYaw += d * (1 - Math.exp(-dt * Math.min(2.2, 0.5 + rider.horse.speed * 0.18)))
    }
    flightCamera(state.camera as THREE.PerspectiveCamera, rider.phase === "riding" ? rider.horse : null, dt)
    horseRT.stats.rendered = rendered
    horseRT.stats.simulated = simulated
    horseRT.stats.ms = performance.now() - started
  }, -30)

  return (
    <>
      <primitive object={root} />
      <StarHillBeacon />
      <Reins />
      <RainLens />
    </>
  )
}
