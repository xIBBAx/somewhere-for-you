/** Announce a ground destination once, after approaching it from outside arrival range.
 * A mark placed underfoot stays selected until she leaves and comes back. */
export class ArrivalTracker {
  private destination: string | null = null
  private approached = false

  update(destination: string | null, arrived: boolean, outsideRange: boolean): boolean {
    if (destination !== this.destination) {
      this.destination = destination
      this.approached = false
    }
    if (destination === null) return false
    if (outsideRange) this.approached = true
    if (!arrived) return false
    if (!this.approached) return false
    this.approached = false
    return true
  }
}
