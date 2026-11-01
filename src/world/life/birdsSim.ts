import { B, BIOME_COUNT, biomeWeights, lakeMask, WATER_LEVEL } from "../climate"
import { worldHeight } from "../terrain"

export type BirdKind = "flock" | "ground" | "lake"

export type BirdState = "perched" | "pecking" | "takeoff" | "flying" | "landing" | "gliding"

export type BirdSlot = {
  id: number
  kind: BirdKind
  active: boolean
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  heading: number
  pitch: number
  bank: number
  scale: number
  state: BirdState
  stateTimer: number
  flapTimer: number
  flapAmp: number
  flapSpeed: number
  phaseOffset: number
  glideDihedral: number
  // Flocks & grouping
  flockId: number
  flockOffsetX: number
  flockOffsetY: number
  flockOffsetZ: number
  homePerchX: number
  homePerchZ: number
}

export type Flock = {
  id: number
  active: boolean
  type: "v" | "murmuration"
  cx: number
  cy: number
  cz: number
  vx: number
  vy: number
  vz: number
  speed: number
  heading: number
  flapTimer: number
  isFlapping: boolean
  birdCount: number
  startIdx: number
}

export const MAX_FLOCK_BIRDS = 44
export const MAX_GROUND_BIRDS = 24
export const MAX_LAKE_BIRDS = 8
export const TOTAL_BIRDS = MAX_FLOCK_BIRDS + MAX_GROUND_BIRDS + MAX_LAKE_BIRDS // 76 birds

export type BirdsSimState = {
  birds: BirdSlot[]
  flocks: Flock[]
  lastCheckTimer: number
  stats: {
    distantFlocks: number
    distantBirds: number
    groundBirds: number
    takingOff: number
    lakeBirds: number
  }
}

const _weightsScratch = new Float32Array(BIOME_COUNT)

export const createBirdsSimulation = (): BirdsSimState => {
  const birds: BirdSlot[] = []

  for (let i = 0; i < TOTAL_BIRDS; i++) {
    const kind: BirdKind =
      i < MAX_FLOCK_BIRDS ? "flock" : i < MAX_FLOCK_BIRDS + MAX_GROUND_BIRDS ? "ground" : "lake"

    birds.push({
      id: i,
      kind,
      active: false,
      x: 0,
      y: -100,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      heading: 0,
      pitch: 0,
      bank: 0,
      scale: kind === "flock" ? 1.4 : kind === "lake" ? 0.95 : 0.65,
      state: kind === "ground" ? "perched" : "flying",
      stateTimer: 0,
      flapTimer: 0,
      flapAmp: 1.0,
      flapSpeed: 24.0 + (i % 5),
      phaseOffset: (i * 1.618) % (Math.PI * 2),
      glideDihedral: 0.08,
      flockId: -1,
      flockOffsetX: 0,
      flockOffsetY: 0,
      flockOffsetZ: 0,
      homePerchX: 0,
      homePerchZ: 0,
    })
  }

  // 4 distant flock slots (11 birds each = 44 birds max)
  const flocks: Flock[] = []
  for (let f = 0; f < 4; f++) {
    flocks.push({
      id: f,
      active: false,
      type: f % 2 === 0 ? "v" : "murmuration",
      cx: 0,
      cy: 80,
      cz: 0,
      vx: 14,
      vy: 0,
      vz: 0,
      speed: 15,
      heading: 0,
      flapTimer: 3,
      isFlapping: true,
      birdCount: 9 + (f % 3),
      startIdx: f * 11,
    })
  }

  return {
    birds,
    flocks,
    lastCheckTimer: 0,
    stats: {
      distantFlocks: 0,
      distantBirds: 0,
      groundBirds: 0,
      takingOff: 0,
      lakeBirds: 0,
    },
  }
}

/** Check if location is suitable for ground perched birds (meadow, flowerMeadow, glade, forest edge) */
export const isGoodPerchLocation = (x: number, z: number): boolean => {
  biomeWeights(x, z, _weightsScratch)
  const meadow = _weightsScratch[B.meadow]
  const flower = _weightsScratch[B.flowerMeadow]
  const glade = _weightsScratch[B.glade]
  const forest = _weightsScratch[B.forest]
  const lake = lakeMask(x, z)
  if (lake > 0.45) return false // in water
  // Suitable in open or semi-open meadow / glade or edge of forest
  return meadow + flower + glade > 0.35 || (forest > 0.25 && meadow > 0.15)
}

