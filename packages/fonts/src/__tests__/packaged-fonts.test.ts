// `packagedFonts()` — the packaged substitutes served ON DEMAND.
//
// The promises pinned here are the ones the interface is for: a document pays only for the
// families it names, a name outside the closed five buys nothing, the answer is stable
// regardless of how the file happened to order its `w:rFonts`, and the function carries the
// mark that tells `useDocxSource` it must not be called as a zero-argument loader.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  ALL_WORD_DEFAULT_FAMILIES,
  FONT_ASSET_MANIFEST,
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

const EVERY_PACKAGED_BYTE = FONT_ASSET_MANIFEST.reduce(
  (total, entry) => total + entry.byteLength,
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

  test('a document naming none of the five costs nothing at all', async () => {
    const { fetcher, requested } = countingFetcher();
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
    await packagedFonts({ fetcher: lazy.fetcher, install: false })({
      families: [],
      defaultFamily: 'Times New Roman',
    });
    const eager = countingFetcher();
    await loadDefaultFonts({ fetcher: eager.fetcher });

    expect(eager.bytes()).toBe(EVERY_PACKAGED_BYTE);
    // A Times-New-Roman-only document buys Liberation Serif and nothing else, which is
    // under a quarter of what the eager loader spends whichever document opens.
    expect(lazy.bytes()).toBeLessThan(eager.bytes() / 4);
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
    expect(forwards.families).toEqual(['Calibri', 'Cambria', 'Arial']);
    expect(forwards.families.every((family) => ALL_WORD_DEFAULT_FAMILIES.includes(family))).toBe(
      true
    );
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

  test('skips a family an earlier origin in the composition already answered for', async () => {
    const { fetcher, requested } = countingFetcher();
    const fragment = await packagedFonts({ fetcher, install: false })({
      families: ['Times New Roman'],
      defaultFamily: 'Calibri',
      // Both spellings a composition can report: the Word name and the loaded face.
      resolvedFamilies: ['calibri', 'Liberation Serif'],
    });

    expect(fragment.families).toHaveLength(0);
    expect(requested).toHaveLength(0);
  });

  test('carries the resolver mark, so a hook never calls it as a loader', () => {
    const resolve = packagedFonts();
    const brand = Symbol.for('docx-editor.dev/font-resolver');

    expect((resolve as unknown as Record<symbol, unknown>)[brand]).toBe(true);
    // Not enumerable: the mark must not turn up in a host's own `{ ...resolver }`.
    expect(Object.getOwnPropertyNames(resolve)).not.toContain(
      'Symbol(docx-editor.dev/font-resolver)'
    );
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
