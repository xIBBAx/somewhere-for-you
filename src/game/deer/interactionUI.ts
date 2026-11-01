import { create } from "zustand"

export type DeerOffer = {
  id: string
  name: string
  species: string
  stage: string
  advice: string
  ride: string | null
  hello: string | null
}
export const useDeerUI = create<{ offer: DeerOffer | null }>(() => ({ offer: null }))
export const showDeerOffer = (offer: DeerOffer | null): void => {
  const previous = useDeerUI.getState().offer
  if (JSON.stringify(previous) !== JSON.stringify(offer)) useDeerUI.setState({ offer })
}
