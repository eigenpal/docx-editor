import { setTimeout as sleep } from 'node:timers/promises';

export const PUBLICATION_TIMEOUT_MS = 10 * 60_000;
const TRANSIENT = new Set([404, 408, 429, 500, 502, 503, 504]);

function retryAfter(response, now) {
  const value = response.headers.get('retry-after');
  if (!value) return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds)
    ? Math.max(0, seconds * 1000)
    : Math.max(0, Date.parse(value) - now) || 0;
}

// Inject time and transport so publication delays can be tested without waiting on npm.
export function createRegistryClient({
  fetch: request = globalThis.fetch,
  now = Date.now,
  wait = (ms, signal) => sleep(ms, undefined, { signal }),
  random = Math.random,
  log = console.log,
} = {}) {
  return async function registry(name, version = '', options = {}) {
    const { waitForPublication = false, signal } = options;
    const started = now();
    const deadline =
      options.deadline ?? started + (waitForPublication ? PUBLICATION_TIMEOUT_MS : 90_000);
    const label = `${name}${version ? '@' + version : ''}`;
    const base = `https://registry.npmjs.org/${encodeURIComponent(name)}`;
    let attempt = 0;
    let last = 'no response';
    for (;;) {
      signal?.throwIfAborted();
      if (now() >= deadline) throw new Error(`Registry lookup timed out: ${label}; ${last}`);
      attempt++;
      let delay = 0;
      // Version metadata and the package document can become visible at different times.
      // Only use the exact requested version from the package document, never dist-tags.latest.
      const urls =
        version && waitForPublication
          ? [`${base}/${version}`, base]
          : [version ? `${base}/${version}` : base];
      for (const url of urls) {
        if (now() >= deadline) break;
        let value;
        try {
          const timeout = AbortSignal.timeout(Math.max(1, Math.min(30_000, deadline - now())));
          const response = await request(url, {
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
            headers: { 'cache-control': 'no-cache', accept: 'application/json' },
            cache: 'no-store',
          });
          if (response.ok) {
            const document = await response.json();
            value = version && url === base ? document.versions?.[version] : document;
            if (!value) last = 'requested version absent from package metadata';
          } else {
            last = `HTTP ${response.status}`;
            delay = Math.max(delay, retryAfter(response, now()));
            // Do not hide authentication failures or invalid requests behind retries.
            if (!waitForPublication || !TRANSIENT.has(response.status)) {
              const error = new Error(`Registry lookup failed: ${label}: ${last}`);
              error.permanent = true;
              throw error;
            }
          }
        } catch (error) {
          signal?.throwIfAborted();
          if (error.permanent) throw error;
          last = error.cause?.code ?? error.message;
          if (!waitForPublication && attempt >= 3)
            throw new Error(`Registry request failed: ${label}: ${last}`);
        }
        if (value) {
          // Metadata can be readable before its dist-tags propagate. Keep semantic
          // validation outside the transport catch: a rejected release is not a network retry.
          const pending = options.pendingReason?.(value);
          if (!pending) return value;
          last = pending;
        }
        // Respect throttling/service Retry-After before requesting another metadata endpoint.
        if (delay > 0) break;
      }
      const remaining = deadline - now();
      if (remaining <= 0) throw new Error(`Registry lookup timed out: ${label}; ${last}`);
      const backoff = waitForPublication
        ? Math.min(30_000, 5000 * 2 ** Math.min(attempt - 1, 3))
        : 1000;
      const pause = Math.min(
        remaining,
        Math.max(delay, Math.round(backoff * (0.8 + 0.2 * random())))
      );
      if (waitForPublication)
        log(
          `Waiting for ${label}: ${last}; attempt ${attempt}, ${Math.ceil(remaining / 1000)}s remaining, retry in ${Math.ceil(pause / 1000)}s`
        );
      await wait(pause, signal);
    }
  };
}

export const registry = createRegistryClient();
