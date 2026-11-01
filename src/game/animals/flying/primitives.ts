/** Small mutable vectors keep the simulation independent of the renderer. */
export type FlightPoint = { x: number; y: number; z: number }

export const flightPoint = (x = 0, y = 0, z = 0): FlightPoint => ({ x, y, z })
export const distanceSquared = (a: FlightPoint, b: FlightPoint): number =>
  (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2

/** FNV-1a identity plus a local PRNG: never consumes global randomness or wall time. */
export function identitySeed(id: string, worldSeed: number): number {
  let hash = (2166136261 ^ worldSeed) >>> 0
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619) >>> 0
  return hash
}

export function flightRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Render frames feed elapsed time; biological decisions run on integer ticks.
 * A suspended tab cannot enqueue minutes of catch-up work. Lost wall time is
 * explicit telemetry, never a position jump or an oversized integration step.
 */
export class FlightClock {
  readonly step: number
  readonly maxSteps: number
  ticks = 0
  discardedSeconds = 0
  private accumulator = 0

  constructor(hz = 60, maxSteps = 8) {
    if (!Number.isFinite(hz) || hz <= 0 || !Number.isInteger(maxSteps) || maxSteps < 1)
      throw new RangeError("Invalid flight clock configuration")
    this.step = 1 / hz
    this.maxSteps = maxSteps
  }

  get time(): number { return this.ticks * this.step }
  get interpolation(): number { return this.accumulator / this.step }

  advance(elapsed: number, simulate: (dt: number, tick: number) => void): number {
    if (!Number.isFinite(elapsed) || elapsed < 0) throw new RangeError("Invalid elapsed time")
    const accepted = Math.min(elapsed, this.step * this.maxSteps)
    this.discardedSeconds += elapsed - accepted
    this.accumulator += accepted
    let steps = 0
    while (this.accumulator + 1e-10 >= this.step && steps < this.maxSteps) {
      simulate(this.step, this.ticks)
      this.ticks++
      this.accumulator = Math.max(0, this.accumulator - this.step)
      steps++
    }
    return steps
  }
}
