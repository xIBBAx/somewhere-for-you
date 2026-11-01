/** A bounded world clock; it needs neither a player nor a loaded entity. */
export const territoryPhase = (offset: number, time: number, period: number): number =>
  ((((time + offset) % period) + period) % period) / period
