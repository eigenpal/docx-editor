/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canonicalFamily,
  installedWordFontResolver,
  supplementalFonts,
} from '../src/font-provisioning.ts';

async function directory(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'pdf-font-provision-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('installed discovery includes the default family when no run names it', async () => {
  await directory(async (root) => {
    await copyFile(
      new URL('../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url),
      join(root, 'Arial.ttf')
    );
    const resolve = installedWordFontResolver([root]);
    const implicit = await resolve({ families: [], defaultFamily: 'Arial' });
    const explicit = await resolve({ families: ['Arial'], defaultFamily: 'Arial' });
    expect(implicit.sources).toHaveLength(1);
    expect(implicit.sources[0]!.request).toEqual({ family: 'Arial', weight: 400, style: 'normal' });
    expect(explicit.sources).toEqual(implicit.sources);
  });
});

test('a collection without the requested family never substitutes its first face', async () => {
  await directory(async (root) => {
    await copyFile(
      new URL('./fixtures/Collection.ttc', import.meta.url),
      join(root, 'msgothic.ttc')
    );
    const result = await installedWordFontResolver([root])({
      families: ['MS Gothic'],
      defaultFamily: 'Unavailable Font',
    });
    expect(result.sources.length).toBe(0);
  });
});

test('installed discovery admits the Word symbol face when requested for glyph fallback', async () => {
  await directory(async (root) => {
    await copyFile(
      new URL('../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url),
      join(root, 'seguisym.ttf')
    );
    const result = await installedWordFontResolver([root])({
      families: ['Segoe UI Symbol'],
      defaultFamily: 'Arial',
    });
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]!.request).toEqual({
      family: 'Segoe UI Symbol',
      weight: 400,
      style: 'normal',
    });
  });
});

test('unknown and prototype-property family names do not become file candidates', async () => {
  await directory(async (root) => {
    const result = await installedWordFontResolver([root])({
      families: ['constructor', 'toString', '../../Arial', 'Unavailable Font'],
      defaultFamily: 'Unavailable Font',
    });
    expect(result.sources.length).toBe(0);
  });
});

test('installed discovery observes cancellation before reading a candidate', async () => {
  await directory(async (root) => {
    const controller = new AbortController();
    controller.abort(new Error('stop font lookup'));
    await expect(
      installedWordFontResolver([root])({
        families: ['Arial'],
        defaultFamily: 'Arial',
        signal: controller.signal,
      })
    ).rejects.toThrow('stop font lookup');
  });
});

test('installed discovery admits the legacy symbol faces a Word bullet names', async () => {
  await directory(async (root) => {
    const sample = new URL(
      '../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf',
      import.meta.url
    );
    for (const file of ['symbol.ttf', 'Wingdings.ttf', 'Wingdings 2.ttf', 'webdings.ttf']) {
      await copyFile(sample, join(root, file));
    }
    const result = await installedWordFontResolver([root])({
      families: ['Symbol', 'Wingdings', 'Wingdings 2', 'Webdings'],
      defaultFamily: 'Arial',
    });
    // One regular face each: a symbol font has no bold or italic file to find.
    expect(result.sources.map((source) => source.request)).toEqual([
      { family: 'Symbol', weight: 400, style: 'normal' },
      { family: 'Wingdings', weight: 400, style: 'normal' },
      { family: 'Wingdings 2', weight: 400, style: 'normal' },
      { family: 'Webdings', weight: 400, style: 'normal' },
    ]);
  });
});

