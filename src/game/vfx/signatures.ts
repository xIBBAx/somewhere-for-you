import * as THREE from "three"
import { coneDirection, emit, lumenBudget, rand, Shape } from "./lumenCore"
import { emitPetal, PetalKind } from "./petals"

/**
 * The look of each moment, composed from Lumen light and real petals. Each
 * one is its own small piece of choreography (timing, shape, colour and
 * physics), not one burst recoloured: a hug blooms from the ground up, a
 * high five cracks outward and falls as sparks, a found wonder rises as a
 * column of light.
 */

const colorCache = new Map<string, THREE.Color>()
export const col = (hex: string): THREE.Color => {
  let c = colorCache.get(hex)
  if (!c) {
    c = new THREE.Color(hex)
    colorCache.set(hex, c)
  }
  return c
}

const count = (n: number): number => Math.max(1, Math.round(n * lumenBudget.scale))
const UP = new THREE.Vector3(0, 1, 0)
const _d = new THREE.Vector3()
const _c = new THREE.Color()

/** a colour a little warmer or cooler than the given one (linear) */
const vary = (base: THREE.Color, spread = 0.12): THREE.Color =>
  _c.copy(base).offsetHSL(rand(-spread, spread) * 0.15, rand(-0.1, 0.1), rand(-spread, spread) * 0.5)

/**
 * The general celebration (every older `spawnBurst` call): glints that pop
 * and turn, motes that rise on the air, and one soft ring.
 */
export const celebrate = (at: THREE.Vector3, n = 14, hex = "#ffd9a0", spread = 1.6): void => {
  const base = col(hex)
  const motes = count(n * 1.6)
  for (let i = 0; i < motes; i++) {
    const a = Math.random() * Math.PI * 2
    const r = Math.random() * spread * 0.45
    emit({
      x: at.x + Math.cos(a) * r * 0.4, y: at.y + rand(-0.15, 0.25), z: at.z + Math.sin(a) * r * 0.4,
      vx: Math.cos(a) * r * 1.2, vy: rand(0.5, 1.6) * Math.sqrt(spread), vz: Math.sin(a) * r * 1.2,
      life: rand(1.3, 2.6), color: vary(base), intensity: rand(1.4, 2.6), size: rand(0.045, 0.09),
      drag: 1.6, gravity: -0.12, shape: Shape.Glow, curl: rand(0.08, 0.22),
    })
  }
  const glints = count(Math.max(3, n * 0.35))
  for (let i = 0; i < glints; i++) {
    coneDirection(UP, 1.2, _d)
    const s = rand(0.6, 1.4) * spread
    emit({
      x: at.x, y: at.y + 0.1, z: at.z, vx: _d.x * s, vy: _d.y * s, vz: _d.z * s,
      life: rand(0.7, 1.3), color: base, intensity: rand(2.5, 4), size: rand(0.12, 0.22),
      drag: 2.6, gravity: 0.25, shape: Shape.Glint, spin: rand(-2, 2), delay: rand(0, 0.15),
    })
  }
  emit({ x: at.x, y: at.y, z: at.z, life: 0.8, color: base, intensity: 0.7, size: 0.35 + spread * 0.22, shape: Shape.Ring, grow: 1.4 })
}

/**
 * A hug: warmth that starts at their feet. Two rose-gold rings run out over
 * the ground, a helix of real rose petals lifts round them, and embers of
 * warm light rise between them.
 */
