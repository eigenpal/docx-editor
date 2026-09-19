/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import { exportPdf } from '../src/index.ts';

for (const fixture of ['images-crop', 'images-transform'])
  test(`${fixture} embeds the validated image once`, async () => {
    const source = new Uint8Array(
      readFileSync(new URL(`../../../e2e/fixtures/${fixture}.docx`, import.meta.url))
    );
    const result = await exportPdf(source);
    expect(result.diagnostics).toEqual([]);
    const pdf = await PDFDocument.load(result.bytes);
    const resources = pdf.getPage(0).node.Resources()!;
    const images = resources.lookup(PDFName.of('XObject'), PDFDict);
    expect(images.keys()).toHaveLength(1);
  });
test('image alpha is published by Core and encoded as a PDF graphics state', async () => {
  const source = new Uint8Array(
    readFileSync(new URL('../../../e2e/fixtures/images-crop.docx', import.meta.url))
  );
  const files = unzipSync(source);
  files['word/document.xml'] = strToU8(
    strFromU8(files['word/document.xml']!).replace(
      '</a:blip>',
      '<a:alphaModFix amt="50000"/></a:blip>'
    )
  );
  const result = await exportPdf(zipSync(files));
  expect(result.diagnostics).toEqual([]);
  const pdf = await PDFDocument.load(result.bytes);
  const states = pdf.getPage(0).node.Resources()!.lookup(PDFName.of('ExtGState'), PDFDict);
  expect(states.lookup(PDFName.of('Alpha50000'), PDFDict).get(PDFName.of('ca'))!.toString()).toBe(
    '0.5'
  );
});
