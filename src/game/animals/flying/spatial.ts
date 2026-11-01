import { distanceSquared, type FlightPoint } from "./primitives"

export type SpatialFlightAgent = { position: FlightPoint }

/**
 * Fixed-capacity hashed 3D cells. Hash collisions are filtered by actual cell
 * coordinates. Build once per simulation tick, query into caller-owned buffers.
 * Queries return nearest entries, with stable index tie-breaking, even when the
 * requested neighbourhood exceeds the output capacity.
 */
export class FlightSpatialGrid {
  private readonly heads: Int32Array
  private readonly next: Int32Array
  private readonly cells: Int32Array
  private readonly distances: Float64Array
  private agents: readonly SpatialFlightAgent[] = []
  private readonly mask: number
  readonly cellSize: number
  candidatesVisited = 0

  constructor(readonly capacity: number, cellSize = 4, bucketCount = 2048) {
    if (!Number.isInteger(capacity) || capacity < 1 || !Number.isFinite(cellSize) || cellSize <= 0 ||
        !Number.isInteger(bucketCount) || bucketCount < 1 || (bucketCount & (bucketCount - 1)) !== 0)
      throw new RangeError("Invalid flight spatial grid configuration")
    this.cellSize = cellSize
    this.mask = bucketCount - 1
    this.heads = new Int32Array(bucketCount).fill(-1)
    this.next = new Int32Array(capacity)
    this.cells = new Int32Array(capacity * 3)
    this.distances = new Float64Array(capacity)
  }

  private bucket(x: number, y: number, z: number): number {
    return (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & this.mask
  }

  rebuild(agents: readonly SpatialFlightAgent[]): void {
    if (agents.length > this.capacity) throw new RangeError("Flight population exceeds spatial capacity")
    this.agents = agents
    this.heads.fill(-1)
    this.candidatesVisited = 0
    for (let i = 0; i < agents.length; i++) {
      const p = agents[i].position
      if (!Number.isFinite(p.x + p.y + p.z)) throw new RangeError("Non-finite flight position")
      const x = Math.floor(p.x / this.cellSize)
      const y = Math.floor(p.y / this.cellSize)
      const z = Math.floor(p.z / this.cellSize)
      this.cells[i * 3] = x; this.cells[i * 3 + 1] = y; this.cells[i * 3 + 2] = z
      const bucket = this.bucket(x, y, z)
      this.next[i] = this.heads[bucket]
      this.heads[bucket] = i
    }
  }

  query(point: FlightPoint, radius: number, output: Int32Array, exclude = -1): number {
    if (!Number.isFinite(radius) || radius < 0 || !Number.isFinite(point.x + point.y + point.z))
      throw new RangeError("Invalid spatial query")
    const limit = Math.min(output.length, this.capacity)
    if (limit === 0) return 0
    const radiusSquared = radius * radius
    const minX = Math.floor((point.x - radius) / this.cellSize)
    const maxX = Math.floor((point.x + radius) / this.cellSize)
    const minY = Math.floor((point.y - radius) / this.cellSize)
    const maxY = Math.floor((point.y + radius) / this.cellSize)
    const minZ = Math.floor((point.z - radius) / this.cellSize)
    const maxZ = Math.floor((point.z + radius) / this.cellSize)
    let count = 0
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) for (let z = minZ; z <= maxZ; z++) {
      for (let i = this.heads[this.bucket(x, y, z)]; i !== -1; i = this.next[i]) {
        if (i === exclude || this.cells[i * 3] !== x || this.cells[i * 3 + 1] !== y || this.cells[i * 3 + 2] !== z) continue
        this.candidatesVisited++
        const distance = distanceSquared(point, this.agents[i].position)
        if (distance > radiusSquared) continue
        let rank = count
        while (rank > 0 && (distance < this.distances[rank - 1] ||
          (distance === this.distances[rank - 1] && i < output[rank - 1]))) rank--
        if (rank >= limit) continue
        for (let j = Math.min(count, limit - 1); j > rank; j--) {
          output[j] = output[j - 1]; this.distances[j] = this.distances[j - 1]
        }
        output[rank] = i; this.distances[rank] = distance
        count = Math.min(count + 1, limit)
      }
    }
    return count
  }
}
