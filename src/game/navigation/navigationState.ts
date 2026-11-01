import * as THREE from "three"
import { isMark, type Destination } from "../../state/navigationStore"
import { groundHeight } from "../world-layout"
import { ridingCelestial } from "../celestial/CelestialController"
import { bodyById, nearestBody, universe, GAME_TO_ECEF } from "../celestial/universe"
import { spaceRT } from "../celestial/spaceState"
import { DATUM_Y } from "../celestial/scale"
import { earthFrame, localToUniverse, universeToLocal } from "../celestial/frames"
import { activeFlightCourse } from "./flightCourse"
import { celestialMarkers, companionMarkers, earthMarkers, navigatorActor, navigatorAxes, navigatorPosition } from "./atlasSnapshot"
import { compassPoint, formatBearing, groundArrived, groundBearing, groundDistance, normalizedDegrees, skyPoint } from "./atlasMath"
import { MARK_COLOUR } from "./markPlace"
import { formatNavigationDistance, skyRangeLabel } from "./navigationUnits"
import { names } from "../../personalization"

const earthNorth = new THREE.Vector3(0, 0, 1).applyMatrix3(GAME_TO_ECEF.clone().transpose()).normalize()
const toLocal = new THREE.Quaternion(), position = new THREE.Vector3(), direction = new THREE.Vector3()
export const navigationSnapshot = (destination: Destination | null, range: number) => {
  const actor = navigatorActor()
  const flight = activeFlightCourse(ridingCelestial())
  const sky = spaceRT.mode === "deep" || spaceRT.realm !== "earth" || actor.y - DATUM_Y > 600 || !!flight && !flight.landing
  const heading = groundBearing(Math.sin(actor.heading), Math.cos(actor.heading))
  navigatorPosition(position); navigatorAxes(toLocal).invert()
  // Surface compasses follow the actual surface frame; out in open space the
  // nearest body's pole is the reference, regardless of the realm left behind.
  const reference = sky ? spaceRT.mode === "local" ? bodyById(spaceRT.realm) : universe.bodies.length ? nearestBody(position).body : null : null
  if (reference) direction.copy(reference.def.id === "earth" ? earthNorth : reference.pole).applyQuaternion(toLocal)
  const north = reference ? Math.hypot(direction.x, direction.z) > 1e-7 ? groundBearing(direction.x, direction.z) : null : sky ? null : 0
  const facing = north === null ? null : normalizedDegrees(heading - north)
  const stars = sky ? celestialMarkers() : []
  let target = stars.find(m => destination && m.destination.kind === destination.kind && m.destination.id === destination.id)
  if (sky && destination?.kind === "earth") {
    localToUniverse(earthFrame(), destination.x, groundHeight(destination.x, destination.z), destination.z, direction)
    direction.sub(position).applyQuaternion(toLocal)
    const p = skyPoint(direction.x, direction.y, direction.z, Math.max(direction.length(), ...stars.map(m => m.distance)))
    target = { ...p, destination, color: isMark(destination) ? MARK_COLOUR : "#c9ded4", surfaceDistance: p.distance, meanAltitude: p.distance }
    stars.push(target)
  }
  const altitude = actor.y - groundHeight(actor.x, actor.z)
  const ground = !sky && destination?.kind === "earth" ? destination : null
  const horizontal = ground ? Math.hypot(ground.x - actor.x, ground.z - actor.z) : null
  // a mark can sit on rough ground no one stands exactly on: a few strides of it is there
  const arrived = horizontal !== null && groundArrived(isMark(ground) ? Math.max(0, horizontal - 6) : horizontal, actor.y - groundHeight(actor.x, actor.z), actor.airborne)
  const overhead = !arrived && horizontal !== null && horizontal < 14 && actor.airborne
  let bearing: number | null = ground && horizontal! >= 0.1 ? groundBearing(ground.x - actor.x, ground.z - actor.z) : null
  let elevation: number | null = null, projection: ReturnType<typeof skyPoint> | null = null
  let courseEarth: { x: number; z: number } | null = null
  if (flight && !sky) {
    universeToLocal(earthFrame(), flight.point, direction)
    courseEarth = { x: direction.x, z: direction.z }
    bearing = Math.hypot(direction.x - actor.x, direction.z - actor.z) < 0.1 ? null : groundBearing(direction.x - actor.x, direction.z - actor.z)
  }
  if (flight && sky) {
    direction.copy(flight.point).sub(position).applyQuaternion(toLocal)
    projection = skyPoint(direction.x, direction.y, direction.z, Math.max(1, ...stars.map(m => m.distance), flight.distance))
    bearing = projection.vertical || projection.coincident ? null : groundBearing(direction.x, direction.z)
    elevation = projection.elevation
  } else if (target) {
    projection = target; bearing = target.vertical || target.coincident ? null : groundBearing(target.x - 100, target.y - 100); elevation = target.elevation
  }
  const unavailable = !!destination && sky && !target && !flight
  const name = flight?.name ?? destination?.name ?? (sky ? reference?.def.name ?? "The sky" : "This world")
  const bearingText = bearing !== null && north !== null ? `${compassPoint(bearing - north)} ${formatBearing(bearing - north)}` : null
  const distance = flight ? sky ? formatNavigationDistance(flight.distance) : groundDistance(flight.distance) : horizontal !== null ? groundDistance(horizontal) : target ? formatNavigationDistance(target.destination.kind === "body" ? target.meanAltitude : target.distance) : null
  const detail = flight ? `${flight.stage}${flight.holding ? "" : ` · ${distance} to waypoint`}` : arrived ? `Within ${isMark(ground) ? 10 : 4} m · on the ground` : ground ? `${distance} horizontal${actor.airborne ? " · airborne" : ""}` : target ? skyRangeLabel(target) : destination ? destination.kind === "earth" ? sky ? `${isMark(destination) ? "Your mark on Earth" : "Earth landmark"} · return to Earth, then follow it` : "Earth landmark" : `Sky destination · travel with ${names.starborn}` : "Choose a destination"
  const directionText = arrived && !flight ? "Arrived" : overhead && !flight ? "Just below you · land to arrive" : flight?.holding ? "Holding viewpoint"
    : projection?.coincident ? "At destination" : projection?.vertical ? elevation! > 0 ? "Directly above" : "Directly below"
    : bearingText ? `${bearingText}${elevation !== null ? ` · ${elevation > 0 ? "+" : ""}${elevation.toFixed(1)}°` : ""}` : null
  return { ...actor, sky, heading, north, facing, reference: reference?.def.name ?? "World grid", stars,
    courseEarth, earth: sky ? [] : earthMarkers(actor.x, actor.z, range), companions: sky ? [] : companionMarkers(), altitude, flight, target, ground, horizontal, arrived, bearing, bearingText, directionText, elevation, projection, unavailable, name, distance, detail }
}
