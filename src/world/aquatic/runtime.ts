import { WATER_LEVEL, lakeMask } from "../climate"
import { worldHeight } from "../terrain"
import { waterZone } from "./habitat"

export const aquaticStats = { chunks: 0, fish: 0, full: 0, reduced: 0, surface: 0, ripples: 0, drawCalls: 0,
  cpuMs: 0, averageCpuMs: 0, maxCpuMs: 0, frames: 0, refreshMs: 0 }
export const aquaticRT = {
  enabled: true,
  request: null as null | ((x: number, z: number) => "ready" | "pending" | "dry"),
  snapshots: () => ({} as object),
  exercise: null as null | ((kind: "jump" | "rise" | "croak") => boolean),
}

export const spawnAquaticTestPopulation = (x: number, z: number): "ready" | "pending" | "dry" => {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return "dry"
  return aquaticRT.request?.(x, z) ?? "pending"
}

export const sampleAquaticWater = (x: number, z: number): object => {
  const bed = worldHeight(x, z), depth = WATER_LEVEL - bed
  return { x, z, bed, surface: WATER_LEVEL, depth, lakeMask: lakeMask(x, z), zone: waterZone(depth) }
}
