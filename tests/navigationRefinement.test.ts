import * as THREE from "three"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { makeIdentity } from "../src/game/horses/breeds"
import { makeHorseState, type HorseState } from "../src/game/horses/horseState"
import { homeLanding, riderRT } from "../src/game/horses/riding"
import { flightOf } from "../src/game/pegasus/flight"
import { characterRT, companionRT, playerRT } from "../src/game/runtime"
import { groundHeight } from "../src/game/world-layout"
import { earthFrame, localAxes, localToUniverse } from "../src/game/celestial/frames"
import { observationJourney, observationPoint } from "../src/game/celestial/observations"
import { DATUM_Y, EARTH_SCALE, SAIL_ALTITUDE } from "../src/game/celestial/scale"
import { spaceRT } from "../src/game/celestial/spaceState"
import { activeFlightCourse, flightCourseName } from "../src/game/navigation/flightCourse"
import { mountUniverse, sailRT } from "../src/game/celestial/starSail"
import { bodyById, GAME_TO_ECEF, updateUniverse } from "../src/game/celestial/universe"
import { navigatorActor, navigatorPosition } from "../src/game/navigation/atlasSnapshot"
import { formatBearing, groundArrived, groundBearing, mapPoint, rotateMapPoint, unmapPoint } from "../src/game/navigation/atlasMath"
import { navigationSnapshot } from "../src/game/navigation/navigationState"
import { formatMeanRadiusAltitude, formatNavigationDistance } from "../src/game/navigation/navigationUnits"
import { atlasWaterAt, rasterTerrain } from "../src/game/navigation/terrainAtlas"
import { HOME, type Destination } from "../src/state/navigationStore"
import { useObservation } from "../src/state/observationStore"
import { POND } from "../src/world/hubLayout"
import { originRT } from "../src/world/origin"

const starborn = (): HorseState => {
  const horse = makeHorseState(makeIdentity(9907, "starborn", { saddled: true }), -36, -24, true)
  horse.y = groundHeight(horse.x, horse.z)
  horse.heading = 0.3
  flightOf(horse)
  return horse
}
const ride = (horse: HorseState, id: "explorer" | "companion" = "explorer"): void => {
  characterRT.active = id
  riderRT[id].phase = "riding"
  riderRT[id].horse = horse
  horse.rider = id
}

describe("heading-up navigation geometry", () => {
  it("puts the direction of travel at the top and round-trips pins through every heading at large logical coordinates", () => {
    for (const [cx, cz] of [[0, 0], [-90_000_000.25, 80_000_000.5]]) {
      for (const heading of [0, 45, 90, 180, 270, 359]) for (const range of [70, 180, 1400]) {
        const angle = heading * Math.PI / 180
        const forward = mapPoint(cx + Math.sin(angle) * range, cz - Math.cos(angle) * range, cx, cz, range, 82, heading)
        expect(forward.x).toBeCloseTo(100, 6)
        expect(forward.y).toBeCloseTo(18, 6)
        for (const [dx, dz] of [[0, 0], [0.125, -0.75], [-1, 1], [1, 0]]) {
          const x = cx + dx * range, z = cz + dz * range
          const drawn = mapPoint(x, z, cx, cz, range, 82, heading)
          const restored = unmapPoint(drawn.x, drawn.y, cx, cz, range, 82, heading)
          expect(restored.x).toBeCloseTo(x, 6)
          expect(restored.z).toBeCloseTo(z, 6)
        }
      }
    }
    expect(rotateMapPoint(100, 100, 123)).toEqual({ x: 100, y: 100 })
    expect(rotateMapPoint(182, 100, 90).x).toBeCloseTo(100, 10)
    expect(rotateMapPoint(182, 100, 90).y).toBeCloseTo(18, 10)
  })

  it("wraps rounded bearings without displaying a nonexistent 360 degree compass direction", () => {
    for (const [degrees, label] of [[0, "000°"], [90, "090°"], [-90, "270°"], [359.6, "000°"], [-0.4, "000°"], [719.6, "000°"]] as const) {
      expect(formatBearing(degrees)).toBe(label)
    }
  })

  it("requires horizontal proximity, surface proximity and grounded movement before claiming arrival", () => {
    expect(groundArrived(2, 0.5, false)).toBe(true)
    for (const [distance, altitude, airborne] of [[4, 0, false], [0, 3, false], [0, -3, false], [0, 0, true], [0, 900, true]] as const) {
      expect(groundArrived(distance, altitude, airborne)).toBe(false)
    }
  })
})

