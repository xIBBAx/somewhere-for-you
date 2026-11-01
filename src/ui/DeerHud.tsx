import { useDeerUI } from "../game/deer/interactionUI"
import { input, pushAction } from "../game/runtime"

/** Readable permission and real input buttons, including on touch screens. */
export const DeerHud = (): React.ReactElement | null => {
  const offer = useDeerUI((s) => s.offer)
  if (!offer) return null
  return (
    <div className="deer-offer" aria-label={`${offer.name}, ${offer.species}`}>
      <strong>
        {offer.name} <span>· {offer.species}</span>
      </strong>
      <div className="deer-relationship">{offer.stage}</div>
      <p>{offer.advice}</p>
      <div className="deer-actions">
        {offer.hello && (
          <button onClick={() => pushAction("pat")}>
            <kbd>B</kbd>
            {offer.hello}
          </button>
        )}
        {offer.ride && (
          <button
            onClick={() => {
              input.interact = true
            }}
          >
            <kbd>E</kbd>
            {offer.ride}
          </button>
        )}
      </div>
    </div>
  )
}
