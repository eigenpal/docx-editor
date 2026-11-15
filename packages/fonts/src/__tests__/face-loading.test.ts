// Loading only the faces a document uses (`faces`), the byte cache that the loaders share,
// and the idle prefetch that fills it with the other faces of the families in use.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'bun:test';
import { loadDefaultFonts, packagedFonts, prefetchDefaultFonts } from '../index.ts';
import { GOOGLE_FONT_CATALOG, googleFonts } from '../google-fonts.ts';

const assetsDir = new URL('../../assets/', import.meta.url);

/** A fetcher over the package's own assets and the catalog's byte lengths. */
function fakeFetcher() {
  const requested: { file: string; priority: string | undefined }[] = [];
  const held: (() => void)[] = [];
  let hold = false;
  const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const file = url.slice(url.lastIndexOf('/') + 1);
    requested.push({ file, priority: (init as { priority?: string } | undefined)?.priority });
    const respond = () => {
      const face = GOOGLE_FONT_CATALOG.find((entry) => entry.url === url);
      return new Response(
        face
          ? new Uint8Array(face.byteLength)
          : new Uint8Array(readFileSync(new URL(file, assetsDir)))
      );
    };
    if (!hold) return Promise.resolve(respond());
    return new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      held.push(() => resolve(respond()));
    });
  }) as typeof fetch;
  return {
    fetcher,
    files: () => requested.map((entry) => entry.file),
    requested,
    hold: () => void (hold = true),
    release: () => held.splice(0).forEach((run) => run()),
  };
}

/** Run idle callbacks by hand. */
const idle: (() => void)[] = [];
const host = globalThis as { requestIdleCallback?: (run: () => void) => number };
afterEach(() => {
  delete host.requestIdleCallback;
  idle.length = 0;
});
const withIdle = () => (host.requestIdleCallback = (run) => idle.push(run));

describe('loadDefaultFonts with faces', () => {
  test('loads only the faces asked for, and maps only those', async () => {
    const { fetcher, files } = fakeFetcher();
    const fragment = await loadDefaultFonts({
      families: ['Calibri', 'Arial'],
      faces: [
        { weight: 400, style: 'normal' },
        { weight: 600, style: 'italic' },
      ],
      fetcher,
    });
    expect(files().sort()).toEqual([
      'Carlito-BoldItalic.ttf',
      'Carlito-Regular.ttf',
      'LiberationSans-BoldItalic.ttf',
      'LiberationSans-Regular.ttf',
    ]);
    expect(fragment.sources).toHaveLength(4);
    expect(
      fragment.substitutions.map((s) => `${s.from.family} ${s.from.weight} ${s.from.style}`)
    ).toEqual(['Calibri 400 normal', 'Calibri 700 italic', 'Arial 400 normal', 'Arial 700 italic']);
  });

  test('an italic of an upright-only family loads its upright file once', async () => {
    const { fetcher, files } = fakeFetcher();
    const fragment = await loadDefaultFonts({
      families: ['Segoe UI'],
      faces: [
        { weight: 400, style: 'normal' },
        { weight: 400, style: 'italic' },
      ],
      fetcher,
    });
    expect(files()).toEqual(['Selawik-Regular.ttf']);
    expect(fragment.substitutions.map((s) => `${s.from.style} -> ${s.to.style}`)).toEqual([
      'normal -> normal',
      'italic -> normal',
    ]);
  });

  test('a second load of the same face reads it from memory', async () => {
    const { fetcher, files } = fakeFetcher();
    await loadDefaultFonts({
      families: ['Cambria'],
      faces: [{ weight: 400, style: 'normal' }],
      fetcher,
    });
    const again = await loadDefaultFonts({
      families: ['Cambria'],
      faces: [{ weight: 400, style: 'normal' }],
      fetcher,
    });
    expect(files()).toEqual(['Caladea-Regular.ttf']);
    expect(again.sources).toHaveLength(1);
  });
});

