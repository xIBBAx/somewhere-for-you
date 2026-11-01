import { useFrame } from "@react-three/fiber"
import { awayFromEarth } from "../../world/realmHook"
import { useMemo, useRef } from "react"
import * as THREE from "three"
import { damp, smoothstep } from "../../utils/math"
import { avatarRT, worldRT } from "../runtime"
import { HOME_CENTER } from "../world-layout"
import { weatherRT } from "../weather/weatherState"
import { contrailVaporTexture } from "../../utils/canvasTexture"
import { sfx } from "../audio/audio"
import {
  AIRCRAFT_DEFINITIONS,
  CELESTIAL_ROUTES,
  CIVILIAN_LIVERIES,
  calculateAircraftSpatialAudio,
  calculateNextSpawnInterval,
  isAircraftWeatherPermitted,
  selectRandomAircraftType,
  type AircraftType,
  type CelestialFlightRoute,
} from "./aerialTraffic"

const CONTRAIL_PAIRS = 50

type ActiveFlight = {
  active: boolean
  type: AircraftType
  route: CelestialFlightRoute
  progress: number
  duration: number
  altitude: number
  arcHeight: number
  startPos: THREE.Vector3
  endPos: THREE.Vector3
  currentPos: THREE.Vector3
  liveryIndex: number
  propellerAngle: number
  rotorAngle: number
  tailRotorAngle: number
  audioTimer: number
  isSecondary: boolean
  /** metres the aircraft has climbed or sunk to give a Pegasus (and the camera) room */
  dodge: number
}

const createBlankFlight = (isSecondary = false): ActiveFlight => ({
  active: false,
  type: "commercial_jet",
  route: CELESTIAL_ROUTES[0],
  progress: 0,
  duration: 52,
  altitude: 54,
  arcHeight: 3.5,
  startPos: new THREE.Vector3(-125, 54, -60),
  endPos: new THREE.Vector3(125, 54, 50),
  currentPos: new THREE.Vector3(),
  liveryIndex: 0,
  propellerAngle: 0,
  rotorAngle: 0,
  tailRotorAngle: 0,
  audioTimer: 0,
  isSecondary,
  dodge: 0,
})

type AircraftMeshRefs = {
  group: React.RefObject<THREE.Group | null>
  commercialJet: React.RefObject<THREE.Group | null>
  regionalTurboprop: React.RefObject<THREE.Group | null>
  cargoTransport: React.RefObject<THREE.Group | null>
  businessJet: React.RefObject<THREE.Group | null>
  smallPropeller: React.RefObject<THREE.Group | null>
  helicopter: React.RefObject<THREE.Group | null>
  glider: React.RefObject<THREE.Group | null>
  // Animated parts
  turbopropBladesL: React.RefObject<THREE.Group | null>
  turbopropBladesR: React.RefObject<THREE.Group | null>
  smallPropBlades: React.RefObject<THREE.Group | null>
  heliMainRotor: React.RefObject<THREE.Group | null>
  heliTailRotor: React.RefObject<THREE.Group | null>
  // Lighting materials
  strobes: React.RefObject<Array<THREE.MeshBasicMaterial | null>>
  beacons: React.RefObject<Array<THREE.MeshBasicMaterial | null>>
}

/**
 * Living Sky Aerial Traffic System:
 * - 7 Realistic Civilian Aircraft Types (Airliner, Regional Turboprop, Cargo Transport, Business Jet, Light Prop, Helicopter, Glider).
 * - Organic Scheduling (45-90s initial delay, 3-8 min intervals, rarity weights).
 * - Independent 360-degree celestial routes across the open world.
 * - Distance-attenuated subtle ambient audio.
 * - Selective fading vapor contrails on high-altitude jets.
 * - Animated propellers & rotors.
 * - FAA/ICAO navigation lighting with daytime-to-night visibility transitions.
 */
