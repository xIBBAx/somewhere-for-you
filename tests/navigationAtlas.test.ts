import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as THREE from "three"
import { compassPoint, groundBearing, mapPoint, skyPoint, unmapPoint } from "../src/game/navigation/atlasMath"
import { atlasWaterAt, rasterTerrain } from "../src/game/navigation/terrainAtlas"
import { celestialMarkers, navigatorPosition } from "../src/game/navigation/atlasSnapshot"
import { HOME, readDestination } from "../src/state/navigationStore"
import { POND, RIVER_MAX_X, RIVER_MIN_X, riverCenterZ, riverHalfWidthAt } from "../src/world/hubLayout"
import { lakeMask, WATER_LEVEL } from "../src/world/climate"
import { worldHeight } from "../src/world/terrain"
import { waterSurfaceAt } from "../src/world/waterSurface"
import { originRT } from "../src/world/origin"
import { avatarRT, characterRT, companionRT, playerRT } from "../src/game/runtime"
import { earthFrame, localAxes, localToUniverse } from "../src/game/celestial/frames"
import { spaceRT } from "../src/game/celestial/spaceState"
import { bodyById, universe, updateUniverse } from "../src/game/celestial/universe"
import { DATUM_Y } from "../src/game/celestial/scale"
import { SITE_BY_ID } from "../src/game/celestial/realm/lunarSites"

// Keep the React controller outside this math/integration test; the world,
// ephemeris, surface frames and navigation snapshots remain real modules.
vi.mock("../src/game/celestial/CelestialController", () => ({ ridingCelestial: () => null }))

describe("atlas coordinate conventions", () => {
  it.each([
    [0, -10, 0, "N"], [10, -10, 45, "NE"], [10, 0, 90, "E"], [10, 10, 135, "SE"],
    [0, 10, 180, "S"], [-10, 10, 225, "SW"], [-10, 0, 270, "W"], [-10, -10, 315, "NW"],
  ] as const)("gives the true bearing for (%s, %s)", (dx, dz, bearing, compass) => {
    expect(groundBearing(dx, dz)).toBe(bearing)
    expect(compassPoint(bearing)).toBe(compass)
  })

  it("round-trips world pins at every zoom and far beyond a render-origin rebase", () => {
    for (const [cx, cz] of [[0, 22.5], [4096.125, -8192.75], [-90_000_000.25, 80_000_000.5]]) {
      for (const range of [70, 180, 500, 1400]) for (const [dx, dz] of [[0, 0], [0.125, -0.75], [-1, 1]]) {
        const x = cx + dx * range, z = cz + dz * range
        const drawn = mapPoint(x, z, cx, cz, range)
        const restored = unmapPoint(drawn.x, drawn.y, cx, cz, range)
        expect(restored.x).toBeCloseTo(x, 7)
        expect(restored.z).toBeCloseTo(z, 7)
      }
    }
    expect(mapPoint(0, -70, 0, 0, 70)).toEqual({ x: 100, y: 18 })
    expect(mapPoint(70, 0, 0, 0, 70)).toEqual({ x: 182, y: 100 })
  })

  it("preserves azimuth and true elevation while compressing astronomical distance", () => {
    const near = skyPoint(3, 4, -3, 1e12), far = skyPoint(3e9, 4e9, -3e9, 1e12)
    expect(groundBearing(near.x - 100, near.y - 100)).toBeCloseTo(45, 10)
    expect(groundBearing(far.x - 100, far.y - 100)).toBeCloseTo(45, 10)
    expect(near.elevation).toBeCloseTo(Math.atan2(4, Math.sqrt(18)) * 180 / Math.PI, 10)
    expect(far.elevation).toBeCloseTo(near.elevation, 10)
    expect(far.distance).toBeCloseTo(Math.sqrt(34) * 1e9, 4)
    const nearRadius = Math.hypot(near.x - 100, near.y - 100), farRadius = Math.hypot(far.x - 100, far.y - 100)
    expect(farRadius).toBeGreaterThan(nearRadius)
    expect(farRadius).toBeLessThanOrEqual(80)
    expect(farRadius / nearRadius).toBeLessThan(10)
    expect(near.vertical).toBe(false)
  })

  it("handles zenith, nadir and a coincident observer without inventing an azimuth", () => {
    for (const height of [-1e12, 1e12]) {
      const p = skyPoint(0, height, 0, 1e12)
      expect(p).toMatchObject({ x: 100, y: 100, vertical: true, elevation: Math.sign(height) * 90, distance: Math.abs(height) })
    }
    const zero = skyPoint(0, 0, 0, 1e12)
    expect(Object.values(zero).every(v => typeof v === "boolean" || Number.isFinite(v))).toBe(true)
    expect(zero.distance).toBe(0)
    expect(skyPoint(1, 1e12, 0, 1e12).vertical).toBe(true)
    expect(skyPoint(1e8, 1e12, 0, 1e12).vertical).toBe(false)
  })
})

