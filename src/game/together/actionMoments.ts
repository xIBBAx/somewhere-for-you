/**
 * Once-per-action moments: the squeeze of a hug, the clap of a high five.
 *
 * Effects used to fire inside a fixed 1/30 s window after a moment's time,
 * so a 15 FPS frame could step over the window (no clap, no count) and a
 * 120 FPS run could land in it several times (double claps, double counts).
 * A moment now fires on the first frame the action clock reaches it and never
 * again until the next action starts, at any frame rate, through long frames
 * and through the action clock being held at zero while the partner walks in.
 */
export class ActionMoments {
  private fired = new Set<string>()

  /** Call when a new shared action starts (or the current one is cancelled). */
  reset(): void {
    this.fired.clear()
  }

  /** True exactly once per action, on the first frame with `time >= at`. */
  once(key: string, time: number, at: number): boolean {
    if (time < at || this.fired.has(key)) return false
    this.fired.add(key)
    return true
  }
}

export const coupleMoments = new ActionMoments()
