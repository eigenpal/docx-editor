// The notice strip's mailbox.
//
// The strip lives in `SpecimenProvider`, under the editor root; the permit's pop-ups render
// from the root's `popups` map, beside it rather than under it. A one-line bus lets a pop-up
// speak without the two having to share a React ancestor — the same strip, the same fade.

type Listener = (text: string) => void;

const listeners = new Set<Listener>();

/** Show a notice, if the strip is mounted; a notice nobody hears is dropped, not queued. */
export function announce(text: string): void {
  for (const listener of listeners) listener(text);
}

/** Subscribe the strip; returns the unsubscribe. */
export function onAnnounce(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
