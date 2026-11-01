export type AquaticEventKind = "croak" | "rise" | "jump" | "splash" | "frog-hop"
export type AquaticEvent = { kind: AquaticEventKind; x: number; y: number; z: number; strength: number }
type Listener = (event: Readonly<AquaticEvent>) => void
const listeners = new Set<Listener>()
const event: AquaticEvent = { kind: "rise", x: 0, y: 0, z: 0, strength: 0 }

/** The audio integrator subscribes here. The pooled event is synchronous;
 * listeners that retain an event must copy it. There is no sound dependency. */
export const aquaticEvents = {
  subscribe(listener: Listener): () => void { listeners.add(listener); return () => { listeners.delete(listener) } },
  emit(kind: AquaticEventKind, x: number, y: number, z: number, strength = 1): void {
    event.kind = kind; event.x = x; event.y = y; event.z = z; event.strength = strength
    for (const listener of listeners) listener(event)
  },
}
