/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A legacy shape with a CSS rgb() outline exports that outline at its weight.

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { createFontSource } from '@docx-editor.dev/core/editor';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

const FAMILY = 'DejaVu Sans';
const fontBytes = new Uint8Array(
  readFileSync(
    new URL('../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url)
  )
);
const source = createFontSource(fontBytes, { family: FAMILY, weight: 400, style: 'normal' });
if ('failure' in source) throw new Error(JSON.stringify(source.failure));

const RECT =
  '<w:p><w:r><w:t>Anchor</w:t></w:r><w:r><w:pict>' +
  '<v:rect xmlns:v="urn:schemas-microsoft-com:vml" id="Box" ' +
  'style="position:absolute;margin-left:72pt;margin-top:120pt;width:144pt;height:72pt;z-index:2" ' +
  'filled="f" strokecolor="rgb(255,0,0)" strokeweight="2pt"/></w:pict></w:r></w:p>';

test('an rgb() outline exports red at 2 pt', async () => {
  const result = await exportPdf(docx(RECT), {
    useSystemFonts: false,
    fidelityPolicy: 'best-effort',
    fonts: { sources: [source.source], defaultFont: { family: FAMILY, sizeHalfPoints: 22 } },
  });
  const parsed = await PDFDocument.load(result.bytes);
  const ops = parsed.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(object).decode())]
        : []
    )
    .join('\n');
  expect(ops).toMatch(/1 0 0 RG/);
  expect(ops).toMatch(/(^|\s)2 w(\s|$)/m);
});