describe('packagedFonts with faces', () => {
  test('loads the faces the text uses, and nothing for a family no text uses', async () => {
    const { fetcher, files } = fakeFetcher();
    const fragment = await packagedFonts({ fetcher, prefetch: false })({
      families: ['Times New Roman', 'Courier New'],
      defaultFamily: 'Calibri',
      faces: [
        { family: 'times new roman', weight: 700, style: 'normal' },
        { family: 'Calibri', weight: 400, style: 'italic' },
      ],
    });
    expect(files().sort()).toEqual(['Carlito-Italic.ttf', 'LiberationSerif-Bold.ttf']);
    expect(fragment.families).toEqual(['Calibri', 'Times New Roman']);
  });

  test('an alias loads the face of its family that its text uses', async () => {
    const { fetcher, files } = fakeFetcher();
    const fragment = await packagedFonts({ fetcher, prefetch: false })({
      families: ['Helvetica'],
      defaultFamily: 'Helvetica',
      faces: [{ family: 'Helvetica', weight: 700, style: 'normal' }],
    });
    expect(files()).toEqual(['LiberationSans-Bold.ttf']);
    expect(fragment.substitutions.map((s) => `${s.from.family} ${s.from.weight}`)).toContain(
      'Helvetica 700'
    );
  });

  test('without faces, every face of a family loads, as before', async () => {
    const { fetcher, files } = fakeFetcher();
    await packagedFonts({ fetcher })({ families: [], defaultFamily: 'Courier New' });
    expect(files()).toHaveLength(4);
    expect(idle).toHaveLength(0);
  });

  test('prefetches the other faces of the families in use when idle, at low priority', async () => {
    withIdle();
    const { fetcher, files, requested } = fakeFetcher();
    const resolve = packagedFonts({ fetcher });
    await resolve({
      families: ['Arial'],
      defaultFamily: 'Arial',
      faces: [{ family: 'Arial', weight: 400, style: 'normal' }],
    });
    expect(files()).toEqual(['LiberationSans-Regular.ttf']);
    expect(idle).toHaveLength(1);
    idle[0]!();
    expect(requested.slice(1).map((entry) => entry.priority)).toEqual(['low', 'low', 'low']);
    expect(files().slice(1).sort()).toEqual([
      'LiberationSans-Bold.ttf',
      'LiberationSans-BoldItalic.ttf',
      'LiberationSans-Italic.ttf',
    ]);
    await new Promise((settle) => setTimeout(settle, 0));
    // A bold edit later: its face is in memory, so nothing is fetched again.
    const bold = await resolve({
      families: ['Arial'],
      defaultFamily: 'Arial',
      resolvedFaces: [{ family: 'Arial', weight: 400, style: 'normal' }],
      faces: [
        { family: 'Arial', weight: 400, style: 'normal' },
        { family: 'Arial', weight: 700, style: 'normal' },
      ],
    });
    expect(bold.sources.map((source) => source.request.weight)).toEqual([700]);
    expect(files()).toHaveLength(4);
  });

  test('the prefetch waits until the faces the document needs have arrived', async () => {
    withIdle();
    const { fetcher, hold, release } = fakeFetcher();
    hold();
    const loading = packagedFonts({ fetcher })({
      families: [],
      defaultFamily: 'Cambria',
      faces: [{ family: 'Cambria', weight: 400, style: 'normal' }],
    });
    await new Promise((settle) => setTimeout(settle, 0));
    expect(idle).toHaveLength(0);
    release();
    await loading;
    expect(idle).toHaveLength(1);
  });

  test('prefetch: false fetches nothing ahead', async () => {
    withIdle();
    const { fetcher } = fakeFetcher();
    await packagedFonts({ fetcher, prefetch: false })({
      families: [],
      defaultFamily: 'Calibri',
      faces: [{ family: 'Calibri', weight: 400, style: 'normal' }],
    });
    expect(idle).toHaveLength(0);
  });
});

