// The whole chain, against the REAL engine (font-resolution-overhaul 4.5):
// loadDefaultFonts → composeFontConfiguration → createLayoutShaping → resolve('Calibri')
// lands on validated Carlito bytes, marked as a substitution — and an explicit source
// for the same face beats the substitute.
//
// core-contract is a devDependency here strictly FOR THIS TEST; the shipped module has
// no engine dependency in either direction.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  composeFontConfiguration,
  createLayoutShaping,
} from '@docx-editor.dev/core-contract/editor';
import { FontResolutionError, sha256FontBytes } from '@docx-editor.dev/core-contract/layout';
import { loadDefaultFonts } from '../index.ts';

const assetsDir = new URL('../../assets/', import.meta.url);

const localFetcher = ((input: RequestInfo | URL) => {
  const url = String(input);
  const file = url.slice(url.lastIndexOf('/') + 1);
  return Promise.resolve(new Response(new Uint8Array(readFileSync(new URL(file, assetsDir)))));
}) as typeof fetch;

describe('fonts package through the engine', () => {
  test('a document naming Calibri measures via validated Carlito bytes', async () => {
    const fragment = await loadDefaultFonts({ families: ['Calibri'], fetcher: localFetcher });
    const fonts = composeFontConfiguration({}, fragment);
    const shaping = await createLayoutShaping(fonts);
    const resolved = shaping.fonts.resolve({ family: 'Calibri', weight: 400, style: 'normal' });
    expect(resolved).not.toBeInstanceOf(FontResolutionError);
    if (resolved instanceof FontResolutionError) return;
    // Substitution is RECORDED, not silent: hosts can badge "Calibri → Carlito".
    expect(resolved.substitution).toEqual({
      requested: { family: 'Calibri', weight: 400, style: 'normal' },
      resolved: { family: 'Carlito', weight: 400, style: 'normal' },
    });
    const carlito = readFileSync(new URL('Carlito-Regular.ttf', assetsDir));
    expect(resolved.hash).toBe(sha256FontBytes(new Uint8Array(carlito)));
    (shaping.shaper as { dispose?: () => void }).dispose?.();
  });

  test('an explicit Calibri source beats the substitute mapping', async () => {
    const fragment = await loadDefaultFonts({ families: ['Calibri'], fetcher: localFetcher });
    // "Real Calibri" stand-in: any valid face supplied under the Calibri name.
    const dejavu = new Uint8Array(
      readFileSync(
        new URL('../../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url)
      )
    );
    const fonts = composeFontConfiguration(
      {
        sources: [
          {
            request: { family: 'Calibri', weight: 400, style: 'normal' },
            id: 'app-calibri',
            bytes: dejavu,
            hash: sha256FontBytes(dejavu),
            faceIndex: 0,
          },
        ],
      },
      fragment
    );
    const shaping = await createLayoutShaping(fonts);
    const resolved = shaping.fonts.resolve({ family: 'Calibri', weight: 400, style: 'normal' });
    expect(resolved).not.toBeInstanceOf(FontResolutionError);
    if (resolved instanceof FontResolutionError) return;
    // Direct source, no substitution — and it is the app's bytes.
    expect(resolved.substitution).toBeNull();
    expect(resolved.hash).toBe(sha256FontBytes(dejavu));
    (shaping.shaper as { dispose?: () => void }).dispose?.();
  });
});
