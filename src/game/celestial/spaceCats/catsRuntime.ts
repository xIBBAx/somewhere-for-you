import * as THREE from "three"
import type { CrewId } from "./crew"

/**
 * The space cats' shared runtime state (SpaceCats.tsx owns it; the sky panel,
 * the star chart, the Star Nook prompt and QA read it).
 */
export type CatPhase = "none" | "waiting" | "escort" | "landing" | "flying" | "homing" | "nook"

export const spaceCatsRT = {
  phase: "none" as CatPhase,
  /** the L1 point (universe) and whether it is known yet */
  pod: new THREE.Vector3(),
  podReady: false,
  /** from the ridden mount to the crew (game m) */
  mountDistance: Infinity,
  canGather: false,
  /** the mount they follow (horse id) */
  following: null as string | null,
  /** Starborn noticed them this session (so she slows only once) */
  noticed: false,
  /** QA and the Star Nook prompt: where each cat is and what it is doing */
  cats: [] as Array<{ id: CrewId; name: string; x: number; y: number; z: number; act: string; visible: boolean; loaded: boolean }>,
  /** a request from the Star Nook prompt: say hello to this cat */
  greet: null as CrewId | null,
  /** QA or a replay: put the crew back in their kit and read the voyage again */
  reset: false,
  /** QA: a camera kept on one cat (distance, compass bearing in degrees, height) */
  look: null as { id: CrewId; dist: number; bearing: number; up: number } | null,
  /** QA: the scene (for counting every cat model in it) */
  scene: null as THREE.Object3D | null,
  /** QA: a look at the scene objects themselves */
  probe: (() => null) as () => unknown,
}

