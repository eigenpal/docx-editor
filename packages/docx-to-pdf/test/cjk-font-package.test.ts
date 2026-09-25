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

test('the installed package supplies the face for CJK families', async () => {
  expect((await importCjkFace())?.href).toBe(NOTO_SANS_CJK_JP_URL.href);
  const resolvers = packagedFontResolvers(async () => NOTO_SANS_CJK_JP_URL);
  const result = await resolvers.supplementalFonts({ families: ['宋体'], defaultFamily: 'Arial' });
  expect(result.sources.map((source) => source.request)).toEqual([
    { family: CJK, weight: 400, style: 'normal' },
  ]);
  expect(result.substitutions).toContainEqual({
    from: { family: '宋体', weight: 700, style: 'italic' },
    to: { family: CJK, weight: 400, style: 'normal' },
  });
  const standIn = await resolvers.standInFonts({ families: ['宋体'], defaultFamily: 'Arial' });
  expect(standIn).toEqual({ sources: [], substitutions: [] });
  expect(resolvers.isGenericSubstitution('宋体', CJK)).toBe(false);
  expect(resolvers.missingGlyphHint('日本語')).toBe('');
});

test('without the package, CJK families take the reported stand-in and glyphs name it', async () => {
  const locator = counted(async () => null);
  const resolvers = packagedFontResolvers(locator.locate);
  // Before any lookup, nothing is known to be missing.
  expect(resolvers.missingGlyphHint('日本語')).toBe('');
  const result = await resolvers.supplementalFonts({
    families: ['宋体', 'MS Mincho', CJK, 'Cambria Math'],
    defaultFamily: 'Arial',
  });
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
  expect(resolvers.missingGlyphHint('\u{20000}')).toContain(HINT);
  expect(resolvers.missingGlyphHint('Hello')).toBe('');
  expect(resolvers.missingGlyphHint('😀')).toBe('');
  expect(locator.calls).toBe(1);
});

test('a document that needs no CJK face never looks for the package', async () => {
  const locator = counted(async () => null);
  const resolvers = packagedFontResolvers(locator.locate);
  await resolvers.supplementalFonts({ families: ['Helvetica'], defaultFamily: 'Arial' });
  await resolvers.standInFonts({ families: ['Montserrat'], defaultFamily: 'Arial' });
  expect(locator.calls).toBe(0);
});

test('a broken package fails the lookup loudly and then reads as absent', async () => {
  const broken = new Error('Invalid packaged face');
  const locator = counted(async () => {
    throw broken;
  });
  const resolvers = packagedFontResolvers(locator.locate);
  await expect(
    resolvers.supplementalFonts({ families: ['宋体'], defaultFamily: 'Arial' })
  ).rejects.toBe(broken);
  const standIn = await resolvers.standInFonts({ families: ['宋体'], defaultFamily: 'Arial' });
  expect(standIn.substitutions[0]?.to.family).toBe('Liberation Sans');
  expect(resolvers.missingGlyphHint('中文')).toContain(HINT);
  expect(locator.calls).toBe(1);
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
