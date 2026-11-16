// Loading only the faces a document uses (`faces`), the byte cache that the loaders share,
// and the idle prefetch that fills it with the other faces of the families in use.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'bun:test';
import { loadDefaultFonts, packagedFonts } from '../index.ts';
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
const host = globalThis as {
  requestIdleCallback?: (run: () => void) => number;
  document?: unknown;
};
afterEach(() => {
  delete host.requestIdleCallback;
  delete host.document;
  idle.length = 0;
});
const withIdle = () => (host.requestIdleCallback = (run) => idle.push(run));
const tick = () => new Promise((settle) => setTimeout(settle, 0));

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
    const fragment = await packagedFonts({ fetcher, loading: 'lazy' })({
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
    const fragment = await packagedFonts({ fetcher, loading: 'lazy' })({
      families: ['Helvetica'],
      defaultFamily: 'Helvetica',
      faces: [{ family: 'Helvetica', weight: 700, style: 'normal' }],
    });
    expect(files()).toEqual(['LiberationSans-Bold.ttf']);
    expect(fragment.substitutions.map((s) => `${s.from.family} ${s.from.weight}`)).toContain(
      'Helvetica 700'
    );
  });

  test('an alias face points at the packaged face, not at a redirect of its family', async () => {
    const { fetcher, files } = fakeFetcher();
    // An earlier answer installed Liberation Sans Bold and mapped Arial 700 onto it.
    const fragment = await packagedFonts({ fetcher, loading: 'lazy' })({
      families: ['Helvetica'],
      defaultFamily: 'Helvetica',
      resolvedFaces: [
        { family: 'Liberation Sans', weight: 700, style: 'normal' },
        { family: 'Arial', weight: 700, style: 'normal' },
      ],
      faces: [{ family: 'Helvetica', weight: 700, style: 'normal' }],
    });
    expect(files()).toEqual([]);
    expect(fragment.substitutions.map((s) => `${s.from.family} > ${s.to.family}`)).toEqual([
      'Helvetica > Liberation Sans',
    ]);
  });

  test('the deferred faces of an alias family map the alias too', async () => {
    withIdle();
    const { fetcher } = fakeFetcher();
    const fragment = await packagedFonts({ fetcher })({
      families: ['Helvetica'],
      defaultFamily: 'Helvetica',
      faces: [{ family: 'Helvetica', weight: 400, style: 'normal' }],
    });
    await tick();
    idle[0]!();
    const later = await fragment.deferred!;
    expect(
      later.substitutions
        .filter((s) => s.from.family === 'Helvetica')
        .map((s) => `${s.from.weight} ${s.from.style} > ${s.to.family}`)
    ).toEqual([
      '700 normal > Liberation Sans',
      '400 italic > Liberation Sans',
      '700 italic > Liberation Sans',
    ]);
  });

  test('without faces, every face of a family loads, as before', async () => {
    const { fetcher, files } = fakeFetcher();
    await packagedFonts({ fetcher })({ families: [], defaultFamily: 'Courier New' });
    expect(files()).toHaveLength(4);
    expect(idle).toHaveLength(0);
  });

  test('loads the other faces of the families in use when idle, at low priority, as a deferred answer', async () => {
    withIdle();
    const { fetcher, files, requested } = fakeFetcher();
    const fragment = await packagedFonts({ fetcher })({
      families: ['Arial'],
      defaultFamily: 'Arial',
      faces: [{ family: 'Arial', weight: 400, style: 'normal' }],
    });
    expect(files()).toEqual(['LiberationSans-Regular.ttf']);
    expect(fragment.deferred).toBeDefined();
    await tick();
    expect(idle).toHaveLength(1);
    idle[0]!();
    const later = await fragment.deferred!;
    expect(requested.slice(1).map((entry) => entry.priority)).toEqual(['low', 'low', 'low']);
    expect(later.sources.map((source) => source.id).sort()).toEqual([
      'default-fonts:LiberationSans-Bold.ttf',
      'default-fonts:LiberationSans-BoldItalic.ttf',
      'default-fonts:LiberationSans-Italic.ttf',
    ]);
    expect(
      later.substitutions.map((s) => `${s.from.family} ${s.from.weight} ${s.from.style}`)
    ).toEqual(['Arial 700 normal', 'Arial 400 italic', 'Arial 700 italic']);
    expect(later.families).toEqual(['Arial']);
  });

  test('the deferred faces wait until the faces the document needs have arrived', async () => {
    withIdle();
    const { fetcher, hold, release } = fakeFetcher();
    hold();
    const loading = packagedFonts({ fetcher })({
      families: [],
      defaultFamily: 'Cambria',
      faces: [{ family: 'Cambria', weight: 400, style: 'normal' }],
    });
    await tick();
    expect(idle).toHaveLength(0);
    release();
    await loading;
    await tick();
    expect(idle).toHaveLength(1);
  });

  test('a browser without requestIdleCallback loads the deferred faces after a short delay', async () => {
    host.document = {};
    const { fetcher, files } = fakeFetcher();
    const timers: (() => void)[] = [];
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((run: () => void) => timers.push(run)) as typeof setTimeout;
    let fragment;
    try {
      fragment = await packagedFonts({ fetcher })({
        families: [],
        defaultFamily: 'Cambria',
        faces: [{ family: 'Cambria', weight: 400, style: 'normal' }],
      });
      await Promise.resolve();
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
    expect(files()).toEqual(['Caladea-Regular.ttf']);
    expect(timers).toHaveLength(1);
    timers[0]!();
    expect((await fragment.deferred!).sources).toHaveLength(3);
  });

  test('outside a browser, the other faces load on demand', async () => {
    const { fetcher } = fakeFetcher();
    const fragment = await packagedFonts({ fetcher })({
      families: [],
      defaultFamily: 'Calibri',
      faces: [{ family: 'Calibri', weight: 400, style: 'normal' }],
    });
    expect(fragment.deferred).toBeUndefined();
  });

  test('a cancelled resolution loads nothing in the background', async () => {
    withIdle();
    const { fetcher, files } = fakeFetcher();
    const controller = new AbortController();
    const fragment = await packagedFonts({ fetcher })({
      families: [],
      defaultFamily: 'Calibri',
      faces: [{ family: 'Calibri', weight: 400, style: 'normal' }],
      signal: controller.signal,
    });
    // The editor moved on before the browser was idle.
    controller.abort(new Error('superseded'));
    await expect(fragment.deferred!).rejects.toThrow('superseded');
    idle.forEach((run) => run());
    expect(files()).toEqual(['Carlito-Regular.ttf']);
  });

  test("loading: 'lazy' loads nothing ahead", async () => {
    withIdle();
    const { fetcher } = fakeFetcher();
    const fragment = await packagedFonts({ fetcher, loading: 'lazy' })({
      families: [],
      defaultFamily: 'Calibri',
      faces: [{ family: 'Calibri', weight: 400, style: 'normal' }],
    });
    expect(fragment.deferred).toBeUndefined();
    expect(idle).toHaveLength(0);
  });

  test("loading: 'eager' loads every face before the text shows", async () => {
    withIdle();
    const { fetcher, files } = fakeFetcher();
    const fragment = await packagedFonts({ fetcher, loading: 'eager' })({
      families: [],
      defaultFamily: 'Calibri',
      faces: [{ family: 'Calibri', weight: 400, style: 'normal' }],
    });
    expect([...files()].sort()).toEqual([
      'Carlito-Bold.ttf',
      'Carlito-BoldItalic.ttf',
      'Carlito-Italic.ttf',
      'Carlito-Regular.ttf',
    ]);
    expect(fragment.deferred).toBeUndefined();
    expect(idle).toHaveLength(0);
  });
});

