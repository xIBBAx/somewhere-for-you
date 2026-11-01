import { describe, expect, it } from "vitest"
import {
  AIRCRAFT_DEFINITIONS,
  CELESTIAL_ROUTES,
  CIVILIAN_LIVERIES,
  calculateAircraftSpatialAudio,
  calculateNextSpawnInterval,
  isAircraftWeatherPermitted,
  selectRandomAircraftType,
  type AircraftType,
} from "../src/game/environment/aerialTraffic"

describe("aerial traffic system - aircraft types and specifications", () => {
  const expectedTypes: AircraftType[] = [
    "commercial_jet",
    "regional_turboprop",
    "cargo_transport",
    "business_jet",
    "small_propeller",
    "helicopter",
    "glider",
  ]

  it("defines all 7 peaceful civilian aircraft types with valid parameters", () => {
    expectedTypes.forEach((type) => {
      const def = AIRCRAFT_DEFINITIONS[type]
      expect(def).toBeDefined()
      expect(def.type).toBe(type)
      expect(def.name.length).toBeGreaterThan(3)
      expect(def.altitudeRange[0]).toBeGreaterThanOrEqual(15)
      expect(def.altitudeRange[1]).toBeGreaterThan(def.altitudeRange[0])
      expect(def.transitDuration[0]).toBeGreaterThanOrEqual(40)
      expect(def.transitDuration[1]).toBeGreaterThanOrEqual(def.transitDuration[0])
      expect(def.spawnWeight).toBeGreaterThan(0)
    })
  })

  it("restricts contrail eligibility selectively to high-altitude jet aircraft", () => {
    expect(AIRCRAFT_DEFINITIONS.commercial_jet.contrailEligible).toBe(true)
    expect(AIRCRAFT_DEFINITIONS.cargo_transport.contrailEligible).toBe(true)
    expect(AIRCRAFT_DEFINITIONS.business_jet.contrailEligible).toBe(true)

    expect(AIRCRAFT_DEFINITIONS.regional_turboprop.contrailEligible).toBe(false)
    expect(AIRCRAFT_DEFINITIONS.small_propeller.contrailEligible).toBe(false)
    expect(AIRCRAFT_DEFINITIONS.helicopter.contrailEligible).toBe(false)
    expect(AIRCRAFT_DEFINITIONS.glider.contrailEligible).toBe(false)
  })

  it("configures animated rotors and propellers for respective models", () => {
    expect(AIRCRAFT_DEFINITIONS.regional_turboprop.hasSpinningProp).toBe(true)
    expect(AIRCRAFT_DEFINITIONS.small_propeller.hasSpinningProp).toBe(true)
    expect(AIRCRAFT_DEFINITIONS.helicopter.hasRotor).toBe(true)

    expect(AIRCRAFT_DEFINITIONS.commercial_jet.hasSpinningProp).toBe(false)
    expect(AIRCRAFT_DEFINITIONS.commercial_jet.hasRotor).toBe(false)
    expect(AIRCRAFT_DEFINITIONS.glider.hasSpinningProp).toBe(false)
    expect(AIRCRAFT_DEFINITIONS.glider.hasRotor).toBe(false)
  })

  it("provides tasteful civilian liveries for all aircraft types", () => {
    expectedTypes.forEach((type) => {
      const liveries = CIVILIAN_LIVERIES[type]
      expect(liveries).toBeDefined()
      expect(liveries.length).toBeGreaterThanOrEqual(2)
      liveries.forEach((l) => {
        expect(l.fuselage).toMatch(/^#[0-9a-fA-F]{6}$/)
        expect(l.wings).toMatch(/^#[0-9a-fA-F]{6}$/)
        expect(l.accent).toMatch(/^#[0-9a-fA-F]{6}$/)
        expect(l.tail).toMatch(/^#[0-9a-fA-F]{6}$/)
      })
    })
  })
})

describe("aerial traffic scheduling & weather integration", () => {
  it("schedules first appearance roughly 45–90 seconds after game start", () => {
    const minVal = calculateNextSpawnInterval(true, 0.0)
    const maxVal = calculateNextSpawnInterval(true, 1.0)
    const midVal = calculateNextSpawnInterval(true, 0.5)

    expect(minVal).toBe(45)
    expect(maxVal).toBe(90)
    expect(midVal).toBe(67.5)
  })

  it("schedules subsequent appearances at randomized 3–8 minute intervals", () => {
    const minVal = calculateNextSpawnInterval(false, 0.0)
    const maxVal = calculateNextSpawnInterval(false, 1.0)
    const midVal = calculateNextSpawnInterval(false, 0.5)

    expect(minVal).toBe(180) // 3 minutes
    expect(maxVal).toBe(480) // 8 minutes
    expect(midVal).toBe(330) // 5.5 minutes
  })

  it("grounds light aircraft, gliders and helicopters during heavy rain and thunderstorms", () => {
    const clearWeather = { rain: 0.0, cloud: 0.2, lightning: 0.0 }
    const thunderstorm = { rain: 0.8, cloud: 0.95, lightning: 0.8 }

    expect(isAircraftWeatherPermitted("small_propeller", clearWeather)).toBe(true)
    expect(isAircraftWeatherPermitted("helicopter", clearWeather)).toBe(true)
    expect(isAircraftWeatherPermitted("glider", clearWeather)).toBe(true)

    expect(isAircraftWeatherPermitted("small_propeller", thunderstorm)).toBe(false)
    expect(isAircraftWeatherPermitted("helicopter", thunderstorm)).toBe(false)
    expect(isAircraftWeatherPermitted("glider", thunderstorm)).toBe(false)
    expect(isAircraftWeatherPermitted("regional_turboprop", thunderstorm)).toBe(false)
  })

  it("selects aircraft based on weighted probabilities and weather eligibility", () => {
    const clear = { rain: 0.0, cloud: 0.1, lightning: 0.0 }
    const heavyRain = { rain: 0.7, cloud: 0.9, lightning: 0.0 }

    const selectedClear = selectRandomAircraftType(0.1, clear)
    expect(selectedClear).toBe("commercial_jet")

    // In heavy rain, low-altitude aircraft are filtered out
    const selectedRain = selectRandomAircraftType(0.9, heavyRain)
    expect(["commercial_jet", "cargo_transport"]).toContain(selectedRain)
  })
})

describe("360-degree celestial flight routes & spatial audio", () => {
  it("provides 8 independent routes traversing the sky dome from various compass headings", () => {
    expect(CELESTIAL_ROUTES.length).toBe(8)
    CELESTIAL_ROUTES.forEach((route) => {
      expect(route.id).toBeDefined()
      expect(route.name).toBeDefined()
      expect(route.start[0]).toBeLessThanOrEqual(135)
      expect(route.start[0]).toBeGreaterThanOrEqual(-135)
      expect(route.end[0]).toBeLessThanOrEqual(135)
      expect(route.end[0]).toBeGreaterThanOrEqual(-135)
      // Start and end should be distinct
      const dist = Math.hypot(route.end[0] - route.start[0], route.end[1] - route.start[1])
      expect(dist).toBeGreaterThan(100)
    })
  })

  it("calculates realistic distance attenuation and silent cutoff for distant aircraft", () => {
    const playerPos = { x: 0, y: 0, z: 0 }
    const closeAircraft = { x: 5, y: 20, z: 5 } // ~21m distance
    const midAircraft = { x: 40, y: 45, z: 30 } // ~67m distance
    const distantAircraft = { x: 120, y: 55, z: 120 } // ~178m distance

    const closeVol = calculateAircraftSpatialAudio(closeAircraft, playerPos, 0.04)
    const midVol = calculateAircraftSpatialAudio(midAircraft, playerPos, 0.04)
    const distantVol = calculateAircraftSpatialAudio(distantAircraft, playerPos, 0.04)

    expect(closeVol).toBeGreaterThan(0.02)
    expect(midVol).toBeLessThan(closeVol)
    expect(midVol).toBeGreaterThan(0)
    expect(distantVol).toBe(0) // completely silent beyond 110m
  })
})
