import type { FinaleStatus } from "../../state/gameStore"

export const COMPANION_REVEAL_START = 4.2
export const COMPANION_REVEAL_END = 7.6

export type CompanionVisibility = {
  mounted: boolean
  visible: boolean
  scale: number
}

/** The companion enters at full human scale; the director animates the walk into the garden. */
export const getCompanionVisibility = (
  finale: FinaleStatus,
  finaleTime: number,
): CompanionVisibility => {
  if (finale === "locked") return { mounted: false, visible: false, scale: 0 }
  if (finale === "done") return { mounted: true, visible: true, scale: 1 }

  return {
    mounted: true,
    visible: finaleTime >= COMPANION_REVEAL_START,
    scale: 1,
  }
}
