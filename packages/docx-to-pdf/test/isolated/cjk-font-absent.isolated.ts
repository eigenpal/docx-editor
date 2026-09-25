/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, mock, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { docx, paragraph } from '../fixture.ts';

// This file runs in its own process, so the missing package stays local to it. The loader
// answers exactly as Node does for a package that is not installed.
let imports = 0;
mock.module(fileURLToPath(new URL('../../../fonts-cjk/src/index.ts', import.meta.url)), () => {
  imports += 1;
  throw Object.assign(
    new Error("Cannot find package '@docx-editor.dev/fonts-cjk' imported from /app/index.js"),
    { code: 'ERR_MODULE_NOT_FOUND' }
  );
});
const { exportPdf, PdfFidelityError } = await import('../../src/index.ts');

test('without the CJK package, CJK text is reported and strict export refuses it', async () => {
  const source = docx(
    paragraph(
      '日本語 中文 한국어',
      '<w:rPr><w:rFonts w:ascii="MS Mincho" w:eastAsia="MS Mincho"/></w:rPr>'
    )
  );
  const result = await exportPdf(source, {
    useSystemFonts: false,
    fidelityPolicy: 'best-effort',
  });
  expect(imports).toBeGreaterThan(0);
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
  expect(codes).toContain('font-substitution');
  expect(codes).not.toContain('font-origin-failed');
  const missing = result.diagnostics.filter((diagnostic) => diagnostic.code === 'missing-glyph');
  expect(missing.length).toBeGreaterThan(0);
  for (const diagnostic of missing)
    expect(diagnostic.message).toContain(
      'install @docx-editor.dev/fonts-cjk for Chinese, Japanese, and Korean text'
    );
  const mincho = result.fontResolution.families.find((family) => family.family === 'MS Mincho');
  expect(mincho?.faces[0]?.sourceFamily).toBe('Liberation Sans');
  await expect(exportPdf(source, { useSystemFonts: false })).rejects.toBeInstanceOf(
    PdfFidelityError
  );
});

test('without the CJK package, a Latin document keeps every other packaged face', async () => {
  const source = docx(
    paragraph(
      'Sum ∑ of parts',
      '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr>'
    )
  );
  const result = await exportPdf(source, { useSystemFonts: false });
  expect(result.diagnostics).toEqual([]);
  const math = result.fontResolution.families.find((family) => family.family === 'Cambria Math');
  expect(math?.faces[0]?.sourceFamily).toBe('Noto Sans Math');
});
