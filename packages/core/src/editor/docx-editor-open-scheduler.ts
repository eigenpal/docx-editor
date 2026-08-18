// The open-yield scheduler: one painted frame between "open this document" and the
// blocking mount, so a host's loading screen can actually show.
//
// Opening a document parses, lays out and paints in one synchronous pass — seconds of
// blocked main thread on a long file — and a mount that runs in the same task as
// `load()`/`attach()` blocks the very frame that would have painted the host's loading
// screen. Documents past {@link OPEN_PAINT_YIELD_BYTES} therefore schedule the mount
// behind one painted frame, and `snapshot().isOpening` is true for exactly that window.
// Small documents keep the synchronous path: they need no loading flash, and every
// existing synchronous caller stays as it was. So does every environment without
// `requestAnimationFrame` — headless and server hosts mount synchronously by definition.

/**
 * The size past which an open earns a painted loading frame before the blocking mount.
 *
 * Zipped size is the only cheap proxy for mount cost. Documents under this mount well
 * inside one frame's budget on current hardware, so deferring them would buy nothing
 * and flash a loading screen; documents over it are the ones whose synchronous mount
 * visibly freezes the page they were opened from.
 */
const OPEN_PAINT_YIELD_BYTES = 128 * 1024;

/** What the facade hands the scheduler; both close over facade-owned state. */
export interface OpenSchedulerHooks {
  /** The real synchronous mount (`mountBytes`). */
  readonly mount: (bytes: Uint8Array) => void;
  /** Called once when a mount is scheduled — the facade bumps and emits here. */
  readonly scheduled: () => void;
}

/** The deferred-mount window, owned by the facade. See the module comment. */
export interface OpenScheduler {
  /** Whether this open is worth (and able to get) a painted frame before the mount. */
  shouldYield(bytes: Uint8Array): boolean;
  /** Schedule the mount behind one painted frame and report the state move. */
  schedule(bytes: Uint8Array): void;
  /** Cancel a scheduled open and hand its bytes back to the caller to re-route. */
  cancel(): Uint8Array | null;
  /**
   * Run a scheduled open NOW. For callers that need the document synchronously — a
   * `save()` or `exec` issued inside the yield window must see the document that was
   * just loaded, not a "no document is loaded" refusal the next frame would disprove.
   */
  flush(): void;
  /** Whether a mount is currently waiting on its frame — `snapshot().isOpening`. */
  isScheduled(): boolean;
}

export function createOpenScheduler(hooks: OpenSchedulerHooks): OpenScheduler {
  let scheduled: { readonly bytes: Uint8Array; cancel(): void } | null = null;

  const cancel = (): Uint8Array | null => {
    if (!scheduled) return null;
    const { bytes } = scheduled;
    scheduled.cancel();
    scheduled = null;
    return bytes;
  };

  return {
    shouldYield: (bytes) =>
      bytes.byteLength >= OPEN_PAINT_YIELD_BYTES &&
      typeof requestAnimationFrame === 'function' &&
      typeof cancelAnimationFrame === 'function',

    // `requestAnimationFrame` fires BEFORE the pending paint, so the heavy work goes
    // into a task queued from inside it — the first slot guaranteed to run after the
    // loading screen is on screen. Until then the previous document (if any) stays
    // mounted under the host's overlay. A HIDDEN tab never fires rAF at all, so a
    // plain-timer fallback mounts anyway: a document opened in the background must be
    // there when the tab is next looked at, not still waiting for a frame.
    schedule(bytes) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let fallback: ReturnType<typeof setTimeout> | null = null;
      const run = () => {
        scheduled = null;
        hooks.mount(bytes);
      };
      const raf = requestAnimationFrame(() => {
        if (fallback !== null) clearTimeout(fallback);
        fallback = null;
        timer = setTimeout(run, 0);
      });
      fallback = setTimeout(() => {
        cancelAnimationFrame(raf);
        run();
      }, 250);
      scheduled = {
        bytes,
        cancel: () => {
          cancelAnimationFrame(raf);
          if (timer !== null) clearTimeout(timer);
          if (fallback !== null) clearTimeout(fallback);
        },
      };
      hooks.scheduled();
    },

    cancel,

    flush() {
      const bytes = cancel();
      if (bytes) hooks.mount(bytes);
    },

    isScheduled: () => scheduled !== null,
  };
}
