// @docx-editor.dev/fonts (font-resolution-overhaul group 4).
//
// Pins the package's promises: no fetch without a call, family narrowing fetches only
// the requested assets, baked hashes match the shipped bytes, and the fragment's
// substitution map speaks the Word family names.

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { ALL_WORD_DEFAULT_FAMILIES, FONT_ASSET_MANIFEST, loadDefaultFonts } from '../index.ts';

const assetsDir = new URL('../../assets/', import.meta.url);

function countingFetcher(): { fetcher: typeof fetch; requested: string[] } {
  const requested: string[] = [];
  const fetcher = ((input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    const file = url.slice(url.lastIndexOf('/') + 1);
    const bytes = readFileSync(new URL(file, assetsDir));
    return Promise.resolve(new Response(new Uint8Array(bytes)));
  }) as typeof fetch;
  return { fetcher, requested };
}

describe('packaged manifest', () => {
  test('baked hashes match the shipped bytes (the CI guarantee, asserted here too)', () => {
    const files = readdirSync(assetsDir).filter((name) => name.endsWith('.ttf'));
    expect(files.length).toBe(FONT_ASSET_MANIFEST.length);
    for (const entry of FONT_ASSET_MANIFEST) {
      const bytes = readFileSync(new URL(entry.file, assetsDir));
      expect(bytes.byteLength).toBe(entry.byteLength);
      expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(entry.hash);
    }
  });

  test('every Word family has all four faces packaged', () => {
    expect(ALL_WORD_DEFAULT_FAMILIES).toHaveLength(5);
    expect(FONT_ASSET_MANIFEST).toHaveLength(20);
  });
});

describe('loadDefaultFonts', () => {
  test('family narrowing fetches ONLY the requested assets', async () => {
    const { fetcher, requested } = countingFetcher();
    const fragment = await loadDefaultFonts({ families: ['Times New Roman'], fetcher });
    expect(requested).toHaveLength(4);
    expect(requested.every((url) => url.includes('LiberationSerif'))).toBe(true);
    expect(fragment.failures).toHaveLength(0);
    expect(fragment.sources).toHaveLength(4);
    expect(fragment.sources.every((s) => s.request.family === 'Liberation Serif')).toBe(true);
    // The substitution map speaks the WORD name on the from side.
    expect(fragment.substitutions).toHaveLength(4);
    expect(
      fragment.substitutions.every(
        (s) => s.from.family === 'Times New Roman' && s.to.family === 'Liberation Serif'
      )
    ).toBe(true);
  });

  test('default load covers all five families with baked hashes attached', async () => {
    const { fetcher, requested } = countingFetcher();
    const fragment = await loadDefaultFonts({ fetcher });
    expect(requested).toHaveLength(20);
    expect(fragment.sources).toHaveLength(20);
    expect(fragment.failures).toHaveLength(0);
    const manifestHashes = new Set(FONT_ASSET_MANIFEST.map((entry) => entry.hash));
    for (const source of fragment.sources) expect(manifestHashes.has(source.hash)).toBe(true);
    // Deterministic source order for stable configuration fingerprints.
    const ids = fragment.sources.map((source) => source.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  test('a failed face degrades that face only', async () => {
    const { fetcher } = countingFetcher();
    const failing = ((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('Carlito-Bold.ttf'))
        return Promise.resolve(new Response(null, { status: 500 }));
      return fetcher(input as RequestInfo);
    }) as typeof fetch;
    const fragment = await loadDefaultFonts({ families: ['Calibri'], fetcher: failing });
    expect(fragment.sources).toHaveLength(3);
    expect(fragment.failures).toEqual([
      { family: 'Calibri', file: 'Carlito-Bold.ttf', diagnostic: 'HTTP 500' },
    ]);
    // All four substitution entries stay: the missing face falls back at resolve time.
    expect(fragment.substitutions).toHaveLength(4);
  });

  test('importing the module fetches nothing (no fetch without a call)', () => {
    // The fetch spy in this suite is injected per call; the module itself holds no
    // top-level fetch. This asserts the structural fact: the only fetch call sites
    // live inside the exported functions.
    const moduleSource = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    const topLevel = moduleSource
      .split('\n')
      .filter((line) => !line.startsWith(' ') && !line.startsWith('\t'));
    expect(topLevel.some((line) => line.includes('fetch('))).toBe(false);
  });

  test('no inlined font bytes in the module source (assets stay separate files)', () => {
    const moduleSource = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    const manifestSource = readFileSync(
      new URL('../manifest.generated.ts', import.meta.url),
      'utf8'
    );
    for (const source of [moduleSource, manifestSource]) {
      expect(source.length).toBeLessThan(64 * 1024);
      expect(source.includes('base64')).toBe(false);
    }
  });
});

describe('lane boundary', () => {
  test('the engine never imports this package (fonts are strictly opt-in)', () => {
    const corePackage = JSON.parse(
      readFileSync(new URL('../../../core/package.json', import.meta.url), 'utf8')
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(corePackage.dependencies?.['@docx-editor.dev/fonts']).toBeUndefined();
    expect(corePackage.devDependencies?.['@docx-editor.dev/fonts']).toBeUndefined();
  });
});
