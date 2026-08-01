// App-directed font fetching (font-resolution-overhaul group 3).
//
// `loadFonts` turns URLs the APPLICATION chose into verified `FontSource`s. The security
// posture is explicit-only: this helper fetches exactly what it is handed, is never
// called by the engine itself, and a document can never reach it — opening a file must
// not produce a network request (no zero-click fetch, no default CDN, no discovery).
//
// The contract's `sha256:` hash does double duty here: it gates admission when the
// caller pinned an expectation (a tampered response or poisoned cache entry fails that
// source, hard), and it revalidates the Cache API layer on every read — the cache is an
// optimization keyed by URL, but BYTES are only ever trusted by content.
//
// Per-source failure is degradation, not rejection: the promise always resolves, with
// every admitted source plus a typed failure list, so the app can mount with partial
// coverage (unresolved families measure via the fixed fallback) and report.

import type { FontFaceRequest, FontSource } from '@docx-editor.dev/core-contract/contracts/editor';
import { HARD_MAX_FONT_BYTES, sha256FontBytes } from '@docx-editor.dev/core-contract/layout';
import type { FontConfigurationFragment } from './font-composition.ts';

/** One URL to fetch and the face it claims to be. */
export interface FontUrlSource {
  readonly url: string;
  readonly family: string;
  readonly weight: number;
  readonly style: 'normal' | 'italic';
  /**
   * Expected `sha256:` content hash. When present, mismatching bytes are REFUSED —
   * pin this for any URL not under the app's sole control.
   */
  readonly hash?: string;
  readonly faceIndex?: number;
}

export interface LoadFontsRequest {
  readonly sources: readonly FontUrlSource[];
  /** Cache API bucket name; default `docx-editor-fonts`. */
  readonly cacheName?: string;
  /** Injectable for tests and CSP-constrained hosts; defaults to global `fetch`. */
  readonly fetcher?: typeof fetch;
  /** Per-font byte ceiling; defaults to the engine hard maximum. */
  readonly maxFontBytes?: number;
}

export type FontLoadFailureReason =
  | 'networkError'
  | 'httpError'
  | 'hashMismatch'
  | 'overLimit'
  | 'emptyResponse'
  /** The declared face itself is unusable (empty family, out-of-range weight); nothing was fetched. */
  | 'invalidRequest';

export interface FontLoadFailure {
  readonly url: string;
  readonly request: FontFaceRequest;
  readonly reason: FontLoadFailureReason;
  /** HTTP status for `httpError`; hashes for `hashMismatch`. */
  readonly status?: number;
  readonly expectedHash?: string;
  readonly actualHash?: string;
  readonly diagnostic?: string;
}

export interface LoadFontsResult extends FontConfigurationFragment {
  readonly sources: readonly FontSource[];
  readonly failures: readonly FontLoadFailure[];
}

/**
 * Mirrors the request contract's own assertions (`assertRequest`) as a returned reason
 * rather than a throw, so one bad entry in a caller's list degrades that entry only.
 */
function faceRequestProblem(request: FontFaceRequest): string | null {
  if (request.family.trim().length === 0) return 'font family must not be empty';
  if (!Number.isInteger(request.weight) || request.weight < 1 || request.weight > 1000) {
    return 'font weight must be an integer from 1 through 1000';
  }
  if (request.style !== 'normal' && request.style !== 'italic') {
    return 'font style must be normal or italic';
  }
  return null;
}

/** The Cache API when the environment provides one; absence degrades to direct fetch. */
function openCache(cacheName: string): Promise<Cache | null> {
  try {
    if (typeof caches === 'undefined') return Promise.resolve(null);
    return caches.open(cacheName).catch(() => null);
  } catch {
    // Non-secure contexts throw on ACCESS, not just on open.
    return Promise.resolve(null);
  }
}

async function cachedBytes(cache: Cache | null, url: string): Promise<Uint8Array | null> {
  if (!cache) return null;
  try {
    const hit = await cache.match(url);
    if (!hit) return null;
    return new Uint8Array(await hit.arrayBuffer());
  } catch {
    return null;
  }
}

