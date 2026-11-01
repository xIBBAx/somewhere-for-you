import { gift } from "../../personalization"

/**
 * What the high mountain valley and its bench are called on maps and in
 * travel (personalization `places.valleyName` / `places.benchName`). Read
 * once at start-up; never imported by the terrain workers.
 */
export const HIGHVALE_NAME = gift().places.valleyName
export const BENCH_ID = "highvale-bench"
export const BENCH_NAME = gift().places.benchName
