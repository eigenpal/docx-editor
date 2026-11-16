/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A group with one member that has no fill and no outline exports its other members.

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

const NS =
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
  'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"';
const EMU = 12_700;

const member = (x: number, fill: string) =>
  `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="${x}" y="0"/>` +
  `<a:ext cx="${100 * EMU}" cy="${80 * EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/>` +
  `</a:prstGeom>${fill}<a:ln><a:noFill/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp>`;

const GROUP =
  `<w:p><w:r><w:t>Anchor</w:t></w:r><w:r><w:drawing ${NS}><wp:anchor distT="0" distB="0" ` +
  'distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" ' +
  'layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH ' +
  'relativeFrom="page"><wp:posOffset>1828800</wp:posOffset></wp:positionH><wp:positionV ' +
  `relativeFrom="page"><wp:posOffset>2540000</wp:posOffset></wp:positionV><wp:extent ` +
  `cx="${200 * EMU}" cy="${80 * EMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
  '<wp:docPr id="1" name="Group"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData ' +
  'uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"><wpg:wgp>' +
  '<wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/>' +
  `<a:ext cx="${200 * EMU}" cy="${80 * EMU}"/><a:chOff x="0" y="0"/>` +
  `<a:chExt cx="${200 * EMU}" cy="${80 * EMU}"/></a:xfrm></wpg:grpSpPr>` +
  member(0, '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>') +
  member(100 * EMU, '<a:noFill/>') +
  '</wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>';

test('a group exports its painted member beside a member that paints nothing', async () => {
  const result = await exportPdf(docx(GROUP), {
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
  // The red member paints; the member with no fill and no outline paints nothing.
  expect(ops).toMatch(/1 0 0 rg/);
});