/** Spawn a flock crossing the sky */
export const spawnFlock = (
  flock: Flock,
  sim: BirdsSimState,
  playerX: number,
  playerZ: number,
  forceAngle?: number,
): void => {
  const angle = forceAngle !== undefined ? forceAngle : Math.random() * Math.PI * 2
  const distance = 240 + Math.random() * 120
  flock.active = true
  flock.type = Math.random() < 0.6 ? "v" : "murmuration"
  flock.birdCount = flock.type === "v" ? 7 + Math.floor(Math.random() * 3) * 2 : 8 + Math.floor(Math.random() * 4)
  if (flock.birdCount > 11) flock.birdCount = 11

  flock.cx = playerX + Math.cos(angle) * distance
  flock.cz = playerZ + Math.sin(angle) * distance
  flock.cy = 65 + Math.random() * 45

  // Heading across the player's general vicinity with ~60m miss distance
  const targetX = playerX + (Math.random() - 0.5) * 120
  const targetZ = playerZ + (Math.random() - 0.5) * 120
  const dx = targetX - flock.cx
  const dz = targetZ - flock.cz
  flock.heading = Math.atan2(dx, dz)
  flock.speed = 14 + Math.random() * 5
  flock.vx = Math.sin(flock.heading) * flock.speed
  flock.vz = Math.cos(flock.heading) * flock.speed
  flock.vy = (Math.random() - 0.5) * 0.8
  flock.flapTimer = 2.5 + Math.random() * 2
  flock.isFlapping = true

  // Assign individual bird offsets
  for (let i = 0; i < 11; i++) {
    const slot = sim.birds[flock.startIdx + i]
    if (i < flock.birdCount) {
      slot.active = true
      slot.flockId = flock.id
      slot.state = "flying"
      slot.scale = 1.35 + (i % 3) * 0.1
      slot.flapSpeed = 22.0 + (i % 4) * 1.5

      if (flock.type === "v") {
        if (i === 0) {
          // Leader
          slot.flockOffsetX = 0
          slot.flockOffsetY = 0
          slot.flockOffsetZ = 0
        } else {
          const side = i % 2 === 1 ? -1 : 1
          const rank = Math.ceil(i / 2)
          slot.flockOffsetX = side * rank * 4.2
          slot.flockOffsetY = rank * 0.45
          slot.flockOffsetZ = -rank * 4.8
        }
      } else {
        // Loose murmuration
        const ang = (i / flock.birdCount) * Math.PI * 2 + i * 1.1
        const rad = 3.5 + (i % 4) * 2.5
        slot.flockOffsetX = Math.cos(ang) * rad
        slot.flockOffsetY = Math.sin(ang * 1.5) * 1.8
        slot.flockOffsetZ = Math.sin(ang) * rad
      }

      slot.x = flock.cx + slot.flockOffsetX
      slot.y = flock.cy + slot.flockOffsetY
      slot.z = flock.cz + slot.flockOffsetZ
      slot.vx = flock.vx
      slot.vy = flock.vy
      slot.vz = flock.vz
      slot.heading = flock.heading
      slot.pitch = 0
      slot.bank = 0
      slot.flapAmp = 1.0
    } else {
      slot.active = false
    }
  }
}

