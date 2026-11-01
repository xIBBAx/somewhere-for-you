import { create } from "zustand"
import { observationJourney } from "../game/celestial/observations"
import { voyage, saveVoyage } from "../game/celestial/voyageMemory"

export const observationKey = (journey: string, stop: number): string => `${journey}:${stop}`
export const nextObservationStop = (id: string): number => {
  const journey = observationJourney(id)
  if (!journey) return 0
  return journey.stops.findIndex((_, i) => !voyage.observations?.includes(observationKey(id, i)))
}
export const rememberObservation = (id: string, stop: number): boolean => {
  const journey = observationJourney(id)
  if (!journey || !Number.isInteger(stop) || stop < 0 || stop >= journey.stops.length) return false
  const key = observationKey(id, stop)
  voyage.observations ??= []
  if (voyage.observations.includes(key)) return false
  voyage.observations.push(key); saveVoyage()
  return true
}

type ObservationState = {
  journey: string | null; stop: number; ready: boolean; holding: boolean; progress: number; completed: boolean; reading: string
  start: (id: string) => void
  next: () => void
  close: () => void
  hold: (holding: boolean) => void
}
export const useObservation = create<ObservationState>((set, get) => ({
  journey: null, stop: 0, ready: false, holding: false, progress: 0, completed: false, reading: "",
  start: id => {
    if (!observationJourney(id)) return
    const first = nextObservationStop(id)
    set({ journey: id, stop: first < 0 ? 0 : first, ready: false, holding: false, progress: 0, completed: false, reading: "" })
  },
  next: () => {
    const s = get(), journey = s.journey && observationJourney(s.journey)
    if (!journey || !s.completed || s.stop >= journey.stops.length - 1) return
    set({ stop: s.stop + 1, ready: false, holding: false, progress: 0, completed: false, reading: "" })
  },
  close: () => set({ journey: null, holding: false, progress: 0, ready: false }),
  hold: holding => set({ holding }),
}))
