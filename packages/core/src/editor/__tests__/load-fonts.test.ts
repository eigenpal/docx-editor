// loadFonts: explicit URLs in, hash-verified cached FontSources out
// (font-resolution-overhaul group 3).
//
// The fetcher is injected and counted, so these pin the security-relevant behavior
// directly: exactly the listed URLs are requested, per-source failures degrade rather
// than reject, hash expectations gate admission hard, and the cache layer serves only
// hash-revalidated bytes (a poisoned entry is discarded and refetched).

import { afterEach, describe, expect, test } from 'bun:test';
import { sha256FontBytes } from '../../layout/index.ts';
import { loadFonts } from '../load-fonts.ts';

const fontA = new Uint8Array([1, 2, 3, 4]);
const fontB = new Uint8Array([5, 6, 7, 8]);
const fontC = new Uint8Array([9, 10, 11, 12]);

interface FakeFetch {
  readonly fetcher: typeof fetch;
  readonly requested: string[];
}

function fakeFetch(routes: Record<string, Uint8Array | number>): FakeFetch {
  const requested: string[] = [];
  const fetcher = ((input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    const route = routes[url];
    if (route === undefined) return Promise.resolve(new Response(null, { status: 404 }));
    if (typeof route === 'number') return Promise.resolve(new Response(null, { status: route }));
    return Promise.resolve(new Response(route.slice()));
  }) as typeof fetch;
  return { fetcher, requested };
}

/** An in-memory Cache API double registered on the happy-dom/bun global. */
class FakeCache {
  private readonly entries = new Map<string, Uint8Array>();
  match(url: string): Promise<Response | undefined> {
    const bytes = this.entries.get(url);
    return Promise.resolve(bytes ? new Response(bytes.slice()) : undefined);
  }
  put(url: string, response: Response): Promise<void> {
    return response.arrayBuffer().then((buffer) => {
      this.entries.set(url, new Uint8Array(buffer));
    });
  }
  delete(url: string): Promise<boolean> {
    return Promise.resolve(this.entries.delete(url));
  }
  /** Test hook: poison an entry directly. */
  poison(url: string, bytes: Uint8Array): void {
    this.entries.set(url, bytes);
  }
  has(url: string): boolean {
    return this.entries.has(url);
  }
}

const globalWithCaches = globalThis as { caches?: unknown };
const originalCaches = globalWithCaches.caches;

function installFakeCaches(): Map<string, FakeCache> {
  const buckets = new Map<string, FakeCache>();
  globalWithCaches.caches = {
    open(name: string) {
      let bucket = buckets.get(name);
      if (!bucket) {
        bucket = new FakeCache();
        buckets.set(name, bucket);
      }
      return Promise.resolve(bucket);
    },
  };
  return buckets;
}

afterEach(() => {
  if (originalCaches === undefined) delete globalWithCaches.caches;
  else globalWithCaches.caches = originalCaches;
});