describe("precise navigation distance labels", () => {
  it("uses real metres for close waypoints and never rounds a positive separation down to zero", () => {
    expect(formatNavigationDistance(0)).toBe("0 m")
    expect(formatNavigationDistance(0.01 / EARTH_SCALE)).toBe("<0.1 m")
    expect(formatNavigationDistance(0.2)).toBe("13 m")
    expect(formatNavigationDistance(1000 / EARTH_SCALE)).toBe("1.0 km")
  })

  it("preserves the sign of altitude relative to the mean radius without implying local terrain clearance", () => {
    expect(formatMeanRadiusAltitude(0)).toBe("At mean radius")
    expect(formatMeanRadiusAltitude(0.2)).toBe("13 m above mean radius")
    expect(formatMeanRadiusAltitude(-0.2)).toBe("13 m below mean radius")
    expect(formatMeanRadiusAltitude(-0.01 / EARTH_SCALE)).toBe("<0.1 m below mean radius")
  })
})

describe("live course and mounted navigation snapshots", () => {
  const original = {
    active: characterRT.active,
    player: { pos: playerRT.pos.clone(), facing: playerRT.facing, jumpHeight: playerRT.jumpHeight },
    partner: { pos: companionRT.pos.clone(), facing: companionRT.facing, jumpHeight: companionRT.jumpHeight },
    riders: { explorer: { phase: riderRT.explorer.phase, horse: riderRT.explorer.horse }, companion: { phase: riderRT.companion.phase, horse: riderRT.companion.horse } },
    mode: spaceRT.mode, realm: spaceRT.realm, frame: spaceRT.frame, pos: spaceRT.pos.clone(), park: spaceRT.park.clone(),
    autopilot: sailRT.autopilot, pilot: sailRT.pilot, origin: { ...originRT }, observation: useObservation.getState(),
  }
  beforeEach(() => {
    characterRT.active = "explorer"
    for (const id of ["explorer", "companion"] as const) { riderRT[id].phase = "none"; riderRT[id].horse = null }
    playerRT.pos.set(0, groundHeight(0, 22.5), 22.5); playerRT.facing = 0; playerRT.jumpHeight = 0
    companionRT.pos.set(-1000, 45, 2000); companionRT.jumpHeight = 0
    spaceRT.mode = "local"; spaceRT.realm = "earth"; spaceRT.frame = earthFrame(); spaceRT.park.identity()
    sailRT.autopilot = null; sailRT.pilot = null
    useObservation.getState().close()
    updateUniverse(0.37, new Date("2026-10-20T12:00:00Z"))
  })
  afterEach(() => {
    characterRT.active = original.active
    for (const [body, state] of [[playerRT, original.player], [companionRT, original.partner]] as const) {
      body.pos.copy(state.pos); body.facing = state.facing; body.jumpHeight = state.jumpHeight
    }
    Object.assign(riderRT.explorer, original.riders.explorer); Object.assign(riderRT.companion, original.riders.companion)
    spaceRT.mode = original.mode; spaceRT.realm = original.realm; spaceRT.frame = original.frame
    spaceRT.pos.copy(original.pos); spaceRT.park.copy(original.park)
    sailRT.autopilot = original.autopilot; sailRT.pilot = original.pilot
    Object.assign(originRT, original.origin)
    useObservation.setState(original.observation)
  })

  it("reports the actual Saturn approach while Mars remains the selected browsing destination", () => {
    const horse = starborn(); ride(horse); horse.flight!.mode = "sail"
    spaceRT.mode = "deep"; spaceRT.pos.set(1e8, 3e7, -4e8)
    sailRT.autopilot = { kind: "target", id: "saturn" }
    const selected: Destination = { kind: "body", id: "mars", name: "Mars" }
    const saturn = bodyById("saturn")!, view = navigationSnapshot(selected, 180)
    expect(view.name).toBe("Saturn")
    expect(view.target?.destination.id).toBe("mars")
    expect(view.flight).toMatchObject({ kind: "target", name: "Saturn", stage: "Safe approach waypoint" })
    expect(view.flight!.point.distanceTo(saturn.pos) / saturn.radius).toBeCloseTo(2.6, 7)
    expect(view.flight!.distance).toBeCloseTo(view.flight!.point.distanceTo(spaceRT.pos), 5)
    const delta = view.flight!.point.clone().sub(spaceRT.pos)
    expect(view.bearing).toBeCloseTo(groundBearing(delta.x, delta.z), 7)
    expect(view.directionText).toBe(`${view.bearingText} · ${view.elevation! > 0 ? "+" : ""}${view.elevation!.toFixed(1)}°`)
    expect(flightCourseName(sailRT.autopilot)).toBe("Saturn")
  })

  it("reports signed mean-radius altitude inside the actual Moon while retaining the compatible clamped surface distance", () => {
    const moon = bodyById("moon")!, radial = new THREE.Vector3(0.3, 0.9, -0.2).normalize()
    const destination: Destination = { kind: "body", id: "moon", name: "The Moon" }
    spaceRT.mode = "deep"
    spaceRT.pos.copy(moon.pos).addScaledVector(radial, moon.radius - 3)
    const inside = navigationSnapshot(destination, 180)
    expect(inside.flight).toBeNull()
    expect(inside.target!.meanAltitude).toBeCloseTo(-3, 7)
    expect(inside.target!.surfaceDistance).toBe(0)
    expect(inside.detail).toContain("below mean radius")
    expect(inside.distance).toBe("191 m")

    spaceRT.pos.copy(moon.pos).addScaledVector(radial, moon.radius + 3)
    const outside = navigationSnapshot(destination, 180)
    expect(outside.target!.meanAltitude).toBeCloseTo(3, 7)
    expect(outside.target!.surfaceDistance).toBeCloseTo(3, 7)
    expect(outside.detail).toContain("above mean radius")
  })

  it("uses the celestial radar, horizon and distance scale for a course started before takeoff", () => {
    const horse = starborn(); ride(horse)
    horse.flight!.mode = "ground"
    sailRT.autopilot = { kind: "target", id: "saturn" }
    const view = navigationSnapshot({ kind: "body", id: "saturn", name: "Saturn" }, 70)
    expect(spaceRT.mode).toBe("local")
    expect(horse.y - DATUM_Y).toBeLessThan(600)
    expect(view.sky).toBe(true)
    expect(view.distance).toBe(formatNavigationDistance(view.flight!.distance))
    expect(view.detail).toContain("AU to waypoint")
    expect(view.projection).not.toBeNull()
    expect(view.courseEarth).toBeNull()
    expect(view.ground).toBeNull()
    // The safe meadow landing still returns to the life-size ground map.
    sailRT.autopilot = { kind: "home" }
    const home = navigationSnapshot(HOME, 70)
    expect(home.flight!.landing).toBe(true)
    expect(home.sky).toBe(false)
    expect(home.detail).toContain("Safe meadow landing")
  })

  it("projects the exact observation viewpoint, owns its returned point and marks holding only for the matching ready stop", () => {
    const horse = starborn(); ride(horse); horse.flight!.mode = "sail"
    spaceRT.mode = "deep"; spaceRT.pos.set(1e8, 3e7, -4e8)
    sailRT.autopilot = { kind: "observation", journey: "moonlight", stop: 1 }
    const journey = observationJourney("moonlight")!, moon = bodyById("moon")!, sun = bodyById("sun")!
    const expected = observationPoint(journey, 1, moon, sun, new THREE.Vector3())
    useObservation.setState({ journey: "moonlight", stop: 1, ready: true })
    const course = activeFlightCourse(horse)!
    expect(course.name).toBe(journey.stops[1].title)
    expect(course.point.distanceTo(expected)).toBeLessThan(1e-7)
    expect(course.point.distanceTo(moon.pos)).toBeGreaterThan(moon.radius * 2.9)
    expect(course).toMatchObject({ holding: true, stage: "Holding viewpoint" })
    const snapshot = navigationSnapshot({ kind: "body", id: "moon", name: "The Moon" }, 180)
    expect(snapshot.flight!.point.distanceTo(expected)).toBeLessThan(1e-7)
    useObservation.setState({ stop: 2 })
    expect(activeFlightCourse(horse)!.holding).toBe(false)
    sailRT.autopilot = { kind: "target", id: "mars" }
    activeFlightCourse(horse)
    expect(course.point.distanceTo(expected)).toBeLessThan(1e-7)
  })

  it("distinguishes Homeward's upper-air waypoint from its actual safe meadow landing", () => {
    const horse = starborn(); ride(horse); horse.flight!.mode = "sail"
    sailRT.autopilot = { kind: "home" }
    horse.y = DATUM_Y + 2000
    const approach = activeFlightCourse(horse)!
    const upperAir = localToUniverse(earthFrame(), 0, DATUM_Y + SAIL_ALTITUDE + 250, 0, new THREE.Vector3())
    expect(approach.stage).toBe("Upper-air approach")
    expect(approach.point.distanceTo(upperAir)).toBeLessThan(1e-7)
    horse.flight!.mode = "landing"
    horse.y = groundHeight(horse.x, horse.z) + 10
    const spot = homeLanding(), ground = localToUniverse(earthFrame(), spot.x, groundHeight(spot.x, spot.z), spot.z, new THREE.Vector3())
    const landing = activeFlightCourse(horse)!
    expect(landing).toMatchObject({ name: "Homeward", stage: "Safe meadow landing" })
    expect(landing.point.distanceTo(ground)).toBeLessThan(1e-7)
    expect(landing.point.distanceTo(approach.point)).toBeGreaterThan(1000)
    expect(landing.distance).toBeCloseTo(ground.distanceTo(mountUniverse(horse, new THREE.Vector3())), 8)
  })

  it("uses the active rider's actual mount location, heading and airborne state instead of their seated avatar offset", () => {
    const horse = starborn(); ride(horse, "companion"); horse.flight!.mode = "air"
    horse.x = 3210; horse.z = -4567; horse.y = 1200; horse.heading = 1.2
    companionRT.pos.set(horse.x + 9, horse.y + 2, horse.z - 4); companionRT.facing = -2
    const expected = localToUniverse(spaceRT.frame, horse.x, horse.y, horse.z, new THREE.Vector3())
    expect(navigatorActor()).toMatchObject({ x: horse.x, y: horse.y, z: horse.z, heading: horse.heading, airborne: true })
    expect(navigatorPosition(new THREE.Vector3()).distanceTo(expected)).toBeLessThan(1e-7)
    const view = navigationSnapshot(HOME, 180)
    expect(view).toMatchObject({ x: horse.x, y: horse.y, z: horse.z, airborne: true, arrived: false })
  })

  it("does not announce ground arrival for a jumping ordinary horse directly over the destination", () => {
    const horse = makeHorseState(makeIdentity(9910, "quarter", { saddled: true }), HOME.x, HOME.z, true)
    horse.y = groundHeight(horse.x, horse.z); horse.jumpY = 1.5; ride(horse)
    const actor = navigatorActor(), view = navigationSnapshot(HOME, 180)
    expect(actor.y).toBeCloseTo(horse.y + horse.jumpY, 9)
    expect(actor.airborne).toBe(true)
    expect(view.arrived).toBe(false)
    horse.jumpY = 0
    expect(navigationSnapshot(HOME, 180).arrived).toBe(true)
  })

  it("derives celestial north from the real body's pole and explicitly leaves north undefined directly above a pole", () => {
    const moon = bodyById("moon")!
    spaceRT.mode = "deep"; spaceRT.pos.copy(moon.pos).addScaledVector(moon.pole, moon.radius + 3000)
    spaceRT.park.setFromEuler(new THREE.Euler(0.4, -0.9, 0.2))
    const localPole = moon.pole.clone().applyQuaternion(spaceRT.park.clone().invert())
    const expectedNorth = groundBearing(localPole.x, localPole.z)
    const view = navigationSnapshot({ kind: "body", id: "mars", name: "Mars" }, 180)
    expect(view.reference).toBe("The Moon")
    expect(view.north).toBeCloseTo(expectedNorth, 8)
    expect(view.facing).toBeCloseTo(((view.heading - expectedNorth) % 360 + 360) % 360, 8)
    spaceRT.park.setFromUnitVectors(new THREE.Vector3(0, 1, 0), moon.pole)
    const atPole = navigationSnapshot({ kind: "body", id: "mars", name: "Mars" }, 180)
    expect(atPole.north).toBeNull()
    expect(atPole.facing).toBeNull()
    expect(atPole.bearingText).toBeNull()
  })

  it("uses the approached world's north after leaving the Moon, and the actual realm in local mode", () => {
    const mars = bodyById("mars")!
    spaceRT.realm = "moon" // last local landing; it must not pin a deep-space compass
    spaceRT.mode = "deep"
    spaceRT.pos.copy(mars.pos).add(new THREE.Vector3(mars.radius + 3000, 1000, 2000))
    const expected = mars.pole.clone().applyQuaternion(spaceRT.park.clone().invert())
    const deep = navigationSnapshot({ kind: "body", id: "mars", name: "Mars" }, 180)
    expect(deep.reference).toBe("Mars")
    expect(deep.north).toBeCloseTo(groundBearing(expected.x, expected.z), 8)
    spaceRT.mode = "local"
    spaceRT.realm = "mars"
    // An unfinished transition can still have an old frame. Realm wins over a
    // nearest-body lookup, so its stated reference never silently changes.
    const local = navigationSnapshot({ kind: "body", id: "mars", name: "Mars" }, 180)
    expect(local.reference).toBe("Mars")
  })

  it("provides a truthful compact direction for vertical bodies and grounded arrival", () => {
    const moon = bodyById("moon")!
    spaceRT.mode = "deep"
    spaceRT.pos.copy(moon.pos).add(new THREE.Vector3(0, moon.radius + 3000, 0))
    const aboveMoon = navigationSnapshot({ kind: "body", id: "moon", name: "The Moon" }, 180)
    expect(aboveMoon.projection?.vertical).toBe(true)
    expect(aboveMoon.directionText).toBe("Directly below")
    expect(aboveMoon.arrived).toBe(false)
    spaceRT.mode = "local"; spaceRT.realm = "earth"; spaceRT.frame = earthFrame()
    const home = navigationSnapshot(HOME, 180)
    expect(home.arrived).toBe(true)
    expect(home.directionText).toBe("Arrived")
    const east = navigationSnapshot({ kind: "earth", id: "pin", name: "East", x: 50, z: 22.5 }, 180)
    expect(east.directionText).toBe("E 090°")
  })

  it("keeps Earth's geographic compass aligned with its fixed ECEF globe as story time changes the celestial pole", () => {
    playerRT.pos.set(23_000, DATUM_Y + 1500, -31_000)
    playerRT.facing = 0.7
    const geographicPole = new THREE.Vector3(0, 0, 1).applyMatrix3(GAME_TO_ECEF.clone().transpose())
    const axesInverse = localAxes(spaceRT.frame, playerRT.pos.x, playerRT.pos.z, new THREE.Quaternion()).invert()
    const localNorth = geographicPole.applyQuaternion(axesInverse)
    const expectedNorth = groundBearing(localNorth.x, localNorth.z)
    const readings: Array<{ north: number | null; facing: number | null; bearing: string | null }> = []
    const celestialPoles: THREE.Vector3[] = []
    for (const storyTime of [0.12, 0.49, 0.8]) {
      updateUniverse(storyTime, new Date("2026-10-20T12:00:00Z"))
      celestialPoles.push(bodyById("earth")!.pole.clone())
      const view = navigationSnapshot(HOME, 180)
      expect(view.sky).toBe(true)
      expect(view.reference).toBe("Earth")
      expect(view.north).toBeCloseTo(expectedNorth, 8)
      readings.push({ north: view.north, facing: view.facing, bearing: view.bearingText })
    }
    // The fixed rendered geography must win even though these story-clock
    // configurations genuinely rotate the ephemeris pole used by the sky.
    expect(celestialPoles[0].distanceTo(celestialPoles[1])).toBeGreaterThan(0.01)
    for (const reading of readings.slice(1)) expect(reading).toEqual(readings[0])
  })

  it("keeps snapshots read-only and independent of render-origin changes", () => {
    const horse = starborn(); ride(horse); horse.flight!.mode = "sail"
    horse.x = 4567; horse.z = -6789; horse.y = 1500; horse.speed = 35
    sailRT.autopilot = { kind: "home" }
    const before = { x: horse.x, y: horse.y, z: horse.z, speed: horse.speed, heading: horse.heading,
      player: playerRT.pos.clone(), partner: companionRT.pos.clone(), position: spaceRT.pos.clone(), frame: spaceRT.frame, origin: { ...originRT }, ap: sailRT.autopilot,
      axes: localAxes(spaceRT.frame, horse.x, horse.z, new THREE.Quaternion()) }
    const first = navigationSnapshot(HOME, 180)
    for (let i = 0; i < 5; i++) navigationSnapshot(HOME, 180)
    expect({ x: horse.x, y: horse.y, z: horse.z, speed: horse.speed, heading: horse.heading })
      .toEqual({ x: before.x, y: before.y, z: before.z, speed: before.speed, heading: before.heading })
    expect(playerRT.pos).toEqual(before.player); expect(companionRT.pos).toEqual(before.partner)
    expect(spaceRT.pos).toEqual(before.position); expect(spaceRT.frame).toBe(before.frame)
    expect(sailRT.autopilot).toBe(before.ap); expect(originRT).toEqual(before.origin)
    Object.assign(originRT, { x: 4096, z: -7168, version: before.origin.version + 1 })
    const rebased = navigationSnapshot(HOME, 180)
    expect(rebased).toEqual(first)
    expect(localAxes(spaceRT.frame, horse.x, horse.z, new THREE.Quaternion())).toEqual(before.axes)
  })
})

