// One call per frame, however many requests arrive before it.
//
// A wheel fires far more scroll events than there are frames, and each repaint costs the same
// whether one event asked for it or twenty. Falls back to a microtask where the view has no
// animation frames (a detached document, a headless test).

/** `run`, coalesced to the next animation frame of `document`'s view. */
export function frameCoalescer(document: Document, run: () => void): () => void {
  let scheduled = false;
  const fire = (): void => {
    scheduled = false;
    run();
  };
  return () => {
    if (scheduled) return;
    scheduled = true;
    const raf = document.defaultView?.requestAnimationFrame;
    if (raf) raf(fire);
    else queueMicrotask(fire);
  };
}