describe('the shared byte cache', () => {
  test('a load joins a fetch on the way instead of fetching again', async () => {
    const { fetcher, files, hold, release } = fakeFetcher();
    hold();
    void loadDefaultFonts({
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

  test('a load does not join a fetch that its last waiter aborted', async () => {
    const { fetcher, files, hold, release } = fakeFetcher();
    hold();
    const first = new AbortController();
    const abandoned = loadDefaultFonts({
      families: ['Arial'],
      faces: [{ weight: 400, style: 'normal' }],
      fetcher,
      signal: first.signal,
    });
    first.abort(new Error('superseded'));
    // In the same tick: the aborted fetch has not settled yet when the next document asks.
    const next = loadDefaultFonts({
      families: ['Arial'],
      faces: [{ weight: 400, style: 'normal' }],
      fetcher,
      signal: new AbortController().signal,
    });
    await expect(abandoned).rejects.toThrow('superseded');
    release();
    const fragment = await next;
    expect(fragment.failures).toEqual([]);
    expect(fragment.sources).toHaveLength(1);
    expect(files()).toEqual(['LiberationSans-Regular.ttf', 'LiberationSans-Regular.ttf']);
  });

  test('a failed fetch is forgotten, so a later load fetches the file', async () => {
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
    const failed = await loadDefaultFonts({
      families: ['Courier New'],
      faces: [{ weight: 400, style: 'italic' }],
      fetcher,
    });
    expect(failed.failures).toHaveLength(1);
    const fragment = await loadDefaultFonts({
      families: ['Courier New'],
      faces: [{ weight: 400, style: 'italic' }],
      fetcher,
    });
    expect(fragment.failures).toEqual([]);
    expect(calls).toBe(2);
  });
});

describe('googleFonts with faces', () => {
  test('fetches only the catalog faces the text uses', async () => {
    const { fetcher, files } = fakeFetcher();
    const roboto = GOOGLE_FONT_CATALOG.filter((face) => face.family === 'Roboto');
    expect(roboto.length).toBeGreaterThan(1);
    const fragment = await googleFonts({ fetcher, loading: 'lazy', onFailure: () => {} })({
      families: ['Roboto'],
      defaultFamily: 'Roboto',
      faces: [{ family: 'Roboto', weight: 400, style: 'normal' }],
    });
    expect(files()).toHaveLength(1);
    expect(
      fragment.sources.map((source) => `${source.request.weight} ${source.request.style}`)
    ).toEqual(['400 normal']);
  });

  test("loading: 'eager' fetches every catalog face of a family in use", async () => {
    withIdle();
    const { fetcher, files } = fakeFetcher();
    const roboto = GOOGLE_FONT_CATALOG.filter((face) => face.family === 'Roboto');
    const fragment = await googleFonts({ fetcher, loading: 'eager', onFailure: () => {} })({
      families: ['Roboto'],
      defaultFamily: 'Roboto',
      faces: [{ family: 'Roboto', weight: 400, style: 'normal' }],
    });
    expect(files()).toHaveLength(roboto.length);
    expect(fragment.deferred).toBeUndefined();
    expect(idle).toHaveLength(0);
  });

  test('a family no text uses fetches nothing', async () => {
    const { fetcher, files } = fakeFetcher();
    await googleFonts({ fetcher, loading: 'lazy', onFailure: () => {} })({
      families: ['Roboto'],
      defaultFamily: 'Calibri',
      faces: [{ family: 'Calibri', weight: 400, style: 'normal' }],
    });
    expect(files().some((file) => file.toLowerCase().includes('roboto'))).toBe(false);
  });

  test('loads the other catalog faces of a family in use in the background', async () => {
    withIdle();
    const { fetcher, requested } = fakeFetcher();
    const fragment = await googleFonts({ fetcher, onFailure: () => {} })({
      families: ['Roboto'],
      defaultFamily: 'Roboto',
      faces: [{ family: 'Roboto', weight: 400, style: 'normal' }],
    });
    expect(requested).toHaveLength(1);
    await tick();
    idle[0]!();
    const later = await fragment.deferred!;
    const roboto = GOOGLE_FONT_CATALOG.filter((face) => face.family === 'Roboto');
    expect(requested).toHaveLength(roboto.length);
    expect(requested.slice(1).every((entry) => entry.priority === 'low')).toBe(true);
    expect(later.sources).toHaveLength(roboto.length - 1);
  });

  test('maps the background faces onto the name the document wrote', async () => {
    withIdle();
    const { fetcher } = fakeFetcher();
    const fragment = await googleFonts({
      fetcher,
      onFailure: () => {},
      substitute: { 'Brand Sans': 'Roboto' },
    })({
      families: ['Brand Sans'],
      defaultFamily: 'Calibri',
      resolvedFaces: [{ family: 'Calibri', weight: 400, style: 'normal' }],
      faces: [{ family: 'Brand Sans', weight: 400, style: 'normal' }],
    });
    await tick();
    idle[0]!();
    const later = await fragment.deferred!;
    expect(later.substitutions).toContainEqual({
      from: { family: 'Brand Sans', weight: 700, style: 'normal' },
      to: { family: 'Roboto', weight: 700, style: 'normal' },
    });
  });

  test('loads no bundled face in the background that an earlier origin paints', async () => {
    withIdle();
    const { fetcher, files } = fakeFetcher();
    const fragment = await googleFonts({ fetcher, onFailure: () => {} })({
      families: ['Calibri'],
      defaultFamily: 'Calibri',
      resolvedFaces: [{ family: 'Carlito', weight: 700, style: 'normal' }],
      faces: [{ family: 'Calibri', weight: 400, style: 'normal' }],
    });
    await tick();
    expect(idle).toHaveLength(1);
    idle[0]!();
    await fragment.deferred;
    expect(files()).not.toContain('Carlito-Bold.ttf');
    expect(files()).toContain('Carlito-Italic.ttf');
  });
});