async function storeBytes(cache: Cache | null, url: string, bytes: Uint8Array): Promise<void> {
  if (!cache) return;
  try {
    // A fresh Response over a copy: the caller's view must not alias cache storage.
    await cache.put(
      url,
      new Response(bytes.slice(), { headers: { 'Content-Length': String(bytes.byteLength) } })
    );
  } catch {
    // Quota or eviction races are the cache's business; the fetch already succeeded.
  }
}

async function discardEntry(cache: Cache | null, url: string): Promise<void> {
  if (!cache) return;
  try {
    await cache.delete(url);
  } catch {
    /* best-effort */
  }
}

/**
 * Fetch app-specified font URLs into verified, cache-backed `FontSource`s.
 *
 * Fetches ONLY the URLs listed — never a default host or engine-chosen CDN — and never
 * rejects for a per-source failure: the result carries every admitted source and a
 * typed entry for every drop. Compose the result with `composeFontConfiguration`.
 */
export async function loadFonts(request: LoadFontsRequest): Promise<LoadFontsResult> {
  const fetcher = request.fetcher ?? fetch;
  const maxFontBytes = request.maxFontBytes ?? HARD_MAX_FONT_BYTES;
  const cache = await openCache(request.cacheName ?? 'docx-editor-fonts');

  const sources: FontSource[] = [];
  const failures: FontLoadFailure[] = [];

  // Sequential per list order keeps admission deterministic; the fetches themselves are
  // the slow part and typically few. Callers needing parallelism can shard the list.
  for (const source of request.sources) {
    const faceRequest: FontFaceRequest = Object.freeze({
      family: source.family,
      weight: source.weight,
      style: source.style,
    });
    // Screened HERE, not at composition: the request contract refuses a malformed face
    // with a THROW, so admitting one would detonate the configuration carrying every
    // other font instead of degrading this single source. Same discipline the embedded
    // lane applies to file-declared families.
    const descriptorProblem = faceRequestProblem(faceRequest);
    if (descriptorProblem) {
      failures.push({
        url: source.url,
        request: faceRequest,
        reason: 'invalidRequest',
        diagnostic: descriptorProblem,
      });
      continue;
    }
    const admit = (bytes: Uint8Array, fromCache: boolean): 'admitted' | FontLoadFailure => {
      if (bytes.byteLength === 0) {
        return { url: source.url, request: faceRequest, reason: 'emptyResponse' };
      }
      if (bytes.byteLength > maxFontBytes) {
        return { url: source.url, request: faceRequest, reason: 'overLimit' };
      }
      const actualHash = sha256FontBytes(bytes);
      if (source.hash !== undefined && source.hash !== actualHash) {
        return {
          url: source.url,
          request: faceRequest,
          reason: 'hashMismatch',
          expectedHash: source.hash,
          actualHash,
          ...(fromCache ? { diagnostic: 'cached bytes failed revalidation' } : {}),
        };
      }
      sources.push({
        request: faceRequest,
        id: `url:${source.url}`,
        bytes,
        hash: actualHash,
        faceIndex: source.faceIndex ?? 0,
      });
      return 'admitted';
    };

    // Cache first, revalidated by content hash. A poisoned or stale entry is discarded
    // and the URL refetched — a cache problem is never a hard failure by itself.
    const cached = await cachedBytes(cache, source.url);
    if (cached) {
      const verdict = admit(cached, true);
      if (verdict === 'admitted') continue;
      await discardEntry(cache, source.url);
    }

    let response: Response;
    try {
      response = await fetcher(source.url);
    } catch (error) {
      failures.push({
        url: source.url,
        request: faceRequest,
        reason: 'networkError',
        diagnostic: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (!response.ok) {
      failures.push({
        url: source.url,
        request: faceRequest,
        reason: 'httpError',
        status: response.status,
      });
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      failures.push({
        url: source.url,
        request: faceRequest,
        reason: 'networkError',
        diagnostic: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const verdict = admit(bytes, false);
    if (verdict === 'admitted') {
      await storeBytes(cache, source.url, bytes);
    } else {
      failures.push(verdict);
    }
  }

  return { sources, failures };
}
