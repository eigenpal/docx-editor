// @docx-editor.dev/fonts/google — the on-demand half.
//
// Pins the promises that make fetching-on-open defensible: nothing goes out for a family
// the document did not name, a name is only ever a lookup key (never a URL fragment),
// every URL is pinned to the recorded revision, and a substituted name resolves to its
// metric-compatible target.

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import {
  GOOGLE_FONTS_REVISION,
  GOOGLE_FONT_CATALOG,
  GOOGLE_FONT_FAMILIES,
  GOOGLE_METRIC_SUBSTITUTES,
  googleFonts,
} from '../google-fonts.ts';

/**
 * A fetcher that serves catalogued byte lengths without touching the network, and reads
 * the package's OWN assets from disk — `googleFonts()` answers a family the catalog
 * cannot match from the bundle, over this same fetcher.
 */
function fakeFetcher(): { fetcher: typeof fetch; requested: string[] } {
  const requested: string[] = [];
  const fetcher = ((input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (url.startsWith('file:')) {
      return Promise.resolve(new Response(new Uint8Array(readFileSync(new URL(url)))));
    }
    const face = GOOGLE_FONT_CATALOG.find((entry) => entry.url === url);
    if (!face) return Promise.resolve(new Response(null, { status: 404 }));
    return Promise.resolve(new Response(new Uint8Array(face.byteLength)));
  }) as typeof fetch;
  return { fetcher, requested };
}

const resolve = (
  families: readonly string[],
  fetcher: typeof fetch,
  options: Parameters<typeof googleFonts>[0] = {}
) =>
  googleFonts({ ...options, fetcher, onFailure: options.onFailure ?? (() => {}) })({
    families,
    defaultFamily: 'Calibri',
  });

/**
 * The same, with a default family the catalog does not cover — so `sources` reflects the
 * declared families ALONE. `resolve` always drags Carlito in as Calibri's stand-in, which
 * is right for the default-family behaviour and useless for asserting what one name did.
 */
const resolveOnly = (
  families: readonly string[],
  fetcher: typeof fetch,
  options: Parameters<typeof googleFonts>[0] = {}
) =>
  googleFonts({ ...options, fetcher, onFailure: options.onFailure ?? (() => {}) })({
    families,
    defaultFamily: 'No Such Family',
  });