/** Update distant flocks */
const stepFlocks = (
  sim: BirdsSimState,
  dt: number,
  playerX: number,
  playerZ: number,
  timeOfDay: number,
  rain: number,
): void => {
  // Weather & time suppression: rain grounded, night reduces
  const weatherAllowed = rain < 0.35
  const isNight = timeOfDay > 0.85
  const maxActiveFlocks = !weatherAllowed ? 0 : isNight ? 1 : timeOfDay < 0.35 || (timeOfDay > 0.65 && timeOfDay < 0.82) ? 4 : 2

  let activeCount = 0
  for (const flock of sim.flocks) {
    if (flock.active) activeCount++
  }

  // Periodic check to spawn flocks if needed
  if (weatherAllowed && activeCount < maxActiveFlocks && Math.random() < dt * 0.25) {
    for (const flock of sim.flocks) {
      if (!flock.active) {
        spawnFlock(flock, sim, playerX, playerZ)
        break
      }
    }
  }

  // Step active flocks
  for (const flock of sim.flocks) {
    if (!flock.active) continue

    flock.cx += flock.vx * dt
    flock.cy += flock.vy * dt
    flock.cz += flock.vz * dt

    // Flap vs Glide cycle
    flock.flapTimer -= dt
    if (flock.flapTimer <= 0) {
      flock.isFlapping = !flock.isFlapping
      flock.flapTimer = flock.isFlapping ? 2.5 + Math.random() * 2 : 2.2 + Math.random() * 2
    }

    const distToPlayer = Math.hypot(flock.cx - playerX, flock.cz - playerZ)
    if (distToPlayer > 440) {
      flock.active = false
      for (let i = 0; i < 11; i++) {
        sim.birds[flock.startIdx + i].active = false
      }
      continue
    }

    // Update birds in flock
    const cosH = Math.cos(flock.heading)
    const sinH = Math.sin(flock.heading)

    for (let i = 0; i < flock.birdCount; i++) {
      const slot = sim.birds[flock.startIdx + i]
      if (!slot.active) continue

      // Micro turbulence
      const turbX = Math.sin(slot.phaseOffset + flock.cx * 0.05) * 0.35
      const turbY = Math.cos(slot.phaseOffset + flock.cz * 0.05) * 0.25

      const ox = slot.flockOffsetX + turbX
      const oz = slot.flockOffsetZ
      const worldOx = ox * cosH + oz * sinH
      const worldOz = -ox * sinH + oz * cosH

      slot.x = flock.cx + worldOx
      slot.y = flock.cy + slot.flockOffsetY + turbY
      slot.z = flock.cz + worldOz
      slot.heading = flock.heading
      slot.pitch = Math.atan2(flock.vy, flock.speed)
      slot.bank = 0
      slot.flapAmp = flock.isFlapping ? 1.0 : 0.0
    }
  }
}

/** Initialize or recycle perched / ground birds */
const initGroundBird = (slot: BirdSlot, playerX: number, playerZ: number, seed: number): void => {
  // Spawn in a ring around the player: 18m to 42m
  const angle = (seed % 1000) * 0.006283
  const radius = 18 + ((seed >> 4) % 24)
  const x = playerX + Math.cos(angle) * radius
  const z = playerZ + Math.sin(angle) * radius

  if (!isGoodPerchLocation(x, z)) {
    slot.active = false
    return
  }

  const y = worldHeight(x, z)
  slot.active = true
  slot.state = "perched"
  slot.homePerchX = x
  slot.homePerchZ = z
  slot.x = x
  slot.y = y + 0.08
  slot.z = z
  slot.vx = 0
  slot.vy = 0
  slot.vz = 0
  slot.heading = (seed % 360) * (Math.PI / 180)
  slot.pitch = 0
  slot.bank = 0
  slot.flapAmp = 0
  slot.scale = 0.58 + (seed % 4) * 0.05
  slot.stateTimer = 2 + (seed % 5)
}

