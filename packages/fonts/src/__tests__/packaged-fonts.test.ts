// `packagedFonts()` — the packaged substitutes served ON DEMAND.
//
// The promises pinned here are the ones the interface is for: a document pays for the
// families it names PLUS its default face rather than for every packaged family, a name
// outside the closed five contributes nothing of its own, the answer is stable regardless
// of how the file happened to order its `w:rFonts`, and the function carries the mark that
// tells `useDocxSource` it must not be called as a zero-argument loader.
//
// These tests hand-write the request. That is the right unit for the resolver's own rules,
// and it is also how the "costs nothing at all" claim survived four review rounds on a
// `defaultFamily` the engine cannot produce. Any test whose MEANING depends on the request
// being realistic belongs in engine-request.test.ts, which gets its request from
// `createDocxEditor`.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { FACES, FAMILY_PLANS, planFaceFile } from '../family-plans.ts';
import {
  FONT_ASSET_MANIFEST,
  WORD_DOCUMENT_DEFAULT_FAMILIES,
  loadDefaultFonts,
  packagedFonts,
} from '../index.ts';

const assetsDir = new URL('../../assets/', import.meta.url);

function countingFetcher(): { fetcher: typeof fetch; requested: string[]; bytes: () => number } {
  const requested: string[] = [];
  let total = 0;
  const fetcher = ((input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    const file = url.slice(url.lastIndexOf('/') + 1);
    const bytes = readFileSync(new URL(file, assetsDir));
    total += bytes.byteLength;
    return Promise.resolve(new Response(new Uint8Array(bytes)));
  }) as typeof fetch;
  return { fetcher, requested, bytes: () => total };
}

/**
 * What the EAGER loader spends by default: every face of every family in
 * {@link WORD_DOCUMENT_DEFAULT_FAMILIES}.
 *
 * Derived from the shipped plan rather than summed over the whole manifest. The manifest
 * now carries a family the eager loader deliberately does NOT load by default, so summing
 * it compared this against a total no configuration produces — and said so, loudly, the
 * first time the two lists diverged.
 */
const byteLengthOf = new Map(FONT_ASSET_MANIFEST.map((entry) => [entry.file, entry.byteLength]));
const EAGER_DEFAULT_BYTES = WORD_DOCUMENT_DEFAULT_FAMILIES.reduce(
  (total, family) =>
    total +
    FACES.reduce(
      (perFamily, face) =>
        perFamily + (byteLengthOf.get(planFaceFile(FAMILY_PLANS.get(family)!, face.suffix)) ?? 0),
      0
    ),
  0
);

