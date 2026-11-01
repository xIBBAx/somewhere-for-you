import { WATER_LEVEL } from "../climate"
import { pushOutOfScatter } from "../colliders"
import { rng } from "../noise"
import { worldHeight } from "../terrain"
import { emitCreatureSplash as emitCreatureSplashNear, emitRipple } from "../render/waterFx"
import { WATER_WAYS, creatureWaterSurfaceAt, creatureWaterY, makeWaterContact, pickWaterSpot, shakeOffWater, stepWaterContact, waterCurrentAt, waterInvitation, waterUnwelcoming, type WaterContact } from "../creatureWater"
import { CHUNK_SIZE } from "../worldConfig"
import { ANIMAL_PROFILE, habitatAllows, type AnimalSpawn } from "./population"
import { COATS } from "./animalAssets"
import { ALARM_RADIUS, CALM_DAY, activityLevel, findShelter, findShore, wantsShelter, type AnimalEnv } from "./rhythm"

export type AnimalState = "idle" | "wander" | "graze" | "sit" | "sleep" | "flee" | "approach" | "follow" | "swim" | "watch" | "return" | "shelter" | "drink"
  /** in the water by choice: wading, soaking or swimming; then climbing back out */
  | "bathe" | "emerge"
export type AnimalPlayer = { x: number; z: number; speed: number; facing: number }
export type AnimalAgent = AnimalSpawn & {
  y: number; heading: number; speed: number; targetSpeed: number; state: AnimalState
  timer: number; reactTimer: number; tx: number; tz: number; homeX: number; homeZ: number
  random: () => number; speedFactor: number; happy: number; friendTime: number
  sit: number; sleep: number; graze: number; swim: number; turnRate: number
  groundDx: number; groundDz: number; groundTimer: number; travelled: number
  /** a short species-typical action while resting (groom, yawn, preen …) */
  act: AnimalAct; actTime: number; actW: number; alert: number; thump: number; actSide: number
  /** 0 … 1+, grows while active; above 1 the animal goes to drink */
  thirst: number
  /** at the water's edge, head down (drink); resting in cover (shelter) */
  atWater: boolean; sheltered: boolean
  /** heading to turn to while standing (the water when drinking), NaN = none */
  faceHeading: number
  /** this flight has already warned the others; the next zig-zag cut */
  alarmSent: boolean; zig: number
  /** seconds left walking round an obstacle, and on which side (±1) */
  detour: number; detourSide: number
  /** the bank it walked in from, and whether this bathe is a swim, a wade or a soak */
  bankX: number; bankZ: number; bathKind: "" | "wade" | "swim" | "soak"; bathMoves: number
  /** this outing to the water has already drawn a companion along */
  invited: boolean
  /** water against the body: wake rings, wetness, drips */
  water: WaterContact
}

export type AnimalAct = "" | "groom" | "yawn" | "scratch" | "stretch" | "rear" | "preen" | "flap" | "pounce" | "dabble" | "shake" | "splash"

/** What each species does with its idle moments, and for how long. */
export const SPECIES_ACTS: Record<AnimalSpawn["species"], Array<[AnimalAct, number]>> = {
  cat: [["groom", 4.5], ["yawn", 2.4], ["scratch", 2.2], ["stretch", 2.2]],
  // a mousing fox: freeze, rise on the hind legs, dive nose-first into the grass
  fox: [["yawn", 2.4], ["scratch", 2.2], ["stretch", 2.0], ["groom", 3.5], ["pounce", 1.9]],
  rabbit: [["groom", 3.2], ["rear", 2.6]],
  deer: [],
  // dabbling ducks feed tipped up, tail in the air, more often than they preen
  duck: [["preen", 4.0], ["flap", 1.6], ["dabble", 3.2], ["dabble", 2.4]],
  // A horse's ordinary idle is a relaxed stand; the feline foreleg stretch
  // lowered its long equine neck and folded its legs into a cat silhouette.
  horse: [],
  monkey: [["groom", 3.2], ["scratch", 2.2], ["yawn", 2.4]],
  tiger: [["yawn", 2.4], ["stretch", 2.2], ["groom", 3.5]],
  cheetah: [["yawn", 2.4], ["stretch", 2.2], ["groom", 3.5]],
  gorilla: [["groom", 3.2], ["scratch", 2.2], ["yawn", 2.4]],
}

/** Weight of the running action: eases in, holds, eases out. */
/** Water acts shared by everyone who gets wet: the shake, and pawing/splashing at the surface. */
const WATER_ACTS: Array<[AnimalAct, number]> = [["shake", 1.4], ["splash", 2.6]]

