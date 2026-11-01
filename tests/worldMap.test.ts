import { describe, expect, it, vi } from "vitest"
import { bearingOf, MAP_LINES, MAP_AREAS, toScreen, toWorldXZ, viewBounds, type MapView } from "../src/game/navigation/mapView"
import { chartedAt, levelFor, MAP_HOME, MAX_LEVEL, rasterTile, tileMetres, TILE_PX, tileUncharted } from "../src/game/navigation/mapTiles"
import { groundBearing } from "../src/game/navigation/atlasMath"
import { readDestination } from "../src/state/navigationStore"
import { HIGHVALE_CENTER, HIGHVALE_ARRIVAL } from "../src/world/highvale/highvaleLayout"
import { HIGHVALE_PATHS } from "../src/world/highvale/highvale.layout"
import { BENCH_WORLD } from "../src/world/highvale/highvaleStructures"
import { BENCH_ID, BENCH_NAME, HIGHVALE_NAME } from "../src/world/highvale/highvaleNames"
import { POND } from "../src/world/hubLayout"
import { PLAYABLE_REACH } from "../src/game/travel/safety"
import { cameraRT } from "../src/game/runtime"

vi.mock("../src/game/celestial/CelestialController", () => ({ ridingCelestial: () => null }))

const view = (up: number, cx = 6060, cz = -23150, mpp = 1.7): MapView => ({ cx, cz, mpp, up, w: 900, h: 600 })

describe("the map's one projection", () => {
  it("round-trips any world point at any rotation, zoom and distance from the origin", () => {
    for (const up of [0, 0.3, Math.PI / 2, -2.4, Math.PI]) for (const mpp of [0.12, 1.1, 49]) for (const [cx, cz] of [[0, 22.5], [6060, -23150], [-80_000.5, 120_000.25]]) {
      const v = view(up, cx, cz, mpp)
      for (const [dx, dz] of [[0, 0], [37.5, -12.25], [-400, 900]]) {
        const s = toScreen(v, cx + dx, cz + dz)
        const back = toWorldXZ(v, s.x, s.y)
        expect(back.x).toBeCloseTo(cx + dx, 6)
        expect(back.z).toBeCloseTo(cz + dz, 6)
      }
    }
  })

  it("puts what lies in the `up` bearing straight above the centre, and keeps east to the right of north", () => {
    for (const up of [0, 0.7, 2, -1.3]) {
      const v = view(up)
      // a point 100 m away along bearing `up` (bearing b: dx = sin b, dz = -cos b)
      const ahead = toScreen(v, v.cx + Math.sin(up) * 100, v.cz - Math.cos(up) * 100)
      expect(ahead.x).toBeCloseTo(v.w / 2, 6)
      expect(ahead.y).toBeCloseTo(v.h / 2 - 100 / v.mpp, 6)
      // and a point 90° clockwise of it (to the right of the way you look) is to the right
      const right = toScreen(v, v.cx + Math.sin(up + Math.PI / 2) * 100, v.cz - Math.cos(up + Math.PI / 2) * 100)
      expect(right.x).toBeCloseTo(v.w / 2 + 100 / v.mpp, 6)
      expect(right.y).toBeCloseTo(v.h / 2, 6)
    }
    // north up: north is up, east is right
    const v = view(0)
    expect(toScreen(v, v.cx, v.cz - 10).y).toBeLessThan(v.h / 2)
    expect(toScreen(v, v.cx + 10, v.cz).x).toBeGreaterThan(v.w / 2)
  })

  it("measures bearings as the compass does", () => {
    for (const [dx, dz] of [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [3, -7]]) {
      expect(((bearingOf(dx, dz) * 180 / Math.PI) + 360) % 360).toBeCloseTo(groundBearing(dx, dz), 9)
    }
  })

  it("covers the whole screen at any rotation (the tile bounds include every corner)", () => {
    for (const up of [0, 0.8, 2.2]) {
      const v = view(up), b = viewBounds(v)
      for (const [sx, sy] of [[0, 0], [v.w, 0], [0, v.h], [v.w, v.h]]) {
        const p = toWorldXZ(v, sx, sy)
        expect(p.x).toBeGreaterThanOrEqual(b.x0); expect(p.x).toBeLessThanOrEqual(b.x1)
        expect(p.z).toBeGreaterThanOrEqual(b.z0); expect(p.z).toBeLessThanOrEqual(b.z1)
      }
    }
  })
})