describe("atlas water geography", () => {
  it("includes the authored pond and curved river that the swimming sampler excludes", () => {
    expect(waterSurfaceAt(POND.x, POND.z)).toBeNull()
    expect(atlasWaterAt(POND.x, POND.z)).toBe(true)
    expect(atlasWaterAt(POND.x + POND.r + 0.1, POND.z)).toBe(false)
    for (const x of [-9, -4, 0, 5, 10]) {
      const centre = riverCenterZ(x), width = riverHalfWidthAt(x)
      expect(waterSurfaceAt(x, centre)).toBeNull()
      expect(atlasWaterAt(x, centre)).toBe(true)
      expect(atlasWaterAt(x, centre + width * 0.9)).toBe(true)
      expect(atlasWaterAt(x, centre + width + 0.1)).toBe(false)
    }
    for (const x of [RIVER_MIN_X - 0.1, RIVER_MAX_X + 0.1]) expect(atlasWaterAt(x, riverCenterZ(x))).toBe(false)
  })

  it("keeps dry home terrain dry even below the common water datum", () => {
    expect(lakeMask(0, 22.5)).toBe(0)
    expect(atlasWaterAt(0, 22.5)).toBe(false)
    expect(atlasWaterAt(0, 22.5, WATER_LEVEL - 10)).toBe(false)
    expect(atlasWaterAt(-12, 3.4)).toBe(false)
  })

  it("matches actual wild lake water and excludes the dry shoreline", () => {
    let wet: { x: number; z: number } | undefined, shore: { x: number; z: number } | undefined
    for (let i = 0; i < 20_000 && (!wet || !shore); i++) {
      const x = (i * 37.1) % 4000 - 2000, z = Math.floor(i / 108) * 37 - 2000
      const mask = lakeMask(x, z)
      if (mask <= 0) continue
      const h = worldHeight(x, z)
      if (!wet && h < WATER_LEVEL - 0.5) wet = { x, z }
      if (!shore && h > WATER_LEVEL + 0.5) shore = { x, z }
    }
    expect(wet).toBeDefined()
    expect(shore).toBeDefined()
    expect(waterSurfaceAt(wet!.x, wet!.z)).toBe(WATER_LEVEL)
    expect(atlasWaterAt(wet!.x, wet!.z)).toBe(true)
    expect(waterSurfaceAt(shore!.x, shore!.z)).toBeNull()
    expect(atlasWaterAt(shore!.x, shore!.z)).toBe(false)
  })

  it("rasterizes north-up water at the same world points used for terrain sampling", () => {
    const request = { id: 17, x: POND.x, z: POND.z, range: 8, size: 16 }
    const raster = rasterTerrain(request), repeated = rasterTerrain(request)
    expect(raster.pixels).toEqual(repeated.pixels)
    expect(raster.pixels.length).toBe(request.size * request.size * 4)
    let water = 0, land = 0
    for (let j = 0; j < request.size; j++) for (let i = 0; i < request.size; i++) {
      const x = request.x - request.range + (i + 0.5), z = request.z - request.range + (j + 0.5)
      const p = (j * request.size + i) * 4, color = [...raster.pixels.slice(p, p + 3)]
      expect(raster.pixels[p + 3]).toBe(255)
      if (atlasWaterAt(x, z)) { expect(color).toEqual([84, 143, 157]); water++ }
      else { expect(color).not.toEqual([84, 143, 157]); land++ }
    }
    expect(water).toBeGreaterThan(0)
    expect(land).toBeGreaterThan(0)
  })
})

describe("navigation save validation", () => {
  it("restores valid destinations with canonical names for known places", () => {
    expect(readDestination(JSON.stringify({ kind: "earth", id: "home", name: "tampered", x: 123, z: 456 }))).toEqual(HOME)
    expect(readDestination(JSON.stringify({ kind: "earth", id: "pin", name: "Our place", x: -1234.5, z: 9876.25 }))).toEqual({ kind: "earth", id: "pin", name: "Our place", x: -1234.5, z: 9876.25 })
    expect(readDestination(JSON.stringify({ kind: "body", id: "moon", name: "tampered" }))).toEqual({ kind: "body", id: "moon", name: "The Moon" })
    const site = SITE_BY_ID.get("apollo11")!
    expect(readDestination(JSON.stringify({ kind: "site", id: site.id, name: "tampered" }))).toEqual({ kind: "site", id: site.id, name: site.title })
    expect(readDestination(JSON.stringify({ kind: "cats", id: "space-cats", name: "tampered" }))).toEqual({ kind: "cats", id: "space-cats", name: "The space cats" })
  })

  it("rejects malformed, oversized, impossible and unknown destinations", () => {
    const invalid = [null, "", "{", "null", "false", "[]", "x".repeat(1201),
      JSON.stringify({ kind: "earth", id: "pin", name: "", x: 0, z: 0 }),
      JSON.stringify({ kind: "earth", id: "pin", name: "x".repeat(101), x: 0, z: 0 }),
      JSON.stringify({ kind: "earth", id: "pin", name: "Pin", x: "10", z: 0 }),
      '{"kind":"earth","id":"pin","name":"Pin","x":1e999,"z":0}',
      JSON.stringify({ kind: "earth", id: "pin", name: "Pin", x: 1e8, z: 0 }),
      JSON.stringify({ kind: "earth", id: "pin", name: "Pin", x: 0, z: -1e8 }),
      JSON.stringify({ kind: "body", id: "unknown", name: "Unknown" }),
      JSON.stringify({ kind: "site", id: "unknown", name: "Unknown" }),
      JSON.stringify({ kind: "cats", id: "unknown", name: "Unknown" }),
      JSON.stringify({ kind: "teleport", id: "home", name: "Home" }),
    ]
    for (const raw of invalid) expect(readDestination(raw)).toBeNull()
  })

  it("rejects inherited object properties as celestial body identifiers", () => {
    for (const id of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(readDestination(JSON.stringify({ kind: "body", id, name: "Invalid" }))).toBeNull()
    }
  })
})

