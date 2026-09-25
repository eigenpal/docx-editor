/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { NOTO_SANS_CJK_JP_URL } from '@docx-editor.dev/fonts-cjk';
import {
  importCjkFace,
  isPackageNotFound,
  packagedFontResolvers,
  PDF_GLYPH_FALLBACKS,
  type CjkFaceLocator,
} from '../src/font-provisioning.ts';
import { exportPdf } from '../src/index.ts';
import { docx, paragraph } from './fixture.ts';

const CJK = 'Noto Sans CJK JP';
const HINT = 'install @docx-editor.dev/fonts-cjk';

function counted(locate: CjkFaceLocator) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    locate: () => {
      calls += 1;
      return locate();
    },
  };
}

test('the PDF package no longer ships the CJK face and declares its package optional', () => {
  expect(existsSync(new URL('../assets/NotoSansCJKjp-Regular.otf', import.meta.url))).toBe(false);
  expect(existsSync(new URL('../licenses/NotoSansCJK-OFL.txt', import.meta.url))).toBe(false);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(pkg.peerDependencies['@docx-editor.dev/fonts-cjk']).toBe(
    pkg.peerDependencies['@docx-editor.dev/core']
  );
  expect(pkg.peerDependenciesMeta['@docx-editor.dev/fonts-cjk']).toEqual({ optional: true });
  expect(pkg.dependencies['@docx-editor.dev/fonts-cjk']).toBeUndefined();
});

test('the installed package supplies the face for CJK families from its own origin', async () => {
  expect((await importCjkFace())?.href).toBe(NOTO_SANS_CJK_JP_URL.href);
  const resolvers = packagedFontResolvers(async () => NOTO_SANS_CJK_JP_URL);
  const request = { families: ['宋体'], defaultFamily: 'Arial' };
  const cjk = await resolvers.cjkFonts(request);
  expect(cjk.sources.map((source) => source.request)).toEqual([
    { family: CJK, weight: 400, style: 'normal' },
  ]);
  expect(cjk.substitutions).toContainEqual({
    from: { family: '宋体', weight: 700, style: 'italic' },
    to: { family: CJK, weight: 400, style: 'normal' },
  });
  expect(await resolvers.supplementalFonts(request)).toEqual({ sources: [], substitutions: [] });
  expect(await resolvers.standInFonts(request)).toEqual({ sources: [], substitutions: [] });
  expect(resolvers.isGenericSubstitution('宋体', CJK)).toBe(false);
  expect(resolvers.missingGlyphHint('日本語')).toBe('');
});

test('without the package, CJK families take the reported stand-in and glyphs name it', async () => {
  const locator = counted(async () => null);
  const resolvers = packagedFontResolvers(locator.locate);
  // Before any lookup, nothing is known to be missing.
  expect(resolvers.missingGlyphHint('日本語')).toBe('');
  const request = { families: ['宋体', 'MS Mincho', CJK, 'Cambria Math'], defaultFamily: 'Arial' };
  expect(await resolvers.cjkFonts(request)).toEqual({ sources: [] });
  const result = await resolvers.supplementalFonts(request);
  expect(result.sources.map((source) => source.request.family)).toEqual(['Noto Sans Math']);
  expect(result.substitutions.every((s) => s.to.family !== CJK)).toBe(true);
  const standIn = await resolvers.standInFonts({
    families: ['宋体', CJK],
    defaultFamily: 'Arial',
  });
  expect(standIn.sources.map((source) => source.request.family)).toEqual(
    Array(4).fill('Liberation Sans')
  );
  expect(standIn.substitutions).toContainEqual({
    from: { family: '宋体', weight: 700, style: 'normal' },
    to: { family: 'Liberation Sans', weight: 700, style: 'normal' },
  });
  expect(resolvers.isGenericSubstitution('宋体', 'Liberation Sans')).toBe(true);
  // Families outside the CJK plan keep their meaning.
  expect(resolvers.isGenericSubstitution('Calibri', 'Carlito')).toBe(false);
  expect(resolvers.missingGlyphHint('日本語')).toBe(
    `; ${HINT} for Chinese, Japanese, and Korean text`
  );
  expect(resolvers.missingGlyphHint('한국어')).toContain(HINT);
  expect(resolvers.missingGlyphHint(String.fromCodePoint(0x20000))).toContain(HINT);
  expect(resolvers.missingGlyphHint('Hello')).toBe('');
  expect(resolvers.missingGlyphHint('😀')).toBe('');
  expect(locator.calls).toBe(1);
});

test('a request that names no CJK family never looks for the package', async () => {
  const locator = counted(async () => null);
  const resolvers = packagedFontResolvers(locator.locate);
  const request = { families: ['Helvetica', 'Montserrat'], defaultFamily: 'Arial' };
  await resolvers.supplementalFonts(request);
  await resolvers.cjkFonts(request);
  await resolvers.standInFonts(request);
  expect(locator.calls).toBe(0);
});

