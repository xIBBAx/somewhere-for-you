import * as THREE from "three"

/**
 * Feeds the HTML loader (index.html, window.__bootProgress) with real
 * progress: the app starting, every model/texture fetched through three.js'
 * default loading manager, the world streaming in around the spawn point and
 * finally shader warm-up. The loader never moves backwards.
 */
type BootWindow = Window & { __bootProgress?: (value: number) => void }

const report = (value: number): void => {
  ;(window as BootWindow).__bootProgress?.(value)
}

let assets = 0
let stage = 0.12

const update = (): void => report(stage + assets * 0.58)

export const bootProgress = {
  /** the app module graph has run */
  started: (): void => { stage = Math.max(stage, 0.12); update() },
  /** spawn chunks and both characters are ready */
  worldReady: (): void => { stage = Math.max(stage, 0.3); assets = Math.max(assets, 0.9); update() },
  /** shaders compiled; the loader can finish */
  warmed: (): void => report(1),
  /** a warm-up step completed (0..1 of that phase) */
  warming: (t: number): void => report(0.82 + t * 0.16),
}

THREE.DefaultLoadingManager.onProgress = (_url, loaded, total) => {
  if (total > 0) {
    assets = Math.max(assets, loaded / total)
    update()
  }
}

bootProgress.started()
