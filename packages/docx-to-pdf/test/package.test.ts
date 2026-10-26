/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { exportPdf } from '../src/index.ts';
import { docx, paragraph } from './fixture.ts';

test('package supports public releases and the encoder does not reshape text', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(pkg.private).toBe(false);
  expect(pkg.publishConfig.access).toBe('public');
  expect(pkg.peerDependencies['@docx-editor.dev/core']).toBeDefined();
  expect(pkg.dependencies['@docx-editor.dev/core']).toBeUndefined();
  const source = ['fonts.ts', 'text.ts', 'paint.ts']
    .map((name) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8'))
    .join('\n');
  expect(source).not.toMatch(/\.drawText\(|\.widthOfTextAtSize\(|\.layout\(/);
});
test('strict export preserves explicit physical page geometry', async () => {
  const source = docx(
    paragraph('Physical page geometry', '<w:rPr><w:rFonts w:ascii="Arial"/></w:rPr>') +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>'
  );
  const result = await exportPdf(source, { useSystemFonts: false });
  const pdf = await PDFDocument.load(result.bytes);
  expect(result.diagnostics).toEqual([]);
  expect(result.pageCount).toBe(1);
  expect(pdf.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
});

test('fallback font binaries match the recorded inputs and carry their own licenses', () => {
  const assets = new URL('../assets/', import.meta.url);
  const sources = JSON.parse(readFileSync(new URL('sources.json', assets), 'utf8')) as Record<
    string,
    { installedSha256?: string }
  >;
  for (const [file, record] of Object.entries(sources)) {
    if (record.installedSha256)
      expect(
        createHash('sha256')
          .update(readFileSync(new URL(file, assets)))
          .digest('hex')
      ).toBe(record.installedSha256);
    if (file.endsWith('-OFL.txt'))
      expect(readFileSync(new URL(`../licenses/${file}`, import.meta.url), 'utf8')).toContain(
        'SIL OPEN FONT LICENSE'
      );
  }
  expect(
    readFileSync(new URL('../../../examples/vite/public/sample.docx', import.meta.url))
  ).toEqual(readFileSync(new URL('../../../examples/vite/public/sample.docx', import.meta.url)));
});
