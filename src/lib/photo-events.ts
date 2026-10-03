"use client";

/**
 * "This unit's photos changed" — inside one browser tab.
 *
 * The card and the edit popup each load a unit's photos on their own. Without this, a photo
 * added in the popup appeared on the card only after a reload. Whoever changes the photos
 * says so here; everyone showing that unit's photos listens and fetches again. The live
 * stream feeds the same signal when the change came from someone else's screen.
 */

type Listener = (unitId: string) => void;
const listeners = new Set<Listener>();

export function onPhotosChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function photosChanged(unitId: string): void {
  for (const l of listeners) l(unitId);
}