describe("live celestial navigation", () => {
  const playerPosition = playerRT.pos.clone(), partnerPosition = companionRT.pos.clone(), active = characterRT.active
  const frame = spaceRT.frame, mode = spaceRT.mode, realm = spaceRT.realm, position = spaceRT.pos.clone(), park = spaceRT.park.clone()
  const origin = { ...originRT }
  beforeEach(() => {
    characterRT.active = "explorer"
    spaceRT.mode = "local"; spaceRT.realm = "earth"; spaceRT.frame = earthFrame()
    playerRT.pos.set(1234, 900, -789)
    updateUniverse(0.37, new Date("2026-10-19T12:00:00Z"))
  })
  afterEach(() => {
    playerRT.pos.copy(playerPosition); companionRT.pos.copy(partnerPosition); characterRT.active = active
    spaceRT.frame = frame; spaceRT.mode = mode; spaceRT.realm = realm; spaceRT.pos.copy(position); spaceRT.park.copy(park)
    Object.assign(originRT, origin)
  })

  it("uses the active avatar's actual surface position and ignores render-origin offsets", () => {
    characterRT.active = "companion"
    companionRT.pos.set(-6789, 432, 987)
    const expected = localToUniverse(spaceRT.frame, companionRT.pos.x, companionRT.pos.y, companionRT.pos.z, new THREE.Vector3())
    expect(navigatorPosition(new THREE.Vector3()).distanceTo(expected)).toBeLessThan(1e-8)
    const before = celestialMarkers()
    Object.assign(originRT, { x: -7168, z: 1024, version: origin.version + 1 })
    expect(celestialMarkers()).toEqual(before)
    const earth = before.find(m => m.destination.id === "earth")!
    expect(earth.vertical).toBe(true)
    expect(earth.elevation).toBeCloseTo(-90, 7)
    expect(earth.surfaceDistance).toBeCloseTo(companionRT.pos.y - DATUM_Y, 7)
  })

  it("projects current ephemeris positions through the observer's current local axes", () => {
    const observer = navigatorPosition(new THREE.Vector3()), body = avatarRT()
    const inverse = localAxes(spaceRT.frame, body.pos.x, body.pos.z, new THREE.Quaternion()).invert()
    const markers = celestialMarkers()
    for (const id of ["moon", "mars", "saturn", "neptune"]) {
      const actual = markers.find(m => m.destination.id === id)!, world = bodyById(id)!
      const delta = world.pos.clone().sub(observer).applyQuaternion(inverse)
      expect(actual.surfaceDistance).toBeCloseTo(observer.distanceTo(world.pos) - world.radius, 4)
      expect(actual.elevation).toBeCloseTo(Math.atan2(delta.y, Math.hypot(delta.x, delta.z)) * 180 / Math.PI, 9)
      expect(groundBearing(actual.x - 100, actual.y - 100)).toBeCloseTo(groundBearing(delta.x, delta.z), 9)
    }
    expect(new Set(markers.map(m => m.destination.id)).size).toBe(markers.length)
    expect(markers.length).toBeGreaterThanOrEqual(universe.bodies.length)
  })

  it("uses the real deep-space position and parked frame, not the avatar's local anchor", () => {
    spaceRT.mode = "deep"
    spaceRT.pos.set(1e9, 3e7, -4e8)
    spaceRT.park.setFromEuler(new THREE.Euler(0.4, -0.9, 0.2))
    expect(navigatorPosition(new THREE.Vector3())).toEqual(spaceRT.pos)
    const moon = bodyById("moon")!, marker = celestialMarkers().find(m => m.destination.id === "moon")!
    const delta = moon.pos.clone().sub(spaceRT.pos).applyQuaternion(spaceRT.park.clone().invert())
    expect(marker.distance).toBeCloseTo(spaceRT.pos.distanceTo(moon.pos), 4)
    expect(marker.elevation).toBeCloseTo(Math.atan2(delta.y, Math.hypot(delta.x, delta.z)) * 180 / Math.PI, 9)
    expect(groundBearing(marker.x - 100, marker.y - 100)).toBeCloseTo(groundBearing(delta.x, delta.z), 9)
    playerRT.pos.set(-2000, -4000, 8000)
    expect(celestialMarkers().find(m => m.destination.id === "moon")).toEqual(marker)
  })
})