describe("transparent terrain-map ink", () => {
  it("keeps the base map opaque while overlay ink preserves authoritative pond water and translucent land", () => {
    const request = { id: 42, x: POND.x, z: POND.z, range: 8, size: 16 }
    const raster = rasterTerrain(request), step = 2 * request.range / request.size
    expect(raster.ink.length).toBe(request.size ** 2 * 4)
    let water = 0, land = 0
    for (let j = 0; j < request.size; j++) for (let i = 0; i < request.size; i++) {
      const x = request.x + (i + 0.5 - request.size / 2) * step, z = request.z + (j + 0.5 - request.size / 2) * step
      const p = (j * request.size + i) * 4
      expect(raster.pixels[p + 3]).toBe(255)
      expect(raster.ink[p + 3]).toBeGreaterThan(0)
      expect(raster.ink[p + 3]).toBeLessThan(255)
      if (atlasWaterAt(x, z)) {
        expect([...raster.pixels.slice(p, p + 3)]).toEqual([84, 143, 157])
        expect(raster.ink[p + 2]).toBeGreaterThan(raster.ink[p])
        water++
      } else {
        expect([...raster.pixels.slice(p, p + 3)]).not.toEqual([84, 143, 157])
        land++
      }
    }
    expect(water).toBeGreaterThan(0); expect(land).toBeGreaterThan(0)
  })
})