export const actEnvelope = (act: AnimalAct, t: number): number => {
  const dur = (SPECIES_ACTS.cat.concat(SPECIES_ACTS.fox, SPECIES_ACTS.rabbit, SPECIES_ACTS.duck, WATER_ACTS).find(([a]) => a === act)?.[1]) ?? 0
  if (!act || dur <= 0 || t >= dur) return 0
  const inT = act === "flap" ? 0.15 : 0.4
  return Math.min(1, t / inT, (dur - t) / 0.45)
}
const damp = (a: number, b: number, k: number, dt: number): number => a + (b - a) * (1 - Math.exp(-k * dt))
const angle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a))

export const createAnimalAgent = (s: AnimalSpawn): AnimalAgent => {
  const random = rng(s.seed)
  return { ...s, y: s.species === "duck" ? WATER_LEVEL : worldHeight(s.x, s.z) + (s.groundOffset ?? 0), heading: random() * Math.PI * 2,
    speed: 0, targetSpeed: 0, state: s.sleeper ? "sleep" : s.species === "duck" ? "swim" : "idle", timer: 1 + random() * 4, reactTimer: random(),
    tx: s.x, tz: s.z, homeX: s.x, homeZ: s.z, random, speedFactor: 0.85 + random() * 0.3,
    happy: 0, friendTime: 0, sit: 0, sleep: s.sleeper ? 1 : 0, graze: 0, swim: s.species === "duck" ? 1 : 0, turnRate: 0,
    groundDx: 0, groundDz: 0, groundTimer: 0, travelled: 0, act: "", actTime: 0, actW: 0, alert: 0, thump: 0,
    actSide: random() < 0.5 ? -1 : 1, thirst: random(), atWater: false, sheltered: false, faceHeading: Number.NaN,
    alarmSent: false, zig: 0, detour: 0, detourSide: 1, bankX: s.x, bankZ: s.z, bathKind: "", bathMoves: 0, invited: false, water: makeWaterContact() }
}

/**
 * Having drunk, does the animal stay to bathe? Its love of water, the day
 * (heat draws it in, cold and storms keep it out, the dark quietens all but
 * the tiger) and company (others already splashing) decide. It may wade in
 * to cool its legs, lie down in the shallows to soak (tigers, macaques,
 * gorillas), or swim out and back.
 */
const startBathe = (a: AnimalAgent, env: AnimalEnv, company: number): boolean => {
  if (a.species === "duck" || waterUnwelcoming()) return false
  const way = WATER_WAYS[a.species]
  const invite = waterInvitation(env.tod, a.species === "tiger")
  // some breeds are famous for loving water: the Turkish Van ("the swimming
  // cat"), the Bengal and the Maine Coon
  const breed = a.species === "cat" ? COATS.cat[a.coat % COATS.cat.length].name : ""
  const love = breed === "Turkish Van" ? 0.9 : breed === "Bengal" ? 0.7 : breed === "Maine Coon" ? 0.6 : way.love
  const p = love * (0.15 + invite * 1.1) + company * 0.3
  if (a.random() > p) return false
  const swim = way.swims && a.random() < love * (0.25 + invite) * (a.species === "rabbit" ? 0.5 : 1)
  const spot = pickWaterSpot(a.x, a.z, Number.isFinite(a.faceHeading) ? a.faceHeading : a.heading, way, a.scale, swim, a.random) ??
    (swim ? pickWaterSpot(a.x, a.z, Number.isFinite(a.faceHeading) ? a.faceHeading : a.heading, way, a.scale, false, a.random) : null)
  if (!spot) return false
  a.bankX = a.x; a.bankZ = a.z
  const deep = spot.depth > way.shoulder * a.scale * way.wade
  a.bathKind = deep ? "swim" : (a.species === "tiger" || a.species === "monkey" || a.species === "gorilla") && a.random() < 0.65 ? "soak" : "wade"
  a.state = "bathe"; a.atWater = false; a.tx = spot.x; a.tz = spot.z; a.timer = 25; a.faceHeading = Number.NaN
  a.bathMoves = deep ? 1 + Math.floor(a.random() * 3) : a.random() < 0.4 ? 1 : 0
  return true
}

/** Water an animal may move through right now (its own depth if it cannot swim). */
const waterAllows = (a: AnimalAgent, x: number, z: number): boolean => {
  const surface = creatureWaterSurfaceAt(x, z)
  if (surface === null) {
    // the muddy strip between the waterline and dry habitat is walkable on the way in or out
    return worldHeight(x, z) < WATER_LEVEL + 0.6 || habitatAllows(a.species, x, z, false)
  }
  const way = WATER_WAYS[a.species]
  return way.swims || surface - worldHeight(x, z) <= way.shoulder * a.scale * way.wade
}

