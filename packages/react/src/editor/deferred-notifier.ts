/** Coalesced deferred notifier for editor state ticks. @internal */
export function deferredTick(notify: () => void): () => void {
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    const scheduling = (
      globalThis as typeof globalThis & {
        navigator?: {
          scheduling?: { isInputPending?: (options?: { includeContinuous?: boolean }) => boolean };
        };
      }
    ).navigator?.scheduling;
    const flush = () => {
      scheduled = false;
      notify();
    };
    if (scheduling?.isInputPending?.({ includeContinuous: true })) setTimeout(flush, 0);
    else queueMicrotask(flush);
  };
}
