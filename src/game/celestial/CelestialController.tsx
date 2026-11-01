import { activeFlightCourse } from "../navigation/flightCourse"
import { formatMeanRadiusAltitude, formatNavigationDistance } from "../navigation/navigationUnits"
import { useFrame } from "@react-three/fiber"
import { useExplorationUI } from "../../state/explorationUIStore"
import { useDiscoveries } from "../../state/discoveryStore"
import { useRef } from "react"
import * as THREE from "three"
import { characterRT, takeAction, worldRT } from "../runtime"
import { partnerLeftBehind, riderRT } from "../horses/riding"
import { startTakeoff } from "../pegasus/flight"
import { groundHeight } from "../world-layout"
import type { HorseState } from "../horses/horseState"
import { useGame } from "../../state/gameStore"
import { skyCommands, useSky } from "../../state/skyStore"
import { mountUniverse, sailRT } from "./starSail"
import { spaceRT } from "./spaceState"
import { bodyById, nearestBody } from "./universe"
import { formatRealDistance, EARTH_SCALE } from "./scale"
import { HAZARDS, hazardNearness, hazardOf } from "./hazards"
import { SITE_BY_ID } from "./realm/lunarSites"
import { rememberStudied, voyage } from "./voyageMemory"
import { CATS_TARGET, GATHER_RANGE, waitingInSpace } from "./spaceCats/journey"
import { spaceCatsRT } from "./spaceCats/catsRuntime"
import { observationJourney, observationPoint, observationReading, observationView } from "./observations"
import { useObservation, rememberObservation } from "../../state/observationStore"
import { crewNames } from "./spaceCats/crew"
import { HOME, useNavigation } from "../../state/navigationStore"
import { resetTravelState, dropOut, skipJourney, startJourney, travelling, travelRT, type TravelDestination } from "./cosmicTravel"
import { travelCommands, useTravel } from "../../state/travelStore"
import { input } from "../runtime"
import { DATUM_Y } from "./scale"
import { names } from "../../personalization"

/** The space cats as the chart and the panel name them. */
/** Bound for home: home becomes the destination, unless the explorer is following a
 * place of her own on Earth (a mark, a memory), which waits for her there. */
const headHome = (): void => {
  const nav = useNavigation.getState()
  if (nav.destination?.kind !== "earth") nav.choose(HOME)
}

export const catsTargetName = (): string => (voyage.cats === "unseen" ? "Five little lights" : "The space cats")

/**
 * The sky's game layer: reads the star-chart, travel and homeward commands
 * (M, N, K, or the sky panel's buttons) and keeps the sky panel's readout
 * current. Only the star-born can answer them.
 */

const _u = new THREE.Vector3()
const observationGoal = new THREE.Vector3()
let observationTimer = 0

/** The Pegasus the active character is riding, if it is the star-born. */
export const ridingCelestial = (): HorseState | null => {
  const r = riderRT[characterRT.active]
  const h = r.phase === "riding" ? (r.horse as HorseState | null) : null
  return h?.flight?.spec.celestial ? h : null
}

const formatSpeed = (mps: number): string => {
  const kms = (mps * EARTH_SCALE) / 1000
  const c = kms / 299_792.458
  if (c > 0.5) return `${c < 10 ? c.toFixed(1) : Math.round(c).toLocaleString()} × light speed`
  if (kms >= 1) return `${kms < 100 ? kms.toFixed(1) : Math.round(kms).toLocaleString()} km/s`
  return `${Math.round(kms * 3600).toLocaleString()} km/h`
}

/** Height over the ground close to it, in the life-size metres you stand in. */
const formatGround = (m: number): string => (m < 1000 ? `${Math.max(0, Math.round(m))} m` : formatRealDistance(m))