export const SkyLife = (): React.ReactElement => {
  // Flight state records
  const primaryFlight = useRef<ActiveFlight>(createBlankFlight(false))
  const secondaryFlight = useRef<ActiveFlight>(createBlankFlight(true))
  const totalFlightsSpawned = useRef(0)

  // Scheduling timer: initial flight in 45-90 seconds
  const scheduleTimer = useRef<number>(calculateNextSpawnInterval(true))

  // Aircraft model refs for primary flight
  const pGroup = useRef<THREE.Group>(null)
  const pCommercialJet = useRef<THREE.Group>(null)
  const pRegionalTurboprop = useRef<THREE.Group>(null)
  const pCargoTransport = useRef<THREE.Group>(null)
  const pBusinessJet = useRef<THREE.Group>(null)
  const pSmallPropeller = useRef<THREE.Group>(null)
  const pHelicopter = useRef<THREE.Group>(null)
  const pGlider = useRef<THREE.Group>(null)
  const pTurbopropBladesL = useRef<THREE.Group>(null)
  const pTurbopropBladesR = useRef<THREE.Group>(null)
  const pSmallPropBlades = useRef<THREE.Group>(null)
  const pHeliMainRotor = useRef<THREE.Group>(null)
  const pHeliTailRotor = useRef<THREE.Group>(null)
  const pStrobes = useRef<Array<THREE.MeshBasicMaterial | null>>([])
  const pBeacons = useRef<Array<THREE.MeshBasicMaterial | null>>([])

  // Aircraft model refs for secondary rare flight
  const sGroup = useRef<THREE.Group>(null)
  const sCommercialJet = useRef<THREE.Group>(null)
  const sRegionalTurboprop = useRef<THREE.Group>(null)
  const sCargoTransport = useRef<THREE.Group>(null)
  const sBusinessJet = useRef<THREE.Group>(null)
  const sSmallPropeller = useRef<THREE.Group>(null)
  const sHelicopter = useRef<THREE.Group>(null)
  const sGlider = useRef<THREE.Group>(null)
  const sTurbopropBladesL = useRef<THREE.Group>(null)
  const sTurbopropBladesR = useRef<THREE.Group>(null)
  const sSmallPropBlades = useRef<THREE.Group>(null)
  const sHeliMainRotor = useRef<THREE.Group>(null)
  const sHeliTailRotor = useRef<THREE.Group>(null)
  const sStrobes = useRef<Array<THREE.MeshBasicMaterial | null>>([])
  const sBeacons = useRef<Array<THREE.MeshBasicMaterial | null>>([])

  // Contrail mesh refs
  const primaryLeftContrail = useRef<Array<THREE.Mesh | null>>([])
  const primaryRightContrail = useRef<Array<THREE.Mesh | null>>([])
  const secondaryLeftContrail = useRef<Array<THREE.Mesh | null>>([])
  const secondaryRightContrail = useRef<Array<THREE.Mesh | null>>([])
  const contrailMat = useRef<THREE.MeshBasicMaterial>(null)

  // Distant bird formations
  const birdFormations = useRef<Array<THREE.Group | null>>([])
  const birdActivity = useRef(1)

  const vaporTexture = useMemo(() => contrailVaporTexture(), [])

  const reducedMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  )

  // Pre-allocated vectors for frame performance
  const tempPos = useMemo(() => new THREE.Vector3(), [])
  const tempAhead = useMemo(() => new THREE.Vector3(), [])
  const tempWorld = useMemo(() => new THREE.Vector3(), [])
  const tempCam = useMemo(() => new THREE.Vector3(), [])
  const trailLeft = useMemo(() => new THREE.Vector3(), [])
  const trailRight = useMemo(() => new THREE.Vector3(), [])

  // Helper to initialize a flight
  const launchFlight = (flight: ActiveFlight, requestedType?: AircraftType | null) => {
    const flightNum = totalFlightsSpawned.current++
    const weather = {
      rain: weatherRT.rain,
      cloud: weatherRT.cloud,
      lightning: worldRT.lightning,
    }

    const type: AircraftType =
      requestedType && AIRCRAFT_DEFINITIONS[requestedType]
        ? requestedType
        : selectRandomAircraftType((flightNum * 0.381966 + Math.random() * 0.5) % 1.0, weather)

    const def = AIRCRAFT_DEFINITIONS[type]
    const routeIdx = (flightNum * 3 + (flight.isSecondary ? 4 : 0)) % CELESTIAL_ROUTES.length
    const route = CELESTIAL_ROUTES[routeIdx]

    flight.type = type
    flight.route = route
    flight.active = true
    flight.dodge = 0
    flight.progress = 0
    flight.duration = THREE.MathUtils.lerp(def.transitDuration[0], def.transitDuration[1], Math.random())
    flight.altitude = THREE.MathUtils.lerp(def.altitudeRange[0], def.altitudeRange[1], Math.random())
    flight.arcHeight = route.arcPeak + (flightNum % 3) * 0.8
    flight.startPos.set(route.start[0], flight.altitude, route.start[1])
    flight.endPos.set(route.end[0], flight.altitude, route.end[1])
    flight.liveryIndex = flightNum % CIVILIAN_LIVERIES[type].length
    flight.audioTimer = 0.5
  }

  useFrame((state, rawDt) => {
    // on the Moon: home's life waits, paused, for the riders to come back
    if (awayFromEarth(avatarRT().pos)) return
    const dt = Math.min(Math.max(rawDt, 1e-4), 1 / 20)
    const time = state.clock.elapsedTime
    const night = smoothstep(0.72, 0.98, worldRT.timeOfDay)
    const weatherActivity = Math.max(0, 1 - weatherRT.rain * 1.45 - night)
    birdActivity.current = damp(birdActivity.current, weatherActivity, 1.1, dt)

    // Bird formations
    birdFormations.current.forEach((formation, index) => {
      if (!formation) return
      if (
        index === 0 &&
        worldRT.introActive &&
        worldRT.introProgress >= 0.565 &&
        worldRT.introProgress <= 0.73 &&
        weatherActivity > 0.3
      ) {
        const arrival = smoothstep(0.565, 0.73, worldRT.introProgress)
        formation.visible = true
        formation.position.set(
          THREE.MathUtils.lerp(-18, 13, arrival),
          24 + Math.sin(arrival * Math.PI) * 1.5,
          THREE.MathUtils.lerp(15, 23, arrival),
        )
        formation.rotation.set(0, -0.9 + arrival * 0.35, Math.sin(time * 0.7) * 0.06)
        formation.scale.setScalar(0.92)
        return
      }
      formation.visible = birdActivity.current > 0.12 + index * 0.18
      const orbit = time * (0.045 + index * 0.012) + index * 2.8
      const radius = 48 + index * 12
      formation.position.set(
        HOME_CENTER.x + Math.cos(orbit) * radius,
        21 + index * 4 + Math.sin(time * 0.18 + index) * 1.2,
        HOME_CENTER.y + Math.sin(orbit) * radius * 0.72,
      )
      formation.rotation.y = -orbit + Math.PI * 0.5
      formation.rotation.z = Math.sin(time * 0.3 + index) * 0.08
      formation.scale.setScalar(0.55 + index * 0.12)
    })

    const pf = primaryFlight.current
    const sf = secondaryFlight.current
    const weather = { rain: weatherRT.rain, cloud: weatherRT.cloud, lightning: worldRT.lightning }

    // Air traffic is switched off by design: no aircraft, no
    // contrails and no blinking strobes or beacons in the sky. The launches
    // are commented out rather than deleted, so a flight is never active and
    // updateFlightInstance below just keeps every model hidden. To bring the
    // planes back, uncomment these two blocks.
    // // Manual debug trigger override
    // if (worldRT.airplaneRequested && !reducedMotion) {
    //   launchFlight(pf, (worldRT.aircraftRequestedType as AircraftType) ?? null)
    //   worldRT.airplaneRequested = false
    //   worldRT.aircraftRequestedType = null
    //   scheduleTimer.current = calculateNextSpawnInterval(false)
    // }

    // // Organic Scheduling System (45-90s initial delay, 3-8 min intervals)
    // if (!pf.active && !reducedMotion) {
    //   scheduleTimer.current -= dt
    //   if (scheduleTimer.current <= 0) {
    //     if (isAircraftWeatherPermitted("commercial_jet", weather)) {
    //       launchFlight(pf)
    //       scheduleTimer.current = calculateNextSpawnInterval(false)

    //       // 4% chance of rare simultaneous secondary flight on a distant non-intersecting route
    //       if (Math.random() < 0.04 && !sf.active) {
    //         launchFlight(sf)
    //       }
    //     } else {
    //       // Postpone during severe storm
    //       scheduleTimer.current = 45
    //     }
    //   }
    // }
    void [launchFlight, scheduleTimer, reducedMotion] // kept for the commented launches above

    // Shared lighting strobe & beacon pulses
    const strobePhase = (time * 0.85) % 1.0
    const isStrobe = strobePhase < 0.05 || (strobePhase > 0.12 && strobePhase < 0.17)
    const strobeOpacity = isStrobe ? 1.0 : 0.05
    const beaconPulse = Math.pow(Math.max(0, Math.sin(time * 2.8)), 3)
    const beaconOpacity = 0.15 + beaconPulse * 0.85

    // Helper to update a flight instance
    const updateFlightInstance = (
      flight: ActiveFlight,
      refs: AircraftMeshRefs,
      leftContrails: React.RefObject<Array<THREE.Mesh | null>>,
      rightContrails: React.RefObject<Array<THREE.Mesh | null>>,
    ) => {
      if (!flight.active) {
        if (refs.group.current) refs.group.current.visible = false
        for (let i = 0; i < CONTRAIL_PAIRS; i++) {
          if (leftContrails.current[i]) leftContrails.current[i]!.visible = false
          if (rightContrails.current[i]) rightContrails.current[i]!.visible = false
        }
        return
      }

      // Check if weather grounded current aircraft type
      if (!isAircraftWeatherPermitted(flight.type, weather)) {
        flight.active = false
        if (refs.group.current) refs.group.current.visible = false
        return
      }

      flight.progress += dt / flight.duration
      if (flight.progress >= 1) {
        flight.active = false
        if (refs.group.current) refs.group.current.visible = false
        for (let i = 0; i < CONTRAIL_PAIRS; i++) {
          if (leftContrails.current[i]) leftContrails.current[i]!.visible = false
          if (rightContrails.current[i]) rightContrails.current[i]!.visible = false
        }
        return
      }

      // Trajectory interpolation
      const getPosAt = (p: number, out: THREE.Vector3) => {
        out.lerpVectors(flight.startPos, flight.endPos, p)
        out.y = flight.altitude + Math.sin(p * Math.PI) * flight.arcHeight
        return out
      }

      getPosAt(flight.progress, flight.currentPos)
      getPosAt(Math.min(1, flight.progress + 0.003), tempAhead)

      const heading = Math.atan2(tempAhead.x - flight.currentPos.x, tempAhead.z - flight.currentPos.z)
      const pitch = Math.atan2(tempAhead.y - flight.currentPos.y, flight.currentPos.distanceTo(tempAhead))

      // Update active model visibility
      if (refs.commercialJet.current) refs.commercialJet.current.visible = flight.type === "commercial_jet"
      if (refs.regionalTurboprop.current) refs.regionalTurboprop.current.visible = flight.type === "regional_turboprop"
      if (refs.cargoTransport.current) refs.cargoTransport.current.visible = flight.type === "cargo_transport"
      if (refs.businessJet.current) refs.businessJet.current.visible = flight.type === "business_jet"
      if (refs.smallPropeller.current) refs.smallPropeller.current.visible = flight.type === "small_propeller"
      if (refs.helicopter.current) refs.helicopter.current.visible = flight.type === "helicopter"
      if (refs.glider.current) refs.glider.current.visible = flight.type === "glider"

      // Animated rotating propellers & rotors
      const def = AIRCRAFT_DEFINITIONS[flight.type]
      if (def.hasSpinningProp) {
        flight.propellerAngle += dt * 38.0
        if (refs.turbopropBladesL.current) refs.turbopropBladesL.current.rotation.z = flight.propellerAngle
        if (refs.turbopropBladesR.current) refs.turbopropBladesR.current.rotation.z = -flight.propellerAngle
        if (refs.smallPropBlades.current) refs.smallPropBlades.current.rotation.z = flight.propellerAngle
      }
      if (def.hasRotor) {
        flight.rotorAngle += dt * 26.0
        flight.tailRotorAngle += dt * 52.0
        if (refs.heliMainRotor.current) refs.heliMainRotor.current.rotation.y = flight.rotorAngle
        if (refs.heliTailRotor.current) refs.heliTailRotor.current.rotation.x = flight.tailRotorAngle
      }

      // Give the riders room: a flight that would pass within ~90 m of the
      // view eases its height away from it (as traffic is kept clear of a
      // known obstacle), so a climbing Pegasus never flies through an
      // airliner and its lamps never fill the screen
      if (refs.group.current?.parent) {
        tempWorld.copy(flight.currentPos)
        tempWorld.y += flight.dodge
        refs.group.current.parent.localToWorld(tempWorld)
        state.camera.getWorldPosition(tempCam)
        const dist = tempWorld.distanceTo(tempCam)
        const away = tempWorld.y >= tempCam.y ? 1 : -1
        const want = dist < 90 ? away * (90 - dist) * 1.4 : 0
        flight.dodge += (want - flight.dodge) * (1 - Math.exp(-dt * (Math.abs(want) > Math.abs(flight.dodge) ? 1.6 : 0.3)))
      }
      flight.currentPos.y += flight.dodge

      // Update group transform
      if (refs.group.current) {
        refs.group.current.visible = true
        refs.group.current.position.copy(flight.currentPos)
        const roll = Math.sin(time * 0.35 + flight.duration) * (flight.type === "helicopter" ? 0.06 : 0.03)
        refs.group.current.rotation.set(pitch, heading, roll)
      }

      // Lighting pulses
      refs.strobes.current.forEach((mat) => {
        if (mat) mat.opacity = strobeOpacity
      })
      refs.beacons.current.forEach((mat) => {
        if (mat) mat.opacity = beaconOpacity
      })

      // Distance-attenuated spatial audio
      flight.audioTimer -= dt
      if (flight.audioTimer <= 0) {
        flight.audioTimer = def.audioProfile === "rotor_rhythm" ? 0.5 : 1.2
        const gain = calculateAircraftSpatialAudio(flight.currentPos, avatarRT().pos, def.maxAudioVolume)
        if (gain > 0.001) {
          if (def.audioProfile === "distant_jet") sfx.distantJet(gain)
          else if (def.audioProfile === "turboprop_hum") sfx.turbopropHum(gain)
          else if (def.audioProfile === "cargo_rumble") sfx.cargoRumble(gain)
          else if (def.audioProfile === "light_prop") sfx.lightProp(gain)
          else if (def.audioProfile === "rotor_rhythm") sfx.rotorRhythm(gain)
        }
      }

      // Contrails for high-altitude jets
      const showContrail =
        def.contrailEligible &&
        flight.altitude >= def.minContrailAltitude &&
        weather.rain < 0.35

      if (showContrail) {
        const windSpeed = weatherRT.wind * 0.08
        const windRad = weatherRT.windDirectionRad
        const windDriftX = Math.cos(windRad) * windSpeed
        const windDriftZ = Math.sin(windRad) * windSpeed

        const engineL = def.engineOffsets[0] ?? { x: -1.15, y: -0.2, z: -0.45 }
        const engineR = def.engineOffsets[1] ?? { x: 1.15, y: -0.2, z: -0.45 }

        for (let i = 0; i < CONTRAIL_PAIRS; i++) {
          const leftMesh = leftContrails.current[i]
          const rightMesh = rightContrails.current[i]
          if (!leftMesh || !rightMesh) continue

          const stepFraction = 0.0036
          const trailProg = flight.progress - (i + 1.2) * stepFraction

          if (trailProg <= 0) {
            leftMesh.visible = false
            rightMesh.visible = false
            continue
          }

          leftMesh.visible = true
          rightMesh.visible = true

          getPosAt(trailProg, tempPos)
          const ageNorm = i / CONTRAIL_PAIRS
          const driftAge = (i + 1) * 0.55

          const cosH = Math.cos(heading)
          const sinH = Math.sin(heading)

          const lEngineX = tempPos.x + engineL.x * cosH + engineL.z * sinH + windDriftX * driftAge
          const lEngineZ = tempPos.z - engineL.x * sinH + engineL.z * cosH + windDriftZ * driftAge
          const lEngineY = tempPos.y + engineL.y

          const rEngineX = tempPos.x + engineR.x * cosH + engineR.z * sinH + windDriftX * driftAge
          const rEngineZ = tempPos.z - engineR.x * sinH + engineR.z * cosH + windDriftZ * driftAge
          const rEngineY = tempPos.y + engineR.y

          trailLeft.set(lEngineX, lEngineY, lEngineZ)
          trailRight.set(rEngineX, rEngineY, rEngineZ)

          leftMesh.position.copy(trailLeft)
          rightMesh.position.copy(trailRight)

          const scaleWidth = 0.12 + Math.pow(ageNorm, 0.65) * 0.72
          const scaleLength = 0.45 + ageNorm * 0.6
          leftMesh.scale.set(scaleWidth, 0.08 + ageNorm * 0.25, scaleLength)
          rightMesh.scale.set(scaleWidth, 0.08 + ageNorm * 0.25, scaleLength)

          leftMesh.rotation.set(pitch, heading, 0)
          rightMesh.rotation.set(pitch, heading, 0)
        }
      } else {
        for (let i = 0; i < CONTRAIL_PAIRS; i++) {
          if (leftContrails.current[i]) leftContrails.current[i]!.visible = false
          if (rightContrails.current[i]) rightContrails.current[i]!.visible = false
        }
      }
    }

    const primaryMeshRefs: AircraftMeshRefs = {
      group: pGroup,
      commercialJet: pCommercialJet,
      regionalTurboprop: pRegionalTurboprop,
      cargoTransport: pCargoTransport,
      businessJet: pBusinessJet,
      smallPropeller: pSmallPropeller,
      helicopter: pHelicopter,
      glider: pGlider,
      turbopropBladesL: pTurbopropBladesL,
      turbopropBladesR: pTurbopropBladesR,
      smallPropBlades: pSmallPropBlades,
      heliMainRotor: pHeliMainRotor,
      heliTailRotor: pHeliTailRotor,
      strobes: pStrobes,
      beacons: pBeacons,
    }

    const secondaryMeshRefs: AircraftMeshRefs = {
      group: sGroup,
      commercialJet: sCommercialJet,
      regionalTurboprop: sRegionalTurboprop,
      cargoTransport: sCargoTransport,
      businessJet: sBusinessJet,
      smallPropeller: sSmallPropeller,
      helicopter: sHelicopter,
      glider: sGlider,
      turbopropBladesL: sTurbopropBladesL,
      turbopropBladesR: sTurbopropBladesR,
      smallPropBlades: sSmallPropBlades,
      heliMainRotor: sHeliMainRotor,
      heliTailRotor: sHeliTailRotor,
      strobes: sStrobes,
      beacons: sBeacons,
    }

    updateFlightInstance(pf, primaryMeshRefs, primaryLeftContrail, primaryRightContrail)
    updateFlightInstance(sf, secondaryMeshRefs, secondaryLeftContrail, secondaryRightContrail)

    // Contrail color harmonization across day/sunset/night
    const tod = worldRT.timeOfDay
    const golden = Math.max(0, 1 - Math.abs(tod - 0.72) * 3.5)
    const dusk = Math.max(0, (tod - 0.78) * 4)
    if (contrailMat.current) {
      contrailMat.current.color.setRGB(
        1.0,
        1.0 - golden * 0.12 - dusk * 0.4,
        1.0 - golden * 0.32 - dusk * 0.45,
      )
    }
  })

  return (
    <>
      {/* Primary Flight Group with 7 Pre-Instantiated Models */}
      <group ref={pGroup} visible={false}>
        <group ref={pCommercialJet} visible={false}>
          <CommercialJetModel strobes={pStrobes} beacons={pBeacons} offset={0} />
        </group>
        <group ref={pRegionalTurboprop} visible={false}>
          <RegionalTurbopropModel bladesL={pTurbopropBladesL} bladesR={pTurbopropBladesR} strobes={pStrobes} beacons={pBeacons} offset={2} />
        </group>
        <group ref={pCargoTransport} visible={false}>
          <CargoTransportModel strobes={pStrobes} beacons={pBeacons} offset={4} />
        </group>
        <group ref={pBusinessJet} visible={false}>
          <BusinessJetModel strobes={pStrobes} beacons={pBeacons} offset={6} />
        </group>
        <group ref={pSmallPropeller} visible={false}>
          <SmallPropellerModel blades={pSmallPropBlades} strobes={pStrobes} beacons={pBeacons} offset={8} />
        </group>
        <group ref={pHelicopter} visible={false}>
          <HelicopterModel mainRotor={pHeliMainRotor} tailRotor={pHeliTailRotor} beacons={pBeacons} offset={10} />
        </group>
        <group ref={pGlider} visible={false}>
          <GliderModel offset={12} />
        </group>
      </group>

      {/* Secondary Rare Flight Group */}
      <group ref={sGroup} visible={false}>
        <group ref={sCommercialJet} visible={false}>
          <CommercialJetModel strobes={sStrobes} beacons={sBeacons} offset={0} />
        </group>
        <group ref={sRegionalTurboprop} visible={false}>
          <RegionalTurbopropModel bladesL={sTurbopropBladesL} bladesR={sTurbopropBladesR} strobes={sStrobes} beacons={sBeacons} offset={2} />
        </group>
        <group ref={sCargoTransport} visible={false}>
          <CargoTransportModel strobes={sStrobes} beacons={sBeacons} offset={4} />
        </group>
        <group ref={sBusinessJet} visible={false}>
          <BusinessJetModel strobes={sStrobes} beacons={sBeacons} offset={6} />
        </group>
        <group ref={sSmallPropeller} visible={false}>
          <SmallPropellerModel blades={sSmallPropBlades} strobes={sStrobes} beacons={sBeacons} offset={8} />
        </group>
        <group ref={sHelicopter} visible={false}>
          <HelicopterModel mainRotor={sHeliMainRotor} tailRotor={sHeliTailRotor} beacons={sBeacons} offset={10} />
        </group>
        <group ref={sGlider} visible={false}>
          <GliderModel offset={12} />
        </group>
      </group>

      {/* Primary Contrail Ribbons */}
      {Array.from({ length: CONTRAIL_PAIRS }).map((_, i) => {
        const segAlpha = Math.pow(1 - i / CONTRAIL_PAIRS, 1.4) * 0.42
        return (
          <group key={`p-contrail:${i}`}>
            <mesh
              ref={(el) => {
                primaryLeftContrail.current[i] = el
              }}
              visible={false}
              renderOrder={-3}
            >
              <planeGeometry args={[1, 1]} />
              <meshBasicMaterial
                ref={i === 0 ? contrailMat : undefined}
                map={vaporTexture}
                color="#ffffff"
                transparent
                opacity={segAlpha}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                side={THREE.DoubleSide}
              />
            </mesh>
            <mesh
              ref={(el) => {
                primaryRightContrail.current[i] = el
              }}
              visible={false}
              renderOrder={-3}
            >
              <planeGeometry args={[1, 1]} />
              <meshBasicMaterial
                map={vaporTexture}
                color="#ffffff"
                transparent
                opacity={segAlpha}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        )
      })}

      {/* Secondary Contrail Ribbons */}
      {Array.from({ length: CONTRAIL_PAIRS }).map((_, i) => {
        const segAlpha = Math.pow(1 - i / CONTRAIL_PAIRS, 1.4) * 0.42
        return (
          <group key={`s-contrail:${i}`}>
            <mesh
              ref={(el) => {
                secondaryLeftContrail.current[i] = el
              }}
              visible={false}
              renderOrder={-3}
            >
              <planeGeometry args={[1, 1]} />
              <meshBasicMaterial
                map={vaporTexture}
                color="#ffffff"
                transparent
                opacity={segAlpha}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                side={THREE.DoubleSide}
              />
            </mesh>
            <mesh
              ref={(el) => {
                secondaryRightContrail.current[i] = el
              }}
              visible={false}
              renderOrder={-3}
            >
              <planeGeometry args={[1, 1]} />
              <meshBasicMaterial
                map={vaporTexture}
                color="#ffffff"
                transparent
                opacity={segAlpha}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        )
      })}

      {/* Distant Bird Formations */}
      {Array.from({ length: 3 }).map((_, i) => (
        <group
          key={`formation:${i}`}
          ref={(el) => {
            birdFormations.current[i] = el
          }}
        >
          {Array.from({ length: 5 }).map((__, j) => {
            const offset = (j - 2) * 1.4
            const depth = Math.abs(j - 2) * -1.2
            return (
              <mesh key={j} position={[offset, 0, depth]}>
                <coneGeometry args={[0.22, 0.65, 4]} />
                <meshStandardMaterial color="#334155" roughness={0.9} />
              </mesh>
            )
          })}
        </group>
      ))}
    </>
  )
}

