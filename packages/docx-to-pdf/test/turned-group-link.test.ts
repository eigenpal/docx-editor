/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A link in the text of a group turned a quarter: the click area covers the turned text.

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
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
const FONT = source.source;

const NS =
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
  'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"';
const EMU = 12_700;

const LABEL =
  '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/>' +
  `<a:ext cx="${200 * EMU}" cy="${40 * EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/>` +
  '</a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr><wps:txbx><w:txbxContent>' +
  '<w:p><w:hyperlink r:id="rIdLink"><w:r><w:t>Linked label text</w:t></w:r></w:hyperlink></w:p>' +
  '</w:txbxContent></wps:txbx><wps:bodyPr lIns="0" tIns="0" rIns="0" bIns="0"/></wps:wsp>';

const group = (rot: string) =>
  `<w:p><w:r><w:t>Anchor</w:t></w:r><w:r><w:drawing ${NS}><wp:anchor distT="0" distB="0" ` +
  'distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" ' +
  'layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH ' +
  'relativeFrom="page"><wp:posOffset>1828800</wp:posOffset></wp:positionH><wp:positionV ' +
  `relativeFrom="page"><wp:posOffset>2540000</wp:posOffset></wp:positionV><wp:extent ` +
  `cx="${200 * EMU}" cy="${40 * EMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
  '<wp:docPr id="1" name="Group"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData ' +
  'uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"><wpg:wgp>' +
  `<wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm${rot}><a:off x="0" y="0"/>` +
  `<a:ext cx="${200 * EMU}" cy="${40 * EMU}"/><a:chOff x="0" y="0"/>` +
  `<a:chExt cx="${200 * EMU}" cy="${40 * EMU}"/></a:xfrm></wpg:grpSpPr>${LABEL}` +
  '</wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>';

const RELS =
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" ' +
  'Target="https://example.com/" TargetMode="External"/></Relationships>';

async function linkRect(rot: string): Promise<{ width: number; height: number }> {
  const result = await exportPdf(docx(group(rot), { 'word/_rels/document.xml.rels': RELS }), {
    useSystemFonts: false,
    fidelityPolicy: 'best-effort',
    fonts: { sources: [FONT], defaultFont: { family: FAMILY, sizeHalfPoints: 22 } },
  });
  const parsed = await PDFDocument.load(result.bytes);
  const annots = parsed.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
  for (let index = 0; index < annots.size(); index += 1) {
    const annot = annots.lookup(index, PDFDict);
    if (annot.get(PDFName.of('Subtype'))?.toString() !== '/Link') continue;
    const rect = annot.lookup(PDFName.of('Rect'), PDFArray);
    const [x0, y0, x1, y1] = [0, 1, 2, 3].map((i) => rect.lookup(i, PDFNumber).asNumber());
    return { width: Math.abs(x1! - x0!), height: Math.abs(y1! - y0!) };
  }
  throw new Error('no link annotation');
}

test('a link in turned group text has a click area over the turned text', async () => {
  const upright = await linkRect('');
  expect(upright.width).toBeGreaterThan(upright.height);
  const turned = await linkRect(' rot="5400000"');
  expect(turned.height).toBeCloseTo(upright.width, 1);
  expect(turned.width).toBeCloseTo(upright.height, 1);
});