/** Step perched & ground birds */
const stepGroundBirds = (
  sim: BirdsSimState,
  dt: number,
  playerX: number,
  _playerY: number,
  playerZ: number,
  playerSpeed: number,
  rain: number,
): void => {
  const startIndex = MAX_FLOCK_BIRDS
  const count = MAX_GROUND_BIRDS

  for (let i = 0; i < count; i++) {
    const slot = sim.birds[startIndex + i]

    // Respawn inactive or far birds
    if (!slot.active) {
      if (Math.random() < dt * 0.5) {
        initGroundBird(slot, playerX, playerZ, Math.floor(Math.random() * 100000))
      }
      continue
    }

    const distToPlayer = Math.hypot(slot.x - playerX, slot.z - playerZ)

    if (distToPlayer > 60 && slot.state === "flying") {
      // Land or recycle when far
      slot.active = false
      continue
    }
    if (distToPlayer > 80 && (slot.state === "perched" || slot.state === "pecking")) {
      slot.active = false
      continue
    }

    // State machine
    if (slot.state === "perched" || slot.state === "pecking") {
      // Takeoff trigger: The explorer comes within 6m or runs within 10m
      const triggerDist = playerSpeed > 3.0 ? 10.5 : 6.2
      if (distToPlayer < triggerDist) {
        // Trigger take-off!
        slot.state = "takeoff"
        slot.stateTimer = 0

        // Fly away from player with slight spread
        const fleeAngle = Math.atan2(slot.x - playerX, slot.z - playerZ) + (Math.random() - 0.5) * 0.6
        const speed = 9.5 + Math.random() * 3.5
        slot.vx = Math.sin(fleeAngle) * speed
        slot.vz = Math.cos(fleeAngle) * speed
        slot.vy = 4.2 + Math.random() * 2.0 // upward climb
        slot.heading = fleeAngle
        slot.pitch = 0.35 // climbing pitch
        slot.flapAmp = 1.3 // rapid wingbeats
        slot.flapSpeed = 28.0

        // Alert nearby perched birds within 5m
        for (let j = 0; j < count; j++) {
          const other = sim.birds[startIndex + j]
          if (other.active && (other.state === "perched" || other.state === "pecking")) {
            if (Math.hypot(other.x - slot.x, other.z - slot.z) < 5.0) {
              other.state = "takeoff"
              other.stateTimer = Math.random() * 0.15
              const otherAngle = Math.atan2(other.x - playerX, other.z - playerZ) + (Math.random() - 0.5) * 0.7
              const otherSpeed = 9.0 + Math.random() * 3.0
              other.vx = Math.sin(otherAngle) * otherSpeed
              other.vz = Math.cos(otherAngle) * otherSpeed
              other.vy = 4.5 + Math.random() * 1.8
              other.heading = otherAngle
              other.pitch = 0.35
              other.flapAmp = 1.3
              other.flapSpeed = 28.0
            }
          }
        }
      } else {
        // Idle behaviors on ground
        slot.stateTimer -= dt
        if (slot.stateTimer <= 0) {
          if (slot.state === "perched") {
            slot.state = "pecking"
            slot.stateTimer = 1.2 + Math.random() * 2.0
            slot.heading += (Math.random() - 0.5) * 1.2
          } else {
            slot.state = "perched"
            slot.stateTimer = 2.0 + Math.random() * 3.5
          }
        }
        slot.y = worldHeight(slot.x, slot.z) + 0.08
        slot.pitch = slot.state === "pecking" ? -0.25 : 0.0
        slot.flapAmp = 0
      }
    } else if (slot.state === "takeoff") {
      slot.stateTimer += dt
      slot.x += slot.vx * dt
      slot.y += slot.vy * dt
      slot.z += slot.vz * dt

      // Level out after climbing for ~2.5s
      if (slot.stateTimer > 2.2) {
        slot.state = "flying"
        slot.stateTimer = 0
        slot.vy *= 0.3
        slot.flapAmp = 1.0
        slot.flapSpeed = 24.0
      }

      slot.heading = Math.atan2(slot.vx, slot.vz)
      slot.pitch = Math.atan2(slot.vy, Math.hypot(slot.vx, slot.vz))
      slot.bank = (slot.heading - Math.atan2(slot.vx, slot.vz)) * 0.5
    } else if (slot.state === "flying") {
      slot.stateTimer += dt
      slot.x += slot.vx * dt
      slot.y += slot.vy * dt
      slot.z += slot.vz * dt

      // Gentle curve & flap-glide cycle
      if (slot.stateTimer > 4.5 && rain < 0.25) {
        // After flying away, glide
        slot.flapAmp = (Math.sin(slot.stateTimer * 2.0) > 0.1) ? 1.0 : 0.0
      }

      // Keep minimum height above terrain
      const groundY = worldHeight(slot.x, slot.z)
      if (slot.y < groundY + 4.0) {
        slot.vy += dt * 3.0
      }

      slot.heading = Math.atan2(slot.vx, slot.vz)
      slot.pitch = Math.atan2(slot.vy, Math.hypot(slot.vx, slot.vz))
      slot.bank = Math.sin(slot.stateTimer) * 0.15

      if (slot.stateTimer > 12.0) {
        slot.active = false
      }
    }
  }
}

