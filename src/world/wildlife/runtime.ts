import type { AnimalAgent } from "./behavior"
import type { AnimalSpawn } from "./population"

/** Stable diagnostics shared by the scene and the debug panel, including HMR. */
export const wildlifeStats = { known: 0, active: 0, rendered: 0, near: 0, middle: 0, far: 0, simulationMs: 0 }
export const wildlifeRT = {
  nearAnimal: null as string | null,
  walkers: new Map<string, AnimalAgent>(),
  snapshots: (): Array<Record<string, unknown>> => [],
  /** QA-only animals (`__worldDev.catParade`), kept outside the population budget */
  extra: [] as AnimalSpawn[],
}