/** 1. Commercial Airliner (Twin-Turbofan Jet) */
const CommercialJetModel = ({
  strobes,
  beacons,
  offset,
}: {
  strobes: React.RefObject<Array<THREE.MeshBasicMaterial | null>>
  beacons: React.RefObject<Array<THREE.MeshBasicMaterial | null>>
  offset: number
}): React.ReactElement => (
  <group scale={1.2}>
    {/* Fuselage */}
    <mesh position={[0, 0, 0]} rotation-x={Math.PI / 2}>
      <cylinderGeometry args={[0.42, 0.42, 4.2, 16]} />
      <meshStandardMaterial color="#f8fafc" roughness={0.35} metalness={0.15} />
    </mesh>
    {/* Aerodynamic Nose Cone */}
    <mesh position={[0, -0.02, 2.45]} rotation-x={Math.PI / 2}>
      <coneGeometry args={[0.42, 0.9, 16]} />
      <meshStandardMaterial color="#f8fafc" roughness={0.35} metalness={0.15} />
    </mesh>
    {/* Cockpit Window Visor */}
    <mesh position={[0, 0.16, 2.22]} rotation-x={0.35}>
      <boxGeometry args={[0.48, 0.14, 0.32]} />
      <meshBasicMaterial color="#0f172a" />
    </mesh>
    {/* Passenger Cabin Window Ribbons */}
    <mesh position={[-0.43, 0.08, 0.2]}>
      <boxGeometry args={[0.02, 0.08, 2.8]} />
      <meshBasicMaterial color="#1e293b" />
    </mesh>
    <mesh position={[0.43, 0.08, 0.2]}>
      <boxGeometry args={[0.02, 0.08, 2.8]} />
      <meshBasicMaterial color="#1e293b" />
    </mesh>
    {/* Swept Main Wings with Dihedral */}
    <group position={[0, -0.12, 0.15]}>
      <mesh position={[-1.65, 0.06, -0.45]} rotation-z={-0.05} rotation-y={-0.38}>
        <boxGeometry args={[2.5, 0.06, 0.85]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.4} />
      </mesh>
      <mesh position={[1.65, 0.06, -0.45]} rotation-z={0.05} rotation-y={0.38}>
        <boxGeometry args={[2.5, 0.06, 0.85]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.4} />
      </mesh>
      <mesh position={[-2.85, 0.25, -0.92]}>
        <boxGeometry args={[0.04, 0.36, 0.28]} />
        <meshStandardMaterial color="#0284c7" roughness={0.3} />
      </mesh>
      <mesh position={[2.85, 0.25, -0.92]}>
        <boxGeometry args={[0.04, 0.36, 0.28]} />
        <meshStandardMaterial color="#0284c7" roughness={0.3} />
      </mesh>
    </group>
    {/* Twin Under-Wing Turbofan Engines */}
    {[-1.15, 1.15].map((x, i) => (
      <group key={i} position={[x, -0.25, 0.1]}>
        <mesh rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.22, 0.22, 0.95, 12]} />
          <meshStandardMaterial color="#94a3b8" roughness={0.25} metalness={0.4} />
        </mesh>
        <mesh position={[0, 0, 0.48]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.16, 0.16, 0.04, 12]} />
          <meshBasicMaterial color="#0f172a" />
        </mesh>
      </group>
    ))}
    {/* Tail Empennage */}
    <group position={[0, 0, -2.1]}>
      <mesh position={[0, 0.72, -0.22]} rotation-x={-0.45}>
        <boxGeometry args={[0.07, 1.25, 0.95]} />
        <meshStandardMaterial color="#0369a1" roughness={0.35} />
      </mesh>
      <mesh position={[-0.85, 0.12, -0.32]} rotation-y={-0.32}>
        <boxGeometry args={[1.35, 0.04, 0.52]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.4} />
      </mesh>
      <mesh position={[0.85, 0.12, -0.32]} rotation-y={0.32}>
        <boxGeometry args={[1.35, 0.04, 0.52]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.4} />
      </mesh>
    </group>
    {/* Navigation & Strobe Lights */}
    <mesh position={[-2.88, -0.06, -0.92]}>
      <sphereGeometry args={[0.07, 8, 8]} />
      <meshBasicMaterial color="#ef4444" />
    </mesh>
    <mesh position={[2.88, -0.06, -0.92]}>
      <sphereGeometry args={[0.07, 8, 8]} />
      <meshBasicMaterial color="#22c55e" />
    </mesh>
    <mesh position={[-2.92, -0.06, -0.95]}>
      <sphereGeometry args={[0.09, 8, 8]} />
      <meshBasicMaterial
        ref={(el) => {
          strobes.current[offset] = el
        }}
        color="#ffffff"
        transparent
        opacity={0}
      />
    </mesh>
    <mesh position={[2.92, -0.06, -0.95]}>
      <sphereGeometry args={[0.09, 8, 8]} />
      <meshBasicMaterial
        ref={(el) => {
          strobes.current[offset + 1] = el
        }}
        color="#ffffff"
        transparent
        opacity={0}
      />
    </mesh>
    <mesh position={[0, 0.48, 0.3]}>
      <sphereGeometry args={[0.08, 8, 8]} />
      <meshBasicMaterial
        ref={(el) => {
          beacons.current[offset] = el
        }}
        color="#ef4444"
        transparent
        opacity={0}
      />
    </mesh>
    <mesh position={[0, -0.48, -0.1]}>
      <sphereGeometry args={[0.08, 8, 8]} />
      <meshBasicMaterial
        ref={(el) => {
          beacons.current[offset + 1] = el
        }}
        color="#ef4444"
        transparent
        opacity={0}
      />
    </mesh>
  </group>
)