describe("the minimap turns with the camera", async () => {
  const { viewBearing } = await import("../src/ui/MiniRadar")
  it("puts up on the map where the camera looks", () => {
    // the boom sits at +(sin yaw, cos yaw) from what it looks at: yaw 0 looks toward −z (north)
    for (const [yaw, bearing] of [[0, 0], [Math.PI / 2, -Math.PI / 2], [Math.PI, Math.PI], [-Math.PI / 2, Math.PI / 2]]) {
      cameraRT.yaw = yaw
      const b = viewBearing()
      expect(Math.cos(b)).toBeCloseTo(Math.cos(bearing), 9)
      expect(Math.sin(b)).toBeCloseTo(Math.sin(bearing), 9)
    }
  })
})

describe("map tiles", () => {
  it("climb a power-of-two ladder, finer for finer views", () => {
    expect(tileMetres(0)).toBe(32)
    expect(tileMetres(MAX_LEVEL)).toBe(32 * 2 ** MAX_LEVEL)
    let last = -1
    for (const mpp of [0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128]) {
      const l = levelFor(mpp)
      expect(l).toBeGreaterThanOrEqual(last)
      last = l
      // a tile pixel is never more than ~1.6 screen pixels wide
      if (l > 0 && l < MAX_LEVEL) expect(tileMetres(l) / TILE_PX / mpp).toBeLessThan(1.6)
    }
  })

  it("chart what can be reached (home's reach, Highvale) and fade the country between", () => {
    expect(chartedAt(MAP_HOME.x, MAP_HOME.z)).toBe(1)
    expect(chartedAt(MAP_HOME.x + PLAYABLE_REACH - 10, MAP_HOME.z)).toBe(1)
    expect(chartedAt(MAP_HOME.x + PLAYABLE_REACH + 500, MAP_HOME.z)).toBe(0)
    expect(chartedAt(HIGHVALE_CENTER.x, HIGHVALE_CENTER.z)).toBe(1)
    expect(chartedAt((HIGHVALE_CENTER.x + MAP_HOME.x) / 2, (HIGHVALE_CENTER.z + MAP_HOME.z) / 2)).toBe(0)
    expect(tileUncharted(12_000, -12_000, 1024)).toBe(true)
    expect(tileUncharted(-512, -512, 1024)).toBe(false)
  })

  it("draw the home pond as water and the meadow beside it as land", () => {
    const level = 0, s = tileMetres(level)
    const tx = Math.floor(POND.x / s), tz = Math.floor(POND.z / s)
    const tile = rasterTile({ level, tx, tz })
    const px = (x: number, z: number): number[] => {
      const i = Math.floor((x - tx * s) / s * TILE_PX), j = Math.floor((z - tz * s) / s * TILE_PX)
      const p = (j * TILE_PX + i) * 4
      return [tile.rgba[p], tile.rgba[p + 1], tile.rgba[p + 2]]
    }
    const water = px(POND.x, POND.z)
    expect(water[2]).toBeGreaterThan(water[0] + 30) // blue over red
    const land = px(POND.x + POND.r + 4, POND.z)
    expect(land[1]).toBeGreaterThan(land[2]) // green over blue
  })
})

describe("map layers are the game's own", () => {
  it("lay Highvale's trails where the valley's layout puts them", () => {
    const trails = MAP_LINES.filter((l) => l.kind === "trail" || l.kind === "paved")
    expect(trails.length).toBe(HIGHVALE_PATHS.length)
    const first = HIGHVALE_PATHS[0], line = trails[0]
    expect(line.pts[0]).toBeCloseTo(HIGHVALE_CENTER.x + first.points[0], 6)
    expect(line.pts[1]).toBeCloseTo(HIGHVALE_CENTER.z - first.points[1], 6)
  })

  it("draw solid buildings from their collision footprints, and only solid ones", () => {
    expect(MAP_AREAS.length).toBeGreaterThan(15)
    for (const a of MAP_AREAS) expect(a.pts.length).toBeGreaterThanOrEqual(6)
  })
})

describe("a saved destination in Highvale", () => {
  it("is put back where the layout has the place now, not where an old save had it", () => {
    const m = readDestination(JSON.stringify({ kind: "earth", id: "highvale", name: HIGHVALE_NAME, x: 1, z: 2 }))
    expect(m).toMatchObject({ x: HIGHVALE_ARRIVAL.x, z: HIGHVALE_ARRIVAL.z })
    const b = readDestination(JSON.stringify({ kind: "earth", id: BENCH_ID, name: "x", x: 1, z: 2 }))
    expect(b).toMatchObject({ x: BENCH_WORLD.x, z: BENCH_WORLD.z, name: BENCH_NAME })
  })
})
