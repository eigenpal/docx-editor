// The font bytes this package has fetched, shared by `loadDefaultFonts`, `packagedFonts()`, and
// `googleFonts()`, and the idle wait before the faces that load in the background.

/** One font file to fetch: its URL, its expected size, and the word that names its source. */
export interface FontFile {
  /** A packaged asset URL (a `URL` or, from some bundlers, a path string), or a catalog URL. */
  readonly url: URL | string;
  /** The size the file must have. A different size is an error page, not the font. */
  readonly byteLength: number;
  /** How a size mismatch names the expected size: `packaged` or `catalogued`. */
  readonly source: 'packaged' | 'catalogued';
}

/**
 * Bytes already fetched this session, keyed by pinned URL — and PER FETCHER.
 *
 * Immutable URLs make the cache trivially safe to share, and sharing is what makes a
 * second document naming the same family cost nothing; in-flight promises are cached too,
 * so two editors mounting at once fetch a face once. Keying on the fetcher keeps that
 * sharing where it belongs: hosts all using the global `fetch` share one cache, while a
 * host that supplied its own (a CSP-constrained proxy, a test double) never receives
 * bytes some other fetcher produced. A `WeakMap` so a discarded fetcher's bytes go too.
 */
const MAX_CACHED_FONT_BYTES = 16 * 1024 * 1024;
const MAX_CACHED_FONT_FACES = 64;
/**
 * CJK faces cache apart, under a budget that holds all four regions (23.6 MB). In the shared
 * 16 MB cache one Chinese face would evict every Latin face, and two regions would never fit.
 */
const MAX_CACHED_CJK_FONT_BYTES = 24 * 1024 * 1024;

interface PendingFontFetch {
  /** Signal-scoped waiters still racing this fetch; the last aborting one cancels it. */
  waiters: number;
  /** An unsigned waiter joined, so no abort may cancel the shared work under it. */
  pinned: boolean;
  readonly controller: AbortController;
}

interface FontByteCache {
  readonly entries: Map<string, Promise<Uint8Array>>;
  readonly sizes: Map<string, number>;
  /** In-flight state per URL; absent once the entry holds settled bytes. */
  readonly pending: Map<string, PendingFontFetch>;
  totalBytes: number;
  readonly maxBytes: number;
}

const byteCaches = new WeakMap<object, FontByteCache>();
const cjkByteCaches = new WeakMap<object, FontByteCache>();

function cacheFor(fetcher: typeof fetch, cjk: boolean): FontByteCache {
  const caches = cjk ? cjkByteCaches : byteCaches;
  let cache = caches.get(fetcher);
  if (!cache) {
    const maxBytes = cjk ? MAX_CACHED_CJK_FONT_BYTES : MAX_CACHED_FONT_BYTES;
    cache = { entries: new Map(), sizes: new Map(), pending: new Map(), totalBytes: 0, maxBytes };
    caches.set(fetcher, cache);
  }
  return cache;
}

function cacheSuccess(cache: FontByteCache, url: string, bytes: Uint8Array): void {
  const previous = cache.sizes.get(url) ?? 0;
  cache.entries.delete(url);
  cache.sizes.delete(url);
  cache.totalBytes -= previous;
  if (bytes.byteLength > cache.maxBytes) return;
  cache.entries.set(url, Promise.resolve(bytes));
  cache.sizes.set(url, bytes.byteLength);
  cache.totalBytes += bytes.byteLength;
  while (cache.entries.size > MAX_CACHED_FONT_FACES || cache.totalBytes > cache.maxBytes) {
    // Evict oldest SETTLED entries only. A pending entry has no recorded bytes to reclaim,
    // and dropping its cache reference would both orphan the downloaded bytes (the settle
    // handler declines to record a replaced entry) and break single-flight for new callers.
    let oldest: string | undefined;
    for (const key of cache.entries.keys()) {
      if (cache.sizes.has(key)) {
        oldest = key;
        break;
      }
    }
    if (oldest === undefined) break;
    cache.entries.delete(oldest);
    cache.totalBytes -= cache.sizes.get(oldest) ?? 0;
    cache.sizes.delete(oldest);
  }
}

/**
 * The bytes of `file`, from the cache, from a fetch already on the way, or from a new fetch.
 * A size mismatch or an HTTP error rejects, and a failed fetch is not cached.
 */
export async function fetchFontFile(
  file: FontFile,
  fetcher: typeof fetch,
  signal?: AbortSignal,
  cjk = false,
  low = false
): Promise<Uint8Array> {
  const face = { url: String(file.url) };
  const byteCache = cacheFor(fetcher, cjk);
  const inFlight = byteCache.entries.get(face.url);
  const inFlightState = inFlight ? byteCache.pending.get(face.url) : undefined;
  // A fetch whose last waiter aborted it rejects a little later: until then its entry is still
  // here, and a new caller that joined it would fail with an abort that is not its own.
  const doomed = inFlightState?.controller.signal.aborted === true;
  // Reuse a settled entry, or join a shared in-flight fetch. The one refusal: a signal-scoped
  // caller never joins a PINNED fetch (one an unsigned caller owns), because that fetch may be
  // stranded and nothing can cancel it — the caller replaces it with work it can cancel.
  if (inFlight && !doomed && (!inFlightState || !signal || !inFlightState.pinned)) {
    // Map insertion order is the LRU order. Pending entries can move too; successful byte
    // accounting is unchanged until their completion records the actual size.
    byteCache.entries.delete(face.url);
    byteCache.entries.set(face.url, inFlight);
    if (!inFlightState) return raceWithAbort(inFlight, signal);
    return joinPendingFetch(inFlight, inFlightState, signal);
  }
  // The fetch is cache-owned under its own controller: concurrent documents share ONE download
  // per face instead of one each. Signal-scoped waiters are refcounted and the LAST aborting
  // waiter cancels the shared request, so caller-owned work stays physically cancellable. A
  // failed or cancelled fetch is forgotten below, so it can never poison retries.
  const controller = new AbortController();
  const state: PendingFontFetch = { waiters: 0, pinned: !signal, controller };
  const pending = startFetch(file, fetcher, controller.signal, low);
  track(byteCache, face.url, pending, state);
  return joinPendingFetch(pending, state, signal);
}