/** 2. Regional Commuter (Twin-Turboprop) */
const RegionalTurbopropModel = ({
  bladesL,
  bladesR,
  strobes,
  beacons,
  offset,
}: {
  bladesL: React.RefObject<THREE.Group | null>
  bladesR: React.RefObject<THREE.Group | null>
  strobes: React.RefObject<Array<THREE.MeshBasicMaterial | null>>
  beacons: React.RefObject<Array<THREE.MeshBasicMaterial | null>>
  offset: number
}): React.ReactElement => (
  <group scale={1.15}>
    <mesh position={[0, 0, 0]} rotation-x={Math.PI / 2}>
      <cylinderGeometry args={[0.36, 0.36, 3.6, 14]} />
      <meshStandardMaterial color="#f8fafc" roughness={0.4} />
    </mesh>
    <mesh position={[0, -0.02, 2.05]} rotation-x={Math.PI / 2}>
      <coneGeometry args={[0.36, 0.75, 14]} />
      <meshStandardMaterial color="#f8fafc" roughness={0.4} />
    </mesh>
    <mesh position={[0, 0.34, 0.2]}>
      <boxGeometry args={[4.2, 0.06, 0.65]} />
      <meshStandardMaterial color="#0d9488" roughness={0.4} />
    </mesh>
    {/* Turboprop Nacelles & Spinners */}
    {[-1.05, 1.05].map((x, i) => (
      <group key={i} position={[x, 0.32, 0.4]}>
        <mesh rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.18, 0.18, 0.95, 10]} />
          <meshStandardMaterial color="#475569" roughness={0.4} />
        </mesh>
        <mesh position={[0, 0, 0.55]} rotation-x={Math.PI / 2}>
          <coneGeometry args={[0.09, 0.22, 10]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.8} />
        </mesh>
        {/* Spinning Propeller Blades */}
        <group ref={i === 0 ? bladesL : bladesR} position={[0, 0, 0.52]}>
          <mesh>
            <boxGeometry args={[0.82, 0.04, 0.01]} />
            <meshBasicMaterial color="#0f172a" />
          </mesh>
          <mesh rotation-z={Math.PI / 3}>
            <boxGeometry args={[0.82, 0.04, 0.01]} />
            <meshBasicMaterial color="#0f172a" />
          </mesh>
          <mesh rotation-z={-Math.PI / 3}>
            <boxGeometry args={[0.82, 0.04, 0.01]} />
            <meshBasicMaterial color="#0f172a" />
          </mesh>
          <mesh>
            <circleGeometry args={[0.42, 16]} />
            <meshBasicMaterial color="#94a3b8" transparent opacity={0.25} />
          </mesh>
        </group>
      </group>
    ))}
    {/* T-Tail */}
    <group position={[0, 0, -1.8]}>
      <mesh position={[0, 0.72, -0.15]} rotation-x={-0.35}>
        <boxGeometry args={[0.06, 1.35, 0.75]} />
        <meshStandardMaterial color="#0f766e" roughness={0.35} />
      </mesh>
      <mesh position={[0, 1.35, -0.38]}>
        <boxGeometry args={[1.65, 0.04, 0.45]} />
        <meshStandardMaterial color="#0d9488" roughness={0.4} />
      </mesh>
    </group>
    {/* Lights */}
    <mesh position={[-2.12, 0.34, 0.2]}>
      <sphereGeometry args={[0.06, 8, 8]} />
      <meshBasicMaterial color="#ef4444" />
    </mesh>
    <mesh position={[2.12, 0.34, 0.2]}>
      <sphereGeometry args={[0.06, 8, 8]} />
      <meshBasicMaterial color="#22c55e" />
    </mesh>
    <mesh position={[0, 1.38, -0.42]}>
      <sphereGeometry args={[0.07, 8, 8]} />
      <meshBasicMaterial
        ref={(el) => {
          strobes.current[offset] = el
        }}
        color="#ffffff"
        transparent
        opacity={0}
      />
    </mesh>
    <mesh position={[0, 0.42, 0.2]}>
      <sphereGeometry args={[0.07, 8, 8]} />
      <meshBasicMaterial
        ref={(el) => {
          beacons.current[offset] = el
        }}
        color="#ef4444"
        transparent
        opacity={0}
      />
    </mesh>
  </group>
)