/** Animals that keep to dry land and drink from lakes and ponds. */
const DRINKERS = new Set<AnimalSpawn["species"]>(["rabbit", "fox", "cat", "tiger", "cheetah", "gorilla", "monkey", "horse"])
const FELINE_REST = new Set<AnimalSpawn["species"]>(["cat", "fox", "tiger", "cheetah"])

/** What a settled animal does next: rest, seek cover, drink, graze or roam. */
const chooseNext = (a: AnimalAgent, env: AnimalEnv): void => {
  const profile = ANIMAL_PROFILE[a.species]
  const active = activityLevel(a.species, env)
  if (wantsShelter(a.species, env) && !a.sheltered) {
    const spot = findShelter(a.x, a.z, profile.radius * a.scale, Math.min(16, profile.homeRange * 1.2), env.windX ?? 1, env.windZ ?? 0)
    if (spot && habitatAllows(a.species, spot.x, spot.z, false) && Math.hypot(spot.x - a.homeX, spot.z - a.homeZ) < profile.homeRange * 1.4) {
      a.state = "shelter"; a.tx = spot.x; a.tz = spot.z; a.timer = 25
      return
    }
  }
  if (env.rain < 0.2) a.sheltered = false
  if (DRINKERS.has(a.species) && a.thirst > 1 && !a.sheltered) {
    const shore = findShore(a.x, a.z, (x, z) => habitatAllows(a.species, x, z) && Math.hypot(x - a.homeX, z - a.homeZ) < profile.homeRange * 1.4)
    if (shore) {
      a.state = "drink"; a.atWater = false; a.tx = shore.x; a.tz = shore.z; a.faceHeading = shore.face; a.timer = 30
      return
    }
    a.thirst = 0.4 // nowhere near water: forget about it for a while
  }
  const roll = a.random()
  // rest more in the animal's quiet hours, and while tucked under a tree
  const rest = (1 - active) * 0.75 + (a.sheltered ? 0.5 : 0)
  if (a.species !== "duck" && roll < rest) {
    const deep = active < 0.45 && a.random() < 0.55
    a.state = deep ? "sleep" : FELINE_REST.has(a.species) || a.species === "rabbit" ? "sit" : "graze"
    a.timer = (deep ? 18 : 7) + a.random() * (deep ? 40 : 14)
    return
  }
  a.sheltered = false
  const r2 = a.random()
  a.state = ["cat", "tiger", "cheetah", "monkey", "gorilla"].includes(a.species) ? (r2 < 0.35 ? "sit" : "wander") : ["deer", "rabbit", "horse"].includes(a.species) ? (r2 < 0.5 ? "graze" : "wander") : "wander"
  if (a.state === "wander") pickWander(a)
  a.timer = 3 + a.random() * 7
}

/**
 * One fleeing animal warns the others of its kind around it, once per
 * flight; those it warns run the same way but do not warn again, so a scare
 * spreads through a group without echoing round it forever.
 */
export const spreadAlarm = (agents: Iterable<AnimalAgent> | AnimalAgent[]): number => {
  const list = Array.isArray(agents) ? agents : [...agents]
  let warned = 0
  for (const a of list) {
    if (a.state !== "flee") { a.alarmSent = false; continue }
    if (a.alarmSent) continue
    a.alarmSent = true
    const radius = ALARM_RADIUS[a.species]
    if (!radius) continue
    const fx = a.tx - a.x, fz = a.tz - a.z, len = Math.hypot(fx, fz) || 1
    for (const b of list) {
      if (b === a || b.species !== a.species || b.state === "flee" || b.friendTime > 0 || b.sleeper) continue
      if (Math.hypot(b.x - a.x, b.z - a.z) > radius) continue
      b.state = "flee"; b.alarmSent = true; b.act = ""; b.timer = 1.6 + b.random() * 1.2
      b.tx = b.x + (fx / len) * 12; b.tz = b.z + (fz / len) * 12
      warned++
    }
  }
  return warned
}

const pickWander = (a: AnimalAgent): void => {
  for (let i = 0; i < 8; i++) {
    const angle = a.random() * Math.PI * 2
    const d = ANIMAL_PROFILE[a.species].homeRange * (0.25 + a.random() * 0.75)
    const x = a.homeX + Math.sin(angle) * d
    const z = a.homeZ + Math.cos(angle) * d
    if (habitatAllows(a.species, x, z)) { a.tx = x; a.tz = z; return }
  }
  a.tx = a.homeX; a.tz = a.homeZ
}