export const hugBloom = (at: THREE.Vector3, ground: number): void => {
  const rose = col("#ff8fb1")
  const gold = col("#ffd08a")
  for (let i = 0; i < 2; i++) {
    emit({ x: at.x, y: ground + 0.06, z: at.z, life: 1.5, color: i ? gold : rose, intensity: 0.7 - i * 0.15, size: 1.0 + i * 0.45, shape: Shape.Ring, axis: UP, grow: 1.5, delay: i * 0.28 })
  }
  const petals = count(34)
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 6 + rand(-0.3, 0.3)
    const r = 0.55 + rand(-0.1, 0.25)
    const tangent = 1.1
    emitPetal({
      x: at.x + Math.cos(a) * r, y: ground + 0.25 + (i / petals) * 0.6, z: at.z + Math.sin(a) * r,
      vx: -Math.sin(a) * tangent + Math.cos(a) * 0.35, vy: rand(1.6, 2.6), vz: Math.cos(a) * tangent + Math.sin(a) * 0.35,
      life: rand(3.2, 4.6), color: vary(i % 3 ? rose : col("#ffc0cf"), 0.25).clone(), kind: PetalKind.Rose,
      size: rand(0.09, 0.13), drag: 1.5, gravity: 0.55, spin: rand(2, 5), flutter: rand(0.15, 0.35), delay: i * 0.018,
    })
  }
  const embers = count(26)
  for (let i = 0; i < embers; i++) {
    emit({
      x: at.x + rand(-0.25, 0.25), y: at.y + rand(-0.4, 0.3), z: at.z + rand(-0.25, 0.25),
      vx: rand(-0.2, 0.2), vy: rand(0.4, 1.1), vz: rand(-0.2, 0.2),
      life: rand(1.8, 3.2), color: vary(gold), intensity: rand(1.4, 2.6), size: rand(0.03, 0.06),
      drag: 0.8, gravity: -0.18, shape: Shape.Glow, curl: 0.16, delay: rand(0, 0.6),
    })
  }
  emit({ x: at.x, y: at.y, z: at.z, life: 1.4, color: rose, intensity: 0.7, size: 0.9, shape: Shape.Glow })
}

/**
 * A high five: a white-hot crack of light at the palms, sparks thrown out
 * and falling under gravity with motion blur, a shock ring in the air and a
 * smaller one on the ground.
 */
export const highFiveClap = (at: THREE.Vector3, ground: number): void => {
  const hot = col("#fff4d6")
  const gold = col("#ffcf6b")
  emit({ x: at.x, y: at.y, z: at.z, life: 0.32, color: hot, intensity: 5, size: 0.55, shape: Shape.Glow })
  emit({ x: at.x, y: at.y, z: at.z, life: 0.5, color: hot, intensity: 3, size: 0.42, shape: Shape.Glint, spin: 1.5 })
  emit({ x: at.x, y: at.y, z: at.z, life: 0.4, color: gold, intensity: 0.9, size: 0.55, shape: Shape.Ring, grow: 1.8 })
  emit({ x: at.x, y: ground + 0.05, z: at.z, life: 0.8, color: gold, intensity: 0.55, size: 0.9, shape: Shape.Ring, axis: UP, grow: 1.5, delay: 0.05 })
  const sparks = count(34)
  for (let i = 0; i < sparks; i++) {
    _d.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize()
    const s = rand(3.5, 7.5)
    emit({
      x: at.x, y: at.y, z: at.z, vx: _d.x * s, vy: _d.y * s + 1.2, vz: _d.z * s,
      life: rand(0.45, 0.95), color: i % 4 ? gold : hot, intensity: rand(2.5, 4.5), size: rand(0.018, 0.03),
      drag: 3.2, gravity: 6, shape: Shape.Streak, stretch: 0.055,
    })
  }
  const glints = count(6)
  for (let i = 0; i < glints; i++) {
    coneDirection(UP, 1.4, _d)
    emit({ x: at.x, y: at.y, z: at.z, vx: _d.x * 2.2, vy: _d.y * 2.2, vz: _d.z * 2.2, life: rand(0.6, 1), color: hot, intensity: 3, size: rand(0.1, 0.18), drag: 3, gravity: 0.6, shape: Shape.Glint, spin: rand(-3, 3), delay: rand(0.04, 0.18) })
  }
}

/**
 * Fireflies caught in cupped hands: a few gathered motes spiral in, then the
 * light leaks out between the fingers in soft pulses.
 */
export const fireflyCupped = (hands: THREE.Vector3): void => {
  const green = col("#d9ff8a")
  const n = count(14)
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const r = rand(0.5, 1.1)
    const h = rand(-0.2, 0.6)
    emit({
      x: hands.x + Math.cos(a) * r, y: hands.y + h, z: hands.z + Math.sin(a) * r,
      vx: -Math.cos(a) * r * 2.4 - Math.sin(a) * 1.2, vy: -h * 2.4, vz: -Math.sin(a) * r * 2.4 + Math.cos(a) * 1.2,
      life: rand(0.45, 0.75), color: green, intensity: rand(2, 3.2), size: rand(0.03, 0.05), drag: 3.5, shape: Shape.Glow,
    })
  }
  for (let i = 0; i < 4; i++) {
    emit({ x: hands.x, y: hands.y, z: hands.z, life: 0.7, color: green, intensity: 1.6 - i * 0.25, size: 0.22, shape: Shape.Glow, delay: 0.35 + i * 0.45 })
  }
  const leak = count(10)
  for (let i = 0; i < leak; i++) {
    emit({
      x: hands.x + rand(-0.05, 0.05), y: hands.y + 0.04, z: hands.z + rand(-0.05, 0.05),
      vx: rand(-0.25, 0.25), vy: rand(0.2, 0.6), vz: rand(-0.25, 0.25),
      life: rand(1, 1.8), color: green, intensity: 1.4, size: 0.02, drag: 1.2, gravity: -0.05, shape: Shape.Mote, curl: 0.12, delay: rand(0.4, 2.2),
    })
  }
}