/** 3. Heavy Cargo Transport */
const CargoTransportModel = ({
  strobes,
  beacons,
  offset,
}: {
  strobes: React.RefObject<Array<THREE.MeshBasicMaterial | null>>
  beacons: React.RefObject<Array<THREE.MeshBasicMaterial | null>>
  offset: number
}): React.ReactElement => (
  <group scale={1.3}>
    <mesh position={[0, 0, 0]}>
      <boxGeometry args={[0.92, 0.88, 4.4]} />
      <meshStandardMaterial color="#e2e8f0" roughness={0.45} />
    </mesh>
    <mesh position={[0, 0, 2.45]} rotation-x={Math.PI / 2}>
      <cylinderGeometry args={[0.44, 0.44, 0.6, 12]} />
      <meshStandardMaterial color="#e2e8f0" roughness={0.45} />
    </mesh>
    <mesh position={[0, 0.42, 0.2]}>
      <boxGeometry args={[5.4, 0.08, 0.95]} />
      <meshStandardMaterial color="#64748b" roughness={0.4} />
    </mesh>
    {[-1.8, -1.0, 1.0, 1.8].map((x, i) => (
      <mesh key={i} position={[x, 0.22, 0.2]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.18, 0.18, 0.75, 10]} />
        <meshStandardMaterial color="#475569" roughness={0.3} metalness={0.3} />
      </mesh>
    ))}
    <group position={[0, 0, -2.2]}>
      <mesh position={[0, 0.85, -0.3]} rotation-x={-0.38}>
        <boxGeometry args={[0.08, 1.55, 1.15]} />
        <meshStandardMaterial color="#334155" roughness={0.4} />
      </mesh>
      <mesh position={[0, 1.55, -0.7]}>
        <boxGeometry args={[2.1, 0.05, 0.62]} />
        <meshStandardMaterial color="#64748b" roughness={0.4} />
      </mesh>
    </group>
    <mesh position={[-2.72, 0.42, 0.2]}>
      <sphereGeometry args={[0.07, 8, 8]} />
      <meshBasicMaterial color="#ef4444" />
    </mesh>
    <mesh position={[2.72, 0.42, 0.2]}>
      <sphereGeometry args={[0.07, 8, 8]} />
      <meshBasicMaterial color="#22c55e" />
    </mesh>
    <mesh position={[0, 1.62, -0.75]}>
      <sphereGeometry args={[0.09, 8, 8]} />
      <meshBasicMaterial
        ref={(el) => {
          strobes.current[offset] = el
        }}
        color="#ffffff"
        transparent
        opacity={0}
      />
    </mesh>
    <mesh position={[0, 0.52, 0.5]}>
      <sphereGeometry args={[0.08, 8, 8]} />
      <meshBasicMaterial
        ref={(el) => {
          beacons.current[offset] = el
        }}
        color="#ef4444"
        transparent
        opacity={0}
      />
    </mesh>
  </group>
)