// Core adds every glyph fallback to the families a resolver receives, so a real export always
// asks for the CJK face. Its failure must stay in its own origin.
const exportFamilies = [...PDF_GLYPH_FALLBACKS.map((face) => face.family), 'Calibri'];

for (const [name, locate] of [
  [
    'a broken package',
    async () => {
      throw new TypeError('@docx-editor.dev/fonts-cjk does not export NOTO_SANS_CJK_JP_URL');
    },
  ],
  [
    'a deployment without the package assets',
    async () => new URL('./missing-assets/NotoSansCJKjp-Regular.otf', import.meta.url),
  ],
] as const)
  test(`${name} fails the CJK origin alone and then reads as absent`, async () => {
    const locator = counted(locate);
    const resolvers = packagedFontResolvers(locator.locate);
    const request = { families: exportFamilies, defaultFamily: 'Arial' };
    const supplemental = await resolvers.supplementalFonts(request);
    expect(supplemental.sources.map((source) => source.request.family)).toEqual([
      'Noto Sans Symbols 2',
      'Noto Sans Math',
      'Noto Sans Arabic',
      'Twemoji Mozilla',
      'Noto Emoji',
    ]);
    await expect(resolvers.cjkFonts(request)).rejects.toThrow(
      '@docx-editor.dev/fonts-cjk could not supply its face'
    );
    await expect(resolvers.cjkFonts(request)).rejects.toThrow(
      '@docx-editor.dev/fonts-cjk could not supply its face'
    );
    const standIn = await resolvers.standInFonts({ families: ['宋体'], defaultFamily: 'Arial' });
    expect(standIn.substitutions[0]?.to.family).toBe('Liberation Sans');
    expect(resolvers.isGenericSubstitution('宋体', 'Liberation Sans')).toBe(true);
    expect(resolvers.missingGlyphHint('中文')).toContain(HINT);
    expect(locator.calls).toBe(1);
  });

test('a cancelled read does not mark the package absent', async () => {
  const resolvers = packagedFontResolvers(async () => NOTO_SANS_CJK_JP_URL);
  const request = { families: ['宋体'], defaultFamily: 'Arial', signal: AbortSignal.abort() };
  await expect(resolvers.cjkFonts(request)).rejects.toThrow();
  expect(resolvers.missingGlyphHint('中文')).toBe('');
  const cjk = await resolvers.cjkFonts({ families: ['宋体'], defaultFamily: 'Arial' });
  expect(cjk.sources).toHaveLength(1);
});

test('only "the package itself is not installed" reads as absent', () => {
  const name = '@docx-editor.dev/fonts-cjk';
  const error = (code: string, message: string) => Object.assign(new Error(message), { code });
  // Node ESM, Node CommonJS, and Bun.
  expect(
    isPackageNotFound(
      error('ERR_MODULE_NOT_FOUND', `Cannot find package '${name}' imported from /app/x.js`),
      name
    )
  ).toBe(true);
  expect(
    isPackageNotFound(
      error('MODULE_NOT_FOUND', `Cannot find module '${name}'\nRequire stack:\n- /app/x.cjs`),
      name
    )
  ).toBe(true);
  expect(
    isPackageNotFound(
      error('ERR_MODULE_NOT_FOUND', `Cannot find module '${name}' from '/app/x.js'`),
      name
    )
  ).toBe(true);
  // A broken install names a file inside the package, or another package.
  expect(
    isPackageNotFound(
      error(
        'ERR_MODULE_NOT_FOUND',
        `Cannot find module '/app/node_modules/${name}/dist/index.js' imported from /app/x.js`
      ),
      name
    )
  ).toBe(false);
  expect(
    isPackageNotFound(error('ERR_MODULE_NOT_FOUND', `Cannot find package '${name}-extra'`), name)
  ).toBe(false);
  expect(
    isPackageNotFound(error('ENOENT', `Cannot find package '${name}' imported from /app`), name)
  ).toBe(false);
  expect(isPackageNotFound(`Cannot find package '${name}'`, name)).toBe(false);
  expect(isPackageNotFound(null, name)).toBe(false);
});

test('a CJK document exports in the installed package face', async () => {
  const source = docx(
    paragraph(
      '日本語の文書 中文 한국어',
      '<w:rPr><w:rFonts w:ascii="MS Mincho" w:eastAsia="MS Mincho"/></w:rPr>'
    )
  );
  const result = await exportPdf(source, { useSystemFonts: false });
  expect(result.diagnostics).toEqual([]);
  expect(result.pageCount).toBe(1);
  const sha256 = createHash('sha256').update(readFileSync(NOTO_SANS_CJK_JP_URL)).digest('hex');
  const mincho = result.fontResolution.families.find((family) => family.family === 'MS Mincho');
  expect(mincho?.coverage).toBe('complete');
  expect(mincho?.faces[0]).toMatchObject({
    sourceFamily: CJK,
    via: 'substitution',
    hash: `sha256:${sha256}`,
  });
});