/** A flower picked: pollen drifting off in the light, and a few loose petals. */
export const bouquetGathered = (at: THREE.Vector3, hex = "#ff9ab8"): void => {
  const tint = col(hex)
  const pollen = col("#fff1b0")
  const n = count(40)
  for (let i = 0; i < n; i++) {
    emit({
      x: at.x + rand(-0.2, 0.2), y: at.y + rand(-0.1, 0.2), z: at.z + rand(-0.2, 0.2),
      vx: rand(-0.5, 0.5), vy: rand(0.1, 0.7), vz: rand(-0.5, 0.5),
      life: rand(2, 3.8), color: pollen, intensity: rand(0.8, 1.6), size: rand(0.012, 0.024), drag: 1.1, gravity: -0.02, shape: Shape.Mote, curl: 0.2,
    })
  }
  const petals = count(14)
  for (let i = 0; i < petals; i++) {
    emitPetal({
      x: at.x + rand(-0.15, 0.15), y: at.y + 0.1, z: at.z + rand(-0.15, 0.15),
      vx: rand(-0.9, 0.9), vy: rand(0.8, 1.8), vz: rand(-0.9, 0.9),
      life: rand(2.4, 3.4), color: vary(tint, 0.3).clone(), kind: i % 2 ? PetalKind.Blossom : PetalKind.Rose,
      size: rand(0.07, 0.1), drag: 1.8, gravity: 0.7, spin: rand(3, 6), flutter: 0.22,
    })
  }
  emit({ x: at.x, y: at.y, z: at.z, life: 0.8, color: pollen, intensity: 1.2, size: 0.6, shape: Shape.Glint, spin: 0.8 })
}

const CONFETTI = ["#ff5d7a", "#ffcf3f", "#4fd1ff", "#9b7bff", "#5ce1a2", "#ff9e3d", "#ffffff"]

/**
 * A race won (or finished): two bursts of real foil confetti thrown up from
 * the line, fluttering down through the light; streamers of sparks first.
 */
export const confettiCelebration = (at: THREE.Vector3, won: boolean): void => {
  const n = count(won ? 190 : 90)
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1
    _d.set(side * rand(0.1, 0.7), rand(0.8, 1.4), rand(-0.6, 0.6)).normalize()
    const s = rand(5, 8.5)
    emitPetal({
      x: at.x + side * 1.6, y: at.y - 1, z: at.z, vx: _d.x * s, vy: _d.y * s, vz: _d.z * s,
      life: rand(4.5, 7), color: col(CONFETTI[i % CONFETTI.length]), kind: i % 9 === 0 ? PetalKind.Blossom : PetalKind.Confetti,
      size: rand(0.07, 0.1), drag: 2.6, gravity: 3.2, spin: rand(5, 11), flutter: rand(0.2, 0.45), delay: Math.floor(i / (n / 3)) * 0.22,
    })
  }
  const gold = col(won ? "#ffe08a" : "#bfe3ff")
  const sparks = count(40)
  for (let i = 0; i < sparks; i++) {
    coneDirection(UP, 0.6, _d)
    const s = rand(8, 14)
    emit({ x: at.x + rand(-1.5, 1.5), y: at.y - 1, z: at.z, vx: _d.x * s, vy: _d.y * s, vz: _d.z * s, life: rand(0.8, 1.4), color: gold, intensity: 3, size: 0.03, drag: 2.4, gravity: 5, shape: Shape.Streak, stretch: 0.06 })
  }
  emit({ x: at.x, y: at.y, z: at.z, life: 0.6, color: gold, intensity: 1.4, size: 1.4, shape: Shape.Ring, grow: 1.6 })
}

/**
 * A wonder found: a column of light that rises from where it stands, a ring
 * running out over the ground and glints turning in the air above.
 */