/** 4. Executive Business Jet */
const BusinessJetModel = ({
  strobes,
  beacons,
  offset,
}: {
  strobes: React.RefObject<Array<THREE.MeshBasicMaterial | null>>
  beacons: React.RefObject<Array<THREE.MeshBasicMaterial | null>>
  offset: number
}): React.ReactElement => (
  <group scale={1.1}>
    <mesh position={[0, 0, 0]} rotation-x={Math.PI / 2}>
      <cylinderGeometry args={[0.3, 0.3, 3.2, 14]} />
      <meshStandardMaterial color="#fdfefe" roughness={0.25} metalness={0.3} />
    </mesh>
    <mesh position={[0, -0.02, 1.95]} rotation-x={Math.PI / 2}>
      <coneGeometry args={[0.3, 0.9, 14]} />
      <meshStandardMaterial color="#fdfefe" roughness={0.25} metalness={0.3} />
    </mesh>
    <group position={[0, -0.1, 0.1]}>
      <mesh position={[-1.25, 0, -0.32]} rotation-z={-0.08} rotation-y={-0.45}>
        <boxGeometry args={[2.0, 0.05, 0.72]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.3} />
      </mesh>
      <mesh position={[1.25, 0, -0.32]} rotation-z={0.08} rotation-y={0.45}>
        <boxGeometry args={[2.0, 0.05, 0.72]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.3} />
      </mesh>
      <mesh position={[-2.25, 0.22, -0.75]}>
        <boxGeometry args={[0.03, 0.34, 0.22]} />
        <meshStandardMaterial color="#e2b87f" roughness={0.2} />
      </mesh>
      <mesh position={[2.25, 0.22, -0.75]}>
        <boxGeometry args={[0.03, 0.34, 0.22]} />
        <meshStandardMaterial color="#e2b87f" roughness={0.2} />
      </mesh>
    </group>
    {[-0.48, 0.48].map((x, i) => (
      <mesh key={i} position={[x, 0.18, -1.15]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.16, 0.16, 0.78, 12]} />
        <meshStandardMaterial color="#c59a58" roughness={0.3} metalness={0.4} />
      </mesh>
    ))}
    <group position={[0, 0, -1.6]}>
      <mesh position={[0, 0.62, -0.2]} rotation-x={-0.52}>
        <boxGeometry args={[0.05, 1.1, 0.68]} />
        <meshStandardMaterial color="#c59a58" roughness={0.25} />
      </mesh>
      <mesh position={[0, 1.08, -0.48]}>
        <boxGeometry args={[1.35, 0.03, 0.42]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.3} />
      </mesh>
    </group>
    <mesh position={[-2.28, -0.06, -0.75]}>
      <sphereGeometry args={[0.06, 8, 8]} />
      <meshBasicMaterial color="#ef4444" />
    </mesh>
    <mesh position={[2.28, -0.06, -0.75]}>
      <sphereGeometry args={[0.06, 8, 8]} />
      <meshBasicMaterial color="#22c55e" />
    </mesh>
    <mesh position={[0, 1.12, -0.52]}>
      <sphereGeometry args={[0.07, 8, 8]} />
      <meshBasicMaterial
        ref={(el) => {
          strobes.current[offset] = el
        }}
        color="#ffffff"
        transparent
        opacity={0}
      />
    </mesh>
    <mesh position={[0, 0.38, 0.3]}>
      <sphereGeometry args={[0.06, 8, 8]} />
      <meshBasicMaterial
        ref={(el) => {
          beacons.current[offset] = el
        }}
        color="#ef4444"
        transparent
        opacity={0}
      />
    </mesh>
  </group>
)