/** Step lake birds (birds flying low over lakes) */
const stepLakeBirds = (sim: BirdsSimState, dt: number, playerX: number, playerZ: number, rain: number): void => {
  const startIndex = MAX_FLOCK_BIRDS + MAX_GROUND_BIRDS
  const count = MAX_LAKE_BIRDS

  // Check if player is near a lake
  const lakeIntensity = lakeMask(playerX, playerZ)
  const allowLakeBirds = rain < 0.35 && lakeIntensity > 0.15

  for (let i = 0; i < count; i++) {
    const slot = sim.birds[startIndex + i]

    if (!allowLakeBirds) {
      slot.active = false
      continue
    }

    if (!slot.active) {
      // Spawn near water surface
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.5
      const rad = 25 + Math.random() * 45
      const sx = playerX + Math.cos(ang) * rad
      const sz = playerZ + Math.sin(ang) * rad

      if (lakeMask(sx, sz) > 0.25) {
        slot.active = true
        slot.x = sx
        slot.y = WATER_LEVEL + 1.2 + Math.random() * 1.5
        slot.z = sz
        const heading = ang + Math.PI * 0.5
        const speed = 10 + Math.random() * 3
        slot.vx = Math.sin(heading) * speed
        slot.vz = Math.cos(heading) * speed
        slot.vy = 0
        slot.heading = heading
        slot.pitch = 0
        slot.bank = 0
        slot.state = "gliding"
        slot.stateTimer = Math.random() * 5
        slot.scale = 0.95
        slot.flapSpeed = 20.0
      }
      continue
    }

    // Low skimming flight
    slot.stateTimer += dt
    const turnRate = 0.35 + Math.sin(slot.stateTimer * 0.5) * 0.2
    slot.heading += turnRate * dt
    const speed = 10.5
    slot.vx = Math.sin(slot.heading) * speed
    slot.vz = Math.cos(slot.heading) * speed

    // Swooping altitude (dipping near water, then climbing gently)
    const targetY = WATER_LEVEL + 1.0 + Math.sin(slot.stateTimer * 1.2 + slot.phaseOffset) * 0.9
    slot.y += (targetY - slot.y) * dt * 2.0
    slot.vy = (targetY - slot.y) * 2.0

    slot.x += slot.vx * dt
    slot.z += slot.vz * dt

    // Flap and glide cycle: glide low over water
    const glideCycle = Math.sin(slot.stateTimer * 0.8)
    slot.flapAmp = glideCycle > 0.3 ? 1.0 : 0.0

    slot.pitch = Math.atan2(slot.vy, speed)
    slot.bank = turnRate * 0.6

    // Recycle if moved out of water area or too far
    if (lakeMask(slot.x, slot.z) < 0.1 || Math.hypot(slot.x - playerX, slot.z - playerZ) > 100) {
      slot.active = false
    }
  }
}

/** Main simulation update called each frame */
export const stepBirdsSimulation = (
  sim: BirdsSimState,
  dt: number,
  playerPos: { x: number; y: number; z: number },
  playerSpeed: number,
  timeOfDay: number,
  rain: number,
): void => {
  stepFlocks(sim, dt, playerPos.x, playerPos.z, timeOfDay, rain)
  stepGroundBirds(sim, dt, playerPos.x, playerPos.y, playerPos.z, playerSpeed, rain)
  stepLakeBirds(sim, dt, playerPos.x, playerPos.z, rain)

  // Update diagnostic stats
  let distantFlocks = 0
  let distantBirds = 0
  let groundBirds = 0
  let takingOff = 0
  let lakeBirds = 0

  for (const flock of sim.flocks) {
    if (flock.active) distantFlocks++
  }

  for (let i = 0; i < TOTAL_BIRDS; i++) {
    const slot = sim.birds[i]
    if (!slot.active) continue
    if (slot.kind === "flock") distantBirds++
    else if (slot.kind === "ground") {
      groundBirds++
      if (slot.state === "takeoff" || slot.state === "flying") takingOff++
    } else if (slot.kind === "lake") {
      lakeBirds++
    }
  }

  sim.stats.distantFlocks = distantFlocks
  sim.stats.distantBirds = distantBirds
  sim.stats.groundBirds = groundBirds
  sim.stats.takingOff = takingOff
  sim.stats.lakeBirds = lakeBirds
}

/** Force debug trigger: immediately spawns a flock overhead and startles nearby ground birds */
export const forceFlockDebug = (sim: BirdsSimState, playerX: number, playerZ: number): void => {
  const flock = sim.flocks[0]
  spawnFlock(flock, sim, playerX, playerZ, 0)
  flock.cx = playerX - 40
  flock.cz = playerZ - 60
  flock.cy = 50
  flock.heading = 0.6
  flock.vx = Math.sin(0.6) * 16
  flock.vz = Math.cos(0.6) * 16

  // Force spawn 4 ground birds right in front of player and flush them
  const startIndex = MAX_FLOCK_BIRDS
  for (let i = 0; i < 4; i++) {
    const slot = sim.birds[startIndex + i]
    slot.active = true
    slot.state = "takeoff"
    slot.stateTimer = 0
    const ang = (i / 4) * 0.8 - 0.4
    slot.x = playerX + Math.sin(ang) * 4.0
    slot.z = playerZ - 5.0 - i * 1.2
    slot.y = worldHeight(slot.x, slot.z) + 0.5
    slot.vx = Math.sin(ang) * 10
    slot.vz = -11
    slot.vy = 5.0 + i * 0.5
    slot.heading = Math.atan2(slot.vx, slot.vz)
    slot.pitch = 0.4
    slot.flapAmp = 1.3
    slot.flapSpeed = 28.0
    slot.scale = 0.65
  }
}