export const discoveryPillar = (at: THREE.Vector3, ground: number, hex = "#ffe7b0", fresh = true): void => {
  const c = col(hex)
  emit({ x: at.x, y: ground + 0.05, z: at.z, life: 1.6, color: c, intensity: 0.6, size: 1.1, shape: Shape.Ring, axis: UP, grow: 1.7 })
  const n = count(fresh ? 46 : 20)
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const r = rand(0.05, 0.4)
    emit({
      x: at.x + Math.cos(a) * r, y: ground + rand(0, 0.6), z: at.z + Math.sin(a) * r,
      vx: -Math.sin(a) * 0.5, vy: rand(1.6, 3.6), vz: Math.cos(a) * 0.5,
      life: rand(1.4, 2.4), color: vary(c), intensity: rand(1.6, 2.8), size: rand(0.025, 0.05), drag: 0.9, gravity: -0.3, shape: Shape.Glow, curl: 0.06, delay: rand(0, 0.5),
    })
  }
  const glints = count(fresh ? 7 : 3)
  for (let i = 0; i < glints; i++) {
    emit({ x: at.x + rand(-0.6, 0.6), y: ground + rand(1.4, 2.8), z: at.z + rand(-0.6, 0.6), vy: 0.3, life: rand(0.9, 1.5), color: c, intensity: 3.2, size: rand(0.14, 0.24), drag: 1, shape: Shape.Glint, spin: rand(-1.5, 1.5), delay: 0.3 + rand(0, 0.7) })
  }
}

/** A purring cat, a nuzzle: thistledown-soft motes drifting up, no hearts. */
export const affectionDrift = (at: THREE.Vector3, hex = "#ffc3d6"): void => {
  const c = col(hex)
  const n = count(16)
  for (let i = 0; i < n; i++) {
    emit({
      x: at.x + rand(-0.25, 0.25), y: at.y + rand(-0.1, 0.15), z: at.z + rand(-0.25, 0.25),
      vx: rand(-0.15, 0.15), vy: rand(0.25, 0.6), vz: rand(-0.15, 0.15),
      life: rand(1.8, 3), color: vary(c, 0.2), intensity: rand(0.9, 1.6), size: rand(0.03, 0.055), drag: 1, gravity: -0.06, shape: Shape.Glow, curl: 0.14, delay: rand(0, 0.6),
    })
  }
  emit({ x: at.x, y: at.y, z: at.z, life: 1.1, color: c, intensity: 0.6, size: 0.45, shape: Shape.Glow })
}

/** The little star of a memory lifting off her: a glint, a ring, a tail of light. */
export const starLift = (at: THREE.Vector3): void => {
  const gold = col("#ffe3a3")
  emit({ x: at.x, y: at.y, z: at.z, life: 0.8, color: gold, intensity: 1.6, size: 0.55, shape: Shape.Ring, grow: 1.5 })
  emit({ x: at.x, y: at.y, z: at.z, life: 1.1, color: gold, intensity: 3, size: 0.35, shape: Shape.Glint, spin: 1.2 })
  const n = count(18)
  for (let i = 0; i < n; i++) {
    emit({ x: at.x + rand(-0.1, 0.1), y: at.y, z: at.z + rand(-0.1, 0.1), vx: rand(-0.3, 0.3), vy: rand(1.2, 2.6), vz: rand(-0.3, 0.3), life: rand(0.9, 1.6), color: gold, intensity: 2, size: 0.035, drag: 1.3, gravity: -0.2, shape: Shape.Glow, curl: 0.1, delay: i * 0.03 })
  }
}

/** A soft trail particle (the risen star, a lifted rider): call each frame. */
export const trailMote = (at: THREE.Vector3, hex: string, intensity = 1.6, size = 0.04): void => {
  emit({ x: at.x + rand(-0.04, 0.04), y: at.y + rand(-0.04, 0.04), z: at.z + rand(-0.04, 0.04), vx: rand(-0.1, 0.1), vy: rand(-0.05, 0.2), vz: rand(-0.1, 0.1), life: rand(0.6, 1.1), color: col(hex), intensity, size, drag: 1.5, shape: Shape.Glow, curl: 0.05 })
}

/**
 * The finale's bloom in the garden: marigold petals falling over everyone,
 * rings of light over the lawn and glints rising like the first stars.
 */