export const thinkAnimal = (a: AnimalAgent, player: AnimalPlayer, dt: number, react: boolean, env: AnimalEnv = CALM_DAY): void => {
  const profile = ANIMAL_PROFILE[a.species]
  const active = activityLevel(a.species, env)
  // hot days make everyone thirsty sooner
  if (a.state !== "drink" || !a.atWater) a.thirst += dt * active * (1 + 1.4 * Math.max(0, waterInvitation(env.tod, true) - 0.5)) / 240
  const dx = player.x - a.x, dz = player.z - a.z
  const d = Math.hypot(dx, dz)
  a.timer -= dt; a.reactTimer -= dt
  a.friendTime = Math.max(0, a.friendTime - dt)
  a.happy = Math.max(0, a.happy - dt * 0.15)
  if (react && a.reactTimer <= 0) {
    a.reactTimer = 0.35 + a.random() * 0.7
    const fast = player.speed > 3.2
    if ((a.species === "rabbit" || a.species === "deer") && a.friendTime <= 0 && d < (a.species === "deer" ? 9 : 5.5) && fast && a.state !== "flee") {
      a.state = "flee"; a.timer = 2 + a.random() * 1.5; a.act = ""
      // a rabbit drums a warning with its hind feet as it bolts
      if (a.species === "rabbit") a.thump = 1
      const away = d > 0.01 ? Math.atan2(-dx, -dz) : a.heading + Math.PI
      a.tx = a.x + Math.sin(away) * 12; a.tz = a.z + Math.cos(away) * 12
    } else if (["rabbit", "deer", "fox", "horse", "monkey", "tiger", "cheetah", "gorilla"].includes(a.species) && d < 9 && a.state !== "flee" && a.state !== "watch" && a.state !== "bathe" && a.state !== "emerge" && a.random() < 0.35) {
      a.state = "watch"; a.timer = 2 + a.random() * 3
    }
    if (a.species === "cat" && a.state !== "sleep") {
      if (a.friendTime > 0 && d > 2 && d < 35) a.state = "follow"
      else if (!fast && d < 6 && d > 1.3 && ["idle", "wander"].includes(a.state) && a.random() < 0.5) { a.state = "approach"; a.timer = 8 }
    }
    if (a.species === "duck" && d < 8 && a.random() < 0.25) {
      const x = a.x + dx * 0.25, z = a.z + dz * 0.25
      if (habitatAllows("duck", x, z, false)) { a.tx = x; a.tz = z; a.timer = 4 }
    }
  }
  if (a.friendTime <= 0 && !["flee", "sleep", "return", "drink", "shelter", "bathe", "emerge"].includes(a.state) && Math.hypot(a.x - a.homeX, a.z - a.homeZ) > profile.homeRange * 1.5) {
    a.state = "return"; a.tx = a.homeX; a.tz = a.homeZ; a.timer = 30
  }
  // idle moments: groom, yawn, preen … only while settled and unhurried
  if (a.act) {
    a.actTime += dt
    if (actEnvelope(a.act, a.actTime) <= 0 && a.actTime > 0.5) a.act = ""
  } else if (["idle", "sit", "watch", "swim"].includes(a.state) && a.speed < 0.1 && a.random() < dt * 0.12) {
    const acts = SPECIES_ACTS[a.species].filter(([act]) => (a.state === "watch" ? act === "rear" : act !== "rear" || a.random() < 0.4) &&
      (act !== "pounce" || (a.state === "idle" && active > 0.5)))
    if (acts.length) {
      a.act = acts[Math.floor(a.random() * acts.length)][0]
      a.actTime = 0
      a.actSide = a.random() < 0.5 ? -1 : 1
    }
  }
  a.targetSpeed = 0
  switch (a.state) {
    case "sleep":
      // napping cats on their landmark sleep on; everyone else wakes in time
      if (!a.sleeper && a.timer <= 0) { a.state = "idle"; a.timer = 1 + a.random() * 2 }
      break
    case "idle": case "sit": case "graze": case "watch":
      if (a.timer <= 0) chooseNext(a, env)
      break
    case "shelter":
      a.targetSpeed = profile.walk * a.speedFactor
      if (Math.hypot(a.tx - a.x, a.tz - a.z) < 0.5 || a.timer <= 0) {
        a.sheltered = true; a.targetSpeed = 0
        a.state = FELINE_REST.has(a.species) || a.species === "rabbit" ? "sit" : "idle"
        a.timer = 15 + a.random() * 25
      }
      break
    case "drink":
      if (!a.atWater) {
        a.targetSpeed = profile.walk * a.speedFactor
        if (Math.hypot(a.tx - a.x, a.tz - a.z) < 0.45) { a.atWater = true; a.targetSpeed = 0; a.timer = 4.5 + a.random() * 3.5 }
        else if (a.timer <= 0) { a.state = "idle"; a.timer = 1; a.faceHeading = Number.NaN }
      } else if (a.timer <= 0) {
        a.thirst = 0; a.atWater = false
        if (!startBathe(a, env, bathingCompany(a))) {
          a.faceHeading = Number.NaN
          a.state = "idle"; a.timer = 1 + a.random() * 2
        }
      }
      break
    case "bathe": {
      const way = WATER_WAYS[a.species]
      const out = waterUnwelcoming() || a.timer <= 0
      if (!a.atWater) {
        // wading is slow going; swimming its own pace
        a.targetSpeed = (a.swim > 0.5 ? way.swimSpeed : profile.walk * (1 - Math.min(0.5, a.water.depth))) * a.speedFactor
        if (Math.hypot(a.tx - a.x, a.tz - a.z) < 0.45) {
          a.atWater = true; a.targetSpeed = 0
          const invite = waterInvitation(env.tod, a.species === "tiger")
          a.timer = (a.bathKind === "soak" ? 14 : a.bathKind === "swim" ? 5 : 7) * (0.6 + invite) * (0.7 + a.random() * 0.8)
          // a wading horse paws the water, a monkey slaps at it, a tiger flops down
          if (a.bathKind === "wade" && a.random() < 0.55) { a.act = "splash"; a.actTime = 0; a.actSide = a.random() < 0.5 ? -1 : 1 }
        } else if (out) { a.state = "emerge"; a.tx = a.bankX; a.tz = a.bankZ; a.timer = 30; a.atWater = false }
      } else if (out) {
        if (a.bathMoves > 0 && !waterUnwelcoming()) {
          // a little further: another lap, or a few steps along the shallows
          a.bathMoves--
          const spot = pickWaterSpot(a.bankX, a.bankZ, Math.atan2(a.x - a.bankX, a.z - a.bankZ), way, a.scale, a.bathKind === "swim", a.random)
          if (spot) { a.tx = spot.x; a.tz = spot.z; a.atWater = false; a.timer = 20; break }
        }
        a.state = "emerge"; a.tx = a.bankX; a.tz = a.bankZ; a.timer = 30; a.atWater = false
      }
      break
    }
    case "emerge":
      a.targetSpeed = (a.swim > 0.5 ? way0(a).swimSpeed : profile.walk) * a.speedFactor
      if (Math.hypot(a.tx - a.x, a.tz - a.z) < 0.45 || (a.timer <= 0 && !a.water.inWater)) {
        a.state = "idle"; a.targetSpeed = 0; a.timer = 1.5 + a.random() * 2; a.bathKind = ""
        // on the bank: shake it all off (cats then sit down to groom it smooth)
        if (WATER_WAYS[a.species].shakes && a.water.wet > 0.3) { a.act = "shake"; a.actTime = 0; a.state = a.species === "cat" ? "sit" : "idle"; a.timer = a.species === "cat" ? 6 : a.timer }
      } else if (a.timer <= -20) { a.state = "idle"; a.timer = 1 }
      break
    case "wander": case "return": case "flee":
      a.targetSpeed = (a.state === "flee" ? profile.run : profile.walk) * a.speedFactor
      // a bolting rabbit cuts left and right to shake off a chaser
      if (a.state === "flee" && a.species === "rabbit") {
        a.zig -= dt
        if (a.zig <= 0) {
          a.zig = 0.32 + a.random() * 0.3
          const turn = (a.random() < 0.5 ? -1 : 1) * (0.35 + a.random() * 0.3)
          const fx = a.tx - a.x, fz = a.tz - a.z, c = Math.cos(turn), sn = Math.sin(turn)
          a.tx = a.x + fx * c + fz * sn; a.tz = a.z - fx * sn + fz * c
        }
      }
      if (Math.hypot(a.tx - a.x, a.tz - a.z) < 0.4 || a.timer <= 0) {
        a.state = "idle"; a.targetSpeed = 0; a.timer = 2 + a.random() * 4
      }
      break
    case "approach": case "follow":
      a.tx = player.x - (dx / Math.max(0.01, d)) * 1.05
      a.tz = player.z - (dz / Math.max(0.01, d)) * 1.05
      a.targetSpeed = a.state === "follow" ? Math.min(profile.run, Math.max(0, d - 1.2) * 1.2) : profile.walk * a.speedFactor
      if (d < 1.3) { a.state = "sit"; a.targetSpeed = 0; a.timer = 3 + a.random() * 3; a.happy = Math.max(a.happy, 0.45) }
      else if ((a.state === "follow" && a.friendTime <= 0) || d > 35 || (a.state === "approach" && a.timer <= 0)) { a.state = "return"; a.tx = a.homeX; a.tz = a.homeZ; a.timer = 30 }
      break
    case "swim":
      // ducks drift slowly and rest longer between paddles after dark
      if (a.timer <= -2 - (1 - active) * 8 || Math.hypot(a.tx - a.x, a.tz - a.z) < 0.3) { pickWander(a); a.timer = 4 + a.random() * 6 }
      a.targetSpeed = a.timer > 0 ? profile.walk * a.speedFactor * (0.45 + 0.55 * active) : 0
      break
  }
  // the shake throws the water off; splashing play sends up little bursts
  if (a.act === "shake" && a.actTime < dt + 1e-6 && d < 45) shakeOffWater(a.water, WATER_WAYS[a.species], a.scale, a.x, a.z, worldHeight(a.x, a.z))
  if (a.act === "splash" && a.water.inWater && d < 45) {
    const beat = Math.floor(a.actTime / 0.5)
    if (beat !== Math.floor((a.actTime - dt) / 0.5) && a.actTime > 0.3 && a.actTime < 2.3) {
      const way = WATER_WAYS[a.species], r = way.shoulder * a.scale * 0.55
      emitCreatureSplashNear(a.x + Math.sin(a.heading) * r + Math.cos(a.heading) * 0.1 * a.actSide, a.z + Math.cos(a.heading) * r - Math.sin(a.heading) * 0.1 * a.actSide,
        Math.max(0.08, way.mass * a.scale * 0.4), Math.sin(a.heading) * 0.4, Math.cos(a.heading) * 0.4)
    }
  }
  // the pounce itself: a short leap forward at the top of the rise
  if (a.act === "pounce" && a.actTime > 0.75 && a.actTime < 1.1) {
    a.targetSpeed = 3.2
    a.tx = a.x + Math.sin(a.heading) * 1.2; a.tz = a.z + Math.cos(a.heading) * 1.2
  }
}

