/** Radar zoom ladder, metres of radius: walking, riding, flying. */
export const RANGES = [70, 180, 500, 1400]

/** What the corner shows. The minimap is always on in play; it yields only to
 * modal surfaces that cover the game. The full atlas replaces it while open,
 * and a cosmic journey swaps the radar for a destination with a progress ring. */
export type MinimapView = "hidden" | "atlas" | "journey" | "map"
export const minimapView = ({ modal, atlasOpen, travelPhase }: { modal: boolean; atlasOpen: boolean; travelPhase: string }): MinimapView =>
  modal ? "hidden" : atlasOpen ? "atlas" : travelPhase !== "idle" ? "journey" : "map"

/** Automatic zoom index: walking stays close, riding or jumping widens, flight
 * and real height see the most. A deliberate zoom by the player overrides it. */
export const autoZoomIndex = ({ flying, airborne, mounted, altitude }: { flying: boolean; airborne: boolean; mounted: boolean; altitude: number }, current = -1): number =>
  // (height has a margin both ways, so hovering about 25 m never pumps the zoom)
  flying || altitude > (current === 2 ? 12 : 25) ? 2 : mounted || airborne ? 1 : 0