describe('packagedFonts', () => {
  test('loads only the families the document names, plus its default family', async () => {
    const { fetcher, requested } = countingFetcher();
    const fragment = await packagedFonts({ fetcher, install: false })({
      families: ['Times New Roman', 'Montserrat'],
      defaultFamily: 'Calibri',
    });

    expect(fragment.families).toEqual(['Calibri', 'Times New Roman']);
    // Four faces each for Calibri (Carlito) and Times New Roman (Liberation Serif); the
    // uncatalogued Montserrat buys nothing here.
    expect(requested).toHaveLength(8);
    expect(requested.some((url) => url.includes('Carlito'))).toBe(true);
    expect(requested.some((url) => url.includes('LiberationSerif'))).toBe(true);
    expect(requested.some((url) => url.includes('Caladea'))).toBe(false);
    expect(requested.some((url) => url.includes('LiberationSans'))).toBe(false);
    expect(fragment.failures).toHaveLength(0);
    expect(fragment.sources).toHaveLength(8);
  });

  test('a document naming none of the six still pays for the DEFAULT family', async () => {
    const { fetcher, requested } = countingFetcher();
    // 'Calibri' because that is what the engine sends — see engine-request.test.ts. This
    // test used to pass `defaultFamily: 'Montserrat'` and assert that nothing loaded,
    // which was true of a request the engine cannot produce.
    const fragment = await packagedFonts({ fetcher, install: false })({
      families: ['Montserrat', 'Sagona'],
      defaultFamily: 'Calibri',
    });

    expect(fragment.families).toEqual(['Calibri']);
    expect(requested.map((url) => url.slice(url.lastIndexOf('/') + 1)).sort()).toEqual([
      'Carlito-Bold.ttf',
      'Carlito-BoldItalic.ttf',
      'Carlito-Italic.ttf',
      'Carlito-Regular.ttf',
    ]);
  });

  test('nothing loads only when the default family is outside the six too', async () => {
    const { fetcher, requested } = countingFetcher();
    // Reachable through `allow`, or by an engine whose default face is not one of the
    // five. Not reachable by writing a document that names none of them.
    const fragment = await packagedFonts({ fetcher, install: false })({
      families: ['Montserrat', 'Sagona'],
      defaultFamily: 'Montserrat',
    });

    expect(requested).toHaveLength(0);
    expect(fragment.families).toHaveLength(0);
    expect(fragment.sources).toHaveLength(0);
    expect(fragment.substitutions).toHaveLength(0);
  });

  test('costs a fraction of loading every packaged face', async () => {
    const lazy = countingFetcher();
    // The engine's real request for a Times New Roman document: the family it names, and
    // Calibri as the default face it inherits. This test used to pass
    // `defaultFamily: 'Times New Roman'`, which the engine never sends — the assertion
    // held either way, but its premise did not.
    await packagedFonts({ fetcher: lazy.fetcher, install: false })({
      families: ['Times New Roman'],
      defaultFamily: 'Calibri',
    });
    const eager = countingFetcher();
    await loadDefaultFonts({ fetcher: eager.fetcher });

    expect(eager.bytes()).toBe(EAGER_DEFAULT_BYTES);
    // Liberation Serif for the named family and Carlito for the default one: two families
    // out of five, still well under what the eager loader spends whichever document opens.
    expect(lazy.bytes()).toBeLessThan(eager.bytes() * 0.6);
    expect(lazy.bytes()).toBeGreaterThan(0);
  });

  test('matches family names case-insensitively, as Word does', async () => {
    const { fetcher, requested } = countingFetcher();
    const fragment = await packagedFonts({ fetcher, install: false })({
      families: ['courier new'],
      defaultFamily: 'CALIBRI',
    });

    expect(fragment.families).toEqual(['Calibri', 'Courier New']);
    expect(requested).toHaveLength(8);
  });

  test('the family list is document-order independent', async () => {
    const resolve = packagedFonts({ fetcher: countingFetcher().fetcher, install: false });
    const forwards = await resolve({
      families: ['Arial', 'Cambria', 'Calibri'],
      defaultFamily: 'Calibri',
    });
    const backwards = await resolve({
      families: ['Calibri', 'Cambria', 'Arial'],
      defaultFamily: 'Calibri',
    });

    expect(forwards.families).toEqual(backwards.families);
    // Written out rather than derived from ALL_WORD_DEFAULT_FAMILIES. Deriving it made the
    // assertion restate the implementation, and it also broke the moment that list grew:
    // a filter over the constant tracks new entries, while the three families this
    // document actually names do not.
    expect(forwards.families).toEqual(['Calibri', 'Cambria', 'Arial']);
  });

  test('`allow` narrows what a document can ever reach', async () => {
    const { fetcher, requested } = countingFetcher();
    const fragment = await packagedFonts({ allow: ['Calibri'], fetcher, install: false })({
      families: ['Arial', 'Cambria'],
      defaultFamily: 'Calibri',
    });

    expect(fragment.families).toEqual(['Calibri']);
    expect(requested.every((url) => url.includes('Carlito'))).toBe(true);
    expect(requested).toHaveLength(4);
  });

  test('substitutions speak the Word family names the document wrote', async () => {
    const { fetcher } = countingFetcher();
    const fragment = await packagedFonts({ fetcher, install: false })({
      families: [],
      defaultFamily: 'Calibri',
    });

    expect(fragment.substitutions.map((entry) => entry.from.family)).toEqual([
      'Calibri',
      'Calibri',
      'Calibri',
      'Calibri',
    ]);
    expect(new Set(fragment.substitutions.map((entry) => entry.to.family))).toEqual(
      new Set(['Carlito'])
    );
  });

  const FOUR_FACES = [
    { weight: 400, style: 'normal' as const },
    { weight: 700, style: 'normal' as const },
    { weight: 400, style: 'italic' as const },
    { weight: 700, style: 'italic' as const },
  ];
  const allFacesOf = (family: string) => FOUR_FACES.map((face) => ({ family, ...face }));

  test('skips a family an earlier origin can already paint in EVERY face', async () => {
    const { fetcher, requested } = countingFetcher();
    const fragment = await packagedFonts({ fetcher, install: false })({
      families: ['Times New Roman'],
      defaultFamily: 'Calibri',
      // Both spellings a composition can report: the Word name the document wrote
      // (case-folded, as Word matches) and the face that was actually loaded.
      resolvedFaces: [...allFacesOf('calibri'), ...allFacesOf('Liberation Serif')],
    });

    expect(fragment.families).toHaveLength(0);
    expect(requested).toHaveLength(0);
  });

  test('a PARTLY covered family is loaded whole, so no face is left without bytes', async () => {
    const { fetcher, requested } = countingFetcher();
    // The composition an earlier origin of hand-supplied brand bytes produces: regular
    // Arial and nothing else. Reading that as "Arial is covered" left bold, italic and
    // bold-italic Arial with neither bytes nor a substitution.
    const fragment = await packagedFonts({ fetcher, install: false })({
      families: ['Arial'],
      defaultFamily: 'Arial',
      resolvedFaces: [{ family: 'Arial', weight: 400, style: 'normal' }],
    });

    expect(fragment.families).toEqual(['Arial']);
    expect(requested).toHaveLength(4);
    // A substitution for every face, including the one the earlier origin covers —
    // first-wins composition drops that one, and keeps the three that matter.
    expect(fragment.substitutions).toHaveLength(4);
    expect(
      fragment.substitutions.map((entry) => `${entry.from.weight}/${entry.from.style}`).sort()
    ).toEqual(['400/italic', '400/normal', '700/italic', '700/normal']);
  });

  test('a face covered under only ONE of its two names still counts', async () => {
    const { fetcher, requested } = countingFetcher();
    // Regular and bold reported under the Word name, italics under the substitute: a
    // composition can report either spelling, and neither alone should have to be complete.
    const fragment = await packagedFonts({ fetcher, install: false })({
      families: [],
      defaultFamily: 'Calibri',
      resolvedFaces: [
        { family: 'Calibri', weight: 400, style: 'normal' },
        { family: 'Calibri', weight: 700, style: 'normal' },
        { family: 'Carlito', weight: 400, style: 'italic' },
        { family: 'Carlito', weight: 700, style: 'italic' },
      ],
    });

    expect(fragment.families).toHaveLength(0);
    expect(requested).toHaveLength(0);
  });

  test('carries both halves of the resolver mark, so a hook never calls it as a loader', () => {
    const resolve = packagedFonts();
    const brand = Symbol.for('docx-editor.dev/font-resolver');

    expect((resolve as unknown as Record<symbol, unknown>)[brand]).toBe(true);
    // The string half, which is what the TYPE claims and so must really be there.
    expect((resolve as unknown as Record<string, unknown>)['docx-editor.dev/font-resolver']).toBe(
      true
    );
    // Neither half enumerable: the mark must not turn up in a host's own `{ ...resolver }`.
    expect(Object.getOwnPropertySymbols({ ...resolve })).not.toContain(brand);
    expect(Object.keys(resolve)).toEqual([]);
  });

  test('routes failures to `onFailure` instead of the console', async () => {
    const failures: string[] = [];
    const failing = (() =>
      Promise.resolve(new Response('nope', { status: 503 }))) as unknown as typeof fetch;
    const fragment = await packagedFonts({
      fetcher: failing,
      install: false,
      onFailure: (failure) => failures.push(`${failure.family}:${failure.diagnostic}`),
    })({ families: [], defaultFamily: 'Calibri' });

    expect(failures).toHaveLength(4);
    expect(failures.every((entry) => entry.startsWith('Calibri:HTTP 503'))).toBe(true);
    // Degradation, not refusal: the substitution map survives a total fetch failure.
    expect(fragment.sources).toHaveLength(0);
    expect(fragment.substitutions).toHaveLength(4);
  });
});
