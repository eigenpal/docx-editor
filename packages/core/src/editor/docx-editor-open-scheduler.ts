// The open-yield scheduler: one painted frame between "open this document" and the
// blocking mount, so a host's loading screen can actually show.
//
// Opening a document parses, lays out and paints in one synchronous pass — seconds of
// blocked main thread on a long file — and a mount that runs in the same task as
// `load()`/`attach()` blocks the very frame that would have painted the host's loading
// screen. Documents past {@link OPEN_PAINT_YIELD_CONTENT_BYTES} of CONTENT therefore
// schedule the mount behind one painted frame, and `snapshot().isOpening` is true for
// exactly that window. Small documents keep the synchronous path: they need no loading
// flash, and every existing synchronous caller stays as it was. So does every
// environment without `requestAnimationFrame` — headless and server hosts mount
// synchronously by definition.

/**
 * The UNCOMPRESSED size past which an open earns a painted loading frame first.
 *
 * Mount cost tracks the content, and the zipped size lies about it: a 200-page
 * tracked-changes document is ~1.6 MB of XML but zips under 90 KiB, while WordprocessingML
 * routinely compresses 10–20×. So the threshold reads the true entry sizes from the ZIP
 * central directory (see {@link zipContentExceeds} — a bounded scan, no decompression).
 * Documents under this mount well inside a frame or two on current hardware; over it,
 * the synchronous mount visibly freezes the page the document was opened from.
 */
const OPEN_PAINT_YIELD_CONTENT_BYTES = 512 * 1024;

/**
 * Whether the ZIP's entries sum past `limit` uncompressed — WITHOUT inflating anything.
 * The central directory records every entry's uncompressed size; walking it costs
 * microseconds on any real document.
 *
 * Attacker-controlled input rules (the bytes come straight from a file): the entry
 * count is a bounded uint16, the walk advances monotonically and bounds-checks every
 * read, the sizes are only summed and compared — never fed to an allocation — and the
 * sum exits early at the limit, so a forged huge size simply means "defer", which the
 * real parser then judges. Anything malformed answers `false` and the open proceeds on
 * the synchronous path, where the parser reports the actual error.
 */
function zipContentExceeds(bytes: Uint8Array, limit: number): boolean {
  const length = bytes.byteLength;
  if (length < 22) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, length);
  // End-of-central-directory: signature PK\x05\x06, at most 64 KiB of trailing comment.
  const scanFloor = Math.max(0, length - (64 * 1024 + 22));
  let eocd = -1;
  for (let at = length - 22; at >= scanFloor; at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) return false;
  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  let total = 0;
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (offset + 46 > length) return false;
    if (view.getUint32(offset, true) !== 0x02014b50) return false;
    // A ZIP64 sentinel (0xFFFFFFFF) sums as huge and exits below: correct — it IS huge.
    total += view.getUint32(offset + 24, true);
    if (total >= limit) return true;
    offset +=
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
  }
  return false;
}

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
    // The zipped size is a shortcut, not the measure: a file already past the limit
    // zipped cannot be under it unpacked in any way that mounts fast.
    shouldYield: (bytes) =>
      typeof requestAnimationFrame === 'function' &&
      typeof cancelAnimationFrame === 'function' &&
      (bytes.byteLength >= OPEN_PAINT_YIELD_CONTENT_BYTES ||
        zipContentExceeds(bytes, OPEN_PAINT_YIELD_CONTENT_BYTES)),

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