describe('prefetchDefaultFonts', () => {
  test('a load joins a prefetch on the way instead of fetching again', async () => {
    const { fetcher, files, hold, release } = fakeFetcher();
    hold();
    prefetchDefaultFonts({
      families: ['Cambria'],
      faces: [{ weight: 700, style: 'italic' }],
      fetcher,
    });
    const load = loadDefaultFonts({
      families: ['Cambria'],
      faces: [{ weight: 700, style: 'italic' }],
      fetcher,
    });
    release();
    expect((await load).sources).toHaveLength(1);
    expect(files()).toEqual(['Caladea-BoldItalic.ttf']);
  });

  test('a failed prefetch is forgotten, so a later load fetches the file', async () => {
    let calls = 0;
    const fetcher = ((input: RequestInfo | URL) => {
      calls += 1;
      if (calls === 1) return Promise.resolve(new Response(null, { status: 503 }));
      const url = String(input);
      return Promise.resolve(
        new Response(
          new Uint8Array(readFileSync(new URL(url.slice(url.lastIndexOf('/') + 1), assetsDir)))
        )
      );
    }) as typeof fetch;
    prefetchDefaultFonts({
      families: ['Courier New'],
      faces: [{ weight: 400, style: 'italic' }],
      fetcher,
    });
    await new Promise((settle) => setTimeout(settle, 0));
    const fragment = await loadDefaultFonts({
      families: ['Courier New'],
      faces: [{ weight: 400, style: 'italic' }],
      fetcher,
    });
    expect(fragment.failures).toEqual([]);
    expect(calls).toBe(2);
  });

  test('the abort of a load that joined a prefetch cancels it', async () => {
    const { fetcher, hold } = fakeFetcher();
    hold();
    prefetchDefaultFonts({
      families: ['Arial'],
      faces: [{ weight: 700, style: 'italic' }],
      fetcher,
    });
    const controller = new AbortController();
    const load = loadDefaultFonts({
      families: ['Arial'],
      faces: [{ weight: 700, style: 'italic' }],
      fetcher,
      signal: controller.signal,
    });
    controller.abort(new Error('superseded'));
    await expect(load).rejects.toThrow('superseded');
  });
});

describe('googleFonts with faces', () => {
  test('fetches only the catalog faces the text uses', async () => {
    const { fetcher, files } = fakeFetcher();
    const roboto = GOOGLE_FONT_CATALOG.filter((face) => face.family === 'Roboto');
    expect(roboto.length).toBeGreaterThan(1);
    const fragment = await googleFonts({ fetcher, prefetch: false, onFailure: () => {} })({
      families: ['Roboto'],
      defaultFamily: 'Roboto',
      faces: [{ family: 'Roboto', weight: 400, style: 'normal' }],
    });
    expect(files()).toHaveLength(1);
    expect(
      fragment.sources.map((source) => `${source.request.weight} ${source.request.style}`)
    ).toEqual(['400 normal']);
  });

  test('a family no text uses fetches nothing', async () => {
    const { fetcher, files } = fakeFetcher();
    await googleFonts({ fetcher, prefetch: false, onFailure: () => {} })({
      families: ['Roboto'],
      defaultFamily: 'Calibri',
      faces: [{ family: 'Calibri', weight: 400, style: 'normal' }],
    });
    expect(files().some((file) => file.toLowerCase().includes('roboto'))).toBe(false);
  });

  test('prefetches the other catalog faces of a family in use when idle', async () => {
    withIdle();
    const { fetcher, requested } = fakeFetcher();
    await googleFonts({ fetcher, onFailure: () => {} })({
      families: ['Roboto'],
      defaultFamily: 'Roboto',
      faces: [{ family: 'Roboto', weight: 400, style: 'normal' }],
    });
    expect(requested).toHaveLength(1);
    idle[0]!();
    const roboto = GOOGLE_FONT_CATALOG.filter((face) => face.family === 'Roboto');
    expect(requested).toHaveLength(roboto.length);
    expect(requested.slice(1).every((entry) => entry.priority === 'low')).toBe(true);
  });
});