/** 5. Light Civilian Propeller Monoplane */
const SmallPropellerModel = ({
  blades,
  strobes,
  beacons,
  offset,
}: {
  blades: React.RefObject<THREE.Group | null>
  strobes: React.RefObject<Array<THREE.MeshBasicMaterial | null>>
  beacons: React.RefObject<Array<THREE.MeshBasicMaterial | null>>
  offset: number
}): React.ReactElement => (
  <group scale={1.0}>
    <mesh position={[0, 0, 0]}>
      <boxGeometry args={[0.54, 0.58, 2.4]} />
      <meshStandardMaterial color="#fef08a" roughness={0.4} />
    </mesh>
    <mesh position={[0, 0.18, 0.48]} rotation-x={0.45}>
      <boxGeometry args={[0.5, 0.32, 0.35]} />
      <meshBasicMaterial color="#1e293b" />
    </mesh>
    <group position={[0, 0.32, 0.2]}>
      <mesh>
        <boxGeometry args={[3.2, 0.04, 0.58]} />
        <meshStandardMaterial color="#fef9c3" roughness={0.4} />
      </mesh>
      <mesh position={[-0.85, -0.22, 0]} rotation-z={0.42}>
        <cylinderGeometry args={[0.015, 0.015, 0.65, 5]} />
        <meshStandardMaterial color="#94a3b8" />
      </mesh>
      <mesh position={[0.85, -0.22, 0]} rotation-z={-0.42}>
        <cylinderGeometry args={[0.015, 0.015, 0.65, 5]} />
        <meshStandardMaterial color="#94a3b8" />
      </mesh>
    </group>
    <group position={[0, 0, 1.22]}>
      <mesh rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.22, 0.22, 0.32, 10]} />
        <meshStandardMaterial color="#ca8a04" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0, 0.18]} rotation-x={Math.PI / 2}>
        <coneGeometry args={[0.08, 0.18, 8]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.9} />
      </mesh>
      <group ref={blades} position={[0, 0, 0.16]}>
        <mesh>
          <boxGeometry args={[0.75, 0.045, 0.01]} />
          <meshBasicMaterial color="#0f172a" />
        </mesh>
        <mesh>
          <circleGeometry args={[0.38, 14]} />
          <meshBasicMaterial color="#94a3b8" transparent opacity={0.28} />
        </mesh>
      </group>
    </group>
    <group position={[0, -0.36, 0.3]}>
      {[-0.32, 0.32].map((x, i) => (
        <group key={i} position={[x, 0, 0]}>
          <mesh rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.08, 0.08, 0.05, 8]} />
            <meshStandardMaterial color="#1e293b" />
          </mesh>
        </group>
      ))}
      <mesh position={[0, -0.02, 0.75]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.06, 0.06, 0.04, 8]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
    </group>
    <group position={[0, 0, -1.2]}>
      <mesh position={[0, 0.35, -0.1]} rotation-x={-0.35}>
        <boxGeometry args={[0.04, 0.65, 0.48]} />
        <meshStandardMaterial color="#a16207" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.05, -0.2]}>
        <boxGeometry args={[1.05, 0.03, 0.35]} />
        <meshStandardMaterial color="#fef9c3" roughness={0.4} />
      </mesh>
    </group>
    <mesh position={[-1.62, 0.32, 0.2]}>
      <sphereGeometry args={[0.05, 8, 8]} />
      <meshBasicMaterial color="#ef4444" />
    </mesh>
    <mesh position={[1.62, 0.32, 0.2]}>
      <sphereGeometry args={[0.05, 8, 8]} />
      <meshBasicMaterial color="#22c55e" />
    </mesh>
    <mesh position={[0, 0.68, -0.3]}>
      <sphereGeometry args={[0.06, 8, 8]} />
      <meshBasicMaterial
        ref={(el) => {
          strobes.current[offset] = el
        }}
        color="#ffffff"
        transparent
        opacity={0}
      />
    </mesh>
    <mesh position={[0, 0.42, 0.1]}>
      <sphereGeometry args={[0.05, 8, 8]} />
      <meshBasicMaterial
        ref={(el) => {
          beacons.current[offset] = el
        }}
        color="#ef4444"
        transparent
        opacity={0}
      />
    </mesh>
  </group>
)