export const CelestialController = (): null => {
  const timer = useRef(0)
  const waiting = useRef(false)
  useFrame((_, dt) => {
    // a journey asked for just as a rescue began must not start by itself later
    if (worldRT.relocating) travelCommands.go = null
    if (worldRT.relocating || useExplorationUI.getState().panel === "controls") return
    const h = ridingCelestial()
    // the one Pegasus whose sailing carries the view (starSail.ts)
    sailRT.pilot = h
    const hint = useGame.getState().showHint
    const sky = useSky.getState()

    if (skyCommands.cancel) {
      skyCommands.cancel = false
      sailRT.autopilot = null
      spaceRT.target = null
      hint("You take the reins again.")
    }
    const ensure = skyCommands.ensure
    skyCommands.ensure = false
    // ---- cosmic travel: Direct to Planets, the return to Earth ------------------
    const travel0 = useTravel.getState()
    const begin = (dest: TravelDestination, style: "cinematic" | "quick"): void => {
      const left = h ? partnerLeftBehind(h) : null
      if (left) { hint(`Wait for ${left} — nobody is left behind.`); return }
      const turning = travelling()
      const why = startJourney(h, dest, style)
      if (why) hint(why)
      else if (turning) {
        travel0.setPicker(false)
        if (dest.kind === "body") useNavigation.getState().choose({ kind: "body", id: dest.id, name: bodyById(dest.id)?.def.name ?? dest.id })
        else if (dest.kind === "earth") headHome()
        hint(`${names.starborn} turns her run toward ${travelRT.name}.`)
      }
      else {
        travel0.setPicker(false)
        sky.setChart(false)
        if (dest.kind === "body") useNavigation.getState().choose({ kind: "body", id: dest.id, name: bodyById(dest.id)?.def.name ?? dest.id })
        else if (dest.kind === "earth") headHome()
        hint(style === "quick" ? `${travelRT.name} — in a heartbeat.` : dest.kind === "earth"
          ? `${names.starborn} turns for home. E to arrive now · Space to pull out early.`
          : `${names.starborn} gathers her starlight for ${travelRT.name}. E to arrive now · Esc to stop.`)
      }
    }
    if (travelCommands.go) {
      const go = travelCommands.go
      travelCommands.go = null
      begin(go.dest, go.style)
    }
    if (takeAction("planets")) travel0.setPicker(!travel0.pickerOpen)
    const inSpace = spaceRT.mode === "deep" || spaceRT.realm !== "earth" || (!!h && h.y - DATUM_Y > 2_000)
    if (takeAction("returnEarth")) begin({ kind: "earth" }, "cinematic")
    if (takeAction("quickReturn")) begin({ kind: "earth" }, "quick")
    if (travelCommands.skip) { travelCommands.skip = false; skipJourney() }
    if (travelling()) {
      if (input.cancel || travelCommands.drop) {
        input.cancel = false
        if (h) dropOut(h)
        hint("You take the reins again.")
      }
      travelCommands.drop = false
      // a journey owns the course: no chart, no autopilot underneath it
      if (!h) {
        resetTravelState()
        skyCommands.cancel = false
        skyCommands.ensure = false
        skyCommands.observation = null
        skyCommands.target = null
        skyCommands.site = null
        skyCommands.travel = false
        skyCommands.home = false
        travelCommands.go = null
        travelCommands.skip = false
        travelCommands.drop = false
      }
    }
    travelCommands.drop = false
    if (travelling()) {
      // The corridor owns the course. Consume conflicting requests rather
      // than leaving an invisible autopilot waiting underneath the journey.
      takeAction("starChart")
      takeAction("travel")
      takeAction("homeward")
      skyCommands.observation = null
      skyCommands.target = null
      skyCommands.site = null
      skyCommands.travel = false
      skyCommands.home = false
      sailRT.autopilot = null
    }
    if (travelRT.arrived) {
      const what = travelRT.arrived
      travelRT.arrived = null
      if (what === "earth") hint("Home's sky. Fly wherever you like — dash, dive to the sea, or E to land.")
      else if (what === "rings") hint(`Saturn's rings: life-size ice all round you. W to drift on, Space/C to rise or sink through the ice; ${names.starborn}'s light parts it before you.`)
      else if (what.startsWith("body:")) hint(`${travelRT.name}. Look around — Space/C to climb or dive, N for another world, K for home.`)
    }
    // ---- commands -----------------------------------------------------------
    // M: the star chart beyond the sky, the World map on Earth
    if (takeAction("starChart")) {
      const beyond = spaceRT.mode === "deep" || spaceRT.realm !== "earth" || h?.flight?.mode === "sail"
      if (h && beyond) sky.setChart(!sky.chartOpen)
      else if (spaceRT.realm === "earth" && spaceRT.mode !== "deep") useExplorationUI.getState().open("atlas")
      else hint(`Only ${names.starborn}, the star-born, sails the stars. Call her with I, then press M.`)
    }
    if (skyCommands.observation) {
      const command = skyCommands.observation
      skyCommands.observation = null
      const journey = observationJourney(command.journey)
      if (!h) hint(`${names.starborn} carries these journeys beyond the sky.`)
      else if (journey && Number.isInteger(command.stop) && command.stop >= 0 && command.stop < journey.stops.length) {
        spaceRT.target = journey.body
        sailRT.autopilot = { kind: "observation", journey: journey.id, stop: command.stop }
        sailRT.arrived = null
        useNavigation.getState().choose({ kind: "body", id: journey.body, name: bodyById(journey.body)?.def.name ?? journey.body })
        hint(`${names.starborn} finds a quiet viewpoint. Steer any time to take the reins.`)
      }
    }
    if (skyCommands.target !== null) {
      spaceRT.target = skyCommands.target
      skyCommands.target = null
    }
    // a place on the Moon chosen on the chart: straight there (it is on the Moon, so the Moon is the destination)
    if (skyCommands.site !== null) {
      const site = SITE_BY_ID.get(skyCommands.site)
      skyCommands.site = null
      skyCommands.travel = false
      if (!h) hint(`Only ${names.starborn} can sail to the Moon.`)
      else if (site) {
        spaceRT.target = "moon"
        sailRT.autopilot = { kind: "site", id: site.id }
        sailRT.arrived = null
        useNavigation.getState().choose({ kind: "site", id: site.id, name: site.title })
        hint(`${names.starborn} sets her sails for ${site.name}. Steer to take over.`)
      }
    }
    const travel = takeAction("travel") || skyCommands.travel
    skyCommands.travel = false
    if (travel) {
      if (!h || !spaceRT.target) travel0.setPicker(true)
      else if (!ensure && ((sailRT.autopilot?.kind === "target" && sailRT.autopilot.id === spaceRT.target) || (sailRT.autopilot?.kind === "cats" && spaceRT.target === CATS_TARGET))) {
        sailRT.autopilot = null
        hint("You take the reins again.")
      } else if (spaceRT.target === CATS_TARGET) {
        if (!waitingInSpace(voyage)) { spaceRT.target = null; hint("The space cats aren't out there any more.") }
        else {
          sailRT.autopilot = { kind: "cats" }
          sailRT.arrived = null
          useNavigation.getState().choose({ kind: "cats", id: "space-cats", name: catsTargetName() })
          hint(`${names.starborn} sets her sails for ${voyage.cats === "unseen" ? "the five little lights" : "the space cats"} at the L1 point.`)
        }
      } else {
        sailRT.autopilot = { kind: "target", id: spaceRT.target }
        sailRT.arrived = null
        useNavigation.getState().choose({ kind: "body", id: spaceRT.target, name: bodyById(spaceRT.target)?.def.name ?? "The stars" })
        hint(`${names.starborn} sets her sails for ${bodyById(spaceRT.target)?.def.name ?? "the stars"}. Steer any time to take over.`)
      }
    }
    const home = takeAction("homeward") || skyCommands.home
    skyCommands.home = false
    if (home) {
      if (!h) hint(`Homeward is ${names.starborn}'s: she always knows the way back. Press I to call her.`)
      // out in space, homeward is the journey back to Earth
      else if (inSpace && !travelling()) begin({ kind: "earth" }, "cinematic")
      else if (sailRT.autopilot?.kind === "home" && !ensure) { sailRT.autopilot = null; hint("You take the reins again.") }
      else {
        sailRT.autopilot = { kind: "home" }
        sailRT.arrived = null
        headHome()
        sky.setChart(false)
        hint(`Homeward — ${names.starborn} turns toward Earth and home.`)
      }
    }
    if (sailRT.arrived) {
      const what = sailRT.arrived
      sailRT.arrived = null
      if (what === "home") {
        // over home: down through the air (the wings take over and land)
      } else if (what === "cats") {
        hint(voyage.cats === "unseen" ? "Right beside the lights — look!" : `Alongside ${crewNames()}. Press O to bring them home.`)
      } else if (what.startsWith("site:")) {
        const site = SITE_BY_ID.get(what.slice(5))
        if (site) hint(`Below you: ${site.name}. Press E (or Land) to set down beside it.`)
      } else if (what === "moon") {
        hint("The Moon. Come down low and press E to land.")
      } else {
        const b = bodyById(what)
        // a fact is a little story: it goes in a card that wraps, not the one-line hint
        if (b) useDiscoveries.getState().showToast({ title: b.def.name, line: b.def.fact, kind: "sky" })
      }
    }
    if (!h && sailRT.autopilot) sailRT.autopilot = null
    // a course set while standing on the Moon: up off the dust first
    if (h && sailRT.autopilot && h.flight?.mode === "ground" && spaceRT.realm !== "earth") {
      const left = partnerLeftBehind(h)
      if (left) {
        if (!waiting.current) hint(`Wait for ${left} — nobody is left behind on the Moon.`)
        waiting.current = true
      } else {
        waiting.current = false
        startTakeoff(h)
      }
    }

    // An intentional observation earns a saved memory only at the actual
    // viewpoint, while station keeping, with a continuous player hold.
    observationView.body = null
    const observation = useObservation.getState()
    const journey = observation.journey ? observationJourney(observation.journey) : undefined
    if (journey && h) {
      const body = bodyById(journey.body), sun = bodyById("sun")
      if (body && sun) {
        observationPoint(journey, observation.stop, body, sun, observationGoal)
        mountUniverse(h, _u)
        const holdingStation = sailRT.autopilot?.kind === "observation" && sailRT.autopilot.journey === journey.id && sailRT.autopilot.stop === observation.stop
        const ready = holdingStation && _u.distanceTo(observationGoal) <= Math.max(30, body.radius * 0.015) * 1.3 && h.speed < Math.max(2, body.radius * 0.001)
        observationView.body = ready ? journey.body : null
        const progress = observation.completed ? 1 : ready && observation.holding && !document.hidden ? Math.min(1, observation.progress + Math.min(dt, 0.1) / 4) : 0
        observationTimer -= dt
        if (ready !== observation.ready || observationTimer <= 0 || progress >= 1) {
          observationTimer = 0.1
          const reading = observationReading(journey, body, sun, _u)
          const text = journey.kind === "phase" ? `${Math.round(reading.value)}% ${reading.label}` : `${Math.abs(reading.value).toFixed(1)}° ${reading.value < 0 ? "below" : "above"} the ring plane`
          useObservation.setState({ ready, progress, reading: text, completed: observation.completed || progress >= 1 })
          if (progress >= 1 && !observation.completed) {
            const fresh = rememberObservation(journey.id, observation.stop)
            useDiscoveries.getState().showToast({ title: fresh ? "A new way of seeing" : "A lovely view, again", line: journey.stops[observation.stop].line, kind: "sky" })
          }
        } else if (progress !== observation.progress) useObservation.setState({ progress })
      }
    } else if (journey && (observation.ready || observation.progress > 0 || observation.holding)) {
      useObservation.setState({ ready: false, progress: 0, holding: false })
    }
    // ---- readout (4 Hz) -----------------------------------------------------
    timer.current -= dt
    if (timer.current > 0) return
    timer.current = 0.25
    useTravel.getState().setJourney({ phase: travelRT.phase, name: travelRT.name, progress: travelRT.progress, style: travelRT.style })
    const f = h?.flight ?? null
    const high = !!h && !!f && f.mode !== "ground" && (f.mode === "sail" || spaceRT.skyAltitude > 160 || spaceRT.realm !== "earth")
    if (!high || !h) {
      sky.setHazard(null)
      sky.setReadout({ high: false, sailing: false, nearest: "", altitude: "", speed: "", target: spaceRT.target ? (spaceRT.target === CATS_TARGET ? catsTargetName() : bodyById(spaceRT.target)?.def.name ?? null) : null, targetDistance: null, eta: null, autopilot: null, notice: null, cats: null, gather: false })
      return
    }
    mountUniverse(h, _u)
    const near = nearestBody(_u)
    // a world drawing near that cannot be landed on: its conditions, and why not
    const nearness = hazardNearness(near.body, near.altitude)
    if (nearness > 0.15 && HAZARDS[near.body.def.id]) {
      const hz = hazardOf(near.body.def.id)
      const level = nearness > 0.97 ? "floor" : nearness > 0.6 ? "close" : "near"
      sky.setHazard({ id: near.body.def.id, name: near.body.def.name, summary: hz.summary, facts: hz.facts, level, source: hz.source })
      if (rememberStudied(near.body.def.id)) hint(`${near.body.def.name}: ${hz.summary.toLowerCase()}. ${names.starborn} will not land here.`)
    } else sky.setHazard(null)
    let targetDistance: string | null = null
    const eta = null
    const t = spaceRT.target ? bodyById(spaceRT.target) : null
    let targetName = t?.def.name ?? null
    if (spaceRT.target === CATS_TARGET && spaceCatsRT.podReady) {
      targetName = catsTargetName()
      targetDistance = `${formatNavigationDistance(_u.distanceTo(spaceCatsRT.pod))} to signal`
    }
    if (t) {
      targetDistance = formatMeanRadiusAltitude(_u.distanceTo(t.pos) - t.radius)
    }
    const course = activeFlightCourse(h)
    if (course) { targetName = course.name; targetDistance = course.holding ? "Holding viewpoint" : `${formatNavigationDistance(course.distance)} to waypoint` }
    sky.setReadout({
      high: true,
      sailing: f!.mode === "sail",
      nearest: near.body.def.name,
      // over the Moon's ground: the real height over the dust below, not over its mean radius
      altitude: spaceRT.realm !== "earth" && spaceRT.mode === "local" ? formatGround(h.y - groundHeight(h.x, h.z)) : formatRealDistance(Math.max(0, near.altitude)),
      speed: formatSpeed(h.speed),
      target: targetName,
      targetDistance,
      eta,
      autopilot: sailRT.autopilot?.kind ?? null,
      notice: sailRT.noticeT > 0 ? sailRT.notice : null,
      cats: spaceCatsRT.phase === "waiting" && spaceCatsRT.mountDistance < 400 && voyage.cats === "met"
        ? spaceCatsRT.canGather ? `${crewNames()} are right beside you.` : `The space cats · ${Math.round(spaceCatsRT.mountDistance)} m — come within ${GATHER_RANGE} m`
        : spaceCatsRT.phase === "escort" ? "The space cats are with you · take them home (K)" : null,
      gather: spaceCatsRT.canGather,
    })
  })
  return null
}