/** The fetch of one file, checked for its size. */
async function startFetch(
  file: FontFile,
  fetcher: typeof fetch,
  signal: AbortSignal,
  low: boolean
): Promise<Uint8Array> {
  // `priority` is a hint: a browser without fetch priorities ignores it.
  const init = low ? ({ signal, priority: 'low' } as RequestInit) : { signal };
  const response = await fetcher(file.url as unknown as RequestInfo, init);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  // The cheap half of content-checking, done here so an error page served with 200
  // never reaches the engine. The hash half is the engine's: it re-derives on admission
  // and refuses a mismatch, so a tampered asset fails loudly there rather than silently.
  if (bytes.byteLength !== file.byteLength) {
    throw new Error(
      `unexpected byte length ${bytes.byteLength}, ${file.source} ${file.byteLength}`
    );
  }
  return bytes;
}

/** Record a fetch in the cache: its bytes on success, nothing on failure. */
function track(
  byteCache: FontByteCache,
  url: string,
  pending: Promise<Uint8Array>,
  state: PendingFontFetch
): void {
  const face = { url };
  byteCache.entries.set(face.url, pending);
  byteCache.pending.set(face.url, state);
  // A failed fetch must not be remembered as a failure forever: the next document gets to
  // try again. Only successes stay cached. Identity checks keep a replaced fetch's late
  // settlement from touching its successor's cache slot.
  pending.then(
    (bytes) => {
      if (byteCache.pending.get(face.url) === state) byteCache.pending.delete(face.url);
      if (byteCache.entries.get(face.url) === pending) cacheSuccess(byteCache, face.url, bytes);
    },
    () => {
      if (byteCache.pending.get(face.url) === state) byteCache.pending.delete(face.url);
      if (byteCache.entries.get(face.url) !== pending) return;
      byteCache.entries.delete(face.url);
      byteCache.sizes.delete(face.url);
    }
  );
}

function joinPendingFetch(
  work: Promise<Uint8Array>,
  state: PendingFontFetch,
  signal: AbortSignal | undefined
): Promise<Uint8Array> {
  if (!signal) {
    // An unsigned waiter can never abandon the fetch, so no abort may cancel it either.
    state.pinned = true;
    return work;
  }
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error('Font loading was aborted'));
  }
  state.waiters += 1;
  let counted = true;
  const leave = (abandoning: boolean): void => {
    if (!counted) return;
    counted = false;
    state.waiters -= 1;
    if (abandoning && state.waiters === 0 && !state.pinned) {
      state.controller.abort(signal.reason ?? new Error('Font loading was aborted'));
    }
  };
  return new Promise<Uint8Array>((resolve, reject) => {
    const abort = (): void => {
      reject(signal.reason ?? new Error('Font loading was aborted'));
      leave(true);
    };
    signal.addEventListener('abort', abort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        leave(false);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        leave(false);
        reject(error);
      }
    );
  });
}

function raceWithAbort<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('Font loading was aborted'));
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason ?? new Error('Font loading was aborted'));
    signal.addEventListener('abort', abort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      }
    );
  });
}

/** The delay before a background load in a browser that has no `requestIdleCallback`. */
const IDLE_FALLBACK_MS = 1000;

/**
 * Run `run` when the browser is idle: through `requestIdleCallback`, or after a short delay
 * in a browser without it. Outside a browser, run nothing and return false.
 */
export function whenIdle(run: () => void): boolean {
  const host = globalThis as {
    requestIdleCallback?: (run: () => void, options?: { timeout: number }) => unknown;
    document?: unknown;
  };
  if (typeof host.requestIdleCallback === 'function') {
    host.requestIdleCallback(run, { timeout: 5000 });
    return true;
  }
  if (host.document === undefined) return false;
  setTimeout(run, IDLE_FALLBACK_MS);
  return true;
}

/** Whether `whenIdle` runs anything here: in a browser. */
export function canIdle(): boolean {
  const host = globalThis as { requestIdleCallback?: unknown; document?: unknown };
  return typeof host.requestIdleCallback === 'function' || host.document !== undefined;
}

/** Resolves when the browser is idle (`whenIdle`). Rejects with the reason when `signal` aborts. */
export function idle(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const abort = (): void => reject(signal!.reason);
    signal?.addEventListener('abort', abort, { once: true });
    whenIdle(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    });
  });
}