export const gardenBloom = (at: THREE.Vector3, ground: number): void => {
  const n = count(160)
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const r = rand(0, 7)
    emitPetal({
      x: at.x + Math.cos(a) * r, y: ground + rand(5, 9), z: at.z + Math.sin(a) * r,
      vx: rand(-0.4, 0.4), vy: rand(-0.3, 0.2), vz: rand(-0.4, 0.4),
      life: rand(6, 9), color: vary(col(i % 4 ? "#ff9d2e" : "#ffd24a"), 0.15).clone(), kind: PetalKind.Blossom,
      size: rand(0.07, 0.1), drag: 2.4, gravity: 0.9, spin: rand(2, 5), flutter: rand(0.3, 0.6), delay: rand(0, 2.5),
    })
  }
  for (let i = 0; i < 3; i++) {
    emit({ x: at.x, y: ground + 0.06, z: at.z, life: 2.2, color: col(i === 1 ? "#ffd9a0" : "#ff9ab8"), intensity: 0.55, size: 2.4 + i * 1.4, shape: Shape.Ring, axis: UP, grow: 1.5, delay: i * 0.4 })
  }
  celebrate(at, 30, "#ffd9a0", 2.4)
}

/**
 * Water struck by a skipped stone: a crown of droplets thrown up and falling
 * back, a ring of light on the surface (the sky in the ripple).
 */
export const skipCrown = (x: number, y: number, z: number, strength = 1): void => {
  const water = col("#dff4ff")
  const n = count(16 * strength)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2)
    const s = rand(1.4, 2.6) * strength
    emit({ x: x + Math.cos(a) * 0.08, y: y + 0.02, z: z + Math.sin(a) * 0.08, vx: Math.cos(a) * s * 0.55, vy: rand(1.6, 2.8) * strength, vz: Math.sin(a) * s * 0.55, life: rand(0.45, 0.75), color: water, intensity: 1.4, size: 0.016, drag: 0.6, gravity: 9.8, shape: Shape.Streak, stretch: 0.035 })
  }
  emit({ x, y: y + 0.02, z, life: 1.3, color: water, intensity: 0.7, size: 0.5 + strength * 0.3, shape: Shape.Ring, axis: UP, grow: 2.2 })
}

/** A sky lantern let go: embers shaken loose from the flame as it lifts. */
export const lanternEmbers = (at: THREE.Vector3): void => {
  const flame = col("#ffb562")
  const n = count(22)
  for (let i = 0; i < n; i++) {
    emit({ x: at.x + rand(-0.12, 0.12), y: at.y + rand(-0.05, 0.1), z: at.z + rand(-0.12, 0.12), vx: rand(-0.4, 0.4), vy: rand(0.5, 1.6), vz: rand(-0.4, 0.4), life: rand(1.2, 2.4), color: flame, intensity: rand(2, 3.5), size: rand(0.025, 0.045), drag: 1.3, gravity: -0.2, shape: Shape.Ember, curl: 0.14, spin: rand(0, 6) })
  }
  emit({ x: at.x, y: at.y, z: at.z, life: 0.9, color: flame, intensity: 1.4, size: 0.7, shape: Shape.Glow })
}

/**
 * A beat of their dance: a ripple of light runs out from their feet and a
 * ring of motes turns round them, rising with the music's sway.
 */
export const danceBeat = (mid: THREE.Vector3, ground: number): void => {
  const rose = col("#ffb3c8")
  const gold = col("#ffe3a8")
  emit({ x: mid.x, y: ground + 0.05, z: mid.z, life: 1.4, color: rose, intensity: 0.5, size: 1.1, shape: Shape.Ring, axis: UP, grow: 1.6 })
  const n = count(18)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const r = 0.9
    emit({
      x: mid.x + Math.cos(a) * r, y: ground + 0.3 + rand(0, 0.5), z: mid.z + Math.sin(a) * r,
      vx: -Math.sin(a) * 1.4, vy: rand(0.35, 0.8), vz: Math.cos(a) * 1.4,
      life: rand(1.4, 2.2), color: i % 2 ? rose : gold, intensity: rand(1.4, 2.2), size: rand(0.03, 0.05), drag: 0.9, gravity: -0.08, shape: Shape.Glow, curl: 0.08,
    })
  }
}

const TURF = ["#5f8a3a", "#7da24a", "#a8a25c", "#6b5a3a"]
const MEADOW = ["#ffd6e6", "#ffffff", "#ffe27a", "#c9b6ff"]

/**
 * A hoof leaving the ground at a gallop: bits of turf and grass thrown back
 * and up, now and then a flower's petals; snow in snow, spray when wet. Real
 * lit blades (not light), so they darken against the sun like the grass.
 */
