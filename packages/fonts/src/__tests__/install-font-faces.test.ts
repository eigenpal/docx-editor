// Paint-side registration reuses the bytes the loader already fetched (#596).
//
// The measurement half and the paint half both need the same asset. Registering by URL
// made the browser fetch it a second time, and — the sharper half — put that request
// outside `fetcher`, so a host routing font traffic through its own mirror had half its
// traffic escape. These pin that the bytes are reused, and that a standalone call with no
// loader behind it still works by URL.

import './dom-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { installDefaultFontFaces, loadDefaultFonts } from '../index.ts';

const assetsDir = new URL('../../assets/', import.meta.url);

/** Serves the packaged assets from disk and records every URL asked for. */
function countingFetcher(): { fetcher: typeof fetch; requested: string[] } {
  const requested: string[] = [];
  const fetcher = ((input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    const file = url.slice(url.lastIndexOf('/') + 1);
    return Promise.resolve(new Response(new Uint8Array(readFileSync(new URL(file, assetsDir)))));
  }) as typeof fetch;
  return { fetcher, requested };
}

interface Registered {
  readonly family: string;
  readonly source: unknown;
}

/** Captures what `installDefaultFontFaces` hands the browser, without a browser. */
function captureRegistrations(): {
  readonly document: Document;
  readonly registered: Registered[];
  restore(): void;
} {
  const registered: Registered[] = [];
  const faces = new Set<unknown>();
  const previous = (globalThis as { FontFace?: unknown }).FontFace;
  class StubFontFace {
    readonly family: string;
    readonly weight: string;
    readonly style: string;
    constructor(family: string, source: unknown, descriptors: Record<string, string>) {
      this.family = family;
      this.weight = descriptors.weight ?? '400';
      this.style = descriptors.style ?? 'normal';
      registered.push({ family, source });
    }
    load(): Promise<this> {
      return Promise.resolve(this);
    }
  }
  (globalThis as { FontFace?: unknown }).FontFace = StubFontFace;
  const document = { fonts: faces } as unknown as Document;
  return {
    document,
    registered,
    restore: () => {
      (globalThis as { FontFace?: unknown }).FontFace = previous;
    },
  };
}

let active: { restore(): void } | undefined;
afterEach(() => {
  active?.restore();
  active = undefined;
});

describe('installDefaultFontFaces', () => {
  test('registers from the bytes the loader already fetched, issuing no request of its own', async () => {
    const { fetcher, requested } = countingFetcher();
    const fragment = await loadDefaultFonts({ families: ['Calibri'], fetcher });
    expect(fragment.sources).toHaveLength(4);
    const loaderRequests = requested.length;

    const capture = captureRegistrations();
    active = capture;
    const installed = await installDefaultFontFaces({
      families: ['Calibri'],
      fetcher,
      document: capture.document,
      loaded: fragment.sources,
    });

    expect(installed).toBe(4);
    // The whole point, and the only assertion here that can see it: bytes, not a
    // `url(...)` descriptor. `requested` cannot carry this claim — registration never
    // reads `options.fetcher`, so a URL registration would go straight to the browser
    // and leave the counter untouched. That is exactly why the old behaviour was
    // invisible to an injected fetcher.
    for (const entry of capture.registered) {
      expect(`${entry.family}: ${entry.source instanceof ArrayBuffer}`).toBe(
        `${entry.family}: true`
      );
    }
    expect(requested).toHaveLength(loaderRequests);
    // Under the WORD name, so the browser paints Calibri runs with Carlito glyphs.
    expect(new Set(capture.registered.map((entry) => entry.family))).toEqual(new Set(['Calibri']));
  });

  test('falls back to the URL form when no loaded sources are supplied', async () => {
    const capture = captureRegistrations();
    active = capture;
    await installDefaultFontFaces({
      families: ['Calibri'],
      document: capture.document,
    });

    // The source shape is the claim, and the return value is deliberately not asserted:
    // the stub resolves `load()` whatever it was handed, so a count of 4 would hold for a
    // broken fallback too.
    expect(capture.registered.map((entry) => typeof entry.source)).toEqual([
      'string',
      'string',
      'string',
      'string',
    ]);
    for (const entry of capture.registered) {
      // QUOTED. An unquoted CSS `url()` token forbids characters the URL parser leaves
      // alone, `(` and `)` among them, so a checkout under a path like `My (Docs)` built
      // a token that failed to parse and silently dropped the face.
      expect(String(entry.source)).toMatch(/^url\("[^"]*Carlito-[^"]*"\)$/);
    }
  });

  test('ignores loaded sources that are not packaged assets', async () => {
    const capture = captureRegistrations();
    active = capture;
    await installDefaultFontFaces({
      families: ['Calibri'],
      document: capture.document,
      // A composed configuration can carry sources from other origins. Only ids this
      // package minted name a packaged file, so anything else must not be mistaken for one.
      loaded: [
        {
          request: { family: 'Carlito', weight: 400, style: 'normal' },
          id: 'google-fonts:Carlito-Regular.ttf',
          bytes: new Uint8Array([1, 2, 3]),
          hash: 'sha256:0',
          faceIndex: 0,
        },
      ],
    });

    for (const entry of capture.registered) {
      expect(typeof entry.source).toBe('string');
    }
  });
});
