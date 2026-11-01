/**
 * Where a speech bubble's tail goes on screen. The bubble hangs above the
 * speaker (its bottom edge at `y`); when that would cover the row of shared
 * actions (on phones it sits across the top, right where heads land in
 * landscape) it drops to just below the row so both stay readable.
 */
export type ScreenRect = { left: number; right: number; top: number; bottom: number }

export const bubbleBottom = (x: number, y: number, width: number, height: number, bar: ScreenRect | null, gap = 6): number => {
  if (!bar) return y
  const overlapsX = x + width / 2 > bar.left && x - width / 2 < bar.right
  const overlapsY = y - height < bar.bottom + gap && y > bar.top - gap
  return overlapsX && overlapsY ? bar.bottom + gap + height : y
}