export const hoofTurf = (x: number, y: number, z: number, heading: number, strength: number, snow: number, wet: number): void => {
  const bx = -Math.sin(heading), bz = -Math.cos(heading)
  if (snow > 0.35) {
    // clods of snow (lit, so the sun shades them against the white ground) and a glitter of powder
    const white = col("#f4f8ff")
    for (let i = 0; i < count(14 * strength); i++) {
      emitPetal({ x: x + rand(-0.12, 0.12), y: y + 0.05, z: z + rand(-0.12, 0.12), vx: bx * rand(1.4, 3.4) * strength + rand(-0.8, 0.8), vy: rand(1.6, 3.2) * strength, vz: bz * rand(1.4, 3.4) * strength + rand(-0.8, 0.8),
        life: rand(0.7, 1.1), color: white, kind: PetalKind.Rose, size: rand(0.09, 0.17), drag: 1.7, gravity: 6, spin: rand(4, 9), flutter: 0.02 })
    }
    for (let i = 0; i < count(4 * strength); i++) {
      emit({ x, y: y + 0.08, z, vx: bx * rand(0.6, 1.6) + rand(-0.5, 0.5), vy: rand(0.6, 1.4), vz: bz * rand(0.6, 1.6) + rand(-0.5, 0.5),
        life: rand(0.4, 0.8), color: white, intensity: 1.6, size: rand(0.05, 0.1), drag: 2.2, gravity: 1.5, shape: Shape.Glint, spin: rand(-2, 2) })
    }
    return
  }
  const pieces = count((3 + strength * 5) * (wet > 0.4 ? 0.6 : 1))
  for (let i = 0; i < pieces; i++) {
    const flower = Math.random() < 0.14
    emitPetal({
      x: x + rand(-0.08, 0.08), y: y + 0.04, z: z + rand(-0.08, 0.08),
      vx: bx * rand(1.2, 3) * strength + rand(-0.5, 0.5), vy: rand(1.2, 2.6) * strength, vz: bz * rand(1.2, 3) * strength + rand(-0.5, 0.5),
      life: rand(0.7, 1.2), color: col(flower ? MEADOW[i % MEADOW.length] : TURF[i % TURF.length]), kind: flower ? PetalKind.Blossom : PetalKind.Leaf,
      size: flower ? rand(0.05, 0.075) : rand(0.05, 0.09), drag: 1.5, gravity: 6.5, spin: rand(6, 12), flutter: 0.05,
    })
  }
  if (wet > 0.4) {
    const water = col("#e4f1ff")
    for (let i = 0; i < count(4 * strength); i++) {
      emit({ x, y: y + 0.03, z, vx: bx * rand(0.6, 1.6) + rand(-0.6, 0.6), vy: rand(1, 2.2), vz: bz * rand(0.6, 1.6) + rand(-0.6, 0.6), life: 0.45, color: water, intensity: 0.9, size: 0.012, drag: 0.6, gravity: 9.8, shape: Shape.Streak, stretch: 0.03 })
    }
  }
}

/** All four hooves coming down after a jump: a wider throw of turf and seed. */
export const jumpLanding = (x: number, y: number, z: number, heading: number, snow: number, wet: number): void => {
  for (let i = 0; i < 4; i++) {
    const a = heading + (i - 1.5) * 0.9
    hoofTurf(x + Math.sin(a) * 0.4, y, z + Math.cos(a) * 0.4, heading + Math.PI * (i % 2 ? 0.25 : -0.25), 1.4, snow, wet)
  }
  const seed = col("#fff2c4")
  for (let i = 0; i < count(10); i++) {
    emit({ x: x + rand(-0.6, 0.6), y: y + 0.1, z: z + rand(-0.6, 0.6), vx: rand(-0.4, 0.4), vy: rand(0.3, 0.9), vz: rand(-0.4, 0.4), life: rand(1.5, 2.8), color: seed, intensity: 0.7, size: rand(0.015, 0.025), drag: 1.2, gravity: -0.03, shape: Shape.Mote, curl: 0.25 })
  }
}

/** The purr itself: a faint ring of warm light that runs out over the grass round a contented cat. */
export const purrRipple = (at: THREE.Vector3): void => {
  emit({ x: at.x, y: at.y, z: at.z, life: 1.3, color: col("#ffc3d6"), intensity: 0.4, size: 0.5, shape: Shape.Ring, axis: UP, grow: 1.8 })
}