describe('catalog', () => {
  test('every family ships all four faces, pinned to an immutable revision', () => {
    const byFamily = new Map<string, Set<string>>();
    for (const face of GOOGLE_FONT_CATALOG) {
      expect(face.url).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/gh\/google\/fonts@[0-9a-f]{40}\//);
      expect(face.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      const faces = byFamily.get(face.family) ?? new Set<string>();
      faces.add(`${face.weight}/${face.style}`);
      byFamily.set(face.family, faces);
    }
    expect(byFamily.size).toBe(GOOGLE_FONT_FAMILIES.length);
    for (const [family, faces] of byFamily) {
      expect(`${family}:${faces.size}`).toBe(`${family}:4`);
    }
  });

  test('serves static Montserrat families without admitting variable fonts', () => {
    expect(GOOGLE_FONT_FAMILIES).toContain('Montserrat');
    expect(GOOGLE_FONT_FAMILIES).toContain('Montserrat Light');
    const montserrat = GOOGLE_FONT_CATALOG.filter((face) => face.family === 'Montserrat');
    expect(montserrat).toHaveLength(4);
    expect(montserrat.every((face) => !face.url.includes(`@${GOOGLE_FONTS_REVISION}/`))).toBe(true);
  });

  test('every metric substitute target is actually catalogued', () => {
    for (const target of Object.values(GOOGLE_METRIC_SUBSTITUTES)) {
      expect(GOOGLE_FONT_FAMILIES).toContain(target);
    }
  });
});

describe('googleFonts resolver', () => {
  test('fetches ONLY the families the document declared', async () => {
    const { fetcher, requested } = fakeFetcher();
    const fragment = await resolve(['Tinos'], fetcher);
    // Four faces of Tinos, plus the four the default family (Calibri -> Carlito) needs.
    expect(fragment.sources.map((source) => source.request.family).sort()).toEqual([
      'Carlito',
      'Carlito',
      'Carlito',
      'Carlito',
      'Tinos',
      'Tinos',
      'Tinos',
      'Tinos',
    ]);
    expect(requested).toHaveLength(8);
    expect(requested.every((url) => /\/(tinos|carlito)\//.test(url))).toBe(true);
    expect(fragment.failures).toHaveLength(0);
  });

  test('a document naming nothing catalogued makes no request at all', async () => {
    const { fetcher, requested } = fakeFetcher();
    const fragment = await googleFonts({ fetcher })({
      families: ['Wingdings', 'Segoe UI', 'Some Corporate Face'],
      defaultFamily: 'Wingdings',
    });
    expect(requested).toHaveLength(0);
    expect(fragment.sources).toHaveLength(0);
    expect(fragment.substitutions).toHaveLength(0);
  });

  test('a Word family resolves through its metric-compatible stand-in', async () => {
    const { fetcher } = fakeFetcher();
    const fragment = await resolve(['Times New Roman'], fetcher);
    const substitution = fragment.substitutions.find(
      (entry) =>
        entry.from.family === 'Times New Roman' &&
        entry.from.weight === 700 &&
        entry.from.style === 'normal'
    );
    expect(substitution?.to).toEqual({ family: 'Tinos', weight: 700, style: 'normal' });
    // The SOURCE speaks the catalog name; only the substitution speaks Word's.
    expect(fragment.sources.every((source) => source.request.family !== 'Times New Roman')).toBe(
      true
    );
  });

  test('a family the catalog cannot match resolves from the packaged assets', async () => {
    // No google/fonts family is metric-compatible with Century Gothic, and the closest
    // The package's own TeX Gyre Adventor answers it, over the SAME fetcher, so
    // `googleFonts()` is the on-demand path for it and makes no third-party request.
    const { fetcher, requested } = fakeFetcher();
    const fragment = await resolveOnly(['century gothic'], fetcher);
    expect(fragment.sources).toHaveLength(4);
    expect(fragment.sources.every((source) => source.request.family === 'TeX Gyre Adventor')).toBe(
      true
    );
    expect(requested.every((url) => url.includes('TeXGyreAdventor'))).toBe(true);
    // Keyed on the document's own spelling, and carrying Word's line box for the family —
    // PER WEIGHT, because Century Gothic's bold ascent is 2032 against the regular 1989.
    expect(
      fragment.substitutions.map(
        (entry) =>
          `${entry.from.family}/${entry.from.weight}/${entry.from.style}->${entry.to.family}@${entry.lineMetrics?.heightEm}`
      )
    ).toEqual([
      'century gothic/400/normal->TeX Gyre Adventor@1.19140625',
      'century gothic/700/normal->TeX Gyre Adventor@1.21240234375',
      'century gothic/400/italic->TeX Gyre Adventor@1.19140625',
      'century gothic/700/italic->TeX Gyre Adventor@1.21240234375',
    ]);
  });

  test('Montserrat family names resolve directly to their static faces', async () => {
    const { fetcher } = fakeFetcher();
    const fragment = await resolveOnly(['Montserrat', 'Montserrat Light'], fetcher);
    expect(fragment.sources).toHaveLength(8);
    expect(new Set(fragment.sources.map((source) => source.request.family))).toEqual(
      new Set(['Montserrat', 'Montserrat Light'])
    );
    expect(fragment.substitutions).toHaveLength(0);
  });

  test('an explicit substitute overrides the packaged answer for that family', async () => {
    // The bundled face is a DEFAULT, not a floor. Checking it before the substitution map
    // made Century Gothic the one family `substitute` could not redirect, and under
    // `allow` the two options together resolved to nothing at all.
    const { fetcher, requested } = fakeFetcher();
    const fragment = await resolveOnly(['Century Gothic'], fetcher, {
      substitute: { 'Century Gothic': 'Lato' },
    });
    expect(fragment.sources.every((source) => source.request.family === 'Lato')).toBe(true);
    expect(fragment.sources).toHaveLength(4);
    expect(requested.some((url) => url.includes('TeXGyreAdventor'))).toBe(false);

    const narrowed = fakeFetcher();
    const allowed = await resolveOnly(['Century Gothic'], narrowed.fetcher, {
      allow: ['Lato'],
      substitute: { 'Century Gothic': 'Lato' },
    });
    expect(allowed.sources).toHaveLength(4);
    expect(allowed.sources.every((source) => source.request.family === 'Lato')).toBe(true);
  });

  test('a family named directly needs no substitution entry', async () => {
    const { fetcher } = fakeFetcher();
    const fragment = await resolve(['Cousine'], fetcher);
    expect(fragment.substitutions.some((entry) => entry.from.family === 'Cousine')).toBe(false);
  });

  test('a file-supplied name is a lookup key, never part of a URL', async () => {
    const { fetcher, requested } = fakeFetcher();
    const hostile = [
      '../../../etc/passwd',
      'https://evil.example/font.ttf',
      'Tinos/../../evil',
      // Escaped, never a literal NUL: an embedded control byte makes git treat the
      // whole file as binary, which costs every reviewer the diff.
      'Tinos\u0000',
    ];
    const fragment = await resolve(hostile, fetcher);
    // Only the default family's stand-in was fetched; every hostile name missed the catalog.
    expect(requested.every((url) => url.includes('/carlito/'))).toBe(true);
    expect(fragment.sources.every((source) => source.request.family === 'Carlito')).toBe(true);
  });

  test('a family named in a prototype key resolves like any other miss', async () => {
    // `substitutes[declared]` on a plain object answers `Object` for "constructor", and
    // the lookup went on to call `.toLowerCase()` on a function. One `w:rFonts` was enough
    // to reject the whole resolver, which the engine degrades to the fixed measurer — so
    // an odd family name cost the document EVERY other family's fonts too.
    const { fetcher } = fakeFetcher();
    for (const hostile of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      const fragment = await resolveOnly([hostile, 'Tinos'], fetcher);
      expect(fragment.sources.some((source) => source.request.family === 'Tinos')).toBe(true);
      expect(fragment.sources.every((source) => source.request.family === 'Tinos')).toBe(true);
    }
  });

  test('a substituted family matches however the document spelled it', async () => {
    // Word matches font names case-insensitively and the catalog lookup always did, but
    // the substitution map was keyed exact-case: `w:ascii="calibri"` resolved to nothing
    // while "Calibri" resolved to four faces.
    const { fetcher } = fakeFetcher();
    for (const spelling of ['Calibri', 'calibri', 'CALIBRI']) {
      const fragment = await resolveOnly([spelling], fetcher, { substitute: {} });
      expect(fragment.sources.length).toBeGreaterThan(0);
      expect(fragment.sources.every((source) => source.request.family === 'Carlito')).toBe(true);
      // The substitution speaks the document's own spelling, because the painter finds a
      // face's alias under the name the run actually wrote.
      expect(fragment.substitutions.every((entry) => entry.from.family === spelling)).toBe(true);
    }
  });

  test('a catalogued family spelled in another case still paints', async () => {
    const { fetcher } = fakeFetcher();
    const fragment = await resolveOnly(['tinos'], fetcher);
    expect(fragment.sources.every((source) => source.request.family === 'Tinos')).toBe(true);
    // Face keys are case-sensitive, so "tinos" needs an entry pointing at the "Tinos"
    // face or it would measure shaped and paint in whatever the platform picks.
    expect(
      fragment.substitutions.some(
        (entry) => entry.from.family === 'tinos' && entry.to.family === 'Tinos'
      )
    ).toBe(true);
  });

  test('`allow` closes the catalog down to a short list', async () => {
    const { fetcher, requested } = fakeFetcher();
    const fragment = await resolve(['Tinos', 'Cousine'], fetcher, { allow: ['Tinos'] });
    expect(requested.every((url) => url.includes('/tinos/'))).toBe(true);
    expect(fragment.sources.every((source) => source.request.family === 'Tinos')).toBe(true);
  });

  test('an app substitution overrides the built-in map', async () => {
    const { fetcher } = fakeFetcher();
    const fragment = await resolve(['Georgia'], fetcher, { substitute: { Georgia: 'Tinos' } });
    expect(
      fragment.substitutions.some(
        (entry) => entry.from.family === 'Georgia' && entry.to.family === 'Tinos'
      )
    ).toBe(true);
  });

  test('bytes that are not the catalogued length are refused, not admitted', async () => {
    const failures: string[] = [];
    const fetcher = ((_input: RequestInfo | URL) =>
      Promise.resolve(new Response(new Uint8Array(7)))) as typeof fetch;
    const fragment = await googleFonts({
      fetcher,
      onFailure: (failure) => failures.push(failure.diagnostic),
    })({ families: ['Tinos'], defaultFamily: 'Tinos' });
    expect(fragment.sources).toHaveLength(0);
    expect(failures).toHaveLength(4);
    expect(failures[0]).toContain('unexpected byte length 7');
  });

  test('an HTTP failure degrades that face and reports it, leaving the rest usable', async () => {
    const failures: string[] = [];
    const { fetcher: ok } = fakeFetcher();
    const fetcher = ((input: RequestInfo | URL) =>
      String(input).includes('-Bold.ttf')
        ? Promise.resolve(new Response(null, { status: 503 }))
        : ok(input)) as typeof fetch;
    const fragment = await googleFonts({
      fetcher,
      onFailure: (failure) => failures.push(failure.diagnostic),
    })({ families: ['Cousine'], defaultFamily: 'Cousine' });
    expect(failures).toEqual(['HTTP 503']);
    expect(fragment.sources).toHaveLength(3);
  });

  test('sources carry the catalogued hash, so the engine can re-derive and refuse drift', async () => {
    const { fetcher } = fakeFetcher();
    const fragment = await resolve(['Tinos'], fetcher);
    for (const source of fragment.sources) {
      const catalogued = GOOGLE_FONT_CATALOG.find(
        (face) =>
          face.family === source.request.family &&
          face.weight === source.request.weight &&
          face.style === source.request.style
      );
      expect(source.hash).toBe(catalogued!.hash);
    }
  });

  test('resolution order does not change the composed result', async () => {
    const { fetcher } = fakeFetcher();
    const first = await resolve(['Tinos', 'Cousine'], fetcher);
    const second = await resolve(['Cousine', 'Tinos'], fetcher);
    expect(first.sources.map((source) => source.id)).toEqual(second.sources.map((s) => s.id));
  });
});
