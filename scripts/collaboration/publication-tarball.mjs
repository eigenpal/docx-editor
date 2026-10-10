import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { PUBLICATION_TIMEOUT_MS } from './registry.mjs';

const TRANSIENT = new Set([404, 408, 429, 500, 502, 503, 504]);

// Metadata can reach npm's mirrors before the corresponding archive is downloadable.
export function createTarballVerifier({
  fetch: request = globalThis.fetch,
  now = Date.now,
  wait = (ms, signal) => sleep(ms, undefined, { signal }),
  log = console.log,
} = {}) {
  return async function verifyTarball(
    published,
    { deadline = now() + PUBLICATION_TIMEOUT_MS, signal } = {}
  ) {
    const label = `${published.name}@${published.version}`;
    const url = new URL(published.dist?.tarball);
    if (url.origin !== 'https://registry.npmjs.org' || url.username || url.password)
      throw new Error(`Unexpected npm tarball URL: ${label}`);
    let last = 'no response';
    for (let attempt = 0; now() < deadline; attempt++) {
      signal?.throwIfAborted();
      let retryDelay = 0;
      let integrity;
      try {
        const timeout = AbortSignal.timeout(Math.max(1, Math.min(60_000, deadline - now())));
        const response = await request(url, {
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          cache: 'no-store',
          redirect: 'error',
          headers: { 'cache-control': 'no-cache' },
        });
        if (response.ok) {
          const hash = createHash('sha512');
          for await (const chunk of response.body) hash.update(chunk);
          integrity = 'sha512-' + hash.digest('base64');
        } else {
          await response.body?.cancel();
          last = `HTTP ${response.status}`;
          if (!TRANSIENT.has(response.status)) {
            const error = new Error(`Tarball download failed: ${label}: ${last}`);
            error.permanent = true;
            throw error;
          }
          const value = response.headers.get('retry-after');
          if (value) {
            const seconds = Number(value);
            retryDelay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now();
          }
        }
      } catch (error) {
        signal?.throwIfAborted();
        if (error.permanent) throw error;
        last = error.message;
      }
      // A hash mismatch is a release error, never a reason to retry different bytes.
      if (integrity) {
        if (integrity !== published.dist.integrity)
          throw new Error(`Downloaded artifact differs from tested candidate: ${label}`);
        return;
      }
      const remaining = deadline - now();
      if (remaining <= 0) break;
      const delay = Math.min(
        remaining,
        Math.max(retryDelay || 0, Math.min(30_000, 5000 * 2 ** Math.min(attempt, 3)))
      );
      log(`Waiting for tarball ${label}: ${last}; retry in ${Math.ceil(delay / 1000)}s`);
      await wait(delay, signal);
    }
    signal?.throwIfAborted();
    throw new Error(`Tarball download timed out: ${label}; ${last}`);
  };
}

export const verifyTarball = createTarballVerifier();