const scratch = { x: 0, z: 0 }
const way0 = (a: AnimalAgent) => WATER_WAYS[a.species]

/** How many others are bathing close by (a group gathers at the water). */
let bathers: readonly AnimalAgent[] = []
const bathingCompany = (a: AnimalAgent): number => {
  let n = 0
  for (const b of bathers) if (b !== a && b.state === "bathe" && Math.hypot(b.x - a.x, b.z - a.z) < 18) n++
  return Math.min(1, n * 0.5)
}

/**
 * Friends follow friends to the water: an animal setting off to drink or
 * bathe now and then draws an idle companion of its kind (or, for the big
 * cats, monkeys and gorillas, any calm neighbour) along. One invitation per
 * outing, so a group gathers without the whole valley stampeding.
 */
export const spreadWaterVisits = (list: readonly AnimalAgent[]): number => {
  bathers = list
  let joined = 0
  for (const a of list) {
    if (a.state !== "drink" && a.state !== "bathe") { a.invited = false; continue }
    if (a.atWater || a.invited) continue
    a.invited = true
    for (const b of list) {
      if (b === a || b.species !== a.species || b.sleeper || b.friendTime > 0) continue
      if (b.state !== "idle" && b.state !== "graze" && b.state !== "sit" && b.state !== "wander") continue
      if (Math.hypot(b.x - a.x, b.z - a.z) > 16 || b.random() > 0.45) continue
      b.thirst = Math.max(b.thirst, 1.05)
      b.timer = Math.min(b.timer, 0.4 + b.random() * 2.5)
      joined++
      break
    }
  }
  return joined
}