/** 6. Scenic Civilian Helicopter */
const HelicopterModel = ({
  mainRotor,
  tailRotor,
  beacons,
  offset,
}: {
  mainRotor: React.RefObject<THREE.Group | null>
  tailRotor: React.RefObject<THREE.Group | null>
  beacons: React.RefObject<Array<THREE.MeshBasicMaterial | null>>
  offset: number
}): React.ReactElement => (
  <group scale={1.15}>
    <mesh position={[0, 0, 0.3]}>
      <sphereGeometry args={[0.48, 14, 12]} />
      <meshStandardMaterial color="#0284c7" roughness={0.3} />
    </mesh>
    <mesh position={[0, 0.08, 0.55]} scale={[0.9, 0.85, 1.1]}>
      <sphereGeometry args={[0.44, 12, 10]} />
      <meshStandardMaterial color="#0f172a" roughness={0.1} metalness={0.6} />
    </mesh>
    <mesh position={[0, 0.45, 0.1]}>
      <boxGeometry args={[0.32, 0.22, 0.72]} />
      <meshStandardMaterial color="#f8fafc" roughness={0.35} />
    </mesh>
    <mesh position={[0, 0.62, 0.15]}>
      <cylinderGeometry args={[0.04, 0.04, 0.18, 8]} />
      <meshStandardMaterial color="#94a3b8" metalness={0.8} />
    </mesh>
    <group ref={mainRotor} position={[0, 0.72, 0.15]}>
      <mesh>
        <boxGeometry args={[3.8, 0.015, 0.08]} />
        <meshBasicMaterial color="#1e293b" />
      </mesh>
      <mesh rotation-y={Math.PI / 2}>
        <boxGeometry args={[3.8, 0.015, 0.08]} />
        <meshBasicMaterial color="#1e293b" />
      </mesh>
      <mesh rotation-x={Math.PI / 2}>
        <circleGeometry args={[1.9, 20]} />
        <meshBasicMaterial color="#64748b" transparent opacity={0.25} side={THREE.DoubleSide} />
      </mesh>
    </group>
    <mesh position={[0, 0.12, -1.25]} rotation-x={Math.PI / 2}>
      <cylinderGeometry args={[0.1, 0.18, 2.2, 8]} />
      <meshStandardMaterial color="#0284c7" roughness={0.35} />
    </mesh>
    <group position={[0, 0.25, -2.35]}>
      <mesh rotation-x={-0.25}>
        <boxGeometry args={[0.035, 0.55, 0.32]} />
        <meshStandardMaterial color="#075985" roughness={0.35} />
      </mesh>
      <group ref={tailRotor} position={[0.05, 0.18, 0]}>
        <mesh>
          <boxGeometry args={[0.01, 0.68, 0.035]} />
          <meshBasicMaterial color="#0f172a" />
        </mesh>
        <mesh rotation-y={Math.PI / 2}>
          <circleGeometry args={[0.34, 12]} />
          <meshBasicMaterial color="#94a3b8" transparent opacity={0.3} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
    <group position={[0, -0.48, 0.15]}>
      {[-0.38, 0.38].map((x, i) => (
        <group key={i} position={[x, 0, 0]}>
          <mesh rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.025, 0.025, 1.7, 6]} />
            <meshStandardMaterial color="#64748b" metalness={0.7} />
          </mesh>
          <mesh position={[0, 0.08, 0.85]} rotation-x={0.45}>
            <cylinderGeometry args={[0.025, 0.025, 0.22, 6]} />
            <meshStandardMaterial color="#64748b" metalness={0.7} />
          </mesh>
          <mesh position={[0, 0.16, 0.35]}>
            <cylinderGeometry args={[0.018, 0.018, 0.32, 5]} />
            <meshStandardMaterial color="#64748b" metalness={0.7} />
          </mesh>
          <mesh position={[0, 0.16, -0.35]}>
            <cylinderGeometry args={[0.018, 0.018, 0.32, 5]} />
            <meshStandardMaterial color="#64748b" metalness={0.7} />
          </mesh>
        </group>
      ))}
    </group>
    <mesh position={[0, 0.58, 0.15]}>
      <sphereGeometry args={[0.07, 8, 8]} />
      <meshBasicMaterial
        ref={(el) => {
          beacons.current[offset] = el
        }}
        color="#ef4444"
        transparent
        opacity={0}
      />
    </mesh>
    <mesh position={[0, -0.42, 0.15]}>
      <sphereGeometry args={[0.06, 8, 8]} />
      <meshBasicMaterial
        ref={(el) => {
          beacons.current[offset + 1] = el
        }}
        color="#ef4444"
        transparent
        opacity={0}
      />
    </mesh>
  </group>
)

/** 7. Soaring Recreational Sailplane (Glider) */
const GliderModel = ({
  offset: _offset,
}: {
  offset: number
}): React.ReactElement => (
  <group scale={1.1}>
    <mesh position={[0, 0, 0]} rotation-x={Math.PI / 2}>
      <cylinderGeometry args={[0.16, 0.22, 2.8, 12]} />
      <meshStandardMaterial color="#ffffff" roughness={0.2} metalness={0.1} />
    </mesh>
    <mesh position={[0, -0.01, 1.6]} rotation-x={Math.PI / 2}>
      <coneGeometry args={[0.22, 0.55, 12]} />
      <meshStandardMaterial color="#ffffff" roughness={0.2} />
    </mesh>
    <mesh position={[0, 0.1, 0.85]} scale={[0.7, 0.75, 1.2]}>
      <sphereGeometry args={[0.24, 12, 10]} />
      <meshStandardMaterial color="#0284c7" roughness={0.1} transparent opacity={0.8} />
    </mesh>
    <group position={[0, 0.12, 0.4]}>
      <mesh position={[-1.9, 0.08, -0.1]} rotation-z={-0.04}>
        <boxGeometry args={[3.8, 0.025, 0.38]} />
        <meshStandardMaterial color="#e0f2fe" roughness={0.25} />
      </mesh>
      <mesh position={[1.9, 0.08, -0.1]} rotation-z={0.04}>
        <boxGeometry args={[3.8, 0.025, 0.38]} />
        <meshStandardMaterial color="#e0f2fe" roughness={0.25} />
      </mesh>
      <mesh position={[-3.82, 0.18, -0.1]}>
        <boxGeometry args={[0.02, 0.18, 0.14]} />
        <meshStandardMaterial color="#38bdf8" />
      </mesh>
      <mesh position={[3.82, 0.18, -0.1]}>
        <boxGeometry args={[0.02, 0.18, 0.14]} />
        <meshStandardMaterial color="#38bdf8" />
      </mesh>
    </group>
    <group position={[0, 0, -1.4]}>
      <mesh position={[0, 0.45, -0.1]} rotation-x={-0.35}>
        <boxGeometry args={[0.03, 0.9, 0.38]} />
        <meshStandardMaterial color="#0284c7" roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.88, -0.25]}>
        <boxGeometry args={[1.25, 0.02, 0.26]} />
        <meshStandardMaterial color="#e0f2fe" roughness={0.25} />
      </mesh>
    </group>
  </group>
)