describe('loadFonts', () => {
  test('fetches exactly the listed URLs and nothing else', async () => {
    delete globalWithCaches.caches;
    const { fetcher, requested } = fakeFetch({ '/a.ttf': fontA, '/b.ttf': fontB });
    const result = await loadFonts({
      sources: [
        { url: '/a.ttf', family: 'Alpha', weight: 400, style: 'normal' },
        { url: '/b.ttf', family: 'Beta', weight: 700, style: 'italic' },
      ],
      fetcher,
    });
    expect(requested).toEqual(['/a.ttf', '/b.ttf']);
    expect(result.failures).toHaveLength(0);
    expect(result.sources.map((source) => source.request)).toEqual([
      { family: 'Alpha', weight: 400, style: 'normal' },
      { family: 'Beta', weight: 700, style: 'italic' },
    ]);
    // The computed hash is attached when no expectation was pinned.
    expect(result.sources[0]!.hash).toBe(sha256FontBytes(fontA));
  });

  test('one of three failing degrades that source only, never rejects', async () => {
    delete globalWithCaches.caches;
    const { fetcher } = fakeFetch({ '/a.ttf': fontA, '/b.ttf': 404, '/c.ttf': fontC });
    const result = await loadFonts({
      sources: [
        { url: '/a.ttf', family: 'Alpha', weight: 400, style: 'normal' },
        { url: '/b.ttf', family: 'Beta', weight: 400, style: 'normal' },
        { url: '/c.ttf', family: 'Gamma', weight: 400, style: 'normal' },
      ],
      fetcher,
    });
    expect(result.sources).toHaveLength(2);
    expect(result.failures).toEqual([
      {
        url: '/b.ttf',
        request: { family: 'Beta', weight: 400, style: 'normal' },
        reason: 'httpError',
        status: 404,
      },
    ]);
  });

  test('a thrown fetch is a typed networkError, not a rejection', async () => {
    delete globalWithCaches.caches;
    const fetcher = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    const result = await loadFonts({
      sources: [{ url: '/a.ttf', family: 'Alpha', weight: 400, style: 'normal' }],
      fetcher,
    });
    expect(result.sources).toHaveLength(0);
    expect(result.failures[0]).toMatchObject({ reason: 'networkError', diagnostic: 'offline' });
  });

  test('a pinned hash gates admission hard, with expected and actual reported', async () => {
    delete globalWithCaches.caches;
    const { fetcher } = fakeFetch({ '/a.ttf': fontB /* tampered: B served for A's URL */ });
    const expected = sha256FontBytes(fontA);
    const result = await loadFonts({
      sources: [{ url: '/a.ttf', family: 'Alpha', weight: 400, style: 'normal', hash: expected }],
      fetcher,
    });
    expect(result.sources).toHaveLength(0);
    expect(result.failures[0]).toMatchObject({
      reason: 'hashMismatch',
      expectedHash: expected,
      actualHash: sha256FontBytes(fontB),
    });
  });

  test('second call serves from cache without a refetch', async () => {
    installFakeCaches();
    const { fetcher, requested } = fakeFetch({ '/a.ttf': fontA });
    const request = {
      sources: [{ url: '/a.ttf', family: 'Alpha', weight: 400, style: 'normal' as const }],
      fetcher,
    };
    const first = await loadFonts(request);
    expect(first.sources).toHaveLength(1);
    expect(requested).toEqual(['/a.ttf']);
    const second = await loadFonts(request);
    expect(second.sources).toHaveLength(1);
    // No second network request: the bytes came from the cache, hash-verified.
    expect(requested).toEqual(['/a.ttf']);
    expect(second.sources[0]!.hash).toBe(sha256FontBytes(fontA));
  });

  test('a poisoned cache entry is discarded and the URL refetched', async () => {
    const buckets = installFakeCaches();
    const { fetcher, requested } = fakeFetch({ '/a.ttf': fontA });
    const expected = sha256FontBytes(fontA);
    const request = {
      sources: [
        { url: '/a.ttf', family: 'Alpha', weight: 400, style: 'normal' as const, hash: expected },
      ],
      fetcher,
    };
    await loadFonts(request);
    const bucket = buckets.get('docx-editor-fonts')!;
    bucket.poison('/a.ttf', fontB);
    const result = await loadFonts(request);
    // Admission proceeded on the FRESH bytes' verification; the poisoned entry is gone.
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]!.hash).toBe(expected);
    expect(result.failures).toHaveLength(0);
    expect(requested).toEqual(['/a.ttf', '/a.ttf']);
  });

  test('degrades to direct fetch when the Cache API is unavailable', async () => {
    delete globalWithCaches.caches;
    const { fetcher, requested } = fakeFetch({ '/a.ttf': fontA });
    const request = {
      sources: [{ url: '/a.ttf', family: 'Alpha', weight: 400, style: 'normal' as const }],
      fetcher,
    };
    expect((await loadFonts(request)).sources).toHaveLength(1);
    expect((await loadFonts(request)).sources).toHaveLength(1);
    // Two calls, two fetches: no cache, no error.
    expect(requested).toEqual(['/a.ttf', '/a.ttf']);
  });

  test('an over-limit response is refused with a typed failure', async () => {
    delete globalWithCaches.caches;
    const { fetcher } = fakeFetch({ '/a.ttf': fontA });
    const result = await loadFonts({
      sources: [{ url: '/a.ttf', family: 'Alpha', weight: 400, style: 'normal' }],
      fetcher,
      maxFontBytes: 2,
    });
    expect(result.sources).toHaveLength(0);
    expect(result.failures[0]).toMatchObject({ reason: 'overLimit' });
  });
});