test('a symbol face is only read when the document asks for it', async () => {
  await directory(async (root) => {
    await copyFile(
      new URL('../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url),
      join(root, 'symbol.ttf')
    );
    const result = await installedWordFontResolver([root])({
      families: ['Arial'],
      defaultFamily: 'Arial',
    });
    expect(result.sources.length).toBe(0);
  });
});

// Every export used to open all five packaged faces, 16 MB of them one CJK face, before layout
// had asked for anything. A face is read only when something names it: the document, a
// requested fallback, or the substitution that stands in for a family the document uses.
test('packaged faces are read only for the families that ask for them', async () => {
  const latin = await supplementalFonts({ families: ['Arial'], defaultFamily: 'Arial' });
  expect(latin.sources).toHaveLength(0);
  const math = await supplementalFonts({ families: ['Noto Sans Math'], defaultFamily: 'Arial' });
  expect(math.sources.map((source) => source.request.family)).toEqual(['Noto Sans Math']);
  // A substituted family pulls in its stand-in and nothing else.
  const cambria = await supplementalFonts({ families: ['Cambria Math'], defaultFamily: 'Arial' });
  expect(cambria.sources.map((source) => source.request.family)).toEqual(['Noto Sans Math']);
  expect(cambria.substitutions.every((s) => s.to.family === 'Noto Sans Math')).toBe(true);
});

test('a styled or localized family name resolves to the face Word would use', () => {
  expect(canonicalFamily('Times New Roman Bold')).toEqual({
    family: 'Times New Roman',
    bold: true,
    italic: false,
  });
  expect(canonicalFamily('Arial Bold Italic')).toEqual({
    family: 'Arial',
    bold: true,
    italic: true,
  });
  expect(canonicalFamily('宋体')).toEqual({ family: 'SimSun', bold: false, italic: false });
  expect(canonicalFamily('ＭＳ 明朝')).toEqual({ family: 'MS Mincho', bold: false, italic: false });
  // Only the four style words fold; a family that happens to end in another word does not.
  expect(canonicalFamily('Segoe UI Light')).toEqual({
    family: 'Segoe UI Light',
    bold: false,
    italic: false,
  });
});

test('installed discovery reads a face-named family and a styled family name', async () => {
  await directory(async (root) => {
    const sample = new URL(
      '../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf',
      import.meta.url
    );
    for (const file of ['Aptos.ttf', 'Aptos-Bold.ttf', 'timesbd.ttf', 'SimHei.ttf']) {
      await copyFile(sample, join(root, file));
    }
    const result = await installedWordFontResolver([root])({
      families: ['Aptos', 'Times New Roman Bold', '黑体'],
      defaultFamily: 'Aptos',
    });
    expect(result.sources.map((source) => source.request)).toEqual([
      { family: 'Aptos', weight: 400, style: 'normal' },
      { family: 'Aptos', weight: 700, style: 'normal' },
      // The bold file answers the styled name at both weights, under the name layout asks for.
      { family: 'Times New Roman Bold', weight: 400, style: 'normal' },
      { family: 'Times New Roman Bold', weight: 700, style: 'normal' },
      { family: '黑体', weight: 400, style: 'normal' },
    ]);
  });
});

test('packaged Latin substitutes stand in for Helvetica and for a styled Word family', async () => {
  const helvetica = await supplementalFonts({ families: ['Helvetica'], defaultFamily: 'Arial' });
  expect(helvetica.sources.map((source) => source.request)).toEqual([
    { family: 'Liberation Sans', weight: 400, style: 'normal' },
    { family: 'Liberation Sans', weight: 700, style: 'normal' },
    { family: 'Liberation Sans', weight: 400, style: 'italic' },
    { family: 'Liberation Sans', weight: 700, style: 'italic' },
  ]);
  expect(helvetica.substitutions).toContainEqual({
    from: { family: 'Helvetica', weight: 700, style: 'italic' },
    to: { family: 'Liberation Sans', weight: 700, style: 'italic' },
  });
  const styled = await supplementalFonts({
    families: ['Times New Roman Bold'],
    defaultFamily: 'Arial',
  });
  expect(styled.sources.map((source) => source.request.family)).toEqual(
    Array(4).fill('Liberation Serif')
  );
  // Bold is in the name, so every weight of the request is the bold face.
  expect(styled.substitutions.map((s) => s.to.weight)).toEqual([700, 700, 700, 700]);
  const cjk = await supplementalFonts({ families: ['宋体'], defaultFamily: 'Arial' });
  expect(cjk.sources.map((source) => source.request.family)).toEqual(['Noto Sans CJK JP']);
});