/**
 * Personal space: no two animals stand inside each other. Overlapping pairs
 * are eased apart (a little per frame, so it reads as shuffling aside) as
 * long as the new spot is still their habitat. Sleepers on their cushions
 * and a cat being petted keep their place.
 */
export const separateAnimals = (list: readonly AnimalAgent[], dt: number): number => {
  let pushes = 0
  const k = Math.min(1, dt * 4)
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    const ra = ANIMAL_PROFILE[a.species].radius * a.scale
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j]
      const min = ra + ANIMAL_PROFILE[b.species].radius * b.scale + 0.12
      const dx = b.x - a.x, dz = b.z - a.z
      if (Math.abs(dx) > min || Math.abs(dz) > min) continue
      const d = Math.hypot(dx, dz)
      if (d >= min) continue
      const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0
      const push = (min - d) * 0.5 * k
      const aFixed = a.sleeper || a.state === "sleep", bFixed = b.sleeper || b.state === "sleep"
      if (!aFixed) {
        const x = a.x - nx * push * (bFixed ? 2 : 1), z = a.z - nz * push * (bFixed ? 2 : 1)
        if (habitatAllows(a.species, x, z, false)) { a.x = x; a.z = z }
      }
      if (!bFixed) {
        const x = b.x + nx * push * (aFixed ? 2 : 1), z = b.z + nz * push * (aFixed ? 2 : 1)
        if (habitatAllows(b.species, x, z, false)) { b.x = x; b.z = z }
      }
      pushes++
    }
  }
  return pushes
}
/** Blocked by a trunk on the way somewhere: commit to walking round it on
 * whichever side is open (and nearer the goal) for a moment, then re-aim.
 * Re-aiming every step only rocked the animal against the bark. */
const startDetour = (a: AnimalAgent, step: number, radius: number): boolean => {
  let best = 0, bestD = Infinity
  for (const side of [1, -1]) {
    // probe almost tangentially, with a little slack: the animal is touching the bark
    const h = a.heading + side * 1.45
    scratch.x = a.x + Math.sin(h) * Math.max(step, 0.15); scratch.z = a.z + Math.cos(h) * Math.max(step, 0.15)
    if (pushOutOfScatter(scratch, radius * 0.8, CHUNK_SIZE) || !habitatAllows(a.species, scratch.x, scratch.z, false)) continue
    const d = Math.hypot(a.tx - scratch.x, a.tz - scratch.z)
    if (d < bestD) { bestD = d; best = side }
  }
  if (!best) return false
  a.detourSide = best; a.detour = 0.7
  return true
}
/** Integrate in short steps even for the far tier, so reduced update rates do
 * not let an animal tunnel through a trunk, a shoreline or a steep bank. */
export const moveAnimal = (a: AnimalAgent, player: AnimalPlayer, dt: number): void => {
  const profile = ANIMAL_PROFILE[a.species]
  const ox = a.x, oz = a.z, heading = a.heading
  const steps = Math.max(1, Math.ceil(dt / 0.08)), hdt = dt / steps
  let speed = a.speed
  for (let i = 0; i < steps; i++) {
    speed = damp(speed, a.targetSpeed, a.targetSpeed > speed ? 4 : 7, hdt)
    const dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot(dx, dz)
    if (d > 0.08 && speed > 1e-5) {
      const swerve = a.detour > 0 ? a.detourSide * 1.25 : 0
      a.detour = Math.max(0, a.detour - hdt)
      a.heading += angle(Math.atan2(dx, dz) + swerve - a.heading) * (1 - Math.exp(-(swerve ? 9 : 5) * hdt))
      const step = Math.min(d, speed * hdt)
      scratch.x = a.x + Math.sin(a.heading) * step; scratch.z = a.z + Math.cos(a.heading) * step
      const hit = pushOutOfScatter(scratch, profile.radius * a.scale, CHUNK_SIZE)
      const dh = Math.abs(worldHeight(scratch.x, scratch.z) - worldHeight(a.x, a.z))
      const wading = a.species !== "duck" && (a.state === "bathe" || a.state === "emerge" || a.water.inWater)
      const allowed = wading
        ? waterAllows(a, scratch.x, scratch.z) && (a.water.inWater || dh <= step * profile.slope * 1.6 + 0.03)
        : habitatAllows(a.species, scratch.x, scratch.z, false) && (a.species === "duck" || dh <= step * profile.slope + 0.015)
      const purposeful = (a.state === "shelter" || a.state === "drink" || a.state === "bathe" || a.state === "emerge") && !a.atWater
      // progress toward the goal; a trunk met head-on pushes the step back to ~0
      const progress = ((scratch.x - a.x) * dx + (scratch.z - a.z) * dz) / d
      if (allowed && Math.hypot(scratch.x - a.x, scratch.z - a.z) <= step + 0.05) { a.x = scratch.x; a.z = scratch.z }
      else if (!(hit && purposeful)) { speed = 0; a.targetSpeed = 0 }
      if (hit || !allowed) {
        // a trunk in the way of cover or water: walk round it and carry on
        if (purposeful && hit && allowed) {
          if (progress < step * 0.35 && a.detour <= 0) startDetour(a, step, profile.radius * a.scale)
          continue
        }
        if (a.state === "bathe") { a.state = "emerge"; a.tx = a.bankX; a.tz = a.bankZ; a.timer = 30; a.atWater = false; continue }
        if (a.state === "emerge" || a.water.inWater) {
          // the way back is blocked: make for the nearest dry bank instead
          const shore = findShore(a.x, a.z, (x, z) => habitatAllows(a.species, x, z, false))
          if (shore) { a.state = "emerge"; a.tx = shore.x; a.tz = shore.z; a.timer = 30; continue }
        }
        a.state = a.species === "duck" ? "swim" : "idle"; a.timer = 0.5 + a.random(); a.atWater = false; a.faceHeading = Number.NaN; pickWander(a)
      }
    } else if (a.state === "drink" && a.atWater && Number.isFinite(a.faceHeading)) {
      a.heading += angle(a.faceHeading - a.heading) * (1 - Math.exp(-2.5 * hdt))
    } else if (["sit", "watch", "approach"].includes(a.state) && Math.hypot(player.x - a.x, player.z - a.z) < 9) {
      a.heading += angle(Math.atan2(player.x - a.x, player.z - a.z) - a.heading) * (1 - Math.exp(-2 * hdt))
    }
  }
  const distance = Math.hypot(a.x - ox, a.z - oz)
  a.travelled += distance
  a.speed = distance / Math.max(dt, 1e-4)
  a.turnRate = angle(a.heading - heading) / Math.max(dt, 1e-4)
  if (a.groundOffset && Math.hypot(a.x - a.homeX, a.z - a.homeZ) > 0.4) a.groundOffset = 0
  if (a.species === "duck") a.y = WATER_LEVEL
  else {
    const way = WATER_WAYS[a.species]
    const bed = worldHeight(a.x, a.z) + (a.groundOffset ?? 0)
    const near = Math.hypot(player.x - a.x, player.z - a.z) < 45
    stepWaterContact(a.water, way, a.scale, a.x, a.z, bed, a.heading, a.speed, dt, near)
    let swim = 0
    a.y = bed
    if (a.water.inWater) {
      const w = creatureWaterY(a.x, a.z, way, a.scale, bed)
      swim = w.swim
      // afloat, the body rises and falls a little with each stroke
      a.y = w.y + (swim > 0 ? Math.sin(a.travelled * 3 + a.seed) * 0.012 * way.shoulder * a.scale : 0)
      // the soak: lying down in the shallows, only the head and back showing
      if (swim > 0.5) {
        // rivers carry swimmers downstream a little as they cross
        const c = waterCurrentAt(a.x, a.z, scratch)
        const cx = a.x + c.x * dt * 0.6, cz = a.z + c.z * dt * 0.6
        if (waterAllows(a, cx, cz)) { a.x = cx; a.z = cz }
      }
    }
    a.swim = damp(a.swim, swim, 4, dt)
  }
  // a paddling duck's wake: a small ring every few body lengths, only where
  // someone is near enough to see it (the ring pool is shared)
  if (a.species === "duck" && a.speed > 0.05 && Math.hypot(player.x - a.x, player.z - a.z) < 60) {
    const last = duckWakeAt.get(a) ?? a.travelled
    if (a.travelled - last > 0.4) {
      duckWakeAt.set(a, a.travelled)
      emitRipple(a.x - Math.sin(a.heading) * 0.12, a.z - Math.cos(a.heading) * 0.12, 0.28 + Math.min(0.3, a.speed * 0.3), 1.5)
    } else if (!duckWakeAt.has(a)) duckWakeAt.set(a, a.travelled)
  }
  a.groundTimer -= dt
  if (a.groundTimer <= 0 && a.species !== "duck") {
    a.groundTimer = 0.15
    a.groundDx = (worldHeight(a.x + 0.35, a.z) - worldHeight(a.x - 0.35, a.z)) / 0.7
    a.groundDz = (worldHeight(a.x, a.z + 0.35) - worldHeight(a.x, a.z - 0.35)) / 0.7
  }
  const soaking = a.state === "bathe" && a.atWater && a.bathKind === "soak"
  a.sit = damp(a.sit, a.state === "sit" || soaking ? 1 : 0, soaking ? 1.5 : 4, dt)
  a.sleep = damp(a.sleep, a.state === "sleep" ? 1 : 0, 3, dt)
  // standing in the shallows it drinks again now and then, or noses the surface
  const sipping = a.state === "bathe" && a.atWater && a.bathKind === "wade" && Math.sin(a.travelled * 0.7 + a.timer * 0.9) > 0.55
  a.graze = damp(a.graze, a.state === "graze" || (a.state === "drink" && a.atWater) || sipping || a.act === "splash" ? (a.act === "splash" ? 0.5 : 1) : 0, 3, dt)
  a.actW = actEnvelope(a.act, a.actTime)
  // watching the explorer: head high, ears forward, the deer's tail flagged
  a.alert = damp(a.alert, a.state === "watch" || a.state === "flee" ? 1 : 0, 5, dt)
  a.thump = Math.max(0, a.thump - dt * 3)
}

const duckWakeAt = new WeakMap<object, number>()
